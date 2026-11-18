/**
 * useAuditIntegrity — Quick Agent log integrity via server-controlled seals.
 * localStorage is used only as a cache of the last server-issued contentHash.
 * Authoritative verification is always performed against the server AuditLedger seal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { sha256Sync } from '../utils/auditLedger';
import { useAuth } from '../context/AuthContext';

export type IntegrityStatus = 'INTACT' | 'TAMPERED' | 'EMPTY' | 'CHECKING' | 'UNSEALED';

export interface AuditIntegrityResult {
  rollingHash: string;
  fullHash: string;
  baselineHash: string | null;
  integrityStatus: IntegrityStatus;
  isTampered: boolean;
  lastCheckedAt: string | null;
  recompute: () => void;
  /** Request a server-side seal of the current logs (authoritative). */
  sealBaseline: () => Promise<void>;
  /** Restore logs from last server-sealed snapshot (Integrity Auto-Recovery). */
  restoreFromLedger: () => Promise<{ ok: boolean; logs?: string[]; error?: string }>;
}

const SEAL_CACHE_KEY = 'zyntheor_server_seal_content_hash';

function computeHash(logs: string[]): { full: string; short: string } {
  const payload = logs.join('\n');
  const full = sha256Sync(payload);
  return { full, short: full.slice(0, 12) };
}

export function useAuditIntegrity(quickLogs: string[]): AuditIntegrityResult {
  const { authHeaders, isAuthenticated } = useAuth();
  const [rollingHash, setRollingHash] = useState('');
  const [fullHash, setFullHash] = useState('');
  const [baselineHash, setBaselineHash] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(SEAL_CACHE_KEY);
  });
  const [integrityStatus, setIntegrityStatus] = useState<IntegrityStatus>('EMPTY');
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const verifyingRef = useRef(false);

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

    const cached = typeof window !== 'undefined' ? localStorage.getItem(SEAL_CACHE_KEY) : baselineHash;
    if (!cached) {
      setIntegrityStatus('UNSEALED');
      setBaselineHash(null);
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
    setLastCheckedAt(new Date().toISOString());
  }, [quickLogs, baselineHash]);

  const sealBaseline = useCallback(async () => {
    if (quickLogs.length === 0) {
      if (typeof window !== 'undefined') localStorage.removeItem(SEAL_CACHE_KEY);
      setBaselineHash(null);
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
      const res = await fetch('/api/audit/seal-logs', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ logs: quickLogs })
      });
      const data = await res.json();
      if (res.ok && data.success && data.seal?.contentHash) {
        const hash = data.seal.contentHash as string;
        if (typeof window !== 'undefined') {
          localStorage.setItem(SEAL_CACHE_KEY, hash);
        }
        setBaselineHash(hash);
        setIntegrityStatus(hash === full ? 'INTACT' : 'TAMPERED');
      } else {
        setIntegrityStatus('UNSEALED');
      }
    } catch {
      setIntegrityStatus('UNSEALED');
    }
    setLastCheckedAt(new Date().toISOString());
  }, [quickLogs, isAuthenticated, authHeaders]);

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
        const res = await fetch('/api/audit/verify-logs', {
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
      const res = await fetch('/api/audit/restore-logs', {
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
      if (typeof window !== 'undefined' && data.contentHash) {
        localStorage.setItem(SEAL_CACHE_KEY, data.contentHash);
      }
      setBaselineHash(data.contentHash || null);
      setIntegrityStatus('INTACT');
      setLastCheckedAt(new Date().toISOString());
      return { ok: true, logs: data.logs.map(String) };
    } catch (e: any) {
      setIntegrityStatus('TAMPERED');
      return { ok: false, error: e.message || String(e) };
    }
  }, [isAuthenticated, authHeaders, fullHash, rollingHash, quickLogs]);

return {
    rollingHash,
    fullHash,
    baselineHash,
    integrityStatus,
    isTampered: integrityStatus === 'TAMPERED',
    lastCheckedAt,
    recompute,
    sealBaseline,
    restoreFromLedger
  };
}
