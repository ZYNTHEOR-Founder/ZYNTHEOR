/**
 * ZYNTHEOR Batch 28 — Human Approval Gate & High-Impact Governance Control
 *
 * Enforces mandatory human-in-the-loop authorization for high-impact actions:
 *   - DATA_DELETION (bulk deletes, destructive file removals)
 *   - PERMISSION_CHANGE (RBAC, token scopes, role mutations)
 *   - MODEL_RELEASE (promoting trained checkpoint weights into active runtime)
 *   - SYSTEM_CONFIG_MUTATION (runtime endpoints, security settings)
 *   - PUBLICATION (external deliverable publishing)
 *
 * ZERO-BYPASS INVARIANT:
 *   Autonomous agents / SYSTEM accounts CANNOT approve their own requests.
 *   Every request, approval, rejection, and consumption is sealed in AuditLedger.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger';
import { SovereignRole } from './SovereignIdentity';

export type HighImpactActionType =
  | 'DATA_DELETION'
  | 'PERMISSION_CHANGE'
  | 'MODEL_RELEASE'
  | 'SYSTEM_CONFIG_MUTATION'
  | 'PUBLICATION';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONSUMED' | 'EXPIRED';

export interface ApprovalRequestRecord {
  requestId: string;
  actionType: HighImpactActionType;
  resourceId: string;
  description: string;
  requestedByUserId: string;
  requestedByRole: SovereignRole | 'AUTONOMOUS_AGENT';
  tenantId: string;
  riskLevel: 'high' | 'critical';
  metadata?: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  reviewedByUserId?: string;
  reviewedByRole?: SovereignRole;
  reviewedAt?: string;
  reviewNote?: string;
  consumedAt?: string;
  requestDigest: string;
}

const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export class ApprovalGate {
  private static instance: ApprovalGate | null = null;
  private filePath: string;
  private requests: ApprovalRequestRecord[] = [];

  private constructor() {
    this.filePath = process.env.ZYNTHEOR_APPROVALS_FILE
      ? path.resolve(process.env.ZYNTHEOR_APPROVALS_FILE)
      : path.resolve(process.cwd(), 'native_data', 'approval_requests.json');
    this.load();
  }

  public static getInstance(): ApprovalGate {
    if (!ApprovalGate.instance) {
      ApprovalGate.instance = new ApprovalGate();
    }
    return ApprovalGate.instance;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (Array.isArray(parsed)) {
          this.requests = parsed;
          return;
        }
      }
    } catch {
      // Fallback to empty if unreadable
    }
    this.requests = [];
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tmp = path.join(dir, `.${path.basename(this.filePath)}.tmp.${process.pid}.${Date.now()}`);
    fs.writeFileSync(tmp, JSON.stringify(this.requests.slice(0, 500), null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  private expireStale(): void {
    const now = Date.now();
    let changed = false;
    for (const r of this.requests) {
      if (r.status === 'PENDING' || r.status === 'APPROVED') {
        const exp = Date.parse(r.expiresAt);
        if (Number.isFinite(exp) && exp <= now) {
          r.status = 'EXPIRED';
          changed = true;
        }
      }
    }
    if (changed) this.save();
  }

  /** Detects whether a natural-language task goal involves high-impact operations. */
  public detectHighImpactGoal(goal: string): {
    highImpact: boolean;
    actionType?: HighImpactActionType;
    reason?: string;
  } {
    const g = String(goal || '').toLowerCase();
    if (/\b(delete\s+all|wipe\s+database|drop\s+table|rm\s+-rf|purge\s+all|ลบข้อมูลทั้งหมด)\b/.test(g)) {
      return {
        highImpact: true,
        actionType: 'DATA_DELETION',
        reason: 'Destructive bulk data deletion requires explicit human approval.',
      };
    }
    if (/\b(grant\s+admin|elevate\s+role|change\s+permissions?|modify\s+rbac|เปลี่ยนสิทธิ์|เพิ่มสิทธิ์ผู้ดูแล)\b/.test(g)) {
      return {
        highImpact: true,
        actionType: 'PERMISSION_CHANGE',
        reason: 'RBAC / privilege escalation requires explicit human approval.',
      };
    }
    if (/\b(promote\s+model|release\s+checkpoint|deploy\s+production|publish\s+release|ปล่อยเวอร์ชัน|เผยแพร่โมเดล)\b/.test(g)) {
      return {
        highImpact: true,
        actionType: 'MODEL_RELEASE',
        reason: 'Production model / release promotion requires explicit human approval.',
      };
    }
    return { highImpact: false };
  }

  public requestApproval(input: {
    actionType: HighImpactActionType;
    resourceId: string;
    description: string;
    requestedByUserId: string;
    requestedByRole: SovereignRole | 'AUTONOMOUS_AGENT';
    tenantId: string;
    riskLevel?: 'high' | 'critical';
    ttlMs?: number;
    metadata?: Record<string, unknown>;
  }): ApprovalRequestRecord {
    this.expireStale();
    // Return existing pending or valid approved request for the same tuple if already raised
    const existing = this.requests.find(
      (r) =>
        r.tenantId === input.tenantId &&
        r.actionType === input.actionType &&
        r.resourceId === input.resourceId &&
        (r.status === 'PENDING' || r.status === 'APPROVED')
    );
    if (existing) return existing;

    const now = new Date();
    const requestId = `apr_${now.getTime()}_${crypto.randomBytes(3).toString('hex')}`;
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS)).toISOString();
    const requestDigest = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          requestId,
          actionType: input.actionType,
          resourceId: input.resourceId,
          tenantId: input.tenantId,
          requestedByUserId: input.requestedByUserId,
        })
      )
      .digest('hex');

    const record: ApprovalRequestRecord = {
      requestId,
      actionType: input.actionType,
      resourceId: input.resourceId,
      description: input.description,
      requestedByUserId: input.requestedByUserId,
      requestedByRole: input.requestedByRole,
      tenantId: input.tenantId,
      riskLevel: input.riskLevel ?? (input.actionType === 'PERMISSION_CHANGE' || input.actionType === 'MODEL_RELEASE' ? 'critical' : 'high'),
      metadata: input.metadata,
      status: 'PENDING',
      createdAt: now.toISOString(),
      expiresAt,
      requestDigest,
    };

    this.requests.unshift(record);
    this.save();

    AuditLedger.append('GOVERNANCE', 'HUMAN_APPROVAL_REQUESTED', {
      requestId: record.requestId,
      actionType: record.actionType,
      resourceId: record.resourceId,
      tenantId: record.tenantId,
      requestedByUserId: record.requestedByUserId,
      riskLevel: record.riskLevel,
      requestDigest: record.requestDigest,
    });

    return record;
  }

  public approveRequest(
    requestId: string,
    reviewer: { userId: string; role: SovereignRole; tenantId: string },
    note?: string
  ): ApprovalRequestRecord {
    this.expireStale();
    if (reviewer.role !== 'admin' && reviewer.role !== 'operator') {
      AuditLedger.append('GOVERNANCE', 'HUMAN_APPROVAL_DENIED_ROLE', {
        requestId,
        reviewerUserId: reviewer.userId,
        reviewerRole: reviewer.role,
      });
      throw new Error('FORBIDDEN: Only human operator or administrator may approve high-impact actions.');
    }
    if (!reviewer.userId || reviewer.userId === 'SYSTEM' || reviewer.userId === 'AUTONOMOUS_AGENT') {
      throw new Error('FORBIDDEN: Autonomous agents cannot self-approve high-impact requests.');
    }

    const record = this.requests.find((r) => r.requestId === requestId);
    if (!record) {
      throw new Error(`APPROVAL_NOT_FOUND: '${requestId}' does not exist.`);
    }
    if (record.tenantId !== reviewer.tenantId && reviewer.role !== 'admin') {
      throw new Error('FORBIDDEN: Cross-tenant approval is prohibited.');
    }
    if (record.status !== 'PENDING') {
      throw new Error(`APPROVAL_INVALID_STATE: Request '${requestId}' is ${record.status}, not PENDING.`);
    }

    record.status = 'APPROVED';
    record.reviewedByUserId = reviewer.userId;
    record.reviewedByRole = reviewer.role;
    record.reviewedAt = new Date().toISOString();
    record.reviewNote = note?.trim() || 'Approved by authorized human reviewer';
    this.save();

    AuditLedger.append('GOVERNANCE', 'HUMAN_APPROVAL_GRANTED', {
      requestId: record.requestId,
      actionType: record.actionType,
      resourceId: record.resourceId,
      reviewedByUserId: reviewer.userId,
      reviewedByRole: reviewer.role,
      tenantId: record.tenantId,
    });

    return record;
  }

  public rejectRequest(
    requestId: string,
    reviewer: { userId: string; role: SovereignRole; tenantId: string },
    reason?: string
  ): ApprovalRequestRecord {
    this.expireStale();
    if (reviewer.role !== 'admin' && reviewer.role !== 'operator') {
      throw new Error('FORBIDDEN: Only human operator or administrator may reject high-impact requests.');
    }
    const record = this.requests.find((r) => r.requestId === requestId);
    if (!record) {
      throw new Error(`APPROVAL_NOT_FOUND: '${requestId}' does not exist.`);
    }
    if (record.tenantId !== reviewer.tenantId && reviewer.role !== 'admin') {
      throw new Error('FORBIDDEN: Cross-tenant rejection is prohibited.');
    }
    if (record.status !== 'PENDING') {
      throw new Error(`APPROVAL_INVALID_STATE: Request '${requestId}' is ${record.status}, not PENDING.`);
    }

    record.status = 'REJECTED';
    record.reviewedByUserId = reviewer.userId;
    record.reviewedByRole = reviewer.role;
    record.reviewedAt = new Date().toISOString();
    record.reviewNote = reason?.trim() || 'Rejected by human reviewer';
    this.save();

    AuditLedger.append('GOVERNANCE', 'HUMAN_APPROVAL_REJECTED', {
      requestId: record.requestId,
      actionType: record.actionType,
      resourceId: record.resourceId,
      reviewedByUserId: reviewer.userId,
      reason: record.reviewNote,
      tenantId: record.tenantId,
    });

    return record;
  }

  /**
   * Verifies that an authorized human approval exists (and optionally consumes it).
   * Fail-closed: never permits execution unless an explicit APPROVED record exists.
   */
  public verifyAndConsume(params: {
    actionType: HighImpactActionType;
    resourceId: string;
    tenantId: string;
    approvalRequestId?: string;
    consume?: boolean;
  }): { approved: boolean; record?: ApprovalRequestRecord; reason?: string } {
    this.expireStale();
    const record = params.approvalRequestId
      ? this.requests.find((r) => r.requestId === params.approvalRequestId)
      : this.requests.find(
          (r) =>
            r.tenantId === params.tenantId &&
            r.actionType === params.actionType &&
            r.resourceId === params.resourceId &&
            r.status === 'APPROVED'
        );

    if (!record) {
      return { approved: false, reason: 'APPROVAL_REQUIRED: No matching human approval record found.' };
    }
    if (record.tenantId !== params.tenantId) {
      return { approved: false, reason: 'FORBIDDEN: Approval record belongs to a different tenant.' };
    }
    if (record.actionType !== params.actionType || record.resourceId !== params.resourceId) {
      return { approved: false, reason: 'APPROVAL_MISMATCH: Approval scope does not match target resource/action.' };
    }
    if (record.status !== 'APPROVED') {
      return { approved: false, reason: `APPROVAL_BLOCKED: Request status is ${record.status}.` };
    }
    if (!record.reviewedByUserId || (record.reviewedByRole !== 'admin' && record.reviewedByRole !== 'operator')) {
      return { approved: false, reason: 'APPROVAL_INVALID_REVIEWER: Missing verified human approver.' };
    }

    if (params.consume !== false) {
      record.status = 'CONSUMED';
      record.consumedAt = new Date().toISOString();
      this.save();
      AuditLedger.append('GOVERNANCE', 'HUMAN_APPROVAL_CONSUMED', {
        requestId: record.requestId,
        actionType: record.actionType,
        resourceId: record.resourceId,
        tenantId: record.tenantId,
      });
    }

    return { approved: true, record };
  }

  public listRequests(scope?: { tenantId?: string; status?: ApprovalStatus }): ApprovalRequestRecord[] {
    this.expireStale();
    return this.requests.filter((r) => {
      if (scope?.tenantId && r.tenantId !== scope.tenantId) return false;
      if (scope?.status && r.status !== scope.status) return false;
      return true;
    });
  }

  public getRequest(requestId: string, scope?: { tenantId?: string }): ApprovalRequestRecord | undefined {
    this.expireStale();
    const rec = this.requests.find((r) => r.requestId === requestId);
    if (!rec) return undefined;
    if (scope?.tenantId && rec.tenantId !== scope.tenantId) return undefined;
    return rec;
  }
}
