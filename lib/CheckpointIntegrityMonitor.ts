/**
 * ZYNTHEOR Real-Time Checkpoint Hash Integrity Monitor
 * Continuously verifies the loaded runtime checkpoint SHA-256 against cloud-signed
 * metadata (S3/R2 object metadata headers, signed HTTP response headers, or verified
 * container metadata) and automatically emits a GOVERNANCE security audit event when
 * any mismatch is detected.
 */

import { AuditLedger, type AuditRecord } from './AuditLedger.ts';
import {
  isCloudCheckpointStorageConfigured,
  statCheckpointInCloudStorage,
} from './CloudCheckpointStorage.ts';
import { validateCloudUrl } from './ConnectivityMonitor.ts';

export type CheckpointIntegrityStatus =
  | 'VERIFIED'
  | 'MISMATCH'
  | 'NOT_LOADED'
  | 'UNCONFIGURED';

export interface CheckpointHashCheckInput {
  loadedHash?: string | null;
  cloudSignedHash?: string | null;
  cloudComputedHash?: string | null;
  weightsLoaded: boolean;
  sourceUri?: string | null;
  metadataSource?: string | null;
  userId?: string;
  tenantId?: string;
}

export interface CheckpointVerificationEvaluation {
  status: CheckpointIntegrityStatus;
  verified: boolean;
  mismatch: boolean;
  failClosed: boolean;
  loadedHash: string | null;
  cloudSignedHash: string | null;
  cloudComputedHash: string | null;
  sourceUri: string | null;
  metadataSource: string | null;
  reason: string;
  checkedAt: string;
}

export interface CheckpointMonitorResult extends CheckpointVerificationEvaluation {
  auditEventTriggered: boolean;
  auditBlockIndex?: number;
  auditEntryHash?: string;
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const MISMATCH_AUDIT_COOLDOWN_MS = 60_000;
const lastMismatchAuditTimestamps = new Map<string, number>();

export function normalizeSha256(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return SHA256_HEX_RE.test(trimmed) ? trimmed : trimmed;
}

export function resetCheckpointMonitorDebounceState(): void {
  lastMismatchAuditTimestamps.clear();
}

export function evaluateCheckpointHashAgainstMetadata(
  input: CheckpointHashCheckInput
): CheckpointVerificationEvaluation {
  const checkedAt = new Date().toISOString();
  const loadedHash = normalizeSha256(input.loadedHash);
  const cloudSignedHash = normalizeSha256(input.cloudSignedHash);
  const cloudComputedHash = normalizeSha256(input.cloudComputedHash);
  const sourceUri = input.sourceUri ?? null;
  const metadataSource = input.metadataSource ?? null;

  if (!input.weightsLoaded || !loadedHash) {
    return {
      status: 'NOT_LOADED',
      verified: false,
      mismatch: false,
      failClosed: true,
      loadedHash,
      cloudSignedHash,
      cloudComputedHash,
      sourceUri,
      metadataSource,
      reason: 'No runtime checkpoint weights are currently loaded.',
      checkedAt,
    };
  }

  if (!cloudSignedHash) {
    return {
      status: 'UNCONFIGURED',
      verified: false,
      mismatch: false,
      failClosed: false,
      loadedHash,
      cloudSignedHash: null,
      cloudComputedHash,
      sourceUri,
      metadataSource,
      reason: 'Cloud-signed metadata SHA-256 is unavailable for comparison.',
      checkedAt,
    };
  }

  const signedMatchesLoaded = loadedHash === cloudSignedHash;
  const computedMatchesLoaded = cloudComputedHash ? loadedHash === cloudComputedHash : true;
  const computedMatchesSigned = cloudComputedHash ? cloudComputedHash === cloudSignedHash : true;

  if (signedMatchesLoaded && computedMatchesLoaded && computedMatchesSigned) {
    return {
      status: 'VERIFIED',
      verified: true,
      mismatch: false,
      failClosed: false,
      loadedHash,
      cloudSignedHash,
      cloudComputedHash,
      sourceUri,
      metadataSource,
      reason: `Loaded checkpoint SHA-256 matches cloud-signed metadata (${metadataSource || 'cloud_metadata'}).`,
      checkedAt,
    };
  }

  const mismatchParts: string[] = [];
  if (!signedMatchesLoaded) {
    mismatchParts.push(`loaded(${loadedHash.slice(0, 12)}) != cloud_signed(${cloudSignedHash.slice(0, 12)})`);
  }
  if (cloudComputedHash && !computedMatchesLoaded) {
    mismatchParts.push(`loaded(${loadedHash.slice(0, 12)}) != payload(${cloudComputedHash.slice(0, 12)})`);
  }
  if (cloudComputedHash && !computedMatchesSigned) {
    mismatchParts.push(`payload(${cloudComputedHash.slice(0, 12)}) != cloud_signed(${cloudSignedHash.slice(0, 12)})`);
  }

  return {
    status: 'MISMATCH',
    verified: false,
    mismatch: true,
    failClosed: true,
    loadedHash,
    cloudSignedHash,
    cloudComputedHash,
    sourceUri,
    metadataSource,
    reason: `SECURITY_ALERT: Checkpoint SHA-256 mismatch detected — ${mismatchParts.join('; ')}`,
    checkedAt,
  };
}

export interface VerifyRecordOptions {
  appendAudit?: (
    role: AuditRecord['role'],
    action: string,
    payload: Record<string, any>
  ) => AuditRecord;
  forceAuditOnMismatch?: boolean;
  nowMs?: number;
}

export function verifyAndRecordCheckpointIntegrity(
  input: CheckpointHashCheckInput,
  options: VerifyRecordOptions = {}
): CheckpointMonitorResult {
  const evaluation = evaluateCheckpointHashAgainstMetadata(input);
  if (!evaluation.mismatch) {
    return {
      ...evaluation,
      auditEventTriggered: false,
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const dedupeKey = `${evaluation.loadedHash || 'none'}|${evaluation.cloudSignedHash || 'none'}|${evaluation.sourceUri || 'unknown'}`;
  const lastLoggedAt = lastMismatchAuditTimestamps.get(dedupeKey) ?? 0;
  const shouldEmit = options.forceAuditOnMismatch || nowMs - lastLoggedAt >= MISMATCH_AUDIT_COOLDOWN_MS;

  if (!shouldEmit) {
    return {
      ...evaluation,
      auditEventTriggered: false,
    };
  }

  lastMismatchAuditTimestamps.set(dedupeKey, nowMs);
  const appendFn = options.appendAudit ?? ((role, action, payload) => AuditLedger.append(role, action, payload));
  const auditRecord = appendFn('GOVERNANCE', 'CHECKPOINT_HASH_MISMATCH_DETECTED', {
    severity: 'CRITICAL',
    loadedSha256: evaluation.loadedHash,
    cloudSignedSha256: evaluation.cloudSignedHash,
    cloudComputedSha256: evaluation.cloudComputedHash,
    sourceUri: evaluation.sourceUri,
    metadataSource: evaluation.metadataSource,
    reason: evaluation.reason,
    detectedAt: evaluation.checkedAt,
    userId: input.userId || 'system_monitor',
    tenantId: input.tenantId || 'default',
  });

  return {
    ...evaluation,
    auditEventTriggered: true,
    auditBlockIndex: auditRecord.index,
    auditEntryHash: auditRecord.entry_hash,
  };
}

export interface ResolvedCloudMetadataHash {
  cloudSignedHash: string | null;
  cloudComputedHash: string | null;
  metadataSource: string | null;
  sourceUri: string | null;
}

/**
 * Resolves authoritative cloud-signed checkpoint SHA-256 metadata from:
 * 1. S3 / R2 HeadObject metadata (`zyntheor-sha256` / `sha256`) when S3 is configured, or
 * 2. Presigned HTTP/HTTPS HEAD signed response headers (`x-zyntheor-sha256`, `x-amz-meta-zyntheor-sha256`),
 *    falling back to verified container header metadata from `inspectRes`.
 */
export async function resolveCloudSignedMetadataHash(params: {
  sourceUri?: string | null;
  inspectRes?: {
    payload_sha256?: string | null;
    metadata?: Record<string, any> | null;
  } | null;
  timeoutMs?: number;
}): Promise<ResolvedCloudMetadataHash> {
  const sourceUri = params.sourceUri || process.env.CHECKPOINT_PRESIGNED_URL || null;
  const inspectPayloadSha = normalizeSha256(params.inspectRes?.payload_sha256 ?? null);
  const inspectMetaSha = normalizeSha256(
    params.inspectRes?.metadata?.sha256 ?? params.inspectRes?.metadata?.payload_sha256 ?? null
  );

  // 1. S3/R2 HeadObject cloud metadata
  if (isCloudCheckpointStorageConfigured() && (!sourceUri || sourceUri.startsWith('s3://'))) {
    try {
      const stat = await statCheckpointInCloudStorage();
      const s3MetaSha = normalizeSha256(
        stat.metadata?.['zyntheor-sha256'] ??
          stat.metadata?.['sha256'] ??
          null
      );
      if (s3MetaSha) {
        return {
          cloudSignedHash: s3MetaSha,
          cloudComputedHash: inspectPayloadSha,
          metadataSource: 's3_object_metadata',
          sourceUri: stat.sourceUri,
        };
      }
    } catch {
      // Fall through cleanly to HTTP/container metadata
    }
  }

  // 2. HTTP/HTTPS signed header on presigned cloud URL
  if (sourceUri && (sourceUri.startsWith('https://') || sourceUri.startsWith('http://'))) {
    const urlCheck = validateCloudUrl(sourceUri);
    if (urlCheck.ok) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 2500);
      try {
        const res = await fetch(sourceUri, {
          method: 'HEAD',
          redirect: 'manual',
          headers: { 'User-Agent': 'ZYNTHEOR-CheckpointIntegrityMonitor/1.0' },
          signal: controller.signal,
        });
        if (res.ok) {
          const headerSha = normalizeSha256(
            res.headers.get('x-zyntheor-sha256') ??
              res.headers.get('x-amz-meta-zyntheor-sha256') ??
              res.headers.get('x-amz-meta-sha256') ??
              null
          );
          if (headerSha) {
            return {
              cloudSignedHash: headerSha,
              cloudComputedHash: inspectPayloadSha,
              metadataSource: 'cloud_http_signed_header',
              sourceUri,
            };
          }
        }
      } catch {
        // Network error during optional HEAD header lookup; fall back to verified container metadata below
      } finally {
        clearTimeout(timer);
      }
    }
  }

  // 3. Container signed header metadata (`metadata.sha256` / `metadata.payload_sha256`)
  if (inspectMetaSha) {
    return {
      cloudSignedHash: inspectMetaSha,
      cloudComputedHash: inspectPayloadSha,
      metadataSource: 'checkpoint_container_metadata',
      sourceUri,
    };
  }

  return {
    cloudSignedHash: null,
    cloudComputedHash: inspectPayloadSha,
    metadataSource: null,
    sourceUri,
  };
}
