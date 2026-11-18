import { useCallback, useEffect, useState } from 'react';

export interface BaselineReference {
  label: string;
  sha256: string;
  source: string;
}

export interface CheckpointVerificationResult {
  success: boolean;
  status: 'VERIFIED' | 'MISMATCH' | 'MISSING' | 'UNVERIFIED' | 'ERROR';
  checkpointPath: string;
  fileExists: boolean;
  fileSizeBytes: number | null;
  expectedParams: number;
  actualParams: number | null;
  expectedBaselines: BaselineReference[];
  actualContainerSha256: string | null;
  actualPayloadSha256: string | null;
  sha256Match: boolean;
  paramsMatch: boolean;
  matchedBaselineLabel: string | null;
  reason: string;
  checkedAt: string;
}

interface UseCheckpointVerificationOptions {
  enabled: boolean;
  authHeaders: () => Record<string, string>;
}

export function useCheckpointVerification({ enabled, authHeaders }: UseCheckpointVerificationOptions) {
  const [verification, setVerification] = useState<CheckpointVerificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const verifyCheckpoint = useCallback(async () => {
    if (!enabled) return null;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/model/verify-checkpoint-baseline', {
        method: 'GET',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Verification HTTP ${res.status}`);
      }
      setVerification(json as CheckpointVerificationResult);
      return json as CheckpointVerificationResult;
    } catch (err: any) {
      const msg = err?.message || 'Failed to verify checkpoint SHA-256 baseline.';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled, authHeaders]);

  useEffect(() => {
    if (enabled) {
      void verifyCheckpoint();
    } else {
      setVerification(null);
      setError('');
    }
  }, [enabled, verifyCheckpoint]);

  const isVerified = Boolean(
    verification?.status === 'VERIFIED' &&
      verification?.sha256Match &&
      verification?.paramsMatch &&
      verification?.actualParams === 41_527_808
  );

  return {
    verification,
    verifying: loading,
    verificationError: error,
    isVerified,
    verifyCheckpoint,
  };
}
