import React from 'react';
import { ModuleId, SystemStatusData } from '../types';
import { Menu, Play, RefreshCw, Search, User } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';

interface HeaderProps {
  activeModule: ModuleId;
  statusData: SystemStatusData | null;
  onToggleMobile: () => void;
  onOpenQuickTask: () => void;
  onRefreshStatus: () => void;
  isRefreshing: boolean;
  onOpenShortcuts?: () => void;
  onOpenSettings?: () => void;
  onOpenCloudSettings?: () => void;
  onOpenSignIn?: () => void;
  onOpenSearch?: () => void;
  onOpenAssistant?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeModule,
  statusData,
  onToggleMobile,
  onOpenQuickTask,
  onRefreshStatus,
  isRefreshing,
  onOpenSettings,
  onOpenCloudSettings,
  onOpenSignIn,
  onOpenSearch,
}) => {
  const { t, lang } = useLanguage();
  const { session, role, isAuthenticated, sessionExpired } = useAuth();
  const authMs = session.authenticatedAt ? new Date(session.authenticatedAt).getTime() : NaN;
  const hasValidSessionTime = isAuthenticated && Number.isFinite(authMs);
  const sessionAgeMin = hasValidSessionTime ? Math.max(0, Math.floor((Date.now() - authMs) / 60000)) : 0;
  const remainingMin = hasValidSessionTime ? Math.max(0, 60 - sessionAgeMin) : 0;

  const getModuleTitle = (mod: ModuleId): string => {
    switch (mod) {
      case 'command_center': return t('nav.command_center');
      case 'conversational_intelligence': return t('nav.conversational_intelligence');
      case 'intelligence_core': return t('nav.intelligence_core');
      case 'proof_of_intelligence': return t('nav.proof_of_intelligence');
      case 'dev_studio': return t('nav.dev_studio');
      case 'research_lab': return t('nav.research_lab');
      case 'automation_center': return t('nav.automation_center');
      case 'knowledge_hub': return t('nav.knowledge_hub');
      case 'model_laboratory': return t('nav.model_laboratory');
      case 'experiment_center': return t('nav.experiment_center');
      case 'infrastructure_cloud': return t('nav.infrastructure_cloud');
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

  const isNativeRuntimeReady = Boolean(statusData?.model?.weightsLoaded && statusData?.model?.inferenceReady);
  const runtimeShortLabel = statusData === null
    ? (lang === 'th' ? 'กำลังตรวจสถานะ' : 'Checking')
    : isNativeRuntimeReady
      ? (lang === 'th' ? 'ระบบพร้อมใช้งาน' : 'Runtime Ready')
      : (lang === 'th' ? 'ยังไม่โหลดโมเดล' : 'Runtime Not Ready');
  const runtimeAriaLabel = statusData === null
    ? (lang === 'th' ? 'Native Runtime: กำลังรอข้อมูลสถานะ' : 'Native Runtime: Awaiting status data')
    : isNativeRuntimeReady
      ? (lang === 'th' ? 'Native Runtime: โหลดโมเดลและ Inference พร้อมแล้ว' : 'Native Runtime: Model loaded and inference ready')
      : (lang === 'th' ? 'Native Runtime: ยังไม่พร้อมใช้งาน Inference' : 'Native Runtime: Inference is not ready');

  return (
    <header className="bg-[var(--app-surface)] border-b border-[var(--app-card-border)] sticky top-0 z-50 transition-colors duration-200">
      <div className="h-14 px-3 sm:px-5 md:px-8 flex items-center justify-between gap-2">
        {/* Left: Mobile Toggle & Single Clean Page Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggleMobile}
            className="lg:hidden relative z-50 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-elevated)] transition-colors shrink-0 cursor-pointer"
            aria-label="Toggle menu"
          >
            <Menu className="w-5 h-5 pointer-events-none" />
          </button>

          <h1 className="font-semibold text-[var(--app-text-primary)] text-sm sm:text-base tracking-tight truncate">
            {getModuleTitle(activeModule)}
          </h1>
        </div>

        {/* Right: Concise Truthful Status & Essential Controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div
            role="status"
            data-testid="header-cloud-status"
            aria-label={runtimeAriaLabel}
            className="flex items-center gap-1.5 sm:gap-2 px-1 sm:px-2 py-1 text-[11px] text-[var(--app-text-secondary)]"
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: statusData === null ? 'var(--app-text-secondary)' : isNativeRuntimeReady ? 'var(--status-verified)' : 'var(--status-warning)' }}
              aria-hidden="true"
            />
            <span className="hidden md:inline whitespace-nowrap">{runtimeShortLabel}</span>
            {!isNativeRuntimeReady && (
              <button
                type="button"
                data-testid="header-configure-connection-btn"
                onClick={onOpenCloudSettings || onOpenSettings}
                className="hidden xl:inline text-[11px] font-medium text-[var(--app-accent)] hover:underline cursor-pointer whitespace-nowrap"
              >
                {lang === 'th' ? 'ตั้งค่า' : 'Setup'}
              </button>
            )}
          </div>

          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              title={lang === 'th' ? 'ค้นหา (Ctrl+F)' : 'Search (Ctrl+F)'}
              aria-label={lang === 'th' ? 'ค้นหา' : 'Search'}
              className="min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center gap-1.5 px-2 sm:px-2.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-card)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] transition-colors cursor-pointer shrink-0"
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xl:inline text-[11px]">{t('btn.search')}</span>
            </button>
          )}

          <LanguageSwitcher variant="compact" />

          <button
            type="button"
            data-testid="header-auth-btn"
            onClick={hasValidSessionTime ? onOpenSettings : (onOpenSignIn || onOpenSettings)}
            className={`min-h-[40px] min-w-[40px] sm:min-h-[36px] flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              sessionExpired
                ? 'border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] text-[var(--z-danger)] bg-[var(--app-card)]'
                : 'border-[var(--app-card-border)] bg-[var(--app-card)] text-[var(--app-text-primary)] hover:border-[var(--app-accent)]'
            }`}
            title={
              hasValidSessionTime
                ? `${role} · ${remainingMin}m`
                : sessionExpired
                  ? (lang === 'th' ? 'เซสชันหมดอายุ · เข้าสู่ระบบใหม่' : 'Session expired · Sign in')
                  : (lang === 'th' ? 'เข้าสู่ระบบ' : 'Sign in')
            }
          >
            <User className="w-3.5 h-3.5 text-[var(--app-text-secondary)] shrink-0" />
            <span className="hidden sm:inline">
              {hasValidSessionTime
                ? `${role === 'Administrator' ? 'Admin' : role === 'Developer' ? 'Dev' : (lang === 'th' ? 'ผู้ใช้' : 'User')} · ${remainingMin}${lang === 'th' ? 'น.' : 'm'}`
                : sessionExpired
                  ? (lang === 'th' ? 'หมดอายุ' : 'Expired')
                  : (lang === 'th' ? 'เข้าสู่ระบบ' : 'Sign in')}
            </span>
          </button>

          <button
            type="button"
            onClick={onRefreshStatus}
            disabled={isRefreshing}
            title={t('btn.refresh')}
            aria-label={t('btn.refresh')}
            className="hidden sm:flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-[var(--app-card-border)] bg-[var(--app-card)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[var(--app-accent)]' : ''}`} />
          </button>

          <button
            type="button"
            onClick={onOpenQuickTask}
            title={lang === 'th' ? 'สั่งงานด่วน (Ctrl+K)' : 'Quick Run (Ctrl+K)'}
            className="min-h-[40px] sm:min-h-[36px] flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-[var(--app-accent-deep)] hover:brightness-110 rounded-lg transition-all whitespace-nowrap cursor-pointer shrink-0"
          >
            <Play className="w-3 h-3 shrink-0" />
            <span>{t('btn.run')}</span>
            <kbd className="hidden md:inline-flex items-center px-1 py-0.2 text-[9px] font-mono bg-black/25 rounded text-white/80">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>
    </header>
  );
};
