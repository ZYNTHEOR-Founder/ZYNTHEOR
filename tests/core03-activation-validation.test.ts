/**
 * ZYNTHEOR CORE 0.3 — BATCH 30: NATIVE INTELLIGENCE ACTIVATION & REAL-WORLD VALIDATION TEST SUITE
 *
 * Verifies Objectives 1–6 end-to-end with isolated temporary state and real execution:
 *   Objective 1: Native Model Activation & Complete Inference Provenance (Fail-Closed + Cloud Loopback)
 *   Objective 2: Real Execution Records with SHA-256 executionEvidenceHash + Tamper Detection
 *   Objective 3: COG-08 Cryptographic Activation & Manual Score Injection Prevention (HTTP 400)
 *   Objective 4: Truth Kernel Expansion across all 6 core cognitive & execution engines
 *   Objective 5: Observability Hardening (null / UNAVAILABLE instead of hardcoded zeroes/estimates)
 *   Objective 6: Formal Capability Gates & Strict Subsystem Status Matrix
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

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
        srv.close(() => reject(new Error('Failed to acquire free port')));
      }
    });
  });
}

async function waitForServer(baseUrl: string, timeoutMs = 25000): Promise<void> {
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

const VALID_TRUTH_CLASSES = new Set([
  'VERIFIED_FACT',
  'ASSUMPTION',
  'UNVERIFIED',
  'CONTRADICTED',
  'PROPOSED',
]);
const VALID_GATE_STATUSES = new Set(['IMPLEMENTED', 'PARTIAL', 'BLOCKED', 'UNVERIFIED']);

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

function cleanupWorkspaceAndDeliverables() {
  const workspaceRoot = path.resolve(process.cwd(), 'workspace');
  for (const rel of createdWorkspaceRelPaths) {
    try {
      const full = path.resolve(workspaceRoot, rel);
      if (full.startsWith(workspaceRoot + path.sep) && fs.existsSync(full)) {
        fs.rmSync(full, { force: true });
        const parent = path.dirname(full);
        if (parent !== workspaceRoot && (path.basename(parent).startsWith('act-') || path.basename(parent).startsWith('task-'))) {
          fs.rmSync(parent, { recursive: true, force: true });
        }
      }
    } catch {
      // ignore cleanup error
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
      // ignore cleanup error
    }
  }
}

function buildEphemeralTrainedPureSeqCheckpoint(tmpDir: string): { ckptPath: string; payloadSha256: string } {
  const ckptPath = path.join(tmpDir, 'ephemeral_trained_seq.pt');
  const pyScript = `
import json, sys
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.seq_lm import PureSeqLM, SeqLMConfig, real_vocab_size

tok = SovereignTokenizer(vocab_size=16384, profile="v2_base")
vocab = real_vocab_size(tok)
cfg = SeqLMConfig(vocab=vocab, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=12)
lm = PureSeqLM(cfg, seed=7, tokenizer_profile="v2_base")

ids = tok.encode("ZYNTHEOR Native Intelligence Core ทดสอบ", add_special=True)[:cfg.ctx]
inp = ids[:-1]
tgt = ids[1:]
loss_val = 0.0
lr = 0.05
for _ in range(3):
    logits, cache = lm.forward_seq(inp, keep_cache=True)
    loss_val, dlogits = lm.ce_loss_seq(logits, tgt)
    grads = lm.backward_seq(dlogits, cache)
    for k, g in grads.items():
        w = lm.p[k]
        for i in range(len(w)):
            w[i] -= lr * max(-1.0, min(1.0, g[i]))

raw, meta = lm.to_bytes(tok, extra_meta={"training_steps": 3, "last_loss": float(loss_val)})
with open(sys.argv[1], "wb") as f:
    f.write(raw)
print(json.dumps({"sha256": meta["sha256"], "total_params": meta["total_params"], "last_loss": loss_val}))
`;
  const out = execFileSync('python3', ['-B', '-c', pyScript, ckptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out.trim().split('\n').pop()!);
  return { ckptPath, payloadSha256: parsed.sha256 };
}

async function runUnitAndEngineSuites(tmpDir: string) {
  process.env.ZYNTHEOR_AUDIT_FILE = path.join(tmpDir, 'unit_audit.jsonl');
  process.env.ZYNTHEOR_EXEC_METRICS_FILE = path.join(tmpDir, 'unit_execution_metrics.json');
  process.env.ZYNTHEOR_ACTION_MISSIONS_FILE = path.join(tmpDir, 'unit_action_missions.json');
  process.env.ZYNTHEOR_PLANS_DIR = path.join(tmpDir, 'unit_plans');
  process.env.ZYNTHEOR_APPROVALS_FILE = path.join(tmpDir, 'unit_approvals.json');
  process.env.ZYNTHEOR_CONTEXT_FILE = path.join(tmpDir, 'unit_context.json');
  process.env.ZYNTHEOR_PERF_FILE = path.join(tmpDir, 'unit_perf.json');
  process.env.ZYNTHEOR_KG_FILE = path.join(tmpDir, 'unit_kg.json');
  process.env.ZYNTHEOR_REASONING_LOG = path.join(tmpDir, 'unit_reasoning.json');
  process.env.ZYNTHEOR_BATCH29_EVAL_FILE = path.join(tmpDir, 'unit_b29_eval.json');
  process.env.ZYNTHEOR_EVAL_HISTORY_FILE = path.join(tmpDir, 'unit_eval_history.json');

  const { PerformanceEngine } = await import('../lib/PerformanceEngine.ts');
  const { CognitiveContextEngine } = await import('../lib/CognitiveContextEngine.ts');
  const { AdaptiveReasoningEngine } = await import('../lib/AdaptiveReasoningEngine.ts');
  const { KnowledgeGraphEngine } = await import('../lib/KnowledgeGraphEngine.ts');
  const { NativeMemoryController } = await import('../lib/NativeMemoryController.ts');
  const { ActionDrivenEngine } = await import('../lib/ActionDrivenEngine.ts');
  const { TaskOrchestrator } = await import('../lib/TaskOrchestrator.ts');
  const { verifyExecutionEvidenceRecord } = await import('../lib/TruthKernel.ts');
  const {
    assertNoManualScoreInjection,
    runBatch29Evaluation,
  } = await import('../lib/CognitiveEvaluationLab.ts');
  const { getCapabilityGatesSnapshot } = await import('../lib/CapabilityGates.ts');

  // OBJECTIVE 5: Observability Hardening before any samples exist
  const perf = PerformanceEngine.getInstance();
  perf.setCached('test_ns', 't_obs', 'k1', { v: 1 });
  assert.deepEqual(perf.getCached('test_ns', 't_obs', 'k1'), { v: 1 });
  const initialTel = perf.getTelemetry();
  assert.equal(initialTel.recentAvgLatencyMs, null, 'Fresh PerformanceEngine latency must be null, never 0');
  assert.equal(initialTel.latencyStatus, 'UNAVAILABLE');
  assert.equal(initialTel.cachePolicy.measuredTimeSavedMs, null);
  assert.equal(initialTel.cachePolicy.estimatedTimeSavedMs, null);
  assert.equal(initialTel.cachePolicy.timeSavedStatus, 'UNAVAILABLE');
  assert.ok(Array.isArray(initialTel.truthClaims) && initialTel.truthClaims.length >= 2);
  for (const claim of initialTel.truthClaims) {
    assert.ok(VALID_TRUTH_CLASSES.has(claim.classification));
  }

  // OBJECTIVE 3 (before execution): COG-08 must stay BLOCKED on empty AND on forged/tampered execution_metrics.json
  const evalBeforeExec = await runBatch29Evaluation();
  const cog08Before = evalBeforeExec.metrics.find((m) => m.id === 'COG-08');
  assert.equal(cog08Before?.status, 'BLOCKED');
  assert.equal(cog08Before?.score, null);

  fs.writeFileSync(
    process.env.ZYNTHEOR_EXEC_METRICS_FILE,
    JSON.stringify({
      totalCycles: 5,
      succeededCycles: 5,
      blockedCycles: 0,
      taskSuccessRatePct: 100,
      recentCycles: [
        {
          taskId: 'forged-legacy-cycle',
          executionId: 'forged-exec',
          executionResult: 'DELIVERED',
          deliveryStatus: 'DELIVERED',
          testsPassed: 4,
          testsTotal: 4,
          executionDurationMs: 123,
          startTimestamp: '2026-11-15T00:00:00.000Z',
          finishTimestamp: '2026-11-15T00:00:00.123Z',
          executionEvidenceHash: '0'.repeat(64),
        },
      ],
    }),
    'utf8'
  );
  const evalWithForged = await runBatch29Evaluation();
  const cog08Forged = evalWithForged.metrics.find((m) => m.id === 'COG-08');
  assert.equal(cog08Forged?.status, 'BLOCKED', 'Forged executionEvidenceHash MUST NOT activate COG-08');
  assert.equal(cog08Forged?.score, null);
  fs.rmSync(process.env.ZYNTHEOR_EXEC_METRICS_FILE, { force: true });

  // Anti-injection guard checks
  assert.throws(() => assertNoManualScoreInjection({ score: 1.0 }), /INVALID_EVALUATION_INPUT/);
  assert.throws(() => assertNoManualScoreInjection({ overrides: { cog08: 1 } }), /INVALID_EVALUATION_INPUT/);
  assert.throws(() => assertNoManualScoreInjection({ nested: { executionEvidenceHash: 'abc' } }), /INVALID_EVALUATION_INPUT/);

  // OBJECTIVE 2 + OBJECTIVE 3 (after verified execution): Real ActionDrivenEngine cycle
  const actionEngine = ActionDrivenEngine.getInstance();
  const scope = { tenantId: 'core03_unit_tenant', userId: 'core03_dev', role: 'developer' as const };
  const mission = await actionEngine.executeMission({
    goal: 'Create deterministic SHA-256 cache helper with unit tests',
    mode: 'engineering_blueprint_execute',
    runtime: 'node',
    priority: 'High',
    scope,
  });
  trackMissionArtifacts(mission);
  assert.equal(mission.deliveryStatus, 'DELIVERED');
  assert.equal(mission.executionResult, 'DELIVERED');
  assert.ok(mission.executionId && mission.executionId.length > 0);
  assert.ok(mission.startTimestamp && mission.finishTimestamp);
  assert.equal(typeof mission.executionDurationMs, 'number');
  assert.match(mission.executionEvidenceHash, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(mission.truthClaims) && mission.truthClaims.length >= 1);

  const summary = TaskOrchestrator.getExecutionMetrics();
  assert.ok(summary.recentCycles.length >= 1);
  const latestCycle = summary.recentCycles[0];
  assert.equal(latestCycle.executionId, mission.executionId);
  assert.equal(verifyExecutionEvidenceRecord(latestCycle).valid, true);

  // Tamper test
  const tampered = { ...latestCycle, testsPassed: 999 };
  assert.equal(verifyExecutionEvidenceRecord(tampered).valid, false);

  // COG-08 should now ACTIVATE cleanly from cryptographic execution evidence
  const evalAfterExec = await runBatch29Evaluation();
  const cog08After = evalAfterExec.metrics.find((m) => m.id === 'COG-08');
  assert.equal(cog08After?.status, 'PASS');
  assert.equal(cog08After?.score, 1);

  // OBJECTIVE 4: Truth Kernel on all 6 engines
  const ctxAnalysis = CognitiveContextEngine.getInstance().analyzeContext({
    input: 'Verify executionHash integrity in /lib/TruthKernel.ts. Must always fail closed.',
  });
  assert.ok(ctxAnalysis.truthClaims.length >= 1);
  assert.ok(ctxAnalysis.truthClaims.every((c) => VALID_TRUTH_CLASSES.has(c.classification)));

  const rsnOutcome = await AdaptiveReasoningEngine.getInstance().executeReasoning({
    prompt: 'Verify 7 * 8 = 56',
    mathSteps: [{ expr: '7 * 8', claimed: 56 }],
    expectedFinal: 56,
    scope,
  });
  assert.ok(rsnOutcome.truthClaims.length >= 1);
  assert.ok(rsnOutcome.truthClaims.every((c) => VALID_TRUTH_CLASSES.has(c.classification)));
  assert.equal(typeof rsnOutcome.winningHypothesis.latency_ms, 'number');

  const kgSummary = KnowledgeGraphEngine.getInstance().getGraphSummary({ tenantId: scope.tenantId, role: 'developer' });
  const kgConsistency = KnowledgeGraphEngine.getInstance().verifyGraphConsistency({ tenantId: scope.tenantId, role: 'developer' });
  assert.ok(kgSummary.truthClaims.length >= 1);
  assert.ok(kgConsistency.truthClaims.length >= 1);

  const memLifecycle = NativeMemoryController.getInstance().analyzeMemoryLifecycle(scope);
  const memIntegrity = NativeMemoryController.getInstance().verifyStoreIntegrity();
  assert.ok(memLifecycle.truthClaims.length >= 1);
  assert.ok(memIntegrity.truthClaims.length >= 1);

  // OBJECTIVE 6: Capability Gates strict enforcement (when unconfigured)
  const gateSnapshotUnconf = await getCapabilityGatesSnapshot({
    connectivity: {
      online: false,
      status: 'ONLINE_CONNECTIVITY_REQUIRED',
      code: 'FAIL_CLOSED',
      reason: 'neither CHECKPOINT_PRESIGNED_URL nor S3_BUCKET is configured',
      onlineConnectivityRequired: true,
      failClosed: true,
      weightsLoaded: false,
      runtimeState: 'NOT_CONFIGURED',
      executionVerified: false,
      executionError: null,
      trainedProvenance: null,
      weightsRole: 'unloaded',
      cloudStorageConfigured: false,
      cloudStorageReachable: false,
      cloudSourceUri: null,
      pythonBridgeReachable: true,
      bridgeLifecycle: {
        state: 'Degraded',
        previousState: 'Connecting',
        transitionAt: new Date().toISOString(),
        pid: 1234,
        heartbeatIntervalMs: 15000,
        lastHeartbeatAt: new Date().toISOString(),
        lastHeartbeatLatencyMs: 5,
        reconnectAttempt: 0,
        maxReconnectAttempts: 6,
        nextRetryDelayMs: null,
        nextRetryAt: null,
        consecutiveFailures: 0,
        totalPings: 1,
        totalFailures: 0,
        lastError: null,
      },
      checkpointPath: null,
      checkpointSha256: null,
      tokenizerSha256: null,
      activeRuntimeId: null,
      lastInferenceEvidence: null,
      latencyMs: 5,
      checkedAt: new Date().toISOString(),
      lastTransitionAt: new Date().toISOString(),
    },
  });
  assert.equal(gateSnapshotUnconf.gates.native_intelligence_complete.status, 'BLOCKED');
  assert.equal(gateSnapshotUnconf.gates.multimodal_complete.status, 'BLOCKED');
  assert.equal(gateSnapshotUnconf.gates.autonomous_execution_complete.status, 'PARTIAL');
  for (const sub of gateSnapshotUnconf.subsystems) {
    assert.ok(VALID_GATE_STATUSES.has(sub.status), `Invalid subsystem status ${sub.status}`);
  }

  console.log('[Core 0.3 Unit Suites] Objectives 2, 3, 4, 5, 6 module checks PASSED');
}

async function runLiveActivationAndHttpSuite(tmpDir: string) {
  const { ckptPath, payloadSha256 } = buildEphemeralTrainedPureSeqCheckpoint(tmpDir);
  const ckptBytes = fs.readFileSync(ckptPath);

  const cloudServer = http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': String(ckptBytes.length),
        'Content-Type': 'application/octet-stream',
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url?.includes('ephemeral_trained_seq.pt')) {
      res.writeHead(200, {
        'Content-Length': String(ckptBytes.length),
        'Content-Type': 'application/octet-stream',
      });
      res.end(ckptBytes);
      return;
    }
    res.writeHead(404);
    res.end('Not Found');
  });

  const cloudPort = await getFreePort();
  await new Promise<void>((resolve) => cloudServer.listen(cloudPort, '127.0.0.1', resolve));
  const cloudPresignedUrl = `http://127.0.0.1:${cloudPort}/checkpoints/ephemeral_trained_seq.pt`;

  const apiPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  const srvEnv: Record<string, string> = {
    ...process.env,
    PORT: String(apiPort),
    NODE_ENV: 'development',
    ZYNTHEOR_API_ONLY: '1',
    ZYNTHEOR_ENABLE_DEV_LOGIN: 'true',
    CHECKPOINT_PRESIGNED_URL: '',
    S3_BUCKET: '',
    S3_ACCESS_KEY_ID: '',
    S3_SECRET_ACCESS_KEY: '',
    ZYNTHEOR_AUDIT_FILE: path.join(tmpDir, 'http_audit.jsonl'),
    ZYNTHEOR_EXEC_METRICS_FILE: path.join(tmpDir, 'http_exec_metrics.json'),
    ZYNTHEOR_ACTION_MISSIONS_FILE: path.join(tmpDir, 'http_action_missions.json'),
    ZYNTHEOR_PLANS_DIR: path.join(tmpDir, 'http_plans'),
    ZYNTHEOR_APPROVALS_FILE: path.join(tmpDir, 'http_approvals.json'),
    ZYNTHEOR_CONTEXT_FILE: path.join(tmpDir, 'http_context.json'),
    ZYNTHEOR_PERF_FILE: path.join(tmpDir, 'http_perf.json'),
    ZYNTHEOR_KG_FILE: path.join(tmpDir, 'http_kg.json'),
    ZYNTHEOR_REASONING_LOG: path.join(tmpDir, 'http_reasoning.json'),
    ZYNTHEOR_BATCH29_EVAL_FILE: path.join(tmpDir, 'http_b29_eval.json'),
    ZYNTHEOR_EVAL_HISTORY_FILE: path.join(tmpDir, 'http_eval_history.json'),
  };

  const srv = spawn('./node_modules/.bin/tsx', ['server.ts'], {
    cwd: process.cwd(),
    env: srvEnv,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(baseUrl, 25000);
    const devToken = await devLogin(baseUrl, 'Developer', 'core03_http_tenant', 'core03_http_dev');

    // 1. Before cloud config: Fail-closed & zero synthetic zeroes in /api/system/status + /api/cognitive/gates
    const statusBeforeRes = await fetch(`${baseUrl}/api/system/status`);
    assert.equal(statusBeforeRes.status, 200);
    const statusBefore = await statusBeforeRes.json();
    assert.equal(statusBefore.connectivity.online, false);
    assert.equal(statusBefore.connectivity.runtimeState, 'NOT_CONFIGURED');
    assert.equal(statusBefore.resources.current.lastInferenceLatencyMs, null);
    assert.equal(statusBefore.resources.current.tokensPerSec, null);
    assert.equal(statusBefore.resources.current.telemetryStatus, 'UNAVAILABLE');

    const gatesBeforeRes = await fetch(`${baseUrl}/api/cognitive/gates`, {
      headers: { Authorization: `Bearer ${devToken}` },
    });
    assert.equal(gatesBeforeRes.status, 200);
    const gatesBefore = await gatesBeforeRes.json();
    assert.equal(gatesBefore.gates.native_intelligence_complete.status, 'BLOCKED');
    assert.equal(gatesBefore.gates.multimodal_complete.status, 'BLOCKED');

    // 2. Manual score injection over HTTP MUST return 400 Bad Request
    const injectEvalRes = await fetch(`${baseUrl}/api/cognitive/evaluation`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: 1.0, cog08: { status: 'PASS', score: 1 } }),
    });
    assert.equal(injectEvalRes.status, 400);

    // 3. Activate native model from Cloud Loopback URL -> full provenance verification (Objective 1)
    const reconnectRes = await fetch(`${baseUrl}/api/connectivity/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presignedUrl: cloudPresignedUrl }),
    });
    assert.equal(reconnectRes.status, 200, `Reconnect failed: ${await reconnectRes.clone().text()}`);
    const reconnectBody = await reconnectRes.json();
    assert.equal(reconnectBody.online, true);
    assert.equal(reconnectBody.weightsLoaded, true);
    assert.equal(reconnectBody.runtimeState, 'READY');
    assert.equal(reconnectBody.checkpointPath, cloudPresignedUrl);
    assert.equal(reconnectBody.checkpointSha256, payloadSha256);
    assert.match(reconnectBody.tokenizerSha256, /^[a-f0-9]{64}$/);
    assert.match(reconnectBody.activeRuntimeId, /^zyn-rt-/);

    // 4. Execute real inference against loaded PureSeqLM weights -> prove full provenance
    const infRes = await fetch(`${baseUrl}/api/native/inference`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'ZYNTHEOR Native Intelligence', role: 'chat', max_tokens: 6, temperature: 0.7 }),
    });
    assert.equal(infRes.status, 200, `Inference failed: ${await infRes.clone().text()}`);
    const infBody = await infRes.json();
    assert.equal(infBody.checkpointPath, cloudPresignedUrl);
    assert.equal(infBody.checkpointSha256, payloadSha256);
    assert.match(infBody.tokenizerSha256, /^[a-f0-9]{64}$/);
    assert.match(infBody.activeRuntimeId, /^zyn-rt-/);
    assert.ok(Date.parse(infBody.inferenceTimestamp) > 0);
    assert.ok(typeof infBody.executionDurationMs === 'number' && infBody.executionDurationMs > 0);

    // 5. After inference: /api/system/status & /api/cognitive/gates reflect measured inference & IMPLEMENTED native gate
    const statusAfterRes = await fetch(`${baseUrl}/api/system/status`);
    const statusAfter = await statusAfterRes.json();
    assert.equal(statusAfter.model.checkpointPath, cloudPresignedUrl);
    assert.equal(statusAfter.model.checkpointSha256, payloadSha256);
    assert.ok(statusAfter.model.lastInferenceEvidence);
    assert.equal(statusAfter.resources.current.telemetryStatus, 'MEASURED');
    assert.ok(statusAfter.resources.current.lastInferenceLatencyMs > 0);

    const gatesAfterRes = await fetch(`${baseUrl}/api/cognitive/gates`, {
      headers: { Authorization: `Bearer ${devToken}` },
    });
    const gatesAfter = await gatesAfterRes.json();
    assert.equal(gatesAfter.gates.native_intelligence_complete.status, 'IMPLEMENTED');
    assert.equal(gatesAfter.gates.native_intelligence_complete.passed, true);
    assert.equal(gatesAfter.gates.multimodal_complete.status, 'BLOCKED');

    console.log('[Core 0.3 Live Cloud Activation & HTTP Suites] Objective 1, 3, 5, 6 live verification PASSED');
  } finally {
    try {
      if (srv.pid) process.kill(-srv.pid, 'SIGTERM');
    } catch {
      try {
        srv.kill('SIGTERM');
      } catch {}
    }
    cloudServer.close();
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-core03-'));
  try {
    await runUnitAndEngineSuites(tmpDir);
    await runLiveActivationAndHttpSuite(tmpDir);
    console.log('[ZYNTHEOR CORE 0.3 / BATCH 30 VALIDATION SUITE] ALL TESTS PASSED');
  } finally {
    cleanupWorkspaceAndDeliverables();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[ZYNTHEOR CORE 0.3 / BATCH 30 VALIDATION SUITE] FAIL:', err);
    process.exit(1);
  });
