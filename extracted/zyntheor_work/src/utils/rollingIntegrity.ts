import { AuditRecord } from '../types';
import { sha256Sync } from './auditLedger';
import type { IntegrityStatus } from '../hooks/useAuditIntegrity';

export type RollingEntrySeverity = 'intact' | 'warning' | 'error' | 'tampered';

export interface RollingIntegrityPoint {
  index: number;
  label: string;
  score: number;
  severity: RollingEntrySeverity;
  hashDigest: string;
  summary: string;
}

function classifyTraceLine(line: string): 'error' | 'warning' | 'success' | 'info' {
  const upper = line.toUpperCase();
  if (
    upper.includes('[ERROR]') ||
    upper.includes('TAMPER') ||
    upper.includes('FAILED') ||
    upper.includes('EXCEPTION') ||
    /EXITCODE:\s*[1-9]/.test(upper)
  ) {
    return 'error';
  }
  if (upper.includes('[WARNING]') || upper.includes('WARN') || upper.includes('DENIED') || upper.includes('RETRY')) {
    return 'warning';
  }
  if (
    upper.includes('[DONE]') ||
    upper.includes('[SUCCESS]') ||
    upper.includes('EXITCODE: 0') ||
    upper.includes('VERIFIED') ||
    upper.includes('PASSED')
  ) {
    return 'success';
  }
  return 'info';
}

/**
 * Computes a deterministic Rolling Integrity trajectory over the last `limit` (default 50)
 * Quick Agent execution trace lines, pairing real cumulative SHA-256 hashing with
 * execution stability and cryptographic seal verification status.
 */
export function computeQuickLogRollingIntegrity(
  logs: string[],
  integrityStatus: IntegrityStatus,
  limit: number = 50
): RollingIntegrityPoint[] {
  if (!logs || logs.length === 0) return [];

  const startOffset = Math.max(0, logs.length - limit);
  const windowLogs = logs.slice(startOffset);

  let score = integrityStatus === 'UNSEALED' ? 92 : 100;
  let rollingChainHash = '0'.repeat(64);
  const points: RollingIntegrityPoint[] = [];

  for (let i = 0; i < windowLogs.length; i++) {
    const line = windowLogs[i];
    const lineNum = startOffset + i + 1;
    rollingChainHash = sha256Sync(`${rollingChainHash}|${lineNum}|${line}`);

    const kind = classifyTraceLine(line);
    let severity: RollingEntrySeverity = 'intact';

    if (kind === 'error') {
      score = Math.max(0, score - 22);
      severity = 'error';
    } else if (kind === 'warning') {
      score = Math.max(0, score - 9);
      severity = 'warning';
    } else if (kind === 'success') {
      const ceiling = integrityStatus === 'UNSEALED' ? 95 : 100;
      score = Math.min(ceiling, score + 6);
      severity = 'intact';
    } else {
      const ceiling = integrityStatus === 'UNSEALED' ? 95 : 100;
      score = Math.min(ceiling, score + 2);
      severity = 'intact';
    }

    const isLast = i === windowLogs.length - 1;
    if (isLast && integrityStatus === 'TAMPERED') {
      score = Math.min(score, 12);
      severity = 'tampered';
    }

    const tagMatch = line.match(/^\[([A-Z0-9_]+)\]/);
    const label = tagMatch ? `#${lineNum} [${tagMatch[1]}]` : `#${lineNum}`;

    points.push({
      index: lineNum,
      label,
      score: Math.round(score * 10) / 10,
      severity,
      hashDigest: rollingChainHash.slice(0, 12),
      summary: line.length > 96 ? `${line.slice(0, 93)}...` : line
    });
  }

  return points;
}

/**
 * Computes a deterministic Rolling Integrity trajectory over the last `limit` (default 50)
 * AuditLedger blocks by recalculating each block's payload SHA-256 digest, entry preimage hash,
 * and prev_hash chain continuity.
 */
export function computeLedgerRollingIntegrity(
  records: AuditRecord[],
  limit: number = 50
): RollingIntegrityPoint[] {
  if (!records || records.length === 0) return [];

  const sortedAll = [...records].sort((a, b) => a.index - b.index);
  const byIndex = new Map<number, AuditRecord>();
  for (const r of sortedAll) byIndex.set(r.index, r);

  const windowRecords = sortedAll.slice(-limit);
  const genesisHash = '0'.repeat(64);
  let score = 100;
  const points: RollingIntegrityPoint[] = [];

  for (const rec of windowRecords) {
    const calcPayloadDigest = sha256Sync(JSON.stringify(rec.payload));
    const preimage = `${rec.index}|${rec.timestamp}|${rec.prev_hash}|${rec.role}|${rec.action}|${rec.payload_digest}`;
    const calcEntryHash = sha256Sync(preimage);

    const payloadValid = calcPayloadDigest === rec.payload_digest;
    const entryValid = calcEntryHash === rec.entry_hash;
    let linkValid = true;
    if (rec.index === 0) {
      linkValid = rec.prev_hash === genesisHash;
    } else {
      const prevRec = byIndex.get(rec.index - 1);
      if (prevRec) {
        linkValid = rec.prev_hash === prevRec.entry_hash;
      }
    }

    const actionUpper = rec.action.toUpperCase();
    let severity: RollingEntrySeverity = 'intact';

    if (!payloadValid || !entryValid || !linkValid) {
      score = Math.max(0, score - 45);
      severity = 'tampered';
    } else if (actionUpper.includes('TAMPER')) {
      score = Math.max(0, score - 25);
      severity = 'error';
    } else if (actionUpper.includes('DENIED') || actionUpper.includes('FAILED') || actionUpper.includes('ERROR')) {
      score = Math.max(0, score - 8);
      severity = 'warning';
    } else {
      score = Math.min(100, score + 3);
      severity = 'intact';
    }

    points.push({
      index: rec.index,
      label: `#${rec.index} ${rec.role}`,
      score: Math.round(score * 10) / 10,
      severity,
      hashDigest: calcEntryHash.slice(0, 12),
      summary: `${rec.role}: ${rec.action}`
    });
  }

  return points;
}
