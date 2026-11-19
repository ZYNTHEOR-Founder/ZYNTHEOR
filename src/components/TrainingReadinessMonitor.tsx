import React, { useCallback, useEffect, useState } from 'react';
import { VividCard } from './ui/VividCard';
import { StatusBadge } from './ui/StatusBadge';
import { useLanguage } from '../context/LanguageContext';
import {
  Activity,
  Cpu,
  HardDrive,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

interface GradientPoint {
  step: number;
  gradNorm: number;
  trainLoss: number | null;
  valLoss: number | null;
  lr: number | null;
}

interface TrainingReadinessData {
  success: boolean;
  checkedAt: string;
  pythonBackend: {
    pythonAvailable: boolean;
    pythonVersion: string | null;
    pythonExecutable: string | null;
    numpyAvailable: boolean;
    numpyVersion: string | null;
    boto3Available?: boolean;
    boto3Version?: string | null;
    npCompatAvailable: boolean;
    seqLmImportable: boolean;
    pythonRssMb: number | null;
    backendMode: 'NUMPY_NATIVE' | 'NUMPY_MISSING_BLOCKED' | 'UNAVAILABLE';
    target41mNumpyGate: 'READY' | 'BLOCKED';
    probeLatencyMs: number;
    error: string | null;
  };
  memory: {
    systemTotalMb: number;
    systemUsedMb: number;
    systemFreeMb: number;
    systemUsedPct: number;
    nodeHeapUsedMb: number;
    nodeHeapTotalMb: number;
    nodeRssMb: number;
    pythonRssMb: number | null;
  };
  gradientStability: {
    status: 'STABLE' | 'ELEVATED' | 'UNSTABLE' | 'UNAVAILABLE';
    sourceArtifact: string | null;
    totalSamples: number;
    latestGradNorm: number | null;
    minGradNorm: number | null;
    maxGradNorm: number | null;
    meanGradNorm: number | null;
    stdDevGradNorm: number | null;
    nonFiniteCount: number;
    clipThreshold: number;
    bestValLoss: number | null;
    recentPoints: GradientPoint[];
  };
  checkpointSave: {
    status: 'READY' | 'WRITABLE_TARGET_MISSING' | 'READ_ONLY' | 'BLOCKED';
    storageWritable: boolean;
    writableDirsCount: number;
    targetCheckpointPath: string;
    targetCheckpointPresent: boolean;
    localPtCount: number;
    latestCheckpoint: {
      path: string;
      sizeBytes: number;
      modifiedAt: string;
    } | null;
    pipelineRunsCount: number;
    latestRunStatus: string | null;
    latestRunLifecycle: string | null;
    cloudStorageConfigured: boolean;
    cloudStorageReachable: boolean;
  };
}

export const TrainingReadinessMonitor: React.FC = () => {
  const { lang } = useLanguage();
  const th = lang === 'th';
  const [data, setData] = useState<TrainingReadinessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/system/training-readiness');
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error || `Training readiness HTTP ${res.status}`);
      }
      setData(json as TrainingReadinessData);
    } catch (err: any) {
      setError(
        err?.message ||
          (th
            ? 'ไม่สามารถตรวจสอบความพร้อมการฝึก Python/NumPy ได้'
            : 'Unable to probe Python/NumPy training readiness.')
      );
    } finally {
      setLoading(false);
    }
  }, [th]);

  useEffect(() => {
    void fetchReadiness();
    const timer = setInterval(() => {
      void fetchReadiness();
    }, 15000);
    return () => clearInterval(timer);
  }, [fetchReadiness]);

  const py = data?.pythonBackend;
  const mem = data?.memory;
  const grad = data?.gradientStability;
  const ckpt = data?.checkpointSave;

  const overallBadgeStatus =
    py?.numpyAvailable && grad?.status === 'STABLE' && ckpt?.storageWritable
      ? 'VERIFIED'
      : py?.numpyAvailable
        ? 'PARTIAL'
        : 'BLOCKED';

  const maxChartGrad =
    grad?.recentPoints && grad.recentPoints.length > 0
      ? Math.max(...grad.recentPoints.map((p) => p.gradNorm), 1)
      : 1;

  return (
    <div data-testid="training-readiness-monitor">
      <VividCard
        title={th ? 'มอนิเตอร์ความพร้อมการฝึก (Training Readiness Monitor)' : 'Training Readiness Monitor'}
        subtitle={
          th
            ? 'ตรวจสุขภาพ Python/NumPy แบบเรียลไทม์ การใช้หน่วยความจำ ความเสถียรของ Gradient และสถานะการบันทึก Checkpoint'
            : 'Real-time health checks for the Python/NumPy backend, memory footprint, gradient stability metrics, and checkpoint save status.'
        }
        gradientAccent="violet"
        headerAction={
          <div className="flex items-center gap-2">
            <StatusBadge status={overallBadgeStatus} />
            <button
              type="button"
              onClick={() => void fetchReadiness()}
              disabled={loading}
              className="p-2 rounded-xl border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] disabled:opacity-50 cursor-pointer"
              title={th ? 'รีเฟรชการตรวจสอบความพร้อมการฝึก' : 'Refresh training readiness probe'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      >
        {error ? (
          <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] border border-[var(--z-danger)] text-xs font-mono text-[var(--z-danger)]">
            {error}
          </div>
        ) : !data ? (
          <div className="p-6 text-center text-xs font-mono text-[var(--app-text-secondary)]">
            {th
              ? 'กำลังตรวจสอบ Python/NumPy backend และหลักฐาน Gradient…'
              : 'Probing Python/NumPy backend and gradient evidence…'}
          </div>
        ) : (
          <div className="space-y-4">
            {/* 4-column Health Matrix */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
              {/* 1. Python / NumPy Backend */}
              <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[var(--app-text-primary)] flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
                    Python / NumPy Backend
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                      py?.numpyAvailable
                        ? 'text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)]'
                        : 'text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)]'
                    }`}
                  >
                    {py?.backendMode}
                  </span>
                </div>
                <div className="font-mono text-[11px] space-y-1 text-[var(--app-text-secondary)]">
                  <div>
                    Python:{' '}
                    <span className="text-[var(--app-text-primary)] font-semibold">
                      {py?.pythonVersion || (th ? 'ไม่พร้อมใช้งาน' : 'unavailable')}
                    </span>{' '}
                    · {py?.probeLatencyMs}ms
                  </div>
                  <div>
                    NumPy / boto3:{' '}
                    <span className={py?.numpyAvailable ? 'text-[var(--z-ok)] font-semibold' : 'text-[var(--z-danger)] font-semibold'}>
                      {py?.numpyAvailable
                        ? `v${py.numpyVersion}`
                        : th
                          ? 'BLOCKED (ไม่มี NumPy)'
                          : 'BLOCKED (NumPy missing)'}
                    </span>
                    {' · '}
                    <span className={py?.boto3Available ? 'text-[var(--z-ok)]' : 'text-[var(--z-warn)]'}>
                      {py?.boto3Available
                        ? `boto3 v${py.boto3Version || 'ok'}`
                        : th
                          ? 'ไม่มี boto3'
                          : 'boto3 missing'}
                    </span>
                  </div>
                  <div>
                    {th ? 'เกณฑ์ 41.5M' : '41.5M Target Gate'}:{' '}
                    <span className={py?.target41mNumpyGate === 'READY' ? 'text-[var(--z-ok)] font-bold' : 'text-[var(--z-danger)] font-bold'}>
                      {py?.target41mNumpyGate}
                    </span>
                  </div>
                </div>
                {py?.error && (
                  <div className="text-[10px] leading-relaxed text-[var(--app-text-secondary)] border-t border-[var(--app-card-border)] pt-1.5">
                    {py.error}
                  </div>
                )}
              </div>

              {/* 2. Memory Usage */}
              <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[var(--app-text-primary)] flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-[var(--app-amber)] shrink-0" />
                    {th ? 'การใช้หน่วยความจำ' : 'Memory Usage'}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-[var(--app-accent)]">
                    {mem?.systemUsedPct ?? 0}% OS RAM
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--app-input-bg)] overflow-hidden border border-[var(--app-card-border)]">
                  <div
                    className="h-full bg-[var(--app-accent)] transition-all"
                    style={{ width: `${Math.min(100, Math.max(2, mem?.systemUsedPct ?? 0))}%` }}
                  />
                </div>
                <div className="font-mono text-[11px] space-y-1 text-[var(--app-text-secondary)]">
                  <div>
                    {th ? 'ระบบ' : 'System'}: <span className="text-[var(--app-text-primary)]">{mem?.systemUsedMb.toLocaleString()}</span> / {mem?.systemTotalMb.toLocaleString()} MB
                  </div>
                  <div>
                    Node Heap / RSS: <span className="text-[var(--app-text-primary)]">{mem?.nodeHeapUsedMb} MB</span> / {mem?.nodeRssMb} MB
                  </div>
                  <div>
                    Python Probe RSS:{' '}
                    <span className="text-[var(--app-text-primary)]">
                      {mem?.pythonRssMb !== null && mem?.pythonRssMb !== undefined ? `${mem.pythonRssMb} MB` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Gradient Stability Metrics */}
              <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[var(--app-text-primary)] flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-[var(--z-ok)] shrink-0" />
                    {th ? 'ความเสถียร Gradient' : 'Gradient Stability'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                      grad?.status === 'STABLE'
                        ? 'text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)]'
                        : grad?.status === 'ELEVATED'
                          ? 'text-[var(--z-warn)] border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-warn)_12%,transparent)]'
                          : 'text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)]'
                    }`}
                  >
                    {grad?.status || 'UNAVAILABLE'}
                  </span>
                </div>
                <div className="font-mono text-[11px] space-y-1 text-[var(--app-text-secondary)]">
                  <div>
                    {th ? 'ล่าสุด / เฉลี่ย' : 'Latest / Mean'} ‖g‖₂:{' '}
                    <span className="text-[var(--app-text-primary)] font-semibold">
                      {grad?.latestGradNorm ?? '—'} / {grad?.meanGradNorm ?? '—'}
                    </span>
                  </div>
                  <div>
                    {th ? 'ช่วง / σ' : 'Range / σ'}:{' '}
                    <span className="text-[var(--app-text-primary)]">
                      {grad?.minGradNorm ?? '—'}–{grad?.maxGradNorm ?? '—'} (σ={grad?.stdDevGradNorm ?? '—'})
                    </span>
                  </div>
                  <div>
                    Non-finite: <span className={grad?.nonFiniteCount === 0 ? 'text-[var(--z-ok)] font-bold' : 'text-[var(--z-danger)] font-bold'}>{grad?.nonFiniteCount ?? 0}</span> · Clip={grad?.clipThreshold}
                  </div>
                </div>
                {grad?.recentPoints && grad.recentPoints.length > 0 && (
                  <div className="flex items-end gap-1 h-8 pt-1 border-t border-[var(--app-card-border)]" aria-label={th ? 'ประวัติ Gradient norm' : 'Gradient norm history'}>
                    {grad.recentPoints.map((pt) => {
                      const heightPct = Math.max(12, Math.round((pt.gradNorm / maxChartGrad) * 100));
                      return (
                        <div
                          key={pt.step}
                          title={`Step ${pt.step}: grad_norm=${pt.gradNorm.toFixed(3)}, val_loss=${pt.valLoss?.toFixed(3) ?? '—'}`}
                          className="flex-1 rounded-sm bg-[var(--app-accent)] opacity-80 hover:opacity-100 transition-opacity"
                          style={{ height: `${heightPct}%` }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 4. Checkpoint Save Status */}
              <div className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[var(--app-text-primary)] flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
                    {th ? 'สถานะบันทึก Checkpoint' : 'Checkpoint Save Status'}
                  </span>
                  {ckpt?.storageWritable ? (
                    <ShieldCheck className="w-4 h-4 text-[var(--z-ok)]" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-[var(--z-danger)]" />
                  )}
                </div>
                <div className="font-mono text-[11px] space-y-1 text-[var(--app-text-secondary)]">
                  <div>
                    {th ? 'พื้นที่ดิสก์' : 'Local Storage'}:{' '}
                    <span className={ckpt?.storageWritable ? 'text-[var(--z-ok)] font-bold' : 'text-[var(--z-danger)] font-bold'}>
                      {ckpt?.storageWritable
                        ? `WRITABLE (${ckpt.writableDirsCount} ${th ? 'โฟลเดอร์' : 'dirs'})`
                        : 'READ_ONLY'}
                    </span>
                  </div>
                  <div>
                    {th ? 'ไฟล์เป้าหมาย 41.5M' : '41.5M Target File'}:{' '}
                    <span className={ckpt?.targetCheckpointPresent ? 'text-[var(--z-ok)] font-bold' : 'text-[var(--z-warn)] font-bold'}>
                      {ckpt?.targetCheckpointPresent
                        ? th
                          ? 'PRESENT (พบไฟล์)'
                          : 'PRESENT'
                        : th
                          ? 'MISSING ON DISK (ไม่พบบนดิสก์)'
                          : 'MISSING ON DISK'}
                    </span>
                  </div>
                  <div>
                    {th ? 'ไฟล์ที่บันทึก' : 'Saved Bundles'}: <span className="text-[var(--app-text-primary)]">{ckpt?.localPtCount ?? 0} .pt</span> · {th ? 'รัน' : 'Runs'}: {ckpt?.pipelineRunsCount ?? 0}
                  </div>
                  <div className="truncate" title={ckpt?.latestCheckpoint?.path || ''}>
                    Cloud Sync:{' '}
                    <span className={ckpt?.cloudStorageConfigured ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-secondary)]'}>
                      {ckpt?.cloudStorageConfigured
                        ? ckpt.cloudStorageReachable
                          ? 'CONFIGURED & REACHABLE'
                          : 'CONFIGURED (UNREACHABLE)'
                        : 'NOT CONFIGURED'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[var(--app-text-secondary)] pt-1 border-t border-[var(--app-card-border)]">
              <span>
                {th ? 'แหล่งหลักฐาน Gradient' : 'Gradient evidence source'}: {grad?.sourceArtifact || (th ? 'ไม่มี' : 'None')} ({grad?.totalSamples ?? 0} {th ? 'steps' : 'steps'} · best val loss {grad?.bestValLoss ?? '—'})
              </span>
              <span>
                {th ? 'ตรวจล่าสุด' : 'Last readiness probe'}: {new Date(data.checkedAt).toLocaleTimeString()}
              </span>
            </div>
          </div>
        )}
      </VividCard>
    </div>
  );
};
