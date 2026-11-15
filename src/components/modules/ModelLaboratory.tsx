import React, { useEffect, useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { useLanguage } from '../../context/LanguageContext';
import { BrainCircuit, Cloud, Database, FileCheck, RefreshCw, ShieldAlert } from 'lucide-react';

const TARGET_PARAMS = 41_527_808;
const count = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

export const ModelLaboratory: React.FC = () => {
  const { lang } = useLanguage();
  const [modelStatus, setModelStatus] = useState<any>(null);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setLastError('');
    try {
      const [runtimeResponse, inspectResponse, datasetsResponse] = await Promise.all([
        fetch('/api/system/status'),
        fetch('/api/model/inspect'),
        fetch('/api/knowledge/datasets')
      ]);
      const [runtime, inspect, datasetData] = await Promise.all([
        runtimeResponse.json(), inspectResponse.json(), datasetsResponse.json()
      ]);
      setModelStatus({ runtime: runtime?.model || null, inspect, inspectHttpOk: inspectResponse.ok });
      if (datasetData?.success) setDatasets(Array.isArray(datasetData.datasets) ? datasetData.datasets : []);
      if (!runtimeResponse.ok) setLastError(runtime?.error || runtime?.reason || `Runtime status HTTP ${runtimeResponse.status}`);
      else if (!runtime?.model?.inferenceReady) setLastError(runtime?.model?.readinessReason || 'Cloud Runtime has not loaded a verified checkpoint.');
    } catch (error: any) {
      setLastError(error?.message || 'Unable to retrieve model evidence.');
      setModelStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const runtime = modelStatus?.runtime;
  const inspect = modelStatus?.inspect;
  const ready = Boolean(runtime?.weightsLoaded && runtime?.inferenceReady);
  const activeParams = ready ? (runtime?.activeParams ?? runtime?.totalParams) : null;
  const payloadBytes = inspect?.payload_bytes;
  const hash = ready ? (runtime?.checkpointHash || inspect?.payload_sha256 || '') : '';
  const digestVerified = ready && Boolean(hash) && inspect?.status !== 'PAYLOAD_INTEGRITY_FAILED';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-[var(--app-text-primary)]">{lang === 'th' ? 'ห้องปฏิบัติการโมเดล Native' : 'Native Model Laboratory'}</h2><p className="text-xs text-[var(--app-text-secondary)] mt-1">{lang === 'th' ? 'ข้อมูลที่โหลดจริงแยกจากสเปกเป้าหมายและสถานะการฝึก' : 'Measured active runtime data is kept separate from target specifications and training readiness.'}</p></div><button type="button" onClick={() => void refresh()} disabled={loading} className="p-2 rounded-xl border border-[var(--app-card-border)] text-[var(--app-text-primary)] disabled:opacity-50" title="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button></div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard title="Active parameters" value={count(activeParams)} subtitle={ready ? 'Cloud Runtime loaded' : 'No verified active weights'} icon={<BrainCircuit className="w-5 h-5" />} accentColor="cyan" />
        <MetricCard title="Target architecture" value={count(runtime?.targetParams ?? TARGET_PARAMS)} subtitle="Specification only · not active" icon={<Cloud className="w-5 h-5" />} accentColor="purple" />
        <MetricCard title="Payload size" value={typeof payloadBytes === 'number' ? `${(payloadBytes / (1024 * 1024)).toFixed(2)} MB` : '—'} subtitle={ready ? 'Cloud checkpoint payload' : 'Unavailable until cloud load'} icon={<Database className="w-5 h-5" />} accentColor="cyan" />
        <MetricCard title="Checkpoint integrity" value={digestVerified ? 'VERIFIED' : 'UNVERIFIED'} subtitle={hash ? hash.slice(0, 16) + '…' : 'No active checkpoint seal'} icon={<FileCheck className="w-5 h-5" />} accentColor={digestVerified ? 'lime' : 'coral'} />
      </div>

      <VividCard title="Runtime & checkpoint evidence" subtitle="No local file is promoted as an active model. Readiness is confirmed by the Native Cloud Runtime." gradientAccent="cyan">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div className="flex items-center gap-2"><span className={`vivid-status-dot ${ready ? 'is-ready' : 'is-blocked'}`} /><span className="text-sm font-semibold text-[var(--app-text-primary)]">{runtime?.runtimeState || 'BLOCKED'}</span></div><StatusBadge status={ready ? 'VERIFIED' : runtime ? 'BLOCKED' : 'UNVERIFIED'} /></div>
        <p className="text-sm leading-6 text-[var(--app-text-secondary)]">{lastError || (ready ? 'Cloud checkpoint is loaded; inference readiness is reported by the active bridge.' : 'No verified checkpoint is loaded. Target architecture values are not active weights.')}</p>
        {hash && <p className="mt-3 text-[11px] break-all font-mono text-[var(--app-text-secondary)]">SHA-256: {hash}</p>}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl bg-[var(--app-surface-elevated)] p-3"><div className="text-[var(--app-text-secondary)]">Target width</div><div className="mt-1 font-semibold text-[var(--app-text-primary)]">512</div></div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] p-3"><div className="text-[var(--app-text-secondary)]">Target layers</div><div className="mt-1 font-semibold text-[var(--app-text-primary)]">10</div></div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] p-3"><div className="text-[var(--app-text-secondary)]">Target heads</div><div className="mt-1 font-semibold text-[var(--app-text-primary)]">8</div></div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] p-3"><div className="text-[var(--app-text-secondary)]">Target FFN</div><div className="mt-1 font-semibold text-[var(--app-text-primary)]">1,472</div></div>
        </div>
      </VividCard>

      <VividCard title="Training governance" subtitle="Training weights requires a verified dataset, provenance checks, an authorized human approval, and an implemented Cloud training runner." gradientAccent="coral">
        <div className="flex items-start gap-3"><ShieldAlert className="w-5 h-5 text-[var(--z-warn)] shrink-0 mt-0.5" /><div className="min-w-0"><StatusBadge status="BLOCKED" /><p className="mt-2 text-sm text-[var(--app-text-secondary)]">{lang === 'th' ? 'ยังไม่เปิดการฝึกและส่งออก checkpoint จากหน้านี้ เพราะ pipeline ที่เชื่อม dataset provenance, human approval และการฝึก Native จริงบน Cloud Runtime ยังไม่ผ่านการตรวจครบ การกดเริ่มจึงไม่ควรเปลี่ยนน้ำหนักโมเดล' : 'Training and checkpoint export are disabled here because dataset provenance, human approval, and the Native Cloud training runner are not yet verified end-to-end. No weights will be changed by this screen.'}</p></div></div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs"><div className="rounded-xl bg-[var(--app-surface-elevated)] p-3"><div className="text-[var(--app-text-secondary)]">Knowledge datasets available</div><div className="mt-1 text-lg font-bold text-[var(--app-text-primary)]">{datasets.length}</div></div><div className="rounded-xl bg-[var(--app-surface-elevated)] p-3"><div className="text-[var(--app-text-secondary)]">Training readiness</div><div className="mt-1 font-bold text-[var(--z-danger)]">NOT READY</div></div></div>
      </VividCard>
    </div>
  );
};
