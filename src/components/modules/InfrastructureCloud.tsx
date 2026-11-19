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
      title: lang === 'th' ? '1. การเชื่อมต่อ Cloud Bucket (S3 / R2)' : '1. Cloud Bucket Connection (S3 / R2)',
      state: !connectivity?.cloudStorageConfigured
        ? 'NOT_CONFIGURED'
        : connectivity.cloudStorageReachable
          ? 'VERIFIED'
          : 'BLOCKED',
      summary: connectivity?.cloudStorageConfigured
        ? `${connectivity.cloudConfigProvider || 's3'} · ${preflight?.bucket || (lang === 'th' ? 'ตั้งค่า Bucket แล้ว' : 'bucket configured')}`
        : lang === 'th'
          ? 'ยังไม่ได้ตั้งค่าตัวแปร Bucket'
          : 'Bucket env vars not configured',
      detail:
        connectivity?.cloudSourceUri ||
        (lang === 'th'
          ? 'การต่อ Bucket ได้เพียงอย่างเดียวไม่ได้แปลว่า Target Checkpoint พร้อมทำงาน'
          : 'Connecting a bucket alone does not mark Target Checkpoint as ready.'),
      icon: <HardDrive className="w-4 h-4 text-[var(--app-accent)]" />,
      rawJson: { connectivity, preflight },
    },
    {
      id: 'target_checkpoint_exists',
      title: lang === 'th' ? '2. ตรวจพบ Target Checkpoint (41.5M)' : '2. Target Checkpoint Exists (41.5M)',
      state: !connectivity?.cloudStorageConfigured
        ? 'NOT_CONFIGURED'
        : preflight?.checks?.checkpointExists
          ? 'VERIFIED'
          : 'BLOCKED',
      summary: preflight?.checkpointKey || 'checkpoints/model_checkpoint_target_41m.pt',
      detail:
        preflight?.checks?.checkpointExists
          ? `${lang === 'th' ? 'พบไฟล์' : 'Found'} (${preflight.checkpointSizeBytes ?? '—'} bytes · header=${preflight.headerMagicValid ? 'VALID' : 'UNKNOWN'})`
          : preflight?.error ||
            (lang === 'th'
              ? 'ยังไม่ยืนยันการมีอยู่ของ Target Checkpoint ใน Bucket'
              : 'Target checkpoint presence not verified in bucket.'),
      icon: <ShieldCheck className="w-4 h-4 text-[var(--app-magenta)]" />,
      rawJson: preflight,
    },
    {
      id: 'rw_verification',
      title: lang === 'th' ? '3. ทดสอบสิทธิ์อ่าน/เขียน Bucket' : '3. Bucket Read / Write Verification',
      state: preflight?.checks?.readWriteVerified
        ? 'VERIFIED'
        : connectivity?.cloudStorageConfigured
          ? 'UNVERIFIED'
          : 'NOT_CONFIGURED',
      summary: preflight?.checks?.readWriteVerified
        ? lang === 'th'
          ? 'ทดสอบเขียน-อ่านไปกลับ SHA-256 ตรงกัน'
          : 'Round-trip R/W SHA-256 matched'
        : lang === 'th'
          ? 'ยังไม่ผ่านการทดสอบ Read/Write'
          : 'R/W probe not verified',
      detail:
        lang === 'th'
          ? 'ตรวจสอบความสมบูรณ์ของแฮชเมื่ออัปโหลด/ดาวน์โหลดจริงบน Cloud Object Storage'
          : 'Verifies live PUT/GET roundtrip hash integrity against Cloud Object Storage.',
      icon: <CheckCircle2 className="w-4 h-4 text-[var(--z-ok)]" />,
      rawJson: preflight?.checks,
    },
    {
      id: 'cloud_sql',
      title: lang === 'th' ? '4. ฐานข้อมูลถาวร Cloud SQL (PostgreSQL)' : '4. Cloud SQL (PostgreSQL) Persistence',
      state: cloudSqlConfigured ? 'VERIFIED' : 'NOT_CONFIGURED',
      summary: cloudSqlConfigured
        ? lang === 'th'
          ? 'ตั้งค่า DATABASE_URL แล้ว'
          : 'DATABASE_URL configured'
        : lang === 'th'
          ? 'ยังไม่ได้ตั้งค่า DATABASE_URL / PGHOST'
          : 'DATABASE_URL / PGHOST unset',
      detail:
        cloudDepsItem?.detail ||
        (lang === 'th'
          ? 'ใช้ระบบจัดเก็บเข้ารหัสแบบ Append-Only ในเครื่องชั่วคราวจนกว่าจะตั้งค่า Cloud SQL'
          : 'Uses fail-safe local encrypted append-only stores until Cloud SQL is configured.'),
      icon: <Database className="w-4 h-4 text-[var(--app-amber)]" />,
      rawJson: cloudDepsItem,
    },
    {
      id: 'storage_integrity',
      title: lang === 'th' ? '5. ความสมบูรณ์ของพื้นที่จัดเก็บและ Artifact' : '5. Local & Artifact Storage Integrity',
      state: ckptSave?.storageWritable ? 'VERIFIED' : ckptSave ? 'BLOCKED' : 'UNVERIFIED',
      summary: ckptSave
        ? `${ckptSave.storageWritable ? (lang === 'th' ? 'เขียนได้' : 'WRITABLE') : (lang === 'th' ? 'อ่านได้อย่างเดียว' : 'READ_ONLY')} · ${ckptSave.localPtCount} ${lang === 'th' ? 'ไฟล์ .pt ในเครื่อง' : 'local .pt bundle(s)'}`
        : lang === 'th'
          ? 'รอการตรวจสอบ'
          : 'Pending probe',
      detail: ckptSave?.targetCheckpointPath || 'checkpoints / native_data directories',
      icon: <HardDrive className="w-4 h-4 text-[var(--app-accent)]" />,
      rawJson: ckptSave,
    },
    {
      id: 'express_server',
      title: lang === 'th' ? '6. เซิร์ฟเวอร์ Express API (/api/health)' : '6. Express API Server (/api/health)',
      state: healthProbe?.ok ? 'VERIFIED' : healthProbe ? 'BLOCKED' : 'CHECKING',
      summary: healthProbe
        ? `HTTP ${healthProbe.httpStatus} · ${healthProbe.latencyMs}ms · uptime ${statusData?.uptimeSeconds ?? 0}s`
        : lang === 'th'
          ? 'กำลังตรวจสอบ /api/health…'
          : 'Probing /api/health…',
      detail: healthProbe?.payload ? JSON.stringify(healthProbe.payload) : 'Express + WebSocket /ws/runtime server',
      icon: <Server className="w-4 h-4 text-[var(--z-ok)]" />,
      rawJson: healthProbe,
    },
    {
      id: 'python_bridge',
      title: lang === 'th' ? '7. Python Native Bridge & เอนจิน NumPy' : '7. Python Native Bridge & NumPy Engine',
      state:
        connectivity?.pythonBridgeReachable && py?.numpyAvailable
          ? 'VERIFIED'
          : connectivity?.pythonBridgeReachable
            ? 'PARTIAL'
            : 'BLOCKED',
      summary: py
        ? `Python ${py.pythonVersion || '—'} · ${py.backendMode || 'UNKNOWN'}`
        : connectivity?.pythonBridgeReachable
          ? lang === 'th'
            ? 'เชื่อมต่อ Bridge แล้ว'
            : 'Bridge Connected'
          : lang === 'th'
            ? 'เชื่อมต่อ Bridge ไม่ได้'
            : 'Bridge Unreachable',
      detail: py?.numpyAvailable
        ? `NumPy v${py.numpyVersion} ${lang === 'th' ? 'พร้อมประมวลผล Tensor 41.5M' : 'ready for 41.5M tensors'}`
        : lang === 'th'
          ? 'โปรเซส Bridge ทำงานอยู่ แต่ขาด C-extension NumPy (ใช้ได้เฉพาะโหมดสำรอง np_compat)'
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
                        { label: lang === 'th' ? 'สถานะ' : 'State', value: row.state },
                        { label: lang === 'th' ? 'สรุป' : 'Summary', value: row.summary },
                        { label: lang === 'th' ? 'รายละเอียดการตรวจ' : 'Diagnostic Detail', value: row.detail },
                      ],
                      rawJson: row.rawJson,
                      targetModule: 'user_settings',
                      targetLabel: lang === 'th' ? 'เปิดหน้า Settings > Secrets' : 'Open Settings > Secrets',
                    })
                  }
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-2 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer"
                  title={lang === 'th' ? 'ดูหลักฐานเชิงลึก' : 'Inspect evidence'}
                  aria-label={lang === 'th' ? 'ดูหลักฐานเชิงลึก' : 'Inspect evidence'}
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
          title={lang === 'th' ? 'ปฏิบัติการ Cloud Checkpoint 41.5M' : '41.5M Cloud Checkpoint Operations'}
          subtitle={
            lang === 'th'
              ? 'ต้องใช้สิทธิ์ Developer หรือ Administrator เพื่อทดสอบอ่าน/เขียน Bucket จริงและโหลดน้ำหนักเข้า Runtime'
              : 'Requires Developer or Administrator role to run live Bucket R/W probes and load runtime weights.'
          }
          gradientAccent="purple"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--app-text-secondary)]">
            <span>
              {lang === 'th'
                ? 'กรุณาเข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator ในหน้า Settings เพื่อรัน Probe และดึง Checkpoint 41.5M'
                : 'Sign in as Developer or Administrator in Settings to execute R/W bucket probes and fetch 41.5M checkpoints.'}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('user_settings')}
              className="min-h-[40px] px-3.5 py-2 rounded-xl font-bold bg-[var(--app-accent-deep)] text-white cursor-pointer"
            >
              {lang === 'th' ? 'เปิดหน้า Settings และเลือกบทบาท' : 'Open Settings & Role Session'}
            </button>
          </div>
        </VividCard>
      )}
    </div>
  );
};
