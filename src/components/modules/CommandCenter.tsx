import React from 'react';
import { SystemStatusData, ModuleId, StatusLevel } from '../../types';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { ResourceMonitor } from '../ResourceMonitor';
import { useLanguage } from '../../context/LanguageContext';
import {
  Activity, ArrowRight, BrainCircuit, Cloud, Code2, Database,
  Gauge, Layers3, LockKeyhole, ShieldCheck, TerminalSquare, Workflow
} from 'lucide-react';

interface CommandCenterProps {
  statusData: SystemStatusData | null;
  onNavigate: (module: ModuleId) => void;
  onOpenQuickTask: () => void;
}

const formatCount = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

export const CommandCenter: React.FC<CommandCenterProps> = ({
  statusData,
  onNavigate,
  onOpenQuickTask
}) => {
  const { lang } = useLanguage();
  const model = statusData?.model;
  const commercial = statusData?.commercial;
  const audit = statusData?.audit;
  const sandbox = statusData?.sandbox;
  const resources = statusData?.resources;
  const inferenceReady = Boolean(model?.inferenceReady && model?.weightsLoaded);

  const runtimeStatus: StatusLevel = inferenceReady ? 'VERIFIED' : 'BLOCKED';
  const checkpointStatus: StatusLevel = model?.weightsLoaded ? 'VERIFIED' : 'BLOCKED';
  const auditStatus: StatusLevel = audit?.chainValid === true
    ? 'VERIFIED'
    : audit?.chainValid === false ? 'BLOCKED' : 'UNVERIFIED';

  const systems: Array<{ name: string; detail: string; status: StatusLevel; evidence: string }> = [
    {
      name: 'Cloud Native Runtime',
      detail: model?.runtimeState || 'No runtime telemetry',
      status: runtimeStatus,
      evidence: model?.readinessReason || 'Waiting for verified Cloud Runtime checkpoint and inference response'
    },
    {
      name: 'Checkpoint Integrity',
      detail: `${formatCount(model?.activeParams ?? model?.totalParams)} active parameters`,
      status: checkpointStatus,
      evidence: model?.checkpointHash ? `SHA-256 ${model.checkpointHash}` : 'No active Cloud Runtime checkpoint fingerprint'
    },
    {
      name: 'Audit Ledger',
      detail: `${formatCount(audit?.totalRecords)} recorded events`,
      status: auditStatus,
      evidence: audit?.headHash ? `Head ${audit.headHash}` : 'No audit-chain head returned'
    },
    {
      name: 'Knowledge Workspace',
      detail: 'Documents · retrieval · dataset curation',
      status: 'IMPLEMENTED',
      evidence: 'Workspace API and dataset curation modules are present; dataset quality remains separately gated'
    },
    {
      name: 'Native Reasoning & Adaptation',
      detail: 'Planning · evaluation · learning gates',
      status: 'PARTIAL',
      evidence: 'Native model generation is separate from planning/evaluation; full adaptive loop is not certified'
    },
    {
      name: 'Application Execution',
      detail: `${formatCount(sandbox?.fileCount)} workspace files`,
      status: sandbox?.fileCount !== undefined ? 'IMPLEMENTED' : 'UNVERIFIED',
      evidence: sandbox?.path || 'Workspace telemetry unavailable'
    }
  ];

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="vivid-command-hero relative overflow-hidden rounded-[28px] border border-[var(--app-card-border)] p-6 md:p-9">
        <img
          src="/assets/zyntheor-rainbow-neural.svg"
          alt=""
          aria-hidden="true"
          className="vivid-command-hero-art"
        />
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] font-bold tracking-[.18em] text-white/75 backdrop-blur">
            <span className={`vivid-status-dot ${inferenceReady ? 'is-ready' : 'is-blocked'}`} />
            NATIVE MULTI-DOMAIN INTELLIGENCE
          </div>
          <h1 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight text-white md:text-5xl">
            ZYNTHEOR <span className="vivid-rainbow-text">VIVID INTELLIGENCE</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-200/80 md:text-base">
            {lang === 'th'
              ? 'จากความเข้าใจบริบท สู่การวางแผน สร้าง ลงมือทดสอบ ตรวจผล และส่งมอบงาน — ด้วยสถานะที่อ้างอิงหลักฐานจริง'
              : 'Understand context. Plan. Create. Execute. Test. Verify. Deliver — with every runtime claim backed by evidence.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={onOpenQuickTask} className="vivid-primary-action">
              <Workflow size={16} /> {lang === 'th' ? 'เริ่มงานใหม่' : 'Start a task'}
            </button>
            <button onClick={() => onNavigate('dev_studio')} className="vivid-secondary-action">
              <Code2 size={16} /> {lang === 'th' ? 'เปิด Creation Studio' : 'Open Creation Studio'}
            </button>
            <button onClick={() => onNavigate('knowledge_hub')} className="vivid-secondary-action">
              <Database size={16} /> {lang === 'th' ? 'คลังความรู้' : 'Knowledge Workspace'}
            </button>
          </div>
        </div>
        <div className="vivid-hero-orbit" aria-hidden="true"><span /><span /><span /></div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Active Native Parameters"
          value={formatCount(model?.activeParams ?? model?.totalParams)}
          subtitle={model?.weightsLoaded ? 'Loaded from Cloud Runtime' : 'No verified weights loaded'}
          icon={<BrainCircuit className="h-5 w-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Inference Runtime"
          value={inferenceReady ? 'READY' : 'BLOCKED'}
          subtitle={model?.runtimeState || 'Awaiting Cloud Runtime telemetry'}
          icon={<Cloud className="h-5 w-5" />}
          accentColor={inferenceReady ? 'lime' : 'coral'}
        />
        <MetricCard
          title="Recorded Tasks"
          value={formatCount(commercial?.tasksCompleted)}
          subtitle={`${formatCount(commercial?.tasksFailed)} failed · ${formatCount(commercial?.totalTokensProcessed)} tokens recorded`}
          icon={<Activity className="h-5 w-5" />}
          accentColor="purple"
        />
        <MetricCard
          title="Audit Records"
          value={formatCount(audit?.totalRecords)}
          subtitle={audit?.chainValid === true ? 'Integrity check passed' : 'Integrity not verified'}
          icon={<ShieldCheck className="h-5 w-5" />}
          accentColor="magenta"
        />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,.9fr)]">
        <VividCard
          title={lang === 'th' ? 'สถานะระบบจากหลักฐานจริง' : 'Evidence-backed system status'}
          subtitle={lang === 'th' ? 'แยกสถานะ runtime, weights, audit และความสามารถที่ยังต้องพิสูจน์' : 'Runtime, model weights, audit integrity, and capabilities are reported independently.'}
          gradientAccent="cyan"
        >
          <div className="space-y-3">
            {systems.map((item) => (
              <div key={item.name} className="grid grid-cols-1 gap-2 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--app-text-primary)]">{item.name}</div>
                  <div className="mt-0.5 text-xs text-[var(--app-text-secondary)]">{item.detail}</div>
                  <div className="mt-1 break-all font-mono text-[10px] leading-5 text-[var(--app-text-secondary)]">{item.evidence}</div>
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        </VividCard>

        <div className="space-y-5">
          <VividCard title="Native Runtime Gate" subtitle="Cloud-connected model readiness" gradientAccent="sunset">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold"><span className={`vivid-status-dot ${inferenceReady ? 'is-ready' : 'is-blocked'}`} />{model?.runtimeState || 'NOT CONNECTED'}</div>
                <StatusBadge status={runtimeStatus} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[var(--app-surface)] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">Active parameters</div>
                  <div className="mt-1 font-mono text-lg font-bold">{formatCount(model?.activeParams ?? model?.totalParams)}</div>
                </div>
                <div className="rounded-xl bg-[var(--app-surface)] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">Target parameters</div>
                  <div className="mt-1 font-mono text-lg font-bold">{formatCount(model?.targetParams)}</div>
                </div>
              </div>
              <p className="break-words text-xs leading-6 text-[var(--app-text-secondary)]">{model?.readinessReason || 'Configure and verify a complete checkpoint in the designated Cloud Runtime before enabling inference.'}</p>
              <div className="flex items-start gap-2 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] p-3">
                <LockKeyhole size={15} className="mt-0.5 shrink-0 text-[var(--app-accent)]" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold">Checkpoint fingerprint</div>
                  <div className="mt-1 break-all font-mono text-[10px] text-[var(--app-text-secondary)]">{model?.checkpointHash || 'Not available'}</div>
                </div>
              </div>
              <button onClick={() => onNavigate('model_laboratory')} className="vivid-inline-link">
                {lang === 'th' ? 'เปิด Model Laboratory' : 'Open Model Laboratory'} <ArrowRight size={14} />
              </button>
            </div>
          </VividCard>

          <VividCard title={lang === 'th' ? 'ทางลัดการทำงาน' : 'Workspaces'} subtitle="Move from intent to deliverable" gradientAccent="violet">
            <div className="grid grid-cols-1 gap-2">
              <button onClick={() => onNavigate('dev_studio')} className="vivid-workspace-link"><Code2 size={16} /> Creation Studio <ArrowRight size={14} /></button>
              <button onClick={() => onNavigate('research_lab')} className="vivid-workspace-link"><Layers3 size={16} /> Research Lab <ArrowRight size={14} /></button>
              <button onClick={() => onNavigate('governance_security')} className="vivid-workspace-link"><ShieldCheck size={16} /> Governance & Security <ArrowRight size={14} /></button>
              <button onClick={() => onNavigate('api_platform')} className="vivid-workspace-link"><TerminalSquare size={16} /> Runtime APIs <ArrowRight size={14} /></button>
            </div>
          </VividCard>
        </div>
      </div>

      <VividCard
        title={lang === 'th' ? 'ทรัพยากรระบบ' : 'System resource telemetry'}
        subtitle={lang === 'th' ? 'ค่าที่อ่านจาก process และ operating system จริง ไม่เติมค่าตัวอย่าง' : 'Measured process and operating-system values only; unavailable metrics remain blank.'}
        gradientAccent="cyan"
      >
        <ResourceMonitor history={resources?.history} current={resources?.current} />
      </VividCard>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[10px] text-[var(--app-text-secondary)]">
        <div className="flex items-center gap-2"><Gauge size={13} /> {statusData?.serverTime ? `Last telemetry: ${new Date(statusData.serverTime).toLocaleString()}` : 'No telemetry timestamp'}</div>
        <button onClick={() => onNavigate('governance_security')} className="vivid-inline-link">Review evidence <ArrowRight size={13} /></button>
      </div>
    </div>
  );
};
