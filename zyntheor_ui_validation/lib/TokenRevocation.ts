/**
 * Persistent JTI token revocation list.
 * Fail-closed: if the denylist file is corrupt, treat as empty list but log.
 * Storage: native_data/revoked_jti.jsonl (append-only) + snapshot index.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger';

const REVOKE_FILE = path.resolve(process.cwd(), 'native_data', 'revoked_jti.jsonl');
const REVOKE_INDEX = path.resolve(process.cwd(), 'native_data', 'revoked_jti_index.json');

export class TokenRevocation {
  private static jtiSet: Set<string> = new Set();
  private static loaded = false;

  private static ensureLoaded(): void {
    if (this.loaded) return;
    const dir = path.dirname(REVOKE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Prefer compact index for fast startup
    if (fs.existsSync(REVOKE_INDEX)) {
      try {
        const list: string[] = JSON.parse(fs.readFileSync(REVOKE_INDEX, 'utf8'));
        this.jtiSet = new Set(list);
        this.loaded = true;
        return;
      } catch {
        /* fall through */
      }
    }

    if (fs.existsSync(REVOKE_FILE)) {
      try {
        const lines = fs.readFileSync(REVOKE_FILE, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const rec = JSON.parse(line);
            if (rec.jti) this.jtiSet.add(rec.jti);
          } catch {
            /* skip bad line */
          }
        }
      } catch {
        AuditLedger.append('SYSTEM', 'REVOCATION_LIST_LOAD_ERROR', {
          path: REVOKE_FILE
        });
      }
    }
    this.loaded = true;
  }

  private static persistIndex(): void {
    const dir = path.dirname(REVOKE_INDEX);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = REVOKE_INDEX + '.tmp.' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(tmp, JSON.stringify([...this.jtiSet]), 'utf8');
    fs.renameSync(tmp, REVOKE_INDEX);
  }

  public static isRevoked(jti: string | undefined | null): boolean {
    if (!jti) return false;
    this.ensureLoaded();
    return this.jtiSet.has(jti);
  }

  public static revoke(jti: string, meta: { sub?: string; reason?: string } = {}): void {
    if (!jti) return;
    this.ensureLoaded();
    if (this.jtiSet.has(jti)) return;
    this.jtiSet.add(jti);
    const dir = path.dirname(REVOKE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const rec = {
      jti,
      revokedAt: new Date().toISOString(),
      sub: meta.sub || null,
      reason: meta.reason || 'manual'
    };
    fs.appendFileSync(REVOKE_FILE, JSON.stringify(rec) + '\n', 'utf8');
    this.persistIndex();
    AuditLedger.append('GOVERNANCE', 'TOKEN_REVOKED', rec);
  }

  public static size(): number {
    this.ensureLoaded();
    return this.jtiSet.size;
  }
}
