import React, { useMemo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  RotateCcw,
  Terminal,
} from 'lucide-react';
import type {
  WorkflowSnapshot,
  WorkflowStageId,
  WorkflowStageState,
} from '../utils/workflowStages';

export const DEFAULT_LRU_CACHE_TASK_GOAL = 'Build In-Memory LRU Cache with TTL';

export interface TaskExecutionProgressSummary {
  taskTitle: string;
  isDefaultLruCacheTask: boolean;
  overallState: WorkflowSnapshot['overallState'];
  completedSteps: number;
  totalSteps: number;
  activeStepNumber: number;
  currentStage: WorkflowStageState | null;
  failedStage: WorkflowStageState | null;
  percentage: number;
  totalLogs: number;
  totalDurationMs: number | null;
  latestLogLine: string | null;
}

export function deriveTaskExecutionProgress(
  snapshot: WorkflowSnapshot,
  logs: string[] = [],
  fallbackGoal: string = DEFAULT_LRU_CACHE_TASK_GOAL
): TaskExecutionProgressSummary {
  const effectiveGoal = (snapshot.goal || fallbackGoal || DEFAULT_LRU_CACHE_TASK_GOAL).trim();
  const isDefaultLruCacheTask = /lru\s*cache/i.test(effectiveGoal);
  const totalSteps = Math.max(1, snapshot.stages.length);
  const completedSteps = snapshot.completedSteps;
  const currentStage = snapshot.stages.find((s) => s.status === 'RUNNING') ?? null;
  const failedStage = snapshot.stages.find((s) => s.status === 'FAILED') ?? null;

  let activeStepNumber = completedSteps;
  if (failedStage) {
    activeStepNumber = failedStage.order;
  } else if (currentStage) {
    activeStepNumber = currentStage.order;
  } else if (snapshot.overallState === 'PARTIAL' && snapshot.activeStageIndex >= 0) {
    activeStepNumber = snapshot.activeStageIndex + 1;
  }

  let percentage = 0;
  if (snapshot.overallState === 'COMPLETED' && completedSteps === totalSteps) {
    percentage = 100;
  } else if (logs.length === 0 && snapshot.overallState === 'IDLE') {
    percentage = 0;
  } else if (failedStage) {
    percentage = Math.max(5, Math.min(95, Math.round((completedSteps / totalSteps) * 100)));
  } else if (currentStage) {
    percentage = Math.max(
      8,
      Math.min(96, Math.round(((completedSteps + 0.5) / totalSteps) * 100))
    );
  } else {
    percentage = Math.min(100, Math.round((completedSteps / totalSteps) * 100));
  }

  const latestLogLine =
    logs.length > 0 ? logs[logs.length - 1].trim() || null : null;

  return {
    taskTitle: effectiveGoal,
    isDefaultLruCacheTask,
    overallState: snapshot.overallState,
    completedSteps,
    totalSteps,
    activeStepNumber,
    currentStage,
    failedStage,
    percentage,
    totalLogs: logs.length,
    totalDurationMs: snapshot.totalDurationMs,
    latestLogLine,
  };
}

export interface TaskExecutionProgressBarProps {
  snapshot: WorkflowSnapshot;
  logs: string[];
  goal?: string;
  lang?: 'th' | 'en';
  verificationHash?: string | null;
  activeFilterStageId?: WorkflowStageId | null;
  onStageClick?: (stage: WorkflowStageState) => void;
  onInspectStageInTerminal?: (stage: WorkflowStageState) => void;
  onStartTask?: () => void;
  onRetryTask?: () => void;
}

const SHORT_LABELS: Record<WorkflowStageId, { en: string; th: string }> = {
  task_intake: { en: 'Intake', th: 'รับคำสั่ง' },
  reasoning_planning: { en: 'Plan', th: 'วางแผน' },
  research_knowledge: { en: 'Research', th: 'ค้นคว้า' },
  creation_execution: { en: 'Execute', th: 'สร้างโค้ด' },
  testing_repair: { en: 'Test', th: 'ทดสอบ' },
  verification_delivery: { en: 'Verify', th: 'ตรวจสอบ' },
  learning_adaptation: { en: 'Learn', th: 'เรียนรู้' },
};

export const TaskExecutionProgressBar: React.FC<TaskExecutionProgressBarProps> = ({
  snapshot,
  logs,
  goal,
  lang = 'en',
  verificationHash = null,
  activeFilterStageId = null,
  onStageClick,
  onInspectStageInTerminal,
  onStartTask,
  onRetryTask,
}) => {
  const th = lang === 'th';

  const summary = useMemo(
    () => deriveTaskExecutionProgress(snapshot, logs, goal),
    [snapshot, logs, goal]
  );

  const fillColorClass =
    summary.overallState === 'FAILED'
      ? 'bg-[var(--z-danger)]'
      : summary.overallState === 'COMPLETED'
        ? 'bg-[var(--z-ok)]'
        : summary.overallState === 'RUNNING'
          ? 'bg-gradient-to-r from-[var(--app-accent-deep)] to-[var(--app-accent)]'
          : 'bg-[var(--app-accent)]';

  const stateLabel =
    summary.overallState === 'FAILED'
      ? th ? 'หยุดเพราะเกิดข้อผิดพลาด' : 'FAILED'
      : summary.overallState === 'COMPLETED'
        ? th ? 'เสร็จสมบูรณ์' : 'COMPLETED'
        : summary.overallState === 'RUNNING'
          ? th
            ? `กำลังทำขั้นตอน ${summary.activeStepNumber}/${summary.totalSteps}`
            : `RUNNING STEP ${summary.activeStepNumber}/${summary.totalSteps}`
          : summary.overallState === 'PARTIAL'
            ? th
              ? `คืบหน้าบางส่วน ${summary.completedSteps}/${summary.totalSteps}`
              : `PARTIAL ${summary.completedSteps}/${summary.totalSteps}`
            : th ? 'รอเริ่มดำเนินงาน' : 'IDLE';

  const stateTextColor =
    summary.overallState === 'FAILED'
      ? 'text-[var(--z-danger)]'
      : summary.overallState === 'COMPLETED'
        ? 'text-[var(--z-ok)]'
        : summary.overallState === 'RUNNING'
          ? 'text-[var(--app-accent)]'
          : 'text-[var(--app-text-secondary)]';

  const focusStage =
    summary.failedStage ??
    summary.currentStage ??
    snapshot.stages.find((s) => s.matchedLogs.length > 0) ??
    snapshot.stages[0];

  return (
    <section
      data-testid="task-execution-progress-bar"
      aria-label={
        th
          ? `แถบความคืบหน้างาน: ${summary.taskTitle}`
          : `Task execution progress: ${summary.taskTitle}`
      }
      className="rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-4 md:p-5 space-y-3.5"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--app-text-secondary)]">
            <span>{th ? 'ความคืบหน้าขั้นตอนการทำงาน (Log Stream)' : 'Task Execution Progress (Log Stream)'}</span>
            <span aria-hidden="true">·</span>
            <span className={`font-mono font-bold ${stateTextColor}`} data-testid="task-progress-state-label">
              {stateLabel}
            </span>
          </div>
          <h3
            data-testid="task-progress-goal-title"
            className="mt-1 text-sm md:text-base font-bold text-[var(--app-text-primary)] truncate"
            title={summary.taskTitle}
          >
            {summary.taskTitle}
          </h3>
        </div>

        <div className="flex items-baseline gap-3 shrink-0 font-mono tabular-nums">
          <div className="text-right">
            <div
              data-testid="task-progress-percentage"
              className="text-2xl font-bold leading-none text-[var(--app-text-primary)]"
            >
              {summary.percentage}%
            </div>
            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
              {summary.completedSteps}/{summary.totalSteps} {th ? 'ขั้นตอน' : 'steps'}
              {' · '}
              {summary.totalLogs} {th ? 'บันทึก' : 'logs'}
              {typeof summary.totalDurationMs === 'number' && summary.totalDurationMs > 0
                ? ` · ${summary.totalDurationMs}ms`
                : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Continuous Horizontal Progress Track */}
      <div className="space-y-2">
        <div
          role="progressbar"
          aria-valuenow={summary.percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={
            th
              ? `ความคืบหน้างาน ${summary.taskTitle}: ${summary.percentage}%`
              : `${summary.taskTitle} progress: ${summary.percentage}%`
          }
          className="h-2.5 w-full overflow-hidden rounded-full border border-[var(--app-card-border)] bg-[var(--app-input-bg)]"
        >
          <div
            data-testid="task-progress-fill"
            className={`h-full rounded-full transition-all duration-300 ${fillColorClass}`}
            style={{ width: `${summary.percentage > 0 ? Math.max(2, summary.percentage) : 0}%` }}
          />
        </div>

        {/* 7 Step-Matched Segments from Log Stream */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5"
          role="list"
          aria-label={th ? 'ขั้นตอนตาม Log Stream' : 'Log-derived execution steps'}
        >
          {snapshot.stages.map((stage) => {
            const isSelected = activeFilterStageId === stage.id;
            const label = SHORT_LABELS[stage.id]?.[th ? 'th' : 'en'] || stage.labelEn;
            const segmentStyle =
              stage.status === 'FAILED'
                ? 'border-[var(--z-danger)] bg-[color-mix(in_srgb,var(--z-danger)_12%,var(--app-surface))] text-[var(--z-danger)]'
                : stage.status === 'COMPLETED'
                  ? 'border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_10%,var(--app-surface))] text-[var(--z-ok)]'
                  : stage.status === 'RUNNING'
                    ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_12%,var(--app-surface))] text-[var(--app-accent)]'
                    : 'border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-secondary)]';

            return (
              <button
                key={stage.id}
                type="button"
                role="listitem"
                data-testid={`task-progress-step-${stage.id}`}
                data-status={stage.status}
                onClick={() => onStageClick?.(stage)}
                title={`${stage.order}. ${th ? stage.labelTh : stage.labelEn} — ${stage.status} (${stage.matchedLogs.length} logs)`}
                className={`flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors cursor-pointer ${segmentStyle} ${
                  isSelected ? 'ring-1 ring-[var(--app-accent)]' : ''
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0 font-semibold truncate">
                  {stage.status === 'COMPLETED' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : stage.status === 'RUNNING' ? (
                    <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
                  ) : stage.status === 'FAILED' ? (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 shrink-0 opacity-60" aria-hidden="true" />
                  )}
                  <span className="truncate">
                    {stage.order}. {label}
                  </span>
                </span>
                <span className="font-mono text-[10px] tabular-nums opacity-80 shrink-0">
                  {stage.matchedLogs.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Stream Telemetry & Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--app-card-border)] text-xs">
        <div className="min-w-0 flex-1 font-mono text-[11px] text-[var(--app-text-secondary)] truncate">
          {summary.failedStage?.errorReason ? (
            <span className="text-[var(--z-danger)]">
              [{summary.failedStage.order}. {th ? summary.failedStage.labelTh : summary.failedStage.labelEn}]{' '}
              {summary.failedStage.errorReason}
            </span>
          ) : summary.latestLogLine ? (
            <span data-testid="task-progress-latest-log">
              {summary.currentStage
                ? `[${summary.currentStage.order}/${summary.totalSteps}] `
                : ''}
              {summary.latestLogLine}
            </span>
          ) : (
            <span data-testid="task-progress-empty-hint">
              {th
                ? `ยังไม่มี Log Stream สำหรับ "${summary.taskTitle}" — กดเริ่มดำเนินงานเพื่อติดตามทั้ง 7 ขั้นตอนแบบเรียลไทม์`
                : `No log stream events recorded yet for "${summary.taskTitle}" — run task to stream 7-stage execution progress.`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {verificationHash && summary.overallState === 'COMPLETED' && (
            <span className="font-mono text-[10px] tabular-nums text-[var(--z-ok)]">
              SHA-256: {verificationHash.slice(0, 12)}…
            </span>
          )}

          {summary.overallState === 'IDLE' && onStartTask && (
            <button
              type="button"
              data-testid="task-progress-start-btn"
              onClick={onStartTask}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--app-accent-deep)] px-3 py-1.5 text-[11px] font-bold text-white hover:brightness-110 transition-all cursor-pointer"
            >
              <Play className="w-3 h-3" aria-hidden="true" />
              {th ? 'เริ่มงานนี้' : 'Run task'}
            </button>
          )}

          {summary.overallState === 'FAILED' && onRetryTask && (
            <button
              type="button"
              data-testid="task-progress-retry-btn"
              onClick={onRetryTask}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--z-danger)] px-2.5 py-1 text-[11px] font-semibold text-[var(--z-danger)] cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              {th ? 'ลองใหม่' : 'Retry'}
            </button>
          )}

          {focusStage && summary.totalLogs > 0 && onInspectStageInTerminal && (
            <button
              type="button"
              data-testid="task-progress-terminal-btn"
              onClick={() => onInspectStageInTerminal(focusStage)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--app-accent)] hover:underline cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
              {th ? 'ดู Log ใน Terminal' : 'Inspect logs'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
