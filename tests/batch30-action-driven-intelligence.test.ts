/**
 * ZYNTHEOR Batch 30 — Action-Driven Native Intelligence Test Suite
 *
 * Tests all 8 Action-Driven pillars under Zero Simulation Policy with isolated state:
 *   1. Perception (workspace inspection, honest runtimeState, AuditLedger check)
 *   2. Intelligence + Fail-Closed requireNativeModel=true when weights unavailable
 *   3. Planning + Execution + Verification + Delivery (Node & Python blueprints + SHA-256 ZIP)
 *   4. Adaptation (Self-repair fixing unsafe eval() + missing brace, plus rollback on unrepairable error)
 *   5. System Integrity Audit & Formal Reasoning Verification modes
 *   6. Learning Capture (PII-scrubbed lesson stored only when verified) & TaskOrchestrator metrics
 *   7. ApprovalGate high-impact enforcement & single-use consumption
 *   8. Tenant/owner cross-isolation & Live HTTP RBAC server tests (/api/action/*)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        srv.close(() => resolve(addr.port));
      } else {
        srv.close(() => reject(new Error('Failed to resolve free port')));
      }
    });
  });
}

async function waitForServer(baseUrl: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/health`);
}

async function devLogin(baseUrl: string, role: string, tenantId: string, userId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, tenantId, userId }),
  });
  const data = await res.json();
  assert.equal(res.status, 200, `Login failed for ${role}: ${JSON.stringify(data)}`);
  return data.token;
}

const createdWorkspaceRelPaths: string[] = [];
const createdDeliverableZips: string[] = [];

function trackMissionArtifacts(mission: any) {
  if (Array.isArray(mission?.artifacts)) {
    for (const a of mission.artifacts) {
      if (typeof a.path === 'string' && a.path.startsWith('/workspace/')) {
        createdWorkspaceRelPaths.push(a.path.replace(/^\/workspace\//, ''));
      }
    }
  }
  if (mission?.packageArtifact?.zipFilename) {
    createdDeliverableZips.push(mission.packageArtifact.zipFilename);
  }
}

function cleanupCreatedArtifacts() {
  const workspaceRoot = path.resolve(process.cwd(), 'workspace');
  for (const rel of createdWorkspaceRelPaths) {
    try {
      const full = path.resolve(workspaceRoot, rel);
      if (full.startsWith(workspaceRoot + path.sep) && fs.existsSync(full)) {
        fs.rmSync(full, { force: true });
        const parent = path.dirname(full);
        if (parent !== workspaceRoot && path.basename(parent).startsWith('act-')) {
          fs.rmSync(parent, { recursive: true, force: true });
        }
      }
    } catch {
      // ignore
    }
  }
  const delivDir = path.resolve(process.cwd(), 'native_data', 'deliverables');
  for (const zip of createdDeliverableZips) {
    try {
      const full = path.resolve(delivDir, zip);
      if (full.startsWith(delivDir + path.sep) && fs.existsSync(full)) {
        fs.rmSync(full, { force: true });
      }
    } catch {
      // ignore
    }
  }
}

async function runModuleTests(tmpDir: string) {
  process.env.ZYNTHEOR_AUDIT_FILE = path.join(tmpDir, 'audit_log.jsonl');
  process.env.ZYNTHEOR_EXEC_METRICS_FILE = path.join(tmpDir, 'execution_metrics.json');
  process.env.ZYNTHEOR_ACTION_MISSIONS_FILE = path.join(tmpDir, 'action_missions.json');
  process.env.ZYNTHEOR_PLANS_DIR = path.join(tmpDir, 'plans');
  process.env.ZYNTHEOR_APPROVALS_FILE = path.join(tmpDir, 'approvals.json');
  process.env.ZYNTHEOR_CONTEXT_FILE = path.join(tmpDir, 'cognitive_context.json');
  process.env.ZYNTHEOR_PERF_FILE = path.join(tmpDir, 'performance_profiles.json');
  process.env.ZYNTHEOR_KG_FILE = path.join(tmpDir, 'knowledge_graph.json');
  process.env.ZYNTHEOR_REASONING_LOG = path.join(tmpDir, 'adaptive_reasoning_history.json');
  process.env.ZYNTHEOR_EVAL_HISTORY_FILE = path.join(tmpDir, 'eval_history.json');

  const { ActionDrivenEngine } = await import('../lib/ActionDrivenEngine.ts');
  const { ApprovalGate } = await import('../lib/ApprovalGate.ts');
  const { TaskOrchestrator } = await import('../lib/TaskOrchestrator.ts');
  const { NativeMemoryController } = await import('../lib/NativeMemoryController.ts');
  const { AuditLedger } = await import('../lib/AuditLedger.ts');

  const engine = ActionDrivenEngine.getInstance();
  const scopeA = { tenantId: 'b30_tenant_alpha', userId: 'b30_dev_a', role: 'developer' as const };
  const adminA = { tenantId: 'b30_tenant_alpha', userId: 'b30_admin_a', role: 'admin' as const };
  const scopeB = { tenantId: 'b30_tenant_beta', userId: 'b30_dev_b', role: 'developer' as const };

  // 1. Capabilities & Perception (Zero Simulation check)
  const caps = await engine.getCapabilities(scopeA);
  assert.equal(caps.policy, 'ZERO_SIMULATION_ACTION_DRIVEN');
  assert.equal(caps.weightsLoaded, false);
  assert.equal(caps.nativeNeuralState, 'NOT_CONFIGURED');
  assert.equal(caps.deterministicActionEngineReady, true);
  assert.equal(caps.pillarReadiness.length, 8);

  const perception = await engine.perceiveEnvironment('Build LRU cache and test it', scopeA);
  assert.equal(perception.connectivity.weightsLoaded, false);
  assert.equal(perception.auditIntegrity.valid, true);
  assert.ok(perception.contextAnalysis.intent.primary);

  // 2. Fail-closed requireNativeModel=true when weights are absent
  const blockedNeural = await engine.executeActionMission(
    {
      goal: 'Generate neural code requiring cloud model weights',
      requireNativeModel: true,
    },
    scopeA
  );
  assert.equal(blockedNeural.status, 'BLOCKED');
  assert.ok(blockedNeural.failureReason?.includes('BLOCKED_NATIVE_MODEL_REQUIRED'));

  // 3. Engineering Blueprint Execute (Node LRU Cache + Unit Tests + SHA-256 ZIP + Learning + Metrics)
  const nodeMission = await engine.executeActionMission(
    {
      goal: 'Build an in-memory LRU cache with TTL eviction and verify tests',
      mode: 'engineering_blueprint_execute',
      runtime: 'node',
    },
    scopeA
  );
  trackMissionArtifacts(nodeMission);
  assert.equal(nodeMission.status, 'DELIVERED');
  assert.equal(nodeMission.attribution, 'deterministic_action_engine');
  assert.equal(nodeMission.nativeNeuralState, 'NOT_CONFIGURED');
  assert.equal(nodeMission.pillars.length, 8);
  assert.equal(nodeMission.verificationOutput?.syntaxOk, true);
  assert.equal(nodeMission.verificationOutput?.runtimeExitCode, 0);
  assert.equal(nodeMission.verificationOutput?.unitTestExitCode, 0);
  assert.ok(nodeMission.packageArtifact?.integrityOk, 'ZIP deliverable SHA-256 must verify');
  assert.equal(nodeMission.learningCapture?.captured, true);
  assert.ok(nodeMission.learningCapture?.memoryKey);

  // Verify captured lesson exists in NativeMemoryController under tenant scope
  const memItem = NativeMemoryController.getInstance().retrieveMemory(nodeMission.learningCapture!.memoryKey!, {
    tenantId: scopeA.tenantId,
    userId: scopeA.userId,
    role: scopeA.role,
  });
  assert.ok(memItem, 'Verified lesson must be stored in NativeMemoryController');

  // 4. Engineering Blueprint Execute (Python DAG Scheduler)
  const pyMission = await engine.executeActionMission(
    {
      goal: 'Build a topological DAG dependency scheduler in Python with cycle detection',
      mode: 'engineering_blueprint_execute',
      runtime: 'python3',
    },
    scopeA
  );
  trackMissionArtifacts(pyMission);
  assert.equal(pyMission.status, 'DELIVERED');
  assert.equal(pyMission.runtime, 'python3');
  assert.equal(pyMission.verificationOutput?.syntaxOk, true);
  assert.equal(pyMission.verificationOutput?.unitTestExitCode, 0);

  // Verify TaskOrchestrator recorded both cycles cleanly
  const execMetrics = TaskOrchestrator.getInstance().getExecutionMetrics();
  assert.ok(execMetrics.totalCycles >= 2, `Expected >=2 execution cycles, got ${execMetrics.totalCycles}`);

  // 5. Adaptation & Self-Repair (fixes unsafe eval() + missing brace)
  const buggyTarget = `missions/b30_repair_${Date.now()}.js`;
  createdWorkspaceRelPaths.push(buggyTarget);
  const repairMission = await engine.executeActionMission(
    {
      goal: 'Verify and self-repair broken JS config parser',
      mode: 'workspace_verify_repair',
      runtime: 'node',
      targetFile: buggyTarget,
      sourceCode:
        'function parseCfg(raw) {\n  const parsed = eval("(" + raw + ")");\n  return parsed.ok;\n\nconsole.log(JSON.stringify({ ok: parseCfg(\'{"ok":true}\') }));\n',
    },
    scopeA
  );
  trackMissionArtifacts(repairMission);
  assert.equal(repairMission.status, 'DELIVERED');
  assert.ok(repairMission.repairHistory.length >= 1, 'Must attempt deterministic repair');
  assert.equal(repairMission.repairHistory[repairMission.repairHistory.length - 1].resolved, true);
  const p6 = repairMission.pillars.find((p) => p.id === '06_ADAPTATION');
  assert.equal(p6?.status, 'REPAIRED');

  // 6. Unrepairable failure must remain FAILED (Zero False Completion)
  const unrepairableTarget = `missions/b30_fail_${Date.now()}.js`;
  createdWorkspaceRelPaths.push(unrepairableTarget);
  const failedMission = await engine.executeActionMission(
    {
      goal: 'Verify broken script that throws ReferenceError',
      mode: 'workspace_verify_repair',
      runtime: 'node',
      targetFile: unrepairableTarget,
      sourceCode: 'console.log(nonExistentVariableShouldFail);\n',
    },
    scopeA
  );
  trackMissionArtifacts(failedMission);
  assert.equal(failedMission.status, 'FAILED');
  assert.equal(failedMission.packageArtifact ?? null, null);
  assert.equal(failedMission.learningCapture?.captured, false);

  // 7. System Integrity Audit & Reasoning Verification modes
  const auditMission = await engine.executeActionMission(
    {
      goal: 'Audit system integrity and SSRF hardening',
      mode: 'system_integrity_audit',
    },
    scopeA
  );
  trackMissionArtifacts(auditMission);
  assert.equal(auditMission.status, 'DELIVERED');

  const reasonMission = await engine.executeActionMission(
    {
      goal: 'Verify multi-step arithmetic proof for capacity planning',
      mode: 'reasoning_verification',
      mathSteps: [
        { expr: '40 + 60', claimed: 100 },
        { expr: '100 * 3', claimed: 300 },
      ],
      expectedFinal: 300,
    },
    scopeA
  );
  trackMissionArtifacts(reasonMission);
  assert.equal(reasonMission.status, 'DELIVERED');

  // 8. ApprovalGate high-impact blocking + admin approval + single-use enforcement
  const blockedHighImpact = await engine.executeActionMission(
    {
      goal: 'Purge all legacy production records after auditing table schema',
      mode: 'system_integrity_audit',
    },
    scopeA
  );
  assert.equal(blockedHighImpact.status, 'BLOCKED');
  assert.ok(blockedHighImpact.approvalRequestId, 'Must create ApprovalGate requestId');

  const reqId = blockedHighImpact.approvalRequestId!;
  assert.throws(
    () => ApprovalGate.getInstance().approveRequest(reqId, scopeA, 'dev cannot approve'),
    /FORBIDDEN/
  );
  ApprovalGate.getInstance().approveRequest(reqId, adminA, 'Approved for verified Batch 30 test');

  const approvedRun = await engine.executeActionMission(
    {
      goal: 'Purge all legacy production records after auditing table schema',
      mode: 'system_integrity_audit',
      approvalRequestId: reqId,
    },
    scopeA
  );
  trackMissionArtifacts(approvedRun);
  assert.equal(approvedRun.status, 'DELIVERED');

  // Reusing consumed token must be rejected
  const replayRun = await engine.executeActionMission(
    {
      goal: 'Purge all legacy production records after auditing table schema',
      mode: 'system_integrity_audit',
      approvalRequestId: reqId,
    },
    scopeA
  );
  assert.equal(replayRun.status, 'BLOCKED');

  // 9. Tenant/owner isolation on getMission & listMissions
  assert.throws(() => engine.getMission(nodeMission.missionId, scopeB), /FORBIDDEN/);
  assert.ok(!engine.listMissions(scopeB).some((m) => m.missionId === nodeMission.missionId));

  // Verify AuditLedger hash chain intact
  const ledgerCheck = AuditLedger.verifyIntegrity();
  assert.equal(ledgerCheck.valid, true, `AuditLedger invalid: ${JSON.stringify(ledgerCheck)}`);

  console.log('✓ Batch 30 module tests passed');
}

async function runHttpTests(tmpDir: string) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');

  const srv = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      ZYNTHEOR_API_ONLY: '1',
      ZYNTHEOR_ENABLE_DEV_LOGIN: 'true',
      ZYNTHEOR_AUDIT_FILE: path.join(tmpDir, 'http_audit_log.jsonl'),
      ZYNTHEOR_EXEC_METRICS_FILE: path.join(tmpDir, 'http_execution_metrics.json'),
      ZYNTHEOR_ACTION_MISSIONS_FILE: path.join(tmpDir, 'http_action_missions.json'),
      ZYNTHEOR_PLANS_DIR: path.join(tmpDir, 'http_plans'),
      ZYNTHEOR_APPROVALS_FILE: path.join(tmpDir, 'http_approvals.json'),
      ZYNTHEOR_CONTEXT_FILE: path.join(tmpDir, 'http_context.json'),
      ZYNTHEOR_PERF_FILE: path.join(tmpDir, 'http_perf.json'),
      ZYNTHEOR_KG_FILE: path.join(tmpDir, 'http_kg.json'),
    },
  });

  try {
    await waitForServer(baseUrl);

    // 1. Unauthenticated must fail closed with 401
    const unauthRes = await fetch(`${baseUrl}/api/action/capabilities`);
    assert.equal(unauthRes.status, 401);

    const guestTok = await devLogin(baseUrl, 'User', 'b30_http_alpha', 'guest_1');
    const devATok = await devLogin(baseUrl, 'Developer', 'b30_http_alpha', 'dev_a');
    const devBTok = await devLogin(baseUrl, 'Developer', 'b30_http_beta', 'dev_b');

    // 2. Capabilities & Perceive accessible to guest+, missions/run requires developer+
    const capsRes = await fetch(`${baseUrl}/api/action/capabilities`, {
      headers: { Authorization: `Bearer ${guestTok}` },
    });
    assert.equal(capsRes.status, 200);
    const capsJson = await capsRes.json();
    assert.equal(capsJson.capabilities.policy, 'ZERO_SIMULATION_ACTION_DRIVEN');

    const percRes = await fetch(`${baseUrl}/api/action/perceive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guestTok}` },
      body: JSON.stringify({ goal: 'Inspect sandbox for Batch 30 HTTP check' }),
    });
    assert.equal(percRes.status, 200);

    const guestRunRes = await fetch(`${baseUrl}/api/action/missions/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guestTok}` },
      body: JSON.stringify({ goal: 'Build token bucket rate limiter' }),
    });
    assert.equal(guestRunRes.status, 403, 'Guest must be denied on /api/action/missions/run');

    // 3. Developer A executes real mission over HTTP
    const runRes = await fetch(`${baseUrl}/api/action/missions/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${devATok}` },
      body: JSON.stringify({
        goal: 'Build a token bucket rate limiter module with unit tests',
        mode: 'engineering_blueprint_execute',
        runtime: 'node',
      }),
    });
    assert.equal(runRes.status, 200);
    const runJson = await runRes.json();
    trackMissionArtifacts(runJson.mission);
    assert.equal(runJson.mission.status, 'DELIVERED');
    assert.equal(runJson.mission.pillars.length, 8);

    // 4. List + get mission for Dev A works, Dev B cross-tenant is 403
    const listRes = await fetch(`${baseUrl}/api/action/missions`, {
      headers: { Authorization: `Bearer ${devATok}` },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.ok(listJson.missions.some((m: any) => m.missionId === runJson.mission.missionId));

    const crossTenantGet = await fetch(
      `${baseUrl}/api/action/missions/${encodeURIComponent(runJson.mission.missionId)}`,
      { headers: { Authorization: `Bearer ${devBTok}` } }
    );
    assert.equal(crossTenantGet.status, 403, 'Cross-tenant mission inspection must return 403');

    // 5. Prototype pollution rejection
    const protoRes = await fetch(`${baseUrl}/api/action/missions/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${devATok}` },
      body: '{"goal":"test","__proto__":{"polluted":true}}',
    });
    assert.equal(protoRes.status, 400);

    console.log('✓ Batch 30 live HTTP RBAC tests passed');
  } finally {
    if (srv.pid) {
      try {
        process.kill(-srv.pid, 'SIGTERM');
      } catch {
        srv.kill('SIGTERM');
      }
    }
  }
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-b30-'));
  try {
    await runModuleTests(tmpDir);
    await runHttpTests(tmpDir);
    console.log('ALL BATCH 30 ACTION-DRIVEN TESTS PASSED');
  } finally {
    cleanupCreatedArtifacts();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Batch 30 test failure:', err);
    process.exit(1);
  });
