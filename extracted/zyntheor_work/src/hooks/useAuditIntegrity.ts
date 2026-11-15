/**
 * useAuditIntegrity — Quick Agent log integrity via server-controlled seals.
 * localStorage is used only as a cache of the last server-issued contentHash.
 * Authoritative verification is always performed against the server AuditLedger seal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { sha256Sync } from '../utils/auditLedger';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/apiClient';

export type IntegrityStatus = 'INTACT' | 'TAMPERED' | 'EMPTY' | 'CHECKING' | 'UNSEALED';

export type CheckpointIntegrityStatus =
  | 'VERIFIED'
  | 'MISMATCH'
  | 'NOT_LOADED'
  | 'UNCONFIGURED'
  | 'CHECKING';

export interface CheckpointIntegrityReport {
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
  auditEventTriggered?: boolean;
  auditBlockIndex?: number;
  auditEntryHash?: string;
}

export interface AuditIntegrityMonitorOptions {
  checkpointSha256?: string | null;
  runtimeOnline?: boolean;
  checkpointPollIntervalMs?: number;
}

export interface SignedSealMetadata {
  sealId?: string;
  contentHash: string;
  entryHash?: string;
  sealedAt?: string;
  logCount?: number;
}

export interface ExplicitVerificationReport {
  status: IntegrityStatus;
  verifiedAt: string;
  logCount: number;
  recalculatedHash: string;
  sealedContentHash: string | null;
  sealMetadata: SignedSealMetadata | null;
  hashMatches: boolean;
  serverVerified: boolean;
  serverMatch?: boolean;
  error?: string;
}

export interface AuditIntegrityResult {
  rollingHash: string;
  fullHash: string;
  baselineHash: string | null;
  sealMetadata: SignedSealMetadata | null;
  integrityStatus: IntegrityStatus;
  isTampered: boolean;
  isVerifying: boolean;
  lastCheckedAt: string | null;
  verificationReport: ExplicitVerificationReport | null;
  recompute: () => void;
  /** Explicitly recalculate hash of displayed logs and compare against signed seal metadata. */
  verifyIntegrity: (displayedLogs?: string[]) => Promise<ExplicitVerificationReport>;
  clearVerificationReport: () => void;
  /** Request a server-side seal of the current logs (authoritative). */
  sealBaseline: () => Promise<void>;
  /** Restore logs from last server-sealed snapshot (Integrity Auto-Recovery). */
  restoreFromLedger: () => Promise<{ ok: boolean; logs?: string[]; error?: string }>;
  /** Continuous real-time checkpoint SHA-256 monitor against cloud-signed metadata. */
  checkpointIntegrityStatus: CheckpointIntegrityStatus;
  checkpointMismatch: boolean;
  isVerifyingCheckpoint: boolean;
  checkpointAuditReport: CheckpointIntegrityReport | null;
  verifyCheckpointIntegrity: () => Promise<CheckpointIntegrityReport>;
}

const SEAL_CACHE_KEY = 'zyntheor_server_seal_content_hash';
const SEAL_META_CACHE_KEY = 'zyntheor_server_seal_metadata';

function readCachedSealMetadata(): SignedSealMetadata | null {
  if (typeof window === 'undefined') return null;
  try {
    const rawMeta = localStorage.getItem(SEAL_META_CACHE_KEY);
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta) as SignedSealMetadata;
      if (parsed && typeof parsed.contentHash === 'string' && parsed.contentHash.length > 0) {
        return parsed;
      }
    }
    const rawHash = localStorage.getItem(SEAL_CACHE_KEY);
    return rawHash ? { contentHash: rawHash } : null;
  } catch {
    const rawHash = localStorage.getItem(SEAL_CACHE_KEY);
    return rawHash ? { contentHash: rawHash } : null;
  }
}

function writeCachedSealMetadata(meta: SignedSealMetadata | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!meta) {
      localStorage.removeItem(SEAL_CACHE_KEY);
      localStorage.removeItem(SEAL_META_CACHE_KEY);
    } else {
      localStorage.setItem(SEAL_CACHE_KEY, meta.contentHash);
      localStorage.setItem(SEAL_META_CACHE_KEY, JSON.stringify(meta));
    }
  } catch {
    // ignore storage quota errors
  }
}

function computeHash(logs: string[]): { full: string; short: string } {
  const payload = logs.join('\n');
  const full = sha256Sync(payload);
  return { full, short: full.slice(0, 12) };
}

export function useAuditIntegrity(
  quickLogs: string[],
  options?: AuditIntegrityMonitorOptions
): AuditIntegrityResult {
  const { authHeaders, isAuthenticated } = useAuth();
  const [rollingHash, setRollingHash] = useState('');
  const [fullHash, setFullHash] = useState('');
  const [sealMetadata, setSealMetadata] = useState<SignedSealMetadata | null>(() => readCachedSealMetadata());
  const [baselineHash, setBaselineHash] = useState<string | null>(() => readCachedSealMetadata()?.contentHash ?? null);
  const [integrityStatus, setIntegrityStatus] = useState<IntegrityStatus>('EMPTY');
  const [isVerifying, setIsVerifying] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [verificationReport, setVerificationReport] = useState<ExplicitVerificationReport | null>(null);
  const verifyingRef = useRef(false);
  const [checkpointIntegrityStatus, setCheckpointIntegrityStatus] = useState<CheckpointIntegrityStatus>('NOT_LOADED');
  const [isVerifyingCheckpoint, setIsVerifyingCheckpoint] = useState(false);
  const [checkpointAuditReport, setCheckpointAuditReport] = useState<CheckpointIntegrityReport | null>(null);
  const checkpointAuditReportRef = useRef<CheckpointIntegrityReport | null>(null);
  const verifyingCheckpointRef = useRef(false);
  const checkpointPollMs = options?.checkpointPollIntervalMs ?? 10000;

  const recompute = useCallback(() => {
    if (quickLogs.length === 0) {
      setRollingHash('');
      setFullHash('');
      setIntegrityStatus('EMPTY');
      setLastCheckedAt(new Date().toISOString());
      return;
    }

    const { full, short } = computeHash(quickLogs);
    setFullHash(full);
    setRollingHash(short);

    const cachedMeta = readCachedSealMetadata();
    const cached = cachedMeta?.contentHash ?? baselineHash;
    if (!cached) {
      setIntegrityStatus('UNSEALED');
      setBaselineHash(null);
      setSealMetadata(null);
      setLastCheckedAt(new Date().toISOString());
      return;
    }

    // Fast local check; authoritative confirmation happens via server when authenticated
    if (cached !== full) {
      setIntegrityStatus('TAMPERED');
    } else {
      setIntegrityStatus('INTACT');
    }
    setBaselineHash(cached);
    if (cachedMeta) setSealMetadata(cachedMeta);
    setLastCheckedAt(new Date().toISOString());
  }, [quickLogs, baselineHash]);

  const sealBaseline = useCallback(async () => {
    if (quickLogs.length === 0) {
      writeCachedSealMetadata(null);
      setBaselineHash(null);
      setSealMetadata(null);
      setIntegrityStatus('EMPTY');
      return;
    }

    const { full, short } = computeHash(quickLogs);
    setFullHash(full);
    setRollingHash(short);

    if (!isAuthenticated) {
      // Cannot seal without server session — mark unsealed (do not treat local hash as trusted)
      setIntegrityStatus('UNSEALED');
      setLastCheckedAt(new Date().toISOString());
      return;
    }

    try {
      setIntegrityStatus('CHECKING');
      const res = await fetch(apiUrl('/api/audit/seal-logs'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ logs: quickLogs })
      });
      const data = await res.json();
      if (res.ok && data.success && data.seal?.contentHash) {
        const nextMeta: SignedSealMetadata = {
          sealId: data.seal.sealId,
          contentHash: String(data.seal.contentHash),
          entryHash: data.seal.entryHash,
          sealedAt: data.seal.sealedAt,
          logCount: quickLogs.length
        };
        writeCachedSealMetadata(nextMeta);
        setSealMetadata(nextMeta);
        setBaselineHash(nextMeta.contentHash);
        setIntegrityStatus(nextMeta.contentHash === full ? 'INTACT' : 'TAMPERED');
      } else {
        setIntegrityStatus('UNSEALED');
      }
    } catch {
      setIntegrityStatus('UNSEALED');
    }
    setLastCheckedAt(new Date().toISOString());
  }, [quickLogs, isAuthenticated, authHeaders]);

  const verifyIntegrity = useCallback(async (displayedLogs?: string[]): Promise<ExplicitVerificationReport> => {
    const logsToCheck = displayedLogs ?? quickLogs;
    const verifiedAt = new Date().toISOString();

    if (logsToCheck.length === 0) {
      const emptyReport: ExplicitVerificationReport = {
        status: 'EMPTY',
        verifiedAt,
        logCount: 0,
        recalculatedHash: '',
        sealedContentHash: baselineHash,
        sealMetadata,
        hashMatches: false,
        serverVerified: false
      };
      setIntegrityStatus('EMPTY');
      setLastCheckedAt(verifiedAt);
      setVerificationReport(emptyReport);
      return emptyReport;
    }

    setIsVerifying(true);
    setIntegrityStatus('CHECKING');

    try {
      const { full: recalculatedHash, short } = computeHash(logsToCheck);
      setFullHash(recalculatedHash);
      setRollingHash(short);

      const cachedMeta = readCachedSealMetadata() ?? sealMetadata;
      let activeMeta: SignedSealMetadata | null = cachedMeta;
      let sealedContentHash: string | null = cachedMeta?.contentHash ?? baselineHash ?? null;

      if (!sealedContentHash) {
        const unsealedReport: ExplicitVerificationReport = {
          status: 'UNSEALED',
          verifiedAt,
          logCount: logsToCheck.length,
          recalculatedHash,
          sealedContentHash: null,
          sealMetadata: null,
          hashMatches: false,
          serverVerified: false
        };
        setIntegrityStatus('UNSEALED');
        setLastCheckedAt(verifiedAt);
        setVerificationReport(unsealedReport);
        return unsealedReport;
      }

      let localMatch = recalculatedHash === sealedContentHash;
      let serverVerified = false;
      let serverMatch: boolean | undefined;
      let serverError: string | undefined;

      if (isAuthenticated) {
        try {
          const res = await fetch(apiUrl('/api/audit/verify-logs'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ logs: logsToCheck, contentHash: sealedContentHash })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            serverVerified = true;
            serverMatch = Boolean(data.match) && data.actualHash === recalculatedHash;
            if (data.sealMetadata?.contentHash) {
              const mergedMeta: SignedSealMetadata = {
                ...activeMeta,
                sealId: data.sealMetadata.sealId ?? activeMeta?.sealId,
                contentHash: activeMeta?.contentHash ?? data.sealMetadata.contentHash,
                sealedAt: data.sealMetadata.sealedAt ?? activeMeta?.sealedAt,
                logCount: data.sealMetadata.logCount ?? activeMeta?.logCount
              };
              activeMeta = mergedMeta;
              setSealMetadata(mergedMeta);
              writeCachedSealMetadata(mergedMeta);
            }
          } else {
            serverError = data.error || `HTTP ${res.status}`;
          }
        } catch (err: any) {
          serverError = err?.message || 'Server verification request failed';
        }
      }

      const finalMatches = serverVerified ? Boolean(localMatch && serverMatch) : localMatch;
      const finalStatus: IntegrityStatus = finalMatches ? 'INTACT' : 'TAMPERED';

      const report: ExplicitVerificationReport = {
        status: finalStatus,
        verifiedAt,
        logCount: logsToCheck.length,
        recalculatedHash,
        sealedContentHash,
        sealMetadata: activeMeta,
        hashMatches: finalMatches,
        serverVerified,
        serverMatch,
        error: serverError
      };

      setIntegrityStatus(finalStatus);
      setLastCheckedAt(verifiedAt);
      setVerificationReport(report);
      return report;
    } finally {
      setIsVerifying(false);
    }
  }, [quickLogs, baselineHash, sealMetadata, isAuthenticated, authHeaders]);

  const clearVerificationReport = useCallback(() => {
    setVerificationReport(null);
  }, []);

  // Local rolling hash + status on log changes
  useEffect(() => {
    recompute();
  }, [quickLogs, recompute]);

  // Periodic server-side verification when we have a cached seal
  useEffect(() => {
    if (!isAuthenticated || quickLogs.length === 0 || !baselineHash) return;

    const tick = async () => {
      if (verifyingRef.current) return;
      verifyingRef.current = true;
      try {
        const res = await fetch(apiUrl('/api/audit/verify-logs'), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ logs: quickLogs, contentHash: baselineHash })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setIntegrityStatus(data.status === 'TAMPERED' ? 'TAMPERED' : 'INTACT');
          setLastCheckedAt(new Date().toISOString());
        }
      } catch {
        /* network — keep last known local status */
      } finally {
        verifyingRef.current = false;
      }
    };

    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [isAuthenticated, quickLogs, baselineHash, authHeaders]);

  const restoreFromLedger = useCallback(async (): Promise<{ ok: boolean; logs?: string[]; error?: string }> => {
    if (!isAuthenticated) {
      return { ok: false, error: 'Not authenticated' };
    }
    try {
      setIntegrityStatus('CHECKING');
      const res = await fetch(apiUrl('/api/audit/restore-logs'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          confirmTampered: true,
          currentHash: fullHash || rollingHash,
          currentLogs: quickLogs
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.logs)) {
        setIntegrityStatus('TAMPERED');
        return { ok: false, error: data.error || 'Restore failed' };
      }
      if (data.contentHash) {
        const restoredMeta: SignedSealMetadata = {
          sealId: data.sealId,
          contentHash: String(data.contentHash),
          sealedAt: data.sealedAt || new Date().toISOString(),
          logCount: data.logs.length
        };
        writeCachedSealMetadata(restoredMeta);
        setSealMetadata(restoredMeta);
      }
      setBaselineHash(data.contentHash || null);
      setIntegrityStatus('INTACT');
      setVerificationReport(null);
      setLastCheckedAt(new Date().toISOString());
      return { ok: true, logs: data.logs.map(String) };
    } catch (e: any) {
      setIntegrityStatus('TAMPERED');
      return { ok: false, error: e.message || String(e) };
    }
  }, [isAuthenticated, authHeaders, fullHash, rollingHash, quickLogs]);

  const verifyCheckpointIntegrity = useCallback(async (): Promise<CheckpointIntegrityReport> => {
    const checkedAt = new Date().toISOString();
    if (!isAuthenticated) {
      const unauthReport: CheckpointIntegrityReport = {
        status: options?.checkpointSha256 ? 'UNCONFIGURED' : 'NOT_LOADED',
        verified: false,
        mismatch: false,
        failClosed: true,
        loadedHash: options?.checkpointSha256 ?? null,
        cloudSignedHash: null,
        cloudComputedHash: null,
        sourceUri: null,
        metadataSource: null,
        reason: 'Authentication required to verify loaded checkpoint against cloud-signed metadata.',
        checkedAt,
      };
      setCheckpointIntegrityStatus(unauthReport.status);
      setCheckpointAuditReport(unauthReport);
      return unauthReport;
    }

    if (verifyingCheckpointRef.current && checkpointAuditReportRef.current) {
      return checkpointAuditReportRef.current;
    }

    verifyingCheckpointRef.current = true;
    setIsVerifyingCheckpoint(true);
    try {
      const res = await fetch(apiUrl('/api/governance/verify-checkpoint-integrity'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          observedSha256: options?.checkpointSha256 ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const nextStatus: CheckpointIntegrityStatus =
        data.status === 'VERIFIED' ||
        data.status === 'MISMATCH' ||
        data.status === 'NOT_LOADED' ||
        data.status === 'UNCONFIGURED'
          ? data.status
          : res.status === 409
          ? 'MISMATCH'
          : 'UNCONFIGURED';

      const report: CheckpointIntegrityReport = {
        status: nextStatus,
        verified: Boolean(data.verified),
        mismatch: Boolean(data.mismatch || nextStatus === 'MISMATCH'),
        failClosed: Boolean(data.failClosed ?? nextStatus !== 'VERIFIED'),
        loadedHash: data.loadedHash ?? options?.checkpointSha256 ?? null,
        cloudSignedHash: data.cloudSignedHash ?? null,
        cloudComputedHash: data.cloudComputedHash ?? null,
        sourceUri: data.sourceUri ?? null,
        metadataSource: data.metadataSource ?? null,
        reason: data.reason || data.error || 'Checkpoint integrity verification completed.',
        checkedAt: data.checkedAt || checkedAt,
        auditEventTriggered: Boolean(data.auditEventTriggered),
        auditBlockIndex: typeof data.auditBlockIndex === 'number' ? data.auditBlockIndex : undefined,
        auditEntryHash: typeof data.auditEntryHash === 'string' ? data.auditEntryHash : undefined,
      };

      setCheckpointIntegrityStatus(nextStatus);
      checkpointAuditReportRef.current = report;
      setCheckpointAuditReport(report);
      return report;
    } catch (err: any) {
      const errReport: CheckpointIntegrityReport = {
        status: 'UNCONFIGURED',
        verified: false,
        mismatch: false,
        failClosed: true,
        loadedHash: options?.checkpointSha256 ?? null,
        cloudSignedHash: null,
        cloudComputedHash: null,
        sourceUri: null,
        metadataSource: null,
        reason: err?.message || 'Unable to verify loaded checkpoint integrity',
        checkedAt,
      };
      setCheckpointIntegrityStatus('UNCONFIGURED');
      checkpointAuditReportRef.current = errReport;
      setCheckpointAuditReport(errReport);
      return errReport;
    } finally {
      verifyingCheckpointRef.current = false;
      setIsVerifyingCheckpoint(false);
    }
  }, [isAuthenticated, authHeaders, options?.checkpointSha256]);

  // Continuous real-time monitor: verify loaded checkpoint hash against cloud-signed metadata
  useEffect(() => {
    if (!isAuthenticated) {
      setCheckpointIntegrityStatus(options?.checkpointSha256 ? 'UNCONFIGURED' : 'NOT_LOADED');
      return;
    }

    void verifyCheckpointIntegrity();
    const id = window.setInterval(() => {
      void verifyCheckpointIntegrity();
    }, checkpointPollMs);
    return () => window.clearInterval(id);
  }, [
    isAuthenticated,
    options?.checkpointSha256,
    options?.runtimeOnline,
    checkpointPollMs,
    verifyCheckpointIntegrity,
  ]);

  return {
    rollingHash,
    fullHash,
    baselineHash,
    sealMetadata,
    integrityStatus,
    isTampered: integrityStatus === 'TAMPERED',
    isVerifying,
    lastCheckedAt,
    verificationReport,
    recompute,
    verifyIntegrity,
    clearVerificationReport,
    sealBaseline,
    restoreFromLedger,
    checkpointIntegrityStatus,
    checkpointMismatch: checkpointIntegrityStatus === 'MISMATCH',
    isVerifyingCheckpoint,
    checkpointAuditReport,
    verifyCheckpointIntegrity,
  };
}
