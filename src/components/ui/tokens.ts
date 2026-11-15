/**
 * ZYNTHEOR Batch 25 Shared Design Tokens
 * Ink & Saffron identity. Colors resolve through CSS variables so every theme restyles the app.
 */

export const ZYNTHEOR_PALETTE = {
  ink: 'var(--app-bg)',
  inkSurface: 'var(--app-surface)',
  inkElevated: 'var(--app-surface-elevated)',
  inkBorder: 'var(--app-card-border)',
  signal: 'var(--app-accent)',
  signalDeep: 'var(--app-accent-deep)',
  saffron: 'var(--app-amber)',
  ok: 'var(--z-ok)',
  warn: 'var(--z-warn)',
  danger: 'var(--z-danger)',
  textPrimary: 'var(--app-text-primary)',
  textSecondary: 'var(--app-text-secondary)',
  textMuted: 'var(--app-text-secondary)',
} as const;

export const ZYNTHEOR_GRADIENTS = {
  brand: 'var(--app-accent-deep)',
  cyanBlue: 'var(--app-accent-deep)',
  violetMagenta: 'var(--app-accent-deep)',
  coralLime: 'var(--app-amber)',
  midnightHero: 'var(--app-surface)',
} as const;

export const ZYNTHEOR_TYPOGRAPHY = {
  fontSans: "'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontMono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  scales: {
    display: 'text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight leading-tight',
    h1: 'text-xl sm:text-2xl font-bold tracking-tight leading-snug',
    h2: 'text-base sm:text-lg font-bold tracking-tight leading-snug',
    h3: 'text-sm sm:text-base font-semibold tracking-tight',
    body: 'text-sm leading-relaxed',
    caption: 'text-xs leading-normal',
    eyebrow: 'text-xs font-medium tracking-wide',
  },
} as const;

export const ZYNTHEOR_SPACING = {
  pagePadding: 'p-4 md:p-6 lg:p-8',
  sectionGap: 'space-y-6 md:space-y-8',
  cardPadding: 'p-4 sm:p-6',
  gridGap: 'gap-4 md:gap-6',
} as const;

export const ZYNTHEOR_RADII = {
  card: 'rounded-[14px]',
  hero: 'rounded-[18px]',
  control: 'rounded-[10px]',
  badge: 'rounded-md',
} as const;

export const ZYNTHEOR_STATUS_TOKENS = {
  VERIFIED: {
    hex: 'var(--z-ok)',
    glow: 'none',
    bg: 'color-mix(in srgb, var(--z-ok) 12%, transparent)',
    border: 'color-mix(in srgb, var(--z-ok) 35%, transparent)',
    textClass: 'text-[var(--z-ok)]',
  },
  ONLINE: {
    hex: 'var(--z-ok)',
    glow: 'none',
    bg: 'color-mix(in srgb, var(--z-ok) 12%, transparent)',
    border: 'color-mix(in srgb, var(--z-ok) 35%, transparent)',
    textClass: 'text-[var(--z-ok)]',
  },
  IMPLEMENTED: {
    hex: 'var(--app-accent)',
    glow: 'none',
    bg: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
    border: 'color-mix(in srgb, var(--app-accent) 35%, transparent)',
    textClass: 'text-[var(--app-accent)]',
  },
  ACTIVE: {
    hex: 'var(--app-accent)',
    glow: 'none',
    bg: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
    border: 'color-mix(in srgb, var(--app-accent) 35%, transparent)',
    textClass: 'text-[var(--app-accent)]',
  },
  PARTIAL: {
    hex: 'var(--z-warn)',
    glow: 'none',
    bg: 'color-mix(in srgb, var(--z-warn) 12%, transparent)',
    border: 'color-mix(in srgb, var(--z-warn) 35%, transparent)',
    textClass: 'text-[var(--z-warn)]',
  },
  BLOCKED: {
    hex: 'var(--z-danger)',
    glow: 'none',
    bg: 'color-mix(in srgb, var(--z-danger) 14%, transparent)',
    border: 'color-mix(in srgb, var(--z-danger) 40%, transparent)',
    textClass: 'text-[var(--z-danger)]',
  },
  FAILED: {
    hex: 'var(--z-danger)',
    glow: 'none',
    bg: 'color-mix(in srgb, var(--z-danger) 14%, transparent)',
    border: 'color-mix(in srgb, var(--z-danger) 40%, transparent)',
    textClass: 'text-[var(--z-danger)]',
  },
  'NOT IMPLEMENTED': {
    hex: 'var(--app-text-secondary)',
    glow: 'none',
    bg: 'color-mix(in srgb, var(--app-text-secondary) 10%, transparent)',
    border: 'color-mix(in srgb, var(--app-text-secondary) 28%, transparent)',
    textClass: 'text-[var(--app-text-secondary)]',
  },
  'NOT RUN': {
    hex: 'var(--app-text-secondary)',
    glow: 'none',
    bg: 'color-mix(in srgb, var(--app-text-secondary) 10%, transparent)',
    border: 'color-mix(in srgb, var(--app-text-secondary) 28%, transparent)',
    textClass: 'text-[var(--app-text-secondary)]',
  },
} as const;
