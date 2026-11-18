import React from 'react';

export interface FormFieldProps {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  hint,
  error,
  required,
  className = '',
  children,
}) => (
  <div className={`space-y-1.5 ${className}`}>
    {label && (
      <label
        htmlFor={htmlFor}
        className="block text-xs font-bold tracking-wide"
        style={{ color: 'var(--app-text-secondary)' }}
      >
        {label}
        {required && <span className="ml-1 text-[var(--z-danger)]">*</span>}
      </label>
    )}
    {children}
    {error ? (
      <p className="text-[11px] font-medium text-[var(--z-danger)]" role="alert">
        {error}
      </p>
    ) : hint ? (
      <p className="text-[11px]" style={{ color: 'var(--app-text-secondary)' }}>
        {hint}
      </p>
    ) : null}
  </div>
);

const CONTROL_BASE =
  'w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-medium transition-colors border focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ hasError = false, className = '', style, ...rest }, ref) => (
    <input
      ref={ref}
      className={`${CONTROL_BASE} ${className}`}
      style={{
        backgroundColor: 'var(--app-input-bg)',
        borderColor: hasError ? 'var(--z-danger)' : 'var(--app-card-border)',
        color: 'var(--app-text-primary)',
        ...style,
      }}
      {...rest}
    />
  )
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ hasError = false, className = '', style, ...rest }, ref) => (
    <textarea
      ref={ref}
      className={`${CONTROL_BASE} resize-y ${className}`}
      style={{
        backgroundColor: 'var(--app-input-bg)',
        borderColor: hasError ? 'var(--z-danger)' : 'var(--app-card-border)',
        color: 'var(--app-text-primary)',
        ...style,
      }}
      {...rest}
    />
  )
);
Textarea.displayName = 'Textarea';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ hasError = false, className = '', style, children, ...rest }, ref) => (
    <select
      ref={ref}
      className={`${CONTROL_BASE} cursor-pointer ${className}`}
      style={{
        backgroundColor: 'var(--app-input-bg)',
        borderColor: hasError ? 'var(--z-danger)' : 'var(--app-card-border)',
        color: 'var(--app-text-primary)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';
