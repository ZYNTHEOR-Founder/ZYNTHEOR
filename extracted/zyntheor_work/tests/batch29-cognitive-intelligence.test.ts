/**
 * ZYNTHEOR Batch 29 — Cognitive Intelligence & Adaptive Architecture Comprehensive Test Suite
 *
 * Tests all Batch 29 subsystems against real implementations with isolated temp state:
 *   1. CognitiveContextEngine (segmentation, bilingual intents, entities/relations, conflicts, TTL, tenant/owner isolation)
 *   2. AdaptiveReasoningEngine (classification, strategy selection, math/CSP/AST verifiers, counterexamples, abstention, trace redaction, benchmark)
 *   3. KnowledgeGraphEngine (bilingual entity resolution, triple provenance SHA-256, 2+ hop traversal, contradictions, consistency, tenant isolation)
 *   4. NativeMemoryController (importance scoring, near-duplicate detection, reversible consolidation + verbatim archive + rollback + tenant isolation)
 *   5. PerformanceEngine (async profiling, bottleneck detection, tenant-safe cache + invalidation, reversible optimization + rollback)
 *   6. MultimodalInterfaces (honest capability registry: PARTIAL document parsing without OCR, NOT IMPLEMENTED for vision/audio/speech)
 *   7. Security Boundaries (SSRF validation, AuditLedger chain integrity, prototype-pollution protection)
 *   8. CognitiveEvaluationLab (12-metric reproducible evaluation runner + baselines + provenance)
 *   9. Live HTTP Express Server RBAC + Batch 29 /api/cognitive/* endpoints
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

async function runModuleTests(tmpDir: string) {
  process.env.ZYNTHEOR_AUDIT_FILE = path.join(tmpDir, 'audit_log.jsonl');
  process.env.ZYNTHEOR_EXEC_METRICS_FILE = path.join(tmpDir, 'execution_metrics.json');
  process.env.ZYNTHEOR_CONTEXT_FILE = path.join(tmpDir, 'cognitive_context.json');
  process.env.ZYNTHEOR_PERF_FILE = path.join(tmpDir, 'performance_profiles.json');
  process.env.ZYNTHEOR_KG_FILE = path.join(tmpDir, 'knowledge_graph.json');
  process.env.ZYNTHEOR_REASONING_LOG = path.join(tmpDir, 'adaptive_reasoning_history.json');
  process.env.ZYNTHEOR_BATCH29_EVAL_FILE = path.join(tmpDir, 'batch29_eval.json');
  process.env.ZYNTHEOR_EVAL_HISTORY_FILE = path.join(tmpDir, 'eval_history.json');

  const { CognitiveContextEngine } = await import('../lib/CognitiveContextEngine.ts');
  const { AdaptiveReasoningEngine } = await import('../lib/AdaptiveReasoningEngine.ts');
  const { KnowledgeGraphEngine } = await import('../lib/KnowledgeGraphEngine.ts');
  const { KnowledgeWorkspace } = await import('../lib/KnowledgeWorkspace.ts');
  const { NativeMemoryController } = await import('../lib/NativeMemoryController.ts');
  const { PerformanceEngine } = await import('../lib/PerformanceEngine.ts');
  const { getMultimodalCapabilityRegistry } = await import('../lib/MultimodalInterfaces.ts');
  const { runBatch29Evaluation } = await import('../lib/CognitiveEvaluationLab.ts');
  const { validateCloudUrl } = await import('../lib/ConnectivityMonitor.ts');
  const { AuditLedger } = await import('../lib/AuditLedger.ts');

  const scopeA = { tenantId: 'b29_tenant_alpha', userId: 'b29_dev_a', role: 'developer' };
  const scopeB = { tenantId: 'b29_tenant_beta', userId: 'b29_dev_b', role: 'developer' };
  const scopeAOtherUser = { tenantId: 'b29_tenant_alpha', userId: 'b29_dev_other', role: 'developer' };

  // 1. CognitiveContextEngine
  const ctx = CognitiveContextEngine.getInstance();
  const codingAnalysis = ctx.analyzeContext({
    input: 'Build a TypeScript HMAC-SHA256 webhook verifier in /lib/AuthMiddleware.ts.\nStrictly enforce timingSafeEqual max=32.\nNever allow empty secrets max=64.',
    nativeNeuralState: 'BLOCKED',
  });
  assert.equal(codingAnalysis.attribution, 'deterministic_preprocessor');
  assert.equal(codingAnalysis.nativeNeuralState, 'BLOCKED');
  assert.ok(['coding', 'security_audit'].includes(codingAnalysis.intent.primary));
  assert.ok(codingAnalysis.segments.length >= 3);
  assert.ok(codingAnalysis.conflicts.length >= 1, 'Conflicting numeric/directive constraints must be flagged');
  assert.ok(codingAnalysis.entities.some((e) => e.type === 'FILE_PATH'));

  const thaiAnalysis = ctx.analyzeContext({
    input: 'ช่วยแก้ไข bug ที่ error ในระบบทดสอบและเพิ่ม unit test',
  });
  assert.equal(thaiAnalysis.language, 'mixed');
  assert.ok(thaiAnalysis.intent.primary === 'debugging' || thaiAnalysis.intent.secondary.includes('debugging'));

  const sessId = `b29_sess_${Date.now()}`;
  const upserted = ctx.upsertSessionTurn({
    sessionId: sessId,
    role: 'user',
    text: 'Strictly preserve SHA-256 chain verification on AuditLedger.',
    pinAsFact: true,
    scope: scopeA,
  });
  assert.equal(upserted.session.turns.length, 1);
  assert.equal(upserted.session.pinnedFacts.length, 1);

  assert.throws(
    () =>
      ctx.upsertSessionTurn({
        sessionId: sessId,
        role: 'user',
        text: 'Unauthorized cross-tenant write',
        scope: scopeB,
      }),
    /FORBIDDEN:/
  );
  assert.throws(
    () =>
      ctx.upsertSessionTurn({
        sessionId: sessId,
        role: 'user',
        text: 'Unauthorized cross-owner write',
        scope: scopeAOtherUser,
      }),
    /FORBIDDEN:/
  );
  assert.equal(ctx.deleteSession(sessId, scopeA), true);

  // 2. AdaptiveReasoningEngine
  const reasoner = AdaptiveReasoningEngine.getInstance();

  const mathValid = await reasoner.executeReasoning({
    prompt: 'Verify algebraic derivation step by step',
    scope: scopeA,
    mathSteps: [
      { expr: '12 * 4', claimed: 48 },
      { expr: '48 - 8', claimed: 40 },
    ],
    expectedFinal: 40,
  });
  assert.equal(mathValid.problemClass, 'deterministic_symbolic');
  assert.equal(mathValid.selectedStrategy, 'symbolic_math_verifier');
  assert.equal(mathValid.verified, true);
  assert.equal(mathValid.reasoningMetadata.redactedPrivateTrace, true);
  assert.equal(mathValid.reasoningMetadata.traceDigestSha256.length, 64);

  const mathWrong = await reasoner.executeReasoning({
    prompt: 'Check flawed arithmetic step',
    scope: scopeA,
    mathSteps: [{ expr: '10 * 5', claimed: 55 }],
    expectedFinal: 55,
  });
  assert.equal(mathWrong.verified, false);
  assert.equal(mathWrong.winningHypothesis.verifierPassed, false);
  assert.equal(mathWrong.winningHypothesis.counterexamplePassed, true);

  const cspCycle = await reasoner.executeReasoning({
    prompt: 'Schedule cyclic dependency graph',
    scope: scopeA,
    cspTasks: [
      { id: 't1', depends_on: ['t2'], cost: 2 },
      { id: 't2', depends_on: ['t1'], cost: 2 },
    ],
  });
  assert.equal(cspCycle.problemClass, 'constraint_csp');
  assert.equal(cspCycle.verified, false);

  const unsafeAst = await reasoner.executeReasoning({
    prompt: 'Inspect Python security boundaries',
    scope: scopeA,
    pythonSource: 'def run(x):\n    return eval(x)\n',
  });
  assert.equal(unsafeAst.problemClass, 'code_verification');
  assert.equal(unsafeAst.verified, false);

  const unknownQuery = await reasoner.executeReasoning({
    prompt: 'Explain __totally_unknown_b29_entity_xyz999__ configuration details',
    scope: scopeA,
  });
  assert.equal(unknownQuery.uncertainty.abstentionRecommended, true);

  const bench = await reasoner.evaluateAgainstIndependentBenchmark();
  assert.ok(bench.totalCases >= 5);
  assert.ok(bench.accuracy >= 0.8, `Expected benchmark accuracy >= 0.8, got ${bench.accuracy}`);

  // 3. KnowledgeGraphEngine
  const kw = KnowledgeWorkspace.getInstance();
  const kg = KnowledgeGraphEngine.getInstance();
  const createdDocIds: string[] = [];
  try {
    const d1 = kw.createDocument({
      title: 'B29 Core Pipeline Spec',
      content: 'AuthGateway validates SovereignToken. SovereignToken requires TimingSafeEqualCheck.',
      collection: 'B29Unit',
      tags: ['b29', 'auth'],
      provenance: 'B29 unit doc 1',
      tenantId: scopeA.tenantId,
    });
    const d2 = kw.createDocument({
      title: 'B29 Policy Positive',
      content: 'LedgerService must always enforce ImmutableHashChain limit=100.',
      collection: 'B29Unit',
      tags: ['b29', 'policy'],
      provenance: 'B29 unit doc 2',
      tenantId: scopeA.tenantId,
    });
    const d3 = kw.createDocument({
      title: 'B29 Policy Negative',
      content: 'LedgerService must never enforce ImmutableHashChain limit=20.',
      collection: 'B29Unit',
      tags: ['b29', 'policy'],
      provenance: 'B29 unit doc 3',
      tenantId: scopeA.tenantId,
    });
    const dSecret = kw.createDocument({
      title: 'Tenant Beta Confidential',
      content: 'BetaVault holds TopSecretBetaToken.',
      collection: 'B29Unit',
      tags: ['secret'],
      provenance: 'B29 unit doc beta',
      tenantId: scopeB.tenantId,
    });
    createdDocIds.push(d1.id, d2.id, d3.id, dSecret.id);

    kg.buildFromWorkspace({ tenantId: scopeA.tenantId, role: 'developer' });
    kg.buildFromWorkspace({ tenantId: scopeB.tenantId, role: 'developer' });

    const resolved = kg.resolveCanonicalEntity('ซินธีออร์');
    assert.equal(resolved.displayLabel, 'ZYNTHEOR');
    assert.equal(resolved.canonical, 'zyntheor');

    const hops = kg.traverseMultiHop('AuthGateway', {
      maxHops: 3,
      limit: 5,
      scope: { tenantId: scopeA.tenantId, role: 'developer' },
    });
    assert.ok(hops.paths.some((p) => p.hops.length >= 2), 'Expected 2+ hop traversal path');
    assert.ok(
      hops.paths.every((p) => p.provenanceHashes.every((h) => h.length === 64)),
      'Every traversal hop must carry 64-char SHA-256 provenance hash'
    );

    const crossTenantHops = kg.traverseMultiHop('BetaVault', {
      maxHops: 2,
      limit: 5,
      scope: { tenantId: scopeA.tenantId, role: 'developer' },
    });
    assert.equal(crossTenantHops.paths.length, 0, 'Cross-tenant graph traversal must return empty');

    const contradictions = kg.detectGraphContradictions({ tenantId: scopeA.tenantId, role: 'developer' });
    assert.ok(contradictions.length >= 1, 'Should detect contradiction across positive and negative docs');

    const consistency = kg.verifyGraphConsistency({ tenantId: scopeA.tenantId, role: 'developer' });
    assert.equal(consistency.valid, true);
    assert.equal(consistency.danglingEdgeIds.length, 0);
    assert.equal(consistency.missingProvenanceEdgeIds.length, 0);
  } finally {
    for (const id of createdDocIds) {
      try {
        kw.deleteDocument(id);
      } catch {
        // ignore cleanup error
      }
    }
  }

  // 4. NativeMemoryController Reversible Consolidation
  const mem = NativeMemoryController.getInstance();
  const mk1 = `b29_unit_ep1_${Date.now()}`;
  const mk2 = `b29_unit_ep2_${Date.now()}`;
  const mkTarget = `b29_unit_sem_${Date.now()}`;
  try {
    mem.storeMemory(mk1, 'Always enforce constant-time HMAC verification and fail closed on tamper', 'episodic', undefined, { scope: scopeA });
    mem.storeMemory(mk2, 'Always enforce constant-time HMAC verification and fail closed on tamper', 'episodic', undefined, { scope: scopeA });

    const dups = mem.detectNearDuplicates(scopeA);
    assert.ok(dups.some((d) => (d.keyA === mk1 && d.keyB === mk2) || (d.keyA === mk2 && d.keyB === mk1)));

    const cons = mem.consolidateEpisodicToSemanticReversible({
      targetKey: mkTarget,
      sourceCategory: 'episodic',
      maxSources: 10,
      archiveSourcesFromActive: true,
      scope: scopeA,
    });
    assert.ok(cons.consolidated);
    assert.ok(fs.existsSync(cons.archivePath));
    assert.equal(mem.retrieveMemory(mk1, scopeA), null, 'Source moved out of active index');

    assert.throws(() => mem.rollbackConsolidation(cons.consolidationId, scopeB), /FORBIDDEN:/);

    const rb = mem.rollbackConsolidation(cons.consolidationId, scopeA);
    assert.ok(rb.restoredKeys.includes(mk1));
    assert.ok(rb.restoredKeys.includes(mk2));
    assert.ok(mem.retrieveMemory(mk1, scopeA), 'Restored verbatim source item must exist again');
  } finally {
    for (const k of [mk1, mk2, mkTarget]) {
      try {
        mem.deleteMemory(k, scopeA);
      } catch {
        // ignore cleanup
      }
    }
  }

  // 5. PerformanceEngine
  const perf = PerformanceEngine.getInstance();
  const profOut = await perf.profileAsync(
    { operation: 'unit_probe_op', strategy: 'fast_probe', tenantId: scopeA.tenantId },
    async () => ({ result: 42, succeeded: true })
  );
  assert.equal(profOut.result, 42);
  assert.ok(profOut.durationMs >= 0);

  perf.setCached('kg', scopeA.tenantId, 'k1', { secret: 'alpha_only' });
  assert.deepEqual(perf.getCached('kg', scopeA.tenantId, 'k1'), { secret: 'alpha_only' });
  assert.equal(perf.getCached('kg', scopeB.tenantId, 'k1'), null, 'Tenant B must not read Tenant A cache');
  assert.ok(perf.invalidateTenantNamespace(scopeA.tenantId, 'kg') >= 1);
  assert.equal(perf.getCached('kg', scopeA.tenantId, 'k1'), null);

  const prevLimit = perf.getConfig().retrievalLimit;
  const optSnap = perf.applyOptimization({
    updates: { retrievalLimit: prevLimit === 7 ? 5 : 7 },
    reason: 'Unit test optimization',
    appliedBy: 'b29_unit',
  });
  assert.equal(perf.getConfig().retrievalLimit, prevLimit === 7 ? 5 : 7);
  perf.rollbackOptimization(optSnap.snapshotId, 'b29_unit');
  assert.equal(perf.getConfig().retrievalLimit, prevLimit);

  // 6. Multimodal Interfaces Honesty
  const mm = await getMultimodalCapabilityRegistry();
  const docMod = mm.modalities.find((m) => m.modality === 'document_understanding');
  const imgMod = mm.modalities.find((m) => m.modality === 'image_understanding');
  const audMod = mm.modalities.find((m) => m.modality === 'audio_input');
  const spkMod = mm.modalities.find((m) => m.modality === 'speech_processing');
  assert.equal(docMod?.status, 'PARTIAL');
  assert.equal(imgMod?.status, 'NOT IMPLEMENTED');
  assert.equal(audMod?.status, 'NOT IMPLEMENTED');
  assert.equal(spkMod?.status, 'NOT IMPLEMENTED');

  // 7. Security Boundaries (SSRF + AuditLedger)
  assert.equal(validateCloudUrl('http://169.254.169.254/latest/meta-data/').ok, false);
  assert.equal(validateCloudUrl('http://10.0.0.5/weights.pt').ok, false);
  assert.equal(validateCloudUrl('file:///etc/passwd').ok, false);
  assert.equal(validateCloudUrl('https://cdn.zyntheor.example/checkpoint.pt').ok, true);
  assert.equal(AuditLedger.verifyIntegrity().valid, true);

  // 8. CognitiveEvaluationLab 12 Metrics
  const evalReport = await runBatch29Evaluation();
  assert.equal(evalReport.schema, 'ZYNTHEOR_BATCH29_EVAL_V1');
  assert.equal(evalReport.summary.total, 12);
  assert.equal(evalReport.summary.failed, 0, `Expected 0 failed metrics, got: ${JSON.stringify(evalReport.metrics.filter((m) => m.status === 'FAIL'))}`);
  assert.equal(evalReport.securityValidation.ssrfHardened, true);
  assert.equal(evalReport.securityValidation.crossTenantBlocked, true);
  assert.equal(evalReport.securityValidation.auditChainValid, true);

  console.log('[Batch29 Module Tests] ALL 8 COGNITIVE SUBSYSTEM SUITES PASSED');
}

async function runLiveHttpTests(tmpDir: string) {
  const apiPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${apiPort}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    NODE_ENV: 'development',
    ZYNTHEOR_API_ONLY: '1',
    ZYNTHEOR_ENABLE_DEV_LOGIN: 'true',
    ZYNTHEOR_AUDIT_FILE: path.join(tmpDir, 'http_audit_log.jsonl'),
    ZYNTHEOR_EXEC_METRICS_FILE: path.join(tmpDir, 'http_execution_metrics.json'),
    ZYNTHEOR_CONTEXT_FILE: path.join(tmpDir, 'http_context.json'),
    ZYNTHEOR_PERF_FILE: path.join(tmpDir, 'http_perf.json'),
    ZYNTHEOR_KG_FILE: path.join(tmpDir, 'http_kg.json'),
    ZYNTHEOR_REASONING_LOG: path.join(tmpDir, 'http_reasoning.json'),
    ZYNTHEOR_BATCH29_EVAL_FILE: path.join(tmpDir, 'http_b29_eval.json'),
  };

  const srv = spawn('./node_modules/.bin/tsx', ['server.ts'], {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(baseUrl, 20000);

    // Unauthenticated request denied
    const unauthRes = await fetch(`${baseUrl}/api/cognitive/operations`);
    assert.equal(unauthRes.status, 401);

    const guestToken = await devLogin(baseUrl, 'User', 'http_tenant_a', 'http_u_guest');
    const devToken = await devLogin(baseUrl, 'Developer', 'http_tenant_a', 'http_u_dev');
    const devTenantBToken = await devLogin(baseUrl, 'Developer', 'http_tenant_b', 'http_u_dev_b');
    const adminToken = await devLogin(baseUrl, 'Administrator', 'http_tenant_a', 'http_u_admin');

    // Guest cannot mutate adaptive reasoning or run evaluation
    const guestReasonRes = await fetch(`${baseUrl}/api/cognitive/reasoning/execute`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guestToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Run math' }),
    });
    assert.equal(guestReasonRes.status, 403);

    // Developer blocked from operator performance optimize endpoint
    const devOptimizeRes = await fetch(`${baseUrl}/api/cognitive/performance/optimize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'unauthorized', updates: { retrievalLimit: 4 } }),
    });
    assert.equal(devOptimizeRes.status, 403);

    // Prototype pollution rejection (construct raw JSON string so __proto__ is an own JSON key)
    const protoRes = await fetch(`${baseUrl}/api/cognitive/context/analyze`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guestToken}`, 'Content-Type': 'application/json' },
      body: '{"input":"test","__proto__":{"polluted":true}}',
    });
    assert.equal(protoRes.status, 400);

    // Context analyze & session tenant isolation
    const ctxRes = await fetch(`${baseUrl}/api/cognitive/context/analyze`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guestToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Build HMAC verifier\u0000 and run tests' }),
    });
    assert.equal(ctxRes.status, 200);
    const ctxBody = await ctxRes.json();
    assert.equal(ctxBody.analysis.attribution, 'deterministic_preprocessor');

    const sessId = `http_sess_${Date.now()}`;
    const createSessRes = await fetch(`${baseUrl}/api/cognitive/context/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessId, text: 'Pinned tenant rule', pinAsFact: true }),
    });
    assert.equal(createSessRes.status, 201);

    const crossTenantSess = await fetch(`${baseUrl}/api/cognitive/context/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devTenantBToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessId, text: 'Cross tenant tamper attempt' }),
    });
    assert.equal(crossTenantSess.status, 403);

    // Adaptive reasoning execution
    const rsnRes = await fetch(`${baseUrl}/api/cognitive/reasoning/execute`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Verify 9 * 7 equals 63',
        mathSteps: [{ expr: '9 * 7', claimed: 63 }],
        expectedFinal: 63,
      }),
    });
    assert.equal(rsnRes.status, 200);
    const rsnBody = await rsnRes.json();
    assert.equal(rsnBody.outcome.verified, true);

    // Admin apply + rollback performance optimization
    const adminOptRes = await fetch(`${baseUrl}/api/cognitive/performance/optimize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'HTTP E2E optimization', updates: { retrievalLimit: 7 } }),
    });
    assert.equal(adminOptRes.status, 200);
    const adminOptBody = await adminOptRes.json();

    const adminRbRes = await fetch(`${baseUrl}/api/cognitive/performance/rollback`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId: adminOptBody.snapshot.snapshotId }),
    });
    assert.equal(adminRbRes.status, 200);
    assert.equal((await adminRbRes.json()).snapshot.rolledBack, true);

    // Multimodal capability honesty
    const mmRes = await fetch(`${baseUrl}/api/cognitive/multimodal/capabilities`, {
      headers: { Authorization: `Bearer ${guestToken}` },
    });
    assert.equal(mmRes.status, 200);
    const mmBody = await mmRes.json();
    assert.equal(mmBody.registry.modalities.some((m: any) => m.status === 'NOT IMPLEMENTED'), true);

    // Unified operations & 12-metric evaluation endpoint
    const evalPostRes = await fetch(`${baseUrl}/api/cognitive/evaluation`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${devToken}` },
    });
    assert.equal(evalPostRes.status, 200);
    const evalBody = await evalPostRes.json();
    assert.equal(evalBody.report.summary.total, 12);
    assert.equal(evalBody.report.summary.failed, 0);

    const opsRes = await fetch(`${baseUrl}/api/cognitive/operations`, {
      headers: { Authorization: `Bearer ${guestToken}` },
    });
    assert.equal(opsRes.status, 200);
    const opsBody = await opsRes.json();
    assert.equal(opsBody.success, true);

    console.log('[Batch29 HTTP & RBAC Tests] ALL COGNITIVE API ENDPOINTS VERIFIED');
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-b29-'));
  try {
    await runModuleTests(tmpDir);
    await runLiveHttpTests(tmpDir);
    console.log('[Batch29 Cognitive Intelligence Suite] PASS');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Batch29 Cognitive Intelligence Suite] FAIL:', err);
    process.exit(1);
  });
