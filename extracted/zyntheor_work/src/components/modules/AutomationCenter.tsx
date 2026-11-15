import React, { useState, useEffect } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge, StatusDot } from '../ui/StatusBadge';
import { ExecutionMetricsSummary, PersistentTaskRecord, TaskPriority } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiUrl } from '../../lib/apiClient';
import { Zap, Play, ShieldCheck, CheckCircle2, Wrench, ListChecks, Download, RotateCw, FlaskConical } from 'lucide-react';

interface ScheduledHmacSummary {
  scheduledTaskId: string;
  taskId: string;
  executedAt: string;
  hmacVerified: boolean;
  passedTests: number;
  totalTests: number;
  auditChainValid: boolean;
}

export const AutomationCenter: React.FC = () => {
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const [pipelineState, setPipelineState] = useState<'IDLE' | 'RUNNING' | 'COMPLETED'>('IDLE');
  const [scheduledHmacRuns, setScheduledHmacRuns] = useState<ScheduledHmacSummary[]>([]);
  const [execMetrics, setExecMetrics] = useState<ExecutionMetricsSummary | null>(null);
  const [taskQueue, setTaskQueue] = useState<PersistentTaskRecord[]>([]);
  const [queueGoal, setQueueGoal] = useState('');
  const [queuePriority, setQueuePriority] = useState<TaskPriority>('High');
  const [queueBusy, setQueueBusy] = useState(false);
  const [acceptanceBusy, setAcceptanceBusy] = useState(false);
  const [acceptanceResult, setAcceptanceResult] = useState<any>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadAutomationData = async () => {
    if (!authReady || !isAuthenticated) return;
    const h = authHeaders();
    await Promise.allSettled([
      fetch(apiUrl('/api/agent/scheduled-checks'), { headers: h })
        .then((r) => r.json())
        .then((d) => {
          if (d.success && Array.isArray(d.checks)) {
            setScheduledHmacRuns(d.checks);
          }
        }),
      fetch(apiUrl('/api/agent/metrics'), { headers: h })
        .then((r) => r.json())
        .then((d) => {
          if (d.success && d.metrics) {
            setExecMetrics(d.metrics);
          }
        }),
      fetch(apiUrl('/api/agent/tasks'), { headers: h })
        .then((r) => r.json())
        .then((d) => {
          if (d.success && Array.isArray(d.tasks)) {
            setTaskQueue(d.tasks);
          }
        })
    ]);
  };

  useEffect(() => {
    void loadAutomationData();
  }, [authReady, isAuthenticated]);

  const handleEnqueue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queueGoal.trim() || queueBusy) return;
    setQueueBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/agent/queue'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ goal: queueGoal.trim(), priority: queuePriority })
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Failed to enqueue');
      const queuedGoal = queueGoal.trim();
      setQueueGoal('');
      setActionMsg(`Queued ${d.task.taskId} [${d.task.priority}] -> ${d.task.lifecycleStatus}`);
      showToast({
        variant: 'info',
        title: 'Task Added to Priority Queue',
        message: queuedGoal,
        meta: `${d.task.taskId} · ${d.task.priority} Priority`,
      });
      await loadAutomationData();
    } catch (err: any) {
      setActionMsg(`Error: ${err.message}`);
    } finally {
      setQueueBusy(false);
    }
  };

  const drainNdjson = async (url: string) => {
    setQueueBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl(url), { method: 'POST', headers: authHeaders() });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      let finalSuccess = false;
      let finalTaskId = '';
      let finalGoal = '';
      let finalDurationMs: number | null = null;
      let streamError: string | null = null;

      if (res.body) {
        const reader = res.body.getReader();
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
              const ev = JSON.parse(line);
              if (ev.type === 'done' || ev.type === 'final_result') {
                finalSuccess = Boolean(ev.data?.success);
                finalTaskId = ev.data?.taskId || finalTaskId;
                finalGoal = ev.data?.goal || finalGoal;
                if (typeof ev.data?.durationMs === 'number') {
                  finalDurationMs = ev.data.durationMs;
                }
              } else if (ev.type === 'error') {
                streamError = ev.message || 'Execution failed';
              }
            } catch {
              /* ignore malformed stream chunk */
            }
          }
        }
      }

      if (streamError) {
        setActionMsg(`Execution error: ${streamError}`);
      } else if (finalSuccess) {
        setActionMsg('Autonomous execution completed. Lifecycle & deliverable state updated.');
        showToast({
          variant: 'success',
          title: 'Queued Execution Delivered',
          message: finalGoal || 'Autonomous task completed and verified.',
          meta: [finalTaskId ? `Task ${finalTaskId}` : null, finalDurationMs != null ? `${finalDurationMs} ms` : null]
            .filter(Boolean)
            .join(' · ') || undefined,
        });
      } else {
        setActionMsg('Execution finished without passing all delivery gates. Inspect lifecycle state below.');
      }
      await loadAutomationData();
    } catch (err: any) {
      setActionMsg(`Execution notice: ${err.message}`);
    } finally {
      setQueueBusy(false);
    }
  };

  const handleDownloadZip = async (filename: string) => {
    const res = await fetch(apiUrl(`/api/agent/deliverables/${filename}`), { headers: authHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunAcceptance = async () => {
    if (acceptanceBusy) return;
    setAcceptanceBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/agent/acceptance-scenario'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ priority: 'High' })
      });
      const d = await res.json();
      const scenario = d.scenario || d;
      setAcceptanceResult(scenario);
      if (scenario?.scenario_passed) {
        showToast({
          variant: 'success',
          title: 'Defect-Repair Acceptance Passed',
          message: `Defect '${scenario.defect_type || 'verified'}' repaired and regression suite passed.`,
          meta: scenario.package?.zip_path ? `ZIP ${scenario.package.zip_bytes ?? ''}B` : undefined,
        });
      }
      await loadAutomationData();
    } catch (err: any) {
      setActionMsg(`Acceptance error: ${err.message}`);
    } finally {
      setAcceptanceBusy(false);
    }
  };

  const latestHmac = scheduledHmacRuns[0];

  const jobs = [
    {
      id: 'JOB-905',
      name: 'Post-Cycle Heavy-Load HMAC Integrity Verification',
      schedule: 'On Heavy-Load Agent Cycle Complete',
      trigger: 'TaskOrchestrator Hook',
      status: latestHmac ? (latestHmac.hmacVerified ? 'VERIFIED' : 'PARTIAL') : 'IMPLEMENTED',
      lastRun: latestHmac
        ? `${scheduledHmacRuns.length} run(s) · Last: ${new Date(latestHmac.executedAt).toLocaleTimeString()} (${latestHmac.passedTests}/${latestHmac.totalTests} PASS)`
        : 'Awaiting heavy-load agent cycle',
      target: 'SovereignIdentity + AuditLedger'
    },
    {
      id: 'JOB-901',
      name: 'Continuous Sandbox Test & Verification',
      schedule: 'Every 15 mins (Defined)',
      trigger: 'Cron / File Change',
      status: 'NOT IMPLEMENTED',
      lastRun: 'No daemon run',
      target: '/workspace/solution.js'
    },
    {
      id: 'JOB-902',
      name: 'Audit Ledger Hash Integrity Probe',
      schedule: 'Hourly (Defined)',
      trigger: 'System Daemon',
      status: 'NOT IMPLEMENTED',
      lastRun: 'No daemon run',
      target: 'native_data/audit_log.jsonl'
    },
    {
      id: 'JOB-903',
      name: 'Autonomous Self-Evolving Benchmark Sweep',
      schedule: 'Daily at 02:00 UTC (Defined)',
      trigger: 'Scheduled Agent',
      status: 'IMPLEMENTED',
      lastRun: 'Manual trigger only',
      target: 'Algorithm Resilience Suite'
    },
    {
      id: 'JOB-904',
      name: 'Tenant Quota Metering & Margin Sync',
      schedule: 'Every 5 mins (Defined)',
      trigger: 'Billing Daemon',
      status: 'NOT IMPLEMENTED',
      lastRun: 'No daemon run',
      target: 'CommercialManager'
    }
  ] as const;

  const triggerPipeline = async () => {
    setPipelineState('RUNNING');
    try {
      await loadAutomationData();
    } finally {
      setPipelineState('COMPLETED');
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Task Completion Rate"
          value={execMetrics && execMetrics.totalCycles > 0 ? `${execMetrics.taskSuccessRatePct}%` : 'No cycles yet'}
          subtitle={execMetrics ? `${execMetrics.succeededCycles}/${execMetrics.totalCycles} delivered` : '8-stage acceptance gate'}
          icon={<CheckCircle2 className="w-5 h-5" />}
          accentColor="lime"
        />
        <MetricCard
          title="Verified Artifacts & Tests"
          value={execMetrics ? `${execMetrics.artifactsCreated} · ${execMetrics.testsPassedCount}/${execMetrics.testsTotalCount}` : '0 · 0/0'}
          subtitle="Usable artifacts · Acceptance tests passed"
          icon={<Zap className="w-5 h-5" />}
          accentColor="coral"
        />
        <MetricCard
          title="Autonomous Self-Repairs"
          value={execMetrics ? `${execMetrics.selfRepairsSucceeded}/${execMetrics.selfRepairsAttempted}` : '0/0'}
          subtitle="Failures diagnosed & fixed by Repair Engine"
          icon={<Wrench className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Post-Cycle HMAC Checks"
          value={latestHmac ? (latestHmac.hmacVerified ? 'HMAC VERIFIED' : 'CHECK ALERT') : 'EVENT HOOK READY'}
          subtitle={latestHmac ? `Last: ${latestHmac.scheduledTaskId}` : `${scheduledHmacRuns.length} run(s) recorded`}
          icon={<ShieldCheck className="w-5 h-5" />}
          accentColor="violet"
        />
      </div>

      {/* Persistent Priority Task Queue & Resumable Lifecycle */}
      <VividCard
        title="Autonomous Priority Task Queue & Lifecycle State"
        subtitle="Persistent Planned → In Progress → Executed → Tested → Delivered/Failed · Ordered High > Medium > Low"
        gradientAccent="cyan"
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => drainNdjson('/api/agent/queue/run-next')}
              disabled={queueBusy || !taskQueue.some((t) => t.lifecycleStatus === 'Planned')}
              className="min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-[#070B19] bg-[#CCFF00] hover:opacity-90 rounded-xl cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-[#070B19]" />
              {queueBusy ? 'Executing...' : 'Run Highest-Priority Next'}
            </button>
            <button
              type="button"
              onClick={handleRunAcceptance}
              disabled={acceptanceBusy}
              className="min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl cursor-pointer disabled:opacity-50"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              {acceptanceBusy ? 'Verifying...' : 'Run Defect-Repair Acceptance'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <form onSubmit={handleEnqueue} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={queueGoal}
              onChange={(e) => setQueueGoal(e.target.value)}
              placeholder="Enqueue engineering objective into priority queue..."
              className="flex-1 min-h-[44px] px-3.5 py-2 text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]/60 focus:outline-none focus:border-[#00F0FF]"
            />
            <select
              value={queuePriority}
              onChange={(e) => setQueuePriority(e.target.value as TaskPriority)}
              className="min-h-[44px] px-3 py-2 text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl text-[var(--app-text-primary)] font-bold focus:outline-none focus:border-[#00F0FF]"
            >
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
            <button
              type="submit"
              disabled={queueBusy || !queueGoal.trim()}
              className="min-h-[44px] px-4 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-xl cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <ListChecks className="w-3.5 h-3.5" />
              Queue Task
            </button>
          </form>

          {actionMsg && (
            <div className="text-xs font-mono px-3 py-2 rounded-lg bg-[var(--app-input-bg)] border border-[#00F0FF]/40 text-[#00F0FF]">
              {actionMsg}
            </div>
          )}

          {acceptanceResult && (
            <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[#7B2CBF]/50 text-xs font-mono space-y-1">
              <div className="font-bold text-[#00F0FF]">
                Acceptance &amp; Defect-Repair Proof: {acceptanceResult.scenario_passed ? 'PASS' : 'FAIL'} (Defect: {acceptanceResult.defect_type})
              </div>
              <div className="text-[var(--app-text-secondary)] break-words">
                Baseline={acceptanceResult.baseline_status} · DefectDetected={String(acceptanceResult.defect_detected)} ({acceptanceResult.defect_detection_status}) · Repair={acceptanceResult.repair_status} · RegressionPassed={String(acceptanceResult.regression_passed)} · ZIP={acceptanceResult.package?.zip_path} ({acceptanceResult.package?.zip_bytes}B, integrity={String(acceptanceResult.package?.integrity_ok)})
              </div>
            </div>
          )}

          {taskQueue.length === 0 ? (
            <div className="text-xs text-[var(--app-text-secondary)] italic py-2">
              No queued or persisted tasks yet. Enqueue an objective above or run a task in Creation Studio.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] uppercase font-semibold">
                    <th className="pb-2 pl-1">Task</th>
                    <th className="pb-2">Priority</th>
                    <th className="pb-2">Lifecycle</th>
                    <th className="pb-2">Tests</th>
                    <th className="pb-2 text-right pr-1">Actions / Deliverable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--app-card-border)]">
                  {taskQueue.slice(0, 12).map((t) => (
                    <tr key={t.taskId} className="hover:bg-[var(--app-surface-elevated)]/40 transition-colors">
                      <td className="py-2.5 pl-1">
                        <div className="font-semibold text-[var(--app-text-primary)] max-w-md truncate">{t.goal}</div>
                        <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">{t.taskId} · {t.runtime} · stage={t.currentStage}</div>
                      </td>
                      <td className="py-2.5 font-mono font-bold text-[var(--app-text-primary)]">{t.priority}</td>
                      <td className="py-2.5">
                        <StatusDot
                          status={
                            t.lifecycleStatus === 'Delivered'
                              ? 'VERIFIED'
                              : t.lifecycleStatus === 'In Progress'
                              ? 'ACTIVE'
                              : t.lifecycleStatus === 'Failed' || t.lifecycleStatus === 'Blocked'
                              ? 'BLOCKED'
                              : 'PARTIAL'
                          }
                          label={t.lifecycleStatus}
                          pulse={t.lifecycleStatus === 'In Progress'}
                        />
                      </td>
                      <td className="py-2.5 font-mono text-[11px] text-[var(--app-text-primary)]">{t.testsPassed}/{t.testsTotal}</td>
                      <td className="py-2.5 text-right pr-1 space-x-2">
                        {t.resumable && t.lifecycleStatus !== 'Delivered' && (
                          <button
                            type="button"
                            disabled={queueBusy}
                            onClick={() => drainNdjson(`/api/agent/tasks/${encodeURIComponent(t.taskId)}/resume`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#FF5E3A] hover:opacity-90 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                          >
                            <RotateCw className="w-3 h-3" />
                            Resume
                          </button>
                        )}
                        {t.packageArtifact?.zipFilename && (
                          <button
                            type="button"
                            onClick={() => handleDownloadZip(t.packageArtifact!.zipFilename)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#00F0FF] hover:opacity-90 text-[#070B19] text-[10px] font-bold cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                            ZIP
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </VividCard>

      {/* Recent 8-Stage Execution Cycles */}
      <VividCard
        title="8-Stage Autonomous Execution Cycles"
        subtitle="Measured End-to-End Runs (Understand → Reason → Plan → Build → Execute → Verify → Repair → Deliver)"
        gradientAccent="lime"
      >
        {!execMetrics || execMetrics.recentCycles.length === 0 ? (
          <div className="text-xs text-[var(--app-text-secondary)] italic py-4">
            No autonomous execution cycles recorded yet. Dispatch a goal in Creation Studio to verify end-to-end execution.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead>
                <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] uppercase font-semibold">
                  <th className="pb-3 pl-1">Task &amp; Goal</th>
                  <th className="pb-3">Priority</th>
                  <th className="pb-3">Runtime &amp; Artifacts</th>
                  <th className="pb-3">Tests &amp; Repairs</th>
                  <th className="pb-3">Delivery Gate</th>
                  <th className="pb-3 text-right pr-1">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--app-card-border)]">
                {execMetrics.recentCycles.map((cycle) => {
                  const p = cycle.priority || 'Medium';
                  return (
                    <tr key={cycle.taskId} className="hover:bg-[var(--app-surface-elevated)]/40 transition-colors">
                      <td className="py-3 pl-1">
                        <div className="font-semibold text-[var(--app-text-primary)] max-w-md truncate">{cycle.goal}</div>
                        <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">{cycle.taskId}</div>
                      </td>
                      <td className="py-3">
                        <StatusDot
                          status={p === 'High' ? 'FAILED' : p === 'Medium' ? 'PARTIAL' : 'IMPLEMENTED'}
                          label={p.toUpperCase()}
                        />
                      </td>
                      <td className="py-3 font-mono text-[11px] text-[var(--app-text-secondary)]">
                        {cycle.runtime} · {cycle.artifacts.map((a) => `${a.path} (${a.bytes}B)`).join(', ')}
                      </td>
                      <td className="py-3 font-mono text-[11px] text-[var(--app-text-secondary)]">
                        {cycle.testsPassed}/{cycle.testsTotal} passed · {cycle.repairHistory.length} repair(s)
                      </td>
                      <td className="py-3">
                        <StatusBadge status={cycle.deliveryStatus === 'DELIVERED' ? 'VERIFIED' : 'BLOCKED'} />
                      </td>
                      <td className="py-3 text-right pr-1 font-mono text-[11px] text-[var(--app-text-secondary)]">
                        {cycle.durationMs}ms
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </VividCard>

      {/* Main Jobs Table */}
      <VividCard
        title="Automated Agent Job Registry"
        subtitle="Sovereign headless background runners with sandbox isolation"
        gradientAccent="coral"
        headerAction={
          <button
            onClick={triggerPipeline}
            disabled={pipelineState === 'RUNNING'}
            className="min-h-[44px] flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white vivid-gradient-coral rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            {pipelineState === 'RUNNING' ? 'Refreshing...' : 'Refresh Telemetry'}
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <thead>
              <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] uppercase font-semibold">
                <th className="pb-3 pl-1">Job ID &amp; Name</th>
                <th className="pb-3">Schedule / Cadence</th>
                <th className="pb-3">Trigger Type</th>
                <th className="pb-3">Status</th>
                <th className="pb-3 text-right pr-1">Target Sandbox Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-card-border)]">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-[var(--app-surface-elevated)]/40 transition-colors">
                  <td className="py-3 pl-1 font-semibold text-[var(--app-text-primary)]">
                    <div>{job.name}</div>
                    <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">{job.id} · {job.lastRun}</div>
                  </td>
                  <td className="py-3 text-[var(--app-text-secondary)] font-mono text-[11px]">{job.schedule}</td>
                  <td className="py-3 text-[var(--app-text-secondary)]">{job.trigger}</td>
                  <td className="py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="py-3 text-right pr-1 font-mono text-[11px] text-[var(--app-text-secondary)]">
                    {job.target}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </VividCard>
    </div>
  );
};
