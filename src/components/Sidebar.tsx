import React, { useMemo, useState, useEffect } from 'react';
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
  Sparkles,
  Award,
  Server,
  ChevronDown,
  MoreHorizontal
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
  shortTh?: string;
  shortEn?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
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

const PRIMARY_ITEMS: NavItem[] = [
  { id: 'command_center', labelKey: 'nav.command_center', shortTh: 'ศูนย์บัญชาการ', shortEn: 'Command Center', icon: LayoutDashboard },
  { id: 'conversational_intelligence', labelKey: 'nav.conversational_intelligence', shortTh: 'แชท', shortEn: 'Chat', icon: Sparkles },
  { id: 'research_lab', labelKey: 'nav.research_lab', shortTh: 'ห้องแล็บ', shortEn: 'Research Lab', icon: FlaskConical },
  { id: 'proof_of_intelligence', labelKey: 'nav.proof_of_intelligence', shortTh: 'หลักฐาน', shortEn: 'Evidence', icon: Award },
];

const PRIMARY_IDS = new Set<ModuleId>(PRIMARY_ITEMS.map((item) => item.id));

const MORE_GROUPS: NavGroup[] = [
  {
    groupKey: 'group.operations',
    items: [
      { id: 'intelligence_core', labelKey: 'nav.intelligence_core', icon: Cpu },
      { id: 'model_laboratory', labelKey: 'nav.model_laboratory', icon: Binary, minRole: 'Developer' },
      { id: 'experiment_center', labelKey: 'nav.experiment_center', icon: Microscope, minRole: 'Developer' },
    ]
  },
  {
    groupKey: 'group.engineering',
    items: [
      { id: 'dev_studio', labelKey: 'nav.dev_studio', icon: Code2, minRole: 'Developer' },
      { id: 'automation_center', labelKey: 'nav.automation_center', icon: Zap },
      { id: 'api_platform', labelKey: 'nav.api_platform', icon: Terminal, minRole: 'Developer' },
      { id: 'knowledge_hub', labelKey: 'nav.knowledge_hub', icon: BookOpen },
    ]
  },
  {
    groupKey: 'group.business',
    items: [
      { id: 'analytics_bi', labelKey: 'nav.analytics_bi', icon: BarChart3 },
      { id: 'marketplace', labelKey: 'nav.marketplace', icon: ShoppingBag },
      { id: 'subscription_billing', labelKey: 'nav.subscription_billing', icon: CreditCard },
    ]
  },
  {
    groupKey: 'group.trust',
    items: [
      { id: 'infrastructure_cloud', labelKey: 'nav.infrastructure_cloud', icon: Server },
      { id: 'governance_security', labelKey: 'nav.governance_security', icon: ShieldCheck, minRole: 'Developer' },
      { id: 'admin_console', labelKey: 'nav.admin_console', icon: Sliders, minRole: 'Administrator' },
      { id: 'user_settings', labelKey: 'nav.user_settings', icon: Settings },
    ]
  }
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onSelectModule,
  isMobileOpen,
  onCloseMobile
}) => {
  const { t, lang } = useLanguage();
  const { role } = useAuth();
  const [isMoreOpen, setIsMoreOpen] = useState<boolean>(() => !PRIMARY_IDS.has(activeModule));

  useEffect(() => {
    if (!PRIMARY_IDS.has(activeModule)) {
      setIsMoreOpen(true);
    }
  }, [activeModule]);

  // Physically remove items the current role cannot access (no client-side discovery).
  const moreGroups = useMemo(() => {
    return MORE_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((item) => roleAllows(role, item.minRole))
    })).filter((g) => g.items.length > 0);
  }, [role]);

  const moreCount = useMemo(
    () => moreGroups.reduce((acc, group) => acc + group.items.length, 0),
    [moreGroups]
  );

  const handleItemClick = (id: ModuleId) => {
    onSelectModule(id);
    onCloseMobile();
  };

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[55] bg-black/50 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 lg:static lg:shrink-0 z-[60] lg:z-40 w-64 flex flex-col
          transform transition-transform duration-200 ease-out
          ${isMobileOpen ? 'translate-x-0 pointer-events-auto visible' : '-translate-x-full pointer-events-none invisible lg:translate-x-0 lg:pointer-events-auto lg:visible'}
        `}
        style={{
          backgroundColor: 'var(--app-sidebar)',
          borderRight: '1px solid var(--app-card-border)'
        }}
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark"><img src="/assets/zyntheor-icon.svg" alt="" aria-hidden="true" className="pointer-events-none select-none" /></div>
          <div><strong>ZYNTHEOR</strong><small>VIVID INTELLIGENCE</small></div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {/* General Section: High-Frequency Core Workspaces */}
          <section data-testid="sidebar-section-general" aria-label={lang === 'th' ? 'ทั่วไป' : 'General'}>
            <div
              className="px-3 mb-1.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--app-text-secondary)' }}
            >
              {lang === 'th' ? 'ทั่วไป' : 'General'}
            </div>
            <nav aria-label={lang === 'th' ? 'เมนูหลักทั่วไป' : 'General navigation'} className="space-y-1">
              {PRIMARY_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                const label = lang === 'th' ? (item.shortTh || t(item.labelKey)) : (item.shortEn || t(item.labelKey));
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`sidebar-nav-${item.id}`}
                    onClick={() => handleItemClick(item.id)}
                    className="w-full flex items-center gap-2.5 pl-3 pr-2 py-2.5 rounded-[10px] text-[13px] transition-colors duration-150 text-left cursor-pointer"
                    style={{
                      backgroundColor: isActive ? 'color-mix(in srgb, var(--app-accent) 14%, transparent)' : 'transparent',
                      boxShadow: isActive ? 'inset 3px 0 0 var(--app-accent)' : 'none',
                      color: isActive ? 'var(--app-text-primary)' : 'var(--app-text-secondary)',
                      fontWeight: isActive ? 600 : 500
                    }}
                  >
                    <Icon
                      className="w-4 h-4 shrink-0 transition-colors"
                      style={{ color: isActive ? 'var(--app-accent)' : 'var(--app-text-secondary)' }}
                    />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </nav>
          </section>

          {/* Advanced Section: Low-Frequency Modules collapsed under a single More entry */}
          <section
            data-testid="sidebar-section-advanced"
            aria-label={lang === 'th' ? 'ขั้นสูง' : 'Advanced'}
            className="pt-3 border-t border-[var(--app-card-border)]"
          >
            <div
              className="px-3 mb-1.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--app-text-secondary)' }}
            >
              {lang === 'th' ? 'ขั้นสูง' : 'Advanced'}
            </div>

            <button
              type="button"
              data-testid="sidebar-nav-more-toggle"
              aria-expanded={isMoreOpen}
              onClick={() => setIsMoreOpen((prev) => !prev)}
              className="w-full flex items-center justify-between pl-3 pr-2 py-2.5 rounded-[10px] text-[13px] font-medium transition-colors duration-150 text-left cursor-pointer"
              style={{
                backgroundColor:
                  !PRIMARY_IDS.has(activeModule) && !isMoreOpen
                    ? 'color-mix(in srgb, var(--app-accent) 12%, transparent)'
                    : 'transparent',
                color: isMoreOpen || !PRIMARY_IDS.has(activeModule) ? 'var(--app-text-primary)' : 'var(--app-text-secondary)',
              }}
            >
              <div className="flex items-center gap-2.5 truncate">
                <MoreHorizontal className="w-4 h-4 shrink-0 text-[var(--app-text-secondary)]" />
                <span className="truncate">{lang === 'th' ? 'เพิ่มเติม' : 'More'}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono tabular-nums text-[var(--app-text-secondary)]">
                  {moreCount}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-150 ${isMoreOpen ? 'rotate-180' : ''}`}
                />
              </div>
            </button>

            {isMoreOpen && (
              <div
                data-testid="sidebar-more-panel"
                className="mt-2 pt-2 space-y-4 border-t border-[var(--app-card-border)]"
              >
                {moreGroups.map((group) => (
                  <div key={group.groupKey}>
                    <div
                      className="px-3 mb-1 text-[11px] font-semibold"
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
                          type="button"
                          data-testid={`sidebar-nav-${item.id}`}
                          onClick={() => handleItemClick(item.id)}
                          className="w-full flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-[10px] text-[12.5px] transition-colors duration-150 text-left cursor-pointer"
                          style={{
                            backgroundColor: isActive ? 'color-mix(in srgb, var(--app-accent) 14%, transparent)' : 'transparent',
                            boxShadow: isActive ? 'inset 3px 0 0 var(--app-accent)' : 'none',
                            color: isActive ? 'var(--app-text-primary)' : 'var(--app-text-secondary)',
                            fontWeight: isActive ? 600 : 500
                          }}
                        >
                          <Icon
                            className="w-3.5 h-3.5 shrink-0 transition-colors"
                            style={{
                              color: isActive ? 'var(--app-accent)' : 'var(--app-text-secondary)'
                            }}
                          />
                          <span className="truncate">{t(item.labelKey)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>
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
              {lang === 'th' ? `บทบาท: ${role}` : `Role: ${role}`}
            </span>
            <span className="text-[11px] font-mono font-bold" style={{ color: 'var(--status-verified)' }}>
              SOVEREIGN
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
