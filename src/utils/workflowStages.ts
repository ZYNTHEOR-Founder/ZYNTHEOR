export type WorkflowStageId =
  | 'task_intake'
  | 'reasoning_planning'
  | 'research_knowledge'
  | 'creation_execution'
  | 'testing_repair'
  | 'verification_delivery'
  | 'learning_adaptation';

export type WorkflowStageStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type WorkflowStepperStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface StageMatchedLog {
  line: number;
  raw: string;
  tag: string;
  message: string;
  latencyMs: number | null;
}

export interface WorkflowStageState {
  id: WorkflowStageId;
  order: number;
  labelEn: string;
  labelTh: string;
  subtitleEn: string;
  subtitleTh: string;
  status: WorkflowStageStatus;
  matchedLogs: StageMatchedLog[];
  durationMs: number | null;
  evidenceSummary: string | null;
  errorReason: string | null;
  remediationHint: { en: string; th: string } | null;
  terminalFilterQuery: string;
}

export interface WorkflowSnapshot {
  overallState: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  stages: WorkflowStageState[];
  activeStageIndex: number;
  stageStatuses: WorkflowStepperStatus[];
  completedSteps: number;
  totalSteps: number;
  totalLogs: number;
  totalDurationMs: number | null;
  activeStageId: WorkflowStageId | null;
  failedStageId: WorkflowStageId | null;
  goal: string;
}

interface StageDefinition {
  id: WorkflowStageId;
  order: number;
  labelEn: string;
  labelTh: string;
  subtitleEn: string;
  subtitleTh: string;
  terminalFilterQuery: string;
}

const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  {
    id: 'task_intake',
    order: 1,
    labelEn: 'Task Intake',
    labelTh: 'รับและวิเคราะห์คำสั่ง',
    subtitleEn: 'Receive and parse goal',
    subtitleTh: 'รับและวิเคราะห์คำสั่ง',
    terminalFilterQuery: '\\[(INIT|01_PERCEPTION)\\]|Initiating Sovereign|task intake',
  },
  {
    id: 'reasoning_planning',
    order: 2,
    labelEn: 'Reasoning & Planning',
    labelTh: 'คิดและวางแผน',
    subtitleEn: 'Formulate steps & tools',
    subtitleTh: 'คิดและวางแผน',
    terminalFilterQuery: '\\[(PLANNER|ARCHITECT|03_PLANNING)\\]|architecture plan|formulating',
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
    terminalFilterQuery: '\\[(CODER|REVIEWER|04_EXECUTION)\\]|synthesizing sovereign|code written|advisory review',
  },
  {
    id: 'testing_repair',
    order: 5,
    labelEn: 'Testing & Repair',
    labelTh: 'ทดสอบและแก้ไข',
    subtitleEn: 'Verify checks & auto-repair',
    subtitleTh: 'ทดสอบและแก้ไข',
    terminalFilterQuery: '\\[(TESTER|DEBUGGER|05_VERIFICATION|06_ADAPTATION)\\]|exitCode|static syntax check|self-repair',
  },
  {
    id: 'verification_delivery',
    order: 6,
    labelEn: 'Verification & Delivery',
    labelTh: 'ตรวจสอบและส่งมอบ',
    subtitleEn: 'Evidence, checksum & audit',
    subtitleTh: 'ตรวจสอบและส่งมอบ',
    terminalFilterQuery: '\\[(DONE|VERIFIED|08_AUTONOMY|AUDIT)\\]|Delivered|evidenceHash',
  },
  {
    id: 'learning_adaptation',
    order: 7,
    labelEn: 'Learning & Adaptation',
    labelTh: 'เรียนรู้และปรับปรุง',
    subtitleEn: 'Evaluate & stage learning',
    subtitleTh: 'ประเมินและปรับปรุง',
    terminalFilterQuery: '\\[(EVOLVER|LEARNING|07_LEARNING)\\]|learning|adaptation|training sample|approval gate',
  },
];

export function getWorkflowStageMeta(stageId: WorkflowStageId): StageDefinition | undefined {
  return STAGE_DEFINITIONS.find((def) => def.id === stageId);
}

function parseLogEntry(raw: string): { tag: string; message: string } {
  const match = raw.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
  if (!match) {
    return { tag: 'INFO', message: raw };
  }
  return { tag: match[1].toUpperCase(), message: match[2] || raw };
}

function classifyStageIndex(tag: string, message: string, currentHighestIdx: number): number {
  const upperTag = tag.toUpperCase();
  const lowerMsg = message.toLowerCase();

  if (
    upperTag === 'INIT' ||
    upperTag === '01_PERCEPTION' ||
    lowerMsg.includes('initiating sovereign') ||
    lowerMsg.includes('task intake')
  ) {
    return 0;
  }

  if (
    upperTag === 'PLANNER' ||
    upperTag === 'ARCHITECT' ||
    upperTag === '03_PLANNING' ||
    lowerMsg.includes('architecture plan') ||
    lowerMsg.includes('formulating')
  ) {
    return 1;
  }

  if (
    upperTag === 'RESEARCH' ||
    upperTag === 'KNOWLEDGE' ||
    upperTag === '02_INTELLIGENCE' ||
    lowerMsg.includes('knowledge workspace') ||
    lowerMsg.includes('knowledge graph') ||
    lowerMsg.includes('context analysis') ||
    lowerMsg.includes('citation')
  ) {
    return 2;
  }

  if (
    upperTag === 'CODER' ||
    upperTag === 'REVIEWER' ||
    upperTag === '04_EXECUTION' ||
    lowerMsg.includes('synthesizing sovereign') ||
    lowerMsg.includes('code written') ||
    lowerMsg.includes('advisory review')
  ) {
    return 3;
  }

  if (
    upperTag === 'TESTER' ||
    upperTag === 'DEBUGGER' ||
    upperTag === '05_VERIFICATION' ||
    upperTag === '06_ADAPTATION' ||
    lowerMsg.includes('exitcode:') ||
    lowerMsg.includes('static syntax check') ||
    lowerMsg.includes('self-repair')
  ) {
    return 4;
  }

  if (
    upperTag === 'DONE' ||
    upperTag === 'VERIFIED' ||
    upperTag === '08_AUTONOMY' ||
    upperTag === 'AUDIT' ||
    lowerMsg.includes('delivered verified') ||
    lowerMsg.includes('evidencehash')
  ) {
    return 5;
  }

  if (
    upperTag === 'EVOLVER' ||
    upperTag === 'LEARNING' ||
    upperTag === '07_LEARNING' ||
    lowerMsg.includes('continuous learning') ||
    lowerMsg.includes('training sample') ||
    lowerMsg.includes('approval gate')
  ) {
    return 6;
  }

  if (upperTag === 'ERROR' || upperTag === 'FAIL' || upperTag === 'FATAL') {
    if (lowerMsg.includes('syntax') || lowerMsg.includes('exitcode') || lowerMsg.includes('test')) {
      return 4;
    }
    if (lowerMsg.includes('reviewer') || lowerMsg.includes('rejected') || lowerMsg.includes('coder')) {
      return 3;
    }
    if (lowerMsg.includes('plan')) {
      return 1;
    }
    return currentHighestIdx >= 0 ? currentHighestIdx : 0;
  }

  return currentHighestIdx >= 0 ? currentHighestIdx : 0;
}

function isErrorEntry(tag: string, message: string): boolean {
  const upperTag = tag.toUpperCase();
  if (upperTag === 'ERROR' || upperTag === 'FAIL' || upperTag === 'FATAL') {
    return true;
  }
  if (upperTag === 'TESTER') {
    const exitMatch = message.match(/exitCode:\s*(-?\d+)/i);
    if (exitMatch && Number(exitMatch[1]) !== 0) {
      return true;
    }
    if (/\bFAILED\b/i.test(message)) {
      return true;
    }
  }
  if (/^FAILED\b|:\s*FAILED\b/i.test(message) && !/0 failed/i.test(message)) {
    return true;
  }
  return false;
}

function buildRemediationHint(errorText: string): { en: string; th: string } {
  const lower = errorText.toLowerCase();

  if (lower.includes('fail_closed') || lower.includes('online connectivity required') || lower.includes('cloud runtime')) {
    return {
      en: 'Verify Cloud Runtime URL, S3/Storage credentials, and online connectivity in User Settings before re-running.',
      th: 'ตรวจสอบ Cloud Runtime URL, S3/Storage และสถานะออนไลน์ใน User Settings ก่อนสั่งรันซ้ำ',
    };
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('rbac') || lower.includes('auth') || lower.includes('unauthorized')) {
    return {
      en: 'Sign in with a verified Developer or Administrator session so orchestration routes are authorized.',
      th: 'เข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator เพื่ออนุญาตการสั่งรัน Pipeline',
    };
  }
  if (lower.includes('syntax') || lower.includes('exitcode') || lower.includes('test')) {
    return {
      en: 'Inspect the failing test output in Execution Terminal and review the generated artifact in /workspace.',
      th: 'เปิดดูรายละเอียด exitCode ใน Execution Terminal และตรวจสอบไฟล์โค้ดใน /workspace',
    };
  }
  if (lower.includes('rejected') || lower.includes('reviewer')) {
    return {
      en: 'Reviewer blocked unsafe constructs. Refine the task prompt or inspect reviewer feedback in the terminal logs.',
      th: 'Reviewer ปฏิเสธโค้ดที่ไม่ปลอดภัย ให้ปรับคำสั่งงานหรือดูข้อเสนอแนะในบันทึกการทำงาน',
    };
  }
  if (lower.includes('stream unavailable') || lower.includes('network') || lower.includes('fetch')) {
    return {
      en: 'Runtime stream interrupted. Confirm backend server health on port 3000 and retry execution.',
      th: 'การเชื่อมต่อสตรีมขาดช่วง ตรวจสอบเซิร์ฟเวอร์พอร์ต 3000 แล้วลองรันใหม่อีกครั้ง',
    };
  }
  return {
    en: 'Inspect the captured error trace in the Execution Terminal and retry once the underlying cause is resolved.',
    th: 'ตรวจสอบรายละเอียด Error ใน Execution Terminal และแก้ไขสาเหตุก่อนกดลองรันใหม่',
  };
}

export interface DeriveWorkflowInput {
  logs: string[];
  isRunning: boolean;
  isDone: boolean;
  stepLatencies?: Array<{ latencyMs: number; timestamp: string }>;
  verificationHash?: string | null;
  totalExecMs?: number | null;
  goal?: string;
}

export function deriveWorkflowSnapshot({
  logs,
  isRunning,
  isDone,
  stepLatencies = [],
  verificationHash = null,
  totalExecMs = null,
  goal = '',
}: DeriveWorkflowInput): WorkflowSnapshot {
  const matchedByStage: StageMatchedLog[][] = STAGE_DEFINITIONS.map(() => []);
  const stageErrors: Array<string | null> = STAGE_DEFINITIONS.map(() => null);

  let highestStageIdx = -1;
  let lastMatchedStageIdx = -1;
  let errorStageIdx: number | null = null;
  let hasDoneTag = false;

  logs.forEach((raw, idx) => {
    const { tag, message } = parseLogEntry(raw);
    if (tag === 'DONE' || tag === 'VERIFIED') {
      hasDoneTag = true;
    }

    const stageIdx = classifyStageIndex(tag, message, highestStageIdx);
    if (stageIdx > highestStageIdx) {
      highestStageIdx = stageIdx;
    }
    lastMatchedStageIdx = stageIdx;

    const recordedLatency = stepLatencies[idx]?.latencyMs;
    const explicitMsMatch = raw.match(/(\d+(?:\.\d+)?)\s*ms\b/i);
    const latencyMs =
      typeof recordedLatency === 'number' && Number.isFinite(recordedLatency) && recordedLatency >= 0
        ? recordedLatency
        : explicitMsMatch
        ? Math.max(1, Math.round(Number(explicitMsMatch[1])))
        : null;

    matchedByStage[stageIdx].push({
      line: idx + 1,
      raw,
      tag,
      message,
      latencyMs,
    });

    if (isErrorEntry(tag, message)) {
      errorStageIdx = stageIdx;
      stageErrors[stageIdx] = message || raw;
    }
  });

  const effectiveDone = isDone || hasDoneTag;

  const stages: WorkflowStageState[] = STAGE_DEFINITIONS.map((def, idx) => {
    const stageLogs = matchedByStage[idx];
    const hasLogs = stageLogs.length > 0;
    const hasExplicitDeliveryEvidence = def.id === 'verification_delivery' && Boolean(verificationHash) && effectiveDone;

    let status: WorkflowStageStatus = 'PENDING';

    if (errorStageIdx !== null) {
      if (idx === errorStageIdx) {
        status = 'FAILED';
      } else if (idx < errorStageIdx && (hasLogs || idx === 0)) {
        status = 'COMPLETED';
      } else {
        status = 'PENDING';
      }
    } else if (isRunning) {
      const runningIdx = lastMatchedStageIdx >= 0 ? lastMatchedStageIdx : 0;
      if (idx === runningIdx) {
        status = 'RUNNING';
      } else if (idx < runningIdx && hasLogs) {
        status = 'COMPLETED';
      } else {
        status = 'PENDING';
      }
    } else if (effectiveDone) {
      if (hasLogs || hasExplicitDeliveryEvidence) {
        status = 'COMPLETED';
      } else {
        status = 'PENDING';
      }
    } else if (hasLogs) {
      // Persisted partial trace from an interrupted session (neither running nor done)
      status = idx < highestStageIdx ? 'COMPLETED' : 'PENDING';
    }

    const measuredLatencies = stageLogs
      .map((l) => l.latencyMs)
      .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms));
    const durationMs =
      measuredLatencies.length > 0
        ? measuredLatencies.reduce((acc, n) => acc + n, 0)
        : null;

    const errMsg = stageErrors[idx];
    let evidenceSummary: string | null = null;
    if (def.id === 'verification_delivery' && verificationHash && status === 'COMPLETED') {
      evidenceSummary = `Evidence SHA-256: ${verificationHash.slice(0, 16)}…`;
    } else if (hasLogs) {
      evidenceSummary = stageLogs[stageLogs.length - 1].message;
    }

    return {
      ...def,
      status,
      matchedLogs: stageLogs,
      durationMs,
      evidenceSummary,
      errorReason: errMsg,
      remediationHint: errMsg ? buildRemediationHint(errMsg) : null,
      terminalFilterQuery: def.terminalFilterQuery,
    };
  });

  const completedSteps = stages.filter((s) => s.status === 'COMPLETED').length;
  const activeStage = stages.find((s) => s.status === 'RUNNING') ?? null;
  const failedStage = stages.find((s) => s.status === 'FAILED') ?? null;

  let overallState: WorkflowSnapshot['overallState'] = 'IDLE';
  if (failedStage) {
    overallState = 'FAILED';
  } else if (isRunning) {
    overallState = 'RUNNING';
  } else if (effectiveDone) {
    overallState = completedSteps === stages.length ? 'COMPLETED' : 'PARTIAL';
  } else if (logs.length > 0) {
    overallState = 'PARTIAL';
  }

  const summedLatencies = stages
    .map((s) => s.durationMs)
    .filter((ms): ms is number => typeof ms === 'number');
  const computedTotalDurationMs =
    typeof totalExecMs === 'number' && Number.isFinite(totalExecMs)
      ? totalExecMs
      : summedLatencies.length > 0
      ? summedLatencies.reduce((acc, n) => acc + n, 0)
      : null;

  const stageStatuses: WorkflowStepperStatus[] = stages.map(
    (s) => s.status.toLowerCase() as WorkflowStepperStatus
  );

  let activeStageIndex = -1;
  if (failedStage) {
    activeStageIndex = stages.findIndex((s) => s.id === failedStage.id);
  } else if (activeStage) {
    activeStageIndex = stages.findIndex((s) => s.id === activeStage.id);
  } else if (logs.length > 0) {
    activeStageIndex = stages.reduce(
      (lastIdx, s, idx) => (s.status === 'COMPLETED' || s.matchedLogs.length > 0 ? idx : lastIdx),
      -1
    );
  }

  return {
    overallState,
    stages,
    activeStageIndex,
    stageStatuses,
    completedSteps,
    totalSteps: stages.length,
    totalLogs: logs.length,
    totalDurationMs: computedTotalDurationMs,
    activeStageId: activeStage?.id ?? failedStage?.id ?? null,
    failedStageId: failedStage?.id ?? null,
    goal,
  };
}

export function getStageMatchedLineIndices(
  logs: string[],
  stageId: WorkflowStageId
): Set<number> {
  const targetStageIdx = STAGE_DEFINITIONS.findIndex((def) => def.id === stageId);
  const indices = new Set<number>();
  if (targetStageIdx < 0 || logs.length === 0) return indices;

  let highestStageIdx = -1;
  logs.forEach((raw, idx) => {
    const { tag, message } = parseLogEntry(raw);
    const stageIdx = classifyStageIndex(tag, message, highestStageIdx);
    if (stageIdx > highestStageIdx) {
      highestStageIdx = stageIdx;
    }
    if (stageIdx === targetStageIdx) {
      indices.add(idx);
    }
  });

  return indices;
}
