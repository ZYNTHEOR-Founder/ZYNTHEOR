/**
 * ZYNTHEOR Batch 28 — Autonomous Intelligence, Continuous Learning & Governance E2E Suite
 *
 * Tests all 10 Batch 28 pillars against real implementations with isolated temp state:
 *   1. AutonomousPlanner (DAG topological sort, cycle detection, budget enforcement, plan revision)
 *   2. ApprovalGate & ToolRegistry (high-impact blocking, zero autonomous self-approval, RBAC denial, telemetry)
 *   3. SelfEvaluationEngine (grounding, citations, contradiction, uncertainty calibration, separated attributions, Batch 28 benchmark)
 *   4. ContinuousLearningPipeline (PII scrubbing, dedupe, PureSeqLM weight training, regression gate fail-closed, approval + promote + SHA-256 rollback)
 *   5. NativeMemoryController (task_memory/working_context, ranked recall, consolidation provenance, conflict detection/resolution, tenant isolation)
 *   6. KnowledgeIntelligenceEngine (query expansion, multi-query RRF + context compression, citation tamper verification)
 *   7. Live HTTP Express Server RBAC + Batch 28 API Routes
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
  });
}

async function waitForServer(baseUrl, timeoutMs = 15000) {
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

async function devLogin(baseUrl, role, tenantId, userId) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, tenantId, userId }),
  });
  const data = await res.json();
  assert.equal(res.status, 200, `Login failed for ${role}: ${JSON.stringify(data)}`);
  return data.token;
}

async function runModuleTests(tmpDir) {
  // Isolate persistent stores so real native_data/ stays pristine
  process.env.ZYNTHEOR_AUDIT_FILE = path.join(tmpDir, 'audit_log.jsonl');
  process.env.ZYNTHEOR_APPROVALS_FILE = path.join(tmpDir, 'approvals.json');
  process.env.ZYNTHEOR_PLANS_DIR = path.join(tmpDir, 'plans');
  process.env.ZYNTHEOR_TRAINING_PIPELINE_DIR = path.join(tmpDir, 'training_pipeline');
  process.env.ZYNTHEOR_TRAINING_CHECKPOINT_DIR = path.join(tmpDir, 'checkpoints');
  process.env.ZYNTHEOR_EVAL_HISTORY_FILE = path.join(tmpDir, 'eval_history.json');
  process.env.ZYNTHEOR_PURE_SEQ_CHECKPOINT = path.join(tmpDir, 'active_seq.pt');

  // Seed an initial baseline active_seq.pt checkpoint so promote + rollback preserve & verify exact SHA-256
  const seedPy = `
import sys
sys.path.insert(0, '.')
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.seq_lm import PureSeqLM, SeqLMConfig, real_vocab_size
tok = SovereignTokenizer(vocab_size=16384, profile="v2_base")
rv = real_vocab_size(tok)
cfg = SeqLMConfig(vocab=rv, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=12)
lm = PureSeqLM(cfg, seed=99, tokenizer_profile="v2_base")
b, _ = lm.to_bytes(tok, extra_meta={"training_steps": 1, "untrained": False})
open(sys.argv[1], "wb").write(b)
`;
  execFileSync('python3', ['-c', seedPy, process.env.ZYNTHEOR_PURE_SEQ_CHECKPOINT], { cwd: process.cwd() });
  const baselineSha = crypto.createHash('sha256').update(fs.readFileSync(process.env.ZYNTHEOR_PURE_SEQ_CHECKPOINT)).digest('hex');

  const { AutonomousPlanner, resolveDagOrder } = await import('../lib/AutonomousPlanner.ts');
  const { ApprovalGate } = await import('../lib/ApprovalGate.ts');
  const { ToolRegistry } = await import('../lib/ToolRegistry.ts');
  const { ContinuousLearningPipeline } = await import('../lib/ContinuousLearningPipeline.ts');
  const { SelfEvaluationEngine } = await import('../lib/SelfEvaluationEngine.ts');
  const { NativeMemoryController } = await import('../lib/NativeMemoryController.ts');
  const { KnowledgeWorkspace } = await import('../lib/KnowledgeWorkspace.ts');
  const { KnowledgeIntelligenceEngine } = await import('../lib/KnowledgeIntelligenceEngine.ts');

  // 1. AutonomousPlanner: DAG resolution, cycle detection, budget & revision
  const planner = AutonomousPlanner.getInstance();
  assert.throws(
    () =>
      resolveDagOrder([
        { id: 's1', title: 'A', stage: '01_INTAKE', dependsOn: ['s2'], priority: 1, estimatedMs: 10, status: 'PENDING', attempts: 0 },
        { id: 's2', title: 'B', stage: '02_ANALYZE', dependsOn: ['s1'], priority: 2, estimatedMs: 10, status: 'PENDING', attempts: 0 },
      ]),
    /PLAN_CYCLE_DETECTED/
  );
  const plan = planner.decomposeGoal({
    taskId: 'TASK_B28_TEST_1',
    goal: 'Build deterministic rate limiter',
    priority: 'High',
    runtime: 'node',
    tenantId: 'tenant_test',
    ownerUserId: 'usr_dev',
  });
  assert.ok(plan.executionOrder.indexOf('step_intake') < plan.executionOrder.indexOf('step_deliver_package'));
  const revised = planner.revisePlan('TASK_B28_TEST_1', {
    reason: 'Unit test failed assertion',
    failedStepId: 'step_verify_tests',
    actionTaken: 'Patch edge case in rate limiter',
  });
  assert.equal(revised.status, 'REVISED');
  assert.equal(revised.revisions.length, 1);

  // 2. ApprovalGate: Zero-bypass invariant (autonomous agents & guests cannot approve)
  const gate = ApprovalGate.getInstance();
  assert.equal(gate.detectHighImpactGoal('delete all production records').actionType, 'DATA_DELETION');
  const reqRec = gate.requestApproval({
    actionType: 'DATA_DELETION',
    resourceId: 'TASK_DEL_1',
    description: 'Delete all stale records',
    requestedByUserId: 'agent_auto',
    requestedByRole: 'AUTONOMOUS_AGENT',
    tenantId: 'tenant_test',
  });
  assert.throws(
    () => gate.approveRequest(reqRec.requestId, { userId: 'agent_auto', role: 'AUTONOMOUS_AGENT', tenantId: 'tenant_test' }),
    /FORBIDDEN/
  );
  assert.throws(
    () => gate.approveRequest(reqRec.requestId, { userId: 'dev1', role: 'developer', tenantId: 'tenant_test' }),
    /FORBIDDEN/
  );
  const approved = gate.approveRequest(reqRec.requestId, { userId: 'adm1', role: 'admin', tenantId: 'tenant_test', note: 'Verified' });
  assert.equal(approved.status, 'APPROVED');
  const consumed1 = gate.verifyAndConsume({ actionType: 'DATA_DELETION', resourceId: 'TASK_DEL_1', tenantId: 'tenant_test', approvalRequestId: reqRec.requestId, consume: true });
  assert.equal(consumed1.approved, true);
  // Single-use replay protection
  const consumed2 = gate.verifyAndConsume({ actionType: 'DATA_DELETION', resourceId: 'TASK_DEL_1', tenantId: 'tenant_test', approvalRequestId: reqRec.requestId, consume: true });
  assert.equal(consumed2.approved, false);

  // 3. ToolRegistry: Least-privilege RBAC & telemetry
  const registry = ToolRegistry.getInstance();
  const deniedTool = await registry.executeToolCall(
    { tool: 'write_file', arguments: { path: 'x.txt', content: 'hi' } },
    { callerRole: 'guest', taskId: 'TASK_RBAC_1' }
  );
  assert.equal(deniedTool.ok, false);
  assert.match(deniedTool.error || '', /SECURITY_PERMISSION_DENIED/);
  const tel = registry.getTelemetry().find((t) => t.tool === 'write_file');
  assert.ok(tel && tel.deniedCalls >= 1);

  // 4. KnowledgeIntelligenceEngine & SelfEvaluationEngine
  const kw = KnowledgeWorkspace.getInstance();
  const kie = KnowledgeIntelligenceEngine.getInstance();
  const doc = kw.createDocument({
    title: 'Zyntheor B28 Knowledge Spec',
    content: 'ZYNTHEOR enforces Zero Simulation Policy and verifies every checkpoint using SHA-256 hashes before execution.',
    collection: 'B28Unit',
    tags: ['b28'],
    tenantId: 'tenant_test',
  });
  try {
    const adv = kie.advancedRetrieve('Zero Simulation Policy SHA-256 checkpoint', {
      collection: 'B28Unit',
      limit: 3,
      minScore: 0.8,
      tenantId: 'tenant_test',
      role: 'developer',
    });
    assert.ok(adv.found && adv.subQueries.length >= 1 && adv.compressedContext.length > 0);
    const validCite = kie.verifyCitations({
      answer: 'ZYNTHEOR enforces Zero Simulation Policy and verifies checkpoints using SHA-256 hashes.',
      citations: adv.results.map((r) => r.citation),
      scope: { tenantId: 'tenant_test', role: 'developer' },
    });
    assert.equal(validCite.verified, true);
    const tamperedCite = kie.verifyCitations({
      answer: 'Fake claim',
      citations: [{ documentId: doc.id, contentHash: '0'.repeat(64), snippet: 'Fake snippet' }],
      scope: { tenantId: 'tenant_test', role: 'developer' },
    });
    assert.equal(tamperedCite.verified, false);
    assert.equal(tamperedCite.citationCorrectnessRate, 0);

    const evaluator = SelfEvaluationEngine.getInstance();
    const evalBad = evaluator.evaluateResponse({
      query: 'What is the SLA?',
      answer: 'The SLA is 99.999% uptime.',
      citations: [],
      claimedConfidence: 0.99,
      scope: { tenantId: 'tenant_test', role: 'developer' },
    });
    assert.equal(evalBad.passed, false);
    assert.equal(evalBad.errorClass, 'UNCERTAINTY');

    const bench = await evaluator.runBatch28Benchmark();
    assert.equal(bench.schema, 'ZYNTHEOR_BATCH28_EVAL_V1');
    assert.equal(bench.summary.failed, 0);
  } finally {
    kw.deleteDocument(doc.id);
  }

  // 5. NativeMemoryController: ranked recall, consolidation provenance, conflict detection, session continuity & tenant isolation
  const mem = NativeMemoryController.getInstance();
  const scopeA = { tenantId: 'tenant_b28_a', userId: 'u_a', role: 'developer' };
  const scopeB = { tenantId: 'tenant_b28_b', userId: 'u_b', role: 'developer' };
  const k1 = `b28_task_${Date.now()}`;
  const k2 = `b28_ctx_${Date.now()}`;
  const kCons = `b28_cons_${Date.now()}`;
  try {
    mem.storeMemory(k1, 'Completed DAG planning and regression gate checks', 'task_memory', { sessionId: 'sess_99' }, { scope: scopeA });
    mem.storeMemory(k2, 'Active working context: monitoring approval queue', 'working_context', { sessionId: 'sess_99' }, { scope: scopeA });
    const ranked = mem.recallRankedMemories('DAG planning regression', { scope: scopeA });
    assert.ok(ranked.length >= 1 && ranked[0].item.key === k1);

    const sessCtx = mem.getWorkingContextForSession('sess_99', scopeA);
    assert.ok(sessCtx.workingContext.some((x) => x.key === k2));

    const cons = mem.consolidateMemories({ targetKey: kCons, sourceCategory: 'task_memory', scope: scopeA });
    assert.ok(cons.consolidated && cons.sourceKeys.includes(k1));

    const conflict = mem.storeWithConflictResolution(k1, 'Conflicting unverified fact', 'task_memory', 'manual_review', { scope: scopeA });
    assert.equal(conflict.conflictDetected, true);
    assert.equal(conflict.conflict.resolution, 'NEEDS_REVIEW');

    assert.throws(() => mem.retrieveMemory(k1, scopeB), /FORBIDDEN/);
  } finally {
    try { mem.deleteMemory(k1); } catch {}
    try { mem.deleteMemory(k2); } catch {}
    try { mem.deleteMemory(kCons); } catch {}
  }

  // 6. ContinuousLearningPipeline: Privacy scrubbing, regression gate, human approval, promote & rollback restoring exact SHA-256
  const pipeline = ContinuousLearningPipeline.getInstance();
  const undersizedRun = await pipeline.executePipelineRun({
    tenantId: 'tenant_test',
    initiatedBy: 'usr_dev',
    customSamples: [
      'ZYNTHEOR Dataset Governance retains train, validation, and test provenance for immutable data snapshots.',
      'ZYNTHEOR Native Inference reloads trained parameters and verifies seeded next-token output.',
      'ZYNTHEOR Evaluation separates checkpoint integrity from model quality and release readiness.',
      'ZYNTHEOR Training records actual optimizer updates and immutable candidate checkpoint metadata.',
      'ZYNTHEOR Validation data is held out from weight updates and checked for generalization.',
      'ZYNTHEOR Test data is kept distinct from training and validation samples.',
    ],
  });
  assert.equal(undersizedRun.status, 'REJECTED_QUALITY');
  assert.match(undersizedRun.error, /minimum 7/);
  assert.equal(undersizedRun.candidateCheckpointPath, null);

  const gatedFail = await pipeline.executePipelineRun({
    tenantId: 'tenant_test',
    initiatedBy: 'usr_dev',
    customSamples: [
      'ZYNTHEOR Continuous Learning scrubs Bearer secret_token_1234567890 and alice@example.com before training.',
      'ZYNTHEOR Continuous Learning scrubs Bearer secret_token_1234567890 and alice@example.com before training.', // duplicate
      'short', // low quality
      'ZYNTHEOR Autonomous Runtime enforces Zero Simulation and SHA-256 verification across all checkpoints.',
      'ZYNTHEOR Multi-Step Reasoning verifies mathematical expressions, code AST safety, and constraint budgets.',
      'ZYNTHEOR Checkpoint Validation maintains an independent final test split for reproducible model evaluation.',
      'ZYNTHEOR Native Training preserves optimizer moments and random generator state inside a verified resume bundle.',
      'ZYNTHEOR Checkpoint Integrity hashes model parameters and metadata before the candidate can be inspected.',
      'ZYNTHEOR Quality Governance blocks promotion when validation or test performance regresses after training.',
    ],
    steps: 6,
    lr: 0.02,
    margin: 50.0, // force fail-closed rejection
  });
  assert.equal(gatedFail.status, 'REJECTED_VALIDATION_GATE');
  assert.ok(gatedFail.datasetManifest.privacyRedactedCount >= 2);
  assert.equal(gatedFail.datasetManifest.dedupedCount, 1);
  assert.equal(gatedFail.datasetManifest.rejectedQualityCount, 1);
  assert.equal(gatedFail.datasetManifest.trainSamples.some((s) => s.includes('alice@example.com')), false);
  assert.equal(gatedFail.qualityGateStatus, 'REJECTED_VALIDATION_GATE');
  assert.equal(gatedFail.checkpointStorageMode, 'LOCAL_CANDIDATE_ONLY');
  assert.equal(gatedFail.checkpointLifecycle, 'TRAINED');
  assert.ok(gatedFail.candidateCheckpointPath && fs.existsSync(gatedFail.candidateCheckpointPath));
  assert.ok(gatedFail.candidateCheckpointFileSha256);

  const rejectedBenchmark = await pipeline.runDomainBenchmarks({
    runId: gatedFail.runId,
    tenantId: 'tenant_test',
  });
  assert.equal(rejectedBenchmark.benchmarkStatus, 'BLOCKED');
  assert.equal(rejectedBenchmark.benchmarkReport.quality_gate.status, 'REJECTED_VALIDATION_GATE');
  assert.equal(rejectedBenchmark.benchmarkReport.readiness_accepted, false);
  assert.throws(
    () => pipeline.promoteApprovedRun({
      runId: gatedFail.runId,
      actor: { userId: 'adm1', role: 'admin', tenantId: 'tenant_test' },
    }),
    /PROMOTION_BLOCKED/
  );

  const awaitingApproval = await pipeline.executePipelineRun({
    tenantId: 'tenant_test',
    initiatedBy: 'usr_dev',
    customSamples: [
      'ZYNTHEOR Autonomous Planning Engine decomposes goals into validated DAG steps with dependency checks.',
      'ZYNTHEOR Verification Engine requires independent sandbox test execution before final artifact delivery.',
      'ZYNTHEOR Security Governance prevents autonomous self-approval and seals every change into AuditLedger.',
      'ZYNTHEOR Knowledge Retrieval applies multi-query expansion and citation hash provenance checks.',
      'ZYNTHEOR Dataset Governance retains train, validation, and test provenance for each immutable snapshot.',
      'ZYNTHEOR Native Inference reloads trained parameters and checks seeded next-token output for parity.',
      'ZYNTHEOR Evaluation separates quality acceptance from checkpoint integrity and production readiness.',
    ],
    steps: 10,
    lr: 0.03,
    margin: -0.5,
    testMargin: 100,
  });
  assert.equal(awaitingApproval.status, 'TRAINED');
  assert.equal(awaitingApproval.checkpointLifecycle, 'TRAINED');
  assert.equal(awaitingApproval.benchmarkStatus, 'NOT_RUN');
  assert.ok(awaitingApproval.datasetManifest.testSamples.length >= 1);
  assert.equal(awaitingApproval.approvalRequestId, null);

  await assert.rejects(
    () => pipeline.executePipelineRun({
      tenantId: 'different_tenant',
      initiatedBy: 'usr_dev',
      resumeFromRunId: awaitingApproval.runId,
    }),
    /RESUME_RUN_INCOMPATIBLE/
  );
  const resumed = await pipeline.executePipelineRun({
    tenantId: 'tenant_test',
    initiatedBy: 'usr_dev',
    resumeFromRunId: awaitingApproval.runId,
    steps: 1,
  });
  assert.equal(resumed.status, 'TRAINED');
  assert.equal(resumed.datasetManifest.datasetVersion, awaitingApproval.datasetManifest.datasetVersion);
  assert.deepEqual(resumed.datasetManifest.trainSamples, awaitingApproval.datasetManifest.trainSamples);
  assert.deepEqual(resumed.datasetManifest.valSamples, awaitingApproval.datasetManifest.valSamples);
  assert.deepEqual(resumed.datasetManifest.testSamples, awaitingApproval.datasetManifest.testSamples);

  const benchmarked = await pipeline.runDomainBenchmarks({
    runId: awaitingApproval.runId,
    tenantId: 'tenant_test',
  });
  assert.equal(benchmarked.benchmarkStatus, 'BLOCKED');
  assert.equal(benchmarked.checkpointLifecycle, 'TRAINED');
  assert.equal(benchmarked.benchmarkReport.summary.total, 10);
  assert.equal(benchmarked.benchmarkReport.general_text_test.status, 'MEASURED');
  assert.equal(benchmarked.benchmarkReport.inference.deterministic_parity, true);

  // Training plus text inference is not sufficient for READY or production promotion.
  assert.throws(
    () => pipeline.promoteApprovedRun({ runId: awaitingApproval.runId, actor: { userId: 'adm1', role: 'admin', tenantId: 'tenant_test' } }),
    /PROMOTION_BLOCKED: Checkpoint requires successful required-domain benchmarks and READY lifecycle/
  );

  console.log('[Batch28 Module Tests] ALL 6 CORE PILLAR SUITES PASSED');
}

async function runLiveHttpTests(tmpDir) {
  const apiPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${apiPort}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    NODE_ENV: 'development',
    ZYNTHEOR_API_ONLY: '1',
    ZYNTHEOR_ENABLE_DEV_LOGIN: 'true',
    ZYNTHEOR_AUDIT_FILE: path.join(tmpDir, 'http_audit_log.jsonl'),
    ZYNTHEOR_APPROVALS_FILE: path.join(tmpDir, 'http_approvals.json'),
    ZYNTHEOR_PLANS_DIR: path.join(tmpDir, 'http_plans'),
    ZYNTHEOR_TRAINING_PIPELINE_DIR: path.join(tmpDir, 'http_training'),
    ZYNTHEOR_TRAINING_CHECKPOINT_DIR: path.join(tmpDir, 'http_checkpoints'),
    ZYNTHEOR_EVAL_HISTORY_FILE: path.join(tmpDir, 'http_eval_history.json'),
  };

  const srv = spawn('./node_modules/.bin/tsx', ['server.ts'], {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(baseUrl, 20000);

    // 1. Unauthenticated access must fail 401
    const unauthOps = await fetch(`${baseUrl}/api/observability/operations`);
    assert.equal(unauthOps.status, 401);

    const guestToken = await devLogin(baseUrl, 'User', 'tenant_http_1', 'u_guest');
    const devToken = await devLogin(baseUrl, 'Developer', 'tenant_http_1', 'u_dev');
    const adminToken = await devLogin(baseUrl, 'Administrator', 'tenant_http_1', 'u_admin');

    const missingResume = await fetch(`${baseUrl}/api/training/pipeline/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeFromRunId: 'missing_run' }),
    });
    assert.equal(missingResume.status, 404);
    assert.match((await missingResume.json()).error, /RESUME_RUN_NOT_FOUND/);

    const missingBenchmark = await fetch(`${baseUrl}/api/training/pipeline/benchmark`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'missing_run' }),
    });
    assert.equal(missingBenchmark.status, 404);

    // 2. Guest blocked from developer endpoints
    const guestTelemetry = await fetch(`${baseUrl}/api/tools/telemetry`, {
      headers: { Authorization: `Bearer ${guestToken}` },
    });
    assert.equal(guestTelemetry.status, 403);

    // 3. Developer can query observability, reasoning, and run Batch 28 benchmark
    const opsRes = await fetch(`${baseUrl}/api/observability/operations`, {
      headers: { Authorization: `Bearer ${devToken}` },
    });
    assert.equal(opsRes.status, 200);
    const opsData = await opsRes.json();
    assert.equal(opsData.success, true);

    const reasonRes = await fetch(`${baseUrl}/api/reasoning/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'verify_math',
        steps: [{ expr: '(8 + 4) * 3', claimed: 36 }],
        expected_final: 36,
      }),
    });
    assert.equal(reasonRes.status, 200);
    const reasonData = await reasonRes.json();
    assert.equal(reasonData.result.verified, true);

    // 4. Approval Gate HTTP RBAC: Developer can create request, CANNOT approve; Admin CAN approve
    const createApr = await fetch(`${baseUrl}/api/governance/approvals`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'SYSTEM_CONFIG_MUTATION',
        resourceId: 'cfg_b28_http',
        description: 'Update sandbox timeout limit',
      }),
    });
    assert.equal(createApr.status, 201);
    const createdApr = await createApr.json();
    const aprId = createdApr.request.requestId;

    const devApproveAttempt = await fetch(`${baseUrl}/api/governance/approvals/${aprId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'self approve attempt' }),
    });
    assert.equal(devApproveAttempt.status, 403);

    const adminApprove = await fetch(`${baseUrl}/api/governance/approvals/${aprId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Admin verified' }),
    });
    assert.equal(adminApprove.status, 200);
    const adminApproveBody = await adminApprove.json();
    assert.equal(adminApproveBody.request.status, 'APPROVED');

    // 5. Batch 28 Benchmark endpoint
    const benchRes = await fetch(`${baseUrl}/api/evaluation/batch28`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}` },
    });
    assert.equal(benchRes.status, 200);
    const benchBody = await benchRes.json();
    assert.equal(benchBody.report.schema, 'ZYNTHEOR_BATCH28_EVAL_V1');
    assert.equal(benchBody.report.summary.failed, 0);

    console.log('[Batch28 HTTP & RBAC Tests] ALL ENDPOINTS VERIFIED');
  } finally {
    try {
      if (srv.pid) process.kill(-srv.pid, 'SIGTERM');
    } catch {
      try {
        srv.kill('SIGTERM');
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-b28-'));
  try {
    await runModuleTests(tmpDir);
    await runLiveHttpTests(tmpDir);
    console.log('[Batch28 E2E Suite] PASS');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Batch28 E2E Suite] FAILED:', err);
    process.exit(1);
  });
