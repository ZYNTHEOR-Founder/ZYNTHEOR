import React from 'react';

export type VividGradientAccent =
  | 'emerald'
  | 'amber'
  | 'emerald-amber'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'violet'
  | 'magenta'
  | 'coral'
  | 'lime'
  | 'sunset'
  | 'energy'
  | 'none';

export interface VividCardProps {
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
  title?: string;
  subtitle?: string;
  gradientAccent?: VividGradientAccent;
  variant?: 'white' | 'navy' | 'midnight' | 'elevated';
}

export const VividCard: React.FC<VividCardProps> = ({
  children,
  className = '',
  headerAction,
  title,
  subtitle,
  gradientAccent = 'none',
  variant = 'white',
}) => {
  const getGradientLine = (): string | null => {
    switch (gradientAccent) {
      case 'cyan':
      case 'blue':
        return 'h-0.5 w-full bg-gradient-to-r from-[#00F0FF] via-[#2563EB] to-[#7B2CBF]';
      case 'violet':
      case 'purple':
        return 'h-0.5 w-full bg-gradient-to-r from-[#7B2CBF] via-[#FF007F] to-[#00F0FF]';
      case 'magenta':
        return 'h-0.5 w-full bg-gradient-to-r from-[#FF007F] via-[#7B2CBF] to-[#FF5E3A]';
      case 'coral':
      case 'sunset':
      case 'amber':
        return 'h-0.5 w-full bg-gradient-to-r from-[#FF5E3A] via-[#FF007F] to-[#CCFF00]';
      case 'lime':
      case 'emerald':
      case 'energy':
        return 'h-0.5 w-full bg-gradient-to-r from-[#00F0FF] via-[#CCFF00] to-[#2563EB]';
      case 'emerald-amber':
        return 'h-0.5 w-full bg-gradient-to-r from-[#00F0FF] via-[#7B2CBF] to-[#FF5E3A]';
      default:
        return null;
    }
  };

  const isElevated = variant === 'elevated';
  const gradientClass = getGradientLine();

  return (
    <div
      className={`platform-card rounded-2xl transition-all duration-200 overflow-hidden shadow-sm border ${className}`}
      style={{
        backgroundColor: isElevated ? 'var(--app-surface-elevated)' : 'var(--app-card)',
        borderColor: 'var(--app-card-border)',
        color: 'var(--app-text-primary)',
      }}
    >
      {gradientClass && <div className={gradientClass} />}
      {(title || headerAction) && (
        <div
          className="px-4 sm:px-6 py-4 flex items-center justify-between gap-3 border-b"
          style={{ borderColor: 'var(--app-card-border)' }}
        >
          <div className="min-w-0">
            {title && (
              <h3
                className="font-semibold text-sm sm:text-base tracking-tight truncate"
                style={{ color: 'var(--app-text-primary)' }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                className="text-xs mt-0.5 leading-snug"
                style={{ color: 'var(--app-text-secondary)' }}
              >
                {subtitle}
              </p>
            )}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      )}
      <div className="p-4 sm:p-6 min-w-0">{children}</div>
    </div>
  );
};
