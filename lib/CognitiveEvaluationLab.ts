/**
 * ZYNTHEOR Batch 29 — Cognitive Evaluation Lab
 *
 * Reproducible, Zero-Simulation evaluation runner across all 12 Cognitive Metrics.
 * Compares against historical Batch 27 / Batch 28 / LMv2 baselines when present,
 * tags every run with datasetVersion, checkpointSha256, runtimeVersion, hardware,
 * and config, and isolates temporary fixtures per runId with full cleanup.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { AuditLedger } from './AuditLedger.ts';
import { ConnectivityMonitor, validateCloudUrl } from './ConnectivityMonitor.ts';
import { CognitiveContextEngine } from './CognitiveContextEngine.ts';
import { AdaptiveReasoningEngine } from './AdaptiveReasoningEngine.ts';
import { KnowledgeGraphEngine } from './KnowledgeGraphEngine.ts';
import { KnowledgeWorkspace } from './KnowledgeWorkspace.ts';
import { KnowledgeIntelligenceEngine } from './KnowledgeIntelligenceEngine.ts';
import { NativeMemoryController } from './NativeMemoryController.ts';
import { PerformanceEngine } from './PerformanceEngine.ts';
import { SelfEvaluationEngine } from './SelfEvaluationEngine.ts';
import { getMultimodalCapabilityRegistry } from './MultimodalInterfaces.ts';
import { SovereignIdentity } from './SovereignIdentity.ts';
import {
  getCapabilityGatesSnapshot,
  inspectVerifiedExecutionMetrics,
  type CapabilityGatesSnapshot,
} from './CapabilityGates.ts';
import {
  classifyTruthClaim,
  enforceTruthClaims,
  summarizeTruthClaims,
  type TruthClaimRecord,
  type TruthKernelSummary,
} from './TruthKernel.ts';

export type EvalMetricStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT IMPLEMENTED';

export interface CognitiveMetricResult {
  id: string;
  name: string;
  status: EvalMetricStatus;
  score: number | null;
  unit: string;
  details: string;
  evidence: Record<string, unknown>;
}

export interface Batch29EvaluationReport {
  schema: 'ZYNTHEOR_BATCH29_EVAL_V1';
  runId: string;
  timestamp: string;
  status: 'VERIFIED' | 'PARTIAL_BLOCKED' | 'FAILED';
  provenance: {
    runtimeVersion: string;
    datasetVersion: string;
    checkpointSha256: string | null;
    tokenizerSha256: string | null;
    activeRuntimeId: string | null;
    runtimeState: string;
    executionVerified: boolean;
    hardware: {
      platform: string;
      arch: string;
      cpus: number;
      totalMemMb: number;
      nodeVersion: string;
    };
    config: {
      onlineOnlyMandatory: boolean;
      zeroSimulationPolicy: boolean;
    };
  };
  summary: {
    passed: number;
    failed: number;
    blocked: number;
    notImplemented: number;
    total: number;
  };
  metrics: CognitiveMetricResult[];
  modelCapabilityProbe: any;
  multimodalCapabilities: Awaited<ReturnType<typeof getMultimodalCapabilityRegistry>>;
  capabilityGates?: CapabilityGatesSnapshot;
  truthKernel?: {
    claims: TruthClaimRecord[];
    summary: TruthKernelSummary;
  };
  securityValidation: {
    auditChainValid: boolean;
    auditRecords: number;
    identitySuitePassed: number;
    identitySuiteTotal: number;
    ssrfHardened: boolean;
    crossTenantBlocked: boolean;
  };
  baselineComparison: {
    batch27: { runId: string; status: string; passed: number; blocked: number; total: number } | null;
    batch28: { runId: string; overallStatus: string; passedChecks: number; blockedChecks: number; totalChecks: number } | null;
    lmV2: { valPerplexity: number; top1Accuracy: number; thaiValPerplexity: number } | null;
  };
  durationMs: number;
}

const EVAL_FILE = () =>
  process.env.ZYNTHEOR_BATCH29_EVAL_FILE
    ? path.resolve(process.env.ZYNTHEOR_BATCH29_EVAL_FILE)
    : path.resolve(process.cwd(), 'native_data', 'batch29_eval.json');

export function loadLatestBatch29EvalReport(): Batch29EvaluationReport | null {
  try {
    const f = EVAL_FILE();
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonIfExists(relPath: string): any {
  try {
    const abs = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

async function runPythonModelCapabilityProbe(): Promise<any> {
  const script = path.resolve(process.cwd(), 'qplus_native', 'batch29_cognitive_probe.py');
  return new Promise((resolve) => {
    execFile('python3', ['-B', script], { cwd: process.cwd(), timeout: 15_000 }, (err, stdout, stderr) => {
      if (err && !stdout.trim()) {
        resolve({ error: stderr || err.message, status: 'FAILED' });
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (parseErr: any) {
        resolve({ error: parseErr.message, status: 'FAILED' });
      }
    });
  });
}

const FORBIDDEN_EVAL_INJECTION_KEYS = new Set([
  'score',
  'scores',
  'metrics',
  'cog08',
  'cog-08',
  'taskcompletionscore',
  'taskcompletionrate',
  'override',
  'overrides',
  'manualscore',
  'status',
  'summary',
  'passed',
  'failed',
  'blocked',
  'totalcycles',
  'succeededcycles',
  'executionevidencehash',
]);

export function assertNoManualScoreInjection(input: unknown): void {
  if (input === undefined || input === null) return;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('INVALID_EVALUATION_INPUT: Request payload must be an object or empty');
  }
  const scan = (obj: Record<string, unknown>, prefix = '') => {
    for (const [key, val] of Object.entries(obj)) {
      const normalized = key.toLowerCase();
      if (FORBIDDEN_EVAL_INJECTION_KEYS.has(normalized)) {
        throw new Error(
          `INVALID_EVALUATION_INPUT: Manual score/metric injection ('${prefix}${key}') is forbidden; evaluation scores must come exclusively from verified execution evidence.`
        );
      }
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        scan(val as Record<string, unknown>, `${prefix}${key}.`);
      }
    }
  };
  scan(input as Record<string, unknown>);
}

export async function runBatch29Evaluation(rawInput?: unknown): Promise<Batch29EvaluationReport> {
  assertNoManualScoreInjection(rawInput);
  const tStart = Date.now();
  const runId = `b29_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const timestamp = new Date().toISOString();
  const tenantA = `__b29_eval_a_${runId}`;
  const tenantB = `__b29_eval_b_${runId}`;
  const scopeA = { tenantId: tenantA, userId: 'eval_dev_a', role: 'developer' };
  const scopeB = { tenantId: tenantB, userId: 'eval_dev_b', role: 'developer' };

  const metrics: CognitiveMetricResult[] = [];
  const conn = await ConnectivityMonitor.getInstance().checkNow();

  // 1. Context Accuracy (Intent, Segmentation, Conflict Detection, Scope Isolation)
  const ctxEngine = CognitiveContextEngine.getInstance();
  const ctxProbes = [
    { text: 'Build HMAC webhook verifier in TypeScript with unit tests', expected: 'coding' },
    { text: 'Calculate budget: 150 + 240 * 2 under constraint max=700', expected: 'math_reasoning' },
    { text: 'แก้ไข bug ที่ error ในไฟล์ server.ts', expected: 'debugging' },
    { text: 'Verify tenantId isolation and SHA-256 audit ledger signatures', expected: 'security_audit' },
  ];
  let intentHits = 0;
  for (const p of ctxProbes) {
    const res = ctxEngine.analyzeContext({ input: p.text });
    if (res.intent.primary === p.expected || res.intent.secondary.includes(p.expected as any)) {
      intentHits += 1;
    }
  }
  const conflictProbe = ctxEngine.analyzeContext({
    input: 'Strictly allow online audit persistence max=10.\nNever allow online audit persistence max=25.',
  });
  const ctxAccuracy = Number((intentHits / ctxProbes.length).toFixed(3));
  metrics.push({
    id: 'COG-01',
    name: 'Context Accuracy & Conflict Detection',
    status: intentHits >= 3 && conflictProbe.conflicts.length > 0 ? 'PASS' : 'FAIL',
    score: ctxAccuracy,
    unit: 'ratio',
    details: `${intentHits}/${ctxProbes.length} bilingual intents recognized; ${conflictProbe.conflicts.length} conflict(s) flagged deterministically.`,
    evidence: {
      intentHits,
      totalProbes: ctxProbes.length,
      conflictsDetected: conflictProbe.conflicts.map((c) => c.kind),
      attribution: conflictProbe.attribution,
    },
  });

  // 2. Reasoning Accuracy (Independent Benchmark Suite)
  const rsnEngine = AdaptiveReasoningEngine.getInstance();
  const rsnBench = await rsnEngine.evaluateAgainstIndependentBenchmark();
  metrics.push({
    id: 'COG-02',
    name: 'Adaptive Reasoning Accuracy (Independent Benchmark)',
    status: rsnBench.accuracy >= 0.8 ? 'PASS' : 'FAIL',
    score: rsnBench.accuracy,
    unit: 'ratio',
    details: `${rsnBench.passedCases}/${rsnBench.totalCases} independent symbolic/CSP/AST/abstention benchmark cases passed.`,
    evidence: {
      passedCases: rsnBench.passedCases,
      totalCases: rsnBench.totalCases,
      avgLatencyMs: rsnBench.avgLatencyMs,
    },
  });

  // Setup isolated KnowledgeWorkspace + KnowledgeGraph fixtures
  const kw = KnowledgeWorkspace.getInstance();
  const kg = KnowledgeGraphEngine.getInstance();
  const kie = KnowledgeIntelligenceEngine.getInstance();
  const createdDocs: string[] = [];
  let crossTenantBlocked = false;

  try {
    const doc1 = kw.createDocument({
      title: 'B29 Auth Architecture',
      content: 'AuthService utilizes HMAC_TimingSafeEqual. HMAC_TimingSafeEqual guarantees TimingAttackDefense.',
      collection: `B29Eval_${runId}`,
      tags: ['b29', 'auth', 'security'],
      provenance: 'Batch29 evaluation fixture A1',
      tenantId: tenantA,
    });
    const doc2 = kw.createDocument({
      title: 'B29 Security Contradiction Positive',
      content: 'AuditLedger must always enforce SHA256Chain with blockLimit=100.',
      collection: `B29Eval_${runId}`,
      tags: ['b29', 'audit'],
      provenance: 'Batch29 evaluation fixture A2',
      tenantId: tenantA,
    });
    const doc3 = kw.createDocument({
      title: 'B29 Security Contradiction Negative',
      content: 'AuditLedger must never enforce SHA256Chain with blockLimit=25.',
      collection: `B29Eval_${runId}`,
      tags: ['b29', 'audit'],
      provenance: 'Batch29 evaluation fixture A3',
      tenantId: tenantA,
    });
    const docSecretB = kw.createDocument({
      title: 'Tenant B Confidential Vault',
      content: 'TenantBVault uses SecretKeyOmega9912 for internal signing.',
      collection: `B29Eval_${runId}`,
      tags: ['secret'],
      provenance: 'Batch29 isolation fixture B',
      tenantId: tenantB,
    });
    createdDocs.push(doc1.id, doc2.id, doc3.id, docSecretB.id);

    kg.buildFromWorkspace({ tenantId: tenantA, role: 'developer' });
    kg.buildFromWorkspace({ tenantId: tenantB, role: 'developer' });

    // 3. Multi-hop retrieval accuracy
    const hopRes = kg.traverseMultiHop('AuthService', {
      maxHops: 3,
      limit: 5,
      scope: { tenantId: tenantA, role: 'developer' },
    });
    const hasMultiHop = hopRes.paths.some((p) => p.hops.length >= 2 && p.provenanceHashes.length > 0);
    const hasAnyPath = hopRes.paths.length > 0;
    const crossLeaked = hopRes.paths.some((p) => p.hops.some((h) => h.documentId === docSecretB.id));
    metrics.push({
      id: 'COG-03',
      name: 'Multi-Hop Knowledge Graph Retrieval',
      status: hasMultiHop && !crossLeaked ? 'PASS' : 'FAIL',
      score: hasMultiHop ? 1 : hasAnyPath ? 0.5 : 0,
      unit: 'ratio',
      details: `Found ${hopRes.paths.length} traversal path(s); 2+ hop verified=${hasMultiHop}; crossTenantLeak=${crossLeaked}.`,
      evidence: {
        seedNodes: hopRes.seedNodes,
        pathCount: hopRes.paths.length,
        maxHopsObserved: Math.max(0, ...hopRes.paths.map((p) => p.hops.length)),
        latencyMs: hopRes.latencyMs,
      },
    });

    // 4. Contradiction detection accuracy
    const contradictions = kg.detectGraphContradictions({ tenantId: tenantA, role: 'developer' });
    metrics.push({
      id: 'COG-04',
      name: 'Contradiction Detection Accuracy',
      status: contradictions.length >= 1 ? 'PASS' : 'FAIL',
      score: contradictions.length >= 1 ? 1 : 0,
      unit: 'ratio',
      details: `Detected ${contradictions.length} cross-document triple/assertion contradiction(s).`,
      evidence: {
        contradictions: contradictions.slice(0, 5).map((c) => ({
          subject: c.subjectLabel,
          reason: c.reason,
          confidence: c.confidence,
        })),
      },
    });

    // 5. Knowledge Graph consistency
    const kgConsistency = kg.verifyGraphConsistency({ tenantId: tenantA, role: 'developer' });
    metrics.push({
      id: 'COG-05',
      name: 'Knowledge Graph Consistency & Provenance',
      status: kgConsistency.valid && kgConsistency.edgeCount > 0 ? 'PASS' : 'FAIL',
      score: kgConsistency.valid ? 1 : 0,
      unit: 'ratio',
      details: `nodes=${kgConsistency.nodeCount} edges=${kgConsistency.edgeCount} dangling=${kgConsistency.danglingEdgeIds.length} missingProvenance=${kgConsistency.missingProvenanceEdgeIds.length}.`,
      evidence: { ...kgConsistency, contradictions: kgConsistency.contradictions.length },
    });

    // Cross-tenant KG + Doc isolation probe
    const crossKg = kg.traverseMultiHop('TenantBVault', { maxHops: 2, limit: 5, scope: { tenantId: tenantA, role: 'developer' } });
    let docReadBlocked = false;
    try {
      kw.getDocument(docSecretB.id, { tenantId: tenantA, role: 'developer' });
    } catch {
      docReadBlocked = true;
    }
    crossTenantBlocked = crossKg.paths.length === 0 && docReadBlocked;

    // 11. Response Groundedness
    const groundedResp = kie.verifyCitations({
      answer: 'AuthService utilizes HMAC_TimingSafeEqual for defense.',
      citations: [{ documentId: doc1.id, contentHash: doc1.contentHash, snippet: 'AuthService utilizes HMAC_TimingSafeEqual' }],
      scope: { tenantId: tenantA, role: 'developer' },
    });
    const unkResp = kie.advancedRetrieve(`__nonexistent_${runId}__`, { tenantId: tenantA, role: 'developer' });
    metrics.push({
      id: 'COG-11',
      name: 'Response Groundedness & Honest Abstention',
      status: groundedResp.verified && !unkResp.found ? 'PASS' : 'FAIL',
      score: groundedResp.answerGroundingRate,
      unit: 'ratio',
      details: `citationCorrectness=${groundedResp.citationCorrectnessRate} answerGrounding=${groundedResp.answerGroundingRate} unknownAbstained=${!unkResp.found}.`,
      evidence: {
        citationCorrectnessRate: groundedResp.citationCorrectnessRate,
        answerGroundingRate: groundedResp.answerGroundingRate,
        unknownAbstained: !unkResp.found,
      },
    });
  } finally {
    for (const id of createdDocs) {
      try {
        kw.deleteDocument(id);
      } catch {
        // ignore cleanup error
      }
    }
    kg.buildFromWorkspace({ tenantId: tenantA, role: 'developer' });
    kg.buildFromWorkspace({ tenantId: tenantB, role: 'developer' });
  }

  // 6 & 7. Memory Retention Accuracy & Reversible Memory Consolidation Safety
  const memCtrl = NativeMemoryController.getInstance();
  const k1 = `__b29_ep_1_${runId}`;
  const k2 = `__b29_ep_2_${runId}`;
  const kTarget = `__b29_sem_${runId}`;
  let retentionOk = false;
  let consolidationSafe = false;
  let consolidationId = '';

  try {
    memCtrl.storeMemory(k1, 'Always enforce constant-time HMAC signature checks', 'episodic', undefined, { scope: scopeA });
    memCtrl.storeMemory(k2, 'Never leak cross-tenant episodic memory entries', 'episodic', undefined, { scope: scopeA });

    // Cross-tenant memory probe must throw
    let memIsolated = false;
    try {
      memCtrl.retrieveMemory(k1, scopeB);
    } catch {
      memIsolated = true;
    }

    const recalled = memCtrl.recallRankedMemories('constant-time HMAC signature', { limit: 3, scope: scopeA });
    retentionOk = memIsolated && recalled.some((r) => r.item.key === k1);

    const cons = memCtrl.consolidateEpisodicToSemanticReversible({
      targetKey: kTarget,
      sourceCategory: 'episodic',
      maxSources: 5,
      archiveSourcesFromActive: true,
      scope: scopeA,
    });
    consolidationId = cons.consolidationId;
    const rb = memCtrl.rollbackConsolidation(consolidationId, scopeA);
    const restored1 = memCtrl.retrieveMemory(k1, scopeA);
    const restored2 = memCtrl.retrieveMemory(k2, scopeA);
    consolidationSafe = Boolean(
      cons.consolidated &&
        fs.existsSync(cons.archivePath) &&
        rb.restoredKeys.includes(k1) &&
        restored1 &&
        restored2
    );
  } finally {
    for (const k of [k1, k2, kTarget]) {
      try {
        memCtrl.deleteMemory(k, scopeA);
      } catch {
        // ignore cleanup error
      }
    }
  }

  const memIntegrity = memCtrl.verifyStoreIntegrity();
  metrics.push({
    id: 'COG-06',
    name: 'Memory Retention & Tenant Isolation Accuracy',
    status: retentionOk && memIntegrity.valid ? 'PASS' : 'FAIL',
    score: retentionOk && memIntegrity.valid ? 1 : 0,
    unit: 'ratio',
    details: `Ranked recall matched saved fact; store SHA-256 integrity valid=${memIntegrity.valid} (${memIntegrity.totalItems} items).`,
    evidence: { retentionOk, storeIntegrityValid: memIntegrity.valid, storeSha256: memIntegrity.storeSha256 },
  });

  metrics.push({
    id: 'COG-07',
    name: 'Reversible Memory Consolidation Safety',
    status: consolidationSafe ? 'PASS' : 'FAIL',
    score: consolidationSafe ? 1 : 0,
    unit: 'ratio',
    details: consolidationSafe
      ? `Reversible consolidation snapshot verified and rolled back cleanly (${consolidationId}).`
      : 'Reversible consolidation or rollback verification failed.',
    evidence: { consolidationId, consolidationSafe },
  });

  // 8. Task Completion Rate (strictly measured from cryptographically verified execution records only)
  const execInspection = inspectVerifiedExecutionMetrics();
  const taskCyclesTotal = execInspection.verifiedCycles.length;
  const taskCyclesSucceeded = execInspection.verifiedSucceededCount;
  const taskCompletionScore =
    taskCyclesTotal > 0 ? Number((taskCyclesSucceeded / taskCyclesTotal).toFixed(3)) : null;
  metrics.push({
    id: 'COG-08',
    name: 'Autonomous Task Completion Rate',
    status: taskCyclesTotal === 0 ? 'BLOCKED' : taskCompletionScore! >= 0.5 ? 'PASS' : 'FAIL',
    score: taskCompletionScore,
    unit: 'ratio',
    details:
      taskCyclesTotal > 0
        ? `${taskCyclesSucceeded}/${taskCyclesTotal} cryptographically verified autonomous execution cycle(s) completed (rejected/unverified=${execInspection.rejectedCycles.length}).`
        : execInspection.rejectedCycles.length > 0
        ? `BLOCKED: ${execInspection.rejectedCycles.length} unverified/tampered cycle(s) rejected (zero valid executionEvidenceHash records).`
        : 'BLOCKED: Zero verified autonomous task execution cycles recorded yet.',
    evidence: {
      totalCycles: taskCyclesTotal,
      succeededCycles: taskCyclesSucceeded,
      rejectedCyclesCount: execInspection.rejectedCycles.length,
      rejectedReasons: execInspection.rejectedCycles.slice(0, 5),
      verifiedExecutionIds: execInspection.verifiedCycles.slice(0, 5).map((c: any) => c.executionId || c.taskId),
    },
  });

  // 9. Bilingual Capability & Native Model Capability Probe
  const modelCapabilityProbe = await runPythonModelCapabilityProbe();
  const tokV4 = modelCapabilityProbe?.tokenizer_profiles?.bilingual_v4;
  const tokBpe = modelCapabilityProbe?.tokenizer_profiles?.bilingual_bpe;
  const pureLmOk = modelCapabilityProbe?.pure_seq_lm?.status === 'VERIFIED';
  const zeroUnk = tokV4?.unk_count === 0 && tokBpe?.unk_count === 0;
  metrics.push({
    id: 'COG-09',
    name: 'Bilingual Tokenizer & Pure-Python Model Stability',
    status: zeroUnk && pureLmOk ? 'PASS' : 'FAIL',
    score: zeroUnk && pureLmOk ? 1 : 0,
    unit: 'ratio',
    details: `Zero-UNK bilingual=${zeroUnk}; BPE gain=${tokBpe?.compression_gain_vs_v2_pct ?? 0}%; PureSeqLM grad parity=${modelCapabilityProbe?.pure_seq_lm?.gradient_parity?.passed}; Cloud 41M=${modelCapabilityProbe?.target_41m_cloud_model?.status}.`,
    evidence: {
      bilingualV4Tokens: tokV4?.total_tokens,
      bilingualBpeCompressionPct: tokBpe?.compression_gain_vs_v2_pct,
      pureSeqLmVerified: pureLmOk,
      target41mStatus: modelCapabilityProbe?.target_41m_cloud_model?.status,
    },
  });

  // 10. Calibration Error (SelfEvaluationEngine real evaluation)
  const selfEval = SelfEvaluationEngine.getInstance().evaluateResponse({
    query: 'Does ZYNTHEOR verify HMAC signatures with timingSafeEqual?',
    answer: 'Yes, ZYNTHEOR SovereignIdentity requires constant-time crypto.timingSafeEqual for HMAC verification.',
    citations: [],
    claimedConfidence: 0.25,
    orchestratorSuccess: true,
    scope: { tenantId: tenantA, role: 'developer' },
  });
  const ece = selfEval.scores.calibrationError;
  metrics.push({
    id: 'COG-10',
    name: 'Confidence Calibration Error (ECE)',
    status: Number.isFinite(ece) && ece <= 0.35 ? 'PASS' : 'FAIL',
    score: ece,
    unit: 'ece',
    details: `Measured single-probe ECE=${ece} (claimed=${selfEval.scores.claimedConfidence}, empirical=${selfEval.scores.empiricalAccuracy}).`,
    evidence: selfEval.scores,
  });

  // 12. Latency & Memory Usage + Reversible Optimization Check
  const perf = PerformanceEngine.getInstance();
  const snap = perf.applyOptimization({
    updates: { retrievalLimit: 6 },
    reason: `Batch 29 evaluation reversible probe (${runId})`,
    appliedBy: 'Batch29Evaluator',
  });
  const rolledBack = perf.rollbackOptimization(snap.snapshotId, 'Batch29Evaluator');
  const perfTel = perf.getTelemetry();
  const memMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
  const avgLatencyLabel = perfTel.recentAvgLatencyMs !== null ? `${perfTel.recentAvgLatencyMs}ms` : 'UNAVAILABLE';
  metrics.push({
    id: 'COG-12',
    name: 'Runtime Latency, RSS Memory & Reversible Optimization',
    status: rolledBack.rolledBack ? 'PASS' : 'FAIL',
    score: perfTel.recentAvgLatencyMs,
    unit: 'ms',
    details: `avgLatency=${avgLatencyLabel}; Node RSS=${memMb}MiB; Optimization rollback verified=${rolledBack.rolledBack}.`,
    evidence: {
      recentAvgLatencyMs: perfTel.recentAvgLatencyMs,
      latencyStatus: perfTel.latencyStatus,
      nodeRssMb: memMb,
      bottlenecksCount: perfTel.bottlenecks.length,
      rollbackVerified: rolledBack.rolledBack,
    },
  });

  // Security, Multimodal & Capability Gates
  const multimodalCapabilities = await getMultimodalCapabilityRegistry();
  const capabilityGates = await getCapabilityGatesSnapshot({
    connectivity: conn,
    multimodal: multimodalCapabilities,
  });
  const evalTruthClaims = enforceTruthClaims([
    ...capabilityGates.truthClaims,
    ...perfTel.truthClaims,
    classifyTruthClaim({
      domain: 'capability_gate',
      statement: `COG-08 autonomous completion=${taskCompletionScore ?? 'BLOCKED'} over ${taskCyclesTotal} verified execution record(s)`,
      classification: taskCyclesTotal > 0 ? 'VERIFIED_FACT' : 'UNVERIFIED',
      basis: `SHA-256 executionEvidenceHash inspection (rejected=${execInspection.rejectedCycles.length})`,
    }),
  ]);
  const auditCheck = AuditLedger.verifyIntegrity();
  const idSim = SovereignIdentity.getInstance().runSecuritySimulation();
  const idPassed = idSim.filter((r) => r.status === 'PASS').length;
  const ssrfHardened =
    !validateCloudUrl('http://169.254.169.254/latest/meta-data/').ok &&
    !validateCloudUrl('http://10.0.0.5/checkpoint.pt').ok &&
    !validateCloudUrl('file:///etc/passwd').ok;

  const passed = metrics.filter((m) => m.status === 'PASS').length;
  const failed = metrics.filter((m) => m.status === 'FAIL').length;
  const blocked = metrics.filter((m) => m.status === 'BLOCKED').length;
  const notImplemented = metrics.filter((m) => m.status === 'NOT IMPLEMENTED').length;
  const overallStatus: Batch29EvaluationReport['status'] =
    failed > 0 ? 'FAILED' : blocked > 0 ? 'PARTIAL_BLOCKED' : 'VERIFIED';

  const b27 = readJsonIfExists('native_data/batch27_eval_report.json');
  const b28 = readJsonIfExists('native_data/batch28_eval.json');
  const v2 = readJsonIfExists('artifacts/lm-v2-eval.json');

  const report: Batch29EvaluationReport = {
    schema: 'ZYNTHEOR_BATCH29_EVAL_V1',
    runId,
    timestamp,
    status: overallStatus,
    provenance: {
      runtimeVersion: 'ZYNTHEOR-Core0.3-Batch30',
      datasetVersion: `KnowledgeCorpus+B29Bench@${timestamp.slice(0, 10)}`,
      checkpointSha256: conn.weightsLoaded ? conn.checkpointSha256 || null : null,
      tokenizerSha256: conn.tokenizerSha256 || null,
      activeRuntimeId: conn.activeRuntimeId || null,
      runtimeState: conn.runtimeState,
      executionVerified: conn.executionVerified,
      hardware: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
        nodeVersion: process.version,
      },
      config: {
        onlineOnlyMandatory: true,
        zeroSimulationPolicy: true,
      },
    },
    summary: {
      passed,
      failed,
      blocked,
      notImplemented,
      total: metrics.length,
    },
    metrics,
    modelCapabilityProbe,
    multimodalCapabilities,
    capabilityGates,
    truthKernel: {
      claims: evalTruthClaims,
      summary: summarizeTruthClaims(evalTruthClaims),
    },
    securityValidation: {
      auditChainValid: auditCheck.valid,
      auditRecords: auditCheck.totalRecords,
      identitySuitePassed: idPassed,
      identitySuiteTotal: idSim.length,
      ssrfHardened,
      crossTenantBlocked,
    },
    baselineComparison: {
      batch27: b27
        ? {
            runId: String(b27.runId || ''),
            status: String(b27.status || ''),
            passed: Number(b27.summary?.passed || 0),
            blocked: Number(b27.summary?.blocked || 0),
            total: Number(b27.summary?.total || 0),
          }
        : null,
      batch28: b28
        ? {
            runId: String(b28.runId || ''),
            overallStatus: String(b28.status || b28.overallStatus || ''),
            passedChecks: Number(b28.summary?.passed ?? b28.passedChecks ?? 0),
            blockedChecks: Number(b28.summary?.blocked ?? b28.blockedChecks ?? 0),
            totalChecks: Number(b28.summary?.total ?? b28.totalChecks ?? 0),
          }
        : null,
      lmV2: v2
        ? {
            valPerplexity: Number(v2.perplexity?.model ?? 0),
            top1Accuracy: Number(v2.accuracy?.top1 ?? 0),
            thaiValPerplexity: Number(v2.thai_target_positions?.model_ppl ?? 0),
          }
        : null,
    },
    durationMs: Date.now() - tStart,
  };

  const outFile = EVAL_FILE();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

  AuditLedger.append('SYSTEM', 'BATCH29_COGNITIVE_EVAL_EXECUTED', {
    runId,
    status: overallStatus,
    passed,
    failed,
    blocked,
    durationMs: report.durationMs,
  });

  return report;
}
