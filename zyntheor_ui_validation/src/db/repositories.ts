import { desc, eq, and, sql, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import { db, isCloudSqlConfigured } from './index.ts';
import {
  auditLedger,
  curatedDatasets,
  knowledgeChunks,
  knowledgeDocuments,
  memoryStore,
  modelCheckpoints,
  quickLogSeals,
} from './schema.ts';

// ---------------------------------------------------------------------------
// 1. Audit Ledger Repository (Cloud SQL PostgreSQL)
// ---------------------------------------------------------------------------

export async function appendCloudAuditRecord(record: {
  blockIndex: number;
  timestamp: string;
  prevHash: string;
  role: string;
  action: string;
  payloadDigest: string;
  payload: Record<string, unknown>;
  payloadRaw?: string;
  entryHash: string;
  tenantId?: string;
  userUid?: string;
}) {
  if (!isCloudSqlConfigured()) return null;
  try {
    const payloadRaw = record.payloadRaw ?? JSON.stringify(record.payload);
    const [inserted] = await db
      .insert(auditLedger)
      .values({
        blockIndex: record.blockIndex,
        timestamp: record.timestamp,
        prevHash: record.prevHash,
        role: record.role,
        action: record.action,
        payloadDigest: record.payloadDigest,
        payload: record.payload,
        payloadRaw,
        entryHash: record.entryHash,
        tenantId: record.tenantId ?? null,
        userUid: record.userUid ?? null,
      })
      .onConflictDoNothing({ target: auditLedger.blockIndex })
      .returning();
    return inserted ?? null;
  } catch (error) {
    console.error('[CloudSQL] appendCloudAuditRecord failed:', error);
    throw new Error('Failed to persist audit record to Cloud SQL.', { cause: error });
  }
}

export async function getCloudAuditChainHead(): Promise<{
  count: number;
  maxIndex: number;
  headHash: string;
  missingRawCount: number;
}> {
  if (!isCloudSqlConfigured()) return { count: 0, maxIndex: -1, headHash: '0'.repeat(64), missingRawCount: 0 };
  try {
    const rows = await db
      .select({
        blockIndex: auditLedger.blockIndex,
        entryHash: auditLedger.entryHash,
      })
      .from(auditLedger)
      .orderBy(desc(auditLedger.blockIndex));
    if (rows.length === 0) {
      return { count: 0, maxIndex: -1, headHash: '0'.repeat(64), missingRawCount: 0 };
    }
    const missingRows = await db
      .select({ id: auditLedger.id })
      .from(auditLedger)
      .where(isNull(auditLedger.payloadRaw));
    return {
      count: rows.length,
      maxIndex: rows[0].blockIndex,
      headHash: rows[0].entryHash,
      missingRawCount: missingRows.length,
    };
  } catch (error) {
    console.error('[CloudSQL] getCloudAuditChainHead failed:', error);
    throw new Error('Failed to read audit chain head from Cloud SQL.', { cause: error });
  }
}

export async function getAllCloudAuditRecordsAsc() {
  if (!isCloudSqlConfigured()) return [];
  try {
    const rows = await db
      .select()
      .from(auditLedger)
      .orderBy(auditLedger.blockIndex);
    return rows.map((r) => ({
      index: r.blockIndex,
      timestamp: r.timestamp,
      prev_hash: r.prevHash,
      role: r.role,
      action: r.action,
      payload_digest: r.payloadDigest,
      payload: r.payload,
      entry_hash: r.entryHash,
    }));
  } catch (error) {
    console.error('[CloudSQL] getAllCloudAuditRecordsAsc failed:', error);
    throw new Error('Failed to query full audit chain from Cloud SQL.', { cause: error });
  }
}

export async function syncCloudAuditRecords(
  records: Array<{
    blockIndex: number;
    timestamp: string;
    prevHash: string;
    role: string;
    action: string;
    payloadDigest: string;
    payload: Record<string, unknown>;
    payloadRaw?: string;
    entryHash: string;
    tenantId?: string;
    userUid?: string;
  }>
): Promise<number> {
  if (!isCloudSqlConfigured() || records.length === 0) return 0;
  try {
    let insertedTotal = 0;
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const slice = records.slice(i, i + batchSize);
      const inserted = await db
        .insert(auditLedger)
        .values(
          slice.map((record) => ({
            blockIndex: record.blockIndex,
            timestamp: record.timestamp,
            prevHash: record.prevHash,
            role: record.role,
            action: record.action,
            payloadDigest: record.payloadDigest,
            payload: record.payload,
            payloadRaw: record.payloadRaw ?? JSON.stringify(record.payload),
            entryHash: record.entryHash,
            tenantId: record.tenantId ?? null,
            userUid: record.userUid ?? null,
          }))
        )
        .onConflictDoUpdate({
          target: auditLedger.blockIndex,
          set: {
            payloadRaw: sql`COALESCE(${auditLedger.payloadRaw}, excluded.payload_raw)`,
          },
        })
        .returning({ id: auditLedger.id });
      insertedTotal += inserted.length;
    }
    return insertedTotal;
  } catch (error) {
    console.error('[CloudSQL] syncCloudAuditRecords failed:', error);
    throw new Error('Failed to sync audit records to Cloud SQL.', { cause: error });
  }
}

export async function getRecentCloudAuditRecords(limit: number = 50) {
  if (!isCloudSqlConfigured()) return [];
  try {
    const rows = await db
      .select()
      .from(auditLedger)
      .orderBy(desc(auditLedger.blockIndex))
      .limit(limit);
    return rows.map((r) => ({
      index: r.blockIndex,
      timestamp: r.timestamp,
      prev_hash: r.prevHash,
      role: r.role,
      action: r.action,
      payload_digest: r.payloadDigest,
      payload: r.payload,
      entry_hash: r.entryHash,
    }));
  } catch (error) {
    console.error('[CloudSQL] getRecentCloudAuditRecords failed:', error);
    throw new Error('Failed to query audit ledger from Cloud SQL.', { cause: error });
  }
}

export async function verifyCloudAuditChain() {
  if (!isCloudSqlConfigured()) {
    return { configured: false, valid: false, totalRecords: 0, headHash: '' };
  }
  try {
    const rows = await db
      .select()
      .from(auditLedger)
      .orderBy(auditLedger.blockIndex);
    if (rows.length === 0) {
      return { configured: true, valid: true, totalRecords: 0, headHash: '0'.repeat(64) };
    }
    let expectedPrev = '0'.repeat(64);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.blockIndex !== i || r.prevHash !== expectedPrev) {
        return {
          configured: true,
          valid: false,
          totalRecords: rows.length,
          headHash: '',
          brokenIndex: i,
          error: `Chain break at block ${i}`,
        };
      }
      const rawPayloadStr = r.payloadRaw ?? JSON.stringify(r.payload);
      const calcPayload = crypto.createHash('sha256').update(rawPayloadStr).digest('hex');
      if (calcPayload !== r.payloadDigest) {
        return {
          configured: true,
          valid: false,
          totalRecords: rows.length,
          headHash: '',
          brokenIndex: i,
          error: `Payload mismatch at block ${i}`,
        };
      }
      const preimage = `${r.blockIndex}|${r.timestamp}|${r.prevHash}|${r.role}|${r.action}|${r.payloadDigest}`;
      const calcEntry = crypto.createHash('sha256').update(preimage).digest('hex');
      if (calcEntry !== r.entryHash) {
        return {
          configured: true,
          valid: false,
          totalRecords: rows.length,
          headHash: '',
          brokenIndex: i,
          error: `Entry hash invalid at block ${i}`,
        };
      }
      expectedPrev = r.entryHash;
    }
    return {
      configured: true,
      valid: true,
      totalRecords: rows.length,
      headHash: rows[rows.length - 1].entryHash,
    };
  } catch (error) {
    console.error('[CloudSQL] verifyCloudAuditChain failed:', error);
    throw new Error('Failed to verify audit chain in Cloud SQL.', { cause: error });
  }
}

// ---------------------------------------------------------------------------
// 2. Quick Log Seals Repository (Cloud SQL PostgreSQL)
// ---------------------------------------------------------------------------

export async function saveCloudQuickLogSeal(seal: {
  sealId: string;
  userId: string;
  tenantId: string;
  contentHash: string;
  entryHash: string;
  logs: string[];
}) {
  if (!isCloudSqlConfigured()) return null;
  try {
    const [row] = await db
      .insert(quickLogSeals)
      .values({
        sealId: seal.sealId,
        userId: seal.userId,
        tenantId: seal.tenantId,
        contentHash: seal.contentHash,
        entryHash: seal.entryHash,
        logs: seal.logs,
      })
      .onConflictDoNothing({ target: quickLogSeals.sealId })
      .returning();
    return row ?? null;
  } catch (error) {
    console.error('[CloudSQL] saveCloudQuickLogSeal failed:', error);
    throw new Error('Failed to persist quick log seal in Cloud SQL.', { cause: error });
  }
}

export async function getLatestCloudQuickLogSeal(userId: string) {
  if (!isCloudSqlConfigured()) return null;
  try {
    const [row] = await db
      .select()
      .from(quickLogSeals)
      .where(eq(quickLogSeals.userId, userId))
      .orderBy(desc(quickLogSeals.sealedAt))
      .limit(1);
    return row ?? null;
  } catch (error) {
    console.error('[CloudSQL] getLatestCloudQuickLogSeal failed:', error);
    throw new Error('Failed to query quick log seal from Cloud SQL.', { cause: error });
  }
}

// ---------------------------------------------------------------------------
// 3. Memory Store Repository (Cloud SQL PostgreSQL)
// ---------------------------------------------------------------------------

export async function upsertCloudMemory(item: {
  memoryKey: string;
  tenantId?: string;
  userUid?: string;
  category: string;
  value: unknown;
  readCount?: number;
  metadata?: Record<string, unknown>;
  contentDigest: string;
}) {
  if (!isCloudSqlConfigured()) return null;
  const tenantId = item.tenantId || 'default-tenant';
  try {
    const [row] = await db
      .insert(memoryStore)
      .values({
        memoryKey: item.memoryKey,
        tenantId,
        userUid: item.userUid ?? null,
        category: item.category,
        value: item.value,
        readCount: item.readCount ?? 0,
        metadata: item.metadata ?? null,
        contentDigest: item.contentDigest,
      })
      .onConflictDoUpdate({
        target: [memoryStore.tenantId, memoryStore.memoryKey],
        set: {
          category: item.category,
          value: item.value,
          readCount: item.readCount ?? 0,
          metadata: item.metadata ?? null,
          contentDigest: item.contentDigest,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row ?? null;
  } catch (error) {
    console.error('[CloudSQL] upsertCloudMemory failed:', error);
    throw new Error('Failed to persist memory entry to Cloud SQL.', { cause: error });
  }
}

export async function listCloudMemories(tenantId: string = 'default-tenant') {
  if (!isCloudSqlConfigured()) return [];
  try {
    return await db
      .select()
      .from(memoryStore)
      .where(eq(memoryStore.tenantId, tenantId))
      .orderBy(desc(memoryStore.updatedAt));
  } catch (error) {
    console.error('[CloudSQL] listCloudMemories failed:', error);
    throw new Error('Failed to query memory entries from Cloud SQL.', { cause: error });
  }
}

export async function deleteCloudMemory(memoryKey: string, tenantId: string = 'default-tenant') {
  if (!isCloudSqlConfigured()) return false;
  try {
    const deleted = await db
      .delete(memoryStore)
      .where(and(eq(memoryStore.tenantId, tenantId), eq(memoryStore.memoryKey, memoryKey)))
      .returning({ id: memoryStore.id });
    return deleted.length > 0;
  } catch (error) {
    console.error('[CloudSQL] deleteCloudMemory failed:', error);
    throw new Error('Failed to delete memory entry from Cloud SQL.', { cause: error });
  }
}

// ---------------------------------------------------------------------------
// 4. Knowledge Workspace Repository (Cloud SQL PostgreSQL)
// ---------------------------------------------------------------------------

export async function upsertCloudKnowledgeDocument(
  doc: {
    id: string;
    title: string;
    content: string;
    source: string;
    format: string;
    collection: string;
    tags: string[];
    language: string;
    version: number;
    contentHash: string;
    status: string;
    chunksCount: number;
    byteSize: number;
    provenance: string;
    curatedForTraining: boolean;
    tenantId?: string;
    readRoles?: string[];
    parsedMetadata?: Record<string, unknown>;
    userUid?: string;
  },
  chunks: Array<{
    id: string;
    documentId: string;
    documentTitle: string;
    collection: string;
    chunkIndex: number;
    text: string;
    language: string;
    hash: string;
    tenantId?: string;
  }>
) {
  if (!isCloudSqlConfigured()) return null;
  const tenantId = doc.tenantId || 'default-tenant';
  try {
    const [savedDoc] = await db
      .insert(knowledgeDocuments)
      .values({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        source: doc.source,
        format: doc.format,
        collection: doc.collection,
        tags: doc.tags,
        language: doc.language,
        version: doc.version,
        contentHash: doc.contentHash,
        status: doc.status,
        chunksCount: doc.chunksCount,
        byteSize: doc.byteSize,
        provenance: doc.provenance,
        curatedForTraining: doc.curatedForTraining,
        tenantId,
        readRoles: doc.readRoles ?? null,
        parsedMetadata: doc.parsedMetadata ?? null,
        userUid: doc.userUid ?? null,
      })
      .onConflictDoUpdate({
        target: knowledgeDocuments.id,
        set: {
          title: doc.title,
          content: doc.content,
          collection: doc.collection,
          tags: doc.tags,
          language: doc.language,
          version: doc.version,
          contentHash: doc.contentHash,
          status: doc.status,
          chunksCount: doc.chunksCount,
          byteSize: doc.byteSize,
          parsedMetadata: doc.parsedMetadata ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, doc.id));
    if (chunks.length > 0) {
      await db.insert(knowledgeChunks).values(
        chunks.map((c) => ({
          id: c.id,
          documentId: c.documentId,
          documentTitle: c.documentTitle,
          collection: c.collection,
          chunkIndex: c.chunkIndex,
          text: c.text,
          language: c.language,
          hash: c.hash,
          tenantId: c.tenantId || tenantId,
        }))
      );
    }
    return savedDoc ?? null;
  } catch (error) {
    console.error('[CloudSQL] upsertCloudKnowledgeDocument failed:', error);
    throw new Error('Failed to persist knowledge document in Cloud SQL.', { cause: error });
  }
}

export async function listCloudKnowledgeDocuments(tenantId?: string) {
  if (!isCloudSqlConfigured()) return [];
  try {
    if (tenantId) {
      return await db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.tenantId, tenantId))
        .orderBy(desc(knowledgeDocuments.updatedAt));
    }
    return await db
      .select()
      .from(knowledgeDocuments)
      .orderBy(desc(knowledgeDocuments.updatedAt));
  } catch (error) {
    console.error('[CloudSQL] listCloudKnowledgeDocuments failed:', error);
    throw new Error('Failed to query knowledge documents from Cloud SQL.', { cause: error });
  }
}

export async function deleteCloudKnowledgeDocument(id: string) {
  if (!isCloudSqlConfigured()) return false;
  try {
    const deleted = await db
      .delete(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .returning({ id: knowledgeDocuments.id });
    return deleted.length > 0;
  } catch (error) {
    console.error('[CloudSQL] deleteCloudKnowledgeDocument failed:', error);
    throw new Error('Failed to delete knowledge document from Cloud SQL.', { cause: error });
  }
}

export async function saveCloudCuratedDataset(
  manifest: {
    datasetId: string;
    name: string;
    version: string;
    createdAt?: string | Date;
    sourceDocIds: string[];
    totalSamples: number;
    trainSamples: number;
    valSamples: number;
    evalSamples: number;
    totalTokensEstimate: number;
    thaiScriptRatio: number;
    englishScriptRatio: number;
    datasetHash: string;
    syntheticCount: number;
    originalCount: number;
    qualityScoreAvg: number;
    status: string;
  },
  items: Array<Record<string, unknown>>
) {
  if (!isCloudSqlConfigured()) return null;
  try {
    const createdDate = manifest.createdAt ? new Date(manifest.createdAt) : new Date();
    const [row] = await db
      .insert(curatedDatasets)
      .values({
        datasetId: manifest.datasetId,
        name: manifest.name,
        version: manifest.version,
        sourceDocIds: manifest.sourceDocIds,
        totalSamples: manifest.totalSamples,
        trainSamples: manifest.trainSamples,
        valSamples: manifest.valSamples,
        evalSamples: manifest.evalSamples,
        totalTokensEstimate: manifest.totalTokensEstimate,
        thaiScriptRatio: manifest.thaiScriptRatio,
        englishScriptRatio: manifest.englishScriptRatio,
        datasetHash: manifest.datasetHash,
        syntheticCount: manifest.syntheticCount,
        originalCount: manifest.originalCount,
        qualityScoreAvg: Math.round(manifest.qualityScoreAvg),
        status: manifest.status,
        createdAt: Number.isNaN(createdDate.getTime()) ? new Date() : createdDate,
        items,
      })
      .onConflictDoUpdate({
        target: curatedDatasets.datasetId,
        set: {
          status: manifest.status,
          datasetHash: manifest.datasetHash,
          items,
        },
      })
      .returning();
    return row ?? null;
  } catch (error) {
    console.error('[CloudSQL] saveCloudCuratedDataset failed:', error);
    throw new Error('Failed to save curated dataset in Cloud SQL.', { cause: error });
  }
}

// ---------------------------------------------------------------------------
// 5. Cloud Model Checkpoint Registry (PostgreSQL metadata -> S3/R2/GCS Object)
// ---------------------------------------------------------------------------

export async function upsertCloudModelCheckpoint(entry: {
  modelKey: string;
  storageProvider: string;
  bucket: string;
  objectKey: string;
  sha256: string;
  totalParams: number;
  architecture: string;
  storageMode: string;
  byteSize: number;
  metadata?: Record<string, unknown>;
}) {
  if (!isCloudSqlConfigured()) return null;
  try {
    const [row] = await db
      .insert(modelCheckpoints)
      .values({
        modelKey: entry.modelKey,
        storageProvider: entry.storageProvider,
        bucket: entry.bucket,
        objectKey: entry.objectKey,
        sha256: entry.sha256,
        totalParams: entry.totalParams,
        architecture: entry.architecture,
        storageMode: entry.storageMode,
        byteSize: entry.byteSize,
        metadata: entry.metadata ?? null,
      })
      .onConflictDoUpdate({
        target: modelCheckpoints.modelKey,
        set: {
          storageProvider: entry.storageProvider,
          bucket: entry.bucket,
          objectKey: entry.objectKey,
          sha256: entry.sha256,
          totalParams: entry.totalParams,
          architecture: entry.architecture,
          storageMode: entry.storageMode,
          byteSize: entry.byteSize,
          metadata: entry.metadata ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row ?? null;
  } catch (error) {
    console.error('[CloudSQL] upsertCloudModelCheckpoint failed:', error);
    throw new Error('Failed to register cloud model checkpoint.', { cause: error });
  }
}

export async function getCloudModelCheckpoint(modelKey: string) {
  if (!isCloudSqlConfigured()) return null;
  try {
    const [row] = await db
      .select()
      .from(modelCheckpoints)
      .where(eq(modelCheckpoints.modelKey, modelKey))
      .limit(1);
    return row ?? null;
  } catch (error) {
    console.error('[CloudSQL] getCloudModelCheckpoint failed:', error);
    throw new Error('Failed to read cloud model checkpoint registry.', { cause: error });
  }
}
