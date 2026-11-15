import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { Zap, Play, Clock, CheckCircle2, AlertTriangle, ShieldCheck, RefreshCw, Calendar } from 'lucide-react';

export const AutomationCenter: React.FC = () => {
  const [pipelineState, setPipelineState] = useState<'IDLE' | 'RUNNING' | 'COMPLETED'>('IDLE');

  const jobs = [
    {
      id: 'JOB-901',
      name: 'Continuous Sandbox Test & Verification',
      schedule: 'Every 15 mins (Defined)',
      trigger: 'Cron / File Change',
      status: 'NOT_VERIFIED',
      lastRun: 'No daemon run',
      target: '/workspace/solution.js'
    },
    {
      id: 'JOB-902',
      name: 'Audit Ledger Hash Integrity Probe',
      schedule: 'Hourly (Defined)',
      trigger: 'System Daemon',
      status: 'NOT_VERIFIED',
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
      status: 'NOT_VERIFIED',
      lastRun: 'No daemon run',
      target: 'CommercialManager'
    }
  ];

  const triggerPipeline = () => {
    setPipelineState('RUNNING');
    setTimeout(() => {
      setPipelineState('COMPLETED');
    }, 2000);
  };

  return (
    <div className="space-y-8">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <MetricCard
          title="Active Pipelines"
          value="0 Scheduled (4 Defined)"
          subtitle="No active background cron daemon"
          icon={<Zap className="w-5 h-5" />}
          accentColor="orange"
        />
        <MetricCard
          title="Scheduled Triggers"
          value="NOT VERIFIED"
          subtitle="Awaiting real scheduler runtime proof"
          icon={<Clock className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Security Approvals"
          value="Air-Gapped"
          subtitle="ToolGateway Sandbox Barrier"
          icon={<ShieldCheck className="w-5 h-5" />}
          accentColor="lime"
        />
      </div>

      {/* Main Jobs Table */}
      <VividCard
        title="Automated Agent Job Registry"
        subtitle="Sovereign headless background runners with sandbox isolation"
        gradientAccent="sunset"
        headerAction={
          <button
            onClick={triggerPipeline}
            disabled={pipelineState === 'RUNNING'}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[var(--app-text-primary)] bg-[var(--z-warn)] rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            {pipelineState === 'RUNNING' ? 'Running Pipeline...' : 'Trigger All Jobs'}
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] font-semibold">
                <th className="pb-3 pl-1">Job ID & Name</th>
                <th className="pb-3">Schedule / Cadence</th>
                <th className="pb-3">Trigger Type</th>
                <th className="pb-3">Status</th>
                <th className="pb-3 text-right pr-1">Target Sandbox Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-card-border)]">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-[color-mix(in_srgb,var(--app-surface-elevated)_50%,transparent)] transition-colors">
                  <td className="py-3 pl-1 font-semibold text-[var(--app-text-primary)]">
                    <div>{job.name}</div>
                    <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">{job.id}</div>
                  </td>
                  <td className="py-3 text-[var(--app-text-primary)] font-mono text-[11px]">{job.schedule}</td>
                  <td className="py-3 text-[var(--app-text-secondary)]">{job.trigger}</td>
                  <td className="py-3">
                    <StatusBadge status={job.status as any} />
                  </td>
                  <td className="py-3 text-right pr-1 font-mono text-[11px] text-[var(--app-text-primary)]">
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
