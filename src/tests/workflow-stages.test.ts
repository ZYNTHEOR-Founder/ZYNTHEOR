import assert from 'node:assert/strict';
import {
  deriveWorkflowSnapshot,
  getStageMatchedLineIndices,
  getWorkflowStageMeta,
} from '../utils/workflowStages.ts';

// 1. Idle zero-state
{
  const snap = deriveWorkflowSnapshot({
    logs: [],
    isRunning: false,
    isDone: false,
    goal: 'Build cache',
  });
  assert.equal(snap.overallState, 'IDLE');
  assert.equal(snap.activeStageIndex, -1);
  assert.deepEqual(snap.stageStatuses, Array(7).fill('pending'));
  assert.equal(snap.stages.length, 7);
  assert.equal(snap.completedSteps, 0);
  assert.equal(snap.totalLogs, 0);
  assert.ok(snap.stages.every((s) => s.status === 'PENDING'));
}

// 2. Live streaming mid-run highlights only active stage as RUNNING and prior emitted stages as COMPLETED
{
  const snap = deriveWorkflowSnapshot({
    logs: [
      '[INIT] Initiating Sovereign Multi-Agent for: "Build cache"',
      '[PLANNER] Formulating step-by-step sovereign architecture plan...',
      '[CODER] Synthesizing sovereign native code via stream...',
    ],
    isRunning: true,
    isDone: false,
    stepLatencies: [
      { latencyMs: 12, timestamp: '2026-11-17T00:00:00Z' },
      { latencyMs: 48, timestamp: '2026-11-17T00:00:01Z' },
      { latencyMs: 95, timestamp: '2026-11-17T00:00:02Z' },
    ],
    goal: 'Build cache',
  });

  assert.equal(snap.overallState, 'RUNNING');
  assert.equal(snap.activeStageIndex, 3);
  assert.deepEqual(snap.stageStatuses, [
    'completed',
    'completed',
    'pending',
    'running',
    'pending',
    'pending',
    'pending',
  ]);
  assert.equal(snap.activeStageId, 'creation_execution');
  assert.equal(snap.stages.find((s) => s.id === 'task_intake')?.status, 'COMPLETED');
  assert.equal(snap.stages.find((s) => s.id === 'reasoning_planning')?.status, 'COMPLETED');
  assert.equal(snap.stages.find((s) => s.id === 'research_knowledge')?.status, 'PENDING');
  assert.equal(snap.stages.find((s) => s.id === 'creation_execution')?.status, 'RUNNING');
  assert.equal(snap.stages.find((s) => s.id === 'testing_repair')?.status, 'PENDING');
  assert.equal(snap.totalDurationMs, 155);
}

// 3. Error isolation: only failing stage becomes FAILED with cause & remediation
{
  const logs = [
    '[INIT] Initiating Sovereign Multi-Agent for: "Build cache"',
    '[PLANNER] Architecture plan drafted.',
    '[ERROR] FAIL_CLOSED: Online Connectivity Required (NO_CLOUD_RUNTIME)',
  ];
  const snap = deriveWorkflowSnapshot({
    logs,
    isRunning: false,
    isDone: false,
    goal: 'Build cache',
  });

  assert.equal(snap.overallState, 'FAILED');
  assert.equal(snap.activeStageIndex, 1);
  assert.equal(snap.stageStatuses[1], 'failed');
  assert.equal(snap.failedStageId, 'reasoning_planning');
  assert.equal(snap.stages.find((s) => s.id === 'task_intake')?.status, 'COMPLETED');
  const failed = snap.stages.find((s) => s.id === 'reasoning_planning');
  assert.equal(failed?.status, 'FAILED');
  assert.ok(failed?.errorReason?.includes('Online Connectivity Required'));
  assert.ok(failed?.remediationHint?.en.includes('Cloud Runtime'));
  assert.equal(snap.stages.filter((s) => s.status === 'FAILED').length, 1);

  // Stage-based terminal filtering includes both planning log and contextual error line
  const planningLineIndices = getStageMatchedLineIndices(logs, 'reasoning_planning');
  assert.deepEqual(Array.from(planningLineIndices), [1, 2]);
}

// 4. Full 7-stage completion with verification hash evidence & per-stage terminal filter integrity
{
  const logs = [
    '[INIT] Initiating Sovereign Multi-Agent',
    '[PLANNER] Plan formulated',
    '[KNOWLEDGE] Context retrieved from Knowledge Workspace',
    '[CODER] Code written to /workspace/solution.js',
    '[REVIEWER] Advisory review approved',
    '[TESTER] exitCode: 0 | Static syntax check PASSED in 32ms',
    '[DONE] Delivered verified draft',
    '[EVOLVER] Continuous learning sample staged',
  ];
  const snap = deriveWorkflowSnapshot({
    logs,
    isRunning: false,
    isDone: true,
    verificationHash: 'abcdef1234567890abcdef1234567890',
    totalExecMs: 420,
    goal: 'Full pipeline run',
  });

  assert.equal(snap.overallState, 'COMPLETED');
  assert.equal(snap.activeStageIndex, 6);
  assert.deepEqual(snap.stageStatuses, Array(7).fill('completed'));
  assert.equal(snap.completedSteps, 7);
  assert.equal(snap.totalDurationMs, 420);
  const delivery = snap.stages.find((s) => s.id === 'verification_delivery');
  assert.equal(delivery?.status, 'COMPLETED');
  assert.ok(delivery?.evidenceSummary?.includes('abcdef1234567890'));

  // Verify stage-to-terminal filtering maps each stage accurately
  assert.deepEqual(Array.from(getStageMatchedLineIndices(logs, 'task_intake')), [0]);
  assert.deepEqual(Array.from(getStageMatchedLineIndices(logs, 'reasoning_planning')), [1]);
  assert.deepEqual(Array.from(getStageMatchedLineIndices(logs, 'research_knowledge')), [2]);
  assert.deepEqual(Array.from(getStageMatchedLineIndices(logs, 'creation_execution')), [3, 4]);
  assert.deepEqual(Array.from(getStageMatchedLineIndices(logs, 'testing_repair')), [5]);
  assert.deepEqual(Array.from(getStageMatchedLineIndices(logs, 'verification_delivery')), [6]);
  assert.deepEqual(Array.from(getStageMatchedLineIndices(logs, 'learning_adaptation')), [7]);

  // Verify stage metadata lookup & terminalFilterQuery regex compilation
  for (const stage of snap.stages) {
    const meta = getWorkflowStageMeta(stage.id);
    assert.ok(meta);
    const regex = new RegExp(stage.terminalFilterQuery, 'i');
    assert.ok(
      stage.matchedLogs.every((entry) => regex.test(entry.raw)),
      `Expected terminalFilterQuery for ${stage.id} to match all stage logs`
    );
  }
}

console.log('workflow-stages.test.ts: ALL ASSERTIONS PASSED');

