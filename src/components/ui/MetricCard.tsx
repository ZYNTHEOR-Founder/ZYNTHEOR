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
      case 'emerald':
        return 'bg-[color-mix(in_srgb,var(--z-ok)_15%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)]';
      case 'amber':
        return 'bg-[color-mix(in_srgb,var(--app-amber)_15%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_30%,transparent)]';
      case 'cyan':
      case 'blue':
        return 'bg-[color-mix(in_srgb,var(--z-ok)_15%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)]';
      case 'purple':
      case 'violet':
        return 'bg-[color-mix(in_srgb,var(--z-ok)_15%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)]';
      case 'magenta':
      case 'coral':
        return 'bg-[color-mix(in_srgb,var(--app-amber)_15%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_30%,transparent)]';
      case 'orange':
        return 'bg-[color-mix(in_srgb,var(--app-amber)_15%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_30%,transparent)]';
      case 'lime':
        return 'bg-[color-mix(in_srgb,var(--z-ok)_15%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)]';
      default:
        return 'bg-[color-mix(in_srgb,var(--z-ok)_15%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)]';
    }
  };

  return (
    <div 
      className="rounded-2xl p-5 border shadow-sm transition-all duration-200 flex flex-col justify-between"
      style={{
        backgroundColor: 'var(--app-card)',
        borderColor: 'var(--app-card-border)',
        color: 'var(--app-text-primary)'
      }}
    >
      <div className="flex items-start justify-between">
        <span 
          className="text-xs font-medium "
          style={{ color: 'var(--app-text-secondary)' }}
        >
          {title}
        </span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${getIconContainerStyle()}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3">
        <div 
          className="text-2xl font-bold tracking-tight font-mono tabular-nums"
          style={{ color: 'var(--app-text-primary)' }}
        >
          {value}
        </div>
        <div className="flex items-center justify-between mt-1 text-xs">
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
