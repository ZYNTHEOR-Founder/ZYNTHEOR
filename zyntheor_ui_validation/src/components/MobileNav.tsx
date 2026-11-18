import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { ModuleId } from '../types';
import { LayoutDashboard, Code2, Cpu, BarChart3, MoreHorizontal } from 'lucide-react';

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
  const { t } = useLanguage();
  const quickItems: Array<{ id: ModuleId; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = [
    { id: 'command_center', label: t('mobile.command'), icon: LayoutDashboard },
    { id: 'dev_studio', label: t('mobile.studio'), icon: Code2 },
    { id: 'intelligence_core', label: t('mobile.brain'), icon: Cpu },
    { id: 'analytics_bi', label: t('mobile.analytics'), icon: BarChart3 }
  ];

  return (
    <nav 
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl px-2 py-1.5 flex items-center justify-around lg:hidden transition-colors"
      style={{
        backgroundColor: 'var(--app-surface)',
        borderTop: '1px solid var(--app-card-border)',
        color: 'var(--app-text-primary)',
        paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))'
      }}
    >
      {quickItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeModule === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelectModule(item.id)}
            className="mobile-nav-item flex flex-col items-center justify-center min-w-[56px] min-h-[46px] py-1 px-2 rounded-xl transition-all duration-200 cursor-pointer"
            style={{
              color: isActive ? 'var(--app-accent)' : 'var(--app-text-secondary)',
              fontWeight: isActive ? 700 : 500
            }}
          >
            <Icon className="w-5 h-5" style={{ color: isActive ? 'var(--app-accent)' : 'inherit' }} />
            <span className="text-[10px] mt-0.5">{item.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-label={t("mobile.more")}
        onClick={onOpenMore}
        className="mobile-nav-item flex flex-col items-center justify-center min-w-[56px] min-h-[46px] py-1 px-2 rounded-xl transition-all duration-200 cursor-pointer"
        style={{ color: 'var(--app-text-secondary)' }}
      >
        <MoreHorizontal className="w-5 h-5" />
        <span className="text-[10px] mt-0.5">{t('mobile.more')}</span>
      </button>
    </nav>
  );
};
