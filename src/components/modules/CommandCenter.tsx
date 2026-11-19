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
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  ChevronDown,
  Code2,
  Eye,
  EyeOff,
  FlaskConical,
  Paperclip,
  Play,
  RefreshCw,
  ShieldCheck,
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
  const [attachmentError, setAttachmentError] = useState('');
  const [showTrainingDetails, setShowTrainingDetails] = useState(false);
  const [showWorkflowStepper, setShowWorkflowStepper] = useState(false);

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

  const model = statusData?.model;
  const audit = statusData?.audit;
  const training = statusData?.training ?? null;
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
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="command-center-goal-input" className="text-sm font-medium text-[var(--app-text-primary)]">
            {th ? 'คุณต้องการให้ ZYNTHEOR ทำอะไร?' : 'What should ZYNTHEOR work on?'}
          </label>
          <span className="text-[11px] font-mono tabular-nums text-[var(--app-text-secondary)]">
            {goal.length.toLocaleString()} / {MAX_GOAL_CHARS.toLocaleString()}
          </span>
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
          className="w-full resize-y rounded-lg border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-4 py-3 text-sm leading-relaxed text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]/70 outline-none focus:border-[var(--app-accent)]"
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

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            data-testid="command-center-attach-file-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={!onGoalChange || isWorkflowRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-2 text-xs font-medium text-[var(--app-text-primary)] hover:border-[var(--app-accent)] disabled:opacity-40 cursor-pointer transition-colors"
          >
            <Paperclip className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" aria-hidden="true" />
            <span>{th ? 'แนบไฟล์ (สูงสุด 200 KB)' : 'Attach file'}</span>
          </button>

          <button
            type="button"
            data-testid="command-center-run-task-btn"
            onClick={() => {
              if (onRunTask && onGoalChange) onRunTask();
              else onOpenQuickTask();
            }}
            disabled={isWorkflowRunning || !goal.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--app-accent-deep)] px-5 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40 cursor-pointer transition-all"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {isWorkflowRunning
                ? (th ? 'กำลังดำเนินงาน…' : 'Executing…')
                : (th ? 'เริ่มดำเนินงาน' : 'Run task')}
            </span>
          </button>
        </div>
      </section>

      {/* 3. Fast Tool Access Row (Clean Hairline Tiles) */}
      <section aria-label={th ? 'ทางลัดเครื่องมือหลัก' : 'Primary tools'} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          { id: 'research_lab', icon: FlaskConical, name: 'ResearchLab', desc: th ? 'วิจัยและทดสอบระบบ' : 'Research & validation' },
          { id: 'dev_studio', icon: Code2, name: 'DevStudio', desc: th ? 'พัฒนาและแก้ไขโค้ด' : 'Build software' },
          { id: 'model_laboratory', icon: BrainCircuit, name: 'ModelLaboratory', desc: th ? 'โมเดลและการฝึก R0' : 'Models & training' },
          { id: 'governance_security', icon: ShieldCheck, name: th ? 'หลักฐาน & Audit' : 'Evidence Ledger', desc: th ? 'ตรวจสอบ SHA-256 Chain' : 'Verification & audit' },
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

      {/* 5. Active Task Execution Progress (Shown only when running or logs exist) */}
      {(workflowLogs.length > 0 || isWorkflowRunning) && (
        <div className="space-y-4">
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

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowWorkflowStepper((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
            >
              <span>{showWorkflowStepper ? (th ? 'ซ่อนลำดับ 7 ขั้นตอน' : 'Hide 7-stage trace') : (th ? 'ดูรายละเอียด 7 ขั้นตอน' : 'Show 7-stage trace')}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showWorkflowStepper ? 'rotate-180' : ''}`} />
            </button>
          </div>

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
        </div>
      )}

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
    </div>
  );
};
