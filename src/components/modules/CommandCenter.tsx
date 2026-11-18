import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SystemStatusData, ModuleId, StatusLevel, EvidenceDrawerItem, TrainingProgressAlert, TimeToEpochEstimate } from '../../types';
import { StatusDot } from '../ui/StatusBadge';
import { WorkflowStepper } from '../WorkflowStepper';
import { TaskExecutionProgressBar } from '../TaskExecutionProgressBar';
import {
  deriveWorkflowSnapshot,
  type WorkflowStageId,
  type WorkflowStageState,
} from '../../utils/workflowStages';
import { useLanguage } from '../../context/LanguageContext';
import {
  Activity, AlertTriangle, ArrowRight, BrainCircuit, Calculator, Clock, Code2, Eye, EyeOff, FlaskConical, Gauge, Layers, RefreshCw, ShieldCheck
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
  showSentimentTrend?: boolean;
  onToggleSentimentTrend?: () => void;
}

const DEFAULT_TRAINING_TARGET_STEPS = 5800;
const TARGET_MODEL_PARAMS = 41_527_808;

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Number((cx + radius * Math.cos(rad)).toFixed(2)),
    y: Number((cy + radius * Math.sin(rad)).toFixed(2)),
  };
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

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

const STALL_THRESHOLD_MS = 5 * 60 * 1000;

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

const TIME_TO_EPOCH_WINDOW = 10;

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
  showSentimentTrend: controlledShowSentimentTrend,
  onToggleSentimentTrend,
}) => {
  const { lang } = useLanguage();
  const fallbackSentimentShortcut = useSentimentTrendShortcut({
    enabled: onToggleSentimentTrend === undefined,
  });
  const isSentimentTrendVisible =
    controlledShowSentimentTrend ?? fallbackSentimentShortcut.showSentimentTrend;
  const handleToggleSentimentTrend =
    onToggleSentimentTrend ?? fallbackSentimentShortcut.toggleSentimentTrend;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const goalInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const isDispatchAvailable = Boolean(onRunTask && onGoalChange);
  const MAX_ATTACHMENT_BYTES = 200 * 1024;
  const MAX_GOAL_CHARS = 250000;
  const allowedAttachment = /\.(txt|md|json|csv|ya?ml|toml|ini|js|jsx|ts|tsx|py|sql|html|css|xml|sh|c|cpp|h|go|rs)$/i;

  const handleAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setAttachmentError('');
    if (!file) return;
    if (!allowedAttachment.test(file.name)) {
      setAttachmentError(lang === 'th' ? 'รองรับเฉพาะไฟล์ข้อความและ Source Code' : 'Only text and source-code files are supported.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachmentError(lang === 'th' ? 'ไฟล์ต้องมีขนาดไม่เกิน 200 KB' : 'File must be 200 KB or smaller.');
      return;
    }
    try {
      const content = await file.text();
      const block = `\n\n[ATTACHED FILE: ${file.name}]\n${content}\n[/ATTACHED FILE]`;
      if ((goal + block).length > MAX_GOAL_CHARS) {
        setAttachmentError(
          lang === 'th'
            ? `คำสั่งรวมไฟล์แนบต้องไม่เกิน ${MAX_GOAL_CHARS.toLocaleString()} ตัวอักษร`
            : `Task and attachment must stay within ${MAX_GOAL_CHARS.toLocaleString()} characters.`
        );
        return;
      }
      onGoalChange?.(`${goal}${block}`);
    } catch {
      setAttachmentError(lang === 'th' ? 'อ่านไฟล์ไม่สำเร็จ' : 'Unable to read the selected file.');
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

  const model = statusData?.model;
  const audit = statusData?.audit;
  const training = statusData?.training ?? null;
  const inferenceReady = Boolean(model?.inferenceReady && model?.weightsLoaded);
  const runtimeStatus: StatusLevel = inferenceReady ? 'VERIFIED' : 'BLOCKED';
  const checkpointStatus: StatusLevel = model?.weightsLoaded ? 'VERIFIED' : 'BLOCKED';
  const auditStatus: StatusLevel = audit?.chainValid === true
    ? 'VERIFIED'
    : audit?.chainValid === false ? 'BLOCKED' : 'UNVERIFIED';
  const th = lang === 'th';

  const targetSteps = training?.targetSteps && training.targetSteps > 0
    ? training.targetSteps
    : DEFAULT_TRAINING_TARGET_STEPS;
  const currentStep = training ? Math.max(0, Math.min(targetSteps, training.currentStep)) : 0;
  const rawPct = targetSteps > 0 ? (currentStep / targetSteps) * 100 : 0;
  const clampedPct = Math.max(0, Math.min(100, rawPct));
  const formattedPct = clampedPct === 0 || clampedPct === 100 ? clampedPct.toFixed(0) : clampedPct.toFixed(1);
  const visibleArcPct = currentStep > 0 ? Math.max(1.2, clampedPct) : 0;

  const trainingStatusKey = !statusData
    ? 'CHECKING'
    : training?.running
      ? 'ACTIVE'
      : training?.status || 'BLOCKED';
  const trainingStatusLabel = !statusData
    ? (th ? 'CHECKING' : 'CHECKING')
    : training?.running
      ? 'RUNNING'
      : training?.status || 'BLOCKED';

  // Client-side stall tracker (detects >5m with no step increase during active training)
  // and rolling 10-step duration observer when polling between backend eval checkpoints.
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
          title: th ? 'Validation Loss มีแนวโน้มสูงขึ้นผิดปกติ' : 'Validation loss trending upward',
          detail: th
            ? `ค่า Validation Loss เพิ่มขึ้น +${delta.toFixed(4)} (${prev2.toFixed(4)} → ${prev1.toFixed(4)} → ${latest.toFixed(4)})`
            : `Validation loss increased +${delta.toFixed(4)} (${prev2.toFixed(4)} → ${prev1.toFixed(4)} → ${latest.toFixed(4)}) over recent evaluations.`,
          detectedAt: new Date(nowMs).toISOString(),
        });
      }
    }
    return Array.from(merged.values());
  }, [training?.alerts, training?.running, training?.recentValLosses, nowMs, th]);

  // Smooth Blue (#3B82F6 at 0%) -> Emerald (#10B981 at 100%) percentage fill color-coding
  const gaugeFillStart = clampedPct >= 75 ? '#0EA5E9' : '#3B82F6';
  const gaugeFillEnd = interpolateBlueToEmerald(clampedPct);

  const arcCx = 110;
  const arcCy = 96;
  const arcRadius = 74;
  const arcStart = 150;
  const arcEnd = 390;
  const arcPath = describeArc(arcCx, arcCy, arcRadius, arcStart, arcEnd);
  const milestoneTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const angle = arcStart + (arcEnd - arcStart) * fraction;
    const inner = polarToCartesian(arcCx, arcCy, arcRadius - 11, angle);
    const outer = polarToCartesian(arcCx, arcCy, arcRadius - 5, angle);
    const stepValue = Math.round(targetSteps * fraction);
    return { fraction, inner, outer, stepValue };
  });

  const saveEvery = training?.saveEvery ?? 100;
  const evalEvery = training?.evalEvery ?? 25;
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
  const maxStepBarSec =
    timeToEpoch.recentStepDurationsSec.length > 0
      ? Math.max(...timeToEpoch.recentStepDurationsSec, 0.001)
      : 1;

  const milestoneSegments = 10;
  const stepsPerSegment = targetSteps / milestoneSegments;

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="vivid-command-hero relative overflow-hidden rounded-[28px] border border-[var(--app-card-border)] p-5 md:p-8">
        <img
          src="/assets/zyntheor-rainbow-neural.svg"
          alt=""
          aria-hidden="true"
          className="vivid-command-hero-art"
        />
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] font-bold tracking-[.18em] text-white/75 backdrop-blur">
            <span className={`vivid-status-dot ${inferenceReady ? 'is-ready' : 'is-blocked'}`} />
            {inferenceReady ? 'SYSTEM ONLINE' : 'RUNTIME BLOCKED'}
          </div>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-white md:text-5xl">
            Command <span className="vivid-rainbow-text">Center</span>
          </h1>
          <p className="mt-2 text-sm text-slate-200/80 md:text-base">Intelligence Without Boundaries.</p>
        </div>
        <div className="vivid-hero-orbit" aria-hidden="true"><span /><span /><span /></div>
      </section>

      <section className="rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-4 md:p-5 space-y-3" aria-label="Direct task dispatch">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[var(--app-text-primary)]">{th ? 'คุณต้องการให้ ZYNTHEOR ทำอะไร?' : 'What should ZYNTHEOR do?'}</h2>
          </div>
        </div>
        <textarea
          ref={goalInputRef}
          value={goal}
          onChange={(event) => onGoalChange?.(event.target.value.slice(0, MAX_GOAL_CHARS))}
          readOnly={!onGoalChange}
          rows={4}
          maxLength={MAX_GOAL_CHARS}
          placeholder={th ? 'อธิบายงานที่ต้องการ เช่น สร้างเว็บไซต์ วิเคราะห์ข้อมูล หรือวิจัยหัวข้อ...' : 'Describe the work: build a website, analyze data, research a topic…'}
          className="w-full resize-y rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-3.5 py-3 text-sm text-[var(--app-text-primary)] outline-none focus:border-[var(--app-accent)]"
        />
        <input ref={fileInputRef} type="file" accept=".txt,.md,.json,.csv,.yaml,.yml,.toml,.ini,.js,.jsx,.ts,.tsx,.py,.sql,.html,.css,.xml,.sh,.c,.cpp,.h,.go,.rs" className="hidden" onChange={handleAttachment} />
        {attachmentError && <p role="alert" className="text-xs text-[var(--z-danger)]">{attachmentError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] text-[var(--app-text-secondary)]">{goal.length.toLocaleString()} / {MAX_GOAL_CHARS.toLocaleString()} {lang === 'th' ? 'ตัวอักษร' : 'characters'}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="command-center-attach-file-btn" onClick={() => fileInputRef.current?.click()} disabled={!onGoalChange || isWorkflowRunning} className="rounded-lg border border-[var(--app-card-border)] px-3 py-2 text-xs font-semibold text-[var(--app-text-primary)] disabled:opacity-40 cursor-pointer">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden="true">＋</span>{lang === 'th' ? 'แนบไฟล์' : 'Attach file'}</span>
            </button>
            <button type="button" data-testid="command-center-run-task-btn" onClick={() => { if (onRunTask && onGoalChange) onRunTask(); else onOpenQuickTask(); }} disabled={isWorkflowRunning || !goal.trim()} className="rounded-lg bg-[var(--app-accent)] px-4 py-2 text-xs font-bold text-black disabled:opacity-40 cursor-pointer">
              {isWorkflowRunning ? (lang === 'th' ? 'กำลังดำเนินงาน…' : 'Executing…') : (lang === 'th' ? 'เริ่มดำเนินงาน' : 'Run task')}
            </button>
          </div>
        </div>
        {!isDispatchAvailable && <p className="text-[10px] text-[var(--app-text-secondary)]">{lang === 'th' ? 'กำลังใช้ Quick Task Modal เนื่องจากยังไม่ได้เชื่อม Direct Dispatch' : 'Quick Task Modal is used until direct dispatch props are connected.'}</p>}
      </section>

      <section aria-label="Primary modules" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          { id: 'research_lab', icon: <FlaskConical size={18} />, name: 'ResearchLab', desc: th ? 'ค้นคว้าและวิเคราะห์' : 'Research & analysis' },
          { id: 'dev_studio', icon: <Code2 size={18} />, name: 'DevStudio', desc: th ? 'สร้างซอฟต์แวร์' : 'Build software' },
          { id: 'model_laboratory', icon: <BrainCircuit size={18} />, name: 'ModelLaboratory', desc: th ? 'โมเดลและการฝึก' : 'Models & training' },
          { id: 'governance_security', icon: <ShieldCheck size={18} />, name: 'Evidence Ledger', desc: th ? 'ผลตรวจสอบและหลักฐาน' : 'Verification & evidence' },
        ] as Array<{ id: ModuleId; icon: React.ReactNode; name: string; desc: string }>).map((m) => (
          <button
            key={m.id}
            type="button"
            data-testid={`command-center-shortcut-${m.id}`}
            onClick={() => onNavigate(m.id)}
            className="flex min-h-[72px] cursor-pointer flex-col items-start gap-1 rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-surface)] p-3 text-left hover:border-[var(--app-accent)]"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text-primary)]">{m.icon}{m.name}</span>
            <span className="text-[11px] text-[var(--app-text-secondary)]">{m.desc}</span>
          </button>
        ))}
      </section>

      <section
        aria-label={th ? 'ตัววัดความคืบหน้าการฝึก 5,800 ขั้นตอน' : '5,800-Step Training Progress Gauge'}
        data-testid="training-progress-gauge-section"
        className="rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-4 md:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--app-card-border)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Gauge className="w-4 h-4 shrink-0 text-[var(--app-accent)]" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-[var(--app-text-primary)] truncate">
                {th ? 'ความคืบหน้าการฝึก NativeLM · เป้าหมาย 5,800 ขั้นตอน' : 'NativeLM Training Progress · 5,800-Step Target'}
              </h2>
              <p className="text-[11px] text-[var(--app-text-secondary)] font-mono tabular-nums truncate">
                {training?.pipelineId
                  ? `${training.pipelineId} · ${(training.targetParams ?? TARGET_MODEL_PARAMS).toLocaleString()} params`
                  : `${TARGET_MODEL_PARAMS.toLocaleString()} target params · /api/system/status`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <StatusDot
              status={trainingStatusKey}
              label={trainingStatusLabel}
              detail={
                training?.error
                  ? training.error
                  : blockers.length > 0
                    ? blockers.join(', ')
                    : `${currentStep} / ${targetSteps} steps`
              }
            />
            {onRefreshStatus && (
              <button
                type="button"
                onClick={onRefreshStatus}
                disabled={isRefreshingStatus}
                aria-label={th ? 'รีเฟรชสถานะการฝึก' : 'Refresh training status'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--app-text-primary)] hover:border-[var(--app-accent)] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{th ? 'อัปเดต' : 'Refresh'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('research_lab')}
              className="vivid-inline-link whitespace-nowrap"
            >
              {th ? 'เปิด Training Pipeline' : 'Training pipeline'} <ArrowRight size={13} />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-[230px_1fr] gap-6 items-center">
          {/* Precision 240-degree SVG Arc Gauge */}
          <div className="flex flex-col items-center justify-center">
            <div className="relative w-[220px] h-[154px]">
              <svg
                viewBox="0 0 220 154"
                className="w-full h-full overflow-visible"
                role="img"
                aria-label={
                  th
                    ? `เกจวัดความคืบหน้าการฝึก ${currentStep.toLocaleString()} จาก ${targetSteps.toLocaleString()} ขั้นตอน (${formattedPct}%)`
                    : `Training step gauge: ${currentStep.toLocaleString()} of ${targetSteps.toLocaleString()} steps (${formattedPct}%)`
                }
              >
                <defs>
                  <linearGradient id="zyntheor-training-gauge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={gaugeFillStart} style={{ transition: 'stop-color 600ms ease' }} />
                    <stop offset="100%" stopColor={gaugeFillEnd} style={{ transition: 'stop-color 600ms ease' }} />
                  </linearGradient>
                </defs>

                {/* Base 240-degree Track */}
                <path
                  d={arcPath}
                  fill="none"
                  stroke="color-mix(in srgb, var(--app-text-secondary) 20%, transparent)"
                  strokeWidth="12"
                  strokeLinecap="round"
                  pathLength={100}
                />

                {/* Real-time Step Progress Arc (smooth CSS transition, Blue -> Emerald fill) */}
                <path
                  d={arcPath}
                  fill="none"
                  stroke="url(#zyntheor-training-gauge-grad)"
                  strokeWidth="12"
                  strokeLinecap="round"
                  pathLength={100}
                  strokeDasharray="100 100"
                  strokeDashoffset={100 - visibleArcPct}
                  style={{
                    opacity: visibleArcPct > 0 ? 1 : 0,
                    transition: 'stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1), stroke 600ms ease, opacity 300ms ease',
                  }}
                />

                {/* Perimeter Graduation Ticks */}
                {milestoneTicks.map((tick) => {
                  const reached = currentStep >= tick.stepValue && currentStep > 0;
                  return (
                    <line
                      key={tick.fraction}
                      x1={tick.inner.x}
                      y1={tick.inner.y}
                      x2={tick.outer.x}
                      y2={tick.outer.y}
                      stroke={reached ? gaugeFillEnd : 'color-mix(in srgb, var(--app-text-secondary) 40%, transparent)'}
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      style={{ transition: 'stroke 500ms ease' }}
                    />
                  );
                })}

                {/* Endpoint Step Bounds */}
                <text
                  x="38"
                  y="147"
                  textAnchor="middle"
                  className="fill-[var(--app-text-secondary)] text-[10px] font-mono"
                >
                  0
                </text>
                <text
                  x="182"
                  y="147"
                  textAnchor="middle"
                  className="fill-[var(--app-text-secondary)] text-[10px] font-mono"
                >
                  {targetSteps.toLocaleString()}
                </text>
              </svg>

              {/* Center Readout */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-3">
                <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--app-text-secondary)]">
                  {th ? 'ขั้นตอนปัจจุบัน' : 'STEP'}
                </span>
                <span
                  data-testid="training-gauge-current-step"
                  className="mt-0.5 font-mono text-3xl font-bold leading-none tabular-nums text-[var(--app-text-primary)]"
                >
                  {statusData ? currentStep.toLocaleString() : '—'}
                </span>
                <span
                  data-testid="training-gauge-target-steps"
                  className="mt-1 font-mono text-[11px] tabular-nums text-[var(--app-text-secondary)]"
                >
                  / {targetSteps.toLocaleString()} (
                  <span
                    data-testid="training-gauge-pct"
                    className="font-semibold transition-colors duration-500"
                    style={{ color: statusData && currentStep > 0 ? gaugeFillEnd : undefined }}
                  >
                    {statusData ? `${formattedPct}%` : '—'}
                  </span>
                  )
                </span>
              </div>
            </div>
          </div>

          {/* Segmented Checkpoint Bar & Live Telemetry Grid */}
          <div className="space-y-4 min-w-0">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-2">
                <span className="font-semibold text-[var(--app-text-primary)]">
                  {th ? 'ความคืบหน้าแบบแบ่งช่วง Checkpoint' : 'Checkpoint Milestone Progression'}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--app-text-secondary)]">
                  {th
                    ? `ประเมินผลทุก ${evalEvery} ขั้น · บันทึก Checkpoint ทุก ${saveEvery} ขั้น`
                    : `Eval every ${evalEvery} steps · Save every ${saveEvery} steps`}
                </span>
              </div>

              {/* Accessible Linear Progressbar + 10-Stage Milestone Segments */}
              <div
                role="progressbar"
                aria-label={th ? 'ความคืบหน้าขั้นตอนการฝึก 5,800 ขั้นตอน' : '5,800-step training progress'}
                aria-valuenow={currentStep}
                aria-valuemin={0}
                aria-valuemax={targetSteps}
                aria-valuetext={`${currentStep.toLocaleString()} / ${targetSteps.toLocaleString()} (${formattedPct}%)`}
                className="grid grid-cols-10 gap-1"
              >
                {Array.from({ length: milestoneSegments }, (_, idx) => {
                  const segStart = idx * stepsPerSegment;
                  const segEnd = (idx + 1) * stepsPerSegment;
                  const segFill =
                    currentStep <= segStart
                      ? 0
                      : currentStep >= segEnd
                        ? 100
                        : ((currentStep - segStart) / stepsPerSegment) * 100;
                  return (
                    <div
                      key={idx}
                      title={`${Math.round(segStart).toLocaleString()}–${Math.round(segEnd).toLocaleString()}`}
                      className="h-2.5 rounded-sm overflow-hidden bg-[color-mix(in_srgb,var(--app-text-secondary)_16%,transparent)]"
                    >
                      <div
                        className="h-full"
                        style={{
                          width: `${segFill}%`,
                          backgroundColor: gaugeFillEnd,
                          transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1), background-color 600ms ease',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] tabular-nums text-[var(--app-text-secondary)]">
                <span>0</span>
                <span>{Math.round(targetSteps * 0.25).toLocaleString()}</span>
                <span>{Math.round(targetSteps * 0.5).toLocaleString()}</span>
                <span>{Math.round(targetSteps * 0.75).toLocaleString()}</span>
                <span>{targetSteps.toLocaleString()}</span>
              </div>
            </div>

            {/* Stall (>5 min) & Validation Loss Upward-Trend Warning Alert */}
            {trainingAlerts.length > 0 && (
              <div
                role="alert"
                data-testid="training-alert-banner"
                className="rounded-xl border border-[color-mix(in_srgb,var(--z-warn)_48%,transparent)] bg-[color-mix(in_srgb,var(--z-warn)_11%,var(--app-surface))] px-3.5 py-3 space-y-1.5"
              >
                {trainingAlerts.map((alert) => (
                  <div key={alert.id} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                    <div className="flex items-start gap-2 min-w-0">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--z-warn)]" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="font-bold text-[var(--z-warn)]">
                          {alert.id === 'stalled_progress'
                            ? (th ? 'คำเตือน: ความคืบหน้าการฝึกหยุดชะงัก' : alert.title)
                            : (th ? 'คำเตือน: Validation Loss มีแนวโน้มสูงขึ้น' : alert.title)}
                        </div>
                        <div className="font-mono text-[11px] text-[var(--app-text-primary)] break-words">
                          {alert.detail}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('research_lab')}
                      className="text-[11px] font-semibold text-[var(--z-warn)] hover:underline cursor-pointer shrink-0"
                    >
                      {th ? 'ตรวจสอบใน ResearchLab' : 'Inspect in ResearchLab'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Current Epoch & Estimated Time Remaining Display */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[var(--app-card-border)]">
              <div
                data-testid="training-gauge-epoch"
                className="flex items-start gap-3 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3.5 py-3"
              >
                <Layers className="w-4 h-4 shrink-0 mt-0.5 text-[var(--app-accent)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--app-text-secondary)]">
                    {th ? 'Epoch ปัจจุบัน (รอบการฝึก 5,800 ขั้น)' : 'Current Epoch (5,800-Step Cycle)'}
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-mono text-lg font-bold leading-none tabular-nums text-[var(--app-text-primary)]">
                      {statusData ? `Epoch ${currentEpoch} / ${totalEpochs}` : '—'}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--app-text-secondary)]">
                      {statusData
                        ? `· ${th ? 'ช่วง' : 'Window'} ${completedCheckpointCycles}/${plannedCheckpointsCount}`
                        : ''}
                    </span>
                  </div>
                </div>
              </div>

              <div
                data-testid="training-gauge-eta"
                className="flex items-start gap-3 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3.5 py-3"
              >
                <Clock className="w-4 h-4 shrink-0 mt-0.5 text-[var(--app-accent)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--app-text-secondary)]">
                    {th ? 'เวลาที่เหลือโดยประมาณ (ETA)' : 'Est. Time Remaining (ETA)'}
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-lg font-bold leading-none tabular-nums text-[var(--app-text-primary)]">
                      {!statusData
                        ? '—'
                        : training?.trainingCompletedVerified && currentStep >= targetSteps
                          ? '0s'
                          : estimatedRemaining !== null
                            ? formatDuration(estimatedRemaining)
                            : '—'}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--app-text-secondary)]">
                      {!statusData
                        ? ''
                        : secondsPerStep !== null && (training?.running || timeToEpoch.windowSteps > 0)
                          ? `· ${secondsPerStep.toFixed(2)}s/step (${timeToEpoch.windowSteps > 0 ? `${timeToEpoch.windowSteps}/10` : 'run'})${elapsedSeconds !== null ? ` · ${th ? 'ผ่านไป' : 'Elapsed'} ${formatDuration(elapsedSeconds)}` : ''}`
                          : training?.trainingCompletedVerified && elapsedSeconds !== null
                            ? `· ${th ? 'รวมเวลา' : 'Total'} ${formatDuration(elapsedSeconds)}`
                            : training?.status === 'BLOCKED'
                              ? (th ? '· รอปลดล็อก Gate เพื่อวัดความเร็ว' : '· Blocked until gates pass')
                              : (th ? '· รอข้อมูลความเร็วจาก 10 ขั้นล่าสุด' : '· Awaiting step history')}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Time-to-Epoch Calculator (Historical Average of Last 10 Completed Steps) */}
            <div
              data-testid="time-to-epoch-calculator"
              className="pt-3 border-t border-[var(--app-card-border)] space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Calculator className="w-3.5 h-3.5 shrink-0 text-[var(--app-accent)]" aria-hidden="true" />
                  <span className="text-xs font-semibold text-[var(--app-text-primary)]">
                    {th ? 'ตัวคำนวณเวลาเสร็จสิ้น Epoch (Time-to-Epoch)' : 'Time-to-Epoch Calculator'}
                  </span>
                  <span className="text-[11px] text-[var(--app-text-secondary)]">
                    <span aria-hidden="true">·</span>{' '}
                    {th ? 'เฉลี่ยจาก 10 ขั้นตอนล่าสุด' : 'Last 10 completed steps avg'}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="time-to-epoch-toggle-manual"
                  onClick={() => setShowCustomPaceCalc((v) => !v)}
                  className="text-[11px] font-semibold text-[var(--app-accent)] hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  {showCustomPaceCalc
                    ? (th ? 'ซ่อนตัวคำนวณวางแผน' : 'Hide planning input')
                    : (th ? 'คำนวณความเร็ววางแผน' : 'What-if pace')}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">
                    {th ? 'เวลาที่เหลือถึงจบ Epoch' : 'Time-to-Epoch'}
                  </div>
                  <div
                    data-testid="time-to-epoch-value"
                    className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--app-text-primary)]"
                  >
                    {!statusData
                      ? '—'
                      : timeToEpoch.basis === 'completed'
                        ? '0s'
                        : timeToEpoch.estimatedSecondsToEpoch !== null
                          ? formatDuration(timeToEpoch.estimatedSecondsToEpoch)
                          : '—'}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">
                    {th ? 'ค่าเฉลี่ย 10 ขั้นล่าสุด' : 'Last-10-Step Avg'}
                  </div>
                  <div
                    data-testid="time-to-epoch-avg-step"
                    className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--app-text-primary)]"
                  >
                    {timeToEpoch.averageStepSeconds !== null
                      ? `${timeToEpoch.averageStepSeconds.toFixed(3)}s/step`
                      : '—'}
                    <span className="ml-1.5 text-[11px] font-normal text-[var(--app-text-secondary)]">
                      ({timeToEpoch.windowSteps}/{timeToEpoch.maxWindowSteps})
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">
                    {th ? 'ขั้นตอนคงเหลือใน Epoch' : 'Remaining in Epoch'}
                  </div>
                  <div
                    data-testid="time-to-epoch-remaining-steps"
                    className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--app-text-primary)]"
                  >
                    {statusData ? timeToEpoch.remainingStepsInEpoch.toLocaleString() : '—'}
                    <span className="ml-1.5 text-[11px] font-normal text-[var(--app-text-secondary)]">
                      {statusData ? `/ ${targetSteps.toLocaleString()} steps` : ''}
                    </span>
                  </div>
                </div>
              </div>

              {/* 10-slot Historical Step Duration Window */}
              <div className="space-y-1.5">
                <div className="grid grid-cols-10 gap-1 items-end h-7" aria-label={th ? 'กราฟระยะเวลา 10 ขั้นตอนล่าสุด' : 'Last 10 completed step durations'}>
                  {Array.from({ length: TIME_TO_EPOCH_WINDOW }, (_, idx) => {
                    const offset = TIME_TO_EPOCH_WINDOW - timeToEpoch.recentStepDurationsSec.length;
                    const sample = idx >= offset ? timeToEpoch.recentStepDurationsSec[idx - offset] : null;
                    const heightPct = sample !== null ? Math.max(18, Math.round((sample / maxStepBarSec) * 100)) : 0;
                    return (
                      <div
                        key={idx}
                        title={
                          sample !== null
                            ? `${th ? 'ขั้นตอนที่บันทึก' : 'Completed step'} #${idx - offset + 1}: ${sample.toFixed(3)}s`
                            : (th ? 'ยังไม่มีข้อมูลระยะเวลาขั้นตอน' : 'No step duration sample yet')
                        }
                        className="h-full flex items-end rounded-sm bg-[color-mix(in_srgb,var(--app-text-secondary)_12%,transparent)] overflow-hidden"
                      >
                        {sample !== null && (
                          <div
                            className="w-full rounded-sm transition-all duration-300"
                            style={{
                              height: `${heightPct}%`,
                              backgroundColor: gaugeFillEnd,
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-[var(--app-text-secondary)]">
                  <span>
                    {timeToEpoch.windowSteps > 0
                      ? (th
                          ? `สูตร: ${timeToEpoch.remainingStepsInEpoch.toLocaleString()} ขั้น × ${timeToEpoch.averageStepSeconds?.toFixed(3)}s (เฉลี่ย ${timeToEpoch.windowSteps} ขั้นล่าสุด)`
                          : `Formula: ${timeToEpoch.remainingStepsInEpoch.toLocaleString()} remaining × ${timeToEpoch.averageStepSeconds?.toFixed(3)}s (${timeToEpoch.windowSteps}-step rolling avg)`)
                      : (th
                          ? 'ยังไม่มีประวัติระยะเวลาต่อ Step — จะคำนวณอัตโนมัติเมื่อมีขั้นตอนที่เสร็จสมบูรณ์อย่างน้อย 1 ขั้น'
                          : 'Awaiting ≥1 completed step duration — populates automatically from live step telemetry.')}
                  </span>
                </div>
              </div>

              {showCustomPaceCalc && (
                <div className="pt-2.5 border-t border-dashed border-[var(--app-card-border)] flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="manual-step-pace-input" className="text-[11px] font-medium text-[var(--app-text-secondary)]">
                      {th ? 'ประมาณการวางแผน (วินาที/Step):' : 'Planning estimate (sec/step):'}
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
                        : (th ? 'ระบุวินาที/Step เพื่อคำนวณ' : 'Enter sec/step to estimate')}
                    </span>
                    {customSecPerStepInput && (
                      <button
                        type="button"
                        onClick={() => setCustomSecPerStepInput('')}
                        className="text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                      >
                        {th ? 'ล้างค่า' : 'Clear'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Flat Divided Telemetry Grid (Single Elevation, Tabular Numerals) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[var(--app-card-border)]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">
                  {th ? 'เกตความปลอดภัย' : 'Safety Gates'}
                </div>
                <div className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--app-text-primary)]">
                  {statusData ? `${gatesPassed} / ${gatesTotal}` : '—'}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">
                  {th ? 'Checkpoint ที่ตรวจแล้ว' : 'Verified Checkpoints'}
                </div>
                <div className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--app-text-primary)]">
                  {statusData ? `${verifiedCheckpointsCount} / ${plannedCheckpointsCount}` : '—'}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">
                  {th ? 'Validation Loss' : 'Validation Loss'}
                </div>
                <div className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--app-text-primary)]">
                  {typeof training?.latestValLoss === 'number' ? training.latestValLoss.toFixed(4) : '—'}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">
                  {th ? 'Perplexity / Grad' : 'Perplexity / Grad'}
                </div>
                <div className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--app-text-primary)]">
                  {typeof training?.latestPerplexity === 'number'
                    ? `${training.latestPerplexity.toFixed(2)} · ${training.latestGradNorm?.toFixed(2) ?? '—'}`
                    : '—'}
                </div>
              </div>
            </div>

            {/* Honest Operational State / Blocker Explanation */}
            {!statusData ? (
              <div className="text-xs text-[var(--app-text-secondary)]">
                {th ? 'กำลังดึงข้อมูลสถานะการฝึกแบบเรียลไทม์จาก /api/system/status…' : 'Fetching live training pipeline telemetry from /api/system/status…'}
              </div>
            ) : training?.error ? (
              <div className="text-xs font-mono text-[var(--z-danger)] break-words">
                {training.error}
              </div>
            ) : training?.status === 'BLOCKED' && blockers.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--app-text-secondary)]">
                <span className="truncate">
                  <strong className="font-mono text-[var(--z-danger)]">BLOCKED:</strong>{' '}
                  <span className="font-mono">{blockers.slice(0, 3).join(' · ')}{blockers.length > 3 ? ` (+${blockers.length - 3})` : ''}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('model_laboratory')}
                  className="text-[11px] font-semibold text-[var(--app-accent)] hover:underline cursor-pointer shrink-0"
                >
                  {th ? 'ตรวจสอบใน ModelLaboratory' : 'Inspect in ModelLaboratory'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

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
          if (onRunTask && onGoalChange) onRunTask();
          else onOpenQuickTask();
        }}
        onRetryTask={onRetryQuickTask}
      />

      {workflowLogs.length > 0 && (
        <section
          aria-label={th ? 'กราฟแนวโน้ม Sentiment ของงาน' : 'Session Sentiment Trend'}
          data-testid="command-center-sentiment-trend"
          className="rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-4 py-3 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <Activity className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" aria-hidden="true" />
              <span className="font-bold text-[var(--app-text-primary)]">
                {th ? 'แนวโน้ม Sentiment ของการประมวลผล' : 'Session Sentiment Trend'}
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-card)] px-2.5 py-1 text-[11px] font-mono font-semibold text-[var(--app-text-primary)] hover:border-[var(--app-accent)] transition-colors cursor-pointer"
              title={th ? 'แสดง/ซ่อนกราฟ Sentiment (Alt+V)' : 'Toggle sentiment trend chart (Alt+V)'}
            >
              <span>{isSentimentTrendVisible ? (th ? 'ซ่อนกราฟ' : 'Hide Chart') : (th ? 'แสดงกราฟ' : 'Show Chart')}</span>
              <kbd className="px-1 py-0.2 rounded bg-black/30 text-[10px] text-[var(--app-accent)] border border-[var(--app-card-border)]">
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
                  Completion (+1)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--app-accent)]" />
                  Neutral (0)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--z-danger)]" />
                  Error (-1)
                </span>
              </div>
            </div>
          )}
        </section>
      )}

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

      <section
        aria-label="System status"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--app-text-secondary)]">
          <span className="flex items-center gap-2">Runtime <StatusDot status={runtimeStatus} detail={model?.readinessReason} /></span>
          <span className="flex items-center gap-2">Checkpoint <StatusDot status={checkpointStatus} detail={model?.checkpointHash} /></span>
          <span className="flex items-center gap-2">Audit <StatusDot status={auditStatus} detail={audit?.headHash} /></span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {workflowLogs.length === 0 && (
            <button
              type="button"
              data-testid="command-center-toggle-sentiment-trend"
              aria-pressed={isSentimentTrendVisible}
              onClick={handleToggleSentimentTrend}
              title={th ? 'สลับการแสดงแผนภูมิแนวโน้ม (Alt+V)' : 'Toggle Sentiment Trend Chart (Alt+V)'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-card)] px-2.5 py-1 text-[11px] font-mono font-semibold text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:border-[var(--app-accent)] cursor-pointer"
            >
              {isSentimentTrendVisible ? <Eye className="w-3.5 h-3.5 text-[var(--app-accent)]" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
              <span>{th ? 'แนวโน้ม Sentiment' : 'Sentiment Trend'}</span>
              <kbd className="rounded bg-black/30 px-1 text-[9px] text-[var(--app-accent)]">Alt+V</kbd>
            </button>
          )}
          <button type="button" onClick={() => onNavigate('governance_security')} className="vivid-inline-link">
            {th ? 'ดูหลักฐานทั้งหมด' : 'Review evidence'} <ArrowRight size={13} />
          </button>
        </div>
      </section>
    </div>
  );
};
