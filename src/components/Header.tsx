import React from 'react';
import { ModuleId, SystemStatusData, ConnectivityHealthState } from '../types';
import { Menu, Terminal, RefreshCw, Keyboard } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { StatusDot } from './ui/StatusBadge';

interface HeaderProps {
  activeModule: ModuleId;
  statusData: SystemStatusData | null;
  connectivity?: ConnectivityHealthState | null;
  onToggleMobile: () => void;
  onOpenQuickTask: () => void;
  onRefreshStatus: () => void;
  isRefreshing: boolean;
  onOpenShortcuts?: () => void;
  onRegenerateModel?: () => void;
  isRegenerating?: boolean;
  regenerationError?: string | null;
}

export const Header: React.FC<HeaderProps> = ({
  activeModule,
  statusData,
  connectivity = null,
  onToggleMobile,
  onOpenQuickTask,
  onRefreshStatus,
  isRefreshing,
  onOpenShortcuts,
}) => {
  const { t, lang } = useLanguage();

  const getModuleTitle = (mod: ModuleId): string => {
    switch (mod) {
      case 'command_center': return t('nav.command_center');
      case 'autonomous_execution': return t('nav.autonomous_execution');
      case 'cognitive_operations': return t('nav.cognitive_operations');
      case 'conversational_intelligence': return t('nav.conversational_intelligence');
      case 'intelligence_core': return t('nav.intelligence_core');
      case 'dev_studio': return t('nav.dev_studio');
      case 'research_lab': return t('nav.research_lab');
      case 'automation_center': return t('nav.automation_center');
      case 'knowledge_hub': return t('nav.knowledge_hub');
      case 'model_laboratory': return t('nav.model_laboratory');
      case 'experiment_center': return t('nav.experiment_center');
      case 'api_platform': return t('nav.api_platform');
      case 'marketplace': return t('nav.marketplace');
      case 'subscription_billing': return t('nav.subscription_billing');
      case 'analytics_bi': return t('nav.analytics_bi');
      case 'governance_security': return t('nav.governance_security');
      case 'user_settings': return t('nav.user_settings');
      case 'admin_console': return t('nav.admin_console');
      default: return 'ZYNTHEOR';
    }
  };

  const activeKey = statusData?.model?.activeKey;
  const runtimeState =
    connectivity?.runtimeState ||
    statusData?.model?.runtimeState ||
    (statusData?.model?.weightsLoaded ? 'READY' : undefined);
  const executionVerified =
    connectivity?.executionVerified ??
    statusData?.model?.executionVerified ??
    false;
  const isFailClosed = Boolean(
    (connectivity && (!connectivity.online || connectivity.onlineConnectivityRequired || !executionVerified)) ||
      (statusData &&
        statusData.model &&
        (statusData.model.weightsLoaded === false ||
          statusData.model.onlineConnectivityRequired === true ||
          statusData.model.executionVerified === false))
  );
  const headerStatus = !statusData && !connectivity
    ? 'CHECKING'
    : !isFailClosed && executionVerified && runtimeState === 'READY'
    ? 'READY'
    : runtimeState || 'FAIL_CLOSED';
  const modelTitle = isFailClosed
    ? connectivity?.reason || statusData?.model?.failClosedReason || statusData?.model?.executionError || 'FAIL_CLOSED: Online Connectivity Required'
    : statusData?.model?.weightsSource || activeKey || 'Cloud Runtime';

  return (
    <div className="sticky top-0 z-30">
      <header className="workspace-header h-16 px-4 md:px-7 flex items-center justify-between gap-3 transition-colors duration-200">
        {/* Left: Mobile Toggle & Breadcrumbs */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onToggleMobile}
            className="lg:hidden min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-[var(--app-text-secondary)] hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            aria-label="Toggle menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="workspace-breadcrumb hidden sm:inline shrink-0">{t('nav.ecosystem')}</span>
            <span className="workspace-breadcrumb-divider hidden sm:inline shrink-0">/</span>
            <h1 className="font-semibold text-[var(--app-text-primary)] text-base md:text-[17px] tracking-tight truncate">
              {getModuleTitle(activeModule)}
            </h1>
          </div>
        </div>

        {/* Right: Actions, Language Toggle, Minimal Runtime Dot & Quick Task CTA */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {/* Dedicated Language Switcher Component */}
          <LanguageSwitcher variant="compact" />

          <div className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-full workspace-runtime">
            <StatusDot
              status={headerStatus as any}
              label={headerStatus === 'READY' ? 'Runtime ready' : headerStatus.replaceAll('_', ' ').toLowerCase()}
              detail={modelTitle}
              pulse={headerStatus === 'CHECKING' || headerStatus === 'INITIALIZING'}
            />
          </div>

          {onOpenShortcuts && (
            <button
              type="button"
              onClick={onOpenShortcuts}
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
              className="workspace-icon-button hidden sm:flex"
            >
              <Keyboard className="w-4 h-4" />
            </button>
          )}

          {/* Manual Refresh */}
          <button
            onClick={onRefreshStatus}
            disabled={isRefreshing}
            title={t('btn.refresh')}
            aria-label={t('btn.refresh')}
            className="workspace-icon-button min-w-[40px] min-h-[40px]"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} style={isRefreshing ? { color: 'var(--app-accent)' } : undefined} />
          </button>

          {/* Primary Action Button with Shortcut Badge */}
          <button
            onClick={onOpenQuickTask}
            title={lang === 'th' ? 'สั่งการประมวลผลด่วน (Ctrl+K)' : 'Quick Dispatch Native Intelligence (Ctrl+K)'}
            className="flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-[0_6px_20px_rgba(0,240,255,0.22)] hover:brightness-110 transition-all whitespace-nowrap cursor-pointer border border-[#00F0FF]/35"
          >
            <Terminal className="w-4 h-4 text-[#CCFF00]" />
            <span className="hidden sm:inline">{t('btn.run_agent')}</span>
            <span className="sm:hidden">{t('btn.run')}</span>
          </button>
        </div>
      </header>
    </div>
  );
};
