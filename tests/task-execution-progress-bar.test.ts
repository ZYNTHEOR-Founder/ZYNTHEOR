import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deriveWorkflowSnapshot } from '../src/utils/workflowStages';
import {
  DEFAULT_LRU_CACHE_TASK_GOAL,
  deriveTaskExecutionProgress,
} from '../src/components/TaskExecutionProgressBar';

function run() {
  console.log('1. Testing idle state for Build In-Memory LRU Cache with TTL...');
  const idleSnap = deriveWorkflowSnapshot({
    logs: [],
    isRunning: false,
    isDone: false,
    goal: DEFAULT_LRU_CACHE_TASK_GOAL,
  });
  const idleProgress = deriveTaskExecutionProgress(idleSnap, [], DEFAULT_LRU_CACHE_TASK_GOAL);
  assert.equal(idleProgress.taskTitle, 'Build In-Memory LRU Cache with TTL');
  assert.equal(idleProgress.isDefaultLruCacheTask, true);
  assert.equal(idleProgress.overallState, 'IDLE');
  assert.equal(idleProgress.percentage, 0);
  assert.equal(idleProgress.completedSteps, 0);
  assert.equal(idleProgress.totalSteps, 7);
  assert.equal(idleProgress.latestLogLine, null);

  console.log('2. Testing mid-execution log stream progress tracking...');
  const runningLogs = [
    '[INIT] Initiating Sovereign Task: Build In-Memory LRU Cache with TTL (12ms)',
    '[PLANNER] Formulating LRU Cache architecture plan with O(1) Map + TTL eviction (45ms)',
    '[RESEARCH] Knowledge Workspace hit: Cache eviction patterns citation verified (28ms)',
    '[CODER] Synthesizing sovereign LRU Cache TypeScript artifact',
  ];
  const runningSnap = deriveWorkflowSnapshot({
    logs: runningLogs,
    isRunning: true,
    isDone: false,
    goal: DEFAULT_LRU_CACHE_TASK_GOAL,
  });
  const runningProgress = deriveTaskExecutionProgress(
    runningSnap,
    runningLogs,
    DEFAULT_LRU_CACHE_TASK_GOAL
  );
  assert.equal(runningProgress.overallState, 'RUNNING');
  assert.equal(runningProgress.completedSteps, 3);
  assert.equal(runningProgress.activeStepNumber, 4);
  assert.equal(runningProgress.currentStage?.id, 'creation_execution');
  assert.equal(runningProgress.percentage, 50);
  assert.equal(runningProgress.totalLogs, 4);
  assert.ok(runningProgress.latestLogLine?.includes('[CODER]'));

  console.log('3. Testing failed step tracking from TESTER exitCode log...');
  const failedLogs = [
    ...runningLogs,
    '[TESTER] exitCode: 1 — TTL expiry assertion FAILED',
  ];
  const failedSnap = deriveWorkflowSnapshot({
    logs: failedLogs,
    isRunning: false,
    isDone: false,
    goal: DEFAULT_LRU_CACHE_TASK_GOAL,
  });
  const failedProgress = deriveTaskExecutionProgress(
    failedSnap,
    failedLogs,
    DEFAULT_LRU_CACHE_TASK_GOAL
  );
  assert.equal(failedProgress.overallState, 'FAILED');
  assert.equal(failedProgress.failedStage?.id, 'testing_repair');
  assert.equal(failedProgress.activeStepNumber, 5);
  assert.ok(failedProgress.percentage > 0 && failedProgress.percentage < 100);

  console.log('4. Testing completed 7-stage execution tracking...');
  const completedLogs = [
    ...runningLogs,
    '[TESTER] exitCode: 0 — 8 unit tests passed (64ms)',
    '[DONE] Delivered verified LRU Cache artifact (evidenceHash: abc123def456)',
    '[LEARNING] Continuous learning sample staged for human approval (15ms)',
  ];
  const doneSnap = deriveWorkflowSnapshot({
    logs: completedLogs,
    isRunning: false,
    isDone: true,
    verificationHash: 'abc123def4567890',
    goal: DEFAULT_LRU_CACHE_TASK_GOAL,
  });
  const doneProgress = deriveTaskExecutionProgress(
    doneSnap,
    completedLogs,
    DEFAULT_LRU_CACHE_TASK_GOAL
  );
  assert.equal(doneProgress.overallState, 'COMPLETED');
  assert.equal(doneProgress.completedSteps, 7);
  assert.equal(doneProgress.percentage, 100);

  console.log('5. Verifying CommandCenter.tsx mounts TaskExecutionProgressBar...');
  const ccSrc = fs.readFileSync(path.resolve('src/components/modules/CommandCenter.tsx'), 'utf8');
  assert.ok(ccSrc.includes('<TaskExecutionProgressBar'), 'CommandCenter must render TaskExecutionProgressBar');
  const pbIdx = ccSrc.indexOf('<TaskExecutionProgressBar');
  const wsIdx = ccSrc.indexOf('<WorkflowStepper');
  assert.ok(pbIdx > 0 && wsIdx > pbIdx, 'TaskExecutionProgressBar should mount cleanly above WorkflowStepper');

  console.log('\nALL TASK EXECUTION PROGRESS BAR TESTS PASSED.');
}

run();
