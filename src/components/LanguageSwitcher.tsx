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
      <div className={`flex items-center gap-1.5 p-1 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-xs font-bold ${className}`}>
        <button
          onClick={() => setLang('th')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
            lang === 'th'
              ? 'bg-[var(--app-surface)] text-[#00F0FF] border border-[#00F0FF]/40 shadow-xs'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          <span>🇹🇭 ภาษาไทย (TH)</span>
          {lang === 'th' && <Check className="w-3 h-3 stroke-[3]" />}
        </button>

        <button
          onClick={() => setLang('en')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
            lang === 'en'
              ? 'bg-[var(--app-surface)] text-[#00F0FF] border border-[#00F0FF]/40 shadow-xs'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          <span>🇬🇧 English (EN)</span>
          {lang === 'en' && <Check className="w-3 h-3 stroke-[3]" />}
        </button>
      </div>
    );
  }

  // Compact variant (default for Header)
  return (
    <div className={`flex items-center bg-[var(--app-input-bg)] p-0.5 rounded-xl border border-[var(--app-card-border)] text-xs font-bold ${className}`}>
      <button
        onClick={() => setLang('th')}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
          lang === 'th'
            ? 'bg-[var(--app-surface)] text-[#00F0FF] shadow-xs'
            : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
        }`}
        title="สลับเป็นภาษาไทย (Switch to Thai)"
      >
        <span className="text-[11px]">TH</span>
      </button>
      <button
        onClick={() => setLang('en')}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
          lang === 'en'
            ? 'bg-[var(--app-surface)] text-[#00F0FF] shadow-xs'
            : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
        }`}
        title="Switch to English"
      >
        <span className="text-[11px]">EN</span>
      </button>
    </div>
  );
};
