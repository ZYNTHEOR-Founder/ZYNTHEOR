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
        return 'h-1 w-full bg-gradient-to-r from-[#00F0FF] via-[#2563EB] to-[#7B2CBF]';
      case 'violet':
      case 'purple':
        return 'h-1 w-full bg-gradient-to-r from-[#7B2CBF] via-[#FF007F] to-[#00F0FF]';
      case 'magenta':
        return 'h-1 w-full bg-gradient-to-r from-[#FF007F] via-[#7B2CBF] to-[#FF5E3A]';
      case 'coral':
      case 'sunset':
      case 'amber':
        return 'h-1 w-full bg-gradient-to-r from-[#FF5E3A] via-[#FF007F] to-[#CCFF00]';
      case 'lime':
      case 'emerald':
      case 'energy':
        return 'h-1 w-full bg-gradient-to-r from-[#00F0FF] via-[#CCFF00] to-[#2563EB]';
      case 'emerald-amber':
        return 'h-1 w-full bg-gradient-to-r from-[#00F0FF] via-[#7B2CBF] to-[#FF5E3A]';
      default:
        return null;
    }
  };

  const isMidnightSurface = variant === 'navy' || variant === 'midnight';
  const isElevated = variant === 'elevated';
  const gradientClass = getGradientLine();

  return (
    <div
      className={`rounded-2xl transition-all duration-200 overflow-hidden shadow-sm border ${
        isMidnightSurface
          ? 'bg-[#0D1326] text-[#F4F7FF] border-[#1E294A] shadow-xl shadow-black/25'
          : isElevated
          ? 'bg-[#131B36] text-[#F4F7FF] border-[#293763] shadow-lg shadow-[#00F0FF]/5'
          : 'shadow-black/15'
      } ${className}`}
      style={
        !isMidnightSurface && !isElevated
          ? {
              backgroundColor: 'var(--app-card)',
              borderColor: 'var(--app-card-border)',
              color: 'var(--app-text-primary)',
            }
          : undefined
      }
    >
      {gradientClass && <div className={gradientClass} />}
      {(title || headerAction) && (
        <div
          className={`px-4 sm:px-6 py-4 flex items-center justify-between gap-3 border-b ${
            isMidnightSurface || isElevated ? 'border-[#1E294A]' : ''
          }`}
          style={
            !isMidnightSurface && !isElevated
              ? { borderColor: 'var(--app-card-border)' }
              : undefined
          }
        >
          <div className="min-w-0">
            {title && (
              <h3
                className="font-semibold text-sm sm:text-base tracking-tight truncate"
                style={
                  !isMidnightSurface && !isElevated
                    ? { color: 'var(--app-text-primary)' }
                    : undefined
                }
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                className="text-xs mt-0.5 leading-snug"
                style={
                  !isMidnightSurface && !isElevated
                    ? { color: 'var(--app-text-secondary)' }
                    : { color: '#9AA8C7' }
                }
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
