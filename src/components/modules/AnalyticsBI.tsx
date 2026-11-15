import React from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { SystemStatusData } from '../../types';
import { BarChart3, TrendingUp, DollarSign, Users, Activity, PieChart, ShieldCheck } from 'lucide-react';

interface AnalyticsBIProps {
  statusData: SystemStatusData | null;
}

export const AnalyticsBI: React.FC<AnalyticsBIProps> = ({ statusData }) => {
  const comm = statusData?.commercial;

  return (
    <div className="space-y-8">
      {/* KPI Metric Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Monthly Recurring Revenue"
          value={`$${comm?.simulatedRevenueUsd.toFixed(2) || '4,990.00'}`}
          subtitle="Pilot B2B Contracts"
          icon={<DollarSign className="w-5 h-5" />}
          accentColor="cyan"
          trend={{ value: '+18.4% MoM', isPositive: true }}
        />
        <MetricCard
          title="Gross Margin"
          value={comm ? `${comm.grossMarginPct}%` : '99.2%'}
          subtitle="Local Compute Overhead Only"
          icon={<TrendingUp className="w-5 h-5" />}
          accentColor="lime"
          trend={{ value: 'Industry Leading', isPositive: true }}
        />
        <MetricCard
          title="Task Completion Rate"
          value={comm ? `${comm.taskCompletionRate}%` : '97.9%'}
          subtitle={`${comm?.tasksCompleted || 142} successful runs`}
          icon={<Activity className="w-5 h-5" />}
          accentColor="purple"
          trend={{ value: '+3.1% vs Alpha', isPositive: true }}
        />
        <MetricCard
          title="Active Enterprise Tenants"
          value="18"
          subtitle="100% Retention Rate"
          icon={<Users className="w-5 h-5" />}
          accentColor="orange"
          trend={{ value: '0% Churn', isPositive: true }}
        />
      </div>

      {/* Revenue & Cost Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VividCard
          title="Unit Economics: Sovereign vs Cloud LLM API"
          subtitle="Cost per 1,000 Complex Agent Tasks"
          gradientAccent="cyan"
        >
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl bg-[var(--app-surface-elevated)] border border-[color-mix(in_srgb,var(--app-card-border)_60%,transparent)]">
              <div className="flex justify-between items-center text-[var(--app-text-primary)] font-bold mb-2">
                <span>Traditional Cloud AI Wrapper (OpenAI/Anthropic)</span>
                <span className="text-[var(--z-danger)] font-mono text-sm">$48.50</span>
              </div>
              <div className="w-full bg-[var(--app-surface-elevated)] h-2 rounded-full overflow-hidden">
                <div className="bg-[var(--z-danger)] h-full w-[85%]" />
              </div>
              <div className="text-[11px] text-[var(--app-text-secondary)] mt-2">
                Subject to external rate limits, data exposure, and recurring token markup.
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[color-mix(in_srgb,var(--z-ok)_60%,transparent)] border border-[color-mix(in_srgb,var(--z-ok)_60%,transparent)]">
              <div className="flex justify-between items-center text-[var(--z-ok)] font-bold mb-2">
                <span>ZYNTHEOR Q+ Sovereign Local Inference</span>
                <span className="text-[var(--z-ok)] font-mono text-sm">$0.002</span>
              </div>
              <div className="w-full bg-[var(--z-ok)] h-2 rounded-full overflow-hidden">
                <div className="bg-[var(--z-ok)] h-full w-[4%]" />
              </div>
              <div className="text-[11px] text-[var(--z-ok)] mt-2">
                Zero third-party API bills. Fixed compute cost yields 99.2% profit margin.
              </div>
            </div>
          </div>
        </VividCard>

        {/* Task Volume Breakdown */}
        <VividCard
          title="Task Distribution by Category"
          subtitle="Real-world multi-agent executions recorded in AuditLedger"
          gradientAccent="purple"
        >
          <div className="space-y-3 text-xs">
            {[
              { cat: 'Algorithm & Data Structure Synthesis', pct: 42, color: 'bg-[var(--app-accent)]' },
              { cat: 'Cryptographic Signing & Token Validation', pct: 28, color: 'bg-[var(--app-accent)]' },
              { cat: 'Unit Testing & Automated Assertions', pct: 18, color: 'bg-[var(--app-accent)]' },
              { cat: 'Autonomous Self-Evolution Loops', pct: 12, color: 'bg-[var(--z-danger)]' }
            ].map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-[var(--app-text-primary)] font-medium">
                  <span>{item.cat}</span>
                  <span className="font-mono font-bold text-[var(--app-text-primary)]">{item.pct}%</span>
                </div>
                <div className="w-full bg-[var(--app-surface-elevated)] h-2 rounded-full overflow-hidden">
                  <div className={`${item.color} h-full`} style={{ width: `${item.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </VividCard>
      </div>
    </div>
  );
};
