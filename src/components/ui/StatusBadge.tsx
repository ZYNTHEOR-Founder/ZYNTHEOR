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
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[color-mix(in_srgb,var(--z-ok)_10%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] ${className}`}>
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--z-ok)]" />
          VERIFIED
        </span>
      );
    case 'IMPLEMENTED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] ${className}`}>
          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--app-accent)]" />
          IMPLEMENTED
        </span>
      );
    case 'PARTIAL':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[color-mix(in_srgb,var(--app-amber)_10%,transparent)] text-[var(--app-amber)] border border-[color-mix(in_srgb,var(--app-amber)_30%,transparent)] ${className}`}>
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--app-amber)]" />
          PARTIAL
        </span>
      );
    case 'BLOCKED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] ${className}`}>
          <XCircle className="w-3.5 h-3.5 text-[var(--z-danger)]" />
          BLOCKED
        </span>
      );
    case 'UNVERIFIED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] ${className}`}>
          <CircleHelp className="w-3.5 h-3.5" />
          UNVERIFIED
        </span>
      );
    case 'NOT_CONFIGURED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] ${className}`}>
          <Clock className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
          UNSET
        </span>
      );
    case 'NOT IMPLEMENTED':
    default:
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] ${className}`}>
          <Clock className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
          NOT IMPLEMENTED
        </span>
      );
  }
};

export type MinimalIndicatorState =
  | StatusLevel
  | 'FAILED'
  | 'NOT_IMPLEMENTED'
  | 'UNAVAILABLE'
  | 'ONLINE'
  | 'READY'
  | 'ACTIVE'
  | 'CHECKING'
  | 'INITIALIZING'
  | 'REPAIRED'
  | 'PENDING'
  | 'NOT_RUN'
  | 'NOT RUN'
  | 'COMPLETED'
  | 'DELIVERED'
  | 'CURRENT'
  | 'SKIPPED'
  | 'FAIL_CLOSED'
  | 'NOT_TRAINED'
  | 'NOT_LOADED'
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND';

export interface StatusDotProps {
  status: string;
  label?: string;
  detail?: string;
  pulse?: boolean;
  dotOnly?: boolean;
  className?: string;
}

const DOT_STYLE: Record<string, { color: string; critical?: boolean }> = {
  VERIFIED: { color: 'var(--z-ok)' },
  ONLINE: { color: 'var(--z-ok)' },
  READY: { color: 'var(--z-ok)' },
  IMPLEMENTED: { color: 'var(--app-accent)' },
  ACTIVE: { color: 'var(--app-accent)' },
  CHECKING: { color: 'var(--app-text-secondary)' },
  INITIALIZING: { color: 'var(--app-accent)' },
  PARTIAL: { color: 'var(--z-warn)' },
  REPAIRED: { color: 'var(--app-accent)' },
  PENDING: { color: 'var(--z-warn)' },
  NOT_RUN: { color: 'var(--app-text-secondary)' },
  'NOT RUN': { color: 'var(--app-text-secondary)' },
  'NOT IMPLEMENTED': { color: 'var(--app-text-secondary)' },
  UNVERIFIED: { color: 'var(--app-text-secondary)' },
  BLOCKED: { color: 'var(--z-danger)', critical: true },
  FAILED: { color: 'var(--z-danger)', critical: true },
  FAIL_CLOSED: { color: 'var(--z-danger)', critical: true },
  NOT_TRAINED: { color: 'var(--z-danger)', critical: true },
  NOT_LOADED: { color: 'var(--z-danger)', critical: true },
  NOT_CONFIGURED: { color: 'var(--app-text-secondary)', critical: true },
  UNAVAILABLE: { color: 'var(--app-text-secondary)', critical: true },
  NOT_FOUND: { color: 'var(--z-danger)', critical: true },
  COMPLETED: { color: 'var(--z-ok)' },
  DELIVERED: { color: 'var(--z-ok)' },
  CURRENT: { color: 'var(--app-accent)' },
  SKIPPED: { color: 'var(--app-text-secondary)' },
};

export const StatusDot: React.FC<StatusDotProps> = ({
  status,
  label,
  detail,
  dotOnly = false,
  className = '',
}) => {
  const style = DOT_STYLE[status] || DOT_STYLE.UNVERIFIED;
  const displayLabel = label ?? status;
  const accessibleLabel = detail ? `${displayLabel}: ${detail}` : displayLabel;
  const showText = !dotOnly || Boolean(style.critical);

  return (
    <span role="status" aria-label={accessibleLabel} title={accessibleLabel} className={`inline-flex items-center gap-1.5 shrink-0 ${className}`}>
      <span className="inline-flex h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: style.color }} aria-hidden="true" />
      {showText ? (
        <span className="font-mono text-[11px] font-medium tracking-wide leading-none whitespace-nowrap" style={{ color: style.color }}>
          {displayLabel}
        </span>
      ) : (
        <span className="sr-only">{accessibleLabel}</span>
      )}
    </span>
  );
};
