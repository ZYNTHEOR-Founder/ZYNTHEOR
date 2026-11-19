import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  targetLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  requireConfirmText?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  targetLabel,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  requireConfirmText,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}) => {
  const { lang } = useLanguage();
  const th = lang === 'th';
  const titleId = useId();
  const descId = useId();
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmInputRef = useRef<HTMLInputElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const [typedText, setTypedText] = useState('');
  const [internalLoading, setInternalLoading] = useState(false);

  const busy = loading || internalLoading;
  const requiresTyping = Boolean(requireConfirmText && requireConfirmText.length > 0);
  const confirmMatched = !requiresTyping || typedText.trim() === requireConfirmText;

  useEffect(() => {
    if (!open) {
      setTypedText('');
      setInternalLoading(false);
      return;
    }

    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const timer = window.setTimeout(() => {
      if (requiresTyping && confirmInputRef.current) {
        confirmInputRef.current.focus();
      } else {
        cancelBtnRef.current?.focus();
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
      if (lastFocusedRef.current && typeof lastFocusedRef.current.focus === 'function') {
        lastFocusedRef.current.focus();
      }
    };
  }, [open, requiresTyping]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const resolvedConfirmLabel =
    confirmLabel || (th ? 'ยืนยันการลบ' : 'Delete');
  const resolvedCancelLabel =
    cancelLabel || (th ? 'ยกเลิก' : 'Cancel');

  const isDanger = tone === 'danger';
  const accentColor = isDanger ? 'var(--z-danger)' : 'var(--z-warn)';

  const handleConfirmClick = async () => {
    if (busy || !confirmMatched) return;
    try {
      const maybePromise = onConfirm();
      if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
        setInternalLoading(true);
        await maybePromise;
      }
    } finally {
      setInternalLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-[color-mix(in_srgb,var(--app-bg)_74%,transparent)] backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] text-[var(--app-text-primary)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
                  borderColor: `color-mix(in srgb, ${accentColor} 35%, transparent)`,
                  color: accentColor,
                }}
                aria-hidden="true"
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <h3 id={titleId} className="text-base font-bold text-[var(--app-text-primary)] leading-snug">
                  {title}
                </h3>
                <p id={descId} className="text-xs sm:text-sm text-[var(--app-text-secondary)] leading-relaxed">
                  {description}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              aria-label={th ? 'ปิดหน้าต่างยืนยัน' : 'Close confirmation dialog'}
              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] disabled:opacity-40 cursor-pointer shrink-0 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {targetLabel && (
            <div className="px-3.5 py-2.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] text-xs font-mono text-[var(--app-text-primary)] break-all">
              {targetLabel}
            </div>
          )}

          {requiresTyping && (
            <div className="space-y-1.5">
              <label className="block text-xs text-[var(--app-text-secondary)]">
                {th ? (
                  <>
                    พิมพ์ <span className="font-mono font-semibold text-[var(--app-text-primary)]">{requireConfirmText}</span> เพื่อยืนยันการลบ
                  </>
                ) : (
                  <>
                    Type <span className="font-mono font-semibold text-[var(--app-text-primary)]">{requireConfirmText}</span> to confirm deletion
                  </>
                )}
              </label>
              <input
                ref={confirmInputRef}
                type="text"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                disabled={busy}
                placeholder={requireConfirmText}
                autoComplete="off"
                spellCheck={false}
                className="w-full min-h-[40px] px-3 py-2 rounded-xl text-xs font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] focus:border-[var(--z-danger)] focus:outline-none"
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="px-3.5 py-2.5 rounded-xl border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] text-xs text-[var(--z-danger)]"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-[var(--app-card-border)]">
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="min-h-[40px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold border border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            >
              {resolvedCancelLabel}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmClick()}
              disabled={busy || !confirmMatched}
              className="min-h-[40px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 transition-all"
              style={{
                backgroundColor: accentColor,
                color: isDanger ? '#FFFFFF' : '#090D12',
              }}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Trash2 className="w-4 h-4 shrink-0" />
              )}
              <span>{busy ? (th ? 'กำลังดำเนินการ...' : 'Deleting...') : resolvedConfirmLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
