import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from 'recharts';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusDot } from '../ui/StatusBadge';
import {
  SystemStatusData,
  AuditRecord,
  ExecutionMetricsSummary,
  ExecutionCycleSummary,
  PersistentTaskRecord,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
import {
  Activity,
  Clock,
  CheckCircle2,
  Cpu,
  ShieldCheck,
  RefreshCw,
  DollarSign,
  BarChart3,
  TrendingUp,
  Play,
  RotateCcw,
  Layers,
  Database,
  Wrench,
} from 'lucide-react';

interface AnalyticsBIProps {
  statusData: SystemStatusData | null;
}

interface PerformancePoint {
  id: string;
  label: string;
  timestampIso: string;
  goal: string;
  runtime: string;
  outcome: 'DELIVERED' | 'BLOCKED' | 'FAILED';
  successFlag: number; // 100 or 0
  cumulativeSuccessRatePct: number;
  rollingSuccessRatePct: number;
  testPassRatePct: number | null;
  testsPassed: number;
  testsTotal: number;
  durationMs: number | null;
  rollingAvgLatencyMs: number | null;
  repairs: number;
  source: 'cycle' | 'task' | 'audit';
}

type WindowFilter = 'all' | '25' | '10';
type LatencyMode = 'execution' | 'inference';

const ROLE_COLORS: Record<string, string> = {
  PLANNER: '#00F0FF',
  CODER: '#2563EB',
  TESTER: '#CCFF00',
  REVIEWER: '#C084FC',
  GOVERNANCE: '#FF007F',
  EVOLVER: '#FF5E3A',
  SYSTEM: '#38BDF8',
  COMMERCIAL: '#A855F7',
};

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : Math.round(sorted[mid]);
}

export const AnalyticsBI: React.FC<AnalyticsBIProps> = ({ statusData }) => {
  const { authHeaders, authReady, isAuthenticated, role } = useAuth();
  const comm = statusData?.commercial;

  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [execMetrics, setExecMetrics] = useState<ExecutionMetricsSummary | null>(null);
  const [cycles, setCycles] = useState<ExecutionCycleSummary[]>([]);
  const [tasks, setTasks] = useState<PersistentTaskRecord[]>([]);
  const [adminTelemetryRestricted, setAdminTelemetryRestricted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [windowFilter, setWindowFilter] = useState<WindowFilter>('all');
  const [latencyMode, setLatencyMode] = useState<LatencyMode>('execution');
  const [opsTelemetry, setOpsTelemetry] = useState<any | null>(null);
  const [runningBench, setRunningBench] = useState(false);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [opsActionError, setOpsActionError] = useState<string | null>(null);

  const fetchPerformanceData = useCallback(async () => {
    if (!authReady || !isAuthenticated) return;
    setLoading(true);
    const headers = authHeaders();
    const canQueryAdmin = role === 'Administrator';

    try {
      const requests: Array<Promise<any>> = [
        fetch(apiUrl('/api/audit?limit=150'), { headers }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
        fetch(apiUrl('/api/agent/tasks'), { headers }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
      ];

      if (canQueryAdmin) {
        requests.push(
          fetch(apiUrl('/api/agent/metrics'), { headers }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
          fetch(apiUrl('/api/agent/cycles'), { headers }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) }))
        );
      }

      const [auditRes, tasksRes, opsRes, metricsRes, cyclesRes] = await Promise.allSettled([
        requests[0],
        requests[1],
        fetch(apiUrl('/api/observability/operations'), { headers }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
        ...requests.slice(2),
      ]);

      if (auditRes.status === 'fulfilled' && auditRes.value?.ok && Array.isArray(auditRes.value.body?.records)) {
        setAuditRecords(auditRes.value.body.records);
      }

      if (tasksRes.status === 'fulfilled' && tasksRes.value?.ok && Array.isArray(tasksRes.value.body?.tasks)) {
        setTasks(tasksRes.value.body.tasks);
      }

      if (opsRes.status === 'fulfilled' && opsRes.value?.ok && opsRes.value.body?.success) {
        setOpsTelemetry(opsRes.value.body);
      }

      if (canQueryAdmin) {
        let anyForbidden = false;
        if (metricsRes?.status === 'fulfilled') {
          if (metricsRes.value?.status === 403) anyForbidden = true;
          const m = metricsRes.value?.body?.metrics || metricsRes.value?.body;
          if (metricsRes.value?.ok && m && typeof m.totalCycles === 'number') {
            setExecMetrics(m);
          }
        }
        if (cyclesRes?.status === 'fulfilled') {
          if (cyclesRes.value?.status === 403) anyForbidden = true;
          if (cyclesRes.value?.ok && Array.isArray(cyclesRes.value.body?.cycles)) {
            setCycles(cyclesRes.value.body.cycles);
          }
        }
        setAdminTelemetryRestricted(anyForbidden);
      } else {
        setExecMetrics(null);
        setCycles([]);
        setAdminTelemetryRestricted(true);
      }
    } finally {
      setLoading(false);
    }
  }, [authReady, isAuthenticated, authHeaders, role]);

  const handleRunBatch28Benchmark = async () => {
    if (runningBench || role === 'User') return;
    setRunningBench(true);
    setOpsActionError(null);
    try {
      const res = await fetch(apiUrl('/api/evaluation/batch28'), { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Benchmark failed (${res.status})`);
      await fetchPerformanceData();
    } catch (err: any) {
      setOpsActionError(err.message);
    } finally {
      setRunningBench(false);
    }
  };

  const handleRunContinuousLearning = async () => {
    if (runningPipeline || role === 'User') return;
    setRunningPipeline(true);
    setOpsActionError(null);
    try {
      const res = await fetch(apiUrl('/api/training/pipeline/run'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ steps: 12, lr: 0.02, margin: 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Pipeline failed (${res.status})`);
      await fetchPerformanceData();
    } catch (err: any) {
      setOpsActionError(err.message);
    } finally {
      setRunningPipeline(false);
    }
  };

  const handleRollbackBackup = async (backupId: string) => {
    setOpsActionError(null);
    try {
      const res = await fetch(apiUrl('/api/training/pipeline/rollback'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ backupId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Rollback failed (${res.status})`);
      await fetchPerformanceData();
    } catch (err: any) {
      setOpsActionError(err.message);
    }
  };

  useEffect(() => {
    void fetchPerformanceData();
  }, [fetchPerformanceData]);

  // Build unified chronological execution performance series from real backend data
  const fullSeries = useMemo<PerformancePoint[]>(() => {
    interface RawRun {
      id: string;
      timestampIso: string;
      goal: string;
      runtime: string;
      outcome: 'DELIVERED' | 'BLOCKED' | 'FAILED';
      testsPassed: number;
      testsTotal: number;
      durationMs: number | null;
      repairs: number;
      source: 'cycle' | 'task' | 'audit';
    }

    const byId = new Map<string, RawRun>();

    // 1. Authoritative 8-stage ExecutionCycleSummary records (Admin endpoint)
    const cycleSource =
      cycles.length > 0
        ? cycles
        : Array.isArray(execMetrics?.recentCycles)
        ? execMetrics.recentCycles
        : [];

    for (const c of cycleSource) {
      byId.set(c.taskId, {
        id: c.taskId,
        timestampIso: c.completedAt,
        goal: c.goal,
        runtime: c.runtime || 'node',
        outcome: c.deliveryStatus === 'DELIVERED' ? 'DELIVERED' : 'BLOCKED',
        testsPassed: Number(c.testsPassed) || 0,
        testsTotal: Number(c.testsTotal) || 0,
        durationMs: typeof c.durationMs === 'number' && Number.isFinite(c.durationMs) ? c.durationMs : null,
        repairs: Array.isArray(c.repairHistory) ? c.repairHistory.length : 0,
        source: 'cycle',
      });
    }

    // 2. Persistent tasks accessible to Developer / Administrator
    for (const t of tasks) {
      if (t.lifecycleStatus !== 'Delivered' && t.lifecycleStatus !== 'Failed' && t.lifecycleStatus !== 'Blocked') {
        continue;
      }
      if (byId.has(t.taskId)) continue;
      const ts = t.completedAt || t.updatedAt || t.createdAt;
      const startMs = Date.parse(t.createdAt);
      const endMs = Date.parse(ts);
      const elapsed =
        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
          ? Math.round(endMs - startMs)
          : null;
      byId.set(t.taskId, {
        id: t.taskId,
        timestampIso: ts,
        goal: t.goal,
        runtime: t.runtime || 'node',
        outcome: t.lifecycleStatus === 'Delivered' ? 'DELIVERED' : t.lifecycleStatus === 'Failed' ? 'FAILED' : 'BLOCKED',
        testsPassed: Number(t.testsPassed) || 0,
        testsTotal: Number(t.testsTotal) || 0,
        durationMs: elapsed,
        repairs: Math.max(0, (Number(t.attempts) || 1) - 1),
        source: 'task',
      });
    }

    // 3. AuditLedger delivery events (enriches durationMs or captures historical deliveries if task state was pruned)
    for (const rec of auditRecords) {
      if (rec.action !== 'TASK_DELIVERED' && rec.action !== 'TASK_DELIVERY_BLOCKED') continue;
      const taskId = typeof rec.payload?.taskId === 'string' ? rec.payload.taskId : `audit-${rec.index}`;
      const existing = byId.get(taskId);
      const payloadDuration =
        typeof rec.payload?.durationMs === 'number' && Number.isFinite(rec.payload.durationMs)
          ? rec.payload.durationMs
          : null;
      if (existing) {
        if (existing.durationMs === null && payloadDuration !== null) {
          existing.durationMs = payloadDuration;
        }
        if (typeof rec.payload?.repairs === 'number' && existing.repairs === 0) {
          existing.repairs = rec.payload.repairs;
        }
        continue;
      }
      byId.set(taskId, {
        id: taskId,
        timestampIso: rec.timestamp,
        goal: typeof rec.payload?.goal === 'string' ? rec.payload.goal : `Audit event #${rec.index}`,
        runtime: 'node',
        outcome: rec.action === 'TASK_DELIVERED' ? 'DELIVERED' : 'BLOCKED',
        testsPassed: Number(rec.payload?.testsPassed) || 0,
        testsTotal: Number(rec.payload?.testsTotal) || 0,
        durationMs: payloadDuration,
        repairs: Number(rec.payload?.repairs) || 0,
        source: 'audit',
      });
    }

    const sorted = Array.from(byId.values()).sort(
      (a, b) => Date.parse(a.timestampIso) - Date.parse(b.timestampIso)
    );

    let cumSuccess = 0;
    const recentOutcomes: number[] = [];
    const recentDurations: number[] = [];

    return sorted.map((run, idx) => {
      const successVal = run.outcome === 'DELIVERED' ? 100 : 0;
      if (run.outcome === 'DELIVERED') cumSuccess += 1;
      recentOutcomes.push(successVal);
      if (recentOutcomes.length > 5) recentOutcomes.shift();

      if (run.durationMs !== null) {
        recentDurations.push(run.durationMs);
        if (recentDurations.length > 5) recentDurations.shift();
      }

      const cumulativeSuccessRatePct = Number(((cumSuccess / (idx + 1)) * 100).toFixed(1));
      const rollingSuccessRatePct = Number(
        (recentOutcomes.reduce((a, b) => a + b, 0) / recentOutcomes.length).toFixed(1)
      );
      const rollingAvgLatencyMs =
        recentDurations.length > 0
          ? Math.round(recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length)
          : null;
      const testPassRatePct =
        run.testsTotal > 0 ? Number(((run.testsPassed / run.testsTotal) * 100).toFixed(1)) : null;

      return {
        ...run,
        label: `${formatTimeShort(run.timestampIso)} (#${idx + 1})`,
        successFlag: successVal,
        cumulativeSuccessRatePct,
        rollingSuccessRatePct,
        testPassRatePct,
        rollingAvgLatencyMs,
      };
    });
  }, [cycles, execMetrics, tasks, auditRecords]);

  const displayedSeries = useMemo(() => {
    if (windowFilter === '10') return fullSeries.slice(-10);
    if (windowFilter === '25') return fullSeries.slice(-25);
    return fullSeries;
  }, [fullSeries, windowFilter]);

  const inferenceSeries = useMemo(() => {
    const hist = statusData?.resources?.history || [];
    return hist
      .filter((s) => typeof s.lastInferenceLatencyMs === 'number' || typeof s.tokensPerSec === 'number')
      .map((s) => ({
        label: s.timeLabel || formatTimeShort(s.timestamp),
        timestampIso: s.timestamp,
        inferenceLatencyMs: s.lastInferenceLatencyMs ?? 0,
        tokensPerSec: s.tokensPerSec ?? 0,
      }));
  }, [statusData?.resources?.history]);

  const latencySummary = useMemo(() => {
    const durations = displayedSeries
      .map((p) => p.durationMs)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const avgMs =
      durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    const medMs = median(durations);
    const maxMs = durations.length > 0 ? Math.max(...durations) : null;
    const totalTestsPassed = displayedSeries.reduce((sum, p) => sum + p.testsPassed, 0);
    const totalTests = displayedSeries.reduce((sum, p) => sum + p.testsTotal, 0);
    const totalRepairs = displayedSeries.reduce((sum, p) => sum + p.repairs, 0);
    const deliveredCount = displayedSeries.filter((p) => p.outcome === 'DELIVERED').length;
    const windowSuccessPct =
      displayedSeries.length > 0
        ? Number(((deliveredCount / displayedSeries.length) * 100).toFixed(1))
        : null;
    return {
      durationsCount: durations.length,
      avgMs,
      medMs,
      maxMs,
      totalTestsPassed,
      totalTests,
      totalRepairs,
      deliveredCount,
      windowSuccessPct,
    };
  }, [displayedSeries]);

  const roleDistribution = useMemo(() => {
    if (auditRecords.length === 0) return [];
    const counts: Record<string, number> = {};
    for (const r of auditRecords) {
      const key = r.role || 'SYSTEM';
      counts[key] = (counts[key] || 0) + 1;
    }
    const total = auditRecords.length;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([roleName, count]) => ({
        role: roleName,
        count,
        pct: Math.round((count / total) * 100),
        fill: ROLE_COLORS[roleName] || '#00F0FF',
      }));
  }, [auditRecords]);

  const totalTokens = comm?.totalTokensProcessed ?? 0;
  const cloudCost = comm?.cloudApiCostUsd ?? 0;
  const nativeCost = comm?.nativeComputeCostUsd ?? 0;
  const authoritativeCompleted = execMetrics?.succeededCycles ?? latencySummary.deliveredCount;
  const authoritativeTotal = execMetrics?.totalCycles ?? displayedSeries.length;
  const completionRate =
    execMetrics && execMetrics.totalCycles > 0
      ? execMetrics.taskSuccessRatePct
      : latencySummary.windowSuccessPct;

  const SuccessTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const pt: PerformancePoint | undefined = payload[0]?.payload;
    if (!pt) return null;
    return (
      <div className="bg-[#0D1326] border border-[#1E294A] p-3 rounded-xl shadow-2xl text-xs font-mono space-y-1.5 max-w-xs">
        <div className="flex items-center justify-between gap-2 border-b border-[#1E294A] pb-1">
          <span className="font-bold text-[#00F0FF]">{pt.id}</span>
          <span className={pt.outcome === 'DELIVERED' ? 'text-[#CCFF00] font-bold' : 'text-[#FF007F] font-bold'}>
            {pt.outcome}
          </span>
        </div>
        <div className="text-[11px] text-[#F4F7FF] font-sans line-clamp-2">{pt.goal}</div>
        <div className="text-[10px] text-[#9AA8C7]">{new Date(pt.timestampIso).toLocaleString()}</div>
        <div className="space-y-0.5 pt-1 border-t border-[#1E294A] tabular-nums">
          <div className="flex justify-between gap-4">
            <span className="text-[#00F0FF]">Cumulative Success:</span>
            <span className="font-bold text-[#F4F7FF]">{pt.cumulativeSuccessRatePct}%</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-[#CCFF00]">Rolling (5-run):</span>
            <span className="font-bold text-[#F4F7FF]">{pt.rollingSuccessRatePct}%</span>
          </div>
          {pt.testPassRatePct !== null && (
            <div className="flex justify-between gap-4">
              <span className="text-[#C084FC]">Tests Passed:</span>
              <span className="font-bold text-[#F4F7FF]">
                {pt.testsPassed}/{pt.testsTotal} ({pt.testPassRatePct}%)
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const LatencyTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const raw = payload[0]?.payload;
    if (!raw) return null;

    if (latencyMode === 'inference') {
      return (
        <div className="bg-[#0D1326] border border-[#1E294A] p-3 rounded-xl shadow-2xl text-xs font-mono space-y-1">
          <div className="text-[#00F0FF] font-bold border-b border-[#1E294A] pb-1">
            Sample: {raw.label}
          </div>
          <div className="flex justify-between gap-4 tabular-nums">
            <span className="text-[#FF5E3A]">Inference Latency:</span>
            <span className="font-bold text-[#F4F7FF]">{raw.inferenceLatencyMs} ms</span>
          </div>
          <div className="flex justify-between gap-4 tabular-nums">
            <span className="text-[#CCFF00]">Throughput:</span>
            <span className="font-bold text-[#F4F7FF]">{raw.tokensPerSec} tok/s</span>
          </div>
        </div>
      );
    }

    const pt = raw as PerformancePoint;
    return (
      <div className="bg-[#0D1326] border border-[#1E294A] p-3 rounded-xl shadow-2xl text-xs font-mono space-y-1.5 max-w-xs">
        <div className="flex items-center justify-between gap-2 border-b border-[#1E294A] pb-1">
          <span className="font-bold text-[#FF5E3A]">{pt.id}</span>
          <span className="text-[#9AA8C7]">{pt.runtime}</span>
        </div>
        <div className="text-[11px] text-[#F4F7FF] font-sans line-clamp-2">{pt.goal}</div>
        <div className="space-y-0.5 pt-1 border-t border-[#1E294A] tabular-nums">
          <div className="flex justify-between gap-4">
            <span className="text-[#FF5E3A]">Execution Latency:</span>
            <span className="font-bold text-[#F4F7FF]">
              {pt.durationMs !== null ? `${pt.durationMs} ms` : 'Not recorded'}
            </span>
          </div>
          {pt.rollingAvgLatencyMs !== null && (
            <div className="flex justify-between gap-4">
              <span className="text-[#00F0FF]">5-Run Moving Avg:</span>
              <span className="font-bold text-[#F4F7FF]">{pt.rollingAvgLatencyMs} ms</span>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <span className="text-[#FF007F]">Self-Repairs:</span>
            <span className="font-bold text-[#F4F7FF]">{pt.repairs}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Control & Scope Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] px-4 sm:px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--app-text-primary)]">
            <BarChart3 className="w-4 h-4 text-[#00F0FF]" />
            <span>Historical Agent Performance Telemetry</span>
          </div>
          <StatusDot
            status={loading ? 'CHECKING' : displayedSeries.length > 0 ? 'VERIFIED' : 'NOT RUN'}
            label={
              loading
                ? 'SYNCING'
                : adminTelemetryRestricted
                ? 'SCOPED (TASKS + AUDIT)'
                : `${fullSeries.length} RECORDED RUNS`
            }
            pulse={loading}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            className="inline-flex rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-1 text-[11px] font-mono"
            role="group"
            aria-label="History window filter"
          >
            {(['all', '25', '10'] as WindowFilter[]).map((win) => (
              <button
                key={win}
                type="button"
                onClick={() => setWindowFilter(win)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                  windowFilter === win
                    ? 'bg-[#00F0FF] text-[#070B19] font-bold'
                    : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                {win === 'all' ? 'All Runs' : `Last ${win}`}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void fetchPerformanceData()}
            disabled={loading}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] hover:border-[#00F0FF] text-xs font-semibold text-[var(--app-text-primary)] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#00F0FF] ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          title="Execution Success Rate"
          value={completionRate !== null ? `${completionRate}%` : 'No runs'}
          subtitle={`${authoritativeCompleted} / ${authoritativeTotal} verified deliveries`}
          icon={<CheckCircle2 className="w-5 h-5" />}
          accentColor="lime"
        />
        <MetricCard
          title="Avg / Median Latency"
          value={latencySummary.avgMs !== null ? `${latencySummary.avgMs} ms` : 'Not measured'}
          subtitle={
            latencySummary.medMs !== null
              ? `Median ${latencySummary.medMs} ms · Peak ${latencySummary.maxMs} ms`
              : 'Awaiting completed execution cycles'
          }
          icon={<Clock className="w-5 h-5" />}
          accentColor="coral"
        />
        <MetricCard
          title="Verification Gate Pass"
          value={
            latencySummary.totalTests > 0
              ? `${latencySummary.totalTestsPassed}/${latencySummary.totalTests}`
              : '0/0'
          }
          subtitle={`${latencySummary.totalRepairs} autonomous repair(s) logged`}
          icon={<Activity className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Recorded Compute Spend"
          value={`$${(nativeCost + cloudCost).toFixed(4)}`}
          subtitle={`${totalTokens.toLocaleString()} native tokens · ${comm && comm.simulatedRevenueUsd > 0 ? `$${comm.simulatedRevenueUsd.toFixed(2)} rev` : 'No payment ledger'}`}
          icon={<DollarSign className="w-5 h-5" />}
          accentColor="purple"
        />
      </div>

      {/* Primary Time-Series Recharts Visualizations */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Chart 1: Execution Success Rate Trend Over Time */}
        <VividCard
          title="Execution Success Rate Over Time"
          subtitle="Cumulative delivery rate, 5-run rolling success trajectory, and acceptance test pass percentage"
          gradientAccent="lime"
        >
          {loading && displayedSeries.length === 0 ? (
            <div className="h-[290px] rounded-xl knowledge-skeleton" />
          ) : displayedSeries.length === 0 ? (
            <div className="h-[290px] flex flex-col items-center justify-center text-center px-6 rounded-xl border border-dashed border-[var(--app-card-border)] bg-[var(--app-input-bg)] space-y-2">
              <TrendingUp className="w-7 h-7 text-[#00F0FF] opacity-75" />
              <div className="text-sm font-bold text-[var(--app-text-primary)]">
                No historical agent executions recorded yet
              </div>
              <p className="text-xs text-[var(--app-text-secondary)] max-w-md">
                Run an engineering objective in Autonomous Execution or DevStudio to populate real delivery rates and verification gate history. Zero synthetic curves are plotted.
              </p>
            </div>
          ) : (
            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={displayedSeries} margin={{ top: 10, right: 12, left: -14, bottom: 4 }}>
                  <defs>
                    <linearGradient id="zySuccessGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00F0FF" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#00F0FF" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E294A" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#6D7B9D"
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: '#1E294A' }}
                    minTickGap={22}
                  />
                  <YAxis
                    domain={[0, 100]}
                    stroke="#6D7B9D"
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: '#1E294A' }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip content={<SuccessTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Bar
                    dataKey="testPassRatePct"
                    name="Test Pass %"
                    fill="#7B2CBF"
                    fillOpacity={0.55}
                    radius={[4, 4, 0, 0]}
                    barSize={14}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulativeSuccessRatePct"
                    name="Cumulative Success %"
                    stroke="#00F0FF"
                    strokeWidth={2.2}
                    fill="url(#zySuccessGradient)"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="rollingSuccessRatePct"
                    name="5-Run Rolling %"
                    stroke="#CCFF00"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#CCFF00' }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </VividCard>

        {/* Chart 2: Execution & Inference Latency Trends Over Time */}
        <VividCard
          title="Latency Trends Over Time"
          subtitle={
            latencyMode === 'execution'
              ? 'Measured end-to-end execution duration (ms) & 5-run moving average'
              : 'Runtime native inference latency (ms) & throughput from /api/system/status'
          }
          gradientAccent="coral"
          headerAction={
            <div className="inline-flex rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-1 text-[10px] font-mono">
              <button
                type="button"
                onClick={() => setLatencyMode('execution')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                  latencyMode === 'execution'
                    ? 'bg-[#FF5E3A] text-[#070B19]'
                    : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                Agent Runs
              </button>
              <button
                type="button"
                onClick={() => setLatencyMode('inference')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                  latencyMode === 'inference'
                    ? 'bg-[#00F0FF] text-[#070B19]'
                    : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                Inference Samples
              </button>
            </div>
          }
        >
          {latencyMode === 'execution' ? (
            loading && displayedSeries.length === 0 ? (
              <div className="h-[290px] rounded-xl knowledge-skeleton" />
            ) : latencySummary.durationsCount === 0 ? (
              <div className="h-[290px] flex flex-col items-center justify-center text-center px-6 rounded-xl border border-dashed border-[var(--app-card-border)] bg-[var(--app-input-bg)] space-y-2">
                <Clock className="w-7 h-7 text-[#FF5E3A] opacity-75" />
                <div className="text-sm font-bold text-[var(--app-text-primary)]">
                  No execution latency durations recorded yet
                </div>
                <p className="text-xs text-[var(--app-text-secondary)] max-w-md">
                  Completed execution cycles report exact millisecond latency. Switch to &ldquo;Inference Samples&rdquo; or run a task to measure real cycle latency.
                </p>
              </div>
            ) : (
              <div className="h-[290px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={displayedSeries} margin={{ top: 10, right: 12, left: -10, bottom: 4 }}>
                    <defs>
                      <linearGradient id="zyLatencyGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF5E3A" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#FF5E3A" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E294A" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#6D7B9D"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#1E294A' }}
                      minTickGap={22}
                    />
                    <YAxis
                      stroke="#6D7B9D"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#1E294A' }}
                      tickFormatter={(v) => `${v}ms`}
                    />
                    <Tooltip content={<LatencyTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    <Area
                      type="monotone"
                      dataKey="durationMs"
                      name="Run Duration (ms)"
                      stroke="#FF5E3A"
                      strokeWidth={2.2}
                      fill="url(#zyLatencyGradient)"
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="rollingAvgLatencyMs"
                      name="5-Run Avg Latency (ms)"
                      stroke="#00F0FF"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )
          ) : inferenceSeries.length === 0 ? (
            <div className="h-[290px] flex flex-col items-center justify-center text-center px-6 rounded-xl border border-dashed border-[var(--app-card-border)] bg-[var(--app-input-bg)] space-y-2">
              <Cpu className="w-7 h-7 text-[#00F0FF] opacity-75" />
              <div className="text-sm font-bold text-[var(--app-text-primary)]">
                No runtime inference latency samples recorded
              </div>
              <p className="text-xs text-[var(--app-text-secondary)] max-w-md">
                System status polling has not recorded live NativeLM inference latency yet (requires loaded online checkpoint &amp; active inference probes).
              </p>
            </div>
          ) : (
            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={inferenceSeries} margin={{ top: 10, right: 12, left: -10, bottom: 4 }}>
                  <defs>
                    <linearGradient id="zyInfGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF007F" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#FF007F" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E294A" vertical={false} />
                  <XAxis dataKey="label" stroke="#6D7B9D" fontSize={10} tickLine={false} />
                  <YAxis stroke="#6D7B9D" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}ms`} />
                  <Tooltip content={<LatencyTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Area
                    type="monotone"
                    dataKey="inferenceLatencyMs"
                    name="Inference Latency (ms)"
                    stroke="#FF007F"
                    strokeWidth={2.2}
                    fill="url(#zyInfGradient)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </VividCard>
      </div>

      {/* Role Distribution & Compute Accounting */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VividCard
          title="Audit Ledger Activity by Agent Role"
          subtitle={`Computed directly from ${auditRecords.length} verified records in /api/audit`}
          gradientAccent="purple"
        >
          {loading && roleDistribution.length === 0 ? (
            <div className="h-[220px] rounded-xl knowledge-skeleton" />
          ) : roleDistribution.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--app-text-secondary)]">
              No audit records available yet for this session. Execute an autonomous task or verify ledger permissions to inspect role distribution.
            </div>
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roleDistribution} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E294A" vertical={false} />
                  <XAxis dataKey="role" stroke="#9AA8C7" fontSize={10} tickLine={false} />
                  <YAxis stroke="#6D7B9D" fontSize={10} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(0, 240, 255, 0.06)' }}
                    contentStyle={{
                      backgroundColor: '#0D1326',
                      borderColor: '#1E294A',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: '#F4F7FF',
                    }}
                  />
                  <Bar dataKey="count" name="Events" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {roleDistribution.map((entry) => (
                      <Cell key={entry.role} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </VividCard>

        <VividCard
          title="Recorded Inference & Compute Accounting"
          subtitle="Actual tokens and cost counters returned by /api/system/status"
          gradientAccent="cyan"
        >
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)]">
              <div className="flex justify-between items-center font-bold mb-1.5 text-[var(--app-text-primary)]">
                <span className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#00F0FF]" />
                  <span>Native Tokens Processed</span>
                </span>
                <span className="text-[#00F0FF] font-mono text-sm tabular-nums">
                  {totalTokens.toLocaleString()}
                </span>
              </div>
              <div className="text-[11px] text-[var(--app-text-secondary)]">
                Recorded native compute cost:{' '}
                <span className="font-mono text-[var(--app-text-primary)]">${nativeCost.toFixed(4)}</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)]">
              <div className="flex justify-between items-center font-bold mb-1.5 text-[var(--app-text-primary)]">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#CCFF00]" />
                  <span>External Cloud LLM API Spend</span>
                </span>
                <span className="text-[#CCFF00] font-mono text-sm tabular-nums">
                  ${cloudCost.toFixed(4)}
                </span>
              </div>
              <div className="text-[11px] text-[var(--app-text-secondary)]">
                Cloud infrastructure, storage, and networking overhead are tracked only when payment/billing telemetry is connected.
              </div>
            </div>
          </div>
        </VividCard>
      </div>

      {/* Batch 28 Production Observability: Separated Attribution, Benchmark & Continuous Learning */}
      <div className="space-y-6">
        {opsActionError && (
          <div className="rounded-xl border border-[#FF007F]/45 bg-[#FF007F]/10 px-4 py-3 text-xs text-[#FF99C8]">
            {opsActionError}
          </div>
        )}

        <VividCard
          title="Autonomous Intelligence Benchmark & Layer Attribution"
          subtitle="Separated attribution across Native Model, Orchestrator, and Knowledge Retrieval (Zero Simulation)"
          gradientAccent="cyan"
          headerAction={
            role !== 'User' ? (
              <button
                type="button"
                onClick={() => void handleRunBatch28Benchmark()}
                disabled={runningBench}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#00F0FF] to-[#2563EB] text-xs font-bold text-[#070B19] hover:brightness-105 cursor-pointer disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{runningBench ? 'Running Benchmark…' : 'Run Batch 28 Benchmark'}</span>
              </button>
            ) : undefined
          }
        >
          {!opsTelemetry?.evaluation?.latestBenchmark ? (
            <div className="rounded-xl border border-dashed border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-6 text-center text-xs text-[var(--app-text-secondary)]">
              No Batch 28 benchmark run recorded yet. Click &ldquo;Run Batch 28 Benchmark&rdquo; to execute real verification probes and record provenance.
            </div>
          ) : (
            <div className="space-y-4">
              {(() => {
                const bench = opsTelemetry.evaluation.latestBenchmark;
                const attr = bench.attributionBreakdown || {};
                const m = bench.metrics || {};
                return (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[var(--app-text-secondary)]">
                      <span>
                        Run ID: <strong className="text-[#00F0FF]">{bench.runId}</strong> · Dataset:{' '}
                        {bench.provenance?.datasetVersion} · Status:{' '}
                        <strong className={bench.status === 'VERIFIED' ? 'text-[#CCFF00]' : 'text-[#FF5E3A]'}>
                          {bench.status}
                        </strong>
                      </span>
                      <span className="tabular-nums">
                        Checks: {bench.summary?.passed}/{bench.summary?.total} PASS ({bench.summary?.blocked} BLOCKED)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-3.5">
                        <div className="flex items-center justify-between font-bold mb-1">
                          <span className="text-[#00F0FF]">Native Model Layer</span>
                          <span className="font-mono text-[10px] text-[#FF5E3A]">
                            {attr.nativeModel?.status || 'BLOCKED'}
                          </span>
                        </div>
                        <div className="font-mono text-lg font-extrabold tabular-nums text-[var(--app-text-primary)]">
                          {attr.nativeModel?.score !== null && attr.nativeModel?.score !== undefined
                            ? `${(attr.nativeModel.score * 100).toFixed(1)}%`
                            : 'BLOCKED'}
                        </div>
                        <div className="text-[11px] text-[var(--app-text-secondary)] mt-1">{attr.nativeModel?.note}</div>
                      </div>

                      <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-3.5">
                        <div className="flex items-center justify-between font-bold mb-1">
                          <span className="text-[#CCFF00]">Orchestrator &amp; Reasoning</span>
                          <span className="font-mono text-[10px] text-[#CCFF00]">
                            {attr.orchestrator?.status || 'VERIFIED'}
                          </span>
                        </div>
                        <div className="font-mono text-lg font-extrabold tabular-nums text-[var(--app-text-primary)]">
                          {typeof attr.orchestrator?.score === 'number'
                            ? `${(attr.orchestrator.score * 100).toFixed(1)}%`
                            : '—'}
                        </div>
                        <div className="text-[11px] text-[var(--app-text-secondary)] mt-1">
                          DAG Planning {m.planningSuccessRatePct}% · Reasoning {m.multiStepReasoningAccuracyPct}% · Recovery{' '}
                          {m.errorRecoveryRatePct}%
                        </div>
                      </div>

                      <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-3.5">
                        <div className="flex items-center justify-between font-bold mb-1">
                          <span className="text-[#C084FC]">Knowledge Retrieval &amp; Grounding</span>
                          <span className="font-mono text-[10px] text-[#CCFF00]">
                            {attr.knowledgeRetrieval?.status || 'VERIFIED'}
                          </span>
                        </div>
                        <div className="font-mono text-lg font-extrabold tabular-nums text-[var(--app-text-primary)]">
                          {typeof attr.knowledgeRetrieval?.score === 'number'
                            ? `${(attr.knowledgeRetrieval.score * 100).toFixed(1)}%`
                            : '—'}
                        </div>
                        <div className="text-[11px] text-[var(--app-text-secondary)] mt-1">
                          MRR {m.retrievalRelevanceMrr} · Citations {m.citationCorrectnessPct}% · Grounding{' '}
                          {m.factualGroundingRatePct}%
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-[11px] tabular-nums">
                      {[
                        ['Planning', `${m.planningSuccessRatePct}%`],
                        ['Task Completion', `${m.taskCompletionRatePct}%`],
                        ['Tool Accuracy', `${m.toolAccuracyPct}%`],
                        ['Memory Recall', `${m.memoryRecallScorePct}%`],
                        ['Security Violation', `${m.securityViolationRatePct}%`],
                        ['Avg Latency', `${m.avgLatencyMs} ms`],
                      ].map(([label, val]) => (
                        <div
                          key={String(label)}
                          className="rounded-lg border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-3 py-2"
                        >
                          <div className="text-[10px] text-[var(--app-text-secondary)]">{label}</div>
                          <div className="font-mono font-bold text-sm text-[var(--app-text-primary)]">{val}</div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </VividCard>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <VividCard
            title="Tool Reliability & Memory Operations"
            subtitle="Live per-tool invocation metrics and Long-Horizon Memory store integrity"
            gradientAccent="purple"
          >
            <div className="space-y-3 text-xs">
              {opsTelemetry?.memory && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-3">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#C084FC]" />
                    <span className="font-bold text-[var(--app-text-primary)]">
                      Memory Integrity: {opsTelemetry.memory.integrityValid ? 'VERIFIED' : 'TAMPERED'}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--app-text-secondary)]">
                    {opsTelemetry.memory.stats?.totalItems ?? 0} entries · Grounding queries:{' '}
                    {opsTelemetry.knowledge?.totalQueries ?? 0} ({opsTelemetry.knowledge?.groundedRatePct ?? 0}%)
                  </span>
                </div>
              )}

              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {(opsTelemetry?.toolTelemetry || []).map((tl: any) => (
                  <div
                    key={tl.tool}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-3 py-2 font-mono text-[11px] tabular-nums"
                  >
                    <span className="flex items-center gap-1.5 text-[var(--app-text-primary)] font-semibold">
                      <Wrench className="w-3 h-3 text-[#00F0FF]" />
                      {tl.tool}
                    </span>
                    <span className="text-[var(--app-text-secondary)]">
                      {tl.succeededCalls}/{tl.totalCalls} ok · {tl.deniedCalls} denied · {tl.avgLatencyMs}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </VividCard>

          <VividCard
            title="Continuous Learning Pipeline & Checkpoints"
            subtitle="Real PureSeqLM training runs, held-out regression gates, and SHA-256 rollback backups"
            gradientAccent="lime"
            headerAction={
              role !== 'User' ? (
                <button
                  type="button"
                  onClick={() => void handleRunContinuousLearning()}
                  disabled={runningPipeline}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#CCFF00]/50 bg-[#CCFF00]/15 text-xs font-bold text-[#CCFF00] hover:bg-[#CCFF00]/25 cursor-pointer disabled:opacity-50"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{runningPipeline ? 'Training PureSeqLM…' : 'Run Training Pipeline'}</span>
                </button>
              ) : undefined
            }
          >
            <div className="space-y-3 text-xs">
              {(opsTelemetry?.continuousLearning?.runs || []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-5 text-center text-[var(--app-text-secondary)]">
                  No Continuous Learning pipeline runs recorded yet.
                </div>
              ) : (
                <div className="max-h-44 overflow-y-auto space-y-2">
                  {(opsTelemetry?.continuousLearning?.runs || []).map((run: any) => (
                    <div
                      key={run.runId}
                      className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-3 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2 font-mono">
                        <span className="font-bold text-[#00F0FF]">{run.runId}</span>
                        <span className="text-[10px] font-bold text-[#CCFF00]">{run.status}</span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[var(--app-text-secondary)]">
                        NLL: {run.baselineEval?.nll ?? '—'} → {run.candidateEval?.nll ?? '—'} (Δ={run.nllDelta ?? '—'}) ·
                        Dataset {run.datasetManifest?.datasetVersion || '—'}
                      </div>
                      {run.approvalRequestId && (
                        <div className="text-[10px] font-mono text-[#FF5E3A]">
                          Approval ID: {run.approvalRequestId}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(opsTelemetry?.continuousLearning?.backups || []).length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-[var(--app-card-border)]">
                  <div className="text-[11px] font-semibold text-[var(--app-text-secondary)]">
                    Preserved Checkpoint Backups (SHA-256 Verified)
                  </div>
                  {(opsTelemetry?.continuousLearning?.backups || []).slice(0, 3).map((bkp: any) => (
                    <div
                      key={bkp.backupId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-2.5 py-1.5 text-[11px] font-mono"
                    >
                      <span className="truncate text-[var(--app-text-primary)]">
                        {bkp.backupId} · {String(bkp.sha256).slice(0, 12)}…
                      </span>
                      {role === 'Administrator' && (
                        <button
                          type="button"
                          onClick={() => void handleRollbackBackup(bkp.backupId)}
                          className="inline-flex items-center gap-1 text-[#FF5E3A] hover:underline cursor-pointer shrink-0"
                        >
                          <RotateCcw className="w-3 h-3" /> Rollback
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </VividCard>
        </div>
      </div>
    </div>
  );
};
