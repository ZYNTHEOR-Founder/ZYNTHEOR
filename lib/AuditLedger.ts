/**
 * ZYNTHEOR Sovereign Audit Ledger
 * Immutable append-only audit trail with SHA-256 cryptographic hash chaining.
 * Stored at native_data/audit_log.jsonl
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface AuditRecord {
  index: number;
  timestamp: string;
  prev_hash: string;
  role: 'SYSTEM' | 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER' | 'EVOLVER' | 'COMMERCIAL' | 'GOVERNANCE';
  action: string;
  payload_digest: string;
  payload: Record<string, any>;
  entry_hash: string;
}

export interface WorkflowRuntimeEvent {
  id: string;
  timestamp: string;
  source: 'cloud_preflight' | 'checkpoint_recovery' | 'runtime_activation' | 'training_pipeline';
  tag: 'INIT' | 'PLANNER' | 'RESEARCH' | 'CODER' | 'TESTER' | 'DONE' | 'LEARNING' | 'ERROR';
  logLine: string;
  goal?: string;
  resetLogs?: boolean;
  isRunning?: boolean;
  isDone?: boolean;
  verificationHash?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, any>;
}

export type WorkflowEventListener = (event: WorkflowRuntimeEvent) => void;

export class AuditLedger {
  private static filePath = path.resolve(process.cwd(), 'native_data', 'audit_log.jsonl');
  private static genesisHash = '0'.repeat(64);
  private static workflowListeners = new Set<WorkflowEventListener>();

  private static ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '', 'utf8');
      // Create Genesis block
      this.append(
        'SYSTEM',
        'GENESIS_INITIALIZATION',
        {
          engine: 'ZYNTHEOR Q+ Sovereign AI Engine',
          architecture: 'ZYNTHEOR Native architecture; checkpoint parameters are runtime-evidence controlled',
          sovereignty_rule: 'Native Intelligence Core; execution status is recorded from verified runtime evidence',
          init_timestamp: new Date().toISOString()
        }
      );
    }
  }

  private static getLastRecord(): AuditRecord | null {
    this.ensureFile();
    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) return null;
    const lines = content.split('\n');
    const lastLine = lines[lines.length - 1];
    try {
      return JSON.parse(lastLine) as AuditRecord;
    } catch {
      return null;
    }
  }

  public static append(
    role: AuditRecord['role'],
    action: string,
    payload: Record<string, any>
  ): AuditRecord {
    this.ensureFile();
    const lastRecord = this.getLastRecord();
    const index = lastRecord ? lastRecord.index + 1 : 0;
    const prev_hash = lastRecord ? lastRecord.entry_hash : this.genesisHash;
    const timestamp = new Date().toISOString();

    const payloadStr = JSON.stringify(payload);
    const payload_digest = crypto.createHash('sha256').update(payloadStr).digest('hex');

    // SHA-256(index + timestamp + prev_hash + role + action + payload_digest)
    const preimage = `${index}|${timestamp}|${prev_hash}|${role}|${action}|${payload_digest}`;
    const entry_hash = crypto.createHash('sha256').update(preimage).digest('hex');

    const record: AuditRecord = {
      index,
      timestamp,
      prev_hash,
      role,
      action,
      payload_digest,
      payload,
      entry_hash
    };

    fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf8');
    return record;
  }

  public static getRecent(limit: number = 50): AuditRecord[] {
    this.ensureFile();
    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) return [];
    const lines = content.split('\n');
    const records: AuditRecord[] = [];
    const start = Math.max(0, lines.length - limit);
    for (let i = lines.length - 1; i >= start; i--) {
      try {
        records.push(JSON.parse(lines[i]));
      } catch {
        // ignore malformed lines
      }
    }
    return records;
  }

  public static verifyIntegrity(): {
    valid: boolean;
    totalRecords: number;
    headHash: string;
    brokenIndex?: number;
    error?: string;
  } {
    this.ensureFile();
    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) return { valid: true, totalRecords: 0, headHash: this.genesisHash };
    const lines = content.split('\n');

    let expectedPrevHash = this.genesisHash;
    for (let i = 0; i < lines.length; i++) {
      try {
        const record = JSON.parse(lines[i]) as AuditRecord;
        if (record.index !== i) {
          return { valid: false, totalRecords: lines.length, headHash: '', brokenIndex: i, error: `Index mismatch at ${i}` };
        }
        if (record.prev_hash !== expectedPrevHash) {
          return { valid: false, totalRecords: lines.length, headHash: '', brokenIndex: i, error: `Hash break at record ${i}` };
        }

        const payloadStr = JSON.stringify(record.payload);
        const calcPayloadDigest = crypto.createHash('sha256').update(payloadStr).digest('hex');
        if (calcPayloadDigest !== record.payload_digest) {
          return { valid: false, totalRecords: lines.length, headHash: '', brokenIndex: i, error: `Payload tampering at record ${i}` };
        }

        const preimage = `${record.index}|${record.timestamp}|${record.prev_hash}|${record.role}|${record.action}|${record.payload_digest}`;
        const calcEntryHash = crypto.createHash('sha256').update(preimage).digest('hex');
        if (calcEntryHash !== record.entry_hash) {
          return { valid: false, totalRecords: lines.length, headHash: '', brokenIndex: i, error: `Entry hash invalid at record ${i}` };
        }

        expectedPrevHash = record.entry_hash;
      } catch (err: any) {
        return { valid: false, totalRecords: lines.length, headHash: '', brokenIndex: i, error: err.message };
      }
    }

    const last = JSON.parse(lines[lines.length - 1]) as AuditRecord;
    return {
      valid: true,
      totalRecords: lines.length,
      headHash: last.entry_hash
    };
  }

  public static subscribeWorkflowEvents(listener: WorkflowEventListener): () => void {
    this.workflowListeners.add(listener);
    return () => {
      this.workflowListeners.delete(listener);
    };
  }

  public static emitWorkflowEvent(
    input: Omit<WorkflowRuntimeEvent, 'id' | 'timestamp' | 'logLine'> & { message: string }
  ): WorkflowRuntimeEvent {
    const cleanMsg = String(input.message || '').replace(/[\r\n]+/g, ' ').trim();
    const ev: WorkflowRuntimeEvent = {
      id: `wf_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      timestamp: new Date().toISOString(),
      source: input.source,
      tag: input.tag,
      logLine: `[${input.tag}] ${cleanMsg}`,
      goal: input.goal,
      resetLogs: input.resetLogs,
      isRunning: input.isRunning,
      isDone: input.isDone,
      verificationHash: input.verificationHash ?? null,
      durationMs: input.durationMs ?? null,
      metadata: input.metadata,
    };
    for (const listener of this.workflowListeners) {
      try {
        listener(ev);
      } catch {
        // Ignore subscriber exceptions
      }
    }
    return ev;
  }
}
