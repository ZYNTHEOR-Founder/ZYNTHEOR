import React, { useEffect, useState } from 'react';
import { VividCard } from './ui/VividCard';
import { Cpu, HardDrive, Activity } from 'lucide-react';
import { apiUrl } from '../lib/apiClient';

type ResourceTelemetry = {
  cpuPercent?: number;
  processHeapUsedMb?: number;
  processHeapTotalMb?: number;
  processRssMb?: number;
  systemRamUsedMb?: number;
  systemRamTotalMb?: number;
  systemRamFreeMb?: number;
};

interface HardwareMonitorProps {
  isTraining: boolean;
  activeModelLabel?: string;
}

const formatMb = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} MB` : '—';

export const HardwareMonitor: React.FC<HardwareMonitorProps> = ({ isTraining, activeModelLabel }) => {
  const [telemetry, setTelemetry] = useState<ResourceTelemetry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchResources = async () => {
      try {
        const res = await fetch(apiUrl('/api/system/status'));
        if (!res.ok) throw new Error(`Runtime telemetry unavailable (${res.status})`);
        const data = await res.json();
        if (!data.success || !data.resources) throw new Error(data.error || 'Runtime telemetry not returned');
        if (active) {
          const current = data.resources.current || data.resources;
          setTelemetry({
            cpuPercent: current.cpuPercent,
            processHeapUsedMb: current.processHeapUsedMb,
            processHeapTotalMb: current.processHeapTotalMb,
            processRssMb: current.processRssMb,
            systemRamUsedMb: current.systemRamUsedMb,
            systemRamTotalMb: current.systemRamTotalMb,
            systemRamFreeMb: current.systemRamFreeMb,
          });
          setLoadError(null);
        }
      } catch (error: any) {
        if (active) setLoadError(error?.message || 'Runtime telemetry unavailable');
      }
    };

    void fetchResources();
    const interval = setInterval(() => void fetchResources(), isTraining ? 1500 : 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isTraining]);

  const metricCards = [
    {
      title: 'CPU usage',
      value: typeof telemetry?.cpuPercent === 'number' ? `${telemetry.cpuPercent.toFixed(1)}%` : '—',
      detail: 'Reported by runtime',
      icon: <Cpu className="h-4 w-4 text-[#CCFF00]" />,
    },
    {
      title: 'Process memory',
      value: formatMb(telemetry?.processRssMb),
      detail: `Heap ${formatMb(telemetry?.processHeapUsedMb)} / ${formatMb(telemetry?.processHeapTotalMb)}`,
      icon: <Activity className="h-4 w-4 text-[#00F0FF]" />,
    },
    {
      title: 'Host memory',
      value: `${formatMb(telemetry?.systemRamUsedMb)} / ${formatMb(telemetry?.systemRamTotalMb)}`,
      detail: `Free ${formatMb(telemetry?.systemRamFreeMb)}`,
      icon: <HardDrive className="h-4 w-4 text-[#FF5E3A]" />,
    },
  ];

  return (
    <VividCard
      title={`Runtime resources${activeModelLabel ? ` · ${activeModelLabel}` : ''}`}
      subtitle="Only telemetry returned by the server is displayed."
      gradientAccent="cyan"
    >
      {loadError && !telemetry && (
        <p role="status" className="mb-3 text-xs text-[var(--app-text-secondary)]">{loadError}</p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {metricCards.map((metric) => (
          <div key={metric.title} className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--app-text-secondary)]">
              {metric.icon}
              <span>{metric.title}</span>
            </div>
            <div className="mt-2 text-xl font-bold font-mono tabular-nums text-[var(--app-text-primary)]">{metric.value}</div>
            <div className="mt-1 text-[10px] text-[var(--app-text-secondary)]">{metric.detail}</div>
          </div>
        ))}
      </div>
      {loadError && telemetry && (
        <p role="status" className="mt-3 text-[10px] text-[var(--app-text-secondary)]">Latest refresh failed: {loadError}</p>
      )}
    </VividCard>
  );
};

export default HardwareMonitor;
