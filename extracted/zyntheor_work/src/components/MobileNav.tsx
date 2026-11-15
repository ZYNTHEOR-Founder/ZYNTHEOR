import React from 'react';
import { ModuleId } from '../types';
import { LayoutDashboard, Workflow, Cpu, BarChart3, MoreHorizontal } from 'lucide-react';

interface MobileNavProps {
  activeModule: ModuleId;
  onSelectModule: (module: ModuleId) => void;
  onOpenMore: () => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  activeModule,
  onSelectModule,
  onOpenMore
}) => {
  const quickItems: Array<{ id: ModuleId; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = [
    { id: 'command_center', label: 'Command', icon: LayoutDashboard },
    { id: 'autonomous_execution', label: 'Execute', icon: Workflow },
    { id: 'intelligence_core', label: 'Brain', icon: Cpu },
    { id: 'analytics_bi', label: 'Analytics', icon: BarChart3 }
  ];

  return (
    <nav
      aria-label="Mobile quick navigation"
      className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-md px-2 py-1.5 flex items-center justify-around lg:hidden transition-colors"
      style={{
        backgroundColor: 'var(--app-surface)',
        borderTop: '1px solid var(--app-card-border)',
        color: 'var(--app-text-primary)'
      }}
    >
      {quickItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeModule === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectModule(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className="flex flex-col items-center justify-center min-h-[44px] py-1 px-3 rounded-xl transition-colors cursor-pointer"
            style={{
              color: isActive ? 'var(--zy-cyan, var(--app-accent))' : 'var(--app-text-secondary)',
              backgroundColor: isActive ? 'rgba(0, 240, 255, 0.10)' : 'transparent',
              fontWeight: isActive ? 700 : 500
            }}
          >
            <Icon className="w-5 h-5" style={{ color: isActive ? 'var(--zy-cyan, var(--app-accent))' : 'inherit' }} />
            <span className="text-[10px] mt-0.5 truncate max-w-[64px]">{item.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenMore}
        className="flex flex-col items-center justify-center min-h-[44px] py-1 px-3 rounded-xl transition-colors cursor-pointer"
        style={{ color: 'var(--app-text-secondary)' }}
      >
        <MoreHorizontal className="w-5 h-5" />
        <span className="text-[10px] mt-0.5">All</span>
      </button>
    </nav>
  );
};
