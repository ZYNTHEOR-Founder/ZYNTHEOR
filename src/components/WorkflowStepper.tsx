import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Loader2,
  RotateCcw,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';
import type {
  WorkflowStageId,
  WorkflowStageState,
  WorkflowStepperStatus,
} from '../utils/workflowStages';

export type { WorkflowStepperStatus };

export interface WorkflowStepperProps {
  activeStageIndex: number;
  stageStatuses: WorkflowStepperStatus[];
  stages?: WorkflowStageState[];
  totalLogs?: number;
  totalDurationMs?: number | null;
  goal?: string;
  lang?: 'th' | 'en';
  activeFilterStageId?: WorkflowStageId | null;
  onStageClick?: (stage: WorkflowStageState) => void;
  onClearStageFilter?: () => void;
  onOpenQuickTask?: () => void;
  onInspectStageInTerminal?: (stage: WorkflowStageState) => void;
  onRetryQuickTask?: () => void;
}

const DEFAULT_STAGE_META: Array<{
  id: WorkflowStageId;
  order: number;
  labelEn: string;
  labelTh: string;
  subtitleEn: string;
  subtitleTh: string;
  terminalFilterQuery: string;
}> = [
  {
    id: 'task_intake',
    order: 1,
    labelEn: 'Task Intake',
    labelTh: 'รับและวิเคราะห์คำสั่ง',
    subtitleEn: 'Receive and parse goal',
    subtitleTh: 'รับและวิเคราะห์คำสั่ง',
    terminalFilterQuery: '\\[(INIT|01_PERCEPTION)\\]|Initiating Sovereign',
  },
  {
    id: 'reasoning_planning',
    order: 2,
    labelEn: 'Reasoning & Planning',
    labelTh: 'คิดและวางแผน',
    subtitleEn: 'Formulate steps & tools',
    subtitleTh: 'คิดและวางแผน',
    terminalFilterQuery: '\\[(PLANNER|ARCHITECT|03_PLANNING)\\]',
  },
  {
    id: 'research_knowledge',
    order: 3,
    labelEn: 'Research & Knowledge',
    labelTh: 'ค้นคว้าและใช้ความรู้',
    subtitleEn: 'Query Knowledge Workspace',
    subtitleTh: 'ค้นคว้าและเรียกใช้ความรู้',
    terminalFilterQuery: '\\[(RESEARCH|KNOWLEDGE|02_INTELLIGENCE)\\]|knowledge|context|citation',
  },
  {
    id: 'creation_execution',
    order: 4,
    labelEn: 'Creation & Execution',
    labelTh: 'สร้างและลงมือทำ',
    subtitleEn: 'Build & execute tools',
    subtitleTh: 'สร้างและลงมือปฏิบัติงาน',
    terminalFilterQuery: '\\[(CODER|REVIEWER|04_EXECUTION)\\]',
  },
  {
    id: 'testing_repair',
    order: 5,
    labelEn: 'Testing & Repair',
    labelTh: 'ทดสอบและแก้ไข',
    subtitleEn: 'Verify checks & auto-repair',
    subtitleTh: 'ทดสอบและแก้ไข',
    terminalFilterQuery: '\\[(TESTER|DEBUGGER|05_VERIFICATION|06_ADAPTATION)\\]|exitCode',
  },
  {
    id: 'verification_delivery',
    order: 6,
    labelEn: 'Verification & Delivery',
    labelTh: 'ตรวจสอบและส่งมอบ',
    subtitleEn: 'Evidence, checksum & audit',
    subtitleTh: 'ตรวจสอบและส่งมอบ',
    terminalFilterQuery: '\\[(DONE|VERIFIED|08_AUTONOMY|AUDIT)\\]|Delivered',
  },
  {
    id: 'learning_adaptation',
    order: 7,
    labelEn: 'Learning & Adaptation',
    labelTh: 'เรียนรู้และปรับปรุง',
    subtitleEn: 'Evaluate & stage learning',
    subtitleTh: 'ประเมินและปรับปรุง',
    terminalFilterQuery: '\\[(EVOLVER|LEARNING|07_LEARNING)\\]|learning|adaptation',
  },
];

function getStatusTone(status: WorkflowStepperStatus): {
  textColor: string;
  nodeSurface: string;
  nodeBorder: string;
  connectorColor: string;
  label: string;
} {
  switch (status) {
    case 'completed':
      return {
        textColor: 'text-[var(--z-ok)]',
        nodeSurface: 'bg-[color-mix(in_srgb,var(--z-ok)_12%,var(--app-surface))]',
        nodeBorder: 'border-[color-mix(in_srgb,var(--z-ok)_50%,var(--app-card-border))]',
        connectorColor: 'bg-[color-mix(in_srgb,var(--z-ok)_55%,var(--app-card-border))]',
        label: 'COMPLETED',
      };
    case 'running':
      return {
        textColor: 'text-[var(--app-accent)]',
        nodeSurface: 'bg-[color-mix(in_srgb,var(--app-accent)_16%,var(--app-surface))]',
        nodeBorder: 'border-[var(--app-accent)]',
        connectorColor: 'bg-[color-mix(in_srgb,var(--app-accent)_50%,var(--app-card-border))]',
        label: 'RUNNING',
      };
    case 'failed':
      return {
        textColor: 'text-[var(--z-danger)]',
        nodeSurface: 'bg-[color-mix(in_srgb,var(--z-danger)_16%,var(--app-surface))]',
        nodeBorder: 'border-[var(--z-danger)]',
        connectorColor: 'bg-[color-mix(in_srgb,var(--z-danger)_45%,var(--app-card-border))]',
        label: 'FAILED',
      };
    case 'pending':
    default:
      return {
        textColor: 'text-[var(--app-text-secondary)]',
        nodeSurface: 'bg-[var(--app-surface)]',
        nodeBorder: 'border-[var(--app-card-border)]',
        connectorColor: 'bg-[var(--app-card-border)]',
        label: 'PENDING',
      };
  }
}

function StageStatusIcon({ status }: { status: WorkflowStepperStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-[var(--z-ok)] shrink-0" aria-hidden="true" />;
    case 'running':
      return (
        <Loader2
          className="h-4 w-4 text-[var(--app-accent)] animate-spin motion-reduce:animate-none shrink-0"
          aria-hidden="true"
        />
      );
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-[var(--z-danger)] shrink-0" aria-hidden="true" />;
    case 'pending':
    default:
      return <CircleDashed className="h-4 w-4 text-[var(--app-text-secondary)] shrink-0" aria-hidden="true" />;
  }
}

export const WorkflowStepper: React.FC<WorkflowStepperProps> = ({
  activeStageIndex,
  stageStatuses,
  stages,
  totalLogs = 0,
  totalDurationMs = null,
  goal = '',
  lang = 'en',
  activeFilterStageId = null,
  onStageClick,
  onClearStageFilter,
  onOpenQuickTask,
  onInspectStageInTerminal,
  onRetryQuickTask,
}) => {
  const [selectedStageIdx, setSelectedStageIdx] = useState<number | null>(null);

  const handleStageSelect = (idx: number, stage: WorkflowStageState) => {
    setSelectedStageIdx(idx);
    const filterHandler = onStageClick ?? onInspectStageInTerminal;
    if (filterHandler) {
      filterHandler(stage);
    }
  };

  const normalizedStages = useMemo(() => {
    return DEFAULT_STAGE_META.map((meta, idx) => {
      const provided = stages?.[idx];
      const propStatus = stageStatuses[idx];
      const status: WorkflowStepperStatus =
        propStatus ??
        (provided ? (provided.status.toLowerCase() as WorkflowStepperStatus) : 'pending');

      const stageRecord: WorkflowStageState = provided ?? {
        ...meta,
        status: status.toUpperCase() as WorkflowStageState['status'],
        matchedLogs: [],
        durationMs: null,
        evidenceSummary: null,
        errorReason: null,
        remediationHint: null,
      };

      return {
        idx,
        status,
        isActive: idx === activeStageIndex,
        stage: stageRecord,
      };
    });
  }, [stages, stageStatuses, activeStageIndex]);

  const failedItem = useMemo(
    () => normalizedStages.find((item) => item.status === 'failed') ?? null,
    [normalizedStages]
  );
  const isStreaming = useMemo(
    () => normalizedStages.some((item) => item.status === 'running'),
    [normalizedStages]
  );
  const completedCount = useMemo(
    () => normalizedStages.filter((item) => item.status === 'completed').length,
    [normalizedStages]
  );

  // Automatically focus the failing stage when an error occurs
  useEffect(() => {
    if (failedItem) {
      setSelectedStageIdx(failedItem.idx);
    }
  }, [failedItem]);

  const selectedItem =
    selectedStageIdx !== null && selectedStageIdx >= 0 && selectedStageIdx < normalizedStages.length
      ? normalizedStages[selectedStageIdx]
      : null;

  const hasActivity = totalLogs > 0 || activeStageIndex >= 0 || completedCount > 0 || Boolean(failedItem);
  const allCompleted = completedCount === normalizedStages.length && !failedItem && !isStreaming;

  const headerStatusLabel = isStreaming
    ? 'LIVE STATUS'
    : failedItem
    ? 'ERROR DETECTED'
    : allCompleted
    ? 'COMPLETED'
    : hasActivity
    ? 'RECORDED'
    : 'IDLE';

  const headerStatusColor = isStreaming
    ? 'text-[var(--app-accent)]'
    : failedItem
    ? 'text-[var(--z-danger)]'
    : allCompleted
    ? 'text-[var(--z-ok)]'
    : 'text-[var(--app-text-secondary)]';

  return (
    <section
      aria-label={lang === 'th' ? 'ไทม์ไลน์การทำงานอัตโนมัติ 7 ขั้นตอน' : 'ZYNTHEOR 7-Stage Workflow Stepper'}
      data-testid="workflow-stepper"
      className="rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-card)] p-5 md:p-6 shadow-sm"
    >
      {/* Top Header & Compact Summary Bar */}
      <div className="flex flex-col gap-3 border-b border-[var(--app-card-border)] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono font-semibold tracking-wider">
            <span className="text-[var(--app-text-secondary)]">AUTONOMOUS WORKFLOW</span>
            <span aria-hidden="true" className="text-[var(--app-text-secondary)]">·</span>
            <span className={`inline-flex items-center gap-1.5 ${headerStatusColor}`}>
              {isStreaming && (
                <span
                  className="h-2 w-2 rounded-full bg-[var(--app-accent)] animate-pulse motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              <span>{headerStatusLabel}</span>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-base md:text-lg font-bold tracking-tight text-[var(--app-text-primary)]">
              {lang === 'th' ? '7 ขั้นตอนการทำงาน' : '7-Stage Execution Workflow'}
            </h2>
            <span className="text-xs text-[var(--app-text-secondary)]">
              Task lifecycle · Evidence-based progress
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <div
            data-testid="workflow-summary-bar"
            className="flex flex-wrap items-center gap-2.5 font-mono text-xs tabular-nums text-[var(--app-text-secondary)]"
          >
            <span>
              <strong className="text-[var(--app-text-primary)]">
                {completedCount}/{normalizedStages.length}
              </strong>{' '}
              {lang === 'th' ? 'ขั้นตอน' : 'Steps'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="text-[var(--app-text-primary)]">{totalLogs}</strong>{' '}
              {lang === 'th' ? 'บันทึก' : 'Logs'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="text-[var(--app-text-primary)]">
                {totalDurationMs !== null ? `${totalDurationMs.toLocaleString()} ms` : '—'}
              </strong>
            </span>
          </div>

          {onOpenQuickTask && (
            <button
              type="button"
              onClick={onOpenQuickTask}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--app-text-primary)] transition-colors hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] cursor-pointer whitespace-nowrap shrink-0"
            >
              {totalLogs > 0 ? <Terminal className="h-3.5 w-3.5" /> : <Workflow className="h-3.5 w-3.5" />}
              <span>
                {totalLogs > 0
                  ? lang === 'th'
                    ? 'เปิด Terminal'
                    : 'Open Terminal'
                  : lang === 'th'
                  ? 'เริ่มสั่งงาน'
                  : 'Start Task'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Active Goal / Filter Strip */}
      {((hasActivity && goal) || activeFilterStageId || selectedItem) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--app-text-secondary)]">
          <div className="min-w-0 truncate">
            {hasActivity && goal && (
              <>
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--app-text-secondary)] mr-2">
                  {lang === 'th' ? 'เป้าหมาย:' : 'Goal:'}
                </span>
                <span className="font-medium text-[var(--app-text-primary)]">{goal}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {activeFilterStageId && onClearStageFilter && (
              <button
                type="button"
                data-testid="stepper-clear-stage-filter"
                onClick={onClearStageFilter}
                className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--app-accent)] hover:underline cursor-pointer"
              >
                <X className="h-3 w-3" />
                <span>{lang === 'th' ? 'ล้างตัวกรอง Terminal' : 'Clear terminal filter'}</span>
              </button>
            )}
            {selectedItem && (
              <button
                type="button"
                onClick={() => setSelectedStageIdx(null)}
                className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
              >
                <X className="h-3 w-3" />
                <span>{lang === 'th' ? 'ปิดรายละเอียด' : 'Close detail'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Desktop Connected 7-Stage Horizontal Timeline */}
      <div className="mt-5 hidden lg:grid lg:grid-cols-7 lg:gap-2">
        {normalizedStages.map(({ idx, status, isActive, stage }) => {
          const tone = getStatusTone(status);
          const isSelected = selectedItem?.idx === idx;
          const isFiltered = activeFilterStageId === stage.id;
          const nextItem = normalizedStages[idx + 1];
          const connectorTone =
            nextItem && status === 'completed' ? tone.connectorColor : 'bg-[var(--app-card-border)]';

          return (
            <div key={stage.id} className="relative flex flex-col">
              {idx < normalizedStages.length - 1 && (
                <div
                  aria-hidden="true"
                  className={`absolute left-[calc(50%+16px)] right-[-8px] top-[19px] h-[2px] ${connectorTone}`}
                />
              )}

              <button
                type="button"
                data-testid={`workflow-stage-${stage.id}`}
                data-status={status}
                data-active={isActive ? 'true' : 'false'}
                data-filtered={isFiltered ? 'true' : 'false'}
                aria-current={isActive ? 'step' : undefined}
                aria-pressed={isFiltered || isSelected}
                aria-expanded={isSelected}
                title={
                  lang === 'th'
                    ? `คลิกเพื่อกรองบันทึกของขั้น ${stage.order}. ${stage.labelTh} ใน Terminal`
                    : `Click to filter terminal logs for Stage ${stage.order}: ${stage.labelEn}`
                }
                onClick={() => handleStageSelect(idx, stage)}
                className={`group relative z-10 flex h-full flex-col items-start rounded-xl border p-3 text-left transition-all duration-150 cursor-pointer focus-visible:outline-none ${
                  status === 'failed'
                    ? 'border-[var(--z-danger)] bg-[color-mix(in_srgb,var(--z-danger)_12%,var(--app-surface))] ring-1 ring-[color-mix(in_srgb,var(--z-danger)_40%,transparent)]'
                    : isFiltered || isActive || status === 'running'
                    ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_12%,var(--app-surface))] ring-1 ring-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                    : isSelected
                    ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_7%,var(--app-surface))]'
                    : 'border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[color-mix(in_srgb,var(--app-accent)_55%,var(--app-card-border))]'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border font-mono text-[11px] font-bold tabular-nums ${tone.nodeSurface} ${tone.nodeBorder} ${tone.textColor}`}
                  >
                    {String(stage.order).padStart(2, '0')}
                  </span>
                  <StageStatusIcon status={status} />
                </div>

                <div className="mt-3 text-xs font-bold leading-snug text-[var(--app-text-primary)]">
                  {stage.labelEn}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-[var(--app-text-secondary)]">
                  {lang === 'th' ? stage.labelTh : stage.subtitleEn}
                </div>

                <div className="mt-auto pt-3 flex w-full items-center justify-between gap-1 font-mono text-[10px] font-bold tracking-wider">
                  <span className={tone.textColor}>{tone.label}</span>
                  {stage.durationMs !== null && (
                    <span className="tabular-nums text-[var(--app-text-secondary)]">
                      {stage.durationMs}ms
                    </span>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Mobile & Tablet Connected Vertical Timeline */}
      <div className="mt-5 flex flex-col lg:hidden">
        {normalizedStages.map(({ idx, status, isActive, stage }) => {
          const tone = getStatusTone(status);
          const isSelected = selectedItem?.idx === idx;
          const isFiltered = activeFilterStageId === stage.id;
          const isLast = idx === normalizedStages.length - 1;

          return (
            <div key={stage.id} className="relative flex gap-3 pb-3 last:pb-0">
              {!isLast && (
                <div
                  aria-hidden="true"
                  className={`absolute left-[15px] top-[34px] bottom-0 w-[2px] ${
                    status === 'completed' ? tone.connectorColor : 'bg-[var(--app-card-border)]'
                  }`}
                />
              )}

              <div
                className={`relative z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-bold tabular-nums ${tone.nodeSurface} ${tone.nodeBorder} ${tone.textColor}`}
              >
                {String(stage.order).padStart(2, '0')}
              </div>

              <button
                type="button"
                data-testid={`workflow-stage-mobile-${stage.id}`}
                data-status={status}
                data-active={isActive ? 'true' : 'false'}
                data-filtered={isFiltered ? 'true' : 'false'}
                aria-current={isActive ? 'step' : undefined}
                aria-pressed={isFiltered || isSelected}
                aria-expanded={isSelected}
                onClick={() => handleStageSelect(idx, stage)}
                className={`flex min-h-[44px] flex-1 items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                  status === 'failed'
                    ? 'border-[var(--z-danger)] bg-[color-mix(in_srgb,var(--z-danger)_12%,var(--app-surface))]'
                    : isFiltered || isActive || status === 'running'
                    ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_12%,var(--app-surface))]'
                    : isSelected
                    ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_7%,var(--app-surface))]'
                    : 'border-[var(--app-card-border)] bg-[var(--app-surface)]'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--app-text-primary)] truncate">
                    {stage.labelEn}
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)] truncate">
                    {lang === 'th' ? stage.labelTh : stage.subtitleEn}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-mono text-[10px] font-bold tracking-wider ${tone.textColor}`}>
                    {tone.label}
                  </span>
                  <StageStatusIcon status={status} />
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Inline Error Banner when a stage fails and detail drawer isn't already focused on it */}
      {failedItem && (!selectedItem || selectedItem.idx !== failedItem.idx) && (
        <div className="mt-4 flex flex-col gap-2 rounded-xl border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_10%,var(--app-surface))] p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--z-danger)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                {lang === 'th'
                  ? `ติดขัดที่ขั้นตอน ${failedItem.stage.order}. ${failedItem.stage.labelTh}`
                  : `Failed at Stage ${failedItem.stage.order}: ${failedItem.stage.labelEn}`}
              </span>
            </div>
            {failedItem.stage.errorReason && (
              <p className="mt-1 font-mono text-[11px] text-[var(--app-text-primary)] break-words">
                {failedItem.stage.errorReason}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSelectedStageIdx(failedItem.idx)}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[var(--app-card)] px-3 py-1.5 text-xs font-semibold text-[var(--z-danger)] hover:opacity-90 cursor-pointer shrink-0"
          >
            <span>{lang === 'th' ? 'ดูสาเหตุและวิธีแก้' : 'Inspect Cause'}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Interactive Stage Evidence & Logs Drawer */}
      {selectedItem && (
        <div
          data-testid="workflow-stage-detail"
          className="mt-5 border-t border-[var(--app-card-border)] pt-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StageStatusIcon status={selectedItem.status} />
                <h3 className="text-sm font-bold text-[var(--app-text-primary)]">
                  {String(selectedItem.stage.order).padStart(2, '0')}. {selectedItem.stage.labelEn}
                </h3>
                <span className="text-xs text-[var(--app-text-secondary)]">
                  · {selectedItem.stage.labelTh}
                </span>
                <span className={`font-mono text-[11px] font-bold ${getStatusTone(selectedItem.status).textColor}`}>
                  · {getStatusTone(selectedItem.status).label}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums text-[var(--app-text-secondary)]">
                <span>
                  {selectedItem.stage.matchedLogs.length}{' '}
                  {lang === 'th' ? 'รายการบันทึก' : 'matched log lines'}
                </span>
                {selectedItem.stage.durationMs !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{selectedItem.stage.durationMs} ms</span>
                  </>
                )}
                {selectedItem.stage.evidenceSummary && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[var(--app-text-primary)] truncate max-w-md">
                      {selectedItem.stage.evidenceSummary}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedItem.status === 'failed' && onRetryQuickTask && (
                <button
                  type="button"
                  onClick={onRetryQuickTask}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--z-danger)] hover:opacity-90 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>{lang === 'th' ? 'รันซ้ำ' : 'Retry Task'}</span>
                </button>
              )}
              {onInspectStageInTerminal && (
                <button
                  type="button"
                  data-testid="inspect-stage-in-terminal"
                  onClick={() => onInspectStageInTerminal(selectedItem.stage)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--app-text-primary)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] cursor-pointer"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  <span>
                    {lang === 'th' ? 'เปิดดูใน Execution Terminal' : 'Open in Execution Terminal'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {selectedItem.status === 'failed' && (
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_8%,var(--app-surface))] p-3.5 space-y-1.5">
              <div className="text-xs font-bold text-[var(--z-danger)]">
                {lang === 'th' ? 'สาเหตุที่ตรวจพบ' : 'Detected Cause'}
              </div>
              <div className="font-mono text-xs text-[var(--app-text-primary)] break-words">
                {selectedItem.stage.errorReason ||
                  (lang === 'th' ? 'พบข้อผิดพลาดระหว่างการทำงาน' : 'Execution error reported')}
              </div>
              {selectedItem.stage.remediationHint && (
                <div className="pt-1 text-xs text-[var(--app-text-secondary)]">
                  <strong className="text-[var(--app-text-primary)]">
                    {lang === 'th' ? 'แนวทางแก้ไข: ' : 'Remediation: '}
                  </strong>
                  {lang === 'th'
                    ? selectedItem.stage.remediationHint.th
                    : selectedItem.stage.remediationHint.en}
                </div>
              )}
            </div>
          )}

          {selectedItem.stage.matchedLogs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--app-card-border)] bg-[var(--app-surface)] px-4 py-4 text-xs text-[var(--app-text-secondary)]">
              {lang === 'th'
                ? 'ยังไม่มีบันทึกการทำงานจาก Runtime ในขั้นตอนนี้'
                : 'No runtime events recorded for this stage yet.'}
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] divide-y divide-[var(--app-card-border)] font-mono text-xs">
              {selectedItem.stage.matchedLogs.map((entry) => (
                <div
                  key={`${selectedItem.stage.id}-L${entry.line}`}
                  className="flex items-start gap-3 px-3.5 py-2 hover:bg-[var(--app-surface)] transition-colors"
                >
                  <span className="text-[11px] tabular-nums text-[var(--app-text-secondary)] shrink-0">
                    L{entry.line}
                  </span>
                  <span
                    className={`text-[11px] font-bold shrink-0 ${
                      entry.tag === 'ERROR' || entry.tag === 'FAIL'
                        ? 'text-[var(--z-danger)]'
                        : entry.tag === 'DONE' || entry.tag === 'VERIFIED'
                        ? 'text-[var(--z-ok)]'
                        : entry.tag === 'TESTER'
                        ? 'text-[var(--app-amber)]'
                        : 'text-[var(--app-accent)]'
                    }`}
                  >
                    [{entry.tag}]
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[var(--app-text-primary)]">
                    {entry.message}
                  </span>
                  {entry.latencyMs !== null && (
                    <span className="text-[11px] tabular-nums text-[var(--app-text-secondary)] shrink-0">
                      {entry.latencyMs}ms
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
