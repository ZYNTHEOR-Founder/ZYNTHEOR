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
        <div className="bg-[#0D1326] border border-[#1E294A] p-3 rounded-xl shadow-xl text-xs font-mono space-y-1">
          <div className="text-[#94A3C4] font-bold border-b border-[#1E294A] pb-1 mb-1">
            Timestamp: {label}
          </div>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5" style={{ color: entry.color }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                {entry.name}:
              </span>
              <span className="font-bold text-[#F4F7FF]">
                {entry.value} {entry.unit || ''}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const cpuCores = latest?.cpuCores;
  const load1m = latest?.loadAvg1m;

  return (
    <div className="space-y-4">
      {/* Honest OS Telemetry Strips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Metric 1: System Load Average */}
        <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
          <div className="flex items-center justify-between text-[var(--app-text-secondary)] text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-[var(--app-text-primary)]">
              <Cpu className="w-3.5 h-3.5 text-[#CCFF00]" /> System Load Avg
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-[var(--app-text-primary)] mt-1.5 tabular-nums">
            {typeof load1m === 'number' ? load1m.toFixed(2) : '—'}{' '}
            <span className="text-xs text-[var(--app-text-secondary)] font-normal">/ {cpuCores ?? '—'} cores</span>
          </div>
          <div className="text-[10px] text-[var(--app-text-secondary)] mt-1 flex justify-between font-mono tabular-nums">
            <span>5m: {latest?.loadAvg5m?.toFixed(2) ?? '—'}</span>
            <span>15m: {latest?.loadAvg15m?.toFixed(2) ?? '—'}</span>
          </div>
        </div>

        {/* Metric 2: Process Node Heap */}
        <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
          <div className="flex items-center justify-between text-[var(--app-text-secondary)] text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-[var(--app-text-primary)]">
              <Server className="w-3.5 h-3.5 text-[#00F0FF]" /> Process Heap
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-[var(--app-text-primary)] mt-1.5 tabular-nums">
            {latest?.processHeapUsedMb?.toFixed(1) ?? '—'}{' '}
            <span className="text-xs text-[var(--app-text-secondary)] font-normal">MB</span>
          </div>
          <div className="text-[10px] text-[var(--app-text-secondary)] mt-1 flex justify-between font-mono tabular-nums">
            <span>Total: {latest?.processHeapTotalMb?.toFixed(1) ?? '—'} MB</span>
            <span>RSS: {latest?.processRssMb?.toFixed(1) ?? '—'} MB</span>
          </div>
        </div>

        {/* Metric 3: System Physical RAM */}
        <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
          <div className="flex items-center justify-between text-[var(--app-text-secondary)] text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-[var(--app-text-primary)]">
              <HardDrive className="w-3.5 h-3.5 text-[#7B2CBF]" /> Host Memory
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-[var(--app-text-primary)] mt-1.5 tabular-nums">
            {latest?.systemRamUsedMb ? Math.round(latest.systemRamUsedMb) : '—'}{' '}
            <span className="text-xs text-[var(--app-text-secondary)] font-normal">/ {latest?.systemRamTotalMb ? Math.round(latest.systemRamTotalMb) : '—'} MB</span>
          </div>
          <div className="text-[10px] text-[var(--app-text-secondary)] mt-1 font-mono tabular-nums">
            Free: {latest?.systemRamFreeMb ? Math.round(latest.systemRamFreeMb) : '—'} MB available
          </div>
        </div>

        {/* Metric 4: Real Measured Throughput */}
        <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
          <div className="flex items-center justify-between text-[var(--app-text-secondary)] text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-[var(--app-text-primary)]">
              <Zap className="w-3.5 h-3.5 text-[#FF5E3A]" /> Measured Speed
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-[var(--app-text-primary)] mt-1.5 tabular-nums">
            {latest?.tokensPerSec && latest.tokensPerSec > 0 ? (
              <>
                {latest.tokensPerSec.toFixed(1)}{' '}
                <span className="text-xs text-[var(--app-text-secondary)] font-normal">tok/s</span>
              </>
            ) : (
              <span className="text-sm text-[var(--app-text-secondary)] font-normal">—</span>
            )}
          </div>
          <div className="text-[10px] text-[var(--app-text-secondary)] mt-1 font-mono tabular-nums">
            {latest?.lastInferenceLatencyMs ? (
              `Last Latency: ${latest.lastInferenceLatencyMs.toFixed(0)} ms`
            ) : (
              'Awaiting inference trace'
            )}
          </div>
        </div>
      </div>

      {/* Telemetry Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--app-card-border)]">
        <div className="text-xs font-medium text-[var(--app-text-secondary)] flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#00F0FF]" />
          <span>Real OS &amp; Process Runtime Metrics (Zero Simulation)</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 bg-[var(--app-input-bg)] p-1 rounded-lg text-xs border border-[var(--app-card-border)]">
          <button
            onClick={() => setActiveMetric('all')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
              activeMetric === 'all'
                ? 'bg-[#00F0FF]/20 text-[#00F0FF] border border-[#00F0FF]/40'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setActiveMetric('load')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
              activeMetric === 'load'
                ? 'bg-[#CCFF00]/20 text-[#CCFF00] border border-[#CCFF00]/40'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
            }`}
          >
            System Load (1m)
          </button>
          <button
            onClick={() => setActiveMetric('process_memory')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
              activeMetric === 'process_memory'
                ? 'bg-[#7B2CBF]/25 text-[#00F0FF] border border-[#7B2CBF]/50'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
            }`}
          >
            Process Heap &amp; RSS
          </button>
          <button
            onClick={() => setActiveMetric('system_ram')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
              activeMetric === 'system_ram'
                ? 'bg-[#FF5E3A]/20 text-[#FF5E3A] border border-[#FF5E3A]/40'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
            }`}
          >
            Host RAM
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-64 w-full bg-[#070B19] rounded-2xl border border-[#1E294A] p-3 pt-5">
        {chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[#94A3C4] text-xs">
            <Activity className="w-6 h-6 mb-2 text-[#00F0FF]/50" />
            <span>No telemetry samples received yet.</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorLoad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#CCFF00" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#CCFF00" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorHeap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00F0FF" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#00F0FF" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorRss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7B2CBF" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#7B2CBF" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FF5E3A" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#FF5E3A" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1E294A" />
              <XAxis
                dataKey="timeLabel"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: '#94A3C4' }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: '#94A3C4' }}
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
                  stroke="#CCFF00"
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
                  stroke="#00F0FF"
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
                  stroke="#7B2CBF"
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
                  stroke="#FF5E3A"
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
