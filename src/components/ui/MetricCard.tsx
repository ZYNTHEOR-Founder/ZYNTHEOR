import React from 'react';

export type MetricAccentColor =
  | 'emerald'
  | 'amber'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'violet'
  | 'magenta'
  | 'coral'
  | 'orange'
  | 'lime';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  accentColor?: MetricAccentColor;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  trend,
  accentColor = 'cyan',
}) => {
  const getIconContainerStyle = (): string => {
    switch (accentColor) {
      case 'cyan':
        return 'bg-[#00F0FF]/12 text-[#00F0FF] border-[#00F0FF]/35';
      case 'blue':
        return 'bg-[#2563EB]/15 text-[#60A5FA] border-[#2563EB]/40';
      case 'purple':
      case 'violet':
        return 'bg-[#7B2CBF]/18 text-[#C084FC] border-[#7B2CBF]/45';
      case 'magenta':
        return 'bg-[#FF007F]/15 text-[#FF4FA3] border-[#FF007F]/40';
      case 'coral':
      case 'orange':
      case 'amber':
        return 'bg-[#FF5E3A]/15 text-[#FF7D5F] border-[#FF5E3A]/40';
      case 'lime':
      case 'emerald':
      default:
        return 'bg-[#CCFF00]/12 text-[#CCFF00] border-[#CCFF00]/35';
    }
  };

  return (
    <div
      className="platform-metric-card rounded-2xl p-4 sm:p-5 border shadow-sm transition-all duration-200 flex flex-col justify-between min-w-0"
      style={{
        backgroundColor: 'var(--app-card)',
        borderColor: 'var(--app-card-border)',
        color: 'var(--app-text-primary)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider leading-snug"
          style={{ color: 'var(--app-text-secondary)' }}
        >
          {title}
        </span>
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${getIconContainerStyle()}`}
        >
          {icon}
        </div>
      </div>
      <div className="mt-3 min-w-0">
        <div
          className="text-xl sm:text-2xl font-bold tracking-tight font-mono tabular-nums truncate"
          style={{ color: 'var(--app-text-primary)' }}
        >
          {value}
        </div>
        <div className="flex items-center justify-between gap-2 mt-1 text-xs">
          {subtitle && (
            <span
              className="truncate"
              style={{ color: 'var(--app-text-secondary)' }}
            >
              {subtitle}
            </span>
          )}
          {trend && (
            <span
              className={`font-semibold ml-auto shrink-0 font-mono ${
                trend.isPositive ? 'text-[#CCFF00]' : 'text-[#FF007F]'
              }`}
            >
              {trend.value}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
