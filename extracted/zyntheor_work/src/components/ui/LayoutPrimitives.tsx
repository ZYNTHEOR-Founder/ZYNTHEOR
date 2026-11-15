import React from 'react';
import { Heading, Text, Eyebrow } from './Typography';

export interface PageContainerProps {
  children: React.ReactNode;
  maxWidth?: '5xl' | '6xl' | '7xl' | 'full';
  className?: string;
}

export const PageContainer: React.FC<PageContainerProps> = ({
  children,
  maxWidth = '7xl',
  className = '',
}) => {
  const maxWidthClass =
    maxWidth === '5xl'
      ? 'max-w-5xl'
      : maxWidth === '6xl'
      ? 'max-w-6xl'
      : maxWidth === 'full'
      ? 'max-w-none'
      : 'max-w-7xl';

  return <div className={`w-full min-w-0 mx-auto space-y-6 md:space-y-8 ${maxWidthClass} ${className}`}>{children}</div>;
};

export interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  accentColor?: 'cyan' | 'violet' | 'magenta' | 'coral' | 'lime';
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  eyebrow,
  title,
  subtitle,
  action,
  accentColor = 'cyan',
  className = '',
}) => (
  <div className={`flex flex-col sm:flex-row sm:items-end justify-between gap-3 ${className}`}>
    <div className="min-w-0 space-y-1">
      {eyebrow && <Eyebrow color={accentColor}>{eyebrow}</Eyebrow>}
      <Heading as="h2" scale="h2">
        {title}
      </Heading>
      {subtitle && <Text size="xs">{subtitle}</Text>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export interface ResponsiveGridProps {
  children: React.ReactNode;
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}

export const ResponsiveGrid: React.FC<ResponsiveGridProps> = ({
  children,
  cols = 4,
  className = '',
}) => {
  const gridCols =
    cols === 1
      ? 'grid-cols-1'
      : cols === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : cols === 3
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4';

  return <div className={`grid gap-4 md:gap-5 min-w-0 ${gridCols} ${className}`}>{children}</div>;
};

export interface SplitPanelProps {
  primary: React.ReactNode;
  secondary: React.ReactNode;
  ratio?: '2:1' | '1:1' | '1:3';
  className?: string;
}

export const SplitPanel: React.FC<SplitPanelProps> = ({
  primary,
  secondary,
  ratio = '2:1',
  className = '',
}) => {
  const layoutClass =
    ratio === '1:1'
      ? 'xl:grid-cols-2'
      : ratio === '1:3'
      ? 'lg:grid-cols-[260px_minmax(0,1fr)]'
      : 'xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)]';

  return (
    <div className={`grid grid-cols-1 gap-5 md:gap-6 min-w-0 ${layoutClass} ${className}`}>
      <div className="min-w-0">{primary}</div>
      <div className="min-w-0">{secondary}</div>
    </div>
  );
};

export interface EmptyStateCardProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyStateCard: React.FC<EmptyStateCardProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => (
  <div
    className={`rounded-2xl border border-dashed p-6 sm:p-8 flex flex-col items-center justify-center text-center gap-3 ${className}`}
    style={{
      backgroundColor: 'var(--app-bg-secondary)',
      borderColor: 'var(--app-card-border)',
    }}
  >
    {icon && (
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#00F0FF]/10 text-[#00F0FF] border border-[#00F0FF]/25">
        {icon}
      </div>
    )}
    <div className="space-y-1 max-w-md">
      <div className="text-sm font-semibold" style={{ color: 'var(--app-text-primary)' }}>
        {title}
      </div>
      <div className="text-xs leading-relaxed" style={{ color: 'var(--app-text-secondary)' }}>
        {description}
      </div>
    </div>
    {action && <div className="pt-1">{action}</div>}
  </div>
);
