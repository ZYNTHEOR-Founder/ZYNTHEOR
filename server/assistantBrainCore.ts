import { CognitiveContextEngine } from '../lib/CognitiveContextEngine';
import {
  AdaptiveReasoningEngine,
  type ProblemClass,
  type ReasoningStrategyId,
} from '../lib/AdaptiveReasoningEngine';
import {
  NativeMemoryController,
  type MemoryCategory,
  type MemoryScope,
} from '../lib/NativeMemoryController';
import { AutonomousPlanner } from '../lib/AutonomousPlanner';
import { ConnectivityMonitor } from '../lib/ConnectivityMonitor';

export interface BrainRecalledMemory {
  key: string;
  category: MemoryCategory;
  score: number;
  preview: string;
  updatedAt: string;
}

export interface BrainCorePacket {
  cycleId: string;
  architecture: string;
  timestamp: string;
  intent: string;
  intentConfidence: number;
  language: 'th' | 'en' | 'mixed';
  problemClass: ProblemClass;
  strategy: ReasoningStrategyId;
  entities: string[];
  conflictCount: number;
  conflicts: string[];
  recalledMemories: BrainRecalledMemory[];
  nativeRuntimeState: string;
  nativeWeightsLoaded: boolean;
  activeModule?: string;
  tenantId: string;
}

export interface BrainCycleTrace {
  cycleId: string;
  timestamp: string;
  sessionId: string;
  intent: string;
  problemClass: ProblemClass;
  strategy: ReasoningStrategyId;
  recalledCount: number;
  toolsUsed: string[];
  memoryCommitted: boolean;
  activeModule?: string;
  durationMs: number;
}

export interface AssistantBrainStatus {
  active: boolean;
  architecture: string;
  modelSlot: string;
  subsystems: {
    perception: string;
    reasoning: string;
    memory: string;
    planner: string;
  };
  metrics: {
    totalCycles: number;
    memoriesRecalled: number;
    memoriesCommitted: number;
    reasoningCalls: number;
    plansDecomposed: number;
    lastCycleAt: string | null;
    strategyCounts: Record<string, number>;
    intentCounts: Record<string, number>;
  };
  memoryStore: {
    totalEpisodicItems: number;
    storeSizeBytes: number;
    categories: Record<string, number>;
    lastPersisted: string;
  };
  lastPacket: BrainCorePacket | null;
  recentCycles: BrainCycleTrace[];
}

export class AssistantBrainCore {
  private static instance: AssistantBrainCore | null = null;

  private totalCycles = 0;
  private memoriesRecalled = 0;
  private memoriesCommitted = 0;
  private reasoningCalls = 0;
  private plansDecomposed = 0;
  private lastCycleAt: string | null = null;
  private lastPacket: BrainCorePacket | null = null;
  private strategyCounts: Record<string, number> = {};
  private intentCounts: Record<string, number> = {};
  private recentCycles: BrainCycleTrace[] = [];

  private constructor() {}

  public static getInstance(): AssistantBrainCore {
    if (!AssistantBrainCore.instance) {
      AssistantBrainCore.instance = new AssistantBrainCore();
    }
    return AssistantBrainCore.instance;
  }

  public async perceiveAndPrepare(params: {
    sessionId: string;
    message: string;
    activeModule?: string;
    tenantId?: string;
    role?: string;
    shortTermSummary?: string;
  }): Promise<BrainCorePacket> {
    const tenantId = (params.tenantId || 'zyntheor-default').trim() || 'zyntheor-default';
    const conn = await ConnectivityMonitor.getInstance().getStatus().catch(() => null);
    const nativeState: 'READY' | 'BLOCKED' | 'UNINVOKED' = conn?.weightsLoaded
      ? 'READY'
      : conn
      ? 'BLOCKED'
      : 'UNINVOKED';

    const cognitive = CognitiveContextEngine.getInstance();
    const analysisInput = params.shortTermSummary
      ? `${params.message}\n[Recent context]: ${params.shortTermSummary}`
      : params.message;
    const analysis = cognitive.analyzeContext({
      input: analysisInput,
      query: params.message,
      nativeNeuralState: nativeState,
    });

    const adaptive = AdaptiveReasoningEngine.getInstance();
    const problemClass = adaptive.classifyProblem(params.message);
    const strategy = adaptive.selectStrategy(problemClass, false);

    const scope: MemoryScope = {
      tenantId,
      role: params.role || 'user',
    };

    let recalledMemories: BrainRecalledMemory[] = [];
    try {
      const matches = NativeMemoryController.getInstance().recallRankedMemories(params.message, {
        limit: 4,
        scope,
      });
      recalledMemories = matches.map(({ item, score }) => ({
        key: item.key,
        category: item.category,
        score,
        preview: (typeof item.value === 'string' ? item.value : JSON.stringify(item.value)).slice(0, 240),
        updatedAt: item.updatedAt,
      }));
    } catch {
      recalledMemories = [];
    }

    const cycleId = `brain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const packet: BrainCorePacket = {
      cycleId,
      architecture: 'ZYNTHEOR-AssistantBrainCore-v1',
      timestamp: now,
      intent: analysis.intent.primary,
      intentConfidence: Number(analysis.intent.confidence.toFixed(2)),
      language: analysis.language,
      problemClass,
      strategy,
      entities: analysis.entities.slice(0, 10).map((e) => e.text),
      conflictCount: analysis.conflicts.length,
      conflicts: analysis.conflicts.slice(0, 4).map((c) => `${c.kind}: ${c.description}`),
      recalledMemories,
      nativeRuntimeState: conn?.runtimeState || 'NOT_CONFIGURED',
      nativeWeightsLoaded: Boolean(conn?.weightsLoaded),
      activeModule: params.activeModule,
      tenantId,
    };

    this.totalCycles += 1;
    this.memoriesRecalled += recalledMemories.length;
    this.lastCycleAt = now;
    this.lastPacket = packet;
    this.strategyCounts[strategy] = (this.strategyCounts[strategy] || 0) + 1;
    this.intentCounts[analysis.intent.primary] = (this.intentCounts[analysis.intent.primary] || 0) + 1;

    return packet;
  }

  public recallOrStoreMemory(params: {
    action: 'recall' | 'store';
    query?: string;
    key?: string;
    value?: unknown;
    category?: MemoryCategory;
    limit?: number;
    tenantId?: string;
    role?: string;
  }): { ok: boolean; summary: string; data: Record<string, unknown> } {
    const controller = NativeMemoryController.getInstance();
    const tenantId = (params.tenantId || 'zyntheor-default').trim() || 'zyntheor-default';
    const scope: MemoryScope = { tenantId, role: params.role || 'assistant' };

    if (params.action === 'store') {
      const memKey =
        (params.key || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 96) ||
        `asst_mem_${Date.now().toString(36)}`;
      const category: MemoryCategory = params.category || 'episodic';
      const val = params.value ?? params.query ?? '';
      if (!val || (typeof val === 'string' && !val.trim())) {
        return {
          ok: false,
          summary: 'Missing memory value to store',
          data: { error: 'value is required when action is "store".' },
        };
      }
      const res = controller.storeWithConflictResolution(memKey, val, category, 'overwrite', {
        scope,
      });
      this.memoriesCommitted += 1;
      return {
        ok: true,
        summary: `Committed '${memKey}' (${category}, v${res.item.version})`,
        data: {
          stored: res.stored,
          key: res.item.key,
          category: res.item.category,
          version: res.item.version,
          conflictResolution: res.conflict.resolution,
        },
      };
    }

    const query = (params.query || '').trim();
    const limit = Math.min(10, Math.max(1, Number(params.limit) || 5));
    const hits = controller.recallRankedMemories(query, {
      limit,
      category: params.category,
      scope,
    });
    this.memoriesRecalled += hits.length;
    return {
      ok: true,
      summary: `${hits.length} persistent memories recalled`,
      data: {
        query,
        count: hits.length,
        memories: hits.map(({ item, score }) => ({
          key: item.key,
          category: item.category,
          score,
          version: item.version,
          updatedAt: item.updatedAt,
          value: typeof item.value === 'string' ? item.value.slice(0, 600) : item.value,
        })),
      },
    };
  }

  public async executeAdaptiveReasoning(params: {
    prompt: string;
    tenantId?: string;
    role?: string;
    mathSteps?: Array<{ expr: string; claimed?: number }>;
    expectedFinal?: number;
    pythonSource?: string;
  }): Promise<{ ok: boolean; summary: string; data: Record<string, unknown> }> {
    this.reasoningCalls += 1;
    const outcome = await AdaptiveReasoningEngine.getInstance().executeReasoning({
      prompt: params.prompt,
      scope: {
        tenantId: params.tenantId || 'zyntheor-default',
        role: params.role || 'assistant',
      },
      mathSteps: params.mathSteps,
      expectedFinal: params.expectedFinal,
      pythonSource: params.pythonSource,
    });

    return {
      ok: true,
      summary: `${outcome.selectedStrategy} · ${outcome.verified ? 'VERIFIED' : 'ANALYZED'} (${Math.round(
        outcome.uncertainty.calibratedConfidence * 100
      )}%)`,
      data: {
        reasoningId: outcome.reasoningId,
        problemClass: outcome.problemClass,
        selectedStrategy: outcome.selectedStrategy,
        revisedToStrategy: outcome.revisedToStrategy,
        verified: outcome.verified,
        confidence: outcome.uncertainty.calibratedConfidence,
        abstentionRecommended: outcome.uncertainty.abstentionRecommended,
        answer: outcome.answerSummary,
        verifierAttribution: outcome.reasoningMetadata.verifierAttribution,
        winningHypothesis: outcome.winningHypothesis?.summary,
        hypothesesCount: outcome.hypothesesEvaluated,
        durationMs: outcome.reasoningMetadata.durationMs,
      },
    };
  }

  public decomposeExecutionPlan(params: {
    goal: string;
    priority?: 'Low' | 'Medium' | 'High';
    runtime?: 'node' | 'python3';
    tenantId?: string;
    userId?: string;
  }): { ok: boolean; summary: string; data: Record<string, unknown> } {
    this.plansDecomposed += 1;
    const taskId = `asst_plan_${Date.now().toString(36)}`;
    const plan = AutonomousPlanner.getInstance().decomposeGoal({
      taskId,
      goal: params.goal,
      priority: params.priority === 'High' || params.priority === 'Low' ? params.priority : 'Medium',
      runtime: params.runtime === 'python3' ? 'python3' : 'node',
      tenantId: params.tenantId || 'zyntheor-default',
      ownerUserId: params.userId || 'assistant-brain-core',
    });

    return {
      ok: true,
      summary: `${plan.steps.length}-stage DAG plan (${plan.runtime})`,
      data: {
        taskId: plan.taskId,
        goal: plan.goal,
        runtime: plan.runtime,
        status: plan.status,
        steps: plan.steps.map((s) => ({
          id: s.id,
          stage: s.stage,
          title: s.title,
          dependsOn: s.dependsOn,
          tool: s.tool,
        })),
      },
    };
  }

  public recordEpisode(params: {
    packet: BrainCorePacket;
    sessionId: string;
    userMessage: string;
    assistantResponse: string;
    toolsUsed: string[];
    startedAtMs: number;
  }): BrainCycleTrace {
    let memoryCommitted = false;
    const shouldPersistLesson =
      params.toolsUsed.length > 0 &&
      params.assistantResponse.trim().length >= 40 &&
      !params.toolsUsed.every((t) => t === 'propose_ui_action');

    if (shouldPersistLesson) {
      try {
        const memKey = `brain_episode_${params.packet.intent}_${params.packet.cycleId}`;
        NativeMemoryController.getInstance().storeMemory(
          memKey,
          {
            query: params.userMessage.slice(0, 280),
            resolution: params.assistantResponse.replace(/\s+/g, ' ').trim().slice(0, 420),
            strategy: params.packet.strategy,
            toolsUsed: params.toolsUsed,
            activeModule: params.packet.activeModule || null,
          },
          'reasoning_trace',
          {
            sessionId: params.sessionId,
            cycleId: params.packet.cycleId,
            intent: params.packet.intent,
          },
          {
            scope: { tenantId: params.packet.tenantId, role: 'assistant' },
            ttlSeconds: 60 * 60 * 24 * 14,
          }
        );
        this.memoriesCommitted += 1;
        memoryCommitted = true;
      } catch {
        memoryCommitted = false;
      }
    }

    const trace: BrainCycleTrace = {
      cycleId: params.packet.cycleId,
      timestamp: new Date().toISOString(),
      sessionId: params.sessionId,
      intent: params.packet.intent,
      problemClass: params.packet.problemClass,
      strategy: params.packet.strategy,
      recalledCount: params.packet.recalledMemories.length,
      toolsUsed: params.toolsUsed,
      memoryCommitted,
      activeModule: params.packet.activeModule,
      durationMs: Math.max(1, Date.now() - params.startedAtMs),
    };

    this.recentCycles = [trace, ...this.recentCycles].slice(0, 20);
    return trace;
  }

  public getBrainStatus(): AssistantBrainStatus {
    const stats = NativeMemoryController.getInstance().getStats();
    return {
      active: true,
      architecture: 'ZYNTHEOR-AssistantBrainCore-v1',
      modelSlot: 'gemini-4-hydrogen + ZYNTHEOR Cognitive Core',
      subsystems: {
        perception: 'CognitiveContextEngine (Intent / Entities / Conflict Detector)',
        reasoning: 'AdaptiveReasoningEngine (Symbolic / CSP / AST / Multi-Hop RAG)',
        memory: 'NativeMemoryController (Persistent Episodic & Reasoning Trace)',
        planner: 'AutonomousPlanner (DAG Goal Decomposition)',
      },
      metrics: {
        totalCycles: this.totalCycles,
        memoriesRecalled: this.memoriesRecalled,
        memoriesCommitted: this.memoriesCommitted,
        reasoningCalls: this.reasoningCalls,
        plansDecomposed: this.plansDecomposed,
        lastCycleAt: this.lastCycleAt,
        strategyCounts: { ...this.strategyCounts },
        intentCounts: { ...this.intentCounts },
      },
      memoryStore: {
        totalEpisodicItems: stats.totalItems,
        storeSizeBytes: stats.storeSizeBytes,
        categories: stats.totalCategories,
        lastPersisted: stats.lastPersisted,
      },
      lastPacket: this.lastPacket,
      recentCycles: this.recentCycles.slice(0, 8),
    };
  }
}
