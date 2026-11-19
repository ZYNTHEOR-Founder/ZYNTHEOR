import React, { useEffect, useState } from 'react';
import { VividCard } from './ui/VividCard';
import { useLanguage } from '../context/LanguageContext';
import { Cpu, HardDrive, Activity } from 'lucide-react';

interface HardwareMonitorProps {
  isTraining: boolean;
  memoryBudgetMb?: number;
}

interface ResourceTelemetry {
  cpuPercent: number;
  processHeapUsedMb: number;
  processRssMb: number;
  systemRamUsedMb: number;
  systemRamTotalMb: number;
  vramMb: number;
  vramMaxMb: number;
}

export const HardwareMonitor: React.FC<HardwareMonitorProps> = ({
  isTraining,
  memoryBudgetMb = 512
}) => {
  const { lang } = useLanguage();
  const th = lang === 'th';

  const [telemetry, setTelemetry] = useState<ResourceTelemetry>({
    cpuPercent: 0,
    processHeapUsedMb: 0,
    processRssMb: 0,
    systemRamUsedMb: 0,
    systemRamTotalMb: 1,
    vramMb: 0,
    vramMaxMb: memoryBudgetMb
  });

  useEffect(() => {
    let active = true;
    const fetchResources = async () => {
      try {
        const res = await fetch('/api/system/status');
        const data = await res.json();
        if (active && data.success && data.resources) {
          const r = data.resources;
          setTelemetry({
            cpuPercent: r.cpuPercent ?? 0,
            processHeapUsedMb: r.processHeapUsedMb ?? 0,
            processRssMb: r.processRssMb ?? 0,
            systemRamUsedMb: r.systemRamUsedMb ?? 0,
            systemRamTotalMb: r.systemRamTotalMb ?? 1,
            vramMb: r.vramMb ?? r.processHeapUsedMb ?? 0,
            vramMaxMb: memoryBudgetMb
          });
        }
      } catch {
        // ignore transient poll errors
      }
    };

    fetchResources();
    const interval = setInterval(fetchResources, isTraining ? 1500 : 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isTraining, memoryBudgetMb]);

  const ramPct = Math.min(100, Math.round((telemetry.processRssMb / Math.max(1, memoryBudgetMb)) * 100));
  const vramPct = Math.min(100, Math.round((telemetry.vramMb / Math.max(1, telemetry.vramMaxMb)) * 100));
  const withinBudget = telemetry.processRssMb <= memoryBudgetMb;

  return (
    <VividCard
      title={th ? 'มอนิเตอร์ฮาร์ดแวร์ (HardwareMonitor · จำกัดหน่วยความจำ 33.9M)' : 'HardwareMonitor (33.9M Memory-Bounded)'}
      subtitle={
        th
          ? `การใช้ CPU, RAM และ VRAM แบบเรียลไทม์ · งบประมาณ: ${memoryBudgetMb} MB`
          : `Real-time CPU, RAM & VRAM utilization · Budget: ${memoryBudgetMb} MB`
      }
      gradientAccent="emerald"
    >
      <div className="flex justify-end mb-3">
        <span
          className={`px-2.5 py-1 rounded-md text-[10px] font-bold font-mono border ${
            withinBudget
              ? 'bg-[color-mix(in_srgb,var(--z-ok)_14%,transparent)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
              : 'bg-[color-mix(in_srgb,var(--app-amber)_14%,transparent)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)]'
          }`}
        >
          {withinBudget ? (th ? 'BOUNDED OK (ปกติ)' : 'BOUNDED OK') : th ? 'NEAR BUDGET (ใกล้ขีดจำกัด)' : 'NEAR BUDGET'}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-[var(--app-text-secondary)] font-semibold">
              <Cpu className="w-3.5 h-3.5 text-[var(--app-accent)]" />
              {th ? 'ภาระ CPU (CPU Load)' : 'CPU Load'}
            </span>
            <span className="font-mono font-bold text-[var(--app-text-primary)]">{telemetry.cpuPercent}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--app-bg)] overflow-hidden">
            <div
              className="h-full bg-[var(--app-accent)] transition-all duration-300"
              style={{ width: `${telemetry.cpuPercent}%` }}
            />
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-[var(--app-text-secondary)] font-semibold">
              <HardDrive className="w-3.5 h-3.5 text-[var(--app-amber)]" />
              {th ? 'Process RSS / งบประมาณ' : 'Process RSS / Budget'}
            </span>
            <span className="font-mono font-bold text-[var(--app-text-primary)]">
              {telemetry.processRssMb.toFixed(1)} / {memoryBudgetMb} MB
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--app-bg)] overflow-hidden">
            <div
              className="h-full bg-[var(--app-amber)] transition-all duration-300"
              style={{ width: `${ramPct}%` }}
            />
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-[var(--app-text-secondary)] font-semibold">
              <Activity className="w-3.5 h-3.5 text-[var(--app-accent)]" />
              {th ? 'Heap / บัฟเฟอร์ Tensor' : 'Heap / Tensor Buffer'}
            </span>
            <span className="font-mono font-bold text-[var(--app-text-primary)]">
              {telemetry.vramMb.toFixed(1)} MB
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--app-bg)] overflow-hidden">
            <div
              className="h-full bg-[var(--z-ok)] transition-all duration-300"
              style={{ width: `${vramPct}%` }}
            />
          </div>
        </div>
      </div>
    </VividCard>
  );
};
