import React, { useMemo } from 'react';
import { ModuleId } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useAuth, AuthRole } from '../context/AuthContext';
import {
  LayoutDashboard,
  Workflow,
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
  LogOut,
  Brain
} from 'lucide-react';
import { NavGroupLabel, NavItemButton } from './ui/NavigationPrimitives';
import { StatusDot } from './ui/StatusBadge';

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
  const { role, session, logout } = useAuth();

  const allGroups: NavGroup[] = [
    {
      groupKey: 'group.operations',
      items: [
        { id: 'command_center', labelKey: 'nav.command_center', icon: LayoutDashboard, accentColor: '#00F0FF' },
        { id: 'autonomous_execution', labelKey: 'nav.autonomous_execution', icon: Workflow, accentColor: '#CCFF00' },
        { id: 'cognitive_operations', labelKey: 'nav.cognitive_operations', icon: Brain, accentColor: '#00F0FF' },
        { id: 'dev_studio', labelKey: 'nav.dev_studio', icon: Code2, accentColor: '#2563EB', minRole: 'Developer' },
        { id: 'automation_center', labelKey: 'nav.automation_center', icon: Zap, accentColor: '#FF5E3A' },
        { id: 'intelligence_core', labelKey: 'nav.intelligence_core', icon: Cpu, accentColor: '#7B2CBF' }
      ]
    },
    {
      groupKey: 'group.engineering',
      items: [
        { id: 'model_laboratory', labelKey: 'nav.model_laboratory', icon: Binary, accentColor: '#00F0FF', minRole: 'Developer' },
        { id: 'api_platform', labelKey: 'nav.api_platform', icon: Terminal, accentColor: '#2563EB', minRole: 'Developer' }
      ]
    },
    {
      groupKey: 'group.reasoning',
      items: [
        { id: 'research_lab', labelKey: 'nav.research_lab', icon: FlaskConical, accentColor: '#FF007F' },
        { id: 'knowledge_hub', labelKey: 'nav.knowledge_hub', icon: BookOpen, accentColor: '#00F0FF' },
        { id: 'experiment_center', labelKey: 'nav.experiment_center', icon: Microscope, accentColor: '#FF5E3A', minRole: 'Developer' },
        { id: 'conversational_intelligence', labelKey: 'nav.conversational_intelligence', icon: Sparkles, accentColor: '#9AA8C7' }
      ]
    },
    {
      groupKey: 'group.business',
      items: [
        { id: 'marketplace', labelKey: 'nav.marketplace', icon: ShoppingBag, accentColor: '#00F0FF' },
        { id: 'subscription_billing', labelKey: 'nav.subscription_billing', icon: CreditCard, accentColor: '#FF007F' },
        { id: 'analytics_bi', labelKey: 'nav.analytics_bi', icon: BarChart3, accentColor: '#7B2CBF' }
      ]
    },
    {
      groupKey: 'group.trust',
      items: [
        { id: 'governance_security', labelKey: 'nav.governance_security', icon: ShieldCheck, accentColor: '#CCFF00', minRole: 'Developer' },
        { id: 'admin_console', labelKey: 'nav.admin_console', icon: Sliders, accentColor: '#FF007F', minRole: 'Administrator' },
        { id: 'user_settings', labelKey: 'nav.user_settings', icon: Settings, accentColor: '#9AA8C7' }
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
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden"
          onClick={onCloseMobile}
          aria-hidden
        />
      )}

      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50 w-64 shrink-0 flex flex-col
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
          <div>
            <strong>ZYNTHEOR</strong>
            <small>NATIVE INTELLIGENCE</small>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {groups.map((group) => (
            <div key={group.groupKey} className="space-y-1">
              <NavGroupLabel>{t(group.groupKey)}</NavGroupLabel>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavItemButton
                    key={item.id}
                    label={t(item.labelKey)}
                    icon={<Icon className="w-4 h-4" />}
                    active={activeModule === item.id}
                    accentColor={item.accentColor}
                    onClick={() => handleItemClick(item.id)}
                  />
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
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold truncate" style={{ color: 'var(--app-text-primary)' }}>
                <span>Role: {role}</span>
                {session.authMode === 'development' && (
                  <StatusDot status="PARTIAL" label="Dev" detail="Development authentication mode" />
                )}
              </div>
              {session.email && (
                <div className="text-[10px] truncate" style={{ color: 'var(--app-text-secondary)' }}>
                  {session.email}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-rose-300 hover:border-rose-500/40 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
          <div className="text-[10px] mt-1.5 truncate" style={{ color: 'var(--app-text-secondary)' }}>
            {t('footer.sovereign_desc')}
          </div>
        </div>
      </aside>
    </>
  );
};
