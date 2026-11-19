import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemeMode =
  | 'emerald-amber'
  | 'light'
  | 'dark'
  | 'system'
  | 'midnight-navy'
  | 'vivid-cyan'
  | 'royal-purple';

export interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: 'emerald-amber' | 'light' | 'dark' | 'midnight-navy' | 'vivid-cyan' | 'royal-purple';
  setTheme: (theme: ThemeMode) => void;
  customAccent: string;
  setCustomAccent: (color: string) => void;
  accentIntensity: number; // 0.6 to 1.4
  setAccentIntensity: (intensity: number) => void;
  resetThemeDefaults: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('zyntheor_theme_mode') as ThemeMode;
      if (['emerald-amber', 'light', 'dark', 'system', 'midnight-navy', 'vivid-cyan', 'royal-purple'].includes(saved)) {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'emerald-amber'; // Default to Obsidian palette
  });

  const [customAccent, setCustomAccentState] = useState<string>(() => {
    try {
      return localStorage.getItem('zyntheor_custom_accent') || '';
    } catch {
      return '';
    }
  });

  const [accentIntensity, setAccentIntensityState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('zyntheor_accent_intensity');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 1.5) return parsed;
      }
    } catch {
      // ignore
    }
    return 1.0;
  });

  // Calculate resolved theme (if 'system', check prefers-color-scheme)
  const getResolvedTheme = (mode: ThemeMode): 'emerald-amber' | 'light' | 'dark' | 'midnight-navy' | 'vivid-cyan' | 'royal-purple' => {
    if (mode === 'system') {
      const isDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return isDark ? 'emerald-amber' : 'light';
    }
    return mode;
  };

  const [resolvedTheme, setResolvedTheme] = useState(() => getResolvedTheme(theme));

  // Update DOM attributes on theme change
  useEffect(() => {
    const resolved = getResolvedTheme(theme);
    setResolvedTheme(resolved);

    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);

    if (resolved === 'emerald-amber' || resolved === 'dark' || resolved === 'midnight-navy' || resolved === 'vivid-cyan' || resolved === 'royal-purple') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Apply custom accent color if defined
    if (customAccent) {
      root.style.setProperty('--app-accent', customAccent);
    } else {
      root.style.removeProperty('--app-accent');
    }

    // Apply accent intensity
    root.style.setProperty('--accent-intensity', String(accentIntensity));
  }, [theme, customAccent, accentIntensity]);

  // System listener when theme is 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => {
      const resolved = e.matches ? 'emerald-amber' : 'light';
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
      if (resolved === 'emerald-amber') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('zyntheor_theme_mode', newTheme);
    } catch {
      // ignore
    }
  };

  const setCustomAccent = (color: string) => {
    setCustomAccentState(color);
    try {
      if (color) {
        localStorage.setItem('zyntheor_custom_accent', color);
      } else {
        localStorage.removeItem('zyntheor_custom_accent');
      }
    } catch {
      // ignore
    }
  };

  const setAccentIntensity = (val: number) => {
    const clamped = Math.max(0.6, Math.min(1.4, Number(val.toFixed(2))));
    setAccentIntensityState(clamped);
    try {
      localStorage.setItem('zyntheor_accent_intensity', String(clamped));
    } catch {
      // ignore
    }
  };

  const resetThemeDefaults = () => {
    setTheme('emerald-amber');
    setCustomAccent('');
    setAccentIntensity(1.0);
    try {
      localStorage.removeItem('zyntheor_theme_mode');
      localStorage.removeItem('zyntheor_custom_accent');
      localStorage.removeItem('zyntheor_accent_intensity');
    } catch {
      // ignore
    }
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        customAccent,
        setCustomAccent,
        accentIntensity,
        setAccentIntensity,
        resetThemeDefaults
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
};
