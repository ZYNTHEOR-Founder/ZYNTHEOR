/**
 * ZYNTHEOR Batch 27 — End-to-End Reproducible Evaluation Runner
 *
 * Zero-Simulation Policy:
 * - Never fabricates metrics when cloud checkpoints or dependencies are missing.
 * - Weight-dependent checks stay BLOCKED until Native Runtime is READY (executionVerified).
 * - Tags every evaluation run with datasetVersion, checkpointSha256, runtimeVersion,
 *   hardware, config, and timestamp.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger.ts';
import { ConnectivityMonitor, validateCloudUrl } from './ConnectivityMonitor.ts';
import { parserCapabilityReport } from './DocumentBinaryParser.ts';
import { KnowledgeIntelligenceEngine } from './KnowledgeIntelligenceEngine.ts';
import { KnowledgeWorkspace } from './KnowledgeWorkspace.ts';
import { NativeMemoryController } from './NativeMemoryController.ts';
import { NativeNeuralLMProvider } from './providers.ts';
import { SovereignIdentity } from './SovereignIdentity.ts';

export interface Batch27EvalCheck {
  id: string;
  category: 'runtime' | 'tokenizer' | 'inference' | 'reasoning' | 'knowledge' | 'memory' | 'security';
  name: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  details: string;
  metrics: Record<string, any> | null;
}

export interface Batch27EvaluationReport {
  schema: 'ZYNTHEOR_BATCH27_EVAL_V1';
  runId: string;
  timestamp: string;
  status: 'VERIFIED' | 'PARTIAL_BLOCKED' | 'FAILED';
  provenance: {
    runtimeVersion: string;
    datasetVersion: string;
    checkpointSha256: string | null;
    weightsSource: string | null;
    runtimeState: string;
    executionVerified: boolean;
    trainedProvenance: string | null;
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
    total: number;
  };
  checks: Batch27EvalCheck[];
  pythonEval: any;
  knowledgeMetrics: {
    precisionAt3: number;
    mrr: number;
    evalQueriesCount: number;
    crossTenantIsolated: boolean;
    parsers: Awaited<ReturnType<typeof parserCapabilityReport>>;
  };
  memoryMetrics: {
    integrityValid: boolean;
    totalItems: number;
    storeSha256: string;
    versioningVerified: boolean;
    ttlExpirationVerified: boolean;
    crossTenantIsolated: boolean;
  };
  securityMetrics: {
    auditChainValid: boolean;
    auditTotalRecords: number;
    identitySuitePassed: number;
    identitySuiteTotal: number;
    ssrfBlockedImds: boolean;
    ssrfBlockedPrivate: boolean;
    ssrfBlockedScheme: boolean;
  };
  baselineComparison: {
    lmV2Baseline: {
      checkpointSha256: string;
      totalParams: number;
      valPerplexity: number;
      top1Accuracy: number;
      top5Accuracy: number;
      thaiValPerplexity: number;
    } | null;
    target41mBaseline: {
      checkpointSha256: string;
      params: number;
      bestValLoss: number;
      stepsRecorded: number;
    } | null;
    currentLiveRuntime: {
      runtimeState: string;
      executionVerified: boolean;
      perplexity: number | null;
      nextTokenAccuracy: number | null;
      thaiPerplexity: number | null;
      englishPerplexity: number | null;
    };
  };
}

const EVAL_REPORT_PATH = path.resolve(process.cwd(), 'native_data', 'batch27_eval_report.json');

export function loadLatestBatch27EvalReport(): Batch27EvaluationReport | null {
  try {
    if (!fs.existsSync(EVAL_REPORT_PATH)) return null;
    return JSON.parse(fs.readFileSync(EVAL_REPORT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export async function runBatch27Evaluation(): Promise<Batch27EvaluationReport> {
  const runId = `b27_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const timestamp = new Date().toISOString();
  const checks: Batch27EvalCheck[] = [];

  // 1. Connectivity + Python bridge runtime + tokenizer + model inference eval
  const connectivity = await ConnectivityMonitor.getInstance().checkNow();
  const provider = NativeNeuralLMProvider.getInstance();
  let pythonEval: any = null;
  try {
    pythonEval = await provider.batch27Eval();
  } catch (err: any) {
    pythonEval = {
      status: 'FAILED',
      error: err?.message || String(err),
      runtime: {
        runtime_state: connectivity.runtimeState,
        execution_verified: false,
      },
      tokenizer: null,
      inference: { status: 'BLOCKED', reason: err?.message || 'Bridge error', metrics: null },
    };
  }

  checks.push({
    id: 'B27-RT-01',
    category: 'runtime',
    name: 'Native Runtime Lifecycle & Execution-Gated Readiness',
    status:
      connectivity.runtimeState === 'READY' && connectivity.executionVerified
        ? 'PASS'
        : connectivity.runtimeState === 'FAILED'
          ? 'FAIL'
          : 'BLOCKED',
    details:
      connectivity.runtimeState === 'READY' && connectivity.executionVerified
        ? `Runtime READY with executionVerified=true (${connectivity.cloudSourceUri || 'cloud'})`
        : `Runtime state=${connectivity.runtimeState}; executionVerified=${connectivity.executionVerified}; ${connectivity.reason}`,
    metrics: {
      runtimeState: connectivity.runtimeState,
      executionVerified: connectivity.executionVerified,
      weightsLoaded: connectivity.weightsLoaded,
      cloudStorageConfigured: connectivity.cloudStorageConfigured,
      latencyMs: connectivity.latencyMs,
    },
  });

  const tok = pythonEval?.tokenizer;
  const tokPassed = Boolean(tok && (tok.status === 'PASS' || tok.passed === true));
  const tokRoundtripPct = tok?.roundtrip_accuracy != null
    ? Number((Number(tok.roundtrip_accuracy) * 100).toFixed(2))
    : tok?.roundtrip_accuracy_pct;
  const tokUnkPct = tok?.unk_rate != null
    ? Number((Number(tok.unk_rate) * 100).toFixed(4))
    : tok?.unk_rate_pct;
  const tokTps = tok?.tokenizer_tok_per_sec ?? tok?.tokens_per_sec ?? 0;

  checks.push({
    id: 'B27-TOK-01',
    category: 'tokenizer',
    name: 'Thai/English/Mixed Tokenizer Roundtrip & Zero-UNK Check',
    status: tokPassed ? 'PASS' : tok ? 'FAIL' : 'BLOCKED',
    details: tok
      ? `roundtrip=${tokRoundtripPct}% unk_rate=${tokUnkPct}% throughput=${tokTps} tok/s`
      : 'Tokenizer evaluation unavailable',
    metrics: tok || null,
  });

  const inf = pythonEval?.inference;
  const infStatus: 'PASS' | 'FAIL' | 'BLOCKED' =
    inf?.status === 'PASS' || inf?.status === 'VERIFIED'
      ? 'PASS'
      : inf?.status === 'FAIL' || inf?.status === 'FAILED'
        ? 'FAIL'
        : 'BLOCKED';
  const infMetrics = inf?.metrics || null;
  checks.push({
    id: 'B27-INF-01',
    category: 'inference',
    name: 'Native Logit Forward Pass, NLL/PPL, TTFT, Throughput & Determinism',
    status: infStatus,
    details:
      infStatus === 'PASS' && infMetrics
        ? `PPL=${infMetrics.perplexity} acc=${infMetrics.next_token_accuracy != null ? (Number(infMetrics.next_token_accuracy) * 100).toFixed(1) : '—'}% TTFT=${infMetrics.first_token_latency_ms}ms tok/s=${infMetrics.tokens_per_sec} RSS=${infMetrics.rss_mb_after}MiB deterministic=${infMetrics.deterministic_greedy_parity}`
        : inf?.reason || 'Weight-dependent inference metrics blocked until runtime is READY',
    metrics: infMetrics,
  });

  const rsn = pythonEval?.reasoning_separation;
  const rsnPassed = Boolean(
    rsn &&
      (rsn.status === 'PASS' ||
        rsn.native_model_logits_proven === true ||
        rsn.inference_origin === 'native_model_logits')
  );
  checks.push({
    id: 'B27-RSN-01',
    category: 'reasoning',
    name: 'Reasoning Provenance Separation (Native Logits vs Orchestrator)',
    status:
      infStatus === 'PASS'
        ? rsnPassed
          ? 'PASS'
          : 'FAIL'
        : 'BLOCKED',
    details:
      infStatus === 'PASS'
        ? `chatOrigin=${rsn?.chat_inference_origin || rsn?.inference_origin} plannerOrigin=${rsn?.planner_inference_origin || 'orchestrator_structured'} symbolicArith=${rsn?.orchestrator_symbolic_verifier?.arithmetic_chain_verified} weightsRole=${rsn?.weights_role}`
        : 'Blocked until resident weights are READY',
    metrics: rsn || null,
  });

  // Uncertainty / Hallucination Abstention Check on Knowledge Hybrid Retrieval
  const unkQuery = `__nonexistent_quantum_flux_capacitor_${runId}__`;
  const abstainResp = KnowledgeIntelligenceEngine.getInstance().hybridRetrieve(unkQuery, {
    limit: 3,
    minScore: 1.5,
    tenantId: `__b27_eval_tenant_a_${runId}`,
    role: 'developer',
  });
  const abstentionClean = !abstainResp.found && abstainResp.results.length === 0;
  checks.push({
    id: 'B27-RSN-02',
    category: 'reasoning',
    name: 'Uncertainty & Hallucination Abstention (No Fabricated RAG Citations)',
    status: abstentionClean ? 'PASS' : 'FAIL',
    details: abstentionClean
      ? 'Unknown query yielded found=false with 0 fabricated citations'
      : `Unexpected grounding hits (${abstainResp.results.length}) returned for unknown probe`,
    metrics: { abstentionClean, unexpectedHits: abstainResp.results.length },
  });

  // 2. Knowledge Pipeline, RAG Precision@K / MRR & Cross-Tenant Isolation
  const kw = KnowledgeWorkspace.getInstance();
  const kie = KnowledgeIntelligenceEngine.getInstance();
  const evalTenantA = `__b27_eval_tenant_a_${runId}`;
  const evalTenantB = `__b27_eval_tenant_b_${runId}`;
  const parsers = await parserCapabilityReport();

  let precisionAt3 = 0;
  let mrr = 0;
  let ragQueries = 0;
  let knowledgeCrossTenantIsolated = false;
  const createdEvalDocIds: string[] = [];

  try {
    const d1 = kw.createDocument({
      title: 'Batch 27 Eval Ledger Specification',
      content: 'Sovereign ledger chains use SHA-256 cryptographic linking and strict monotonic block indices.',
      collection: `B27Eval_${runId}`,
      tags: ['b27eval', 'ledger'],
      provenance: 'Batch27 evaluation fixture',
      curatedForTraining: false,
      tenantId: evalTenantA,
    });
    const d2 = kw.createDocument({
      title: 'Batch 27 Eval Tokenizer Spec',
      content: 'Bilingual Thai and English tokenization guarantees lossless roundtrip across U+0E01 to U+0E5B.',
      collection: `B27Eval_${runId}`,
      tags: ['b27eval', 'tokenizer'],
      provenance: 'Batch27 evaluation fixture',
      curatedForTraining: false,
      tenantId: evalTenantA,
    });
    const d3 = kw.createDocument({
      title: 'Tenant B Confidential Spec',
      content: 'Tenant Beta secret protocol XYZ-991827 should never be retrieved by Tenant Alpha.',
      collection: `B27Eval_${runId}`,
      tags: ['b27eval', 'secret'],
      provenance: 'Batch27 cross-tenant isolation probe',
      curatedForTraining: false,
      tenantId: evalTenantB,
    });
    createdEvalDocIds.push(d1.id, d2.id, d3.id);

    const probes = [
      { query: 'cryptographic SHA-256 monotonic block indices', expectedDocId: d1.id, forbidden: ['XYZ-991827'] },
      { query: 'bilingual lossless roundtrip U+0E01 U+0E5B', expectedDocId: d2.id, forbidden: ['XYZ-991827'] },
    ];
    ragQueries = probes.length;
    let totalPrec = 0;
    let totalRr = 0;

    for (const p of probes) {
      const resp = kie.hybridRetrieve(p.query, {
        collection: `B27Eval_${runId}`,
        limit: 3,
        minScore: 1.0,
        tenantId: evalTenantA,
        role: 'developer',
        forbiddenTargetValues: p.forbidden,
      });
      const hitIdx = resp.results.findIndex((r) => r.documentId === p.expectedDocId);
      const relevantInTop3 = hitIdx >= 0 ? 1 : 0;
      totalPrec += relevantInTop3 / Math.max(1, Math.min(3, resp.results.length || 3));
      totalRr += hitIdx >= 0 ? 1 / (hitIdx + 1) : 0;
    }

    precisionAt3 = Number((totalPrec / probes.length).toFixed(3));
    mrr = Number((totalRr / probes.length).toFixed(3));

    // Negative isolation test: Tenant A queries Tenant B's secret keyword -> must get 0 hits
    const crossResp = kie.hybridRetrieve('Tenant Beta secret protocol XYZ-991827', {
      limit: 5,
      minScore: 0.5,
      tenantId: evalTenantA,
      role: 'admin',
    });
    const leaked = crossResp.results.some((r) => r.documentId === d3.id);
    let getBlocked = false;
    try {
      kw.getDocument(d3.id, { tenantId: evalTenantA, role: 'admin' });
    } catch {
      getBlocked = true;
    }
    knowledgeCrossTenantIsolated = !leaked && getBlocked;
  } finally {
    for (const id of createdEvalDocIds) {
      try {
        kw.deleteDocument(id);
      } catch {
        // best effort cleanup
      }
    }
  }

  checks.push({
    id: 'B27-RAG-01',
    category: 'knowledge',
    name: 'Knowledge Hybrid Retrieval Precision@3, MRR & Parser Honesty',
    status: precisionAt3 > 0 && mrr >= 0.5 ? 'PASS' : 'FAIL',
    details: `Precision@3=${precisionAt3} MRR=${mrr} queries=${ragQueries} pdf=${parsers.engines.pdf} docx=${parsers.engines.docx}`,
    metrics: { precisionAt3, mrr, ragQueries, parsers },
  });

  checks.push({
    id: 'B27-RAG-02',
    category: 'knowledge',
    name: 'Knowledge Workspace Cross-Tenant Isolation',
    status: knowledgeCrossTenantIsolated ? 'PASS' : 'FAIL',
    details: knowledgeCrossTenantIsolated
      ? 'Cross-tenant hybrid retrieval and getDocument strictly blocked'
      : 'Cross-tenant leak or unguarded read detected',
    metrics: { crossTenantIsolated: knowledgeCrossTenantIsolated },
  });

  // 3. Sovereign Memory Persistence, Versioning, TTL, Integrity & Isolation
  const memCtrl = NativeMemoryController.getInstance();
  const memKeyA = `__b27_mem_a_${runId}`;
  const memKeyTtl = `__b27_mem_ttl_${runId}`;
  let versioningVerified = false;
  let ttlExpirationVerified = false;
  let memCrossTenantIsolated = false;

  try {
    const v1 = memCtrl.storeMemory(
      memKeyA,
      { step: 1 },
      'reasoning_trace',
      undefined,
      { scope: { tenantId: evalTenantA, userId: 'u_a', role: 'developer' } }
    );
    const v2 = memCtrl.updateMemory(
      memKeyA,
      { step: 2 },
      'reasoning_trace',
      undefined,
      { scope: { tenantId: evalTenantA, userId: 'u_a', role: 'developer' } }
    );
    versioningVerified = v1.version === 1 && v2.version === 2 && (v2.history?.length || 0) >= 2;

    // Cross-tenant read must fail
    try {
      memCtrl.retrieveMemory(memKeyA, { tenantId: evalTenantB, userId: 'u_b', role: 'admin' });
    } catch {
      memCrossTenantIsolated = true;
    }

    // TTL expiration test: store an already-expired item (expiresAt in past via metadata/ttl)
    const expItem = memCtrl.storeMemory(
      memKeyTtl,
      { transient: true },
      'episodic',
      undefined,
      { scope: { tenantId: evalTenantA, userId: 'u_a', role: 'developer' }, ttlSeconds: 1 }
    );
    expItem.expiresAt = new Date(Date.now() - 2000).toISOString();
    const afterExpiry = memCtrl.retrieveMemory(memKeyTtl, { tenantId: evalTenantA, userId: 'u_a', role: 'developer' });
    ttlExpirationVerified = afterExpiry === null;
  } finally {
    try {
      memCtrl.deleteMemory(memKeyA);
    } catch { /* ignore */ }
    try {
      memCtrl.deleteMemory(memKeyTtl);
    } catch { /* ignore */ }
  }

  const memIntegrity = memCtrl.verifyStoreIntegrity();
  checks.push({
    id: 'B27-MEM-01',
    category: 'memory',
    name: 'Sovereign Memory Versioning, TTL Expiry, SHA-256 Integrity & Tenant Isolation',
    status: memIntegrity.valid && versioningVerified && ttlExpirationVerified && memCrossTenantIsolated ? 'PASS' : 'FAIL',
    details: `integrityValid=${memIntegrity.valid} versioning=${versioningVerified} ttl=${ttlExpirationVerified} isolated=${memCrossTenantIsolated}`,
    metrics: {
      integrityValid: memIntegrity.valid,
      totalItems: memIntegrity.totalItems,
      storeSha256: memIntegrity.storeSha256,
      versioningVerified,
      ttlExpirationVerified,
      crossTenantIsolated: memCrossTenantIsolated,
    },
  });

  // 4. Security & SSRF Hardening
  const auditIntegrity = AuditLedger.verifyIntegrity();
  const simResults = SovereignIdentity.getInstance().runSecuritySimulation();
  const simPassed = simResults.filter((r) => r.status === 'PASS').length;
  const ssrfBlockedImds = !validateCloudUrl('http://169.254.169.254/latest/meta-data/').ok;
  const ssrfBlockedPrivate = !validateCloudUrl('http://10.0.0.5/checkpoint.pt').ok;
  const ssrfBlockedScheme = !validateCloudUrl('file:///etc/passwd').ok;

  checks.push({
    id: 'B27-SEC-01',
    category: 'security',
    name: 'Audit Ledger Chain, Constant-Time Identity & SSRF Blocking',
    status:
      auditIntegrity.valid &&
      simPassed === simResults.length &&
      ssrfBlockedImds &&
      ssrfBlockedPrivate &&
      ssrfBlockedScheme
        ? 'PASS'
        : 'FAIL',
    details: `auditValid=${auditIntegrity.valid} (${auditIntegrity.totalRecords} recs) identity=${simPassed}/${simResults.length} ssrfImds=${ssrfBlockedImds}`,
    metrics: {
      auditChainValid: auditIntegrity.valid,
      auditTotalRecords: auditIntegrity.totalRecords,
      identitySuitePassed: simPassed,
      identitySuiteTotal: simResults.length,
      ssrfBlockedImds,
      ssrfBlockedPrivate,
      ssrfBlockedScheme,
    },
  });

  const passed = checks.filter((c) => c.status === 'PASS').length;
  const failed = checks.filter((c) => c.status === 'FAIL').length;
  const blocked = checks.filter((c) => c.status === 'BLOCKED').length;
  const overallStatus: Batch27EvaluationReport['status'] =
    failed > 0 ? 'FAILED' : blocked > 0 ? 'PARTIAL_BLOCKED' : 'VERIFIED';

  const readJsonIfExists = (relPath: string): any => {
    try {
      const abs = path.resolve(process.cwd(), relPath);
      if (!fs.existsSync(abs)) return null;
      return JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      return null;
    }
  };
  const v2Art = readJsonIfExists('artifacts/lm-v2-eval.json');
  const tgtArt = readJsonIfExists('artifacts/target-training-evidence.json');

  const report: Batch27EvaluationReport = {
    schema: 'ZYNTHEOR_BATCH27_EVAL_V1',
    runId,
    timestamp,
    status: overallStatus,
    provenance: {
      runtimeVersion: 'ZYNTHEOR-Batch27',
      datasetVersion: `KnowledgeCorpus@${timestamp.slice(0, 10)}`,
      checkpointSha256: connectivity.weightsLoaded
        ? (pythonEval?.runtime_verification?.checkpoint_sha256 || pythonEval?.provenance?.checkpoint_sha256 || null)
        : null,
      weightsSource: connectivity.cloudSourceUri,
      runtimeState: connectivity.runtimeState,
      executionVerified: connectivity.executionVerified,
      trainedProvenance: connectivity.trainedProvenance,
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
      total: checks.length,
    },
    checks,
    pythonEval,
    knowledgeMetrics: {
      precisionAt3,
      mrr,
      evalQueriesCount: ragQueries,
      crossTenantIsolated: knowledgeCrossTenantIsolated,
      parsers,
    },
    memoryMetrics: {
      integrityValid: memIntegrity.valid,
      totalItems: memIntegrity.totalItems,
      storeSha256: memIntegrity.storeSha256,
      versioningVerified,
      ttlExpirationVerified,
      crossTenantIsolated: memCrossTenantIsolated,
    },
    securityMetrics: {
      auditChainValid: auditIntegrity.valid,
      auditTotalRecords: auditIntegrity.totalRecords,
      identitySuitePassed: simPassed,
      identitySuiteTotal: simResults.length,
      ssrfBlockedImds,
      ssrfBlockedPrivate,
      ssrfBlockedScheme,
    },
    baselineComparison: {
      lmV2Baseline: v2Art
        ? {
            checkpointSha256: String(v2Art.checkpoint_sha256 || ''),
            totalParams: Number(v2Art.total_params || 0),
            valPerplexity: Number(v2Art.perplexity?.model ?? 0),
            top1Accuracy: Number(v2Art.accuracy?.top1 ?? 0),
            top5Accuracy: Number(v2Art.accuracy?.top5 ?? 0),
            thaiValPerplexity: Number(v2Art.thai_target_positions?.model_ppl ?? 0),
          }
        : null,
      target41mBaseline: tgtArt
        ? {
            checkpointSha256: String(tgtArt.checkpoint_sha256 || ''),
            params: Number(tgtArt.params || 0),
            bestValLoss: Number(tgtArt.best_val_loss ?? 0),
            stepsRecorded: Array.isArray(tgtArt.history) ? tgtArt.history.length : 0,
          }
        : null,
      currentLiveRuntime: {
        runtimeState: connectivity.runtimeState,
        executionVerified: connectivity.executionVerified,
        perplexity: infMetrics?.perplexity ?? null,
        nextTokenAccuracy: infMetrics?.next_token_accuracy ?? null,
        thaiPerplexity: infMetrics?.thai_metrics?.perplexity ?? null,
        englishPerplexity: infMetrics?.english_metrics?.perplexity ?? null,
      },
    },
  };

  fs.mkdirSync(path.dirname(EVAL_REPORT_PATH), { recursive: true });
  fs.writeFileSync(EVAL_REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  AuditLedger.append('SYSTEM', 'BATCH27_EVALUATION_EXECUTED', {
    runId,
    status: overallStatus,
    passed,
    failed,
    blocked,
    runtimeState: connectivity.runtimeState,
  });

  return report;
}
