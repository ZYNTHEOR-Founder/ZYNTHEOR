import React from 'react';
export interface NavGroupLabelProps {
  children: React.ReactNode;
  className?: string;
}

export const NavGroupLabel: React.FC<NavGroupLabelProps> = ({ children, className = '' }) => (
  <div
    className={`nav-group-label px-3 mb-1.5 text-[10px] font-mono font-bold ${className}`}
    style={{ color: 'var(--app-text-secondary)' }}
  >
    {children}
  </div>
);

export interface NavItemButtonProps {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  accentColor?: string;
  onClick: () => void;
  badge?: string;
}

export const NavItemButton: React.FC<NavItemButtonProps> = ({
  label,
  icon,
  active = false,
  accentColor = 'var(--app-accent)',
  onClick,
  badge,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`workspace-nav-item w-full min-h-[40px] flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 text-left cursor-pointer border ${active ? 'is-active' : ''}`}
    style={{
      '--nav-accent': active ? 'var(--app-accent)' : accentColor,
    } as React.CSSProperties}
  >
    <div className="flex items-center gap-2.5 min-w-0 truncate">
      <span className="workspace-nav-icon shrink-0">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      {badge && (
        <span className="text-[10px] font-mono font-bold text-[var(--app-accent)]">
          {badge}
        </span>
      )}
      {active && <span className="workspace-nav-active-mark" aria-hidden="true" />}
    </div>
  </button>
);

export interface TabOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

export interface TabBarProps<T extends string> {
  items: Array<TabOption<T>>;
  activeId: T;
  onChange: (id: T) => void;
  className?: string;
}

export function TabBar<T extends string>({
  items,
  activeId,
  onChange,
  className = '',
}: TabBarProps<T>) {
  return (
    <div
      role="tablist"
      className={`flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl border ${className}`}
      style={{
        backgroundColor: 'var(--app-bg-secondary)',
        borderColor: 'var(--app-card-border)',
      }}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              isActive
                ? 'bg-gradient-to-r from-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] via-[color-mix(in_srgb,var(--app-accent-deep)_25%,transparent)] to-[color-mix(in_srgb,var(--app-accent-deep)_25%,transparent)] text-[var(--app-text-primary)] border border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)] shadow-sm'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] border border-transparent'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
