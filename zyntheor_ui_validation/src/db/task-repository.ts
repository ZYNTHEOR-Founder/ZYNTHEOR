import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, requireCloudSql } from './index.ts';
import { executionTasks } from './schema.ts';

export interface TaskOwner {
  tenantId: string;
  ownerUserId: string;
}

export interface TaskRecordLike {
  taskId: string;
  tenantId: string;
  ownerUserId: string;
  lifecycleStatus: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

function assertOwner(owner: TaskOwner): void {
  if (!owner?.tenantId?.trim() || !owner?.ownerUserId?.trim()) {
    throw new Error('VERIFIED_TASK_OWNER_REQUIRED');
  }
}

function assertRecord(record: TaskRecordLike, owner: TaskOwner): void {
  assertOwner(owner);
  if (!record?.taskId?.trim()) throw new Error('TASK_ID_REQUIRED');
  if (record.tenantId !== owner.tenantId || record.ownerUserId !== owner.ownerUserId) {
    throw new Error('TASK_OWNER_MISMATCH');
  }
}

/** Atomic create/update. A task ID already owned by another principal is never overwritten. */
export async function saveTaskRecord(record: TaskRecordLike, owner: TaskOwner): Promise<void> {
  assertRecord(record, owner);
  requireCloudSql();
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(executionTasks).values({
      taskId: record.taskId,
      tenantId: owner.tenantId,
      ownerUserId: owner.ownerUserId,
      lifecycleStatus: record.lifecycleStatus,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      task: record as Record<string, unknown>,
    }).onConflictDoNothing({ target: executionTasks.taskId }).returning({ taskId: executionTasks.taskId });

    if (inserted.length) return;

    const updated = await tx.update(executionTasks).set({
      lifecycleStatus: record.lifecycleStatus,
      updatedAt: new Date(record.updatedAt),
      task: record as Record<string, unknown>,
    }).where(and(
      eq(executionTasks.taskId, record.taskId),
      eq(executionTasks.tenantId, owner.tenantId),
      eq(executionTasks.ownerUserId, owner.ownerUserId),
    )).returning({ taskId: executionTasks.taskId });

    if (!updated.length) throw new Error('TASK_ID_OWNERSHIP_CONFLICT');
  }, { isolationLevel: 'serializable' });
}

export async function getTaskRecord(taskId: string, owner: TaskOwner): Promise<TaskRecordLike | null> {
  assertOwner(owner);
  requireCloudSql();
  const [row] = await db.select({ task: executionTasks.task })
    .from(executionTasks)
    .where(and(
      eq(executionTasks.taskId, taskId),
      eq(executionTasks.tenantId, owner.tenantId),
      eq(executionTasks.ownerUserId, owner.ownerUserId),
    )).limit(1);
  return (row?.task as TaskRecordLike | undefined) ?? null;
}

export async function listTaskRecords(owner: TaskOwner, limit = 100): Promise<TaskRecordLike[]> {
  assertOwner(owner);
  requireCloudSql();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db.select({ task: executionTasks.task })
    .from(executionTasks)
    .where(and(
      eq(executionTasks.tenantId, owner.tenantId),
      eq(executionTasks.ownerUserId, owner.ownerUserId),
    ))
    .orderBy(desc(executionTasks.createdAt))
    .limit(safeLimit);
  return rows.map((row) => row.task as TaskRecordLike);
}

export async function deleteTaskRecord(taskId: string, owner: TaskOwner): Promise<boolean> {
  assertOwner(owner);
  requireCloudSql();
  const deleted = await db.delete(executionTasks).where(and(
    eq(executionTasks.taskId, taskId),
    eq(executionTasks.tenantId, owner.tenantId),
    eq(executionTasks.ownerUserId, owner.ownerUserId),
  )).returning({ taskId: executionTasks.taskId });
  return deleted.length > 0;
}

/**
 * Atomically claims one queued task for a worker. PostgreSQL row locking with
 * SKIP LOCKED prevents two workers from starting the same task concurrently.
 * The claim is always constrained by the verified tenant and owner identity.
 */
export async function claimNextTaskRecord(owner: TaskOwner): Promise<TaskRecordLike | null> {
  assertOwner(owner);
  requireCloudSql();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(executionTasks).where(and(
      eq(executionTasks.tenantId, owner.tenantId),
      eq(executionTasks.ownerUserId, owner.ownerUserId),
      eq(executionTasks.lifecycleStatus, 'Planned'),
    )).orderBy(executionTasks.createdAt).limit(1).for('update', { skipLocked: true });

    if (!row) return null;
    const claimedAt = new Date();
    const claimedTask = {
      ...(row.task as Record<string, unknown>),
      lifecycleStatus: 'In Progress',
      updatedAt: claimedAt.toISOString(),
    } as TaskRecordLike;
    const updated = await tx.update(executionTasks).set({
      lifecycleStatus: 'In Progress',
      updatedAt: claimedAt,
      task: claimedTask as Record<string, unknown>,
    }).where(and(
      eq(executionTasks.taskId, row.taskId),
      eq(executionTasks.tenantId, owner.tenantId),
      eq(executionTasks.ownerUserId, owner.ownerUserId),
      eq(executionTasks.lifecycleStatus, 'Planned'),
    )).returning({ taskId: executionTasks.taskId });
    if (!updated.length) throw new Error('TASK_CLAIM_CONFLICT');
    return claimedTask;
  }, { isolationLevel: 'serializable' });
}

/** Persist lifecycle changes only while the caller still owns the task. */
export async function updateTaskRecord(
  record: TaskRecordLike,
  owner: TaskOwner,
  expectedStatuses?: string[],
): Promise<void> {
  assertRecord(record, owner);
  requireCloudSql();
  await db.transaction(async (tx) => {
    const conditions = [
      eq(executionTasks.taskId, record.taskId),
      eq(executionTasks.tenantId, owner.tenantId),
      eq(executionTasks.ownerUserId, owner.ownerUserId),
    ];
    if (expectedStatuses?.length) {
      conditions.push(inArray(executionTasks.lifecycleStatus, expectedStatuses));
    }
    const updated = await tx.update(executionTasks).set({
      lifecycleStatus: record.lifecycleStatus,
      updatedAt: new Date(record.updatedAt),
      task: record as Record<string, unknown>,
    }).where(and(...conditions)).returning({ taskId: executionTasks.taskId });
    if (!updated.length) throw new Error('TASK_UPDATE_NOT_FOUND_OR_STATE_CONFLICT');
  }, { isolationLevel: 'serializable' });
}
