/**
 * ZYNTHEOR Batch 29 — Self-Adaptive Performance Engine
 *
 * Evidence-driven profiling, bottleneck detection, tenant-safe caching,
 * strategy performance comparison, regression detection, and reversible optimization.
 *
 * Invariants:
 *  - Every optimization records an explicit pre-change snapshot for rollback.
 *  - Caching is strictly tenant-scoped and invalidated on corpus/memory mutations.
 *  - Never trades correctness, security, or data integrity for speed.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { performance } from 'perf_hooks';
import { AuditLedger } from './AuditLedger.ts';

export interface PerformanceSample {
  sampleId: string;
  operation: string;
  strategy?: string;
  tenantId: string;
  durationMs: number;
  heapDeltaKb: number;
  cacheHit: boolean;
  succeeded: boolean;
  accuracyScore?: number;
  timestamp: string;
}

export interface AdaptiveConfigParameters {
  retrievalLimit: number;
  contextMaxChars: number;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  batchSize: number;
  multiPathMaxCandidates: number;
  graphMaxHops: number;
}

export interface OptimizationSnapshot {
  snapshotId: string;
  createdAt: string;
  appliedBy: string;
  reason: string;
  previousConfig: AdaptiveConfigParameters;
  newConfig: AdaptiveConfigParameters;
  baselineAvgMs: number | null;
  rolledBack: boolean;
  rolledBackAt?: string;
}

export interface BottleneckFinding {
  operation: string;
  sampleCount: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  severity: 'nominal' | 'elevated' | 'bottleneck';
  recommendation: string;
}

interface CacheEntry<T = unknown> {
  key: string;
  tenantId: string;
  namespace: string;
  value: T;
  createdAtMs: number;
  expiresAtMs: number;
  hits: number;
}

const DEFAULT_CONFIG: AdaptiveConfigParameters = {
  retrievalLimit: 5,
  contextMaxChars: 1200,
  cacheEnabled: true,
  cacheTtlMs: 30_000,
  batchSize: 8,
  multiPathMaxCandidates: 3,
  graphMaxHops: 2,
};

export class PerformanceEngine {
  private static instance: PerformanceEngine | null = null;
  private filePath: string;
  private config: AdaptiveConfigParameters = { ...DEFAULT_CONFIG };
  private samples: PerformanceSample[] = [];
  private snapshots: OptimizationSnapshot[] = [];
  private cache = new Map<string, CacheEntry>();
  private cacheStats = { hits: 0, misses: 0, invalidations: 0, timeSavedMs: 0 };

  private constructor() {
    this.filePath = process.env.ZYNTHEOR_PERF_FILE
      ? path.resolve(process.env.ZYNTHEOR_PERF_FILE)
      : path.resolve(process.cwd(), 'native_data', 'performance_profiles.json');
    this.loadFromDisk();
  }

  public static getInstance(): PerformanceEngine {
    if (!PerformanceEngine.instance) {
      PerformanceEngine.instance = new PerformanceEngine();
    }
    return PerformanceEngine.instance;
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private loadFromDisk(): void {
    try {
      this.ensureDir();
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed?.config) this.config = { ...DEFAULT_CONFIG, ...parsed.config };
      if (Array.isArray(parsed?.samples)) this.samples = parsed.samples.slice(-500);
      if (Array.isArray(parsed?.snapshots)) this.snapshots = parsed.snapshots.slice(0, 100);
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  private persist(): void {
    this.ensureDir();
    const tmp = `${this.filePath}.tmp.${process.pid}`;
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        {
          version: 'ZYNTHEOR_PERF_V1',
          updatedAt: new Date().toISOString(),
          config: this.config,
          samples: this.samples.slice(-400),
          snapshots: this.snapshots.slice(0, 100),
          cacheStats: this.cacheStats,
        },
        null,
        2
      ),
      'utf8'
    );
    fs.renameSync(tmp, this.filePath);
  }

  public getConfig(): AdaptiveConfigParameters {
    return { ...this.config };
  }

  public async profileAsync<T>(
    meta: { operation: string; strategy?: string; tenantId?: string; cacheHit?: boolean },
    fn: () => Promise<{ result: T; succeeded?: boolean; accuracyScore?: number }>
  ): Promise<{ result: T; durationMs: number; heapDeltaKb: number }> {
    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    let succeeded = true;
    let accuracyScore: number | undefined;
    try {
      const out = await fn();
      succeeded = out.succeeded ?? true;
      accuracyScore = out.accuracyScore;
      const durationMs = Number((performance.now() - t0).toFixed(3));
      const heapDeltaKb = Number(((process.memoryUsage().heapUsed - heapBefore) / 1024).toFixed(2));
      this.recordSample({
        operation: meta.operation,
        strategy: meta.strategy,
        tenantId: meta.tenantId || 'default-tenant',
        durationMs,
        heapDeltaKb,
        cacheHit: Boolean(meta.cacheHit),
        succeeded,
        accuracyScore,
      });
      return { result: out.result, durationMs, heapDeltaKb };
    } catch (err) {
      const durationMs = Number((performance.now() - t0).toFixed(3));
      const heapDeltaKb = Number(((process.memoryUsage().heapUsed - heapBefore) / 1024).toFixed(2));
      this.recordSample({
        operation: meta.operation,
        strategy: meta.strategy,
        tenantId: meta.tenantId || 'default-tenant',
        durationMs,
        heapDeltaKb,
        cacheHit: Boolean(meta.cacheHit),
        succeeded: false,
      });
      throw err;
    }
  }

  public recordSample(input: Omit<PerformanceSample, 'sampleId' | 'timestamp'>): PerformanceSample {
    const rec: PerformanceSample = {
      sampleId: `perf_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...input,
    };
    this.samples.push(rec);
    if (this.samples.length > 500) {
      this.samples = this.samples.slice(-500);
    }
    this.persist();
    return rec;
  }

  /**
   * Tenant-isolated verified cache lookup. Never leaks entries across tenants.
   */
  public getCached<T>(namespace: string, tenantId: string, rawKey: string): T | null {
    if (!this.config.cacheEnabled) {
      this.cacheStats.misses += 1;
      return null;
    }
    const scopedKey = `${tenantId}::${namespace}::${crypto.createHash('sha256').update(rawKey).digest('hex')}`;
    const entry = this.cache.get(scopedKey);
    const now = Date.now();
    if (!entry || entry.tenantId !== tenantId || entry.expiresAtMs <= now) {
      if (entry && entry.expiresAtMs <= now) this.cache.delete(scopedKey);
      this.cacheStats.misses += 1;
      return null;
    }
    entry.hits += 1;
    this.cacheStats.hits += 1;
    this.cacheStats.timeSavedMs += 2;
    return entry.value as T;
  }

  public setCached<T>(namespace: string, tenantId: string, rawKey: string, value: T): void {
    if (!this.config.cacheEnabled) return;
    const scopedKey = `${tenantId}::${namespace}::${crypto.createHash('sha256').update(rawKey).digest('hex')}`;
    const now = Date.now();
    this.cache.set(scopedKey, {
      key: scopedKey,
      tenantId,
      namespace,
      value,
      createdAtMs: now,
      expiresAtMs: now + this.config.cacheTtlMs,
      hits: 0,
    });
    if (this.cache.size > 400) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }

  public invalidateTenantNamespace(tenantId: string, namespace?: string): number {
    let removed = 0;
    for (const [k, entry] of this.cache.entries()) {
      if (entry.tenantId === tenantId && (!namespace || entry.namespace === namespace)) {
        this.cache.delete(k);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.cacheStats.invalidations += removed;
    }
    return removed;
  }

  public detectBottlenecks(operationFilter?: string): BottleneckFinding[] {
    const byOp = new Map<string, number[]>();
    for (const s of this.samples) {
      if (operationFilter && s.operation !== operationFilter) continue;
      const arr = byOp.get(s.operation) || [];
      arr.push(s.durationMs);
      byOp.set(s.operation, arr);
    }

    const findings: BottleneckFinding[] = [];
    for (const [op, durations] of byOp.entries()) {
      const sorted = [...durations].sort((a, b) => a - b);
      const avgMs = Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2));
      const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      const p95Ms = Number(sorted[p95Idx].toFixed(2));
      const maxMs = Number(sorted[sorted.length - 1].toFixed(2));

      let severity: BottleneckFinding['severity'] = 'nominal';
      let recommendation = 'Latency within nominal operating envelope.';
      if (p95Ms > 250) {
        severity = 'bottleneck';
        recommendation = `Consider enabling cache, tightening retrievalLimit (${this.config.retrievalLimit}), or bounding contextMaxChars (${this.config.contextMaxChars}).`;
      } else if (p95Ms > 80) {
        severity = 'elevated';
        recommendation = `Monitor ${op}; candidate for batch-size or cache-TTL tuning.`;
      }
      findings.push({
        operation: op,
        sampleCount: sorted.length,
        avgMs,
        p95Ms,
        maxMs,
        severity,
        recommendation,
      });
    }

    return findings.sort((a, b) => b.p95Ms - a.p95Ms);
  }

  public compareStrategies(): Array<{
    strategy: string;
    calls: number;
    successRatePct: number;
    avgDurationMs: number;
    avgAccuracy: number | null;
  }> {
    const groups = new Map<string, PerformanceSample[]>();
    for (const s of this.samples) {
      if (!s.strategy) continue;
      const list = groups.get(s.strategy) || [];
      list.push(s);
      groups.set(s.strategy, list);
    }

    return Array.from(groups.entries())
      .map(([strategy, list]) => {
        const okCount = list.filter((x) => x.succeeded).length;
        const avgDurationMs = Number((list.reduce((a, x) => a + x.durationMs, 0) / list.length).toFixed(2));
        const accList = list.map((x) => x.accuracyScore).filter((v): v is number => typeof v === 'number');
        const avgAccuracy =
          accList.length > 0 ? Number((accList.reduce((a, b) => a + b, 0) / accList.length).toFixed(3)) : null;
        return {
          strategy,
          calls: list.length,
          successRatePct: Number(((okCount / list.length) * 100).toFixed(1)),
          avgDurationMs,
          avgAccuracy,
        };
      })
      .sort((a, b) => b.successRatePct - a.successRatePct || a.avgDurationMs - b.avgDurationMs);
  }

  /**
   * Reversible adaptive tuning with bounded safety limits.
   * Rejects unsafe settings that could compromise completeness or isolation.
   */
  public applyOptimization(params: {
    updates: Partial<AdaptiveConfigParameters>;
    reason: string;
    appliedBy: string;
  }): OptimizationSnapshot {
    const prev = { ...this.config };
    const next: AdaptiveConfigParameters = {
      retrievalLimit: Math.min(20, Math.max(2, Math.round(params.updates.retrievalLimit ?? prev.retrievalLimit))),
      contextMaxChars: Math.min(8000, Math.max(400, Math.round(params.updates.contextMaxChars ?? prev.contextMaxChars))),
      cacheEnabled: params.updates.cacheEnabled ?? prev.cacheEnabled,
      cacheTtlMs: Math.min(300_000, Math.max(1_000, Math.round(params.updates.cacheTtlMs ?? prev.cacheTtlMs))),
      batchSize: Math.min(64, Math.max(1, Math.round(params.updates.batchSize ?? prev.batchSize))),
      multiPathMaxCandidates: Math.min(8, Math.max(1, Math.round(params.updates.multiPathMaxCandidates ?? prev.multiPathMaxCandidates))),
      graphMaxHops: Math.min(4, Math.max(1, Math.round(params.updates.graphMaxHops ?? prev.graphMaxHops))),
    };

    const avgMs =
      this.samples.length > 0
        ? Number((this.samples.reduce((a, s) => a + s.durationMs, 0) / this.samples.length).toFixed(2))
        : null;

    const snap: OptimizationSnapshot = {
      snapshotId: `opt_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      createdAt: new Date().toISOString(),
      appliedBy: params.appliedBy,
      reason: params.reason,
      previousConfig: prev,
      newConfig: next,
      baselineAvgMs: avgMs,
      rolledBack: false,
    };

    this.config = next;
    if (!next.cacheEnabled) {
      this.cache.clear();
    }
    this.snapshots.unshift(snap);
    this.persist();

    AuditLedger.append('SYSTEM', 'PERFORMANCE_OPTIMIZATION_APPLIED', {
      snapshotId: snap.snapshotId,
      appliedBy: params.appliedBy,
      reason: params.reason,
    });

    return snap;
  }

  public rollbackOptimization(snapshotId: string, actor: string): OptimizationSnapshot {
    const snap = this.snapshots.find((s) => s.snapshotId === snapshotId);
    if (!snap) {
      throw new Error(`Optimization snapshot '${snapshotId}' not found`);
    }
    if (snap.rolledBack) {
      throw new Error(`Optimization snapshot '${snapshotId}' already rolled back`);
    }
    this.config = { ...snap.previousConfig };
    snap.rolledBack = true;
    snap.rolledBackAt = new Date().toISOString();
    this.cache.clear();
    this.persist();

    AuditLedger.append('SYSTEM', 'PERFORMANCE_OPTIMIZATION_ROLLED_BACK', {
      snapshotId,
      actor,
    });

    return snap;
  }

  public evaluateCachePolicy(): {
    cacheEnabled: boolean;
    entriesCount: number;
    hits: number;
    misses: number;
    hitRatePct: number;
    invalidations: number;
    estimatedTimeSavedMs: number;
  } {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return {
      cacheEnabled: this.config.cacheEnabled,
      entriesCount: this.cache.size,
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      hitRatePct: total > 0 ? Number(((this.cacheStats.hits / total) * 100).toFixed(1)) : 0,
      invalidations: this.cacheStats.invalidations,
      estimatedTimeSavedMs: this.cacheStats.timeSavedMs,
    };
  }

  public getTelemetry() {
    const bottlenecks = this.detectBottlenecks();
    const recent = this.samples.slice(-50);
    const avgLatencyMs =
      recent.length > 0 ? Number((recent.reduce((a, s) => a + s.durationMs, 0) / recent.length).toFixed(2)) : 0;
    const regressionDetected = bottlenecks.some((b) => b.severity === 'bottleneck');

    return {
      config: this.getConfig(),
      totalSamples: this.samples.length,
      recentAvgLatencyMs: avgLatencyMs,
      bottlenecks,
      strategies: this.compareStrategies(),
      cachePolicy: this.evaluateCachePolicy(),
      snapshots: this.snapshots.slice(0, 15),
      regressionDetected,
    };
  }
}
