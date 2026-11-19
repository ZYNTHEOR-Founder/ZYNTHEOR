import React from 'react';

interface VividCardProps {
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
  title?: string;
  subtitle?: string;
  gradientAccent?: 'emerald' | 'amber' | 'emerald-amber' | 'cyan' | 'purple' | 'violet' | 'coral' | 'sunset' | 'energy' | 'none' | 'lime' | 'blue' | 'magenta';
  variant?: 'white' | 'navy' | 'midnight';
}

export const VividCard: React.FC<VividCardProps> = ({
  children,
  className = '',
  headerAction,
  title,
  subtitle,
  gradientAccent = 'none',
  variant = 'white'
}) => {
  const getGradientLine = () => {
    switch (gradientAccent) {
      case 'amber':
      case 'coral':
      case 'sunset':
      case 'magenta':
        return 'h-px w-full bg-[var(--app-amber)] opacity-45';
      case 'emerald':
      case 'lime':
      case 'emerald-amber':
      case 'cyan':
      case 'blue':
      case 'purple':
      case 'violet':
      case 'energy':
        return 'h-px w-full bg-[var(--app-accent)] opacity-45';
      default:
        return null;
    }
  };

  const isNavy = variant === 'navy' || variant === 'midnight';

  return (
    <div
      className={`rounded-xl transition-colors duration-200 overflow-hidden ${
        isNavy
          ? 'bg-[var(--app-surface)] text-[var(--app-text-primary)] border border-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)] '
          : 'border '
      } ${className}`}
      style={!isNavy ? {
        backgroundColor: 'var(--app-card)',
        borderColor: 'var(--app-card-border)',
        color: 'var(--app-text-primary)'
      } : undefined}
    >
      {getGradientLine() && <div className={getGradientLine()!} />}
      {(title || headerAction) && (
        <div
          className={`px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 border-b ${isNavy ? 'border-[var(--app-card-border)]' : ''}`}
          style={!isNavy ? { borderColor: 'var(--app-card-border)' } : undefined}
        >
          <div className="min-w-0">
            {title && (
              <h3
                className="font-semibold text-[15px] tracking-tight leading-snug"
                style={!isNavy ? { color: 'var(--app-text-primary)' } : undefined}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                className="text-xs mt-0.5 leading-relaxed"
                style={!isNavy ? { color: 'var(--app-text-secondary)' } : undefined}
              >
                {subtitle}
              </p>
            )}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
};
