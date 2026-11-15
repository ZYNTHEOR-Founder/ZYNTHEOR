import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { StatusDot } from '../components/ui/StatusBadge';

export type ToastVariant = 'success' | 'info' | 'warning' | 'error';

export interface ToastOptions {
  title: string;
  message?: string;
  meta?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

export interface ToastItem extends ToastOptions {
  id: string;
  variant: ToastVariant;
  durationMs: number;
  createdAt: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (options: ToastOptions) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const MAX_TOASTS = 4;
const DEFAULT_DURATION_MS = 5200;

const VARIANT_STYLES: Record<
  ToastVariant,
  {
    topBar: string;
    border: string;
    dotStatus: 'VERIFIED' | 'IMPLEMENTED' | 'PARTIAL' | 'FAILED';
    titleColor: string;
    metaBg: string;
  }
> = {
  success: {
    topBar: 'bg-gradient-to-r from-[#00F0FF] via-[#CCFF00] to-[#00F0FF]',
    border: 'border-[#CCFF00]/45 shadow-[0_14px_34px_rgba(0,240,255,0.14)]',
    dotStatus: 'VERIFIED',
    titleColor: 'text-[#F4F7FF]',
    metaBg: 'text-[#CCFF00]',
  },
  info: {
    topBar: 'bg-gradient-to-r from-[#00F0FF] via-[#2563EB] to-[#7B2CBF]',
    border: 'border-[#00F0FF]/45 shadow-[0_14px_34px_rgba(0,240,255,0.14)]',
    dotStatus: 'IMPLEMENTED',
    titleColor: 'text-[#F4F7FF]',
    metaBg: 'text-[#00F0FF]',
  },
  warning: {
    topBar: 'bg-gradient-to-r from-[#FF5E3A] via-[#FF007F] to-[#7B2CBF]',
    border: 'border-[#FF5E3A]/50 shadow-[0_14px_34px_rgba(255,94,58,0.14)]',
    dotStatus: 'PARTIAL',
    titleColor: 'text-[#F4F7FF]',
    metaBg: 'text-[#FF8C73]',
  },
  error: {
    topBar: 'bg-gradient-to-r from-[#FF007F] via-[#FF5E3A] to-[#7B2CBF]',
    border: 'border-[#FF007F]/55 shadow-[0_14px_34px_rgba(255,0,127,0.16)]',
    dotStatus: 'FAILED',
    titleColor: 'text-[#F4F7FF]',
    metaBg: 'text-[#FF66B2]',
  },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((item) => item.id !== id));
    },
    [clearTimer]
  );

  const scheduleDismiss = useCallback(
    (id: string, durationMs: number) => {
      clearTimer(id);
      if (durationMs <= 0) return;
      const timer = setTimeout(() => {
        dismissToast(id);
      }, durationMs);
      timersRef.current.set(id, timer);
    },
    [clearTimer, dismissToast]
  );

  const showToast = useCallback(
    (options: ToastOptions): string => {
      const id = `zy-toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const variant: ToastVariant = options.variant ?? 'success';
      const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
      const nextItem: ToastItem = {
        ...options,
        id,
        variant,
        durationMs,
        createdAt: Date.now(),
      };

      setToasts((prev) => {
        const trimmed = prev.length >= MAX_TOASTS ? prev.slice(prev.length - (MAX_TOASTS - 1)) : prev;
        return [...trimmed, nextItem];
      });
      scheduleDismiss(id, durationMs);
      return id;
    },
    [scheduleDismiss]
  );

  const clearToasts = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ toasts, showToast, dismissToast, clearToasts }),
    [toasts, showToast, dismissToast, clearToasts]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="zy-toast-region fixed z-50 bottom-20 lg:bottom-5 left-4 right-4 sm:left-auto sm:right-5 sm:w-[380px] flex flex-col gap-2.5 pointer-events-none"
      >
        {toasts.map((toast) => {
          const style = VARIANT_STYLES[toast.variant];
          return (
            <div
              key={toast.id}
              role="status"
              onMouseEnter={() => clearTimer(toast.id)}
              onMouseLeave={() => scheduleDismiss(toast.id, toast.durationMs)}
              onFocus={() => clearTimer(toast.id)}
              onBlur={() => scheduleDismiss(toast.id, toast.durationMs)}
              className={`zy-toast-enter pointer-events-auto relative overflow-hidden rounded-2xl border bg-[#0D1326]/95 backdrop-blur-md text-[#F4F7FF] ${style.border}`}
            >
              <div className={`h-1 w-full ${style.topBar}`} />
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="mt-1 shrink-0">
                  <StatusDot status={style.dotStatus} dotOnly pulse={false} label={toast.variant.toUpperCase()} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-bold leading-snug ${style.titleColor}`}>
                    {toast.title}
                  </div>
                  {toast.message && (
                    <p className="mt-0.5 text-[11px] text-[#9AA8C7] leading-relaxed break-words">
                      {toast.message}
                    </p>
                  )}
                  {toast.meta && (
                    <div className={`mt-1 text-[10px] font-mono tabular-nums truncate ${style.metaBg}`}>
                      {toast.meta}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Dismiss notification"
                  className="min-w-[32px] min-h-[32px] -mr-1.5 -mt-1 flex items-center justify-center rounded-lg text-[#9AA8C7] hover:text-[#F4F7FF] hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};
