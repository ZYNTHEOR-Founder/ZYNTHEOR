import React from 'react';
import { StatusLevel } from '../../types';
import { CheckCircle2, AlertTriangle, XCircle, Clock, ShieldCheck } from 'lucide-react';

interface StatusBadgeProps {
  status: StatusLevel;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  switch (status) {
    case 'VERIFIED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--z-ok)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_60%,transparent)] ${className}`}>
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--z-ok)]" />
          VERIFIED
        </span>
      );
    case 'IMPLEMENTED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--app-accent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)] ${className}`}>
          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--app-accent)]" />
          IMPLEMENTED
        </span>
      );
    case 'PARTIAL':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--app-amber)] text-[var(--app-amber)] border border-[color-mix(in_srgb,var(--app-amber)_60%,transparent)] ${className}`}>
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--app-amber)]" />
          PARTIAL
        </span>
      );
    case 'BLOCKED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--z-danger)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_60%,transparent)] ${className}`}>
          <XCircle className="w-3.5 h-3.5 text-[var(--z-danger)]" />
          BLOCKED
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
