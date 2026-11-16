import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger';
import {
  NativeMemoryController,
  type EpisodicMemoryItem,
  type MemoryCategory,
  type MemoryScope,
} from './NativeMemoryController';
import { AutonomousPlanner, type PlanStep } from './AutonomousPlanner';
import { CognitiveContextEngine } from './CognitiveContextEngine';
import {
  AdaptiveReasoningEngine,
  type ProblemClass,
  type ReasoningStrategyId,
} from './AdaptiveReasoningEngine';
import { ConnectivityMonitor } from './ConnectivityMonitor';

export type CognitiveMode = 'analytical' | 'autonomous' | 'creative' | 'guarded';

export type RecursiveNodeStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED' | 'FAILED';

export interface CognitiveStateCheckpoint {
  checkpointId: string;
  label: string;
  createdAt: string;
  mode: CognitiveMode;
  activeFocus: string;
  workingHypothesis: string;
  stateDigestSha256: string;
  continuityCounter: number;
  memoryKey: string;
}

export interface PersistentCognitiveState {
  tenantId: string;
  mode: CognitiveMode;
  activeFocus: string;
  workingHypothesis: string;
  maxRecursionDepth: number;
  autoConsolidate: boolean;
  confidenceThreshold: number;
  pinnedDirectives: string[];
  continuityCounter: number;
  stateDigestSha256: string;
  lastHydratedAt: string;
  lastPersistedAt: string;
  checkpoints: CognitiveStateCheckpoint[];
}

export interface RecursiveTaskNode {
  nodeId: string;
  parentId: string | null;
  depth: number;
  order: number;
  title: string;
  stage: string;
  problemClass: ProblemClass;
  strategy: ReasoningStrategyId;
  dependsOn: string[];
  acceptanceGate: string;
  status: RecursiveNodeStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  children: RecursiveTaskNode[];
}

export interface RecursivePlanRecord {
  planId: string;
  linkedTaskId: string;
  tenantId: string;
  ownerUserId: string;
  goal: string;
  priority: 'Low' | 'Medium' | 'High';
  runtime: 'node' | 'python3';
  maxDepth: number;
  branchFactor: number;
  status: 'ACTIVE' | 'COMPLETED' | 'BLOCKED' | 'FAILED';
  totalNodes: number;
  completedNodes: number;
  realizedDepth: number;
  createdAt: string;
  updatedAt: string;
  root: RecursiveTaskNode;
}

export interface CognitiveCoreMemoryItemSummary {
  key: string;
  category: MemoryCategory;
  score?: number;
  version: number;
  readCount: number;
  importanceScore: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  contentDigest: string;
  preview: string;
  value: unknown;
}

export interface CognitiveCoreMemoryOverview {
  totalItems: number;
  scopedItemsCount: number;
  storeSizeBytes: number;
  lastPersisted: string;
  categories: Record<string, number>;
  integrity: {
    valid: boolean;
    corruptedCount: number;
    storeSha256: string;
    checkedAt: string;
  };
  lifecycle: {
    expiringSoonCount: number;
    nearDuplicatesCount: number;
    consolidationSnapshotsCount: number;
  };
  items: CognitiveCoreMemoryItemSummary[];
}

export interface CognitiveCoreSnapshot {
  architecture: string;
  state: PersistentCognitiveState;
  neuralBridge: {
    online: boolean;
    runtimeState: string;
    weightsLoaded: boolean;
    executionVerified: boolean;
    reason: string;
    checkpointSha256: string | null;
  };
  memory: CognitiveCoreMemoryOverview;
  plans: RecursivePlanRecord[];
  planMetrics: {
    totalPlans: number;
    activePlans: number;
    completedPlans: number;
    totalNodes: number;
    completedNodes: number;
  };
}

interface CognitiveCoreDiskStore {
  version: string;
  updatedAt: string;
  states: Record<string, PersistentCognitiveState>;
  plans: Record<string, RecursivePlanRecord>;
}

const VALID_MODES = new Set<CognitiveMode>(['analytical', 'autonomous', 'creative', 'guarded']);
const VALID_CATEGORIES = new Set<MemoryCategory>([
  'working_context',
  'episodic',
  'semantic',
  'reasoning_trace',
  'task_memory',
  'user_preference',
]);
const VALID_NODE_STATUS = new Set<RecursiveNodeStatus>([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'BLOCKED',
  'FAILED',
]);

function resolveCognitiveStoreFile(): string {
  if (process.env.ZYNTHEOR_COGNITIVE_CORE_FILE) {
    return path.resolve(process.env.ZYNTHEOR_COGNITIVE_CORE_FILE);
  }
  return path.resolve(process.cwd(), 'native_data', 'cognitive_core_state.json');
}

function computeStateDigest(state: Omit<PersistentCognitiveState, 'stateDigestSha256'>): string {
  const canonical = JSON.stringify({
    tenantId: state.tenantId,
    mode: state.mode,
    activeFocus: state.activeFocus,
    workingHypothesis: state.workingHypothesis,
    maxRecursionDepth: state.maxRecursionDepth,
    autoConsolidate: state.autoConsolidate,
    confidenceThreshold: state.confidenceThreshold,
    pinnedDirectives: state.pinnedDirectives,
    continuityCounter: state.continuityCounter,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function formatMemoryItem(item: EpisodicMemoryItem, score?: number): CognitiveCoreMemoryItemSummary {
  const rawStr = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
  return {
    key: item.key,
    category: item.category,
    ...(score !== undefined ? { score } : {}),
    version: item.version,
    readCount: item.readCount,
    importanceScore: item.importanceScore,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    expiresAt: item.expiresAt,
    contentDigest: item.contentDigest,
    preview: String(rawStr || '').slice(0, 220),
    value: item.value,
  };
}

function summarizeTreeStats(root: RecursiveTaskNode): {
  totalNodes: number;
  completedNodes: number;
  realizedDepth: number;
} {
  let totalNodes = 0;
  let completedNodes = 0;
  let realizedDepth = 0;

  const walk = (node: RecursiveTaskNode) => {
    totalNodes += 1;
    if (node.status === 'COMPLETED') completedNodes += 1;
    if (node.depth > realizedDepth) realizedDepth = node.depth;
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(root);
  return { totalNodes, completedNodes, realizedDepth };
}

function flattenTreeStepsForDag(root: RecursiveTaskNode): PlanStep[] {
  const steps: PlanStep[] = [];
  const walk = (node: RecursiveTaskNode) => {
    const deps: string[] = [];
    if (node.parentId) deps.push(node.parentId);
    for (const dep of node.dependsOn) {
      if (!deps.includes(dep)) deps.push(dep);
    }
    steps.push({
      id: node.nodeId,
      title: node.title.slice(0, 120),
      stage: node.stage,
      dependsOn: deps.filter((d) => steps.some((s) => s.id === d)),
      priority: Math.min(10, Math.max(1, node.depth + 1)),
      estimatedMs: 250 + node.depth * 150,
      status: node.status === 'BLOCKED' ? 'SKIPPED' : node.status,
      attempts: node.status === 'PENDING' ? 0 : 1,
    });
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(root);
  return steps;
}

export class CognitiveCore {
  private static instance: CognitiveCore | null = null;
  private loadedPath: string;
  private diskStore: CognitiveCoreDiskStore;

  private constructor() {
    this.loadedPath = resolveCognitiveStoreFile();
    this.diskStore = this.loadFromDisk(this.loadedPath);
  }

  public static getInstance(): CognitiveCore {
    if (!CognitiveCore.instance) {
      CognitiveCore.instance = new CognitiveCore();
    }
    return CognitiveCore.instance;
  }

  private ensureSynced(): void {
    const target = resolveCognitiveStoreFile();
    if (target !== this.loadedPath) {
      this.loadedPath = target;
      this.diskStore = this.loadFromDisk(target);
    }
  }

  private loadFromDisk(filePath: string): CognitiveCoreDiskStore {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          return {
            version: parsed.version || '1.0.0',
            updatedAt: parsed.updatedAt || new Date().toISOString(),
            states: parsed.states || {},
            plans: parsed.plans || {},
          };
        }
      } catch {
        // reset malformed store gracefully
      }
    }
    const fresh: CognitiveCoreDiskStore = {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      states: {},
      plans: {},
    };
    this.persistToDisk(fresh, filePath);
    return fresh;
  }

  private persistToDisk(data: CognitiveCoreDiskStore, targetPath?: string): void {
    const filePath = targetPath || resolveCognitiveStoreFile();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    data.updatedAt = new Date().toISOString();
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  private createDefaultState(tenantId: string): PersistentCognitiveState {
    const now = new Date().toISOString();
    const base: Omit<PersistentCognitiveState, 'stateDigestSha256'> = {
      tenantId,
      mode: 'analytical',
      activeFocus: 'Maintain grounded multi-step reasoning and persistent cross-session continuity.',
      workingHypothesis:
        'Combining persistent long-term memory buffers with recursive goal decomposition lowers multi-stage reasoning drift.',
      maxRecursionDepth: 3,
      autoConsolidate: true,
      confidenceThreshold: 0.7,
      pinnedDirectives: [
        'Preserve fail-closed runtime integrity when Cloud weights are offline.',
        'Record verified resolutions into long-term episodic and reasoning memory.',
      ],
      continuityCounter: 1,
      lastHydratedAt: now,
      lastPersistedAt: now,
      checkpoints: [],
    };
    return {
      ...base,
      stateDigestSha256: computeStateDigest(base),
    };
  }

  public getState(tenantId = 'default-tenant'): PersistentCognitiveState {
    this.ensureSynced();
    const normalizedTenant = tenantId.trim() || 'default-tenant';
    let state = this.diskStore.states[normalizedTenant];
    if (!state) {
      state = this.createDefaultState(normalizedTenant);
      this.diskStore.states[normalizedTenant] = state;
      this.persistToDisk(this.diskStore);
    } else {
      state.lastHydratedAt = new Date().toISOString();
    }
    return state;
  }

  public updateState(
    tenantId: string,
    patch: Partial<{
      mode: CognitiveMode;
      activeFocus: string;
      workingHypothesis: string;
      maxRecursionDepth: number;
      autoConsolidate: boolean;
      confidenceThreshold: number;
      pinnedDirectives: string[];
    }>
  ): PersistentCognitiveState {
    this.ensureSynced();
    const current = this.getState(tenantId);
    const now = new Date().toISOString();

    const nextMode: CognitiveMode =
      patch.mode && VALID_MODES.has(patch.mode) ? patch.mode : current.mode;
    const nextDepth =
      typeof patch.maxRecursionDepth === 'number' && Number.isFinite(patch.maxRecursionDepth)
        ? Math.min(5, Math.max(1, Math.round(patch.maxRecursionDepth)))
        : current.maxRecursionDepth;
    const nextConfidence =
      typeof patch.confidenceThreshold === 'number' && Number.isFinite(patch.confidenceThreshold)
        ? Number(Math.min(0.99, Math.max(0.2, patch.confidenceThreshold)).toFixed(2))
        : current.confidenceThreshold;
    const nextDirectives = Array.isArray(patch.pinnedDirectives)
      ? patch.pinnedDirectives.map((d) => String(d).trim()).filter(Boolean).slice(0, 12)
      : current.pinnedDirectives;

    const draft: Omit<PersistentCognitiveState, 'stateDigestSha256'> = {
      tenantId: current.tenantId,
      mode: nextMode,
      activeFocus:
        typeof patch.activeFocus === 'string' && patch.activeFocus.trim()
          ? patch.activeFocus.trim().slice(0, 400)
          : current.activeFocus,
      workingHypothesis:
        typeof patch.workingHypothesis === 'string'
          ? patch.workingHypothesis.trim().slice(0, 800)
          : current.workingHypothesis,
      maxRecursionDepth: nextDepth,
      autoConsolidate:
        typeof patch.autoConsolidate === 'boolean' ? patch.autoConsolidate : current.autoConsolidate,
      confidenceThreshold: nextConfidence,
      pinnedDirectives: nextDirectives,
      continuityCounter: current.continuityCounter + 1,
      lastHydratedAt: current.lastHydratedAt,
      lastPersistedAt: now,
      checkpoints: current.checkpoints,
    };

    const updated: PersistentCognitiveState = {
      ...draft,
      stateDigestSha256: computeStateDigest(draft),
    };

    this.diskStore.states[current.tenantId] = updated;
    this.persistToDisk(this.diskStore);

    AuditLedger.append('SYSTEM', 'COGNITIVE_CORE_STATE_UPDATED', {
      tenantId: current.tenantId,
      mode: updated.mode,
      continuityCounter: updated.continuityCounter,
      stateDigestSha256: updated.stateDigestSha256,
    });

    return updated;
  }

  public saveCheckpoint(
    scope: MemoryScope,
    label?: string
  ): { checkpoint: CognitiveStateCheckpoint; state: PersistentCognitiveState } {
    this.ensureSynced();
    const tenantId = scope.tenantId || 'default-tenant';
    const state = this.getState(tenantId);
    const now = new Date().toISOString();
    const checkpointId = `ckpt_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const memoryKey = `cognitive_state_${checkpointId}`;
    const cleanLabel =
      (label || '').trim().slice(0, 120) ||
      `Checkpoint #${state.continuityCounter} (${state.mode})`;

    NativeMemoryController.getInstance().storeMemory(
      memoryKey,
      {
        checkpointId,
        label: cleanLabel,
        mode: state.mode,
        activeFocus: state.activeFocus,
        workingHypothesis: state.workingHypothesis,
        maxRecursionDepth: state.maxRecursionDepth,
        pinnedDirectives: state.pinnedDirectives,
        stateDigestSha256: state.stateDigestSha256,
        continuityCounter: state.continuityCounter,
      },
      'semantic',
      { checkpointId, source: 'CognitiveCore' },
      { scope }
    );

    const checkpoint: CognitiveStateCheckpoint = {
      checkpointId,
      label: cleanLabel,
      createdAt: now,
      mode: state.mode,
      activeFocus: state.activeFocus,
      workingHypothesis: state.workingHypothesis,
      stateDigestSha256: state.stateDigestSha256,
      continuityCounter: state.continuityCounter,
      memoryKey,
    };

    state.checkpoints = [checkpoint, ...state.checkpoints].slice(0, 16);
    state.continuityCounter += 1;
    state.lastPersistedAt = now;
    const { stateDigestSha256: _ignored, ...rest } = state;
    state.stateDigestSha256 = computeStateDigest(rest);

    this.diskStore.states[state.tenantId] = state;
    this.persistToDisk(this.diskStore);

    AuditLedger.append('SYSTEM', 'COGNITIVE_CORE_CHECKPOINT_SAVED', {
      tenantId: state.tenantId,
      checkpointId,
      memoryKey,
      stateDigestSha256: state.stateDigestSha256,
    });

    return { checkpoint, state };
  }

  public listMemoryBuffers(
    scope: MemoryScope,
    opts?: { query?: string; category?: MemoryCategory; limit?: number }
  ): CognitiveCoreMemoryOverview {
    const ctrl = NativeMemoryController.getInstance();
    const stats = ctrl.getStats();
    const integrity = ctrl.verifyStoreIntegrity();
    const lifecycle = ctrl.analyzeMemoryLifecycle(scope);
    const limit = Math.min(60, Math.max(1, Number(opts?.limit) || 32));
    const category = opts?.category && VALID_CATEGORIES.has(opts.category) ? opts.category : undefined;
    const query = (opts?.query || '').trim();

    let items: CognitiveCoreMemoryItemSummary[];
    if (query) {
      const ranked = ctrl.recallRankedMemories(query, {
        limit,
        category,
        scope,
      });
      items = ranked.map(({ item, score }) => formatMemoryItem(item, score));
    } else {
      const all = ctrl
        .listAll(scope)
        .filter((item) => (!category ? true : item.category === category))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, limit);
      items = all.map((item) => formatMemoryItem(item));
    }

    return {
      totalItems: stats.totalItems,
      scopedItemsCount: lifecycle.totalScopedItems,
      storeSizeBytes: stats.storeSizeBytes,
      lastPersisted: stats.lastPersisted,
      categories: lifecycle.byCategory,
      integrity: {
        valid: integrity.valid,
        corruptedCount: integrity.corruptedKeys.length,
        storeSha256: integrity.storeSha256,
        checkedAt: integrity.checkedAt,
      },
      lifecycle: {
        expiringSoonCount: lifecycle.expiringSoonCount,
        nearDuplicatesCount: lifecycle.nearDuplicatesCount,
        consolidationSnapshotsCount: lifecycle.consolidationSnapshotsCount,
      },
      items,
    };
  }

  public commitMemoryBuffer(
    scope: MemoryScope,
    params: {
      key: string;
      value: unknown;
      category?: MemoryCategory;
      conflictStrategy?: 'overwrite' | 'manual_review' | 'keep_existing';
      ttlSeconds?: number;
    }
  ) {
    const cleanKey = String(params.key || '')
      .trim()
      .replace(/[^a-zA-Z0-9_.:-]/g, '_')
      .slice(0, 96);
    if (!cleanKey) {
      throw new Error('Memory key is required');
    }
    if (params.value === undefined || params.value === null || String(params.value).trim() === '') {
      throw new Error('Memory value cannot be empty');
    }
    const category: MemoryCategory =
      params.category && VALID_CATEGORIES.has(params.category) ? params.category : 'episodic';
    const strategy =
      params.conflictStrategy === 'manual_review' || params.conflictStrategy === 'keep_existing'
        ? params.conflictStrategy
        : 'overwrite';

    return NativeMemoryController.getInstance().storeWithConflictResolution(
      cleanKey,
      params.value,
      category,
      strategy,
      {
        scope,
        ttlSeconds:
          typeof params.ttlSeconds === 'number' && params.ttlSeconds > 0
            ? params.ttlSeconds
            : undefined,
      }
    );
  }

  public deleteMemoryBuffer(scope: MemoryScope, key: string): boolean {
    return NativeMemoryController.getInstance().deleteMemory(key, scope);
  }

  public consolidateMemoryBuffer(
    scope: MemoryScope,
    params?: { targetKey?: string; sourceCategory?: MemoryCategory; archiveSourcesFromActive?: boolean }
  ) {
    const sourceCategory: MemoryCategory =
      params?.sourceCategory && VALID_CATEGORIES.has(params.sourceCategory)
        ? params.sourceCategory
        : 'episodic';
    const targetKey =
      (params?.targetKey || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '_') ||
      `cog_semantic_${Date.now().toString(36)}`;

    return NativeMemoryController.getInstance().consolidateEpisodicToSemanticReversible({
      targetKey,
      sourceCategory,
      maxSources: 12,
      archiveSourcesFromActive: params?.archiveSourcesFromActive ?? false,
      scope,
    });
  }

  private buildRecursiveSubtree(params: {
    goal: string;
    parentId: string | null;
    depth: number;
    maxDepth: number;
    branchFactor: number;
    order: number;
    stagePrefix: string;
  }): RecursiveTaskNode {
    const now = new Date().toISOString();
    const ctx = CognitiveContextEngine.getInstance().analyzeContext({ input: params.goal });
    const adaptive = AdaptiveReasoningEngine.getInstance();
    const problemClass = adaptive.classifyProblem(params.goal);
    const strategy = adaptive.selectStrategy(problemClass, false);
    const nodeId = `node_d${params.depth}_${crypto.randomBytes(3).toString('hex')}`;

    const stage =
      params.depth === 0
        ? 'ROOT_OBJECTIVE'
        : `${params.stagePrefix}.${params.order}`;

    const acceptanceGate =
      params.depth === 0
        ? 'All child execution branches verified and consolidated into memory.'
        : strategy === 'ast_code_inspector'
        ? 'Code parses cleanly and passes sandbox runtime checks.'
        : strategy === 'symbolic_math_verifier'
        ? 'Deterministic computation and bounds assertions pass.'
        : strategy === 'csp_dependency_solver'
        ? 'Dependency ordering resolves without cycles or budget violation.'
        : 'Evidence retrieved and validated against working directives.';

    const node: RecursiveTaskNode = {
      nodeId,
      parentId: params.parentId,
      depth: params.depth,
      order: params.order,
      title: params.goal.slice(0, 180),
      stage,
      problemClass,
      strategy,
      dependsOn: [],
      acceptanceGate,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      children: [],
    };

    if (params.depth < params.maxDepth) {
      const subGoals = this.deriveSubGoals(params.goal, params.depth, params.branchFactor, ctx.intent.primary);
      let prevSiblingId: string | null = null;
      subGoals.forEach((subGoal, idx) => {
        const child = this.buildRecursiveSubtree({
          goal: subGoal,
          parentId: nodeId,
          depth: params.depth + 1,
          maxDepth: params.maxDepth,
          branchFactor: params.branchFactor,
          order: idx + 1,
          stagePrefix: params.depth === 0 ? `L${idx + 1}` : `${params.stagePrefix}.${idx + 1}`,
        });
        if (prevSiblingId) {
          child.dependsOn = [prevSiblingId];
        }
        prevSiblingId = child.nodeId;
        node.children.push(child);
      });
    }

    return node;
  }

  private deriveSubGoals(
    goal: string,
    depth: number,
    branchFactor: number,
    intent: string
  ): string[] {
    const clean = goal.replace(/\s+/g, ' ').trim().slice(0, 90);
    const templatesByDepth: string[] =
      depth === 0
        ? [
            `Recall context & verify constraints for: ${clean}`,
            intent === 'coding' || intent === 'debugging'
              ? `Architect & implement verified modules for: ${clean}`
              : `Decompose evidence & execution paths for: ${clean}`,
            `Validate outcomes, audit integrity & consolidate memory for: ${clean}`,
          ]
        : depth === 1
        ? [
            `Inspect preconditions & state dependencies (${clean})`,
            `Execute core synthesis step (${clean})`,
            `Run verification assertions & edge checks (${clean})`,
          ]
        : [
            `Atomic step A: validate inputs for ${clean}`,
            `Atomic step B: apply & verify output for ${clean}`,
            `Atomic step C: emit trace digest for ${clean}`,
          ];

    return templatesByDepth.slice(0, Math.min(3, Math.max(2, branchFactor)));
  }

  public createRecursivePlan(
    scope: MemoryScope,
    params: {
      goal: string;
      maxDepth?: number;
      branchFactor?: number;
      priority?: 'Low' | 'Medium' | 'High';
      runtime?: 'node' | 'python3';
    }
  ): RecursivePlanRecord {
    this.ensureSynced();
    const goal = String(params.goal || '').trim();
    if (!goal) {
      throw new Error('Plan goal is required');
    }

    const tenantId = scope.tenantId || 'default-tenant';
    const ownerUserId = scope.userId || 'cognitive-core';
    const maxDepth = Math.min(4, Math.max(1, Number(params.maxDepth) || 2));
    const branchFactor = Math.min(3, Math.max(2, Number(params.branchFactor) || 2));
    const priority: 'Low' | 'Medium' | 'High' =
      params.priority === 'High' || params.priority === 'Low' ? params.priority : 'Medium';
    const runtime: 'node' | 'python3' = params.runtime === 'python3' ? 'python3' : 'node';

    const planId = `rplan_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const linkedTaskId = `cog_${planId}`;
    const now = new Date().toISOString();

    const root = this.buildRecursiveSubtree({
      goal,
      parentId: null,
      depth: 0,
      maxDepth,
      branchFactor,
      order: 1,
      stagePrefix: 'L0',
    });

    const stats = summarizeTreeStats(root);
    const dagSteps = flattenTreeStepsForDag(root);

    AutonomousPlanner.getInstance().decomposeGoal({
      taskId: linkedTaskId,
      goal,
      priority,
      runtime,
      tenantId,
      ownerUserId,
      customSteps: dagSteps,
    });

    const record: RecursivePlanRecord = {
      planId,
      linkedTaskId,
      tenantId,
      ownerUserId,
      goal,
      priority,
      runtime,
      maxDepth,
      branchFactor,
      status: 'ACTIVE',
      totalNodes: stats.totalNodes,
      completedNodes: stats.completedNodes,
      realizedDepth: stats.realizedDepth,
      createdAt: now,
      updatedAt: now,
      root,
    };

    this.diskStore.plans[planId] = record;
    this.persistToDisk(this.diskStore);

    AuditLedger.append('PLANNER', 'COGNITIVE_CORE_RECURSIVE_PLAN_CREATED', {
      planId,
      linkedTaskId,
      tenantId,
      maxDepth,
      totalNodes: stats.totalNodes,
    });

    return record;
  }

  private findNode(root: RecursiveTaskNode, nodeId: string): RecursiveTaskNode | null {
    if (root.nodeId === nodeId) return root;
    for (const child of root.children) {
      const hit = this.findNode(child, nodeId);
      if (hit) return hit;
    }
    return null;
  }

  private rollupNodeStatuses(node: RecursiveTaskNode): void {
    if (node.children.length === 0) return;
    for (const child of node.children) {
      this.rollupNodeStatuses(child);
    }
    const allCompleted = node.children.every((c) => c.status === 'COMPLETED');
    const anyFailed = node.children.some((c) => c.status === 'FAILED');
    const anyBlocked = node.children.some((c) => c.status === 'BLOCKED');
    const anyActive = node.children.some((c) => c.status === 'RUNNING' || c.status === 'COMPLETED');

    if (allCompleted) {
      node.status = 'COMPLETED';
    } else if (anyFailed) {
      node.status = 'FAILED';
    } else if (anyBlocked) {
      node.status = 'BLOCKED';
    } else if (anyActive) {
      node.status = 'RUNNING';
    } else {
      node.status = 'PENDING';
    }
    node.updatedAt = new Date().toISOString();
  }

  public expandRecursiveNode(
    scope: MemoryScope,
    params: { planId: string; nodeId: string; focusHint?: string; branchFactor?: number }
  ): RecursivePlanRecord {
    this.ensureSynced();
    const plan = this.diskStore.plans[params.planId];
    if (!plan) {
      throw new Error(`NOT_FOUND: Recursive plan '${params.planId}' not found.`);
    }
    if (scope.tenantId && plan.tenantId !== scope.tenantId) {
      throw new Error('FORBIDDEN: Cross-tenant plan access denied.');
    }

    const target = this.findNode(plan.root, params.nodeId);
    if (!target) {
      throw new Error(`NOT_FOUND: Node '${params.nodeId}' not found in plan '${params.planId}'.`);
    }
    if (target.depth >= 5) {
      throw new Error('MAX_RECURSION_DEPTH: Maximum safety recursion depth (5) reached.');
    }

    const branchFactor = Math.min(3, Math.max(2, Number(params.branchFactor) || plan.branchFactor || 2));
    const expandPrompt = params.focusHint?.trim()
      ? `${target.title} — ${params.focusHint.trim()}`
      : target.title;
    const subGoals = this.deriveSubGoals(expandPrompt, target.depth, branchFactor, 'planning');

    const startOrder = target.children.length + 1;
    let prevId = target.children.length > 0 ? target.children[target.children.length - 1].nodeId : null;
    subGoals.forEach((sg, idx) => {
      const subtree = this.buildRecursiveSubtree({
        goal: sg,
        parentId: target.nodeId,
        depth: target.depth + 1,
        maxDepth: target.depth + 1,
        branchFactor,
        order: startOrder + idx,
        stagePrefix: target.stage === 'ROOT_OBJECTIVE' ? `L${startOrder + idx}` : `${target.stage}.${startOrder + idx}`,
      });
      if (prevId) subtree.dependsOn = [prevId];
      prevId = subtree.nodeId;
      target.children.push(subtree);
    });

    target.status = 'RUNNING';
    target.updatedAt = new Date().toISOString();
    this.rollupNodeStatuses(plan.root);

    const stats = summarizeTreeStats(plan.root);
    plan.totalNodes = stats.totalNodes;
    plan.completedNodes = stats.completedNodes;
    plan.realizedDepth = stats.realizedDepth;
    plan.maxDepth = Math.max(plan.maxDepth, stats.realizedDepth);
    plan.status = plan.root.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE';
    plan.updatedAt = new Date().toISOString();

    this.diskStore.plans[plan.planId] = plan;
    this.persistToDisk(this.diskStore);

    AuditLedger.append('PLANNER', 'COGNITIVE_CORE_NODE_EXPANDED', {
      planId: plan.planId,
      nodeId: target.nodeId,
      newDepth: target.depth + 1,
      totalNodes: plan.totalNodes,
    });

    return plan;
  }

  public updateRecursiveNodeStatus(
    scope: MemoryScope,
    params: { planId: string; nodeId: string; status: RecursiveNodeStatus; note?: string }
  ): RecursivePlanRecord {
    this.ensureSynced();
    const plan = this.diskStore.plans[params.planId];
    if (!plan) {
      throw new Error(`NOT_FOUND: Recursive plan '${params.planId}' not found.`);
    }
    if (scope.tenantId && plan.tenantId !== scope.tenantId) {
      throw new Error('FORBIDDEN: Cross-tenant plan access denied.');
    }
    if (!VALID_NODE_STATUS.has(params.status)) {
      throw new Error(`Invalid node status '${params.status}'.`);
    }

    const target = this.findNode(plan.root, params.nodeId);
    if (!target) {
      throw new Error(`NOT_FOUND: Node '${params.nodeId}' not found.`);
    }

    const markDescendants = (node: RecursiveTaskNode, status: RecursiveNodeStatus) => {
      node.status = status;
      node.updatedAt = new Date().toISOString();
      if (status === 'COMPLETED' || status === 'PENDING') {
        for (const child of node.children) {
          markDescendants(child, status);
        }
      }
    };

    markDescendants(target, params.status);
    if (params.note !== undefined) {
      target.notes = params.note.trim().slice(0, 300) || undefined;
    }

    this.rollupNodeStatuses(plan.root);

    const stats = summarizeTreeStats(plan.root);
    plan.totalNodes = stats.totalNodes;
    plan.completedNodes = stats.completedNodes;
    plan.realizedDepth = stats.realizedDepth;
    plan.status =
      plan.root.status === 'COMPLETED'
        ? 'COMPLETED'
        : plan.root.status === 'FAILED'
        ? 'FAILED'
        : plan.root.status === 'BLOCKED'
        ? 'BLOCKED'
        : 'ACTIVE';
    plan.updatedAt = new Date().toISOString();

    this.diskStore.plans[plan.planId] = plan;
    this.persistToDisk(this.diskStore);

    AutonomousPlanner.getInstance().updateStepStatus(
      plan.linkedTaskId,
      target.nodeId,
      params.status === 'BLOCKED' ? 'SKIPPED' : params.status,
      { outputSummary: params.note }
    );

    const state = this.getState(plan.tenantId);
    if (plan.status === 'COMPLETED' && state.autoConsolidate) {
      try {
        NativeMemoryController.getInstance().storeWithConflictResolution(
          `rplan_completed_${plan.planId}`,
          {
            planId: plan.planId,
            goal: plan.goal,
            totalNodes: plan.totalNodes,
            realizedDepth: plan.realizedDepth,
            completedAt: plan.updatedAt,
          },
          'reasoning_trace',
          'overwrite',
          { scope }
        );
      } catch {
        // non-fatal memory consolidation
      }
    }

    return plan;
  }

  public deleteRecursivePlan(scope: MemoryScope, planId: string): boolean {
    this.ensureSynced();
    const plan = this.diskStore.plans[planId];
    if (!plan) return false;
    if (scope.tenantId && plan.tenantId !== scope.tenantId) {
      throw new Error('FORBIDDEN: Cross-tenant plan deletion denied.');
    }
    delete this.diskStore.plans[planId];
    this.persistToDisk(this.diskStore);
    return true;
  }

  public listRecursivePlans(scope: MemoryScope): RecursivePlanRecord[] {
    this.ensureSynced();
    return Object.values(this.diskStore.plans)
      .filter((plan) => !scope.tenantId || plan.tenantId === scope.tenantId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  public async getSnapshot(
    scope: MemoryScope,
    memoryOpts?: { query?: string; category?: MemoryCategory }
  ): Promise<CognitiveCoreSnapshot> {
    const tenantId = scope.tenantId || 'default-tenant';
    const state = this.getState(tenantId);
    const conn = await ConnectivityMonitor.getInstance().getStatus().catch(() => null);
    const memory = this.listMemoryBuffers(scope, memoryOpts);
    const plans = this.listRecursivePlans(scope);

    let totalNodes = 0;
    let completedNodes = 0;
    let activePlans = 0;
    let completedPlans = 0;
    for (const p of plans) {
      totalNodes += p.totalNodes;
      completedNodes += p.completedNodes;
      if (p.status === 'COMPLETED') completedPlans += 1;
      else if (p.status === 'ACTIVE') activePlans += 1;
    }

    return {
      architecture: 'ZYNTHEOR-CognitiveCore-v1 (extends IntelligenceCore)',
      state,
      neuralBridge: {
        online: Boolean(conn?.online),
        runtimeState: conn?.runtimeState || 'NOT_CONFIGURED',
        weightsLoaded: Boolean(conn?.weightsLoaded),
        executionVerified: Boolean(conn?.executionVerified),
        reason: conn?.reason || 'Cloud Runtime checkpoint status unavailable.',
        checkpointSha256: conn?.checkpointSha256 || null,
      },
      memory,
      plans,
      planMetrics: {
        totalPlans: plans.length,
        activePlans,
        completedPlans,
        totalNodes,
        completedNodes,
      },
    };
  }
}
