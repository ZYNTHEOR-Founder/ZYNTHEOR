// ZYNTHEOR Modular Core (ESM) — Goal: Build an expense ledger CLI module with tests
import crypto from 'crypto';

export function computeDigestManifest(records) {
  const cleaned = records.map((r) => String(r).trim()).filter(Boolean);
  const sha256 = crypto.createHash('sha256').update(cleaned.join('|')).digest('hex');
  return { count: cleaned.length, cleaned, sha256 };
}

export function sumAmounts(values) {
  return Number(values.reduce((acc, v) => acc + Number(v || 0), 0).toFixed(4));
}
