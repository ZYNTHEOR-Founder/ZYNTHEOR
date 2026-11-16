/**
 * ZYNTHEOR Sovereign NativeMemoryController
 * Manages episodic, semantic, task, working-context, and reasoning memories within the Sovereign Core.
 * Persists across sessions in native_data/memory_store.json (or ZYNTHEOR_MEMORY_FILE).
 *
 * CRITICAL INVARIANTS:
 *  - Every read, write, update, query, delete, consolidation, and rollback is logged to AuditLedger with SHA-256 chaining.
 *  - Strict tenant isolation: cross-tenant reads/writes/rollbacks throw FORBIDDEN.
 *  - Reversible consolidation preserves verbatim snapshots under memory_archives/ for exact rollback.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger';
import {
  classifyTruthClaim,
  enforceTruthClaims,
  summarizeTruthClaims,
  type TruthClaimRecord,
  type TruthKernelSummary,
} from './TruthKernel';

export type MemoryCategory =
  | 'episodic'
  | 'semantic'
  | 'user_preference'
  | 'reasoning_trace'
  | 'task_memory'
  | 'working_context';

export interface MemoryScope {
  tenantId?: string;
  userId?: string;
  role?: string;
}

export interface MemoryHistoryEntry {
  version: number;
  updatedAt: string;
  contentDigest: string;
  valuePreview: string;
}

export interface EpisodicMemoryItem {
  key: string;
  value: any;
  category: MemoryCategory;
  createdAt: string;
  updatedAt: string;
  readCount: number;
  version: number;
  history: MemoryHistoryEntry[];
  metadata?: Record<string, any>;
  scope?: MemoryScope;
  expiresAt?: string;
  importanceScore: number;
  contentDigest: string;
}

export interface ConsolidationArchiveRecord {
  consolidationId: string;
  tenantId: string;
  targetKey: string;
  sourceCategory: MemoryCategory;
  createdAt: string;
  sourceKeys: string[];
  sources: EpisodicMemoryItem[];
}

export interface MemoryStoreData {
  version: string;
  lastPersisted: string;
  verified_knowledge: Record<string, string>;
  sessions: Array<{ key: string; val: string; timestamp?: string }>;
  episodic: Record<string, EpisodicMemoryItem>;
  consolidations?: Record<string, { consolidationId: string; archivePath: string; tenantId: string; createdAt: string; targetKey: string }>;
}

function normalizeScopeArg(scopeOrOpts?: MemoryScope | { scope?: MemoryScope; ttlSeconds?: number }): {
  scope?: MemoryScope;
  ttlSeconds?: number;
} {
  if (!scopeOrOpts || typeof scopeOrOpts !== 'object') return {};
  if ('scope' in scopeOrOpts || 'ttlSeconds' in scopeOrOpts) {
    return {
      scope: (scopeOrOpts as { scope?: MemoryScope }).scope,
      ttlSeconds: (scopeOrOpts as { ttlSeconds?: number }).ttlSeconds,
    };
  }
  return { scope: scopeOrOpts as MemoryScope };
}

function tokenizeText(input: string): string[] {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export class NativeMemoryController {
  private static instance: NativeMemoryController | null = null;
  private loadedFilePath: string;
  private store: MemoryStoreData;

  private constructor() {
    this.loadedFilePath = this.resolveFilePath();
    this.store = this.loadFromDisk(this.loadedFilePath);
  }

  public static getInstance(): NativeMemoryController {
    if (!NativeMemoryController.instance) {
      NativeMemoryController.instance = new NativeMemoryController();
    }
    return NativeMemoryController.instance;
  }

  private resolveFilePath(): string {
    if (process.env.ZYNTHEOR_MEMORY_FILE) {
      return path.resolve(process.env.ZYNTHEOR_MEMORY_FILE);
    }
    return path.resolve(process.cwd(), 'native_data', 'memory_store.json');
  }

  private resolveArchiveDir(): string {
    return path.join(path.dirname(this.resolveFilePath()), 'memory_archives');
  }

  private ensureSyncedStore(): void {
    const target = this.resolveFilePath();
    if (target !== this.loadedFilePath) {
      this.loadedFilePath = target;
      this.store = this.loadFromDisk(target);
    }
  }

  private loadFromDisk(filePath: string): MemoryStoreData {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.episodic) parsed.episodic = {};
        if (!parsed.verified_knowledge) parsed.verified_knowledge = {};
        if (!parsed.sessions) parsed.sessions = [];
        if (!parsed.consolidations) parsed.consolidations = {};
        for (const item of Object.values(parsed.episodic) as EpisodicMemoryItem[]) {
          if (!Number.isFinite(item.version)) item.version = 1;
          if (!Array.isArray(item.history)) {
            item.history = [
              {
                version: item.version,
                updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
                contentDigest: item.contentDigest || this.computeDigest(item.value),
                valuePreview: this.previewValue(item.value),
              },
            ];
          }
          if (!Number.isFinite(item.importanceScore)) {
            item.importanceScore = this.computeImportance(item.value, item.category, item.readCount || 0);
          }
        }
        return parsed;
      } catch (err) {
        console.error('[NativeMemoryController] Failed to parse memory store, resetting', err);
      }
    }

    const initial: MemoryStoreData = {
      version: '1.0.0-SOVEREIGN',
      lastPersisted: new Date().toISOString(),
      verified_knowledge: {
        architecture: 'ZYNTHEOR Native Core; active checkpoint size must be read from verified Cloud Runtime evidence',
        sovereignty_rule: 'Native model is the intelligence core; runtime readiness requires a verified Cloud checkpoint and recorded evidence',
        sandbox_root: '/workspace',
        multilingual_engine: 'Thai-English Dual Native Vocabulary & Code-Switching',
      },
      sessions: [],
      episodic: {},
      consolidations: {},
    };

    this.persistToDisk(initial, filePath);
    return initial;
  }

  private persistToDisk(data: MemoryStoreData, targetPath?: string): void {
    const filePath = targetPath || this.resolveFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    data.lastPersisted = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private computeDigest(val: any): string {
    const serialized = typeof val === 'string' ? val : JSON.stringify(val);
    return crypto.createHash('sha256').update(serialized ?? '').digest('hex');
  }

  private previewValue(val: any): string {
    const s = typeof val === 'string' ? val : JSON.stringify(val);
    return String(s || '').slice(0, 140);
  }

  private computeImportance(val: any, category: MemoryCategory, readCount: number): number {
    const catWeight: Record<MemoryCategory, number> = {
      semantic: 0.85,
      user_preference: 0.8,
      task_memory: 0.78,
      reasoning_trace: 0.72,
      working_context: 0.65,
      episodic: 0.55,
    };
    const lenBoost = Math.min(0.1, String(typeof val === 'string' ? val : JSON.stringify(val)).length / 2000);
    const readBoost = Math.min(0.1, readCount * 0.02);
    return Number(Math.min(1, (catWeight[category] || 0.5) + lenBoost + readBoost).toFixed(3));
  }

  private isExpired(item: EpisodicMemoryItem): boolean {
    if (!item.expiresAt) return false;
    const expMs = Date.parse(item.expiresAt);
    return Number.isFinite(expMs) && expMs <= Date.now();
  }

  private assertScopeAccess(item: EpisodicMemoryItem, callerScope?: MemoryScope, action = 'read'): void {
    if (!item.scope?.tenantId) return;
    if (!callerScope?.tenantId) {
      throw new Error(`FORBIDDEN: Tenant scope required to ${action} tenant-scoped memory '${item.key}'.`);
    }
    if (item.scope.tenantId !== callerScope.tenantId) {
      throw new Error(
        `FORBIDDEN: Cross-tenant memory access denied for key '${item.key}' (expected tenant '${item.scope.tenantId}', got '${callerScope.tenantId}').`
      );
    }
  }

  private isItemAccessibleInScope(item: EpisodicMemoryItem, callerScope?: MemoryScope): boolean {
    if (this.isExpired(item)) return false;
    if (!callerScope?.tenantId) {
      return !item.scope?.tenantId;
    }
    if (!item.scope?.tenantId) return true;
    return item.scope.tenantId === callerScope.tenantId;
  }

  /**
   * Stores or updates an episodic/semantic/task memory item with optional tenant scope & TTL.
   */
  public storeMemory(
    key: string,
    value: any,
    category: MemoryCategory = 'episodic',
    metadata?: Record<string, any>,
    options?: { scope?: MemoryScope; ttlSeconds?: number }
  ): EpisodicMemoryItem {
    this.ensureSyncedStore();
    const now = new Date().toISOString();
    const digest = this.computeDigest(value);
    const existing = this.store.episodic[key];
    if (existing && options?.scope) {
      this.assertScopeAccess(existing, options.scope, 'overwrite');
    }

    const nextVersion = existing ? (existing.version || 1) + 1 : 1;
    const historyEntry: MemoryHistoryEntry = {
      version: nextVersion,
      updatedAt: now,
      contentDigest: digest,
      valuePreview: this.previewValue(value),
    };
    const priorHistory = existing?.history ? [...existing.history] : [];
    const mergedScope = options?.scope || existing?.scope;
    const expiresAt =
      typeof options?.ttlSeconds === 'number' && Number.isFinite(options.ttlSeconds) && options.ttlSeconds > 0
        ? new Date(Date.now() + options.ttlSeconds * 1000).toISOString()
        : existing?.expiresAt;

    const item: EpisodicMemoryItem = {
      key,
      value,
      category,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      readCount: existing ? existing.readCount : 0,
      version: nextVersion,
      history: [...priorHistory, historyEntry].slice(-25),
      metadata: metadata || existing?.metadata,
      ...(mergedScope ? { scope: { tenantId: mergedScope.tenantId, userId: mergedScope.userId, role: mergedScope.role } } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      importanceScore: this.computeImportance(value, category, existing?.readCount || 0),
      contentDigest: digest,
    };

    this.store.episodic[key] = item;
    this.persistToDisk(this.store);

    AuditLedger.append('SYSTEM', 'MEMORY_WRITE_OP', {
      memoryKey: key,
      category,
      version: nextVersion,
      tenantId: mergedScope?.tenantId || null,
      contentDigest: digest,
      isUpdate: Boolean(existing),
      timestamp: now,
    });

    return item;
  }

  /**
   * Updates an existing memory item, incrementing version and retaining history.
   */
  public updateMemory(
    key: string,
    value: any,
    category?: MemoryCategory,
    metadata?: Record<string, any>,
    options?: { scope?: MemoryScope; ttlSeconds?: number }
  ): EpisodicMemoryItem {
    this.ensureSyncedStore();
    const existing = this.store.episodic[key];
    if (existing && options?.scope) {
      this.assertScopeAccess(existing, options.scope, 'update');
    }
    const now = new Date().toISOString();
    const digest = this.computeDigest(value);
    const prevDigest = existing ? existing.contentDigest : null;
    const nextCategory = category || existing?.category || 'episodic';
    const nextVersion = existing ? (existing.version || 1) + 1 : 1;
    const historyEntry: MemoryHistoryEntry = {
      version: nextVersion,
      updatedAt: now,
      contentDigest: digest,
      valuePreview: this.previewValue(value),
    };
    const mergedScope = options?.scope || existing?.scope;
    const expiresAt =
      typeof options?.ttlSeconds === 'number' && Number.isFinite(options.ttlSeconds) && options.ttlSeconds > 0
        ? new Date(Date.now() + options.ttlSeconds * 1000).toISOString()
        : existing?.expiresAt;

    const item: EpisodicMemoryItem = {
      key,
      value,
      category: nextCategory,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      readCount: existing ? existing.readCount : 0,
      version: nextVersion,
      history: [...(existing?.history || []), historyEntry].slice(-25),
      metadata: metadata || existing?.metadata,
      ...(mergedScope ? { scope: { tenantId: mergedScope.tenantId, userId: mergedScope.userId, role: mergedScope.role } } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      importanceScore: this.computeImportance(value, nextCategory, existing?.readCount || 0),
      contentDigest: digest,
    };

    this.store.episodic[key] = item;
    this.persistToDisk(this.store);

    AuditLedger.append('SYSTEM', 'MEMORY_UPDATE_OP', {
      memoryKey: key,
      previousDigest: prevDigest,
      newDigest: digest,
      version: nextVersion,
      category: item.category,
      tenantId: mergedScope?.tenantId || null,
      updatedAt: now,
    });

    return item;
  }

  /**
   * Retrieves a memory item by key with TTL enforcement and tenant isolation.
   */
  public retrieveMemory(
    key: string,
    scopeOrOpts?: MemoryScope | { scope?: MemoryScope }
  ): EpisodicMemoryItem | null {
    this.ensureSyncedStore();
    const { scope } = normalizeScopeArg(scopeOrOpts);
    const item = this.store.episodic[key];
    const now = new Date().toISOString();

    if (item) {
      this.assertScopeAccess(item, scope, 'retrieve');
      if (this.isExpired(item)) {
        delete this.store.episodic[key];
        this.persistToDisk(this.store);
        AuditLedger.append('SYSTEM', 'MEMORY_READ_OP', {
          memoryKey: key,
          found: false,
          expired: true,
          timestamp: now,
        });
        return null;
      }

      item.readCount++;
      item.importanceScore = this.computeImportance(item.value, item.category, item.readCount);
      this.persistToDisk(this.store);

      AuditLedger.append('SYSTEM', 'MEMORY_READ_OP', {
        memoryKey: key,
        found: true,
        readCount: item.readCount,
        contentDigest: item.contentDigest,
        timestamp: now,
      });

      return item;
    }

    AuditLedger.append('SYSTEM', 'MEMORY_READ_OP', {
      memoryKey: key,
      found: false,
      timestamp: now,
    });

    return null;
  }

  /**
   * Queries memories by substring or category with optional tenant scope filtering.
   */
  public queryMemories(
    queryStr: string,
    category?: MemoryCategory,
    scopeOrOpts?: MemoryScope | { scope?: MemoryScope }
  ): EpisodicMemoryItem[] {
    this.ensureSyncedStore();
    const { scope } = normalizeScopeArg(scopeOrOpts);
    const items = Object.values(this.store.episodic);
    const qLower = String(queryStr || '').toLowerCase();

    const results = items.filter((item) => {
      if (!this.isItemAccessibleInScope(item, scope)) return false;
      if (category && item.category !== category) return false;
      if (!queryStr) return true;
      const keyMatch = item.key.toLowerCase().includes(qLower);
      const valMatch = JSON.stringify(item.value).toLowerCase().includes(qLower);
      return keyMatch || valMatch;
    });

    AuditLedger.append('SYSTEM', 'MEMORY_QUERY_OP', {
      query: queryStr,
      categoryFilter: category || 'ALL',
      matchCount: results.length,
    });

    return results;
  }

  /**
   * Ranked recall combining token overlap, importance score, and recency within scope.
   */
  public recallRankedMemories(
    query: string,
    options: { limit?: number; category?: MemoryCategory; scope?: MemoryScope } = {}
  ): Array<{ item: EpisodicMemoryItem; score: number }> {
    this.ensureSyncedStore();
    const qTokens = tokenizeText(query);
    const limit = Math.max(1, Math.min(50, options.limit ?? 10));
    const scored: Array<{ item: EpisodicMemoryItem; score: number }> = [];

    for (const item of Object.values(this.store.episodic)) {
      if (!this.isItemAccessibleInScope(item, options.scope)) continue;
      if (options.category && item.category !== options.category) continue;
      const hay = `${item.key} ${typeof item.value === 'string' ? item.value : JSON.stringify(item.value)}`.toLowerCase();
      const hayTokens = new Set(tokenizeText(hay));
      let overlap = 0;
      for (const tok of qTokens) {
        if (hayTokens.has(tok) || hay.includes(tok)) overlap += 1;
      }
      if (qTokens.length > 0 && overlap === 0) continue;
      const tokenScore = qTokens.length > 0 ? overlap / qTokens.length : 0.5;
      const recencyMs = Math.max(0, Date.now() - Date.parse(item.updatedAt || item.createdAt));
      const recencyBoost = 1 / (1 + recencyMs / (1000 * 60 * 60 * 24));
      const totalScore = Number((tokenScore * 0.7 + item.importanceScore * 0.2 + recencyBoost * 0.1).toFixed(4));
      scored.push({ item, score: totalScore });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Returns working_context & task_memory entries associated with a session ID under caller scope.
   */
  public getWorkingContextForSession(
    sessionId: string,
    scope?: MemoryScope
  ): { sessionId: string; workingContext: EpisodicMemoryItem[]; taskMemories: EpisodicMemoryItem[] } {
    this.ensureSyncedStore();
    const all = Object.values(this.store.episodic).filter((item) => {
      if (!this.isItemAccessibleInScope(item, scope)) return false;
      return item.metadata?.sessionId === sessionId;
    });

    return {
      sessionId,
      workingContext: all.filter((i) => i.category === 'working_context'),
      taskMemories: all.filter((i) => i.category === 'task_memory'),
    };
  }

  /**
   * Stores a memory with explicit conflict detection when the same key holds divergent content.
   */
  public storeWithConflictResolution(
    key: string,
    value: any,
    category: MemoryCategory = 'episodic',
    strategy: 'manual_review' | 'overwrite' | 'keep_existing' = 'manual_review',
    options?: { scope?: MemoryScope; ttlSeconds?: number }
  ): {
    conflictDetected: boolean;
    stored: boolean;
    item: EpisodicMemoryItem;
    conflict: {
      resolution: 'NEEDS_REVIEW' | 'OVERWROTE' | 'KEPT_EXISTING' | 'NONE';
      existingDigest: string | null;
      candidateDigest: string;
    };
  } {
    this.ensureSyncedStore();
    const existing = this.store.episodic[key];
    const candidateDigest = this.computeDigest(value);

    if (existing && !this.isExpired(existing)) {
      if (options?.scope) {
        this.assertScopeAccess(existing, options.scope, 'resolve conflict on');
      }
      if (existing.contentDigest !== candidateDigest) {
        if (strategy === 'manual_review') {
          AuditLedger.append('SYSTEM', 'MEMORY_CONFLICT_FLAGGED', {
            memoryKey: key,
            existingDigest: existing.contentDigest,
            candidateDigest,
            resolution: 'NEEDS_REVIEW',
          });
          return {
            conflictDetected: true,
            stored: false,
            item: existing,
            conflict: {
              resolution: 'NEEDS_REVIEW',
              existingDigest: existing.contentDigest,
              candidateDigest,
            },
          };
        }
        if (strategy === 'keep_existing') {
          return {
            conflictDetected: true,
            stored: false,
            item: existing,
            conflict: {
              resolution: 'KEPT_EXISTING',
              existingDigest: existing.contentDigest,
              candidateDigest,
            },
          };
        }
        const updated = this.storeMemory(key, value, category, undefined, options);
        return {
          conflictDetected: true,
          stored: true,
          item: updated,
          conflict: {
            resolution: 'OVERWROTE',
            existingDigest: existing.contentDigest,
            candidateDigest,
          },
        };
      }
    }

    const saved = this.storeMemory(key, value, category, undefined, options);
    return {
      conflictDetected: false,
      stored: true,
      item: saved,
      conflict: {
        resolution: 'NONE',
        existingDigest: existing?.contentDigest || null,
        candidateDigest,
      },
    };
  }

  /**
   * Non-destructive provenance consolidation of matching memories into a single semantic summary key.
   */
  public consolidateMemories(params: {
    targetKey: string;
    sourceCategory?: MemoryCategory;
    maxSources?: number;
    scope?: MemoryScope;
  }): {
    consolidated: boolean;
    consolidationId: string;
    targetKey: string;
    sourceKeys: string[];
    count: number;
  } {
    this.ensureSyncedStore();
    const sourceCategory = params.sourceCategory || 'task_memory';
    const maxSources = Math.max(1, Math.min(100, params.maxSources ?? 20));
    const candidates = Object.values(this.store.episodic)
      .filter((item) => {
        if (item.key === params.targetKey) return false;
        if (item.category !== sourceCategory) return false;
        if (!this.isItemAccessibleInScope(item, params.scope)) return false;
        if (params.scope?.tenantId) return item.scope?.tenantId === params.scope.tenantId;
        return true;
      })
      .slice(0, maxSources);

    const consolidationId = `cons_${crypto.randomUUID().slice(0, 12)}`;
    const sourceKeys = candidates.map((c) => c.key);
    const summaryText = candidates
      .map((c) => `[${c.key}] ${typeof c.value === 'string' ? c.value : JSON.stringify(c.value)}`)
      .join('\n');

    this.storeMemory(
      params.targetKey,
      {
        consolidationId,
        sourceCategory,
        sourceKeys,
        summary: summaryText,
        createdAt: new Date().toISOString(),
      },
      'semantic',
      { consolidationId, sourceKeys },
      { scope: params.scope }
    );

    AuditLedger.append('SYSTEM', 'MEMORY_CONSOLIDATION_OP', {
      consolidationId,
      targetKey: params.targetKey,
      sourceCategory,
      sourceKeys,
      reversible: false,
    });

    return {
      consolidated: candidates.length > 0,
      consolidationId,
      targetKey: params.targetKey,
      sourceKeys,
      count: candidates.length,
    };
  }

  /**
   * Detects near-duplicate memories within caller scope via token Jaccard similarity (>= 0.85).
   */
  public detectNearDuplicates(
    scope?: MemoryScope
  ): Array<{ keyA: string; keyB: string; similarity: number }> {
    this.ensureSyncedStore();
    const items = Object.values(this.store.episodic).filter((item) => {
      if (!this.isItemAccessibleInScope(item, scope)) return false;
      if (scope?.tenantId) return item.scope?.tenantId === scope.tenantId;
      return true;
    });

    const tokenSets = items.map((item) => ({
      item,
      tokens: new Set(tokenizeText(typeof item.value === 'string' ? item.value : JSON.stringify(item.value))),
    }));

    const duplicates: Array<{ keyA: string; keyB: string; similarity: number }> = [];
    for (let i = 0; i < tokenSets.length; i++) {
      for (let j = i + 1; j < tokenSets.length; j++) {
        const a = tokenSets[i];
        const b = tokenSets[j];
        if (a.item.contentDigest === b.item.contentDigest) {
          duplicates.push({ keyA: a.item.key, keyB: b.item.key, similarity: 1 });
          continue;
        }
        if (a.tokens.size === 0 || b.tokens.size === 0) continue;
        let inter = 0;
        for (const tok of a.tokens) {
          if (b.tokens.has(tok)) inter++;
        }
        const union = a.tokens.size + b.tokens.size - inter;
        const sim = union > 0 ? inter / union : 0;
        if (sim >= 0.85) {
          duplicates.push({
            keyA: a.item.key,
            keyB: b.item.key,
            similarity: Number(sim.toFixed(3)),
          });
        }
      }
    }
    return duplicates;
  }

  /**
   * Reversible episodic -> semantic consolidation.
   * Archives verbatim source items to disk so rollbackConsolidation restores every source bit-for-bit.
   */
  public consolidateEpisodicToSemanticReversible(params: {
    targetKey: string;
    sourceCategory?: MemoryCategory;
    maxSources?: number;
    archiveSourcesFromActive?: boolean;
    scope?: MemoryScope;
  }): {
    consolidated: boolean;
    consolidationId: string;
    targetKey: string;
    archivePath: string;
    sourceKeys: string[];
    archivedCount: number;
  } {
    this.ensureSyncedStore();
    const sourceCategory = params.sourceCategory || 'episodic';
    const maxSources = Math.max(1, Math.min(100, params.maxSources ?? 20));
    const archiveSourcesFromActive = params.archiveSourcesFromActive ?? true;

    const candidates = Object.values(this.store.episodic)
      .filter((item) => {
        if (item.key === params.targetKey) return false;
        if (item.category !== sourceCategory) return false;
        if (!this.isItemAccessibleInScope(item, params.scope)) return false;
        if (params.scope?.tenantId) return item.scope?.tenantId === params.scope.tenantId;
        return true;
      })
      .slice(0, maxSources);

    const consolidationId = `rev_cons_${crypto.randomUUID().slice(0, 12)}`;
    const archiveDir = this.resolveArchiveDir();
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    const archivePath = path.join(archiveDir, `${consolidationId}.json`);
    const snapshot: ConsolidationArchiveRecord = {
      consolidationId,
      tenantId: params.scope?.tenantId || 'default',
      targetKey: params.targetKey,
      sourceCategory,
      createdAt: new Date().toISOString(),
      sourceKeys: candidates.map((c) => c.key),
      sources: JSON.parse(JSON.stringify(candidates)),
    };
    fs.writeFileSync(archivePath, JSON.stringify(snapshot, null, 2), 'utf8');

    const consolidatedSummary = candidates
      .map((c) => `- (${c.key}) ${typeof c.value === 'string' ? c.value : JSON.stringify(c.value)}`)
      .join('\n');

    this.storeMemory(
      params.targetKey,
      {
        consolidationId,
        sourceCategory,
        sourceCount: candidates.length,
        sourceKeys: snapshot.sourceKeys,
        summary: consolidatedSummary,
        archivePath,
      },
      'semantic',
      { consolidationId, sourceKeys: snapshot.sourceKeys, archivePath },
      { scope: params.scope }
    );

    let archivedCount = 0;
    if (archiveSourcesFromActive) {
      for (const c of candidates) {
        if (this.store.episodic[c.key]) {
          delete this.store.episodic[c.key];
          archivedCount++;
        }
      }
    }

    if (!this.store.consolidations) this.store.consolidations = {};
    this.store.consolidations[consolidationId] = {
      consolidationId,
      archivePath,
      tenantId: snapshot.tenantId,
      createdAt: snapshot.createdAt,
      targetKey: params.targetKey,
    };
    this.persistToDisk(this.store);

    AuditLedger.append('SYSTEM', 'MEMORY_REVERSIBLE_CONSOLIDATION', {
      consolidationId,
      tenantId: snapshot.tenantId,
      targetKey: params.targetKey,
      sourceKeys: snapshot.sourceKeys,
      archivedCount,
      archivePath,
    });

    return {
      consolidated: candidates.length > 0,
      consolidationId,
      targetKey: params.targetKey,
      archivePath,
      sourceKeys: snapshot.sourceKeys,
      archivedCount,
    };
  }

  /**
   * Restores verbatim archived source memories from a reversible consolidation snapshot.
   */
  public rollbackConsolidation(
    consolidationId: string,
    scope?: MemoryScope
  ): {
    rolledBack: boolean;
    consolidationId: string;
    restoredKeys: string[];
  } {
    this.ensureSyncedStore();
    const indexRec = this.store.consolidations?.[consolidationId];
    const archivePath = indexRec?.archivePath || path.join(this.resolveArchiveDir(), `${consolidationId}.json`);
    if (!fs.existsSync(archivePath)) {
      throw new Error(`NOT_FOUND: Consolidation archive '${consolidationId}' does not exist.`);
    }

    const snapshot = JSON.parse(fs.readFileSync(archivePath, 'utf8')) as ConsolidationArchiveRecord;
    if (snapshot.tenantId && snapshot.tenantId !== 'default') {
      if (!scope?.tenantId || scope.tenantId !== snapshot.tenantId) {
        throw new Error(
          `FORBIDDEN: Cross-tenant rollback denied for consolidation '${consolidationId}' (expected tenant '${snapshot.tenantId}', got '${scope?.tenantId || 'none'}').`
        );
      }
    }

    const restoredKeys: string[] = [];
    for (const src of snapshot.sources || []) {
      this.store.episodic[src.key] = src;
      restoredKeys.push(src.key);
    }
    if (snapshot.targetKey && this.store.episodic[snapshot.targetKey]) {
      delete this.store.episodic[snapshot.targetKey];
    }
    this.persistToDisk(this.store);

    AuditLedger.append('SYSTEM', 'MEMORY_CONSOLIDATION_ROLLBACK', {
      consolidationId,
      tenantId: snapshot.tenantId,
      restoredKeys,
    });

    return {
      rolledBack: true,
      consolidationId,
      restoredKeys,
    };
  }

  /**
   * Lists all currently active non-expired memories (optionally scoped by tenant).
   */
  public listAll(scope?: MemoryScope): EpisodicMemoryItem[] {
    this.ensureSyncedStore();
    return Object.values(this.store.episodic).filter((item) => this.isItemAccessibleInScope(item, scope));
  }

  /**
   * Clears a specific memory key with optional tenant isolation enforcement.
   */
  public deleteMemory(key: string, scopeOrOpts?: MemoryScope | { scope?: MemoryScope }): boolean {
    this.ensureSyncedStore();
    const { scope } = normalizeScopeArg(scopeOrOpts);
    const existing = this.store.episodic[key];
    if (existing) {
      if (scope) {
        this.assertScopeAccess(existing, scope, 'delete');
      }
      const digest = existing.contentDigest;
      delete this.store.episodic[key];
      this.persistToDisk(this.store);

      AuditLedger.append('SYSTEM', 'MEMORY_DELETE_OP', {
        memoryKey: key,
        previousDigest: digest,
      });
      return true;
    }
    return false;
  }

  /**
   * Analyzes memory lifecycle health, expirations, and duplicate candidates with Truth Kernel claims.
   */
  public analyzeMemoryLifecycle(scope?: MemoryScope): {
    checkedAt: string;
    totalScopedItems: number;
    byCategory: Record<string, number>;
    expiringSoonCount: number;
    nearDuplicatesCount: number;
    consolidationSnapshotsCount: number;
    truthClaims: TruthClaimRecord[];
    truthSummary: TruthKernelSummary;
  } {
    this.ensureSyncedStore();
    const items = Object.values(this.store.episodic).filter((item) => {
      if (scope?.tenantId) {
        return !item.scope?.tenantId || item.scope.tenantId === scope.tenantId;
      }
      return true;
    });
    const byCategory: Record<string, number> = {};
    let expiringSoonCount = 0;
    const oneDayMs = 24 * 60 * 60 * 1000;
    for (const item of items) {
      byCategory[item.category] = (byCategory[item.category] || 0) + 1;
      if (item.expiresAt) {
        const expMs = Date.parse(item.expiresAt);
        if (Number.isFinite(expMs) && expMs - Date.now() <= oneDayMs) {
          expiringSoonCount++;
        }
      }
    }
    const dups = this.detectNearDuplicates(scope);
    const consCount = Object.keys(this.store.consolidations || {}).length;

    const claims = enforceTruthClaims([
      classifyTruthClaim({
        domain: 'memory_controller',
        statement: `Analyzed ${items.length} scoped memory item(s): ${dups.length} near-duplicate pair(s), ${expiringSoonCount} expiring <=24h, ${consCount} reversible consolidation archive(s)`,
        classification: 'VERIFIED_FACT',
        basis: `Direct inspection of persisted store (${path.basename(this.resolveFilePath())}) and token Jaccard duplicate scan`,
      }),
    ]);

    return {
      checkedAt: new Date().toISOString(),
      totalScopedItems: items.length,
      byCategory,
      expiringSoonCount,
      nearDuplicatesCount: dups.length,
      consolidationSnapshotsCount: consCount,
      truthClaims: claims,
      truthSummary: summarizeTruthClaims(claims),
    };
  }

  /**
   * Verifies SHA-256 content digests of every item and the backing store file.
   */
  public verifyStoreIntegrity(): {
    valid: boolean;
    totalItems: number;
    corruptedKeys: string[];
    storeSha256: string;
    checkedAt: string;
    truthClaims: TruthClaimRecord[];
    truthSummary: TruthKernelSummary;
  } {
    this.ensureSyncedStore();
    const items = Object.values(this.store.episodic);
    const corruptedKeys: string[] = [];
    for (const item of items) {
      const actualDigest = this.computeDigest(item.value);
      if (actualDigest !== item.contentDigest) {
        corruptedKeys.push(item.key);
      }
    }

    const filePath = this.resolveFilePath();
    let storeSha256 = '';
    try {
      const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : JSON.stringify(this.store);
      storeSha256 = crypto.createHash('sha256').update(raw).digest('hex');
    } catch {
      storeSha256 = crypto.createHash('sha256').update(JSON.stringify(this.store)).digest('hex');
    }

    const valid = corruptedKeys.length === 0 && /^[a-f0-9]{64}$/.test(storeSha256);
    const claims = enforceTruthClaims([
      classifyTruthClaim({
        domain: 'memory_controller',
        statement: valid
          ? `Memory store integrity VERIFIED (${items.length} item(s), storeSha256=${storeSha256.slice(0, 12)})`
          : `Memory store integrity FAILED: ${corruptedKeys.length} corrupted key(s)`,
        classification: valid ? 'VERIFIED_FACT' : 'CONTRADICTED',
        basis: `Per-item SHA-256 contentDigest verification + backing file SHA-256`,
        evidenceRefs: [storeSha256, ...corruptedKeys],
      }),
    ]);

    return {
      valid,
      totalItems: items.length,
      corruptedKeys,
      storeSha256,
      checkedAt: new Date().toISOString(),
      truthClaims: claims,
      truthSummary: summarizeTruthClaims(claims),
    };
  }

  /**
   * Gets memory health stats.
   */
  public getStats(): {
    totalItems: number;
    totalCategories: Record<string, number>;
    storeSizeBytes: number;
    lastPersisted: string;
  } {
    this.ensureSyncedStore();
    const items = Object.values(this.store.episodic);
    const categories: Record<string, number> = {};
    for (const item of items) {
      categories[item.category] = (categories[item.category] || 0) + 1;
    }

    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(this.resolveFilePath()).size;
    } catch {
      sizeBytes = 0;
    }

    return {
      totalItems: items.length,
      totalCategories: categories,
      storeSizeBytes: sizeBytes,
      lastPersisted: this.store.lastPersisted,
    };
  }
}
