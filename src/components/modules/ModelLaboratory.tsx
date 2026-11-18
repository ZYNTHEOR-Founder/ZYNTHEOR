import React, { useCallback, useEffect, useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { ConnectivityE2EVerifier } from '../ui/ConnectivityE2EVerifier';
import { Cloud41MCheckpointModule } from '../Cloud41MCheckpointModule';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useCheckpointVerification } from '../../hooks/useCheckpointVerification';
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  Database,
  FileCheck,
  GitBranch,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';

const TARGET_PARAMS = 41_527_808;
const count = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

interface PhaseStatusEntry {
  phase: {
    id: string;
    order: number;
    titleEn: string;
    titleTh: string;
    descriptionEn: string;
    descriptionTh: string;
    focusAreas: string[];
    recommendedSteps: number;
    recommendedLr: number;
    curatedCorpus: string[];
  };
  status: 'VERIFIED' | 'TRAINED' | 'FAILED' | 'NOT_STARTED';
  runsCount: number;
  passedRunsCount: number;
  latestRun: any | null;
  bestValNll: number | null;
  latestPhaseVerification: any | null;
}

export const ModelLaboratory: React.FC = () => {
  const { lang } = useLanguage();
  const { authHeaders, authReady, isAuthenticated, role } = useAuth();
  const [modelStatus, setModelStatus] = useState<any>(null);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [phases, setPhases] = useState<PhaseStatusEntry[]>([]);
  const [phaseSummary, setPhaseSummary] = useState<any>(null);
  const [checkpoints, setCheckpoints] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [harvestReport, setHarvestReport] = useState<any>(null);

  const [selectedPhaseId, setSelectedPhaseId] = useState<string>('phase_1_continuation');
  const [continueMode, setContinueMode] = useState<'phase_continuation' | 'exact_resume' | 'fresh'>('phase_continuation');
  const [selectedCheckpointPath, setSelectedCheckpointPath] = useState<string>('');
  const [selectedResumeRunId, setSelectedResumeRunId] = useState<string>('');
  const [steps, setSteps] = useState<number>(12);
  const [lr, setLr] = useState<number>(0.02);
  const [customCorpusText, setCustomCorpusText] = useState<string>('');

  const [inspectionResult, setInspectionResult] = useState<any>(null);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [trainBusy, setTrainBusy] = useState(false);
  const [harvestBusy, setHarvestBusy] = useState(false);
  const [actionBusyRunId, setActionBusyRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [cloudUrlInput, setCloudUrlInput] = useState('');
  const [cloudUploadUrlInput, setCloudUploadUrlInput] = useState('');
  const [cloudKeyInput, setCloudKeyInput] = useState('');
  const [reconnectBusy, setReconnectBusy] = useState(false);

  const isDevOrAdmin = role === 'Developer' || role === 'Administrator';
  const {
    verification: baselineVerification,
    verifying: baselineVerifying,
    verificationError: baselineVerificationError,
    isVerified: baselineShaVerified,
    verifyCheckpoint,
  } = useCheckpointVerification({
    enabled: authReady && isAuthenticated && isDevOrAdmin,
    authHeaders,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setLastError('');
    try {
      const headers = authHeaders();
      const [runtimeResponse, inspectResponse, datasetsResponse] = await Promise.all([
        fetch('/api/system/status'),
        isAuthenticated && isDevOrAdmin
          ? fetch('/api/model/inspect', { headers })
          : Promise.resolve(new Response('{}', { status: 401 })),
        isAuthenticated
          ? fetch('/api/knowledge/datasets', { headers })
          : Promise.resolve(new Response('{}', { status: 401 })),
      ]);

      const [runtime, inspect, datasetData] = await Promise.all([
        runtimeResponse.json(),
        inspectResponse.json(),
        datasetsResponse.json(),
      ]);

      setModelStatus({
        runtime: runtime?.model || null,
        connectivity: runtime?.connectivity || null,
        inspect,
        inspectHttpOk: inspectResponse.ok,
      });
      if (datasetData?.success) setDatasets(Array.isArray(datasetData.datasets) ? datasetData.datasets : []);

      if (isAuthenticated && isDevOrAdmin) {
        const [phasesRes, runsRes, approvalsRes] = await Promise.all([
          fetch('/api/training/pipeline/phases', { headers }),
          fetch('/api/training/pipeline/runs', { headers }),
          fetch('/api/governance/approvals', { headers }),
        ]);
        const [phasesJson, runsJson, approvalsJson] = await Promise.all([
          phasesRes.json(),
          runsRes.json(),
          approvalsRes.json(),
        ]);
        if (phasesJson?.success) {
          setPhases(Array.isArray(phasesJson.phases) ? phasesJson.phases : []);
          setPhaseSummary(phasesJson.summary || null);
          setHarvestReport(phasesJson.harvestPreview || null);
          const discovered = Array.isArray(phasesJson.checkpoints) ? phasesJson.checkpoints : [];
          setCheckpoints(discovered);
          if (!selectedCheckpointPath && discovered.length > 0) {
            setSelectedCheckpointPath(discovered[0].path);
          }
        }
        if (runsJson?.success) {
          const rList = Array.isArray(runsJson.runs) ? runsJson.runs : [];
          setRuns(rList);
          setBackups(Array.isArray(runsJson.backups) ? runsJson.backups : []);
          const resumable = rList.find((r: any) => r.status === 'TRAINED' && r.checkpointLifecycle === 'TRAINED');
          if (!selectedResumeRunId && resumable) {
            setSelectedResumeRunId(resumable.runId);
          }
        }
        if (approvalsJson?.success) {
          setApprovals(Array.isArray(approvalsJson.requests) ? approvalsJson.requests : []);
        }
      }

      if (!runtimeResponse.ok) {
        setLastError(runtime?.error || runtime?.reason || `Runtime status HTTP ${runtimeResponse.status}`);
      } else if (!runtime?.model?.inferenceReady) {
        setLastError(runtime?.model?.readinessReason || 'Cloud Runtime has not loaded a verified active checkpoint.');
      }
      if (isAuthenticated && isDevOrAdmin) {
        void verifyCheckpoint();
      }
    } catch (error: any) {
      setLastError(error?.message || 'Unable to retrieve model evidence.');
      setModelStatus(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin, selectedCheckpointPath, selectedResumeRunId, verifyCheckpoint]);

  useEffect(() => {
    if (authReady) void refresh();
  }, [authReady, isAuthenticated, role]);

  const handleReconnectCloud = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (reconnectBusy) return;
    setReconnectBusy(true);
    setActionMessage('');
    setLastError('');
    try {
      const body: Record<string, string> = {};
      if (cloudUrlInput.trim()) body.presignedUrl = cloudUrlInput.trim();
      if (cloudKeyInput.trim()) body.objectKey = cloudKeyInput.trim();
      const res = await fetch('/api/connectivity/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        const errMsg = json.error || json.reason || `Reconnect HTTP ${res.status}`;
        setLastError(errMsg);
        setActionMessage(
          lang === 'th'
            ? `เชื่อมต่อ Cloud Runtime ไม่สำเร็จ: ${errMsg}`
            : `Cloud Runtime connection failed: ${errMsg}`
        );
      } else {
        setActionMessage(
          lang === 'th'
            ? `โหลดและตรวจสอบ Checkpoint สำเร็จ (${count(json.activeParams)} active params · SHA-256: ${String(json.checkpointSha256 || '').slice(0, 12)}…)`
            : `Cloud Checkpoint loaded & verified (${count(json.activeParams)} active params · SHA-256: ${String(json.checkpointSha256 || '').slice(0, 12)}…)`
        );
      }
      await refresh();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setLastError(msg);
      setActionMessage(`Reconnect error: ${msg}`);
    } finally {
      setReconnectBusy(false);
    }
  };

  const activePhase = phases.find((p) => p.phase.id === selectedPhaseId) || phases[0] || null;

  const handleSelectPhase = (entry: PhaseStatusEntry) => {
    setSelectedPhaseId(entry.phase.id);
    setSteps(entry.phase.recommendedSteps);
    setLr(entry.phase.recommendedLr);
  };

  const handleInspectCheckpoint = async (ckptPath?: string) => {
    const target = ckptPath || selectedCheckpointPath;
    if (!target || !isAuthenticated) return;
    setInspectBusy(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/training/pipeline/inspect-checkpoint', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ checkpointPath: target }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setInspectionResult(json.inspection);
    } catch (err: any) {
      setActionMessage(`Inspection error: ${err?.message || String(err)}`);
    } finally {
      setInspectBusy(false);
    }
  };

  const handleHarvestErrors = async () => {
    if (!isAuthenticated) return;
    setHarvestBusy(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/training/pipeline/harvest-errors', {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setHarvestReport(json.harvest);
      setActionMessage(
        lang === 'th'
          ? `เก็บข้อผิดพลาดจริง ${json.harvest.harvestedErrorSamples.length} รายการ (รวมชุดข้อมูล ${json.harvest.combinedSamples.length} ตัวอย่าง)`
          : `Harvested ${json.harvest.harvestedErrorSamples.length} live error trace(s) (${json.harvest.combinedSamples.length} curated samples ready).`
      );
    } catch (err: any) {
      setActionMessage(`Harvest error: ${err?.message || String(err)}`);
    } finally {
      setHarvestBusy(false);
    }
  };

  const handleRunPhaseTraining = async () => {
    if (!isAuthenticated || !isDevOrAdmin || trainBusy) return;
    setTrainBusy(true);
    setActionMessage('');
    try {
      const customLines = customCorpusText
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: Record<string, any> = {
        phaseId: selectedPhaseId,
        steps,
        lr,
        runPhaseVerification: true,
      };
      if (customLines.length > 0) {
        payload.customSamples = customLines;
      }
      if (continueMode === 'exact_resume' && selectedResumeRunId) {
        payload.resumeFromRunId = selectedResumeRunId;
        payload.resumeTraining = true;
      } else if (continueMode === 'phase_continuation' && selectedCheckpointPath) {
        payload.baselineCheckpointPath = selectedCheckpointPath;
        payload.resumeTraining = false;
      }

      const res = await fetch('/api/training/pipeline/phase-run', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Training HTTP ${res.status}`);
      }
      const run = json.run;
      if (run?.candidateCheckpointPath) {
        setSelectedCheckpointPath(run.candidateCheckpointPath);
      }
      if (run?.status === 'TRAINED') {
        setSelectedResumeRunId(run.runId);
      }
      setActionMessage(
        `${run.phaseLabel || selectedPhaseId}: status=${run.status}, steps=${run.cumulativeTrainingSteps ?? run.trainingConfig.steps}, val NLL ${run.baselineEval?.nll} → ${run.candidateEval?.nll}`
      );
      await refresh();
      if (run?.candidateCheckpointPath) {
        await handleInspectCheckpoint(run.candidateCheckpointPath);
      }
    } catch (err: any) {
      setActionMessage(`Training failed: ${err?.message || String(err)}`);
    } finally {
      setTrainBusy(false);
    }
  };

  const handleEvaluateRun = async (runId: string, kind: 'phase' | 'domain') => {
    setActionBusyRunId(runId);
    setActionMessage('');
    try {
      const endpoint =
        kind === 'phase' ? '/api/training/pipeline/phase-evaluate' : '/api/training/pipeline/benchmark';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ runId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setActionMessage(
        kind === 'phase'
          ? `Phase verification ${json.evaluation?.status}: ${json.evaluation?.summary?.passed}/${json.evaluation?.summary?.total} checks passed`
          : `Domain benchmark ${json.run?.benchmarkStatus}: ${json.run?.benchmarkReport?.summary?.passed || 0}/${json.run?.benchmarkReport?.summary?.total || 10} domains passed`
      );
      await refresh();
    } catch (err: any) {
      setActionMessage(`Evaluation error: ${err?.message || String(err)}`);
    } finally {
      setActionBusyRunId(null);
    }
  };

  const handleRequestApproval = async (runId: string) => {
    setActionBusyRunId(runId);
    setActionMessage('');
    try {
      const res = await fetch('/api/governance/approvals', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          actionType: 'MODEL_RELEASE',
          resourceId: runId,
          description: `Approve release of trained candidate checkpoint ${runId}`,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setActionMessage(`Approval request created: ${json.request?.requestId}`);
      await refresh();
    } catch (err: any) {
      setActionMessage(`Approval request error: ${err?.message || String(err)}`);
    } finally {
      setActionBusyRunId(null);
    }
  };

  const handleApprovalDecision = async (requestId: string, decision: 'approve' | 'reject', runId: string) => {
    setActionBusyRunId(runId);
    setActionMessage('');
    try {
      const res = await fetch(`/api/governance/approvals/${encodeURIComponent(requestId)}/${decision}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ note: `${decision}d via ModelLaboratory` }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setActionMessage(`Approval request ${requestId} ${decision}d.`);
      await refresh();
    } catch (err: any) {
      setActionMessage(`Approval decision error: ${err?.message || String(err)}`);
    } finally {
      setActionBusyRunId(null);
    }
  };

  const handlePromoteRun = async (runId: string) => {
    setActionBusyRunId(runId);
    setActionMessage('');
    try {
      const res = await fetch('/api/training/pipeline/promote', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ runId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setActionMessage(`Promoted run ${runId} to active local release target.`);
      await refresh();
    } catch (err: any) {
      setActionMessage(`Promote blocked: ${err?.message || String(err)}`);
    } finally {
      setActionBusyRunId(null);
    }
  };

  const handlePublishCloud = async (runId: string) => {
    setActionBusyRunId(runId);
    setActionMessage('');
    try {
      const res = await fetch('/api/training/pipeline/publish-cloud', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          runId,
          objectKey: cloudKeyInput.trim() || undefined,
          presignedUploadUrl: cloudUploadUrlInput.trim() || undefined,
          loadAfterUpload: !cloudUploadUrlInput.trim() || Boolean(cloudUrlInput.trim()),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setActionMessage(
        `Published checkpoint to Cloud Storage (${json.uploaded?.sourceUri} · SHA-256: ${String(
          json.uploaded?.payloadSha256 || ''
        ).slice(0, 12)}…)`
      );
      await refresh();
    } catch (err: any) {
      setActionMessage(`Cloud publish blocked: ${err?.message || String(err)}`);
    } finally {
      setActionBusyRunId(null);
    }
  };

  const handleRollback = async (backupId: string) => {
    setActionBusyRunId(backupId);
    setActionMessage('');
    try {
      const res = await fetch('/api/training/pipeline/rollback', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ backupId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setActionMessage(`Restored checkpoint backup ${backupId} (SHA-256: ${String(json.restoredSha256 || '').slice(0, 12)}…)`);
      await refresh();
    } catch (err: any) {
      setActionMessage(`Rollback failed: ${err?.message || String(err)}`);
    } finally {
      setActionBusyRunId(null);
    }
  };

  const runtime = modelStatus?.runtime;
  const connectivity = modelStatus?.connectivity;
  const inspect = modelStatus?.inspect;
  const ready = Boolean(
    runtime?.weightsLoaded &&
      runtime?.inferenceReady &&
      connectivity?.executionVerified !== false &&
      runtime?.runtimeState === 'READY'
  );
  const activeParams = ready ? (runtime?.activeParams ?? runtime?.totalParams ?? null) : null;
  const payloadBytes = inspect?.payload_bytes;
  const hash = ready ? (runtime?.checkpointSha256 || runtime?.checkpointHash || inspect?.payload_sha256 || '') : '';
  const digestVerified = ready && Boolean(hash) && inspect?.status !== 'PAYLOAD_INTEGRITY_FAILED';
  const internetReachable = Boolean(connectivity?.internetReachable);
  const cloudConfigured = Boolean(connectivity?.cloudStorageConfigured);
  const cloudReachable = Boolean(connectivity?.cloudStorageReachable);
  const bridgeReachable = Boolean(connectivity?.pythonBridgeReachable);
  const remediationSteps: string[] = Array.isArray(connectivity?.remediationSteps)
    ? connectivity.remediationSteps
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--app-text-primary)]">
            {lang === 'th' ? 'ห้องปฏิบัติการโมเดล Native และสายการฝึก 7 ระยะ' : 'Native Model Laboratory & 7-Phase Training Pipeline'}
          </h2>
          <p className="text-xs text-[var(--app-text-secondary)] mt-1">
            {lang === 'th'
              ? 'ตรวจ Checkpoint จริง โหลด Weight และ Optimizer State แล้วฝึกต่อยอดครบ 7 ระยะด้วยข้อมูลและหลักฐานจริง'
              : 'Inspect real checkpoints, verify optimizer/scheduler state, and run evidence-backed PureSeqLM continuation across all 7 phases.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="p-2 rounded-xl border border-[var(--app-card-border)] text-[var(--app-text-primary)] disabled:opacity-50 cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Top Runtime Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          title="Active parameters"
          value={ready ? count(activeParams) : '—'}
          subtitle={
            ready
              ? typeof activeParams === 'number' && activeParams < TARGET_PARAMS
                ? 'Partial Trained Subgraph · not full 41.5M Core'
                : 'Cloud Runtime verified & loaded'
              : 'Hidden until checkpoint verified & loaded'
          }
          icon={<BrainCircuit className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Target architecture"
          value={count(runtime?.targetParams ?? TARGET_PARAMS)}
          subtitle="Specification only · not active"
          icon={<Cloud className="w-5 h-5" />}
          accentColor="purple"
        />
        <MetricCard
          title="Local pipeline runs"
          value={phaseSummary ? `${phaseSummary.trainedCount}/${phaseSummary.totalPhases} phases` : `${runs.length} runs`}
          subtitle={checkpoints.length > 0 ? `${checkpoints.length} verified .pt bundle(s) on disk` : 'No local .pt candidates yet'}
          icon={<Layers className="w-5 h-5" />}
          accentColor="emerald"
        />
        <MetricCard
          title="Checkpoint integrity"
          value={digestVerified ? 'VERIFIED' : inspectionResult?.valid ? 'CANDIDATE OK' : 'UNVERIFIED'}
          subtitle={
            hash
              ? `${hash.slice(0, 16)}…`
              : inspectionResult?.sha256
              ? `Candidate ${inspectionResult.sha256.slice(0, 12)}…`
              : typeof payloadBytes === 'number'
              ? `${(payloadBytes / (1024 * 1024)).toFixed(2)} MB`
              : 'No active cloud seal'
          }
          icon={<FileCheck className="w-5 h-5" />}
          accentColor={digestVerified ? 'lime' : inspectionResult?.valid ? 'cyan' : 'coral'}
        />
      </div>

      {/* Runtime & Checkpoint Evidence + Internet vs Model Connectivity */}
      <VividCard
        title="Runtime, Connectivity & Checkpoint Evidence"
        subtitle="Separates public Internet reachability from Cloud Storage & Native Runtime checkpoint verification."
        gradientAccent="cyan"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className={`vivid-status-dot ${ready ? 'is-ready' : 'is-blocked'}`} />
            <span className="text-sm font-semibold text-[var(--app-text-primary)]">
              {ready ? 'READY' : runtime?.runtimeState || connectivity?.runtimeState || 'NOT_CONFIGURED'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${
                internetReachable
                  ? 'text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)]'
                  : 'text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)]'
              }`}
            >
              INTERNET: {internetReachable ? 'ONLINE' : 'OFFLINE'}
            </span>
            <StatusBadge
              status={
                ready
                  ? 'VERIFIED'
                  : connectivity?.cloudStorageConfigured
                  ? 'BLOCKED'
                  : 'UNVERIFIED'
              }
            />
          </div>
        </div>

        {/* Two-Track Connectivity Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-xs">
          <div className="rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] p-3">
            <div className="text-[10px] font-mono uppercase text-[var(--app-text-secondary)]">1. Internet Connectivity</div>
            <div className={`mt-1 font-bold ${internetReachable ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'}`}>
              {internetReachable ? 'ONLINE' : 'OFFLINE'}
            </div>
            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)] break-words">
              {connectivity?.internetProbeDetail || 'Checking public network reachability…'}
            </div>
          </div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] p-3">
            <div className="text-[10px] font-mono uppercase text-[var(--app-text-secondary)]">2. Cloud Storage</div>
            <div
              className={`mt-1 font-bold ${
                cloudConfigured && cloudReachable
                  ? 'text-[var(--z-ok)]'
                  : cloudConfigured
                  ? 'text-[var(--z-warn)]'
                  : 'text-[var(--z-danger)]'
              }`}
            >
              {cloudConfigured ? (cloudReachable ? 'REACHABLE' : 'UNREACHABLE') : 'NOT CONFIGURED'}
            </div>
            <div className="mt-1 text-[11px] font-mono text-[var(--app-text-secondary)] break-all">
              {connectivity?.cloudSourceUri ||
                (connectivity?.cloudConfigMissingKeys?.length
                  ? `Missing: ${connectivity.cloudConfigMissingKeys.join(', ')}`
                  : 'Set CHECKPOINT_PRESIGNED_URL or S3_BUCKET')}
            </div>
          </div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] p-3">
            <div className="text-[10px] font-mono uppercase text-[var(--app-text-secondary)]">3. Native Bridge & Weights</div>
            <div
              className={`mt-1 font-bold ${
                ready ? 'text-[var(--z-ok)]' : bridgeReachable ? 'text-[var(--z-warn)]' : 'text-[var(--z-danger)]'
              }`}
            >
              {ready ? 'VERIFIED & READY' : bridgeReachable ? 'BRIDGE UP · NO WEIGHTS' : 'BRIDGE UNREACHABLE'}
            </div>
            <div className="mt-1 text-[11px] font-mono text-[var(--app-text-secondary)]">
              {ready
                ? `Active Params: ${count(activeParams)}`
                : 'Active Params withheld until SHA-256 & forward-pass verified'}
            </div>
          </div>
        </div>

        <p className="text-sm leading-6 text-[var(--app-text-secondary)]">
          {lastError ||
            (ready
              ? 'Cloud checkpoint is loaded, SHA-256 verified, and forward-pass execution passed on the active bridge.'
              : connectivity?.reason || 'Cloud checkpoint is not yet connected or loaded.')}
        </p>

        {!ready && remediationSteps.length > 0 && (
          <div
            data-testid="model-connectivity-remediation"
            className="mt-3 p-3 rounded-xl border border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)] bg-[color-mix(in_srgb,var(--app-amber)_8%,var(--app-surface-elevated))] text-xs"
          >
            <div className="font-bold text-[var(--app-amber)] mb-1.5 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" />
              <span>{lang === 'th' ? 'สาเหตุและขั้นตอนการเชื่อมต่อ' : 'Diagnostics & Remediation Steps'}</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[var(--app-text-primary)]">
              {remediationSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Live Cloud Checkpoint Connect / Reload Form */}
        <form onSubmit={handleReconnectCloud} className="mt-4 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              value={cloudUrlInput}
              onChange={(e) => setCloudUrlInput(e.target.value)}
              placeholder="Download Presigned URL — CHECKPOINT_PRESIGNED_URL (https://.../model_checkpoint.pt)"
              className="flex-1 px-3 py-2 rounded-xl text-xs font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
            />
            <input
              type="text"
              value={cloudKeyInput}
              onChange={(e) => setCloudKeyInput(e.target.value)}
              placeholder="Optional S3 Key"
              className="sm:w-44 px-3 py-2 rounded-xl text-xs font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
            />
            <button
              type="submit"
              disabled={reconnectBusy}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-slate-950 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>{reconnectBusy ? 'Connecting…' : 'Connect & Load Checkpoint'}</span>
            </button>
          </div>
          <input
            type="url"
            value={cloudUploadUrlInput}
            onChange={(e) => setCloudUploadUrlInput(e.target.value)}
            placeholder="Optional Upload Presigned URL — CHECKPOINT_UPLOAD_URL for Publish to Cloud Storage (https://...)"
            className="w-full px-3 py-2 rounded-xl text-xs font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
          />
        </form>

        {hash && <p className="mt-3 text-[11px] break-all font-mono text-[var(--app-text-secondary)]">Verified SHA-256: {hash}</p>}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl bg-[var(--app-surface-elevated)] p-3">
            <div className="text-[var(--app-text-secondary)]">Target width</div>
            <div className="mt-1 font-semibold text-[var(--app-text-primary)]">512</div>
          </div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] p-3">
            <div className="text-[var(--app-text-secondary)]">Target layers</div>
            <div className="mt-1 font-semibold text-[var(--app-text-primary)]">10</div>
          </div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] p-3">
            <div className="text-[var(--app-text-secondary)]">Target heads</div>
            <div className="mt-1 font-semibold text-[var(--app-text-primary)]">8</div>
          </div>
          <div className="rounded-xl bg-[var(--app-surface-elevated)] p-3">
            <div className="text-[var(--app-text-secondary)]">Knowledge datasets</div>
            <div className="mt-1 font-semibold text-[var(--app-text-primary)]">{datasets.length}</div>
          </div>
        </div>

        {/* Baseline 41,527,808-Parameter Checkpoint SHA-256 Verification */}
        <div
          data-testid="checkpoint-baseline-verification"
          className="mt-4 p-3.5 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {baselineVerification?.status === 'VERIFIED' ? (
                <ShieldCheck className="w-4 h-4 text-[var(--z-ok)] shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-[var(--z-warn)] shrink-0" />
              )}
              <span className="font-bold text-[var(--app-text-primary)]">
                {lang === 'th'
                  ? 'การตรวจยืนยัน SHA-256 ของ Checkpoint 41.5M เทียบกับ Baseline'
                  : 'Recovered 41.5M Checkpoint SHA-256 Baseline Check'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                data-testid="checkpoint-baseline-status"
                className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${
                  baselineVerification?.status === 'VERIFIED'
                    ? 'text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)]'
                    : baselineVerification?.status === 'MISSING' || baselineVerification?.status === 'MISMATCH'
                    ? 'text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)]'
                    : 'text-[var(--app-text-secondary)] border-[var(--app-card-border)]'
                }`}
              >
                {baselineVerifying
                  ? 'VERIFYING'
                  : baselineVerification?.status || (isAuthenticated && isDevOrAdmin ? 'UNVERIFIED' : 'AUTH_REQUIRED')}
              </span>
              {isAuthenticated && isDevOrAdmin && (
                <button
                  type="button"
                  data-testid="verify-checkpoint-baseline-btn"
                  onClick={() => void verifyCheckpoint()}
                  disabled={baselineVerifying}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--app-surface)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] disabled:opacity-50 cursor-pointer"
                >
                  {baselineVerifying ? 'Checking…' : 'Verify SHA-256'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 font-mono text-[11px]">
            <div className="p-2 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)]">
              <div className="text-[10px] text-[var(--app-text-secondary)]">Target Path</div>
              <div className="text-[var(--app-text-primary)] break-all mt-0.5">
                {baselineVerification?.checkpointPath || 'native_data/model_checkpoint_target_41m.pt'}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)]">
              <div className="text-[10px] text-[var(--app-text-secondary)]">Parameter Count</div>
              <div className="text-[var(--app-text-primary)] mt-0.5">
                {baselineVerification?.actualParams != null
                  ? `${count(baselineVerification.actualParams)} / ${count(baselineVerification.expectedParams)}`
                  : `— / ${count(TARGET_PARAMS)}`}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)]">
              <div className="text-[10px] text-[var(--app-text-secondary)]">Actual SHA-256</div>
              <div className="text-[var(--app-text-primary)] break-all mt-0.5">
                {baselineVerification?.actualContainerSha256
                  ? `${baselineVerification.actualContainerSha256.slice(0, 16)}…`
                  : 'NOT FOUND ON DISK'}
              </div>
            </div>
          </div>

          <div className="text-[11px] text-[var(--app-text-secondary)] break-all">
            {baselineVerificationError ||
              baselineVerification?.reason ||
              (isAuthenticated && isDevOrAdmin
                ? 'Run Verify SHA-256 to hash native_data/model_checkpoint_target_41m.pt against baseline evidence.'
                : 'Sign in with Developer or Administrator role to inspect disk checkpoint SHA-256.')}
          </div>
          <div className="text-[10px] font-mono text-[var(--app-text-secondary)] break-all">
            Expected Baselines: 18ed252176ec16f5… (arch-audit) | 022b94d666a955f9… (step-1000)
          </div>
        </div>

        <ConnectivityE2EVerifier
          presignedUrl={cloudUrlInput}
          objectKey={cloudKeyInput}
          authHeaders={authHeaders}
          onAfterVerify={refresh}
        />
      </VividCard>

      {/* 41.5M Cloud Checkpoint Fetch, SHA-256 & Param Count Pre-Load Verifier + Storage R/W Probe */}
      <Cloud41MCheckpointModule onAfterRuntimeLoad={refresh} />

      {/* Authentication Notice if not Dev/Admin */}
      {(!isAuthenticated || !isDevOrAdmin) && (
        <VividCard
          title={lang === 'th' ? 'สิทธิ์การเข้าถึงสายการฝึกโมเดล' : 'Training Pipeline Authorization Required'}
          subtitle={lang === 'th' ? 'กรุณาเข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator ในหน้า Settings เพื่อรันการฝึกและตรวจ Checkpoint' : 'Sign in with a Developer or Administrator session in Settings to inspect checkpoints, run training phases, and review gates.'}
          gradientAccent="coral"
        >
          <div className="flex items-start gap-3 text-xs text-[var(--app-text-secondary)]">
            <ShieldAlert className="w-5 h-5 text-[var(--z-warn)] shrink-0 mt-0.5" />
            <div>
              {isAuthenticated
                ? `Current role is '${role}'. Training pipeline execution requires Developer or Administrator privileges.`
                : 'No active session token. Open Control Center (Settings) to sign in with an authorized account.'}
            </div>
          </div>
        </VividCard>
      )}

      {/* 7-Phase Progression Studio */}
      {isAuthenticated && isDevOrAdmin && (
        <>
          <VividCard
            title={lang === 'th' ? 'แผนการฝึกและต่อยอด 7 ระยะ (Phase 1 – Phase 7)' : '7-Phase Training & Continuation Curriculum'}
            subtitle={
              lang === 'th'
                ? 'แต่ละระยะบันทึก Weight จริง Optimizer State และผลการวัด NLL/Perplexity แยกเป็นหลักฐาน'
                : 'Select a curriculum phase to execute real PureAdamW backpropagation and phase-specific verification.'
            }
            gradientAccent="emerald"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {phases.map((entry) => {
                const selected = entry.phase.id === selectedPhaseId;
                const stColor =
                  entry.status === 'VERIFIED'
                    ? 'text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)]'
                    : entry.status === 'TRAINED'
                    ? 'text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)]'
                    : entry.status === 'FAILED'
                    ? 'text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)]'
                    : 'text-[var(--app-text-secondary)] border-[var(--app-card-border)]';
                return (
                  <button
                    key={entry.phase.id}
                    type="button"
                    onClick={() => handleSelectPhase(entry)}
                    className={`text-left p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                      selected
                        ? 'bg-[color-mix(in_srgb,var(--app-accent)_10%,var(--app-surface-elevated))] border-[var(--app-accent)] shadow-sm'
                        : 'bg-[var(--app-surface)] border-[var(--app-card-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_55%,transparent)]'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono font-bold text-[var(--app-text-secondary)]">
                          PHASE {entry.phase.order}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${stColor}`}>
                          {entry.status}
                        </span>
                      </div>
                      <div className="text-xs font-bold text-[var(--app-text-primary)] leading-snug">
                        {lang === 'th' ? entry.phase.titleTh : entry.phase.titleEn}
                      </div>
                      <p className="text-[11px] text-[var(--app-text-secondary)] leading-relaxed line-clamp-2">
                        {lang === 'th' ? entry.phase.descriptionTh : entry.phase.descriptionEn}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-[var(--app-card-border)] flex items-center justify-between text-[10px] font-mono text-[var(--app-text-secondary)] tabular-nums">
                      <span>Runs: {entry.runsCount}</span>
                      <span>
                        Best NLL: {typeof entry.bestValNll === 'number' ? entry.bestValNll.toFixed(4) : '—'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {actionMessage && (
              <div className="mt-4 p-3 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs font-mono text-[var(--app-text-primary)]">
                {actionMessage}
              </div>
            )}
          </VividCard>

          {/* Phase 1 Checkpoint Inspector + Phase Runner */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Checkpoint & Optimizer State Inspector */}
            <VividCard
              title={lang === 'th' ? 'Phase 1: ตรวจ Checkpoint & Optimizer State' : 'Phase 1: Checkpoint & Optimizer Inspector'}
              subtitle={lang === 'th' ? 'ตรวจสอบความถูกต้อง SHA-256 โครงสร้าง Weight ค่า PureAdamW และ Scheduler ล่าสุด' : 'Verify .pt weight hashes, PureAdamW moments, LR scheduler step, and cumulative step history.'}
              gradientAccent="cyan"
            >
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={selectedCheckpointPath}
                    onChange={(e) => setSelectedCheckpointPath(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl text-xs font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                  >
                    <option value="">
                      {checkpoints.length === 0
                        ? 'No .pt checkpoints on disk yet — train Phase 1 to create baseline'
                        : 'Select checkpoint file...'}
                    </option>
                    {checkpoints.map((c) => (
                      <option key={c.path} value={c.path}>
                        {c.relativePath} ({(c.sizeBytes / 1024).toFixed(1)} KB
                        {typeof c.cumulativeTrainingSteps === 'number' ? ` · ${c.cumulativeTrainingSteps} steps` : ''})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedCheckpointPath || inspectBusy}
                    onClick={() => void handleInspectCheckpoint()}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-[var(--app-bg)] disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{inspectBusy ? 'Inspecting...' : 'Inspect State'}</span>
                  </button>
                </div>

                {inspectionResult ? (
                  inspectionResult.valid ? (
                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono tabular-nums">
                        <div className="p-2.5 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)]">
                          <div className="text-[10px] text-[var(--app-text-secondary)]">Total Params / ||W||₂</div>
                          <div className="font-bold text-[var(--app-text-primary)] mt-0.5">
                            {count(inspectionResult.total_params)} · {inspectionResult.weights_l2_norm}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)]">
                          <div className="text-[10px] text-[var(--app-text-secondary)]">Optimizer (PureAdamW)</div>
                          <div className="font-bold text-[var(--z-ok)] mt-0.5">
                            {inspectionResult.optimizer?.valid ? `t=${inspectionResult.optimizer.step} · READY` : 'MISSING'}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)]">
                          <div className="text-[10px] text-[var(--app-text-secondary)]">Cumulative Steps</div>
                          <div className="font-bold text-[var(--app-accent)] mt-0.5">
                            {inspectionResult.cumulative_training_steps} (run={inspectionResult.steps_this_run})
                          </div>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] font-mono text-[11px] space-y-1">
                        <div>
                          <span className="text-[var(--app-text-secondary)]">Lifecycle:</span>{' '}
                          <span className="font-bold text-[var(--app-text-primary)]">{inspectionResult.checkpoint_lifecycle}</span>{' '}
                          · Quality Gate:{' '}
                          <span className="font-bold text-[var(--z-ok)]">{inspectionResult.quality_gate_status}</span>
                        </div>
                        <div>
                          <span className="text-[var(--app-text-secondary)]">Scheduler:</span>{' '}
                          {inspectionResult.scheduler?.present
                            ? `${inspectionResult.scheduler.type} (completed=${inspectionResult.scheduler.completed_steps}, lr=${inspectionResult.scheduler.current_lr})`
                            : 'Not present'}
                        </div>
                        <div>
                          <span className="text-[var(--app-text-secondary)]">Payload SHA-256:</span>{' '}
                          {inspectionResult.sha256}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] border border-[var(--z-danger)] text-xs font-mono text-[var(--z-danger)]">
                      {inspectionResult.error || 'Checkpoint inspection failed'}
                    </div>
                  )
                ) : (
                  <div className="p-4 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-xs text-[var(--app-text-secondary)]">
                    {checkpoints.length > 0
                      ? 'Select a checkpoint and click Inspect State to verify weights, PureAdamW moments, and cumulative step metadata.'
                      : 'No checkpoint bundles found yet. Run Phase 1 on the right panel to create and verify an initial PureSeqLM checkpoint.'}
                  </div>
                )}
              </div>
            </VividCard>

            {/* Training & Continuation Runner */}
            <VividCard
              title={activePhase ? (lang === 'th' ? activePhase.phase.titleTh : activePhase.phase.titleEn) : 'Run Training Phase'}
              subtitle={activePhase ? activePhase.phase.focusAreas.join(' · ') : 'Configure optimizer steps & continuation mode'}
              gradientAccent="emerald"
            >
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[var(--app-text-secondary)] mb-1">
                      Continuation Mode
                    </label>
                    <select
                      value={continueMode}
                      onChange={(e) => setContinueMode(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    >
                      <option value="phase_continuation">Phase Continuation (Load Weights)</option>
                      <option value="exact_resume">Exact Optimizer Resume (Frozen Dataset)</option>
                      <option value="fresh">Fresh PureSeqLM Initialization</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[var(--app-text-secondary)] mb-1">
                      Optimizer Steps (1–80)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={80}
                      value={steps}
                      onChange={(e) => setSteps(Math.max(1, Math.min(80, Number(e.target.value) || 12)))}
                      className="w-full px-3 py-2 rounded-xl font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[var(--app-text-secondary)] mb-1">
                      Learning Rate
                    </label>
                    <input
                      type="number"
                      step="0.002"
                      min={0.0005}
                      max={0.5}
                      value={lr}
                      onChange={(e) => setLr(Number(e.target.value) || 0.02)}
                      className="w-full px-3 py-2 rounded-xl font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                </div>

                {continueMode === 'exact_resume' && (
                  <div>
                    <label className="block text-[11px] font-bold text-[var(--app-text-secondary)] mb-1">
                      Trained Run to Exact-Resume
                    </label>
                    <select
                      value={selectedResumeRunId}
                      onChange={(e) => setSelectedResumeRunId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    >
                      <option value="">Select TRAINED run...</option>
                      {runs
                        .filter((r) => r.status === 'TRAINED' && r.checkpointLifecycle === 'TRAINED')
                        .map((r) => (
                          <option key={r.runId} value={r.runId}>
                            {r.runId} ({r.phaseLabel || r.datasetManifest?.datasetVersion} · steps={r.cumulativeTrainingSteps ?? r.trainingConfig?.steps})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {selectedPhaseId === 'phase_7_continuous_improvement' && harvestReport && (
                  <div className="p-3 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[var(--app-text-primary)] flex items-center gap-1.5">
                        <Wrench className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                        Phase 7 Real Error Harvester
                      </span>
                      <button
                        type="button"
                        disabled={harvestBusy}
                        onClick={() => void handleHarvestErrors()}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-50"
                      >
                        {harvestBusy ? 'Harvesting...' : 'Refresh Harvest'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono text-[var(--app-text-secondary)]">
                      <div>Exec failures: {harvestReport.sources?.actionFailures ?? 0}</div>
                      <div>Repairs: {harvestReport.sources?.actionRepairs ?? 0}</div>
                      <div>Eval failures: {harvestReport.sources?.evaluationFailures ?? 0}</div>
                      <div>Rejected runs: {harvestReport.sources?.pipelineRejections ?? 0}</div>
                    </div>
                    <div className="text-[11px] text-[var(--app-text-secondary)]">
                      Harvested traces: <b>{harvestReport.harvestedErrorSamples?.length ?? 0}</b> · Curated combined dataset:{' '}
                      <b>{harvestReport.combinedSamples?.length ?? 0}</b> samples (PII scrubbed: {harvestReport.privacyRedactedCount ?? 0})
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-[var(--app-text-secondary)] mb-1">
                    Optional Custom Corpus Samples (one sample per line ≥60 chars; leave blank to use Phase curated corpus)
                  </label>
                  <textarea
                    rows={3}
                    value={customCorpusText}
                    onChange={(e) => setCustomCorpusText(e.target.value)}
                    placeholder={
                      activePhase
                        ? `Using built-in ${activePhase.phase.curatedCorpus.length} curated sample(s) for ${activePhase.phase.id}...`
                        : 'Optional custom samples...'
                    }
                    className="w-full p-2.5 rounded-xl font-mono text-[11px] bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                  />
                </div>

                {/* Pre-Training 41,527,808-Parameter Checkpoint SHA-256 Gate Indicator */}
                <div
                  data-testid="pre-training-checkpoint-indicator"
                  className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                    baselineShaVerified
                      ? 'bg-[color-mix(in_srgb,var(--z-ok)_10%,var(--app-surface-elevated))] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)]'
                      : 'bg-[color-mix(in_srgb,var(--z-warn)_10%,var(--app-surface-elevated))] border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-[var(--app-text-primary)]">
                      {baselineShaVerified ? (
                        <ShieldCheck className="w-4 h-4 text-[var(--z-ok)] shrink-0" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-[var(--z-warn)] shrink-0" />
                      )}
                      <span>
                        {lang === 'th'
                          ? 'สถานะตรวจยืนยัน SHA-256 Checkpoint 41,527,808 พารามิเตอร์ก่อนฝึก'
                          : 'Pre-Training 41,527,808-Param Checkpoint SHA-256 Check'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        data-testid="pre-training-checkpoint-status"
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${
                          baselineShaVerified
                            ? 'text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)]'
                            : 'text-[var(--z-warn)] border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)]'
                        }`}
                      >
                        {baselineVerifying
                          ? 'VERIFYING'
                          : baselineVerification?.status || 'UNVERIFIED'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void verifyCheckpoint()}
                        disabled={baselineVerifying}
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--app-surface)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
                      >
                        {baselineVerifying ? 'Checking…' : 'Re-verify'}
                      </button>
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-[var(--app-text-secondary)] break-all">
                    {baselineVerificationError
                      ? baselineVerificationError
                      : baselineShaVerified
                        ? `Verified ${count(baselineVerification?.actualParams)} params · Baseline=${baselineVerification?.matchedBaselineLabel} · SHA-256 ${baselineVerification?.actualContainerSha256?.slice(0, 16)}…`
                        : baselineVerification?.reason ||
                          '41,527,808-parameter baseline checkpoint SHA-256 has not been verified yet.'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="text-[11px] font-mono text-[var(--app-text-secondary)]">
                    {continueMode === 'phase_continuation' && selectedCheckpointPath
                      ? `Continuing from: ${selectedCheckpointPath.split('/').pop()}`
                      : continueMode === 'exact_resume'
                      ? `Exact optimizer resume: ${selectedResumeRunId || 'none selected'}`
                      : 'Training fresh PureSeqLM graph'}
                  </div>
                  <button
                    type="button"
                    disabled={trainBusy || (continueMode === 'exact_resume' && !selectedResumeRunId)}
                    onClick={() => void handleRunPhaseTraining()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-[var(--app-bg)] hover:brightness-105 cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{trainBusy ? 'Training PureSeqLM...' : 'Execute Real Training & Verify'}</span>
                  </button>
                </div>
              </div>
            </VividCard>
          </div>

          {/* Pipeline Runs, Evaluation & Rollback Ledger */}
          <VividCard
            title={lang === 'th' ? 'ประวัติการฝึก หลักฐานการประเมิน และ Rollback' : 'Training Runs, Phase Verification & Governance'}
            subtitle="Every run preserves disjoint dataset hashes, weight mutation SHA-256, held-out NLL deltas, and verification gates."
            gradientAccent="cyan"
          >
            {runs.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--app-text-secondary)]">
                No Continuous Learning runs recorded yet for this tenant. Select a phase above and execute training.
              </div>
            ) : (
              <div className="space-y-3">
                {runs.slice(0, 10).map((run) => {
                  const busy = actionBusyRunId === run.runId;
                  const phaseEval = run.phaseEvaluation;
                  return (
                    <div
                      key={run.runId}
                      className="p-4 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <GitBranch className="w-4 h-4 text-[var(--app-accent)]" />
                          <span className="text-xs font-bold text-[var(--app-text-primary)]">
                            {run.phaseLabel || run.datasetManifest?.datasetVersion || run.runId}
                          </span>
                          <span className="text-[10px] font-mono text-[var(--app-text-secondary)]">
                            {run.runId}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge
                            status={
                              run.status === 'PROMOTED' || run.status === 'TRAINED'
                                ? 'VERIFIED'
                                : run.status.startsWith('REJECTED') || run.status === 'FAILED'
                                ? 'BLOCKED'
                                : 'UNVERIFIED'
                            }
                          />
                          <span className="text-[10px] font-mono font-bold text-[var(--app-text-secondary)]">
                            {run.status}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
                        <div className="p-2 rounded-lg bg-[var(--app-surface-elevated)]">
                          <span className="text-[10px] text-[var(--app-text-secondary)] block">Steps (Cumulative)</span>
                          <span className="font-bold text-[var(--app-text-primary)]">
                            {run.trainingConfig?.steps} ({run.cumulativeTrainingSteps ?? run.trainingConfig?.steps})
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-[var(--app-surface-elevated)]">
                          <span className="text-[10px] text-[var(--app-text-secondary)] block">Val NLL Before → After</span>
                          <span className="font-bold text-[var(--app-accent)]">
                            {run.baselineEval?.nll ?? '—'} → {run.candidateEval?.nll ?? '—'}
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-[var(--app-surface-elevated)]">
                          <span className="text-[10px] text-[var(--app-text-secondary)] block">Test NLL</span>
                          <span className="font-bold text-[var(--app-text-primary)]">
                            {run.baselineTestEval?.nll ?? '—'} → {run.candidateTestEval?.nll ?? '—'}
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-[var(--app-surface-elevated)]">
                          <span className="text-[10px] text-[var(--app-text-secondary)] block">Phase Verify</span>
                          <span className={`font-bold ${phaseEval?.status === 'PASS' ? 'text-[var(--z-ok)]' : 'text-[var(--app-text-secondary)]'}`}>
                            {phaseEval ? `${phaseEval.status} (${phaseEval.summary?.passed}/${phaseEval.summary?.total})` : 'NOT_RUN'}
                          </span>
                        </div>
                      </div>

                      {run.parameterDeltaSha256 && (
                        <div className="text-[10px] font-mono text-[var(--app-text-secondary)] break-all">
                          ΔW SHA-256: {run.parameterDeltaSha256.slice(0, 24)}… · Payload: {run.candidateCheckpointSha256?.slice(0, 16)}…
                        </div>
                      )}

                      {phaseEval?.checks && Array.isArray(phaseEval.checks) && (
                        <div className="flex flex-wrap gap-1.5">
                          {phaseEval.checks.map((chk: any) => (
                            <span
                              key={chk.id}
                              className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] flex items-center gap-1"
                              title={chk.detail}
                            >
                              <CheckCircle2
                                className={`w-3 h-3 ${chk.status === 'PASS' ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'}`}
                              />
                              {chk.id}: {chk.status}
                            </span>
                          ))}
                        </div>
                      )}

                      {run.candidateCheckpointPath && (() => {
                        const matchingReq = approvals.find(
                          (req) =>
                            req.actionType === 'MODEL_RELEASE' &&
                            req.resourceId === run.runId
                        );
                        return (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleInspectCheckpoint(run.candidateCheckpointPath)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-50"
                            >
                              Inspect Checkpoint
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleEvaluateRun(run.runId, 'phase')}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-50 flex items-center gap-1"
                            >
                              <Sparkles className="w-3 h-3 text-[var(--app-accent)]" />
                              Run Phase Verification
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleEvaluateRun(run.runId, 'domain')}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-50 flex items-center gap-1"
                            >
                              <Activity className="w-3 h-3" />
                              Domain Benchmark ({run.benchmarkStatus})
                            </button>
                            {run.status === 'TRAINED' && !matchingReq && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleRequestApproval(run.runId)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] cursor-pointer disabled:opacity-50 flex items-center gap-1"
                              >
                                <ShieldCheck className="w-3 h-3 text-[var(--z-ok)]" />
                                Request Release Approval
                              </button>
                            )}
                            {matchingReq && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono border border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                                Approval: {matchingReq.status}
                              </span>
                            )}
                            {role === 'Administrator' && matchingReq?.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleApprovalDecision(matchingReq.requestId, 'approve', run.runId)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-[var(--z-ok)] border border-[var(--z-ok)] cursor-pointer disabled:opacity-50"
                                >
                                  Approve Release
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleApprovalDecision(matchingReq.requestId, 'reject', run.runId)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-[var(--z-danger)] border border-[var(--z-danger)] cursor-pointer disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {role === 'Administrator' && matchingReq?.status === 'APPROVED' && run.status !== 'PROMOTED' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handlePromoteRun(run.runId)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-[var(--app-accent)] border border-[var(--app-accent)] cursor-pointer disabled:opacity-50"
                              >
                                Promote Release
                              </button>
                            )}
                            {role === 'Administrator' && (matchingReq?.status === 'APPROVED' || run.status === 'PROMOTED') && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handlePublishCloud(run.runId)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[var(--app-accent)] text-slate-950 cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                              >
                                <Cloud className="w-3 h-3" />
                                Publish to Cloud Storage
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}

            {backups.length > 0 && role === 'Administrator' && (
              <div className="mt-5 pt-4 border-t border-[var(--app-card-border)] space-y-2">
                <div className="text-xs font-bold text-[var(--app-text-primary)]">
                  Preserved Pre-Promotion Backups ({backups.length})
                </div>
                {backups.slice(0, 5).map((b) => (
                  <div
                    key={b.backupId}
                    className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-[11px] font-mono"
                  >
                    <span>
                      {b.backupId} · {b.reason} · SHA-256: {String(b.sha256 || '').slice(0, 12)}…
                    </span>
                    <button
                      type="button"
                      disabled={actionBusyRunId === b.backupId}
                      onClick={() => void handleRollback(b.backupId)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-[var(--z-warn)] border border-[var(--z-warn)] cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Rollback
                    </button>
                  </div>
                ))}
              </div>
            )}
          </VividCard>
        </>
      )}
    </div>
  );
};
