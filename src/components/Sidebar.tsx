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
  id: string;
  labelTh: string;
  labelEn: string;
  items: NavItem[];
}

const ROLE_RANK: Record<AuthRole, number> = {
  User: 0,
  Developer: 1,
  Administrator: 2,
};

function roleAllows(userRole: AuthRole, minRole?: AuthRole): boolean {
  if (!minRole) return true;
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}

const HOME_ITEM: NavItem = {
  id: 'command_center',
  labelKey: 'nav.command_center',
  shortTh: 'ศูนย์บัญชาการ',
  shortEn: 'Command Center',
  icon: LayoutDashboard,
};

// Every existing module remains reachable; groups describe the work, not implementation details.
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'intelligence',
    labelTh: 'ปัญญาประดิษฐ์',
    labelEn: 'Intelligence',
    items: [
      { id: 'conversational_intelligence', labelKey: 'nav.conversational_intelligence', shortTh: 'พื้นที่สนทนา', shortEn: 'Intelligence Workspace', icon: Sparkles },
      { id: 'intelligence_core', labelKey: 'nav.intelligence_core', icon: Cpu },
      { id: 'proof_of_intelligence', labelKey: 'nav.proof_of_intelligence', icon: Award },
    ],
  },
  {
    id: 'research',
    labelTh: 'วิจัยและทดลอง',
    labelEn: 'Research Lab',
    items: [
      { id: 'research_lab', labelKey: 'nav.research_lab', icon: FlaskConical },
      { id: 'experiment_center', labelKey: 'nav.experiment_center', icon: Microscope, minRole: 'Developer' },
      { id: 'analytics_bi', labelKey: 'nav.analytics_bi', icon: BarChart3 },
    ],
  },
  {
    id: 'engineering',
    labelTh: 'พัฒนาและปฏิบัติการ',
    labelEn: 'Build & Execute',
    items: [
      { id: 'dev_studio', labelKey: 'nav.dev_studio', icon: Code2, minRole: 'Developer' },
      { id: 'automation_center', labelKey: 'nav.automation_center', icon: Zap },
      { id: 'api_platform', labelKey: 'nav.api_platform', icon: Terminal, minRole: 'Developer' },
    ],
  },
  {
    id: 'knowledge',
    labelTh: 'คลังความรู้',
    labelEn: 'Knowledge',
    items: [
      { id: 'knowledge_hub', labelKey: 'nav.knowledge_hub', icon: BookOpen },
    ],
  },
  {
    id: 'training',
    labelTh: 'โมเดลและการฝึก',
    labelEn: 'Model & Training',
    items: [
      { id: 'model_laboratory', labelKey: 'nav.model_laboratory', icon: Binary, minRole: 'Developer' },
    ],
  },
  {
    id: 'system',
    labelTh: 'ควบคุมระบบ',
    labelEn: 'System Control',
    items: [
      { id: 'infrastructure_cloud', labelKey: 'nav.infrastructure_cloud', icon: Server },
      { id: 'governance_security', labelKey: 'nav.governance_security', icon: ShieldCheck, minRole: 'Developer' },
      { id: 'admin_console', labelKey: 'nav.admin_console', icon: Sliders, minRole: 'Administrator' },
      { id: 'user_settings', labelKey: 'nav.user_settings', icon: Settings },
    ],
  },
  {
    id: 'workspace',
    labelTh: 'บริการและบัญชี',
    labelEn: 'Services & Account',
    items: [
      { id: 'marketplace', labelKey: 'nav.marketplace', icon: ShoppingBag },
      { id: 'subscription_billing', labelKey: 'nav.subscription_billing', icon: CreditCard },
    ],
  },
];

const GROUP_FOR_MODULE = new Map<ModuleId, string>(
  NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.id, group.id] as const)),
);

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onSelectModule,
  isMobileOpen,
  onCloseMobile,
}) => {
  const { t, lang } = useLanguage();
  const { role } = useAuth();
  const activeGroup = GROUP_FOR_MODULE.get(activeModule);
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(activeGroup ? [activeGroup] : ['intelligence']),
  );

  useEffect(() => {
    if (activeGroup) {
      setOpenGroups((current) => new Set(current).add(activeGroup));
    }
  }, [activeGroup]);

  const visibleGroups = useMemo(
    () => NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => roleAllows(role, item.minRole)),
    })).filter((group) => group.items.length > 0),
    [role],
  );

  const handleItemClick = (id: ModuleId) => {
    onSelectModule(id);
    onCloseMobile();
  };

  const renderItem = (item: NavItem, compact = false) => {
    const Icon = item.icon;
    const isActive = activeModule === item.id;
    const label = lang === 'th'
      ? (item.shortTh || t(item.labelKey))
      : (item.shortEn || t(item.labelKey));

    return (
      <button
        key={item.id}
        type="button"
        data-testid={`sidebar-nav-${item.id}`}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => handleItemClick(item.id)}
        className={`w-full flex items-center gap-2.5 rounded-xl text-left transition-colors duration-150 cursor-pointer ${compact ? 'px-3 py-2 text-[12px]' : 'px-3 py-2.5 text-[13px]'}`}
        style={{
          backgroundColor: isActive ? 'color-mix(in srgb, var(--app-accent) 13%, transparent)' : 'transparent',
          boxShadow: isActive ? 'inset 2px 0 0 var(--app-accent)' : 'none',
          color: isActive ? 'var(--app-text-primary)' : 'var(--app-text-secondary)',
          fontWeight: isActive ? 650 : 500,
        }}
      >
        <Icon className="w-4 h-4 shrink-0" style={{ color: isActive ? 'var(--app-accent)' : 'var(--app-text-secondary)' }} />
        <span className="truncate">{label}</span>
        {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full shrink-0" style={{ background: 'var(--app-accent)', boxShadow: '0 0 10px var(--app-accent-glow)' }} />}
      </button>
    );
  };

  return (
    <>
      {isMobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[55] bg-black/55 lg:hidden"
          onClick={onCloseMobile}
          aria-label={lang === 'th' ? 'ปิดเมนู' : 'Close navigation'}
        />
      )}

      <aside
        id="zyntheor-primary-navigation"
        className={`fixed inset-y-0 left-0 lg:static lg:shrink-0 z-[60] lg:z-40 w-[min(19rem,88vw)] lg:w-64 flex flex-col transform transition-transform duration-200 ease-out ${isMobileOpen ? 'translate-x-0 pointer-events-auto visible' : '-translate-x-full pointer-events-none invisible lg:translate-x-0 lg:pointer-events-auto lg:visible'}`}
        style={{ backgroundColor: 'var(--app-sidebar)', borderRight: '1px solid var(--app-card-border)' }}
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark"><img src="/assets/zyntheor-icon.svg" alt="" aria-hidden="true" className="pointer-events-none select-none" /></div>
          <div><strong>ZYNTHEOR</strong><small>VIVID INTELLIGENCE</small></div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-3">
          <section aria-label={lang === 'th' ? 'หน้าหลัก' : 'Home'}>
            <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[.16em]" style={{ color: 'var(--app-text-secondary)' }}>
              {lang === 'th' ? 'พื้นที่ทำงาน' : 'WORKSPACE'}
            </div>
            {renderItem(HOME_ITEM)}
          </section>

          <div className="h-px mx-2" style={{ background: 'var(--app-card-border)' }} />

          <nav aria-label={lang === 'th' ? 'เมนูระบบ' : 'System navigation'} className="space-y-1">
            {visibleGroups.map((group) => {
              const isOpen = openGroups.has(group.id);
              const containsActive = group.items.some((item) => item.id === activeModule);
              return (
                <section key={group.id} data-testid={`sidebar-group-${group.id}`} className="rounded-xl">
                  <button
                    type="button"
                    data-testid={`sidebar-group-toggle-${group.id}`}
                    aria-expanded={isOpen}
                    onClick={() => setOpenGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-left text-[12px] font-semibold transition-colors cursor-pointer"
                    style={{ color: containsActive ? 'var(--app-text-primary)' : 'var(--app-text-secondary)', background: containsActive ? 'color-mix(in srgb, var(--app-accent) 5%, transparent)' : 'transparent' }}
                  >
                    <span>{lang === 'th' ? group.labelTh : group.labelEn}</span>
                    <span className="flex items-center gap-2">
                      {containsActive && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--app-accent)' }} />}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {isOpen && <div className="mt-0.5 ml-2 pl-2 space-y-0.5" style={{ borderLeft: '1px solid var(--app-card-border)' }}>
                    {group.items.map((item) => renderItem(item, true))}
                  </div>}
                </section>
              );
            })}
          </nav>
        </div>

        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--app-card-border)', backgroundColor: 'var(--app-card)' }}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold" style={{ color: 'var(--app-text-primary)' }}>
              {lang === 'th' ? `บทบาท: ${role}` : `Role: ${role}`}
            </span>
            <span className="text-[10px] font-mono font-bold tracking-wider" style={{ color: 'var(--app-accent)' }}>SYSTEM WORKSPACE</span>
          </div>
          <div className="text-[10px] mt-1 truncate" style={{ color: 'var(--app-text-secondary)' }}>
            {lang === 'th' ? 'การควบคุมและสิทธิ์ตามบทบาท' : 'Role-based access and system navigation'}
          </div>
        </div>
      </aside>
    </>
  );
};
