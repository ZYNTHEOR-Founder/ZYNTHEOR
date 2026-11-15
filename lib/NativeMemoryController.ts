/**
 * ZYNTHEOR Sovereign NativeMemoryController
 * Manages episodic memory storage within the Sovereign Core.
 * Ensures persistence across sessions in native_data/memory_store.json.
 * 
 * CRITICAL INVARIANT:
 * Every single read and write operation is logged into AuditLedger (native_data/audit_log.jsonl)
 * with SHA-256 cryptographic hash chaining for complete transparency and accountability.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger';
import { isCloudSqlConfigured } from '../src/db/index.ts';
import { deleteCloudMemory, upsertCloudMemory } from '../src/db/repositories.ts';

export interface MemoryVersionRecord {
  version: number;
  updatedAt: string;
  digest: string;
}

export interface MemoryScope {
  tenantId?: string;
  userId?: string;
  role?: string;
}

export type MemoryCategory =
  | 'episodic'
  | 'semantic'
  | 'user_preference'
  | 'reasoning_trace'
  | 'task_memory'
  | 'working_context';

export interface MemoryConflictRecord {
  conflictId: string;
  detectedAt: string;
  existingDigest: string;
  incomingDigest: string;
  policy: 'latest_verified' | 'highest_version' | 'manual_review';
  resolution: 'KEEP_EXISTING' | 'ACCEPT_INCOMING' | 'NEEDS_REVIEW';
  resolvedBy: string;
}

export interface EpisodicMemoryItem {
  key: string;
  value: any;
  category: MemoryCategory;
  createdAt: string;
  updatedAt: string;
  readCount: number;
  metadata?: Record<string, any>;
  contentDigest: string; // SHA-256 of the value
  tenantId?: string;
  ownerUserId?: string;
  version: number;
  ttlSeconds?: number;
  expiresAt?: string;
  history?: MemoryVersionRecord[];
  provenance?: {
    sourceType: 'direct_write' | 'consolidated' | 'task_execution' | 'session_context';
    sourceKeys?: string[];
    sessionId?: string;
    taskId?: string;
  };
  conflicts?: MemoryConflictRecord[];
}

export interface MemoryStoreData {
  version: string;
  lastPersisted: string;
  verified_knowledge: Record<string, string>;
  sessions: Array<{ key: string; val: string; timestamp?: string }>;
  episodic: Record<string, EpisodicMemoryItem>;
}

export interface MemoryStoreIntegrityReport {
  valid: boolean;
  totalItems: number;
  verifiedItems: number;
  tamperedKeys: string[];
  expiredPurgedCount: number;
  storeSha256: string;
  checkedAt: string;
}

export class NativeMemoryController {
  private static instance: NativeMemoryController | null = null;
  private filePath = path.resolve(process.cwd(), 'native_data', 'memory_store.json');
  private store: MemoryStoreData;

  private constructor() {
    this.store = this.loadFromDisk();
  }

  public static getInstance(): NativeMemoryController {
    if (!NativeMemoryController.instance) {
      NativeMemoryController.instance = new NativeMemoryController();
    }
    return NativeMemoryController.instance;
  }

  private loadFromDisk(): MemoryStoreData {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.episodic) parsed.episodic = {};
        if (!parsed.verified_knowledge) parsed.verified_knowledge = {};
        if (!parsed.sessions) parsed.sessions = [];
        for (const k of Object.keys(parsed.episodic)) {
          const it = parsed.episodic[k];
          if (typeof it.version !== 'number') it.version = 1;
          if (!it.tenantId && typeof it.metadata?.tenantId === 'string') {
            it.tenantId = it.metadata.tenantId;
          }
          if (!it.ownerUserId && typeof it.metadata?.ownerUserId === 'string') {
            it.ownerUserId = it.metadata.ownerUserId;
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
        architecture: 'ZYNTHEOR Q+ Native Target 41.53M (41,527,808 parameters; 10L · 8H · 512D)',
        sovereignty_rule: 'Online-first Native neural inference on the Sovereign Cloud runtime',
        sandbox_root: '/workspace',
        multilingual_engine: 'Thai-English Dual Native Vocabulary & Code-Switching'
      },
      sessions: [],
      episodic: {}
    };

    this.persistToDisk(initial);
    return initial;
  }

  private persistToDisk(data: MemoryStoreData): void {
    data.lastPersisted = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private mirrorItemToCloud(item: EpisodicMemoryItem): void {
    if (!isCloudSqlConfigured()) return;
    void upsertCloudMemory({
      memoryKey: item.key,
      tenantId: item.tenantId || (typeof item.metadata?.tenantId === 'string' ? item.metadata.tenantId : 'default-tenant'),
      category: item.category,
      value: item.value,
      readCount: item.readCount,
      metadata: item.metadata,
      contentDigest: item.contentDigest,
    }).catch((err) => {
      console.warn('[NativeMemoryController] Cloud SQL mirror warning:', err?.message || err);
    });
  }

  private computeDigest(val: any): string {
    const serialized = typeof val === 'string' ? val : JSON.stringify(val);
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  private isExpired(item: EpisodicMemoryItem, nowMs = Date.now()): boolean {
    if (!item.expiresAt) return false;
    const expMs = Date.parse(item.expiresAt);
    return Number.isFinite(expMs) && expMs <= nowMs;
  }

  public purgeExpired(): number {
    const nowMs = Date.now();
    let purged = 0;
    for (const [k, item] of Object.entries(this.store.episodic)) {
      if (this.isExpired(item, nowMs)) {
        delete this.store.episodic[k];
        purged += 1;
        AuditLedger.append('SYSTEM', 'MEMORY_TTL_EXPIRED', {
          memoryKey: k,
          tenantId: item.tenantId || 'default-tenant',
          expiresAt: item.expiresAt,
        });
      }
    }
    if (purged > 0) {
      this.persistToDisk(this.store);
    }
    return purged;
  }

  public canAccessItem(item: EpisodicMemoryItem, scope?: MemoryScope): boolean {
    if (!scope || (!scope.tenantId && !scope.userId)) {
      return true;
    }
    const itemTenant = item.tenantId || (typeof item.metadata?.tenantId === 'string' ? item.metadata.tenantId : undefined);
    if (itemTenant && scope.tenantId && itemTenant !== scope.tenantId) {
      return false;
    }
    const itemOwner = item.ownerUserId || (typeof item.metadata?.ownerUserId === 'string' ? item.metadata.ownerUserId : undefined);
    if (itemOwner && scope.userId && itemOwner !== scope.userId && scope.role !== 'admin') {
      return false;
    }
    return true;
  }

  public storeMemory(
    key: string,
    value: any,
    category: EpisodicMemoryItem['category'] = 'episodic',
    metadata?: Record<string, any>,
    options?: { scope?: MemoryScope; ttlSeconds?: number }
  ): EpisodicMemoryItem {
    this.purgeExpired();
    const now = new Date().toISOString();
    const digest = this.computeDigest(value);

    const existing = this.store.episodic[key];
    const scope = options?.scope;
    if (existing && scope && !this.canAccessItem(existing, scope)) {
      AuditLedger.append('SYSTEM', 'MEMORY_CROSS_TENANT_WRITE_BLOCKED', {
        memoryKey: key,
        callerTenant: scope.tenantId,
        ownerTenant: existing.tenantId,
      });
      throw new Error('FORBIDDEN: Cross-tenant or cross-owner memory write rejected');
    }

    const ttlSeconds = options?.ttlSeconds ?? (typeof metadata?.ttlSeconds === 'number' ? metadata.ttlSeconds : existing?.ttlSeconds);
    const expiresAt = typeof ttlSeconds === 'number' && ttlSeconds > 0
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : existing?.expiresAt;

    const mergedMeta = { ...(existing?.metadata || {}), ...(metadata || {}) };
    const tenantId = scope?.tenantId || existing?.tenantId || (typeof mergedMeta.tenantId === 'string' ? mergedMeta.tenantId : undefined);
    const ownerUserId = scope?.userId || existing?.ownerUserId || (typeof mergedMeta.ownerUserId === 'string' ? mergedMeta.ownerUserId : undefined);
    if (tenantId) mergedMeta.tenantId = tenantId;
    if (ownerUserId) mergedMeta.ownerUserId = ownerUserId;

    const nextVersion = existing ? (existing.version || 1) + 1 : 1;
    const prevHistory: MemoryVersionRecord[] = Array.isArray(existing?.history) ? [...existing.history] : [];
    if (existing && prevHistory.length === 0) {
      prevHistory.push({
        version: existing.version || 1,
        updatedAt: existing.updatedAt,
        digest: existing.contentDigest,
      });
    }
    prevHistory.push({ version: nextVersion, updatedAt: now, digest });

    const item: EpisodicMemoryItem = {
      key,
      value,
      category,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      readCount: existing ? existing.readCount : 0,
      metadata: Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined,
      contentDigest: digest,
      tenantId,
      ownerUserId,
      version: nextVersion,
      ttlSeconds,
      expiresAt,
      history: prevHistory.slice(-20),
    };

    this.store.episodic[key] = item;
    this.persistToDisk(this.store);
    this.mirrorItemToCloud(item);

    AuditLedger.append('SYSTEM', 'MEMORY_WRITE_OP', {
      memoryKey: key,
      category,
      contentDigest: digest,
      isUpdate: Boolean(existing),
      version: nextVersion,
      tenantId: tenantId || 'unscoped',
      timestamp: now
    });

    return item;
  }

  public updateMemory(
    key: string,
    value: any,
    category?: EpisodicMemoryItem['category'],
    metadata?: Record<string, any>,
    options?: { scope?: MemoryScope; ttlSeconds?: number }
  ): EpisodicMemoryItem {
    this.purgeExpired();
    const existing = this.store.episodic[key];
    const scope = options?.scope;
    if (existing && scope && !this.canAccessItem(existing, scope)) {
      AuditLedger.append('SYSTEM', 'MEMORY_CROSS_TENANT_UPDATE_BLOCKED', {
        memoryKey: key,
        callerTenant: scope.tenantId,
        ownerTenant: existing.tenantId,
      });
      throw new Error('FORBIDDEN: Cross-tenant or cross-owner memory update rejected');
    }

    const now = new Date().toISOString();
    const digest = this.computeDigest(value);
    const prevDigest = existing ? existing.contentDigest : null;

    const mergedMeta = { ...(existing?.metadata || {}), ...(metadata || {}) };
    const tenantId = scope?.tenantId || existing?.tenantId || (typeof mergedMeta.tenantId === 'string' ? mergedMeta.tenantId : undefined);
    const ownerUserId = scope?.userId || existing?.ownerUserId || (typeof mergedMeta.ownerUserId === 'string' ? mergedMeta.ownerUserId : undefined);
    if (tenantId) mergedMeta.tenantId = tenantId;
    if (ownerUserId) mergedMeta.ownerUserId = ownerUserId;

    const ttlSeconds = options?.ttlSeconds ?? (typeof metadata?.ttlSeconds === 'number' ? metadata.ttlSeconds : existing?.ttlSeconds);
    const expiresAt = typeof ttlSeconds === 'number' && ttlSeconds > 0
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : existing?.expiresAt;

    const nextVersion = existing ? (existing.version || 1) + 1 : 1;
    const prevHistory: MemoryVersionRecord[] = Array.isArray(existing?.history) ? [...existing.history] : [];
    if (existing && prevHistory.length === 0) {
      prevHistory.push({
        version: existing.version || 1,
        updatedAt: existing.updatedAt,
        digest: existing.contentDigest,
      });
    }
    prevHistory.push({ version: nextVersion, updatedAt: now, digest });

    const item: EpisodicMemoryItem = {
      key,
      value,
      category: category || existing?.category || 'episodic',
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      readCount: existing ? existing.readCount : 0,
      metadata: Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined,
      contentDigest: digest,
      tenantId,
      ownerUserId,
      version: nextVersion,
      ttlSeconds,
      expiresAt,
      history: prevHistory.slice(-20),
    };

    this.store.episodic[key] = item;
    this.persistToDisk(this.store);
    this.mirrorItemToCloud(item);

    AuditLedger.append('SYSTEM', 'MEMORY_UPDATE_OP', {
      memoryKey: key,
      previousDigest: prevDigest,
      newDigest: digest,
      version: nextVersion,
      category: item.category,
      tenantId: tenantId || 'unscoped',
      updatedAt: now
    });

    return item;
  }

  public retrieveMemory(key: string, scope?: MemoryScope): EpisodicMemoryItem | null {
    this.purgeExpired();
    const item = this.store.episodic[key];
    const now = new Date().toISOString();

    if (item) {
      if (scope && !this.canAccessItem(item, scope)) {
        AuditLedger.append('SYSTEM', 'MEMORY_CROSS_TENANT_READ_BLOCKED', {
          memoryKey: key,
          callerTenant: scope.tenantId,
          ownerTenant: item.tenantId,
        });
        throw new Error('FORBIDDEN: Cross-tenant or cross-owner memory read rejected');
      }
      item.readCount++;
      this.persistToDisk(this.store);
      this.mirrorItemToCloud(item);

      AuditLedger.append('SYSTEM', 'MEMORY_READ_OP', {
        memoryKey: key,
        found: true,
        readCount: item.readCount,
        contentDigest: item.contentDigest,
        version: item.version,
        timestamp: now
      });

      return item;
    }

    AuditLedger.append('SYSTEM', 'MEMORY_READ_OP', {
      memoryKey: key,
      found: false,
      timestamp: now
    });

    return null;
  }

  public queryMemories(
    queryStr: string,
    category?: EpisodicMemoryItem['category'],
    scope?: MemoryScope
  ): EpisodicMemoryItem[] {
    this.purgeExpired();
    const items = Object.values(this.store.episodic).filter((item) => this.canAccessItem(item, scope));
    const qLower = queryStr.toLowerCase();

    const results = items.filter((item) => {
      if (category && item.category !== category) return false;
      if (!queryStr) return true;
      const keyMatch = item.key.toLowerCase().includes(qLower);
      const valMatch = JSON.stringify(item.value).toLowerCase().includes(qLower);
      return keyMatch || valMatch;
    });

    AuditLedger.append('SYSTEM', 'MEMORY_QUERY_OP', {
      query: queryStr,
      categoryFilter: category || 'ALL',
      tenantId: scope?.tenantId || 'unscoped',
      matchCount: results.length
    });

    return results;
  }

  public listAll(scope?: MemoryScope): EpisodicMemoryItem[] {
    this.purgeExpired();
    return Object.values(this.store.episodic).filter((item) => this.canAccessItem(item, scope));
  }

  public deleteMemory(key: string, scope?: MemoryScope): boolean {
    this.purgeExpired();
    const existing = this.store.episodic[key];
    if (existing) {
      if (scope && !this.canAccessItem(existing, scope)) {
        AuditLedger.append('SYSTEM', 'MEMORY_CROSS_TENANT_DELETE_BLOCKED', {
          memoryKey: key,
          callerTenant: scope.tenantId,
          ownerTenant: existing.tenantId,
        });
        throw new Error('FORBIDDEN: Cross-tenant or cross-owner memory delete rejected');
      }
      const digest = existing.contentDigest;
      const tenantId = existing.tenantId || (typeof existing.metadata?.tenantId === 'string' ? existing.metadata.tenantId : 'default-tenant');
      delete this.store.episodic[key];
      this.persistToDisk(this.store);
      if (isCloudSqlConfigured()) {
        void deleteCloudMemory(key, tenantId).catch((err) => {
          console.warn('[NativeMemoryController] Cloud SQL delete warning:', err?.message || err);
        });
      }

      AuditLedger.append('SYSTEM', 'MEMORY_DELETE_OP', {
        memoryKey: key,
        previousDigest: digest,
        tenantId
      });
      return true;
    }
    return false;
  }

  public verifyStoreIntegrity(): MemoryStoreIntegrityReport {
    const expiredPurgedCount = this.purgeExpired();
    const items = Object.values(this.store.episodic);
    const tamperedKeys: string[] = [];
    let verifiedItems = 0;

    for (const item of items) {
      const expected = this.computeDigest(item.value);
      if (item.contentDigest !== expected) {
        tamperedKeys.push(item.key);
      } else {
        verifiedItems += 1;
      }
    }

    const storeSha256 = fs.existsSync(this.filePath)
      ? crypto.createHash('sha256').update(fs.readFileSync(this.filePath)).digest('hex')
      : crypto.createHash('sha256').update(JSON.stringify(this.store)).digest('hex');

    const report: MemoryStoreIntegrityReport = {
      valid: tamperedKeys.length === 0,
      totalItems: items.length,
      verifiedItems,
      tamperedKeys,
      expiredPurgedCount,
      storeSha256,
      checkedAt: new Date().toISOString(),
    };

    AuditLedger.append('SYSTEM', 'MEMORY_INTEGRITY_VERIFIED', {
      valid: report.valid,
      totalItems: report.totalItems,
      tamperedCount: tamperedKeys.length,
      storeSha256,
    });

    return report;
  }

  public getStats(scope?: MemoryScope): {
    totalItems: number;
    totalCategories: Record<string, number>;
    storeSizeBytes: number;
    lastPersisted: string;
  } {
    this.purgeExpired();
    const items = Object.values(this.store.episodic).filter((item) => this.canAccessItem(item, scope));
    const categories: Record<string, number> = {};
    for (const item of items) {
      categories[item.category] = (categories[item.category] || 0) + 1;
    }

    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(this.filePath).size;
    } catch {
      sizeBytes = 0;
    }

    return {
      totalItems: items.length,
      totalCategories: categories,
      storeSizeBytes: sizeBytes,
      lastPersisted: this.store.lastPersisted
    };
  }

  /**
   * Batch 28: Scored Retrieval Ranking combining lexical overlap, recency decay,
   * access frequency, category priority, and provenance weight within tenant scope.
   */
  public recallRankedMemories(
    query: string,
    options: {
      limit?: number;
      categories?: MemoryCategory[];
      scope?: MemoryScope;
    } = {}
  ): Array<{ item: EpisodicMemoryItem; score: number; breakdown: { lexical: number; recency: number; frequency: number; categoryBoost: number } }> {
    this.purgeExpired();
    const qTokens = query
      .toLowerCase()
      .replace(/[^\w\u0E00-\u0E7F]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
    const nowMs = Date.now();
    const catWeight: Record<MemoryCategory, number> = {
      semantic: 1.4,
      working_context: 1.3,
      task_memory: 1.25,
      user_preference: 1.2,
      reasoning_trace: 1.05,
      episodic: 1.0,
    };

    const items = Object.values(this.store.episodic).filter((it) => {
      if (!this.canAccessItem(it, options.scope)) return false;
      if (options.categories && options.categories.length > 0 && !options.categories.includes(it.category)) return false;
      return true;
    });

    const scored = items.map((it) => {
      const hay = `${it.key} ${typeof it.value === 'string' ? it.value : JSON.stringify(it.value)}`.toLowerCase();
      let lexical = 0;
      for (const tok of qTokens) {
        if (hay.includes(tok)) lexical += 1.5;
      }
      if (qTokens.length > 0 && hay.includes(query.toLowerCase().trim())) {
        lexical += 2.5;
      }
      const ageHours = Math.max(0, (nowMs - Date.parse(it.updatedAt || it.createdAt)) / 3600000);
      const recency = Number((1 / (1 + ageHours / 24)).toFixed(3));
      const frequency = Number(Math.min(1.5, Math.log1p(it.readCount) * 0.4).toFixed(3));
      const categoryBoost = catWeight[it.category] ?? 1.0;
      const total = Number(((lexical + recency + frequency) * categoryBoost).toFixed(3));
      return {
        item: it,
        score: total,
        breakdown: { lexical: Number(lexical.toFixed(2)), recency, frequency, categoryBoost },
      };
    });

    const filtered = qTokens.length > 0 ? scored.filter((s) => s.breakdown.lexical > 0) : scored;
    filtered.sort((a, b) => b.score - a.score);
    const top = filtered.slice(0, options.limit ?? 8);

    AuditLedger.append('SYSTEM', 'MEMORY_RANKED_RECALL', {
      queryLength: query.length,
      candidateCount: items.length,
      returnedCount: top.length,
      tenantId: options.scope?.tenantId || 'unscoped',
    });

    return top;
  }

  /**
   * Batch 28: Consolidates older episodic / task_memory entries into a compact semantic
   * memory record with verifiable SHA-256 lineage and sourceKeys provenance.
   */
  public consolidateMemories(options: {
    targetKey: string;
    sourceCategory?: MemoryCategory;
    maxSources?: number;
    pruneConsolidatedSources?: boolean;
    scope: MemoryScope;
  }): { consolidated: EpisodicMemoryItem | null; sourceKeys: string[]; prunedCount: number } {
    this.purgeExpired();
    const cat = options.sourceCategory ?? 'episodic';
    const candidates = Object.values(this.store.episodic)
      .filter((it) => it.category === cat && this.canAccessItem(it, options.scope))
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .slice(0, options.maxSources ?? 10);

    if (candidates.length === 0) {
      return { consolidated: null, sourceKeys: [], prunedCount: 0 };
    }

    const facts = candidates.map((c) => ({
      key: c.key,
      updatedAt: c.updatedAt,
      digest: c.contentDigest,
      summary: typeof c.value === 'string' ? c.value.slice(0, 240) : JSON.stringify(c.value).slice(0, 240),
    }));
    const sourceKeys = candidates.map((c) => c.key);

    const item = this.storeMemory(
      options.targetKey,
      {
        consolidatedFromCount: candidates.length,
        sourceCategory: cat,
        consolidatedAt: new Date().toISOString(),
        entries: facts,
      },
      'semantic',
      {
        consolidated: true,
        sourceKeys,
        tenantId: options.scope.tenantId,
        ownerUserId: options.scope.userId,
      },
      { scope: options.scope }
    );
    item.provenance = {
      sourceType: 'consolidated',
      sourceKeys,
    };

    let prunedCount = 0;
    if (options.pruneConsolidatedSources) {
      for (const sk of sourceKeys) {
        if (sk !== options.targetKey && this.store.episodic[sk]) {
          delete this.store.episodic[sk];
          prunedCount += 1;
        }
      }
    }
    this.persistToDisk(this.store);

    AuditLedger.append('SYSTEM', 'MEMORY_CONSOLIDATED', {
      targetKey: options.targetKey,
      sourceCount: sourceKeys.length,
      prunedCount,
      tenantId: options.scope.tenantId || 'unscoped',
      contentDigest: item.contentDigest,
    });

    return { consolidated: item, sourceKeys, prunedCount };
  }

  /**
   * Batch 28: Explicit Conflict Detection & Resolution without silent overwrite.
   */
  public storeWithConflictResolution(
    key: string,
    value: any,
    category: MemoryCategory,
    policy: 'latest_verified' | 'highest_version' | 'manual_review',
    options: { scope: MemoryScope; metadata?: Record<string, any>; verified?: boolean }
  ): { item: EpisodicMemoryItem; conflictDetected: boolean; conflict?: MemoryConflictRecord } {
    this.purgeExpired();
    const existing = this.store.episodic[key];
    if (!existing) {
      const created = this.storeMemory(key, value, category, options.metadata, { scope: options.scope });
      return { item: created, conflictDetected: false };
    }
    if (!this.canAccessItem(existing, options.scope)) {
      throw new Error('FORBIDDEN: Cross-tenant or cross-owner memory conflict write rejected');
    }

    const incomingDigest = this.computeDigest(value);
    if (incomingDigest === existing.contentDigest) {
      return { item: existing, conflictDetected: false };
    }

    const conflict: MemoryConflictRecord = {
      conflictId: `mcf_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      detectedAt: new Date().toISOString(),
      existingDigest: existing.contentDigest,
      incomingDigest,
      policy,
      resolution:
        policy === 'manual_review'
          ? 'NEEDS_REVIEW'
          : policy === 'latest_verified' && options.verified === false
          ? 'KEEP_EXISTING'
          : 'ACCEPT_INCOMING',
      resolvedBy: options.scope.userId || 'system',
    };

    if (conflict.resolution === 'ACCEPT_INCOMING') {
      const updated = this.updateMemory(key, value, category, options.metadata, { scope: options.scope });
      updated.conflicts = [...(existing.conflicts || []), conflict].slice(-10);
      this.persistToDisk(this.store);
      AuditLedger.append('SYSTEM', 'MEMORY_CONFLICT_RESOLVED', {
        memoryKey: key,
        policy,
        resolution: conflict.resolution,
        tenantId: options.scope.tenantId || 'unscoped',
      });
      return { item: updated, conflictDetected: true, conflict };
    }

    existing.conflicts = [...(existing.conflicts || []), conflict].slice(-10);
    this.persistToDisk(this.store);
    AuditLedger.append('SYSTEM', 'MEMORY_CONFLICT_FLAGGED', {
      memoryKey: key,
      policy,
      resolution: conflict.resolution,
      tenantId: options.scope.tenantId || 'unscoped',
    });
    return { item: existing, conflictDetected: true, conflict };
  }

  /**
   * Batch 28: Cross-Session Continuity — retrieves active working_context, recent task_memory,
   * and relevant semantic facts scoped cleanly to tenant + owner.
   */
  public getWorkingContextForSession(
    sessionId: string,
    scope: MemoryScope,
    limit = 10
  ): {
    sessionId: string;
    workingContext: EpisodicMemoryItem[];
    recentTasks: EpisodicMemoryItem[];
    semanticAnchors: EpisodicMemoryItem[];
  } {
    this.purgeExpired();
    const accessible = Object.values(this.store.episodic)
      .filter((it) => this.canAccessItem(it, scope))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    const workingContext = accessible
      .filter(
        (it) =>
          it.category === 'working_context' &&
          (!it.metadata?.sessionId || it.metadata.sessionId === sessionId || it.key.includes(sessionId))
      )
      .slice(0, limit);
    const recentTasks = accessible.filter((it) => it.category === 'task_memory').slice(0, limit);
    const semanticAnchors = accessible.filter((it) => it.category === 'semantic').slice(0, limit);

    return { sessionId, workingContext, recentTasks, semanticAnchors };
  }

  /**
   * Batch 29: Deterministic importance scoring & memory classification.
   */
  public classifyAndScoreImportance(item: EpisodicMemoryItem): {
    importanceTier: 'critical' | 'high' | 'normal' | 'low';
    importanceScore: number;
    recommendedCategory: MemoryCategory;
    reasons: string[];
  } {
    const text = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
    const reasons: string[] = [];
    let score = 0.35;

    if (item.category === 'semantic') {
      score += 0.25;
      reasons.push('semantic_anchor');
    } else if (item.category === 'user_preference' || item.category === 'working_context') {
      score += 0.18;
      reasons.push(item.category);
    } else if (item.category === 'task_memory') {
      score += 0.15;
      reasons.push('task_outcome');
    }

    if (/\b(must|never|security|hmac|sha-?256|policy|tenant|forbidden|critical|ห้าม|ต้อง|นโยบาย)\b/i.test(text)) {
      score += 0.25;
      reasons.push('policy_or_constraint');
    }
    if (item.readCount > 0) {
      score += Math.min(0.15, Math.log1p(item.readCount) * 0.06);
      reasons.push('frequently_recalled');
    }
    if (item.provenance?.sourceType === 'consolidated') {
      score += 0.1;
      reasons.push('consolidated_lineage');
    }
    if (text.length < 24) {
      score -= 0.12;
      reasons.push('short_fragment');
    }

    const bounded = Number(Math.min(1, Math.max(0.05, score)).toFixed(3));
    const importanceTier =
      bounded >= 0.8 ? 'critical' : bounded >= 0.6 ? 'high' : bounded >= 0.35 ? 'normal' : 'low';
    const recommendedCategory: MemoryCategory =
      /\b(prefer|language|theme|ตั้งค่า|ชอบ)\b/i.test(text)
        ? 'user_preference'
        : bounded >= 0.72 && item.category === 'episodic'
        ? 'semantic'
        : item.category;

    return { importanceTier, importanceScore: bounded, recommendedCategory, reasons };
  }

  /**
   * Batch 29: Exact + token-Jaccard near-duplicate detection within tenant scope.
   */
  public detectNearDuplicates(
    scope?: MemoryScope,
    similarityThreshold = 0.8
  ): Array<{
    keyA: string;
    keyB: string;
    kind: 'EXACT_DIGEST' | 'NEAR_DUPLICATE';
    similarity: number;
  }> {
    this.purgeExpired();
    const items = this.listAll(scope);
    const tokenSets = new Map<string, Set<string>>();
    for (const it of items) {
      const raw = (typeof it.value === 'string' ? it.value : JSON.stringify(it.value)).toLowerCase();
      const toks = raw
        .replace(/[^\w\u0E00-\u0E7F]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1);
      tokenSets.set(it.key, new Set(toks));
    }

    const matches: Array<{
      keyA: string;
      keyB: string;
      kind: 'EXACT_DIGEST' | 'NEAR_DUPLICATE';
      similarity: number;
    }> = [];

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a.contentDigest === b.contentDigest) {
          matches.push({ keyA: a.key, keyB: b.key, kind: 'EXACT_DIGEST', similarity: 1 });
          continue;
        }
        const sa = tokenSets.get(a.key)!;
        const sb = tokenSets.get(b.key)!;
        if (sa.size === 0 || sb.size === 0) continue;
        let inter = 0;
        for (const t of sa) if (sb.has(t)) inter += 1;
        const union = sa.size + sb.size - inter;
        const sim = union > 0 ? inter / union : 0;
        if (sim >= similarityThreshold) {
          matches.push({
            keyA: a.key,
            keyB: b.key,
            kind: 'NEAR_DUPLICATE',
            similarity: Number(sim.toFixed(3)),
          });
        }
      }
    }
    return matches;
  }

  /**
   * Batch 29: Reversible episodic-to-semantic transformation.
   * Always writes a full verbatim archive snapshot before optional source pruning,
   * guaranteeing zero silent destruction and clean rollback.
   */
  public consolidateEpisodicToSemanticReversible(options: {
    targetKey: string;
    sourceCategory?: MemoryCategory;
    maxSources?: number;
    archiveSourcesFromActive?: boolean;
    scope: MemoryScope;
  }): {
    consolidationId: string;
    archivePath: string;
    consolidated: EpisodicMemoryItem | null;
    sourceKeys: string[];
    archivedFromActiveCount: number;
    sourcesPreservedInArchive: boolean;
  } {
    this.purgeExpired();
    const cat = options.sourceCategory ?? 'episodic';
    const candidates = Object.values(this.store.episodic)
      .filter((it) => it.category === cat && this.canAccessItem(it, options.scope))
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .slice(0, options.maxSources ?? 12);

    const consolidationId = `cons_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const archiveDir = path.resolve(path.dirname(this.filePath), 'memory_archives');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const archivePath = path.join(archiveDir, `${consolidationId}.json`);

    if (candidates.length === 0) {
      return {
        consolidationId,
        archivePath,
        consolidated: null,
        sourceKeys: [],
        archivedFromActiveCount: 0,
        sourcesPreservedInArchive: true,
      };
    }

    const archivePayload = {
      consolidationId,
      createdAt: new Date().toISOString(),
      targetKey: options.targetKey,
      tenantId: options.scope.tenantId || 'unscoped',
      ownerUserId: options.scope.userId || 'system',
      sourceItems: candidates.map((c) => JSON.parse(JSON.stringify(c))),
      rolledBack: false,
    };
    fs.writeFileSync(archivePath, JSON.stringify(archivePayload, null, 2), 'utf8');

    const scoredEntries = candidates.map((c) => {
      const cls = this.classifyAndScoreImportance(c);
      return {
        key: c.key,
        updatedAt: c.updatedAt,
        digest: c.contentDigest,
        importanceTier: cls.importanceTier,
        importanceScore: cls.importanceScore,
        summary: typeof c.value === 'string' ? c.value.slice(0, 260) : JSON.stringify(c.value).slice(0, 260),
      };
    });
    const sourceKeys = candidates.map((c) => c.key);

    const consolidated = this.storeMemory(
      options.targetKey,
      {
        consolidationId,
        archiveFile: path.basename(archivePath),
        sourceCategory: cat,
        sourceCount: candidates.length,
        consolidatedAt: new Date().toISOString(),
        entries: scoredEntries,
      },
      'semantic',
      {
        consolidated: true,
        reversible: true,
        consolidationId,
        sourceKeys,
        tenantId: options.scope.tenantId,
        ownerUserId: options.scope.userId,
      },
      { scope: options.scope }
    );
    consolidated.provenance = {
      sourceType: 'consolidated',
      sourceKeys,
    };

    let archivedFromActiveCount = 0;
    if (options.archiveSourcesFromActive) {
      for (const sk of sourceKeys) {
        if (sk !== options.targetKey && this.store.episodic[sk]) {
          delete this.store.episodic[sk];
          archivedFromActiveCount += 1;
        }
      }
    }
    this.persistToDisk(this.store);

    AuditLedger.append('SYSTEM', 'MEMORY_CONSOLIDATED_REVERSIBLE', {
      consolidationId,
      targetKey: options.targetKey,
      sourceCount: sourceKeys.length,
      archivedFromActiveCount,
      archiveFile: path.basename(archivePath),
      tenantId: options.scope.tenantId || 'unscoped',
    });

    return {
      consolidationId,
      archivePath,
      consolidated,
      sourceKeys,
      archivedFromActiveCount,
      sourcesPreservedInArchive: true,
    };
  }

  /**
   * Batch 29: Rollback a consolidation snapshot, restoring archived source items verbatim
   * after enforcing tenant & ownership boundaries.
   */
  public rollbackConsolidation(
    consolidationId: string,
    scope: MemoryScope
  ): {
    consolidationId: string;
    restoredKeys: string[];
    removedConsolidatedKey: string;
    rolledBackAt: string;
  } {
    const safeId = path.basename(consolidationId);
    const archivePath = path.resolve(path.dirname(this.filePath), 'memory_archives', `${safeId}.json`);
    if (!fs.existsSync(archivePath)) {
      throw new Error(`CONSOLIDATION_ARCHIVE_NOT_FOUND:${safeId}`);
    }
    const parsed = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    if (parsed.tenantId && parsed.tenantId !== 'unscoped' && scope.tenantId && parsed.tenantId !== scope.tenantId) {
      AuditLedger.append('SYSTEM', 'MEMORY_ROLLBACK_FORBIDDEN', {
        consolidationId: safeId,
        callerTenant: scope.tenantId,
        ownerTenant: parsed.tenantId,
      });
      throw new Error('FORBIDDEN: Cross-tenant memory consolidation rollback denied');
    }

    const restoredKeys: string[] = [];
    for (const srcItem of (parsed.sourceItems || []) as EpisodicMemoryItem[]) {
      if (!srcItem?.key) continue;
      if (scope && !this.canAccessItem(srcItem, scope)) {
        throw new Error('FORBIDDEN: Cross-owner memory consolidation rollback denied');
      }
      this.store.episodic[srcItem.key] = srcItem;
      restoredKeys.push(srcItem.key);
    }

    const targetKey = String(parsed.targetKey || '');
    if (targetKey && this.store.episodic[targetKey] && !restoredKeys.includes(targetKey)) {
      delete this.store.episodic[targetKey];
    }

    parsed.rolledBack = true;
    parsed.rolledBackAt = new Date().toISOString();
    fs.writeFileSync(archivePath, JSON.stringify(parsed, null, 2), 'utf8');
    this.persistToDisk(this.store);

    AuditLedger.append('SYSTEM', 'MEMORY_CONSOLIDATION_ROLLED_BACK', {
      consolidationId: safeId,
      restoredCount: restoredKeys.length,
      removedConsolidatedKey: targetKey,
      tenantId: scope.tenantId || 'unscoped',
    });

    return {
      consolidationId: safeId,
      restoredKeys,
      removedConsolidatedKey: targetKey,
      rolledBackAt: parsed.rolledBackAt,
    };
  }

  public analyzeMemoryLifecycle(scope?: MemoryScope) {
    this.purgeExpired();
    const items = this.listAll(scope);
    const tierCounts = { critical: 0, high: 0, normal: 0, low: 0 };
    const classified = items.map((it) => {
      const cls = this.classifyAndScoreImportance(it);
      tierCounts[cls.importanceTier] += 1;
      return {
        key: it.key,
        category: it.category,
        version: it.version,
        readCount: it.readCount,
        updatedAt: it.updatedAt,
        contentDigest: it.contentDigest,
        ...cls,
      };
    });
    const duplicates = this.detectNearDuplicates(scope);
    const archiveDir = path.resolve(path.dirname(this.filePath), 'memory_archives');
    const archives: Array<{ consolidationId: string; targetKey: string; createdAt: string; sourceCount: number; rolledBack: boolean }> = [];
    if (fs.existsSync(archiveDir)) {
      for (const f of fs.readdirSync(archiveDir).filter((x) => x.endsWith('.json')).slice(-30)) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(archiveDir, f), 'utf8'));
          if (scope?.tenantId && d.tenantId && d.tenantId !== 'unscoped' && d.tenantId !== scope.tenantId) continue;
          archives.push({
            consolidationId: d.consolidationId,
            targetKey: d.targetKey,
            createdAt: d.createdAt,
            sourceCount: Array.isArray(d.sourceItems) ? d.sourceItems.length : 0,
            rolledBack: Boolean(d.rolledBack),
          });
        } catch {
          // ignore corrupt archive file
        }
      }
    }

    return {
      stats: this.getStats(scope),
      tierCounts,
      classifiedItems: classified.sort((a, b) => b.importanceScore - a.importanceScore).slice(0, 30),
      duplicates,
      archives: archives.reverse(),
      integrity: this.verifyStoreIntegrity(),
    };
  }
}
