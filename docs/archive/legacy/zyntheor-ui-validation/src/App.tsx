/**
 * ZYNTHEOR - VIVID INTELLIGENCE
 * 100% First-Party Sovereign AI Operating Platform
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ModuleId, SystemStatusData, OrchestrationEvent } from './types';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { MobileNav } from './components/MobileNav';
import { AIAssistantDrawer } from './components/AIAssistantDrawer';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import { useAuditIntegrity } from './hooks/useAuditIntegrity';
import {
  rankLogsBySemanticIntent,
  getSemanticIntentPresets,
} from './utils/semanticLogSearch';

// 15 Ecosystem Modules
import { CommandCenter } from './components/modules/CommandCenter';
import { ConversationalIntelligence } from './components/modules/ConversationalIntelligence';
import { IntelligenceCore } from './components/modules/IntelligenceCore';
import { DevStudio } from './components/modules/DevStudio';
import { ResearchLab } from './components/modules/ResearchLab';
import { AutomationCenter } from './components/modules/AutomationCenter';
import { KnowledgeHub } from './components/modules/KnowledgeHub';
import { ModelLaboratory } from './components/modules/ModelLaboratory';
import { ExperimentCenter } from './components/modules/ExperimentCenter';
import { ApiPlatform } from './components/modules/ApiPlatform';
import { Marketplace } from './components/modules/Marketplace';
import { SubscriptionBilling } from './components/modules/SubscriptionBilling';
import { AnalyticsBI } from './components/modules/AnalyticsBI';
import { GovernanceSecurity } from './components/modules/GovernanceSecurity';
import { UserSettings } from './components/modules/UserSettings';
import { AdminConsole } from './components/modules/AdminConsole';

import { Terminal, X, Play, Pause, ShieldCheck, ShieldAlert, CheckCircle2, Copy, Check, Download, Search, Volume2, VolumeX, RotateCcw, Trash2, WrapText, FileJson, FileText, FileSpreadsheet, ChevronDown, Printer, Camera, History, CheckSquare, Keyboard, PanelRightClose, PanelRightOpen, Activity, Database, LockKeyhole, Network, Sparkles, Layers, LogIn, Settings, Regex, AlertCircle, ListOrdered } from 'lucide-react';

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

const REGEX_SEARCH_PRESETS: Array<{ label: string; pattern: string }> = [
  { label: '[ERROR] [auth]', pattern: '\\[ERROR\\]\\s*\\[auth\\]' },
  { label: 'Stack traces', pattern: '(?:at\\s+.+:\\d+|Traceback|File\\s+".+",\\s+line\\s+\\d+)' },
  { label: 'Non-zero / Fail', pattern: '(?:ERROR|FATAL|Exception|exitCode:\\s*[1-9]\\d*)' },
  { label: 'Agent roles', pattern: '\\[(?:ARCHITECT|CODER|DEBUGGER|TESTER)\\]' }
];

/**
 * Basic syntax highlighting for native intelligence execution logs.
 * Uses regex to parse and highlight common keywords like [ERROR], [INIT], [DONE], [TESTER], etc.
 * with accessible, distinctive color themes, plus optional search match highlighting.
 */
function renderHighlightedLog(
  text: string,
  theme: 'emerald_dark' | 'high_contrast',
  highlightRegex?: RegExp | null
): React.ReactNode {
  if (!text) return null;

  // Regex matches bracketed keywords like [ERROR], [INIT], [DONE], [TESTER], [ARCHITECT], [CODER], [DEBUGGER], [AUDIT], [WARN], [STEP]
  // or standalone status keywords like ERROR, FAIL, FAILED, FATAL, DONE, SUCCESS, PASSED, VERIFIED, INIT, START
  const regex = /(\[(?:ERROR|INIT|DONE|TESTER|ARCHITECT|CODER|DEBUGGER|AUDIT|WARN|STEP)\]|\b(?:ERROR|FAIL|FAILED|FATAL)\b|\b(?:DONE|SUCCESS|PASSED|VERIFIED)\b|\b(?:INIT|START|STARTED)\b)/gi;

  const parts = text.split(regex);
  if (parts.length === 1) {
    return renderMatchHighlights(text, highlightRegex, theme, 'single');
  }

  return parts.map((part, index) => {
    if (!part) return null;
    const lower = part.toLowerCase();

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

    // Indigo / Violet for agent roles [ARCHITECT], [CODER], [DEBUGGER], [AUDIT], [WARN], [STEP]
    if (
      lower === '[architect]' ||
      lower === '[coder]' ||
      lower === '[debugger]' ||
      lower === '[audit]' ||
      lower === '[warn]' ||
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
  const { role, session, authHeaders, login, loginWithGoogle, devAccessEnabled, authError } = useAuth();
  const [activeModule, setActiveModule] = useState<ModuleId>('command_center');
  const [statusData, setStatusData] = useState<SystemStatusData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('zyntheor_context_panel') !== 'closed';
  });
  const [isQuickTaskOpen, setIsQuickTaskOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [assistantOpenedAt, setAssistantOpenedAt] = useState<string | null>(null);
  const quickGoalInputRef = useRef<HTMLInputElement | null>(null);

  // Quick Modal Execution State
  const [quickGoal, setQuickGoal] = useState('Build In-Memory LRU Cache with TTL');
  const [isQuickRunning, setIsQuickRunning] = useState(false);
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
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const [showPerfMetrics, setShowPerfMetrics] = useState(false);
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

  const filteredLogEntries = useMemo(() => {
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
  }, [quickLogs, logTagFilter, logSearchQuery, logSearchMode, compiledLogSearch, semanticLogSuggestions]);


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
      if (lastLogTimeRef.current !== null) {
        setLogLatencyMs(Math.round(now - lastLogTimeRef.current));
      }
      lastLogTimeRef.current = now;

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
    }
  }, [quickLogs, ttsEnabled]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('zyntheor_quick_logs', JSON.stringify(quickLogs));
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
  }, [quickLogs, logTagFilter, ttsRate, ttsPitch, ttsVolume, ttsVoiceUri, session.userId]);

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

  const handleDownloadLogs = () => {
    if (quickLogs.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const content = [
      `# ZYNTHEOR Sovereign Agent Execution Trace`,
      `# Exported: ${new Date().toISOString()}`,
      `# Entries: ${quickLogs.length}`,
      ``,
      ...quickLogs
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyntheor-agent-logs-${timestamp}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportLogsJson = () => {
    if (quickLogs.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const payload = {
      schema: 'ZYNTHEOR_AGENT_SESSION_LOG_V1',
      exportedAt: new Date().toISOString(),
      goal: quickGoal,
      totalEntries: quickLogs.length,
      logs: quickLogs.map((entry, idx) => {
        const m = entry.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
        return {
          line: idx + 1,
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

  const handleExportLogsPdf = () => {
    if (quickLogs.length === 0) return;
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
            <div class="meta">Goal: ${quickGoal}<br/>Exported: ${new Date().toISOString()} | Entries: ${quickLogs.length}</div>
            ${quickLogs.map((l, i) => `<div class="line">${i + 1}. ${l.replace(/</g, '&lt;')}</div>`).join('')}
          </body>
        </html>
      `);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }
    setTimeout(() => document.body.removeChild(iframe), 1000);
  };

  const handleExportLogsCsv = () => {
    if (quickLogs.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ['Line', 'Tag', 'SemanticCategory', 'Message'].map(escapeCsv).join(','),
      ...quickLogs.map((entry, idx) => {
        const m = entry.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
        const tag = m ? m[1] : 'INFO';
        const message = m ? m[2] : entry;
        const category = logCategories[idx] ?? classifyLogSemanticFunction(entry);
        return [idx + 1, tag, category, message].map(escapeCsv).join(',');
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

  const handleExportLogsMarkdown = () => {
    if (quickLogs.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const escapeMd = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const categoryCounts: Record<LogSemanticCategory, number> = {
      'I/O': 0,
      Computation: 0,
      Authentication: 0,
      System: 0
    };
    const tableRows = quickLogs.map((entry, idx) => {
      const m = entry.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
      const tag = m ? m[1] : 'INFO';
      const message = m ? m[2] : entry;
      const category = logCategories[idx] ?? classifyLogSemanticFunction(entry);
      categoryCounts[category] += 1;
      return `| ${idx + 1} | \`${escapeMd(tag)}\` | ${category} | ${escapeMd(message)} |`;
    });
    const content = [
      `# ZYNTHEOR — Sovereign Agent Execution Trace`,
      ``,
      `- **Goal:** ${quickGoal || 'N/A'}`,
      `- **Exported:** ${new Date().toISOString()}`,
      `- **Entries:** ${quickLogs.length}`,
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
      const res = await fetch('/api/system/status');
      const data = await res.json();
      if (data.success) {
        setStatusData(data);
      }
    } catch (err) {
      console.warn('Status endpoint temporarily unavailable:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

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

  const handleRunQuickAgent = async () => {
    if (!quickGoal || isQuickRunning) return;
    setIsQuickRunning(true);
    setQuickDone(false);
    setVerificationHash(null);
    setTotalExecMs(null);
    execStartRef.current = performance.now();
    setLogCategories({});
    setGroupByCategory(false);
    setSelectedLogIndices([]);
    lastSpokenIndexRef.current = -1;
    resetTtsQueue(true);
    setTtsPaused(false);
    ttsPausedRef.current = false;
    setQuickLogs([`[INIT] Initiating Sovereign Multi-Agent for: "${quickGoal}"`]);

    try {
      const response = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ goal: quickGoal })
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
            } else if (ev.type === 'test') {
              setQuickLogs((prev) => [
                ...prev,
                `[TESTER] exitCode: ${ev.data?.exitCode} | ${ev.message}`
              ]);
            } else if (ev.type === 'done' || (ev as any).type === 'final_result') {
              if (ev.data?.executionCycle?.executionEvidenceHash) {
                setVerificationHash(ev.data.executionCycle.executionEvidenceHash);
              }
              if (typeof ev.data?.durationMs === 'number') {
                setTotalExecMs(ev.data.durationMs);
              }
              if (ev.type === 'done') {
                setQuickLogs((prev) => [...prev, `[DONE] ${ev.message}`]);
                setQuickDone(true);
              }
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
    isShortcutsModalOpen,
    isSnapshotDrawerOpen,
    isAssistantOpen,
    isMobileOpen,
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
    <div className="p-5 sm:p-6 rounded-2xl bg-[var(--app-surface)] border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] space-y-4">
      <div className="p-3.5 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_35%,transparent)] text-[var(--z-danger)] text-xs font-mono">
        [RBAC_DENIED] {moduleLabel} requires {requiredRole} role (current: {role}). Module is not rendered for this session.
      </div>
      <div className="text-xs text-[var(--app-text-secondary)]">
        {session.userId && session.userId !== 'anonymous'
          ? `Signed in as ${session.email || session.userId} (role: ${role}${session.authMode ? `, mode: ${session.authMode}` : ''}). ${
              devAccessEnabled
                ? 'Select a Developer or Administrator development session below to access this workspace.'
                : 'Your account requires a Developer or Administrator role claim to open this workspace.'
            }`
          : devAccessEnabled
          ? 'Sign in with Google or select a Development Access role below to unlock this workspace.'
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
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-black hover:opacity-90 transition-opacity cursor-pointer"
        >
          <LogIn className="w-3.5 h-3.5" />
          Continue with Google
        </button>
        {devAccessEnabled && (
          <>
            <button
              type="button"
              onClick={() => void login('Developer')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] transition-colors cursor-pointer"
            >
              Dev Access: Developer
            </button>
            <button
              type="button"
              onClick={() => void login('Administrator')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] transition-colors cursor-pointer"
            >
              Dev Access: Administrator
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setActiveModule('user_settings')}
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
            onNavigate={setActiveModule}
            onOpenQuickTask={() => setIsQuickTaskOpen(true)}
          />
        );
      case 'conversational_intelligence':
        return <ConversationalIntelligence />;
      case 'intelligence_core':
        return <IntelligenceCore statusData={statusData} onRefreshStatus={fetchStatus} />;
      case 'dev_studio':
        return role === 'Developer' || role === 'Administrator' ? (
          <DevStudio />
        ) : (
          renderRbacDenied('DevStudio', 'Developer')
        );
      case 'research_lab':
        return <ResearchLab />;
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
      case 'api_platform':
        return role === 'Developer' || role === 'Administrator' ? (
          <ApiPlatform />
        ) : (
          renderRbacDenied('ApiPlatform', 'Developer')
        );
      case 'marketplace':
        return <Marketplace />;
      case 'subscription_billing':
        return <SubscriptionBilling statusData={statusData} onRefresh={fetchStatus} />;
      case 'analytics_bi':
        return <AnalyticsBI statusData={statusData} />;
      case 'governance_security':
        return role === 'Developer' || role === 'Administrator' ? (
          <GovernanceSecurity />
        ) : (
          renderRbacDenied('GovernanceSecurity', 'Developer')
        );
      case 'user_settings':
        return <UserSettings />;
      case 'admin_console':
        return role === 'Administrator' ? (
          <AdminConsole />
        ) : (
          renderRbacDenied('AdminConsole', 'Administrator')
        );
      default:
        return <CommandCenter statusData={statusData} onNavigate={setActiveModule} onOpenQuickTask={() => setIsQuickTaskOpen(true)} />;
    }
  };

  const AuroraMark = () => (
    <svg className="aurora-mark" viewBox="0 0 96 96" role="img" aria-label="ZYNTHEOR Aurora">
      <defs>
        <linearGradient id="zyntheor-aurora-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--app-accent)" /><stop offset="45%" stopColor="var(--z-warn)" /><stop offset="100%" stopColor="var(--z-danger)" />
        </linearGradient>
        <filter id="zyntheor-aurora-blur"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <circle cx="48" cy="48" r="34" fill="none" stroke="url(#zyntheor-aurora-gradient)" strokeWidth="7" opacity=".22" filter="url(#zyntheor-aurora-blur)" />
      <path className="aurora-orbit" d="M17 52c4-22 28-36 48-27 15 7 20 25 11 39-9 15-31 20-47 10-9-5-14-13-12-22Z" fill="none" stroke="url(#zyntheor-aurora-gradient)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M29 59c8-7 14-21 29-25 6-2 11-1 16 2-6 1-13 5-17 11-6 9-16 16-28 12Z" fill="url(#zyntheor-aurora-gradient)" opacity=".92" />
      <circle cx="68" cy="31" r="3" fill="var(--z-warn)" />
    </svg>
  );

  const ContextRail = () => {
    const model = statusData?.model;
    const audit = statusData?.audit;
    const resources = statusData?.resources?.current;
    return (
      <aside className={`context-rail ${isContextOpen ? 'context-rail-open' : 'context-rail-closed'}`} aria-label={t('context.aria')}>
        <div className="context-rail-header">
          {isContextOpen && <span className="eyebrow">{t('context.live')}</span>}
          <button className="icon-button" onClick={() => setIsContextOpen((value) => {
            const next = !value;
            window.localStorage.setItem('zyntheor_context_panel', next ? 'open' : 'closed');
            return next;
          })} aria-label={isContextOpen ? t('context.collapse') : t('context.open')}>
            {isContextOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
        {isContextOpen && (
          <div className="context-rail-body">
            <div className="context-identity"><AuroraMark /><div><strong>Q+ Sovereign</strong><span>{t('context.online_runtime')}</span></div></div>
            <div className="context-status-line"><span><Activity className="w-3.5 h-3.5" />{t('context.runtime')}</span><b className={model?.weightsLoaded ? 'status-live' : 'status-muted'}>{model ? (model.weightsLoaded ? t('context.weights_loaded') : t('context.weights_not_loaded')) : t('context.no_data')}</b></div>
            <div className="context-stat-grid">
              <div><span>{t('context.parameters')}</span><strong>{model ? `${(model.totalParams / 1000000).toFixed(1)}M` : '—'}</strong></div>
              <div><span>{t('context.throughput')}</span><strong>{resources?.tokensPerSec ? `${resources.tokensPerSec}/s` : '—'}</strong></div>
              <div><span>{t('context.audit_chain')}</span><strong>{audit ? (audit.chainValid ? t('context.valid') : t('context.check')) : '—'}</strong></div>
              <div><span>{t('context.memory')}</span><strong>{resources?.processRssMb ? `${resources.processRssMb} MB` : '—'}</strong></div>
            </div>
            <div className="context-section"><span className="eyebrow">{t('context.knowledge_scope')}</span><div className="context-chip"><Database className="w-3.5 h-3.5" />{t('context.documents_datasets')} <b>{statusData?.sandbox.fileCount ?? '—'}</b></div><div className="context-chip"><Network className="w-3.5 h-3.5" />{t('context.memory_graph')} <b>{statusData ? t('context.data_available') : '—'}</b></div></div>
            <div className="context-section"><span className="eyebrow">{t('context.tool_access')}</span><button className="context-action" onClick={() => setActiveModule('knowledge_hub')}><Sparkles className="w-3.5 h-3.5" />{t('context.knowledge_workspace')} <span>→</span></button><button className={`context-action ${role === 'User' ? 'context-action-disabled' : ''}`} onClick={() => role !== 'User' && setActiveModule('governance_security')} disabled={role === 'User'} title={role === 'User' ? t('context.developer_required') : undefined}><LockKeyhole className="w-3.5 h-3.5" />{t('context.governance_audit')} <span>{role === 'User' ? t('role.Developer') : '→'}</span></button></div>
            <div className="context-note">{statusData ? `${t('context.telemetry_refreshed')} ${new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-US', { timeStyle: 'medium' }).format(new Date(statusData.serverTime))}` : t('context.awaiting_telemetry')}</div>
          </div>
        )}
      </aside>
    );
  };

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
          onToggleMobile={() => setIsMobileOpen(true)}
          onOpenQuickTask={() => setIsQuickTaskOpen(true)}
          onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
          onRefreshStatus={fetchStatus}
          onOpenSettings={() => setActiveModule('user_settings')}
          onOpenAssistant={() => setIsAssistantOpen(true)}
          isRefreshing={isRefreshing}
        />

        <div className="app-workspace">
          <main className="flex-1 p-4 md:p-8 w-full mx-auto pb-24 lg:pb-12 min-w-0">
            <div className="aurora-backdrop" aria-hidden="true"><AuroraMark /></div>
            {activeModule === 'conversational_intelligence' && <div className="workspace-kicker"><span className="eyebrow">INTELLIGENCE FIRST</span><span className="live-dot" /> Native inference surface</div>}
            {renderActiveModule()}
          </main>
          <ContextRail />
        </div>

        {/* Mobile Bottom Navigation */}
        <MobileNav
          activeModule={activeModule}
          onSelectModule={setActiveModule}
          onOpenMore={() => setIsMobileOpen(true)}
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
                <div className="w-8 h-8 rounded-lg vivid-gradient-brand flex items-center justify-center text-[var(--app-text-primary)] font-bold shrink-0 shadow-sm">
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
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPerfMetrics((prev) => !prev)}
                      title="Toggle Performance Metrics"
                      className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${
                        showPerfMetrics
                          ? 'bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                          : logTheme === 'high_contrast'
                          ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)] hover:bg-[var(--app-surface)]'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)] hover:border-[var(--app-accent)]'
                      }`}
                    >
                      Metrics
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
                      <span className="hidden xl:inline">Lines</span>
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
                      <span>{logTextWrap ? 'Wrap Text' : 'No-Wrap'}</span>
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
                        Clear Resolved Logs{resolvedLogCount > 0 ? ` (${resolvedLogCount})` : ''}
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
                        onClick={() => setIsExportMenuOpen((prev) => !prev)}
                        disabled={quickLogs.length === 0}
                        aria-haspopup="menu"
                        aria-expanded={isExportMenuOpen}
                        title={lang === 'th' ? 'ส่งออกบันทึก (CSV, Markdown, JSON, Log, PDF)' : 'Export execution logs'}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${
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
                      {isExportMenuOpen && quickLogs.length > 0 && (
                        <div
                          role="menu"
                          className="absolute right-0 mt-1.5 w-44 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] shadow-xl py-1 z-30 text-[11px] font-mono"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              handleExportLogsCsv();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                            <span>Export CSV (.csv)</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              handleExportLogsMarkdown();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                            <span>Export Markdown (.md)</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              handleExportLogsJson();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer"
                          >
                            <FileJson className="w-3.5 h-3.5 text-[var(--app-amber)]" />
                            <span>Export JSON (.json)</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              handleDownloadLogs();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
                            <span>Raw Log (.log)</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              handleExportLogsPdf();
                              setIsExportMenuOpen(false);
                            }}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
                            <span>Print / PDF</span>
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
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px] flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--app-text-secondary)]" />
                        <input
                          type="text"
                          value={logSearchQuery}
                          onChange={(e) => setLogSearchQuery(e.target.value)}
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
                            onClick={() => setLogSearchQuery('')}
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
                        onClick={() => setLogSearchMode((prev) => (prev === 'regex' ? 'text' : 'regex'))}
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
                        onClick={() => setLogSearchMode((prev) => (prev === 'semantic' ? 'text' : 'semantic'))}
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
                    {(logSearchQuery.trim() || logTagFilter !== 'ALL') && quickLogs.length > 0 && (
                      <span
                        className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold border shrink-0 ${
                          logTheme === 'high_contrast'
                            ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] border-[color-mix(in_srgb,var(--app-text-primary)_40%,transparent)]'
                            : 'bg-[var(--app-bg)] text-[var(--app-accent)] border-[var(--app-card-border)]'
                        }`}
                      >
                        {filteredLogEntries.length}/{quickLogs.length}
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
                            <option value={ttsVoiceUri}>{ttsVoiceUri} (Saved)</option>
                          )}
                          {ttsVoices.map((v) => (
                            <option key={v.voiceURI} value={v.voiceURI}>
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
                              onClick={() => setLogSearchQuery(preset.pattern)}
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
                  {quickLogs.length > 0 && (() => {
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
                        {logSearchMode === 'regex' && compiledLogSearch.error
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
                          setLogSearchQuery('');
                          setLogTagFilter('ALL');
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

                      return (
                        <div
                          key={originalIdx}
                          ref={isActiveTtsLine ? activeTtsRowRef : undefined}
                          data-tts-active={isActiveTtsLine ? 'true' : undefined}
                          aria-current={isActiveTtsLine ? 'step' : undefined}
                          className={`text-[11px] leading-relaxed flex items-start gap-2 text-[var(--app-text-primary)] transition-colors ${
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

      {/* Floating AI Assistant Quick Launcher */}
      {!isAssistantOpen && (
        <button
          type="button"
          onClick={() => setIsAssistantOpen(true)}
          aria-label={lang === 'th' ? 'เปิดผู้ช่วย AI ในระบบ' : 'Open System AI Assistant'}
          title={lang === 'th' ? 'ผู้ช่วย AI ในระบบ (Alt+A)' : 'System AI Assistant (Alt+A)'}
          className="fixed bottom-20 lg:bottom-6 right-5 z-40 inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl vivid-gradient-brand text-white text-xs font-bold shadow-xl hover:opacity-95 transition-all cursor-pointer border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]"
        >
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>{lang === 'th' ? 'ผู้ช่วย AI' : 'AI Assistant'}</span>
        </button>
      )}

      {/* System AI Assistant Drawer */}
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
    </div>
  );
}
