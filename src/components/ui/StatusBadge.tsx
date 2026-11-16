import React from 'react';
import { StatusLevel } from '../../types';
import { CheckCircle2, AlertTriangle, XCircle, Clock, ShieldCheck, CircleHelp } from 'lucide-react';

interface StatusBadgeProps {
  status: StatusLevel;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  switch (status) {
    case 'VERIFIED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[color-mix(in_srgb,var(--z-ok)_14%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] ${className}`}>
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--z-ok)]" />
          VERIFIED
        </span>
      );
    case 'IMPLEMENTED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] ${className}`}>
          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--app-accent)]" />
          IMPLEMENTED
        </span>
      );
    case 'PARTIAL':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[color-mix(in_srgb,var(--app-amber)_14%,transparent)] text-[var(--app-amber)] border border-[color-mix(in_srgb,var(--app-amber)_45%,transparent)] ${className}`}>
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--app-amber)]" />
          PARTIAL
        </span>
      );
    case 'BLOCKED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] ${className}`}>
          <XCircle className="w-3.5 h-3.5 text-[var(--z-danger)]" />
          BLOCKED
        </span>
      );
    case 'UNVERIFIED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] ${className}`}>
          <CircleHelp className="w-3.5 h-3.5" />
          UNVERIFIED
        </span>
      );
    case 'NOT IMPLEMENTED':
    default:
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] ${className}`}>
          <Clock className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
          NOT IMPLEMENTED
        </span>
      );
  }
};

// Minimal glowing status point used by dense operational surfaces.
// It intentionally never turns IMPLEMENTED into VERIFIED.
export type MinimalIndicatorState = StatusLevel | 'FAILED' | 'NOT_IMPLEMENTED' | 'UNAVAILABLE' | 'ONLINE' | 'READY' | 'ACTIVE' | 'CHECKING' | 'INITIALIZING' | 'REPAIRED' | 'PENDING' | 'NOT_RUN' | 'NOT RUN' | 'COMPLETED' | 'DELIVERED' | 'CURRENT' | 'SKIPPED' | 'FAIL_CLOSED' | 'NOT_TRAINED' | 'NOT_LOADED' | 'NOT_CONFIGURED' | 'NOT_FOUND';

export interface StatusDotProps {
  status: string;
  label?: string;
  detail?: string;
  pulse?: boolean;
  dotOnly?: boolean;
  className?: string;
}

const DOT_STYLE: Record<string, { color: string; glow: string; pulse?: boolean; critical?: boolean }> = {
  VERIFIED: { color: '#CCFF00', glow: '0 0 8px rgba(204,255,0,.55)' },
  ONLINE: { color: '#CCFF00', glow: '0 0 8px rgba(204,255,0,.55)', pulse: true },
  READY: { color: '#CCFF00', glow: '0 0 8px rgba(204,255,0,.55)' },
  IMPLEMENTED: { color: '#00F0FF', glow: '0 0 8px rgba(0,240,255,.45)' },
  ACTIVE: { color: '#00F0FF', glow: '0 0 9px rgba(0,240,255,.65)', pulse: true },
  CHECKING: { color: '#00F0FF', glow: '0 0 9px rgba(0,240,255,.65)', pulse: true },
  INITIALIZING: { color: '#00F0FF', glow: '0 0 9px rgba(0,240,255,.65)', pulse: true },
  PARTIAL: { color: '#FF9B42', glow: '0 0 7px rgba(255,155,66,.4)' },
  REPAIRED: { color: '#00F0FF', glow: '0 0 7px rgba(0,240,255,.4)' },
  PENDING: { color: '#FF9B42', glow: '0 0 7px rgba(255,155,66,.35)' },
  NOT_RUN: { color: '#9AA8C7', glow: 'none' },
  'NOT RUN': { color: '#9AA8C7', glow: 'none' },
  'NOT IMPLEMENTED': { color: '#9AA8C7', glow: 'none' },
  UNVERIFIED: { color: '#9AA8C7', glow: 'none' },
  BLOCKED: { color: '#FF007F', glow: '0 0 8px rgba(255,0,127,.45)', critical: true },
  FAILED: { color: '#FF5E3A', glow: '0 0 8px rgba(255,94,58,.45)', critical: true },
  FAIL_CLOSED: { color: '#FF007F', glow: '0 0 8px rgba(255,0,127,.45)', critical: true },
  NOT_TRAINED: { color: '#FF5E3A', glow: '0 0 8px rgba(255,94,58,.45)', critical: true },
  NOT_LOADED: { color: '#FF5E3A', glow: '0 0 8px rgba(255,94,58,.45)', critical: true },
  NOT_CONFIGURED: { color: '#9AA8C7', glow: 'none', critical: true },
  UNAVAILABLE: { color: '#9AA8C7', glow: 'none', critical: true },
  NOT_FOUND: { color: '#FF007F', glow: '0 0 8px rgba(255,0,127,.45)', critical: true },
  COMPLETED: { color: '#00F0FF', glow: '0 0 6px rgba(0,240,255,.35)' },
  DELIVERED: { color: '#CCFF00', glow: '0 0 8px rgba(204,255,0,.45)' },
  CURRENT: { color: '#00F0FF', glow: '0 0 6px rgba(0,240,255,.35)' },
  SKIPPED: { color: '#9AA8C7', glow: 'none' },
};

export const StatusDot: React.FC<StatusDotProps> = ({
  status,
  label,
  detail,
  pulse,
  dotOnly = false,
  className = '',
}) => {
  const style = DOT_STYLE[status] || DOT_STYLE.UNVERIFIED;
  const shouldPulse = pulse ?? Boolean(style.pulse);
  const displayLabel = label ?? status;
  const accessibleLabel = detail ? `${displayLabel}: ${detail}` : displayLabel;
  const showText = !dotOnly || Boolean(style.critical);

  return (
    <span role="status" aria-label={accessibleLabel} title={accessibleLabel} className={`inline-flex items-center gap-1.5 shrink-0 ${className}`}>
      <span className="relative flex h-2.5 w-2.5 items-center justify-center shrink-0" aria-hidden="true">
        {shouldPulse && <span className="absolute inline-flex h-full w-full rounded-full opacity-55 animate-ping" style={{ backgroundColor: style.color }} />}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: style.color, boxShadow: style.glow }} />
      </span>
      {showText ? <span className="font-mono text-[11px] font-semibold tracking-wide leading-none whitespace-nowrap" style={{ color: style.color }}>{displayLabel}</span> : <span className="sr-only">{accessibleLabel}</span>}
    </span>
  );
};
