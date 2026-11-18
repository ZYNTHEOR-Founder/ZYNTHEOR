import React from 'react';
import { ModuleId } from '../types';
import { LayoutDashboard, Sparkles, FlaskConical, MoreHorizontal } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface MobileNavProps {
  activeModule: ModuleId;
  onSelectModule: (module: ModuleId) => void;
  onOpenMore: () => void;
  hidden?: boolean;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  activeModule,
  onSelectModule,
  onOpenMore,
  hidden = false,
}) => {
  const { lang } = useLanguage();
  if (hidden) return null;

  const quickItems: Array<{
    id: ModuleId;
    label: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  }> = [
    { id: 'command_center', label: lang === 'th' ? 'บัญชาการ' : 'Command', icon: LayoutDashboard },
    { id: 'intelligence_core', label: lang === 'th' ? 'ปัญญา' : 'Intelligence', icon: Sparkles },
    { id: 'research_lab', label: lang === 'th' ? 'วิจัย' : 'Research', icon: FlaskConical },
  ];

  const isMoreActive = !quickItems.some((item) => item.id === activeModule);

  return (
    <nav
      aria-label={lang === 'th' ? 'เมนูนำทางหลักบนมือถือ' : 'Mobile primary navigation'}
      className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-xl px-2 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] flex items-center justify-around lg:hidden"
      style={{ backgroundColor: 'color-mix(in srgb, var(--app-surface) 94%, transparent)', borderTop: '1px solid var(--app-card-border)', color: 'var(--app-text-primary)' }}
    >
      {quickItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeModule === item.id || (item.id === 'intelligence_core' && activeModule === 'conversational_intelligence');
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectModule(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className="min-h-12 min-w-12 flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer"
            style={{ color: isActive ? 'var(--app-accent)' : 'var(--app-text-secondary)', fontWeight: isActive ? 700 : 500 }}
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            <span className="text-[10px] mt-0.5 leading-tight truncate max-w-full">{item.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenMore}
        aria-label={lang === 'th' ? 'เปิดเมนูระบบทั้งหมด' : 'Open all system modules'}
        aria-current={isMoreActive ? 'page' : undefined}
        className="min-h-12 min-w-12 flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer"
        style={{ color: isMoreActive ? 'var(--app-accent)' : 'var(--app-text-secondary)' }}
      >
        <MoreHorizontal className="w-[18px] h-[18px] shrink-0" />
        <span className="text-[10px] mt-0.5 leading-tight">{lang === 'th' ? 'ระบบทั้งหมด' : 'All modules'}</span>
      </button>
    </nav>
  );
};
