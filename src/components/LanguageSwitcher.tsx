import React from 'react';
import { useLanguage, Language } from '../context/LanguageContext';
import { Languages, Check } from 'lucide-react';

interface LanguageSwitcherProps {
  variant?: 'buttons' | 'dropdown' | 'compact';
  className?: string;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  variant = 'compact',
  className = ''
}) => {
  const { lang, setLang } = useLanguage();

  if (variant === 'buttons') {
    return (
      <div className={`flex items-center gap-1 p-1 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] text-xs font-medium ${className}`}>
        <button
          type="button"
          onClick={() => setLang('th')}
          aria-pressed={lang === 'th'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
            lang === 'th'
              ? 'bg-[var(--app-card)] text-[var(--app-accent)] font-semibold'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          <span>ภาษาไทย (TH)</span>
          {lang === 'th' && <Check className="w-3 h-3 stroke-[2.5]" />}
        </button>

        <button
          type="button"
          onClick={() => setLang('en')}
          aria-pressed={lang === 'en'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
            lang === 'en'
              ? 'bg-[var(--app-card)] text-[var(--app-accent)] font-semibold'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          <span>English (EN)</span>
          {lang === 'en' && <Check className="w-3 h-3 stroke-[2.5]" />}
        </button>
      </div>
    );
  }

  // Compact variant (default for Header)
  return (
    <div
      className={`flex items-center bg-[var(--app-card)] p-0.5 rounded-lg border border-[var(--app-card-border)] text-[11px] font-medium shrink-0 ${className}`}
      role="group"
      aria-label={lang === 'th' ? 'เลือกภาษา' : 'Select language'}
    >
      <button
        type="button"
        onClick={() => setLang('th')}
        aria-pressed={lang === 'th'}
        className={`flex items-center justify-center px-2 py-1 rounded-md transition-colors cursor-pointer ${
          lang === 'th'
            ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] font-semibold'
            : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
        }`}
        title="สลับเป็นภาษาไทย"
      >
        <span>TH</span>
      </button>
      <button
        type="button"
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
        className={`flex items-center justify-center px-2 py-1 rounded-md transition-colors cursor-pointer ${
          lang === 'en'
            ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] font-semibold'
            : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
        }`}
        title="Switch to English"
      >
        <span>EN</span>
      </button>
    </div>
  );
};
