import React from 'react';
import { ModuleId, SystemStatusData } from '../types';
import { Menu, Terminal, RefreshCw, Clock, Keyboard, Sparkles, Search } from 'lucide-react';
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
  onOpenShortcuts,
  onOpenSettings,
  onOpenCloudSettings,
  onOpenSignIn,
  onOpenSearch,
  onOpenAssistant,
}) => {
  const { t, lang } = useLanguage();
  const { session, role, isAuthenticated, sessionExpired } = useAuth();
  const authMs = session.authenticatedAt ? new Date(session.authenticatedAt).getTime() : NaN;
  const hasValidSessionTime = isAuthenticated && Number.isFinite(authMs);
  const sessionAgeMin = hasValidSessionTime ? Math.max(0, Math.floor((Date.now() - authMs) / 60000)) : 0;
  const remainingMin = hasValidSessionTime ? Math.max(0, 60 - sessionAgeMin) : 0;
  const sessionHealthColor = !hasValidSessionTime
    ? sessionExpired
      ? 'text-[var(--z-danger)]'
      : 'text-[var(--app-text-secondary)]'
    : remainingMin > 15
    ? 'text-[var(--z-ok)]'
    : remainingMin > 0
    ? 'text-[var(--app-amber)]'
    : 'text-[var(--z-danger)]';

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
  const runtimeStatusLabel = statusData === null
    ? (lang === 'th' ? 'Native Runtime: กำลังรอข้อมูลสถานะ' : 'Native Runtime: Awaiting status data')
    : isNativeRuntimeReady
      ? (lang === 'th' ? 'Native Runtime: โหลดโมเดลและ Inference พร้อมแล้ว' : 'Native Runtime: Model loaded and inference ready')
      : (lang === 'th' ? 'Native Runtime: ยังไม่พร้อมใช้งาน Inference' : 'Native Runtime: Inference is not ready');

  return (
    <header className="bg-[color-mix(in_srgb,var(--app-surface)_85%,transparent)] backdrop-blur-md border-b border-[var(--app-card-border)] sticky top-0 z-50 transition-colors duration-200">
      <div className="h-16 px-2.5 sm:px-4 md:px-8 flex items-center justify-between gap-1.5 sm:gap-3">
        {/* Left: Mobile Toggle & Breadcrumbs */}
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggleMobile}
            className="lg:hidden relative z-50 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-elevated)] transition-colors shrink-0 cursor-pointer [&_img]:pointer-events-none [&_svg]:pointer-events-none"
            aria-label="Toggle menu"
          >
            <Menu className="w-5 h-5 pointer-events-none" />
          </button>

          <div className="flex items-center gap-2 text-sm min-w-0 flex-1">
            <span className="font-semibold text-[var(--app-text-secondary)] hidden sm:inline shrink-0">{t('nav.ecosystem')}</span>
            <span className="text-[var(--app-text-secondary)] hidden sm:inline shrink-0">/</span>
            <h1 className="font-bold text-[var(--app-text-primary)] text-sm sm:text-base md:text-lg tracking-tight truncate">
              {getModuleTitle(activeModule)}
            </h1>
          </div>
        </div>

        {/* Right: Actions, Language Toggle, Sovereign Indicator & Quick Task CTA */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            title={lang === 'th' ? 'ค้นหาระบบ หลักฐาน และ Blocker (Ctrl+F)' : 'Global Search & Evidence Jump (Ctrl+F)'}
            aria-label={lang === 'th' ? 'ค้นหาระบบ' : 'Global Search'}
            className="min-h-[40px] min-w-[40px] sm:min-h-[34px] sm:min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-card)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Search className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
            <span className="hidden xl:inline text-[11px] font-mono">Search</span>
          </button>
        )}

        {/* Session Health & Role Indicator (routes Sign in directly to Account & preserves return-to-task) */}
        <button
          type="button"
          data-testid="header-auth-btn"
          onClick={hasValidSessionTime ? onOpenSettings : (onOpenSignIn || onOpenSettings)}
          className={`min-h-[40px] sm:min-h-[34px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors whitespace-nowrap shrink-0 tabular-nums ${
            sessionExpired
              ? 'border-[color-mix(in_srgb,var(--z-danger)_60%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,var(--app-surface))] text-[var(--z-danger)]'
              : hasValidSessionTime
                ? 'border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-primary)] hover:border-[var(--app-accent)]'
                : 'border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_14%,var(--app-surface))] text-[var(--app-accent)] hover:brightness-110'
          }`}
          title={
            hasValidSessionTime
              ? `Session (${role}): ${remainingMin}m remaining · Tap to manage account`
              : sessionExpired
              ? (lang === 'th' ? 'เซสชันหมดอายุ · กดเพื่อเข้าสู่ระบบใหม่' : 'Session expired · Tap to sign in again')
              : (lang === 'th' ? 'ยังไม่ได้เข้าสู่ระบบ · กดเพื่อเข้าสู่ระบบและเปลี่ยนบทบาท' : 'Not signed in · Tap to sign in')
          }
        >
          <Clock className={`w-3.5 h-3.5 shrink-0 ${hasValidSessionTime ? sessionHealthColor : sessionExpired ? 'text-[var(--z-danger)]' : 'text-[var(--app-accent)]'}`} />
          <span>
            {hasValidSessionTime
              ? `${role === 'Administrator' ? 'Admin' : role === 'Developer' ? 'Dev' : 'User'} · ${remainingMin}m`
              : sessionExpired
              ? (lang === 'th' ? 'หมดอายุ · เข้าสู่ระบบ' : 'Expired · Sign in')
              : (lang === 'th' ? 'เข้าสู่ระบบ' : 'Sign in')}
          </span>
        </button>

        {/* Dedicated Language Switcher Component */}
        <LanguageSwitcher variant="compact" />

        {/* Keyboard Shortcuts Trigger Button */}
        {onOpenShortcuts && (
          <button
            type="button"
            onClick={onOpenShortcuts}
            title={lang === 'th' ? 'แป้นพิมพ์ลัด (Ctrl+/ หรือ ?)' : 'Keyboard Shortcuts (Ctrl+/ or ?)'}
            className="hidden sm:flex items-center gap-1 px-2.5 py-2 rounded-xl transition-colors cursor-pointer text-[11px] font-mono shrink-0"
            style={{
              color: 'var(--app-text-secondary)',
              backgroundColor: 'var(--app-card)',
              border: '1px solid var(--app-card-border)',
            }}
          >
            <Keyboard className="w-4 h-4 text-[var(--app-accent)]" />
            <kbd className="hidden lg:inline-block px-1 py-0.2 text-[9px] bg-black/20 rounded border border-[var(--app-card-border)]">?</kbd>
          </button>
        )}

        {/* Manual Refresh */}
        <button
          type="button"
          onClick={onRefreshStatus}
          disabled={isRefreshing}
          title={t('btn.refresh')}
          className="min-h-[40px] min-w-[40px] sm:min-h-[34px] sm:min-w-0 flex items-center justify-center p-2 rounded-xl transition-colors cursor-pointer shrink-0"
          style={{
            color: 'var(--app-text-secondary)',
            backgroundColor: 'var(--app-card)',
            border: '1px solid var(--app-card-border)',
          }}
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} style={isRefreshing ? { color: 'var(--app-accent)' } : undefined} />
        </button>

        {/* AI Assistant Trigger */}
        {onOpenAssistant && (
          <button
            type="button"
            onClick={onOpenAssistant}
            title={lang === 'th' ? 'เปิดผู้ช่วย AI ในระบบ (Alt+A)' : 'Open System AI Assistant (Alt+A)'}
            className="hidden md:flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap border hover:border-[var(--app-accent)] shrink-0"
            style={{
              color: 'var(--app-text-primary)',
              backgroundColor: 'var(--app-card)',
              borderColor: 'var(--app-card-border)',
            }}
          >
            <Sparkles className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
            <span className="hidden lg:inline">{lang === 'th' ? 'ผู้ช่วย AI' : 'AI Assistant'}</span>
          </button>
        )}

          {/* Primary Action Button with Shortcut Badge */}
          <button
            type="button"
            onClick={onOpenQuickTask}
            title={lang === 'th' ? 'สั่งการประมวลผลด่วน (Ctrl+K)' : 'Quick Dispatch Native Intelligence (Ctrl+K)'}
            className="min-h-[40px] sm:min-h-[34px] flex items-center gap-1.5 px-3 sm:px-4 py-1.5 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all whitespace-nowrap cursor-pointer border border-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] shrink-0"
          >
            <Terminal className="w-3.5 h-3.5 text-[var(--app-amber)] shrink-0" />
            <span className="hidden sm:inline">{t('btn.run_agent')}</span>
            <span className="sm:hidden">{t('btn.run')}</span>
            <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono font-normal bg-black/30 border border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] rounded text-[var(--z-ok)]">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>

      {/* Compact runtime truth indicator; readiness is derived only from loaded weights + inference readiness. */}
      <div
        role="status"
        data-testid="header-cloud-status"
        aria-label={runtimeStatusLabel}
        className="min-h-8 px-3 sm:px-5 md:px-8 flex items-center justify-between gap-3 border-t text-[10px] sm:text-[11px]"
        style={{ borderColor: 'var(--app-card-border)', color: 'var(--app-text-secondary)' }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{
              background: isNativeRuntimeReady ? 'var(--status-verified)' : 'var(--app-amber)',
              boxShadow: isNativeRuntimeReady ? '0 0 9px var(--app-accent-glow)' : 'none',
            }}
            aria-hidden="true"
          />
          <span className="truncate">{runtimeStatusLabel}</span>
        </span>
        {!isNativeRuntimeReady && (
          <button
            type="button"
            data-testid="header-configure-connection-btn"
            onClick={onOpenCloudSettings || onOpenSettings}
            className="shrink-0 font-semibold transition-colors hover:text-[var(--app-accent)] cursor-pointer"
          >
            {lang === 'th' ? 'ตรวจสอบการตั้งค่า' : 'Check configuration'}
          </button>
        )}
      </div>
    </header>
  );
};
