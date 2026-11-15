import React, { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import { Cpu, HardDrive, Zap, Server, Activity } from 'lucide-react';
import { ResourceSample } from '../types';

interface ResourceMonitorProps {
  history?: ResourceSample[];
  current?: ResourceSample;
}

export const ResourceMonitor: React.FC<ResourceMonitorProps> = ({ history = [], current }) => {
  const [activeMetric, setActiveMetric] = useState<'all' | 'load' | 'process_memory' | 'system_ram'>('all');

  const chartData = history.length > 0 ? history : (current ? [current] : []);
  const latest = current || (chartData.length > 0 ? chartData[chartData.length - 1] : undefined);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-[var(--app-surface)] border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)] p-3 rounded-xl shadow-xl text-xs font-mono space-y-1">
          <div className="text-[var(--app-text-secondary)] font-bold border-b border-[var(--app-card-border)] pb-1 mb-1">
            Timestamp: {label}
          </div>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5" style={{ color: entry.color }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                {entry.name}:
              </span>
              <span className="font-bold text-[var(--app-text-primary)]">
                {entry.value} {entry.unit || ''}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const cpuCores = latest?.cpuCores || 1;
  const load1m = latest?.loadAvg1m ?? 0;
  const loadRatio = cpuCores > 0 ? (load1m / cpuCores) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Honest OS Telemetry Strips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Metric 1: System Load Average */}
        <div className="p-3.5 rounded-xl bg-[color-mix(in_srgb,var(--app-bg)_60%,transparent)] border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)]">
          <div className="flex items-center justify-between text-[var(--app-text-secondary)] text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-[var(--app-text-secondary)]">
              <Cpu className="w-3.5 h-3.5 text-[var(--z-ok)]" /> System Load Avg
            </span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${loadRatio > 100 ? 'bg-[color-mix(in_srgb,var(--app-amber)_40%,transparent)] text-[var(--app-amber)]' : 'bg-[color-mix(in_srgb,var(--z-ok)_40%,transparent)] text-[var(--z-ok)]'}`}>
              {loadRatio > 100 ? 'SATURATED' : 'NOMINAL'}
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-[var(--app-text-primary)] mt-1.5 tabular-nums">
            {load1m.toFixed(2)}{' '}
            <span className="text-xs text-[var(--app-text-secondary)] font-normal">/ {cpuCores} cores</span>
          </div>
          <div className="text-[10px] text-[var(--app-text-secondary)] mt-1 flex justify-between font-mono">
            <span>5m: {latest?.loadAvg5m?.toFixed(2) ?? '—'}</span>
            <span>15m: {latest?.loadAvg15m?.toFixed(2) ?? '—'}</span>
          </div>
        </div>

        {/* Metric 2: Process Node Heap */}
        <div className="p-3.5 rounded-xl bg-[color-mix(in_srgb,var(--app-bg)_60%,transparent)] border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)]">
          <div className="flex items-center justify-between text-[var(--app-text-secondary)] text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-[var(--app-text-secondary)]">
              <Server className="w-3.5 h-3.5 text-[var(--app-accent)]" /> Process Heap
            </span>
            <span className="text-[10px] text-[var(--app-accent)] font-mono px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]">
              NODE RSS
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-[var(--app-text-primary)] mt-1.5 tabular-nums">
            {latest?.processHeapUsedMb?.toFixed(1) ?? '—'}{' '}
            <span className="text-xs text-[var(--app-text-secondary)] font-normal">MB</span>
          </div>
          <div className="text-[10px] text-[var(--app-text-secondary)] mt-1 flex justify-between font-mono">
            <span>Total: {latest?.processHeapTotalMb?.toFixed(1) ?? '—'} MB</span>
            <span>RSS: {latest?.processRssMb?.toFixed(1) ?? '—'} MB</span>
          </div>
        </div>

        {/* Metric 3: System Physical RAM */}
        <div className="p-3.5 rounded-xl bg-[color-mix(in_srgb,var(--app-bg)_60%,transparent)] border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)]">
          <div className="flex items-center justify-between text-[var(--app-text-secondary)] text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-[var(--app-text-secondary)]">
              <HardDrive className="w-3.5 h-3.5 text-[var(--app-accent)]" /> Host Memory
            </span>
            <span className="text-[10px] text-[var(--app-accent)] font-mono px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]">
              PHYSICAL
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-[var(--app-text-primary)] mt-1.5 tabular-nums">
            {latest?.systemRamUsedMb ? Math.round(latest.systemRamUsedMb) : '—'}{' '}
            <span className="text-xs text-[var(--app-text-secondary)] font-normal">/ {latest?.systemRamTotalMb ? Math.round(latest.systemRamTotalMb) : '—'} MB</span>
          </div>
          <div className="text-[10px] text-[var(--app-text-secondary)] mt-1 font-mono">
            Free: {latest?.systemRamFreeMb ? Math.round(latest.systemRamFreeMb) : '—'} MB available
          </div>
        </div>

        {/* Metric 4: Real Measured Throughput */}
        <div className="p-3.5 rounded-xl bg-[color-mix(in_srgb,var(--app-bg)_60%,transparent)] border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)]">
          <div className="flex items-center justify-between text-[var(--app-text-secondary)] text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-[var(--app-text-secondary)]">
              <Zap className="w-3.5 h-3.5 text-[var(--app-amber)]" /> Measured Speed
            </span>
            <span className="text-[10px] text-[var(--z-ok)] font-mono px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]">
              FIRST-PARTY
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-[var(--app-text-primary)] mt-1.5 tabular-nums">
            {latest?.tokensPerSec && latest.tokensPerSec > 0 ? (
              <>
                {latest.tokensPerSec.toFixed(1)}{' '}
                <span className="text-xs text-[var(--app-text-secondary)] font-normal">tok/s</span>
              </>
            ) : (
              <span className="text-sm text-[var(--app-text-secondary)] font-normal">Standby</span>
            )}
          </div>
          <div className="text-[10px] text-[var(--app-text-secondary)] mt-1 font-mono">
            {latest?.lastInferenceLatencyMs ? (
              `Last Latency: ${latest.lastInferenceLatencyMs.toFixed(0)} ms`
            ) : (
              'Awaiting inference trace'
            )}
          </div>
        </div>
      </div>

      {/* Telemetry Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[color-mix(in_srgb,var(--app-card-border)_60%,transparent)]">
        <div className="text-xs font-medium text-[var(--app-text-secondary)] flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[var(--z-ok)]" />
          <span>Real OS & Process Runtime Metrics (Zero Simulation)</span>
        </div>
        <div className="flex items-center gap-1 bg-[color-mix(in_srgb,var(--app-bg)_80%,transparent)] p-1 rounded-lg text-xs border border-[var(--app-card-border)]">
          <button
            onClick={() => setActiveMetric('all')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
              activeMetric === 'all'
                ? 'bg-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setActiveMetric('load')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
              activeMetric === 'load'
                ? 'bg-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
            }`}
          >
            System Load (1m)
          </button>
          <button
            onClick={() => setActiveMetric('process_memory')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
              activeMetric === 'process_memory'
                ? 'bg-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
            }`}
          >
            Process Heap & RSS
          </button>
          <button
            onClick={() => setActiveMetric('system_ram')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
              activeMetric === 'system_ram'
                ? 'bg-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
            }`}
          >
            Host RAM
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-64 w-full bg-[color-mix(in_srgb,var(--app-bg)_60%,transparent)] rounded-2xl border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)] p-3 pt-5">
        {chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[var(--app-text-secondary)] text-xs">
            <Activity className="w-6 h-6 mb-2 text-[var(--app-text-primary)] animate-pulse" />
            <span>Collecting initial real-time OS telemetry samples...</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorLoad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--app-accent)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--app-accent)" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorHeap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--app-accent)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--app-accent)" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorRss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--app-accent)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--app-accent)" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--app-amber)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--app-amber)" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--app-accent)" />
              <XAxis
                dataKey="timeLabel"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: '#64748B' }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: '#64748B' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
              />

              {(activeMetric === 'all' || activeMetric === 'load') && (
                <Area
                  type="monotone"
                  dataKey="loadAvg1m"
                  name="Load Avg (1m)"
                  stroke="var(--app-accent)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorLoad)"
                />
              )}

              {(activeMetric === 'all' || activeMetric === 'process_memory') && (
                <Area
                  type="monotone"
                  dataKey="processHeapUsedMb"
                  name="Heap Used (MB)"
                  stroke="var(--app-accent)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorHeap)"
                />
              )}

              {(activeMetric === 'all' || activeMetric === 'process_memory') && (
                <Area
                  type="monotone"
                  dataKey="processRssMb"
                  name="Process RSS (MB)"
                  stroke="var(--app-accent)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorRss)"
                />
              )}

              {(activeMetric === 'system_ram') && (
                <Area
                  type="monotone"
                  dataKey="systemRamUsedMb"
                  name="Host RAM Used (MB)"
                  stroke="var(--app-amber)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorRam)"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
