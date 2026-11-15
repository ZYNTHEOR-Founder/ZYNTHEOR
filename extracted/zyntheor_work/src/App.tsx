/**
 * ZYNTHEOR - VIVID INTELLIGENCE
 * 100% First-Party Sovereign AI Operating Platform
 */

import React, { useState, useEffect, useRef } from 'react';
import { ModuleId, SystemStatusData, OrchestrationEvent, TaskPriority } from './types';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { MobileNav } from './components/MobileNav';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import { useToast } from './context/ToastContext';
import { useAuditIntegrity } from './hooks/useAuditIntegrity';
import { useConnectivityMonitor } from './hooks/useConnectivityMonitor';
import { RollingIntegrityChart } from './components/RollingIntegrityChart';
import { PrintableSessionAudit, buildSystemMetadataSnapshot, usePrintAudit } from './components/PrintableSessionAudit';
import { computeQuickLogRollingIntegrity } from './utils/rollingIntegrity';
import { apiUrl } from './lib/apiClient';
import { StatusDot } from './components/ui/StatusBadge';

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
import { AutonomousExecutionDashboard } from './components/modules/AutonomousExecutionDashboard';
import { CognitiveOperations } from './components/modules/CognitiveOperations';

import { Terminal, X, Play, ShieldCheck, ShieldAlert, CheckCircle2, Copy, Check, Download, Search, Volume2, VolumeX, RotateCcw, RefreshCw, Trash2, WrapText, FileJson, Printer, Camera, History, CheckSquare, Keyboard, PanelRightClose, PanelRightOpen, Activity, Database, LockKeyhole, Network, Sparkles, ChevronRight, Layers, Palette, Flag } from 'lucide-react';

type LogSeverity = 'error' | 'warning' | 'success' | 'info';
type LogTerminalTheme = 'midnight_vivid' | 'emerald_dark' | 'high_contrast' | 'monokai' | 'solarized_dark';

const LOG_THEME_STYLES: Record<
  LogTerminalTheme,
  {
    label: string;
    container: string;
    header: string;
    filterBar: string;
    summaryBar: string;
    title: string;
    controlBtn: string;
    input: string;
    rowText: string;
    clusterCard: string;
    mutedText: string;
  }
> = {
  midnight_vivid: {
    label: 'Midnight Navy',
    container: 'bg-[#070B19] text-[#9AA8C7] border-[#1E294A]',
    header: 'bg-[#0D1326] border-[#1E294A]',
    filterBar: 'bg-[#0A1022] border-[#1E294A]',
    summaryBar: 'bg-[#070B19] border-[#1E294A] text-[#9AA8C7]',
    title: 'text-[#00F0FF]',
    controlBtn: 'bg-[#131B36] text-[#F4F7FF] border-[#1E294A] hover:border-[#00F0FF]',
    input: 'bg-[#070B19] text-[#F4F7FF] border-[#1E294A] placeholder:text-[#9AA8C7]/60',
    rowText: 'text-[#F4F7FF]',
    clusterCard: 'bg-[#0D1326]/90 border-[#1E294A] hover:border-[#00F0FF]/60',
    mutedText: 'text-[#9AA8C7]/75',
  },
  emerald_dark: {
    label: 'Emerald Dark',
    container: 'bg-[#071B18] text-[#A7BDB2] border-[#24483D]',
    header: 'bg-[#0D211E] border-[#24483D]',
    filterBar: 'bg-[#0A1B18] border-[#24483D]',
    summaryBar: 'bg-[#071B18] border-[#24483D] text-[#A7BDB2]',
    title: 'text-[#10B981]',
    controlBtn: 'bg-[#102B25] text-[#F0F7F3] border-[#24483D] hover:border-[#10B981]',
    input: 'bg-[#071B18] text-[#F0F7F3] border-[#24483D] placeholder:text-[#A7BDB2]/60',
    rowText: 'text-[#F0F7F3]',
    clusterCard: 'bg-[#0C2520]/80 border-[#24483D] hover:border-[#10B981]/60',
    mutedText: 'text-[#A7BDB2]/70',
  },
  high_contrast: {
    label: 'High Contrast',
    container: 'bg-black text-white border-white/60',
    header: 'bg-zinc-950 border-white/30',
    filterBar: 'bg-zinc-950 border-white/20',
    summaryBar: 'bg-zinc-950 border-white/20 text-white',
    title: 'text-white',
    controlBtn: 'bg-zinc-900 text-white border-white/40 hover:bg-zinc-800',
    input: 'bg-black text-white border-white/30 placeholder:text-zinc-500',
    rowText: 'text-white',
    clusterCard: 'bg-zinc-950 border-white/40 hover:border-white',
    mutedText: 'text-zinc-300',
  },
  monokai: {
    label: 'Monokai',
    container: 'bg-[#272822] text-[#F8F8F2] border-[#49483E]',
    header: 'bg-[#1E1F1C] border-[#49483E]',
    filterBar: 'bg-[#22231E] border-[#49483E]',
    summaryBar: 'bg-[#1E1F1C] border-[#49483E] text-[#CFCFC2]',
    title: 'text-[#A6E22E]',
    controlBtn: 'bg-[#3E3D32] text-[#F8F8F2] border-[#59584C] hover:border-[#A6E22E]',
    input: 'bg-[#272822] text-[#F8F8F2] border-[#49483E] placeholder:text-[#75715E]',
    rowText: 'text-[#F8F8F2]',
    clusterCard: 'bg-[#2F3029] border-[#49483E] hover:border-[#66D9EF]/70',
    mutedText: 'text-[#A59F85]',
  },
  solarized_dark: {
    label: 'Solarized Dark',
    container: 'bg-[#002B36] text-[#EEE8D5] border-[#073642]',
    header: 'bg-[#073642] border-[#1A4A57]',
    filterBar: 'bg-[#03313D] border-[#073642]',
    summaryBar: 'bg-[#002B36] border-[#073642] text-[#93A1A1]',
    title: 'text-[#2AA198]',
    controlBtn: 'bg-[#073642] text-[#EEE8D5] border-[#1E4D5A] hover:border-[#2AA198]',
    input: 'bg-[#002B36] text-[#EEE8D5] border-[#1E4D5A] placeholder:text-[#657B83]',
    rowText: 'text-[#EEE8D5]',
    clusterCard: 'bg-[#073642]/80 border-[#1E4D5A] hover:border-[#268BD2]/70',
    mutedText: 'text-[#839496]',
  },
};

const REPETITIVE_AGENT_TAGS = new Set([
  'ARCHITECT',
  'CODER',
  'DEBUGGER',
  'PLANNER',
  'REVIEWER',
  'TESTER',
  'STEP',
  'AUDIT',
  'HMAC_INTEGRITY',
]);

const TASK_PRIORITIES: TaskPriority[] = ['High', 'Medium', 'Low'];

const PRIORITY_BADGE_STYLES: Record<TaskPriority, { pill: string; activeBtn: string; labelTh: string }> = {
  High: {
    pill: 'text-rose-300',
    activeBtn: 'bg-rose-500/25 text-rose-200 border-rose-400 shadow-sm',
    labelTh: 'สูง (High)',
  },
  Medium: {
    pill: 'text-amber-300',
    activeBtn: 'bg-amber-500/25 text-amber-200 border-amber-400 shadow-sm',
    labelTh: 'ปานกลาง (Medium)',
  },
  Low: {
    pill: 'text-sky-300',
    activeBtn: 'bg-sky-500/25 text-sky-200 border-sky-400 shadow-sm',
    labelTh: 'ต่ำ (Low)',
  },
};

function extractLogPriority(log: string): TaskPriority | null {
  const m = log.match(/\[PRIORITY:(HIGH|MEDIUM|LOW)\]/i);
  if (!m) return null;
  const upper = m[1].toUpperCase();
  if (upper === 'HIGH') return 'High';
  if (upper === 'MEDIUM') return 'Medium';
  return 'Low';
}

function stripPriorityToken(text: string): string {
  return text.replace(/\[PRIORITY:(?:HIGH|MEDIUM|LOW)\]\s*/gi, '').trimStart();
}

interface LogCluster {
  clusterKey: string;
  tag: string | null;
  priority: TaskPriority | null;
  severity: LogSeverity;
  signature: string;
  items: Array<{ log: string; origIdx: number }>;
}

function normalizeLogPattern(log: string): { tag: string | null; priority: TaskPriority | null; signature: string } {
  const match = log.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
  const tag = match ? match[1] : null;
  const priority = extractLogPriority(log);
  const body = stripPriorityToken(match ? match[2] : log)
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hash>')
    .replace(/\b\d+(?:\.\d+)?(?:ms|s|kb|mb|%)?\b/gi, '<#>')
    .replace(/["'`][^"'`]{1,40}["'`]/g, '<str>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return { tag, priority, signature: `${tag || 'RAW'}:${priority || 'NONE'}:${body.slice(0, 64)}` };
}

function buildLogClusters(
  entries: Array<{ log: string; origIdx: number }>,
  enableClustering: boolean
): LogCluster[] {
  if (!enableClustering) {
    return entries.map((entry) => {
      const { tag, priority, signature } = normalizeLogPattern(entry.log);
      return {
        clusterKey: `single-${entry.origIdx}`,
        tag,
        priority,
        severity: classifyLogLine(entry.log),
        signature,
        items: [entry],
      };
    });
  }

  const clusters: LogCluster[] = [];
  for (const entry of entries) {
    const { tag, priority, signature } = normalizeLogPattern(entry.log);
    const severity = classifyLogLine(entry.log);
    const prev = clusters[clusters.length - 1];
    const samePattern = prev && prev.signature === signature && prev.severity === severity;
    const sameRepetitiveAgentTag =
      prev &&
      tag !== null &&
      prev.tag === tag &&
      prev.priority === priority &&
      REPETITIVE_AGENT_TAGS.has(tag) &&
      prev.severity === severity &&
      severity !== 'error';

    if (prev && (samePattern || sameRepetitiveAgentTag)) {
      prev.items.push(entry);
    } else {
      clusters.push({
        clusterKey: `cluster-${entry.origIdx}-${tag || 'info'}`,
        tag,
        priority,
        severity,
        signature,
        items: [entry],
      });
    }
  }
  return clusters;
}

/**
 * Classifies an execution log line as 'error', 'warning', 'success', or 'info' based on keywords.
 */
function classifyLogLine(log: string): LogSeverity {
  if (!log) return 'info';
  if (/\[ERROR\]|\b(?:error|fail|failed|fatal|exception|blocked|tampered|denied)\b/i.test(log)) {
    return 'error';
  }
  if (/\[WARN(?:ING)?\]|\b(?:warn|warning|retry|retrying|timeout|slow|degraded|partial|mismatch|fallback|caution|deprecated)\b/i.test(log)) {
    return 'warning';
  }
  if (/\[DONE\]|\b(?:done|success|succeeded|passed|verified|approved|complete|completed|intact)\b|exitCode:\s*0/i.test(log)) {
    return 'success';
  }
  return 'info';
}

/**
 * Basic syntax highlighting for native intelligence execution logs.
 * Uses regex to parse and highlight common keywords like [ERROR], [WARN], [INIT], [DONE], [TESTER], etc.
 * with accessible, distinctive color themes (Emerald Dark, High Contrast, Monokai, Solarized Dark).
 */
function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderSearchHighlights(
  segment: string,
  searchQuery: string,
  theme: LogTerminalTheme,
  keyPrefix: string
): React.ReactNode {
  const trimmed = searchQuery.trim();
  if (!trimmed || !segment) return segment;

  const escaped = escapeRegExpLiteral(trimmed);
  const queryRegex = new RegExp(`(${escaped})`, 'gi');
  const chunks = segment.split(queryRegex);
  if (chunks.length === 1) return segment;

  const markCls =
    theme === 'high_contrast'
      ? 'bg-yellow-300 text-black font-bold px-0.5 rounded-sm'
      : theme === 'monokai'
      ? 'bg-[#FFE792]/35 text-[#FFF7D6] ring-1 ring-[#FFD866]/70 px-0.5 rounded-sm'
      : theme === 'solarized_dark'
      ? 'bg-[#B58900]/45 text-[#FDF6E3] ring-1 ring-[#F2C94C]/70 px-0.5 rounded-sm'
      : 'bg-amber-300/35 text-amber-100 ring-1 ring-amber-400/60 px-0.5 rounded-sm';

  return chunks.map((chunk, i) => {
    if (!chunk) return null;
    if (chunk.toLowerCase() === trimmed.toLowerCase()) {
      return (
        <mark key={`${keyPrefix}-m-${i}`} className={markCls}>
          {chunk}
        </mark>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t-${i}`}>{chunk}</React.Fragment>;
  });
}

function renderHighlightedLog(text: string, theme: LogTerminalTheme, searchQuery: string = ''): React.ReactNode {
  if (!text) return null;

  const regex = /(\[PRIORITY:(?:HIGH|MEDIUM|LOW)\]|\[(?:ERROR|INIT|DONE|TESTER|ARCHITECT|CODER|DEBUGGER|AUDIT|WARN|WARNING|STEP)\]|\b(?:ERROR|FAIL|FAILED|FATAL)\b|\b(?:WARN|WARNING|RETRY|RETRYING|TIMEOUT|SLOW|DEGRADED|PARTIAL|MISMATCH|FALLBACK)\b|\b(?:DONE|SUCCESS|SUCCEEDED|PASSED|VERIFIED|APPROVED|COMPLETE|COMPLETED|INTACT)\b|\b(?:INIT|START|STARTED)\b)/gi;

  const parts = text.split(regex);
  if (parts.length === 1) {
    return renderSearchHighlights(text, searchQuery, theme, 'plain');
  }

  return parts.map((part, index) => {
    if (!part) return null;
    const lower = part.toLowerCase();

    if (lower === '[priority:high]') {
      return (
        <span key={index} className="font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block bg-rose-500/25 text-rose-200 border border-rose-500/50">
          {renderSearchHighlights('HIGH', searchQuery, theme, `kw-${index}`)}
        </span>
      );
    }
    if (lower === '[priority:medium]') {
      return (
        <span key={index} className="font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block bg-amber-500/25 text-amber-200 border border-amber-500/50">
          {renderSearchHighlights('MEDIUM', searchQuery, theme, `kw-${index}`)}
        </span>
      );
    }
    if (lower === '[priority:low]') {
      return (
        <span key={index} className="font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block bg-sky-500/25 text-sky-200 border border-sky-500/50">
          {renderSearchHighlights('LOW', searchQuery, theme, `kw-${index}`)}
        </span>
      );
    }

    // Red / Rose for [ERROR], ERROR, FAIL, FAILED, FATAL
    if (lower === '[error]' || lower === 'error' || lower === 'fail' || lower === 'failed' || lower === 'fatal') {
      const cls =
        theme === 'high_contrast'
          ? 'bg-rose-950 text-rose-200 border border-rose-500 shadow-sm'
          : theme === 'monokai'
          ? 'bg-[#F92672]/25 text-[#FF6188] border border-[#F92672]/60 shadow-sm'
          : theme === 'solarized_dark'
          ? 'bg-[#DC322F]/25 text-[#FF6E67] border border-[#DC322F]/60 shadow-sm'
          : 'bg-rose-500/25 text-rose-200 border border-rose-500/40 shadow-sm shadow-rose-950/40';
      return (
        <span key={index} className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${cls}`}>
          {renderSearchHighlights(part, searchQuery, theme, `kw-${index}`)}
        </span>
      );
    }

    // Amber / Orange for [WARN], [WARNING], WARN, WARNING, RETRY, TIMEOUT, PARTIAL, MISMATCH, etc.
    if (
      lower === '[warn]' ||
      lower === '[warning]' ||
      lower === 'warn' ||
      lower === 'warning' ||
      lower === 'retry' ||
      lower === 'retrying' ||
      lower === 'timeout' ||
      lower === 'slow' ||
      lower === 'degraded' ||
      lower === 'partial' ||
      lower === 'mismatch' ||
      lower === 'fallback'
    ) {
      const cls =
        theme === 'high_contrast'
          ? 'bg-amber-950 text-amber-200 border border-amber-400 shadow-sm'
          : theme === 'monokai'
          ? 'bg-[#FD971F]/25 text-[#FC9867] border border-[#FD971F]/60 shadow-sm'
          : theme === 'solarized_dark'
          ? 'bg-[#CB4B16]/25 text-[#FFB454] border border-[#CB4B16]/60 shadow-sm'
          : 'bg-amber-500/25 text-amber-200 border border-amber-500/50 shadow-sm shadow-amber-950/40';
      return (
        <span key={index} className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${cls}`}>
          {renderSearchHighlights(part, searchQuery, theme, `kw-${index}`)}
        </span>
      );
    }

    // Cyan / Sky for [INIT], INIT, START, STARTED
    if (lower === '[init]' || lower === 'init' || lower === 'start' || lower === 'started') {
      const cls =
        theme === 'high_contrast'
          ? 'bg-cyan-950 text-cyan-200 border border-cyan-400 shadow-sm'
          : theme === 'monokai'
          ? 'bg-[#66D9EF]/20 text-[#78DCE8] border border-[#66D9EF]/60 shadow-sm'
          : theme === 'solarized_dark'
          ? 'bg-[#268BD2]/25 text-[#58B8FF] border border-[#268BD2]/60 shadow-sm'
          : 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 shadow-sm shadow-cyan-950/40';
      return (
        <span key={index} className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${cls}`}>
          {renderSearchHighlights(part, searchQuery, theme, `kw-${index}`)}
        </span>
      );
    }

    // Emerald / Green for [DONE], DONE, SUCCESS, SUCCEEDED, PASSED, VERIFIED, APPROVED, COMPLETED, INTACT
    if (
      lower === '[done]' ||
      lower === 'done' ||
      lower === 'success' ||
      lower === 'succeeded' ||
      lower === 'passed' ||
      lower === 'verified' ||
      lower === 'approved' ||
      lower === 'complete' ||
      lower === 'completed' ||
      lower === 'intact'
    ) {
      const cls =
        theme === 'high_contrast'
          ? 'bg-emerald-950 text-emerald-200 border border-emerald-400 shadow-sm'
          : theme === 'monokai'
          ? 'bg-[#A6E22E]/20 text-[#A9DC76] border border-[#A6E22E]/60 shadow-sm'
          : theme === 'solarized_dark'
          ? 'bg-[#859900]/25 text-[#B5CC26] border border-[#859900]/60 shadow-sm'
          : 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/40 shadow-sm shadow-emerald-950/40';
      return (
        <span key={index} className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${cls}`}>
          {renderSearchHighlights(part, searchQuery, theme, `kw-${index}`)}
        </span>
      );
    }

    // Yellow for [TESTER]
    if (lower === '[tester]') {
      const cls =
        theme === 'high_contrast'
          ? 'bg-amber-950 text-amber-200 border border-amber-400 shadow-sm'
          : theme === 'monokai'
          ? 'bg-[#E6DB74]/20 text-[#FFD866] border border-[#E6DB74]/60 shadow-sm'
          : theme === 'solarized_dark'
          ? 'bg-[#B58900]/25 text-[#F2C94C] border border-[#B58900]/60 shadow-sm'
          : 'bg-amber-500/25 text-amber-200 border border-amber-500/40 shadow-sm shadow-amber-950/40';
      return (
        <span key={index} className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${cls}`}>
          {renderSearchHighlights(part, searchQuery, theme, `kw-${index}`)}
        </span>
      );
    }

    // Violet / Purple for agent roles [ARCHITECT], [CODER], [DEBUGGER], [AUDIT], [STEP]
    if (
      lower === '[architect]' ||
      lower === '[coder]' ||
      lower === '[debugger]' ||
      lower === '[audit]' ||
      lower === '[step]'
    ) {
      const cls =
        theme === 'high_contrast'
          ? 'bg-indigo-950 text-indigo-200 border border-indigo-400 shadow-sm'
          : theme === 'monokai'
          ? 'bg-[#AE81FF]/20 text-[#AB9DF2] border border-[#AE81FF]/60 shadow-sm'
          : theme === 'solarized_dark'
          ? 'bg-[#6C71C4]/25 text-[#A4A8FF] border border-[#6C71C4]/60 shadow-sm'
          : 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40 shadow-sm shadow-indigo-950/40';
      return (
        <span key={index} className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px] inline-block ${cls}`}>
          {renderSearchHighlights(part, searchQuery, theme, `kw-${index}`)}
        </span>
      );
    }

    return <React.Fragment key={index}>{renderSearchHighlights(part, searchQuery, theme, `seg-${index}`)}</React.Fragment>;
  });
}

export default function App() {
  const { t, lang } = useLanguage();
  const { role, session, authHeaders, authReady, isAuthenticated, devAccessEnabled, authError: contextAuthError, clearAuthError, login, loginWithGoogle } = useAuth();
  const { showToast } = useToast();
  const { printPayload, triggerPrintAudit } = usePrintAudit();
  const [authBusy, setAuthBusy] = useState(false);
  const [devRoleChoice, setDevRoleChoice] = useState<'User' | 'Developer' | 'Administrator'>('User');
  const { connectivity, isChecking: isCheckingConnectivity, reconnect } = useConnectivityMonitor(10000);
  const [activeModule, setActiveModule] = useState<ModuleId>('command_center');
  const [statusData, setStatusData] = useState<SystemStatusData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastPollAt, setLastPollAt] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('zyntheor_context_panel') === 'open';
  });
  const [isQuickTaskOpen, setIsQuickTaskOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const quickGoalInputRef = useRef<HTMLInputElement | null>(null);

  // Quick Modal Execution State
  const [quickGoal, setQuickGoal] = useState('Build In-Memory LRU Cache with TTL');
  const [quickPriority, setQuickPriority] = useState<TaskPriority>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zyntheor_quick_priority');
      if (saved === 'High' || saved === 'Medium' || saved === 'Low') return saved;
    }
    return 'Medium';
  });
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
  const [snapshots, setSnapshots] = useState<Array<{ id: string; timestamp: string; goal: string; priority?: TaskPriority; logs: string[] }>>(() => {
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
  const [presignedReconnectUrl, setPresignedReconnectUrl] = useState('');
  const [showReconnectUrl, setShowReconnectUrl] = useState(false);
  const [isSnapshotDrawerOpen, setIsSnapshotDrawerOpen] = useState(false);
  const [logTheme, setLogTheme] = useState<LogTerminalTheme>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zyntheor_log_theme');
      if (
        saved === 'midnight_vivid' ||
        saved === 'emerald_dark' ||
        saved === 'high_contrast' ||
        saved === 'monokai' ||
        saved === 'solarized_dark'
      ) {
        return saved;
      }
    }
    return 'midnight_vivid';
  });
  const [clusterLogs, setClusterLogs] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('zyntheor_cluster_logs');
        if (saved === 'false') return false;
        if (saved === 'true') return true;
      } catch {
        // ignore storage errors
      }
    }
    return true;
  });
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({});
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [logTagFilter, setLogTagFilter] = useState<'ALL' | 'INIT' | 'TESTER' | 'DONE' | 'ERROR' | 'SUCCESS' | 'WARNING'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zyntheor_log_tag_filter');
      if (
        saved === 'ALL' ||
        saved === 'INIT' ||
        saved === 'TESTER' ||
        saved === 'DONE' ||
        saved === 'ERROR' ||
        saved === 'SUCCESS' ||
        saved === 'WARNING'
      ) {
        return saved;
      }
    }
    return 'ALL';
  });
  const [logPriorityFilter, setLogPriorityFilter] = useState<'ALL' | TaskPriority>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zyntheor_log_priority_filter');
      if (saved === 'ALL' || saved === 'High' || saved === 'Medium' || saved === 'Low') {
        return saved;
      }
    }
    return 'ALL';
  });
  const [logSearchQuery, setLogSearchQuery] = useState('');
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
      return Number.isFinite(parsed) && parsed >= 0.1 && parsed <= 2.0 ? parsed : 1.0;
    }
    return 1.0;
  });
  const [logTextWrap, setLogTextWrap] = useState(true);
  const [logTimeMode, setLogTimeMode] = useState<'absolute' | 'relative'>('absolute');
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedLogIndices, setSelectedLogIndices] = useState<number[]>([]);
  const [showPerfMetrics, setShowPerfMetrics] = useState(false);
  const [showIntegrityChart, setShowIntegrityChart] = useState(true);
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
  const [logLatencyMs, setLogLatencyMs] = useState<number | null>(null);
  const lastLogTimeRef = useRef<number | null>(null);
  const lastSpokenIndexRef = useRef<number>(-1);
  const prevLogCountRef = useRef<number>(quickLogs.length);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Real-time Audit Hash reconciler (rolling SHA-256 of quickLogs vs sealed baseline + continuous checkpoint SHA-256 monitor)
  const {
    rollingHash,
    fullHash,
    sealMetadata,
    integrityStatus,
    isTampered,
    isVerifying,
    verificationReport,
    verifyIntegrity,
    clearVerificationReport,
    sealBaseline,
    restoreFromLedger,
    recompute: recomputeIntegrity,
    checkpointIntegrityStatus,
    checkpointMismatch,
    isVerifyingCheckpoint,
    checkpointAuditReport,
    verifyCheckpointIntegrity,
  } = useAuditIntegrity(quickLogs, {
    checkpointSha256: connectivity.checkpointSha256 ?? statusData?.model?.checkpointHash ?? null,
    runtimeOnline: connectivity.online,
  });

  const rollingIntegrityPoints = React.useMemo(
    () => computeQuickLogRollingIntegrity(quickLogs, integrityStatus, 50),
    [quickLogs, integrityStatus]
  );


  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) setTtsVoices(voices);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (quickLogs.length > 0) {
      const now = performance.now();
      if (lastLogTimeRef.current !== null) {
        setLogLatencyMs(Math.round(now - lastLogTimeRef.current));
      }
      lastLogTimeRef.current = now;

      const latestIdx = quickLogs.length - 1;
      if (ttsEnabled && latestIdx > lastSpokenIndexRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const latest = quickLogs[latestIdx];
        const utterance = new SpeechSynthesisUtterance(
          stripPriorityToken(latest.replace(/^\[[A-Z0-9_]+\]\s*/, ''))
        );
        utterance.rate = ttsRate;
        utterance.pitch = ttsPitch;
        utterance.volume = Math.min(1, Math.max(0, ttsVolume));
        if (ttsVoiceUri) {
          const matched = ttsVoices.find(
            (v, idx) => `${v.voiceURI}::${v.lang}::${v.name}::${idx}` === ttsVoiceUri ||
              `${v.voiceURI}::${v.lang}::${v.name}` === ttsVoiceUri ||
              v.voiceURI === ttsVoiceUri
          );
          if (matched) utterance.voice = matched;
        }
        window.speechSynthesis.speak(utterance);
        lastSpokenIndexRef.current = latestIdx;
      }
    } else {
      lastLogTimeRef.current = null;
      lastSpokenIndexRef.current = -1;
      setLogLatencyMs(null);
    }
  }, [quickLogs, ttsEnabled, ttsRate, ttsPitch, ttsVolume]);

  useEffect(() => {
    prevLogCountRef.current = quickLogs.length;
  }, [quickLogs.length]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('zyntheor_cluster_logs', String(clusterLogs));
      } catch {
        // ignore storage quota errors
      }
    }
  }, [clusterLogs]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('zyntheor_log_tag_filter', logTagFilter);
      } catch {
        // ignore storage quota errors
      }
    }
  }, [logTagFilter]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('zyntheor_log_priority_filter', logPriorityFilter);
      } catch {
        // ignore storage quota errors
      }
    }
  }, [logPriorityFilter]);

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
              logPriorityFilter,
              ttsSettings: { ttsRate, ttsPitch, ttsVolume, ttsVoiceUri }
            })
          );
        } catch {
          // ignore storage quota errors
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [quickLogs, logTagFilter, logPriorityFilter, ttsRate, ttsPitch, ttsVolume, ttsVoiceUri, session.userId]);

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
      `# Goal: ${quickGoal}`,
      `# Priority: ${quickPriority}`,
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
      priority: quickPriority,
      totalEntries: quickLogs.length,
      logs: quickLogs.map((entry, idx) => {
        const m = entry.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
        return {
          line: idx + 1,
          tag: m ? m[1] : 'INFO',
          priority: extractLogPriority(entry) || quickPriority,
          message: stripPriorityToken(m ? m[2] : entry)
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
    const verificationSummary = verificationHash
      ? `${integrityStatus} · Content SHA-256: ${verificationHash}`
      : `${integrityStatus} · Local Session Trace`;
    triggerPrintAudit({
      metadata: buildSystemMetadataSnapshot({
        reportTitle: 'Sovereign Agent Session Log & Audit Report',
        reportSubtitle: 'High-Contrast Offline Printable Session Trace',
        session,
        role,
        statusData,
        connectivity,
        verificationSummary,
        goal: quickGoal,
        priority: quickPriority,
        executionLatencyMs: totalExecMs ?? logLatencyMs,
        activeFilterSummary: `Quick Execution Trace · ${quickLogs.length} entries`,
      }),
      entries: quickLogs.map((entry, idx) => {
        const m = entry.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
        const tag = m ? m[1] : 'INFO';
        const linePriority = extractLogPriority(entry) || quickPriority;
        const msg = stripPriorityToken(m ? m[2] : entry);
        return {
          index: idx + 1,
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          role: tag,
          action: `Priority: ${linePriority}`,
          detail: msg,
          hash: verificationHash || undefined,
        };
      }),
    });
  };

  const handleTakeSnapshot = () => {
    if (quickLogs.length === 0) return;
    const snap = {
      id: `snap-${Date.now()}`,
      timestamp: new Date().toISOString(),
      goal: quickGoal,
      priority: quickPriority,
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

  const fetchStatus = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(apiUrl('/api/system/status'));
      const data = await res.json();
      if (data.success) {
        setStatusData(data);
        setLastPollAt(new Date().toISOString());
      }
    } catch (err) {
      console.warn('Status endpoint temporarily unavailable:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRegenerateModel = async () => {
    if (isRegenerating) return;
    setIsRegenerating(true);
    setRegenerationError(null);
    try {
      const res = await fetch(apiUrl('/api/model/regenerate-v2'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ force: false })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setStatusData(data);
      setLastPollAt(new Date().toISOString());
    } catch (err: any) {
      setRegenerationError(err?.message || 'Failed to regenerate 2.0M checkpoint');
    } finally {
      setIsRegenerating(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

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
    const runPriorityToken = quickPriority.toUpperCase();
    prevLogCountRef.current = 0;
    setQuickLogs([`[INIT] [PRIORITY:${runPriorityToken}] Initiating Sovereign Multi-Agent (${quickPriority} Priority) for: "${quickGoal}"`]);

    try {
      const response = await fetch(apiUrl('/api/agent/execute'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ goal: quickGoal, priority: quickPriority })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('Stream unavailable');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let toastedThisRun = false;

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
            const evPriorityToken = String(ev.priority || ev.data?.priority || quickPriority).toUpperCase();
            const priorityPrefix = `[PRIORITY:${evPriorityToken}]`;
            if (ev.type === 'step') {
              setQuickLogs((prev) => [...prev, `[${ev.role}] ${priorityPrefix} ${ev.message}`]);
            } else if (ev.type === 'tool_call' || ev.type === 'tool_result') {
              setQuickLogs((prev) => [...prev, `[${ev.type.toUpperCase()}] ${priorityPrefix} ${ev.message}`]);
            } else if (ev.type === 'test') {
              setQuickLogs((prev) => [
                ...prev,
                `[TESTER] ${priorityPrefix} exitCode: ${ev.data?.exitCode} | ${ev.message}`
              ]);
            } else if (ev.type === 'security_check') {
              setQuickLogs((prev) => [
                ...prev,
                `[HMAC_INTEGRITY] ${priorityPrefix} ${ev.message}`
              ]);
            } else if (ev.type === 'done') {
              setQuickLogs((prev) => [...prev, `[DONE] ${priorityPrefix} ${ev.message}`]);
              setQuickDone(true);
              if (ev.data?.success === true && !toastedThisRun) {
                toastedThisRun = true;
                showToast({
                  variant: 'success',
                  title: lang === 'th' ? 'งานประมวลผลอัตโนมัติสำเร็จ' : 'Agent Execution Completed',
                  message: quickGoal.trim(),
                  meta: [
                    ev.data?.taskId ? `Task ${ev.data.taskId}` : null,
                    typeof ev.data?.durationMs === 'number' ? `${ev.data.durationMs} ms` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined,
                });
              }
            } else if ((ev as any).type === 'final_result') {
              if (ev.data?.success === true && !toastedThisRun) {
                toastedThisRun = true;
                showToast({
                  variant: 'success',
                  title: lang === 'th' ? 'งานประมวลผลอัตโนมัติสำเร็จ' : 'Agent Execution Completed',
                  message: quickGoal.trim(),
                  meta: [
                    ev.data?.taskId ? `Task ${ev.data.taskId}` : null,
                    typeof ev.data?.durationMs === 'number' ? `${ev.data.durationMs} ms` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined,
                });
              }
            } else if (ev.type === 'error') {
              setQuickLogs((prev) => [...prev, `[ERROR] ${priorityPrefix} ${ev.message}`]);
            }
          } catch (e) {
            // ignore JSON parse
          }
        }
      }
      fetchStatus();
    } catch (err: any) {
      setQuickLogs((prev) => [...prev, `[ERROR] [PRIORITY:${runPriorityToken}] ${err.message}`]);
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
    quickPriority,
    isShortcutsModalOpen,
    isSnapshotDrawerOpen,
    isMobileOpen,
    quickLogs,
    snapshots
  ]);

  const renderActiveModule = () => {
    switch (activeModule) {
      case 'autonomous_execution':
        return <AutonomousExecutionDashboard statusData={statusData} />;
      case 'cognitive_operations':
        return <CognitiveOperations statusData={statusData} />;
      case 'command_center':
        return (
          <CommandCenter
            statusData={statusData}
            onNavigate={setActiveModule}
            onOpenQuickTask={() => setIsQuickTaskOpen(true)}
          />
        );
      case 'conversational_intelligence':
        return <ConversationalIntelligence statusData={statusData} />;
      case 'intelligence_core':
        return <IntelligenceCore statusData={statusData} />;
      case 'dev_studio':
        return role === 'Developer' || role === 'Administrator' ? (
          <DevStudio statusData={statusData} onStatusChanged={fetchStatus} />
        ) : (
          <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-rose-200 text-xs font-mono">
            [RBAC_DENIED] DevStudio requires Developer or Administrator role (current: {role}). Module is not rendered for this session.
          </div>
        );
      case 'research_lab':
        return <ResearchLab />;
      case 'automation_center':
        return <AutomationCenter />;
      case 'knowledge_hub':
        return <KnowledgeHub />;
      case 'model_laboratory':
        return role === 'Developer' || role === 'Administrator' ? (
          <ModelLaboratory statusData={statusData} onStatusChanged={fetchStatus} />
        ) : (
          <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-rose-200 text-xs font-mono">
            [RBAC_DENIED] ModelLaboratory requires Developer or Administrator role (current: {role}). Module is not rendered for this session.
          </div>
        );
      case 'experiment_center':
        return role === 'Developer' || role === 'Administrator' ? (
          <ExperimentCenter />
        ) : (
          <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-rose-200 text-xs font-mono">
            [RBAC_DENIED] ExperimentCenter requires Developer or Administrator role (current: {role}). Module is not rendered for this session.
          </div>
        );
      case 'api_platform':
        return role === 'Developer' || role === 'Administrator' ? (
          <ApiPlatform />
        ) : (
          <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-rose-200 text-xs font-mono">
            [RBAC_DENIED] ApiPlatform requires Developer or Administrator role (current: {role}). Module is not rendered for this session.
          </div>
        );
      case 'marketplace':
        return <Marketplace />;
      case 'subscription_billing':
        return <SubscriptionBilling statusData={statusData} onRefresh={fetchStatus} />;
      case 'analytics_bi':
        return <AnalyticsBI statusData={statusData} />;
      case 'governance_security':
        return role === 'Developer' || role === 'Administrator' ? (
          <GovernanceSecurity
            statusData={statusData}
            checkpointIntegrityStatus={checkpointIntegrityStatus}
            checkpointAuditReport={checkpointAuditReport}
            isVerifyingCheckpoint={isVerifyingCheckpoint}
            onVerifyCheckpointIntegrity={verifyCheckpointIntegrity}
          />
        ) : (
          <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-rose-200 text-xs font-mono">
            [RBAC_DENIED] GovernanceSecurity requires Developer or Administrator role (current: {role}). Module is not rendered for this session.
          </div>
        );
      case 'user_settings':
        return <UserSettings />;
      case 'admin_console':
        return role === 'Administrator' ? (
          <AdminConsole />
        ) : (
          <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-rose-200 text-xs font-mono">
            [RBAC_DENIED] AdminConsole requires Administrator role (current: {role}). Module is not rendered for this session.
          </div>
        );
      default:
        return <CommandCenter statusData={statusData} onNavigate={setActiveModule} onOpenQuickTask={() => setIsQuickTaskOpen(true)} />;
    }
  };

  const AuroraMark = () => (
    <svg className="aurora-mark" viewBox="0 0 96 96" role="img" aria-label="ZYNTHEOR Aurora">
      <defs>
        <linearGradient id="zyntheor-aurora-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00F0FF" /><stop offset="50%" stopColor="#7B2CBF" /><stop offset="100%" stopColor="#FF007F" />
        </linearGradient>
        <filter id="zyntheor-aurora-blur"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <circle cx="48" cy="48" r="34" fill="none" stroke="url(#zyntheor-aurora-gradient)" strokeWidth="7" opacity=".24" filter="url(#zyntheor-aurora-blur)" />
      <path className="aurora-orbit" d="M17 52c4-22 28-36 48-27 15 7 20 25 11 39-9 15-31 20-47 10-9-5-14-13-12-22Z" fill="none" stroke="url(#zyntheor-aurora-gradient)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M29 59c8-7 14-21 29-25 6-2 11-1 16 2-6 1-13 5-17 11-6 9-16 16-28 12Z" fill="url(#zyntheor-aurora-gradient)" opacity=".92" />
      <circle cx="68" cy="31" r="3" fill="#CCFF00" />
    </svg>
  );

  const activeModelTitle = statusData?.model?.name || 'ZYNTHEOR Native Model';

  const isOnlineFailClosed = Boolean(
    !connectivity.online ||
      connectivity.onlineConnectivityRequired ||
      (statusData &&
        statusData.model &&
        (statusData.model.weightsLoaded === false || statusData.model.onlineConnectivityRequired === true))
  );

  const ContextRail = () => {
    const model = statusData?.model;
    const audit = statusData?.audit;
    const resources = statusData?.resources?.current;
    const isFailClosed = Boolean(
      isOnlineFailClosed ||
        (model && (model.weightsLoaded === false || model.onlineConnectivityRequired === true))
    );
    const loadedSig = model?.checkpointHash || '';
    const expectedSig = model?.expectedCheckpointHash || '';
    const signatureMatches = Boolean(
      model &&
        loadedSig &&
        (!expectedSig || loadedSig === expectedSig) &&
        model.signatureMatchesExpected !== false &&
        !isFailClosed
    );
    const shortHash = (h?: string | null) =>
      h && h.length > 16 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h || '—';

    return (
      <aside className={`context-rail ${isContextOpen ? 'context-rail-open' : 'context-rail-closed'}`} aria-label="Native context panel">
        <div className="context-rail-header">
          {isContextOpen && <span className="eyebrow">LIVE CONTEXT</span>}
          <button className="icon-button" onClick={() => setIsContextOpen((value) => {
            const next = !value;
            window.localStorage.setItem('zyntheor_context_panel', next ? 'open' : 'closed');
            return next;
          })} aria-label={isContextOpen ? 'Collapse context panel' : 'Open context panel'}>
            {isContextOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
        {isContextOpen && (
          <div className="context-rail-body">
            <div className="context-identity"><AuroraMark /><div><strong>{activeModelTitle}</strong><span>{model?.weightsSource || connectivity.cloudSource || 'Cloud Object Storage · Online-Only'}</span></div></div>
            <div className="context-status-line">
              <span><Activity className="w-3.5 h-3.5" />Runtime</span>
              <StatusDot
                status={isCheckingConnectivity ? 'CHECKING' : isFailClosed ? 'FAIL_CLOSED' : model?.weightsLoaded ? 'ONLINE' : 'CHECKING'}
                label={isFailClosed ? 'FAIL_CLOSED' : model?.weightsLoaded ? 'CLOUD ACTIVE' : 'CHECKING'}
                detail={connectivity.reason || model?.failClosedReason || undefined}
                pulse={isCheckingConnectivity || Boolean(model?.weightsLoaded && !isFailClosed)}
              />
            </div>

            {/* Model Integrity Status Indicator (Polls /api/system/status every 15s) */}
            <div
              className={`rounded-xl p-3 border text-[11px] space-y-2 transition-colors ${
                !model
                  ? 'bg-[var(--app-card)] border-[var(--app-card-border)]'
                  : signatureMatches
                  ? 'bg-[#00F0FF]/10 border-[#00F0FF]/40'
                  : 'bg-[#FF007F]/10 border-[#FF007F]/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-[var(--app-text-primary)]">
                  {signatureMatches ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-[#CCFF00]" />
                  ) : (
                    <ShieldAlert className="w-3.5 h-3.5 text-[#FF007F]" />
                  )}
                  Model Integrity
                </span>
                <StatusDot
                  status={!model ? 'CHECKING' : isFailClosed ? 'FAIL_CLOSED' : signatureMatches ? 'VERIFIED' : 'BLOCKED'}
                  label={!model ? 'POLLING' : isFailClosed ? 'ONLINE REQUIRED' : signatureMatches ? 'MATCHED' : 'DEVIATION'}
                  pulse={!model}
                />
              </div>

              <div className="space-y-1 font-mono text-[10px] tabular-nums">
                <div className="flex items-center justify-between gap-2" title={loadedSig || 'Unavailable'}>
                  <span className="text-[var(--app-text-secondary)]">Loaded Sig</span>
                  <span className={signatureMatches ? 'text-[#CCFF00] font-semibold' : 'text-[#FF66B2] font-bold'}>
                    {shortHash(loadedSig)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2" title={expectedSig || 'Unavailable'}>
                  <span className="text-[var(--app-text-secondary)]">Cloud Sig</span>
                  <span className="text-[var(--app-text-primary)]">{shortHash(expectedSig)}</span>
                </div>
              </div>

              {(isFailClosed || (model && !signatureMatches)) && (
                <div className="pt-1.5 border-t border-rose-500/30 text-[10px] text-rose-200 leading-snug">
                  {isFailClosed
                    ? connectivity.reason || model?.failClosedReason || 'FAIL_CLOSED: Online Connectivity Required.'
                    : 'Loaded checkpoint signature deviates from expected cloud SHA-256.'}
                </div>
              )}

              <div className="flex items-center justify-between text-[9px] font-mono text-[var(--app-text-secondary)] pt-0.5">
                <span>Poll /api/system/status (15s)</span>
                <span>{lastPollAt ? new Date(lastPollAt).toLocaleTimeString() : '—'}</span>
              </div>
            </div>

            <div className="context-stat-grid">
              <div><span>Parameters</span><strong>{model ? model.totalParams.toLocaleString() : '—'}</strong></div>
              <div><span>Throughput</span><strong>{resources?.tokensPerSec ? `${resources.tokensPerSec}/s` : '—'}</strong></div>
              <div><span>Audit chain</span><strong>{audit ? (audit.chainValid ? 'VALID' : 'CHECK') : '—'}</strong></div>
              <div><span>Memory</span><strong>{resources?.processRssMb ? `${resources.processRssMb} MB` : '—'}</strong></div>
            </div>
            <div className="context-section"><span className="eyebrow">KNOWLEDGE SCOPE</span><div className="context-chip"><Database className="w-3.5 h-3.5" />Documents & datasets <b>{statusData?.sandbox.fileCount ?? '—'}</b></div><div className="context-chip"><Network className="w-3.5 h-3.5" />Memory graph <b>{statusData ? 'runtime-backed' : '—'}</b></div></div>
            <div className="context-section"><span className="eyebrow">TOOL ACCESS</span><button className="context-action" onClick={() => setActiveModule('knowledge_hub')}><Sparkles className="w-3.5 h-3.5" />Knowledge workspace <span>→</span></button><button className={`context-action ${role === 'User' ? 'context-action-disabled' : ''}`} onClick={() => role !== 'User' && setActiveModule('governance_security')} disabled={role === 'User'} title={role === 'User' ? 'Developer role required' : undefined}><LockKeyhole className="w-3.5 h-3.5" />Governance & audit <span>{role === 'User' ? 'Developer' : '→'}</span></button></div>
            <div className="context-note">{statusData ? `Telemetry refreshed ${new Date(statusData.serverTime).toLocaleTimeString()}` : 'Awaiting native runtime telemetry. No mock values are shown.'}</div>
          </div>
        )}
      </aside>
    );
  };

  if (!authReady) {
    return <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)] text-[var(--app-text-primary)]">Checking secure session…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)] text-[var(--app-text-primary)] p-4 sm:p-6">
        <section className="w-full max-w-md rounded-2xl border border-[#1E294A] bg-[#0D1326] p-6 sm:p-8 shadow-2xl shadow-black/40 relative overflow-hidden">
          <div className="h-1 w-full absolute top-0 left-0 bg-gradient-to-r from-[#00F0FF] via-[#7B2CBF] to-[#FF007F]" />
          <div className="text-xs font-mono tracking-[0.28em] text-[#00F0FF] font-bold">ZYNTHEOR</div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-[#F4F7FF]">Sign in to your workspace</h1>
          <p className="mt-2 text-sm text-[#9AA8C7] leading-relaxed">
            Authenticate with your organization identity to access projects, execution history and workspace resources.
          </p>
          <button
            type="button"
            disabled={authBusy}
            onClick={async () => {
              setAuthBusy(true);
              clearAuthError();
              await loginWithGoogle();
              setAuthBusy(false);
            }}
            className="mt-7 w-full min-h-[44px] rounded-xl bg-gradient-to-r from-[#00F0FF] via-[#2563EB] to-[#7B2CBF] px-4 py-3 font-bold text-white shadow-[0_8px_24px_rgba(0,240,255,0.22)] transition hover:brightness-110 disabled:opacity-60 cursor-pointer border border-[#00F0FF]/40"
          >
            {authBusy ? 'Connecting…' : 'Continue with Google'}
          </button>
          {contextAuthError && (
            <div role="alert" className="mt-4 rounded-xl border border-[#FF007F]/45 bg-[#FF007F]/12 p-3 text-xs text-rose-200 space-y-1">
              <div className="font-mono font-bold text-[#FF007F]">{contextAuthError.code}</div>
              <div>{contextAuthError.message}</div>
            </div>
          )}
          {devAccessEnabled ? (
            <div className="mt-6 rounded-xl border border-[#FF5E3A]/40 bg-[#FF5E3A]/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#FF5E3A]">
                  Development Access Only
                </span>
                <span className="text-[10px] font-mono text-[#9AA8C7]">
                  Disabled in Production
                </span>
              </div>
              <p className="text-xs text-[#9AA8C7] leading-relaxed">
                Explicit local development access while OAuth domain authorization is pending. Backend endpoints still require a server-signed ZY-TOKEN and enforce RBAC.
              </p>
              <div className="flex gap-1.5" role="group" aria-label="Development session role">
                {(['User', 'Developer', 'Administrator'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={authBusy}
                    onClick={() => setDevRoleChoice(r)}
                    className={`flex-1 rounded-lg px-2 py-2 text-[11px] font-semibold border transition cursor-pointer ${
                      devRoleChoice === r
                        ? 'border-[#00F0FF] bg-[#00F0FF]/18 text-[#00F0FF]'
                        : 'border-[#1E294A] bg-[#070B19] text-[#9AA8C7] hover:border-[#00F0FF]/40 hover:text-[#F4F7FF]'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={authBusy}
                onClick={async () => {
                  setAuthBusy(true);
                  clearAuthError();
                  await login(devRoleChoice, {
                    userId: `dev_${devRoleChoice.toLowerCase()}`,
                    tenantId: 'dev-workspace'
                  });
                  setAuthBusy(false);
                }}
                className="w-full min-h-[40px] rounded-xl border border-[#FF5E3A]/55 bg-[#FF5E3A]/18 px-4 py-2.5 text-xs font-bold text-[#FF8C73] transition hover:bg-[#FF5E3A]/28 disabled:opacity-60 cursor-pointer"
              >
                {authBusy ? 'Starting dev session…' : `Continue in Development Mode (${devRoleChoice})`}
              </button>
            </div>
          ) : (
            <p className="mt-6 text-xs text-[#9AA8C7]">Access is issued by the configured identity provider. Privileged roles cannot be selected from this screen.</p>
          )}
        </section>
      </div>
    );
  }

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
      <div className="flex-1 min-w-0 flex flex-col">
        <Header
          activeModule={activeModule}
          statusData={statusData}
          connectivity={connectivity}
          onToggleMobile={() => setIsMobileOpen(true)}
          onOpenQuickTask={() => setIsQuickTaskOpen(true)}
          onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
          onRefreshStatus={fetchStatus}
          isRefreshing={isRefreshing}
          onRegenerateModel={handleRegenerateModel}
          isRegenerating={isRegenerating}
          regenerationError={regenerationError}
        />

        <div className="app-workspace">
          <main className="flex-1 p-4 md:p-8 w-full mx-auto pb-24 lg:pb-12 min-w-0">
            <div className="aurora-backdrop" aria-hidden="true"><AuroraMark /></div>
            {isOnlineFailClosed && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-[#FF007F]/35 bg-[#0D1326]/90 px-3.5 py-2.5 text-[#F4F7FF] flex flex-col gap-2.5"
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
                  <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                    <StatusDot
                      status={isCheckingConnectivity ? 'CHECKING' : 'FAIL_CLOSED'}
                      label="FAIL_CLOSED"
                      detail="Online Connectivity Required"
                      pulse={isCheckingConnectivity}
                      className="mt-0.5 sm:mt-0"
                    />
                    <span className="text-xs text-[#9AA8C7] truncate sm:whitespace-normal">
                      {connectivity.reason || statusData?.model?.failClosedReason || 'Online Connectivity Required — Cloud checkpoint/runtime endpoint is not configured.'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div className="flex items-center gap-3 text-[11px] font-mono text-[#9AA8C7]">
                      <StatusDot
                        status={connectivity.cloudStorageConfigured ? 'VERIFIED' : 'PARTIAL'}
                        label={connectivity.cloudStorageConfigured ? 'Cloud Ready' : 'No Cloud Config'}
                        detail="Cloud checkpoint/runtime configuration"
                      />
                      <StatusDot
                        status={connectivity.cloudStorageReachable ? 'VERIFIED' : 'BLOCKED'}
                        label={connectivity.cloudStorageReachable ? 'Endpoint Up' : 'Unreachable'}
                        detail="Cloud storage / runtime reachability"
                      />
                      <StatusDot
                        status={connectivity.pythonBridgeReachable ? 'ONLINE' : 'CHECKING'}
                        label={connectivity.pythonBridgeReachable ? 'Bridge Ready' : 'Bridge Offline'}
                        detail="Native Python inference bridge process"
                        pulse={Boolean(connectivity.pythonBridgeReachable && isCheckingConnectivity)}
                      />
                    </div>
                    {(role === 'Developer' || role === 'Administrator') && (
                      <button
                        type="button"
                        onClick={() => setShowReconnectUrl((v) => !v)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-mono text-[#00F0FF] border border-[#1E294A] bg-[#070B19] hover:border-[#00F0FF]/50 transition-colors cursor-pointer"
                      >
                        {showReconnectUrl ? 'Hide URL' : 'Cloud URL'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void reconnect(
                          authHeaders(),
                          (role === 'Developer' || role === 'Administrator') && presignedReconnectUrl.trim()
                            ? presignedReconnectUrl.trim()
                            : undefined
                        ).then(() => fetchStatus())
                      }
                      disabled={isCheckingConnectivity}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FF007F]/18 hover:bg-[#FF007F]/28 border border-[#FF007F]/45 text-[#F4F7FF] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingConnectivity ? 'animate-spin' : ''}`} />
                      <span>{isCheckingConnectivity ? 'Reconnecting...' : 'Reconnect'}</span>
                    </button>
                  </div>
                </div>
                {showReconnectUrl && (role === 'Developer' || role === 'Administrator') && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-[#1E294A]">
                    <label htmlFor="presigned-reconnect-url" className="text-[11px] font-mono text-[#9AA8C7] shrink-0">
                      Presigned Cloud URL:
                    </label>
                    <input
                      id="presigned-reconnect-url"
                      type="url"
                      value={presignedReconnectUrl}
                      onChange={(e) => setPresignedReconnectUrl(e.target.value)}
                      placeholder="https://... (overrides CHECKPOINT_PRESIGNED_URL for this session)"
                      className="flex-1 min-w-0 px-3 py-2 rounded-xl text-xs font-mono bg-[#070B19] border border-[#1E294A] text-[#F4F7FF] placeholder:text-[#6D7B9D] focus:border-[#00F0FF] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            )}
            {checkpointMismatch && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-[#FF007F]/60 bg-[#FF007F]/12 px-4 py-3 text-[#F4F7FF] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                  <StatusDot
                    status="FAILED"
                    label="CHECKPOINT_MISMATCH"
                    detail={checkpointAuditReport?.reason || 'Loaded checkpoint hash disagrees with cloud-signed metadata'}
                    pulse
                  />
                  <div className="text-xs text-rose-100 font-mono min-w-0">
                    <div>{checkpointAuditReport?.reason || 'SECURITY_ALERT: Loaded checkpoint SHA-256 does not match cloud-signed metadata.'}</div>
                    {checkpointAuditReport?.auditEventTriggered && (
                      <div className="text-[11px] text-rose-200/80 mt-0.5">
                        Audit event recorded automatically (Block #{checkpointAuditReport.auditBlockIndex ?? 'recorded'}).
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void verifyCheckpointIntegrity()}
                  disabled={isVerifyingCheckpoint}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FF007F]/25 hover:bg-[#FF007F]/35 border border-[#FF007F]/50 text-white shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isVerifyingCheckpoint ? 'Verifying...' : 'Re-Verify'}
                </button>
              </div>
            )}
            {activeModule === 'conversational_intelligence' && <div className="workspace-kicker"><span className="eyebrow">INTELLIGENCE FIRST</span><span className="live-dot" /> {activeModelTitle} inference surface</div>}
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
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
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
                <div className="w-8 h-8 rounded-lg vivid-gradient-brand flex items-center justify-center text-white font-bold shrink-0 shadow-sm">
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-tight" style={{ color: 'var(--app-text-primary)' }}>
                    {lang === 'th' ? 'สั่งการประมวลผล Native Intelligence' : 'Dispatch Native Intelligence Engine'}
                  </h3>
                  <p className="text-[11px]" style={{ color: 'var(--app-text-secondary)' }}>
                    {lang === 'th' ? `${activeModelTitle} พร้อม Agent และ Sandbox` : `${activeModelTitle} & Sandboxed Tooling`}
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
                  <span className="text-[10px] font-mono opacity-80 flex items-center gap-1 text-[#9AA8C7]">
                    <span>Dispatch:</span>
                    <kbd className="px-1.5 py-0.2 rounded bg-[#070B19] text-[#00F0FF] border border-[#1E294A] font-bold text-[9px]">
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
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: 'var(--app-text-secondary)' }}>
                    <Flag className="w-3.5 h-3.5 text-[#00F0FF]" />
                    <span>{lang === 'th' ? 'ลำดับความสำคัญของงาน:' : 'Task Priority:'}</span>
                  </span>
                  <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Task Priority">
                    {TASK_PRIORITIES.map((p) => {
                      const active = quickPriority === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={isQuickRunning}
                          onClick={() => {
                            setQuickPriority(p);
                            try {
                              localStorage.setItem('zyntheor_quick_priority', p);
                            } catch {
                              // ignore storage quota errors
                            }
                          }}
                          className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer disabled:opacity-50 ${
                            active
                              ? PRIORITY_BADGE_STYLES[p].activeBtn
                              : 'bg-[#0D1326] text-[#9AA8C7] border-[#1E294A] hover:border-[#00F0FF]/60 hover:text-[#F4F7FF]'
                          }`}
                        >
                          {lang === 'th' ? PRIORITY_BADGE_STYLES[p].labelTh : p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Progress Log Area */}
              <div
                className={`rounded-xl font-mono text-xs border transition-colors overflow-hidden ${LOG_THEME_STYLES[logTheme].container}`}
              >
                <div
                  className={`px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 border-b ${LOG_THEME_STYLES[logTheme].header}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${LOG_THEME_STYLES[logTheme].title}`}
                    >
                      {lang === 'th' ? 'บันทึกการทำงาน (Terminal)' : 'Execution Trace'}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--app-text-secondary)]" title={`Active Task Priority: ${quickPriority}`}>
                      {lang === 'th' ? 'ความสำคัญ' : 'Priority'}: {quickPriority}
                    </span>
                    {logLatencyMs !== null && (
                      <span className="text-[10px] font-mono text-amber-300">{logLatencyMs} ms</span>
                    )}
                    <span
                      className={`flex items-center gap-1 text-[10px] font-mono ${isTampered ? 'text-rose-300' : integrityStatus === 'EMPTY' ? 'text-slate-400' : 'text-emerald-300'}`}
                      title={`Integrity Status: ${integrityStatus} · SHA-256: ${rollingHash || 'empty'}`}
                    >
                      {isTampered ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                      {isTampered ? 'TAMPERED' : rollingHash ? `${rollingHash.slice(0, 8)}` : integrityStatus}
                    </span>
                    <button
                      type="button"
                      onClick={() => void verifyIntegrity(quickLogs)}
                      disabled={quickLogs.length === 0 || isVerifying}
                      title={
                        lang === 'th'
                          ? 'คำนวณ SHA-256 ใหม่จากบันทึกที่แสดงและเทียบกับเมตาเดต้าของตราประทับที่ลงนาม'
                          : 'Recalculate SHA-256 of displayed logs and compare against signed seal metadata'
                      }
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/45 hover:bg-[#00F0FF]/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`w-3 h-3 ${isVerifying ? 'animate-spin' : ''}`} />
                      <span>
                        {isVerifying
                          ? lang === 'th'
                            ? 'กำลังตรวจสอบ...'
                            : 'Verifying...'
                          : lang === 'th'
                          ? 'ตรวจสอบความถูกต้อง'
                          : 'Verify Integrity'}
                      </span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {quickLogs.some((l) => l.includes('[ERROR]')) && !isQuickRunning && (
                      <button
                        type="button"
                        onClick={handleRunQuickAgent}
                        title={lang === 'th' ? 'ลองใหม่อัตโนมัติ' : 'Retry failed run'}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-[#FF007F]/20 text-rose-200 border border-[#FF007F]/45 hover:bg-[#FF007F]/30 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setClusterLogs((prev) => !prev)}
                      aria-pressed={clusterLogs}
                      title={clusterLogs ? 'Disable log clustering (show flat list)' : 'Group repetitive agent steps into collapsible clusters'}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${
                        clusterLogs
                          ? 'bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/45'
                          : LOG_THEME_STYLES[logTheme].controlBtn
                      }`}
                    >
                      <Layers className="w-3 h-3" />
                      <span>Cluster</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowIntegrityChart((prev) => !prev)}
                      title={lang === 'th' ? 'แสดง/ซ่อนกราฟ Rolling Integrity (50 รายการล่าสุด)' : 'Toggle Rolling Integrity Chart (Last 50 Entries)'}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${
                        showIntegrityChart
                          ? 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/50'
                          : LOG_THEME_STYLES[logTheme].controlBtn
                      }`}
                    >
                      <Activity className="w-3 h-3" />
                      <span>Rolling</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPerfMetrics((prev) => !prev)}
                      title="Toggle Performance Metrics"
                      className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${
                        showPerfMetrics
                          ? 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/50'
                          : LOG_THEME_STYLES[logTheme].controlBtn
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
                          ? 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/50'
                          : LOG_THEME_STYLES[logTheme].controlBtn
                      }`}
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogTimeMode((prev) => (prev === 'absolute' ? 'relative' : 'absolute'))}
                      title="Toggle Relative / Absolute Timestamp"
                      className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer border ${LOG_THEME_STYLES[logTheme].controlBtn}`}
                    >
                      {logTimeMode === 'absolute' ? 'ABS' : 'REL'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogTextWrap((prev) => !prev)}
                      title={logTextWrap ? 'Switch to no-wrap' : 'Switch to text wrap'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border ${
                        logTextWrap
                          ? 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/50'
                          : LOG_THEME_STYLES[logTheme].controlBtn
                      }`}
                    >
                      <WrapText className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTtsEnabled((prev) => !prev)}
                      title={ttsEnabled ? 'Disable TTS' : 'Enable Text-to-Speech'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border ${
                        ttsEnabled
                          ? 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/50'
                          : LOG_THEME_STYLES[logTheme].controlBtn
                      }`}
                    >
                      {ttsEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickLogs([])}
                      disabled={quickLogs.length === 0}
                      title={lang === 'th' ? 'ล้างบันทึกทั้งหมด' : 'Clear all logs'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${LOG_THEME_STYLES[logTheme].controlBtn}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleTakeSnapshot}
                      disabled={quickLogs.length === 0}
                      title={lang === 'th' ? 'บันทึก Snapshot' : 'Take Snapshot'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${LOG_THEME_STYLES[logTheme].controlBtn}`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSnapshotDrawerOpen(true)}
                      title={lang === 'th' ? 'เปรียบเทียบ Snapshots' : 'Compare Snapshots'}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer border ${LOG_THEME_STYLES[logTheme].controlBtn}`}
                    >
                      <History className="w-3 h-3" />
                      {snapshots.length}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportLogsJson}
                      disabled={quickLogs.length === 0}
                      title={lang === 'th' ? 'ส่งออก JSON' : 'Export structured JSON'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${LOG_THEME_STYLES[logTheme].controlBtn}`}
                    >
                      <FileJson className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleExportLogsPdf}
                      disabled={quickLogs.length === 0}
                      title={lang === 'th' ? 'ส่งออก PDF' : 'Export formatted PDF'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${LOG_THEME_STYLES[logTheme].controlBtn}`}
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadLogs}
                      disabled={quickLogs.length === 0}
                      title={lang === 'th' ? 'ดาวน์โหลดไฟล์ .log' : 'Download .log file'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${LOG_THEME_STYLES[logTheme].controlBtn}`}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyLogs}
                      disabled={quickLogs.length === 0}
                      title={lang === 'th' ? 'คัดลอกบันทึกทั้งหมด' : 'Copy all logs'}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${LOG_THEME_STYLES[logTheme].controlBtn}`}
                    >
                      {copiedLogs ? (
                        <Check className="w-3.5 h-3.5 text-[#10B981]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsShortcutsModalOpen(true)}
                      title={lang === 'th' ? 'แป้นพิมพ์ลัด (Ctrl+/ หรือ ?)' : 'Keyboard Shortcuts (Ctrl+/ or ?)'}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono transition-colors cursor-pointer border ${LOG_THEME_STYLES[logTheme].controlBtn}`}
                    >
                      <Keyboard className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Shortcuts</span>
                    </button>
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md border ${LOG_THEME_STYLES[logTheme].controlBtn}`}>
                      <Palette className="w-3 h-3 shrink-0 opacity-80" />
                      <select
                        aria-label="Log Terminal Theme"
                        value={logTheme}
                        onChange={(e) => {
                          const next = e.target.value as LogTerminalTheme;
                          setLogTheme(next);
                          try {
                            localStorage.setItem('zyntheor_log_theme', next);
                          } catch {
                            // ignore storage errors
                          }
                        }}
                        className="bg-transparent text-[10px] font-bold focus:outline-none cursor-pointer"
                      >
                        <option value="midnight_vivid" className="bg-[#0D1326] text-[#F4F7FF]">Midnight Navy</option>
                        <option value="emerald_dark" className="bg-[#0D211E] text-[#F0F7F3]">Emerald Dark</option>
                        <option value="high_contrast" className="bg-black text-white">High Contrast</option>
                        <option value="monokai" className="bg-[#272822] text-[#F8F8F2]">Monokai</option>
                        <option value="solarized_dark" className="bg-[#002B36] text-[#EEE8D5]">Solarized Dark</option>
                      </select>
                    </div>
                  </div>
                </div>
                {isTampered && (
                  <div className="mx-3.5 mt-2.5 px-3 py-2 rounded-lg bg-rose-950/80 border border-rose-500/60 text-rose-200 text-[11px] font-mono flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>
                        <strong>INTEGRITY ALARM:</strong> quickLogs hash no longer matches the sealed baseline.
                        Session flagged as TAMPERED — possible unauthorized browser script mutation.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleIntegrityAutoRecovery}
                      className="self-start px-3 py-1.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/30 cursor-pointer"
                    >
                      Integrity Auto-Recovery
                    </button>
                  </div>
                )}
                {verificationReport && (
                  <div
                    className={`mx-3.5 my-2.5 px-3.5 py-2.5 rounded-lg border text-[11px] font-mono space-y-2 ${
                      verificationReport.status === 'INTACT'
                        ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-100'
                        : verificationReport.status === 'UNSEALED'
                        ? 'bg-amber-950/60 border-amber-500/50 text-amber-100'
                        : verificationReport.status === 'EMPTY'
                        ? 'bg-zinc-900/70 border-zinc-600 text-zinc-200'
                        : 'bg-rose-950/80 border-rose-500/70 text-rose-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold">
                        {verificationReport.status === 'INTACT' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : verificationReport.status === 'TAMPERED' ? (
                          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                        )}
                        <span>
                          {verificationReport.status === 'INTACT'
                            ? lang === 'th'
                              ? `ตรวจสอบความถูกต้องสำเร็จ: แฮชตรงกับตราประทับ (${verificationReport.logCount} บรรทัด)`
                              : `Integrity Verified: Hash matches signed seal (${verificationReport.logCount} log lines)`
                            : verificationReport.status === 'UNSEALED'
                            ? lang === 'th'
                              ? 'ยังไม่มีตราประทับที่ลงนาม (Unsealed) — คำนวณแฮชปัจจุบันแล้ว'
                              : 'No signed seal baseline yet (Unsealed) — recalculated hash computed'
                            : verificationReport.status === 'EMPTY'
                            ? lang === 'th'
                              ? 'ไม่มีบันทึกที่แสดงให้ตรวจสอบ'
                              : 'No displayed logs to verify'
                            : lang === 'th'
                            ? 'ตรวจพบความผิดปกติ: แฮชที่คำนวณใหม่ไม่ตรงกับตราประทับที่ลงนาม!'
                            : 'TAMPER DETECTED: Recalculated hash does NOT match signed seal!'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={clearVerificationReport}
                        className="p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
                        aria-label="Close integrity verification result"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {verificationReport.status !== 'EMPTY' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
                        <div className="p-2 rounded bg-black/35 border border-white/10">
                          <div className="opacity-70 uppercase">
                            {lang === 'th' ? 'SHA-256 ที่คำนวณใหม่ (บันทึกที่แสดง)' : 'Recalculated SHA-256 (Displayed Logs)'}
                          </div>
                          <div className="break-all font-bold mt-0.5 select-all text-cyan-200">
                            {verificationReport.recalculatedHash}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-black/35 border border-white/10">
                          <div className="opacity-70 uppercase">
                            {lang === 'th' ? 'แฮชในตราประทับที่ลงนาม' : 'Signed Seal Content Hash'}
                          </div>
                          <div className="break-all font-bold mt-0.5 select-all text-emerald-200">
                            {verificationReport.sealedContentHash || 'NONE (UNSEALED)'}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] opacity-80">
                      <span>Seal ID: {verificationReport.sealMetadata?.sealId || sealMetadata?.sealId || 'N/A'}</span>
                      {(verificationReport.sealMetadata?.entryHash || sealMetadata?.entryHash) && (
                        <span>
                          Ledger Entry: {(verificationReport.sealMetadata?.entryHash || sealMetadata?.entryHash || '').slice(0, 14)}...
                        </span>
                      )}
                      {(verificationReport.sealMetadata?.sealedAt || sealMetadata?.sealedAt) && (
                        <span>
                          Sealed: {new Date(verificationReport.sealMetadata?.sealedAt || sealMetadata?.sealedAt || '').toLocaleTimeString()}
                        </span>
                      )}
                      <span>
                        Server Audit: {verificationReport.serverVerified ? (verificationReport.serverMatch ? 'CONFIRMED' : 'MISMATCH') : 'LOCAL_ONLY'}
                      </span>
                    </div>
                  </div>
                )}
                {showIntegrityChart && (
                  <div className="px-3.5 py-2.5 border-b border-[#1E294A] bg-[#070B19]/90">
                    <RollingIntegrityChart
                      points={rollingIntegrityPoints}
                      status={integrityStatus}
                      theme="dark"
                      height={132}
                      title={
                        lang === 'th'
                          ? 'Rolling Integrity (50 บันทึกการทำงานล่าสุด)'
                          : 'Rolling Integrity (Last 50 Session Log Entries)'
                      }
                      subtitle={
                        lang === 'th'
                          ? 'ติดตามความเสถียรของเซสชันและ SHA-256 Chain แบบต่อเนื่อง'
                          : 'Live session stability & cumulative SHA-256 integrity trajectory'
                      }
                    />
                  </div>
                )}
                <div
                  className={`px-3.5 py-2 flex flex-wrap items-center gap-2 border-b ${LOG_THEME_STYLES[logTheme].filterBar}`}
                >
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-70" />
                    <input
                      type="text"
                      value={logSearchQuery}
                      onChange={(e) => setLogSearchQuery(e.target.value)}
                      placeholder={lang === 'th' ? 'ค้นหาในบันทึก...' : 'Filter logs by text...'}
                      className={`w-full pl-8 pr-2.5 py-1 rounded-md text-[11px] focus:outline-none border ${LOG_THEME_STYLES[logTheme].input}`}
                    />
                  </div>
                  <select
                    value={logTagFilter}
                    onChange={(e) =>
                      setLogTagFilter(e.target.value as 'ALL' | 'INIT' | 'TESTER' | 'DONE' | 'ERROR' | 'SUCCESS' | 'WARNING')
                    }
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold focus:outline-none border cursor-pointer ${LOG_THEME_STYLES[logTheme].input}`}
                  >
                    <option value="ALL">All Logs</option>
                    <option value="SUCCESS">Success</option>
                    <option value="WARNING">Warning</option>
                    <option value="INIT">[INIT]</option>
                    <option value="TESTER">[TESTER]</option>
                    <option value="DONE">[DONE]</option>
                    <option value="ERROR">[ERROR]</option>
                  </select>
                  <select
                    aria-label="Filter logs by priority"
                    value={logPriorityFilter}
                    onChange={(e) => setLogPriorityFilter(e.target.value as 'ALL' | TaskPriority)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold focus:outline-none border cursor-pointer ${LOG_THEME_STYLES[logTheme].input}`}
                  >
                    <option value="ALL">All Priorities</option>
                    <option value="High">High Priority</option>
                    <option value="Medium">Medium Priority</option>
                    <option value="Low">Low Priority</option>
                  </select>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#A7BDB2]">
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
                      className="w-14 accent-[#10B981] cursor-pointer"
                      title="TTS Speech Rate"
                    />
                    <div className="flex items-center gap-1" role="group" aria-label="TTS speed presets">
                      {[0.5, 1.0, 2.0].map((preset) => {
                        const isActive = Math.abs(ttsRate - preset) < 0.01;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              setTtsRate(preset);
                              localStorage.setItem('zyntheor_tts_rate', String(preset));
                            }}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-[#10B981]/25 text-[#10B981] border-[#10B981]/60'
                                : logTheme === 'high_contrast'
                                ? 'bg-zinc-900 text-zinc-200 border-white/30 hover:bg-zinc-800'
                                : 'bg-[#071B18] text-[#A7BDB2] border-[#24483D] hover:border-[#10B981] hover:text-[#F0F7F3]'
                            }`}
                            title={`Set TTS speed preset to ${preset.toFixed(1)}x`}
                          >
                            {preset.toFixed(1)}x
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#A7BDB2]">
                    <span>Pitch {ttsPitch.toFixed(1)}x</span>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={ttsPitch}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setTtsPitch(val);
                        localStorage.setItem('zyntheor_tts_pitch', String(val));
                      }}
                      className="w-14 accent-[#F59E0B] cursor-pointer"
                      title="TTS Pitch"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#A7BDB2]">
                    <span>Vol {ttsVolume.toFixed(1)}x</span>
                    <input
                      type="range"
                      min="0.1"
                      max="2.0"
                      step="0.1"
                      value={ttsVolume}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setTtsVolume(val);
                        localStorage.setItem('zyntheor_tts_volume', String(val));
                      }}
                      className="w-14 accent-[#10B981] cursor-pointer"
                      title="TTS Volume Gain"
                    />
                  </div>
                  {ttsVoices.length > 0 && (() => {
                    const matchedIdx = ttsVoiceUri
                      ? ttsVoices.findIndex(
                          (v, idx) =>
                            `${v.voiceURI}::${v.lang}::${v.name}::${idx}` === ttsVoiceUri ||
                            `${v.voiceURI}::${v.lang}::${v.name}` === ttsVoiceUri ||
                            v.voiceURI === ttsVoiceUri
                        )
                      : -1;
                    const selectVoiceValue =
                      matchedIdx >= 0
                        ? `${ttsVoices[matchedIdx].voiceURI}::${ttsVoices[matchedIdx].lang}::${ttsVoices[matchedIdx].name}::${matchedIdx}`
                        : '';
                    return (
                      <select
                        value={selectVoiceValue}
                        onChange={(e) => {
                          setTtsVoiceUri(e.target.value);
                          localStorage.setItem('zyntheor_tts_voice', e.target.value);
                        }}
                        className="max-w-[140px] px-2 py-1 rounded-md text-[10px] font-mono bg-[#071B18] text-[#F0F7F3] border border-[#24483D] cursor-pointer"
                        title="Select TTS Voice"
                      >
                        <option value="">Default Voice</option>
                        {ttsVoices.map((v, idx) => {
                          const uniqueVoiceId = `${v.voiceURI}::${v.lang}::${v.name}::${idx}`;
                          return (
                            <option key={uniqueVoiceId} value={uniqueVoiceId}>
                              {v.name} ({v.lang})
                            </option>
                          );
                        })}
                      </select>
                    );
                  })()}
                </div>
                {bulkMode && selectedLogIndices.length > 0 && (
                  <div className="px-3.5 py-1.5 flex items-center gap-2 bg-[#102B25] border-b border-[#24483D] text-[10px] font-mono">
                    <span className="text-[#10B981] font-bold">{selectedLogIndices.length} selected</span>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickLogs((prev) => prev.filter((_, i) => !selectedLogIndices.includes(i)));
                        setSelectedLogIndices([]);
                      }}
                      className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 cursor-pointer"
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
                      className="px-2 py-0.5 rounded bg-[#071B18] text-[#F0F7F3] border border-[#24483D] cursor-pointer"
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
                      className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 cursor-pointer"
                    >
                      Categorize [AUDIT]
                    </button>
                  </div>
                )}
                {showPerfMetrics && (
                  <div className="px-3.5 py-1.5 flex items-center gap-4 bg-[#0D211E] border-b border-[#24483D] text-[10px] font-mono text-[#A7BDB2]">
                    <span>
                      Total Execution: <strong className="text-[#F0F7F3]">{totalExecMs !== null ? `${totalExecMs} ms` : 'Running / N/A'}</strong>
                    </span>
                    <span>
                      Throughput:{' '}
                      <strong className="text-[#10B981]">
                        {totalExecMs && totalExecMs > 0
                          ? `${((quickLogs.length / totalExecMs) * 1000).toFixed(2)} steps/s`
                          : 'N/A'}
                      </strong>
                    </span>
                  </div>
                )}
                {/* Summary Pill Count Header */}
                {(() => {
                  const successCount = quickLogs.filter((l) => classifyLogLine(l) === 'success').length;
                  const warningCount = quickLogs.filter((l) => classifyLogLine(l) === 'warning').length;
                  const errorCount = quickLogs.filter((l) => classifyLogLine(l) === 'error').length;
                  const filteredEntries = quickLogs
                    .map((log, origIdx) => ({ log, origIdx }))
                    .filter(({ log }) => {
                      const severity = classifyLogLine(log);
                      const matchTag =
                        logTagFilter === 'ALL' ||
                        (logTagFilter === 'SUCCESS'
                          ? severity === 'success'
                          : logTagFilter === 'WARNING'
                          ? severity === 'warning'
                          : logTagFilter === 'ERROR'
                          ? severity === 'error' || log.startsWith('[ERROR]')
                          : log.startsWith(`[${logTagFilter}]`));
                      const matchPriority =
                        logPriorityFilter === 'ALL' ||
                        extractLogPriority(log) === logPriorityFilter;
                      const matchText =
                        !logSearchQuery.trim() ||
                        log.toLowerCase().includes(logSearchQuery.toLowerCase());
                      return matchTag && matchPriority && matchText;
                    });
                  const clusters = buildLogClusters(filteredEntries, clusterLogs);
                  const multiLineClusters = clusters.filter((c) => c.items.length > 1);

                  return (
                    <>
                      <div
                        className={`px-3.5 py-2 flex flex-wrap items-center gap-2 text-[10px] font-mono border-b ${LOG_THEME_STYLES[logTheme].summaryBar}`}
                      >
                        <button
                          type="button"
                          onClick={() => setLogTagFilter((prev) => (prev === 'SUCCESS' ? 'ALL' : 'SUCCESS'))}
                          className={`inline-flex items-center gap-1.5 py-0.5 font-semibold transition-colors cursor-pointer ${
                            logTagFilter === 'SUCCESS' ? 'text-emerald-200 underline underline-offset-4' : 'text-emerald-300/75 hover:text-emerald-200'
                          }`}
                          title="Filter Success lines"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span>Success: {successCount}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setLogTagFilter((prev) => (prev === 'WARNING' ? 'ALL' : 'WARNING'))}
                          className={`inline-flex items-center gap-1.5 py-0.5 font-semibold transition-colors cursor-pointer ${
                            logTagFilter === 'WARNING' ? 'text-amber-200 underline underline-offset-4' : 'text-amber-300/75 hover:text-amber-200'
                          }`}
                          title="Filter Warning lines"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          <span>Warning: {warningCount}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setLogTagFilter((prev) => (prev === 'ERROR' ? 'ALL' : 'ERROR'))}
                          className={`inline-flex items-center gap-1.5 py-0.5 font-semibold transition-colors cursor-pointer ${
                            logTagFilter === 'ERROR' ? 'text-rose-200 underline underline-offset-4' : 'text-rose-300/75 hover:text-rose-200'
                          }`}
                          title="Filter Error lines"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                          <span>Error: {errorCount}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setLogTagFilter('ALL')}
                          className={`inline-flex items-center gap-1.5 py-0.5 font-semibold transition-colors cursor-pointer ${
                            logTagFilter === 'ALL' ? 'text-[#F0F7F3] underline underline-offset-4' : 'text-[#A7BDB2] hover:text-[#F0F7F3]'
                          }`}
                          title="Show all log lines"
                        >
                          <span>Total: {quickLogs.length}</span>
                        </button>
                        {clusterLogs && multiLineClusters.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-cyan-300/80 font-medium">
                              {multiLineClusters.length} {multiLineClusters.length === 1 ? 'cluster' : 'clusters'}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const next: Record<string, boolean> = {};
                                multiLineClusters.forEach((c) => {
                                  next[c.clusterKey] = true;
                                });
                                setExpandedClusters(next);
                              }}
                              className="py-0.5 text-current/80 hover:text-current underline underline-offset-2 cursor-pointer"
                            >
                              Expand all
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedClusters({})}
                              className="py-0.5 text-current/80 hover:text-current underline underline-offset-2 cursor-pointer"
                            >
                              Collapse all
                            </button>
                          </div>
                        )}
                        {quickLogs.length > 0 && (() => {
                          let score = 0;
                          const points = quickLogs.map((l, i) => {
                            const lvl = classifyLogLine(l);
                            if (lvl === 'error') score -= 1;
                            else if (lvl === 'warning') score -= 0.5;
                            else if (lvl === 'success') score += 1;
                            const x = quickLogs.length === 1 ? 50 : (i / (quickLogs.length - 1)) * 100;
                            const y = Math.max(2, Math.min(18, 10 - score * 2));
                            return `${x.toFixed(1)},${y.toFixed(1)}`;
                          });
                          return (
                            <div className="flex items-center gap-1.5 ml-1" title="Session Sentiment Trend">
                              <span className="opacity-70">Trend</span>
                              <svg width="64" height="20" viewBox="0 0 100 20" className="overflow-visible">
                                <polyline
                                  fill="none"
                                  stroke="#10B981"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  points={points.join(' ')}
                                />
                              </svg>
                            </div>
                          );
                        })()}
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
                        className="p-4 max-h-56 overflow-y-auto space-y-1.5 focus:outline-none focus:ring-1 focus:ring-[#10B981]/40"
                      >
                        {quickLogs.length === 0 ? (
                          <span className={`${LOG_THEME_STYLES[logTheme].mutedText} italic`}>
                            {lang === 'th'
                              ? 'กด "สั่งการประมวลผล" เพื่อเริ่มการประมวลผลและดูเส้นทางการคิด'
                              : 'Click "Dispatch Engine" to stream real native execution trace.'}
                          </span>
                        ) : (
                          clusters.map((cluster) => {
                            const renderLogRow = (log: string, idx: number, nested = false, isCollapsed = false) => {
                              const now = new Date();
                              const ts =
                                logTimeMode === 'relative'
                                  ? `+${(idx * 0.25).toFixed(2)}s`
                                  : `${String(now.getHours()).padStart(2, '0')}:${String(
                                      now.getMinutes()
                                    ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}:${String(
                                      now.getMilliseconds()
                                    ).padStart(3, '0')}`;
                              const match = log.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
                              const tag = match ? match[1] : null;
                              const linePriority = extractLogPriority(log);
                              const message = stripPriorityToken(match ? match[2] : log);
                              const severity = classifyLogLine(log);

                              const rowHighlightClass =
                                severity === 'error'
                                  ? 'rounded-md px-2 py-1 border border-rose-500/35 bg-rose-500/10'
                                  : severity === 'warning'
                                  ? 'rounded-md px-2 py-1 border border-amber-400/35 bg-amber-500/10'
                                  : severity === 'success'
                                  ? 'rounded-md px-2 py-1 border border-[#CCFF00]/30 bg-[#CCFF00]/8'
                                  : 'px-2 py-0.5';

                              const sentimentDotClass =
                                severity === 'error'
                                  ? 'bg-[#FF007F]'
                                  : severity === 'warning'
                                  ? 'bg-[#FF5E3A]'
                                  : severity === 'success'
                                  ? 'bg-[#CCFF00]'
                                  : 'bg-[#00F0FF]/70';

                              const isNewLogEntry = idx >= prevLogCountRef.current;

                              return (
                                <div
                                  key={`${idx}-${nested ? 'n' : 's'}`}
                                  className={`text-[11px] leading-relaxed flex items-start gap-2 transition-colors ${isNewLogEntry ? 'animate-log-fade-in' : ''} ${rowHighlightClass} ${LOG_THEME_STYLES[logTheme].rowText}`}
                                >
                                  {bulkMode && (
                                    <input
                                      type="checkbox"
                                      checked={selectedLogIndices.includes(idx)}
                                      disabled={isCollapsed}
                                      tabIndex={isCollapsed ? -1 : undefined}
                                      onChange={(e) => {
                                        setSelectedLogIndices((prev) =>
                                          e.target.checked ? [...prev, idx] : prev.filter((i) => i !== idx)
                                        );
                                      }}
                                      className="mt-1 accent-[#10B981] cursor-pointer shrink-0"
                                    />
                                  )}
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${sentimentDotClass}`}
                                    title={
                                      severity === 'error'
                                        ? 'Error'
                                        : severity === 'warning'
                                        ? 'Warning'
                                        : severity === 'success'
                                        ? 'Success'
                                        : 'Info'
                                    }
                                  />
                                  <span className={`text-[10px] shrink-0 select-none w-5 text-right opacity-60 ${LOG_THEME_STYLES[logTheme].mutedText}`}>
                                    {idx + 1}
                                  </span>
                                  <span className={`text-[10px] shrink-0 select-none opacity-80 ${LOG_THEME_STYLES[logTheme].mutedText}`}>
                                    {ts}
                                  </span>
                                  {tag && <span className={`text-[10px] shrink-0 font-semibold ${LOG_THEME_STYLES[logTheme].mutedText}`}>[{tag}]</span>}
                                  {linePriority && <span className="text-[9px] shrink-0 text-slate-400">{linePriority}</span>}
                                  <span className={logTextWrap ? 'break-words whitespace-pre-wrap' : 'whitespace-nowrap'}>
                                    {renderHighlightedLog(message, logTheme, logSearchQuery)}
                                  </span>
                                </div>
                              );
                            };

                            if (cluster.items.length === 1) {
                              const only = cluster.items[0];
                              return renderLogRow(only.log, only.origIdx, false);
                            }

                            const isExpanded = Boolean(expandedClusters[cluster.clusterKey]);
                            const firstItem = cluster.items[0];
                            const lastItem = cluster.items[cluster.items.length - 1];
                            const previewMsg = stripPriorityToken(lastItem.log.replace(/^\[[A-Z0-9_]+\]\s*/, ''));

                            return (
                              <div
                                key={cluster.clusterKey}
                                className={`rounded-lg border transition-colors duration-200 ${LOG_THEME_STYLES[logTheme].clusterCard}`}
                              >
                                <button
                                  type="button"
                                  aria-expanded={isExpanded}
                                  onClick={() =>
                                    setExpandedClusters((prev) => ({
                                      ...prev,
                                      [cluster.clusterKey]: !prev[cluster.clusterKey],
                                    }))
                                  }
                                  className={`w-full px-2.5 py-1.5 flex items-center gap-2 text-left text-[11px] cursor-pointer ${LOG_THEME_STYLES[logTheme].rowText}`}
                                >
                                  <ChevronRight
                                    className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ease-out ${
                                      isExpanded ? 'rotate-90 text-[#10B981]' : 'rotate-0 text-[#FFB454]'
                                    }`}
                                  />
                                  <span className="text-cyan-300/80 text-[10px] font-medium shrink-0">
                                    ×{cluster.items.length} steps
                                  </span>
                                  <span className={`text-[10px] shrink-0 opacity-75 ${LOG_THEME_STYLES[logTheme].mutedText}`}>
                                    #{firstItem.origIdx + 1}–#{lastItem.origIdx + 1}
                                  </span>
                                  {cluster.tag && (
                                    <span className="text-[10px] font-medium text-indigo-300/80 shrink-0">
                                      {cluster.tag}
                                    </span>
                                  )}
                                  {cluster.priority && (
                                    <span
                                      className={`text-[9px] font-medium uppercase tracking-wider shrink-0 ${PRIORITY_BADGE_STYLES[cluster.priority].pill}`}
                                    >
                                      {cluster.priority.toUpperCase()}
                                    </span>
                                  )}
                                  <span className="truncate opacity-85">
                                    {renderHighlightedLog(previewMsg, logTheme, logSearchQuery)}
                                  </span>
                                </button>
                                <div
                                  aria-hidden={!isExpanded}
                                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                                    isExpanded
                                      ? 'grid-rows-[1fr] opacity-100'
                                      : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                                  }`}
                                >
                                  <div className="overflow-hidden min-h-0">
                                    <div
                                      className={`px-2.5 pb-2 pt-1 space-y-1 border-t border-current/10 transition-transform duration-200 ease-out ${
                                        isExpanded ? 'translate-y-0' : '-translate-y-1'
                                      }`}
                                    >
                                      {cluster.items.map((item) => renderLogRow(item.log, item.origIdx, true, !isExpanded))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                        <div ref={logsEndRef} />
                      </div>
                    </>
                  );
                })()}
              </div>

              {quickDone && (
                <div 
                  className="flex flex-col gap-1 p-3 rounded-xl text-xs font-semibold"
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    color: 'var(--status-verified)',
                    border: '1px solid rgba(16, 185, 129, 0.3)'
                  }}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>
                      {lang === 'th'
                        ? 'การทำงานเสร็จสิ้น (exitCode 0) บันทึก SHA-256 ลง Audit Ledger สำเร็จ'
                        : 'Execution verified with exitCode 0 in /workspace. SHA-256 logged.'}
                    </span>
                  </div>
                  {verificationHash && (
                    <div className="text-[10px] font-mono text-[#A7BDB2] truncate">
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
              <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-[#9AA8C7]">
                <span>Shortcut:</span>
                <kbd className="px-1.5 py-0.5 rounded bg-[#070B19] border border-[#1E294A] text-[#00F0FF] font-bold text-[10px]">
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
                  className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
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
        <div className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-[#0D1326] border-l border-[#1E294A] h-full flex flex-col shadow-2xl">
            <div className="px-5 py-4 flex items-center justify-between border-b border-[#1E294A] bg-[#131B36]">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#00F0FF]" />
                <h3 className="text-sm font-bold text-[#F4F7FF]">
                  Execution Snapshots ({snapshots.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSnapshotDrawerOpen(false)}
                className="p-1.5 rounded-lg text-[#9AA8C7] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {snapshots.length === 0 ? (
                <div className="text-xs text-[#9AA8C7] italic">
                  No snapshots saved yet. Click the camera icon in the log header to save a snapshot.
                </div>
              ) : (
                snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="p-3 rounded-xl bg-[#070B19] border border-[#1E294A] space-y-2"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-[#00F0FF] font-bold">{snap.logs.length} entries</span>
                        {snap.priority && (
                          <span className={`text-[9px] font-medium uppercase ${PRIORITY_BADGE_STYLES[snap.priority].pill}`}>
                            {snap.priority}
                          </span>
                        )}
                      </div>
                      <span className="text-[#9AA8C7]">{new Date(snap.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-xs font-semibold text-[#F4F7FF] truncate">{snap.goal}</div>
                    <div className="max-h-32 overflow-y-auto bg-[#0D1326] p-2 rounded-lg border border-[#1E294A] font-mono text-[10px] text-[#9AA8C7] space-y-1">
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
        <div className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
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
                <div className="w-8 h-8 rounded-lg vivid-gradient-brand flex items-center justify-center text-white font-bold shrink-0 shadow-sm">
                  <Keyboard className="w-4 h-4 text-[#CCFF00]" />
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
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#00F0FF] mb-2.5 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'การสั่งการและควบคุม Modal' : 'Intelligence Dispatch & Modals'}</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'เปิด/ปิด หน้าต่างด่วน' : 'Toggle Quick Task'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#FF5E3A] font-mono font-bold text-[11px] border border-[#1E294A]">
                      Ctrl + K
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'สั่งการประมวลผลทันที' : 'Dispatch Engine'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#00F0FF] font-mono font-bold text-[11px] border border-[#1E294A]">
                      Ctrl + Enter
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'ปิดหน้าต่าง / ถอยกลับ' : 'Close Active Modal'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#F4F7FF] font-mono font-bold text-[11px] border border-[#1E294A]">
                      Esc
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'เปิดหน้านี้ (คำแนะนำ)' : 'Show Shortcuts'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#00F0FF] font-mono font-bold text-[11px] border border-[#1E294A]">
                      Ctrl + / or ?
                    </kbd>
                  </div>
                </div>
              </div>

              {/* Category 2: Trace & Terminal Actions */}
              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#FF5E3A] mb-2.5 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'การจัดการบันทึกและสแนปช็อต' : 'Trace & Audit Log Management'}</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'คัดลอกบันทึกทั้งหมด' : 'Copy Full Trace'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#F4F7FF] font-mono font-bold text-[11px] border border-[#1E294A]">
                      Ctrl + Shift + C
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'ดาวน์โหลดไฟล์ .log' : 'Download .log File'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#F4F7FF] font-mono font-bold text-[11px] border border-[#1E294A]">
                      Ctrl + Shift + D
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'บันทึก Snapshot' : 'Take Snapshot'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#CCFF00] font-mono font-bold text-[11px] border border-[#1E294A]">
                      Ctrl + Shift + S
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'ประวัติ Snapshots' : 'Snapshot Drawer'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#FF5E3A] font-mono font-bold text-[11px] border border-[#1E294A]">
                      Alt + H
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'ล้างบันทึกปัจจุบัน' : 'Clear Logs'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#FF007F] font-mono font-bold text-[11px] border border-[#1E294A]">
                      Alt + C
                    </kbd>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7]">{lang === 'th' ? 'เลื่อนบนสุด / ล่างสุด' : 'Scroll Top / End'}</span>
                    <kbd className="px-2 py-0.5 rounded bg-[#131B36] text-[#9AA8C7] font-mono font-bold text-[10px] border border-[#1E294A]">
                      Ctrl + Home / End
                    </kbd>
                  </div>
                </div>
              </div>

              {/* Category 3: Quick Navigation */}
              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#7B2CBF] mb-2.5 flex items-center gap-1.5">
                  <span>{lang === 'th' ? 'การสลับโมดูลระบบด่วน' : 'Rapid Module Switching (Alt + 1..9)'}</span>
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono">
                  <div className="p-2 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7] truncate">1. Command</span>
                    <kbd className="text-[#00F0FF]">Alt+1</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7] truncate">2. Chat</span>
                    <kbd className="text-[#00F0FF]">Alt+2</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7] truncate">3. Core</span>
                    <kbd className="text-[#00F0FF]">Alt+3</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7] truncate">4. DevStudio</span>
                    <kbd className="text-[#00F0FF]">Alt+4</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7] truncate">5. Research</span>
                    <kbd className="text-[#00F0FF]">Alt+5</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7] truncate">6. Auto</span>
                    <kbd className="text-[#00F0FF]">Alt+6</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7] truncate">7. Knowledge</span>
                    <kbd className="text-[#00F0FF]">Alt+7</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7] truncate">8. ModelLab</span>
                    <kbd className="text-[#00F0FF]">Alt+8</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center justify-between">
                    <span className="text-[#9AA8C7] truncate">9. Governance</span>
                    <kbd className="text-[#00F0FF]">Alt+9</kbd>
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
              <span className="text-[11px] font-mono text-[#9AA8C7]">
                {lang === 'th' ? 'รองรับทั้ง macOS (⌘) และ Windows/Linux (Ctrl)' : 'Compatible with macOS (Cmd) & Linux/Windows (Ctrl)'}
              </span>
              <button
                type="button"
                onClick={() => setIsShortcutsModalOpen(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-[#131B36] border border-[#1E294A] text-[#F4F7FF] hover:border-[#00F0FF] transition-colors cursor-pointer"
              >
                {lang === 'th' ? 'ปิดหน้านี้ (Esc)' : 'Dismiss (Esc)'}
              </button>
            </div>
          </div>
        </div>
      )}
      <PrintableSessionAudit payload={printPayload} />
    </div>
  );
}
