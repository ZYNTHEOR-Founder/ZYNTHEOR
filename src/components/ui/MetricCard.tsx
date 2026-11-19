import React from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  accentColor?: 'emerald' | 'amber' | 'cyan' | 'blue' | 'purple' | 'violet' | 'magenta' | 'coral' | 'orange' | 'lime';
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  trend,
  accentColor = 'emerald'
}) => {
  const getIconContainerStyle = () => {
    switch (accentColor) {
      case 'amber':
      case 'magenta':
      case 'coral':
      case 'orange':
        return 'bg-[color-mix(in_srgb,var(--app-amber)_12%,transparent)] text-[var(--app-amber)]';
      default:
        return 'bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-[var(--app-accent)]';
    }
  };

  return (
    <div
      className="rounded-xl p-4 sm:p-5 border transition-colors duration-200 flex flex-col justify-between"
      style={{
        backgroundColor: 'var(--app-card)',
        borderColor: 'var(--app-card-border)',
        color: 'var(--app-text-primary)'
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-xs font-medium leading-snug"
          style={{ color: 'var(--app-text-secondary)' }}
        >
          {title}
        </span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${getIconContainerStyle()}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3">
        <div
          className="text-xl sm:text-2xl font-semibold tracking-tight font-mono tabular-nums"
          style={{ color: 'var(--app-text-primary)' }}
        >
          {value}
        </div>
        <div className="flex items-center justify-between mt-1 text-xs gap-2">
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
              className={`font-semibold ml-auto shrink-0 ${
                trend.isPositive ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'
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
