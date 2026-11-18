import { useCallback, useEffect, useState } from 'react';

export const SENTIMENT_TREND_STORAGE_KEY = 'zyntheor_show_sentiment_trend';

export interface KeyboardShortcutLikeEvent {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
  code?: string;
}

/**
 * Matches `Alt + V` (case-insensitive, or physical KeyV for non-Latin layouts)
 * while rejecting conflicting modifier combinations (`Ctrl`, `Meta`, `Shift`).
 */
export function isAltVShortcutEvent(event: KeyboardShortcutLikeEvent): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }
  return event.key === 'v' || event.key === 'V' || event.code === 'KeyV';
}

export const isAltVSentimentShortcut = isAltVShortcutEvent;

export function readPersistedSentimentTrendVisibility(defaultVisible = true): boolean {
  if (typeof window === 'undefined') return defaultVisible;
  try {
    const raw = window.localStorage.getItem(SENTIMENT_TREND_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // Ignore storage access restrictions
  }
  return defaultVisible;
}

export function writePersistedSentimentTrendVisibility(visible: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SENTIMENT_TREND_STORAGE_KEY, String(visible));
  } catch {
    // Ignore storage access restrictions
  }
}

export interface UseSentimentTrendShortcutOptions {
  initialVisible?: boolean;
  enabled?: boolean;
  storageKey?: string;
}

/**
 * Hook that manages Sentiment Trend Chart visibility state and registers an
 * `Alt + V` keyboard shortcut listener to toggle visibility rapidly.
 */
export function useSentimentTrendShortcut(options: UseSentimentTrendShortcutOptions = {}) {
  const {
    initialVisible = true,
    enabled = true,
    storageKey = SENTIMENT_TREND_STORAGE_KEY,
  } = options;

  const [showSentimentTrend, setShowSentimentTrendState] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && storageKey) {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
      } catch {
        // Ignore storage restrictions
      }
    }
    return initialVisible;
  });

  const setShowSentimentTrend = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setShowSentimentTrendState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        if (typeof window !== 'undefined' && storageKey) {
          try {
            window.localStorage.setItem(storageKey, String(resolved));
          } catch {
            // Ignore storage restrictions
          }
        }
        return resolved;
      });
    },
    [storageKey]
  );

  const toggleSentimentTrend = useCallback(() => {
    setShowSentimentTrend((prev) => !prev);
  }, [setShowSentimentTrend]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isAltVShortcutEvent(event)) {
        event.preventDefault();
        toggleSentimentTrend();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, toggleSentimentTrend]);

  return {
    showSentimentTrend,
    setShowSentimentTrend,
    isSentimentTrendVisible: showSentimentTrend,
    setSentimentTrendVisible: setShowSentimentTrend,
    toggleSentimentTrend,
  };
}

export const useSentimentTrendToggle = useSentimentTrendShortcut;
