import React, { useState } from 'react';
import { EndToEndVerificationReport } from '../../types';
import { StatusBadge } from './StatusBadge';
import { useLanguage } from '../../context/LanguageContext';
import { Activity, CheckCircle2, Clock, ShieldCheck, ShieldX, Wrench } from 'lucide-react';

interface ConnectivityE2EVerifierProps {
  presignedUrl?: string;
  objectKey?: string;
  testPrompt?: string;
  authHeaders: () => Record<string, string>;
  onAfterVerify?: () => Promise<void> | void;
}

export const ConnectivityE2EVerifier: React.FC<ConnectivityE2EVerifierProps> = ({
  presignedUrl,
  objectKey,
  testPrompt,
  authHeaders,
  onAfterVerify,
}) => {
  const { lang } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<EndToEndVerificationReport | null>(null);
  const [error, setError] = useState('');

  const runLiveVerification = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, string> = {};
      if (presignedUrl?.trim()) payload.presignedUrl = presignedUrl.trim();
      if (objectKey?.trim()) payload.objectKey = objectKey.trim();
      if (testPrompt?.trim()) payload.testPrompt = testPrompt.trim();

      const res = await fetch('/api/connectivity/verify-e2e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.report) {
        throw new Error(json.error || `Verification HTTP ${res.status}`);
      }
      setReport(json.report);
      await onAfterVerify?.();
    } catch (err: any) {
      setError(err?.message || 'Unable to execute live E2E verification');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="connectivity-e2e-verifier"
      className="mt-4 pt-4 border-t border-[var(--app-card-border)] space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-[var(--app-text-primary)] flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[var(--app-accent)]" />
            <span>
              {lang === 'th'
                ? 'ทดสอบการเชื่อมต่อและ Inference จริงครบ 6 ขั้นตอน (Zero Simulation)'
                : 'Live 6-Stage End-to-End Online & Inference Verification'}
            </span>
          </div>
          <p className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">
            {lang === 'th'
              ? 'ตรวจ DNS, HTTPS, Cloud Storage, Bridge Ping, Checkpoint SHA-256 และ Inference จริงพร้อมเวลาตอบสนอง'
              : 'Measures live DNS, HTTPS, Cloud Storage, Bridge Health, Checkpoint SHA-256 load, and Inference output.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runLiveVerification()}
          disabled={busy}
          data-testid="run-e2e-verify-btn"
          className="px-3.5 py-2 rounded-xl text-xs font-bold border border-[var(--app-accent)] text-[var(--app-accent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{busy ? 'Testing Live Pipeline…' : 'Run Live E2E Verification'}</span>
        </button>
      </div>

      {error && (
        <div className="p-2.5 rounded-xl text-xs font-mono text-[var(--z-danger)] bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] border border-[var(--z-danger)]">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <StatusBadge
                status={
                  report.overallStatus === 'VERIFIED'
                    ? 'VERIFIED'
                    : report.overallStatus === 'FAILED'
                    ? 'BLOCKED'
                    : 'UNVERIFIED'
                }
              />
              <span className="font-mono font-bold text-[var(--app-text-primary)]">
                {report.onlineReady ? 'ONLINE-READY VERIFIED' : `FAIL-CLOSED (${report.overallStatus})`}
              </span>
            </div>
            <span className="text-[11px] font-mono text-[var(--app-text-secondary)] inline-flex items-center gap-1 tabular-nums">
              <Clock className="w-3 h-3" />
              Total: {report.totalLatencyMs} ms · {new Date(report.executedAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
            {report.stages.map((stage) => {
              const badgeColor =
                stage.status === 'PASS'
                  ? 'text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)]'
                  : stage.status === 'FAIL'
                  ? 'text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)]'
                  : 'text-[var(--z-warn)] border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)]';
              return (
                <div
                  key={stage.id}
                  className="rounded-xl p-3 bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-[var(--app-text-primary)] flex items-center gap-1.5">
                      {stage.status === 'PASS' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[var(--z-ok)] shrink-0" />
                      ) : stage.status === 'FAIL' ? (
                        <ShieldX className="w-3.5 h-3.5 text-[var(--z-danger)] shrink-0" />
                      ) : (
                        <Wrench className="w-3.5 h-3.5 text-[var(--z-warn)] shrink-0" />
                      )}
                      <span>
                        {stage.order}. {stage.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                      <span className="text-[var(--app-text-secondary)] tabular-nums">
                        {stage.latencyMs}ms
                      </span>
                      <span className={`px-1.5 py-0.5 rounded border font-bold ${badgeColor}`}>
                        {stage.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-[var(--app-text-secondary)] break-all">
                    {stage.error
                      ? stage.error
                      : Object.entries(stage.evidence || {})
                          .filter(([, v]) => v !== null && v !== undefined && v !== '')
                          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                          .join(' · ')}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 8-Subsystem Sovereign Online Policy Matrix */}
          <div className="rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] p-3 space-y-2">
            <div className="text-[11px] font-bold text-[var(--app-text-primary)]">
              {lang === 'th'
                ? 'สถานะข้อบังคับออนไลน์ระดับสถาปัตยกรรม 8 ระบบหลัก (Sovereign Online Policy Matrix)'
                : '8-Subsystem Sovereign Online Architecture Compliance Matrix'}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
              {report.subsystemPolicyMatrix.map((sub) => (
                <div
                  key={sub.id}
                  className="p-2 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] flex flex-col justify-between gap-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--app-text-primary)]">{sub.name}</span>
                    <StatusBadge
                      status={
                        sub.status === 'VERIFIED'
                          ? 'VERIFIED'
                          : sub.status === 'IMPLEMENTED'
                          ? 'IMPLEMENTED'
                          : sub.status === 'BLOCKED'
                          ? 'BLOCKED'
                          : 'UNVERIFIED'
                      }
                    />
                  </div>
                  <div className="font-mono text-[10px] text-[var(--app-text-secondary)] break-words">
                    {sub.evidence}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
