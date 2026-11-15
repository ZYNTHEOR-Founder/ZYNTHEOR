import React from 'react';
import { ChevronRight } from 'lucide-react';

export interface NavGroupLabelProps {
  children: React.ReactNode;
  className?: string;
}

export const NavGroupLabel: React.FC<NavGroupLabelProps> = ({ children, className = '' }) => (
  <div
    className={`px-3 mb-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.14em] ${className}`}
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
  accentColor = '#00F0FF',
  onClick,
  badge,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 text-left cursor-pointer border"
    style={{
      background: active
        ? 'linear-gradient(135deg, rgba(0, 240, 255, 0.18) 0%, rgba(37, 99, 235, 0.22) 60%, rgba(123, 44, 191, 0.22) 100%)'
        : 'transparent',
      borderColor: active ? 'rgba(0, 240, 255, 0.45)' : 'transparent',
      color: active ? '#F4F7FF' : 'var(--app-text-primary)',
      opacity: active ? 1 : 0.86,
      boxShadow: active ? '0 4px 18px rgba(0, 240, 255, 0.12)' : 'none',
    }}
  >
    <div className="flex items-center gap-2.5 min-w-0 truncate">
      <span className="shrink-0" style={{ color: active ? '#00F0FF' : accentColor }}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      {badge && (
        <span className="text-[10px] font-mono font-bold text-[#00F0FF]">
          {badge}
        </span>
      )}
      {active ? (
        <span className="w-1.5 h-1.5 rounded-full bg-[#CCFF00] shadow-[0_0_8px_#CCFF00]" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5 opacity-40" />
      )}
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
                ? 'bg-gradient-to-r from-[#00F0FF]/20 via-[#2563EB]/25 to-[#7B2CBF]/25 text-[#F4F7FF] border border-[#00F0FF]/50 shadow-sm'
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
