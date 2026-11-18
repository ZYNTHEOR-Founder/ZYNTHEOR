import React, { useState } from 'react';
import { EvidenceDrawerItem, ModuleId } from '../types';
import { StatusDot } from './ui/StatusBadge';
import { useLanguage } from '../context/LanguageContext';
import { ArrowRight, Check, Copy, FileCode2, ShieldCheck, Wrench, X } from 'lucide-react';

interface EvidenceViewerDrawerProps {
  item: EvidenceDrawerItem | null;
  onClose: () => void;
  onNavigate?: (module: ModuleId) => void;
}

export const EvidenceViewerDrawer: React.FC<EvidenceViewerDrawerProps> = ({
  item,
  onClose,
  onNavigate,
}) => {
  const { lang } = useLanguage();
  const [copiedHash, setCopiedHash] = useState(false);

  if (!item) return null;

  const handleCopyHash = async () => {
    if (!item.hash) return;
    try {
      await navigator.clipboard.writeText(item.hash);
      setCopiedHash(true);
      window.setTimeout(() => setCopiedHash(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-sm flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-[var(--app-surface)] border-l border-[var(--app-card-border)] h-full flex flex-col shadow-2xl">
        <div className="px-5 py-4 flex items-start justify-between gap-3 border-b border-[var(--app-card-border)] bg-[var(--app-bg-secondary)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)]">
                {lang === 'th' ? 'ตัวตรวจสอบหลักฐาน (Evidence Viewer)' : 'Cryptographic & Runtime Evidence'}
              </span>
            </div>
            <h3 className="mt-1 text-base font-bold text-[var(--app-text-primary)] truncate">
              {item.title}
            </h3>
            {item.subtitle && (
              <p className="mt-0.5 text-xs text-[var(--app-text-secondary)] leading-relaxed">
                {item.subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close evidence viewer"
            className="p-2 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
            <StatusDot status={item.status} />
            <div className="text-[11px] font-mono text-[var(--app-text-secondary)] tabular-nums text-right">
              {item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Live runtime telemetry'}
            </div>
          </div>

          {item.hash && (
            <div className="p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)]">
                  SHA-256 Digest
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyHash()}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--app-card-border)] text-[10px] font-mono text-[var(--app-accent)] hover:border-[var(--app-accent)] cursor-pointer"
                >
                  {copiedHash ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedHash ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="font-mono text-[11px] text-[var(--app-text-primary)] break-all select-all">
                {item.hash}
              </div>
            </div>
          )}

          {item.source && (
            <div className="font-mono text-[11px] text-[var(--app-text-secondary)] break-all">
              Source: <span className="text-[var(--app-text-primary)]">{item.source}</span>
            </div>
          )}

          {item.details.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)]">
                {lang === 'th' ? 'ค่าที่ตรวจวัดจากระบบจริง' : 'Verified Fields'}
              </div>
              <div className="rounded-xl border border-[var(--app-card-border)] divide-y divide-[var(--app-card-border)] bg-[var(--app-bg)]">
                {item.details.map((row) => (
                  <div key={row.label} className="px-3.5 py-2.5 flex items-start justify-between gap-4">
                    <span className="text-[11px] text-[var(--app-text-secondary)] shrink-0">{row.label}</span>
                    <span className="font-mono tabular-nums text-[11px] text-[var(--app-text-primary)] text-right break-all">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.remediation && item.remediation.length > 0 && (
            <div className="p-3.5 rounded-xl border border-[color-mix(in_srgb,var(--z-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-warn)_8%,var(--app-bg))] space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--z-warn)]">
                <Wrench className="w-3.5 h-3.5" />
                <span>{lang === 'th' ? 'สิ่งที่ต้องดำเนินการต่อ' : 'Required Remediation Steps'}</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-[var(--app-text-primary)] leading-relaxed">
                {item.remediation.map((step, idx) => (
                  <li key={idx} className="break-words">{step}</li>
                ))}
              </ol>
            </div>
          )}

          {item.rawJson !== undefined && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)]">
                <FileCode2 className="w-3.5 h-3.5" />
                <span>Raw Inspection Payload</span>
              </div>
              <pre className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] font-mono text-[10px] text-[var(--app-text-secondary)] overflow-x-auto max-h-60">
                {JSON.stringify(item.rawJson, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[var(--app-card-border)] bg-[var(--app-bg-secondary)] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
          >
            {lang === 'th' ? 'ปิด (Esc)' : 'Close'}
          </button>
          {item.targetModule && onNavigate && (
            <button
              type="button"
              onClick={() => {
                onNavigate(item.targetModule!);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-slate-950 cursor-pointer"
            >
              <span>{item.targetLabel || (lang === 'th' ? 'เปิดพื้นที่ควบคุม' : 'Open Workspace')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
