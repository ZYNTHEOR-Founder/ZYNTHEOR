import React from 'react';
import { ModuleId } from '../types';
import { LayoutDashboard, Sparkles, FlaskConical, Award, MoreHorizontal } from 'lucide-react';
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

  if (hidden) {
    return null;
  }

  const quickItems: Array<{
    id: ModuleId;
    label: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  }> = [
    { id: 'command_center', label: lang === 'th' ? 'ศูนย์บัญชาการ' : 'Center', icon: LayoutDashboard },
    { id: 'conversational_intelligence', label: lang === 'th' ? 'แชท' : 'Chat', icon: Sparkles },
    { id: 'research_lab', label: lang === 'th' ? 'ห้องแล็บ' : 'Lab', icon: FlaskConical },
    { id: 'proof_of_intelligence', label: lang === 'th' ? 'หลักฐาน' : 'Evidence', icon: Award },
  ];

  return (
    <nav
      aria-label={lang === 'th' ? 'เมนูนำทางหลักบนมือถือ' : 'Mobile bottom navigation'}
      className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md px-1.5 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] flex items-center justify-around lg:hidden transition-colors"
      style={{
        backgroundColor: 'var(--app-surface)',
        borderTop: '1px solid var(--app-card-border)',
        color: 'var(--app-text-primary)',
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
            className="min-h-[44px] min-w-[44px] flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer"
            style={{
              color: isActive ? 'var(--app-accent)' : 'var(--app-text-secondary)',
              fontWeight: isActive ? 700 : 500,
            }}
          >
            <Icon className="w-4 h-4 shrink-0" style={{ color: isActive ? 'var(--app-accent)' : 'inherit' }} />
            <span className="text-[10px] mt-0.5 leading-tight truncate max-w-full">{item.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenMore}
        aria-label={lang === 'th' ? 'เปิดเมนูเพิ่มเติม' : 'Open more menu'}
        className="min-h-[44px] min-w-[44px] flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors cursor-pointer"
        style={{ color: 'var(--app-text-secondary)' }}
      >
        <MoreHorizontal className="w-4 h-4 shrink-0" />
        <span className="text-[10px] mt-0.5 leading-tight">{lang === 'th' ? 'เพิ่มเติม' : 'More'}</span>
      </button>
    </nav>
  );
};
