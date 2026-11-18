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
      case 'emerald':
      case 'lime':
        return 'h-1 w-full bg-[var(--app-accent)]';
      case 'amber':
        return 'h-1 w-full bg-[var(--app-amber)]';
      case 'emerald-amber':
      case 'cyan':
      case 'blue':
        return 'h-1 w-full bg-[var(--app-accent)]';
      case 'purple':
      case 'violet':
        return 'h-1 w-full bg-[var(--app-accent)]';
      case 'coral':
      case 'sunset':
      case 'magenta':
        return 'h-1 w-full bg-[var(--app-amber)]';
      case 'energy':
        return 'h-1 w-full bg-[var(--app-accent)]';
      default:
        return null;
    }
  };

  const isNavy = variant === 'navy' || variant === 'midnight';

  return (
    <div
      className={`rounded-2xl transition-all duration-200 overflow-hidden shadow-sm ${
        isNavy
          ? 'bg-[var(--app-surface)] text-[var(--app-text-primary)] border border-[color-mix(in_srgb,var(--app-card-border)_60%,transparent)] '
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
          className={`px-6 py-4 flex items-center justify-between border-b ${isNavy ? 'border-[var(--app-card-border)]' : ''}`}
          style={!isNavy ? { borderColor: 'var(--app-card-border)' } : undefined}
        >
          <div>
            {title && (
              <h3 
                className="font-semibold text-base tracking-tight"
                style={!isNavy ? { color: 'var(--app-text-primary)' } : undefined}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p 
                className="text-xs mt-0.5"
                style={!isNavy ? { color: 'var(--app-text-secondary)' } : undefined}
              >
                {subtitle}
              </p>
            )}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
};
