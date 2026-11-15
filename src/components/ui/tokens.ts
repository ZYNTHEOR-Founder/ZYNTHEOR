/**
 * ZYNTHEOR Batch 25 Shared Design Tokens
 * Midnight Navy foundation paired with vibrant functional color tokens.
 */

export const ZYNTHEOR_PALETTE = {
  midnightNavy: '#070B19',
  midnightSurface: '#0D1326',
  midnightElevated: '#131B36',
  midnightBorder: '#1E294A',
  electricCyan: '#00F0FF',
  brilliantViolet: '#7B2CBF',
  vividMagenta: '#FF007F',
  neonBlue: '#2563EB',
  coralOrange: '#FF5E3A',
  luminousLime: '#CCFF00',
  textPrimary: '#F4F7FF',
  textSecondary: '#9AA8C7',
  textMuted: '#6D7B9D',
} as const;

export const ZYNTHEOR_GRADIENTS = {
  brand: 'linear-gradient(135deg, #00F0FF 0%, #2563EB 36%, #7B2CBF 72%, #FF007F 100%)',
  cyanBlue: 'linear-gradient(135deg, #00F0FF 0%, #2563EB 100%)',
  violetMagenta: 'linear-gradient(135deg, #7B2CBF 0%, #FF007F 100%)',
  coralLime: 'linear-gradient(135deg, #FF5E3A 0%, #CCFF00 100%)',
  midnightHero: 'linear-gradient(128deg, #070B19 0%, #0D1326 52%, #14193A 100%)',
} as const;

export const ZYNTHEOR_TYPOGRAPHY = {
  fontSans: "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  scales: {
    display: 'text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight leading-tight',
    h1: 'text-xl sm:text-2xl font-bold tracking-tight leading-snug',
    h2: 'text-base sm:text-lg font-bold tracking-tight leading-snug',
    h3: 'text-sm sm:text-base font-semibold tracking-tight',
    body: 'text-sm leading-relaxed',
    caption: 'text-xs leading-normal',
    eyebrow: 'text-[10px] font-mono font-bold uppercase tracking-[0.16em]',
  },
} as const;

export const ZYNTHEOR_SPACING = {
  pagePadding: 'p-4 md:p-6 lg:p-8',
  sectionGap: 'space-y-6 md:space-y-8',
  cardPadding: 'p-4 sm:p-6',
  gridGap: 'gap-4 md:gap-6',
} as const;

export const ZYNTHEOR_RADII = {
  card: 'rounded-2xl',
  hero: 'rounded-3xl',
  control: 'rounded-xl',
  badge: 'rounded-lg',
} as const;

export const ZYNTHEOR_STATUS_TOKENS = {
  VERIFIED: {
    hex: '#CCFF00',
    glow: '0 0 8px rgba(204, 255, 0, 0.55)',
    bg: 'rgba(204, 255, 0, 0.12)',
    border: 'rgba(204, 255, 0, 0.35)',
    textClass: 'text-[#CCFF00]',
  },
  ONLINE: {
    hex: '#CCFF00',
    glow: '0 0 8px rgba(204, 255, 0, 0.55)',
    bg: 'rgba(204, 255, 0, 0.12)',
    border: 'rgba(204, 255, 0, 0.35)',
    textClass: 'text-[#CCFF00]',
  },
  IMPLEMENTED: {
    hex: '#00F0FF',
    glow: '0 0 8px rgba(0, 240, 255, 0.55)',
    bg: 'rgba(0, 240, 255, 0.12)',
    border: 'rgba(0, 240, 255, 0.35)',
    textClass: 'text-[#00F0FF]',
  },
  ACTIVE: {
    hex: '#00F0FF',
    glow: '0 0 9px rgba(0, 240, 255, 0.65)',
    bg: 'rgba(0, 240, 255, 0.12)',
    border: 'rgba(0, 240, 255, 0.35)',
    textClass: 'text-[#00F0FF]',
  },
  PARTIAL: {
    hex: '#FF5E3A',
    glow: '0 0 8px rgba(255, 94, 58, 0.50)',
    bg: 'rgba(255, 94, 58, 0.12)',
    border: 'rgba(255, 94, 58, 0.35)',
    textClass: 'text-[#FF5E3A]',
  },
  BLOCKED: {
    hex: '#FF007F',
    glow: '0 0 9px rgba(255, 0, 127, 0.60)',
    bg: 'rgba(255, 0, 127, 0.14)',
    border: 'rgba(255, 0, 127, 0.40)',
    textClass: 'text-[#FF007F]',
  },
  FAILED: {
    hex: '#FF007F',
    glow: '0 0 9px rgba(255, 0, 127, 0.60)',
    bg: 'rgba(255, 0, 127, 0.14)',
    border: 'rgba(255, 0, 127, 0.40)',
    textClass: 'text-[#FF007F]',
  },
  'NOT IMPLEMENTED': {
    hex: '#6D7B9D',
    glow: 'none',
    bg: 'rgba(154, 168, 199, 0.10)',
    border: 'rgba(154, 168, 199, 0.28)',
    textClass: 'text-[#9AA8C7]',
  },
  'NOT RUN': {
    hex: '#6D7B9D',
    glow: 'none',
    bg: 'rgba(154, 168, 199, 0.10)',
    border: 'rgba(154, 168, 199, 0.28)',
    textClass: 'text-[#9AA8C7]',
  },
} as const;
