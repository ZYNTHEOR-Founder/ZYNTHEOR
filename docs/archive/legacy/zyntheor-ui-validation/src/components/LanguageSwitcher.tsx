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

  const languageButton = (value: Language, label: string, title: string) => {
    const active = lang === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setLang(value)}
        aria-label={title}
        aria-pressed={active}
        title={title}
        className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 sm:px-3 text-[11px] font-bold tracking-wide transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] ${
          active
            ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--app-accent)_42%,transparent),0_0_18px_var(--app-accent-glow)]'
            : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-elevated)] hover:text-[var(--app-text-primary)]'
        }`}
      >
        <span>{label}</span>
        {active && <Check aria-hidden="true" className="h-3.5 w-3.5 stroke-[3]" />}
      </button>
    );
  };

  if (variant === 'buttons') {
    return (
      <div
        role="group"
        aria-label={lang === 'th' ? 'เลือกภาษา' : 'Choose language'}
        className={`inline-flex items-center gap-1 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] p-1 ${className}`}
      >
        {languageButton('th', '🇹🇭 ภาษาไทย', 'สลับเป็นภาษาไทย')}
        {languageButton('en', '🇬🇧 English', 'Switch to English')}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={lang === 'th' ? 'เลือกภาษา' : 'Choose language'}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] p-1 ${className}`}
    >
      <Languages aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-[var(--app-text-secondary)]" />
      {languageButton('th', 'TH', 'สลับเป็นภาษาไทย')}
      {languageButton('en', 'EN', 'Switch to English')}
    </div>
  );
};
