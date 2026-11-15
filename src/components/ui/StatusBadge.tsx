import React from 'react';
import { BridgeLifecycleState, RuntimeLifecycleState, StatusLevel } from '../../types';
import { ZYNTHEOR_STATUS_TOKENS } from './tokens';

export type MinimalIndicatorState =
  | StatusLevel
  | RuntimeLifecycleState
  | BridgeLifecycleState
  | 'CHECKING'
  | 'FAIL_CLOSED';

const INDICATOR_STYLES: Record<
  MinimalIndicatorState,
  { hex: string; glow: string; textHex: string; isActiveDefault?: boolean; isError?: boolean }
> = {
  VERIFIED: {
    hex: ZYNTHEOR_STATUS_TOKENS.VERIFIED.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.VERIFIED.glow,
    textHex: '#CCFF00',
  },
  ONLINE: {
    hex: ZYNTHEOR_STATUS_TOKENS.ONLINE.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.ONLINE.glow,
    textHex: '#CCFF00',
  },
  READY: {
    hex: ZYNTHEOR_STATUS_TOKENS.ONLINE.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.ONLINE.glow,
    textHex: '#CCFF00',
  },
  Connected: {
    hex: ZYNTHEOR_STATUS_TOKENS.ONLINE.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.ONLINE.glow,
    textHex: '#CCFF00',
  },
  IMPLEMENTED: {
    hex: ZYNTHEOR_STATUS_TOKENS.IMPLEMENTED.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.IMPLEMENTED.glow,
    textHex: '#00F0FF',
  },
  ACTIVE: {
    hex: ZYNTHEOR_STATUS_TOKENS.ACTIVE.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.ACTIVE.glow,
    textHex: '#00F0FF',
    isActiveDefault: true,
  },
  CHECKING: {
    hex: '#00F0FF',
    glow: '0 0 9px rgba(0, 240, 255, 0.65)',
    textHex: '#00F0FF',
    isActiveDefault: true,
  },
  INITIALIZING: {
    hex: '#00F0FF',
    glow: '0 0 9px rgba(0, 240, 255, 0.65)',
    textHex: '#00F0FF',
    isActiveDefault: true,
  },
  Initializing: {
    hex: '#00F0FF',
    glow: '0 0 9px rgba(0, 240, 255, 0.65)',
    textHex: '#00F0FF',
    isActiveDefault: true,
  },
  Connecting: {
    hex: '#00F0FF',
    glow: '0 0 9px rgba(0, 240, 255, 0.65)',
    textHex: '#00F0FF',
    isActiveDefault: true,
  },
  Reconnecting: {
    hex: '#FF5E3A',
    glow: '0 0 9px rgba(255, 94, 58, 0.65)',
    textHex: '#FF8C73',
    isActiveDefault: true,
    isError: true,
  },
  Degraded: {
    hex: ZYNTHEOR_STATUS_TOKENS.PARTIAL.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.PARTIAL.glow,
    textHex: '#FF8C73',
    isError: true,
  },
  Unreachable: {
    hex: '#FF007F',
    glow: '0 0 9px rgba(255, 0, 127, 0.60)',
    textHex: '#FF66B2',
    isError: true,
  },
  'Service Error': {
    hex: ZYNTHEOR_STATUS_TOKENS.FAILED.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.FAILED.glow,
    textHex: '#FF66B2',
    isError: true,
  },
  PARTIAL: {
    hex: ZYNTHEOR_STATUS_TOKENS.PARTIAL.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.PARTIAL.glow,
    textHex: '#FF8C73',
  },
  NOT_TRAINED: {
    hex: '#FF5E3A',
    glow: '0 0 8px rgba(255, 94, 58, 0.50)',
    textHex: '#FF8C73',
    isError: true,
  },
  QUALITY_BLOCKED: {
    hex: ZYNTHEOR_STATUS_TOKENS.BLOCKED.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.BLOCKED.glow,
    textHex: '#FF66B2',
    isError: true,
  },
  NOT_LOADED: {
    hex: '#FF5E3A',
    glow: '0 0 8px rgba(255, 94, 58, 0.50)',
    textHex: '#FF8C73',
    isError: true,
  },
  NOT_CONFIGURED: {
    hex: '#9AA8C7',
    glow: 'none',
    textHex: '#9AA8C7',
    isError: true,
  },
  NOT_FOUND: {
    hex: '#FF007F',
    glow: '0 0 9px rgba(255, 0, 127, 0.60)',
    textHex: '#FF66B2',
    isError: true,
  },
  BLOCKED: {
    hex: ZYNTHEOR_STATUS_TOKENS.BLOCKED.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.BLOCKED.glow,
    textHex: '#FF66B2',
    isError: true,
  },
  FAILED: {
    hex: ZYNTHEOR_STATUS_TOKENS.FAILED.hex,
    glow: ZYNTHEOR_STATUS_TOKENS.FAILED.glow,
    textHex: '#FF66B2',
    isError: true,
  },
  FAIL_CLOSED: {
    hex: '#FF007F',
    glow: '0 0 9px rgba(255, 0, 127, 0.60)',
    textHex: '#FF66B2',
    isError: true,
  },
  'NOT IMPLEMENTED': {
    hex: ZYNTHEOR_STATUS_TOKENS['NOT IMPLEMENTED'].hex,
    glow: 'none',
    textHex: '#9AA8C7',
  },
  'NOT RUN': {
    hex: ZYNTHEOR_STATUS_TOKENS['NOT RUN'].hex,
    glow: 'none',
    textHex: '#9AA8C7',
  },
};

export interface StatusDotProps {
  status: MinimalIndicatorState;
  label?: string;
  detail?: string;
  pulse?: boolean;
  dotOnly?: boolean;
  className?: string;
}

/**
 * Minimal circular glowing status indicator.
 * Uses subtle pulse only for live/processing/connecting states, and static light for stable states.
 * Critical error states preserve explicit text labels alongside color so status never relies on color alone.
 */
export const StatusDot: React.FC<StatusDotProps> = ({
  status,
  label,
  detail,
  pulse,
  dotOnly = false,
  className = '',
}) => {
  const st = INDICATOR_STYLES[status] || INDICATOR_STYLES['NOT IMPLEMENTED'];
  const shouldPulse = pulse !== undefined ? pulse : Boolean(st.isActiveDefault);
  const displayLabel = label ?? status;
  const accessibleLabel = detail ? `${displayLabel}: ${detail}` : displayLabel;
  const showText = !dotOnly || Boolean(st.isError);

  return (
    <span
      role="status"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className={`inline-flex items-center gap-1.5 shrink-0 ${className}`}
    >
      <span className="relative flex h-2.5 w-2.5 items-center justify-center shrink-0" aria-hidden="true">
        {shouldPulse && (
          <span
            className="status-dot-halo absolute inline-flex h-full w-full rounded-full"
            style={{ backgroundColor: st.hex }}
          />
        )}
        <span
          className={`status-dot-core relative inline-flex h-2 w-2 rounded-full ${shouldPulse ? 'is-pulsing' : ''}`}
          style={{
            backgroundColor: st.hex,
            boxShadow: st.glow,
          }}
        />
      </span>
      {showText ? (
        <span
          className="font-mono text-[11px] font-semibold tracking-wide leading-none whitespace-nowrap"
          style={{ color: st.textHex }}
        >
          {displayLabel}
        </span>
      ) : (
        <span className="sr-only">{accessibleLabel}</span>
      )}
    </span>
  );
};

interface StatusBadgeProps {
  status: StatusLevel;
  label?: string;
  detail?: string;
  pulse?: boolean;
  dotOnly?: boolean;
  className?: string;
}

/**
 * Refactored minimal status indicator (pill/box container intentionally removed).
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  detail,
  pulse,
  dotOnly,
  className = '',
}) => (
  <StatusDot
    status={status}
    label={label}
    detail={detail}
    pulse={pulse}
    dotOnly={dotOnly}
    className={className}
  />
);

export type RuntimeHealthLevel =
  | 'ONLINE'
  | 'VERIFIED'
  | 'CHECKING'
  | 'PARTIAL'
  | 'FAIL_CLOSED'
  | 'BLOCKED'
  | 'NOT IMPLEMENTED';

export interface RuntimeStatusIndicatorProps {
  status: RuntimeHealthLevel;
  label?: string;
  detail?: string;
  pulse?: boolean;
  className?: string;
}

export const RuntimeStatusIndicator: React.FC<RuntimeStatusIndicatorProps> = ({
  status,
  label,
  detail,
  pulse,
  className = '',
}) => (
  <StatusDot
    status={status}
    label={label}
    detail={detail}
    pulse={pulse}
    className={className}
  />
);
