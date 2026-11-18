import React, { useCallback, useEffect, useState } from 'react';
import { EvidenceDrawerItem, ModuleId, SystemStatusData } from '../../types';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowRight,
  Award,
  Bot,
  Code2,
  Eye,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from 'lucide-react';

interface ProofOfIntelligenceProps {
  statusData: SystemStatusData | null;
  truthData: any;
  trainingReadiness: any;
  onNavigate: (module: ModuleId) => void;
  onOpenQuickTask: () => void;
  onInspectEvidence: (item: EvidenceDrawerItem) => void;
  onRefreshAll?: () => Promise<void> | void;
}

export const ProofOfIntelligence: React.FC<ProofOfIntelligenceProps> = ({
  statusData,
  truthData,
  trainingReadiness,
  onNavigate,
  onOpenQuickTask,
  onInspectEvidence,
  onRefreshAll,
}) => {
  const { lang } = useLanguage();
  const { authHeaders, isAuthenticated, role } = useAuth();
  const isDevOrAdmin = role === 'Developer' || role === 'Administrator';

  const [knowledgeStats, setKnowledgeStats] = useState<any>(null);
  const [provenanceAudit, setProvenanceAudit] = useState<any>(null);
  const [recentDocs, setRecentDocs] = useState<any[]>([]);
  const [swBenchmarks, setSwBenchmarks] = useState<any[]>([]);
  const [stageBenchLatest, setStageBenchLatest] = useState<any>(null);
  const [agentTasks, setAgentTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningSwBench, setRunningSwBench] = useState(false);
  const [runningStageBench, setRunningStageBench] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadProofTelemetry = useCallback(async () => {
    const headers = authHeaders();
    if (!isAuthenticated || !headers.Authorization) {
      setKnowledgeStats(null);
      setProvenanceAudit(null);
      setRecentDocs([]);
      return;
    }

    setLoading(true);
    try {
      const [statsRes, provRes, docsRes] = await Promise.all([
        fetch('/api/knowledge/stats', { headers }).catch(() => null),
        fetch('/api/knowledge/dataset-provenance-audit', { headers }).catch(() => null),
        fetch('/api/knowledge/documents', { headers }).catch(() => null),
      ]);

      if (statsRes?.ok) {
        const j = await statsRes.json();
        if (j?.success) setKnowledgeStats(j.stats || j);
      }
      if (provRes?.ok) {
        const j = await provRes.json();
        if (j?.success) setProvenanceAudit(j);
      }
      if (docsRes?.ok) {
        const j = await docsRes.json();
        if (j?.success && Array.isArray(j.documents)) setRecentDocs(j.documents.slice(0, 5));
      }

      if (isDevOrAdmin) {
        const [swRes, stRes, tasksRes] = await Promise.all([
          fetch('/api/benchmarks', { headers }).catch(() => null),
          fetch('/api/benchmarks/stages', { headers }).catch(() => null),
          fetch('/api/agent/tasks', { headers }).catch(() => null),
        ]);
        if (swRes?.ok) {
          const j = await swRes.json();
          if (j?.success && Array.isArray(j.benchmarks)) setSwBenchmarks(j.benchmarks);
        }
        if (stRes?.ok) {
          const j = await stRes.json();
          if (j?.success) setStageBenchLatest(j.latest || null);
        }
        if (tasksRes?.ok) {
          const j = await tasksRes.json();
          if (j?.success && Array.isArray(j.tasks)) setAgentTasks(j.tasks.slice(0, 8));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin]);

  useEffect(() => {
    void loadProofTelemetry();
  }, [loadProofTelemetry]);

  const handleRunSwBench = async () => {
    if (!isAuthenticated || !isDevOrAdmin || runningSwBench) return;
    setRunningSwBench(true);
    setActionMsg(null);
    try {
      const res = await fetch('/api/benchmarks/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setActionMsg(json?.error || `Software benchmark HTTP ${res.status}`);
      } else {
        setActionMsg(
          lang === 'th'
            ? 'รันชุดทดสอบ Software Engineering สำเร็จและบันทึกหลักฐานแล้ว'
            : 'Software Engineering benchmark executed and persisted.'
        );
        await loadProofTelemetry();
        if (onRefreshAll) await onRefreshAll();
      }
    } finally {
      setRunningSwBench(false);
    }
  };

  const handleRunStageBench = async () => {
    if (!isAuthenticated || !isDevOrAdmin || runningStageBench) return;
    setRunningStageBench(true);
    setActionMsg(null);
    try {
      const res = await fetch('/api/benchmarks/stages/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mode: 'specification' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setActionMsg(json?.error || `20-Task stage benchmark HTTP ${res.status}`);
      } else {
        setActionMsg(
          lang === 'th'
            ? 'รันชุดวัดผล Stage Benchmark 20 งานสำเร็จ'
            : '20-Task stage benchmark executed.'
        );
        await loadProofTelemetry();
        if (onRefreshAll) await onRefreshAll();
      }
    } finally {
      setRunningStageBench(false);
    }
  };

  const model = statusData?.model;
  const ready = Boolean(model?.weightsLoaded && model?.inferenceReady);
  const numpyReady = Boolean(trainingReadiness?.pythonBackend?.numpyAvailable);
  const swSummary = truthData?.softwareEngineering?.summary;
  const swEvidenceList: any[] = truthData?.softwareEngineering?.recentEvidence || [];
  const execAutonomy = truthData?.executionAndAutonomy;
  const sandboxFiles = statusData?.sandbox?.fileCount ?? 0;

  const seStatus =
    swBenchmarks.length > 0 && swBenchmarks[0]?.passed === swBenchmarks[0]?.total && swBenchmarks[0]?.total > 0
      ? ready
        ? 'VERIFIED'
        : 'PARTIAL'
      : swSummary && swSummary.implemented > 0
        ? 'PARTIAL'
        : 'UNVERIFIED';

  const researchStatus =
    provenanceAudit?.status === 'PASS' && (knowledgeStats?.totalDocuments ?? recentDocs.length) > 0
      ? 'VERIFIED'
      : (knowledgeStats?.totalDocuments ?? recentDocs.length) > 0
        ? 'PARTIAL'
        : 'BLOCKED';

  const autoStatus =
    execAutonomy?.dataAvailability === 'VERIFIED' && ready
      ? 'VERIFIED'
      : execAutonomy?.history?.length > 0 || agentTasks.length > 0
        ? 'PARTIAL'
        : 'BLOCKED';

  const prerequisites = [
    {
      name: lang === 'th' ? 'Native Architecture (PureSeqLM)' : 'Native Architecture (PureSeqLM)',
      state: 'IMPLEMENTED',
      detail: '512d · 10 layers · 8 heads · 1,472 FFN · 41,527,808 target params',
    },
    {
      name: lang === 'th' ? 'Sovereign Tokenizer (TH/EN)' : 'Sovereign Tokenizer (TH/EN)',
      state: model?.tokenizerSha256 ? 'VERIFIED' : 'PARTIAL',
      detail: model?.tokenizerSha256
        ? `SHA-256 ${model.tokenizerSha256.slice(0, 14)}…`
        : '16k bilingual subword structure active; runtime seal awaits weight binding',
    },
    {
      name: lang === 'th' ? '41.5M Model Checkpoint' : '41.5M Model Checkpoint',
      state: model?.weightsLoaded ? 'VERIFIED' : 'NOT_CONFIGURED',
      detail: model?.weightsLoaded
        ? `${Number(model.activeParams ?? model.totalParams).toLocaleString()} params loaded`
        : 'Cloud Checkpoint URL / S3 not bound or weights not loaded yet',
    },
    {
      name: 'Native Runtime',
      state: ready ? 'VERIFIED' : 'BLOCKED',
      detail: model?.readinessReason || model?.runtimeState || 'Fail-closed until verified forward pass',
    },
    {
      name: 'Native NumPy Training',
      state: numpyReady ? 'VERIFIED' : 'BLOCKED',
      detail: numpyReady
        ? `NumPy v${trainingReadiness.pythonBackend.numpyVersion}`
        : 'NumPy C-extension missing (np_compat fallback blocked for 41.5M)',
    },
    {
      name: lang === 'th' ? 'Training 5,800 Steps' : 'Training 5,800 Steps',
      state:
        trainingReadiness?.checkpointSave?.latestRunStatus === 'COMPLETED_VERIFIED'
          ? 'VERIFIED'
          : 'UNVERIFIED',
      detail:
        trainingReadiness?.checkpointSave?.pipelineRunsCount > 0
          ? `${trainingReadiness.checkpointSave.pipelineRunsCount} run(s) recorded`
          : 'Locked 5,800-step verification not completed yet',
    },
    {
      name: 'Evaluation & Benchmarks',
      state: ready && stageBenchLatest?.stage_pass_rates ? 'VERIFIED' : 'PARTIAL',
      detail: stageBenchLatest?.total_tasks
        ? `Latest stage_bench: ${stageBenchLatest.total_tasks} tasks (${stageBenchLatest.mode})`
        : 'Harness implemented; must prove against active 41.5M Native Model weights',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.16em] text-[var(--app-accent)]">
            <Award className="w-3.5 h-3.5" />
            <span>PROOF OF INTELLIGENCE · EVIDENCE OVER CLAIM</span>
          </div>
          <h2 className="mt-1 text-xl font-bold text-[var(--app-text-primary)]">
            {lang === 'th'
              ? 'การพิสูจน์ 3 งานหลักของ ZYNTHEOR Native Intelligence'
              : 'Core Intelligence Proof Tracker (3 Real Workloads)'}
          </h2>
          <p className="mt-1 text-xs text-[var(--app-text-secondary)] max-w-3xl">
            {lang === 'th'
              ? 'เป้าหมายไม่ได้จบแค่ Chatbot แต่ต้องพิสูจน์ว่า Native Model 41.5M + Runtime ของตัวเองสามารถพัฒนาซอฟต์แวร์ วิจัยวิเคราะห์ และปฏิบัติงานอัตโนมัติได้จริงโดยมี SHA-256 ตรวจสอบทุกขั้นตอน'
              : 'Tracks live verifiable evidence across Software Engineering, Research & Analysis, and Autonomous Execution using only measured runtime records.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadProofTelemetry()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--app-accent)] text-xs font-semibold text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{lang === 'th' ? 'รีเฟรชหลักฐาน' : 'Refresh Proofs'}</span>
        </button>
      </div>

      {actionMsg && (
        <div className="p-3 rounded-xl border border-[var(--app-accent)]/40 bg-[color-mix(in_srgb,var(--app-accent)_10%,var(--app-surface))] font-mono text-xs text-[var(--app-text-primary)]">
          {actionMsg}
        </div>
      )}

      {/* 3 Core Proof Pillars */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 01 Software Engineering */}
        <VividCard
          title="01 — Software Engineering"
          subtitle={lang === 'th' ? 'สร้างโปรแกรม ทดสอบ แก้ไข และส่งมอบซอร์สโค้ด' : 'Create, build, test, repair, and deliver verified code'}
          gradientAccent="cyan"
          headerAction={<StatusDot status={seStatus} />}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2.5 font-mono tabular-nums">
              <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Capabilities</div>
                <div className="mt-1 text-base font-bold text-[var(--app-text-primary)]">
                  {swSummary ? `${swSummary.implemented}/${swSummary.total}` : '—'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Sandbox Files</div>
                <div className="mt-1 text-base font-bold text-[var(--app-text-primary)]">{sandboxFiles}</div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Native Model Assist:</span>
                <span className={ready ? 'text-[var(--z-ok)] font-bold' : 'text-[var(--z-warn)] font-bold'}>
                  {ready ? 'NATIVE READY' : 'DETERMINISTIC FALLBACK ONLY'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Recorded Benchmarks:</span>
                <span className="text-[var(--app-text-primary)]">{swBenchmarks.length || swEvidenceList.length}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">20-Task Stage Bench:</span>
                <span className="text-[var(--app-text-primary)]">
                  {stageBenchLatest?.total_tasks ? `${stageBenchLatest.total_tasks} tasks` : 'Not run'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {isDevOrAdmin && (
                <button
                  type="button"
                  disabled={runningSwBench}
                  onClick={() => void handleRunSwBench()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-[var(--app-accent)] text-slate-950 cursor-pointer disabled:opacity-50"
                >
                  {runningSwBench ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span>Run SE Check</span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  onInspectEvidence({
                    title: '01 — Software Engineering Evidence',
                    subtitle: 'Capability & execution records from SoftwareProjectManager & BenchmarkArena',
                    status: seStatus,
                    source: '/api/benchmarks + TruthDashboard.softwareEngineering',
                    hash: swEvidenceList[0]?.evidenceHash || null,
                    details: [
                      { label: 'Sandbox Workspace Files', value: String(sandboxFiles) },
                      {
                        label: 'Implemented Capabilities',
                        value: swSummary ? `${swSummary.implemented} / ${swSummary.total}` : 'Unknown',
                      },
                      { label: 'Native Model Bound', value: ready ? 'YES (41.5M Verified)' : 'NO (Unbound)' },
                      { label: 'Recent Evidence Records', value: String(swEvidenceList.length) },
                    ],
                    rawJson: { swBenchmarks: swBenchmarks.slice(0, 3), recentEvidence: swEvidenceList.slice(0, 3) },
                    remediation: ready
                      ? []
                      : ['Bind & verify 41.5M Cloud Checkpoint so code synthesis runs on Native Runtime rather than deterministic engine alone.'],
                    targetModule: isDevOrAdmin ? 'dev_studio' : 'infrastructure_cloud',
                    targetLabel: isDevOrAdmin ? 'Open Creation Studio' : 'Open Infrastructure',
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Inspect</span>
              </button>
              {isDevOrAdmin && (
                <button
                  type="button"
                  onClick={() => onNavigate('dev_studio')}
                  className="ml-auto vivid-inline-link"
                >
                  <Code2 className="w-3.5 h-3.5" /> Studio <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </VividCard>

        {/* 02 Research & Analysis */}
        <VividCard
          title="02 — Research & Analysis"
          subtitle={lang === 'th' ? 'ดึงข้อมูลจริง วิเคราะห์ และสรุปรายงานพร้อมแหล่งอ้างอิง' : 'Real ingestion, multi-hop graph analysis & SHA-256 citations'}
          gradientAccent="violet"
          headerAction={<StatusDot status={researchStatus} />}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2.5 font-mono tabular-nums">
              <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Documents</div>
                <div className="mt-1 text-base font-bold text-[var(--app-text-primary)]">
                  {knowledgeStats?.totalDocuments ?? recentDocs.length}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Provenance Gate</div>
                <div
                  className={`mt-1 text-base font-bold ${
                    provenanceAudit?.status === 'PASS' ? 'text-[var(--z-ok)]' : 'text-[var(--z-warn)]'
                  }`}
                >
                  {provenanceAudit?.status || 'UNVERIFIED'}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Vector Chunks:</span>
                <span className="text-[var(--app-text-primary)]">{knowledgeStats?.totalChunks ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Dataset Records:</span>
                <span className="text-[var(--app-text-primary)]">
                  {provenanceAudit?.totalRecords ?? provenanceAudit?.workspaceSummary?.total_records ?? '—'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Latest Doc Hash:</span>
                <span className="text-[var(--app-text-primary)]">
                  {recentDocs[0]?.sha256 ? `${String(recentDocs[0].sha256).slice(0, 12)}…` : 'None'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => onNavigate('research_lab')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-[var(--app-violet)] text-white cursor-pointer hover:opacity-90"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                <span>{lang === 'th' ? 'เปิด ResearchLab' : 'Open ResearchLab'}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onInspectEvidence({
                    title: '02 — Research & Analysis Evidence',
                    subtitle: 'Knowledge Workspace ingestion, graph traversal & dataset provenance audit',
                    status: researchStatus,
                    source: '/api/knowledge/stats + /api/knowledge/dataset-provenance-audit',
                    hash: recentDocs[0]?.sha256 || null,
                    details: [
                      { label: 'Ingested Documents', value: String(knowledgeStats?.totalDocuments ?? recentDocs.length) },
                      { label: 'Indexed Vector Chunks', value: String(knowledgeStats?.totalChunks ?? '0') },
                      { label: 'Provenance Gate Status', value: String(provenanceAudit?.status || 'UNKNOWN') },
                      {
                        label: 'Blocking Reasons',
                        value: Array.isArray(provenanceAudit?.blockingReasons) && provenanceAudit.blockingReasons.length > 0
                          ? provenanceAudit.blockingReasons.join('; ')
                          : 'None',
                      },
                    ],
                    rawJson: { provenanceAudit, recentDocs },
                    remediation: Array.isArray(provenanceAudit?.blockingReasons) ? provenanceAudit.blockingReasons : [],
                    targetModule: 'knowledge_hub',
                    targetLabel: 'Open Knowledge & Memory',
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Inspect</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('knowledge_hub')}
                className="ml-auto vivid-inline-link"
              >
                Memory <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </VividCard>

        {/* 03 Autonomous Execution */}
        <VividCard
          title="03 — Autonomous Execution"
          subtitle={lang === 'th' ? 'ทำงานหลายขั้นตอน ทดสอบ และส่งมอบผ่านระบบจริง' : 'Multi-step planning, runtime execution & verified delivery'}
          gradientAccent="emerald"
          headerAction={<StatusDot status={autoStatus} />}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2.5 font-mono tabular-nums">
              <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Success Rate</div>
                <div className="mt-1 text-base font-bold text-[var(--app-text-primary)]">
                  {typeof execAutonomy?.taskSuccessRatePct === 'number' ? `${execAutonomy.taskSuccessRatePct}%` : '—'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Recovery Rate</div>
                <div className="mt-1 text-base font-bold text-[var(--app-text-primary)]">
                  {typeof execAutonomy?.recoverySuccessRatePct === 'number' ? `${execAutonomy.recoverySuccessRatePct}%` : '—'}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Active Jobs:</span>
                <span className="text-[var(--app-text-primary)]">{execAutonomy?.activeJobs?.length ?? 0}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Verified Cycles:</span>
                <span className="text-[var(--app-text-primary)]">{execAutonomy?.history?.length ?? agentTasks.length}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Verification Rate:</span>
                <span className="text-[var(--app-text-primary)]">
                  {typeof execAutonomy?.verificationSuccessRatePct === 'number'
                    ? `${execAutonomy.verificationSuccessRatePct}%`
                    : 'NOT_ENOUGH_DATA'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onOpenQuickTask}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-[var(--z-ok)] text-slate-950 cursor-pointer"
              >
                <Workflow className="w-3.5 h-3.5" />
                <span>{lang === 'th' ? 'สั่งงานทดสอบจริง' : 'Dispatch Real Task'}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onInspectEvidence({
                    title: '03 — Autonomous Execution Evidence',
                    subtitle: 'ActionDrivenEngine verified cycles, recovery attempts & active plans',
                    status: autoStatus,
                    source: 'TruthDashboard.executionAndAutonomy',
                    hash: execAutonomy?.history?.[0]?.evidenceHash || null,
                    details: [
                      { label: 'Data Availability', value: String(execAutonomy?.dataAvailability || 'NOT_ENOUGH_DATA') },
                      { label: 'Active Planned Jobs', value: String(execAutonomy?.activeJobs?.length ?? 0) },
                      { label: 'History Entries', value: String(execAutonomy?.history?.length ?? 0) },
                    ],
                    rawJson: { executionAndAutonomy: execAutonomy, agentTasks },
                    remediation: ready
                      ? []
                      : ['Complete Native Runtime 41.5M loading and execute multi-step verification tasks to prove autonomous loops on Native Model.'],
                    targetModule: 'automation_center',
                    targetLabel: 'Open Autonomous Execution',
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Inspect</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('automation_center')}
                className="ml-auto vivid-inline-link"
              >
                <Bot className="w-3.5 h-3.5" /> Engine <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </VividCard>
      </div>

      {/* Checklist: What Must Be Proved Before Calling It Our Own AI */}
      <VividCard
        title={lang === 'th' ? 'สิ่งที่ต้องพิสูจน์ก่อนเรียกว่า AI ของตัวเอง (Proof Checklist)' : 'Sovereign AI Proof Checklist'}
        subtitle={
          lang === 'th'
            ? 'ประเมินจากสถานะจริงของระบบ (Live Telemetry) — แยกชัดเจนระหว่าง "มีโครงสร้าง" กับ "ยืนยันการใช้งานจริง"'
            : 'Live inspection matrix strictly separating implemented structure from verified native model runtime.'
        }
        gradientAccent="purple"
        headerAction={
          isDevOrAdmin ? (
            <button
              type="button"
              disabled={runningStageBench}
              onClick={() => void handleRunStageBench()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
            >
              {runningStageBench ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-[var(--app-accent)]" />}
              <span>Run 20-Task Benchmark</span>
            </button>
          ) : undefined
        }
      >
        <div className="divide-y divide-[var(--app-card-border)]">
          {prerequisites.map((row) => (
            <div
              key={row.name}
              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--app-text-primary)]">{row.name}</div>
                <div className="text-xs font-mono text-[var(--app-text-secondary)] mt-0.5 break-words">{row.detail}</div>
              </div>
              <StatusDot status={row.state} />
            </div>
          ))}
        </div>
      </VividCard>
    </div>
  );
};
