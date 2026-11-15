import React from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { SystemStatusData } from '../../types';
import { Activity, Database, DollarSign, Gauge, Users } from 'lucide-react';

interface AnalyticsBIProps { statusData: SystemStatusData | null; }
const showCount = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

export const AnalyticsBI: React.FC<AnalyticsBIProps> = ({ statusData }) => {
  const comm = statusData?.commercial;
  const completed = comm?.tasksCompleted ?? 0;
  const failed = comm?.tasksFailed ?? 0;
  const measuredTotal = completed + failed;
  const measuredRate = measuredTotal > 0 ? `${(completed / measuredTotal * 100).toFixed(1)}%` : '—';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard title="Recorded task executions" value={showCount(comm?.tasksCompleted)} subtitle="Persisted completion counter" icon={<Activity className="w-5 h-5" />} accentColor="cyan" />
        <MetricCard title="Measured completion rate" value={measuredRate} subtitle={measuredTotal ? `${showCount(measuredTotal)} recorded outcomes` : 'No measured outcomes yet'} icon={<Gauge className="w-5 h-5" />} accentColor="purple" />
        <MetricCard title="Native tokens processed" value={showCount(comm?.totalTokensProcessed)} subtitle="Recorded runtime telemetry" icon={<Database className="w-5 h-5" />} accentColor="lime" />
        <MetricCard title="Revenue integration" value="NOT CONNECTED" subtitle="No verified billing ledger attached" icon={<DollarSign className="w-5 h-5" />} accentColor="coral" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VividCard title="Usage evidence" subtitle="Counters reported by the current system status API." gradientAccent="cyan">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--app-surface-elevated)] p-3"><span className="text-[var(--app-text-secondary)]">Completed tasks</span><strong className="text-[var(--app-text-primary)]">{showCount(comm?.tasksCompleted)}</strong></div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--app-surface-elevated)] p-3"><span className="text-[var(--app-text-secondary)]">Failed tasks</span><strong className="text-[var(--app-text-primary)]">{showCount(comm?.tasksFailed)}</strong></div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--app-surface-elevated)] p-3"><span className="text-[var(--app-text-secondary)]">Recorded tokens</span><strong className="text-[var(--app-text-primary)]">{showCount(comm?.totalTokensProcessed)}</strong></div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--app-surface-elevated)] p-3"><span className="text-[var(--app-text-secondary)]">Current phase</span><strong className="text-[var(--app-text-primary)]">{comm?.currentPhase || 'UNVERIFIED'}</strong></div>
          </div>
        </VividCard>
        <VividCard title="Commercial measurement status" subtitle="Simulated revenue is not presented as actual revenue." gradientAccent="coral">
          <div className="flex items-start gap-3"><Users className="w-5 h-5 text-[var(--app-accent)] shrink-0 mt-0.5" /><div className="space-y-2"><p className="text-sm text-[var(--app-text-primary)]">Billing provider, paid invoices, customer count, churn, and actual cloud-cost attribution are not connected to this dashboard.</p><p className="text-xs text-[var(--app-text-secondary)]">Financial KPIs remain unreported until they are sourced from a verified billing and cost ledger. No projections are substituted for measured values.</p></div></div>
        </VividCard>
      </div>
    </div>
  );
};
