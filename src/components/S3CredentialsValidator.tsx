import React, { useCallback, useEffect, useState } from 'react';
import { VividCard } from './ui/VividCard';
import { StatusBadge } from './ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { reconnectionService } from '../services/reconnectionService';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  HardDrive,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

export interface S3ReachabilityResult {
  validConfig: boolean;
  bucketReachable: boolean;
  objectExists: boolean | null;
  bucket: string | null;
  region: string;
  endpoint: string | null;
  checkpointKey: string;
  httpStatusCode: number | null;
  latencyMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  checkedAt: string;
}

interface SecretFieldStatus {
  key: string;
  sensitive: boolean;
  configured: boolean;
  value: string | null;
  maskedPreview: string | null;
}

interface S3CredentialsValidatorProps {
  onAuditMutated?: (setting: string, oldVal: string, newVal: string) => void;
}

export const S3CredentialsValidator: React.FC<S3CredentialsValidatorProps> = ({
  onAuditMutated,
}) => {
  const { lang } = useLanguage();
  const { authHeaders, isAuthenticated, role } = useAuth();
  const isDevOrAdmin = role === 'Developer' || role === 'Administrator';

  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [checkpointKey, setCheckpointKey] = useState('');
  const [forcePathStyle, setForcePathStyle] = useState(false);

  const [configuredMap, setConfiguredMap] = useState<Record<string, SecretFieldStatus>>({});
  const [showAccessKey, setShowAccessKey] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);

  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyResult, setVerifyResult] = useState<S3ReachabilityResult | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const loadCurrentSettings = useCallback(async () => {
    if (!isAuthenticated || !isDevOrAdmin) return;
    setLoading(true);
    try {
      const res = await fetch('/api/settings/secrets', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const map: Record<string, SecretFieldStatus> = {};
      for (const f of (data.fields || []) as SecretFieldStatus[]) {
        map[f.key] = f;
      }
      setConfiguredMap(map);
      setBucket(map.S3_BUCKET?.value || '');
      setRegion(map.S3_REGION?.value || '');
      setEndpoint(map.S3_ENDPOINT?.value || '');
      setCheckpointKey(map.S3_CHECKPOINT_KEY?.value || '');
      setForcePathStyle(String(map.S3_FORCE_PATH_STYLE?.value || '').toLowerCase() === 'true');
      setAccessKeyId('');
      setSecretAccessKey('');
    } catch (err: any) {
      setFeedback({
        ok: false,
        text: err?.message || 'Unable to load current S3 credential settings.',
      });
    } finally {
      setLoading(false);
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin]);

  useEffect(() => {
    void loadCurrentSettings();
  }, [loadCurrentSettings]);

  const runReachabilityCheck = async () => {
    if (!isAuthenticated || !isDevOrAdmin) return null;
    setVerifying(true);
    setFeedback(null);
    try {
      const payload: Record<string, string | boolean> = {
        S3_FORCE_PATH_STYLE: forcePathStyle,
      };
      if (bucket.trim()) payload.S3_BUCKET = bucket.trim();
      if (region.trim()) payload.S3_REGION = region.trim();
      if (endpoint.trim()) payload.S3_ENDPOINT = endpoint.trim();
      if (checkpointKey.trim()) payload.S3_CHECKPOINT_KEY = checkpointKey.trim();
      if (accessKeyId.trim()) payload.S3_ACCESS_KEY_ID = accessKeyId.trim();
      if (secretAccessKey.trim()) payload.S3_SECRET_ACCESS_KEY = secretAccessKey.trim();

      const res = await fetch('/api/settings/s3/verify', {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Verification HTTP ${res.status}`);
      }
      const result = data.result as S3ReachabilityResult;
      setVerifyResult(result);
      return result;
    } catch (err: any) {
      setFeedback({
        ok: false,
        text: err?.message || 'Failed to contact backend S3 verification route.',
      });
      return null;
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveAndVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || !isDevOrAdmin) return;
    setSaving(true);
    setFeedback(null);
    try {
      const updates: Record<string, string | boolean> = {
        S3_BUCKET: bucket.trim(),
        S3_REGION: region.trim(),
        S3_ENDPOINT: endpoint.trim(),
        S3_FORCE_PATH_STYLE: forcePathStyle ? 'true' : 'false',
      };
      if (checkpointKey.trim()) updates.S3_CHECKPOINT_KEY = checkpointKey.trim();
      if (accessKeyId.trim()) updates.S3_ACCESS_KEY_ID = accessKeyId.trim();
      if (secretAccessKey.trim()) updates.S3_SECRET_ACCESS_KEY = secretAccessKey.trim();

      const saveRes = await fetch('/api/settings/secrets', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secrets: updates }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData.success) {
        throw new Error(saveData?.error || `Save failed (HTTP ${saveRes.status})`);
      }

      const updated: string[] = Array.isArray(saveData.updatedKeys) ? saveData.updatedKeys : [];
      if (onAuditMutated && updated.length > 0) {
        onAuditMutated(
          `AWS S3 Credentials (${updated.join(', ')})`,
          'PREVIOUS',
          'UPDATED_LOCAL_ENV'
        );
      }

      await loadCurrentSettings();
      const checkResult = await runReachabilityCheck();
      await reconnectionService.notifyCredentialsUpdated(updated, authHeaders());

      if (checkResult?.bucketReachable) {
        setFeedback({
          ok: true,
          text:
            lang === 'th'
              ? `บันทึก S3 Credentials และเชื่อมต่อ Bucket '${checkResult.bucket}' สำเร็จ (${checkResult.latencyMs}ms)`
              : `Saved S3 credentials and verified bucket '${checkResult.bucket}' reachability (${checkResult.latencyMs}ms).`,
        });
      } else {
        setFeedback({
          ok: false,
          text:
            checkResult?.errorMessage ||
            (lang === 'th'
              ? 'บันทึก S3 Credentials ลง .env.local แล้ว แต่ยังเข้าถึง Bucket ไม่ได้'
              : 'Saved S3 credentials to .env.local, but bucket reachability check failed.'),
        });
      }
    } catch (err: any) {
      setFeedback({
        ok: false,
        text: err?.message || 'Failed to save S3 credentials.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthenticated || !isDevOrAdmin) {
    return (
      <VividCard
        title={lang === 'th' ? 'AWS S3 Credentials & ตรวจสอบ Bucket' : 'AWS S3 Credentials & Bucket Reachability'}
        subtitle="Developer or Administrator session required"
        gradientAccent="coral"
      >
        <div className="flex items-start gap-2.5 text-xs text-[var(--app-text-secondary)] p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <ShieldAlert className="w-4 h-4 text-[var(--z-warn)] shrink-0 mt-0.5" />
          <span>
            {lang === 'th'
              ? 'กรุณาใช้สิทธิ์ Developer หรือ Administrator ด้านบนเพื่อกำหนดค่า S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION, S3_ENDPOINT และทดสอบความพร้อมของ Storage Bucket'
              : 'Sign in or switch to a Developer / Administrator session above to configure AWS S3 credentials and validate storage bucket reachability.'}
          </span>
        </div>
      </VividCard>
    );
  }

  return (
    <VividCard
      title={lang === 'th' ? 'AWS S3 Credentials & ตรวจสอบการเข้าถึง Bucket' : 'AWS S3 Credentials & Bucket Reachability'}
      subtitle={
        lang === 'th'
          ? 'กรอก S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION และ S3_ENDPOINT พร้อมทดสอบ HeadBucket / HeadObject กับ Backend จริง'
          : 'Securely configure AWS S3 / R2 / S3-compatible credentials and validate live storage bucket reachability against the backend.'
      }
      gradientAccent="emerald"
    >
      <form onSubmit={handleSaveAndVerify} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <HardDrive className="w-4 h-4 text-[var(--app-accent)]" />
            <span className="font-semibold text-[var(--app-text-primary)]">Bucket Reachability:</span>
            <StatusBadge
              status={
                verifyResult
                  ? verifyResult.bucketReachable
                    ? 'VERIFIED'
                    : 'BLOCKED'
                  : configuredMap.S3_BUCKET?.configured &&
                      configuredMap.S3_ACCESS_KEY_ID?.configured &&
                      configuredMap.S3_SECRET_ACCESS_KEY?.configured
                    ? 'IMPLEMENTED'
                    : 'BLOCKED'
              }
            />
            {verifyResult && (
              <span className="font-mono text-[11px] text-[var(--app-text-secondary)]">
                {verifyResult.httpStatusCode ? `HTTP ${verifyResult.httpStatusCode}` : verifyResult.errorCode || 'FAILED'}
                {` · ${verifyResult.latencyMs}ms`}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadCurrentSettings()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--app-bg)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* S3_ACCESS_KEY_ID */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <label htmlFor="s3-access-key-id" className="font-bold text-[var(--app-text-primary)]">
                S3_ACCESS_KEY_ID
              </label>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  configuredMap.S3_ACCESS_KEY_ID?.configured
                    ? 'bg-[color-mix(in_srgb,var(--z-ok)_14%,transparent)] text-[var(--z-ok)]'
                    : 'bg-[var(--app-surface)] text-[var(--app-text-secondary)]'
                }`}
              >
                {configuredMap.S3_ACCESS_KEY_ID?.configured
                  ? `SET · ${configuredMap.S3_ACCESS_KEY_ID.maskedPreview || '••••'}`
                  : 'UNSET'}
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                id="s3-access-key-id"
                data-testid="s3-input-S3_ACCESS_KEY_ID"
                type={showAccessKey ? 'text' : 'password'}
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder={
                  configuredMap.S3_ACCESS_KEY_ID?.configured
                    ? `Stored (${configuredMap.S3_ACCESS_KEY_ID.maskedPreview || '••••'}) — enter new key to replace`
                    : 'AKIAIOSFODNN7EXAMPLE'
                }
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3.5 py-2 pr-10 rounded-xl font-mono text-xs bg-[var(--app-bg)] border border-[var(--app-card-border)] focus:border-[var(--app-accent)] outline-none text-[var(--app-text-primary)]"
              />
              <button
                type="button"
                onClick={() => setShowAccessKey((v) => !v)}
                className="absolute right-2.5 text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                aria-label={showAccessKey ? 'Hide S3_ACCESS_KEY_ID' : 'Show S3_ACCESS_KEY_ID'}
              >
                {showAccessKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* S3_SECRET_ACCESS_KEY */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <label htmlFor="s3-secret-access-key" className="font-bold text-[var(--app-text-primary)]">
                S3_SECRET_ACCESS_KEY
              </label>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  configuredMap.S3_SECRET_ACCESS_KEY?.configured
                    ? 'bg-[color-mix(in_srgb,var(--z-ok)_14%,transparent)] text-[var(--z-ok)]'
                    : 'bg-[var(--app-surface)] text-[var(--app-text-secondary)]'
                }`}
              >
                {configuredMap.S3_SECRET_ACCESS_KEY?.configured
                  ? `SET · ${configuredMap.S3_SECRET_ACCESS_KEY.maskedPreview || '••••'}`
                  : 'UNSET'}
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                id="s3-secret-access-key"
                data-testid="s3-input-S3_SECRET_ACCESS_KEY"
                type={showSecretKey ? 'text' : 'password'}
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                placeholder={
                  configuredMap.S3_SECRET_ACCESS_KEY?.configured
                    ? `Stored (${configuredMap.S3_SECRET_ACCESS_KEY.maskedPreview || '••••'}) — enter new secret to replace`
                    : 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
                }
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3.5 py-2 pr-10 rounded-xl font-mono text-xs bg-[var(--app-bg)] border border-[var(--app-card-border)] focus:border-[var(--app-accent)] outline-none text-[var(--app-text-primary)]"
              />
              <button
                type="button"
                onClick={() => setShowSecretKey((v) => !v)}
                className="absolute right-2.5 text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                aria-label={showSecretKey ? 'Hide S3_SECRET_ACCESS_KEY' : 'Show S3_SECRET_ACCESS_KEY'}
              >
                {showSecretKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* S3_BUCKET */}
          <div className="space-y-1">
            <label htmlFor="s3-bucket" className="block text-[11px] font-mono font-bold text-[var(--app-text-primary)]">
              S3_BUCKET
            </label>
            <input
              id="s3-bucket"
              data-testid="s3-input-S3_BUCKET"
              type="text"
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              placeholder="zyntheor-checkpoints"
              spellCheck={false}
              className="w-full px-3.5 py-2 rounded-xl font-mono text-xs bg-[var(--app-bg)] border border-[var(--app-card-border)] focus:border-[var(--app-accent)] outline-none text-[var(--app-text-primary)]"
            />
          </div>

          {/* S3_REGION */}
          <div className="space-y-1">
            <label htmlFor="s3-region" className="block text-[11px] font-mono font-bold text-[var(--app-text-primary)]">
              S3_REGION
            </label>
            <input
              id="s3-region"
              data-testid="s3-input-S3_REGION"
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="us-east-1 or auto"
              spellCheck={false}
              className="w-full px-3.5 py-2 rounded-xl font-mono text-xs bg-[var(--app-bg)] border border-[var(--app-card-border)] focus:border-[var(--app-accent)] outline-none text-[var(--app-text-primary)]"
            />
          </div>

          {/* S3_ENDPOINT */}
          <div className="space-y-1">
            <label htmlFor="s3-endpoint" className="block text-[11px] font-mono font-bold text-[var(--app-text-primary)]">
              S3_ENDPOINT
            </label>
            <input
              id="s3-endpoint"
              data-testid="s3-input-S3_ENDPOINT"
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://<account>.r2.cloudflarestorage.com (optional for AWS S3)"
              spellCheck={false}
              className="w-full px-3.5 py-2 rounded-xl font-mono text-xs bg-[var(--app-bg)] border border-[var(--app-card-border)] focus:border-[var(--app-accent)] outline-none text-[var(--app-text-primary)]"
            />
          </div>

          {/* S3_CHECKPOINT_KEY */}
          <div className="space-y-1">
            <label htmlFor="s3-checkpoint-key" className="block text-[11px] font-mono font-bold text-[var(--app-text-primary)]">
              S3_CHECKPOINT_KEY
            </label>
            <input
              id="s3-checkpoint-key"
              data-testid="s3-input-S3_CHECKPOINT_KEY"
              type="text"
              value={checkpointKey}
              onChange={(e) => setCheckpointKey(e.target.value)}
              placeholder="checkpoints/model_checkpoint.pt"
              spellCheck={false}
              className="w-full px-3.5 py-2 rounded-xl font-mono text-xs bg-[var(--app-bg)] border border-[var(--app-card-border)] focus:border-[var(--app-accent)] outline-none text-[var(--app-text-primary)]"
            />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-mono text-[var(--app-text-primary)] cursor-pointer">
          <input
            type="checkbox"
            checked={forcePathStyle}
            onChange={(e) => setForcePathStyle(e.target.checked)}
            className="accent-[var(--app-accent)]"
          />
          <span>S3_FORCE_PATH_STYLE=true (MinIO / Supabase S3 / custom endpoint)</span>
        </label>

        {/* Backend Reachability Result Card */}
        {verifyResult && (
          <div
            data-testid="s3-verify-result"
            className={`p-3.5 rounded-2xl border font-mono text-xs space-y-2 ${
              verifyResult.bucketReachable
                ? 'bg-[color-mix(in_srgb,var(--z-ok)_10%,var(--app-surface))] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)]'
                : 'bg-[color-mix(in_srgb,var(--z-danger)_10%,var(--app-surface))] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`font-bold flex items-center gap-1.5 ${
                  verifyResult.bucketReachable ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'
                }`}
              >
                {verifyResult.bucketReachable ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <ShieldAlert className="w-4 h-4" />
                )}
                {verifyResult.bucketReachable
                  ? `Bucket '${verifyResult.bucket}' REACHABLE (HTTP ${verifyResult.httpStatusCode ?? 200})`
                  : `Bucket Verification Failed (${verifyResult.errorCode || 'UNREACHABLE'})`}
              </span>
              <span className="text-[11px] text-[var(--app-text-secondary)]">
                {verifyResult.latencyMs}ms · {new Date(verifyResult.checkedAt).toLocaleTimeString()}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
              <div className="p-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">Config Valid</div>
                <div className="font-bold text-[var(--app-text-primary)]">{verifyResult.validConfig ? 'YES' : 'NO'}</div>
              </div>
              <div className="p-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">Checkpoint Object</div>
                <div className="font-bold text-[var(--app-text-primary)]">
                  {verifyResult.objectExists === true
                    ? `FOUND (${verifyResult.checkpointKey})`
                    : verifyResult.objectExists === false
                      ? `MISSING 404 (${verifyResult.checkpointKey})`
                      : 'NOT_CHECKED'}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">Region / Endpoint</div>
                <div className="font-bold text-[var(--app-text-primary)] truncate">
                  {verifyResult.region} · {verifyResult.endpoint || 'AWS S3 Default'}
                </div>
              </div>
            </div>

            {verifyResult.errorMessage && (
              <div className="text-[11px] text-[var(--app-text-primary)] break-all">
                {verifyResult.errorMessage}
              </div>
            )}
          </div>
        )}

        {feedback && (
          <div
            data-testid="s3-save-feedback"
            className={`p-3 rounded-xl border text-xs font-mono flex items-start gap-2 ${
              feedback.ok
                ? 'bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] text-[var(--z-ok)]'
                : 'bg-[color-mix(in_srgb,var(--z-warn)_12%,transparent)] border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)] text-[var(--z-warn)]'
            }`}
          >
            {feedback.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span className="break-all">{feedback.text}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            data-testid="verify-s3-reachability-btn"
            disabled={verifying || saving}
            onClick={() => void runReachabilityCheck()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] disabled:opacity-50 cursor-pointer"
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${verifying ? 'animate-pulse' : ''}`} />
            <span>
              {verifying
                ? lang === 'th'
                  ? 'กำลังตรวจสอบ Bucket...'
                  : 'Verifying Bucket...'
                : lang === 'th'
                  ? 'ตรวจสอบ Bucket Reachability'
                  : 'Validate Bucket Reachability'}
            </span>
          </button>

          <button
            type="submit"
            data-testid="save-s3-credentials-btn"
            disabled={saving || verifying}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-[var(--app-bg)] disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>
              {saving
                ? lang === 'th'
                  ? 'กำลังบันทึกและตรวจสอบ...'
                  : 'Saving & Verifying...'
                : lang === 'th'
                  ? 'บันทึก S3 Credentials และตรวจสอบ'
                  : 'Save S3 Credentials & Verify'}
            </span>
          </button>
        </div>
      </form>
    </VividCard>
  );
};
