import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const src = fs.readFileSync(new URL('../lib/TaskOrchestrator.ts', import.meta.url), 'utf8');
const ae = src.match(/export function assertDeliveryEvidence[\s\S]*?\n}\n/);
assert.ok(ae, 'assertDeliveryEvidence must exist in TaskOrchestrator.ts');
const js = stripTypeScriptTypes(ae[0].replace('export function', 'function')) + '\nreturn assertDeliveryEvidence;';
const guard = new Function(js)();

const criteria = [
  { id: 'AC-01-SYNTAX', passed: true, evidence: 'exitCode=0' },
  { id: 'AC-02-ZIP', passed: true, evidence: 'sha' },
];
const cycle = (o = {}) => ({ executionEvidenceHash: 'h', acceptanceCriteria: criteria, ...o });

test('syntax pass + ZIP pass but runtimeExecuted false can NOT be DELIVERED', () => {
  assert.throws(() => guard({ lifecycleStatus: 'Delivered', deliveryStatus: 'DELIVERED' }, cycle({ runtimeExecuted: false })), /DELIVERY_REQUIRES_RUNTIME_EVIDENCE/);
  assert.throws(() => guard({ deliveryStatus: 'DELIVERED' }, cycle()), /DELIVERY_REQUIRES_RUNTIME_EVIDENCE/); // field missing
  assert.throws(() => guard({ lifecycleStatus: 'Delivered' }, null), /DELIVERY_REQUIRES_RUNTIME_EVIDENCE/);
});

test('DELIVERED also requires an evidence hash and all acceptance criteria passed', () => {
  assert.throws(() => guard({ executionResult: 'DELIVERED' }, cycle({ runtimeExecuted: true, executionEvidenceHash: '' })));
  assert.throws(() => guard({ executionResult: 'DELIVERED' }, cycle({ runtimeExecuted: true, acceptanceCriteria: [{ id: 'x', passed: false }] })));
  assert.throws(() => guard({ executionResult: 'DELIVERED' }, cycle({ runtimeExecuted: true, acceptanceCriteria: [] })));
});

test('DELIVERED with real runtime evidence is allowed; BLOCKED and FAILED never need it', () => {
  assert.doesNotThrow(() => guard({ lifecycleStatus: 'Delivered', deliveryStatus: 'DELIVERED' }, cycle({ runtimeExecuted: true })));
  assert.doesNotThrow(() => guard({ lifecycleStatus: 'Blocked', deliveryStatus: 'BLOCKED' }, cycle({ runtimeExecuted: false })));
  assert.doesNotThrow(() => guard({ lifecycleStatus: 'Failed', deliveryStatus: 'FAILED' }, null));
});

test('guard is enforced on persistence and metrics paths; blocked tasks stay resumable and failures are audited', () => {
  assert.match(src, /assertDeliveryEvidence\(\{ lifecycleStatus: record\.lifecycleStatus \}, record\.executionCycle\)/);
  assert.match(src, /assertDeliveryEvidence\(cycle, cycle\)/);
  assert.match(src, /resumable: syntaxCheckPassed,/);
  assert.match(src, /'TASK_BLOCKED_CLOUD_RUNNER'[\s\S]*?runtimeExecuted: false[\s\S]*?blockedAt: finishTimestamp[\s\S]*?blockedReason/);
  assert.match(src, /'TASK_FAILED_STATIC_CHECK'[\s\S]*?runtimeExecuted: false/);
  assert.match(src, /runtimeExecuted: false,\n\s+runtimeEnvironment: null,/);
  assert.doesNotMatch(src, /'TASK_DELIVERED'/);
  assert.doesNotMatch(src, /success: syntaxCheckPassed/);
});

test('ActionDrivenEngine labels runtime evidence and the non-isolated environment', () => {
  const ade = fs.readFileSync(new URL('../lib/ActionDrivenEngine.ts', import.meta.url), 'utf8');
  assert.match(ade, /runtimeExecuted: allCriteriaPassed/);
  assert.match(ade, /local_tool_gateway_sandbox/);
  assert.match(ade, /not a dedicated isolated Cloud Runner/);
});
