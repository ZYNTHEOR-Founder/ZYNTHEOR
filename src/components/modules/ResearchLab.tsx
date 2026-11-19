import React, { useCallback, useEffect, useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  Search,
  Network,
  CheckCircle2,
  Globe,
  Cpu,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  XCircle,
  Loader2,
  ExternalLink,
  LogIn,
} from 'lucide-react';

interface NativeNumpyEnvReport {
  status: 'NUMPY_NATIVE_READY' | 'NP_COMPAT_ONLY_BLOCKED' | 'PYTHON_UNAVAILABLE';
  pythonAvailable: boolean;
  pythonExecutable: string | null;
  pythonVersion: string | null;
  numpyAvailable: boolean;
  numpyVersion: string | null;
  numpyModuleFile: string | null;
  boto3Available?: boolean;
  boto3Version?: string | null;
  float32Verified: boolean;
  npCompatAvailable: boolean;
  pipAvailable: boolean;
  ensurepipAvailable: boolean;
  venvAvailable: boolean;
  trainTargetScriptPresent: boolean;
  configuredPythonBin: string | null;
  probeLatencyMs: number;
  error: string | null;
  remediationCommands: string[];
  checkedAt: string;
}

interface TrainingPipelineInitSnapshot {
  schemaVersion: string;
  pipelineId: string;
  initializedAt: string;
  trainingExecuted: false;
  canExecuteTraining: boolean;
  status: 'READY' | 'BLOCKED';
  numpyEnvironment: NativeNumpyEnvReport;
  config: {
    targetSteps: number;
    steps: number | null;
    evalEvery: number;
    saveEvery: number;
    batch: number;
    lr: number;
    weightDecay: number;
    tokenizerProfile: 'v2_base' | 'bilingual_v4';
    initCheckpoint: string;
    outCheckpoint: string;
    cloudObjectKey?: string;
    datasetFile: string | null;
    provenanceManifest: string;
    evidenceRoot: string;
    approvalKeyFile: string | null;
    humanApprovalConfirmed: boolean;
    allowFreshInit: boolean;
  };
  schedule: {
    startStep: number;
    targetSteps: number;
    plannedRunSteps: number;
    finalStep: number;
    evalEvery: number;
    saveEvery: number;
    evalCount: number;
    checkpointCount: number;
    milestones: Array<{
      kind: 'periodic_verification' | 'final_verification';
      localStep: number;
      globalStep: number;
      checks: string[];
    }>;
  };
  gates: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  blockers: string[];
  cliCommand: string;
  manifestPath: string;
}

interface TrainingLoopExecutionStatus {
  running: boolean;
  trainingCompletedVerified?: boolean;
  pid: number | null;
  pipelineId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  currentStep: number;
  targetSteps: number;
  evaluationsRecorded?: number;
  evalEvidencePath?: string | null;
  latestTrainLoss: number | null;
  latestValLoss: number | null;
  latestPerplexity?: number | null;
  latestGradNorm: number | null;
  latestLr: number | null;
  verifiedCheckpoints: Array<{
    globalStep: number;
    kind?: string;
    path: string;
    payloadSha256: string;
    containerSha256: string;
    verified?: boolean;
  }>;
  error: string | null;
}

export interface TrainingInitializerInput {
  targetSteps?: number;
  evalEvery?: number;
  saveEvery?: number;
  batch?: number;
  lr?: number;
  tokenizerProfile?: 'v2_base' | 'bilingual_v4';
  initCheckpoint?: string;
  outCheckpoint?: string;
  cloudObjectKey?: string;
  datasetFile?: string;
  provenanceManifest?: string;
  approvalKeyFile?: string;
  approvalRequestId?: string;
  humanApprovalConfirmed: boolean;
  allowFreshInit?: boolean;
  pythonBin?: string;
  execute?: boolean;
  headers?: Record<string, string>;
  fetcher?: typeof fetch;
}

export interface TrainingInitializerResult {
  initialized: boolean;
  executed: boolean;
  humanApprovalPassed: boolean;
  status: 'READY' | 'STARTED' | 'BLOCKED' | 'BLOCKED_HUMAN_APPROVAL' | 'FAILED';
  targetSteps: number;
  checkpointIntervalSteps: number;
  verificationCheckpointsPlanned: number;
  milestones: Array<{ localStep: number; globalStep: number; kind: 'periodic_verification' | 'final_verification' }>;
  snapshot: TrainingPipelineInitSnapshot | null;
  execution: TrainingLoopExecutionStatus | null;
  blockers: string[];
  error: string | null;
}

/**
 * Sets up the 5,800-step PureSeqLM training loop with verification checkpoints every 100 steps
 * and enforces the Human Approval gate fail-closed prior to any execution.
 */
export async function TrainingInitializer(
  input: TrainingInitializerInput
): Promise<TrainingInitializerResult> {
  const targetSteps = Math.max(1, Math.floor(input.targetSteps ?? 5800));
  const saveEvery = Math.max(1, Math.floor(input.saveEvery ?? 100));
  const evalEvery = Math.max(1, Math.floor(input.evalEvery ?? 25));
  const doFetch = input.fetcher || fetch;

  const milestones: TrainingInitializerResult['milestones'] = [];
  for (let step = saveEvery; step < targetSteps; step += saveEvery) {
    milestones.push({ localStep: step, globalStep: step, kind: 'periodic_verification' });
  }
  milestones.push({ localStep: targetSteps, globalStep: targetSteps, kind: 'final_verification' });

  const payload = {
    targetSteps,
    evalEvery,
    saveEvery,
    batch: input.batch ?? 2,
    lr: input.lr ?? 0.0003,
    tokenizerProfile: input.tokenizerProfile || 'v2_base',
    initCheckpoint: input.initCheckpoint?.trim() || undefined,
    outCheckpoint: input.outCheckpoint?.trim() || undefined,
    cloudObjectKey: input.cloudObjectKey?.trim() || undefined,
    datasetFile: input.datasetFile?.trim() || undefined,
    provenanceManifest: input.provenanceManifest?.trim() || undefined,
    approvalKeyFile: input.approvalKeyFile?.trim() || undefined,
    approvalRequestId: input.approvalRequestId?.trim() || undefined,
    humanApprovalConfirmed: Boolean(input.humanApprovalConfirmed),
    allowFreshInit: Boolean(input.allowFreshInit),
    pythonBin: input.pythonBin?.trim() || undefined,
  };

  let snapshot: TrainingPipelineInitSnapshot | null = null;
  let execution: TrainingLoopExecutionStatus | null = null;

  try {
    const initRes = await doFetch('/api/research/training-pipeline/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(input.headers || {}) },
      body: JSON.stringify(payload),
    });
    const initData = await initRes.json().catch(() => ({}));
    if (!initRes.ok || !initData?.success || !initData?.snapshot) {
      return {
        initialized: false,
        executed: false,
        humanApprovalPassed: false,
        status: 'FAILED',
        targetSteps,
        checkpointIntervalSteps: saveEvery,
        verificationCheckpointsPlanned: milestones.length,
        milestones,
        snapshot: null,
        execution: null,
        blockers: ['training_pipeline_init_failed'],
        error: initData?.error || `Initialize HTTP ${initRes.status}`,
      };
    }

    snapshot = initData.snapshot as TrainingPipelineInitSnapshot;
    execution = (initData.execution || null) as TrainingLoopExecutionStatus | null;

    const approvalGate = snapshot.gates.find((g) => g.id === 'human_approval');
    const humanApprovalPassed = Boolean(
      approvalGate ? approvalGate.passed : input.humanApprovalConfirmed
    );

    if (input.execute) {
      if (!humanApprovalPassed) {
        return {
          initialized: true,
          executed: false,
          humanApprovalPassed: false,
          status: 'BLOCKED_HUMAN_APPROVAL',
          targetSteps,
          checkpointIntervalSteps: saveEvery,
          verificationCheckpointsPlanned: snapshot.schedule.checkpointCount,
          milestones,
          snapshot,
          execution,
          blockers: Array.from(new Set([...snapshot.blockers, 'human_approval_confirmation_missing'])),
          error: 'FAIL_CLOSED: Human Approval gate must be confirmed before executing the 5,800-step training loop.',
        };
      }

      if (!snapshot.canExecuteTraining) {
        return {
          initialized: true,
          executed: false,
          humanApprovalPassed,
          status: 'BLOCKED',
          targetSteps,
          checkpointIntervalSteps: saveEvery,
          verificationCheckpointsPlanned: snapshot.schedule.checkpointCount,
          milestones,
          snapshot,
          execution,
          blockers: snapshot.blockers,
          error: `FAIL_CLOSED: Training execution blocked until all gates pass: ${snapshot.blockers.join(', ')}`,
        };
      }

      const startRes = await doFetch('/api/research/training-pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(input.headers || {}) },
        body: JSON.stringify(payload),
      });
      const startData = await startRes.json().catch(() => ({}));
      if (startData?.snapshot) snapshot = startData.snapshot as TrainingPipelineInitSnapshot;
      if (startData?.execution) execution = startData.execution as TrainingLoopExecutionStatus;

      const started = Boolean(startRes.ok && startData?.started);
      return {
        initialized: true,
        executed: started,
        humanApprovalPassed,
        status: started ? 'STARTED' : 'BLOCKED',
        targetSteps,
        checkpointIntervalSteps: saveEvery,
        verificationCheckpointsPlanned: snapshot.schedule.checkpointCount,
        milestones,
        snapshot,
        execution,
        blockers: snapshot.blockers,
        error: started ? null : startData?.error || 'Training loop blocked by readiness gates.',
      };
    }

    return {
      initialized: true,
      executed: false,
      humanApprovalPassed,
      status: snapshot.canExecuteTraining ? 'READY' : humanApprovalPassed ? 'BLOCKED' : 'BLOCKED_HUMAN_APPROVAL',
      targetSteps,
      checkpointIntervalSteps: saveEvery,
      verificationCheckpointsPlanned: snapshot.schedule.checkpointCount,
      milestones,
      snapshot,
      execution,
      blockers: snapshot.blockers,
      error: null,
    };
  } catch (err: any) {
    return {
      initialized: false,
      executed: false,
      humanApprovalPassed: false,
      status: 'FAILED',
      targetSteps,
      checkpointIntervalSteps: saveEvery,
      verificationCheckpointsPlanned: milestones.length,
      milestones,
      snapshot,
      execution,
      blockers: ['training_initializer_network_error'],
      error: err?.message || 'Unable to initialize 5,800-step training pipeline.',
    };
  }
}

interface ResearchLabProps {
  onOpenSignIn?: () => void;
}

export const ResearchLab: React.FC<ResearchLabProps> = ({ onOpenSignIn }) => {
  const { authHeaders, isAuthenticated, role } = useAuth();
  const { lang } = useLanguage();
  const th = lang === 'th';
  const isDevOrAdmin = role === 'Developer' || role === 'Administrator';
  const [researchTopic, setResearchTopic] = useState('Thai-English tokenizer and sequence-model evaluation');
  const [includeWeb, setIncludeWeb] = useState(false);
  const [activeTab, setActiveTab] = useState<'evidence' | 'numpy_pipeline' | 'graph' | 'report' | 'benchmarks'>('numpy_pipeline');
  const [isRunningBenchmarks, setIsRunningBenchmarks] = useState(false);
  const [benchmarkResults, setBenchmarkResults] = useState<any[] | null>(null);
  const [benchmarkMeta, setBenchmarkMeta] = useState<{ suiteStatus?: string; verified?: boolean; executedAt?: string } | null>(null);
  const [benchmarkError, setBenchmarkError] = useState('');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [nativeInspect, setNativeInspect] = useState<any>(null);
  const [investigation, setInvestigation] = useState<any>(null);
  const [investigateError, setInvestigateError] = useState('');

  // Grounded Knowledge & Readiness initial telemetry
  const [knowledgeStats, setKnowledgeStats] = useState<any>(null);
  const [graphSummary, setGraphSummary] = useState<{ nodes: number; edges: number } | null>(null);
  const [provenanceAudit, setProvenanceAudit] = useState<any>(null);
  const [readinessSnapshot, setReadinessSnapshot] = useState<any>(null);

  // Native NumPy & 5,800-Step Pipeline State
  const [numpyEnv, setNumpyEnv] = useState<NativeNumpyEnvReport | null>(null);
  const [customPythonBin, setCustomPythonBin] = useState('');
  const [envBusy, setEnvBusy] = useState(false);
  const [envActionMessage, setEnvActionMessage] = useState('');

  const [targetSteps, setTargetSteps] = useState(5800);
  const [evalEvery, setEvalEvery] = useState(25);
  const [saveEvery, setSaveEvery] = useState(100);
  const [batchSize, setBatchSize] = useState(2);
  const [learningRate, setLearningRate] = useState(0.0003);
  const [tokenizerProfile, setTokenizerProfile] = useState<'v2_base' | 'bilingual_v4'>('v2_base');
  const [initCheckpoint, setInitCheckpoint] = useState('native_data/model_checkpoint_target_41m.pt');
  const [outCheckpoint, setOutCheckpoint] = useState('native_data/model_checkpoint_target_41m_step5800.pt');
  const [cloudObjectKey, setCloudObjectKey] = useState('');
  const [datasetFile, setDatasetFile] = useState('native_data/datasets');
  const [provenanceManifest, setProvenanceManifest] = useState('artifacts/dataset-provenance-manifest.json');
  const [approvalKeyFile, setApprovalKeyFile] = useState('');
  const [approvalRequestId, setApprovalRequestId] = useState('');
  const [approvalRequests, setApprovalRequests] = useState<Array<any>>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);
  const [governanceNotice, setGovernanceNotice] = useState('');
  const [humanApprovalConfirmed, setHumanApprovalConfirmed] = useState(false);
  const [allowFreshInit, setAllowFreshInit] = useState(false);

  const [pipelineInitSnapshot, setPipelineInitSnapshot] = useState<TrainingPipelineInitSnapshot | null>(null);
  const [pipelineExecution, setPipelineExecution] = useState<TrainingLoopExecutionStatus | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [pipelineError, setPipelineError] = useState('');

  const loadWorkspaceTelemetry = useCallback(async () => {
    try {
      const headers = authHeaders();
      const canQueryProtectedKnowledge = isAuthenticated && Boolean(headers.Authorization);

      const readyPromise = fetch('/api/system/training-readiness', { cache: 'no-store' }).catch(() => null);
      const knowledgePromises = canQueryProtectedKnowledge
        ? [
            fetch('/api/knowledge/stats', { headers, cache: 'no-store' }).catch(() => null),
            fetch('/api/knowledge/graph', { headers, cache: 'no-store' }).catch(() => null),
            fetch('/api/knowledge/dataset-provenance-audit', { headers, cache: 'no-store' }).catch(() => null),
          ]
        : [Promise.resolve(null), Promise.resolve(null), Promise.resolve(null)];

      const [readyRes, statsRes, graphRes, provRes] = await Promise.all([
        readyPromise,
        ...knowledgePromises,
      ]);

      if (!canQueryProtectedKnowledge) {
        setKnowledgeStats(null);
        setGraphSummary(null);
        setProvenanceAudit(null);
      }

      if (statsRes?.ok) {
        const sJson = await statsRes.json().catch(() => null);
        if (sJson?.success) setKnowledgeStats(sJson.stats || sJson);
      }
      if (graphRes?.ok) {
        const gJson = await graphRes.json().catch(() => null);
        if (gJson?.success) {
          const nodes = Array.isArray(gJson.nodes)
            ? gJson.nodes.length
            : Number(gJson.nodeCount ?? gJson.stats?.nodes ?? (Array.isArray(gJson.topNodes) ? gJson.topNodes.length : 0));
          const edges = Number(
            gJson.kgEdgeCount ?? gJson.edgeCount ?? (Array.isArray(gJson.edges) ? gJson.edges.length : gJson.stats?.edges ?? 0)
          );
          setGraphSummary({ nodes, edges });
        }
      }
      if (provRes?.ok) {
        const pJson = await provRes.json().catch(() => null);
        if (pJson?.success) setProvenanceAudit(pJson);
      }
      if (readyRes?.ok) {
        const rJson = await readyRes.json().catch(() => null);
        if (rJson?.success) setReadinessSnapshot(rJson);
      }
    } catch {
      // Ignore transient telemetry fetch failure
    }
  }, [authHeaders, isAuthenticated]);

  const loadPipelineStatus = useCallback(async () => {
    if (!isAuthenticated || !isDevOrAdmin) return;
    try {
      const res = await fetch('/api/research/training-pipeline/status', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.numpy) setNumpyEnv(data.numpy as NativeNumpyEnvReport);
        if (data.initializedPipeline) setPipelineInitSnapshot(data.initializedPipeline as TrainingPipelineInitSnapshot);
        if (data.execution) setPipelineExecution(data.execution as TrainingLoopExecutionStatus);
      }
    } catch {
      // Ignore transient status fetch failure
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin]);

  const loadApprovals = useCallback(async () => {
    if (!isAuthenticated || !isDevOrAdmin) return;
    try {
      const res = await fetch('/api/governance/approvals', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && Array.isArray(data.requests)) {
        const trainingReqs = data.requests.filter(
          (r: any) =>
            (r.actionType === 'MODEL_RELEASE' || r.actionType === 'SYSTEM_CONFIG_MUTATION') &&
            (r.status === 'PENDING' || r.status === 'APPROVED')
        );
        setApprovalRequests(trainingReqs);
        if (!approvalRequestId) {
          const firstApproved = trainingReqs.find((r: any) => r.status === 'APPROVED');
          if (firstApproved) setApprovalRequestId(firstApproved.requestId);
        }
      }
    } catch {
      // Ignore transient approval list error
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin, approvalRequestId]);

  useEffect(() => {
    void loadWorkspaceTelemetry();
    void loadPipelineStatus();
    void loadApprovals();
  }, [loadWorkspaceTelemetry, loadPipelineStatus, loadApprovals]);

  useEffect(() => {
    if (!pipelineExecution?.running) return;
    const timer = window.setInterval(() => {
      void loadPipelineStatus();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [pipelineExecution?.running, loadPipelineStatus]);

  const handleEstablishNumpy = async (attemptInstall: boolean) => {
    if (!isAuthenticated || !isDevOrAdmin || envBusy) return;
    setEnvBusy(true);
    setEnvActionMessage('');
    setPipelineError('');
    try {
      const res = await fetch('/api/research/numpy-env/establish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          pythonBin: customPythonBin.trim() || undefined,
          attemptInstall,
        }),
      });
      const data = await res.json();
      if (data.report) setNumpyEnv(data.report as NativeNumpyEnvReport);
      setEnvActionMessage(
        data.established
          ? `Native NumPy ready: ${data.report?.numpyVersion} (${data.report?.pythonExecutable})`
          : data.error || 'Native NumPy environment is not available yet.'
      );
    } catch (err: any) {
      setEnvActionMessage(err?.message || 'Failed to probe Native NumPy environment.');
    } finally {
      setEnvBusy(false);
    }
  };

  const handleRequestTrainingApproval = async () => {
    if (!isAuthenticated || !isDevOrAdmin || approvalBusy) return;
    setApprovalBusy(true);
    setGovernanceNotice('');
    setPipelineError('');
    try {
      const res = await fetch('/api/governance/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          actionType: 'MODEL_RELEASE',
          resourceId: 'training_pipeline_5800',
          description: `Authorize 41,527,808-param NativeLM 5,800-step training (2,800 warm start + 3,000 continuation)`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && data?.request) {
        setApprovalRequestId(data.request.requestId);
        setGovernanceNotice(`ApprovalGate request created: ${data.request.requestId} (${data.request.status})`);
        await loadApprovals();
      } else {
        setPipelineError(data?.error || 'Failed to create ApprovalGate request.');
      }
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleApproveTrainingRequest = async (reqId: string) => {
    if (!isAuthenticated || role !== 'Administrator' || approvalBusy || !reqId) return;
    setApprovalBusy(true);
    setGovernanceNotice('');
    setPipelineError('');
    try {
      const res = await fetch(`/api/governance/approvals/${encodeURIComponent(reqId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ note: 'Administrator authorized 5,800-step NativeLM training execution' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && data?.request) {
        setApprovalRequestId(data.request.requestId);
        setHumanApprovalConfirmed(true);
        setGovernanceNotice(`ApprovalGate APPROVED by Admin: ${data.request.requestId}`);
        await loadApprovals();
      } else {
        setPipelineError(data?.error || 'Failed to approve ApprovalGate request.');
      }
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleSyncInitCheckpointToS3 = async () => {
    if (!isAuthenticated || role !== 'Administrator' || cloudSyncBusy) return;
    setCloudSyncBusy(true);
    setGovernanceNotice('');
    setPipelineError('');
    try {
      const res = await fetch('/api/storage/sync-init-checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          localPath: initCheckpoint,
          objectKey: cloudObjectKey.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && data?.uploaded) {
        setGovernanceNotice(
          `Synced 41.5M init checkpoint to ${data.uploaded.sourceUri} (SHA-256 ${String(data.uploaded.payloadSha256).slice(0, 12)}…)`
        );
      } else {
        setPipelineError(data?.error || 'Failed to sync initialization checkpoint to S3.');
      }
    } finally {
      setCloudSyncBusy(false);
    }
  };

  const handleVerifyProvenance = async () => {
    if (!isAuthenticated || !isDevOrAdmin || approvalBusy) return;
    setApprovalBusy(true);
    setGovernanceNotice('');
    setPipelineError('');
    try {
      const res = await fetch('/api/research/provenance/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ approvalKeyFile: approvalKeyFile.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      const rep = data?.report;
      if (rep) {
        setGovernanceNotice(
          `Provenance Verify: ${rep.status} (${rep.verified_documents ?? 0}/${rep.document_count ?? 0} verified)${
            Array.isArray(rep.issues) && rep.issues.length ? ` · ${rep.issues.join(', ')}` : ''
          }`
        );
      } else {
        setPipelineError(data?.error || 'Provenance verification failed.');
      }
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleInitializePipeline = async () => {
    if (!isAuthenticated || !isDevOrAdmin || initBusy) return;
    setInitBusy(true);
    setPipelineError('');
    try {
      const result = await TrainingInitializer({
        targetSteps,
        evalEvery,
        saveEvery,
        batch: batchSize,
        lr: learningRate,
        tokenizerProfile,
        initCheckpoint,
        outCheckpoint,
        cloudObjectKey,
        datasetFile,
        provenanceManifest,
        approvalKeyFile,
        approvalRequestId,
        humanApprovalConfirmed,
        allowFreshInit,
        pythonBin: customPythonBin,
        execute: false,
        headers: authHeaders(),
      });
      if (result.snapshot) {
        setPipelineInitSnapshot(result.snapshot);
        setNumpyEnv(result.snapshot.numpyEnvironment);
      }
      if (result.execution) setPipelineExecution(result.execution);
      if (!result.initialized && result.error) {
        setPipelineError(result.error);
      }
    } finally {
      setInitBusy(false);
    }
  };

  const handleStartTrainingLoop = async () => {
    if (!isAuthenticated || role !== 'Administrator' || startBusy) return;
    setStartBusy(true);
    setPipelineError('');
    try {
      const result = await TrainingInitializer({
        targetSteps,
        evalEvery,
        saveEvery,
        batch: batchSize,
        lr: learningRate,
        tokenizerProfile,
        initCheckpoint,
        outCheckpoint,
        cloudObjectKey,
        datasetFile,
        provenanceManifest,
        approvalKeyFile,
        approvalRequestId,
        humanApprovalConfirmed,
        allowFreshInit,
        pythonBin: customPythonBin,
        execute: true,
        headers: authHeaders(),
      });
      if (result.snapshot) setPipelineInitSnapshot(result.snapshot);
      if (result.execution) setPipelineExecution(result.execution);
      if (!result.executed && result.error) {
        setPipelineError(result.error);
      }
      await loadApprovals();
    } finally {
      setStartBusy(false);
    }
  };

  const evidenceItems = [
    {
      type: 'PARTIAL',
      title: 'Subword Tokenizer Roundtrip Consistency',
      evidence: 'Sovereign tokenizer encodes Thai + English 16k vocabulary; runtime roundtrip benchmark pending full corpus sweep.',
      source: 'qplus_native/tokenizer.py',
      confidence: 0,
    },
    {
      type: 'UNVERIFIED',
      title: 'Native Forward-Pass Numerical Stability',
      evidence: 'The active runtime numerical-stability benchmark has not been executed against a verified Cloud checkpoint.',
      source: 'qplus_native/model.py · Cloud Runtime evaluation pending',
      confidence: 0,
    },
    {
      type: 'UNVERIFIED',
      title: 'Quantization to 4-bit INT4 without Perplexity Loss',
      evidence: 'Preliminary tensor truncation hypothesis suggests memory reduction on edge devices.',
      source: 'Literature Review / Hypothesis',
      confidence: 0,
    },
    {
      type: 'HYPOTHESIS',
      title: 'Dynamic Multi-Head Pruning during Inference',
      evidence: 'Hypothesis that layers 7-9 can dynamically bypass attention heads on pure arithmetic queries.',
      source: 'Autonomous Research Engine',
      confidence: 0,
    },
  ];

  const verifiedAxiomsCount = investigation?.knowledgeHits?.results?.length || 0;
  const hypothesesCount = evidenceItems.filter((i) => i.type === 'HYPOTHESIS' || i.type === 'UNVERIFIED').length;
  const confidenceVal =
    typeof investigation?.reasoning?.calibratedConfidence === 'number'
      ? Math.round(investigation.reasoning.calibratedConfidence * 100)
      : null;

  const handleAnalyze = async () => {
    if (!researchTopic.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setInvestigateError('');
    try {
      const headers = { 'Content-Type': 'application/json', ...authHeaders() };
      const [invRes, inspRes] = await Promise.all([
        fetch('/api/research/investigate', {
          method: 'POST',
          headers,
          body: JSON.stringify({ query: researchTopic.trim(), includeWeb }),
        }),
        fetch('/api/model/inspect', { headers: authHeaders() }),
      ]);
      const invData = await invRes.json().catch(() => ({}));
      if (!invRes.ok || !invData.success) {
        throw new Error(invData.error || `Research investigation failed (HTTP ${invRes.status})`);
      }
      setInvestigation(invData);
      if (inspRes.ok) {
        const inspData = await inspRes.json().catch(() => null);
        if (inspData?.success) setNativeInspect(inspData);
      }
    } catch (err: any) {
      setInvestigateError(err?.message || 'Unable to execute research investigation.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRunBenchmarks = async () => {
    if (isRunningBenchmarks) return;
    setIsRunningBenchmarks(true);
    setBenchmarkError('');
    try {
      const res = await fetch('/api/verify/language-integrity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Language integrity check failed (HTTP ${res.status})`);
      }
      const suite = data.suite;
      const results = Array.isArray(suite?.results)
        ? suite.results
        : Array.isArray(data.results)
        ? data.results
        : null;
      if (!results) {
        throw new Error('Benchmark endpoint returned no suite results.');
      }
      setBenchmarkResults(results);
      setBenchmarkMeta({
        suiteStatus: suite?.overall_status || (suite?.verified ? 'PASS' : 'BLOCKED'),
        verified: Boolean(suite?.verified),
        executedAt: suite?.executed_at || new Date().toISOString(),
      });
    } catch (err: any) {
      setBenchmarkError(err?.message || 'Unable to execute live language integrity suite.');
    } finally {
      setIsRunningBenchmarks(false);
    }
  };

  const knowledgeResults: any[] = investigation?.knowledgeHits?.results || [];
  const graphPaths: any[] = investigation?.graphPaths?.paths || [];
  const webResearch = investigation?.webResearch || null;
  const webItems: any[] = Array.isArray(webResearch?.items) ? webResearch.items : [];
  const effectiveNumpyReady =
    numpyEnv?.numpyAvailable ?? Boolean(readinessSnapshot?.pythonBackend?.numpyAvailable);
  const effectiveNumpyVersion =
    numpyEnv?.numpyVersion ?? readinessSnapshot?.pythonBackend?.numpyVersion ?? null;
  const effectiveDocCount = knowledgeStats?.totalDocuments ?? null;

  return (
    <div className="space-y-8">
      <VividCard gradientAccent="cyan" className="!p-5 sm:!p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="w-full md:w-2/3">
            <h2 className="text-lg sm:text-xl font-semibold text-[var(--app-text-primary)]">
              {th ? 'ห้องปฏิบัติการวิจัยและฝึกโมเดล (Research Lab)' : 'Intelligence Research Lab'}
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1 leading-relaxed">
              {th
                ? 'ค้นหาความรู้แบบมีหลักฐานอ้างอิง ตั้งค่า Native NumPy ตรวจสอบ Pipeline ฝึก 5,800 รอบ และประเมิน Tokenizer ไทย-อังกฤษ'
                : 'Grounded Knowledge Workspace retrieval, Native NumPy backend initialization, 5,800-step verification pipeline, and adaptive reasoning.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="text"
                value={researchTopic}
                onChange={(e) => setResearchTopic(e.target.value)}
                placeholder={th ? 'ระบุหัวข้อวิจัยหรือคำถามเพื่อค้นคว้า...' : 'Enter AI research inquiry...'}
                className="flex-1 min-w-[200px] min-h-[42px] px-3.5 py-2 text-xs bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-lg focus:outline-none focus:border-[var(--app-accent)] font-medium text-[var(--app-text-primary)]"
              />
              <label className="inline-flex items-center gap-1.5 min-h-[42px] px-3 py-2 text-xs rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeWeb}
                  onChange={(e) => setIncludeWeb(e.target.checked)}
                />
                <Globe className="w-3.5 h-3.5" />
                <span>{th ? 'รวมผลจากเว็บ' : 'Include Web'}</span>
              </label>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing || !isAuthenticated}
                className="min-h-[42px] px-4 py-2 text-xs font-semibold text-white bg-[var(--app-accent-deep)] rounded-lg hover:opacity-95 transition-opacity cursor-pointer flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                {isAnalyzing ? (th ? 'กำลังค้นคว้า...' : 'Investigating...') : (th ? 'สืบค้นวิจัย' : 'Investigate')}
              </button>
            </div>
            {(!isAuthenticated || !isDevOrAdmin) && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-mono text-[var(--app-amber)]">
                <span>
                  {th
                    ? 'เข้าสู่ระบบสิทธิ์ Developer หรือ Admin เพื่อใช้ /api/research/investigate และตรวจสอบ NumPy Pipeline'
                    : 'Sign in as Developer or Admin to run /api/research/investigate & NumPy pipeline diagnostics'}
                </span>
                {onOpenSignIn && (
                  <button
                    type="button"
                    onClick={onOpenSignIn}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--app-amber)] text-[var(--app-amber)] hover:bg-[color-mix(in_srgb,var(--app-amber)_12%,transparent)] font-sans font-semibold cursor-pointer"
                  >
                    <LogIn className="w-3 h-3" />
                    <span>{th ? 'เข้าสู่ระบบ' : 'Sign in'}</span>
                  </button>
                )}
              </div>
            )}
            {investigateError && (
              <div className="mt-2 text-[11px] font-mono text-[var(--z-danger)]">{investigateError}</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] font-mono text-[var(--app-text-secondary)]">
              <span>{th ? 'เอกสาร:' : 'Docs:'} {effectiveDocCount !== null ? effectiveDocCount : '—'}</span>
              <span>·</span>
              <span>
                {th ? 'กราฟ:' : 'Graph:'}{' '}
                {graphSummary
                  ? th
                    ? `${graphSummary.nodes} โหนด / ${graphSummary.edges} เส้นเชื่อม`
                    : `${graphSummary.nodes} nodes / ${graphSummary.edges} edges`
                  : '—'}
              </span>
              <span>·</span>
              <span>Provenance: {provenanceAudit?.status || 'UNVERIFIED'}</span>
            </div>
            {nativeInspect && (
              <div className="mt-1.5 text-[11px] font-mono text-[var(--z-ok)]">
                Cloud Runtime checkpoint: {nativeInspect.total_params?.toLocaleString() || '—'} {th ? 'พารามิเตอร์' : 'active parameters'} · {th ? 'สถานะ:' : 'Status:'} {nativeInspect.status || 'UNVERIFIED'}
              </div>
            )}
          </div>

          <div className="flex gap-4 border-t md:border-t-0 md:border-l border-[var(--app-card-border)] pt-4 md:pt-0 md:pl-6 w-full md:w-1/3 justify-between tabular-nums">
            <div>
              <div className="text-[11px] font-semibold text-[var(--app-text-secondary)]">Native NumPy</div>
              <div
                className={`text-base sm:text-lg font-semibold font-mono ${
                  effectiveNumpyReady ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'
                }`}
              >
                {effectiveNumpyReady ? `v${effectiveNumpyVersion}` : 'BLOCKED'}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[var(--app-text-secondary)]">
                {th ? 'หลักฐานที่พบ' : 'Grounded Hits'}
              </div>
              <div className="text-xl sm:text-2xl font-semibold font-mono text-[var(--z-ok)]">{verifiedAxiomsCount}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[var(--app-text-secondary)]">
                {th ? 'ความเชื่อมั่น' : 'Confidence'}
              </div>
              <div className="text-xl sm:text-2xl font-semibold font-mono text-[var(--app-text-primary)]">
                {confidenceVal !== null ? `${confidenceVal}%` : '—'}
              </div>
            </div>
          </div>
        </div>
      </VividCard>

      {investigation && (
        <VividCard
          title={th ? 'ผลการสืบค้นวิจัยล่าสุด' : 'Live Research Investigation Findings'}
          subtitle={`Verifier: ${investigation.reasoning?.verifierAttribution || 'adaptive_reasoning'} · Native reasoning pipeline`}
          gradientAccent="cyan"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] leading-relaxed text-[var(--app-text-primary)]">
              {investigation.reasoning?.answerSummary || (th ? 'ยังไม่มีสรุปที่อ้างอิงหลักฐานได้' : 'No grounded summary produced.')}
            </div>

            {knowledgeResults.length > 0 && (
              <div className="space-y-2">
                <div className="font-semibold text-[var(--app-text-secondary)]">
                  {th
                    ? `การอ้างอิงจาก Knowledge Workspace (${knowledgeResults.length})`
                    : `Grounded Knowledge Workspace Citations (${knowledgeResults.length})`}
                </div>
                {knowledgeResults.map((r: any, idx: number) => (
                  <div key={idx} className="p-3 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)]">
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                      <span className="font-semibold text-[var(--app-accent)] truncate">{r.documentTitle}</span>
                      <span className="tabular-nums text-[var(--app-text-secondary)] shrink-0">score {r.score}</span>
                    </div>
                    <p className="mt-1 text-[var(--app-text-secondary)]">{r.citation?.snippet || r.text}</p>
                    {(r.contentHash || r.citation?.contentHash) && (
                      <div className="mt-1.5 font-mono text-[10px] text-[var(--app-text-secondary)] break-all">
                        SHA-256: {r.contentHash || r.citation?.contentHash}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {webResearch && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--app-text-secondary)]">
                    {th ? `ผลตรวจจากเว็บจริง (${webItems.length})` : `Live Web Verification (${webItems.length})`}
                  </span>
                  <StatusDot status={webResearch.ok ? 'VERIFIED' : webResearch.status || 'BLOCKED'} />
                </div>
                {webResearch.ok === false ? (
                  <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_8%,var(--app-surface))] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] font-mono text-[11px] text-[var(--z-danger)]">
                    {webResearch.error || (th ? 'ไม่สามารถค้นเว็บจริงได้ในขณะนี้' : 'Live web research unavailable or blocked by connectivity.')}
                  </div>
                ) : webItems.length === 0 ? (
                  <div className="text-[11px] text-[var(--app-text-secondary)]">
                    {th ? 'การค้นหาเว็บสำเร็จ แต่ไม่พบการอ้างอิงภายนอก' : 'Web lookup succeeded with 0 external citations for this query.'}
                  </div>
                ) : (
                  webItems.map((item: any, idx: number) => {
                    const href = typeof item.url === 'string' && /^https?:\/\//i.test(item.url) ? item.url : null;
                    return (
                      <div key={idx} className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                          <span className="font-semibold text-[var(--app-text-primary)] truncate">
                            {item.source || 'Web Source'} · {item.title || 'External Result'}
                          </span>
                          {href && (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[var(--app-accent)] hover:underline shrink-0"
                            >
                              <span>{th ? 'แหล่งที่มา' : 'Source'}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        {item.snippet && <p className="text-[var(--app-text-secondary)]">{item.snippet}</p>}
                        {item.contentHash && (
                          <div className="font-mono text-[10px] text-[var(--app-text-secondary)] break-all">
                            Digest: {item.contentHash}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </VividCard>
      )}

      <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap border-b border-[var(--app-card-border)] pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('numpy_pipeline')}
          className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeTab === 'numpy_pipeline'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          {th ? 'Native NumPy & Pipeline 5,800 รอบ' : 'Native NumPy & 5,800-Step Pipeline'}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('evidence')}
          className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeTab === 'evidence'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          {th ? `จำแนกหลักฐาน (${evidenceItems.length})` : `Evidence Classification (${evidenceItems.length})`}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('graph')}
          className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeTab === 'graph'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          {th ? `เส้นทาง Knowledge Graph (${graphPaths.length})` : `Knowledge Graph Paths (${graphPaths.length})`}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('report')}
          className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeTab === 'report'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          {th ? 'สรุปรายงานวิจัย' : 'Research Briefing'}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('benchmarks')}
          className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeTab === 'benchmarks'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          {th ? 'ทดสอบ Benchmark ไทย-อังกฤษ' : 'Language Benchmarks'}
        </button>
      </div>

      {activeTab === 'numpy_pipeline' && (
        <div className="space-y-6">
          <VividCard
            title={th ? 'สภาพแวดล้อม Native NumPy Backend' : 'Native NumPy Backend Environment'}
            subtitle={
              th
                ? 'ต้องใช้ C-extension NumPy ที่รองรับ float32 จริง (ไม่อนุญาต fallback np_compat สำหรับการฝึก 41.5M)'
                : 'Requires real C-extension NumPy with verified float32 tensors (pure-Python np_compat fallback is strictly blocked for 41.5M training)'
            }
            gradientAccent="cyan"
          >
            {!isAuthenticated || !isDevOrAdmin ? (
              <div className="flex items-start gap-2.5 text-xs text-[var(--app-text-secondary)]">
                <ShieldAlert className="w-4 h-4 text-[var(--z-warn)] shrink-0 mt-0.5" />
                <span>
                  {th
                    ? 'เข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator เพื่อตรวจหรือเชื่อมสภาพแวดล้อม Native NumPy'
                    : 'Sign in with Developer or Administrator role in Settings to inspect or bind the Native NumPy environment.'}
                </span>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums text-[11px]">
                  <div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">
                      {th ? 'สถานะ Backend' : 'Backend State'}
                    </div>
                    <div
                      className={`mt-0.5 font-bold ${
                        numpyEnv?.numpyAvailable ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'
                      }`}
                    >
                      {numpyEnv?.status || 'UNPROBED'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Python Runtime</div>
                    <div className="mt-0.5 font-semibold text-[var(--app-text-primary)] truncate">
                      {numpyEnv?.pythonVersion ? `Python ${numpyEnv.pythonVersion}` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">NumPy / Float32</div>
                    <div className="mt-0.5 font-semibold text-[var(--app-text-primary)]">
                      {numpyEnv?.numpyAvailable
                        ? `v${numpyEnv.numpyVersion} · float32 OK`
                        : numpyEnv?.npCompatAvailable
                        ? 'MISSING (np_compat only)'
                        : 'MISSING'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">
                      {th ? 'ไลบรารีที่จำเป็น' : 'Dependencies'}
                    </div>
                    <div className="mt-0.5 font-semibold text-[var(--app-text-primary)]">
                      boto3: {numpyEnv?.boto3Available ? `v${numpyEnv.boto3Version || 'yes'}` : 'no'} · pip: {numpyEnv?.pipAvailable ? 'yes' : 'no'} · venv: {numpyEnv?.venvAvailable ? 'yes' : 'no'}
                    </div>
                  </div>
                </div>

                {numpyEnv?.pythonExecutable && (
                  <div className="text-[11px] font-mono text-[var(--app-text-secondary)] break-all">
                    Executable: {numpyEnv.pythonExecutable}
                    {numpyEnv.numpyModuleFile ? ` · NumPy module: ${numpyEnv.numpyModuleFile}` : ''}
                  </div>
                )}

                {numpyEnv?.error && (
                  <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_8%,var(--app-surface))] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] font-mono text-[11px] text-[var(--z-danger)] space-y-1.5">
                    <div>{numpyEnv.error}</div>
                    {numpyEnv.remediationCommands.length > 0 && (
                      <ul className="list-disc list-inside text-[var(--app-text-secondary)] space-y-0.5">
                        {numpyEnv.remediationCommands.map((cmd, i) => (
                          <li key={i}>{cmd}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={customPythonBin}
                    onChange={(e) => setCustomPythonBin(e.target.value)}
                    placeholder={
                      th
                        ? 'ระบุพาธ Python virtualenv (ไม่บังคับ เช่น /path/to/.venv/bin/python3)'
                        : 'Optional Python virtualenv executable (/path/to/.venv/bin/python3)'
                    }
                    className="flex-1 px-3 py-2 rounded-lg font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                  />
                  <button
                    type="button"
                    data-testid="probe-numpy-btn"
                    disabled={envBusy}
                    onClick={() => void handleEstablishNumpy(false)}
                    className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                  >
                    {envBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    <span>{th ? 'ตรวจ / ผูก Python' : 'Probe / Bind Python'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="establish-numpy-btn"
                    disabled={envBusy}
                    onClick={() => void handleEstablishNumpy(true)}
                    className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-[var(--app-accent-deep)] text-white cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    <span>{th ? 'ติดตั้ง/ตั้งค่า NumPy' : 'Establish NumPy Env'}</span>
                  </button>
                </div>

                {envActionMessage && (
                  <div className="text-[11px] font-mono text-[var(--app-text-primary)]">{envActionMessage}</div>
                )}
              </div>
            )}
          </VividCard>

          <VividCard
            title={th ? 'ตัวเตรียมและตรวจสอบ Pipeline ฝึก 5,800 รอบ' : '5,800-Step Training Pipeline Initializer & Verification Checkpoints'}
            subtitle={
              th
                ? 'ตรวจความพร้อมของ PureSeqLM 5,800 รอบ และรอบบันทึก Checkpoint (การฝึกจะถูกบล็อกจนกว่า NumPy, Dataset, Provenance และ Human Approval จะผ่านทั้งหมด)'
                : 'Prepares and verifies the 5,800-step PureSeqLM loop and verification checkpoints. Training execution remains blocked until NumPy, Dataset, Provenance, and Human Approval all pass.'
            }
            gradientAccent="emerald"
          >
            {!isAuthenticated || !isDevOrAdmin ? (
              <div className="text-xs text-[var(--app-text-secondary)]">
                {th
                  ? 'ต้องเข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator เพื่อตั้งค่าและตรวจ Pipeline 5,800 รอบ'
                  : 'Developer or Administrator sign-in required to configure and verify the 5,800-step pipeline.'}
              </div>
            ) : (
              <div className="space-y-5 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">
                      {th ? 'จำนวน Step เป้าหมาย' : 'Target Steps'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50000}
                      value={targetSteps}
                      onChange={(e) => setTargetSteps(Math.max(1, Number(e.target.value) || 5800))}
                      className="w-full px-3 py-2 rounded-lg font-mono tabular-nums bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">
                      {th ? 'บันทึก Checkpoint ทุก' : 'Verify Checkpoint Every'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      value={saveEvery}
                      onChange={(e) => setSaveEvery(Math.max(1, Number(e.target.value) || 100))}
                      className="w-full px-3 py-2 rounded-lg font-mono tabular-nums bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">
                      {th ? 'ประเมินผลทุก' : 'Eval Every'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      value={evalEvery}
                      onChange={(e) => setEvalEvery(Math.max(1, Number(e.target.value) || 25))}
                      className="w-full px-3 py-2 rounded-lg font-mono tabular-nums bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">Batch Size</label>
                    <input
                      type="number"
                      min={1}
                      max={32}
                      value={batchSize}
                      onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value) || 2))}
                      className="w-full px-3 py-2 rounded-lg font-mono tabular-nums bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">Learning Rate</label>
                    <input
                      type="number"
                      step="0.0001"
                      min={0.00001}
                      max={0.1}
                      value={learningRate}
                      onChange={(e) => setLearningRate(Number(e.target.value) || 0.0003)}
                      className="w-full px-3 py-2 rounded-lg font-mono tabular-nums bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">Tokenizer Profile</label>
                    <select
                      value={tokenizerProfile}
                      onChange={(e) => setTokenizerProfile(e.target.value === 'bilingual_v4' ? 'bilingual_v4' : 'v2_base')}
                      className="w-full px-3 py-2 rounded-lg font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    >
                      <option value="v2_base">v2_base (locked)</option>
                      <option value="bilingual_v4">bilingual_v4</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">
                      {th ? 'ไฟล์ Checkpoint เริ่มต้น (ไม่เขียนทับต้นฉบับ)' : 'Init Checkpoint Path (Never Overwritten)'}
                    </label>
                    <input
                      type="text"
                      value={initCheckpoint}
                      onChange={(e) => setInitCheckpoint(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">
                      {th ? 'พาธบันทึก Checkpoint ผลลัพธ์ (Step 5800)' : 'Output Step-5800 Checkpoint Path'}
                    </label>
                    <input
                      type="text"
                      value={outCheckpoint}
                      onChange={(e) => setOutCheckpoint(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">
                      {th ? 'ชุดข้อมูลที่ผ่านการตรวจ (Splits / JSONL)' : 'Verified Dataset Splits / JSONL'}
                    </label>
                    <input
                      type="text"
                      value={datasetFile}
                      onChange={(e) => setDatasetFile(e.target.value)}
                      placeholder="native_data/datasets"
                      className="w-full px-3 py-2 rounded-lg font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">
                      Provenance Manifest &amp; HMAC Approval Key
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={provenanceManifest}
                        onChange={(e) => setProvenanceManifest(e.target.value)}
                        className="w-1/2 px-3 py-2 rounded-lg font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                      />
                      <input
                        type="text"
                        value={approvalKeyFile}
                        onChange={(e) => setApprovalKeyFile(e.target.value)}
                        placeholder="ZYNTHEOR_APPROVAL_KEY_FILE"
                        className="w-1/2 px-3 py-2 rounded-lg font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                      />
                    </div>
                  </div>
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">
                        {th
                          ? 'AWS S3 Checkpoint Object Key (ไม่บังคับ — override ค่า S3_CHECKPOINT_KEY)'
                          : 'AWS S3 Checkpoint Object Key (Cloud Preflight Target — optional override for S3_CHECKPOINT_KEY)'}
                      </label>
                      <input
                        type="text"
                        value={cloudObjectKey}
                        onChange={(e) => setCloudObjectKey(e.target.value)}
                        placeholder="checkpoints/model_checkpoint.pt (leave empty to use S3_CHECKPOINT_KEY)"
                        className="w-full px-3 py-2 rounded-lg font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">
                        {th ? 'ApprovalGate Request ID (การอนุมัติจากผู้ดูแล)' : 'ApprovalGate Request ID (Human Governance Sign-Off)'}
                      </label>
                      <div className="flex flex-wrap sm:flex-nowrap gap-2">
                        <select
                          value={approvalRequestId}
                          onChange={(e) => setApprovalRequestId(e.target.value)}
                          className="flex-1 min-w-0 px-3 py-2 rounded-lg font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                        >
                          <option value="">
                            {th ? 'ใช้การติ๊กยืนยันด้วยตนเอง (หรือเลือก ApprovalGate)' : 'Manual checkbox only (or select ApprovalGate)'}
                          </option>
                          {approvalRequests.map((r) => (
                            <option key={r.requestId} value={r.requestId}>
                              {r.requestId} · {r.status} ({r.resourceId})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={approvalBusy}
                          onClick={() => void handleRequestTrainingApproval()}
                          className="px-3 py-2 rounded-lg text-[11px] font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          {th ? 'ขออนุมัติ' : 'Request Approval'}
                        </button>
                        {role === 'Administrator' &&
                          approvalRequestId &&
                          approvalRequests.find((r) => r.requestId === approvalRequestId)?.status === 'PENDING' && (
                            <button
                              type="button"
                              disabled={approvalBusy}
                              onClick={() => void handleApproveTrainingRequest(approvalRequestId)}
                              className="px-3 py-2 rounded-lg text-[11px] font-semibold bg-[var(--app-accent-deep)] text-white cursor-pointer disabled:opacity-50 whitespace-nowrap"
                            >
                              {th ? 'อนุมัติ (Admin)' : 'Admin Approve'}
                            </button>
                          )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--app-text-primary)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={humanApprovalConfirmed}
                        onChange={(e) => setHumanApprovalConfirmed(e.target.checked)}
                      />
                      <span>{th ? 'ยืนยันการอนุมัติโดยมนุษย์แล้ว (Human Approval)' : 'Explicit Human Approval Confirmed'}</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--app-text-secondary)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowFreshInit}
                        onChange={(e) => setAllowFreshInit(e.target.checked)}
                      />
                      <span>{th ? 'อนุญาต Fresh Init (กรณีไม่มีไฟล์ .pt ตั้งต้น)' : 'Allow Fresh Init (no baseline .pt)'}</span>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={approvalBusy}
                      onClick={() => void handleVerifyProvenance()}
                      className="px-3 py-2 rounded-lg text-xs font-medium border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
                    >
                      {th ? 'ตรวจ HMAC Provenance' : 'Verify Provenance HMAC'}
                    </button>
                    {role === 'Administrator' && (
                      <button
                        type="button"
                        disabled={cloudSyncBusy}
                        onClick={() => void handleSyncInitCheckpointToS3()}
                        className="px-3 py-2 rounded-lg text-xs font-medium border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
                      >
                        {cloudSyncBusy ? (th ? 'กำลังซิงค์…' : 'Syncing…') : 'Sync Init .pt → S3'}
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="init-5800-pipeline-btn"
                      disabled={initBusy}
                      onClick={() => void handleInitializePipeline()}
                      className="px-4 py-2 rounded-lg text-xs font-semibold border border-[var(--app-accent)] text-[var(--app-accent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {initBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      <span>{th ? 'เตรียม Pipeline 5,800 รอบ' : 'Initialize 5,800-Step Pipeline'}</span>
                    </button>
                    {role === 'Administrator' && (
                      <button
                        type="button"
                        data-testid="start-5800-loop-btn"
                        disabled={
                          startBusy ||
                          Boolean(pipelineExecution?.running) ||
                          !pipelineInitSnapshot?.canExecuteTraining
                        }
                        onClick={() => void handleStartTrainingLoop()}
                        className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--app-accent-deep)] text-white cursor-pointer disabled:opacity-40 inline-flex items-center gap-1.5"
                        title={
                          pipelineInitSnapshot?.canExecuteTraining
                            ? th
                              ? 'ผ่านเงื่อนไขธรรมาภิบาล ชุดข้อมูล NumPy และการอนุมัติครบถ้วน'
                              : 'All governance, dataset, NumPy, and approval gates passed'
                            : th
                            ? 'ถูกบล็อกจนกว่าการเตรียม Pipeline 5,800 รอบจะสถานะ READY โดยไม่มีตัวบล็อก'
                            : 'Blocked until Initialize 5,800-Step Pipeline reports READY with zero blockers'
                        }
                      >
                        {startBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                        <span>
                          {pipelineExecution?.running
                            ? th
                              ? 'กำลังฝึกโมเดล…'
                              : 'Training Running…'
                            : th
                            ? 'เริ่มฝึก 5,800 รอบ'
                            : 'Start 5,800-Step Loop'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {governanceNotice && (
                  <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_8%,var(--app-surface))] border border-[color-mix(in_srgb,var(--app-accent)_35%,transparent)] font-mono text-[11px] text-[var(--app-text-primary)]">
                    {governanceNotice}
                  </div>
                )}

                {pipelineError && (
                  <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_8%,var(--app-surface))] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] font-mono text-[11px] text-[var(--z-danger)]">
                    {pipelineError}
                  </div>
                )}

                {pipelineInitSnapshot && (
                  <div className="space-y-4 pt-2 border-t border-[var(--app-card-border)]">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                      <div className="flex items-center gap-2">
                        {pipelineInitSnapshot.canExecuteTraining ? (
                          <CheckCircle2 className="w-4 h-4 text-[var(--z-ok)]" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-[var(--z-warn)]" />
                        )}
                        <span className="font-semibold text-[var(--app-text-primary)]">
                          Pipeline {pipelineInitSnapshot.pipelineId} · {pipelineInitSnapshot.status}
                        </span>
                      </div>
                      <span className="tabular-nums text-[var(--app-text-secondary)]">
                        {pipelineInitSnapshot.schedule.plannedRunSteps.toLocaleString()} steps ·{' '}
                        {pipelineInitSnapshot.schedule.checkpointCount} checkpoints (every {pipelineInitSnapshot.schedule.saveEvery}) ·{' '}
                        {pipelineInitSnapshot.schedule.evalCount} evals
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {pipelineInitSnapshot.gates.map((g) => (
                        <div
                          key={g.id}
                          className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1"
                        >
                          <div className="flex items-center gap-1.5 font-semibold text-[var(--app-text-primary)]">
                            {g.passed ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--z-ok)] shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-[var(--z-danger)] shrink-0" />
                            )}
                            <span className="truncate">{g.label}</span>
                          </div>
                          <div className="text-[11px] font-mono text-[var(--app-text-secondary)] break-words">
                            {g.detail}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] font-mono text-[11px] space-y-1.5">
                      <div className="font-semibold text-[var(--app-text-primary)]">
                        {th
                          ? 'กำหนดการตรวจ Checkpoint (6 จุดแรกและจุดสุดท้าย)'
                          : 'Verification Checkpoint Schedule (First 6 & Final Milestone)'}
                      </div>
                      <div className="text-[var(--app-text-secondary)]">
                        {[
                          ...pipelineInitSnapshot.schedule.milestones.slice(0, 6),
                          ...(pipelineInitSnapshot.schedule.milestones.length > 6
                            ? [pipelineInitSnapshot.schedule.milestones[pipelineInitSnapshot.schedule.milestones.length - 1]]
                            : []),
                        ]
                          .map((m) => `step ${m.globalStep} (${m.kind === 'final_verification' ? 'FINAL+41.5M' : 'SHA-256'})`)
                          .join(' → ')}
                      </div>
                      <div className="flex items-start gap-2 pt-1 text-[var(--app-text-secondary)] break-all">
                        <Terminal className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--app-accent)]" />
                        <span>{pipelineInitSnapshot.cliCommand}</span>
                      </div>
                    </div>
                  </div>
                )}

                {pipelineExecution && (pipelineExecution.running || pipelineExecution.startedAt) && (
                  <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] font-mono text-[11px] space-y-1.5">
                    <div className="font-semibold text-[var(--app-text-primary)]">
                      {th ? 'สถานะการรัน:' : 'Execution Status:'}{' '}
                      {pipelineExecution.running
                        ? `RUNNING (PID ${pipelineExecution.pid})`
                        : pipelineExecution.trainingCompletedVerified && pipelineExecution.exitCode === 0
                        ? 'TRAINING COMPLETED (VERIFIED)'
                        : `EXITED (${pipelineExecution.exitCode ?? '—'}) · NOT VERIFIED`}{' '}
                      · Step {pipelineExecution.currentStep}/{pipelineExecution.targetSteps}
                    </div>
                    <div className="text-[var(--app-text-secondary)] tabular-nums">
                      Persisted Evals: {pipelineExecution.evaluationsRecorded ?? 0} · Verified Checkpoints:{' '}
                      {pipelineExecution.verifiedCheckpoints.filter((c) => c.verified !== false).length}
                      {pipelineExecution.evalEvidencePath ? ` · Evidence: ${pipelineExecution.evalEvidencePath}` : ''}
                    </div>
                    {pipelineExecution.latestValLoss !== null && (
                      <div className="text-[var(--app-text-secondary)] tabular-nums">
                        train_loss={pipelineExecution.latestTrainLoss?.toFixed(4)} · val_loss={pipelineExecution.latestValLoss.toFixed(4)} · ppl={(
                          pipelineExecution.latestPerplexity ?? Math.exp(Math.min(pipelineExecution.latestValLoss, 50))
                        ).toFixed(2)} · grad_norm={pipelineExecution.latestGradNorm?.toFixed(4)}
                      </div>
                    )}
                    {pipelineExecution.verifiedCheckpoints.length > 0 && (
                      <div className="text-[var(--app-text-secondary)] break-all">
                        Latest Artifact Hash (Step{' '}
                        {pipelineExecution.verifiedCheckpoints[pipelineExecution.verifiedCheckpoints.length - 1].globalStep}
                        ):{' '}
                        {pipelineExecution.verifiedCheckpoints[pipelineExecution.verifiedCheckpoints.length - 1].containerSha256}
                      </div>
                    )}
                    {pipelineExecution.error && (
                      <div className="text-[var(--z-danger)]">{pipelineExecution.error}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </VividCard>
        </div>
      )}

      {activeTab === 'evidence' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {evidenceItems.map((item, idx) => (
            <VividCard key={idx} className="!p-5">
              <div className="flex items-start justify-between gap-2">
                <StatusDot
                  status={item.type}
                  label={item.type === 'VERIFIED' ? 'VERIFIED AXIOM' : item.type}
                />
                <span className="text-xs font-mono font-semibold text-[var(--app-text-secondary)]">
                  {item.confidence > 0 ? `${item.confidence}%` : (th ? 'ยังไม่ให้คะแนน' : 'Not scored')}
                </span>
              </div>

              <h4 className="mt-3 text-sm font-semibold text-[var(--app-text-primary)]">{item.title}</h4>
              <p className="mt-1 text-xs text-[var(--app-text-secondary)] leading-relaxed">{item.evidence}</p>

              <div className="mt-4 pt-3 border-t border-[var(--app-card-border)] flex items-center justify-between text-[11px] text-[var(--app-text-secondary)]">
                <span className="truncate">
                  {th ? 'ที่มา:' : 'Source:'} <code className="text-[var(--app-text-primary)] font-mono">{item.source}</code> ·{' '}
                  {th ? `สมมติฐานที่เปิดอยู่: ${hypothesesCount}` : `Open claims: ${hypothesesCount}`}
                </span>
              </div>
            </VividCard>
          ))}
        </div>
      )}

      {activeTab === 'graph' && (
        <VividCard
          title={th ? 'การไล่เส้นทางกราฟความรู้แบบ Multi-Hop' : 'Multi-Hop Knowledge Graph Traversal'}
          subtitle={`${th ? 'เส้นทางที่ตรวจพบจาก' : 'Verified graph paths from'} /api/research/investigate${
            graphSummary
              ? th
                ? ` · จัดดัชนีแล้ว ${graphSummary.nodes} โหนด / ${graphSummary.edges} เส้นเชื่อม`
                : ` · ${graphSummary.nodes} nodes / ${graphSummary.edges} edges indexed`
              : ''
          }`}
        >
          {graphPaths.length === 0 ? (
            <div className="p-8 bg-[var(--app-surface)] rounded-xl text-center space-y-3">
              <Network className="w-10 h-10 text-[var(--app-accent)] mx-auto" />
              <div className="max-w-md mx-auto text-xs text-[var(--app-text-secondary)]">
                {th ? (
                  <>
                    กด <strong>สืบค้นวิจัย</strong> เพื่อไล่เส้นทางความสัมพันธ์ใน Knowledge Graph จากเอกสารที่นำเข้า
                  </>
                ) : (
                  <>
                    Run <strong>Investigate</strong> to traverse Knowledge Graph relationships across ingested documents.
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {graphPaths.map((p: any, idx: number) => (
                <div key={idx} className="p-3.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-xs font-mono space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[var(--app-accent)] font-semibold">
                      Path #{idx + 1} · score {typeof p.score === 'number' ? p.score.toFixed(2) : p.totalWeight ?? '—'}
                    </div>
                    <span className="text-[10px] text-[var(--app-text-secondary)]">
                      {(p.hops || []).length} {th ? 'ช่วงเชื่อม' : 'hop(s)'}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {(p.hops || []).map((h: any, hIdx: number) => (
                      <div key={hIdx} className="p-2 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-1">
                        <div className="text-[var(--app-text-primary)] break-words">
                          <span className="font-semibold">{h.fromLabel || h.fromId}</span>{' '}
                          <span className="text-[var(--app-accent)]">—[{h.relation}]→</span>{' '}
                          <span className="font-semibold">{h.toLabel || h.toId}</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--app-text-secondary)]">
                          <span>{th ? 'เอกสาร:' : 'Doc:'} {h.documentTitle || h.documentId}</span>
                          {h.contentHash && <span className="break-all">SHA-256: {String(h.contentHash).slice(0, 16)}…</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </VividCard>
      )}

      {activeTab === 'report' && (
        <VividCard
          title={th ? 'รายงานสรุปสำหรับผู้บริหาร' : 'Executive Research Report'}
          subtitle={th ? 'สรุปหลักฐานและสมมติฐานตามจริง' : 'Evidence and hypotheses · not a certified capability report'}
        >
          <div className="space-y-4 text-xs text-[var(--app-text-primary)] leading-relaxed font-sans max-w-2xl">
            <h3 className="text-sm font-semibold text-[var(--app-text-primary)]">
              {th ? 'สรุปสำหรับผู้บริหาร (Executive Summary)' : 'Executive Summary'}
            </h3>
            <p>
              {th
                ? 'การประเมินโมเดล การค้นคืนจาก Knowledge Workspace และการตรวจสอบเหตุผลถูกแยกชัดเจนจากสมมติฐานที่ยังไม่ได้รับการยืนยัน'
                : 'Native model evaluation, grounded Knowledge Workspace retrieval, and Adaptive Reasoning verification remain strictly separated from unverified hypotheses.'}
            </p>
            <p className="text-[var(--app-text-secondary)]">
              {th
                ? 'ยังไม่มีการส่งออก PDF ในหน้านี้ จนกว่าจะเชื่อมต่อระบบสร้างรายงานจริงจากฝั่ง Server'
                : 'No PDF export is offered here until a real report-generation endpoint exists.'}
            </p>
            {investigation?.reasoning && (
              <pre className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-[11px] font-mono overflow-auto">
                {JSON.stringify(investigation.reasoning, null, 2)}
              </pre>
            )}
          </div>
        </VividCard>
      )}

      {activeTab === 'benchmarks' && (
        <VividCard
          title={th ? 'ทดสอบ Tokenizer และ Runtime (ไทย / อังกฤษ)' : 'Tokenizer & Runtime Benchmarks (Thai / English)'}
          subtitle={th ? 'ผลการทดสอบที่บันทึกจาก /api/verify/language-integrity' : 'Recorded test results from /api/verify/language-integrity'}
          gradientAccent="emerald"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-mono text-[var(--app-text-secondary)]">
                {benchmarkMeta && (
                  <>
                    <StatusDot
                      status={benchmarkMeta.verified ? 'VERIFIED' : 'BLOCKED'}
                      label={`Suite: ${benchmarkMeta.suiteStatus || 'CHECKED'}`}
                    />
                    <span>· {new Date(benchmarkMeta.executedAt || Date.now()).toLocaleTimeString()}</span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={handleRunBenchmarks}
                disabled={isRunningBenchmarks || !isAuthenticated || !isDevOrAdmin}
                className="min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[var(--app-accent-deep)] cursor-pointer disabled:opacity-50"
              >
                {isRunningBenchmarks
                  ? th
                    ? 'กำลังรันชุดทดสอบ...'
                    : 'Running Live Benchmarks...'
                  : th
                  ? 'รันชุดทดสอบจริง'
                  : 'Run Live Benchmarks'}
              </button>
            </div>
            {(!isAuthenticated || !isDevOrAdmin) && (
              <div className="text-xs font-mono text-[var(--app-amber)] flex flex-wrap items-center gap-2">
                <span>
                  {th
                    ? 'ต้องเข้าสู่ระบบสิทธิ์ Developer หรือ Administrator เพื่อสั่งรัน /api/verify/language-integrity'
                    : 'Developer or Administrator sign-in required to execute /api/verify/language-integrity.'}
                </span>
                {onOpenSignIn && (
                  <button
                    type="button"
                    onClick={onOpenSignIn}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--app-amber)] font-sans font-semibold cursor-pointer"
                  >
                    <LogIn className="w-3 h-3" />
                    <span>{th ? 'เข้าสู่ระบบ' : 'Sign in'}</span>
                  </button>
                )}
              </div>
            )}
            {benchmarkError && (
              <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_8%,var(--app-surface))] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] text-xs font-mono text-[var(--z-danger)]">
                {benchmarkError}
              </div>
            )}
            {!benchmarkResults ? (
              <div className="text-xs text-[var(--app-text-secondary)]">
                {th
                  ? 'กด "รันชุดทดสอบจริง" เพื่อตรวจสอบ Tokenizer ภาษาไทย-อังกฤษ และสถานะ Runtime'
                  : 'Click "Run Live Benchmarks" to execute real Thai/English tokenizer and runtime checks.'}
              </div>
            ) : (
              <div className="space-y-2">
                {benchmarkResults.map((b: any) => (
                  <div
                    key={b.test_id}
                    className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--app-text-primary)]">{b.name}</div>
                      <div className="text-[11px] text-[var(--app-text-secondary)] break-words">{b.evidence}</div>
                    </div>
                    <StatusDot
                      status={b.status === 'PASS' ? 'VERIFIED' : 'BLOCKED'}
                      label={`${b.status} (${b.duration_ms ?? 0}ms)`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </VividCard>
      )}
    </div>
  );
};

