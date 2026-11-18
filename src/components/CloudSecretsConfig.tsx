import React, { useCallback, useEffect, useState } from 'react';
import { VividCard } from './ui/VividCard';
import { StatusBadge } from './ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { reconnectionService } from '../services/reconnectionService';
import {
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  RefreshCw,
  RotateCw,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

interface SecretFieldStatus {
  key: string;
  sensitive: boolean;
  configured: boolean;
  value: string | null;
  maskedPreview: string | null;
}

interface SecretsSnapshot {
  storagePath: string;
  storageFileExists: boolean;
  configValid: boolean;
  provider: string;
  missingKeys: string[];
  validationError: string | null;
  sourceUri: string | null;
  fields: SecretFieldStatus[];
}

interface CloudSecretsConfigProps {
  onAuditMutated?: (setting: string, oldVal: string, newVal: string) => void;
}

export const CloudSecretsConfig: React.FC<CloudSecretsConfigProps> = ({ onAuditMutated }) => {
  const { lang } = useLanguage();
  const { authHeaders, isAuthenticated, role } = useAuth();
  const isDevOrAdmin = role === 'Developer' || role === 'Administrator';

  const [snapshot, setSnapshot] = useState<SecretsSnapshot | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [dirtyKeys, setDirtyKeys] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadSecrets = useCallback(async () => {
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
      setSnapshot(data as SecretsSnapshot);
      const nextForm: Record<string, string> = {};
      for (const f of data.fields as SecretFieldStatus[]) {
        nextForm[f.key] = f.sensitive ? '' : f.value || '';
      }
      setFormValues(nextForm);
      setDirtyKeys({});
    } catch (err: any) {
      setStatusMessage({
        ok: false,
        text: err?.message || 'Unable to load Cloud Secrets configuration.',
      });
    } finally {
      setLoading(false);
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin]);

  useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  const handleFieldChange = (key: string, val: string) => {
    setFormValues((prev) => ({ ...prev, [key]: val }));
    setDirtyKeys((prev) => ({ ...prev, [key]: true }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || !isDevOrAdmin) return;

    const payload: Record<string, string> = {};
    for (const [k, isDirty] of Object.entries(dirtyKeys)) {
      if (isDirty) {
        payload[k] = formValues[k] ?? '';
      }
    }

    if (Object.keys(payload).length === 0) {
      setSaving(true);
      setStatusMessage(null);
      try {
        const res = await reconnectionService.attemptReconnect({ headers: authHeaders() });
        setStatusMessage({
          ok: res.ok,
          text: res.ok
            ? lang === 'th'
              ? 'เชื่อมต่อ Cloud Runtime & Storage สำเร็จ'
              : 'Reconnected to Cloud Runtime & Object Storage successfully.'
            : res.error || res.data?.reason || 'Reconnect failed fail-closed.',
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/settings/secrets', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secrets: payload }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      }

      const updated: string[] = Array.isArray(data.updatedKeys) ? data.updatedKeys : [];
      const cleared: string[] = Array.isArray(data.clearedKeys) ? data.clearedKeys : [];
      if (data.snapshot) {
        setSnapshot(data.snapshot);
      }
      await loadSecrets();

      if (onAuditMutated && (updated.length > 0 || cleared.length > 0)) {
        onAuditMutated(
          `Secrets (${[...updated, ...cleared].join(', ')})`,
          'PREVIOUS',
          updated.length > 0 ? 'UPDATED_ENCRYPTED_LOCAL_ENV' : 'CLEARED'
        );
      }

      const reconnectRes = await reconnectionService.notifyCredentialsUpdated(
        [...updated, ...cleared],
        authHeaders()
      );
      const online = Boolean(reconnectRes.ok || data.connectivity?.online);
      const reason =
        data.connectivity?.reason ||
        reconnectRes.data?.reason ||
        reconnectRes.error ||
        (online ? 'Connected and verified.' : 'Saved to .env.local; waiting for reachable Cloud Checkpoint.');

      setStatusMessage({
        ok: online,
        text: online
          ? lang === 'th'
            ? `บันทึก Secrets (${updated.join(', ')}) และเชื่อมต่อ Cloud Runtime สำเร็จ`
            : `Saved (${updated.join(', ')}) and verified Cloud Runtime link.`
          : lang === 'th'
          ? `บันทึกค่าลง .env.local แล้ว แต่การเชื่อมต่อยังไม่พร้อม: ${reason}`
          : `Saved to .env.local. Reconnect probe status: ${reason}`,
      });
    } catch (err: any) {
      setStatusMessage({
        ok: false,
        text: err?.message || 'Failed to save cloud secrets.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async (key: string) => {
    if (!isAuthenticated || !isDevOrAdmin) return;
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/settings/secrets/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Failed to clear ${key}`);
      }
      if (onAuditMutated) {
        onAuditMutated(`Secret ${key}`, 'CONFIGURED', 'CLEARED');
      }
      await loadSecrets();
      await reconnectionService.notifyCredentialsUpdated([key], authHeaders());
      setStatusMessage({
        ok: true,
        text: lang === 'th' ? `ล้างค่า ${key} เรียบร้อยแล้ว` : `Cleared ${key} from .env.local`,
      });
    } catch (err: any) {
      setStatusMessage({
        ok: false,
        text: err?.message || `Unable to clear ${key}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const fieldMap = new Map<string, SecretFieldStatus>();
  for (const f of snapshot?.fields || []) {
    fieldMap.set(f.key, f);
  }

  const renderInputField = (cfg: {
    key: string;
    label: string;
    placeholder: string;
    sensitive?: boolean;
    helper?: string;
  }) => {
    const meta = fieldMap.get(cfg.key);
    const isSensitive = Boolean(cfg.sensitive ?? meta?.sensitive);
    const isRevealed = Boolean(revealed[cfg.key]);
    const configured = Boolean(meta?.configured);

    return (
      <div key={cfg.key} className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-[11px] font-mono font-bold text-[var(--app-text-primary)]">
            {cfg.label} <span className="text-[var(--app-text-secondary)] font-normal">({cfg.key})</span>
          </label>
          <div className="flex items-center gap-1.5">
            {configured ? (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[color-mix(in_srgb,var(--z-ok)_14%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]">
                SET {meta?.maskedPreview && isSensitive ? `· ${meta.maskedPreview}` : ''}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-[var(--app-surface)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)]">
                UNSET
              </span>
            )}
            {configured && (
              <button
                type="button"
                onClick={() => void handleClearKey(cfg.key)}
                disabled={saving}
                title={`Clear ${cfg.key}`}
                className="p-1 rounded-md text-[var(--z-danger)] hover:bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] cursor-pointer disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="relative flex items-center">
          <input
            type={isSensitive && !isRevealed ? 'password' : 'text'}
            data-testid={`secret-input-${cfg.key}`}
            value={formValues[cfg.key] ?? ''}
            onChange={(e) => handleFieldChange(cfg.key, e.target.value)}
            placeholder={
              isSensitive && configured
                ? `Configured (${meta?.maskedPreview || '••••'}) — enter new value to rotate`
                : cfg.placeholder
            }
            autoComplete="off"
            spellCheck={false}
            className="w-full px-3.5 py-2 pr-10 rounded-xl font-mono text-xs bg-[var(--app-bg)] border border-[var(--app-card-border)] focus:border-[var(--app-accent)] outline-none text-[var(--app-text-primary)]"
          />
          {isSensitive && (
            <button
              type="button"
              onClick={() => setRevealed((prev) => ({ ...prev, [cfg.key]: !prev[cfg.key] }))}
              className="absolute right-2.5 text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
              aria-label={isRevealed ? 'Hide secret' : 'Show secret'}
            >
              {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </div>
        {cfg.helper && <p className="text-[10px] text-[var(--app-text-secondary)]">{cfg.helper}</p>}
      </div>
    );
  };

  if (!isAuthenticated || !isDevOrAdmin) {
    return (
      <VividCard
        title={lang === 'th' ? 'Settings > Secrets (ตัวแปรระบบคลาวด์)' : 'Settings > Secrets (Cloud Environment)'}
        subtitle="Developer or Administrator session required"
        gradientAccent="coral"
      >
        <div className="flex items-start gap-2.5 text-xs text-[var(--app-text-secondary)] p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <ShieldAlert className="w-4 h-4 text-[var(--z-warn)] shrink-0 mt-0.5" />
          <span>
            {lang === 'th'
              ? 'กรุณาเลือกสิทธิ์ Developer หรือ Administrator ด้านบนเพื่อดูและบันทึกค่า CLOUD_RUNTIME_URL และ S3 Object Storage ใน .env.local'
              : 'Sign in or switch to a Developer / Administrator session above to configure CLOUD_RUNTIME_URL, S3 bucket credentials, and presigned checkpoint URLs.'}
          </span>
        </div>
      </VividCard>
    );
  }

  return (
    <VividCard
      title={lang === 'th' ? 'Secrets: การเชื่อมต่อ Cloud Runtime & Object Storage' : 'Settings > Secrets: Cloud Runtime & Object Storage'}
      subtitle={
        lang === 'th'
          ? 'บันทึกตัวแปรสภาพแวดล้อมอย่างปลอดภัยลง .env.local (ไม่แสดงค่าลับซ้ำ) และเชื่อมระบบใหม่อัตโนมัติทันที'
          : 'Securely persist CLOUD_RUNTIME_URL, S3 bucket settings, and presigned URLs to .env.local and trigger immediate runtime reconnection.'
      }
      gradientAccent="amber"
    >
      <form onSubmit={handleSave} className="space-y-5">
        {/* Validation & Storage Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <KeyRound className="w-4 h-4 text-[var(--app-amber)]" />
            <span className="font-semibold text-[var(--app-text-primary)]">
              Config Status:
            </span>
            <StatusBadge status={snapshot?.configValid ? 'VERIFIED' : 'BLOCKED'} />
            <span className="font-mono text-[11px] text-[var(--app-text-secondary)]">
              Provider: {snapshot?.provider || 'none'} · Store: {snapshot?.storagePath || '.env.local'}
            </span>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadSecrets()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--app-bg)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
        </div>

        {/* Section 1: Native Cloud Runtime */}
        <div className="p-4 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--app-text-primary)]">
            <Cloud className="w-4 h-4 text-[var(--app-accent)]" />
            <span>1. Native Cloud Runtime Endpoint</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {renderInputField({
              key: 'CLOUD_RUNTIME_URL',
              label: 'Cloud Runtime URL',
              placeholder: 'https://your-zyntheor-runtime.up.railway.app',
              sensitive: false,
              helper: 'Base HTTPS endpoint of the deployed ZYNTHEOR Native Runtime service.',
            })}
            {renderInputField({
              key: 'ZYNTHEOR_CONNECTIVITY_PROBE_URL',
              label: 'Connectivity Probe Override',
              placeholder: 'https://your-zyntheor-runtime.up.railway.app/api/health',
              sensitive: false,
              helper: 'Optional explicit health probe URL if distinct from CLOUD_RUNTIME_URL.',
            })}
          </div>
        </div>

        {/* Section 2: Cloud Object Storage (S3 / R2 / Supabase / MinIO) */}
        <div className="p-4 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--app-text-primary)]">
            <HardDrive className="w-4 h-4 text-[var(--app-accent)]" />
            <span>2. Cloud Object Storage (S3 / Cloudflare R2 / Supabase S3 / MinIO)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {renderInputField({
              key: 'S3_BUCKET',
              label: 'S3 Bucket Name',
              placeholder: 'zyntheor-checkpoints',
              sensitive: false,
            })}
            {renderInputField({
              key: 'S3_REGION',
              label: 'S3 Region',
              placeholder: 'auto or us-east-1',
              sensitive: false,
            })}
            {renderInputField({
              key: 'S3_ENDPOINT',
              label: 'S3 Endpoint URL',
              placeholder: 'https://<account>.r2.cloudflarestorage.com',
              sensitive: false,
              helper: 'Optional for AWS S3; required for R2, Supabase S3, GCS S3-interop, or MinIO.',
            })}
            {renderInputField({
              key: 'S3_CHECKPOINT_KEY',
              label: 'Checkpoint Object Key',
              placeholder: 'checkpoints/model_checkpoint.pt',
              sensitive: false,
            })}
            {renderInputField({
              key: 'S3_ACCESS_KEY_ID',
              label: 'S3 Access Key ID',
              placeholder: 'AKIA... / R2 Access Key',
              sensitive: true,
            })}
            {renderInputField({
              key: 'S3_SECRET_ACCESS_KEY',
              label: 'S3 Secret Access Key',
              placeholder: 'Secret access key (stored masked)',
              sensitive: true,
            })}
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-mono text-[var(--app-text-primary)] cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={String(formValues.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true'}
              onChange={(e) => handleFieldChange('S3_FORCE_PATH_STYLE', e.target.checked ? 'true' : 'false')}
              className="accent-[var(--app-accent)]"
            />
            <span>S3_FORCE_PATH_STYLE=true (enable for MinIO / Supabase S3)</span>
          </label>
        </div>

        {/* Section 3: Presigned Checkpoint URLs */}
        <div className="p-4 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--app-text-primary)]">
            <KeyRound className="w-4 h-4 text-[var(--app-amber)]" />
            <span>3. Presigned Checkpoint URLs (Optional Direct Stream)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {renderInputField({
              key: 'CHECKPOINT_PRESIGNED_URL',
              label: 'Checkpoint Presigned Download URL',
              placeholder: 'https://.../model_checkpoint.pt?X-Amz-Signature=...',
              sensitive: true,
            })}
            {renderInputField({
              key: 'CHECKPOINT_UPLOAD_URL',
              label: 'Checkpoint Presigned Upload URL',
              placeholder: 'https://.../model_checkpoint.pt?X-Amz-Signature=...',
              sensitive: true,
            })}
          </div>
        </div>

        {statusMessage && (
          <div
            data-testid="secrets-save-status"
            className={`p-3 rounded-xl border text-xs font-mono flex items-start gap-2 ${
              statusMessage.ok
                ? 'bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] text-[var(--z-ok)]'
                : 'bg-[color-mix(in_srgb,var(--z-warn)_12%,transparent)] border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)] text-[var(--z-warn)]'
            }`}
          >
            {statusMessage.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span className="break-all">{statusMessage.text}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void reconnectionService.attemptReconnect({ headers: authHeaders() })}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] disabled:opacity-50 cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
            <span>{lang === 'th' ? 'ทดสอบเชื่อมต่อใหม่' : 'Test Reconnect'}</span>
          </button>

          <button
            type="submit"
            data-testid="save-secrets-btn"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-[var(--app-bg)] disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>
              {saving
                ? lang === 'th'
                  ? 'กำลังบันทึกและเชื่อมต่อ...'
                  : 'Saving & Reconnecting...'
                : lang === 'th'
                ? 'บันทึก Secrets และเชื่อม Cloud Runtime'
                : 'Save Secrets & Reconnect'}
            </span>
          </button>
        </div>
      </form>
    </VividCard>
  );
};
