/**
 * ZYNTHEOR - VIVID INTELLIGENCE
 * 100% First-Party Sovereign AI Operating Platform
 */

import React, { Component, Suspense, lazy, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ModuleId, SystemStatusData, OrchestrationEvent, EvidenceDrawerItem } from './types';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { MobileNav } from './components/MobileNav';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import { useAuditIntegrity } from './hooks/useAuditIntegrity';
import {
  rankLogsBySemanticIntent,
  getSemanticIntentPresets,
} from './utils/semanticLogSearch';
import { onButtonFailure, ButtonFailureReport } from './utils/buttonErrorInterceptor';
import {
  getStageMatchedLineIndices,
  getWorkflowStageMeta,
  type WorkflowStageId,
  type WorkflowStageState,
} from './utils/workflowStages';

// Eager home view + lazy code-split secondary ecosystem modules & drawers
import { CommandCenter } from './components/modules/CommandCenter';
import type { ControlSection } from './components/modules/UserSettings';
import type { StepLatencyPoint } from './components/PerformanceTrendsChart';
import { useReconnectionService } from './hooks/useReconnectionService';
import { useSentimentTrendShortcut } from './hooks/useSentimentTrendShortcut';
import { Terminal, X, Play, Pause, ShieldCheck, ShieldAlert, CheckCircle2, Copy, Check, Download, Search, Volume2, VolumeX, RotateCcw, Trash2, WrapText, FileJson, FileText, FileSpreadsheet, ChevronDown, Printer, Camera, History, CheckSquare, Keyboard, PanelRightClose, PanelRightOpen, Activity, Database, LockKeyhole, Network, Sparkles, Layers, LogIn, Settings, Regex, AlertCircle, ListOrdered, TrendingUp, Filter, EyeOff, Eye } from 'lucide-react';

function lazyWithRetry<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    const delays = [250, 600];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await loader();
      } catch (err) {
        lastErr = err;
        if (attempt < delays.length) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }
      }
    }
    throw lastErr;
  });
}

class LazyErrorBoundary extends Component<
  { children: React.ReactNode; lang?: 'th' | 'en'; onReset?: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; lang?: 'th' | 'en'; onReset?: () => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      const th = this.props.lang !== 'en';
      return (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--app-amber)_45%,transparent)] bg-[var(--app-surface)] p-4 text-xs text-[var(--app-text-primary)] flex flex-wrap items-center justify-between gap-3">
          <span>
            {th
              ? 'ไม่สามารถโหลดหน้าจอนี้ได้ในขณะนี้ กรุณารีเฟรชหรือลองใหม่อีกครั้ง'
              : 'Unable to load component right now. Refresh or try opening it again.'}
          </span>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onReset?.();
            }}
            className="px-3 py-1.5 rounded-lg font-bold bg-[var(--app-accent)] text-slate-950 cursor-pointer"
          >
            {th ? 'ลองใหม่' : 'Retry'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ConversationalIntelligence = lazyWithRetry(() =>
  import('./components/modules/ConversationalIntelligence').then((m) => ({ default: m.ConversationalIntelligence }))
);
const IntelligenceCore = lazyWithRetry(() =>
  import('./components/modules/IntelligenceCore').then((m) => ({ default: m.IntelligenceCore }))
);
const DevStudio = lazyWithRetry(() =>
  import('./components/modules/DevStudio').then((m) => ({ default: m.DevStudio }))
);
const ResearchLab = lazyWithRetry(() =>
  import('./components/modules/ResearchLab').then((m) => ({ default: m.ResearchLab }))
);
const AutomationCenter = lazyWithRetry(() =>
  import('./components/modules/AutomationCenter').then((m) => ({ default: m.AutomationCenter }))
);
const KnowledgeHub = lazyWithRetry(() =>
  import('./components/modules/KnowledgeHub').then((m) => ({ default: m.KnowledgeHub }))
);
const ModelLaboratory = lazyWithRetry(() =>
  import('./components/modules/ModelLaboratory').then((m) => ({ default: m.ModelLaboratory }))
);
const ExperimentCenter = lazyWithRetry(() =>
  import('./components/modules/ExperimentCenter').then((m) => ({ default: m.ExperimentCenter }))
);
const ApiPlatform = lazyWithRetry(() =>
  import('./components/modules/ApiPlatform').then((m) => ({ default: m.ApiPlatform }))
);
const Marketplace = lazyWithRetry(() =>
  import('./components/modules/Marketplace').then((m) => ({ default: m.Marketplace }))
);
const SubscriptionBilling = lazyWithRetry(() =>
  import('./components/modules/SubscriptionBilling').then((m) => ({ default: m.SubscriptionBilling }))
);
const AnalyticsBI = lazyWithRetry(() =>
  import('./components/modules/AnalyticsBI').then((m) => ({ default: m.AnalyticsBI }))
);
const GovernanceSecurity = lazyWithRetry(() =>
  import('./components/modules/GovernanceSecurity').then((m) => ({ default: m.GovernanceSecurity }))
);
const UserSettings = lazyWithRetry(() =>
  import('./components/modules/UserSettings').then((m) => ({ default: m.UserSettings }))
);
const AdminConsole = lazyWithRetry(() =>
  import('./components/modules/AdminConsole').then((m) => ({ default: m.AdminConsole }))
);
const ProofOfIntelligence = lazyWithRetry(() =>
  import('./components/modules/ProofOfIntelligence').then((m) => ({ default: m.ProofOfIntelligence }))
);
const InfrastructureCloud = lazyWithRetry(() =>
  import('./components/modules/InfrastructureCloud').then((m) => ({ default: m.InfrastructureCloud }))
);
const AIAssistantDrawer = lazyWithRetry(() =>
  import('./components/AIAssistantDrawer').then((m) => ({ default: m.AIAssistantDrawer }))
);
const EvidenceViewerDrawer = lazyWithRetry(() =>
  import('./components/EvidenceViewerDrawer').then((m) => ({ default: m.EvidenceViewerDrawer }))
);
const GlobalSearchModal = lazyWithRetry(() =>
  import('./components/GlobalSearchModal').then((m) => ({ default: m.GlobalSearchModal }))
);
const PerformanceTrendsChart = lazyWithRetry(() =>
  import('./components/PerformanceTrendsChart').then((m) => ({ default: m.PerformanceTrendsChart }))
);

type LogSemanticCategory = 'I/O' | 'Computation' | 'Authentication' | 'System';

const SEMANTIC_CATEGORY_ORDER: LogSemanticCategory[] = ['Authentication', 'I/O', 'Computation', 'System'];

function isResolvedLogLine(entry: string): boolean {
  return /\[(DONE|VERIFIED)\]/i.test(entry);
}

function classifyLogSemanticFunction(entry: string): LogSemanticCategory {
  if (/\b(auth|oauth|login|logout|token|jwt|session|rbac|role|permission|credential|firebase|tenant|secret|unauthorized|forbidden|401|403|verify_id_token|identity)\b/i.test(entry)) {
    return 'Authentication';
  }
  if (/\b(fetch|http|https|request|response|stream|read|write|file|disk|storage|upload|download|export|import|socket|db|database|sql|sqlite|firestore|save|load|network|api|endpoint|cache|json|csv|markdown)\b|\/api\//i.test(entry)) {
    return 'I/O';
  }
  if (/\b(compute|calculate|eval|matrix|tensor|loss|grad|gradient|step|epoch|train|infer|inference|embed|vector|reason|plan|architect|coder|debugger|tester|exitcode|compile|build|lint|parse|hash|sha-256|sha256|benchmark|score|tokenize|algorithm|sort|lru)\b|^\[(?:CODER|TESTER|ARCHITECT|DEBUGGER)\]/i.test(entry)) {
    return 'Computation';
  }
  return 'System';
}

function getSemanticCategoryBadgeClass(category: LogSemanticCategory): string {
  switch (category) {
    case 'I/O':
      return 'bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]';
    case 'Computation':
      return 'bg-[color-mix(in_srgb,var(--app-amber)_16%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)]';
    case 'Authentication':
      return 'bg-[color-mix(in_srgb,var(--z-danger)_16%,transparent)] text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)]';
    case 'System':
    default:
      return 'bg-[color-mix(in_srgb,var(--z-ok)_16%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]';
  }
}

type SentimentEventKind = 'error' | 'completion' | 'neutral';

interface SentimentEventSchemaEntry {
  readonly kind: SentimentEventKind;
  readonly label: 'Error' | 'Completion' | 'Neutral';
  readonly delta: -1 | 0 | 1;
  readonly deltaLabel: '-1 ↓' | '0 →' | '+1 ↑';
  readonly description: string;
  readonly color: string;
  readonly badgeClass: string;
  readonly Icon: typeof AlertCircle;
  readonly match?: RegExp;
}

const SENTIMENT_EVENT_SCHEMA: Record<SentimentEventKind, SentimentEventSchemaEntry> = {
  error: {
    kind: 'error',
    label: 'Error',
    delta: -1,
    deltaLabel: '-1 ↓',
    description: 'Negative shift — error, failure, or blocked step.',
    color: 'var(--z-danger)',
    badgeClass:
      'bg-[color-mix(in_srgb,var(--z-danger)_18%,transparent)] text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)]',
    Icon: AlertCircle,
    match: /\[ERROR\]|fail|error|blocked/i,
  },
  completion: {
    kind: 'completion',
    label: 'Completion',
    delta: 1,
    deltaLabel: '+1 ↑',
    description: 'Positive shift — step verified or completed.',
    color: 'var(--z-ok)',
    badgeClass:
      'bg-[color-mix(in_srgb,var(--z-ok)_18%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)]',
    Icon: CheckCircle2,
    match: /\[DONE\]|success|verified|exitCode:\s*0|passed/i,
  },
  neutral: {
    kind: 'neutral',
    label: 'Neutral',
    delta: 0,
    deltaLabel: '0 →',
    description: 'Neutral shift — trace or informational event.',
    color: 'var(--app-accent)',
    badgeClass:
      'bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]',
    Icon: Activity,
  },
};

const SENTIMENT_EVENT_LOOKUP_ORDER: readonly SentimentEventKind[] = ['error', 'completion', 'neutral'];

function resolveSentimentEventSchema(logEntry: string): SentimentEventSchemaEntry {
  for (const kind of SENTIMENT_EVENT_LOOKUP_ORDER) {
    const entry = SENTIMENT_EVENT_SCHEMA[kind];
    if (entry.match && entry.match.test(logEntry)) {
      return entry;
    }
  }
  return SENTIMENT_EVENT_SCHEMA.neutral;
}

function compileLogSearchRegex(query: string): { regex: RegExp | null; error: string | null } {
  if (!query.trim()) return { regex: null, error: null };
  try {
    const trimmed = query.trim();
    const literalMatch = trimmed.match(/^\/(.+)\/([dgimsuvy]*)$/);
    if (literalMatch) {
      const [, pattern, rawFlags] = literalMatch;
      const safeFlags = rawFlags.replace(/[gy]/g, '');
      return { regex: new RegExp(pattern, safeFlags), error: null };
    }
    return { regex: new RegExp(query, 'i'), error: null };
  } catch (err) {
    return {
      regex: null,
      error: err instanceof Error ? err.message : 'Invalid regular expression'
    };
  }
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderMatchHighlights(
  fragment: string,
  highlightRegex: RegExp | null | undefined,
  theme: 'emerald_dark' | 'high_contrast',
  keyPrefix: string
): React.ReactNode {
  if (!fragment || !highlightRegex) return fragment;
  const globalFlags = highlightRegex.flags.includes('g')
    ? highlightRegex.flags
    : `${highlightRegex.flags}g`;
  let matcher: RegExp;
  try {
    matcher = new RegExp(highlightRegex.source, globalFlags);
  } catch {
    return fragment;
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matchCount = 0;

  while ((match = matcher.exec(fragment)) !== null && matchCount < 200) {
    if (match[0].length === 0) {
      if (matcher.lastIndex >= fragment.length) break;
      matcher.lastIndex += 1;
      continue;
    }
    if (match.index > lastIndex) {
      nodes.push(
        <React.Fragment key={`${keyPrefix}-t-${matchCount}`}>
          {fragment.slice(lastIndex, match.index)}
        </React.Fragment>
      );
    }
    nodes.push(
      <mark
        key={`${keyPrefix}-m-${matchCount}`}
        className={
          theme === 'high_contrast'
            ? 'bg-[var(--app-text-primary)] text-[var(--app-bg)] font-bold px-0.5 rounded-sm'
            : 'bg-[color-mix(in_srgb,var(--app-accent)_28%,transparent)] text-[var(--app-text-primary)] border-b border-[var(--app-accent)] px-0.5 rounded-sm'
        }
      >
        {match[0]}
      </mark>
    );
    lastIndex = match.index + match[0].length;
    matchCount += 1;
  }

  if (matchCount === 0) return fragment;
  if (lastIndex < fragment.length) {
    nodes.push(
      <React.Fragment key={`${keyPrefix}-tail`}>
        {fragment.slice(lastIndex)}
      </React.Fragment>
    );
  }
  return nodes;
}

export const REGEX_SEARCH_PRESETS: Array<{ label: string; pattern: string }> = [
  { label: '[ERROR] [auth]', pattern: '\\[ERROR\\]\\s*\\[auth\\]' },
  { label: 'Stack traces', pattern: '(?:at\\s+.+:\\d+|Traceback|File\\s+".+",\\s+line\\s+\\d+)' },
  { label: 'Non-zero / Fail', pattern: '(?:ERROR|FATAL|Exception|exitCode:\\s*[1-9]\\d*)' },
  { label: 'Agent roles', pattern: '\\[(?:ARCHITECT|CODER|DEBUGGER|TESTER)\\]' },
  { label: 'Warnings', pattern: '\\[WARN\\]\\s*.*' }
];

/**
 * Basic syntax highlighting for native intelligence execution logs.
 * Uses regex to parse and highlight common keywords like [ERROR], [INIT], [DONE], [TESTER], [WARN], etc.
 * with accessible, distinctive color themes, plus optional search match highlighting.
 */
export function renderHighlightedLog(
  text: string,
  theme: 'emerald_dark' | 'high_contrast',
  highlightRegex?: RegExp | null
): React.ReactNode {
  if (!text) return null;

  // Match full [WARN] warning messages first, then bracketed keywords and standalone status keywords.
  const regex = /(\[WARN\][^\r\n]*|\[(?:ERROR|INIT|DONE|TESTER|ARCHITECT|CODER|DEBUGGER|AUDIT|STEP)\]|\b(?:ERROR|FAIL|FAILED|FATAL)\b|\b(?:DONE|SUCCESS|PASSED|VERIFIED)\b|\b(?:WARN|WARNING)\b|\b(?:INIT|START|STARTED)\b)/gi;

  const parts = text.split(regex);
  if (parts.length === 1) {
    return renderMatchHighlights(text, highlightRegex, theme, 'single');
  }

  return parts.map((part, index) => {
    if (!part) return null;
    const lower = part.toLowerCase();

    // Dedicated warning-message highlight style for [WARN]\s*.*
    const warnMessageMatch = part.match(/^(\[WARN\])(\s*)(.*)$/i);
    if (warnMessageMatch) {
      const [, warnTag, warnSpace, warnBody] = warnMessageMatch;
      return (
        <span
          key={index}
          data-log-highlight="warn-message"
          className={`inline-flex flex-wrap items-baseline gap-1 px-1.5 py-0.5 rounded-md font-mono text-[11px] border-l-2 ${
            theme === 'high_contrast'
              ? 'bg-[color-mix(in_srgb,var(--z-warn)_18%,transparent)] text-[var(--z-warn)] border border-[var(--z-warn)] font-semibold shadow-sm'
              : 'bg-[color-mix(in_srgb,var(--z-warn)_14%,transparent)] text-[var(--app-text-primary)] border border-[color-mix(in_srgb,var(--z-warn)_42%,transparent)] border-l-[var(--z-warn)] shadow-sm'
          }`}
        >
          <span
            data-log-highlight="warn-tag"
            className={`font-mono font-bold px-1 py-0.2 rounded text-[10px] tracking-wide uppercase shrink-0 ${
              theme === 'high_contrast'
                ? 'bg-[var(--z-warn)] text-black'
                : 'bg-[color-mix(in_srgb,var(--z-warn)_25%,transparent)] text-[var(--z-warn)] border border-[color-mix(in_srgb,var(--z-warn)_50%,transparent)]'
            }`}
          >
            {warnTag}
          </span>
          {warnBody ? (
            <span
              data-log-highlight="warn-text"
              className="text-[var(--z-warn)] font-medium"
            >
              {warnSpace}
              {renderMatchHighlights(warnBody, highlightRegex, theme, `warn-${index}`)}
            </span>
          ) : null}
        </span>
      );
    }

    // Standalone WARN / WARNING keyword highlight
    if (lower === 'warn' || lower === 'warning') {
      return (
        <span
          key={index}
          data-log-highlight="warn-keyword"
          className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${
            theme === 'high_contrast'
              ? 'bg-[color-mix(in_srgb,var(--z-warn)_22%,transparent)] text-[var(--z-warn)] border border-[var(--z-warn)] shadow-sm'
              : 'bg-[color-mix(in_srgb,var(--z-warn)_22%,transparent)] text-[var(--z-warn)] border border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)] shadow-sm'
          }`}
        >
          {part}
        </span>
      );
    }

    // Red / Rose for [ERROR], ERROR, FAIL, FAILED, FATAL
    if (lower === '[error]' || lower === 'error' || lower === 'fail' || lower === 'failed' || lower === 'fatal') {
      return (
        <span
          key={index}
          className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${
            theme === 'high_contrast'
              ? 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)] border border-[var(--z-danger)] shadow-sm'
              : 'bg-[color-mix(in_srgb,var(--z-danger)_25%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] shadow-sm shadow-rose-950/40'
          }`}
        >
          {part}
        </span>
      );
    }

    // Cyan / Sky for [INIT], INIT, START, STARTED
    if (lower === '[init]' || lower === 'init' || lower === 'start' || lower === 'started') {
      return (
        <span
          key={index}
          className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${
            theme === 'high_contrast'
              ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border border-[var(--app-accent)] shadow-sm'
              : 'bg-[color-mix(in_srgb,var(--app-accent)_25%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] shadow-sm '
          }`}
        >
          {part}
        </span>
      );
    }

    // Emerald / Green for [DONE], DONE, SUCCESS, PASSED, VERIFIED
    if (lower === '[done]' || lower === 'done' || lower === 'success' || lower === 'passed' || lower === 'verified') {
      return (
        <span
          key={index}
          className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${
            theme === 'high_contrast'
              ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)] border border-[var(--z-ok)] shadow-sm'
              : 'bg-[color-mix(in_srgb,var(--z-ok)_25%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)] shadow-sm '
          }`}
        >
          {part}
        </span>
      );
    }

    // Amber for [TESTER]
    if (lower === '[tester]') {
      return (
        <span
          key={index}
          className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${
            theme === 'high_contrast'
              ? 'bg-[color-mix(in_srgb,var(--app-amber)_20%,transparent)] text-[var(--app-amber)] border border-[var(--app-amber)] shadow-sm'
              : 'bg-[color-mix(in_srgb,var(--app-amber)_25%,transparent)] text-[var(--app-amber)] border border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)] shadow-sm shadow-amber-950/40'
          }`}
        >
          {part}
        </span>
      );
    }

    // Indigo / Violet for agent roles [ARCHITECT], [CODER], [DEBUGGER], [AUDIT], [STEP]
    if (
      lower === '[architect]' ||
      lower === '[coder]' ||
      lower === '[debugger]' ||
      lower === '[audit]' ||
      lower === '[step]'
    ) {
      return (
        <span
          key={index}
          className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${
            theme === 'high_contrast'
              ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border border-[var(--app-accent)] shadow-sm'
              : 'bg-[color-mix(in_srgb,var(--app-accent)_25%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] shadow-sm '
          }`}
        >
          {part}
        </span>
      );
    }

    return (
      <React.Fragment key={index}>
        {renderMatchHighlights(part, highlightRegex, theme, `p-${index}`)}
      </React.Fragment>
    );
  });
}

export default function App() {
  const { t, lang } = useLanguage();
  const { role, session, isAuthenticated, sessionExpired, authHeaders, login, loginWithGoogle, devAccessEnabled, authError } = useAuth();
  const [activeModule, setActiveModule] = useState<ModuleId>('command_center');
  const [settingsInitialSection, setSettingsInitialSection] = useState<ControlSection | undefined>(undefined);
  const [returnToModule, setReturnToModule] = useState<ModuleId | null>(null);
  const { connectivity: liveConnectivity, credentialsRevision } = useReconnectionService();
  const [statusData, setStatusData] = useState<SystemStatusData | null>(null);
  const [truthData, setTruthData] = useState<any>(null);
  const [trainingReadiness, setTrainingReadiness] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('zyntheor_context_panel') === 'open';
  });
  const [isQuickTaskOpen, setIsQuickTaskOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [evidenceDrawerItem, setEvidenceDrawerItem] = useState<EvidenceDrawerItem | null>(null);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [assistantOpenedAt, setAssistantOpenedAt] = useState<string | null>(null);
  const quickGoalInputRef = useRef<HTMLInputElement | null>(null);

  const openAuthSettings = useCallback(
    (section: ControlSection = 'account') => {
      setReturnToModule((prev) => (activeModule !== 'user_settings' ? activeModule : prev));
      setSettingsInitialSection(section);
      setActiveModule('user_settings');
    },
    [activeModule]
  );

  const handleReturnToTask = useCallback(() => {
    if (returnToModule && returnToModule !== 'user_settings') {
      setActiveModule(returnToModule);
      setReturnToModule(null);
    }
  }, [returnToModule]);

  // Quick Modal Execution State
  const [quickGoal, setQuickGoal] = useState('');
  const [isQuickRunning, setIsQuickRunning] = useState(false);
  const [isCreatingSoftwareProject, setIsCreatingSoftwareProject] = useState(false);
  const [lastCreatedProject, setLastCreatedProject] = useState<{ projectId: string; name: string; stack: string } | null>(null);
  const [quickLogs, setQuickLogs] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('zyntheor_quick_logs');
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const [quickDone, setQuickDone] = useState(false);
  const [snapshots, setSnapshots] = useState<Array<{ id: string; timestamp: string; goal: string; logs: string[] }>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('zyntheor_log_snapshots');
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const [isSnapshotDrawerOpen, setIsSnapshotDrawerOpen] = useState(false);
  const [logTheme, setLogTheme] = useState<'emerald_dark' | 'high_contrast'>('emerald_dark');
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [logTagFilter, setLogTagFilter] = useState<'ALL' | 'INIT' | 'TESTER' | 'DONE' | 'ERROR'>('ALL');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logSearchMode, setLogSearchMode] = useState<'text' | 'regex' | 'semantic'>('text');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsRate, setTtsRate] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zyntheor_tts_rate');
      const parsed = saved ? parseFloat(saved) : 1.0;
      return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2.0 ? parsed : 1.0;
    }
    return 1.0;
  });
  const [ttsPitch, setTtsPitch] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zyntheor_tts_pitch');
      const parsed = saved ? parseFloat(saved) : 1.0;
      return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2.0 ? parsed : 1.0;
    }
    return 1.0;
  });
  const [ttsVolume, setTtsVolume] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zyntheor_tts_volume');
      const parsed = saved ? parseFloat(saved) : 1.0;
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2.0 ? parsed : 1.0;
    }
    return 1.0;
  });
  const [hoveredTrendIndex, setHoveredTrendIndex] = useState<number | null>(null);
  const [logTextWrap, setLogTextWrap] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zyntheor_log_text_wrap');
      return saved === null ? true : saved !== 'false';
    }
    return true;
  });
  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zyntheor_log_line_numbers');
      return saved === null ? true : saved !== 'false';
    }
    return true;
  });
  const [activeTtsLineIndex, setActiveTtsLineIndex] = useState<number | null>(null);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsQueueLength, setTtsQueueLength] = useState(0);
  const activeTtsRowRef = useRef<HTMLDivElement | null>(null);
  const ttsQueueRef = useRef<Array<{ lineText: string; lineIdx: number }>>([]);
  const isTtsSpeakingRef = useRef(false);
  const ttsPausedRef = useRef(false);
  const ttsEnabledRef = useRef(ttsEnabled);
  const ttsSessionTokenRef = useRef(0);
  const ttsSpectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ttsSpeechEnergyRef = useRef(0);
  const [logTimeMode, setLogTimeMode] = useState<'absolute' | 'relative'>('absolute');
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedLogIndices, setSelectedLogIndices] = useState<number[]>([]);
  const [logCategories, setLogCategories] = useState<Record<number, LogSemanticCategory>>({});
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExportPreviewOpen, setIsExportPreviewOpen] = useState(false);
  const [workspaceContextExported, setWorkspaceContextExported] = useState(false);
  const [criticalActionError, setCriticalActionError] = useState<ButtonFailureReport | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsubscribe = onButtonFailure((report) => {
      if (report.critical) {
        setCriticalActionError(report);
      }
    });
    return unsubscribe;
  }, []);
  const [dashboardView, setDashboardView] = useState<'overview' | 'performance_trends'>('overview');
  const [showPerfMetrics, setShowPerfMetrics] = useState(false);
  const [showPerfTrendsInTerminal, setShowPerfTrendsInTerminal] = useState(false);
  const {
    showSentimentTrend,
    toggleSentimentTrend,
  } = useSentimentTrendShortcut({
    enabled: activeModule === 'command_center' || isQuickTaskOpen,
  });
  const [smartFilterAllowList, setSmartFilterAllowList] = useState<string[]>([]);
  const [hideNonMatchingLogs, setHideNonMatchingLogs] = useState(false);
  const [activeWorkflowStageFilter, setActiveWorkflowStageFilter] = useState<WorkflowStageId | null>(null);
  const [logStepLatencies, setLogStepLatencies] = useState<Array<{ latencyMs: number; timestamp: string }>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('zyntheor_log_latencies');
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const [verificationHash, setVerificationHash] = useState<string | null>(null);
  const [totalExecMs, setTotalExecMs] = useState<number | null>(null);
  const execStartRef = useRef<number | null>(null);
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsVoiceUri, setTtsVoiceUri] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('zyntheor_tts_voice') || '';
    }
    return '';
  });
  const ttsConfigRef = useRef({ ttsRate, ttsPitch, ttsVolume, ttsVoiceUri, ttsVoices });
  ttsEnabledRef.current = ttsEnabled;
  ttsConfigRef.current = { ttsRate, ttsPitch, ttsVolume, ttsVoiceUri, ttsVoices };
  const updateTtsVolume = useCallback((val: number) => {
    const clamped = Math.min(2, Math.max(0, Number(val.toFixed(2))));
    setTtsVolume(clamped);
    ttsConfigRef.current.ttsVolume = clamped;
    try {
      localStorage.setItem('zyntheor_tts_volume', String(clamped));
    } catch {
      // ignore storage errors
    }
  }, []);
  const [logLatencyMs, setLogLatencyMs] = useState<number | null>(null);
  const lastLogTimeRef = useRef<number | null>(null);
  const lastSpokenIndexRef = useRef<number>(-1);
  const prevTtsEnabledRef = useRef<boolean>(ttsEnabled);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const resetTtsQueue = (cancelBrowserSpeech = true) => {
    ttsSessionTokenRef.current += 1;
    ttsQueueRef.current = [];
    setTtsQueueLength(0);
    isTtsSpeakingRef.current = false;
    setActiveTtsLineIndex(null);
    if (cancelBrowserSpeech && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const processTtsQueue = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (!ttsEnabledRef.current || ttsPausedRef.current || isTtsSpeakingRef.current) return;

    const nextItem = ttsQueueRef.current.shift();
    setTtsQueueLength(ttsQueueRef.current.length);
    if (!nextItem) return;

    const sessionToken = ttsSessionTokenRef.current;
    const { lineText, lineIdx } = nextItem;
    const {
      ttsRate: rate,
      ttsPitch: pitch,
      ttsVolume: volume,
      ttsVoiceUri: voiceUri,
      ttsVoices: voices,
    } = ttsConfigRef.current;

    const cleaned = lineText.replace(/^\[[A-Z0-9_]+\]\s*/, '').trim() || lineText;
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = Math.min(1, Math.max(0, volume));
    if (voiceUri) {
      const availableVoices = voices.length > 0 ? voices : window.speechSynthesis.getVoices();
      const matched = availableVoices.find((v) => v.voiceURI === voiceUri || v.name === voiceUri);
      if (matched) utterance.voice = matched;
    }

    isTtsSpeakingRef.current = true;
    ttsSpeechEnergyRef.current = 1.0;
    setActiveTtsLineIndex(lineIdx);

    utterance.onstart = () => {
      if (sessionToken !== ttsSessionTokenRef.current) return;
      ttsSpeechEnergyRef.current = 1.0;
      setActiveTtsLineIndex(lineIdx);
    };

    utterance.onboundary = () => {
      if (sessionToken !== ttsSessionTokenRef.current) return;
      ttsSpeechEnergyRef.current = 1.0;
    };

    const advanceQueue = () => {
      if (sessionToken !== ttsSessionTokenRef.current) return;
      isTtsSpeakingRef.current = false;
      if (ttsQueueRef.current.length === 0) {
        ttsSpeechEnergyRef.current = 0;
        setActiveTtsLineIndex(null);
      }
      processTtsQueue();
    };

    utterance.onend = advanceQueue;
    utterance.onerror = advanceQueue;

    window.speechSynthesis.speak(utterance);
  };

  const speakLogLine = (lineText: string, lineIdx: number, cancelExisting = false) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (cancelExisting) {
      resetTtsQueue(true);
      ttsPausedRef.current = false;
      setTtsPaused(false);
    }
    ttsQueueRef.current.push({ lineText, lineIdx });
    setTtsQueueLength(ttsQueueRef.current.length);
    processTtsQueue();
  };

  const handleToggleTtsPause = () => {
    if (!ttsEnabled) return;
    const nextPaused = !ttsPausedRef.current;
    ttsPausedRef.current = nextPaused;
    setTtsPaused(nextPaused);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (nextPaused) {
        window.speechSynthesis.pause();
      } else {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        processTtsQueue();
      }
    }
  };

  const resolvedLogCount = useMemo(
    () => quickLogs.filter(isResolvedLogLine).length,
    [quickLogs]
  );

  const handleClearResolvedLogs = () => {
    if (resolvedLogCount === 0) return;
    const nextLogs: string[] = [];
    const nextCategories: Record<number, LogSemanticCategory> = {};
    quickLogs.forEach((line, oldIdx) => {
      if (!isResolvedLogLine(line)) {
        const newIdx = nextLogs.length;
        nextLogs.push(line);
        if (logCategories[oldIdx]) {
          nextCategories[newIdx] = logCategories[oldIdx];
        }
      }
    });
    setQuickLogs(nextLogs);
    setLogCategories(nextCategories);
    setSelectedLogIndices([]);
    if (Object.keys(nextCategories).length === 0) {
      setGroupByCategory(false);
    }
    if (ttsEnabled) {
      resetTtsQueue(true);
      lastSpokenIndexRef.current = nextLogs.length - 1;
    }
  };

  // Real-time Audit Hash reconciler (rolling SHA-256 of quickLogs vs sealed baseline)
  const {
    rollingHash,
    fullHash,
    integrityStatus,
    isTampered,
    sealBaseline,
    restoreFromLedger,
    recompute: recomputeIntegrity
  } = useAuditIntegrity(quickLogs);

  const compiledLogSearch = useMemo(
    () => (logSearchMode === 'regex' ? compileLogSearchRegex(logSearchQuery) : { regex: null, error: null }),
    [logSearchMode, logSearchQuery]
  );

  const semanticLogSuggestions = useMemo(
    () => rankLogsBySemanticIntent(quickLogs, logSearchQuery),
    [quickLogs, logSearchQuery]
  );

  const semanticScoreMap = useMemo(() => {
    const map = new Map<number, { scorePct: number; matchedConcepts: string[] }>();
    for (const item of semanticLogSuggestions) {
      map.set(item.originalIdx, { scorePct: item.scorePct, matchedConcepts: item.matchedConcepts });
    }
    return map;
  }, [semanticLogSuggestions]);

  const activeHighlightRegex = useMemo(() => {
    if (!logSearchQuery.trim()) return null;
    if (logSearchMode === 'regex') return compiledLogSearch.regex;
    if (logSearchMode === 'semantic') {
      const tokens = logSearchQuery
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .slice(0, 8)
        .map((w) => escapeRegExpLiteral(w));
      if (tokens.length === 0) return null;
      try {
        return new RegExp(`(${tokens.join('|')})`, 'i');
      } catch {
        return null;
      }
    }
    try {
      return new RegExp(escapeRegExpLiteral(logSearchQuery.trim()), 'i');
    } catch {
      return null;
    }
  }, [logSearchMode, logSearchQuery, compiledLogSearch.regex]);

  const activeWorkflowStageMeta = useMemo(
    () => (activeWorkflowStageFilter ? getWorkflowStageMeta(activeWorkflowStageFilter) ?? null : null),
    [activeWorkflowStageFilter]
  );

  const stageMatchedLineIndices = useMemo(() => {
    if (!activeWorkflowStageFilter) return null;
    return getStageMatchedLineIndices(quickLogs, activeWorkflowStageFilter);
  }, [quickLogs, activeWorkflowStageFilter]);

  const handleFilterTerminalByStage = useCallback((stage: WorkflowStageState) => {
    setActiveWorkflowStageFilter(stage.id);
    setLogTagFilter('ALL');
    setLogSearchMode('regex');
    setLogSearchQuery(stage.terminalFilterQuery);
    setHideNonMatchingLogs(true);
    setSmartFilterAllowList([]);
    setIsQuickTaskOpen(true);
  }, []);

  const handleClearWorkflowStageFilter = useCallback(() => {
    setActiveWorkflowStageFilter(null);
    setLogSearchQuery('');
    setLogSearchMode('text');
    setHideNonMatchingLogs(false);
    setLogTagFilter('ALL');
  }, []);

  const currentSearchMatches = useMemo(() => {
    if (activeWorkflowStageFilter && stageMatchedLineIndices) {
      return quickLogs
        .map((log, originalIdx) => ({ log, originalIdx }))
        .filter(({ log, originalIdx }) => {
          const matchTag = logTagFilter === 'ALL' || log.startsWith(`[${logTagFilter}]`);
          return matchTag && stageMatchedLineIndices.has(originalIdx);
        });
    }
    if (logSearchMode === 'semantic' && logSearchQuery.trim()) {
      return semanticLogSuggestions
        .filter(({ log }) => logTagFilter === 'ALL' || log.startsWith(`[${logTagFilter}]`))
        .map(({ log, originalIdx }) => ({ log, originalIdx }));
    }
    return quickLogs
      .map((log, originalIdx) => ({ log, originalIdx }))
      .filter(({ log }) => {
        const matchTag = logTagFilter === 'ALL' || log.startsWith(`[${logTagFilter}]`);
        if (!matchTag) return false;
        if (!logSearchQuery.trim()) return true;
        if (logSearchMode === 'regex') {
          if (compiledLogSearch.error || !compiledLogSearch.regex) return false;
          return compiledLogSearch.regex.test(log);
        }
        return log.toLowerCase().includes(logSearchQuery.toLowerCase());
      });
  }, [
    quickLogs,
    logTagFilter,
    logSearchQuery,
    logSearchMode,
    compiledLogSearch,
    semanticLogSuggestions,
    activeWorkflowStageFilter,
    stageMatchedLineIndices,
  ]);

  const currentSearchMatchSet = useMemo(
    () => new Set(currentSearchMatches.map((entry) => entry.originalIdx)),
    [currentSearchMatches]
  );

  const allowListSet = useMemo(() => new Set(smartFilterAllowList), [smartFilterAllowList]);
  const hasSearchOrTagFilter = Boolean(
    activeWorkflowStageFilter || logSearchQuery.trim() || logTagFilter !== 'ALL'
  );
  const hasAnyActiveFilter = hasSearchOrTagFilter || smartFilterAllowList.length > 0;

  const isLogEntryMatching = useCallback(
    (log: string, originalIdx: number): boolean => {
      if (!hasAnyActiveFilter) return true;
      if (smartFilterAllowList.length > 0 && !hasSearchOrTagFilter) {
        return allowListSet.has(log);
      }
      if (smartFilterAllowList.length > 0 && hasSearchOrTagFilter) {
        return currentSearchMatchSet.has(originalIdx) || allowListSet.has(log);
      }
      return currentSearchMatchSet.has(originalIdx);
    },
    [hasAnyActiveFilter, smartFilterAllowList.length, hasSearchOrTagFilter, allowListSet, currentSearchMatchSet]
  );

  const matchingLogEntries = useMemo(() => {
    if (logSearchMode === 'semantic' && logSearchQuery.trim() && smartFilterAllowList.length === 0) {
      return currentSearchMatches;
    }
    return quickLogs
      .map((log, originalIdx) => ({ log, originalIdx }))
      .filter(({ log, originalIdx }) => isLogEntryMatching(log, originalIdx));
  }, [quickLogs, logSearchMode, logSearchQuery, smartFilterAllowList.length, currentSearchMatches, isLogEntryMatching]);

  const filteredLogEntries = useMemo(() => {
    if (!hasAnyActiveFilter) {
      return quickLogs.map((log, originalIdx) => ({ log, originalIdx }));
    }
    if (hideNonMatchingLogs) {
      return matchingLogEntries;
    }
    return quickLogs.map((log, originalIdx) => ({ log, originalIdx }));
  }, [quickLogs, hasAnyActiveFilter, hideNonMatchingLogs, matchingLogEntries]);

  const handleApplySmartFilter = useCallback(() => {
    if (quickLogs.length === 0) return;
    const sourceEntries = hasSearchOrTagFilter
      ? currentSearchMatches
      : quickLogs
          .map((log, originalIdx) => ({ log, originalIdx }))
          .filter(({ log }) => /\[(INIT|TESTER|DONE|ERROR)\]/i.test(log));
    const entriesToAllow = sourceEntries.length > 0 ? sourceEntries : currentSearchMatches;
    const uniqueAllowed = Array.from(new Set(entriesToAllow.map((item) => item.log)));
    setSmartFilterAllowList(uniqueAllowed);
  }, [quickLogs, hasSearchOrTagFilter, currentSearchMatches]);

  const performanceTrendPoints = useMemo<StepLatencyPoint[]>(() => {
    if (quickLogs.length === 0) return [];
    const rawLatencies = quickLogs.map((log, idx) => {
      const recorded = logStepLatencies[idx]?.latencyMs;
      if (typeof recorded === 'number' && Number.isFinite(recorded) && recorded >= 0) {
        return recorded;
      }
      const explicitMs = log.match(/(\d+(?:\.\d+)?)\s*ms\b/i);
      if (explicitMs) {
        return Math.max(1, Math.round(Number(explicitMs[1])));
      }
      return 0;
    });
    let runningSum = 0;
    const cumulative = rawLatencies.map((v) => {
      runningSum += v;
      return runningSum;
    });
    return quickLogs.map((log, idx) => {
      const tagMatch = log.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
      const tag = tagMatch ? tagMatch[1] : 'INFO';
      const message = tagMatch ? tagMatch[2] : log;
      return {
        step: idx + 1,
        latencyMs: rawLatencies[idx],
        elapsedMs: cumulative[idx] ?? rawLatencies[idx],
        tag,
        message,
        raw: log,
        timestamp: logStepLatencies[idx]?.timestamp || new Date().toISOString(),
      };
    });
  }, [quickLogs, logStepLatencies]);


  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return;
      setTtsVoices(voices);
      ttsConfigRef.current.ttsVoices = voices;
      const savedVoiceId = localStorage.getItem('zyntheor_tts_voice') || ttsConfigRef.current.ttsVoiceUri;
      if (savedVoiceId) {
        const matched = voices.find((v) => v.voiceURI === savedVoiceId || v.name === savedVoiceId);
        if (matched) {
          setTtsVoiceUri(matched.voiceURI);
          ttsConfigRef.current.ttsVoiceUri = matched.voiceURI;
          if (matched.voiceURI !== savedVoiceId) {
            localStorage.setItem('zyntheor_tts_voice', matched.voiceURI);
          }
        }
      }
    };
    loadVoices();
    if (typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
      return () => {
        window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      };
    }
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    if (!ttsEnabled) {
      resetTtsQueue(true);
      ttsPausedRef.current = false;
      setTtsPaused(false);
    }
  }, [ttsEnabled]);

  useEffect(() => {
    if (ttsEnabled && activeTtsLineIndex !== null) {
      activeTtsRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [ttsEnabled, activeTtsLineIndex]);

  useEffect(() => {
    const canvas = ttsSpectrumCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isPlaying = ttsEnabled && !ttsPaused && activeTtsLineIndex !== null;
    const styles = getComputedStyle(document.documentElement);
    const accentColor = styles.getPropertyValue('--app-accent').trim() || '#22d3ee';
    const amberColor = styles.getPropertyValue('--app-amber').trim() || '#f59e0b';
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const barCount = 16;
    const heights = new Array<number>(barCount).fill(0);

    const drawFrame = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (!isPlaying) {
        return;
      }

      const volScale = Math.min(1, Math.max(0.15, ttsVolume));
      const pitchShift = (ttsPitch - 1.0) * 0.35;
      const cadence = 0.008 * Math.max(0.5, ttsRate);

      // Decay live boundary energy gradually between word syllables
      ttsSpeechEnergyRef.current = Math.max(0.32, ttsSpeechEnergyRef.current * 0.94);
      const energy = ttsSpeechEnergyRef.current;

      const gap = 2;
      const barWidth = Math.max(2, (w - gap * (barCount - 1)) / barCount);

      for (let i = 0; i < barCount; i += 1) {
        const normIdx = i / (barCount - 1);
        const formantCenter = Math.min(0.85, Math.max(0.15, 0.42 + pitchShift));
        const spectralShape = Math.exp(-Math.pow((normIdx - formantCenter) * 2.1, 2));
        const wave = reducedMotion
          ? 0.68
          : 0.48 +
            0.35 * Math.sin(now * cadence + i * 0.85) +
            0.17 * Math.cos(now * cadence * 1.65 - i * 1.3);

        const target = Math.min(1, Math.max(0.08, wave * (0.45 + 0.55 * spectralShape) * volScale * energy));
        heights[i] = reducedMotion ? target : heights[i] * 0.6 + target * 0.4;

        const barH = Math.max(2, Math.round(heights[i] * (h - 4)));
        const x = Math.round(i * (barWidth + gap));
        const y = h - barH;

        ctx.globalAlpha = i % 3 === 0 ? 0.52 : 0.38;
        ctx.fillStyle = normIdx > 0.65 ? amberColor : accentColor;
        ctx.fillRect(x, y, barWidth, barH);
      }
      ctx.globalAlpha = 1;
    };

    if (!isPlaying || reducedMotion) {
      drawFrame(performance.now());
      return;
    }

    let rafId = 0;
    const loop = (now: number) => {
      drawFrame(now);
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(rafId);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [ttsEnabled, ttsPaused, activeTtsLineIndex, ttsVolume, ttsRate, ttsPitch]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    const justEnabledTts = ttsEnabled && !prevTtsEnabledRef.current;
    prevTtsEnabledRef.current = ttsEnabled;

    if (quickLogs.length > 0) {
      const now = performance.now();
      let stepDeltaMs = 0;
      if (lastLogTimeRef.current !== null) {
        stepDeltaMs = Math.max(1, Math.round(now - lastLogTimeRef.current));
        setLogLatencyMs(stepDeltaMs);
      } else if (execStartRef.current !== null) {
        stepDeltaMs = Math.max(1, Math.round(now - execStartRef.current));
        setLogLatencyMs(stepDeltaMs);
      }
      lastLogTimeRef.current = now;

      setLogStepLatencies((prev) => {
        if (quickLogs.length === prev.length) return prev;
        if (quickLogs.length < prev.length) return prev.slice(0, quickLogs.length);
        const next = [...prev];
        const tsIso = new Date().toISOString();
        for (let idx = prev.length; idx < quickLogs.length; idx += 1) {
          const explicitMs = quickLogs[idx].match(/(\d+(?:\.\d+)?)\s*ms\b/i);
          const inferredMs =
            idx === quickLogs.length - 1 && stepDeltaMs > 0
              ? stepDeltaMs
              : explicitMs
              ? Math.max(1, Math.round(Number(explicitMs[1])))
              : stepDeltaMs;
          next.push({ latencyMs: inferredMs, timestamp: tsIso });
        }
        return next;
      });

      const latestIdx = quickLogs.length - 1;
      if (ttsEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (justEnabledTts) {
          ttsQueueRef.current.push({ lineText: quickLogs[latestIdx], lineIdx: latestIdx });
          lastSpokenIndexRef.current = latestIdx;
          setTtsQueueLength(ttsQueueRef.current.length);
          processTtsQueue();
        } else if (latestIdx > lastSpokenIndexRef.current) {
          const startIdx = Math.max(0, lastSpokenIndexRef.current + 1);
          for (let idx = startIdx; idx <= latestIdx; idx += 1) {
            ttsQueueRef.current.push({ lineText: quickLogs[idx], lineIdx: idx });
          }
          lastSpokenIndexRef.current = latestIdx;
          setTtsQueueLength(ttsQueueRef.current.length);
          processTtsQueue();
        }
      }
    } else {
      lastLogTimeRef.current = null;
      lastSpokenIndexRef.current = -1;
      resetTtsQueue(true);
      setLogLatencyMs(null);
      setLogStepLatencies([]);
    }
  }, [quickLogs, ttsEnabled]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('zyntheor_quick_logs', JSON.stringify(quickLogs));
          localStorage.setItem('zyntheor_log_latencies', JSON.stringify(logStepLatencies));
          localStorage.setItem(
            `zyntheor_session_${session.userId}`,
            JSON.stringify({
              quickLogs,
              logTagFilter,
              ttsSettings: { ttsRate, ttsPitch, ttsVolume, ttsVoiceUri }
            })
          );
        } catch {
          // ignore storage quota errors
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [quickLogs, logStepLatencies, logTagFilter, ttsRate, ttsPitch, ttsVolume, ttsVoiceUri, session.userId]);

  // rolling hash now owned by useAuditIntegrity(quickLogs)

  useEffect(() => {
    if (!quickDone || quickLogs.length === 0) return;
    // Seal legitimate run as the trusted baseline for tamper detection
    sealBaseline();
    if (fullHash) setVerificationHash(fullHash);
    if (execStartRef.current !== null) {
      setTotalExecMs(Math.round(performance.now() - execStartRef.current));
    }
  }, [quickDone, quickLogs, sealBaseline, fullHash]);


  const handleCopyLogs = async () => {
    if (quickLogs.length === 0) return;
    try {
      await navigator.clipboard.writeText(quickLogs.join('\n'));
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  const resolveExportEntries = (subsetEntries?: Array<{ log: string; originalIdx: number }>) =>
    Array.isArray(subsetEntries)
      ? subsetEntries
      : quickLogs.map((log, originalIdx) => ({ log, originalIdx }));

  const handleDownloadLogs = (subsetEntries?: Array<{ log: string; originalIdx: number }>) => {
    const entries = resolveExportEntries(subsetEntries);
    if (entries.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const content = [
      `# ZYNTHEOR Sovereign Agent Execution Trace`,
      `# Exported: ${new Date().toISOString()}`,
      `# Entries: ${entries.length}`,
      ``,
      ...entries.map((e) => e.log)
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyntheor-agent-logs-${timestamp}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportLogsJson = (subsetEntries?: Array<{ log: string; originalIdx: number }>) => {
    const entries = resolveExportEntries(subsetEntries);
    if (entries.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const payload = {
      schema: 'ZYNTHEOR_AGENT_SESSION_LOG_V1',
      exportedAt: new Date().toISOString(),
      goal: quickGoal,
      totalEntries: entries.length,
      logs: entries.map(({ log: entry, originalIdx }) => {
        const m = entry.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
        return {
          line: originalIdx + 1,
          tag: m ? m[1] : 'INFO',
          message: m ? m[2] : entry
        };
      })
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyntheor-agent-session-${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportLogsPdf = (subsetEntries?: Array<{ log: string; originalIdx: number }>) => {
    const entries = resolveExportEntries(subsetEntries);
    if (entries.length === 0) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <html>
          <head>
            <title>ZYNTHEOR Agent Audit Trail</title>
            <style>
              body { font-family: monospace; padding: 24px; color: #111; }
              h1 { font-size: 16px; margin-bottom: 4px; }
              .meta { font-size: 11px; color: #555; margin-bottom: 16px; }
              .line { font-size: 11px; padding: 4px 0; border-bottom: 1px solid #eee; white-space: pre-wrap; }
            </style>
          </head>
          <body>
            <h1>ZYNTHEOR — Sovereign Agent Execution Audit Trail</h1>
            <div class="meta">Goal: ${quickGoal}<br/>Exported: ${new Date().toISOString()} | Entries: ${entries.length}</div>
            ${entries.map(({ log: l, originalIdx }) => `<div class="line">${originalIdx + 1}. ${l.replace(/</g, '&lt;')}</div>`).join('')}
          </body>
        </html>
      `);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }
    setTimeout(() => document.body.removeChild(iframe), 1000);
  };

  const handleExportLogsCsv = (subsetEntries?: Array<{ log: string; originalIdx: number }>) => {
    const entries = resolveExportEntries(subsetEntries);
    if (entries.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ['Line', 'Tag', 'SemanticCategory', 'Message'].map(escapeCsv).join(','),
      ...entries.map(({ log: entry, originalIdx }) => {
        const m = entry.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
        const tag = m ? m[1] : 'INFO';
        const message = m ? m[2] : entry;
        const category = logCategories[originalIdx] ?? classifyLogSemanticFunction(entry);
        return [originalIdx + 1, tag, category, message].map(escapeCsv).join(',');
      })
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyntheor-agent-logs-${timestamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportLogsMarkdown = (subsetEntries?: Array<{ log: string; originalIdx: number }>) => {
    const entries = resolveExportEntries(subsetEntries);
    if (entries.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const escapeMd = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const categoryCounts: Record<LogSemanticCategory, number> = {
      'I/O': 0,
      Computation: 0,
      Authentication: 0,
      System: 0
    };
    const tableRows = entries.map(({ log: entry, originalIdx }) => {
      const m = entry.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
      const tag = m ? m[1] : 'INFO';
      const message = m ? m[2] : entry;
      const category = logCategories[originalIdx] ?? classifyLogSemanticFunction(entry);
      categoryCounts[category] += 1;
      return `| ${originalIdx + 1} | \`${escapeMd(tag)}\` | ${category} | ${escapeMd(message)} |`;
    });
    const content = [
      `# ZYNTHEOR — Sovereign Agent Execution Trace`,
      ``,
      `- **Goal:** ${quickGoal || 'N/A'}`,
      `- **Exported:** ${new Date().toISOString()}`,
      `- **Entries:** ${entries.length}`,
      `- **Integrity:** ${integrityStatus}${rollingHash ? ` (\`${rollingHash.slice(0, 16)}\`)` : ''}`,
      ``,
      `## Semantic Breakdown`,
      ``,
      ...SEMANTIC_CATEGORY_ORDER.map((cat) => `- **${cat}:** ${categoryCounts[cat]}`),
      ``,
      `## Execution Logs`,
      ``,
      `| # | Tag | Category | Message |`,
      `| --- | --- | --- | --- |`,
      ...tableRows
    ].join('\n');
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyntheor-agent-logs-${timestamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportWorkspaceContext = useCallback(() => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportedAt = new Date().toISOString();
    const rawFiles = Array.isArray(statusData?.sandbox?.files) ? statusData.sandbox.files : [];
    const payload = {
      schema: 'ZYNTHEOR_WORKSPACE_CONTEXT_AUDIT_V1',
      exportedAt,
      activeModule,
      role,
      tenantId: statusData?.commercial?.activeTenantId ?? null,
      modelArchitecture: statusData?.model?.architecture ?? null,
      model: statusData?.model
        ? {
            name: statusData.model.name,
            architecture: statusData.model.architecture,
            totalParams: statusData.model.totalParams,
            activeParams: statusData.model.activeParams,
            targetParams: statusData.model.targetParams ?? null,
            checkpointHash: statusData.model.checkpointHash,
            checkpointSha256: statusData.model.checkpointSha256 ?? null,
            tokenizerSha256: statusData.model.tokenizerSha256 ?? null,
            weightsLoaded: statusData.model.weightsLoaded,
            inferenceReady: statusData.model.inferenceReady,
            runtimeState: statusData.model.runtimeState,
            executionVerified: statusData.model.executionVerified ?? null,
          }
        : null,
      sandboxFileCount: statusData?.sandbox?.fileCount ?? 0,
      sandbox: {
        path: statusData?.sandbox?.path ?? null,
        fileCount: statusData?.sandbox?.fileCount ?? 0,
        filesSample: rawFiles.slice(0, 25),
      },
      connectivityStatus:
        statusData?.connectivity?.status ??
        (statusData ? 'UNKNOWN' : 'AWAITING_TELEMETRY'),
      connectivity: statusData?.connectivity
        ? {
            online: statusData.connectivity.online,
            status: statusData.connectivity.status,
            runtimeState: statusData.connectivity.runtimeState,
            internetReachable: statusData.connectivity.internetReachable ?? null,
            internetStatus: statusData.connectivity.internetStatus ?? null,
            cloudStorageConfigured: statusData.connectivity.cloudStorageConfigured ?? null,
            cloudStorageReachable: statusData.connectivity.cloudStorageReachable ?? null,
            pythonBridgeReachable: statusData.connectivity.pythonBridgeReachable ?? null,
            executionVerified: statusData.connectivity.executionVerified,
            weightsLoaded: statusData.connectivity.weightsLoaded,
            reason: statusData.connectivity.reason ?? null,
            lastCheckedAt: statusData.connectivity.lastCheckedAt ?? null,
            lastOnlineAt: statusData.connectivity.lastOnlineAt ?? null,
          }
        : {
            online: typeof navigator !== 'undefined' ? navigator.onLine : null,
            status: 'AWAITING_TELEMETRY',
            runtimeState: statusData?.model?.runtimeState ?? 'UNKNOWN',
          },
      auditVerification: {
        chainValid: statusData?.audit?.chainValid ?? null,
        totalRecords: statusData?.audit?.totalRecords ?? null,
        headHash: statusData?.audit?.headHash ?? null,
        logIntegrityStatus: integrityStatus,
        rollingLogHash: rollingHash || null,
      },
      serverTime: statusData?.serverTime ?? null,
      uptimeSeconds: statusData?.uptimeSeconds ?? null,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyntheor-workspace-context-${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setWorkspaceContextExported(true);
    setTimeout(() => setWorkspaceContextExported(false), 2000);
  }, [statusData, activeModule, role, integrityStatus, rollingHash]);

  const handleAutoCategorizeLogs = () => {
    if (quickLogs.length === 0) return;
    const targetIndices =
      selectedLogIndices.length > 0
        ? selectedLogIndices
        : quickLogs.map((_, idx) => idx);
    setLogCategories((prev) => {
      const next = { ...prev };
      for (const idx of targetIndices) {
        if (quickLogs[idx] !== undefined) {
          next[idx] = classifyLogSemanticFunction(quickLogs[idx]);
        }
      }
      return next;
    });
    setGroupByCategory(true);
  };

  const handleTakeSnapshot = () => {
    if (quickLogs.length === 0) return;
    const snap = {
      id: `snap-${Date.now()}`,
      timestamp: new Date().toISOString(),
      goal: quickGoal,
      logs: [...quickLogs]
    };
    const updated = [snap, ...snapshots].slice(0, 20);
    setSnapshots(updated);
    try {
      localStorage.setItem('zyntheor_log_snapshots', JSON.stringify(updated));
    } catch {
      // ignore storage quota errors
    }
  };

  const fetchStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const headers = authHeaders();
      const hasAuthToken = Boolean(isAuthenticated && headers.Authorization);
      const [statusRes, truthRes, readinessRes] = await Promise.all([
        fetch('/api/system/status', { headers, cache: 'no-store' }),
        hasAuthToken
          ? fetch('/api/dashboard/truth', { headers, cache: 'no-store' }).catch(() => null)
          : Promise.resolve(null),
        fetch('/api/system/training-readiness', { headers, cache: 'no-store' }).catch(() => null),
      ]);
      const data = await statusRes.json().catch(() => null);
      if (data?.success) {
        setStatusData(data);
      }
      if (!hasAuthToken) {
        setTruthData(null);
      } else if (truthRes?.ok) {
        const tJson = await truthRes.json().catch(() => null);
        if (tJson?.success && tJson.truth) setTruthData(tJson.truth);
      }
      if (readinessRes?.ok) {
        const rJson = await readinessRes.json().catch(() => null);
        if (rJson?.success) setTrainingReadiness(rJson);
      }
    } catch (err) {
      console.warn('Status endpoint temporarily unavailable:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [authHeaders, isAuthenticated]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    if (!statusData?.training?.running) return;
    const fastInterval = setInterval(fetchStatus, 3500);
    return () => clearInterval(fastInterval);
  }, [statusData?.training?.running, fetchStatus]);

  useEffect(() => {
    if (credentialsRevision > 0) {
      void fetchStatus();
    }
  }, [credentialsRevision, liveConnectivity.online, fetchStatus]);

  useEffect(() => {
    if (isAssistantOpen) {
      setAssistantOpenedAt(new Date().toISOString());
    }
  }, [isAssistantOpen]);

  const assistantModuleState = useMemo(() => {
    const moduleDetails: Record<string, unknown> = {};
    if (statusData) {
      if (
        activeModule === 'command_center' ||
        activeModule === 'intelligence_core' ||
        activeModule === 'model_laboratory' ||
        activeModule === 'experiment_center'
      ) {
        moduleDetails.model = {
          name: statusData.model.name,
          architecture: statusData.model.architecture,
          runtimeState: statusData.model.runtimeState,
          weightsLoaded: statusData.model.weightsLoaded,
          inferenceReady: statusData.model.inferenceReady,
          totalParams: statusData.model.totalParams,
          activeParams: statusData.model.activeParams,
          readinessReason: statusData.model.readinessReason,
        };
      }
      if (activeModule === 'subscription_billing' || activeModule === 'analytics_bi') {
        moduleDetails.commercial = {
          phase: statusData.commercial.currentPhase,
          tenantId: statusData.commercial.activeTenantId,
          planId: statusData.commercial.activePlanId,
          tasksCompleted: statusData.commercial.tasksCompleted,
          tasksFailed: statusData.commercial.tasksFailed,
          taskCompletionRate: statusData.commercial.taskCompletionRate,
        };
      }
      if (activeModule === 'governance_security' || activeModule === 'admin_console') {
        moduleDetails.audit = statusData.audit;
      }
      if (activeModule === 'knowledge_hub' || activeModule === 'dev_studio') {
        moduleDetails.sandboxFileCount = statusData.sandbox.fileCount;
      }
    }

    return {
      moduleId: activeModule,
      moduleLabel: t(`nav.${activeModule}`),
      openedAt: assistantOpenedAt || undefined,
      isContextRailOpen: isContextOpen,
      quickTask: {
        isOpen: isQuickTaskOpen,
        goal: quickGoal,
        isRunning: isQuickRunning,
        done: quickDone,
        logCount: quickLogs.length,
      },
      logTerminal: {
        totalLogs: quickLogs.length,
        searchMode: logSearchMode,
        searchQuery: logSearchQuery,
        tagFilter: logTagFilter,
        integrityStatus,
        ttsEnabled,
      },
      ...(Object.keys(moduleDetails).length > 0 ? { moduleDetails } : {}),
    };
  }, [
    activeModule,
    t,
    assistantOpenedAt,
    isContextOpen,
    isQuickTaskOpen,
    quickGoal,
    isQuickRunning,
    quickDone,
    quickLogs.length,
    logSearchMode,
    logSearchQuery,
    logTagFilter,
    integrityStatus,
    ttsEnabled,
    statusData,
  ]);

  const assistantWorkspaceMetadata = useMemo(() => {
    if (!statusData) return undefined;
    const rawFiles = Array.isArray(statusData.sandbox?.files) ? statusData.sandbox.files : [];
    const userFacingFiles = rawFiles.filter((f) => !f.startsWith('.zyntheor/snapshots/'));
    const sampleFiles = (userFacingFiles.length > 0 ? userFacingFiles : rawFiles).slice(0, 25);
    const currentRes = statusData.resources?.current;
    const bridgeVal = statusData.connectivity?.bridgeLifecycle as any;

    return {
      tenantId: statusData.commercial?.activeTenantId,
      planId: statusData.commercial?.activePlanId,
      commercialPhase: statusData.commercial?.currentPhase,
      sandboxPath: statusData.sandbox?.path,
      sandboxFileCount: statusData.sandbox?.fileCount,
      sandboxFilesSample: sampleFiles,
      model: {
        name: statusData.model?.name,
        architecture: statusData.model?.architecture,
        runtimeState: statusData.model?.runtimeState,
        weightsLoaded: statusData.model?.weightsLoaded,
        inferenceReady: statusData.model?.inferenceReady,
        executionVerified: statusData.model?.executionVerified,
        checkpointHash: statusData.model?.checkpointHash,
      },
      audit: statusData.audit,
      connectivity: statusData.connectivity
        ? {
            online: statusData.connectivity.online,
            status: statusData.connectivity.status,
            runtimeState: statusData.connectivity.runtimeState,
            bridgeLifecycle: typeof bridgeVal === 'object' && bridgeVal !== null ? bridgeVal.state : bridgeVal,
            cloudStorageConfigured: statusData.connectivity.cloudStorageConfigured,
            pythonBridgeReachable: statusData.connectivity.pythonBridgeReachable,
          }
        : undefined,
      resources: currentRes
        ? {
            loadAvg1m: currentRes.loadAvg1m,
            cpuCores: currentRes.cpuCores,
            processRssMb: currentRes.processRssMb,
            systemRamUsedMb: currentRes.systemRamUsedMb,
            systemRamTotalMb: currentRes.systemRamTotalMb,
            tokensPerSec: currentRes.tokensPerSec,
            lastInferenceLatencyMs: currentRes.lastInferenceLatencyMs,
          }
        : undefined,
      serverTime: statusData.serverTime,
      uptimeSeconds: statusData.uptimeSeconds,
    };
  }, [statusData]);

  const handleIntegrityAutoRecovery = async () => {
    const result = await restoreFromLedger();
    if (result.ok && result.logs) {
      setQuickLogs(result.logs);
      try {
        localStorage.setItem('zyntheor_quick_logs', JSON.stringify(result.logs));
      } catch { /* ignore */ }
    } else {
      console.error('Integrity Auto-Recovery failed', result.error);
    }
  };

  const handleRunQuickAgent = async (goalOverride?: unknown) => {
    const effectiveGoal =
      typeof goalOverride === 'string' && goalOverride.trim() ? goalOverride.trim() : quickGoal;
    if (!effectiveGoal.trim() || isQuickRunning) return;
    setIsQuickRunning(true);
    setQuickDone(false);
    setVerificationHash(null);
    setTotalExecMs(null);
    execStartRef.current = performance.now();
    lastLogTimeRef.current = execStartRef.current;
    setLogStepLatencies([]);
    setLogCategories({});
    setGroupByCategory(false);
    setSelectedLogIndices([]);
    lastSpokenIndexRef.current = -1;
    resetTtsQueue(true);
    setTtsPaused(false);
    ttsPausedRef.current = false;
    setQuickLogs([`[INIT] Dispatching Action-Driven Engine for: "${effectiveGoal}"`]);

    try {
      const response = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ goal: effectiveGoal, mode: 'action_driven', actionMode: 'engineering_blueprint_execute' })
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || errPayload.message || `Execution failed (HTTP ${response.status})`);
      }

      if (!response.body) throw new Error('Stream unavailable');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev: OrchestrationEvent = JSON.parse(line);
            if (ev.type === 'step') {
              setQuickLogs((prev) => [...prev, `[${ev.role || 'STEP'}] ${ev.message}`]);
            } else if (ev.type === 'review') {
              setQuickLogs((prev) => [...prev, `[${ev.role || 'REVIEWER'}] ${ev.message}`]);
            } else if (ev.type === 'test') {
              setQuickLogs((prev) => [
                ...prev,
                `[TESTER] exitCode: ${ev.data?.exitCode} | ${ev.message}`
              ]);
            } else if (ev.type === 'done') {
              if (ev.data?.executionCycle?.executionEvidenceHash) {
                setVerificationHash(ev.data.executionCycle.executionEvidenceHash);
              }
              if (typeof ev.data?.durationMs === 'number') {
                setTotalExecMs(ev.data.durationMs);
              }
              setQuickLogs((prev) => [...prev, `[DONE] ${ev.message}`]);
              setQuickDone(true);
            } else if ((ev as any).type === 'final_result') {
              const payload = ev.data || {};
              const mission = payload.mission || payload;
              const cycle = payload.executionCycle || mission.executionCycle || {};
              const evidenceHash = cycle.executionEvidenceHash || mission.executionEvidenceHash;
              if (typeof evidenceHash === 'string' && evidenceHash) setVerificationHash(evidenceHash);
              const duration = cycle.executionDurationMs ?? mission.executionDurationMs ?? payload.durationMs;
              if (typeof duration === 'number') setTotalExecMs(duration);
              const delivered = payload.success === true || mission.status === 'DELIVERED' || cycle.deliveryStatus === 'DELIVERED';
              const blocked = mission.status === 'BLOCKED' || cycle.deliveryStatus === 'BLOCKED' || cycle.lifecycleStatus === 'Blocked';
              const detail = mission.failureReason || cycle.limitations?.join('; ') || 'Execution result received';
              setQuickLogs((prev) => [...prev, delivered ? `[DONE] ${detail}` : blocked ? `[BLOCKED] ${detail}` : `[RESULT] ${detail}`]);
              setQuickDone(delivered);
            } else if (ev.type === 'error') {
              setQuickLogs((prev) => [...prev, `[ERROR] ${ev.message}`]);
            }
          } catch {
            // ignore partial NDJSON line
          }
        }
      }
      fetchStatus();
    } catch (err: any) {
      setQuickLogs((prev) => [...prev, `[ERROR] ${err.message}`]);
    } finally {
      setIsQuickRunning(false);
    }
  };

  const handleCreateSoftwareProject = async (
    stack: 'node_fullstack' | 'node_api' | 'python_service' | 'static_web'
  ) => {
    const promptText = quickGoal.trim();
    if (!promptText || isCreatingSoftwareProject) return;

    if (!isAuthenticated || (role !== 'Developer' && role !== 'Administrator')) {
      setQuickLogs((prev) => [
        ...prev,
        `[BLOCKED] ${lang === 'th' ? 'ต้องเข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator เพื่อสร้างโปรเจกต์ซอฟต์แวร์จริง' : 'Developer or Administrator role required to scaffold software projects.'}`,
      ]);
      openAuthSettings('account');
      return;
    }

    setIsCreatingSoftwareProject(true);
    setQuickDone(false);
    setVerificationHash(null);
    const t0 = performance.now();
    setQuickLogs([
      `[INIT] SoftwareProjectManager: "${promptText}" (${stack})`,
      `[PLANNER] Analyzing requirements, architecture endpoints, and data schema...`,
    ]);

    try {
      const response = await fetch('/api/engineering/projects', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt: promptText, stack, runChecks: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || `Project creation failed (HTTP ${response.status})`);
      }
      const proj = data.project;
      const latestEv = Array.isArray(proj?.evidenceHistory) ? proj.evidenceHistory[0] : null;
      if (latestEv?.evidenceHash) {
        setVerificationHash(latestEv.evidenceHash);
      }
      setTotalExecMs(Math.max(1, Math.round(performance.now() - t0)));
      setLastCreatedProject({
        projectId: proj.projectId,
        name: proj.name,
        stack: proj.stack,
      });
      setQuickLogs((prev) => [
        ...prev,
        `[CODER] Scaffolded ${proj.revisions?.[0]?.files?.length ?? 0} project file(s) in ${proj.currentRevision}`,
        `[TESTER] Build: ${proj.lastBuild?.status || 'NOT_RUN'} | Tests: ${proj.lastTests ? `${proj.lastTests.passed}/${proj.lastTests.total} (${proj.lastTests.status})` : 'NOT_RUN'} | Security: ${proj.lastSecurityScan?.status || 'NOT_RUN'}`,
        `[DONE] Project "${proj.name}" ready in DevStudio`,
      ]);
      setQuickDone(true);
      void fetchStatus();
    } catch (err: any) {
      setQuickLogs((prev) => [...prev, `[ERROR] ${err?.message || 'Software project creation failed'}`]);
    } finally {
      setIsCreatingSoftwareProject(false);
    }
  };

  // Bridge live Production Integration events (/ws/runtime -> window) into the existing 7-stage Workflow Timeline
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleWorkflowEvent = (evt: Event) => {
      const detail = (evt as CustomEvent<any>)?.detail;
      if (!detail || typeof detail.logLine !== 'string') return;
      if (detail.goal && typeof detail.goal === 'string') {
        setQuickGoal(detail.goal);
      }
      if (typeof detail.isRunning === 'boolean') {
        setIsQuickRunning(detail.isRunning);
      }
      if (detail.isDone === true) {
        setQuickDone(true);
      } else if (detail.resetLogs) {
        setQuickDone(false);
      }
      if (typeof detail.verificationHash === 'string' && detail.verificationHash) {
        setVerificationHash(detail.verificationHash);
      }
      if (typeof detail.durationMs === 'number' && Number.isFinite(detail.durationMs)) {
        setTotalExecMs(detail.durationMs);
      }
      if (detail.resetLogs) {
        setQuickLogs([detail.logLine]);
      } else {
        setQuickLogs((prev) => [...prev, detail.logLine]);
      }
    };
    window.addEventListener('zyntheor:workflow-event', handleWorkflowEvent as EventListener);
    return () => {
      window.removeEventListener('zyntheor:workflow-event', handleWorkflowEvent as EventListener);
    };
  }, []);

  // Auto-focus quick goal input when modal opens
  useEffect(() => {
    if (isQuickTaskOpen) {
      const timer = setTimeout(() => {
        quickGoalInputRef.current?.focus();
        quickGoalInputRef.current?.select();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isQuickTaskOpen]);

  // Global Keyboard Shortcut System for Power Users
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      // 1. Ctrl+K or Cmd+K: Toggle Quick Task Modal
      if (isCtrlOrCmd && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsQuickTaskOpen((prev) => !prev);
        return;
      }

      // 1b. Ctrl+F or Cmd+F (when Quick Task terminal is closed): Toggle Global Search
      if (isCtrlOrCmd && !isQuickTaskOpen && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setIsGlobalSearchOpen((prev) => !prev);
        return;
      }

      // 2. Ctrl+Enter or Cmd+Enter: Dispatch Native Intelligence Engine
      if (isCtrlOrCmd && e.key === 'Enter') {
        if (isQuickTaskOpen && !isQuickRunning && quickGoal.trim()) {
          e.preventDefault();
          handleRunQuickAgent();
          return;
        }
      }

      // 3. Escape: Close open modals/drawers in priority order
      if (e.key === 'Escape') {
        if (evidenceDrawerItem) {
          e.preventDefault();
          setEvidenceDrawerItem(null);
          return;
        }
        if (isGlobalSearchOpen) {
          e.preventDefault();
          setIsGlobalSearchOpen(false);
          return;
        }
        if (isExportPreviewOpen) {
          e.preventDefault();
          setIsExportPreviewOpen(false);
          return;
        }
        if (isExportMenuOpen) {
          e.preventDefault();
          setIsExportMenuOpen(false);
          return;
        }
        if (isShortcutsModalOpen) {
          e.preventDefault();
          setIsShortcutsModalOpen(false);
          return;
        }
        if (isSnapshotDrawerOpen) {
          e.preventDefault();
          setIsSnapshotDrawerOpen(false);
          return;
        }
        if (isAssistantOpen) {
          e.preventDefault();
          setIsAssistantOpen(false);
          return;
        }
        if (isQuickTaskOpen) {
          e.preventDefault();
          setIsQuickTaskOpen(false);
          return;
        }
        if (isMobileOpen) {
          e.preventDefault();
          setIsMobileOpen(false);
          return;
        }
      }

      // 4. Ctrl+/ or Cmd+/ or ? (when not inside an input): Toggle Keyboard Shortcuts Cheat Sheet
      if ((isCtrlOrCmd && (e.key === '/' || e.key === '?')) || (!isInput && e.key === '?')) {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
        return;
      }

      // 4b. Alt+A: Toggle System AI Assistant Drawer
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setIsAssistantOpen((prev) => !prev);
        return;
      }

      // 4c. Ctrl+Shift+E or Cmd+Shift+E: Open the export menu directly
      if (isCtrlOrCmd && e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        setIsQuickTaskOpen(true);
        setIsExportMenuOpen(true);
        return;
      }

      // 5. Alt+1 through Alt+9: Quick Module Navigation
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const moduleMap: Record<string, ModuleId> = {
          '1': 'command_center',
          '2': 'conversational_intelligence',
          '3': 'intelligence_core',
          '4': 'dev_studio',
          '5': 'research_lab',
          '6': 'automation_center',
          '7': 'knowledge_hub',
          '8': 'model_laboratory',
          '9': 'governance_security'
        };
        const targetModule = moduleMap[e.key];
        if (targetModule) {
          setActiveModule(targetModule);
        }
        return;
      }

      // 6. Shortcuts while Quick Task Modal is open
      if (isQuickTaskOpen) {
        // Ctrl+Shift+C: Copy logs
        if (isCtrlOrCmd && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          handleCopyLogs();
          return;
        }
        // Ctrl+Shift+D: Download logs
        if (isCtrlOrCmd && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
          e.preventDefault();
          handleDownloadLogs();
          return;
        }
        // Ctrl+Shift+S: Take Snapshot
        if (isCtrlOrCmd && e.shiftKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          handleTakeSnapshot();
          return;
        }
        // Alt+H: Toggle Snapshot Drawer
        if (e.altKey && (e.key === 'h' || e.key === 'H')) {
          e.preventDefault();
          setIsSnapshotDrawerOpen((prev) => !prev);
          return;
        }
        // Alt+C: Clear Logs
        if (e.altKey && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          setQuickLogs([]);
          setLogCategories({});
          setGroupByCategory(false);
          setSelectedLogIndices([]);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isQuickTaskOpen,
    isQuickRunning,
    quickGoal,
    isExportMenuOpen,
    isExportPreviewOpen,
    isShortcutsModalOpen,
    isSnapshotDrawerOpen,
    isAssistantOpen,
    isMobileOpen,
    isGlobalSearchOpen,
    evidenceDrawerItem,
    quickLogs,
    snapshots
  ]);

  useEffect(() => {
    if (!isExportMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [isExportMenuOpen]);

  const renderRbacDenied = (moduleLabel: string, requiredRole: 'Developer' | 'Administrator') => (
    <div className="p-5 sm:p-6 rounded-xl bg-[var(--app-surface)] border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] space-y-4">
      <div className="p-3.5 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_35%,transparent)] text-[var(--z-danger)] text-xs font-mono">
        {lang === 'th'
          ? `[RBAC_DENIED] ${moduleLabel} ต้องใช้สิทธิ์ ${requiredRole} (สิทธิ์ปัจจุบัน: ${role}) จึงยังไม่แสดงโมดูลนี้ในเซสชันปัจจุบัน`
          : `[RBAC_DENIED] ${moduleLabel} requires ${requiredRole} role (current: ${role}). Module is not rendered for this session.`}
      </div>
      <div className="text-xs text-[var(--app-text-secondary)]">
        {session.userId && session.userId !== 'anonymous'
          ? lang === 'th'
            ? `เข้าสู่ระบบในชื่อ ${session.email || session.userId} (บทบาท: ${role}${session.authMode ? `, โหมด: ${session.authMode}` : ''}). ${
                devAccessEnabled
                  ? 'เลือกเซสชันพัฒนา Developer หรือ Administrator ด้านล่างเพื่อเข้าถึงพื้นที่ทำงานนี้'
                  : 'บัญชีของคุณต้องมีสิทธิ์ Developer หรือ Administrator เพื่อเปิดพื้นที่ทำงานนี้'
              }`
            : `Signed in as ${session.email || session.userId} (role: ${role}${session.authMode ? `, mode: ${session.authMode}` : ''}). ${
                devAccessEnabled
                  ? 'Select a Developer or Administrator development session below to access this workspace.'
                  : 'Your account requires a Developer or Administrator role claim to open this workspace.'
              }`
          : devAccessEnabled
          ? lang === 'th'
            ? 'เข้าสู่ระบบด้วย Google หรือเลือกสิทธิ์ Development Access ด้านล่างเพื่อปลดล็อกพื้นที่ทำงานนี้'
            : 'Sign in with Google or select a Development Access role below to unlock this workspace.'
          : lang === 'th'
            ? 'เข้าสู่ระบบด้วยบัญชี Google ที่ยืนยันแล้วและมีสิทธิ์ Developer หรือ Administrator'
            : 'Sign in with a verified Google account that holds Developer or Administrator privileges.'}
      </div>
      {authError && (
        <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] text-[var(--z-danger)] text-xs">
          {authError}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => void loginWithGoogle()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-[var(--app-bg)] hover:opacity-90 transition-opacity cursor-pointer"
        >
          <LogIn className="w-3.5 h-3.5" />
          {lang === 'th' ? 'เข้าสู่ระบบด้วย Google' : 'Continue with Google'}
        </button>
        {devAccessEnabled && (
          <>
            <button
              type="button"
              onClick={() => void login('Developer')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] transition-colors cursor-pointer"
            >
              {lang === 'th' ? 'สิทธิ์พัฒนา: Developer' : 'Dev Access: Developer'}
            </button>
            <button
              type="button"
              onClick={() => void login('Administrator')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] transition-colors cursor-pointer"
            >
              {lang === 'th' ? 'สิทธิ์พัฒนา: Administrator' : 'Dev Access: Administrator'}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => openAuthSettings('account')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-[var(--app-bg)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] transition-colors cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5" />
          {lang === 'th' ? 'ตั้งค่าบัญชีและสิทธิ์' : 'Open Account Settings'}
        </button>
      </div>
    </div>
  );

  const renderActiveModule = () => {
    switch (activeModule) {
      case 'command_center':
        return (
          <CommandCenter
            statusData={statusData}
            truthData={truthData}
            trainingReadiness={trainingReadiness}
            onRefreshStatus={fetchStatus}
            isRefreshingStatus={isRefreshing}
            onNavigate={setActiveModule}
            onOpenQuickTask={() => setIsQuickTaskOpen(true)}
            onOpenSecrets={() => openAuthSettings('secrets')}
            onInspectEvidence={setEvidenceDrawerItem}
            workflowLogs={quickLogs}
            isWorkflowRunning={isQuickRunning}
            workflowDone={quickDone}
            workflowStepLatencies={logStepLatencies}
            workflowVerificationHash={verificationHash}
            workflowTotalExecMs={totalExecMs}
            workflowGoal={quickGoal}
            activeFilterStageId={activeWorkflowStageFilter}
            onStageClick={handleFilterTerminalByStage}
            onClearStageFilter={handleClearWorkflowStageFilter}
            onRetryQuickTask={handleRunQuickAgent}
            onInspectStageInTerminal={handleFilterTerminalByStage}
            goal={quickGoal}
            onGoalChange={setQuickGoal}
            onRunTask={handleRunQuickAgent}
            onCreateSoftwareProject={handleCreateSoftwareProject}
            isCreatingSoftwareProject={isCreatingSoftwareProject}
            lastCreatedProject={lastCreatedProject}
            showSentimentTrend={showSentimentTrend}
            onToggleSentimentTrend={toggleSentimentTrend}
          />
        );
      case 'conversational_intelligence':
        return (
          <ConversationalIntelligence
            statusData={statusData}
            onNavigate={setActiveModule}
            onOpenAssistant={() => setIsAssistantOpen(true)}
            onDispatchTask={(goal) => {
              setQuickGoal(goal);
              setActiveModule('command_center');
              if (isAuthenticated && (role === 'Developer' || role === 'Administrator')) {
                void handleRunQuickAgent(goal);
              }
            }}
            onDispatchActionDriven={(goal) => {
              setQuickGoal(goal);
              setActiveModule('command_center');
              if (isAuthenticated && (role === 'Developer' || role === 'Administrator')) {
                void handleRunQuickAgent(goal);
              }
            }}
          />
        );
      case 'intelligence_core':
        return (
          <IntelligenceCore
            statusData={statusData}
            onRefreshStatus={fetchStatus}
            onOpenSignIn={() => openAuthSettings('account')}
          />
        );
      case 'proof_of_intelligence':
        return (
          <ProofOfIntelligence
            statusData={statusData}
            truthData={truthData}
            trainingReadiness={trainingReadiness}
            onNavigate={setActiveModule}
            onOpenQuickTask={() => setIsQuickTaskOpen(true)}
            onInspectEvidence={setEvidenceDrawerItem}
            onRefreshAll={fetchStatus}
          />
        );
      case 'dev_studio':
        return role === 'Developer' || role === 'Administrator' ? (
          <DevStudio initialProjectId={lastCreatedProject?.projectId ?? null} />
        ) : (
          renderRbacDenied('DevStudio', 'Developer')
        );
      case 'research_lab':
        return <ResearchLab onOpenSignIn={() => openAuthSettings('account')} />;
      case 'automation_center':
        return <AutomationCenter />;
      case 'knowledge_hub':
        return <KnowledgeHub />;
      case 'model_laboratory':
        return role === 'Developer' || role === 'Administrator' ? (
          <ModelLaboratory />
        ) : (
          renderRbacDenied('ModelLaboratory', 'Developer')
        );
      case 'experiment_center':
        return role === 'Developer' || role === 'Administrator' ? (
          <ExperimentCenter />
        ) : (
          renderRbacDenied('ExperimentCenter', 'Developer')
        );
      case 'infrastructure_cloud':
        return (
          <InfrastructureCloud
            statusData={statusData}
            truthData={truthData}
            trainingReadiness={trainingReadiness}
            onOpenSecrets={() => openAuthSettings('secrets')}
            onNavigate={setActiveModule}
            onInspectEvidence={setEvidenceDrawerItem}
            onRefreshAll={fetchStatus}
          />
        );
      case 'api_platform':
        return role === 'Developer' || role === 'Administrator' ? (
          <ApiPlatform />
        ) : (
          renderRbacDenied('ApiPlatform', 'Developer')
        );
      case 'marketplace':
        return <Marketplace />;
      case 'subscription_billing':
        return <SubscriptionBilling statusData={statusData} onRefresh={fetchStatus} onNavigate={setActiveModule} />;
      case 'analytics_bi':
        return <AnalyticsBI statusData={statusData} onNavigate={setActiveModule} />;
      case 'governance_security':
        return role === 'Developer' || role === 'Administrator' ? (
          <GovernanceSecurity />
        ) : (
          renderRbacDenied('GovernanceSecurity', 'Developer')
        );
      case 'user_settings':
        return (
          <UserSettings
            initialSection={settingsInitialSection}
            returnToModuleLabel={returnToModule ? t(`nav.${returnToModule}`) : null}
            onReturnToTask={handleReturnToTask}
          />
        );
      case 'admin_console':
        return role === 'Administrator' ? (
          <AdminConsole />
        ) : (
          renderRbacDenied('AdminConsole', 'Administrator')
        );
      default:
        return (
          <CommandCenter
            statusData={statusData}
            truthData={truthData}
            trainingReadiness={trainingReadiness}
            onRefreshStatus={fetchStatus}
            isRefreshingStatus={isRefreshing}
            onNavigate={setActiveModule}
            onOpenQuickTask={() => setIsQuickTaskOpen(true)}
            onOpenSecrets={() => openAuthSettings('secrets')}
            onInspectEvidence={setEvidenceDrawerItem}
            workflowLogs={quickLogs}
            isWorkflowRunning={isQuickRunning}
            workflowDone={quickDone}
            workflowStepLatencies={logStepLatencies}
            workflowVerificationHash={verificationHash}
            workflowTotalExecMs={totalExecMs}
            workflowGoal={quickGoal}
            activeFilterStageId={activeWorkflowStageFilter}
            onStageClick={handleFilterTerminalByStage}
            onClearStageFilter={handleClearWorkflowStageFilter}
            onRetryQuickTask={handleRunQuickAgent}
            onInspectStageInTerminal={handleFilterTerminalByStage}
            goal={quickGoal}
            onGoalChange={setQuickGoal}
            onRunTask={handleRunQuickAgent}
            onCreateSoftwareProject={handleCreateSoftwareProject}
            isCreatingSoftwareProject={isCreatingSoftwareProject}
            lastCreatedProject={lastCreatedProject}
            showSentimentTrend={showSentimentTrend}
            onToggleSentimentTrend={toggleSentimentTrend}
          />
        );
    }
  };

  const ContextRail = () => {
    const model = statusData?.model;
    const audit = statusData?.audit;
    const resources = statusData?.resources?.current;
    const th = lang === 'th';
    return (
      <aside className={`context-rail ${isContextOpen ? 'context-rail-open' : 'context-rail-closed'}`} aria-label={th ? 'แผงบริบทระบบ' : 'Native context panel'}>
        <div className="context-rail-header">
          {isContextOpen && <span className="eyebrow">{th ? 'บริบทระบบ' : 'LIVE CONTEXT'}</span>}
          <button
            className="icon-button"
            onClick={() => setIsContextOpen((value) => {
              const next = !value;
              window.localStorage.setItem('zyntheor_context_panel', next ? 'open' : 'closed');
              return next;
            })}
            aria-label={isContextOpen ? (th ? 'ย่อแผงบริบท' : 'Collapse context panel') : (th ? 'เปิดแผงบริบท' : 'Open context panel')}
          >
            {isContextOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
        {isContextOpen && (
          <div className="context-rail-body">
            <div className="context-identity">
              <div>
                <strong>ZYNTHEOR Native</strong>
                <span>{th ? 'ประมวลผลจริงบน Cloud Runtime' : 'Native runtime · local first'}</span>
              </div>
            </div>
            <div className="context-status-line">
              <span><Activity className="w-3.5 h-3.5" />Runtime</span>
              <b className={model?.weightsLoaded ? 'status-live' : 'status-muted'}>
                {model?.weightsLoaded ? (th ? 'โหลดโมเดลแล้ว' : 'WEIGHTS LOADED') : statusData ? (model?.runtimeState || 'BLOCKED') : 'CHECKING'}
              </b>
            </div>
            <div className="context-stat-grid">
              <div><span>{th ? 'พารามิเตอร์' : 'Parameters'}</span><strong>{model ? `${(model.totalParams / 1000000).toFixed(1)}M` : '—'}</strong></div>
              <div><span>{th ? 'ความเร็ว' : 'Throughput'}</span><strong>{resources?.tokensPerSec ? `${resources.tokensPerSec}/s` : '—'}</strong></div>
              <div><span>Audit Chain</span><strong>{audit ? (audit.chainValid ? 'VALID' : 'CHECK') : '—'}</strong></div>
              <div><span>{th ? 'หน่วยความจำ' : 'Memory'}</span><strong>{resources?.processRssMb ? `${resources.processRssMb} MB` : '—'}</strong></div>
            </div>
            <div className="context-section">
              <span className="eyebrow">{th ? 'ขอบเขตข้อมูล' : 'KNOWLEDGE SCOPE'}</span>
              <div className="context-chip"><Database className="w-3.5 h-3.5" />{th ? 'เอกสารและชุดข้อมูล' : 'Documents & datasets'} <b>{statusData?.sandbox.fileCount ?? '—'}</b></div>
              <div className="context-chip"><Network className="w-3.5 h-3.5" />Memory Graph <b>{statusData ? 'runtime-backed' : '—'}</b></div>
            </div>
            <div className="context-section">
              <span className="eyebrow">{th ? 'เครื่องมือด่วน' : 'TOOL ACCESS'}</span>
              <button className="context-action" onClick={() => setActiveModule('knowledge_hub')}><Sparkles className="w-3.5 h-3.5" />{th ? 'คลังความรู้' : 'Knowledge workspace'} <span>→</span></button>
              <button className={`context-action ${role === 'User' ? 'context-action-disabled' : ''}`} onClick={() => role !== 'User' && setActiveModule('governance_security')} disabled={role === 'User'} title={role === 'User' ? (th ? 'ต้องใช้สิทธิ์ Developer' : 'Developer role required') : undefined}><LockKeyhole className="w-3.5 h-3.5" />{th ? 'หลักฐานและ Audit' : 'Governance & audit'} <span>{role === 'User' ? 'Developer' : '→'}</span></button>
              <button type="button" className="context-action" data-testid="export-workspace-context-btn" onClick={handleExportWorkspaceContext} title={th ? 'ดาวน์โหลดไฟล์ JSON บริบทพื้นที่ทำงานสำหรับตรวจสอบ' : 'Download workspace context JSON'}><FileJson className="w-3.5 h-3.5" />{th ? 'ส่งออกบริบท JSON' : 'Export Workspace Context'} <span>{workspaceContextExported ? '✓' : '↓'}</span></button>
            </div>
            <div className="context-note">
              {statusData
                ? `${th ? 'อัปเดตล่าสุด' : 'Refreshed'} ${new Date(statusData.serverTime).toLocaleTimeString()}`
                : (th ? 'กำลังรอข้อมูล Telemetry จริงจากระบบ' : 'Awaiting native runtime telemetry.')}
            </div>
          </div>
        )}
      </aside>
    );
  };

  const hasBlockingOverlay =
    isMobileOpen ||
    isAssistantOpen ||
    isQuickTaskOpen ||
    isGlobalSearchOpen ||
    Boolean(evidenceDrawerItem) ||
    isShortcutsModalOpen ||
    isExportPreviewOpen;

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text-primary)] flex transition-colors duration-200 app-shell">
      {/* Sidebar for Desktop & Mobile Drawer */}
      <Sidebar
        activeModule={activeModule}
        onSelectModule={setActiveModule}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      {/* Main Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeModule={activeModule}
          statusData={statusData}
          onToggleMobile={() => setIsMobileOpen((prev) => !prev)}
          onOpenQuickTask={() => setIsQuickTaskOpen(true)}
          onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
          onRefreshStatus={fetchStatus}
          onOpenSettings={() => openAuthSettings('account')}
          onOpenCloudSettings={() =>
            isAuthenticated && (role === 'Developer' || role === 'Administrator')
              ? openAuthSettings('secrets')
              : setActiveModule('infrastructure_cloud')
          }
          onOpenSignIn={() => openAuthSettings('account')}
          onOpenSearch={() => setIsGlobalSearchOpen(true)}
          onOpenAssistant={() => setIsAssistantOpen(true)}
          isRefreshing={isRefreshing}
        />

        <div className="app-workspace">
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8 w-full max-w-5xl mx-auto pb-24 lg:pb-12 min-w-0">
            {!isAuthenticated && activeModule !== 'user_settings' && (
              <div
                role="status"
                data-testid="signin-banner"
                className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-4 py-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs sm:text-sm font-medium text-[var(--app-text-primary)]">
                    {sessionExpired
                      ? (lang === 'th'
                          ? 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบเพื่อเริ่มสั่งงาน'
                          : 'Session expired — Sign in to dispatch tasks')
                      : (lang === 'th'
                          ? 'เข้าสู่ระบบเพื่อเริ่มสั่งงานและบันทึกประวัติการทำงาน'
                          : 'Sign in to dispatch tasks and save session logs')}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    data-testid="signin-banner-login-btn"
                    onClick={async () => {
                      if (devAccessEnabled) {
                        const ok = await login('User');
                        if (!ok) openAuthSettings('account');
                      } else {
                        const ok = await loginWithGoogle();
                        if (!ok) openAuthSettings('account');
                      }
                    }}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--app-accent-deep)] text-white hover:brightness-110 transition-all cursor-pointer whitespace-nowrap"
                  >
                    {lang === 'th' ? 'เข้าสู่ระบบ' : 'Sign in'}
                  </button>
                  <button
                    type="button"
                    data-testid="signin-banner-options-btn"
                    onClick={() => openAuthSettings('account')}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--app-card)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {lang === 'th' ? 'จัดการบัญชี' : 'Account'}
                  </button>
                </div>
              </div>
            )}
            {activeModule === 'command_center' && (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-card-border)]">
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    data-testid="dashboard-tab-overview"
                    onClick={() => setDashboardView('overview')}
                    className={`inline-flex items-center gap-1.5 pb-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                      dashboardView === 'overview'
                        ? 'border-[var(--app-accent)] text-[var(--app-text-primary)]'
                        : 'border-transparent text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'ภาพรวม' : 'Overview'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="dashboard-tab-performance-trends"
                    onClick={() => setDashboardView('performance_trends')}
                    className={`inline-flex items-center gap-1.5 pb-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                      dashboardView === 'performance_trends'
                        ? 'border-[var(--app-accent)] text-[var(--app-text-primary)]'
                        : 'border-transparent text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'แนวโน้มความเร็ว' : 'Performance Trends'}</span>
                    {performanceTrendPoints.length > 0 && (
                      <span className="font-mono text-[11px] text-[var(--app-text-secondary)]">
                        ({performanceTrendPoints.length})
                      </span>
                    )}
                  </button>
                </div>
                {isQuickRunning && (
                  <span className="inline-flex items-center gap-1.5 pb-2 text-[11px] font-mono text-[var(--z-ok)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--z-ok)]" />
                    {lang === 'th' ? 'กำลังประมวลผลแบบเรียลไทม์' : 'Streaming execution'}
                  </span>
                )}
              </div>
            )}
            {activeModule === 'command_center' && dashboardView === 'performance_trends' ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-5 shadow-sm">
                  <LazyErrorBoundary lang={lang}>
                    <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-[var(--app-surface)]" />}>
                      <PerformanceTrendsChart
                        points={performanceTrendPoints}
                        isRunning={isQuickRunning}
                        lang={lang}
                        onOpenQuickTask={() => setIsQuickTaskOpen(true)}
                        onNavigateCommandCenter={() => {
                          setDashboardView('overview');
                          setActiveModule('command_center');
                        }}
                      />
                    </Suspense>
                  </LazyErrorBoundary>
                </div>
                <div className="rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-5 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-[var(--app-text-primary)]">
                      {lang === 'th' ? 'ตารางลำดับความหน่วงรายขั้นตอน (Log Sequence)' : 'Step Latency Sequence Breakdown'}
                    </h3>
                    <span className="text-[11px] font-mono text-[var(--app-text-secondary)]">
                      {performanceTrendPoints.length} {lang === 'th' ? 'ขั้นตอน' : 'steps'}
                    </span>
                  </div>
                  {performanceTrendPoints.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] p-4 text-xs">
                      <span className="font-semibold text-[var(--app-text-primary)]">
                        {lang === 'th' ? 'เริ่มต้นสั่งงานแรกของคุณใน Command Center' : 'Start your first task'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setDashboardView('overview');
                          setActiveModule('command_center');
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-[var(--app-accent)] text-slate-950 font-bold cursor-pointer"
                      >
                        {lang === 'th' ? 'ไปที่ Command Center' : 'Go to Command Center'}
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-xl border border-[var(--app-card-border)]">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-[var(--app-surface)] text-[var(--app-text-secondary)] border-b border-[var(--app-card-border)] sticky top-0">
                          <tr>
                            <th className="px-3 py-2">#</th>
                            <th className="px-3 py-2">Tag</th>
                            <th className="px-3 py-2">Step Latency</th>
                            <th className="px-3 py-2">Elapsed</th>
                            <th className="px-3 py-2">Log Message</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--app-card-border)] bg-[var(--app-bg)]">
                          {performanceTrendPoints.map((pt) => (
                            <tr key={pt.step} className="hover:bg-[var(--app-surface)] transition-colors">
                              <td className="px-3 py-2 tabular-nums text-[var(--app-text-secondary)]">{pt.step}</td>
                              <td className="px-3 py-2 font-bold text-[var(--app-accent)]">[{pt.tag}]</td>
                              <td className="px-3 py-2 tabular-nums font-bold text-[var(--app-amber)]">{pt.latencyMs} ms</td>
                              <td className="px-3 py-2 tabular-nums text-[var(--app-text-secondary)]">{pt.elapsedMs} ms</td>
                              <td className="px-3 py-2 text-[var(--app-text-primary)] max-w-md truncate">{pt.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <LazyErrorBoundary lang={lang}>
                <Suspense
                  fallback={
                    <div className="rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-6 text-xs text-[var(--app-text-secondary)]">
                      {lang === 'th' ? 'กำลังโหลดหน้าจอ...' : 'Loading module...'}
                    </div>
                  }
                >
                  {renderActiveModule()}
                  {activeModule === 'command_center' && (performanceTrendPoints.length > 0 || isQuickRunning) && (
                    <div className="mt-6 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-5 space-y-3">
                      <PerformanceTrendsChart
                        points={performanceTrendPoints}
                        isRunning={isQuickRunning}
                        lang={lang}
                        compact
                        onOpenQuickTask={() => setIsQuickTaskOpen(true)}
                        onNavigateCommandCenter={() => {
                          setDashboardView('overview');
                          setActiveModule('command_center');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setDashboardView('performance_trends')}
                          className="vivid-inline-link"
                        >
                          <TrendingUp className="w-3.5 h-3.5" />
                          <span>
                            {lang === 'th' ? 'เปิดมุมมองแนวโน้มความเร็วแบบเต็ม' : 'Open full Performance Trends view'}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </Suspense>
              </LazyErrorBoundary>
            )}
          </main>
          <ContextRail />
        </div>

        {/* Mobile Bottom Navigation */}
        <MobileNav
          activeModule={activeModule}
          onSelectModule={setActiveModule}
          onOpenMore={() => setIsMobileOpen(true)}
          hidden={hasBlockingOverlay}
        />
      </div>

      {/* Quick Agent Launch Modal */}
      {isQuickTaskOpen && (
        <div className="fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--app-bg)_70%,transparent)] backdrop-blur-sm flex items-center justify-center p-4">
          <div 
            className="rounded-3xl w-full max-w-xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-colors"
            style={{
              backgroundColor: 'var(--app-card)',
              borderColor: 'var(--app-card-border)',
              color: 'var(--app-text-primary)'
            }}
          >
            <div 
              className="px-6 py-4 flex items-center justify-between"
              style={{
                borderBottom: '1px solid var(--app-card-border)',
                backgroundColor: 'var(--app-surface)'
              }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] border border-[color-mix(in_srgb,var(--app-accent)_28%,transparent)] flex items-center justify-center text-[var(--app-accent)] shrink-0">
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-tight" style={{ color: 'var(--app-text-primary)' }}>
                    {lang === 'th' ? 'สั่งการประมวลผล Native Intelligence' : 'Dispatch Native Intelligence Engine'}
                  </h3>
                  <p className="text-[11px]" style={{ color: 'var(--app-text-secondary)' }}>
                    {lang === 'th' ? 'Native Cloud Runtime พร้อมระบบวางแผน สร้าง และตรวจสอบงาน' : 'Native Cloud Runtime for planning, creation, execution and verification'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsQuickTaskOpen(false)}
                className="p-1.5 rounded-lg transition-colors cursor-pointer"
                style={{ color: 'var(--app-text-secondary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold" style={{ color: 'var(--app-text-secondary)' }}>
                    {lang === 'th' ? 'เป้าหมายงาน หรือคำถามเพื่อการวิเคราะห์' : 'Task Specification & Problem Goal'}
                  </label>
                  <span className="text-[10px] font-mono opacity-80 flex items-center gap-1 text-[var(--app-text-secondary)]">
                    <span>Dispatch:</span>
                    <kbd className="px-1.5 py-0.2 rounded bg-black/40 text-[var(--app-accent)] border border-[var(--app-card-border)] font-bold text-[9px]">
                      Ctrl + Enter
                    </kbd>
                  </span>
                </div>
                <input
                  ref={quickGoalInputRef}
                  type="text"
                  value={quickGoal}
                  onChange={(e) => setQuickGoal(e.target.value)}
                  placeholder={lang === 'th' ? 'เช่น สร้าง In-Memory LRU Cache พร้อม TTL (กด Ctrl+Enter เพื่อสั่งการ)' : 'E.g. Build In-Memory LRU Cache with TTL (Press Ctrl+Enter to dispatch)'}
                  className="w-full px-4 py-2.5 text-xs rounded-xl font-medium focus:outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--app-input-bg)',
                    borderColor: 'var(--app-card-border)',
                    borderWidth: '1px',
                    color: 'var(--app-text-primary)'
                  }}
                />
              </div>

              {/* Progress Log Area */}
              <div
                className={`rounded-xl font-mono text-xs border transition-colors ${
                  logTheme === 'high_contrast'
                    ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_60%,transparent)]'
                    : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)]'
                }`}
              >
                <div
                  className={`px-3.5 py-2 rounded-t-xl flex flex-wrap items-center justify-between gap-2 border-b ${
                    logTheme === 'high_contrast'
                      ? 'bg-[var(--app-bg)] border-[color-mix(in_srgb,var(--app-text-primary)_30%,transparent)]'
                      : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold ${
                        logTheme === 'high_contrast' ? 'text-[var(--app-text-primary)]' : 'text-[var(--app-accent)]'
                      }`}
                    >
                      {lang === 'th' ? 'บันทึกการทำงาน (Terminal)' : 'Execution Trace'}
                    </span>
                    {logLatencyMs !== null && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--app-surface-elevated)] text-[var(--app-amber)] border border-[var(--app-card-border)]">
                        {logLatencyMs} ms
                      </span>
                    )}
                    <span
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                        isTampered
                          ? 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)] border-[var(--z-danger)] animate-pulse'
                          : integrityStatus === 'EMPTY'
                          ? 'bg-[color-mix(in_srgb,var(--app-surface-elevated)_10%,transparent)] text-[var(--app-text-secondary)] border-[color-mix(in_srgb,var(--app-card-border)_30%,transparent)]'
                          : 'bg-[color-mix(in_srgb,var(--z-ok)_10%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)]'
                      }`}
                      title={`Integrity Status: ${integrityStatus} · SHA-256: ${rollingHash || 'empty'}`}
                    >
                      {isTampered ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                      {isTampered ? 'TAMPERED' : rollingHash ? `${rollingHash.slice(0, 8)}` : integrityStatus}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {quickLogs.some((l) => l.includes('[ERROR]')) && !isQuickRunning && (
                      <button
                        type="button"
                        onClick={handleRunQuickAgent}
                        title={lang === 'th' ? 'ลองใหม่อัตโนมัติ' : 'Retry failed run'}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {lang === 'th' ? 'ลองใหม่' : 'Retry'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPerfMetrics((prev) => !prev)}
                      title={lang === 'th' ? 'แสดง/ซ่อนตัวชี้วัดประสิทธิภาพ' : 'Toggle Performance Metrics'}
                      className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${
                        showPerfMetrics
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      {lang === 'th' ? 'เมตริก' : 'Metrics'}
                    </button>
                    <button
                      type="button"
                      data-testid="toggle-terminal-perf-trends"
                      onClick={() => setShowPerfTrendsInTerminal((prev) => !prev)}
                      aria-pressed={showPerfTrendsInTerminal}
                      title={lang === 'th' ? 'สลับมุมมองแนวโน้มประสิทธิภาพ (D3)' : 'Toggle Performance Trends D3 Chart'}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${
                        showPerfTrendsInTerminal
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      <TrendingUp className="w-3 h-3" />
                      <span>{lang === 'th' ? 'แนวโน้มประสิทธิภาพ' : 'Performance Trends'}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="toggle-sentiment-trend"
                      onClick={toggleSentimentTrend}
                      aria-pressed={showSentimentTrend}
                      title={lang === 'th' ? 'แสดง/ซ่อนกราฟแนวโน้ม Sentiment (Alt+V)' : 'Toggle Sentiment Trend Chart (Alt+V)'}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${
                        showSentimentTrend
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      <Activity className="w-3 h-3" />
                      <span>{lang === 'th' ? 'Sentiment (Alt+V)' : 'Sentiment (Alt+V)'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkMode((prev) => !prev);
                        setSelectedLogIndices([]);
                      }}
                      title={lang === 'th' ? 'โหมดเลือกหลายรายการ' : 'Bulk Tagging Mode'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border ${
                        bulkMode
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogTimeMode((prev) => (prev === 'absolute' ? 'relative' : 'absolute'))}
                      title="Toggle Relative / Absolute Timestamp"
                      className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${
                        logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      {logTimeMode === 'absolute' ? 'ABS' : 'REL'}
                    </button>
                    <button
                      type="button"
                      data-testid="toggle-line-numbers"
                      onClick={() => {
                        setShowLineNumbers((prev) => {
                          const next = !prev;
                          try {
                            localStorage.setItem('zyntheor_log_line_numbers', String(next));
                          } catch {
                            // ignore
                          }
                          return next;
                        });
                      }}
                      aria-pressed={showLineNumbers}
                      aria-label="Toggle Line Numbers"
                      title={showLineNumbers ? 'Toggle Line Numbers (Hide)' : 'Toggle Line Numbers (Show)'}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors cursor-pointer border text-[10px] font-mono font-bold ${
                        showLineNumbers
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      <ListOrdered className="w-3.5 h-3.5" />
                      <span className="hidden xl:inline">{lang === 'th' ? 'เลขบรรทัด' : 'Lines'}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="toggle-log-wrap"
                      aria-pressed={logTextWrap}
                      aria-label={logTextWrap ? 'Wrap Text' : 'No-Wrap'}
                      onClick={() => {
                        setLogTextWrap((prev) => {
                          const next = !prev;
                          try {
                            localStorage.setItem('zyntheor_log_text_wrap', String(next));
                          } catch {
                            // ignore storage quota errors
                          }
                          return next;
                        });
                      }}
                      title={logTextWrap ? 'Wrap Text (click to switch to No-Wrap)' : 'No-Wrap (click to switch to Wrap Text)'}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors cursor-pointer border text-[10px] font-mono font-bold ${
                        logTextWrap
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      <WrapText className="w-3.5 h-3.5" />
                      <span>{lang === 'th' ? (logTextWrap ? 'ตัดบรรทัด' : 'ไม่ตัดบรรทัด') : (logTextWrap ? 'Wrap Text' : 'No-Wrap')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTtsEnabled((prev) => !prev)}
                      title={ttsEnabled ? 'Disable TTS' : 'Enable Text-to-Speech'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border ${
                        ttsEnabled
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      {ttsEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleTtsPause}
                      disabled={!ttsEnabled}
                      aria-pressed={ttsPaused}
                      aria-label={ttsPaused ? 'Resume TTS' : 'Pause TTS'}
                      title={
                        !ttsEnabled
                          ? 'Enable TTS to pause or resume speech'
                          : ttsPaused
                          ? 'Resume queued speech synthesis'
                          : 'Pause ongoing speech synthesis'
                      }
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${
                        ttsEnabled && ttsPaused
                          ? 'bg-[color-mix(in_srgb,var(--app-amber)_20%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_50%,transparent)]'
                          : ttsEnabled
                          ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)]'
                      }`}
                    >
                      {ttsPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      <span className="hidden sm:inline">{ttsPaused ? 'Resume' : 'Pause'}</span>
                    </button>
                    <div
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-mono ${
                        logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] border-[var(--app-card-border)]'
                      }`}
                      title="TTS Pitch (0.5x – 2.0x)"
                    >
                      <label htmlFor="tts-pitch-header-slider" className="shrink-0 font-semibold">
                        TTS Pitch
                      </label>
                      <input
                        id="tts-pitch-header-slider"
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={ttsPitch}
                        aria-label="TTS Pitch"
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setTtsPitch(val);
                          localStorage.setItem('zyntheor_tts_pitch', String(val));
                        }}
                        className="w-16 accent-[var(--app-amber)] cursor-pointer"
                      />
                      <span className="tabular-nums font-bold text-[var(--app-amber)] min-w-[2.1rem] text-right">
                        {ttsPitch.toFixed(1)}x
                      </span>
                    </div>
                    <button
                      type="button"
                      data-testid="clear-resolved-logs"
                      aria-label="Clear Resolved Logs"
                      onClick={handleClearResolvedLogs}
                      disabled={resolvedLogCount === 0}
                      title={
                        lang === 'th'
                          ? 'ล้างบันทึกที่เสร็จสิ้นแล้ว ([DONE] / [VERIFIED])'
                          : 'Remove all log lines tagged [DONE] or [VERIFIED]'
                      }
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors cursor-pointer border text-[10px] font-mono font-bold disabled:opacity-40 disabled:cursor-not-allowed ${
                        logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--z-ok)] hover:text-[var(--z-ok)]'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {lang === 'th' ? 'ล้างรายการที่เสร็จแล้ว' : 'Clear Resolved Logs'}{resolvedLogCount > 0 ? ` (${resolvedLogCount})` : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickLogs([]);
                        setLogCategories({});
                        setGroupByCategory(false);
                        setSelectedLogIndices([]);
                      }}
                      disabled={quickLogs.length === 0}
                      title={lang === 'th' ? 'ล้างบันทึกทั้งหมด' : 'Clear all logs'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${
                        logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--z-danger)] hover:text-[var(--z-danger)]'
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleTakeSnapshot}
                      disabled={quickLogs.length === 0}
                      title={lang === 'th' ? 'บันทึก Snapshot' : 'Take Snapshot'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${
                        logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSnapshotDrawerOpen(true)}
                      title={lang === 'th' ? 'เปรียบเทียบ Snapshots' : 'Compare Snapshots'}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer border ${
                        logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      <History className="w-3 h-3" />
                      {snapshots.length}
                    </button>
                    <div className="relative" ref={exportMenuRef}>
                      <button
                        type="button"
                        data-testid="export-menu-trigger"
                        onClick={() => setIsExportMenuOpen((prev) => !prev)}
                        aria-haspopup="menu"
                        aria-expanded={isExportMenuOpen}
                        title={lang === 'th' ? 'ส่งออกบันทึก (Ctrl+Shift+E)' : 'Export execution logs & context (Ctrl+Shift+E)'}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${
                          isExportMenuOpen
                            ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                            : logTheme === 'high_contrast'
                            ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                            : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                        }`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Export</span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {isExportMenuOpen && (
                        <div
                          role="menu"
                          data-testid="export-menu-dropdown"
                          className="absolute right-0 mt-1.5 w-56 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] shadow-xl py-1 z-30 text-[11px] font-mono"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            data-testid="export-preview-menuitem"
                            disabled={quickLogs.length === 0}
                            onClick={() => {
                              setIsExportPreviewOpen(true);
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left text-[var(--app-accent)] font-bold hover:bg-[var(--app-surface-elevated)] border-b border-[var(--app-card-border)] mb-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <span className="inline-flex items-center gap-2">
                              <Eye className="w-3.5 h-3.5" />
                              <span>Preview</span>
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] border border-[color-mix(in_srgb,var(--app-accent)_35%,transparent)] tabular-nums">
                              {selectedLogIndices.length > 0
                                ? selectedLogIndices.length
                                : hasAnyActiveFilter
                                ? matchingLogEntries.length
                                : quickLogs.length}
                            </span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={quickLogs.length === 0}
                            onClick={() => {
                              handleExportLogsCsv();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                            <span>Export CSV (.csv)</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={quickLogs.length === 0}
                            onClick={() => {
                              handleExportLogsMarkdown();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <FileText className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                            <span>Export Markdown (.md)</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={quickLogs.length === 0}
                            onClick={() => {
                              handleExportLogsJson();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <FileJson className="w-3.5 h-3.5 text-[var(--app-amber)]" />
                            <span>Export JSON (.json)</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={quickLogs.length === 0}
                            onClick={() => {
                              handleDownloadLogs();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Download className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
                            <span>Raw Log (.log)</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={quickLogs.length === 0}
                            onClick={() => {
                              handleExportLogsPdf();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Printer className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
                            <span>Print / PDF</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            data-testid="export-menu-workspace-context"
                            onClick={() => {
                              handleExportWorkspaceContext();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] border-t border-[var(--app-card-border)] mt-0.5 cursor-pointer"
                          >
                            <FileJson className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                            <span>Workspace Context (.json)</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyLogs}
                      disabled={quickLogs.length === 0}
                      title={lang === 'th' ? 'คัดลอกบันทึกทั้งหมด' : 'Copy all logs'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${
                        logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      {copiedLogs ? (
                        <Check className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsShortcutsModalOpen(true)}
                      title={lang === 'th' ? 'แป้นพิมพ์ลัด (Ctrl+/ หรือ ?)' : 'Keyboard Shortcuts (Ctrl+/ or ?)'}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono transition-colors cursor-pointer border ${
                        logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      <Keyboard className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Shortcuts</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLogTheme((prev) => (prev === 'emerald_dark' ? 'high_contrast' : 'emerald_dark'))
                      }
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer border ${
                        logTheme === 'high_contrast'
                          ? 'bg-white text-black border-white hover:bg-[var(--app-surface-elevated)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      {logTheme === 'emerald_dark' ? 'Emerald Dark' : 'High Contrast'}
                    </button>
                  </div>
                </div>
                {isTampered && (
                  <div className="mx-3.5 mt-2 px-3 py-2 rounded-lg bg-[color-mix(in_srgb,var(--z-danger)_16%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] text-[var(--z-danger)] text-[11px] font-mono flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0 text-[var(--z-danger)]" />
                      <span>
                        <strong>INTEGRITY ALARM:</strong> quickLogs hash no longer matches the sealed baseline.
                        Session flagged as TAMPERED — possible unauthorized browser script mutation.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleIntegrityAutoRecovery}
                      className="self-start px-3 py-1.5 rounded-md text-[10px] font-bold bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] cursor-pointer"
                    >
                      Integrity Auto-Recovery
                    </button>
                  </div>
                )}
                <div
                  className={`px-3.5 py-2 flex flex-col gap-2 border-b ${
                    logTheme === 'high_contrast'
                      ? 'bg-[var(--app-bg)] border-[color-mix(in_srgb,var(--app-text-primary)_25%,transparent)]'
                      : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
                  }`}
                >
                  {activeWorkflowStageMeta && (
                    <div
                      data-testid="active-stage-filter-banner"
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,var(--app-bg))] px-2.5 py-1.5 text-[11px] font-mono"
                    >
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <Filter className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
                        <span className="font-bold text-[var(--app-text-primary)]">
                          {lang === 'th'
                            ? `ขั้นตอน ${String(activeWorkflowStageMeta.order).padStart(2, '0')}: ${activeWorkflowStageMeta.labelTh}`
                            : `Stage ${String(activeWorkflowStageMeta.order).padStart(2, '0')}: ${activeWorkflowStageMeta.labelEn}`}
                        </span>
                        <span className="text-[var(--app-text-secondary)] tabular-nums">
                          · {matchingLogEntries.length}/{quickLogs.length}{' '}
                          {lang === 'th' ? 'รายการ' : 'logs'}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-testid="clear-stage-filter-btn"
                        onClick={handleClearWorkflowStageFilter}
                        className="inline-flex items-center gap-1 rounded border border-[var(--app-card-border)] bg-[var(--app-surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--app-text-primary)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] cursor-pointer shrink-0"
                      >
                        <X className="w-3 h-3" />
                        <span>{lang === 'th' ? 'ล้างตัวกรองขั้นตอน' : 'Clear Stage Filter'}</span>
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px] flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--app-text-secondary)]" />
                        <input
                          type="text"
                          value={logSearchQuery}
                          onChange={(e) => {
                            setActiveWorkflowStageFilter(null);
                            setLogSearchQuery(e.target.value);
                          }}
                          aria-label={
                            logSearchMode === 'regex'
                              ? 'Regex log search pattern'
                              : logSearchMode === 'semantic'
                              ? 'Semantic intent log search query'
                              : 'Text log search query'
                          }
                          aria-invalid={logSearchMode === 'regex' && Boolean(compiledLogSearch.error)}
                          placeholder={
                            logSearchMode === 'regex'
                              ? lang === 'th'
                                ? 'Regex (เช่น \\[ERROR\\]\\s*\\[auth\\] หรือ at\\s+.*:\\d+)...'
                                : 'Regex (e.g. \\[ERROR\\]\\s*\\[auth\\] or at\\s+.*:\\d+)...'
                              : logSearchMode === 'semantic'
                              ? lang === 'th'
                                ? 'ค้นหาตามความหมาย/เจตนา (เช่น ปัญหาสิทธิ์, พัง, ช้า, test ผ่าน)...'
                                : 'Search by intent (e.g. auth problem, crash, slow, tests passed)...'
                              : lang === 'th'
                              ? 'ค้นหาในบันทึก...'
                              : 'Filter logs by text...'
                          }
                          className={`w-full pl-8 ${logSearchQuery ? 'pr-7' : 'pr-2.5'} py-1 rounded-md text-[11px] focus:outline-none border ${
                            logSearchMode === 'regex' && compiledLogSearch.error
                              ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[var(--z-danger)]'
                              : logTheme === 'high_contrast'
                              ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] placeholder:text-[var(--app-text-secondary)]'
                              : 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[var(--app-card-border)] placeholder:text-[color-mix(in_srgb,var(--app-text-secondary)_60%,transparent)]'
                          }`}
                        />
                        {logSearchQuery && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveWorkflowStageFilter(null);
                              setLogSearchQuery('');
                            }}
                            title="Clear search"
                            aria-label="Clear log search"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveWorkflowStageFilter(null);
                          setLogSearchMode((prev) => (prev === 'regex' ? 'text' : 'regex'));
                        }}
                        aria-pressed={logSearchMode === 'regex'}
                        title={
                          logSearchMode === 'regex'
                            ? 'Regex Search Mode Active (click to switch to plain text search)'
                            : 'Switch to Regex Search Mode (e.g. \\[ERROR\\]\\s*\\[auth\\] or stack traces)'
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold border transition-colors cursor-pointer shrink-0 ${
                          logSearchMode === 'regex'
                            ? logTheme === 'high_contrast'
                              ? 'bg-[var(--app-text-primary)] text-[var(--app-bg)] border-[var(--app-text-primary)]'
                              : 'bg-[color-mix(in_srgb,var(--app-accent)_22%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_55%,transparent)]'
                            : logTheme === 'high_contrast'
                            ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                            : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)]'
                        }`}
                      >
                        <Regex className="w-3.5 h-3.5" />
                        <span>Regex</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveWorkflowStageFilter(null);
                          setLogSearchMode((prev) => (prev === 'semantic' ? 'text' : 'semantic'));
                        }}
                        aria-pressed={logSearchMode === 'semantic'}
                        title={
                          logSearchMode === 'semantic'
                            ? 'Semantic Vector Search Active (click to switch to plain text search)'
                            : 'Switch to Semantic Intent Search (TF-IDF + cosine relevance ranking)'
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold border transition-colors cursor-pointer shrink-0 ${
                          logSearchMode === 'semantic'
                            ? logTheme === 'high_contrast'
                              ? 'bg-[var(--app-text-primary)] text-[var(--app-bg)] border-[var(--app-text-primary)]'
                              : 'bg-[color-mix(in_srgb,var(--app-amber)_22%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_55%,transparent)]'
                            : logTheme === 'high_contrast'
                            ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                            : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-amber)]'
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Semantic</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      data-testid="smart-filter-btn"
                      onClick={handleApplySmartFilter}
                      disabled={quickLogs.length === 0 || (hasSearchOrTagFilter && currentSearchMatches.length === 0)}
                      title={
                        lang === 'th'
                          ? 'สร้าง Allow-list อัตโนมัติจากผลลัพธ์การค้นหาปัจจุบัน'
                          : 'Smart Filter: automatically create an allow-list from the current search results'
                      }
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold border transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                        smartFilterAllowList.length > 0
                          ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_50%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] hover:border-[var(--z-ok)]'
                      }`}
                    >
                      <Filter className="w-3 h-3" />
                      <span>Smart Filter</span>
                      {smartFilterAllowList.length > 0 && (
                        <span className="px-1 rounded bg-black/25 text-[9px] tabular-nums">
                          {smartFilterAllowList.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      data-testid="toggle-hide-non-matching"
                      aria-pressed={hideNonMatchingLogs}
                      onClick={() => setHideNonMatchingLogs((prev) => !prev)}
                      title={
                        hideNonMatchingLogs
                          ? 'Showing only matching/allow-listed lines (click to show non-matching context lines)'
                          : 'Hide all non-matching log lines to declutter the terminal view'
                      }
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold border transition-colors cursor-pointer shrink-0 ${
                        hideNonMatchingLogs
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_22%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_55%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      {hideNonMatchingLogs ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{hideNonMatchingLogs ? 'Non-Matching Hidden' : 'Hide Non-Matching'}</span>
                    </button>
                    {hasAnyActiveFilter && quickLogs.length > 0 && (
                      <span
                        className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold border shrink-0 ${
                          logTheme === 'high_contrast'
                            ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)]'
                            : 'bg-[var(--app-bg)] text-[var(--app-accent)] border-[var(--app-card-border)]'
                        }`}
                      >
                        {matchingLogEntries.length}/{quickLogs.length}
                      </span>
                    )}
                    <select
                      value={logTagFilter}
                      onChange={(e) =>
                        setLogTagFilter(e.target.value as 'ALL' | 'INIT' | 'TESTER' | 'DONE' | 'ERROR')
                      }
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold focus:outline-none border cursor-pointer ${
                        logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)]'
                          : 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[var(--app-card-border)]'
                      }`}
                    >
                      <option value="ALL">All Tags</option>
                      <option value="INIT">[INIT]</option>
                      <option value="TESTER">[TESTER]</option>
                      <option value="DONE">[DONE]</option>
                      <option value="ERROR">[ERROR]</option>
                    </select>
                    <div
                      role="region"
                      aria-label="TTS"
                      data-section="tts"
                      className="flex flex-wrap items-center gap-2 pl-2 border-l border-[var(--app-card-border)]"
                    >
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--app-accent)]">
                        TTS
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--app-text-secondary)]">
                        <span>Rate {ttsRate.toFixed(1)}x</span>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.1"
                          value={ttsRate}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setTtsRate(val);
                            localStorage.setItem('zyntheor_tts_rate', String(val));
                          }}
                          className="w-14 accent-[var(--app-accent)] cursor-pointer"
                          title="TTS Speech Rate"
                        />
                      </div>
                      <div
                        className={`relative overflow-hidden flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-mono text-[var(--app-text-secondary)] ${
                          logTheme === 'high_contrast'
                            ? 'bg-[var(--app-bg)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)]'
                            : 'bg-[var(--app-bg)] border-[var(--app-card-border)]'
                        }`}
                      >
                        <label htmlFor="tts-volume-slider" className="relative z-10 font-semibold shrink-0">
                          Volume {ttsVolume.toFixed(2)}x
                        </label>
                        <input
                          id="tts-volume-slider"
                          data-testid="tts-volume-slider"
                          type="range"
                          min="0"
                          max="2"
                          step="0.01"
                          value={ttsVolume}
                          aria-label="TTS Volume"
                          onChange={(e) => updateTtsVolume(parseFloat(e.target.value))}
                          className="relative z-10 w-24 accent-[var(--app-accent)] cursor-pointer"
                          title="TTS Volume (0.00x – 2.00x)"
                        />
                        <div
                          role="group"
                          aria-label="TTS Volume Presets"
                          className="relative z-10 flex items-center gap-1"
                        >
                          {[0.25, 0.5, 1.0, 2.0].map((preset) => {
                            const isActive = Math.abs(ttsVolume - preset) < 0.005;
                            const label = `${preset === 0.25 ? '0.25' : preset.toFixed(1)}x`;
                            return (
                              <button
                                key={preset}
                                type="button"
                                data-testid={`tts-volume-preset-${preset}`}
                                aria-pressed={isActive}
                                onClick={() => updateTtsVolume(preset)}
                                title={`Set TTS volume to ${label}`}
                                className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold border transition-colors cursor-pointer ${
                                  isActive
                                    ? logTheme === 'high_contrast'
                                      ? 'bg-[var(--app-text-primary)] text-[var(--app-bg)] border-[var(--app-text-primary)]'
                                      : 'bg-[color-mix(in_srgb,var(--app-accent)_22%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_55%,transparent)]'
                                    : logTheme === 'high_contrast'
                                    ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_35%,transparent)] hover:bg-[var(--app-surface)]'
                                    : 'bg-[var(--app-surface)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)]'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        <canvas
                          ref={ttsSpectrumCanvasRef}
                          width={160}
                          height={28}
                          data-testid="tts-spectrum-analyzer"
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 w-full h-full z-20 opacity-80"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--app-text-secondary)]">
                        <label htmlFor="tts-voice-select" className="shrink-0">
                          Voice
                        </label>
                        <select
                          id="tts-voice-select"
                          aria-label="Select TTS Voice"
                          value={ttsVoiceUri}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTtsVoiceUri(val);
                            ttsConfigRef.current.ttsVoiceUri = val;
                            localStorage.setItem('zyntheor_tts_voice', val);
                          }}
                          className={`max-w-[160px] px-2 py-1 rounded-md text-[10px] font-mono cursor-pointer border focus:outline-none ${
                            logTheme === 'high_contrast'
                              ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)]'
                              : 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[var(--app-card-border)]'
                          }`}
                          title="Select TTS Voice"
                        >
                          <option value="">Default Voice</option>
                          {ttsVoiceUri && !ttsVoices.some((v) => v.voiceURI === ttsVoiceUri) && (
                            <option key={`saved-${ttsVoiceUri}`} value={ttsVoiceUri}>{ttsVoiceUri} (Saved)</option>
                          )}
                          {ttsVoices.map((v, idx) => (
                            <option key={`${v.voiceURI || 'voice'}-${v.lang || 'und'}-${v.name || 'unnamed'}-${idx}`} value={v.voiceURI}>
                              {v.name} ({v.lang})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  {logSearchMode === 'regex' && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                      {compiledLogSearch.error ? (
                        <span
                          role="alert"
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${
                            logTheme === 'high_contrast'
                              ? 'bg-[var(--app-bg)] text-[var(--z-danger)] border-[var(--z-danger)] font-bold'
                              : 'bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)]'
                          }`}
                        >
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span>Invalid regex: {compiledLogSearch.error}</span>
                        </span>
                      ) : (
                        <>
                          <span className={logTheme === 'high_contrast' ? 'text-[var(--app-text-primary)]' : 'text-[var(--app-text-secondary)]'}>
                            Patterns:
                          </span>
                          {REGEX_SEARCH_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => {
                                setActiveWorkflowStageFilter(null);
                                setLogSearchQuery(preset.pattern);
                              }}
                              className={`px-1.5 py-0.5 rounded-md border transition-colors cursor-pointer ${
                                logSearchQuery === preset.pattern
                                  ? logTheme === 'high_contrast'
                                    ? 'bg-[var(--app-text-primary)] text-[var(--app-bg)] border-[var(--app-text-primary)] font-bold'
                                    : 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] font-bold'
                                  : logTheme === 'high_contrast'
                                  ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_35%,transparent)] hover:bg-[var(--app-surface)]'
                                  : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)]'
                              }`}
                              title={`Apply regex: ${preset.pattern}`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                  {logSearchMode === 'semantic' && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                      <span className={logTheme === 'high_contrast' ? 'text-[var(--app-text-primary)]' : 'text-[var(--app-amber)]'}>
                        {logSearchQuery.trim()
                          ? `Intent Vector Match (${semanticLogSuggestions.length} ranked)`
                          : 'Intents:'}
                      </span>
                      {!logSearchQuery.trim() &&
                        getSemanticIntentPresets().map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setLogSearchQuery(preset.query)}
                            className="px-1.5 py-0.5 rounded-md border border-[var(--app-card-border)] bg-[var(--app-bg)] text-[var(--app-text-secondary)] hover:text-[var(--app-amber)] hover:border-[var(--app-amber)] transition-colors cursor-pointer"
                          >
                            {preset.label}
                          </button>
                        ))}
                    </div>
                  )}
                  {logSearchMode !== 'semantic' &&
                    logSearchQuery.trim().length >= 2 &&
                    semanticLogSuggestions.length > 0 && (
                      <div
                        data-testid="semantic-intent-suggestions"
                        className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono"
                      >
                        <span className="text-[var(--app-amber)] font-semibold shrink-0">
                          {lang === 'th' ? 'แนะนำตามเจตนา:' : 'Intent suggestions:'}
                        </span>
                        {semanticLogSuggestions.slice(0, 3).map((sug) => (
                          <button
                            key={`sug-${sug.originalIdx}`}
                            type="button"
                            onClick={() => setLogSearchMode('semantic')}
                            title={`L${sug.originalIdx + 1} (${sug.scorePct}% intent match): ${sug.log}`}
                            className="max-w-[230px] truncate px-2 py-0.5 rounded-md border border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)] bg-[color-mix(in_srgb,var(--app-amber)_10%,var(--app-bg))] text-[var(--app-text-primary)] hover:border-[var(--app-amber)] cursor-pointer transition-colors"
                          >
                            <span className="text-[var(--app-amber)] font-bold mr-1">
                              L{sug.originalIdx + 1} · {sug.scorePct}%
                            </span>
                            <span className="opacity-85">{sug.log.replace(/^\[[A-Z0-9_]+\]\s*/, '')}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  {smartFilterAllowList.length > 0 && (
                    <div
                      data-testid="smart-filter-allowlist"
                      className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono pt-1 border-t border-[color-mix(in_srgb,var(--app-card-border)_60%,transparent)]"
                    >
                      <span className="inline-flex items-center gap-1 text-[var(--z-ok)] font-bold shrink-0">
                        <Filter className="w-3 h-3" />
                        Allow-list ({smartFilterAllowList.length}):
                      </span>
                      {smartFilterAllowList.slice(0, 4).map((entry) => (
                        <span
                          key={entry}
                          className="inline-flex items-center gap-1 max-w-[200px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--z-ok)_12%,var(--app-bg))] text-[var(--app-text-primary)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]"
                        >
                          <span className="truncate">{entry}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setSmartFilterAllowList((prev) => prev.filter((item) => item !== entry))
                            }
                            aria-label={`Remove ${entry} from allow-list`}
                            className="text-[var(--app-text-secondary)] hover:text-[var(--z-danger)] cursor-pointer shrink-0"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      ))}
                      {smartFilterAllowList.length > 4 && (
                        <span className="text-[var(--app-text-secondary)]">
                          +{smartFilterAllowList.length - 4} more
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setSmartFilterAllowList([])}
                        className="ml-auto px-2 py-0.5 rounded border border-[var(--app-card-border)] bg-[var(--app-bg)] text-[var(--app-text-secondary)] hover:text-[var(--z-danger)] hover:border-[var(--z-danger)] cursor-pointer"
                      >
                        Clear Allow-list
                      </button>
                    </div>
                  )}
                </div>
                {bulkMode && (
                  <div
                    className={`px-3.5 py-2 flex flex-wrap items-center gap-2 border-b text-[10px] font-mono ${
                      logTheme === 'high_contrast'
                        ? 'bg-[var(--app-bg)] border-[color-mix(in_srgb,var(--app-text-primary)_30%,transparent)] text-[var(--app-text-primary)]'
                        : 'bg-[var(--app-surface-elevated)] border-[var(--app-card-border)]'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={quickLogs.length === 0}
                      onClick={() => {
                        if (selectedLogIndices.length === quickLogs.length) {
                          setSelectedLogIndices([]);
                        } else {
                          setSelectedLogIndices(quickLogs.map((_, idx) => idx));
                        }
                      }}
                      className="px-2 py-0.5 rounded bg-[var(--app-bg)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-40"
                    >
                      {selectedLogIndices.length === quickLogs.length && quickLogs.length > 0 ? 'Deselect All' : 'Select All'}
                    </button>
                    <span className="text-[var(--app-accent)] font-bold">{selectedLogIndices.length} selected</span>
                    <button
                      type="button"
                      disabled={quickLogs.length === 0}
                      onClick={handleAutoCategorizeLogs}
                      title="Classify and group logs by semantic function (I/O, Computation, Authentication, System)"
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_18%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_28%,transparent)] font-bold cursor-pointer disabled:opacity-40"
                    >
                      <Sparkles className="w-3 h-3" />
                      Auto-Categorize
                    </button>
                    {Object.keys(logCategories).length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setGroupByCategory((prev) => !prev)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border cursor-pointer ${
                            groupByCategory
                              ? 'bg-[color-mix(in_srgb,var(--z-ok)_18%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)]'
                              : 'bg-[var(--app-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)]'
                          }`}
                        >
                          <Layers className="w-3 h-3" />
                          {groupByCategory ? 'Grouped' : 'Group View'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLogCategories({});
                            setGroupByCategory(false);
                          }}
                          className="px-2 py-0.5 rounded bg-[var(--app-bg)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] cursor-pointer"
                        >
                          Clear Labels
                        </button>
                        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                          {SEMANTIC_CATEGORY_ORDER.map((cat) => {
                            const count = Object.values(logCategories).filter((c) => c === cat).length;
                            if (count === 0) return null;
                            return (
                              <span
                                key={cat}
                                className={`px-1.5 py-0.2 rounded border text-[9.5px] font-bold ${getSemanticCategoryBadgeClass(cat)}`}
                              >
                                {cat}: {count}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {selectedLogIndices.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setQuickLogs((prev) => prev.filter((_, i) => !selectedLogIndices.includes(i)));
                            setSelectedLogIndices([]);
                            setLogCategories({});
                            setGroupByCategory(false);
                          }}
                          className="px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const subset = quickLogs.filter((_, i) => selectedLogIndices.includes(i)).join('\n');
                            const blob = new Blob([subset], { type: 'text/plain;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `zyntheor-selected-logs-${Date.now()}.log`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="px-2 py-0.5 rounded bg-[var(--app-bg)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] cursor-pointer"
                        >
                          Export Selected
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setQuickLogs((prev) =>
                              prev.map((l, i) => (selectedLogIndices.includes(i) && !l.startsWith('[AUDIT]') ? `[AUDIT] ${l}` : l))
                            );
                            setSelectedLogIndices([]);
                          }}
                          className="px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-amber)_20%,transparent)] text-[var(--app-amber)] border border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)] cursor-pointer"
                        >
                          Categorize [AUDIT]
                        </button>
                      </>
                    )}
                  </div>
                )}
                {showPerfMetrics && (
                  <div
                    className={`px-3.5 py-1.5 flex items-center gap-4 border-b text-[10px] font-mono ${
                      logTheme === 'high_contrast'
                        ? 'bg-[var(--app-bg)] border-[color-mix(in_srgb,var(--app-text-primary)_25%,transparent)] text-[var(--app-text-primary)]'
                        : 'bg-[var(--app-surface)] border-[var(--app-card-border)] text-[var(--app-text-secondary)]'
                    }`}
                  >
                    <span>
                      Total Execution: <strong className="text-[var(--app-text-primary)]">{totalExecMs !== null ? `${totalExecMs} ms` : 'Running / N/A'}</strong>
                    </span>
                    <span>
                      Throughput:{' '}
                      <strong className="text-[var(--app-accent)]">
                        {totalExecMs && totalExecMs > 0
                          ? `${((quickLogs.length / totalExecMs) * 1000).toFixed(2)} steps/s`
                          : 'N/A'}
                      </strong>
                    </span>
                  </div>
                )}
                {showPerfTrendsInTerminal && (
                  <div className="p-3.5 border-b border-[var(--app-card-border)] bg-[var(--app-surface)]">
                    <PerformanceTrendsChart
                      points={performanceTrendPoints}
                      isRunning={isQuickRunning}
                      lang={lang}
                      compact
                    />
                  </div>
                )}
                {/* Summary Dashboard Header */}
                <div
                  className={`px-3.5 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono border-b ${
                    logTheme === 'high_contrast'
                      ? 'bg-[var(--app-bg)] border-[color-mix(in_srgb,var(--app-text-primary)_20%,transparent)] text-[var(--app-text-primary)]'
                      : 'bg-[var(--app-bg)] border-[var(--app-card-border)] text-[var(--app-text-secondary)]'
                  }`}
                >
                  <span className="text-[var(--z-danger)] font-bold">
                    ERROR: {quickLogs.filter((l) => l.includes('[ERROR]')).length}
                  </span>
                  <span className="text-[var(--app-amber)] font-bold">
                    TESTER: {quickLogs.filter((l) => l.includes('[TESTER]')).length}
                  </span>
                  <span className="text-[var(--z-ok)] font-bold">
                    DONE: {quickLogs.filter((l) => l.includes('[DONE]')).length}
                  </span>
                  {quickLogs.length > 0 && !showSentimentTrend && (
                    <button
                      type="button"
                      data-testid="sentiment-trend-hidden-hint"
                      onClick={toggleSentimentTrend}
                      className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-secondary)] hover:text-[var(--app-accent)] hover:border-[var(--app-accent)] text-[9.5px] cursor-pointer"
                      title={lang === 'th' ? 'กด Alt+V หรือคลิกเพื่อแสดงกราฟ Sentiment' : 'Press Alt+V or click to show Sentiment Trend chart'}
                    >
                      <Eye className="w-3 h-3" />
                      <span>{lang === 'th' ? 'แสดง Sentiment (Alt+V)' : 'Show Sentiment (Alt+V)'}</span>
                    </button>
                  )}
                  {quickLogs.length > 0 && showSentimentTrend && (() => {
                    let score = 0;
                    const trendPoints = quickLogs.map((l, i) => {
                      const schema = resolveSentimentEventSchema(l);
                      score += schema.delta;
                      const x = quickLogs.length === 1 ? 50 : (i / (quickLogs.length - 1)) * 100;
                      const y = Math.max(2, Math.min(18, 10 - score * 2));
                      const tagMatch = l.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
                      const tag = tagMatch ? tagMatch[1] : null;
                      const message = tagMatch ? tagMatch[2] : l;
                      return {
                        index: i,
                        x,
                        y,
                        delta: schema.delta,
                        score,
                        eventType: schema.kind,
                        tag,
                        message,
                        raw: l,
                      };
                    });
                    const activePoint =
                      hoveredTrendIndex !== null && hoveredTrendIndex < trendPoints.length
                        ? trendPoints[hoveredTrendIndex]
                        : null;
                    const polylinePoints = trendPoints.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');

                    return (
                      <div
                        className="relative flex flex-wrap items-center gap-2 ml-2"
                        data-testid="session-sentiment-trend"
                      >
                        <span className="opacity-70" title="Session Sentiment Trend">
                          Trend
                        </span>
                        <svg
                          width="84"
                          height="22"
                          viewBox="0 0 100 20"
                          className="overflow-visible cursor-crosshair"
                          role="img"
                          aria-label="Session Sentiment Trend"
                          onMouseLeave={() => setHoveredTrendIndex(null)}
                          onMouseMove={(e) => {
                            if (trendPoints.length === 0) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            if (rect.width <= 0) return;
                            const relX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
                            let nearestIdx = 0;
                            let minDist = Math.abs(trendPoints[0].x - relX);
                            for (let idx = 1; idx < trendPoints.length; idx += 1) {
                              const d = Math.abs(trendPoints[idx].x - relX);
                              if (d < minDist) {
                                minDist = d;
                                nearestIdx = idx;
                              }
                            }
                            setHoveredTrendIndex(nearestIdx);
                          }}
                        >
                          <polyline
                            fill="none"
                            stroke="var(--app-accent)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={polylinePoints}
                          />
                          {trendPoints.map((pt) => {
                            const ptSchema = SENTIMENT_EVENT_SCHEMA[pt.eventType];
                            const isHovered = activePoint?.index === pt.index;
                            const baseRadius = pt.eventType === 'neutral' ? 1.1 : 2.1;
                            return (
                              <g
                                key={pt.index}
                                tabIndex={0}
                                role="button"
                                aria-label={`Line ${pt.index + 1} (${ptSchema.label} ${ptSchema.deltaLabel}): ${pt.raw}`}
                                data-testid={`sentiment-point-${pt.index}`}
                                onMouseEnter={() => setHoveredTrendIndex(pt.index)}
                                onFocus={() => setHoveredTrendIndex(pt.index)}
                                onBlur={() =>
                                  setHoveredTrendIndex((prev) => (prev === pt.index ? null : prev))
                                }
                                className="focus:outline-none cursor-pointer"
                              >
                                <title>
                                  {`L${pt.index + 1}/${trendPoints.length} · ${ptSchema.label} (${ptSchema.deltaLabel}) · Score ${
                                    pt.score > 0 ? `+${pt.score}` : pt.score
                                  }: ${pt.raw}`}
                                </title>
                                <circle cx={pt.x} cy={pt.y} r={5} fill="transparent" />
                                <circle
                                  cx={pt.x}
                                  cy={pt.y}
                                  r={isHovered ? 3.4 : baseRadius}
                                  fill={ptSchema.color}
                                  stroke={isHovered ? 'var(--app-text-primary)' : 'var(--app-bg)'}
                                  strokeWidth={isHovered ? 1.2 : 0.75}
                                />
                              </g>
                            );
                          })}
                        </svg>
                        <div
                          data-testid="sentiment-trend-legend"
                          aria-label="Session Sentiment Trend Legend"
                          className="inline-flex flex-wrap items-center gap-2 text-[9px] opacity-90 border-l border-[var(--app-card-border)] pl-2"
                        >
                          {(['completion', 'neutral', 'error'] as const).map((kind) => {
                            const item = SENTIMENT_EVENT_SCHEMA[kind];
                            return (
                              <span
                                key={kind}
                                className="inline-flex items-center gap-1"
                                title={`${item.label} (${item.deltaLabel}): ${item.description}`}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: item.color }}
                                />
                                <span>
                                  {item.label} ({item.deltaLabel})
                                </span>
                              </span>
                            );
                          })}
                        </div>
                        {activePoint && (() => {
                          const schema = SENTIMENT_EVENT_SCHEMA[activePoint.eventType] ?? SENTIMENT_EVENT_SCHEMA.neutral;
                          const EventIcon = schema.Icon;
                          const formattedScore = activePoint.score > 0 ? `+${activePoint.score}` : String(activePoint.score);
                          return (
                            <div
                              role="tooltip"
                              data-testid="sentiment-trend-tooltip"
                              style={{
                                left: `${Math.min(88, Math.max(12, activePoint.x))}%`,
                              }}
                              className={`pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 z-50 w-72 max-w-[19rem] rounded-lg border px-2.5 py-2 shadow-xl text-[10px] font-mono leading-snug ${
                                logTheme === 'high_contrast'
                                  ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[var(--app-text-primary)]'
                                  : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className="inline-flex items-center gap-1 min-w-0">
                                  <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold border text-[9px] uppercase ${schema.badgeClass}`}
                                  >
                                    <EventIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
                                    <span>{schema.label}</span>
                                  </span>
                                  {activePoint.tag && (
                                    <span className="text-[9px] text-[var(--app-text-secondary)] truncate">
                                      [{activePoint.tag}]
                                    </span>
                                  )}
                                </div>
                                <span className="text-[9px] text-[var(--app-text-secondary)] tabular-nums shrink-0">
                                  Line {activePoint.index + 1}/{trendPoints.length}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 px-2 py-1 mb-1.5 rounded border border-[var(--app-card-border)] bg-[var(--app-bg)] text-[9px] tabular-nums">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-[var(--app-text-secondary)] uppercase">Delta</span>
                                  <strong style={{ color: schema.color }}>{schema.deltaLabel}</strong>
                                </div>
                                <div className="flex items-center justify-between gap-1 border-l border-[var(--app-card-border)] pl-2">
                                  <span className="text-[var(--app-text-secondary)] uppercase">Score</span>
                                  <strong className="text-[var(--app-text-primary)]">{formattedScore}</strong>
                                </div>
                              </div>
                              <div className="text-[9px] text-[var(--app-text-secondary)] mb-1">
                                {schema.description}
                              </div>
                              <div className="text-[var(--app-text-primary)] break-words line-clamp-3 border-t border-[var(--app-card-border)] pt-1">
                                {activePoint.message || activePoint.raw}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
                  {ttsEnabled && (activeTtsLineIndex !== null || ttsPaused || ttsQueueLength > 0) && (
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-bold ${
                        ttsPaused
                          ? 'bg-[color-mix(in_srgb,var(--app-amber)_16%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)]'
                          : 'bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                      }`}
                    >
                      {ttsPaused ? <Pause className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                      <span>
                        {ttsPaused
                          ? activeTtsLineIndex !== null
                            ? `Paused L${activeTtsLineIndex + 1}`
                            : 'TTS Paused'
                          : activeTtsLineIndex !== null
                          ? `Reading L${activeTtsLineIndex + 1}`
                          : 'TTS Ready'}
                        {ttsQueueLength > 0 ? ` (+${ttsQueueLength} queued)` : ''}
                      </span>
                    </span>
                  )}
                  <span className="ml-auto opacity-60 hidden sm:inline">
                    Ctrl+Home/End · Ctrl+C
                  </span>
                </div>
                <div
                  ref={logsContainerRef}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.ctrlKey && e.key === 'Home') {
                      e.preventDefault();
                      logsContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    } else if (e.ctrlKey && e.key === 'End') {
                      e.preventDefault();
                      if (logsContainerRef.current) {
                        logsContainerRef.current.scrollTo({
                          top: logsContainerRef.current.scrollHeight,
                          behavior: 'smooth'
                        });
                      }
                    } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
                      const selection = window.getSelection()?.toString();
                      if (!selection) {
                        e.preventDefault();
                        handleCopyLogs();
                      }
                    }
                  }}
                  className={`p-4 max-h-56 rounded-b-xl overflow-y-auto ${
                    logTextWrap ? 'overflow-x-hidden' : 'overflow-x-auto'
                  } space-y-1.5 focus:outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]`}
                >
                  {quickLogs.length === 0 ? (
                    <span className={logTheme === 'high_contrast' ? 'text-[var(--app-text-secondary)] italic' : 'text-[color-mix(in_srgb,var(--app-text-secondary)_70%,transparent)] italic'}>
                      {lang === 'th' 
                        ? 'กด "สั่งการประมวลผล" เพื่อเริ่มการประมวลผลและดูเส้นทางการคิด' 
                        : 'Click "Dispatch Engine" to stream real native execution trace.'}
                    </span>
                  ) : filteredLogEntries.length === 0 ? (
                    <div
                      className={`text-[11px] flex flex-wrap items-center gap-2 ${
                        logTheme === 'high_contrast'
                          ? 'text-[var(--app-text-primary)]'
                          : 'text-[var(--app-text-secondary)]'
                      }`}
                    >
                      <span>
                        {activeWorkflowStageMeta
                          ? lang === 'th'
                            ? `ยังไม่มีบันทึกในขั้นตอน ${String(activeWorkflowStageMeta.order).padStart(2, '0')}: ${activeWorkflowStageMeta.labelTh}`
                            : `No trace entries recorded for Stage ${String(activeWorkflowStageMeta.order).padStart(2, '0')}: ${activeWorkflowStageMeta.labelEn} yet.`
                          : logSearchMode === 'regex' && compiledLogSearch.error
                          ? `Regex pattern error: ${compiledLogSearch.error}`
                          : lang === 'th'
                          ? `ไม่พบบันทึกที่ตรงกับตัวกรอง "${logSearchQuery || logTagFilter}"`
                          : `No trace entries match ${
                              logSearchMode === 'regex'
                                ? `regex /${logSearchQuery}/`
                                : `"${logSearchQuery || logTagFilter}"`
                            }.`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveWorkflowStageFilter(null);
                          setLogSearchQuery('');
                          setLogTagFilter('ALL');
                          setSmartFilterAllowList([]);
                          setHideNonMatchingLogs(false);
                        }}
                        className={`px-2 py-0.5 rounded-md border text-[10px] font-bold cursor-pointer ${
                          logTheme === 'high_contrast'
                            ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[var(--app-text-primary)]'
                            : 'bg-[var(--app-surface)] text-[var(--app-accent)] border-[var(--app-card-border)]'
                        }`}
                      >
                        Reset Filter
                      </button>
                    </div>
                  ) : (() => {
                    const renderLogRow = (log: string, originalIdx: number) => {
                      const now = new Date();
                      const ts =
                        logTimeMode === 'relative'
                          ? `+${(originalIdx * 0.25).toFixed(2)}s`
                          : `${String(now.getHours()).padStart(2, '0')}:${String(
                              now.getMinutes()
                            ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}:${String(
                              now.getMilliseconds()
                            ).padStart(3, '0')}`;
                      const match = log.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
                      const tag = match ? match[1] : null;
                      const message = match ? match[2] : log;
                      const semanticCat = logCategories[originalIdx];

                      const badgeClass =
                        tag === 'ERROR'
                          ? logTheme === 'high_contrast'
                            ? 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)] border-[var(--z-danger)]'
                            : 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)]'
                          : tag === 'DONE'
                          ? logTheme === 'high_contrast'
                            ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)] border-[var(--z-ok)]'
                            : 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                          : tag === 'WARN'
                          ? logTheme === 'high_contrast'
                            ? 'bg-[color-mix(in_srgb,var(--z-warn)_22%,transparent)] text-[var(--z-warn)] border-[var(--z-warn)]'
                            : 'bg-[color-mix(in_srgb,var(--z-warn)_20%,transparent)] text-[var(--z-warn)] border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)]'
                          : tag === 'TESTER'
                          ? logTheme === 'high_contrast'
                            ? 'bg-[color-mix(in_srgb,var(--app-amber)_20%,transparent)] text-[var(--app-amber)] border-[var(--app-amber)]'
                            : 'bg-[color-mix(in_srgb,var(--app-amber)_20%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)]'
                          : tag === 'INIT'
                          ? logTheme === 'high_contrast'
                            ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[var(--app-accent)]'
                            : 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_50%,transparent)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] border-[var(--app-card-border)]';

                      const tagMatchedBySearch =
                        tag && activeHighlightRegex ? activeHighlightRegex.test(`[${tag}]`) : false;

                      const isNegative = /\[ERROR\]|fail|error|blocked/i.test(log);
                      const isPositive = /\[DONE\]|success|verified|exitCode:\s*0|passed/i.test(log);
                      const sentimentDotClass = isNegative
                        ? 'bg-[var(--z-danger)]'
                        : isPositive
                        ? 'bg-[var(--z-ok)]'
                        : 'bg-[var(--app-amber)]';

                      const isActiveTtsLine = ttsEnabled && activeTtsLineIndex === originalIdx;
                      const isEntryMatched = isLogEntryMatching(log, originalIdx);
                      const isEntryAllowListed = smartFilterAllowList.length > 0 && allowListSet.has(log);
                      const isDimmedNonMatch = hasAnyActiveFilter && !hideNonMatchingLogs && !isEntryMatched;

                      return (
                        <div
                          key={originalIdx}
                          ref={isActiveTtsLine ? activeTtsRowRef : undefined}
                          data-tts-active={isActiveTtsLine ? 'true' : undefined}
                          data-log-matched={isEntryMatched ? 'true' : 'false'}
                          aria-current={isActiveTtsLine ? 'step' : undefined}
                          className={`text-[11px] leading-relaxed flex items-start gap-2 text-[var(--app-text-primary)] transition-all ${
                            isDimmedNonMatch
                              ? 'opacity-35'
                              : hasAnyActiveFilter && isEntryMatched && !isActiveTtsLine
                              ? 'rounded-md px-1.5 py-0.5 -mx-1.5 bg-[color-mix(in_srgb,var(--z-ok)_8%,transparent)] border-l-2 border-[var(--z-ok)]'
                              : ''
                          } ${
                            isActiveTtsLine
                              ? logTheme === 'high_contrast'
                                ? 'rounded-md px-1.5 py-0.5 -mx-1.5 bg-[color-mix(in_srgb,var(--app-accent)_22%,transparent)] border-l-2 border-[var(--app-text-primary)]'
                                : 'rounded-md px-1.5 py-0.5 -mx-1.5 bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] border-l-2 border-[var(--app-accent)]'
                              : ''
                          }`}
                        >
                          {bulkMode && (
                            <input
                              type="checkbox"
                              checked={selectedLogIndices.includes(originalIdx)}
                              onChange={(e) => {
                                setSelectedLogIndices((prev) =>
                                  e.target.checked
                                    ? [...prev, originalIdx]
                                    : prev.filter((i) => i !== originalIdx)
                                );
                              }}
                              className="mt-1 accent-[var(--app-accent)] cursor-pointer shrink-0"
                            />
                          )}
                          <span
                            className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${sentimentDotClass}`}
                            title={isNegative ? 'Alert' : isPositive ? 'Positive' : 'Neutral'}
                          />
                          {showLineNumbers && (
                            <span
                              data-line-number={originalIdx + 1}
                              data-tts-highlighted={isActiveTtsLine ? 'true' : 'false'}
                              onClick={() => {
                                if (ttsEnabled) {
                                  speakLogLine(log, originalIdx, true);
                                }
                              }}
                              title={
                                isActiveTtsLine
                                  ? `Line ${originalIdx + 1} — Reading via TTS`
                                  : ttsEnabled
                                  ? `Line ${originalIdx + 1} (click to read with TTS)`
                                  : `Line ${originalIdx + 1}`
                              }
                              className={`text-[10px] font-mono tabular-nums shrink-0 select-none min-w-[1.75rem] pr-1.5 text-right border-r transition-colors ${
                                ttsEnabled ? 'cursor-pointer' : ''
                              } ${
                                isActiveTtsLine
                                  ? 'bg-[var(--app-accent)] text-black font-bold rounded px-1 border-r-transparent ring-1 ring-[var(--app-accent)] shadow-sm'
                                  : logTheme === 'high_contrast'
                                  ? 'text-[var(--app-text-secondary)] border-[color-mix(in_srgb,var(--app-text-primary)_25%,transparent)]'
                                  : 'text-[color-mix(in_srgb,var(--app-text-secondary)_60%,transparent)] border-[color-mix(in_srgb,var(--app-card-border)_60%,transparent)]'
                              }`}
                            >
                              {originalIdx + 1}
                            </span>
                          )}
                          <span
                            className={`text-[10px] shrink-0 select-none ${
                              logTheme === 'high_contrast'
                                ? 'text-[var(--app-text-secondary)]'
                                : 'text-[color-mix(in_srgb,var(--app-text-secondary)_70%,transparent)]'
                            }`}
                          >
                            {ts}
                          </span>
                          {semanticCat && (
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold border shrink-0 ${getSemanticCategoryBadgeClass(
                                semanticCat
                              )}`}
                              title={`Semantic function: ${semanticCat}`}
                            >
                              {semanticCat}
                            </span>
                          )}
                          {tag && (
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-bold border shrink-0 ${badgeClass} ${
                                tagMatchedBySearch
                                  ? logTheme === 'high_contrast'
                                    ? 'ring-2 ring-[var(--app-text-primary)]'
                                    : 'ring-1 ring-[var(--app-accent)]'
                                  : ''
                              }`}
                            >
                              {tag}
                            </span>
                          )}
                          {logSearchMode === 'semantic' && logSearchQuery.trim() && semanticScoreMap.has(originalIdx) && (
                            <span
                              className="text-[10px] font-mono tabular-nums text-[var(--app-amber)] shrink-0"
                              title={`Semantic relevance: ${semanticScoreMap.get(originalIdx)!.matchedConcepts.join(', ') || 'intent match'}`}
                            >
                              {semanticScoreMap.get(originalIdx)!.scorePct}%
                            </span>
                          )}
                          {isEntryAllowListed && (
                            <span
                              className="px-1 py-0.2 rounded text-[9px] font-bold border bg-[color-mix(in_srgb,var(--z-ok)_16%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)] shrink-0"
                              title="Allow-listed by Smart Filter"
                            >
                              ALLOW
                            </span>
                          )}
                          <span className={logTextWrap ? 'break-words whitespace-pre-wrap' : 'whitespace-nowrap'}>
                            {renderHighlightedLog(message, logTheme, activeHighlightRegex)}
                          </span>
                        </div>
                      );
                    };

                    if (groupByCategory && Object.keys(logCategories).length > 0) {
                      const grouped = new Map<string, Array<{ log: string; originalIdx: number }>>();
                      for (const cat of SEMANTIC_CATEGORY_ORDER) grouped.set(cat, []);
                      grouped.set('Uncategorized', []);
                      for (const item of filteredLogEntries) {
                        const cat = logCategories[item.originalIdx] ?? 'Uncategorized';
                        grouped.get(cat)!.push(item);
                      }
                      return Array.from(grouped.entries())
                        .filter(([, items]) => items.length > 0)
                        .map(([cat, items]) => (
                          <div key={cat} className="space-y-1.5 pb-2 border-b border-[color-mix(in_srgb,var(--app-card-border)_50%,transparent)] last:border-b-0">
                            <div className="flex items-center gap-2 pt-1">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold border uppercase tracking-wider ${
                                  cat === 'Uncategorized'
                                    ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] border-[var(--app-card-border)]'
                                    : getSemanticCategoryBadgeClass(cat as LogSemanticCategory)
                                }`}
                              >
                                {cat} ({items.length})
                              </span>
                            </div>
                            {items.map(({ log, originalIdx }) => renderLogRow(log, originalIdx))}
                          </div>
                        ));
                    }

                    return filteredLogEntries.map(({ log, originalIdx }) => renderLogRow(log, originalIdx));
                  })()}
                  <div ref={logsEndRef} />
                </div>
              </div>

              {quickDone && (
                <div 
                  className="flex flex-col gap-1 p-3 rounded-xl text-xs font-semibold"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--z-ok) 12%, transparent)',
                    color: 'var(--status-verified)',
                    border: '1px solid color-mix(in srgb, var(--z-ok) 30%, transparent)'
                  }}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[var(--z-ok)]" />
                    <span>
                      {lang === 'th'
                        ? 'การทำงานเสร็จสิ้น (exitCode 0) บันทึก SHA-256 ลง Audit Ledger สำเร็จ'
                        : 'Execution verified with exitCode 0 in /workspace. SHA-256 logged.'}
                    </span>
                  </div>
                  {verificationHash && (
                    <div className="text-[10px] font-mono text-[var(--app-text-secondary)] truncate">
                      Verification Hash (SHA-256): {verificationHash}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div 
              className="px-6 py-3 flex items-center justify-between"
              style={{
                borderTop: '1px solid var(--app-card-border)',
                backgroundColor: 'var(--app-surface)'
              }}
            >
              <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-[var(--app-text-secondary)]">
                <span>Shortcut:</span>
                <kbd className="px-1.5 py-0.5 rounded bg-black/30 border border-[var(--app-card-border)] text-[var(--app-accent)] font-bold text-[10px]">
                  Ctrl + Enter
                </kbd>
                <span className="opacity-60">to dispatch</span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setIsQuickTaskOpen(false)}
                  className="px-4 py-2 text-xs font-semibold transition-colors cursor-pointer"
                  style={{ color: 'var(--app-text-secondary)' }}
                >
                  {lang === 'th' ? 'ปิด (Esc)' : 'Close (Esc)'}
                </button>
                <button
                  onClick={handleRunQuickAgent}
                  disabled={isQuickRunning}
                  className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-[var(--app-text-primary)] vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  {isQuickRunning 
                    ? (lang === 'th' ? 'กำลังประมวลผล...' : 'Dispatching Engine...') 
                    : (lang === 'th' ? 'สั่งการประมวลผล (Ctrl+Enter)' : 'Dispatch Engine (Ctrl+Enter)')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Comparison Sidebar Overlay */}
      {isSnapshotDrawerOpen && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-[var(--app-surface)] border-l border-[var(--app-card-border)] h-full flex flex-col shadow-2xl">
            <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--app-card-border)] bg-[var(--app-surface-elevated)]">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[var(--app-accent)]" />
                <h3 className="text-sm font-bold text-[var(--app-text-primary)]">
                  Execution Snapshots ({snapshots.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSnapshotDrawerOpen(false)}
                className="p-1 rounded-lg text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {snapshots.length === 0 ? (
                <div className="text-xs text-[var(--app-text-secondary)] italic">
                  No snapshots saved yet. Click the camera icon in the log header to save a snapshot.
                </div>
              ) : (
                snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-2"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-[var(--app-accent)] font-bold">{snap.logs.length} entries</span>
                      <span className="text-[var(--app-text-secondary)]">{new Date(snap.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-xs font-semibold text-[var(--app-text-primary)] truncate">{snap.goal}</div>
                    <div className="max-h-32 overflow-y-auto bg-[var(--app-surface)] p-2 rounded-lg border border-[var(--app-card-border)] font-mono text-[10px] text-[var(--app-text-secondary)] space-y-1">
                      {snap.logs.map((l, i) => (
                        <div key={i} className="truncate">
                          <span className="opacity-50 mr-1.5">{i + 1}.</span>
                          {renderHighlightedLog(l, logTheme)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Cheat Sheet Modal */}
      {isShortcutsModalOpen && (
        <div className="fixed inset-0 z-[70] bg-[color-mix(in_srgb,var(--app-bg)_75%,transparent)] backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="rounded-3xl w-full max-w-xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] transition-colors"
            style={{
              backgroundColor: 'var(--app-card)',
              borderColor: 'var(--app-card-border)',
              color: 'var(--app-text-primary)'
            }}
          >
            <div
              className="px-6 py-4 flex items-center justify-between"
              style={{
                borderBottom: '1px solid var(--app-card-border)',
                backgroundColor: 'var(--app-surface)'
              }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg vivid-gradient-brand flex items-center justify-center text-[var(--app-text-primary)] font-bold shrink-0 shadow-sm">
                  <Keyboard className="w-4 h-4 text-[var(--app-amber)]" />
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-tight" style={{ color: 'var(--app-text-primary)' }}>
                    {lang === 'th' ? 'แป้นพิมพ์ลัดสำหรับผู้ใช้ขั้นสูง' : 'Power User Keyboard Shortcuts'}
                  </h3>
                  <p className="text-[11px]" style={{ color: 'var(--app-text-secondary)' }}>
                    {lang === 'th' ? 'สั่งการระบบ Native Intelligence ได้อย่างรวดเร็วโดยไม่ต้องใช้เมาส์' : 'Operate ZYNTHEOR at maximum velocity without mouse dependencies'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsShortcutsModalOpen(false)}
                className="p-1.5 rounded-lg transition-colors cursor-pointer"
                style={{ color: 'var(--app-text-secondary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              {/* Category 1: Execution & Dispatch */}
              <div>
                <h4 className="text-[11px] font-bold text-[var(--app-accent)] mb-2.5 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'การสั่งการและควบคุม Modal' : 'Intelligence Dispatch & Modals'}</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'เปิด/ปิด หน้าต่างด่วน' : 'Toggle Quick Task'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-amber)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Ctrl + K
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'สั่งการประมวลผลทันที' : 'Dispatch Engine'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-accent)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Ctrl + Enter
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'ปิดหน้าต่าง / ถอยกลับ' : 'Close Active Modal'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-text-primary)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Esc
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'เปิดหน้านี้ (คำแนะนำ)' : 'Show Shortcuts'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-accent)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Ctrl + / or ?
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'เปิด/ปิด ผู้ช่วย AI' : 'Toggle AI Assistant'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-accent)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Alt + A
                    </kbd>
                  </div>
                </div>
              </div>

              {/* Category 2: Trace & Terminal Actions */}
              <div>
                <h4 className="text-[11px] font-bold text-[var(--app-amber)] mb-2.5 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'การจัดการบันทึกและสแนปช็อต' : 'Trace & Audit Log Management'}</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'คัดลอกบันทึกทั้งหมด' : 'Copy Full Trace'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-text-primary)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Ctrl + Shift + C
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'ดาวน์โหลดไฟล์ .log' : 'Download .log File'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-text-primary)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Ctrl + Shift + D
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'เปิดเมนูส่งออกข้อมูล' : 'Open Export Menu'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-accent)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Ctrl + Shift + E
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'บันทึก Snapshot' : 'Take Snapshot'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-accent)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Ctrl + Shift + S
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'ประวัติ Snapshots' : 'Snapshot Drawer'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-amber)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Alt + H
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'ล้างบันทึกปัจจุบัน' : 'Clear Logs'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--z-danger)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Alt + C
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'แสดง/ซ่อนกราฟ Sentiment' : 'Toggle Sentiment Trend'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-accent)] font-mono font-bold text-[11px] border border-[var(--app-card-border)]">
                      Alt + V
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)]">{lang === 'th' ? 'เลื่อนบนสุด / ล่างสุด' : 'Scroll Top / End'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-black/40 text-[var(--app-text-secondary)] font-mono font-bold text-[10px] border border-[var(--app-card-border)]">
                      Ctrl + Home / End
                    </kbd>
                  </div>
                </div>
              </div>

              {/* Category 3: Quick Navigation */}
              <div>
                <h4 className="text-[11px] font-bold text-[var(--app-accent)] mb-2.5 flex items-center gap-1.5">
                  <span>{lang === 'th' ? 'การสลับโมดูลระบบด่วน' : 'Rapid Module Switching (Alt + 1..9)'}</span>
                </h4>
                <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                  <div className="p-2 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)] truncate">1. Command</span>
                    <kbd className="text-[var(--app-amber)]">Alt+1</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)] truncate">2. Chat</span>
                    <kbd className="text-[var(--app-amber)]">Alt+2</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)] truncate">3. Core</span>
                    <kbd className="text-[var(--app-amber)]">Alt+3</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)] truncate">4. DevStudio</span>
                    <kbd className="text-[var(--app-amber)]">Alt+4</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)] truncate">5. Research</span>
                    <kbd className="text-[var(--app-amber)]">Alt+5</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)] truncate">6. Auto</span>
                    <kbd className="text-[var(--app-amber)]">Alt+6</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)] truncate">7. Knowledge</span>
                    <kbd className="text-[var(--app-amber)]">Alt+7</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)] truncate">8. ModelLab</span>
                    <kbd className="text-[var(--app-amber)]">Alt+8</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between">
                    <span className="text-[var(--app-text-secondary)] truncate">9. Governance</span>
                    <kbd className="text-[var(--app-amber)]">Alt+9</kbd>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="px-6 py-3 flex items-center justify-between"
              style={{
                borderTop: '1px solid var(--app-card-border)',
                backgroundColor: 'var(--app-surface)'
              }}
            >
              <span className="text-[11px] font-mono text-[var(--app-text-secondary)]">
                {lang === 'th' ? 'รองรับทั้ง macOS (⌘) และ Windows/Linux (Ctrl)' : 'Compatible with macOS (Cmd) & Linux/Windows (Ctrl)'}
              </span>
              <button
                type="button"
                onClick={() => setIsShortcutsModalOpen(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] hover:border-[var(--app-accent)] transition-colors cursor-pointer"
              >
                {lang === 'th' ? 'ปิดหน้านี้ (Esc)' : 'Dismiss (Esc)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Summary Preview Modal */}
      {isExportPreviewOpen && (() => {
        const previewScopeLabel =
          selectedLogIndices.length > 0
            ? lang === 'th'
              ? 'รายการที่เลือก (Bulk Selection)'
              : 'Selected Logs (Bulk Selection)'
            : hasAnyActiveFilter
            ? lang === 'th'
              ? 'ผลลัพธ์ตามตัวกรอง / Allow-list'
              : 'Filtered / Allow-listed Logs'
            : lang === 'th'
            ? 'บันทึกการทำงานทั้งหมด'
            : 'All Execution Logs';

        const previewEntries =
          selectedLogIndices.length > 0
            ? [...selectedLogIndices]
                .sort((a, b) => a - b)
                .filter((idx) => quickLogs[idx] !== undefined)
                .map((idx) => ({ log: quickLogs[idx], originalIdx: idx }))
            : hasAnyActiveFilter
            ? matchingLogEntries
            : quickLogs.map((log, originalIdx) => ({ log, originalIdx }));

        const tagCounts = new Map<string, number>();
        const categoryCounts: Record<LogSemanticCategory, number> = {
          'I/O': 0,
          Computation: 0,
          Authentication: 0,
          System: 0,
        };
        let previewTotalLatencyMs = 0;

        const formattedCards = previewEntries.map(({ log, originalIdx }) => {
          const match = log.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
          const tag = match ? match[1] : 'INFO';
          const message = match ? match[2] : log;
          const category = logCategories[originalIdx] ?? classifyLogSemanticFunction(log);
          const latencyMs = performanceTrendPoints[originalIdx]?.latencyMs ?? 0;

          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          categoryCounts[category] += 1;
          previewTotalLatencyMs += latencyMs;

          return {
            originalIdx,
            lineNumber: originalIdx + 1,
            tag,
            message,
            category,
            latencyMs,
            raw: log,
          };
        });

        const avgLatencyMs =
          formattedCards.length > 0 ? Math.round(previewTotalLatencyMs / formattedCards.length) : 0;

        return (
          <div
            data-testid="export-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Export Summary Preview"
            className="fixed inset-0 z-[75] bg-[color-mix(in_srgb,var(--app-bg)_75%,transparent)] backdrop-blur-sm flex items-center justify-center p-4"
          >
            <div
              className="rounded-3xl w-full max-w-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
              style={{
                backgroundColor: 'var(--app-card)',
                borderColor: 'var(--app-card-border)',
                color: 'var(--app-text-primary)',
              }}
            >
              {/* Modal Header */}
              <div
                className="px-6 py-4 flex items-center justify-between gap-3"
                style={{
                  borderBottom: '1px solid var(--app-card-border)',
                  backgroundColor: 'var(--app-surface)',
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg vivid-gradient-brand flex items-center justify-center text-white shrink-0 shadow-sm">
                    <Eye className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm tracking-tight text-[var(--app-text-primary)] truncate">
                      {lang === 'th' ? 'ตรวจสอบสรุปข้อมูลก่อนส่งออก (Export Preview)' : 'Export Data Verification & Preview'}
                    </h3>
                    <p className="text-[11px] text-[var(--app-text-secondary)] truncate">
                      {previewScopeLabel} · {formattedCards.length} / {quickLogs.length}{' '}
                      {lang === 'th' ? 'รายการ' : 'entries'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsExportPreviewOpen(false)}
                  aria-label="Close export preview"
                  className="p-1.5 rounded-lg text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-4 overflow-y-auto">
                {/* Summary Overview Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)]">
                      {lang === 'th' ? 'เป้าหมายงาน & ความถูกต้อง' : 'Goal & Integrity'}
                    </div>
                    <div className="text-xs font-bold text-[var(--app-text-primary)] truncate" title={quickGoal}>
                      {quickGoal || 'N/A'}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--z-ok)] flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 shrink-0" />
                      <span>
                        {integrityStatus}
                        {rollingHash ? ` · ${rollingHash.slice(0, 10)}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)]">
                      {lang === 'th' ? 'จำนวนและหมวดหมู่แท็ก' : 'Entries & Tag Breakdown'}
                    </div>
                    <div className="text-base font-bold font-mono text-[var(--app-accent)] tabular-nums">
                      {formattedCards.length} {lang === 'th' ? 'บันทึก' : 'logs'}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {Array.from(tagCounts.entries()).map(([tag, count]) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold bg-[var(--app-bg)] text-[var(--app-text-primary)] border border-[var(--app-card-border)]"
                        >
                          {tag}: {count}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)]">
                      {lang === 'th' ? 'ความหน่วง & การจำแนก' : 'Latency & Semantics'}
                    </div>
                    <div className="text-xs font-mono font-bold text-[var(--app-amber)] tabular-nums">
                      Total: {previewTotalLatencyMs} ms · Avg: {avgLatencyMs} ms
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {SEMANTIC_CATEGORY_ORDER.filter((cat) => categoryCounts[cat] > 0).map((cat) => (
                        <span
                          key={cat}
                          className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border ${getSemanticCategoryBadgeClass(cat)}`}
                        >
                          {cat}: {categoryCounts[cat]}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Readable Log Cards */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[var(--app-text-secondary)]">
                    <span>
                      {lang === 'th' ? 'รายการบันทึกที่จะถูกส่งออก' : 'Formatted Log Cards'}
                    </span>
                    <span className="font-mono text-[10px]">
                      {new Date().toLocaleString()}
                    </span>
                  </div>

                  {formattedCards.length === 0 ? (
                    <div className="p-6 rounded-2xl border border-dashed border-[var(--app-card-border)] bg-[var(--app-surface)] text-center text-xs text-[var(--app-text-secondary)]">
                      {lang === 'th'
                        ? 'ไม่พบรายการบันทึกในตัวเลือกปัจจุบัน'
                        : 'No log entries match the current selection.'}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {formattedCards.map((card) => (
                        <div
                          key={card.originalIdx}
                          data-testid={`export-preview-card-${card.lineNumber}`}
                          className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] transition-colors space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-[var(--app-bg)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] font-bold tabular-nums">
                                #{card.lineNumber}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] font-bold">
                                [{card.tag}]
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded font-bold border ${getSemanticCategoryBadgeClass(
                                  card.category
                                )}`}
                              >
                                {card.category}
                              </span>
                            </div>
                            <span className="text-[var(--app-amber)] font-bold tabular-nums">
                              {card.latencyMs} ms
                            </span>
                          </div>
                          <div className="text-xs font-mono text-[var(--app-text-primary)] leading-relaxed break-words">
                            {renderHighlightedLog(card.message, logTheme)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer with Direct Export Actions */}
              <div
                className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-2"
                style={{
                  borderTop: '1px solid var(--app-card-border)',
                  backgroundColor: 'var(--app-surface)',
                }}
              >
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                  <button
                    type="button"
                    disabled={formattedCards.length === 0}
                    onClick={() => {
                      handleExportLogsCsv(previewEntries);
                      setIsExportPreviewOpen(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] hover:border-[var(--z-ok)] cursor-pointer disabled:opacity-40"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                    <span>CSV</span>
                  </button>
                  <button
                    type="button"
                    disabled={formattedCards.length === 0}
                    onClick={() => {
                      handleExportLogsMarkdown(previewEntries);
                      setIsExportPreviewOpen(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-40"
                  >
                    <FileText className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                    <span>Markdown</span>
                  </button>
                  <button
                    type="button"
                    disabled={formattedCards.length === 0}
                    onClick={() => {
                      handleExportLogsJson(previewEntries);
                      setIsExportPreviewOpen(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] hover:border-[var(--app-amber)] cursor-pointer disabled:opacity-40"
                  >
                    <FileJson className="w-3.5 h-3.5 text-[var(--app-amber)]" />
                    <span>JSON</span>
                  </button>
                  <button
                    type="button"
                    disabled={formattedCards.length === 0}
                    onClick={() => {
                      handleDownloadLogs(previewEntries);
                      setIsExportPreviewOpen(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-40"
                  >
                    <Download className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
                    <span>.log</span>
                  </button>
                  <button
                    type="button"
                    disabled={formattedCards.length === 0}
                    onClick={() => {
                      handleExportLogsPdf(previewEntries);
                      setIsExportPreviewOpen(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-40"
                  >
                    <Printer className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
                    <span>PDF</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setIsExportPreviewOpen(false)}
                  className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] hover:border-[var(--app-accent)] transition-colors cursor-pointer"
                >
                  {lang === 'th' ? 'ปิด (Esc)' : 'Close (Esc)'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Lightweight Critical Action Failure Alert (human-readable 401/403 copy, never exposes raw CSS selectors) */}
      {criticalActionError && (() => {
        const httpStatus = criticalActionError.apiContext?.status;
        const is401 = httpStatus === 401;
        const is403 = httpStatus === 403;
        const isPrivilege = role === 'Developer' || role === 'Administrator';
        const triggerLabel = criticalActionError.trigger.text?.trim();
        const headline = is401
          ? lang === 'th'
            ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'
            : 'Session expired — please sign in again'
          : is403
            ? lang === 'th'
              ? 'สิทธิ์การใช้งานไม่เพียงพอ'
              : 'Insufficient permissions'
            : criticalActionError.category === 'BACKEND_API_ERROR'
              ? lang === 'th'
                ? 'การเชื่อมต่อระบบขัดข้อง'
                : 'Request failed'
              : lang === 'th'
                ? 'การทำงานของปุ่มขัดข้อง'
                : 'Action failed';
        const detailBody = is401
          ? lang === 'th'
            ? 'กรุณาเข้าสู่ระบบก่อนทำรายการนี้ เพื่อยืนยันตัวตนและสิทธิ์การใช้งาน'
            : 'Please sign in first to verify your session and permissions.'
          : is403
            ? lang === 'th'
              ? 'บัญชีปัจจุบันไม่มีสิทธิ์ดำเนินการนี้ กรุณาเปลี่ยนบทบาทเป็น Developer หรือ Administrator ในหน้าบัญชี'
              : 'Your current role cannot run this action. Switch to Developer or Administrator in Account.'
            : isPrivilege
              ? criticalActionError.message
              : lang === 'th'
                ? 'ไม่สามารถทำรายการนี้ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'
                : 'Unable to complete this action right now. Please try again.';

        return (
          <div
            role="alert"
            data-testid="critical-action-error-indicator"
            className="fixed bottom-20 lg:bottom-6 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-md z-50 rounded-xl bg-[var(--app-surface)] border border-[color-mix(in_srgb,var(--z-danger)_65%,transparent)] shadow-xl p-3.5 flex items-start gap-2.5 text-xs"
          >
            <AlertCircle className="w-4 h-4 text-[var(--z-danger)] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="font-bold text-[var(--app-text-primary)]">{headline}</div>
              <p className="text-[11px] text-[var(--app-text-secondary)] break-words leading-snug">
                {detailBody}
              </p>
              {(is401 || is403) && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setCriticalActionError(null);
                      openAuthSettings('account');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--app-accent)] text-slate-950 text-[11px] font-bold cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'เข้าสู่ระบบ' : 'Sign in'}</span>
                  </button>
                </div>
              )}
              {isPrivilege && !is401 && (triggerLabel || httpStatus) && (
                <div className="text-[10px] font-mono text-[var(--app-text-secondary)] truncate">
                  {[triggerLabel, httpStatus ? `HTTP ${httpStatus}` : null].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCriticalActionError(null)}
              aria-label={lang === 'th' ? 'ปิดแจ้งเตือนข้อผิดพลาด' : 'Dismiss error notification'}
              className="p-1 rounded-lg text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })()}

      {/* Clean Floating AI Assistant Quick Launcher */}
      {!hasBlockingOverlay && (
        <button
          type="button"
          onClick={() => setIsAssistantOpen(true)}
          aria-label={lang === 'th' ? 'เปิดผู้ช่วย AI ในระบบ' : 'Open System AI Assistant'}
          title={lang === 'th' ? 'ผู้ช่วย AI ในระบบ (Alt+A)' : 'System AI Assistant (Alt+A)'}
          className={`fixed bottom-20 lg:bottom-6 right-5 z-40 items-center gap-2 px-3.5 py-2 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-primary)] hover:border-[var(--app-accent)] text-xs font-medium shadow-md transition-colors cursor-pointer ${
            activeModule === 'conversational_intelligence' ? 'hidden lg:inline-flex' : 'inline-flex'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
          <span>{lang === 'th' ? 'ผู้ช่วย AI' : 'AI Assistant'}</span>
        </button>
      )}

      {/* Lazy Overlays (mounted only when opened to prevent eager dynamic-import fetch races) */}
      <LazyErrorBoundary
        lang={lang}
        onReset={() => {
          setIsGlobalSearchOpen(false);
          setEvidenceDrawerItem(null);
          setIsAssistantOpen(false);
        }}
      >
        <Suspense fallback={null}>
          {isGlobalSearchOpen && (
            <GlobalSearchModal
              isOpen={isGlobalSearchOpen}
              onClose={() => setIsGlobalSearchOpen(false)}
              onNavigate={setActiveModule}
              onInspectEvidence={setEvidenceDrawerItem}
              blockers={truthData?.activeBlockers || []}
              quickLogs={quickLogs}
            />
          )}

          {evidenceDrawerItem && (
            <EvidenceViewerDrawer
              item={evidenceDrawerItem}
              onClose={() => setEvidenceDrawerItem(null)}
              onNavigate={setActiveModule}
            />
          )}

          {isAssistantOpen && (
            <AIAssistantDrawer
              isOpen={isAssistantOpen}
              onClose={() => setIsAssistantOpen(false)}
              activeModule={activeModule}
              runtimeReady={Boolean(statusData?.model?.weightsLoaded && statusData?.model?.inferenceReady)}
              recentLogs={quickLogs}
              moduleState={assistantModuleState}
              workspaceMetadata={assistantWorkspaceMetadata}
              onRefreshContext={fetchStatus}
              onApplyToQuickTask={(goalText) => {
                setQuickGoal(goalText);
                setIsAssistantOpen(false);
                setIsQuickTaskOpen(true);
              }}
              onNavigateModule={(mod) => {
                setActiveModule(mod);
                setIsAssistantOpen(false);
              }}
            />
          )}
        </Suspense>
      </LazyErrorBoundary>
    </div>
  );
}
