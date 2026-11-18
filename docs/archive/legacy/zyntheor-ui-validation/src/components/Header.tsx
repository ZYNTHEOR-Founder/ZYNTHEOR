import React from 'react';
import { ModuleId, SystemStatusData } from '../types';
import { Menu, Terminal, RefreshCw, Clock, Keyboard, Sparkles } from 'lucide-react';
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
  onOpenAssistant
}) => {
  const { t, lang } = useLanguage();
  const { session, role, isAuthenticated } = useAuth();
  const authMs = session.authenticatedAt ? new Date(session.authenticatedAt).getTime() : NaN;
  const hasValidSessionTime = isAuthenticated && Number.isFinite(authMs);
  const sessionAgeMin = hasValidSessionTime ? Math.max(0, Math.floor((Date.now() - authMs) / 60000)) : 0;
  const remainingMin = hasValidSessionTime ? Math.max(0, 60 - sessionAgeMin) : 0;
  const sessionHealthColor = !hasValidSessionTime
    ? 'text-[var(--app-text-secondary)]'
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

  const phase = statusData?.commercial?.currentPhase ?? null;
  const phaseLabel = phase === 'COMMERCIAL_LAUNCH'
    ? t('badge.commercial_launch')
    : phase === 'PUBLIC_BETA'
    ? t('badge.public_beta')
    : phase === 'PRIVATE_BETA'
    ? t('badge.private_beta')
    : null;

  return (
    <header className="h-16 px-3 sm:px-4 md:px-8 bg-[color-mix(in_srgb,var(--app-surface)_85%,transparent)] backdrop-blur-md border-b border-[var(--app-card-border)] sticky top-0 z-30 flex items-center justify-between gap-2 sm:gap-4 transition-colors duration-200">
      {/* Left: Mobile Toggle & Breadcrumbs */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <button
          onClick={onToggleMobile}
          className="lg:hidden p-2 rounded-xl text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-elevated)] dark:hover:bg-[var(--app-surface)] transition-colors shrink-0"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0 flex-1">
          <span className="font-semibold text-[var(--app-text-secondary)] hidden sm:inline shrink-0">{t('nav.ecosystem')}</span>
          <span className="text-[var(--app-text-secondary)] dark:text-[var(--app-text-primary)] hidden sm:inline shrink-0">/</span>
          <h1 className="font-bold text-[var(--app-text-primary)] text-sm sm:text-base md:text-lg tracking-tight truncate">
            {getModuleTitle(activeModule)}
          </h1>
        </div>
      </div>

      {/* Right: Actions, Language Toggle, Sovereign Indicator & Quick Task CTA */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* Session Health & Role Indicator (clickable on mobile and desktop) */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-[11px] font-mono border border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-secondary)] hover:border-[var(--app-accent)] tabular-nums cursor-pointer transition-colors whitespace-nowrap shrink-0"
          title={hasValidSessionTime ? `${t('header.session_title')} (${t(`role.${role}`, role)}): ${remainingMin}m` : t('header.sign_in')}
        >
          <Clock className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${sessionHealthColor}`} />
          <span className="hidden sm:inline">{hasValidSessionTime ? `${t(`role.${role}`, role)} · ${remainingMin}m` : t('header.sign_in')}</span>
        </button>

        {/* Dedicated Language Switcher Component */}
        <LanguageSwitcher variant="compact" />

        {/* Audit status is rendered only from the latest system response. */}
        {statusData?.audit && (
          <div
            className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-xl text-[11px] font-semibold"
            style={{
              backgroundColor: statusData.audit.chainValid
                ? 'color-mix(in srgb, var(--z-ok) 10%, transparent)'
                : 'color-mix(in srgb, var(--z-danger) 10%, transparent)',
              color: statusData.audit.chainValid ? 'var(--status-verified)' : 'var(--status-blocked)',
              border: `1px solid color-mix(in srgb, ${statusData.audit.chainValid ? 'var(--z-ok)' : 'var(--z-danger)'} 28%, transparent)`
            }}
            aria-live="polite"
          >
            <span className={`vivid-status-dot ${statusData.audit.chainValid ? 'is-ready' : 'is-blocked'}`} />
            <span>{statusData.audit.chainValid ? t('status.audit_valid') : t('status.audit_check')}</span>
            <span className="font-mono opacity-75">{statusData.audit.totalRecords} {t('status.audit_records')}</span>
          </div>
        )}

        {/* Phase is omitted until actual service status is available. */}
        {phaseLabel && (
          <div
            className="hidden sm:flex items-center px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap"
            style={{
              backgroundColor: 'var(--app-card)',
              color: 'var(--app-text-primary)',
              border: '1px solid var(--app-card-border)'
            }}
          >
            {phaseLabel}
          </div>
        )}

        {/* Keyboard Shortcuts Trigger Button */}
        {onOpenShortcuts && (
          <button
            onClick={onOpenShortcuts}
            title={lang === 'th' ? 'แป้นพิมพ์ลัด (Ctrl+/ หรือ ?)' : 'Keyboard Shortcuts (Ctrl+/ or ?)'}
            className="hidden sm:flex items-center gap-1 px-2.5 py-2 rounded-xl transition-colors cursor-pointer text-[11px] font-mono"
            style={{
              color: 'var(--app-text-secondary)',
              backgroundColor: 'var(--app-card)',
              border: '1px solid var(--app-card-border)'
            }}
          >
            <Keyboard className="w-4 h-4 text-[var(--app-accent)]" />
            <kbd className="hidden lg:inline-block px-1 py-0.2 text-[9px] bg-black/20 rounded border border-[var(--app-card-border)]">?</kbd>
          </button>
        )}

        {/* Manual Refresh */}
        <button
          onClick={onRefreshStatus}
          disabled={isRefreshing}
          title={t('btn.refresh')}
          className="hidden sm:inline-flex p-2 rounded-xl transition-colors cursor-pointer"
          style={{
            color: 'var(--app-text-secondary)',
            backgroundColor: 'var(--app-card)',
            border: '1px solid var(--app-card-border)'
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
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap border hover:border-[var(--app-accent)]"
            style={{
              color: 'var(--app-text-primary)',
              backgroundColor: 'var(--app-card)',
              borderColor: 'var(--app-card-border)'
            }}
          >
            <Sparkles className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
            <span className="hidden sm:inline">{lang === 'th' ? 'ผู้ช่วย AI' : 'AI Assistant'}</span>
          </button>
        )}

        {/* Primary Action Button with Shortcut Badge */}
        <button
          onClick={onOpenQuickTask}
          title={lang === 'th' ? 'สั่งการประมวลผลด่วน (Ctrl+K)' : 'Quick Dispatch Native Intelligence (Ctrl+K)'}
          className="flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-bold text-[var(--app-text-primary)] vivid-gradient-brand rounded-xl shadow-md  hover:opacity-95 transition-all whitespace-nowrap cursor-pointer border border-[color-mix(in_srgb,var(--z-ok)_20%,transparent)]"
        >
          <Terminal className="w-4 h-4 text-[var(--app-amber)]" />
          <span className="hidden sm:inline">{t('btn.run_agent')}</span>
          <span className="sm:hidden">{t('btn.run')}</span>
          <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono font-normal bg-black/30 border border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] rounded text-[var(--z-ok)]">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
};
