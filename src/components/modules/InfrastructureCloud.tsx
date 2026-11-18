import React, { useCallback, useEffect, useState } from 'react';
import { EvidenceDrawerItem, ModuleId, SystemStatusData } from '../../types';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';
import { CloudConnectivityDiagnostics } from '../CloudConnectivityDiagnostics';
import { Cloud41MCheckpointModule } from '../Cloud41MCheckpointModule';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import {
  CheckCircle2,
  Cpu,
  Database,
  Eye,
  HardDrive,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';

interface InfrastructureCloudProps {
  statusData: SystemStatusData | null;
  truthData: any;
  trainingReadiness: any;
  onOpenSecrets: () => void;
  onNavigate: (module: ModuleId) => void;
  onInspectEvidence: (item: EvidenceDrawerItem) => void;
  onRefreshAll?: () => Promise<void> | void;
}

export const InfrastructureCloud: React.FC<InfrastructureCloudProps> = ({
  statusData,
  truthData,
  trainingReadiness,
  onOpenSecrets,
  onNavigate,
  onInspectEvidence,
  onRefreshAll,
}) => {
  const { lang } = useLanguage();
  const { role } = useAuth();
  const isDevOrAdmin = role === 'Developer' || role === 'Administrator';

  const [healthProbe, setHealthProbe] = useState<{
    ok: boolean;
    httpStatus: number;
    latencyMs: number;
    payload: any;
  } | null>(null);
  const [probingHealth, setProbingHealth] = useState(false);

  const probeExpressHealth = useCallback(async () => {
    setProbingHealth(true);
    const t0 = performance.now();
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      setHealthProbe({
        ok: res.ok && payload?.status === 'healthy',
        httpStatus: res.status,
        latencyMs: Math.round(performance.now() - t0),
        payload,
      });
    } catch {
      setHealthProbe({
        ok: false,
        httpStatus: 0,
        latencyMs: Math.round(performance.now() - t0),
        payload: null,
      });
    } finally {
      setProbingHealth(false);
    }
  }, []);

  useEffect(() => {
    void probeExpressHealth();
  }, [probeExpressHealth]);

  const connectivity = statusData?.connectivity;
  const preflight = statusData?.cloudPreflight;
  const py = trainingReadiness?.pythonBackend;
  const ckptSave = trainingReadiness?.checkpointSave;
  const onlineItems: any[] = truthData?.onlineRuntimeConnectivity?.items || [];
  const cloudDepsItem = onlineItems.find((i) => i.id === 'cloud_dependencies');
  const cloudSqlConfigured = cloudDepsItem?.detail?.includes('CloudSQL=configured') ?? false;

  const infraRows: Array<{
    id: string;
    title: string;
    state: string;
    summary: string;
    detail: string;
    icon: React.ReactNode;
    rawJson?: unknown;
  }> = [
    {
      id: 'bucket_connection',
      title: '1. Cloud Bucket Connection (S3 / R2)',
      state: !connectivity?.cloudStorageConfigured
        ? 'NOT_CONFIGURED'
        : connectivity.cloudStorageReachable
          ? 'VERIFIED'
          : 'BLOCKED',
      summary: connectivity?.cloudStorageConfigured
        ? `${connectivity.cloudConfigProvider || 's3'} · ${preflight?.bucket || 'bucket configured'}`
        : 'Bucket env vars not configured',
      detail: connectivity?.cloudSourceUri || 'Connecting a bucket alone does not mark Target Checkpoint as ready.',
      icon: <HardDrive className="w-4 h-4 text-[var(--app-accent)]" />,
      rawJson: { connectivity, preflight },
    },
    {
      id: 'target_checkpoint_exists',
      title: '2. Target Checkpoint Exists (41.5M)',
      state: !connectivity?.cloudStorageConfigured
        ? 'NOT_CONFIGURED'
        : preflight?.checks?.checkpointExists
          ? 'VERIFIED'
          : 'BLOCKED',
      summary: preflight?.checkpointKey || 'checkpoints/model_checkpoint_target_41m.pt',
      detail:
        preflight?.checks?.checkpointExists
          ? `Found (${preflight.checkpointSizeBytes ?? '—'} bytes · header=${preflight.headerMagicValid ? 'VALID' : 'UNKNOWN'})`
          : preflight?.error || 'Target checkpoint presence not verified in bucket.',
      icon: <ShieldCheck className="w-4 h-4 text-[var(--app-magenta)]" />,
      rawJson: preflight,
    },
    {
      id: 'rw_verification',
      title: '3. Bucket Read / Write Verification',
      state: preflight?.checks?.readWriteVerified
        ? 'VERIFIED'
        : connectivity?.cloudStorageConfigured
          ? 'UNVERIFIED'
          : 'NOT_CONFIGURED',
      summary: preflight?.checks?.readWriteVerified ? 'Round-trip R/W SHA-256 matched' : 'R/W probe not verified',
      detail: 'Verifies live PUT/GET roundtrip hash integrity against Cloud Object Storage.',
      icon: <CheckCircle2 className="w-4 h-4 text-[var(--z-ok)]" />,
      rawJson: preflight?.checks,
    },
    {
      id: 'cloud_sql',
      title: '4. Cloud SQL (PostgreSQL) Persistence',
      state: cloudSqlConfigured ? 'VERIFIED' : 'NOT_CONFIGURED',
      summary: cloudSqlConfigured ? 'DATABASE_URL configured' : 'DATABASE_URL / PGHOST unset',
      detail: cloudDepsItem?.detail || 'Uses fail-safe local encrypted append-only stores until Cloud SQL is configured.',
      icon: <Database className="w-4 h-4 text-[var(--app-amber)]" />,
      rawJson: cloudDepsItem,
    },
    {
      id: 'storage_integrity',
      title: '5. Local & Artifact Storage Integrity',
      state: ckptSave?.storageWritable ? 'VERIFIED' : ckptSave ? 'BLOCKED' : 'UNVERIFIED',
      summary: ckptSave
        ? `${ckptSave.storageWritable ? 'WRITABLE' : 'READ_ONLY'} · ${ckptSave.localPtCount} local .pt bundle(s)`
        : 'Pending probe',
      detail: ckptSave?.targetCheckpointPath || 'checkpoints / native_data directories',
      icon: <HardDrive className="w-4 h-4 text-[var(--app-accent)]" />,
      rawJson: ckptSave,
    },
    {
      id: 'express_server',
      title: '6. Express API Server (/api/health)',
      state: healthProbe?.ok ? 'VERIFIED' : healthProbe ? 'BLOCKED' : 'CHECKING',
      summary: healthProbe
        ? `HTTP ${healthProbe.httpStatus} · ${healthProbe.latencyMs}ms · uptime ${statusData?.uptimeSeconds ?? 0}s`
        : 'Probing /api/health…',
      detail: healthProbe?.payload ? JSON.stringify(healthProbe.payload) : 'Express + WebSocket /ws/runtime server',
      icon: <Server className="w-4 h-4 text-[var(--z-ok)]" />,
      rawJson: healthProbe,
    },
    {
      id: 'python_bridge',
      title: '7. Python Native Bridge & NumPy Engine',
      state:
        connectivity?.pythonBridgeReachable && py?.numpyAvailable
          ? 'VERIFIED'
          : connectivity?.pythonBridgeReachable
            ? 'PARTIAL'
            : 'BLOCKED',
      summary: py
        ? `Python ${py.pythonVersion || '—'} · ${py.backendMode || 'UNKNOWN'}`
        : connectivity?.pythonBridgeReachable
          ? 'Bridge Connected'
          : 'Bridge Unreachable',
      detail: py?.numpyAvailable
        ? `NumPy v${py.numpyVersion} ready for 41.5M tensors`
        : 'Bridge process is live, but native C-extension NumPy is blocked (np_compat fallback only).',
      icon: <Cpu className="w-4 h-4 text-[var(--app-accent)]" />,
      rawJson: { pythonBackend: py, bridgeLifecycle: connectivity?.bridgeLifecycle },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.16em] text-[var(--app-accent)]">
            <Server className="w-3.5 h-3.5" />
            <span>CLOUD &amp; INFRASTRUCTURE · HONEST VERIFICATION MATRIX</span>
          </div>
          <h2 className="mt-1 text-xl font-bold text-[var(--app-text-primary)]">
            {lang === 'th'
              ? 'โครงสร้างพื้นฐาน Cloud Storage, Cloud SQL, Server & Python Bridge'
              : 'Cloud & Infrastructure Diagnostics'}
          </h2>
          <p className="mt-1 text-xs text-[var(--app-text-secondary)] max-w-3xl">
            {lang === 'th'
              ? 'แยกสถานะชัดเจน: การต่อ Bucket ได้ ≠ มีไฟล์ Checkpoint 41.5M และยังไม่ถือว่า Runtime พร้อมจนกว่าจะผ่าน Read/Write + SHA-256'
              : 'Strictly separates bucket credentials, target checkpoint existence, R/W verification, Cloud SQL, local storage, Express /api/health, and Python Bridge.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void probeExpressHealth();
            if (onRefreshAll) void onRefreshAll();
          }}
          disabled={probingHealth}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--app-accent)] text-xs font-semibold text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${probingHealth ? 'animate-spin' : ''}`} />
          <span>{lang === 'th' ? 'ตรวจสอบโครงสร้างใหม่' : 'Re-probe Infrastructure'}</span>
        </button>
      </div>

      {/* 7 Separated Infrastructure Checks */}
      <VividCard
        title={lang === 'th' ? 'เมทริกซ์สถานะโครงสร้างพื้นฐาน 7 ชั้น' : '7-Layer Infrastructure Readiness Matrix'}
        subtitle={lang === 'th' ? 'คลิก Inspect เพื่อดูหลักฐานจริงและสิ่งที่ต้องตั้งค่าเพิ่ม' : 'Click Inspect on any layer to view raw telemetry and remediation.'}
        gradientAccent="cyan"
      >
        <div className="divide-y divide-[var(--app-card-border)]">
          {infraRows.map((row) => (
            <div
              key={row.id}
              className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 shrink-0">{row.icon}</div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--app-text-primary)]">{row.title}</div>
                  <div className="text-xs font-mono text-[var(--app-accent)] mt-0.5 break-all">{row.summary}</div>
                  <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5 break-words">{row.detail}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <StatusDot status={row.state} />
                <button
                  type="button"
                  onClick={() =>
                    onInspectEvidence({
                      title: row.title,
                      subtitle: row.summary,
                      status: row.state,
                      source: 'InfrastructureCloud Matrix',
                      details: [
                        { label: 'State', value: row.state },
                        { label: 'Summary', value: row.summary },
                        { label: 'Diagnostic Detail', value: row.detail },
                      ],
                      rawJson: row.rawJson,
                      targetModule: 'user_settings',
                      targetLabel: 'Open Settings > Secrets',
                    })
                  }
                  className="p-2 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer"
                  title="Inspect evidence"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </VividCard>

      <CloudConnectivityDiagnostics onOpenSecrets={onOpenSecrets} />

      {isDevOrAdmin ? (
        <Cloud41MCheckpointModule onAfterRuntimeLoad={onRefreshAll} />
      ) : (
        <VividCard
          title="41.5M Cloud Checkpoint Operations"
          subtitle="Requires Developer or Administrator role to run live Bucket R/W probes and load runtime weights."
          gradientAccent="purple"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--app-text-secondary)]">
            <span>Sign in as Developer or Administrator in Settings to execute R/W bucket probes and fetch 41.5M checkpoints.</span>
            <button
              type="button"
              onClick={() => onNavigate('user_settings')}
              className="px-3.5 py-2 rounded-xl font-bold bg-[var(--app-accent)] text-slate-950 cursor-pointer"
            >
              Open Settings &amp; Role Session
            </button>
          </div>
        </VividCard>
      )}
    </div>
  );
};
