import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'violet' | 'danger' | 'lime' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[34px] px-3 py-1.5 text-xs rounded-lg gap-1.5',
  md: 'min-h-[40px] px-4 py-2 text-xs sm:text-sm rounded-xl gap-2',
  lg: 'min-h-[46px] px-5 py-2.5 text-sm rounded-xl gap-2.5',
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--app-accent-deep)] text-white font-semibold hover:brightness-110 border border-transparent',
  secondary:
    'bg-[var(--app-surface)] text-[var(--app-text-primary)] font-semibold border border-[var(--app-card-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_55%,transparent)] hover:bg-[var(--app-surface-elevated)]',
  violet:
    'bg-[var(--app-accent-deep)] text-white font-semibold shadow-sm hover:brightness-110 border border-[color-mix(in_srgb,var(--z-danger)_35%,transparent)]',
  danger:
    'bg-[color-mix(in_srgb,var(--z-danger)_15%,transparent)] text-[var(--z-danger)] font-semibold border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--z-danger)_25%,transparent)]',
  lime:
    'bg-[var(--z-ok)] text-[var(--app-bg)] font-semibold shadow-sm hover:brightness-95 border border-[color-mix(in_srgb,var(--z-ok)_60%,transparent)]',
  ghost:
    'bg-transparent text-[var(--app-text-secondary)] font-semibold hover:text-[var(--app-text-primary)] hover:bg-[color-mix(in_srgb,var(--app-text-primary)_6%,transparent)] border border-transparent',
  outline:
    'bg-transparent text-[var(--app-accent)] font-semibold border border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}) => {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center transition-all duration-150 select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      {children}
      {rightIcon && !loading ? <span className="shrink-0">{rightIcon}</span> : null}
    </button>
  );
};
