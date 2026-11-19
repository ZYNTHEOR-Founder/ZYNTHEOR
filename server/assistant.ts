import { buildTruthDashboardSnapshot } from '../lib/DashboardTruth';
import { ConnectivityMonitor } from '../lib/ConnectivityMonitor';
import { KnowledgeWorkspace } from '../lib/KnowledgeWorkspace';
import { AuditLedger } from '../lib/AuditLedger';
import { ToolGateway } from '../lib/ToolGateway';
import { ToolRegistry } from '../lib/ToolRegistry';
import { NativeNeuralLMProvider } from '../lib/providers';
import type { SovereignRole } from '../lib/SovereignIdentity';
import {
  AssistantBrainCore,
  type AssistantBrainStatus,
  type BrainCorePacket,
  type BrainCycleTrace,
} from './assistantBrainCore';

type Content = { role: 'user' | 'model'; parts: Part[] };
type Part = { text?: string; functionCall?: any; functionResponse?: any; inlineData?: { mimeType?: string; data?: string } };
// Local minimal types - replaces missing @google/genai import, no external provider
export enum Type {
  STRING = "STRING",
  INTEGER = "INTEGER",
  NUMBER = "NUMBER",
  BOOLEAN = "BOOLEAN",
  OBJECT = "OBJECT",
  ARRAY = "ARRAY",
}
export enum ThinkingLevel {
  LOW = "LOW",
  HIGH = "HIGH",
  XHIGH = "XHIGH",
}
export interface FunctionDeclaration {
  name: string;
  description?: string;
  parameters?: {
    type: Type;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
  [key: string]: any;
}


const ASSISTANT_MODEL = 'zyntheor-native-core';

export type AssistantThinkingMode = 'fast' | 'balanced' | 'deep';

export interface AssistantHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export interface AssistantAttachment {
  name: string;
  mimeType: string;
  dataBase64?: string;
  textContent?: string;
}

export interface AssistantModuleState {
  moduleId: string;
  moduleLabel?: string;
  openedAt?: string;
  quickTask?: {
    isOpen?: boolean;
    goal?: string;
    isRunning?: boolean;
    done?: boolean;
    logCount?: number;
  };
  logTerminal?: {
    totalLogs?: number;
    searchMode?: string;
    searchQuery?: string;
    tagFilter?: string;
    integrityStatus?: string;
    ttsEnabled?: boolean;
  };
  isContextRailOpen?: boolean;
  moduleDetails?: Record<string, unknown>;
}

export interface AssistantWorkspaceMetadata {
  tenantId?: string;
  planId?: string;
  commercialPhase?: string;
  sandboxPath?: string;
  sandboxFileCount?: number;
  sandboxFilesSample?: string[];
  model?: {
    name?: string;
    architecture?: string;
    runtimeState?: string;
    weightsLoaded?: boolean;
    inferenceReady?: boolean;
    executionVerified?: boolean;
    checkpointHash?: string;
  };
  audit?: {
    totalRecords?: number;
    chainValid?: boolean;
    headHash?: string;
  };
  connectivity?: {
    online?: boolean;
    status?: string;
    runtimeState?: string;
    bridgeLifecycle?: string;
    cloudStorageConfigured?: boolean;
    pythonBridgeReachable?: boolean;
  };
  resources?: {
    loadAvg1m?: number;
    cpuCores?: number;
    processRssMb?: number;
    systemRamUsedMb?: number;
    systemRamTotalMb?: number;
    tokensPerSec?: number;
    lastInferenceLatencyMs?: number;
  };
  serverTime?: string;
  uptimeSeconds?: number;
}

export interface AssistantContextInfo {
  sessionId?: string;
  activeModule?: string;
  lang?: 'th' | 'en';
  role?: string;
  runtimeReady?: boolean;
  recentLogs?: string[];
  moduleState?: AssistantModuleState;
  workspaceMetadata?: AssistantWorkspaceMetadata;
}

export interface AssistantShortTermTurn {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  toolsUsed?: string[];
  activeModule?: string;
}

export interface SessionMemoryBuffer {
  sessionId: string;
  turns: AssistantShortTermTurn[];
  recentTools: string[];
  referencedEntities: string[];
  lastSummary: string;
  moduleState?: AssistantModuleState;
  workspaceMetadata?: AssistantWorkspaceMetadata;
  lastContext?: AssistantContextInfo;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMemoryInfo {
  sessionId: string;
  turnCount: number;
  exchangeCount: number;
  maxExchanges: number;
  recentTools: string[];
  referencedEntities: string[];
  lastSummary: string;
  activeModule?: string;
  workspaceTenantId?: string;
  sandboxFileCount?: number;
  updatedAt: string;
}

export interface AssistantGroundingSource {
  title: string;
  url: string;
}

export interface AssistantProposedAction {
  actionType: 'navigate_module' | 'prepare_quick_task';
  label: string;
  moduleId?: string;
  taskGoal?: string;
}

export type AssistantStreamEvent =
  | { type: 'status'; phase: string; label: string }
  | { type: 'brain_core'; packet: BrainCorePacket }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; summary: string }
  | { type: 'chunk'; text: string }
  | { type: 'grounding'; sources: AssistantGroundingSource[] }
  | { type: 'actions'; actions: AssistantProposedAction[] }
  | {
      type: 'done';
      text: string;
      sources?: AssistantGroundingSource[];
      actions?: AssistantProposedAction[];
      toolsUsed?: string[];
      sessionId?: string;
      memoryTurns?: number;
      memoryExchanges?: number;
      maxMemoryExchanges?: number;
      brainTrace?: BrainCycleTrace;
    }
  | { type: 'error'; error: string };

const VALID_MODULE_IDS = new Set([
  'command_center',
  'conversational_intelligence',
  'intelligence_core',
  'dev_studio',
  'research_lab',
  'automation_center',
  'knowledge_hub',
  'model_laboratory',
  'experiment_center',
  'api_platform',
  'marketplace',
  'subscription_billing',
  'analytics_bi',
  'governance_security',
  'user_settings',
  'admin_console',
]);

let cachedClient: any | null = null;
let cachedKey: string | undefined;



export function isAssistantConfigured(): boolean {
  return (AssistantBrainCore.getInstance().getBrainStatus() as any).nativeWeightsLoaded === true;
}

export function getAssistantModelName(): string {
  return ASSISTANT_MODEL;
}

export function getAssistantBrainStatus(): AssistantBrainStatus {
  return AssistantBrainCore.getInstance().getBrainStatus();
}

function resolveThinkingLevel(mode?: AssistantThinkingMode): ThinkingLevel {
  switch (mode) {
    case 'fast':
      return ThinkingLevel.LOW;
    case 'deep':
      return ThinkingLevel.XHIGH;
    case 'balanced':
    default:
      return ThinkingLevel.HIGH;
  }
}

const getSystemTelemetryDeclaration: FunctionDeclaration = {
  name: 'get_system_telemetry',
  description:
    'Inspect live ZYNTHEOR verified system status, runtime metrics, native intelligence gates, active blockers, and SHA-256 audit chain health.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      includeMetrics: {
        type: Type.BOOLEAN,
        description: 'Include detailed runtime resource metrics and blockers.',
      },
    },
  },
};

const searchKnowledgeHubDeclaration: FunctionDeclaration = {
  name: 'search_knowledge_hub',
  description:
    'Search indexed documents and knowledge chunks in the ZYNTHEOR Knowledge Hub.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Search keywords or question to match against indexed documents.',
      },
      limit: {
        type: Type.INTEGER,
        description: 'Maximum number of matching chunks to return (1 to 8).',
      },
      collection: {
        type: Type.STRING,
        description: 'Optional collection name filter.',
      },
    },
    required: ['query'],
  },
};

const inspectWorkspaceFilesDeclaration: FunctionDeclaration = {
  name: 'inspect_workspace_files',
  description:
    'List files inside the ZYNTHEOR /workspace sandbox or read a specific file inside /workspace.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: 'Use "list" to list all workspace files, or "read" to read a file.',
      },
      path: {
        type: Type.STRING,
        description: 'Relative file path inside /workspace when action is "read".',
      },
    },
    required: ['action'],
  },
};

const inspectAuditLedgerDeclaration: FunctionDeclaration = {
  name: 'inspect_audit_ledger',
  description:
    'Verify the immutable SHA-256 audit ledger integrity and retrieve recent audit log entries.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      limit: {
        type: Type.INTEGER,
        description: 'Number of recent audit entries to retrieve (default 8, max 20).',
      },
    },
  },
};

const proposeUiActionDeclaration: FunctionDeclaration = {
  name: 'propose_ui_action',
  description:
    'Attach an interactive action button for the user in the ZYNTHEOR UI: either navigate to a specific module or pre-fill a task goal in the Quick Task Engine.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      actionType: {
        type: Type.STRING,
        description: 'Either "navigate_module" or "prepare_quick_task".',
      },
      moduleId: {
        type: Type.STRING,
        description:
          'Target module ID when actionType is "navigate_module" (e.g., command_center, conversational_intelligence, intelligence_core, dev_studio, research_lab, automation_center, knowledge_hub, model_laboratory, experiment_center, api_platform, marketplace, subscription_billing, analytics_bi, governance_security, user_settings, admin_console).',
      },
      taskGoal: {
        type: Type.STRING,
        description: 'Task specification to prefill in Quick Task when actionType is "prepare_quick_task".',
      },
      label: {
        type: Type.STRING,
        description: 'Short button label in Thai or English for the user.',
      },
    },
    required: ['actionType', 'label'],
  },
};

const recallOrStoreMemoryDeclaration: FunctionDeclaration = {
  name: 'recall_or_store_assistant_memory',
  description:
    'Access ZYNTHEOR NativeMemoryController persistent cross-session memory: recall ranked episodic/semantic/task memories or store a verified fact, preference, or lesson.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: 'Either "recall" to query persistent memory or "store" to save a memory entry.',
      },
      query: {
        type: Type.STRING,
        description: 'Search query when action is "recall".',
      },
      key: {
        type: Type.STRING,
        description: 'Unique memory key when action is "store".',
      },
      value: {
        type: Type.STRING,
        description: 'Memory content or JSON string when action is "store".',
      },
      category: {
        type: Type.STRING,
        description: 'Memory category: episodic, semantic, user_preference, reasoning_trace, or task_memory.',
      },
      limit: {
        type: Type.INTEGER,
        description: 'Maximum results when action is "recall" (1 to 10).',
      },
    },
    required: ['action'],
  },
};

const runAdaptiveReasoningDeclaration: FunctionDeclaration = {
  name: 'run_adaptive_reasoning',
  description:
    'Invoke ZYNTHEOR AdaptiveReasoningEngine to run multi-step verification (symbolic math verification, CSP constraints, AST code inspection, or multi-hop graph reasoning).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: 'Problem statement or reasoning objective to evaluate.',
      },
      pythonSource: {
        type: Type.STRING,
        description: 'Optional Python code snippet to inspect via AST verifier.',
      },
    },
    required: ['prompt'],
  },
};

const decomposeExecutionPlanDeclaration: FunctionDeclaration = {
  name: 'decompose_execution_plan',
  description:
    'Invoke ZYNTHEOR AutonomousPlanner to decompose a software, research, or automation goal into a structured multi-stage DAG execution plan.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      goal: {
        type: Type.STRING,
        description: 'Target engineering or research goal to decompose into stages.',
      },
      priority: {
        type: Type.STRING,
        description: 'Optional priority: Low, Medium, or High.',
      },
      runtime: {
        type: Type.STRING,
        description: 'Target runtime: "node" or "python3".',
      },
    },
    required: ['goal'],
  },
};

const writeWorkspaceFileDeclaration: FunctionDeclaration = {
  name: 'write_workspace_file',
  description:
    'Create or update a file inside the jailed ZYNTHEOR /workspace sandbox (requires verified developer/operator/admin role; blocks secret paths and path traversal).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: 'Relative path inside /workspace (e.g. "src/auth/token.ts" or "tests/test_app.py").',
      },
      content: {
        type: Type.STRING,
        description: 'UTF-8 file content to write.',
      },
    },
    required: ['path', 'content'],
  },
};

const runTerminalCommandDeclaration: FunctionDeclaration = {
  name: 'run_terminal_command',
  description:
    'Execute an allowlisted zero-shell command inside /workspace (allowed binaries: node, python3, ls, cat, head, pwd, echo, mkdir, rm, find; requires verified developer/operator/admin role).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: 'Allowlisted binary name (e.g. "python3" or "node").',
      },
      argsString: {
        type: Type.STRING,
        description: 'Optional space-separated arguments (e.g. "-m unittest tests/test_app.py -v").',
      },
    },
    required: ['command'],
  },
};

const executePythonSandboxDeclaration: FunctionDeclaration = {
  name: 'execute_python_sandbox',
  description:
    'Execute Python 3 code inside an isolated ZYNTHEOR sandbox container/subprocess (requires verified developer/operator/admin role).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      code: {
        type: Type.STRING,
        description: 'Python 3 source code to run.',
      },
      timeoutMs: {
        type: Type.INTEGER,
        description: 'Timeout in milliseconds (500 to 15000, default 5000).',
      },
    },
    required: ['code'],
  },
};

const searchInternetDeclaration: FunctionDeclaration = {
  name: 'search_internet',
  description:
    'Search the public internet via DuckDuckGo HTML endpoint and return verified titles, URLs, and snippets.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Search query in Thai or English.',
      },
      maxResults: {
        type: Type.INTEGER,
        description: 'Maximum results to return (1 to 10, default 5).',
      },
    },
    required: ['query'],
  },
};

export const ASSISTANT_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  getSystemTelemetryDeclaration,
  searchKnowledgeHubDeclaration,
  inspectWorkspaceFilesDeclaration,
  inspectAuditLedgerDeclaration,
  proposeUiActionDeclaration,
  recallOrStoreMemoryDeclaration,
  runAdaptiveReasoningDeclaration,
  decomposeExecutionPlanDeclaration,
  writeWorkspaceFileDeclaration,
  runTerminalCommandDeclaration,
  executePythonSandboxDeclaration,
  searchInternetDeclaration,
];

export const MAX_SHORT_TERM_EXCHANGES = 12;
const MAX_SHORT_TERM_MESSAGES = MAX_SHORT_TERM_EXCHANGES * 2;
const SESSION_MEMORY_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 100;

const sessionMemoryStore = new Map<string, SessionMemoryBuffer>();

export function sanitizeSessionId(raw?: string): string {
  const cleaned = typeof raw === 'string' ? raw.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) : '';
  return cleaned || 'default-session';
}

function pruneSessionMemoryStore(): void {
  const now = Date.now();
  for (const [id, entry] of sessionMemoryStore.entries()) {
    const updatedMs = Date.parse(entry.updatedAt);
    if (!Number.isFinite(updatedMs) || now - updatedMs > SESSION_MEMORY_TTL_MS) {
      sessionMemoryStore.delete(id);
    }
  }
  if (sessionMemoryStore.size <= MAX_SESSIONS) return;
  const sorted = Array.from(sessionMemoryStore.entries()).sort(
    (a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt)
  );
  while (sorted.length > MAX_SESSIONS) {
    const oldest = sorted.shift();
    if (oldest) sessionMemoryStore.delete(oldest[0]);
  }
}

function getOrCreateSessionBuffer(sessionId: string): SessionMemoryBuffer {
  pruneSessionMemoryStore();
  const safeId = sanitizeSessionId(sessionId);
  const existing = sessionMemoryStore.get(safeId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const created: SessionMemoryBuffer = {
    sessionId: safeId,
    turns: [],
    recentTools: [],
    referencedEntities: [],
    lastSummary: '',
    createdAt: now,
    updatedAt: now,
  };
  sessionMemoryStore.set(safeId, created);
  return created;
}

function extractReferencedEntities(text: string): string[] {
  const found = new Set<string>();
  const fileMatches = text.match(/[a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|py|json|md|yml|yaml|sql|log|sh)/g) || [];
  for (const m of fileMatches.slice(0, 8)) found.add(m);
  for (const mod of VALID_MODULE_IDS) {
    if (text.includes(mod)) found.add(mod);
  }
  return Array.from(found).slice(0, 12);
}

function toSessionMemoryInfo(buffer: SessionMemoryBuffer): SessionMemoryInfo {
  return {
    sessionId: buffer.sessionId,
    turnCount: buffer.turns.length,
    exchangeCount: Math.ceil(buffer.turns.length / 2),
    maxExchanges: MAX_SHORT_TERM_EXCHANGES,
    recentTools: buffer.recentTools.slice(-8),
    referencedEntities: buffer.referencedEntities.slice(-12),
    lastSummary: buffer.lastSummary,
    activeModule: buffer.moduleState?.moduleId || buffer.lastContext?.activeModule,
    workspaceTenantId: buffer.workspaceMetadata?.tenantId,
    sandboxFileCount: buffer.workspaceMetadata?.sandboxFileCount,
    updatedAt: buffer.updatedAt,
  };
}

export function syncAssistantSessionContext(
  rawSessionId: string,
  payload: {
    moduleState?: AssistantModuleState;
    workspaceMetadata?: AssistantWorkspaceMetadata;
    context?: AssistantContextInfo;
  }
): SessionMemoryInfo {
  const buffer = getOrCreateSessionBuffer(rawSessionId);
  if (payload.moduleState && typeof payload.moduleState === 'object') {
    buffer.moduleState = payload.moduleState;
  }
  if (payload.workspaceMetadata && typeof payload.workspaceMetadata === 'object') {
    buffer.workspaceMetadata = payload.workspaceMetadata;
  }
  if (payload.context && typeof payload.context === 'object') {
    buffer.lastContext = {
      ...buffer.lastContext,
      ...payload.context,
      sessionId: buffer.sessionId,
    };
  }
  buffer.updatedAt = new Date().toISOString();
  return toSessionMemoryInfo(buffer);
}

export function getAssistantSessionMemoryInfo(rawSessionId: string): SessionMemoryInfo {
  const safeId = sanitizeSessionId(rawSessionId);
  const existing = sessionMemoryStore.get(safeId);
  if (!existing) {
    return {
      sessionId: safeId,
      turnCount: 0,
      exchangeCount: 0,
      maxExchanges: MAX_SHORT_TERM_EXCHANGES,
      recentTools: [],
      referencedEntities: [],
      lastSummary: '',
      updatedAt: new Date().toISOString(),
    };
  }
  return toSessionMemoryInfo(existing);
}

export function clearAssistantSessionMemory(rawSessionId: string): boolean {
  const safeId = sanitizeSessionId(rawSessionId);
  return sessionMemoryStore.delete(safeId);
}

export function resolveAssistantResponseLanguage(
  message: string,
  fallbackLang: 'th' | 'en' = 'th'
): 'th' | 'en' {
  const trimmed = (message || '').trim();
  if (!trimmed) return fallbackLang;
  if (/[\u0E00-\u0E7F]/.test(trimmed)) return 'th';
  if (/[A-Za-z]{2,}/.test(trimmed)) return 'en';
  return fallbackLang;
}

function buildSystemInstruction(
  ctx: AssistantContextInfo,
  sessionBuffer?: SessionMemoryBuffer,
  brainPacket?: BrainCorePacket,
  responseLang?: 'th' | 'en'
): string {
  const resolvedLang = responseLang || (ctx.lang === 'en' ? 'en' : 'th');
  const langNote =
    resolvedLang === 'th'
      ? 'Respond in clear, structured Thai matching the user language, keeping file names, API paths, variable names, and technical commands in English (supports Thai mixed with English technical terms).'
      : 'Respond in clear, structured English matching the user language, preserving exact file names, API paths, variable names, and technical commands.';

  const moduleState = ctx.moduleState || sessionBuffer?.moduleState;
  const workspaceMetadata = ctx.workspaceMetadata || sessionBuffer?.workspaceMetadata;
  const activeModule = moduleState?.moduleId || ctx.activeModule;

  const moduleNote = activeModule ? `Current active workspace module: ${activeModule}.` : '';
  const roleNote = ctx.role ? `Current user role: ${ctx.role}.` : '';
  const runtimeNote =
    typeof ctx.runtimeReady === 'boolean'
      ? `Native runtime status from UI: ${ctx.runtimeReady ? 'READY' : 'NOT_READY / CHECKING'}.`
      : '';

  const brainPacketNote = brainPacket
    ? [
        `[Assistant Brain Core Cognitive State (${brainPacket.architecture})]`,
        `Cycle: ${brainPacket.cycleId} | Intent: ${brainPacket.intent} (conf ${brainPacket.intentConfidence}) | ProblemClass: ${brainPacket.problemClass} | Strategy: ${brainPacket.strategy}`,
        `Native Core Runtime: ${brainPacket.nativeRuntimeState} (weightsLoaded=${brainPacket.nativeWeightsLoaded})`,
        brainPacket.entities.length > 0 ? `Extracted Entities: ${brainPacket.entities.join(', ')}` : '',
        brainPacket.conflictCount > 0 ? `Context Conflicts Detected: ${brainPacket.conflicts.join('; ')}` : '',
        brainPacket.recalledMemories.length > 0
          ? `Persistent Long-Term Memories Recalled (${brainPacket.recalledMemories.length}):\n${brainPacket.recalledMemories
              .map((m) => `- [${m.category}] ${m.key} (score ${m.score}): ${m.preview}`)
              .join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const moduleStateNote = moduleState
    ? `[Selected Module State (Captured on Assistant Open / Sync)]\n${JSON.stringify(moduleState, null, 2).slice(0, 3500)}`
    : '';

  const workspaceMetaNote = workspaceMetadata
    ? `[Active Workspace Metadata]\n${JSON.stringify(workspaceMetadata, null, 2).slice(0, 3500)}`
    : '';

  const memoryBufferNote =
    sessionBuffer && sessionBuffer.turns.length > 0
      ? [
          `[Short-Term Session Memory Buffer]`,
          `Session ID: ${sessionBuffer.sessionId} (${Math.ceil(sessionBuffer.turns.length / 2)}/${MAX_SHORT_TERM_EXCHANGES} retained exchanges)`,
          sessionBuffer.recentTools.length > 0
            ? `Tools invoked earlier in this session: ${sessionBuffer.recentTools.join(', ')}`
            : '',
          sessionBuffer.referencedEntities.length > 0
            ? `Previously referenced modules/files: ${sessionBuffer.referencedEntities.join(', ')}`
            : '',
          sessionBuffer.lastSummary
            ? `Latest assistant response summary: ${sessionBuffer.lastSummary}`
            : '',
          'Use this single-session conversational buffer to answer follow-up questions referencing earlier responses seamlessly.',
        ]
          .filter(Boolean)
          .join('\n')
      : '';

  const logsNote =
    Array.isArray(ctx.recentLogs) && ctx.recentLogs.length > 0
      ? `Recent execution terminal logs (latest ${Math.min(12, ctx.recentLogs.length)} lines):\n${ctx.recentLogs
          .slice(-12)
          .join('\n')}`
      : '';

  return [
    'You are the upgraded built-in AI Assistant (ผู้ช่วย AI อัจฉริยะ) powered by ZYNTHEOR AssistantBrainCore (แกนสมองผู้ช่วย: CognitiveContextEngine + AdaptiveReasoningEngine + NativeMemoryController + AutonomousPlanner).',
    'You have real server-side tools for Phase 6 Autonomous Execution & Verification: write_workspace_file (write files inside jailed /workspace), run_terminal_command (execute allowlisted python3/node/test commands inside /workspace with no shell), execute_python_sandbox (isolated Python sandbox execution), search_internet (live web search), inspect_workspace_files (list/read /workspace), get_system_telemetry, search_knowledge_hub, inspect_audit_ledger, recall_or_store_assistant_memory, run_adaptive_reasoning, decompose_execution_plan, and propose_ui_action.',
    'When asked to create code, run tests, verify implementations, or research external facts autonomously (with verified developer/operator/admin authorization), follow the write -> run test -> inspect error -> self-repair loop directly using write_workspace_file, run_terminal_command, execute_python_sandbox, and search_internet instead of asking the user to manually copy-paste commands. If RBAC rejects a write/exec tool because the caller is unauthenticated/guest, inform the user clearly without fabricating execution.',
    'When the user asks about current system health, blockers, metrics, audit records, knowledge documents, or workspace files, proactively call the relevant tool instead of guessing.',
    'When a user asks to remember preferences/facts across sessions, or asks complex multi-step engineering/planning/verification questions, use recall_or_store_assistant_memory, run_adaptive_reasoning, or decompose_execution_plan.',
    'When a user wants to open a module or run an agent task, call propose_ui_action so they get a one-click button right inside the assistant response.',
    'When the user asks about the currently selected module or active workspace, cite the live [Selected Module State] and [Active Workspace Metadata] provided below (and call tools if deeper inspection is needed).',
    'Available ZYNTHEOR modules: command_center, conversational_intelligence, intelligence_core, dev_studio, research_lab, automation_center, knowledge_hub, model_laboratory, experiment_center, api_platform, marketplace, subscription_billing, analytics_bi, governance_security, user_settings, admin_console.',
    'Be accurate, grounded in tool evidence, and concise. Never fabricate metrics or claim unverified operations.',
    langNote,
    moduleNote,
    roleNote,
    runtimeNote,
    brainPacketNote,
    moduleStateNote,
    workspaceMetaNote,
    memoryBufferNote,
    logsNote,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function executeLocalTool(
  name: string,
  args: Record<string, unknown>,
  proposedActions: AssistantProposedAction[],
  collectedSources: AssistantGroundingSource[],
  scopeCtx?: { tenantId?: string; role?: string; verifiedCallerRole?: SovereignRole; sessionId?: string }
): Promise<{ ok: boolean; summary: string; data: Record<string, unknown> }> {
  try {
    const verifiedRole: SovereignRole = scopeCtx?.verifiedCallerRole ?? 'guest';
    const taskId = scopeCtx?.sessionId ? `assistant_${scopeCtx.sessionId}` : undefined;
    switch (name) {
      case 'get_system_telemetry': {
        const connectivityState = await ConnectivityMonitor.getInstance().checkNow();
        const snapshot = await buildTruthDashboardSnapshot(connectivityState, {
          wsClientCount: 0,
          wsLastFrameAt: null,
          apiAvgLatencyMs: null,
          apiSampleCount: 0,
          lastRecordedTokensPerSec: null,
          lastInferenceLatencyMs: null,
        });
        const integrity = AuditLedger.verifyIntegrity();
        const includeMetrics = args.includeMetrics !== false;
        const payload = {
          generatedAt: snapshot.generatedAt,
          policy: snapshot.policy,
          systemStatusOverview: snapshot.systemStatusOverview,
          nativeIntelligenceGates: snapshot.nativeIntelligenceGates,
          activeBlockers: snapshot.activeBlockers,
          auditIntegrity: {
            valid: integrity.valid,
            totalRecords: integrity.totalRecords,
            headHash: integrity.headHash,
          },
          ...(includeMetrics
            ? {
                realRuntimeMetrics: snapshot.realRuntimeMetrics,
                executionAndAutonomy: snapshot.executionAndAutonomy,
              }
            : {}),
        };
        return {
          ok: true,
          summary: `${snapshot.systemStatusOverview.length} status items · ${snapshot.activeBlockers.length} blockers`,
          data: payload,
        };
      }

      case 'search_knowledge_hub': {
        const query = String(args.query || '').trim();
        const limit = Math.min(8, Math.max(1, Number(args.limit) || 5));
        const collection = typeof args.collection === 'string' && args.collection.trim() ? args.collection.trim() : undefined;
        const kw = KnowledgeWorkspace.getInstance();
        const stats = kw.getStats();
        const results = query ? kw.retrieve(query, { limit, collection }) : [];
        return {
          ok: true,
          summary: `${results.length} matches across ${stats.totalDocuments} docs`,
          data: {
            stats,
            query,
            results: results.map((r) => ({
              documentTitle: r.documentTitle,
              collection: r.collection,
              score: r.score,
              text: r.text.slice(0, 900),
            })),
          },
        };
      }

      case 'inspect_workspace_files': {
        const action = String(args.action || 'list');
        if (action === 'read') {
          const relPath = String(args.path || '').trim();
          const content = ToolGateway.readFile(relPath);
          const truncated = content.length > 8000 ? `${content.slice(0, 8000)}\n...[truncated]` : content;
          return {
            ok: true,
            summary: `Read ${relPath} (${content.length} chars)`,
            data: { path: relPath, length: content.length, content: truncated },
          };
        }
        const files = ToolGateway.listFiles();
        return {
          ok: true,
          summary: `${files.length} files in /workspace`,
          data: { count: files.length, files: files.slice(0, 100) },
        };
      }

      case 'inspect_audit_ledger': {
        const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));
        const integrity = AuditLedger.verifyIntegrity();
        const recent = AuditLedger.getRecent(limit).map((r) => ({
          index: r.index,
          timestamp: r.timestamp,
          role: r.role,
          action: r.action,
          entryHash: r.entry_hash.slice(0, 16),
          payloadSummary: JSON.stringify(r.payload).slice(0, 220),
        }));
        return {
          ok: true,
          summary: `Chain ${integrity.valid ? 'VALID' : 'INVALID'} · ${recent.length} entries`,
          data: { integrity, recent },
        };
      }

      case 'propose_ui_action': {
        const actionType =
          args.actionType === 'prepare_quick_task' ? 'prepare_quick_task' : 'navigate_module';
        const label = String(args.label || '').trim() || (actionType === 'prepare_quick_task' ? 'Open Quick Task' : 'Open Module');
        if (actionType === 'navigate_module') {
          const moduleId = String(args.moduleId || '').trim();
          if (!VALID_MODULE_IDS.has(moduleId)) {
            return {
              ok: false,
              summary: `Invalid moduleId: ${moduleId}`,
              data: { error: `Unknown moduleId '${moduleId}'.` },
            };
          }
          const action: AssistantProposedAction = { actionType: 'navigate_module', label, moduleId };
          proposedActions.push(action);
          return {
            ok: true,
            summary: `Navigation action ready: ${moduleId}`,
            data: { registered: true, action },
          };
        }

        const taskGoal = String(args.taskGoal || '').trim();
        if (!taskGoal) {
          return {
            ok: false,
            summary: 'Missing taskGoal',
            data: { error: 'taskGoal is required for prepare_quick_task.' },
          };
        }
        const action: AssistantProposedAction = { actionType: 'prepare_quick_task', label, taskGoal };
        proposedActions.push(action);
        return {
          ok: true,
          summary: `Quick Task action ready`,
          data: { registered: true, action },
        };
      }

      case 'recall_or_store_assistant_memory': {
        const action = args.action === 'store' ? 'store' : 'recall';
        const validCats = new Set(['episodic', 'semantic', 'user_preference', 'reasoning_trace', 'task_memory', 'working_context']);
        const rawCat = typeof args.category === 'string' ? args.category.trim() : '';
        const category = validCats.has(rawCat) ? (rawCat as any) : undefined;
        return AssistantBrainCore.getInstance().recallOrStoreMemory({
          action,
          query: typeof args.query === 'string' ? args.query : undefined,
          key: typeof args.key === 'string' ? args.key : undefined,
          value: args.value,
          category,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          tenantId: scopeCtx?.tenantId,
          role: scopeCtx?.role,
        });
      }

      case 'run_adaptive_reasoning': {
        const prompt = String(args.prompt || '').trim();
        if (!prompt) {
          return {
            ok: false,
            summary: 'Missing prompt',
            data: { error: 'prompt is required for run_adaptive_reasoning.' },
          };
        }
        return await AssistantBrainCore.getInstance().executeAdaptiveReasoning({
          prompt,
          tenantId: scopeCtx?.tenantId,
          role: scopeCtx?.role,
          pythonSource: typeof args.pythonSource === 'string' ? args.pythonSource : undefined,
        });
      }

      case 'decompose_execution_plan': {
        const goal = String(args.goal || '').trim();
        if (!goal) {
          return {
            ok: false,
            summary: 'Missing goal',
            data: { error: 'goal is required for decompose_execution_plan.' },
          };
        }
        return AssistantBrainCore.getInstance().decomposeExecutionPlan({
          goal,
          priority: args.priority === 'High' || args.priority === 'Low' ? args.priority : 'Medium',
          runtime: args.runtime === 'python3' ? 'python3' : 'node',
          tenantId: scopeCtx?.tenantId,
          userId: scopeCtx?.role,
        });
      }

      case 'write_workspace_file': {
        const res = await ToolRegistry.getInstance().executeToolCall(
          {
            tool: 'write_file',
            arguments: {
              path: typeof args.path === 'string' ? args.path : '',
              content: typeof args.content === 'string' ? args.content : '',
            },
          },
          { taskId, role: verifiedRole, callerRole: verifiedRole }
        );
        return {
          ok: res.ok,
          summary: res.ok
            ? res.stdout || `Wrote ${String(args.path || '')}`
            : res.error || 'write_workspace_file failed',
          data: {
            ok: res.ok,
            callId: res.callId,
            executionMode: res.executionMode,
            output: res.output,
            stdout: res.stdout,
            error: res.error,
            auditHash: res.auditHash,
          },
        };
      }

      case 'run_terminal_command': {
        const res = await ToolRegistry.getInstance().executeToolCall(
          {
            tool: 'run_command',
            arguments: {
              command: typeof args.command === 'string' ? args.command : '',
              argsString: typeof args.argsString === 'string' ? args.argsString : '',
            },
          },
          { taskId, role: verifiedRole, callerRole: verifiedRole }
        );
        return {
          ok: res.ok,
          summary: res.ok
            ? `${String(args.command || '')} exited 0 (${res.durationMs}ms)`
            : res.error || `Command failed (exit ${res.exitCode ?? 1})`,
          data: {
            ok: res.ok,
            callId: res.callId,
            executionMode: res.executionMode,
            exitCode: res.exitCode,
            stdout: res.stdout,
            stderr: res.stderr,
            error: res.error,
            durationMs: res.durationMs,
            auditHash: res.auditHash,
          },
        };
      }

      case 'execute_python_sandbox': {
        const execArgs: Record<string, unknown> = {
          code: typeof args.code === 'string' ? args.code : '',
        };
        if (typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)) {
          execArgs.timeoutMs = Math.trunc(args.timeoutMs);
        }
        const res = await ToolRegistry.getInstance().executeToolCall(
          { tool: 'execute_python', arguments: execArgs },
          { taskId, role: verifiedRole, callerRole: verifiedRole }
        );
        return {
          ok: res.ok,
          summary: res.ok
            ? `Python ${res.executionMode} succeeded (${res.durationMs}ms)`
            : res.error || `Python execution failed (exit ${res.exitCode ?? 1})`,
          data: {
            ok: res.ok,
            callId: res.callId,
            executionMode: res.executionMode,
            dockerIsolated: res.dockerIsolated,
            exitCode: res.exitCode,
            stdout: res.stdout,
            stderr: res.stderr,
            output: res.output,
            error: res.error,
            durationMs: res.durationMs,
            auditHash: res.auditHash,
          },
        };
      }

      case 'search_internet': {
        const searchArgs: Record<string, unknown> = {
          query: typeof args.query === 'string' ? args.query : '',
        };
        if (typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)) {
          searchArgs.maxResults = Math.trunc(args.maxResults);
        }
        const res = await ToolRegistry.getInstance().executeToolCall(
          { tool: 'web_search', arguments: searchArgs },
          { taskId, role: verifiedRole, callerRole: verifiedRole }
        );
        const out = res.output as { count?: number; results?: Array<{ title: string; url: string; snippet: string }> } | null;
        const items = Array.isArray(out?.results) ? out!.results : [];
        for (const item of items) {
          if (item?.url && /^https?:\/\//i.test(item.url) && !collectedSources.some((s) => s.url === item.url)) {
            collectedSources.push({ title: item.title || item.url, url: item.url });
          }
        }
        return {
          ok: res.ok,
          summary: res.ok
            ? `${items.length} internet results`
            : res.error || 'search_internet failed',
          data: {
            ok: res.ok,
            callId: res.callId,
            executionMode: res.executionMode,
            output: res.output,
            error: res.error,
            auditHash: res.auditHash,
          },
        };
      }

      default:
        return {
          ok: false,
          summary: `Unknown tool ${name}`,
          data: { error: `Tool '${name}' is not supported.` },
        };
    }
  } catch (err: any) {
    return {
      ok: false,
      summary: err?.message || 'Tool execution error',
      data: { error: err?.message || 'Tool execution error' },
    };
  }
}

function formatAssistantError(err: any, lang: 'th' | 'en'): Error {
  const raw = String(err?.message || err || 'Native Cloud Runtime request failed.');
  const status = typeof err?.status === 'number' ? err.status : 0;

  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    return new Error(
      lang === 'th'
        ? 'โควตาการเชื่อมต่อปลายทางเต็มชั่วคราว (429 RESOURCE_EXHAUSTED)'
        : 'Upstream runtime quota exceeded (429 RESOURCE_EXHAUSTED).'
    );
  }
  if (status === 403 || /PERMISSION_DENIED/i.test(raw)) {
    return new Error(
      lang === 'th'
        ? 'ไม่มีสิทธิ์เข้าถึง Cloud Object Storage หรือ Cloud Runtime (403 PERMISSION_DENIED)'
        : 'Permission denied accessing Cloud Object Storage or Cloud Runtime (403).'
    );
  }
  if (status === 404 || /NOT_FOUND/i.test(raw)) {
    return new Error(
      lang === 'th'
        ? 'ไม่พบไฟล์ Checkpoint หรือปลายทาง Cloud Runtime ที่ระบุ (404 NOT_FOUND)'
        : 'Configured checkpoint or Cloud Runtime endpoint was not found (404 NOT_FOUND).'
    );
  }
  return new Error(raw);
}

export async function runUpgradedAssistant(params: {
  sessionId?: string;
  message: string;
  history?: AssistantHistoryTurn[];
  attachments?: AssistantAttachment[];
  context?: AssistantContextInfo;
  verifiedCallerRole?: SovereignRole;
  moduleState?: AssistantModuleState;
  workspaceMetadata?: AssistantWorkspaceMetadata;
  thinkingMode?: AssistantThinkingMode;
  webGrounding?: boolean;
  onEvent: (event: AssistantStreamEvent) => void;
}): Promise<string> {
  const fallbackLang: 'th' | 'en' = params.context?.lang === 'en' ? 'en' : 'th';
  const initialLang = resolveAssistantResponseLanguage(params.message || '', fallbackLang);
  const monitor = ConnectivityMonitor.getInstance();
  const conn = await monitor.checkNow();
  const provider = NativeNeuralLMProvider.getInstance();
  const pingSnap = monitor.getLastPingResult() || (await provider.ping().catch(() => null));

  if (!conn.online || !conn.weightsLoaded || !pingSnap?.inference_ready) {
    const isPrivileged =
      params.verifiedCallerRole === 'developer' ||
      params.verifiedCallerRole === 'admin' ||
      params.verifiedCallerRole === 'operator';
    if (!isPrivileged) {
      throw new Error(
        initialLang === 'th'
          ? 'โมเดลยังไม่พร้อม ทีมงานกำลังตั้งค่า — ระหว่างนี้สามารถส่งคำสั่งเป็นงานให้ Action-Driven Engine เพื่อสร้างไฟล์และรันเทสต์ได้'
          : 'Model is not ready yet while setup is in progress — you can dispatch your prompt as an Action-Driven Engine task instead.'
      );
    }
    const reason =
      conn.reason ||
      pingSnap?.readiness_reason ||
      'No Cloud Object Storage (CHECKPOINT_PRESIGNED_URL / S3_BUCKET) or CLOUD_RUNTIME_URL configured';
    throw new Error(
      initialLang === 'th'
        ? `FAIL_CLOSED: ยังไม่พร้อมประมวลผลเพราะยังไม่ได้เชื่อมต่อ Cloud Object Storage / Cloud Runtime และโหลด Checkpoint จริง (${reason})`
        : `FAIL_CLOSED: Native checkpoint is not loaded on the server (${reason}). Configure CHECKPOINT_PRESIGNED_URL, S3_BUCKET credentials, or CLOUD_RUNTIME_URL and connect a verified .pt checkpoint.`
    );
  }

  const resolvedSessionId = sanitizeSessionId(params.sessionId || params.context?.sessionId);
  const sessionBuffer = getOrCreateSessionBuffer(resolvedSessionId);

  const mergedModuleState = params.moduleState || params.context?.moduleState || sessionBuffer.moduleState;
  const mergedWorkspaceMeta =
    params.workspaceMetadata || params.context?.workspaceMetadata || sessionBuffer.workspaceMetadata;

  syncAssistantSessionContext(resolvedSessionId, {
    moduleState: mergedModuleState,
    workspaceMetadata: mergedWorkspaceMeta,
    context: params.context,
  });

  const mergedContext: AssistantContextInfo = {
    ...sessionBuffer.lastContext,
    ...params.context,
    sessionId: resolvedSessionId,
    moduleState: mergedModuleState,
    workspaceMetadata: mergedWorkspaceMeta,
  };

  const clientHistory = (params.history || [])
    .filter((h) => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string' && h.text.trim())
    .slice(-MAX_SHORT_TERM_MESSAGES);

  // Reconcile server short-term memory buffer with client history (supports server-only follow-ups & restart recovery)
  if (sessionBuffer.turns.length === 0 && clientHistory.length > 0) {
    const nowIso = new Date().toISOString();
    sessionBuffer.turns = clientHistory.map((h) => ({
      role: h.role,
      text: h.text,
      timestamp: nowIso,
      activeModule: mergedModuleState?.moduleId || mergedContext.activeModule,
    }));
  } else if (clientHistory.length > sessionBuffer.turns.length) {
    const nowIso = new Date().toISOString();
    sessionBuffer.turns = clientHistory.map((h) => ({
      role: h.role,
      text: h.text,
      timestamp: nowIso,
      activeModule: mergedModuleState?.moduleId || mergedContext.activeModule,
    }));
  }

  const effectiveHistory = sessionBuffer.turns.slice(-MAX_SHORT_TERM_MESSAGES);

  const lang = resolveAssistantResponseLanguage(
    params.message || '',
    mergedContext.lang === 'en' ? 'en' : 'th'
  );
  const startedAtMs = Date.now();
  const tenantId = mergedWorkspaceMeta?.tenantId || 'zyntheor-default';

  params.onEvent({
    type: 'status',
    phase: 'perceiving',
    label:
      lang === 'th'
        ? 'แกนสมองผู้ช่วยกำลังวิเคราะห์บริบทและความจำ...'
        : 'Assistant Brain Core perceiving context & memory...',
  });

  const brainPacket = await AssistantBrainCore.getInstance().perceiveAndPrepare({
    sessionId: resolvedSessionId,
    message: params.message,
    activeModule: mergedModuleState?.moduleId || mergedContext.activeModule,
    tenantId,
    role: mergedContext.role,
    shortTermSummary: sessionBuffer.lastSummary,
  });

  params.onEvent({
    type: 'brain_core',
    packet: brainPacket,
  });

  const systemInstruction = buildSystemInstruction(mergedContext, sessionBuffer, brainPacket, lang);
  const thinkingLevel = resolveThinkingLevel(params.thinkingMode);

  const contents: Content[] = effectiveHistory.map((h) => ({
    role: h.role,
    parts: [{ text: h.text }],
  }));

  const userParts: Part[] = [];
  if (Array.isArray(params.attachments)) {
    for (const att of params.attachments.slice(0, 4)) {
      if (!att || typeof att.name !== 'string') continue;
      if (typeof att.textContent === 'string' && att.textContent.trim()) {
        userParts.push({
          text: `[Attached file: ${att.name}]\n\`\`\`\n${att.textContent.slice(0, 12000)}\n\`\`\``,
        });
      } else if (
        typeof att.dataBase64 === 'string' &&
        att.dataBase64 &&
        typeof att.mimeType === 'string' &&
        att.mimeType
      ) {
        userParts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.dataBase64,
          },
        });
      }
    }
  }
  userParts.push({ text: params.message });
  contents.push({ role: 'user', parts: userParts });

  const hasUrlInMessage = /https?:\/\/\S+/i.test(params.message);
  const useHybridBuiltIns = Boolean(params.webGrounding);

  const tools: Array<Record<string, unknown>> = [
    ...(useHybridBuiltIns ? [{ zyntheorSearch: {} }] : []),
    ...(useHybridBuiltIns && hasUrlInMessage ? [{ urlContext: {} }] : []),
    { functionDeclarations: ASSISTANT_FUNCTION_DECLARATIONS },
  ];

  const config: Record<string, unknown> = {
    systemInstruction,
    thinkingConfig: { thinkingLevel },
    tools,
    ...(useHybridBuiltIns ? { toolConfig: { includeServerSideToolInvocations: true } } : {}),
  };

  const kw = KnowledgeWorkspace.getInstance();
  const retrievedChunks = kw.retrieve(params.message, { limit: 2 });
  let effectivePrompt = params.message;
  if (retrievedChunks.length > 0) {
    const contextPassages = retrievedChunks
      .map((c) => `[DOCUMENT: "${c.documentTitle}" (Collection: ${c.collection})]\n${c.text}`)
      .join('\n\n');
    effectivePrompt = `[KNOWLEDGE_WORKSPACE_GROUNDING_PASSAGES]:\n${contextPassages}\n\n[USER_QUERY]:\n${params.message}`;
  }

  params.onEvent({
    type: 'status',
    phase: 'thinking',
    label:
      lang === 'th'
        ? thinkingLevel === ThinkingLevel.XHIGH
          ? 'กำลังประมวลผลด้วย Native Runtime เชิงลึก...'
          : 'กำลังประมวลผลด้วย Native Runtime...'
        : thinkingLevel === ThinkingLevel.XHIGH
        ? 'Deep reasoning on Native Runtime...'
        : 'Processing on Native Runtime...',
  });

  const proposedActions: AssistantProposedAction[] = [];
  const collectedSources: AssistantGroundingSource[] = [];
  const toolsUsed = new Set<string>();
  let finalText = '';

  try {
    await provider.chatStream(effectivePrompt, 'chat', (chunk) => {
      finalText += chunk;
      params.onEvent({ type: 'chunk', text: chunk });
    });
  } catch (err: any) {
    throw formatAssistantError(err, lang);
  }

  finalText = finalText.trim();
  if (!finalText) {
    finalText =
      lang === 'th'
        ? 'การประมวลผลผ่าน Native Runtime เสร็จสิ้น แต่ไม่มีข้อความตอบกลับ'
        : 'Native Runtime completed with no text output.';
    params.onEvent({ type: 'chunk', text: finalText });
  }

  const turnTimestamp = new Date().toISOString();
  const usedToolsList = Array.from(toolsUsed);
  const userSummaryText = params.attachments && params.attachments.length > 0
    ? `${params.message} [Attachments: ${params.attachments.map((a) => a.name).join(', ')}]`
    : params.message;

  sessionBuffer.turns.push(
    {
      role: 'user',
      text: userSummaryText,
      timestamp: turnTimestamp,
      activeModule: mergedModuleState?.moduleId || mergedContext.activeModule,
    },
    {
      role: 'model',
      text: finalText,
      timestamp: new Date().toISOString(),
      toolsUsed: usedToolsList.length > 0 ? usedToolsList : undefined,
      activeModule: mergedModuleState?.moduleId || mergedContext.activeModule,
    }
  );
  if (sessionBuffer.turns.length > MAX_SHORT_TERM_MESSAGES) {
    sessionBuffer.turns = sessionBuffer.turns.slice(-MAX_SHORT_TERM_MESSAGES);
  }
  if (usedToolsList.length > 0) {
    sessionBuffer.recentTools = Array.from(new Set([...sessionBuffer.recentTools, ...usedToolsList])).slice(-12);
  }
  const entities = extractReferencedEntities(`${userSummaryText}\n${finalText}`);
  if (entities.length > 0) {
    sessionBuffer.referencedEntities = Array.from(
      new Set([...sessionBuffer.referencedEntities, ...entities])
    ).slice(-16);
  }
  sessionBuffer.lastSummary = finalText.replace(/\s+/g, ' ').trim().slice(0, 220);
  sessionBuffer.updatedAt = new Date().toISOString();

  const brainTrace = AssistantBrainCore.getInstance().recordEpisode({
    packet: brainPacket,
    sessionId: sessionBuffer.sessionId,
    userMessage: userSummaryText,
    assistantResponse: finalText,
    toolsUsed: usedToolsList,
    startedAtMs,
  });

  params.onEvent({
    type: 'done',
    text: finalText,
    sources: collectedSources.length > 0 ? collectedSources : undefined,
    actions: proposedActions.length > 0 ? proposedActions : undefined,
    toolsUsed: usedToolsList.length > 0 ? usedToolsList : undefined,
    sessionId: sessionBuffer.sessionId,
    memoryTurns: sessionBuffer.turns.length,
    memoryExchanges: Math.ceil(sessionBuffer.turns.length / 2),
    maxMemoryExchanges: MAX_SHORT_TERM_EXCHANGES,
    brainTrace,
  });

  return finalText;
}
