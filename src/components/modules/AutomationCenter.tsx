import React, { useCallback, useEffect, useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { Zap, Play, Clock, ShieldCheck, RefreshCw } from 'lucide-react';

interface AutomationMission {
  missionId: string;
  goal: string;
  mode: string;
  priority: string;
  lifecycleStatus: string;
  executionAttribution: string;
  createdAt?: string;
  completedAt?: string;
  durationMs?: number;
  stages?: Array<{ stage: string; status: string; summary: string }>;
}

interface AutomationPlan {
  planId: string;
  taskId: string;
  goal: string;
  status: string;
  priority: string;
  completionVerified: boolean;
}

export const AutomationCenter: React.FC = () => {
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const [goalInput, setGoalInput] = useState(
    'Run scheduled system integrity, workspace verification, and security audit sweep'
  );
  const [pipelineState, setPipelineState] = useState<'IDLE' | 'RUNNING' | 'COMPLETED' | 'ERROR'>('IDLE');
  const [missions, setMissions] = useState<AutomationMission[]>([]);
  const [plans, setPlans] = useState<AutomationPlan[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [lastError, setLastError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const loadJobs = useCallback(async () => {
    if (!authReady || !isAuthenticated) return;
    setIsLoading(true);
    setLastError('');
    try {
      const res = await fetch('/api/automation/jobs', { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to load automation jobs (HTTP ${res.status})`);
      }
      setMissions(Array.isArray(data.missions) ? data.missions : []);
      setPlans(Array.isArray(data.plans) ? data.plans : []);
      setMetrics(data.metrics || null);
    } catch (err: any) {
      setLastError(err?.message || 'Unable to fetch live automation jobs.');
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders, authReady, isAuthenticated]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const triggerSweep = async () => {
    if (!isAuthenticated || pipelineState === 'RUNNING') return;
    setPipelineState('RUNNING');
    setLastError('');
    try {
      const res = await fetch('/api/automation/run', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          goal: goalInput.trim() || 'Run system integrity & security verification sweep',
          mode: 'system_integrity_audit',
          priority: 'High',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Automation run failed (HTTP ${res.status})`);
      }
      setPipelineState('COMPLETED');
      await loadJobs();
    } catch (err: any) {
      setPipelineState('ERROR');
      setLastError(err?.message || 'Automation run failed.');
    }
  };

  const toBadgeStatus = (status: string): 'VERIFIED' | 'IMPLEMENTED' | 'PARTIAL' | 'BLOCKED' | 'UNVERIFIED' => {
    const s = String(status || '').toUpperCase();
    if (s === 'DELIVERED' || s === 'COMPLETED' || s === 'VERIFIED') return 'VERIFIED';
    if (s === 'RUNNING' || s === 'REVISED') return 'PARTIAL';
    if (s === 'BLOCKED' || s === 'FAILED') return 'BLOCKED';
    return 'UNVERIFIED';
  };

  return (
    <div className="space-y-8">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <MetricCard
          title="Recorded Missions"
          value={isAuthenticated ? String(missions.length) : 'Sign in'}
          subtitle={`${plans.length} autonomous DAG plans tracked`}
          icon={<Zap className="w-5 h-5" />}
          accentColor="orange"
        />
        <MetricCard
          title="Cycle Success Rate"
          value={
            metrics && typeof metrics.taskSuccessRatePct === 'number'
              ? `${metrics.taskSuccessRatePct}%`
              : '—'
          }
          subtitle={
            metrics
              ? `${metrics.succeededCycles ?? 0}/${metrics.totalCycles ?? 0} verified cycles`
              : 'Awaiting live telemetry'
          }
          icon={<Clock className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Execution Boundary"
          value="Isolated"
          subtitle="ToolGateway Sandbox + AuditLedger"
          icon={<ShieldCheck className="w-5 h-5" />}
          accentColor="lime"
        />
      </div>

      {/* Main Automation Runner & Live History */}
      <VividCard
        title="Autonomous Execution & Verification Runner"
        subtitle="Dispatches real ActionDrivenEngine sweeps through /api/automation/run (Developer / Administrator role)"
        gradientAccent="sunset"
        headerAction={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadJobs()}
              disabled={isLoading || !isAuthenticated}
              className="p-2 rounded-xl border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer disabled:opacity-40"
              title="Refresh live automation history"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => void triggerSweep()}
              disabled={pipelineState === 'RUNNING' || !isAuthenticated}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[var(--z-warn)] rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              {pipelineState === 'RUNNING' ? 'Executing Sweep...' : 'Run Integrity Sweep'}
            </button>
          </div>
        }
      >
        <div className="mb-4 flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            placeholder="Describe automation sweep or maintenance objective..."
            className="flex-1 px-3 py-2 text-xs rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
          />
          {!isAuthenticated && (
            <span className="self-center text-[11px] font-mono text-[var(--app-amber)]">
              Sign in as Developer or Admin to run & inspect automation jobs
            </span>
          )}
        </div>

        {lastError && (
          <div className="mb-4 p-3 rounded-xl border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] text-xs font-mono text-[var(--z-danger)]">
            {lastError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] font-semibold">
                <th className="pb-3 pl-1">Mission ID &amp; Goal</th>
                <th className="pb-3">Mode</th>
                <th className="pb-3">Attribution</th>
                <th className="pb-3">Status</th>
                <th className="pb-3 text-right pr-1">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-card-border)]">
              {missions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[var(--app-text-secondary)]">
                    {isAuthenticated
                      ? 'No automation missions recorded yet. Click "Run Integrity Sweep" to execute a real verification pass.'
                      : 'Authenticated session required to read tenant-isolated automation history.'}
                  </td>
                </tr>
              ) : (
                missions.map((mission) => (
                  <tr
                    key={mission.missionId}
                    className="hover:bg-[color-mix(in_srgb,var(--app-surface-elevated)_50%,transparent)] transition-colors"
                  >
                    <td className="py-3 pl-1 font-semibold text-[var(--app-text-primary)] max-w-md">
                      <div className="truncate">{mission.goal}</div>
                      <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">{mission.missionId}</div>
                    </td>
                    <td className="py-3 font-mono text-[11px] text-[var(--app-text-primary)]">{mission.mode}</td>
                    <td className="py-3 font-mono text-[11px] text-[var(--app-text-secondary)]">
                      {mission.executionAttribution || 'deterministic_action_engine'}
                    </td>
                    <td className="py-3">
                      <StatusBadge status={toBadgeStatus(mission.lifecycleStatus)} />
                    </td>
                    <td className="py-3 text-right pr-1 font-mono tabular-nums text-[11px] text-[var(--app-text-primary)]">
                      {typeof mission.durationMs === 'number' ? `${mission.durationMs} ms` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </VividCard>
    </div>
  );
};
