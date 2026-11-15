/**
 * ZYNTHEOR Autonomous Planning Engine Unit Tests
 *
 * Verifies:
 *   1. Complex goal decomposition into discrete, ordered sub-tasks across stages
 *   2. Topological dependency resolution & priority tie-breaking
 *   3. Dependency cycle, unknown dependency, and duplicate step detection
 *   4. Step lifecycle tracking, resource budget exhaustion, and dynamic plan revision
 *   5. Completion verification & scoped disk persistence
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpPlansDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-plans-unit-'));
process.env.ZYNTHEOR_PLANS_DIR = tmpPlansDir;

let passed = 0;
let failed = 0;

async function runCase(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`✖ ${name}: ${err?.message || err}`);
    failed++;
  }
}

console.log('\n======================================================');
console.log('  ZYNTHEOR AUTONOMOUS PLANNING ENGINE UNIT TESTS      ');
console.log('======================================================\n');

async function main() {
  const { AutonomousPlanner, resolveDagOrder } = await import('../../lib/AutonomousPlanner.ts');
  const planner = AutonomousPlanner.getInstance();

  await runCase('1. Decomposes complex goal into discrete sub-tasks with valid DAG dependencies', () => {
    const plan = planner.decomposeGoal({
      taskId: 'TASK_PLAN_TEST_01',
      goal: 'Build multi-tenant webhook verifier with HMAC signatures, unit tests, and audit logging',
      priority: 'High',
      runtime: 'node',
      tenantId: 'tenant_alpha',
      ownerUserId: 'usr_dev_1',
    });

    assert.ok(plan.steps.length >= 7, `Expected >= 7 discrete sub-tasks, got ${plan.steps.length}`);
    assert.equal(plan.executionOrder.length, plan.steps.length);

    // Every dependency must appear earlier in executionOrder than its dependent
    const pos = new Map(plan.executionOrder.map((id, idx) => [id, idx]));
    for (const step of plan.steps) {
      for (const dep of step.dependsOn) {
        assert.ok(
          (pos.get(dep) ?? -1) < (pos.get(step.id) ?? -1),
          `Dependency '${dep}' must precede '${step.id}' in executionOrder`
        );
      }
    }

    assert.equal(plan.budget.maxToolCalls, 24);
    assert.equal(plan.budget.maxRetries, 3);
    assert.equal(plan.status, 'ACTIVE');
  });

  await runCase('2. Resolves diamond DAGs and orders independent steps by numeric priority', () => {
    const order = resolveDagOrder([
      { id: 'join', title: 'Join', stage: '06_TEST', dependsOn: ['left', 'right'], priority: 3, estimatedMs: 50, status: 'PENDING', attempts: 0 },
      { id: 'right', title: 'Right (High Prio)', stage: '04_BUILD', dependsOn: ['root'], priority: 1, estimatedMs: 50, status: 'PENDING', attempts: 0 },
      { id: 'left', title: 'Left (Low Prio)', stage: '04_BUILD', dependsOn: ['root'], priority: 9, estimatedMs: 50, status: 'PENDING', attempts: 0 },
      { id: 'root', title: 'Root', stage: '01_INTAKE', dependsOn: [], priority: 1, estimatedMs: 20, status: 'PENDING', attempts: 0 },
    ]);

    assert.equal(order[0], 'root');
    assert.ok(order.indexOf('right') < order.indexOf('left'), 'Higher priority step (1) should precede lower priority step (9)');
    assert.equal(order[order.length - 1], 'join');
  });

  await runCase('3. Detects direct and indirect cyclic dependencies fail-closed', () => {
    assert.throws(
      () =>
        resolveDagOrder([
          { id: 'a', title: 'A', stage: '01', dependsOn: ['c'], priority: 1, estimatedMs: 10, status: 'PENDING', attempts: 0 },
          { id: 'b', title: 'B', stage: '02', dependsOn: ['a'], priority: 2, estimatedMs: 10, status: 'PENDING', attempts: 0 },
          { id: 'c', title: 'C', stage: '03', dependsOn: ['b'], priority: 3, estimatedMs: 10, status: 'PENDING', attempts: 0 },
        ]),
      /PLAN_CYCLE_DETECTED/
    );
  });

  await runCase('4. Rejects unknown dependencies and duplicate step IDs', () => {
    assert.throws(
      () =>
        resolveDagOrder([
          { id: 'a', title: 'A', stage: '01', dependsOn: ['missing_step'], priority: 1, estimatedMs: 10, status: 'PENDING', attempts: 0 },
        ]),
      /PLAN_UNKNOWN_DEPENDENCY/
    );

    assert.throws(
      () =>
        resolveDagOrder([
          { id: 'dup', title: 'First', stage: '01', dependsOn: [], priority: 1, estimatedMs: 10, status: 'PENDING', attempts: 0 },
          { id: 'dup', title: 'Second', stage: '02', dependsOn: [], priority: 2, estimatedMs: 10, status: 'PENDING', attempts: 0 },
        ]),
      /PLAN_DUPLICATE_STEP/
    );
  });

  await runCase('5. Tracks step progress, budget exhaustion, and dynamic plan revision', () => {
    const taskId = 'TASK_PLAN_TEST_05';
    planner.decomposeGoal({
      taskId,
      goal: 'Create resilient parser with verification tests',
      priority: 'Medium',
      runtime: 'python3',
      tenantId: 'tenant_alpha',
      ownerUserId: 'usr_dev_1',
    });

    const running = planner.updateStepStatus(taskId, 'step_verify_tests', 'FAILED', {
      error: 'AssertionError on empty input',
    });
    assert.ok(running);

    const revised = planner.revisePlan(taskId, {
      reason: 'Empty input edge case failed verification test',
      failedStepId: 'step_verify_tests',
      actionTaken: 'Guard empty string before parsing and re-run test suite',
    });
    assert.ok(revised);
    assert.equal(revised!.status, 'REVISED');
    assert.equal(revised!.revisions.length, 1);
    assert.ok(revised!.executionOrder.includes('step_repair_1'));
    assert.ok(
      revised!.executionOrder.indexOf('step_repair_1') < revised!.executionOrder.indexOf('step_deliver_package'),
      'Dynamic repair step must precede final delivery gate'
    );

    const budget = planner.recordResourceUsage(taskId, { toolCalls: 25, retries: 2, elapsedMs: 1500 });
    assert.ok(budget);
    assert.equal(budget!.exhausted, true, 'Medium priority maxToolCalls=20 should mark budget exhausted at 25 calls');
    assert.match(budget!.exhaustedReason || '', /Tool call budget exceeded/);
  });

  await runCase('6. Enforces tenant/owner isolation and completion verification persistence', () => {
    const taskId = 'TASK_PLAN_TEST_06';
    planner.decomposeGoal({
      taskId,
      goal: 'Generate deterministic SHA-256 manifest utility',
      priority: 'Low',
      runtime: 'node',
      tenantId: 'tenant_alpha',
      ownerUserId: 'usr_dev_1',
    });

    const finalized = planner.finalizePlan(taskId, true, 'All acceptance criteria passed');
    assert.ok(finalized);
    assert.equal(finalized!.status, 'COMPLETED');
    assert.equal(finalized!.completionVerified, true);

    assert.ok(planner.getPlan(taskId, { tenantId: 'tenant_alpha', ownerUserId: 'usr_dev_1' }));
    assert.equal(planner.getPlan(taskId, { tenantId: 'tenant_beta', ownerUserId: 'usr_dev_1' }), null);
    assert.equal(planner.getPlan(taskId, { tenantId: 'tenant_alpha', ownerUserId: 'usr_other' }), null);
  });

  fs.rmSync(tmpPlansDir, { recursive: true, force: true });

  console.log('\n------------------------------------------------------');
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
