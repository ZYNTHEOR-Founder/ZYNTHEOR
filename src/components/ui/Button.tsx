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
    'bg-gradient-to-r from-[#00F0FF] via-[#2563EB] to-[#7B2CBF] text-white font-bold shadow-[0_6px_22px_rgba(0,240,255,0.24)] hover:brightness-110 border border-[#00F0FF]/35',
  secondary:
    'bg-[#0D1326] text-[#F4F7FF] font-semibold border border-[#1E294A] hover:border-[#00F0FF]/55 hover:bg-[#131B36]',
  violet:
    'bg-gradient-to-r from-[#7B2CBF] to-[#FF007F] text-white font-bold shadow-[0_6px_20px_rgba(255,0,127,0.22)] hover:brightness-110 border border-[#FF007F]/35',
  danger:
    'bg-[#FF007F]/15 text-[#FF85B8] font-bold border border-[#FF007F]/45 hover:bg-[#FF007F]/25',
  lime:
    'bg-[#CCFF00] text-[#070B19] font-extrabold shadow-[0_6px_20px_rgba(204,255,0,0.20)] hover:brightness-95 border border-[#CCFF00]/60',
  ghost:
    'bg-transparent text-[var(--app-text-secondary)] font-semibold hover:text-[var(--app-text-primary)] hover:bg-white/5 border border-transparent',
  outline:
    'bg-transparent text-[#00F0FF] font-semibold border border-[#00F0FF]/45 hover:bg-[#00F0FF]/10',
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
