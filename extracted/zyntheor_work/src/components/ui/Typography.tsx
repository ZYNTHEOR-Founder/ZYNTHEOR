import React from 'react';
import { ZYNTHEOR_TYPOGRAPHY } from './tokens';

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: 'h1' | 'h2' | 'h3' | 'h4';
  scale?: 'display' | 'h1' | 'h2' | 'h3';
  gradient?: boolean;
}

export const Heading: React.FC<HeadingProps> = ({
  as: Component = 'h2',
  scale = 'h2',
  gradient = false,
  className = '',
  children,
  style,
  ...rest
}) => {
  const scaleClass = ZYNTHEOR_TYPOGRAPHY.scales[scale];
  const gradientStyle: React.CSSProperties | undefined = gradient
    ? {
        backgroundImage: 'linear-gradient(120deg, #F4F7FF 15%, #00F0FF 65%, #CCFF00 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        ...style,
      }
    : { color: 'var(--app-text-primary)', ...style };

  return (
    <Component className={`${scaleClass} ${className}`} style={gradientStyle} {...rest}>
      {children}
    </Component>
  );
};

export interface TextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  tone?: 'primary' | 'secondary' | 'muted' | 'accent' | 'mono';
  size?: 'xs' | 'sm' | 'base';
  as?: 'p' | 'span' | 'div';
}

export const Text: React.FC<TextProps> = ({
  tone = 'secondary',
  size = 'sm',
  as: Component = 'p',
  className = '',
  style,
  children,
  ...rest
}) => {
  const sizeClass =
    size === 'xs' ? 'text-xs leading-normal' : size === 'base' ? 'text-base leading-relaxed' : 'text-sm leading-relaxed';

  const toneStyle: React.CSSProperties =
    tone === 'primary'
      ? { color: 'var(--app-text-primary)' }
      : tone === 'accent'
      ? { color: 'var(--app-accent)' }
      : tone === 'muted'
      ? { color: 'var(--app-text-muted, var(--app-text-secondary))' }
      : { color: 'var(--app-text-secondary)' };

  const monoClass = tone === 'mono' ? 'font-mono tabular-nums' : '';

  return (
    <Component className={`${sizeClass} ${monoClass} ${className}`} style={{ ...toneStyle, ...style }} {...rest}>
      {children}
    </Component>
  );
};

export interface EyebrowProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: 'cyan' | 'violet' | 'magenta' | 'coral' | 'lime' | 'secondary';
}

export const Eyebrow: React.FC<EyebrowProps> = ({
  color = 'cyan',
  className = '',
  style,
  children,
  ...rest
}) => {
  const colorMap: Record<NonNullable<EyebrowProps['color']>, string> = {
    cyan: 'var(--zy-cyan, #00F0FF)',
    violet: 'var(--zy-violet, #7B2CBF)',
    magenta: 'var(--zy-magenta, #FF007F)',
    coral: 'var(--zy-coral, #FF5E3A)',
    lime: 'var(--zy-lime, #CCFF00)',
    secondary: 'var(--app-text-secondary)',
  };

  return (
    <span
      className={`${ZYNTHEOR_TYPOGRAPHY.scales.eyebrow} inline-flex items-center gap-1.5 ${className}`}
      style={{ color: colorMap[color], ...style }}
      {...rest}
    >
      {children}
    </span>
  );
};
