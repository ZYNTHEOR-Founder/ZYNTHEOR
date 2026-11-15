/**
 * ZYNTHEOR Sovereign Audit Ledger
 * Immutable append-only audit trail with SHA-256 cryptographic hash chaining.
 * Stored at native_data/audit_log.jsonl
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isCloudSqlConfigured } from '../src/db/index.ts';
import {
  appendCloudAuditRecord,
  getAllCloudAuditRecordsAsc,
  getCloudAuditChainHead,
  getRecentCloudAuditRecords,
  syncCloudAuditRecords,
  verifyCloudAuditChain,
} from '../src/db/repositories.ts';

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

export class AuditLedger {
  private static genesisHash = '0'.repeat(64);
  private static cloudSyncPromise: Promise<{ syncedToCloud: number; hydratedFromCloud: number }> | null = null;
  private static cloudSyncedOnce = false;

  private static get filePath(): string {
    if (process.env.ZYNTHEOR_AUDIT_FILE && process.env.ZYNTHEOR_AUDIT_FILE.trim()) {
      return path.resolve(process.env.ZYNTHEOR_AUDIT_FILE.trim());
    }
    return path.resolve(process.cwd(), 'native_data', 'audit_log.jsonl');
  }

  private static withAppendLock<T>(targetPath: string, fn: () => T): T {
    const lockPath = `${targetPath}.lock`;
    const deadline = Date.now() + 5000;
    let acquired = false;
    while (!acquired) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeSync(fd, `${process.pid}\n`);
        fs.closeSync(fd);
        acquired = true;
      } catch (err: any) {
        if (err?.code === 'EEXIST') {
          try {
            const stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > 5000) {
              fs.unlinkSync(lockPath);
              continue;
            }
          } catch {}
          if (Date.now() >= deadline) {
            throw new Error('AUDIT_LEDGER_LOCK_TIMEOUT');
          }
          // Brief busy-yield without async overhead to keep append() synchronous
          const waitUntil = Date.now() + 2;
          while (Date.now() < waitUntil) { /* yield */ }
        } else {
          throw err;
        }
      }
    }
    try {
      return fn();
    } finally {
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    }
  }

  private static ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const needsGenesis =
      !fs.existsSync(this.filePath) ||
      fs.readFileSync(this.filePath, 'utf8').trim().length === 0;
    if (needsGenesis) {
      const timestamp = new Date().toISOString();
      const payload = {
        engine: 'ZYNTHEOR Q+ Sovereign AI Engine',
        architecture: 'ZYNTHEOR-Native-ActiveSubgraph-v1',
        sovereignty_rule: 'Online-first first-party neural execution on the Sovereign Cloud runtime',
        init_timestamp: timestamp
      };
      const payload_digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const preimage = `0|${timestamp}|${this.genesisHash}|SYSTEM|GENESIS_INITIALIZATION|${payload_digest}`;
      const entry_hash = crypto.createHash('sha256').update(preimage).digest('hex');
      const genesisRecord: AuditRecord = {
        index: 0,
        timestamp,
        prev_hash: this.genesisHash,
        role: 'SYSTEM',
        action: 'GENESIS_INITIALIZATION',
        payload_digest,
        payload,
        entry_hash
      };
      fs.writeFileSync(this.filePath, JSON.stringify(genesisRecord) + '\n', 'utf8');
    }
  }

  private static getLastRecord(): AuditRecord | null {
    const content = fs.existsSync(this.filePath)
      ? fs.readFileSync(this.filePath, 'utf8').trim()
      : '';
    if (!content) return null;
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const lastLine = lines[lines.length - 1];
    let parsed: AuditRecord;
    try {
      parsed = JSON.parse(lastLine) as AuditRecord;
    } catch {
      throw new Error('AUDIT_LEDGER_CHAIN_BROKEN: Tail record is malformed JSON.');
    }
    if (
      !Number.isInteger(parsed.index) ||
      parsed.index < 0 ||
      typeof parsed.entry_hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(parsed.entry_hash)
    ) {
      throw new Error(
        `AUDIT_LEDGER_CHAIN_BROKEN: Tail record at line ${lines.length - 1} lacks valid chain index or SHA-256 entry_hash.`
      );
    }
    return parsed;
  }

  public static append(
    role: AuditRecord['role'],
    action: string,
    payload: Record<string, any>
  ): AuditRecord {
    const targetPath = this.filePath;
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const record = this.withAppendLock(targetPath, () => {
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

      const rec: AuditRecord = {
        index,
        timestamp,
        prev_hash,
        role,
        action,
        payload_digest,
        payload,
        entry_hash
      };

      fs.appendFileSync(targetPath, JSON.stringify(rec) + '\n', 'utf8');
      return { rec, payloadStr };
    });
    if (isCloudSqlConfigured()) {
      void appendCloudAuditRecord({
        blockIndex: record.rec.index,
        timestamp: record.rec.timestamp,
        prevHash: record.rec.prev_hash,
        role: record.rec.role,
        action: record.rec.action,
        payloadDigest: record.rec.payload_digest,
        payload: record.rec.payload,
        payloadRaw: record.payloadStr,
        entryHash: record.rec.entry_hash,
        tenantId: typeof payload?.tenantId === 'string' ? payload.tenantId : undefined,
      }).catch((err) => {
        console.warn('[AuditLedger] Cloud SQL mirror warning:', err?.message || err);
      });
    }
    return record.rec;
  }

  /**
   * Appends a SHA-256 chained checkpoint promotion event to native_data/audit_log.jsonl
   * stamped with the current ISO-8601 timestamp and the promoted model path.
   */
  public static appendPromotionEvent(
    modelPath: string,
    metadata: Record<string, any> = {}
  ): AuditRecord {
    const cleanPath = String(modelPath || '').trim();
    if (!cleanPath) {
      throw new Error('appendPromotionEvent requires a non-empty modelPath.');
    }
    const promotedAt = new Date().toISOString();
    return this.append('SYSTEM', 'MODEL_CHECKPOINT_PROMOTED', {
      modelPath: cleanPath,
      weightsSource: cleanPath,
      promotedAt,
      ...metadata
    });
  }

  public static getRecent(limit: number = 50): AuditRecord[] {
    this.ensureFile();
    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) return [];
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
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
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);

    let expectedPrevHash = this.genesisHash;
    for (let i = 0; i < lines.length; i++) {
      try {
        const record = JSON.parse(lines[i]) as AuditRecord;
        if (record.index !== i) {
          return { valid: false, totalRecords: lines.length, headHash: '', brokenIndex: i, error: `Index mismatch at ${i}` };
        }
        if (typeof record.prev_hash !== 'string' || record.prev_hash !== expectedPrevHash) {
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

  public static async syncWithCloud(force = false): Promise<{ syncedToCloud: number; hydratedFromCloud: number }> {
    if (!isCloudSqlConfigured()) {
      return { syncedToCloud: 0, hydratedFromCloud: 0 };
    }
    if (this.cloudSyncedOnce && !force) {
      return { syncedToCloud: 0, hydratedFromCloud: 0 };
    }
    if (this.cloudSyncPromise && !force) {
      return this.cloudSyncPromise;
    }

    const runSync = async () => {
      const head = await getCloudAuditChainHead();
      const hasLocalFile = fs.existsSync(this.filePath) && fs.readFileSync(this.filePath, 'utf8').trim().length > 0;

      // Ephemeral cloud container without local audit_log.jsonl: hydrate from Cloud SQL
      if (!hasLocalFile && head.count > 0) {
        const cloudRecords = await getAllCloudAuditRecordsAsc();
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          this.filePath,
          cloudRecords.map((r) => JSON.stringify(r)).join('\n') + '\n',
          'utf8'
        );
        this.cloudSyncedOnce = true;
        return { syncedToCloud: 0, hydratedFromCloud: cloudRecords.length };
      }

      this.ensureFile();
      const raw = fs.readFileSync(this.filePath, 'utf8').trim();
      const localRecords: AuditRecord[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          localRecords.push(JSON.parse(trimmed) as AuditRecord);
        } catch {
          // skip malformed line
        }
      }

      if (localRecords.length > head.count || head.missingRawCount > 0) {
        const synced = await syncCloudAuditRecords(
          localRecords.map((r) => ({
            blockIndex: r.index,
            timestamp: r.timestamp,
            prevHash: r.prev_hash,
            role: r.role,
            action: r.action,
            payloadDigest: r.payload_digest,
            payload: r.payload,
            payloadRaw: JSON.stringify(r.payload),
            entryHash: r.entry_hash,
            tenantId: typeof r.payload?.tenantId === 'string' ? r.payload.tenantId : undefined,
          }))
        );
        this.cloudSyncedOnce = true;
        return { syncedToCloud: synced, hydratedFromCloud: 0 };
      }

      this.cloudSyncedOnce = true;
      return { syncedToCloud: 0, hydratedFromCloud: 0 };
    };

    this.cloudSyncPromise = runSync().finally(() => {
      this.cloudSyncPromise = null;
    });
    return this.cloudSyncPromise;
  }

  public static async getRecentCloud(limit: number = 50): Promise<AuditRecord[]> {
    if (!isCloudSqlConfigured()) return this.getRecent(limit);
    await this.syncWithCloud();
    const cloudRecords = await getRecentCloudAuditRecords(limit);
    if (cloudRecords.length > 0) {
      return cloudRecords as AuditRecord[];
    }
    return this.getRecent(limit);
  }

  public static async verifyIntegrityCloud() {
    if (!isCloudSqlConfigured()) return this.verifyIntegrity();
    await this.syncWithCloud();
    const cloud = await verifyCloudAuditChain();
    if (cloud.configured && cloud.totalRecords > 0) {
      return cloud;
    }
    return this.verifyIntegrity();
  }
}
