import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SystemStatusData, ModuleId, StatusLevel, EvidenceDrawerItem, TrainingProgressAlert, TimeToEpochEstimate } from '../../types';
import { StatusDot } from '../ui/StatusBadge';
import { WorkflowStepper } from '../WorkflowStepper';
import { TaskExecutionProgressBar } from '../TaskExecutionProgressBar';
import {
  deriveWorkflowSnapshot,
  getWorkflowStageMeta,
  type WorkflowStageId,
  type WorkflowStageState,
  type WorkflowStageStatus,
} from '../../utils/workflowStages';
import { useLanguage } from '../../context/LanguageContext';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Code2,
  Eye,
  EyeOff,
  FlaskConical,
  Loader2,
  Maximize2,
  Minimize2,
  Paperclip,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useSentimentTrendShortcut } from '../../hooks/useSentimentTrendShortcut';

interface CommandCenterProps {
  statusData: SystemStatusData | null;
  truthData?: any;
  trainingReadiness?: any;
  onRefreshStatus?: () => void;
  isRefreshingStatus?: boolean;
  onNavigate: (module: ModuleId) => void;
  onOpenQuickTask: () => void;
  onOpenSecrets?: () => void;
  onInspectEvidence?: (item: EvidenceDrawerItem) => void;
  workflowLogs?: string[];
  isWorkflowRunning?: boolean;
  workflowDone?: boolean;
  workflowStepLatencies?: Array<{ latencyMs: number; timestamp: string }>;
  workflowVerificationHash?: string | null;
  workflowTotalExecMs?: number | null;
  workflowGoal?: string;
  activeFilterStageId?: WorkflowStageId | null;
  onStageClick?: (stage: WorkflowStageState) => void;
  onClearStageFilter?: () => void;
  onInspectStageInTerminal?: (stage: WorkflowStageState) => void;
  onRetryQuickTask?: () => void;
  goal?: string;
  onGoalChange?: (value: string) => void;
  onRunTask?: () => void;
  onCreateSoftwareProject?: (stack: 'node_fullstack' | 'node_api' | 'python_service' | 'static_web') => void;
  isCreatingSoftwareProject?: boolean;
  lastCreatedProject?: { projectId: string; name: string; stack: string } | null;
  showSentimentTrend?: boolean;
  onToggleSentimentTrend?: () => void;
}

const DEFAULT_TRAINING_TARGET_STEPS = 5800;
const TARGET_MODEL_PARAMS = 41_527_808;
const STALL_THRESHOLD_MS = 5 * 60 * 1000;
const TIME_TO_EPOCH_WINDOW = 10;

function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const rounded = Math.round(seconds);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

function interpolateBlueToEmerald(pct: number): string {
  const t = Math.max(0, Math.min(1, pct / 100));
  const [r, g, b] =
    t <= 0.5
      ? (() => {
          const u = t * 2;
          return [
            Math.round(59 + (6 - 59) * u),
            Math.round(130 + (182 - 130) * u),
            Math.round(246 + (212 - 246) * u),
          ];
        })()
      : (() => {
          const u = (t - 0.5) * 2;
          return [
            Math.round(6 + (16 - 6) * u),
            Math.round(182 + (185 - 182) * u),
            Math.round(212 + (129 - 212) * u),
          ];
        })();
  return `rgb(${r}, ${g}, ${b})`;
}

function computeTimeToEpochEstimate(params: {
  serverEstimate?: TimeToEpochEstimate | null;
  observedStepDurations: number[];
  currentStep: number;
  targetSteps: number;
  currentEpoch: number;
  totalEpochs: number;
  trainingCompletedVerified: boolean;
}): TimeToEpochEstimate {
  const { serverEstimate } = params;
  if (
    serverEstimate &&
    (serverEstimate.windowSteps > 0 || serverEstimate.basis === 'completed')
  ) {
    return serverEstimate;
  }

  const safeTarget = Math.max(1, params.targetSteps);
  const safeStep = Math.max(0, Math.min(safeTarget, params.currentStep));
  const safeTotalEpochs = Math.max(1, params.totalEpochs);
  const safeCurrentEpoch = Math.max(1, Math.min(safeTotalEpochs, params.currentEpoch || 1));
  const stepsPerEpoch = Math.max(1, Math.ceil(safeTarget / safeTotalEpochs));
  const epochEndStep =
    safeTotalEpochs === 1
      ? safeTarget
      : Math.min(safeTarget, safeCurrentEpoch * stepsPerEpoch);
  const remainingStepsInEpoch = Math.max(0, epochEndStep - safeStep);

  if (params.trainingCompletedVerified && safeStep >= safeTarget) {
    return {
      windowSteps: 0,
      maxWindowSteps: TIME_TO_EPOCH_WINDOW,
      averageStepSeconds: null,
      remainingStepsInEpoch: 0,
      estimatedSecondsToEpoch: 0,
      recentStepDurationsSec: [],
      basis: 'completed',
    };
  }

  const window = params.observedStepDurations
    .filter((d) => typeof d === 'number' && Number.isFinite(d) && d > 0)
    .slice(-TIME_TO_EPOCH_WINDOW);

  if (window.length === 0) {
    return {
      windowSteps: 0,
      maxWindowSteps: TIME_TO_EPOCH_WINDOW,
      averageStepSeconds: null,
      remainingStepsInEpoch,
      estimatedSecondsToEpoch: null,
      recentStepDurationsSec: [],
      basis: 'awaiting_step_history',
    };
  }

  const avg = Number((window.reduce((sum, s) => sum + s, 0) / window.length).toFixed(4));
  return {
    windowSteps: window.length,
    maxWindowSteps: TIME_TO_EPOCH_WINDOW,
    averageStepSeconds: avg,
    remainingStepsInEpoch,
    estimatedSecondsToEpoch: Math.max(0, Math.round(remainingStepsInEpoch * avg)),
    recentStepDurationsSec: window,
    basis: 'last_10_steps',
  };
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  statusData,
  truthData,
  onRefreshStatus,
  isRefreshingStatus = false,
  onNavigate,
  onOpenQuickTask,
  workflowLogs = [],
  isWorkflowRunning = false,
  workflowDone = false,
  workflowStepLatencies = [],
  workflowVerificationHash = null,
  workflowTotalExecMs = null,
  workflowGoal = '',
  activeFilterStageId = null,
  onStageClick,
  onClearStageFilter,
  onInspectStageInTerminal,
  onRetryQuickTask,
  goal = '',
  onGoalChange,
  onRunTask,
  onCreateSoftwareProject,
  isCreatingSoftwareProject = false,
  lastCreatedProject = null,
  showSentimentTrend: controlledShowSentimentTrend,
  onToggleSentimentTrend,
}) => {
  const { lang } = useLanguage();
  const th = lang === 'th';
  const fallbackSentimentShortcut = useSentimentTrendShortcut({
    enabled: onToggleSentimentTrend === undefined,
  });
  const isSentimentTrendVisible =
    controlledShowSentimentTrend ?? fallbackSentimentShortcut.showSentimentTrend;
  const handleToggleSentimentTrend =
    onToggleSentimentTrend ?? fallbackSentimentShortcut.toggleSentimentTrend;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const goalInputRef = useRef<HTMLTextAreaElement | null>(null);
  const terminalInputRef = useRef<HTMLTextAreaElement | null>(null);
  const terminalLogsContainerRef = useRef<HTMLDivElement | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [showTrainingDetails, setShowTrainingDetails] = useState(false);
  const [showWorkflowStepper, setShowWorkflowStepper] = useState(true);
  const [terminalMode, setTerminalMode] = useState<'closed' | 'maximized' | 'minimized'>('closed');
  const [terminalAutoScroll, setTerminalAutoScroll] = useState(true);
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [projectStack, setProjectStack] = useState<'node_fullstack' | 'node_api' | 'python_service' | 'static_web'>('node_fullstack');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || terminalMode !== 'maximized') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTerminalMode('closed');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [terminalMode]);

  useEffect(() => {
    if (terminalMode !== 'maximized' || !terminalAutoScroll) return;
    const el = terminalLogsContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [terminalMode, terminalAutoScroll, workflowLogs.length]);

  const MAX_ATTACHMENT_BYTES = 200 * 1024;
  const MAX_GOAL_CHARS = 250000;
  const allowedAttachment = /\.(txt|md|json|csv|ya?ml|toml|ini|js|jsx|ts|tsx|py|sql|html|css|xml|sh|c|cpp|h|go|rs)$/i;

  const handleAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setAttachmentError('');
    if (!file) return;
    if (!allowedAttachment.test(file.name)) {
      setAttachmentError(th ? 'รองรับเฉพาะไฟล์ข้อความและ Source Code' : 'Only text and source-code files are supported.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachmentError(th ? 'ไฟล์ต้องมีขนาดไม่เกิน 200 KB' : 'File must be 200 KB or smaller.');
      return;
    }
    try {
      const content = await file.text();
      const block = `\n\n[ATTACHED FILE: ${file.name}]\n${content}\n[/ATTACHED FILE]`;
      if ((goal + block).length > MAX_GOAL_CHARS) {
        setAttachmentError(
          th
            ? `คำสั่งรวมไฟล์แนบต้องไม่เกิน ${MAX_GOAL_CHARS.toLocaleString()} ตัวอักษร`
            : `Task and attachment must stay within ${MAX_GOAL_CHARS.toLocaleString()} characters.`
        );
        return;
      }
      onGoalChange?.(`${goal}${block}`);
    } catch {
      setAttachmentError(th ? 'อ่านไฟล์ไม่สำเร็จ' : 'Unable to read the selected file.');
    }
  };

  const workflowSnapshot = useMemo(
    () =>
      deriveWorkflowSnapshot({
        logs: workflowLogs,
        isRunning: isWorkflowRunning,
        isDone: workflowDone,
        stepLatencies: workflowStepLatencies,
        verificationHash: workflowVerificationHash,
        totalExecMs: workflowTotalExecMs,
        goal: workflowGoal,
      }),
    [
      workflowLogs,
      isWorkflowRunning,
      workflowDone,
      workflowStepLatencies,
      workflowVerificationHash,
      workflowTotalExecMs,
      workflowGoal,
    ]
  );

  const sentimentTrendData = useMemo(() => {
    let score = 0;
    let completionCount = 0;
    let errorCount = 0;
    let neutralCount = 0;
    const points = workflowLogs.map((line, i) => {
      const isError = /\[ERROR\]|fail|error|blocked/i.test(line);
      const isCompletion = !isError && /\[DONE\]|success|verified|exitCode:\s*0|passed/i.test(line);
      const kind: 'error' | 'completion' | 'neutral' = isError
        ? 'error'
        : isCompletion
          ? 'completion'
          : 'neutral';
      const delta = isError ? -1 : isCompletion ? 1 : 0;
      if (kind === 'error') errorCount += 1;
      else if (kind === 'completion') completionCount += 1;
      else neutralCount += 1;
      score += delta;
      const x = workflowLogs.length === 1 ? 50 : (i / (workflowLogs.length - 1)) * 100;
      const y = Math.max(4, Math.min(28, 16 - score * 2.5));
      return { index: i, x, y, delta, score, kind };
    });
    return {
      points,
      polylinePoints: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
      netScore: score,
      completionCount,
      errorCount,
      neutralCount,
    };
  }, [workflowLogs]);

  const activeStageForIndicator = useMemo<WorkflowStageState>(() => {
    return (
      workflowSnapshot.stages.find((s) => s.status === 'FAILED') ??
      workflowSnapshot.stages.find((s) => s.status === 'RUNNING') ??
      workflowSnapshot.stages.find((s) => s.id === workflowSnapshot.activeStageId) ??
      workflowSnapshot.stages[0]
    );
  }, [workflowSnapshot]);

  const activeStageMeta = useMemo(
    () => getWorkflowStageMeta(activeStageForIndicator.id),
    [activeStageForIndicator.id]
  );

  const stageStatusTone = (status: WorkflowStageStatus) => {
    switch (status) {
      case 'COMPLETED':
        return {
          text: 'text-[var(--z-ok)]',
          badge: 'border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_12%,var(--app-surface))] text-[var(--z-ok)]',
          label: th ? 'เสร็จสิ้น' : 'COMPLETED',
        };
      case 'RUNNING':
        return {
          text: 'text-[var(--app-accent)]',
          badge: 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_14%,var(--app-surface))] text-[var(--app-accent)]',
          label: th ? 'กำลังทำงาน' : 'RUNNING',
        };
      case 'FAILED':
        return {
          text: 'text-[var(--z-danger)]',
          badge: 'border-[var(--z-danger)] bg-[color-mix(in_srgb,var(--z-danger)_14%,var(--app-surface))] text-[var(--z-danger)]',
          label: th ? 'ติดขัด' : 'FAILED',
        };
      case 'PENDING':
      default:
        return {
          text: 'text-[var(--app-text-secondary)]',
          badge: 'border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-secondary)]',
          label: th ? 'รอดำเนินการ' : 'PENDING',
        };
    }
  };

  const model = statusData?.model;
  const audit = statusData?.audit;
  const training = statusData?.training ?? null;
  const connectivity = statusData?.connectivity;
  const cloudOnline = Boolean(connectivity?.online);
  const onlineModeStatus: string = !browserOnline
    ? 'BLOCKED'
    : cloudOnline
      ? 'VERIFIED'
      : statusData
        ? 'PARTIAL'
        : 'CHECKING';
  const onlineModeLabel = !browserOnline
    ? (th ? 'ออฟไลน์ถูกบล็อก (ต้องออนไลน์)' : 'OFFLINE BLOCKED')
    : cloudOnline
      ? (th ? 'ออนไลน์ (Live Cloud)' : 'ONLINE (LIVE)')
      : statusData
        ? (th ? 'ออนไลน์ (API สด · รอตั้งค่า Cloud)' : 'ONLINE (API LIVE)')
        : (th ? 'กำลังตรวจออนไลน์' : 'CHECKING');
  const inferenceReady = Boolean(model?.inferenceReady && model?.weightsLoaded);
  const runtimeStatus: StatusLevel = inferenceReady ? 'VERIFIED' : 'BLOCKED';
  const checkpointStatus: StatusLevel = model?.weightsLoaded ? 'VERIFIED' : 'BLOCKED';
  const auditStatus: StatusLevel = audit?.chainValid === true
    ? 'VERIFIED'
    : audit?.chainValid === false ? 'BLOCKED' : 'UNVERIFIED';

  const targetSteps = training?.targetSteps && training.targetSteps > 0
    ? training.targetSteps
    : DEFAULT_TRAINING_TARGET_STEPS;
  const currentStep = training ? Math.max(0, Math.min(targetSteps, training.currentStep)) : 0;
  const rawPct = targetSteps > 0 ? (currentStep / targetSteps) * 100 : 0;
  const clampedPct = Math.max(0, Math.min(100, rawPct));
  const formattedPct = clampedPct === 0 || clampedPct === 100 ? clampedPct.toFixed(0) : clampedPct.toFixed(1);

  const trainingStatusKey = !statusData
    ? 'CHECKING'
    : training?.running
      ? 'ACTIVE'
      : training?.status || 'BLOCKED';
  const trainingStatusLabel = !statusData
    ? (th ? 'กำลังตรวจ' : 'CHECKING')
    : training?.running
      ? (th ? 'กำลังฝึก' : 'RUNNING')
      : training?.status === 'BLOCKED'
        ? (th ? 'รอปลดล็อก Gate' : 'BLOCKED')
        : training?.status || 'BLOCKED';

  const stepTrackerRef = useRef<{ step: number; advancedAtMs: number } | null>(null);
  const [observedStepDurations, setObservedStepDurations] = useState<number[]>([]);
  const [showCustomPaceCalc, setShowCustomPaceCalc] = useState(false);
  const [customSecPerStepInput, setCustomSecPerStepInput] = useState('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!training?.running) {
      stepTrackerRef.current = null;
      setObservedStepDurations([]);
      return;
    }
    const now = Date.now();
    const serverAdvanceMs = training.lastStepAdvanceAt
      ? Date.parse(training.lastStepAdvanceAt)
      : training.startedAt
        ? Date.parse(training.startedAt)
        : NaN;
    if (!stepTrackerRef.current) {
      stepTrackerRef.current = {
        step: currentStep,
        advancedAtMs: Number.isFinite(serverAdvanceMs) ? serverAdvanceMs : now,
      };
    } else if (currentStep > stepTrackerRef.current.step) {
      const deltaSteps = currentStep - stepTrackerRef.current.step;
      const elapsedSec = Math.max(0, (now - stepTrackerRef.current.advancedAtMs) / 1000);
      if (elapsedSec > 0 && deltaSteps > 0) {
        const perStepSec = Number((elapsedSec / deltaSteps).toFixed(4));
        const fillCount = Math.min(deltaSteps, TIME_TO_EPOCH_WINDOW);
        setObservedStepDurations((prev) =>
          [...prev, ...Array.from({ length: fillCount }, () => perStepSec)].slice(-TIME_TO_EPOCH_WINDOW)
        );
      }
      stepTrackerRef.current = {
        step: currentStep,
        advancedAtMs: Number.isFinite(serverAdvanceMs) ? serverAdvanceMs : now,
      };
    } else if (Number.isFinite(serverAdvanceMs) && serverAdvanceMs > stepTrackerRef.current.advancedAtMs) {
      stepTrackerRef.current.advancedAtMs = serverAdvanceMs;
    }
    setNowMs(now);
    const timer = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [training?.running, training?.lastStepAdvanceAt, training?.startedAt, currentStep]);

  const trainingAlerts = useMemo<TrainingProgressAlert[]>(() => {
    const merged = new Map<TrainingProgressAlert['id'], TrainingProgressAlert>();
    if (Array.isArray(training?.alerts)) {
      for (const a of training.alerts) {
        if (a && a.id) merged.set(a.id, a);
      }
    }
    if (training?.running && stepTrackerRef.current && !merged.has('stalled_progress')) {
      const stalledMs = Math.max(0, nowMs - stepTrackerRef.current.advancedAtMs);
      if (stalledMs > STALL_THRESHOLD_MS) {
        const mins = (stalledMs / 60_000).toFixed(1);
        merged.set('stalled_progress', {
          id: 'stalled_progress',
          severity: 'warning',
          title: th ? 'ความคืบหน้าการฝึกหยุดชะงัก' : 'Training progress stalled',
          detail: th
            ? `ไม่พบการเพิ่มขึ้นของ Step นาน ${mins} นาที (เกินเกณฑ์ 5.0 นาที)`
            : `No step increase detected for ${mins} min (threshold: 5.0 min).`,
          detectedAt: new Date(nowMs).toISOString(),
        });
      }
    }
    const losses = Array.isArray(training?.recentValLosses)
      ? training.recentValLosses.filter((v) => typeof v === 'number' && Number.isFinite(v))
      : [];
    if (losses.length >= 3 && !merged.has('val_loss_rising')) {
      const n = losses.length;
      const latest = losses[n - 1];
      const prev1 = losses[n - 2];
      const prev2 = losses[n - 3];
      const minPrior = Math.min(...losses.slice(0, n - 1));
      const delta = latest - minPrior;
      const threshold = Math.max(0.05, minPrior * 0.05);
      if (prev2 < prev1 && prev1 < latest && delta >= threshold) {
        merged.set('val_loss_rising', {
          id: 'val_loss_rising',
          severity: 'warning',
          title: th ? 'Validation Loss มีแนวโน้มสูงขึ้น' : 'Validation loss trending upward',
          detail: th
            ? `Validation Loss เพิ่มขึ้น +${delta.toFixed(4)} (${prev2.toFixed(4)} → ${prev1.toFixed(4)} → ${latest.toFixed(4)})`
            : `Validation loss increased +${delta.toFixed(4)} (${prev2.toFixed(4)} → ${prev1.toFixed(4)} → ${latest.toFixed(4)}).`,
          detectedAt: new Date(nowMs).toISOString(),
        });
      }
    }
    return Array.from(merged.values());
  }, [training?.alerts, training?.running, training?.recentValLosses, nowMs, th]);

  const gaugeFillColor = interpolateBlueToEmerald(clampedPct);
  const saveEvery = training?.saveEvery ?? 100;
  const plannedCheckpointsCount = training?.plannedCheckpointsCount ?? Math.ceil(targetSteps / Math.max(1, saveEvery));
  const verifiedCheckpointsCount = training?.verifiedCheckpointsCount ?? 0;
  const gatesPassed = training?.gatesPassed ?? 0;
  const gatesTotal = training?.gatesTotal ?? 6;
  const blockers = training?.blockers ?? [];
  const totalEpochs = training?.totalEpochs ?? 1;
  const currentEpoch = training?.currentEpoch ?? (training?.running || currentStep > 0 ? 1 : 0);
  const completedCheckpointCycles = Math.floor(currentStep / Math.max(1, saveEvery));

  const timeToEpoch = useMemo(
    () =>
      computeTimeToEpochEstimate({
        serverEstimate: training?.timeToEpoch,
        observedStepDurations,
        currentStep,
        targetSteps,
        currentEpoch,
        totalEpochs,
        trainingCompletedVerified: Boolean(training?.trainingCompletedVerified),
      }),
    [
      training?.timeToEpoch,
      observedStepDurations,
      currentStep,
      targetSteps,
      currentEpoch,
      totalEpochs,
      training?.trainingCompletedVerified,
    ]
  );
  const estimatedRemaining = timeToEpoch.estimatedSecondsToEpoch ?? training?.estimatedSecondsRemaining ?? null;
  const elapsedSeconds = training?.elapsedSeconds ?? null;
  const secondsPerStep = timeToEpoch.averageStepSeconds ?? training?.secondsPerStep ?? null;
  const parsedCustomSecPerStep = Number(customSecPerStepInput);
  const customPaceEstimateSeconds =
    Number.isFinite(parsedCustomSecPerStep) && parsedCustomSecPerStep > 0
      ? Math.round(timeToEpoch.remainingStepsInEpoch * parsedCustomSecPerStep)
      : null;

  return (
    <div className="space-y-6 md:space-y-8">
      {/* 1. Quiet Minimal Heading & Concise Truthful Status Line */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--app-text-primary)]">
              {th ? 'ศูนย์บัญชาการ' : 'Command Center'}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[var(--app-text-secondary)]">
              {th
                ? 'สั่งงาน วิเคราะห์ หรือเปิดใช้งานเครื่องมือของ ZYNTHEOR จากจุดเดียว'
                : 'Dispatch tasks, inspect training readiness, and launch workspace tools from one clean surface.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('governance_security')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--app-accent)] hover:underline cursor-pointer shrink-0"
          >
            {th ? 'ดูหลักฐานและ Audit' : 'Review evidence'} <ArrowRight size={13} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 border-t border-[var(--app-card-border)] text-xs text-[var(--app-text-secondary)]">
          <span className="inline-flex items-center gap-2" data-testid="online-only-status">
            {browserOnline ? (
              <Wifi className="w-3.5 h-3.5 text-[var(--app-accent)]" aria-hidden="true" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-[var(--z-danger)]" aria-hidden="true" />
            )}
            <span>{th ? 'การเชื่อมต่อ' : 'Connectivity'}</span>
            <StatusDot
              status={onlineModeStatus}
              label={onlineModeLabel}
              detail={connectivity?.reason || (th ? 'ระบบทำงานแบบออนไลน์เท่านั้น (ไม่ใช้ออฟไลน์)' : 'Online-only mode enforced')}
            />
          </span>
          <span className="inline-flex items-center gap-2">
            <span>Runtime</span>
            <StatusDot
              status={runtimeStatus}
              label={inferenceReady ? (th ? 'พร้อม' : 'READY') : (th ? 'ยังไม่โหลด' : 'BLOCKED')}
              detail={model?.readinessReason}
            />
          </span>
          <span className="inline-flex items-center gap-2">
            <span>Checkpoint</span>
            <StatusDot
              status={checkpointStatus}
              label={model?.weightsLoaded ? (th ? 'โหลดแล้ว' : 'LOADED') : (th ? 'ยังไม่โหลด' : 'UNLOADED')}
              detail={model?.checkpointHash}
            />
          </span>
          <span className="inline-flex items-center gap-2">
            <span>Audit</span>
            <StatusDot
              status={auditStatus}
              label={audit?.chainValid === true ? (th ? 'ถูกต้อง' : 'VALID') : audit?.chainValid === false ? (th ? 'ผิดพลาด' : 'INVALID') : (th ? 'รอตรวจ' : 'UNVERIFIED')}
              detail={audit?.headHash}
            />
          </span>
          {workflowLogs.length === 0 && (
            <button
              type="button"
              data-testid="command-center-toggle-sentiment-trend"
              aria-pressed={isSentimentTrendVisible}
              onClick={handleToggleSentimentTrend}
              title={th ? 'สลับการแสดงกราฟ Sentiment (Alt+V)' : 'Toggle Sentiment Trend Chart (Alt+V)'}
              className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
            >
              {isSentimentTrendVisible ? <Eye className="w-3.5 h-3.5 text-[var(--app-accent)]" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
              <span>{th ? 'แนวโน้ม Sentiment' : 'Sentiment Trend'}</span>
              <kbd className="px-1 py-0.2 rounded border border-[var(--app-card-border)] text-[9px] text-[var(--app-text-secondary)]">Alt+V</kbd>
            </button>
          )}
        </div>
      </section>

      {/* 2. Primary Anchor: Direct Task Dispatch Composer */}
      <section
        className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-4 sm:p-6 space-y-3.5"
        aria-label={th ? 'สั่งงานระบบโดยตรง' : 'Direct task dispatch'}
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <label htmlFor="command-center-goal-input" className="text-sm font-medium text-[var(--app-text-primary)]">
              {th ? 'คุณต้องการให้ ZYNTHEOR ทำอะไร?' : 'What should ZYNTHEOR work on?'}
            </label>
            <span className="text-[11px] font-mono tabular-nums text-[var(--app-text-secondary)]">
              {goal.length.toLocaleString()} / {MAX_GOAL_CHARS.toLocaleString()}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto shrink-0">
            <button
              type="button"
              data-testid="command-center-open-terminal-btn"
              onClick={() => setTerminalMode('maximized')}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3.5 py-2 text-xs font-medium text-[var(--app-text-primary)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] cursor-pointer transition-colors whitespace-nowrap"
            >
              {terminalMode === 'minimized' ? (
                <Maximize2 className="w-3.5 h-3.5 shrink-0 text-[var(--app-accent)]" aria-hidden="true" />
              ) : (
                <Terminal className="w-3.5 h-3.5 shrink-0 text-[var(--app-accent)]" aria-hidden="true" />
              )}
              <span>
                {terminalMode === 'minimized'
                  ? (th ? 'ขยาย Terminal' : 'Resume Terminal')
                  : (th ? 'เปิด Terminal' : 'Open Terminal')}
              </span>
              {workflowLogs.length > 0 && (
                <span className="font-mono text-[10px] tabular-nums text-[var(--app-text-secondary)]">
                  ({workflowLogs.length})
                </span>
              )}
            </button>

            <button
              type="button"
              data-testid="command-center-run-task-btn"
              onClick={() => {
                if (!browserOnline) return;
                if (onRunTask && onGoalChange) onRunTask();
                else onOpenQuickTask();
              }}
              disabled={!browserOnline || isWorkflowRunning || !goal.trim()}
              className="min-h-[40px] inline-flex items-center gap-2 rounded-lg bg-[var(--app-accent-deep)] px-4 sm:px-5 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40 cursor-pointer transition-all whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {isWorkflowRunning
                  ? (th ? 'กำลังดำเนินงาน…' : 'Executing…')
                  : (th ? 'เริ่มดำเนินงาน' : 'Run task')}
              </span>
            </button>
          </div>
        </div>

        <textarea
          id="command-center-goal-input"
          ref={goalInputRef}
          value={goal}
          onChange={(event) => onGoalChange?.(event.target.value.slice(0, MAX_GOAL_CHARS))}
          readOnly={!onGoalChange}
          rows={4}
          maxLength={MAX_GOAL_CHARS}
          placeholder={
            th
              ? 'พิมพ์คำสั่งภาษาไทยหรืออังกฤษปนกันได้ เช่น สร้าง API ตรวจสอบสิทธิ์, วิเคราะห์ไฟล์, หรือสรุปสถานะการฝึก R0...'
              : 'Describe your task in Thai or English: build an API, analyze workspace files, or verify training readiness…'
          }
          className="w-full resize-y rounded-lg border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-4 py-3 text-base sm:text-sm leading-relaxed text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]/70 outline-none focus:border-[var(--app-accent)]"
        />

        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.json,.csv,.yaml,.yml,.toml,.ini,.js,.jsx,.ts,.tsx,.py,.sql,.html,.css,.xml,.sh,.c,.cpp,.h,.go,.rs"
          className="hidden"
          onChange={handleAttachment}
        />

        {attachmentError && (
          <p role="alert" className="text-xs text-[var(--z-danger)]">
            {attachmentError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
          <span className="text-[var(--app-text-secondary)]">
            {th ? 'ตัวอย่างคำสั่ง:' : 'Presets:'}
          </span>
          {[
            {
              label: th ? 'สร้างเว็บแอป + API' : 'Full-Stack Web + API',
              text: th
                ? 'สร้างเว็บแอปพลิเคชันติดตามงานและสถานะระบบ พร้อมหน้าเว็บ Dashboard, REST API CRUD, ฐานข้อมูล และชุดทดสอบอัตโนมัติ'
                : 'Build a full-stack operations web app with interactive dashboard UI, REST API CRUD, data store, and automated tests',
            },
            {
              label: th ? 'ตรวจและซ่อมบั๊กในระบบ' : 'Inspect & Repair Code',
              text: th
                ? 'ตรวจสอบโค้ด ทดสอบ Unit Tests สแกนความปลอดภัย และซ่อมแซมจุดบกพร่องที่พบโดยอัตโนมัติ'
                : 'Audit source code, execute unit tests, scan security findings, and perform deterministic repair',
            },
            {
              label: th ? 'ตรวจความพร้อม R0' : 'Audit R0 Readiness',
              text: th
                ? 'ตรวจสอบความพร้อมโครงสร้าง NativeLM R0 (41.5M / 5,800 steps), Audit Chain และสถานะ Runtime จริง'
                : 'Inspect NativeLM R0 (41.5M / 5,800 steps) readiness, Audit Chain integrity, and live runtime status',
            },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onGoalChange?.(preset.text)}
              className="px-2.5 py-1 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="command-center-attach-file-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!onGoalChange || isWorkflowRunning}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3.5 py-2 text-xs font-medium text-[var(--app-text-primary)] hover:border-[var(--app-accent)] disabled:opacity-40 cursor-pointer transition-colors"
            >
              <Paperclip className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" aria-hidden="true" />
              <span>{th ? 'แนบไฟล์ (สูงสุด 200 KB)' : 'Attach file'}</span>
            </button>

            {onCreateSoftwareProject && (
              <div className="inline-flex items-center rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] overflow-hidden">
                <select
                  value={projectStack}
                  onChange={(e) => setProjectStack(e.target.value as typeof projectStack)}
                  aria-label={th ? 'สแต็กโปรเจกต์' : 'Application stack'}
                  className="min-h-[40px] px-2.5 py-2 bg-transparent text-[11px] font-mono text-[var(--app-text-secondary)] border-r border-[var(--app-card-border)] outline-none cursor-pointer"
                >
                  <option value="node_fullstack">Web + API</option>
                  <option value="node_api">REST API</option>
                  <option value="python_service">Python 3</option>
                  <option value="static_web">Static Web</option>
                </select>
                <button
                  type="button"
                  data-testid="command-center-build-app-btn"
                  onClick={() => onCreateSoftwareProject(projectStack)}
                  disabled={!browserOnline || isCreatingSoftwareProject || isWorkflowRunning || !goal.trim()}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[var(--app-accent)] hover:bg-[var(--app-surface-elevated)] disabled:opacity-40 cursor-pointer transition-colors whitespace-nowrap"
                >
                  <Code2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {isCreatingSoftwareProject
                      ? (th ? 'กำลังสร้างโปรเจกต์…' : 'Scaffolding…')
                      : (th ? 'สร้างโปรเจกต์แอป' : 'Build App Project')}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {!browserOnline && (
          <div
            role="alert"
            data-testid="offline-blocked-banner"
            className="flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] px-3.5 py-2 text-xs text-[var(--z-danger)]"
          >
            <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {th
                ? 'ไม่รองรับการทำงานแบบออฟไลน์ — กรุณาเชื่อมต่ออินเทอร์เน็ตและเซิร์ฟเวอร์ออนไลน์ก่อนสั่งงาน'
                : 'Offline execution is disabled — connect to an online network and live server to dispatch tasks.'}
            </span>
          </div>
        )}

        {lastCreatedProject && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--app-card-border)] text-xs">
            <span className="font-mono text-[var(--z-ok)] truncate">
              {th ? 'สร้างโปรเจกต์สำเร็จ:' : 'App scaffolded:'} {lastCreatedProject.name} ({lastCreatedProject.stack})
            </span>
            <button
              type="button"
              onClick={() => onNavigate('dev_studio')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--app-accent)] hover:underline cursor-pointer"
            >
              <span>{th ? 'เปิดแก้ไข / พรีวิว / ส่งออกใน DevStudio' : 'Open in DevStudio'}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      </section>

      {/* 3. Fast Tool Access Row (Clean Hairline Tiles) */}
      <section aria-label={th ? 'ทางลัดเครื่องมือหลัก' : 'Primary tools'} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          { id: 'dev_studio', icon: Code2, name: th ? 'DevStudio & สร้างแอป' : 'DevStudio & App Builder', desc: th ? 'สร้าง พรีวิว ทดสอบ ซ่อม และ GitHub Sync' : 'Build, preview, test, repair & GitHub Sync' },
          { id: 'research_lab', icon: FlaskConical, name: th ? 'ห้องวิจัย & ทดสอบ' : 'ResearchLab', desc: th ? 'ชุดวิจัยและการตรวจสอบโมเดล' : 'Research & validation' },
          { id: 'model_laboratory', icon: BrainCircuit, name: th ? 'ห้องโมเดล R0' : 'ModelLaboratory', desc: th ? 'รันไทม์ R0 (41.5M) และไปป์ไลน์ฝึก' : 'Models & 5,800-step training' },
          { id: 'governance_security', icon: ShieldCheck, name: th ? 'หลักฐาน & Audit' : 'Evidence Ledger', desc: th ? 'ตรวจสอบ SHA-256 Chain และสิทธิ์' : 'Verification & audit' },
        ] as Array<{ id: ModuleId; icon: React.ComponentType<{ className?: string }>; name: string; desc: string }>).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`command-center-shortcut-${item.id}`}
              onClick={() => onNavigate(item.id)}
              className="flex flex-col items-start gap-1 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-3.5 text-left hover:border-[var(--app-accent)] hover:bg-[var(--app-surface)] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 text-xs sm:text-sm font-medium text-[var(--app-text-primary)]">
                <Icon className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
                <span className="truncate">{item.name}</span>
              </span>
              <span className="text-[11px] text-[var(--app-text-secondary)] truncate w-full">{item.desc}</span>
            </button>
          );
        })}
      </section>

      {/* Live Software Engineering Capability Truth Strip (Read-Only from Backend Truth) */}
      {truthData?.softwareEngineering?.summary && (
        <section
          aria-label={th ? 'สถานะความสามารถการสร้างซอฟต์แวร์จริง' : 'Software engineering capability summary'}
          className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-card)] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--app-text-secondary)]">
            <span className="font-medium text-[var(--app-text-primary)]">
              {th ? 'ความสามารถด้านวิศวกรรมซอฟต์แวร์ (Software Engine)' : 'Software Engineering Engine'}
            </span>
            <span className="font-mono tabular-nums text-[var(--z-ok)]">
              {th ? 'พร้อมใช้งานจริง' : 'IMPLEMENTED'} {truthData.softwareEngineering.summary.implemented}/{truthData.softwareEngineering.summary.total}
            </span>
            {truthData.softwareEngineering.summary.partial > 0 && (
              <span className="font-mono tabular-nums text-[var(--app-amber)]">
                PARTIAL {truthData.softwareEngineering.summary.partial}
              </span>
            )}
            {(truthData.softwareEngineering.summary.blocked + truthData.softwareEngineering.summary.notConfigured) > 0 && (
              <span className="font-mono tabular-nums text-[var(--app-text-secondary)]">
                {th ? 'ยังไม่ตั้งค่า/ติดเกต' : 'Gated/Config'} {truthData.softwareEngineering.summary.blocked + truthData.softwareEngineering.summary.notConfigured}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('proof_of_intelligence')}
              className="text-xs font-medium text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
            >
              {th ? 'ดูรายละเอียดความจริงระบบ' : 'Truth matrix'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('dev_studio')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--app-accent)] hover:underline cursor-pointer"
            >
              <span>{th ? 'จัดการโปรเจกต์' : 'Open projects'}</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </section>
      )}

      {/* 4. Concise 5,800-Step Training Progress Summary (Flat + Progressive Disclosure) */}
      <section
        aria-label={th ? 'ความคืบหน้าการฝึก 5,800 ขั้นตอน' : '5,800-Step Training Progress'}
        data-testid="training-progress-gauge-section"
        className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--app-text-primary)]">
              {th ? 'การฝึก NativeLM · เป้าหมาย 5,800 ขั้นตอน' : 'NativeLM Training · 5,800-Step Target'}
            </h3>
            <p className="text-[11px] font-mono text-[var(--app-text-secondary)] truncate">
              {training?.pipelineId
                ? `${training.pipelineId} · ${(training.targetParams ?? TARGET_MODEL_PARAMS).toLocaleString()} params`
                : `${TARGET_MODEL_PARAMS.toLocaleString()} params · /api/system/status`}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <StatusDot
              status={trainingStatusKey}
              label={trainingStatusLabel}
              detail={training?.error || blockers.join(', ') || `${currentStep} / ${targetSteps} steps`}
            />
            {onRefreshStatus && (
              <button
                type="button"
                onClick={onRefreshStatus}
                disabled={isRefreshingStatus}
                aria-label={th ? 'อัปเดตสถานะการฝึก' : 'Refresh training status'}
                className="p-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingStatus ? 'animate-spin text-[var(--app-accent)]' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('research_lab')}
              className="text-xs font-medium text-[var(--app-accent)] hover:underline cursor-pointer whitespace-nowrap"
            >
              {th ? 'เปิด Pipeline' : 'Open Pipeline'}
            </button>
          </div>
        </div>

        {/* Clean Progress Bar + Step Readout */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-mono tabular-nums">
            <span className="text-[var(--app-text-primary)] font-semibold">
              <span data-testid="training-gauge-current-step">
                {statusData ? currentStep.toLocaleString() : '—'}
              </span>{' '}
              <span data-testid="training-gauge-target-steps" className="text-[var(--app-text-secondary)] font-normal">
                / {targetSteps.toLocaleString()} {th ? 'ขั้นตอน' : 'steps'}
              </span>
            </span>
            <span
              data-testid="training-gauge-pct"
              className="font-semibold"
              style={{ color: statusData && currentStep > 0 ? gaugeFillColor : 'var(--app-text-secondary)' }}
            >
              {statusData ? `${formattedPct}%` : '—'}
            </span>
          </div>

          <div
            role="progressbar"
            aria-label={th ? 'ความคืบหน้าการฝึก 5,800 ขั้นตอน' : '5,800-step training progress'}
            aria-valuenow={currentStep}
            aria-valuemin={0}
            aria-valuemax={targetSteps}
            aria-valuetext={`${currentStep.toLocaleString()} / ${targetSteps.toLocaleString()} (${formattedPct}%)`}
            className="h-2 w-full rounded-full overflow-hidden bg-[var(--app-input-bg)] border border-[var(--app-card-border)]"
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${clampedPct > 0 ? Math.max(1.5, clampedPct) : 0}%`,
                backgroundColor: gaugeFillColor,
              }}
            />
          </div>
        </div>

        {/* Stall / Validation Loss Alerts */}
        {trainingAlerts.length > 0 && (
          <div
            role="alert"
            data-testid="training-alert-banner"
            className="rounded-lg border border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-warn)_8%,transparent)] px-3.5 py-2.5 space-y-1"
          >
            {trainingAlerts.map((alert) => (
              <div key={alert.id} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--z-warn)]" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="font-semibold text-[var(--z-warn)]">{alert.title}: </span>
                    <span className="text-[var(--app-text-primary)]">{alert.detail}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('research_lab')}
                  className="text-[11px] font-medium text-[var(--z-warn)] hover:underline cursor-pointer shrink-0"
                >
                  {th ? 'ดูรายละเอียด' : 'Inspect'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Single-Level Key Metrics Strip (No Card-in-Card Nesting) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-[var(--app-card-border)] text-xs">
          <div data-testid="training-gauge-epoch">
            <div className="text-[11px] text-[var(--app-text-secondary)]">
              {th ? 'Epoch ปัจจุบัน' : 'Current Epoch'}
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--app-text-primary)]">
              {statusData ? `Epoch ${currentEpoch} / ${totalEpochs}` : '—'}
              {statusData && (
                <span className="ml-2 text-[11px] font-normal text-[var(--app-text-secondary)]">
                  ({completedCheckpointCycles}/{plannedCheckpointsCount} ckpt)
                </span>
              )}
            </div>
          </div>

          <div data-testid="training-gauge-eta">
            <div className="text-[11px] text-[var(--app-text-secondary)]">
              {th ? 'เวลาที่เหลือ (ETA)' : 'Est. Time Remaining'}
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--app-text-primary)]">
              {!statusData
                ? '—'
                : training?.trainingCompletedVerified && currentStep >= targetSteps
                  ? '0s'
                  : estimatedRemaining !== null
                    ? formatDuration(estimatedRemaining)
                    : '—'}
              {secondsPerStep !== null && (
                <span className="ml-2 text-[11px] font-normal text-[var(--app-text-secondary)]">
                  ({secondsPerStep.toFixed(2)}s/step)
                </span>
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-[var(--app-text-secondary)]">
              {th ? 'เกตความปลอดภัย' : 'Safety Gates'}
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--app-text-primary)]">
              {statusData ? `${gatesPassed} / ${gatesTotal}` : '—'}
              {typeof training?.latestValLoss === 'number' && (
                <span className="ml-2 text-[11px] font-normal text-[var(--app-text-secondary)]">
                  Loss {training.latestValLoss.toFixed(3)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Concise Blocker Line when Blocked */}
        {statusData && training?.status === 'BLOCKED' && blockers.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--app-card-border)] text-xs text-[var(--app-text-secondary)]">
            <span className="truncate">
              <span className="font-mono font-semibold text-[var(--z-danger)]">BLOCKED:</span>{' '}
              <span className="font-mono">{blockers.slice(0, 2).join(' · ')}{blockers.length > 2 ? ` (+${blockers.length - 2})` : ''}</span>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('model_laboratory')}
              className="text-[11px] font-medium text-[var(--app-accent)] hover:underline cursor-pointer shrink-0"
            >
              {th ? 'ตรวจสอบใน ModelLaboratory' : 'Inspect'}
            </button>
          </div>
        )}

        {/* Compact Time-to-Epoch Strip + Progressive Disclosure */}
        <div
          data-testid="time-to-epoch-calculator"
          className="pt-2 border-t border-[var(--app-card-border)] space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[var(--app-text-secondary)]">
              <span data-testid="time-to-epoch-avg-step">
                {th ? 'เฉลี่ย 10 ขั้นล่าสุด:' : 'Last-10 avg:'}{' '}
                <strong className="text-[var(--app-text-primary)]">
                  {timeToEpoch.averageStepSeconds !== null
                    ? `${timeToEpoch.averageStepSeconds.toFixed(3)}s/step`
                    : '—'}
                </strong>
              </span>
              <span data-testid="time-to-epoch-value">
                {th ? 'ถึงจบ Epoch:' : 'Time-to-Epoch:'}{' '}
                <strong className="text-[var(--app-text-primary)]">
                  {!statusData
                    ? '—'
                    : timeToEpoch.basis === 'completed'
                      ? '0s'
                      : timeToEpoch.estimatedSecondsToEpoch !== null
                        ? formatDuration(timeToEpoch.estimatedSecondsToEpoch)
                        : '—'}
                </strong>
              </span>
              <span data-testid="time-to-epoch-remaining-steps">
                {th ? 'คงเหลือ:' : 'Remaining:'}{' '}
                <strong className="text-[var(--app-text-primary)]">
                  {statusData ? `${timeToEpoch.remainingStepsInEpoch.toLocaleString()} steps` : '—'}
                </strong>
              </span>
            </div>

            <button
              type="button"
              data-testid="time-to-epoch-toggle-manual"
              onClick={() => {
                setShowCustomPaceCalc((v) => !v);
                setShowTrainingDetails((v) => !v);
              }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--app-accent)] hover:underline cursor-pointer"
            >
              <span>{showTrainingDetails ? (th ? 'ซ่อนตัวคำนวณ' : 'Hide estimator') : (th ? 'ประมาณการเวลา' : 'Pace estimator')}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTrainingDetails ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {showCustomPaceCalc && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-dashed border-[var(--app-card-border)] text-xs">
              <div className="flex items-center gap-2">
                <label htmlFor="manual-step-pace-input" className="text-[11px] text-[var(--app-text-secondary)]">
                  {th ? 'ความเร็ววางแผน (วินาที/Step):' : 'Planning pace (sec/step):'}
                </label>
                <input
                  id="manual-step-pace-input"
                  data-testid="time-to-epoch-manual-input"
                  type="number"
                  min="0.01"
                  step="0.1"
                  value={customSecPerStepInput}
                  onChange={(e) => setCustomSecPerStepInput(e.target.value)}
                  placeholder="1.50"
                  className="w-24 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-2.5 py-1 font-mono text-xs tabular-nums text-[var(--app-text-primary)] outline-none focus:border-[var(--app-accent)]"
                />
              </div>
              <div className="flex items-center gap-3 font-mono tabular-nums">
                <span data-testid="time-to-epoch-manual-result" className="text-xs font-semibold text-[var(--app-text-primary)]">
                  {customPaceEstimateSeconds !== null
                    ? `${th ? 'รวมประมาณ' : 'Est.'} ${formatDuration(customPaceEstimateSeconds)}`
                    : (th ? 'ระบุวินาที/Step เพื่อคำนวณ' : 'Enter sec/step')}
                </span>
                {customSecPerStepInput && (
                  <button
                    type="button"
                    onClick={() => setCustomSecPerStepInput('')}
                    className="text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                  >
                    {th ? 'ล้าง' : 'Clear'}
                  </button>
                )}
              </div>
              {elapsedSeconds !== null && (
                <span className="text-[11px] font-mono text-[var(--app-text-secondary)]">
                  {th ? 'ผ่านไป' : 'Elapsed'}: {formatDuration(elapsedSeconds)}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 5. 7-Stage Workflow Timeline & Stage-Specific Status Indicator (Live Online Stream) */}
      <section
        aria-label={th ? 'ไทม์ไลน์การทำงาน 7 ขั้นตอนและสถานะรายขั้นตอน' : '7-Stage Workflow Timeline & Stage Status Indicator'}
        data-testid="command-center-workflow-section"
        className="space-y-4"
      >
        {/* Stage-Specific Status Indicator derived directly from workflowStages */}
        <div
          data-testid="workflow-stage-status-indicator"
          className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-4 sm:p-5 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold tabular-nums ${
                  stageStatusTone(activeStageForIndicator.status).badge
                }`}
              >
                {String(activeStageForIndicator.order).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                  <span className="font-semibold text-[var(--app-text-secondary)]">
                    {th
                      ? `สถานะรายขั้นตอน (${activeStageForIndicator.order}/${workflowSnapshot.totalSteps})`
                      : `STAGE STATUS (${activeStageForIndicator.order}/${workflowSnapshot.totalSteps})`}
                  </span>
                  <span className={`font-bold ${stageStatusTone(activeStageForIndicator.status).text}`}>
                    · {stageStatusTone(activeStageForIndicator.status).label}
                  </span>
                  <span className="text-[var(--app-text-secondary)]">
                    · {workflowSnapshot.completedSteps}/{workflowSnapshot.totalSteps} {th ? 'ขั้นตอนสำเร็จ' : 'completed'}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-bold text-[var(--app-text-primary)] truncate">
                    {th
                      ? activeStageMeta?.labelTh || activeStageForIndicator.labelTh
                      : activeStageMeta?.labelEn || activeStageForIndicator.labelEn}
                  </span>
                  <span className="text-xs text-[var(--app-text-secondary)] truncate">
                    — {th
                      ? activeStageMeta?.subtitleTh || activeStageForIndicator.subtitleTh
                      : activeStageMeta?.subtitleEn || activeStageForIndicator.subtitleEn}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-2.5 py-1 text-[11px] font-mono text-[var(--app-text-secondary)]">
                {browserOnline ? (
                  <Wifi className="w-3 h-3 text-[var(--z-ok)]" aria-hidden="true" />
                ) : (
                  <WifiOff className="w-3 h-3 text-[var(--z-danger)]" aria-hidden="true" />
                )}
                <span>{th ? 'โหมดออนไลน์สด' : 'Live Online'}</span>
              </span>
              <button
                type="button"
                onClick={() => setShowWorkflowStepper((v) => !v)}
                aria-expanded={showWorkflowStepper}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-2.5 py-1 text-xs font-medium text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer transition-colors"
              >
                <span>
                  {showWorkflowStepper
                    ? th
                      ? 'ย่อรายละเอียดไทม์ไลน์'
                      : 'Collapse timeline'
                    : th
                    ? 'แสดงไทม์ไลน์ 7 ขั้นตอน'
                    : 'Expand 7-stage timeline'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showWorkflowStepper ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          {/* 7-Stage Compact Status Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 pt-2 border-t border-[var(--app-card-border)]">
            {workflowSnapshot.stages.map((stage) => {
              const tone = stageStatusTone(stage.status);
              const isSelected = activeFilterStageId === stage.id || activeStageForIndicator.id === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  data-testid={`stage-indicator-pill-${stage.id}`}
                  data-status={stage.status}
                  onClick={() => {
                    onStageClick?.(stage);
                    setShowWorkflowStepper(true);
                  }}
                  className={`flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${tone.badge} ${
                    isSelected ? 'ring-1 ring-[var(--app-accent)] bg-[var(--app-surface-elevated)]' : 'hover:border-[var(--app-accent)]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] font-bold opacity-85">
                      {String(stage.order).padStart(2, '0')} · {tone.label}
                    </div>
                    <div className="text-[11px] font-semibold text-[var(--app-text-primary)] truncate">
                      {th ? stage.labelTh : stage.labelEn}
                    </div>
                  </div>
                  {stage.status === 'COMPLETED' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--z-ok)] shrink-0" aria-hidden="true" />
                  ) : stage.status === 'RUNNING' ? (
                    <Loader2 className="w-3.5 h-3.5 text-[var(--app-accent)] animate-spin shrink-0" aria-hidden="true" />
                  ) : stage.status === 'FAILED' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-[var(--z-danger)] shrink-0" aria-hidden="true" />
                  ) : (
                    <CircleDashed className="w-3.5 h-3.5 text-[var(--app-text-secondary)] shrink-0" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <TaskExecutionProgressBar
          snapshot={workflowSnapshot}
          logs={workflowLogs}
          goal={workflowGoal || goal}
          lang={lang}
          verificationHash={workflowVerificationHash}
          activeFilterStageId={activeFilterStageId}
          onStageClick={onStageClick}
          onInspectStageInTerminal={onInspectStageInTerminal}
          onStartTask={() => {
            if (!browserOnline) return;
            if (onRunTask && onGoalChange) onRunTask();
            else onOpenQuickTask();
          }}
          onRetryTask={onRetryQuickTask}
        />

        {showWorkflowStepper && (
          <WorkflowStepper
            activeStageIndex={workflowSnapshot.activeStageIndex}
            stageStatuses={workflowSnapshot.stageStatuses}
            stages={workflowSnapshot.stages}
            totalLogs={workflowSnapshot.totalLogs}
            totalDurationMs={workflowSnapshot.totalDurationMs}
            goal={workflowSnapshot.goal}
            lang={lang}
            activeFilterStageId={activeFilterStageId}
            onStageClick={onStageClick}
            onClearStageFilter={onClearStageFilter}
            onOpenQuickTask={onOpenQuickTask}
            onInspectStageInTerminal={onInspectStageInTerminal}
            onRetryQuickTask={onRetryQuickTask}
          />
        )}
      </section>

      {/* 6. Session Sentiment Trend (Preserved for Alt+V shortcut & tests when logs exist) */}
      {workflowLogs.length > 0 && (
        <section
          aria-label={th ? 'แนวโน้ม Sentiment ของการประมวลผล' : 'Session Sentiment Trend'}
          data-testid="command-center-sentiment-trend"
          className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-card)] px-4 py-3 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <Activity className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" aria-hidden="true" />
              <span className="font-medium text-[var(--app-text-primary)]">
                {th ? 'แนวโน้ม Sentiment ของงาน' : 'Session Sentiment Trend'}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--app-text-secondary)]">
                {th ? 'คะแนนสุทธิ' : 'Score'}:{' '}
                <strong
                  className={
                    sentimentTrendData.netScore > 0
                      ? 'text-[var(--z-ok)]'
                      : sentimentTrendData.netScore < 0
                        ? 'text-[var(--z-danger)]'
                        : 'text-[var(--app-accent)]'
                  }
                >
                  {sentimentTrendData.netScore > 0 ? `+${sentimentTrendData.netScore}` : sentimentTrendData.netScore}
                </strong>
              </span>
              <span className="font-mono text-[10px] tabular-nums text-[var(--app-text-secondary)]">
                +{sentimentTrendData.completionCount} · 0:{sentimentTrendData.neutralCount} · -{sentimentTrendData.errorCount}
              </span>
            </div>
            <button
              type="button"
              data-testid="command-center-toggle-sentiment-trend"
              aria-pressed={isSentimentTrendVisible}
              onClick={handleToggleSentimentTrend}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-2.5 py-1 text-[11px] font-mono text-[var(--app-text-primary)] hover:border-[var(--app-accent)] transition-colors cursor-pointer"
              title={th ? 'แสดง/ซ่อนกราฟ Sentiment (Alt+V)' : 'Toggle sentiment trend chart (Alt+V)'}
            >
              <span>{isSentimentTrendVisible ? (th ? 'ซ่อนกราฟ' : 'Hide Chart') : (th ? 'แสดงกราฟ' : 'Show Chart')}</span>
              <kbd className="px-1 py-0.2 rounded border border-[var(--app-card-border)] text-[9px] text-[var(--app-text-secondary)]">
                Alt+V
              </kbd>
            </button>
          </div>

          {isSentimentTrendVisible && (
            <div
              data-testid="command-center-sentiment-trend-chart"
              className="pt-2 border-t border-[var(--app-card-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <svg
                viewBox="0 0 100 32"
                className="w-full sm:max-w-[260px] h-10 overflow-visible"
                role="img"
                aria-label={th ? 'กราฟเส้นแนวโน้ม Sentiment' : 'Session Sentiment Trend Chart'}
              >
                <line
                  x1="0"
                  y1="16"
                  x2="100"
                  y2="16"
                  stroke="color-mix(in srgb, var(--app-text-secondary) 25%, transparent)"
                  strokeDasharray="2 2"
                  strokeWidth="0.6"
                />
                <polyline
                  fill="none"
                  stroke="var(--app-accent)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={sentimentTrendData.polylinePoints}
                />
                {sentimentTrendData.points.map((pt) => (
                  <circle
                    key={pt.index}
                    cx={pt.x}
                    cy={pt.y}
                    r={pt.kind === 'neutral' ? 1.4 : 2.3}
                    fill={
                      pt.kind === 'error'
                        ? 'var(--z-danger)'
                        : pt.kind === 'completion'
                          ? 'var(--z-ok)'
                          : 'var(--app-accent)'
                    }
                  />
                ))}
              </svg>
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-[var(--app-text-secondary)]">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--z-ok)]" />
                  {th ? 'สำเร็จ (+1)' : 'Completion (+1)'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--app-accent)]" />
                  {th ? 'ทั่วไป (0)' : 'Neutral (0)'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--z-danger)]" />
                  {th ? 'ผิดพลาด (-1)' : 'Error (-1)'}
                </span>
              </div>
            </div>
          )}
        </section>
      )}
      {/* 7. Full-Screen Maximized Execution Terminal Overlay (Mobile-Keyboard Safe) */}
      {terminalMode === 'maximized' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={th ? 'แผงควบคุม Terminal แบบเต็มจอ' : 'Maximized Execution Terminal'}
          data-testid="command-center-maximized-terminal"
          className="fixed inset-0 z-[80] flex flex-col w-full h-[100dvh] bg-[var(--app-bg)] text-[var(--app-text-primary)] overflow-hidden"
        >
          {/* Sticky Top Terminal Bar */}
          <header className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-[var(--app-card-border)] bg-[var(--app-surface)]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] border border-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] flex items-center justify-center text-[var(--app-accent)] shrink-0">
                <Terminal className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold tracking-tight truncate">
                    {th ? 'Execution Terminal' : 'Execution Terminal'}
                  </h3>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--app-text-secondary)]">
                    · {workflowLogs.length} {th ? 'บรรทัด' : 'lines'}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-[var(--app-text-secondary)] truncate">
                  {isWorkflowRunning
                    ? (th ? 'กำลังประมวลผลแบบสด...' : 'Streaming execution...')
                    : workflowDone
                      ? (th ? 'เสร็จสิ้นการทำงาน' : 'Execution finished')
                      : (th ? 'พร้อมรับคำสั่ง' : 'Ready for command')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="terminal-minimize-btn"
                onClick={() => setTerminalMode('minimized')}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-card)] text-xs font-medium text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer whitespace-nowrap"
              >
                <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{th ? 'ย่อ' : 'Minimize'}</span>
              </button>
              <button
                type="button"
                data-testid="terminal-close-btn"
                onClick={() => setTerminalMode('closed')}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,var(--app-card))] text-xs font-semibold text-[var(--z-danger)] hover:brightness-110 cursor-pointer whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{th ? 'ปิด' : 'Close'}</span>
              </button>
            </div>
          </header>

          {/* Top Sticky Command Input Band — anchored above log stream so mobile keyboard NEVER covers typing */}
          <div className="shrink-0 px-4 sm:px-6 py-3 border-b border-[var(--app-card-border)] bg-[var(--app-card)] space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-stretch gap-2.5">
              <textarea
                ref={terminalInputRef}
                data-testid="terminal-command-input"
                value={goal}
                onChange={(e) => onGoalChange?.(e.target.value.slice(0, MAX_GOAL_CHARS))}
                readOnly={!onGoalChange}
                rows={2}
                maxLength={MAX_GOAL_CHARS}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (browserOnline && !isWorkflowRunning && goal.trim()) {
                      if (onRunTask && onGoalChange) onRunTask();
                      else onOpenQuickTask();
                    }
                  }
                }}
                placeholder={
                  th
                    ? 'พิมพ์คำสั่งที่นี่ (Ctrl+Enter เพื่อรัน)...'
                    : 'Type command or goal here (Ctrl+Enter to run)...'
                }
                aria-label={th ? 'ช่องพิมพ์คำสั่ง Terminal' : 'Terminal command input'}
                className="flex-1 resize-none rounded-lg border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-3.5 py-2.5 text-base sm:text-sm text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]/70 outline-none focus:border-[var(--app-accent)]"
              />
              <div className="flex items-center justify-end gap-2 shrink-0">
                {workflowLogs.some((l) => /\[ERROR\]/i.test(l)) && !isWorkflowRunning && onRetryQuickTask && (
                  <button
                    type="button"
                    onClick={onRetryQuickTask}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] text-xs font-semibold text-[var(--z-danger)] hover:brightness-110 cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{th ? 'ลองใหม่' : 'Retry'}</span>
                  </button>
                )}
                <button
                  type="button"
                  data-testid="terminal-run-btn"
                  onClick={() => {
                    if (!browserOnline) return;
                    if (onRunTask && onGoalChange) onRunTask();
                    else onOpenQuickTask();
                  }}
                  disabled={!browserOnline || isWorkflowRunning || !goal.trim()}
                  className="min-h-[44px] flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-[var(--app-accent-deep)] text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {isWorkflowRunning
                      ? (th ? 'กำลังรัน…' : 'Running…')
                      : (th ? 'เริ่มดำเนินงาน' : 'Run')}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[var(--app-text-secondary)]">
              <span>
                {th
                  ? 'พิมพ์ด้านบนแล้วเลื่อนดูบันทึกการทำงานด้านล่างได้ทันที (ไม่โดนคีย์บอร์ดบัง)'
                  : 'Input stays pinned at top; scroll execution logs freely below.'}
              </span>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={terminalAutoScroll}
                    onChange={(e) => setTerminalAutoScroll(e.target.checked)}
                    className="accent-[var(--app-accent)]"
                  />
                  <span>{th ? 'เลื่อนตามอัตโนมัติ' : 'Auto-scroll'}</span>
                </label>
                {workflowLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const el = terminalLogsContainerRef.current;
                      if (el) el.scrollTop = el.scrollHeight;
                    }}
                    className="text-[var(--app-accent)] hover:underline cursor-pointer"
                  >
                    {th ? 'ไปบรรทัดล่าสุด ↓' : 'Latest ↓'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Scrollable Execution Logs Area */}
          <div
            ref={terminalLogsContainerRef}
            data-testid="terminal-logs-scroll-area"
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 pb-12 font-mono text-xs sm:text-[13px] leading-relaxed bg-[var(--app-bg)]"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {workflowLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 text-[var(--app-text-secondary)] space-y-2">
                <Terminal className="w-6 h-6 text-[var(--app-accent)] opacity-75" aria-hidden="true" />
                <p className="text-xs font-sans">
                  {th
                    ? 'ยังไม่มีบันทึกการทำงาน — พิมพ์คำสั่งด้านบนแล้วกด เริ่มดำเนินงาน'
                    : 'No execution logs yet — enter a command above and tap Run.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {workflowLogs.map((line, idx) => {
                  const isError = /\[ERROR\]|FAIL_CLOSED|blocked/i.test(line);
                  const isDone = !isError && /\[DONE\]|VERIFIED|passed/i.test(line);
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 rounded px-2 py-1 ${
                        isError
                          ? 'bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] text-[var(--z-danger)]'
                          : isDone
                            ? 'bg-[color-mix(in_srgb,var(--z-ok)_8%,transparent)] text-[var(--z-ok)]'
                            : 'text-[var(--app-text-primary)]'
                      }`}
                    >
                      <span className="shrink-0 select-none text-[11px] tabular-nums text-[var(--app-text-secondary)] w-8 text-right">
                        {idx + 1}
                      </span>
                      <span className="min-w-0 break-words whitespace-pre-wrap">{line}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
