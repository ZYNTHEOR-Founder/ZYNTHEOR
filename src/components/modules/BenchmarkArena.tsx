import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Cpu,
  Play,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

type Status = 'RUNNING' | 'VERIFIED' | 'FAILED' | 'BLOCKED' | 'UNVERIFIED';
interface RecordItem {
  executionId: string;
  projectId: string;
  level: number;
  status: Status;
  nativeCapabilityStatus: 'UNVERIFIED';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  passed: number;
  total: number;
  skipped: number;
  exitCode: number | null;
  sourceRevision: string | null;
  evidenceSha256: string | null;
  reason?: string;
}

interface StageBenchReport {
  mode: string;
  attribution: string;
  total_tasks: number;
  delivered_count?: number;
  hidden_pass_rate_pct?: number;
  status?: string;
  message?: string;
  availableTasks?: Array<{ id: string; category: string }>;
  stage_pass_rates?: Record<string, { passed: number; total: number; rate: number; ratePct?: number }>;
  tasks?: Array<{
    id: string;
    category?: string;
    delivered: boolean;
    hidden_ok?: boolean;
  }>;
  error?: string;
}

const STAGE_ORDER = ['understand', 'plan', 'build', 'test', 'repair', 'deliver'];

const statusStyle: Record<Status, string> = {
  RUNNING:
    'text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]',
  VERIFIED:
    'text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_30%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_10%,transparent)]',
  FAILED:
    'text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)]',
  BLOCKED:
    'text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_30%,transparent)] bg-[color-mix(in_srgb,var(--app-amber)_10%,transparent)]',
  UNVERIFIED:
    'text-[var(--app-text-secondary)] border-[color-mix(in_srgb,var(--app-card-border)_30%,transparent)] bg-[color-mix(in_srgb,var(--app-surface-elevated)_10%,transparent)]',
};

function StatusIcon({ status }: { status: Status }) {
  if (status === 'VERIFIED') return <CheckCircle2 className="w-3.5 h-3.5" />;
  if (status === 'FAILED') return <XCircle className="w-3.5 h-3.5" />;
  if (status === 'BLOCKED') return <ShieldAlert className="w-3.5 h-3.5" />;
  if (status === 'RUNNING') return <Activity className="w-3.5 h-3.5" />;
  return <AlertCircle className="w-3.5 h-3.5" />;
}

export const BenchmarkArena: React.FC = () => {
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const { lang } = useLanguage();
  const th = lang === 'th';

  const levelInfo = [
    {
      level: 1,
      title: th ? 'แอป To-Do แบบโต้ตอบ' : 'Interactive To-Do',
      detail: th ? 'โต้ตอบ · บันทึกข้อมูล · CRUD' : 'Interactions · Persistence · CRUD',
    },
    {
      level: 2,
      title: th ? 'บล็อกพร้อมฐานข้อมูล' : 'Database Blog',
      detail: th ? 'ฐานข้อมูล · Create · Read · Update · Delete' : 'Database · Create · Read · Update · Delete',
    },
    {
      level: 3,
      title: th ? 'SaaS หลายผู้ใช้' : 'Multi-user SaaS',
      detail: th ? 'ยืนยันตัวตน · สิทธิ์ · แยกข้อมูลผู้ใช้' : 'Authentication · Authorization · Isolation',
    },
    {
      level: 4,
      title: th ? 'อีคอมเมิร์ซ (E-Commerce)' : 'E-Commerce',
      detail: th ? 'ตะกร้า · ราคา · ชำระเงิน · คำสั่งซื้อ' : 'Cart · Pricing · Checkout · Orders',
    },
  ];

  const [projectId, setProjectId] = useState('');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [running, setRunning] = useState<number | null>(null);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [error, setError] = useState('');

  const [stageReport, setStageReport] = useState<StageBenchReport | null>(null);
  const [runningStageBench, setRunningStageBench] = useState(false);
  const [stageError, setStageError] = useState('');

  const latestByLevel = new Map<number, RecordItem>();
  records.forEach((item) => {
    if (!latestByLevel.has(item.level)) latestByLevel.set(item.level, item);
  });

  const refresh = useCallback(async () => {
    if (!authReady || !isAuthenticated) return;
    try {
      const [benchRes, stageRes] = await Promise.all([
        fetch('/api/benchmarks?limit=80', { headers: authHeaders() }),
        fetch('/api/benchmarks/stages', { headers: authHeaders() }),
      ]);
      const data = await benchRes.json();
      if (!benchRes.ok || !data.success) {
        throw new Error(data.error || (th ? 'ไม่สามารถโหลดประวัติ Benchmark ได้' : 'Unable to load benchmark history'));
      }
      setRecords(Array.isArray(data.records) ? data.records : []);

      if (stageRes.ok) {
        const sData = await stageRes.json();
        if (sData.latest) setStageReport(sData.latest);
      }
    } catch (e: any) {
      setError(e.message || (th ? 'ไม่สามารถดึงประวัติ Benchmark ได้' : 'Benchmark history unavailable'));
    }
  }, [authHeaders, authReady, isAuthenticated, th]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (level: number) => {
    if (!projectId.trim() || running !== null || !isAuthenticated) return;
    setRunning(level);
    setError('');
    setSelected(null);
    try {
      const response = await fetch('/api/benchmarks/run', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ level, projectId: projectId.trim() }),
      });
      const data = await response.json();
      if (data.result) setSelected(data.result);
      if (!response.ok && !data.result) {
        throw new Error(data.error || (th ? 'คำสั่งทดสอบ Benchmark ล้มเหลว' : 'Benchmark request failed'));
      }
      await refresh();
    } catch (e: any) {
      setError(e.message || (th ? 'รัน Benchmark ล้มเหลว' : 'Benchmark failed'));
    } finally {
      setRunning(null);
    }
  };

  const runStageBench = async () => {
    if (!isAuthenticated || runningStageBench) return;
    setRunningStageBench(true);
    setStageError('');
    try {
      const response = await fetch('/api/benchmarks/stages/run', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ mode: 'specification' }),
      });
      const data = await response.json();
      if (data.report) setStageReport(data.report);
      if (!response.ok || !data.success) {
        throw new Error(data.error || (th ? `ตรวจ Benchmark รายขั้นตอนไม่สำเร็จ (HTTP ${response.status})` : `Stage benchmark failed (HTTP ${response.status})`));
      }
      if (data.report?.error) {
        setStageError(String(data.report.error));
      }
    } catch (e: any) {
      setStageError(e?.message || (th ? 'ไม่สามารถรัน Benchmark 20 งานได้' : 'Unable to execute 20-task per-stage benchmark'));
    } finally {
      setRunningStageBench(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-[var(--app-accent)] shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--app-text-primary)]">
                {th ? 'ตรวจโครงสร้างโจทย์ทดสอบ 20 งาน (Specification Review)' : '20-Task Capability Specification Review'}
              </h3>
              <p className="text-[11px] text-[var(--app-text-secondary)]">
                {th
                  ? 'ตรวจโครงสร้างงานและเกณฑ์การยอมรับเท่านั้น ไม่ได้รันงานจริงหรือสร้างคะแนนจำลอง'
                  : 'Reviews the task and acceptance criteria structure. This action does not execute tasks or generate benchmark scores.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runStageBench()}
              disabled={!isAuthenticated || runningStageBench}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--app-accent-deep)] px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-95 cursor-pointer disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5" />
              {runningStageBench
                ? th
                  ? 'กำลังตรวจสเปกงาน…'
                  : 'Inspecting specification…'
                : th
                ? 'ตรวจสอบสเปกงาน 20 รายการ'
                : 'Inspect task specification'}
            </button>
          </div>
        </div>

        {stageReport && (
          <div className="text-[11px] font-mono text-[var(--app-text-secondary)] flex flex-wrap gap-x-4 gap-y-1">
            <span>
              {th ? 'รูปแบบการตรวจ:' : 'Review type:'}{' '}
              <strong className="text-[var(--app-text-primary)]">
                {th ? 'ตรวจสเปกเท่านั้น · ไม่มีการรันงาน' : 'Specification only · no task execution'}
              </strong>
            </span>
            <span>
              {th ? 'จำนวนงาน:' : 'Tasks listed:'}{' '}
              <strong className="text-[var(--app-text-primary)]">{stageReport.total_tasks}</strong>
            </span>
          </div>
        )}

        {stageError && (
          <div role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--z-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] p-3 text-xs font-mono text-[var(--z-danger)]">
            {stageError}
          </div>
        )}

        {stageReport?.stage_pass_rates ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {STAGE_ORDER.map((stage) => {
              const s = stageReport.stage_pass_rates?.[stage];
              const pct = s ? Math.round(s.rate * 100) : 0;
              return (
                <div
                  key={stage}
                  className="rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-3 space-y-1"
                >
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)]">
                    {stage}
                  </div>
                  <div
                    className={`text-xl font-semibold font-mono tabular-nums ${
                      pct >= 80
                        ? 'text-[var(--z-ok)]'
                        : pct >= 50
                          ? 'text-[var(--app-amber)]'
                          : 'text-[var(--z-danger)]'
                    }`}
                  >
                    {pct}%
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-[var(--app-text-secondary)]">
                    {s ? `${s.passed}/${s.total} ${th ? 'ผ่าน' : 'passed'}` : '0/0'}
                  </div>
                </div>
              );
            })}
          </div>
        ) : stageReport?.availableTasks ? (
          <div className="rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-3.5 space-y-2.5">
            <div className="text-xs font-mono text-[var(--app-amber)]">
              {stageReport.status}: {stageReport.message}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {stageReport.availableTasks.map((task) => (
                <span
                  key={task.id}
                  className="px-2 py-0.5 rounded bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[10px] font-mono text-[var(--app-text-secondary)]"
                >
                  {task.id} · {task.category}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--app-card-border)] p-4 text-xs text-[var(--app-text-secondary)]">
            {isAuthenticated
              ? th
                ? 'ยังไม่มีผลตรวจสเปก กด "ตรวจสอบสเปกงาน 20 รายการ" เพื่อดูโครงสร้างงาน (ไม่มีการรันงานจริงในขั้นตอนนี้)'
                : 'No specification review recorded yet. Click "Inspect task specification" to review the task definitions. No tasks are executed by this action.'
              : th
              ? 'เข้าสู่ระบบสิทธิ์ Developer หรือ Admin เพื่อตรวจและดูผลการประเมิน 20 งาน'
              : 'Sign in as Developer or Admin to run and inspect the 20-task per-stage benchmark.'}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[var(--z-ok)] shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--app-text-primary)]">
                {th ? 'สนามทดสอบ Benchmark แอปพลิเคชัน (L1–L4)' : 'Competitive Benchmark Arena'}
              </h3>
              <p className="text-[11px] text-[var(--app-text-secondary)]">
                {th
                  ? 'L1–L4 · อ้างอิงหลักฐานการทดสอบจริง · ไม่มีคะแนนสังเคราะห์'
                  : 'L1–L4 · Evidence-gated · No synthetic scores'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!isAuthenticated}
            className="text-xs text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] disabled:opacity-40 cursor-pointer"
          >
            {th ? 'รีเฟรชประวัติ' : 'Refresh history'}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder={th ? 'รหัสโปรเจกต์ Project ID (workspace/projects/<id>)' : 'Project ID (workspace/projects/<id>)'}
            className="min-w-0 flex-1 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-text-primary)] outline-none focus:border-[var(--z-ok)]"
          />
          <span className="self-center text-[10px] text-[var(--app-text-secondary)]">
            {th
              ? 'ต้องตั้งค่า Preview URL และ Origin ที่อนุญาตบนฝั่ง Server ก่อนรัน'
              : 'Preview URL and allowed Origin must be configured server-side.'}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {levelInfo.map((item) => {
            const record = latestByLevel.get(item.level);
            const status = record?.status || 'UNVERIFIED';
            return (
              <div key={item.level} className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">LEVEL {item.level}</div>
                    <div className="text-sm font-semibold text-[var(--app-text-primary)]">{item.title}</div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] mt-1">{item.detail}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-bold shrink-0 ${statusStyle[status]}`}>
                    <StatusIcon status={status} />
                    {status}
                  </span>
                </div>
                {record ? (
                  <div className="space-y-1 text-[10px] text-[var(--app-text-secondary)] tabular-nums">
                    <div className="flex justify-between">
                      <span>{th ? 'การทดสอบ' : 'Tests'}</span>
                      <span className="font-mono text-[var(--app-text-primary)]">{record.passed}/{record.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{th ? 'เวลาที่ใช้' : 'Duration'}</span>
                      <span className="font-mono text-[var(--app-text-primary)]">{record.durationMs} ms</span>
                    </div>
                    {record.evidenceSha256 && <div className="font-mono break-all">SHA-256 {record.evidenceSha256.slice(0, 16)}…</div>}
                    <div className="text-[var(--app-text-secondary)]">
                      {th ? 'สถานะแหล่งกำเนิด Native: UNVERIFIED' : 'Native provenance: UNVERIFIED'}
                    </div>
                    {record.reason && <div className="text-[var(--app-amber)] break-words">{record.reason}</div>}
                  </div>
                ) : (
                  <div className="text-[10px] text-[var(--app-text-secondary)]">
                    {th ? 'ยังไม่มีผลรันที่ยืนยันแล้ว' : 'No verified run recorded'}
                  </div>
                )}
                <button
                  type="button"
                  disabled={!projectId.trim() || running !== null || !isAuthenticated}
                  onClick={() => void run(item.level)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--app-accent-deep)] hover:opacity-95 disabled:opacity-40 px-3 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  {running === item.level ? (th ? 'กำลังรัน…' : 'Running…') : (th ? 'รัน Benchmark' : 'Run Benchmark')}
                </button>
              </div>
            );
          })}
        </div>
        {error && (
          <div role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] p-3 text-xs text-[var(--z-danger)]">
            {error}
          </div>
        )}
        {selected && (
          <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] p-3 space-y-2 tabular-nums">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--app-text-primary)]">
                {th ? `ผลรันล่าสุด · L${selected.level}` : `Latest execution · L${selected.level}`}
              </span>
              <span className={`text-[10px] font-bold ${selected.status === 'VERIFIED' ? 'text-[var(--z-ok)]' : 'text-[var(--app-amber)]'}`}>
                {selected.status}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-[var(--app-text-secondary)]">
              <div><Clock3 className="inline w-3 h-3 mr-1" /> {selected.durationMs} ms</div>
              <div>Exit: {selected.exitCode ?? 'N/A'}</div>
              <div>{th ? 'ทดสอบ:' : 'Tests:'} {selected.passed}/{selected.total}</div>
              <div>{th ? 'ข้าม:' : 'Skipped:'} {selected.skipped}</div>
            </div>
            {selected.reason && <p className="text-xs text-[var(--app-amber)]">{selected.reason}</p>}
            {selected.evidenceSha256 && <p className="break-all font-mono text-[10px] text-[var(--app-text-secondary)]">SHA-256: {selected.evidenceSha256}</p>}
            <p className="break-all font-mono text-[10px] text-[var(--app-text-secondary)]">Execution: {selected.executionId}</p>
          </div>
        )}
        <div className="text-[11px] text-[var(--app-text-secondary)] flex items-start gap-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {th
              ? 'สถานะ VERIFIED ใช้เฉพาะกับการทดสอบ E2E ของแอปพลิเคชันเท่านั้น ส่วนการสร้างโค้ดจาก Native Engine ยังคงเป็น UNVERIFIED จนกว่าจะเชื่อมต่อบันทึกหลักฐานที่ตรวจสอบได้'
              : 'VERIFIED applies to application E2E tests only. Native generation remains UNVERIFIED until an auditable Native Engine project-generation trace is connected.'}
          </span>
        </div>
      </section>
    </div>
  );
};
