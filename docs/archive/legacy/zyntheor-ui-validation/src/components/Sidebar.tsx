import React, { useMemo } from 'react';
import { ModuleId } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useAuth, AuthRole } from '../context/AuthContext';
import {
  LayoutDashboard,
  Cpu,
  Code2,
  FlaskConical,
  Zap,
  BookOpen,
  Binary,
  Microscope,
  Terminal,
  ShoppingBag,
  CreditCard,
  BarChart3,
  ShieldCheck,
  Settings,
  Sliders,
  Sparkles
} from 'lucide-react';

interface SidebarProps {
  activeModule: ModuleId;
  onSelectModule: (module: ModuleId) => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  id: ModuleId;
  labelKey: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accentColor: string;
  /** Minimum role required to see this item. Undefined = all roles. */
  minRole?: AuthRole;
}

interface NavGroup {
  groupKey: string;
  items: NavItem[];
}

const ROLE_RANK: Record<AuthRole, number> = {
  User: 0,
  Developer: 1,
  Administrator: 2
};

function roleAllows(userRole: AuthRole, minRole?: AuthRole): boolean {
  if (!minRole) return true;
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onSelectModule,
  isMobileOpen,
  onCloseMobile
}) => {
  const { t } = useLanguage();
  const { role } = useAuth();

  const allGroups: NavGroup[] = [
    {
      groupKey: 'group.operations',
      items: [
        { id: 'command_center', labelKey: 'nav.command_center', icon: LayoutDashboard, accentColor: 'var(--app-accent)' },
        { id: 'conversational_intelligence', labelKey: 'nav.conversational_intelligence', icon: Sparkles, accentColor: 'var(--app-amber)' },
        { id: 'intelligence_core', labelKey: 'nav.intelligence_core', icon: Cpu, accentColor: 'var(--app-accent)' },
        { id: 'model_laboratory', labelKey: 'nav.model_laboratory', icon: Binary, accentColor: 'var(--app-accent)', minRole: 'Developer' }
      ]
    },
    {
      groupKey: 'group.engineering',
      items: [
        { id: 'dev_studio', labelKey: 'nav.dev_studio', icon: Code2, accentColor: 'var(--app-accent)', minRole: 'Developer' },
        { id: 'automation_center', labelKey: 'nav.automation_center', icon: Zap, accentColor: 'var(--app-amber)' },
        { id: 'api_platform', labelKey: 'nav.api_platform', icon: Terminal, accentColor: 'var(--app-accent)', minRole: 'Developer' }
      ]
    },
    {
      groupKey: 'group.reasoning',
      items: [
        { id: 'research_lab', labelKey: 'nav.research_lab', icon: FlaskConical, accentColor: 'var(--app-amber)' },
        { id: 'knowledge_hub', labelKey: 'nav.knowledge_hub', icon: BookOpen, accentColor: 'var(--app-accent)' },
        { id: 'experiment_center', labelKey: 'nav.experiment_center', icon: Microscope, accentColor: 'var(--app-amber)', minRole: 'Developer' }
      ]
    },
    {
      groupKey: 'group.business',
      items: [
        { id: 'marketplace', labelKey: 'nav.marketplace', icon: ShoppingBag, accentColor: 'var(--app-accent)' },
        { id: 'subscription_billing', labelKey: 'nav.subscription_billing', icon: CreditCard, accentColor: 'var(--app-amber)' },
        { id: 'analytics_bi', labelKey: 'nav.analytics_bi', icon: BarChart3, accentColor: 'var(--app-accent)' }
      ]
    },
    {
      groupKey: 'group.trust',
      items: [
        { id: 'governance_security', labelKey: 'nav.governance_security', icon: ShieldCheck, accentColor: 'var(--app-accent)', minRole: 'Developer' },
        { id: 'admin_console', labelKey: 'nav.admin_console', icon: Sliders, accentColor: 'var(--app-amber)', minRole: 'Administrator' },
        { id: 'user_settings', labelKey: 'nav.user_settings', icon: Settings, accentColor: 'var(--app-text-secondary)' }
      ]
    }
  ];

  // Physically remove items the current role cannot access (no client-side discovery).
  const groups = useMemo(() => {
    return allGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => roleAllows(role, item.minRole))
      }))
      .filter((g) => g.items.length > 0);
  }, [role]);

  const handleItemClick = (id: ModuleId) => {
    onSelectModule(id);
    onCloseMobile();
  };

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden
        />
      )}

      <aside
        className={`
          fixed lg:sticky lg:top-0 lg:h-screen inset-y-0 left-0 z-50 w-64 shrink-0 flex flex-col
          transform transition-transform duration-200 ease-out
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={{
          backgroundColor: 'var(--app-sidebar)',
          borderRight: '1px solid var(--app-card-border)'
        }}
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark"><img src="/assets/zyntheor-icon.svg" alt="ZYNTHEOR" /></div>
          <div><strong>ZYNTHEOR</strong><small>VIVID INTELLIGENCE</small></div>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {groups.map((group) => (
            <div key={group.groupKey}>
              <div
                className="px-3 mb-1.5 text-xs font-semibold"
                style={{ color: 'var(--app-text-secondary)' }}
              >
                {t(group.groupKey)}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item.id)}
                    className="w-full flex items-center justify-between pl-3 pr-2 py-2 rounded-[10px] text-[13px] font-medium transition-colors duration-150 text-left cursor-pointer"
                    style={{
                      backgroundColor: isActive ? 'color-mix(in srgb, var(--app-accent) 14%, transparent)' : 'transparent',
                      boxShadow: isActive ? 'inset 3px 0 0 var(--app-accent)' : 'none',
                      color: isActive ? 'var(--app-text-primary)' : 'var(--app-text-secondary)',
                      fontWeight: isActive ? 600 : 500
                    }}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon
                        className="w-4 h-4 shrink-0 transition-colors"
                        style={{
                          color: isActive ? 'var(--app-accent)' : 'var(--app-text-secondary)'
                        }}
                      />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </div>
                    
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div
          className="p-4"
          style={{
            borderTop: '1px solid var(--app-card-border)',
            backgroundColor: 'var(--app-card)'
          }}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold" style={{ color: 'var(--app-text-primary)' }}>
              {t('role.current')}: {t(`role.${role}`, role)}
            </span>
            <span className="text-[11px] font-mono font-bold" style={{ color: 'var(--app-accent)' }}>
              {t('brand.native_intelligence')}
            </span>
          </div>
          <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--app-text-secondary)' }}>
            {t('footer.sovereign_desc')}
          </div>
        </div>
      </aside>
    </>
  );
};
