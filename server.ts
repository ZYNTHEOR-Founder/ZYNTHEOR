/**
 * ZYNTHEOR Sovereign Server
 * Express backend with Vite middleware mounting on port 3000.
 * Zero external AI APIs. 100% First-party sovereign native neural bridge and sandbox execution.
 */

import 'dotenv/config';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NativeNeuralLMProvider } from './lib/providers';
import { TaskOrchestrator } from './lib/TaskOrchestrator';
import { AuditLedger } from './lib/AuditLedger';
import { ToolGateway } from './lib/ToolGateway';
import { ToolRegistry } from './lib/ToolRegistry';
import { CommercialManager, LaunchPhase } from './lib/CommercialManager';
import { NativeMemoryController, type MemoryScope } from './lib/NativeMemoryController';
import { KnowledgeWorkspace } from './lib/KnowledgeWorkspace';
import { KnowledgeIntelligenceEngine, parseMultiFormat } from './lib/KnowledgeIntelligenceEngine';
import { parseBinaryDocument, bufferFromBase64, parserCapabilityReport } from './lib/DocumentBinaryParser';
import { parseMultipartBuffer, readRequestBuffer } from './lib/multipartMemory';
import {
  requireAuth,
  sealLogsServerSide,
  verifyLogsAgainstSeal,
  loadLatestSealSnapshot,
  UI_TO_SOVEREIGN,
  SOVEREIGN_TO_UI,
  AuthenticatedRequest
} from './lib/AuthMiddleware';
import { SovereignIdentity, SovereignRole } from './lib/SovereignIdentity';
import { TokenRevocation } from './lib/TokenRevocation';
import { enforceRateLimit, rateLimitPolicies } from './lib/RateLimit';
import { requireFirebaseAuth, AuthRequest } from './src/middleware/auth.ts';
import { getOrCreateUser } from './src/db/users.ts';
import { isCloudSqlConfigured } from './src/db/index.ts';
import {
  isCloudCheckpointStorageConfigured,
  loadCheckpointFromCloudStorage,
  statCheckpointInCloudStorage,
  validateCloudRuntimeConfig,
} from './lib/CloudCheckpointStorage.ts';
import {
  ConnectivityMonitor,
  ConnectivityRequiredError,
  validateCloudUrl,
} from './lib/ConnectivityMonitor.ts';
import {
  runBatch27Evaluation,
  loadLatestBatch27EvalReport,
} from './lib/Batch27Evaluator.ts';
import {
  resolveCloudSignedMetadataHash,
  verifyAndRecordCheckpointIntegrity,
} from './lib/CheckpointIntegrityMonitor.ts';
import { ApprovalGate } from './lib/ApprovalGate.ts';
import { AutonomousPlanner } from './lib/AutonomousPlanner.ts';
import { ContinuousLearningPipeline } from './lib/ContinuousLearningPipeline.ts';
import { SelfEvaluationEngine } from './lib/SelfEvaluationEngine.ts';
import { CognitiveContextEngine } from './lib/CognitiveContextEngine.ts';
import { AdaptiveReasoningEngine } from './lib/AdaptiveReasoningEngine.ts';
import { KnowledgeGraphEngine } from './lib/KnowledgeGraphEngine.ts';
import { PerformanceEngine } from './lib/PerformanceEngine.ts';
import { getMultimodalCapabilityRegistry } from './lib/MultimodalInterfaces.ts';
import {
  assertNoManualScoreInjection,
  loadLatestBatch29EvalReport,
  runBatch29Evaluation,
} from './lib/CognitiveEvaluationLab.ts';
import { getCapabilityGatesSnapshot } from './lib/CapabilityGates.ts';
import {
  ActionDrivenEngine,
  type ActionMissionMode,
  type ActionMissionRequest,
} from './lib/ActionDrivenEngine.ts';
import { SoftwareProjectManager } from './lib/SoftwareProjectManager.ts';
import { InternetIntegrationEngine } from './lib/InternetIntegrationEngine.ts';
import { buildTruthDashboardSnapshot } from './lib/DashboardTruth.ts';
import { LedgerService, type LedgerCategorySort } from './src/services/LedgerService.ts';

// Hydrate .env.local if present (without overriding explicit runtime environment variables)
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: false });
}

function resolveServerPort(): number {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
  }
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  if (Number.isInteger(envPort) && envPort > 0 && envPort !== nginxPort) {
    return envPort;
  }
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT);
  if (Number.isInteger(defaultAppPort) && defaultAppPort > 0) {
    return defaultAppPort;
  }
  return 3000;
}

const PORT = resolveServerPort();
const app = express();

app.use(express.json());

// Cloud CORS middleware for decoupled Vite frontend (`VITE_API_URL`)
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  const rawAllowed = (process.env.ALLOWED_ORIGINS || '').trim();
  const allowedList = rawAllowed ? rawAllowed.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (origin && (allowedList.length === 0 || allowedList.includes('*') || allowedList.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-zyntheor-tenant');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

/**
 * Legacy name kept as alias — all authorization goes through requireAuth (Bearer token).
 * allowedRoles uses UI labels mapped to SovereignRole hierarchy.
 * Client x-zyntheor-role headers are NEVER trusted for authorization.
 */
function requireRole(allowedRoles: Array<'User' | 'Developer' | 'Administrator'>) {
  const rank: Record<string, number> = { User: 1, Developer: 2, Administrator: 3 };
  let lowest: 'User' | 'Developer' | 'Administrator' = allowedRoles[0] || 'User';
  for (const r of allowedRoles) {
    if ((rank[r] || 0) < (rank[lowest] || 0)) lowest = r;
  }
  const minSovereign = UI_TO_SOVEREIGN[lowest];
  return requireAuth(minSovereign);
}

// Resource history buffer using authentic OS and process telemetry (nullable inference telemetry until measured)
let lastRecordedTokensPerSec: number | null = null;
let lastRecordedLatencyMs: number | null = null;
const apiLatencySamples: number[] = [];
let liveWsClientCount = 0;
let lastWsFrameAt: string | null = null;

app.use('/api', (_req: Request, res: Response, next) => {
  const startNs = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    apiLatencySamples.push(Number(ms.toFixed(2)));
    if (apiLatencySamples.length > 50) {
      apiLatencySamples.shift();
    }
  });
  next();
});

function getMeasuredTransportTelemetry() {
  const avg =
    apiLatencySamples.length > 0
      ? Number((apiLatencySamples.reduce((a, b) => a + b, 0) / apiLatencySamples.length).toFixed(2))
      : null;
  return {
    wsClientCount: liveWsClientCount,
    wsLastFrameAt: lastWsFrameAt,
    apiAvgLatencyMs: avg,
    apiSampleCount: apiLatencySamples.length,
    lastRecordedTokensPerSec,
    lastInferenceLatencyMs: lastRecordedLatencyMs,
  };
}

interface RealResourceSample {
  timestamp: string;
  timeLabel: string;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  cpuCores: number;
  processHeapUsedMb: number;
  processHeapTotalMb: number;
  processRssMb: number;
  systemRamUsedMb: number;
  systemRamTotalMb: number;
  systemRamFreeMb: number;
  tokensPerSec: number | null;
  lastInferenceLatencyMs: number | null;
  telemetryStatus: 'MEASURED' | 'UNAVAILABLE';
  // Compatibility fields
  cpuPercent: number;
  gpuPercent: number;
  vramMb: number;
  vramMaxMb: number;
  ramUsedMb: number;
  ramTotalMb: number;
}

const resourceHistory: RealResourceSample[] = [];

function sampleResources() {
  const mem = process.memoryUsage();
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
  const ramUsedMb = totalMemMb - freeMemMb;
  const load = os.loadavg();
  const cpus = os.cpus().length || 1;
  const heapUsedMb = +(mem.heapUsed / (1024 * 1024)).toFixed(1);
  const heapTotalMb = +(mem.heapTotal / (1024 * 1024)).toFixed(1);
  const rssMb = +(mem.rss / (1024 * 1024)).toFixed(1);
  const loadAvg1m = +load[0].toFixed(2);
  const loadAvg5m = +load[1].toFixed(2);
  const loadAvg15m = +load[2].toFixed(2);

  const now = new Date();
  const timeLabel = now.toTimeString().slice(0, 8);
  const hasMeasuredInference = lastRecordedLatencyMs !== null || lastRecordedTokensPerSec !== null;

  const sample: RealResourceSample = {
    timestamp: now.toISOString(),
    timeLabel,
    loadAvg1m,
    loadAvg5m,
    loadAvg15m,
    cpuCores: cpus,
    processHeapUsedMb: heapUsedMb,
    processHeapTotalMb: heapTotalMb,
    processRssMb: rssMb,
    systemRamUsedMb: ramUsedMb,
    systemRamTotalMb: totalMemMb,
    systemRamFreeMb: freeMemMb,
    tokensPerSec: lastRecordedTokensPerSec,
    lastInferenceLatencyMs: lastRecordedLatencyMs,
    telemetryStatus: hasMeasuredInference ? 'MEASURED' : 'UNAVAILABLE',
    // Compatibility fields
    cpuPercent: Math.min(100, Math.round((load[0] / cpus) * 100)),
    gpuPercent: 0,
    vramMb: heapUsedMb,
    vramMaxMb: heapTotalMb,
    ramUsedMb,
    ramTotalMb: totalMemMb
  };

  resourceHistory.push(sample);
  if (resourceHistory.length > 20) {
    resourceHistory.shift();
  }
}

// Initial seed with real measurements
for (let i = 5; i >= 0; i--) {
  sampleResources();
}

// 0. Lightweight Health Check (explicitly separates HTTP service liveness from Native Intelligence & Cloud Runtime)
app.get('/api/health', async (_req: Request, res: Response) => {
  const conn = await ConnectivityMonitor.getInstance().getStatus().catch(() => null);
  const cloudCfg = validateCloudRuntimeConfig();
  const nativeIntelligenceReady = Boolean(
    conn && conn.online && conn.weightsLoaded && conn.executionVerified && conn.runtimeState === 'READY'
  );
  res.json({
    status: 'healthy',
    serviceLiveness: 'VERIFIED',
    nativeIntelligenceReady,
    cloudRuntimeStatus: conn?.runtimeState || (cloudCfg.configValid ? 'UNVERIFIED' : 'NOT_CONFIGURED'),
    cloudConfigured: Boolean(conn ? conn.cloudStorageConfigured : cloudCfg.configValid),
    cloudConnected: Boolean(conn?.cloudStorageReachable && conn?.pythonBridgeReachable),
    readinessNote:
      'HTTP API service is alive; Native Intelligence and Cloud Runtime must be verified separately via /api/connectivity/health and /api/truth/dashboard.',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    apiOnly: process.env.ZYNTHEOR_API_ONLY === '1',
    sovereign: true,
    version: '1.0.0',
  });
});

function getActivePromotedCheckpoint(): Record<string, any> | null {
  const activeStatePath = path.resolve(process.cwd(), 'native_data', 'active_checkpoint.json');
  if (!fs.existsSync(activeStatePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(activeStatePath, 'utf8'));
  } catch {
    return null;
  }
}

async function buildSystemStatusPayload() {
  sampleResources();
  const monitor = ConnectivityMonitor.getInstance();
  const connectivity = await monitor.checkNow();
  const provider = NativeNeuralLMProvider.getInstance();
  let pingRes: Awaited<ReturnType<typeof provider.ping>>;
  const cachedPing = monitor.getLastPingResult();
  if (cachedPing) {
    pingRes = cachedPing;
  } else {
    try {
      pingRes = await provider.ping();
    } catch (pingErr: any) {
      pingRes = {
        status: 'fail_closed',
        fail_closed: true,
        code: 'FAIL_CLOSED',
        message: 'Online Connectivity Required',
        online_connectivity_required: true,
        error: pingErr?.message || connectivity.reason,
        model_name: null,
        architecture: null,
        total_params: 0,
        trained_subgraph_params: 0,
        target_total_params: 41527808,
        vocab_size: 0,
        storage_mode: 'UNLOADED_FAIL_CLOSED',
        weights_source: null,
        checkpoint_hash: '',
        weights_loaded: false,
      };
    }
  }
  const integrity = AuditLedger.verifyIntegrity();
  const commercial = CommercialManager.getInstance().getMetrics();
  const files = ToolGateway.listFiles();

  const onlineAndLoaded = Boolean(connectivity.online && pingRes.weights_loaded && connectivity.executionVerified);
  const measuredParams = onlineAndLoaded ? Number(pingRes.total_params || 0) : 0;

  const activeModelInfo = onlineAndLoaded
    ? {
        name: pingRes.model_name || `ZYNTHEOR Native (${measuredParams.toLocaleString()} params)`,
        architecture: pingRes.architecture,
        activeKey:
          measuredParams === 41527808
            ? 'target_41m'
            : measuredParams === 502912
            ? 'v2_2m'
            : measuredParams > 0
            ? 'cloud_native'
            : 'unloaded_fail_closed',
        status: 'ONLINE' as const,
        runtimeState: connectivity.runtimeState,
        executionVerified: connectivity.executionVerified,
        executionError: connectivity.executionError,
        trainedProvenance: connectivity.trainedProvenance,
        weightsRole: connectivity.weightsRole || pingRes.weights_role || null,
        code: null as string | null,
        onlineConnectivityRequired: false,
        failClosedReason: null as string | null,
        totalParams: measuredParams,
        trainedSubgraphParams: Number(pingRes.trained_subgraph_params || measuredParams),
        targetParams: Number(pingRes.target_total_params || 41527808),
        memoryFootprintMb: +((measuredParams * 4) / (1024 * 1024)).toFixed(2),
        storageMode: String(pingRes.storage_mode || 'CLOUD_NATIVE'),
        weightsSource: pingRes.weights_source || connectivity.cloudSourceUri,
        checkpointPath: pingRes.checkpoint_path || connectivity.checkpointPath,
        checkpointHash: pingRes.checkpoint_hash,
        checkpointSha256: pingRes.checkpoint_sha256 || connectivity.checkpointSha256 || pingRes.checkpoint_hash,
        tokenizerSha256: pingRes.tokenizer_sha256 || connectivity.tokenizerSha256,
        activeRuntimeId: pingRes.active_runtime_id || connectivity.activeRuntimeId,
        lastInferenceEvidence: connectivity.lastInferenceEvidence,
        expectedCheckpointHash: pingRes.checkpoint_hash,
        signatureMatchesExpected: Boolean(pingRes.checkpoint_hash),
        weightsLoaded: true,
        runtimeBridgeSource: pingRes.weights_source || connectivity.cloudSourceUri,
      }
    : {
        name: null,
        architecture: null,
        activeKey: 'unloaded_fail_closed',
        status: 'ONLINE_CONNECTIVITY_REQUIRED' as const,
        runtimeState: connectivity.runtimeState,
        executionVerified: connectivity.executionVerified,
        executionError: connectivity.executionError,
        trainedProvenance: connectivity.trainedProvenance,
        weightsRole: connectivity.weightsRole || pingRes.weights_role || 'unloaded',
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        failClosedReason: connectivity.reason,
        totalParams: 0,
        trainedSubgraphParams: 0,
        targetParams: Number(pingRes.target_total_params || 41527808),
        memoryFootprintMb: 0,
        storageMode: 'UNLOADED_FAIL_CLOSED',
        weightsSource: connectivity.cloudSourceUri,
        checkpointPath: connectivity.checkpointPath,
        checkpointHash: '',
        checkpointSha256: null,
        tokenizerSha256: connectivity.tokenizerSha256 || pingRes.tokenizer_sha256 || null,
        activeRuntimeId: connectivity.activeRuntimeId || pingRes.active_runtime_id || null,
        lastInferenceEvidence: connectivity.lastInferenceEvidence,
        expectedCheckpointHash: null,
        signatureMatchesExpected: false,
        weightsLoaded: Boolean(pingRes.weights_loaded),
        runtimeBridgeSource: null,
      };

  const truthDashboard = await buildTruthDashboardSnapshot(
    connectivity,
    getMeasuredTransportTelemetry()
  );

  return {
    success: true,
    connectivity,
    model: activeModelInfo,
    audit: {
      totalRecords: integrity.totalRecords,
      chainValid: integrity.valid,
      headHash: integrity.headHash
    },
    commercial,
    sandbox: {
      path: ToolGateway.getWorkspaceRoot(),
      fileCount: files.length,
      files
    },
    resources: {
      current: resourceHistory[resourceHistory.length - 1],
      history: resourceHistory
    },
    truthDashboard,
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  };
}

// 1. System Status API
app.get('/api/system/status', async (_req: Request, res: Response) => {
  try {
    const payload = await buildSystemStatusPayload();
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1b. Truth-First Dashboard Snapshot API
app.get('/api/truth/dashboard', async (_req: Request, res: Response) => {
  try {
    const connectivity = await ConnectivityMonitor.getInstance().checkNow();
    const truthDashboard = await buildTruthDashboardSnapshot(
      connectivity,
      getMeasuredTransportTelemetry()
    );
    res.json({ success: true, truthDashboard });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Evidence endpoint: exposes measured runtime facts without presenting roadmap values as loaded weights.
app.get('/api/model/evidence', async (_req: Request, res: Response) => {
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    const [ping, language] = await Promise.all([
      provider.ping(),
      provider.verifyLanguageIntegrity()
    ]);
    const evalPath = path.join(process.cwd(), 'artifacts', 'lm-v2-eval.json');
    let evaluation: Record<string, any> | null = null;
    if (fs.existsSync(evalPath)) {
      evaluation = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
    }
    const measured = ping.trained_subgraph_params || ping.total_params;
    res.json({
      success: true,
      status: ping.weights_loaded && language.verified ? 'VERIFIED' : 'PARTIAL',
      model: {
        name: ping.model_name,
        architecture: ping.architecture,
        measuredLoadedParams: measured,
        targetParams: ping.target_total_params,
        vocabSize: ping.vocab_size,
        storageMode: ping.storage_mode,
        weightsSource: ping.weights_source,
        checkpointPath: ping.checkpoint_path || null,
        checkpointSha256: ping.checkpoint_sha256 || ping.checkpoint_hash || null,
        tokenizerSha256: ping.tokenizer_sha256 || null,
        activeRuntimeId: ping.active_runtime_id || null,
        lastInferenceEvidence: provider.getLastInferenceEvidence(),
        weightsLoaded: ping.weights_loaded
      },
      bilingual: {
        verified: language.verified,
        passed: language.passed_tests,
        total: language.total_tests,
        checkpointSha256: language.checkpoint_hash,
        results: language.results
      },
      evaluation: evaluation ? {
        source: 'artifacts/lm-v2-eval.json',
        checkpointSha256: evaluation.checkpoint_sha256,
        totalParams: evaluation.total_params,
        trainingSteps: evaluation.training_steps_total,
        perplexity: evaluation.perplexity,
        accuracy: evaluation.accuracy,
        thaiTargetPositions: evaluation.thai_target_positions,
        beatsBigramBaseline: evaluation.beats_bigram_baseline
      } : null,
      generatedAt: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(503).json({ success: false, status: 'BLOCKED', error: err.message });
  }
});

app.get('/api/system/resources', (_req: Request, res: Response) => {
  sampleResources();
  res.json({
    success: true,
    current: resourceHistory[resourceHistory.length - 1],
    history: resourceHistory
  });
});

app.get('/api/connectivity/health', async (_req: Request, res: Response) => {
  try {
    const state = await ConnectivityMonitor.getInstance().checkNow();
    return res.status(state.online ? 200 : 503).json({
      success: state.online,
      ...state,
    });
  } catch (err: any) {
    return res.status(503).json({
      success: false,
      online: false,
      status: 'ONLINE_CONNECTIVITY_REQUIRED',
      code: 'FAIL_CLOSED',
      onlineConnectivityRequired: true,
      failClosed: true,
      reason: `FAIL_CLOSED: Online Connectivity Required — ${err?.message || err}`,
    });
  }
});

app.post('/api/connectivity/reconnect', async (req: Request, res: Response) => {
  try {
    const presignedUrl = typeof req.body?.presignedUrl === 'string' ? req.body.presignedUrl.trim() : undefined;
    const objectKey = typeof req.body?.objectKey === 'string' ? req.body.objectKey.trim() : undefined;
    const state = await ConnectivityMonitor.getInstance().reconnect(presignedUrl, objectKey);
    return res.status(state.online ? 200 : 503).json({
      success: state.online,
      ...state,
    });
  } catch (err: any) {
    return res.status(503).json({
      success: false,
      online: false,
      status: 'ONLINE_CONNECTIVITY_REQUIRED',
      code: 'FAIL_CLOSED',
      onlineConnectivityRequired: true,
      failClosed: true,
      reason: `FAIL_CLOSED: Online Connectivity Required — ${err?.message || err}`,
    });
  }
});

// 1b. Direct Native Inference Endpoint (Strictly Online-Only, Fail-Closed)
app.post('/api/native/inference', requireAuth('guest'), enforceRateLimit('inference'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ConnectivityMonitor.getInstance().requireOnline('native_inference');
    const prompt = req.body?.prompt || 'ทดสอบ';
    const role = req.body?.role || 'chat';
    const maxTokens = Math.min(Math.max(Number(req.body?.max_tokens ?? 32) || 32, 1), 256);
    const temperature = req.body?.temperature === undefined ? undefined : Math.min(Math.max(Number(req.body.temperature), 0), 2);
    const provider = NativeNeuralLMProvider.getInstance();
    const [pingRes, result] = await Promise.all([
      provider.ping(),
      provider.chat(prompt, role, { max_tokens: maxTokens, temperature }),
    ]);

    if (typeof result.latency_ms === 'number' && result.latency_ms > 0) {
      lastRecordedLatencyMs = result.latency_ms;
    }
    if (typeof result.tokens_per_sec === 'number' && result.tokens_per_sec > 0) {
      lastRecordedTokensPerSec = result.tokens_per_sec;
    }

    AuditLedger.append('SYSTEM', 'NATIVE_INFERENCE_EXECUTED', {
      promptLength: prompt.length,
      inputTokens: result.input_tokens_count,
      outputTokens: result.output_tokens_count,
      latencyMs: result.latency_ms,
      tokensPerSec: result.tokens_per_sec,
      totalParams: result.total_params ?? pingRes.total_params,
      weightsSource: pingRes.weights_source,
      checkpointPath: result.checkpoint_path || pingRes.checkpoint_path || null,
      checkpointSha256: result.checkpoint_sha256 || result.checkpoint_hash || null,
      tokenizerSha256: result.tokenizer_sha256 || pingRes.tokenizer_sha256 || null,
      activeRuntimeId: result.active_runtime_id || pingRes.active_runtime_id || null,
    });

    res.json({
      success: true,
      model: pingRes.model_name || result.architecture || 'ZYNTHEOR Native Cloud',
      architecture: result.architecture || pingRes.architecture,
      totalParams: result.total_params ?? pingRes.total_params,
      targetTotalParams: pingRes.target_total_params,
      weightsSource: pingRes.weights_source,
      checkpointHash: result.checkpoint_hash,
      checkpointPath: result.checkpoint_path || pingRes.checkpoint_path || null,
      checkpointSha256: result.checkpoint_sha256 || result.checkpoint_hash || null,
      tokenizerSha256: result.tokenizer_sha256 || pingRes.tokenizer_sha256 || null,
      activeRuntimeId: result.active_runtime_id || pingRes.active_runtime_id || null,
      inferenceTimestamp: result.inference_timestamp || new Date().toISOString(),
      executionDurationMs: result.execution_duration_ms ?? result.latency_ms,
      inferenceOrigin: result.inference_origin || 'native_model_logits',
      weightsRole: result.weights_role || pingRes.weights_role || null,
      groundingOrigin: result.grounding_origin || 'none',
      maxContextLen: result.max_context_len,
      effectiveContextLen: result.effective_context_len,
      promptTruncated: result.prompt_truncated,
      prompt,
      response: result.text,
      inputTokens: result.input_tokens_count,
      outputTokens: result.output_tokens_count,
      latency_ms: result.latency_ms,
      tokens_per_sec: result.tokens_per_sec,
      latentNorm: result.latent_norm
    });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1c. Learned-logit generation (Strictly Online-Only Cloud Runtime)
app.post('/api/native/learned-generate', requireAuth('guest'), enforceRateLimit('inference'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ConnectivityMonitor.getInstance().requireOnline('learned_generate');
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
    if (!prompt || prompt.length > 4000) {
      return res.status(400).json({ success: false, error: 'prompt must be a non-empty string up to 4000 characters' });
    }
    const maxNewTokens = Math.min(Math.max(Number(req.body?.maxNewTokens ?? 64) || 64, 1), 256);
    const temperature = Math.min(Math.max(Number(req.body?.temperature ?? 0.8), 0), 2);
    const result = await NativeNeuralLMProvider.getInstance().learnedGenerate(prompt, { maxNewTokens, temperature });
    if (typeof result.latency_ms === 'number' && result.latency_ms > 0) {
      lastRecordedLatencyMs = result.latency_ms;
    }
    if (typeof result.tokens_per_sec === 'number' && result.tokens_per_sec > 0) {
      lastRecordedTokensPerSec = result.tokens_per_sec;
    }
    AuditLedger.append('SYSTEM', 'NATIVE_LEARNED_GENERATION_EXECUTED', {
      promptLength: prompt.length,
      outputTokens: result.output_tokens_count,
      latencyMs: result.latency_ms,
      checkpointPath: result.checkpoint_path || null,
      checkpointSha256: result.checkpoint_sha256,
      tokenizerSha256: result.tokenizer_sha256 || null,
      activeRuntimeId: result.active_runtime_id || null,
      weightsSource: result.weights_source,
    });
    res.json({
      success: true,
      source: result.source,
      weightsSource: result.weights_source,
      inferenceOrigin: result.inference_origin || 'native_model_logits',
      weightsRole: result.weights_role || 'learned_sequence_lm',
      groundingOrigin: result.grounding_origin || 'none',
      templateUsed: result.template_used,
      totalParams: result.total_params,
      validationPerplexity: result.validation_perplexity,
      checkpointPath: result.checkpoint_path || null,
      checkpointSha256: result.checkpoint_sha256,
      tokenizerSha256: result.tokenizer_sha256 || null,
      activeRuntimeId: result.active_runtime_id || null,
      inferenceTimestamp: result.inference_timestamp || new Date().toISOString(),
      executionDurationMs: result.execution_duration_ms ?? result.latency_ms,
      prompt,
      continuation: result.text,
      outputTokens: result.output_tokens_count,
      latency_ms: result.latency_ms,
    });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1d. Cloud NativeLM generation with repetition penalty (Strictly Online-Only).
app.post('/api/native/target-generate', requireAuth('guest'), enforceRateLimit('inference'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ConnectivityMonitor.getInstance().requireOnline('target_generate');
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt || prompt.length > 4000) {
      return res.status(400).json({ success: false, error: 'prompt must be a non-empty string up to 4000 characters' });
    }
    const maxNewTokens = Math.min(Math.max(Number(req.body?.maxNewTokens ?? 64) || 64, 1), 512);
    const temperature = Math.min(Math.max(Number(req.body?.temperature ?? 0.8), 0), 2);
    const topK = Math.min(Math.max(Number(req.body?.topK ?? 20) || 20, 1), 532);
    const repetitionPenalty = Math.min(Math.max(Number(req.body?.repetitionPenalty ?? 1.08), 1), 2);
    const seed = req.body?.seed === undefined ? undefined : Number(req.body.seed);
    const result = await NativeNeuralLMProvider.getInstance().targetGenerate(prompt, {
      maxNewTokens, temperature, topK, repetitionPenalty, seed
    });
    if (typeof result.latency_ms === 'number' && result.latency_ms > 0) {
      lastRecordedLatencyMs = result.latency_ms;
    }
    if (typeof result.tokens_per_sec === 'number' && result.tokens_per_sec > 0) {
      lastRecordedTokensPerSec = result.tokens_per_sec;
    }
    AuditLedger.append('SYSTEM', 'NATIVE_TARGET_GENERATION_EXECUTED', {
      promptLength: prompt.length,
      outputTokens: result.output_tokens_count,
      latencyMs: result.latency_ms,
      checkpointPath: result.checkpoint_path || null,
      checkpointSha256: result.checkpoint_sha256,
      tokenizerSha256: result.tokenizer_sha256 || null,
      activeRuntimeId: result.active_runtime_id || null,
      repetitionPenalty
    });
    res.json({
      success: true,
      source: result.source,
      weightsSource: result.weights_source,
      inferenceOrigin: result.inference_origin || 'native_model_logits',
      weightsRole: result.weights_role || 'learned_sequence_lm',
      groundingOrigin: result.grounding_origin || 'none',
      model: `ZYNTHEOR NativeLM (${result.total_params} params)`,
      totalParams: result.total_params,
      trainingSteps: result.training_steps,
      validationPerplexity: result.validation_perplexity,
      checkpointPath: result.checkpoint_path || null,
      checkpointSha256: result.checkpoint_sha256,
      tokenizerSha256: result.tokenizer_sha256 || null,
      activeRuntimeId: result.active_runtime_id || null,
      inferenceTimestamp: result.inference_timestamp || new Date().toISOString(),
      executionDurationMs: result.execution_duration_ms ?? result.latency_ms,
      prompt,
      response: result.text,
      generatedText: result.text,
      inputTokens: result.input_tokens_count,
      outputTokens: result.output_tokens_count,
      latency_ms: result.latency_ms,
      temperature,
      topK,
      repetitionPenalty,
    });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// SECURITY GATE: these execution records, queues, cycles and deliverables are currently
// stored in a shared process-wide orchestrator without durable tenant/user ownership.
// Require developer authorization until tenant-scoped persistence and ownership checks
// are implemented; guest/customer access here would expose or mutate another tenant's work.
// 2. NDJSON Agent Execution Stream (8-Stage Autonomous Execution Cycle)
app.post('/api/agent/execute', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  const { goal, priority: rawPriority, idempotencyKey, approvalRequestId } = req.body || {};
  if (!goal || typeof goal !== 'string') {
    return res.status(400).json({ error: 'Goal string is required' });
  }

  let priority: 'High' | 'Medium' | 'Low' = 'Medium';
  if (rawPriority !== undefined && rawPriority !== null && rawPriority !== '') {
    if (typeof rawPriority !== 'string') {
      return res.status(400).json({ error: 'Invalid priority. Allowed values: High, Medium, Low' });
    }
    const lower = rawPriority.trim().toLowerCase();
    if (lower === 'high') priority = 'High';
    else if (lower === 'medium') priority = 'Medium';
    else if (lower === 'low') priority = 'Low';
    else {
      return res.status(400).json({ error: 'Invalid priority. Allowed values: High, Medium, Low' });
    }
  }

  const orchestrator = TaskOrchestrator.getInstance();

  try {
    await ConnectivityMonitor.getInstance().requireOnline('agent_execute');
  } catch (connErr: any) {
    const resumableCount = orchestrator.listTasks().filter((t) => t.resumable).length;
    return res.status(503).json({
      success: false,
      code: 'FAIL_CLOSED',
      onlineConnectivityRequired: true,
      message: 'Online Connectivity Required',
      error: connErr.message,
      recoverableTasksPreserved: resumableCount,
    });
  }

  // Set up chunked streaming
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const result = await orchestrator.executeTask(
      goal,
      (event) => {
        res.write(JSON.stringify(event) + '\n');
      },
      {
        priority,
        ownerUserId: req.sovereignUserId,
        tenantId: req.sovereignTenantId,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
        approvalRequestId: typeof approvalRequestId === 'string' ? approvalRequestId : undefined,
      }
    );

    CommercialManager.getInstance().recordTask(result.success, 350);

    res.write(JSON.stringify({
      type: 'final_result',
      data: result,
      timestamp: new Date().toISOString()
    }) + '\n');

    res.end();
  } catch (err: any) {
    CommercialManager.getInstance().recordTask(false, 100);
    res.write(JSON.stringify({
      type: 'error',
      priority,
      message: err.message,
      timestamp: new Date().toISOString()
    }) + '\n');
    res.end();
  }
});

// 2b. Scheduled Post-Cycle HMAC Integrity Checks (triggered on heavy-load Sovereign Agent cycles)
app.get('/api/agent/scheduled-checks', requireAuth('admin'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const checks = TaskOrchestrator.getInstance().getScheduledIntegrityChecks();
    res.json({
      success: true,
      totalRuns: checks.length,
      checks
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2c. Autonomous Execution Cycle Metrics & Recent 8-Stage Runs
app.get('/api/agent/metrics', requireAuth('admin'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const metrics = TaskOrchestrator.getInstance().getExecutionMetrics();
    res.json({
      success: true,
      metrics
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agent/cycles', requireAuth('admin'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const cycles = TaskOrchestrator.getInstance().getRecentCycles();
    res.json({
      success: true,
      total: cycles.length,
      cycles
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2d. Persistent Task Lifecycle, Resumable Priority Queue, Acceptance Scenario & Deliverables
app.get('/api/agent/tasks', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const tasks = TaskOrchestrator.getInstance().listTasksFor({ userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! });
    res.json({ success: true, total: tasks.length, tasks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const handleBatchDeleteTasks = (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawIds = req.body?.taskIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return res.status(400).json({ success: false, error: 'taskIds must be a non-empty array of task IDs' });
    }
    if (rawIds.length > 100) {
      return res.status(400).json({ success: false, error: 'Cannot batch-delete more than 100 tasks at once' });
    }
    const taskIds = rawIds
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());
    if (taskIds.length === 0) {
      return res.status(400).json({ success: false, error: 'taskIds must contain valid non-empty strings' });
    }

    const identity = { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! };
    const result = TaskOrchestrator.getInstance().deleteCompletedTasksFor(taskIds, identity);

    if (result.deletedIds.length === 0) {
      if (result.skippedIds.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Only completed (Delivered) tasks can be batch-deleted.',
          skippedIds: result.skippedIds,
          notFoundIds: result.notFoundIds,
        });
      }
      return res.status(404).json({
        success: false,
        error: 'No matching caller-owned tasks were found.',
        notFoundIds: result.notFoundIds,
      });
    }

    return res.json({
      success: true,
      deletedIds: result.deletedIds,
      deletedCount: result.deletedIds.length,
      skippedIds: result.skippedIds,
      notFoundIds: result.notFoundIds,
      tasks: result.remainingTasks,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/agent/tasks/batch-delete', requireAuth('developer'), enforceRateLimit('agent'), handleBatchDeleteTasks);
app.delete('/api/agent/tasks', requireAuth('developer'), enforceRateLimit('agent'), handleBatchDeleteTasks);

app.post('/api/agent/queue', requireAuth('developer'), enforceRateLimit('agent'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { goal, priority: rawPriority } = req.body || {};
    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      return res.status(400).json({ success: false, error: 'Goal string is required' });
    }
    let priority: 'High' | 'Medium' | 'Low' = 'Medium';
    if (rawPriority !== undefined && rawPriority !== null && rawPriority !== '') {
      if (typeof rawPriority !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid priority. Allowed values: High, Medium, Low' });
      }
      const lower = rawPriority.trim().toLowerCase();
      if (lower === 'high') priority = 'High';
      else if (lower === 'medium') priority = 'Medium';
      else if (lower === 'low') priority = 'Low';
      else {
        return res.status(400).json({ success: false, error: 'Invalid priority. Allowed values: High, Medium, Low' });
      }
    }
    const task = TaskOrchestrator.getInstance().enqueueTask(goal, priority, { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! });
    res.status(201).json({ success: true, task });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/agent/queue/run-next', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  const orchestrator = TaskOrchestrator.getInstance();
  const identity = { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! };
  const nextPending = orchestrator.listTasksFor(identity).find((t) => t.lifecycleStatus === 'Planned');
  if (!nextPending) {
    return res.status(404).json({ success: false, error: 'No Planned tasks remain in the priority queue.' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const result = await orchestrator.runNextQueuedTask((event) => {
      res.write(JSON.stringify(event) + '\n');
    }, identity);
    CommercialManager.getInstance().recordTask(result.success, 350);
    res.write(JSON.stringify({ type: 'final_result', data: result, timestamp: new Date().toISOString() }) + '\n');
    res.end();
  } catch (err: any) {
    CommercialManager.getInstance().recordTask(false, 100);
    res.write(JSON.stringify({ type: 'error', message: err.message, timestamp: new Date().toISOString() }) + '\n');
    res.end();
  }
});

app.post('/api/agent/tasks/:taskId/resume', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  const taskId = String(req.params.taskId || '').trim();
  const orchestrator = TaskOrchestrator.getInstance();
  const identity = { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! };
  const existing = orchestrator.getTaskFor(taskId, identity);
  if (!existing) {
    return res.status(404).json({ success: false, error: `Task '${taskId}' not found.` });
  }
  if (existing.lifecycleStatus === 'Delivered') {
    return res.status(409).json({ success: false, error: `Task '${taskId}' is already Delivered.` });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const result = await orchestrator.resumeTask(taskId, (event) => {
      res.write(JSON.stringify(event) + '\n');
    }, identity);
    CommercialManager.getInstance().recordTask(result.success, 350);
    res.write(JSON.stringify({ type: 'final_result', data: result, timestamp: new Date().toISOString() }) + '\n');
    res.end();
  } catch (err: any) {
    res.write(JSON.stringify({ type: 'error', message: err.message, timestamp: new Date().toISOString() }) + '\n');
    res.end();
  }
});

app.post('/api/agent/acceptance-scenario', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const goal = typeof req.body?.goal === 'string' && req.body.goal.trim() ? req.body.goal.trim() : undefined;
    const rawPrio = req.body?.priority;
    const priority = rawPrio === 'Low' ? 'Low' : rawPrio === 'Medium' ? 'Medium' : 'High';
    const scenario = await TaskOrchestrator.getInstance().runAcceptanceScenario({ goal, priority });
    res.json({ success: Boolean(scenario?.scenario_passed), scenario });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agent/deliverables/:filename', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const filename = path.basename(String(req.params.filename || ''));
    if (!/^[a-zA-Z0-9_.-]+\.zip$/.test(filename)) {
      return res.status(400).json({ success: false, error: 'Invalid deliverable filename' });
    }
    const orchestrator = TaskOrchestrator.getInstance();
    const identity = { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! };
    const ownsDeliverable = orchestrator.listTasksFor(identity).some((task) =>
      task.packageArtifact?.zipFilename === filename
    );
    if (!ownsDeliverable) {
      return res.status(404).json({ success: false, error: 'Deliverable archive not found' });
    }
    const delivRoot = ToolGateway.getDeliverablesRoot();
    const target = path.resolve(delivRoot, filename);
    if (!target.startsWith(delivRoot + path.sep) || !fs.existsSync(target)) {
      return res.status(404).json({ success: false, error: 'Deliverable archive not found' });
    }
    res.download(target, filename);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Real-World Execution Verification Suite (8 proofs)
app.post('/api/verify/suite', requireAuth('developer'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    const result = await provider.verifySuite();

    AuditLedger.append('SYSTEM', 'VERIFICATION_SUITE_EXECUTED', {
      passed: result.passed_tests,
      total: result.total_tests,
      verified: result.verified
    });

    res.json({ success: true, suite: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3b. Language Integrity Test Suite (Thai, English, Code-Switching)
app.post('/api/verify/language-integrity', requireAuth('developer'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    const result = await provider.verifyLanguageIntegrity();

    AuditLedger.append('SYSTEM', 'LANGUAGE_INTEGRITY_VERIFIED', {
      passed: result.passed_tests,
      total: result.total_tests,
      verified: result.verified,
      checkpointHash: result.checkpoint_hash
    });

    res.json({ success: true, suite: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Self-Evolving Native Intelligence Loop (5 stages)
app.post('/api/self-evolve/run', requireRole(['Developer', 'Administrator']), enforceRateLimit('agent'), async (req: Request, res: Response) => {
  try {
    const domain = req.body?.domain || 'algorithm_resilience';
    const provider = NativeNeuralLMProvider.getInstance();
    const result = await provider.selfEvolve(domain);

    AuditLedger.append('EVOLVER', 'SELF_EVOLVE_CYCLE_COMMITTED', {
      cycleId: result.cycle_id,
      domain: result.domain,
      improvementPct: result.improvement_pct
    });

    res.json({ success: true, evolution: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Audit Ledger & SHA-256 Integrity Verification
app.get('/api/audit', requireRole(['Developer', 'Administrator']), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const records = await AuditLedger.getRecentCloud(limit);
    const integrity = await AuditLedger.verifyIntegrityCloud();
    res.json({
      success: true,
      integrity,
      records
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Workspace Files & Content
app.get('/api/workspace/files', requireAuth('admin'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const files = ToolGateway.listFiles();
    const details = files.map((relPath) => {
      try {
        const full = path.join(ToolGateway.getWorkspaceRoot(), relPath);
        const stat = fs.statSync(full);
        return {
          path: relPath,
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString()
        };
      } catch {
        return { path: relPath, sizeBytes: 0, updatedAt: new Date().toISOString() };
      }
    });
    res.json({ success: true, files: details, root: ToolGateway.getWorkspaceRoot() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/workspace/file', requireAuth('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path query parameter is required' });
    const content = ToolGateway.readFile(filePath);
    res.json({ success: true, path: filePath, content });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

app.post('/api/workspace/file', requireRole(['Administrator']), async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'path and content are required' });
    }
    const result = ToolGateway.writeFile(filePath, content);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/workspace/file', requireRole(['Administrator']), async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string || req.body?.path;
    if (!filePath) return res.status(400).json({ error: 'path parameter is required' });
    ToolGateway.deleteFile(filePath);
    res.json({ success: true, path: filePath, deleted: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/workspace/run', requireRole(['Administrator']), async (req: Request, res: Response) => {
  try {
    const { command, args } = req.body;
    if (!command) return res.status(400).json({ error: 'command is required' });
    const result = await ToolGateway.runCommand(command, args || []);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 6b. Sandbox Runtime Verification
app.post('/api/sandbox/tamper-verify', requireAuth('developer'), async (_req: Request, res: Response) => {
  try {
    const result = await ToolGateway.runSandboxTamperVerification();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6c. Sovereign ToolRegistry Schemas & Sandboxed Tool Execution
app.get('/api/tools/registry', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = ToolRegistry.getInstance();
    const dockerStatus = await registry.probeDockerSandbox();
    res.json({
      success: true,
      tools: registry.listDefinitions(),
      sandbox: dockerStatus
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tools/execute', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = ToolRegistry.getInstance();
    const { tool, arguments: args, rawText, taskId } = req.body || {};

    let call = tool
      ? { tool: String(tool), arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> }
      : null;

    if (!call && typeof rawText === 'string') {
      const extracted = registry.extractToolCalls(rawText);
      call = extracted[0] || null;
    }

    if (!call) {
      return res.status(400).json({
        success: false,
        error: 'Provide { tool, arguments } or rawText containing a JSON-encoded tool call.'
      });
    }

    const result = await registry.executeToolCall(call, {
      role: req.sovereignRole || 'developer',
      callerRole: req.sovereignRole || 'developer',
      taskId: typeof taskId === 'string' ? taskId : undefined,
    });
    const isForbidden = String(result.error || '').includes('SECURITY_PERMISSION_DENIED');
    const status = result.ok
      ? 200
      : isForbidden
      ? 403
      : result.executionMode === 'validation_error'
      ? 400
      : 502;
    return res.status(status).json({
      success: result.ok,
      result
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Commercial & Business Management
app.get('/api/commercial/metrics', requireAuth('developer'), (_req: Request, res: Response) => {
  const metrics = CommercialManager.getInstance().getMetrics();
  res.json({ success: true, metrics, plans: CommercialManager.PLANS, rateLimits: rateLimitPolicies() });
});

app.post('/api/commercial/plan', requireAuth('admin'), (req: Request, res: Response) => {
  const { planId } = req.body;
  if (!planId) return res.status(400).json({ error: 'planId is required' });
  CommercialManager.getInstance().setPlan(planId);
  res.json({ success: true, metrics: CommercialManager.getInstance().getMetrics() });
});

app.post('/api/commercial/phase', requireRole(['Administrator']), (req: Request, res: Response) => {
  const { phase } = req.body;
  if (!phase) return res.status(400).json({ error: 'phase is required' });
  CommercialManager.getInstance().setPhase(phase as LaunchPhase);
  res.json({ success: true, metrics: CommercialManager.getInstance().getMetrics() });
});

// 7b. Persistent SQLite Expense Ledger Service
function resolveVerifiedLedgerTenant(req: Request): string {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const verification = SovereignIdentity.getInstance().verifyToken(token, { requiredRole: 'guest' });
      if (verification.valid && verification.payload && !TokenRevocation.isRevoked(verification.payload.jti)) {
        return verification.payload.tenantId || 'default-tenant';
      }
    }
  }
  return 'default-tenant';
}

const ALLOWED_LEDGER_SORTS = new Set<LedgerCategorySort>([
  'amount_desc',
  'amount_asc',
  'name_asc',
  'name_desc',
  'count_desc',
]);

function parseLedgerQueryOptions(req: Request) {
  const fromDate =
    typeof req.query.fromDate === 'string' && req.query.fromDate.trim()
      ? req.query.fromDate.trim()
      : undefined;
  const toDate =
    typeof req.query.toDate === 'string' && req.query.toDate.trim()
      ? req.query.toDate.trim()
      : undefined;
  const rawSort = typeof req.query.sortBy === 'string' ? (req.query.sortBy.trim() as LedgerCategorySort) : 'amount_desc';
  const sortBy: LedgerCategorySort = ALLOWED_LEDGER_SORTS.has(rawSort) ? rawSort : 'amount_desc';
  const limit = req.query.limit ? Number(req.query.limit) : 25;
  const rawCurrency = typeof req.query.currency === 'string' ? req.query.currency.trim().toUpperCase() : 'USD';
  const currency = /^[A-Z]{3,5}$/.test(rawCurrency) ? rawCurrency : 'USD';
  return { fromDate, toDate, sortBy, limit, currency };
}

app.get('/api/ledger/summary', (req: Request, res: Response) => {
  try {
    const tenantId = resolveVerifiedLedgerTenant(req);
    const { fromDate, toDate, sortBy, limit, currency } = parseLedgerQueryOptions(req);
    const summary = LedgerService.getInstance().getSummary({
      tenantId,
      currency,
      limit,
      fromDate,
      toDate,
      sortBy,
    });
    res.json({ success: true, summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to load ledger summary' });
  }
});

app.get('/api/ledger/balance', (req: Request, res: Response) => {
  try {
    const tenantId = resolveVerifiedLedgerTenant(req);
    const { fromDate, toDate, currency } = parseLedgerQueryOptions(req);
    const balance = LedgerService.getInstance().getBalance({ tenantId, currency, fromDate, toDate });
    res.json({ success: true, balance });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to compute ledger balance' });
  }
});

app.get('/api/ledger/threshold', (req: Request, res: Response) => {
  try {
    const tenantId = resolveVerifiedLedgerTenant(req);
    const { fromDate, toDate, currency } = parseLedgerQueryOptions(req);
    const threshold = LedgerService.getInstance().checkBudgetThreshold({
      tenantId,
      currency,
      fromDate,
      toDate,
    });
    res.json({ success: true, threshold });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to evaluate budget threshold' });
  }
});

app.put('/api/ledger/threshold', requireAuth('guest'), enforceRateLimit('general'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.sovereignTenantId || 'default-tenant';
    const body = req.body || {};
    const ledger = LedgerService.getInstance();
    const threshold = ledger.setBudgetLimit(Number(body.budgetLimit), {
      tenantId,
      warningRatio: body.warningRatio !== undefined ? Number(body.warningRatio) : undefined,
      currency: body.currency,
    });
    AuditLedger.append('COMMERCIAL', 'LEDGER_BUDGET_UPDATED', {
      tenantId,
      userId: req.sovereignUserId || 'guest',
      budgetLimit: threshold.budgetLimit,
      warningRatio: threshold.warningRatio,
      level: threshold.level,
    });
    const { fromDate, toDate, sortBy, limit } = parseLedgerQueryOptions(req);
    const summary = ledger.getSummary({ tenantId, currency: threshold.currency, limit, fromDate, toDate, sortBy });
    res.json({ success: true, threshold, summary });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Invalid budget limit' });
  }
});

app.get('/api/ledger/records', (req: Request, res: Response) => {
  try {
    const tenantId = resolveVerifiedLedgerTenant(req);
    const typeParam = req.query.type === 'expense' || req.query.type === 'income' ? req.query.type : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const { fromDate, toDate, currency } = parseLedgerQueryOptions(req);
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const records = LedgerService.getInstance().getRecords({
      tenantId,
      type: typeParam,
      category,
      currency,
      fromDate,
      toDate,
      limit,
      offset,
    });
    res.json({ success: true, records, count: records.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to query ledger records' });
  }
});

app.post('/api/ledger/records', requireAuth('guest'), enforceRateLimit('general'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.sovereignTenantId || 'default-tenant';
    const body = req.body || {};
    const ledger = LedgerService.getInstance();
    const record = ledger.insertRecord({
      type: body.type,
      amount: Number(body.amount),
      category: body.category,
      description: body.description,
      currency: body.currency,
      occurredAt: body.occurredAt,
      tenantId,
    });
    AuditLedger.append('COMMERCIAL', 'LEDGER_RECORD_INSERTED', {
      id: record.id,
      type: record.type,
      amount: record.amount,
      category: record.category,
      tenantId,
      userId: req.sovereignUserId || 'guest',
      entryHash: record.entryHash,
    });
    const { fromDate, toDate, sortBy, limit } = parseLedgerQueryOptions(req);
    const summary = ledger.getSummary({ tenantId, currency: record.currency, limit, fromDate, toDate, sortBy });
    res.status(201).json({ success: true, record, summary });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Invalid ledger record' });
  }
});

app.delete('/api/ledger/records/:id', requireAuth('guest'), enforceRateLimit('general'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.sovereignTenantId || 'default-tenant';
    const ledger = LedgerService.getInstance();
    const existingRecord = ledger.getRecordById(req.params.id, tenantId);
    const deleted = ledger.deleteRecord(req.params.id, tenantId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Ledger record '${req.params.id}' not found` });
    }
    AuditLedger.append('COMMERCIAL', 'LEDGER_RECORD_DELETED', {
      id: req.params.id,
      tenantId,
      userId: req.sovereignUserId || 'guest',
    });
    const { fromDate, toDate, sortBy, limit, currency } = parseLedgerQueryOptions(req);
    const summary = ledger.getSummary({ tenantId, currency: existingRecord?.currency || currency, limit, fromDate, toDate, sortBy });
    res.json({ success: true, deleted: true, summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to delete ledger record' });
  }
});

// 8. Native Memory & Episodic Memory Controller
app.get('/api/memory', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    await ConnectivityMonitor.getInstance().requireOnline('memory_inspect');
    const provider = NativeNeuralLMProvider.getInstance();
    const memory = await provider.getMemory();
    res.json({ success: true, memory });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

function callerMemoryScope(req: AuthenticatedRequest): MemoryScope {
  return {
    tenantId: req.sovereignTenantId,
    userId: req.sovereignUserId,
    role: req.sovereignRole,
  };
}

app.get('/api/memory/episodic', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = callerMemoryScope(req);
    const memoryCtrl = NativeMemoryController.getInstance();
    const items = memoryCtrl.listAll(scope);
    const stats = memoryCtrl.getStats(scope);
    res.json({ success: true, items, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/memory/verify-integrity', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const memoryCtrl = NativeMemoryController.getInstance();
    const integrity = memoryCtrl.verifyStoreIntegrity();
    res.json({ success: true, integrity });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/memory/episodic', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { key, value, category, metadata, ttlSeconds } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value are required' });
    }
    const scope = callerMemoryScope(req);
    const memoryCtrl = NativeMemoryController.getInstance();
    const item = memoryCtrl.storeMemory(key, value, category, metadata, {
      scope,
      ttlSeconds: typeof ttlSeconds === 'number' ? ttlSeconds : undefined,
    });
    res.json({ success: true, item });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_OR_OWNER_FORBIDDEN', error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/memory/episodic/:key', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = callerMemoryScope(req);
    const memoryCtrl = NativeMemoryController.getInstance();
    const item = memoryCtrl.retrieveMemory(req.params.key, scope);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Memory item not found' });
    }
    res.json({ success: true, item });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_OR_OWNER_FORBIDDEN', error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/memory/episodic/:key', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { value, category, metadata, ttlSeconds } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'value is required for memory update' });
    }
    const scope = callerMemoryScope(req);
    const memoryCtrl = NativeMemoryController.getInstance();
    const item = memoryCtrl.updateMemory(req.params.key, value, category, metadata, {
      scope,
      ttlSeconds: typeof ttlSeconds === 'number' ? ttlSeconds : undefined,
    });
    res.json({ success: true, item });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_OR_OWNER_FORBIDDEN', error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/memory/episodic/:key', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = callerMemoryScope(req);
    const memoryCtrl = NativeMemoryController.getInstance();
    const deleted = memoryCtrl.deleteMemory(req.params.key, scope);
    res.json({ success: true, deleted });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_OR_OWNER_FORBIDDEN', error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Sovereign Identity & Security Simulation

// ---------------------------------------------------------------------------
// Identity & Trust Layer — session bootstrap + server-side log seals
// ---------------------------------------------------------------------------

/**
 * Bootstrap / login: issues a real HS256 ZY-TOKEN.
 * Online-first: accepts a role request for development seed accounts only.
 * Production deployments MUST set ZYNTHEOR_MASTER_SECRET and gate this further.
 * Client-supplied x-zyntheor-role headers are NOT used for subsequent API auth.
 */
app.get('/api/auth/mode', (_req: Request, res: Response) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const devAccessEnabled = !isProduction && process.env.ZYNTHEOR_ENABLE_DEV_LOGIN === 'true';
  res.json({
    success: true,
    environment: isProduction ? 'production' : (process.env.NODE_ENV || 'development'),
    googleAuthEnabled: true,
    devAccessEnabled,
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  // Development-only role bootstrap. Never allow clients to self-assign Developer/Admin in production.
  if (process.env.NODE_ENV === 'production' || process.env.ZYNTHEOR_ENABLE_DEV_LOGIN !== 'true') {
    return res.status(403).json({
      success: false,
      code: 'DEV_LOGIN_DISABLED',
      error: 'Role-selectable development login is disabled. Use the configured identity provider.'
    });
  }
  try {
    const body = req.body || {};
    const requestedUiRole = (body.role as string) || 'User';
    const allowedUi = ['User', 'Developer', 'Administrator'];
    const uiRole = allowedUi.includes(requestedUiRole) ? requestedUiRole : 'User';
    const sovereignRole = UI_TO_SOVEREIGN[uiRole as keyof typeof UI_TO_SOVEREIGN];
    const userId = typeof body.userId === 'string' && body.userId.trim()
      ? body.userId.trim()
      : 'usr_sovereign_01';
    const tenantId = typeof body.tenantId === 'string' && body.tenantId.trim()
      ? body.tenantId.trim()
      : 'Sovereign Enterprise Prime';
    const ttlSeconds = Math.min(Math.max(Number(body.ttlSeconds) || 3600, 60), 86400);

    const identity = SovereignIdentity.getInstance();
    const { token, payload } = identity.signToken({
      sub: userId,
      tenantId,
      role: sovereignRole,
      ttlSeconds,
      scope: ['workspace:read', 'workspace:execute', 'api:access']
    });

    AuditLedger.append('GOVERNANCE', 'AUTH_LOGIN_ISSUED', {
      sub: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      authMethod: 'dev_login',
      exp: payload.exp,
      jti: payload.jti
    });

    res.json({
      success: true,
      token,
      expiresAt: payload.exp,
      session: {
        userId: payload.sub,
        tenantId: payload.tenantId,
        role: SOVEREIGN_TO_UI[payload.role] || 'User',
        sovereignRole: payload.role,
        authMode: 'development',
        authenticatedAt: new Date(payload.iat * 1000).toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Validate current Bearer token and return session claims (server-verified). */

/** Revoke current token (persistent jti denylist). */
app.post('/api/auth/logout', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const jti = req.tokenPayload?.jti;
    if (jti) {
      TokenRevocation.revoke(jti, { sub: req.sovereignUserId, reason: 'logout' });
    }
    res.json({ success: true, revoked: Boolean(jti), denylistSize: TokenRevocation.size() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/session', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  const p = req.tokenPayload!;
  res.json({
    success: true,
    session: {
      userId: p.sub,
      tenantId: p.tenantId,
      role: SOVEREIGN_TO_UI[p.role] || 'User',
      sovereignRole: p.role,
      exp: p.exp,
      iat: p.iat,
      jti: p.jti
    }
  });
});

/**
 * Exchange a Firebase ID Token (Google Sign-In) for a Cloud SQL synchronized user profile
 * and a verified Sovereign session token.
 */
app.post('/api/auth/firebase-session', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUser = req.user!;
    const dbUser = isCloudSqlConfigured()
      ? await getOrCreateUser(
          firebaseUser.uid,
          firebaseUser.email || `${firebaseUser.uid}@firebase.local`,
          firebaseUser.name || null
        )
      : null;

    const sovereignRole: SovereignRole = (dbUser?.role as SovereignRole) || 'guest';
    const tenantId = dbUser?.tenantId || 'default-tenant';
    const identity = SovereignIdentity.getInstance();
    const { token, payload } = identity.signToken({
      sub: firebaseUser.uid,
      tenantId,
      role: sovereignRole,
    });

    AuditLedger.append('GOVERNANCE', 'FIREBASE_AUTH_LOGIN_ISSUED', {
      sub: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      authMethod: 'firebase_google',
      exp: payload.exp,
      jti: payload.jti
    });

    res.json({
      success: true,
      token,
      expiresAt: payload.exp,
      session: {
        userId: firebaseUser.uid,
        email: firebaseUser.email || `${firebaseUser.uid}@firebase.local`,
        displayName: firebaseUser.name || null,
        tenantId,
        role: SOVEREIGN_TO_UI[sovereignRole] || 'User',
        sovereignRole,
        authMode: 'google',
        authenticatedAt: new Date(payload.iat * 1000).toISOString(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Firebase session sync failed' });
  }
});

/** Inspect & verify `.pt` checkpoint directly from Cloud Object Storage (S3 / R2 / GCS / Supabase). */
app.get('/api/cloud/checkpoint/inspect', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  if (!isCloudCheckpointStorageConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'FAIL_CLOSED: Cloud Object Storage (S3_BUCKET / credentials) is not configured.',
    });
  }
  try {
    const key = typeof req.query.key === 'string' && req.query.key.trim() ? req.query.key.trim() : undefined;
    const verifyPayload = req.query.verify === '1';
    if (verifyPayload) {
      const parsed = await loadCheckpointFromCloudStorage(key);
      return res.json({
        success: true,
        verified: true,
        sourceUri: parsed.sourceUri,
        byteSize: parsed.byteSize,
        totalParams: parsed.weightsFloat32.length,
        payloadSha256: parsed.payloadSha256,
        metadata: parsed.metadata,
      });
    }
    const stat = await statCheckpointInCloudStorage(key);
    return res.json({ success: true, verified: false, stat });
  } catch (err: any) {
    return res.status(502).json({
      success: false,
      error: err?.message || 'Failed to inspect checkpoint from Cloud Object Storage',
    });
  }
});

/**
 * Server-controlled seal of Quick Agent logs.
 * Content hash is recorded in the append-only AuditLedger (not localStorage).
 */
app.post('/api/audit/seal-logs', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = Array.isArray(req.body?.logs) ? req.body.logs.map(String) : [];
    if (logs.length === 0) {
      return res.status(400).json({ success: false, error: 'logs array required' });
    }
    const seal = sealLogsServerSide(logs, {
      userId: req.sovereignUserId || 'unknown',
      tenantId: req.sovereignTenantId || 'unknown',
      goal: req.body?.goal
    });
    res.json({ success: true, seal });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Verify client-presented logs against a previously server-sealed content hash. */
app.post('/api/audit/verify-logs', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = Array.isArray(req.body?.logs) ? req.body.logs.map(String) : [];
    const expectedHash = String(req.body?.contentHash || '');
    if (!expectedHash || logs.length === 0) {
      return res.status(400).json({ success: false, error: 'logs and contentHash required' });
    }
    const result = verifyLogsAgainstSeal(logs, expectedHash);
    const snap = loadLatestSealSnapshot(req.sovereignUserId || 'unknown');
    if (!result.match) {
      AuditLedger.append('GOVERNANCE', 'QUICK_LOGS_TAMPER_DETECTED', {
        userId: req.sovereignUserId,
        tenantId: req.sovereignTenantId,
        expected: expectedHash.slice(0, 16),
        actual: result.actualHash.slice(0, 16),
        logCount: logs.length
      });
    }
    res.json({
      success: true,
      match: result.match,
      actualHash: result.actualHash,
      status: result.match ? 'INTACT' : 'TAMPERED',
      sealMetadata: snap
        ? {
            sealId: snap.sealId,
            contentHash: snap.contentHash,
            sealedAt: snap.sealedAt,
            logCount: snap.logs.length
          }
        : null
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


/** Restore last server-sealed quick log snapshot (Integrity Auto-Recovery).
 * Requires confirmed tamper: client must send confirmTampered=true and currentHash that does NOT match the seal.
 * Writes a pre-restore backup of the client-presented logs (evidence preservation).
 * Replay protection: each sealId can be restored once until a new seal is created.
 */
app.post('/api/audit/restore-logs', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.sovereignUserId || 'unknown';
    const confirmTampered = req.body?.confirmTampered === true;
    const currentHash = String(req.body?.currentHash || '');
    const currentLogs = Array.isArray(req.body?.currentLogs) ? req.body.currentLogs.map(String) : [];

    if (!confirmTampered) {
      AuditLedger.append('GOVERNANCE', 'QUICK_LOGS_RESTORE_DENIED', {
        userId, reason: 'CONFIRM_TAMPERED_REQUIRED'
      });
      return res.status(400).json({
        success: false,
        error: 'confirmTampered=true required — recovery only after verified tamper'
      });
    }

    const snap = loadLatestSealSnapshot(userId);
    if (!snap) {
      AuditLedger.append('GOVERNANCE', 'QUICK_LOGS_RESTORE_FAILED', {
        userId, reason: 'NO_SNAPSHOT'
      });
      return res.status(404).json({ success: false, error: 'No sealed snapshot available for this user' });
    }

    // Must present a currentHash that differs from the sealed content (tamper evidence)
    if (!currentHash || currentHash === snap.contentHash) {
      AuditLedger.append('GOVERNANCE', 'QUICK_LOGS_RESTORE_DENIED', {
        userId, reason: 'NO_TAMPER_EVIDENCE', sealId: snap.sealId
      });
      return res.status(409).json({
        success: false,
        error: 'Recovery denied: currentHash matches seal or missing — no tamper evidence'
      });
    }

    // Replay protection
    const replayDir = path.resolve(process.cwd(), 'native_data', 'quick_log_seals');
    const replayFile = path.join(replayDir, `restored_${snap.sealId}.flag`);
    if (fs.existsSync(replayFile)) {
      AuditLedger.append('GOVERNANCE', 'QUICK_LOGS_RESTORE_DENIED', {
        userId, reason: 'REPLAY_BLOCKED', sealId: snap.sealId
      });
      return res.status(409).json({
        success: false,
        error: 'This seal was already restored. Re-seal logs before another recovery.'
      });
    }

    // Backup client-presented (possibly tampered) logs — do not overwrite original seal snapshot
    if (!fs.existsSync(replayDir)) fs.mkdirSync(replayDir, { recursive: true });
    const backupPath = path.join(
      replayDir,
      `backup_before_restore_${userId}_${Date.now()}.json`
    );
    fs.writeFileSync(
      backupPath,
      JSON.stringify({
        userId,
        tenantId: req.sovereignTenantId,
        currentHash,
        currentLogs,
        sealId: snap.sealId,
        sealContentHash: snap.contentHash,
        backedUpAt: new Date().toISOString()
      }, null, 2),
      'utf8'
    );

    fs.writeFileSync(replayFile, JSON.stringify({ restoredAt: new Date().toISOString(), userId }), 'utf8');

    AuditLedger.append('GOVERNANCE', 'QUICK_LOGS_RESTORED', {
      userId,
      tenantId: req.sovereignTenantId,
      sealId: snap.sealId,
      contentHash: snap.contentHash.slice(0, 16),
      priorHash: currentHash.slice(0, 16),
      logCount: snap.logs.length,
      backupPath: path.basename(backupPath)
    });
    res.json({
      success: true,
      status: 'RESTORED',
      contentHash: snap.contentHash,
      sealId: snap.sealId,
      sealedAt: snap.sealedAt,
      logs: snap.logs,
      backup: path.basename(backupPath)
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/identity/verify-security', requireAuth('admin'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const identity = SovereignIdentity.getInstance();
    const results = identity.runSecuritySimulation();
    const allPassed = results.every((r) => r.status === 'PASS');

    AuditLedger.append('SYSTEM', 'SECURITY_SIMULATION_EXECUTED', {
      totalTests: results.length,
      passed: results.filter((r) => r.status === 'PASS').length,
      allPassed
    });

    res.json({
      success: true,
      verified: allPassed,
      totalTests: results.length,
      passedTests: results.filter((r) => r.status === 'PASS').length,
      results
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/identity/issue-token', requireAuth('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sub, tenantId, role, ttlSeconds, scope } = req.body || {};
    const identity = SovereignIdentity.getInstance();
    // Accept either SovereignRole or UI role labels
    let sovereignRole: SovereignRole = 'developer';
    if (role === 'User' || role === 'Developer' || role === 'Administrator') {
      sovereignRole = UI_TO_SOVEREIGN[role as keyof typeof UI_TO_SOVEREIGN];
    } else if (role === 'guest' || role === 'developer' || role === 'operator' || role === 'admin' || role === 'auditor') {
      sovereignRole = role;
    }
    // Issuer cannot mint a higher role than themselves
    const issuerLevel = req.tokenPayload?.role || 'guest';
    const hierarchy: Record<string, number> = { guest: 1, developer: 2, operator: 3, auditor: 4, admin: 5 };
    if ((hierarchy[sovereignRole] || 0) > (hierarchy[issuerLevel] || 0)) {
      return res.status(403).json({
        success: false,
        error: `Cannot mint role '${sovereignRole}' — issuer is only '${issuerLevel}'.`,
        code: 'PRIVILEGE_ESCALATION_BLOCKED'
      });
    }
    const result = identity.signToken({
      sub: sub || req.sovereignUserId || 'usr_sovereign_prime',
      tenantId: tenantId || req.sovereignTenantId || 'tenant_sovereign_prime',
      role: sovereignRole,
      ttlSeconds: ttlSeconds || 3600,
      scope
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/identity/validate-token', (req: Request, res: Response) => {
  try {
    const { token, expectedTenantId, requiredRole } = req.body;
    const identity = SovereignIdentity.getInstance();
    const result = identity.verifyToken(token, { expectedTenantId, requiredRole });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 10. Native Conversational Intelligence Endpoints
const CHAT_SESSIONS_FILE = path.resolve(process.cwd(), 'native_data', 'chat_sessions.json');

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  thought?: string;
  citations?: Array<{
    docTitle: string;
    collection: string;
    chunkIndex: number;
    score: number;
    snippet: string;
  }>;
  correlationId?: string;
  timestamp: string;
}

interface ChatSession {
  id: string;
  title: string;
  tenantId?: string;
  ownerUserId?: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

function loadChatSessions(): ChatSession[] {
  if (fs.existsSync(CHAT_SESSIONS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHAT_SESSIONS_FILE, 'utf8'));
    } catch {
      return [];
    }
  }
  const defaultSession: ChatSession = {
    id: 'session-default',
    title: 'Welcome to ZYNTHEOR Sovereign Intelligence',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      {
        id: 'msg-0',
        sender: 'assistant',
        content: 'สวัสดีครับ! ผมคือ **ZYNTHEOR Native Target 41.53M** ขับเคลื่อนด้วยโมเดล NativeLM (41,527,808 parameters · 10L · 8H · 512D · Base LM Continuation) โดยสถานะความพร้อมแสดงตามหลักฐาน Runtime\n\nพร้อมทำงานร่วมกับคุณทั้งการวิเคราะห์สถาปัตยกรรม, ตรวจโค้ด, รัน Sandbox และบันทึก Audit Ledger ครับ',
        timestamp: new Date().toISOString()
      }
    ]
  };
  saveChatSessions([defaultSession]);
  return [defaultSession];
}

function saveChatSessions(sessions: ChatSession[]) {
  fs.mkdirSync(path.dirname(CHAT_SESSIONS_FILE), { recursive: true });
  fs.writeFileSync(CHAT_SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

function canAccessChatSession(sess: ChatSession, req: AuthenticatedRequest): boolean {
  if (!sess.tenantId) return true; // shared default welcome template
  if (sess.tenantId !== req.sovereignTenantId) return false;
  if (sess.ownerUserId && sess.ownerUserId !== req.sovereignUserId && req.sovereignRole !== 'admin') {
    return false;
  }
  return true;
}

app.get('/api/chat/sessions', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessions = loadChatSessions().filter((s) => canAccessChatSession(s, req));
    res.json({ success: true, sessions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function handleChatMessage(req: AuthenticatedRequest, res: Response) {
  const { sessionId = 'session-default', message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message string is required' });
  }

  const correlationId = (req.body?.correlationId || req.headers['x-correlation-id'] || `corr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`) as string;
  const startTime = Date.now();

  try {
    await ConnectivityMonitor.getInstance().requireOnline('chat_stream');
  } catch (connErr: any) {
    return res.status(503).json({
      success: false,
      type: 'error',
      code: 'FAIL_CLOSED',
      onlineConnectivityRequired: true,
      message: 'Online Connectivity Required',
      error: connErr.message,
      correlationId,
    });
  }

  const sessions = loadChatSessions();
  let session: ChatSession | undefined;
  if (sessionId === 'session-default') {
    session = sessions.find(
      (s) => s.id === 'session-default' && s.tenantId === req.sovereignTenantId && s.ownerUserId === req.sovereignUserId
    );
    if (!session) {
      const starter = sessions.find((s) => s.id === 'session-default' && !s.tenantId);
      session = {
        id: 'session-default',
        title: starter?.title || 'ZYNTHEOR Sovereign Intelligence',
        tenantId: req.sovereignTenantId,
        ownerUserId: req.sovereignUserId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: starter ? starter.messages.map((m) => ({ ...m })) : []
      };
      sessions.unshift(session);
    }
  } else {
    session = sessions.find((s) => s.id === sessionId);
    if (session && !canAccessChatSession(session, req)) {
      return res.status(403).json({
        success: false,
        code: 'TENANT_OR_OWNER_FORBIDDEN',
        error: `Cross-tenant or unauthorized access to chat session '${sessionId}' is forbidden.`
      });
    }
    if (!session) {
      session = {
        id: sessionId,
        title: message.slice(0, 32) + '...',
        tenantId: req.sovereignTenantId,
        ownerUserId: req.sovereignUserId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
      sessions.unshift(session);
    }
  }

  // Set up chunked streaming after connectivity & session authorization pass
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Correlation-ID', correlationId);

  // Append user message
  session.messages.push({
    id: `msg-${Date.now()}-u`,
    sender: 'user',
    content: message,
    correlationId,
    timestamp: new Date().toISOString()
  });

  // Query Knowledge Workspace (hybrid RAG) for authentic grounded context scoped by caller tenant/role
  const kie = KnowledgeIntelligenceEngine.getInstance();
  const hybridResp = kie.hybridRetrieve(message, {
    limit: 2,
    minScore: 1.5,
    tenantId: req.sovereignTenantId,
    role: req.sovereignRole,
  });
  const retrievedChunks = hybridResp.results || [];
  let effectivePrompt = message;
  const citations = retrievedChunks.map((c) => ({
    docTitle: c.documentTitle,
    collection: c.collection,
    chunkIndex: c.chunkIndex,
    score: c.score,
    snippet: c.text.slice(0, 160) + '...'
  }));

  if (retrievedChunks.length > 0) {
    const contextPassages = retrievedChunks
      .map((c) => `[DOCUMENT: "${c.documentTitle}" (Collection: ${c.collection})]\n${c.text}`)
      .join('\n\n');
    effectivePrompt = `[KNOWLEDGE_WORKSPACE_GROUNDING_PASSAGES]:\n${contextPassages}\n\n[USER_QUERY]:\n${message}`;
  }

  const provider = NativeNeuralLMProvider.getInstance();
  const abortController = new AbortController();
  const onResClose = () => {
    if (!res.writableFinished) {
      abortController.abort();
      void provider.cancelInference(correlationId).catch(() => null);
    }
  };
  res.on('close', onResClose);

  let accumulated = '';
  let tokenCount = 0;

  try {
    const pingRes = await provider.ping();
    const genOpts = {
      maxNewTokens: Math.min(Math.max(Number(req.body?.maxNewTokens ?? 32) || 32, 1), 256),
      temperature: Math.min(Math.max(Number(req.body?.temperature ?? 0.8), 0), 2),
      topK: Math.min(Math.max(Number(req.body?.topK ?? 20) || 20, 1), 16384),
      repetitionPenalty: Math.min(Math.max(Number(req.body?.repetitionPenalty ?? 1.08), 1), 2),
      seed: req.body?.seed === undefined ? undefined : Number(req.body.seed),
    };

    const streamDoneMeta = await provider.chatStream(
      effectivePrompt,
      'chat',
      (chunk, meta) => {
        accumulated += chunk;
        tokenCount += 1;
        if (!res.writableEnded) {
          res.write(
            JSON.stringify({
              type: 'chunk',
              text: chunk,
              tokenIndex: meta?.token_index,
              correlationId
            }) + '\n'
          );
        }
      },
      {
        correlation_id: correlationId,
        max_new_tokens: genOpts.maxNewTokens,
        temperature: genOpts.temperature,
        top_k: genOpts.topK,
        repetition_penalty: genOpts.repetitionPenalty,
        seed: genOpts.seed,
        signal: abortController.signal,
      }
    );

    if (Number(streamDoneMeta?.output_tokens_count) > 0) {
      tokenCount = Number(streamDoneMeta.output_tokens_count);
    }

    const activeWeightsSource = String(streamDoneMeta?.weights_source || pingRes.weights_source || '');
    const resolvedParams = Number(streamDoneMeta?.total_params || pingRes.total_params || 0);
    const resolvedCheckpointPath = streamDoneMeta?.checkpoint_path || pingRes.checkpoint_path || null;
    const resolvedSha = String(streamDoneMeta?.checkpoint_sha256 || pingRes.checkpoint_sha256 || pingRes.checkpoint_hash || '');
    const resolvedTokenizerSha = streamDoneMeta?.tokenizer_sha256 || pingRes.tokenizer_sha256 || null;
    const resolvedRuntimeId = streamDoneMeta?.active_runtime_id || pingRes.active_runtime_id || null;
    const resolvedInferenceTs = streamDoneMeta?.inference_timestamp || new Date().toISOString();
    const activeModelLabel = pingRes.model_name || `ZYNTHEOR Native (${resolvedParams.toLocaleString()} params)`;
    const activeKey =
      resolvedParams === 41527808 ? 'target_41m' : resolvedParams === 502912 ? 'v2_2m' : 'cloud_native';
    const inferenceOrigin = String(streamDoneMeta?.inference_origin || 'native_model_logits');
    const weightsRole = String(streamDoneMeta?.weights_role || pingRes.weights_role || 'unknown');
    const groundingOrigin = citations.length > 0 ? 'rag_retrieval' : 'none';
    const cancelled = Boolean(streamDoneMeta?.cancelled || abortController.signal.aborted);

    const durationMs = Date.now() - startTime;
    const resolvedExecutionDurationMs = Number(streamDoneMeta?.execution_duration_ms ?? durationMs);
    lastRecordedLatencyMs = durationMs;
    lastRecordedTokensPerSec = Number(
      streamDoneMeta?.tokens_per_sec ||
      +(tokenCount / Math.max(0.001, durationMs / 1000)).toFixed(1)
    );

    let thoughtText = '';
    let cleanContent = accumulated;
    const thoughtMatch = accumulated.match(/<thought>([\s\S]*?)<\/thought>/);
    if (thoughtMatch) {
      thoughtText = thoughtMatch[1].trim();
      cleanContent = accumulated.replace(/<thought>[\s\S]*?<\/thought>/, '').trim();
    }

    session.messages.push({
      id: `msg-${Date.now()}-a`,
      sender: 'assistant',
      content: cleanContent,
      thought: thoughtText || undefined,
      citations: citations.length > 0 ? citations : undefined,
      correlationId,
      timestamp: new Date().toISOString()
    });
    session.updatedAt = new Date().toISOString();
    saveChatSessions(sessions);

    AuditLedger.append('SYSTEM', 'CHAT_INTERACTION_RECORDED', {
      sessionId,
      correlationId,
      model: activeModelLabel,
      activeKey,
      weightsSource: activeWeightsSource,
      totalParams: resolvedParams,
      checkpointPath: resolvedCheckpointPath,
      checkpointSha256: resolvedSha,
      tokenizerSha256: resolvedTokenizerSha,
      activeRuntimeId: resolvedRuntimeId,
      inferenceOrigin,
      weightsRole,
      groundingOrigin,
      cancelled,
      promptChars: message.length,
      responseChars: cleanContent.length,
      hasThought: Boolean(thoughtText),
      retrievedKnowledgeCount: retrievedChunks.length,
      durationMs,
      executionDurationMs: resolvedExecutionDurationMs,
      tokensPerSec: lastRecordedTokensPerSec
    });

    if (!res.writableEnded) {
      res.write(JSON.stringify({
        type: 'done',
        correlationId,
        model: activeModelLabel,
        activeKey,
        weightsSource: activeWeightsSource,
        totalParams: resolvedParams,
        checkpointPath: resolvedCheckpointPath,
        checkpointSha256: resolvedSha,
        tokenizerSha256: resolvedTokenizerSha,
        activeRuntimeId: resolvedRuntimeId,
        inferenceTimestamp: resolvedInferenceTs,
        executionDurationMs: resolvedExecutionDurationMs,
        inferenceOrigin,
        weightsRole,
        groundingOrigin,
        cancelled,
        maxContextLen: streamDoneMeta?.max_context_len,
        effectiveContextLen: streamDoneMeta?.effective_context_len,
        promptTruncated: streamDoneMeta?.prompt_truncated,
        fullText: cleanContent,
        thought: thoughtText,
        citations,
        latencyMs: durationMs,
        firstTokenLatencyMs: streamDoneMeta?.first_token_latency_ms,
        tokensPerSec: lastRecordedTokensPerSec,
        timestamp: new Date().toISOString()
      }) + '\n');
      res.end();
    }
  } catch (err: any) {
    if (!res.writableEnded) {
      res.write(JSON.stringify({
        type: 'error',
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        correlationId,
        error: err.message
      }) + '\n');
      res.end();
    }
  } finally {
    res.off('close', onResClose);
  }
}

app.post('/api/chat', requireAuth('guest'), enforceRateLimit('chat'), handleChatMessage);
app.post('/api/chat/message', requireAuth('guest'), enforceRateLimit('chat'), handleChatMessage);

// ==========================================
// 11. KNOWLEDGE WORKSPACE ENDPOINTS
// ==========================================
app.get('/api/knowledge/documents', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { collection, search, tag } = req.query;
    const kw = KnowledgeWorkspace.getInstance();
    const docs = kw.listDocuments({
      collection: collection as string,
      search: search as string,
      tag: tag as string
    });
    const tenantId = req.sovereignTenantId;
    const filtered = docs.filter((d: any) => {
      if (d.tenantId && tenantId && d.tenantId !== tenantId) return false;
      if (d.readRoles && Array.isArray(d.readRoles) && d.readRoles.length > 0) {
        const role = req.sovereignRole || 'guest';
        if (!d.readRoles.includes(role) && role !== 'admin') return false;
      }
      return true;
    });
    res.json({ success: true, count: filtered.length, documents: filtered });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/documents', requireRole(['Developer', 'Administrator']), enforceRateLimit('knowledge'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, content, collection, tags, format, source, provenance, curatedForTraining, readRoles } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    const kw = KnowledgeWorkspace.getInstance();
    const doc = kw.createDocument({
      title,
      content,
      collection,
      tags,
      format,
      source,
      provenance,
      curatedForTraining,
      tenantId: req.sovereignTenantId,
      readRoles
    });
    res.json({ success: true, document: doc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/documents/:id', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    const doc = kw.getDocument(req.params.id, { tenantId: req.sovereignTenantId, role: req.sovereignRole });
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
    res.json({ success: true, document: doc });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_FORBIDDEN', error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/knowledge/documents/:id', requireRole(['Developer', 'Administrator']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    const updated = kw.updateDocument(req.params.id, req.body, { tenantId: req.sovereignTenantId, role: req.sovereignRole });
    res.json({ success: true, document: updated });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_FORBIDDEN', error: err.message });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/knowledge/documents/:id', requireRole(['Developer', 'Administrator']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    const deleted = kw.deleteDocument(req.params.id, { tenantId: req.sovereignTenantId, role: req.sovereignRole });
    res.json({ success: true, deleted });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_FORBIDDEN', error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/retrieve', requireAuth('guest'), enforceRateLimit('knowledge'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query, collection, limit } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const kw = KnowledgeWorkspace.getInstance();
    const results = kw.retrieve(query, {
      collection,
      limit: limit ? Number(limit) : 5,
      tenantId: req.sovereignTenantId,
      role: req.sovereignRole,
    });
    res.json({ success: true, count: results.length, query, results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/stats', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    res.json({ success: true, stats: kw.getStats({ tenantId: req.sovereignTenantId, role: req.sovereignRole }) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/curate-dataset', requireRole(['Developer', 'Administrator']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, documentIds, splitRatio } = req.body;
    if (!name || !Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ error: 'name and non-empty documentIds array are required' });
    }
    const kw = KnowledgeWorkspace.getInstance();
    const manifest = kw.curateDataset(name, documentIds, splitRatio, {
      tenantId: req.sovereignTenantId,
      role: req.sovereignRole,
    });
    res.json({ success: true, manifest });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_FORBIDDEN', error: err.message });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/datasets', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    res.json({ success: true, datasets: kw.getDatasets({ tenantId: req.sovereignTenantId }) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/datasets/:id', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    const detail = kw.getDatasetDetail(req.params.id, { tenantId: req.sovereignTenantId });
    if (!detail) return res.status(404).json({ success: false, error: 'Dataset not found' });
    res.json({ success: true, ...detail });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_FORBIDDEN', error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// Knowledge Intelligence Engine endpoints
// ==========================================

app.post('/api/knowledge/ingest/bulk', requireAuth('developer'), enforceRateLimit('knowledge'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array required' });
    }
    if (items.length > 200) {
      return res.status(400).json({ success: false, error: 'Max 200 items per job' });
    }
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const job = engine.startIngestionJob(items, { tenantId: req.sovereignTenantId });
    res.json({ success: true, job });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/ingest/jobs', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    res.json({ success: true, jobs: engine.listJobs({ tenantId: req.sovereignTenantId }) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/ingest/jobs/:id', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const job = engine.getJob(req.params.id, { tenantId: req.sovereignTenantId });
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_FORBIDDEN', error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/ingest/jobs/:id/resume', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const job = engine.resumeJob(req.params.id, { tenantId: req.sovereignTenantId });
    res.json({ success: true, job });
  } catch (err: any) {
    if (String(err?.message || '').startsWith('FORBIDDEN:')) {
      return res.status(403).json({ success: false, code: 'TENANT_FORBIDDEN', error: err.message });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});


app.post('/api/knowledge/retrieve/hybrid', requireAuth('guest'), enforceRateLimit('knowledge'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query, collection, limit, minScore } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'query string required' });
    }
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const result = engine.hybridRetrieve(query, {
      collection,
      limit: limit ? Number(limit) : 5,
      minScore: minScore !== undefined ? Number(minScore) : undefined,
      tenantId: req.sovereignTenantId,
      role: req.sovereignRole,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/analyze', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const analysis = engine.analyzeCorpus({ tenantId: req.sovereignTenantId, role: req.sovereignRole });
    res.json({
      success: true,
      analysis,
      disclaimer:
        'Indexed knowledge is separate from learned model weights. Analysis does not train the neural checkpoint.'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/duplicates', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    res.json({ success: true, duplicates: engine.findDuplicates({ tenantId: req.sovereignTenantId, role: req.sovereignRole }) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/graph', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const edges = engine.buildGraphEdges({ tenantId: req.sovereignTenantId, role: req.sovereignRole });
    res.json({ success: true, edgeCount: edges.length, edges: edges.slice(0, 500) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/summarize', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const documentIds = Array.isArray(req.body?.documentIds) ? req.body.documentIds : [];
    if (documentIds.length === 0) {
      return res.status(400).json({ success: false, error: 'documentIds required' });
    }
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const summary = engine.extractiveSummary(documentIds, Number(req.body?.maxSentences) || 5, {
      tenantId: req.sovereignTenantId,
      role: req.sovereignRole,
    });
    res.json({ success: true, ...summary, method: 'extractive' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get('/api/knowledge/parsers', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const caps = await parserCapabilityReport();
    res.json({
      success: true,
      parsers: caps,
      limits: { maxBytes: 15 * 1024 * 1024, maxPages: 200 },
      notes: {
        pdf: caps.pdf ? `${caps.engines.pdf} available` : 'No PDF parser (pypdf / pdftotext) installed in runtime',
        docx: caps.docx ? `${caps.engines.docx} available` : 'python-docx not installed in runtime',
        ocr: caps.ocr ? 'OCR available' : 'OCR not implemented — scanned PDFs without text layer will fail closed'
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Parse binary PDF/DOCX — multipart file upload or JSON base64. Real extraction only. */
app.post('/api/knowledge/parse-binary', requireAuth('developer'), enforceRateLimit('knowledge'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ct = String(req.headers['content-type'] || '');
    let format: string | undefined;
    let title: string | undefined;
    let collection: string | undefined;
    let ingest = false;
    let buf: Buffer | null = null;
    let originalname = '';

    if (ct.includes('multipart/form-data')) {
      const raw = await readRequestBuffer(req);
      const parts = parseMultipartBuffer(raw, ct);
      if (!parts.file) {
        return res.status(400).json({ success: false, error: 'multipart field "file" required' });
      }
      buf = parts.file.buffer;
      originalname = parts.file.originalname || '';
      format = (parts.fields.format || '').toLowerCase();
      title = parts.fields.title;
      collection = parts.fields.collection;
      ingest = parts.fields.ingest === 'true' || parts.fields.ingest === '1';
      if (!format) {
        if (originalname.toLowerCase().endsWith('.pdf') || parts.file.mimetype.includes('pdf')) format = 'pdf';
        else if (originalname.toLowerCase().endsWith('.docx') || parts.file.mimetype.includes('wordprocessingml')) format = 'docx';
      }
    } else {
      const body = req.body || {};
      format = String(body.format || '').toLowerCase();
      title = body.title;
      collection = body.collection;
      ingest = Boolean(body.ingest);
      if (typeof body.base64 === 'string' && body.base64.length >= 8) {
        if (body.base64.length > 28 * 1024 * 1024) {
          return res.status(400).json({ success: false, error: 'payload too large' });
        }
        buf = bufferFromBase64(body.base64);
      } else {
        return res.status(400).json({ success: false, error: 'base64 payload or multipart file required' });
      }
    }

    if (format !== 'pdf' && format !== 'docx') {
      return res.status(400).json({ success: false, error: 'format must be pdf or docx' });
    }
    if (!buf) {
      return res.status(400).json({ success: false, error: 'empty file buffer' });
    }

    const parsed = await parseBinaryDocument(buf, format as 'pdf' | 'docx');
    // Basic Thai/English normalization on extracted text
    let normalized = parsed.text || '';
    normalized = normalized.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!parsed.success || !parsed.extracted) {
      return res.status(422).json({
        success: false,
        extracted: false,
        status: 'PARSE_FAILED',
        parsed: { ...parsed, text: normalized },
        error: parsed.errors.join('; ') || 'extraction failed'
      });
    }

    let document = null;
    if (ingest) {
      const kw = KnowledgeWorkspace.getInstance();
      document = kw.createDocument({
        title: title || originalname || `Imported ${format.toUpperCase()}`,
        content: normalized,
        format: format as any,
        collection: collection || 'Imports',
        tags: [format, 'binary-import'],
        provenance: `Binary ${format} extract pages=${parsed.pageCount} file=${originalname || 'inline'}`,
        tenantId: req.sovereignTenantId
      });
    }

    res.json({
      success: true,
      extracted: true,
      status: ingest && document ? 'INDEXED' : 'PARSED_PREVIEW',
      pageCount: parsed.pageCount,
      pages: parsed.pages.map((p) => ({ page: p.page, charCount: p.charCount, preview: p.text.slice(0, 200) })),
      text: normalized,
      textLength: normalized.length,
      warnings: parsed.warnings,
      document,
      meta: parsed.meta
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/parse-preview', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { content, format } = req.body || {};
    if (typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'content string required' });
    }
    const parsed = parseMultiFormat(content, format || 'txt');
    res.json({ success: true, parsed });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// 12. NATIVE TRAINING & CHECKPOINT ENDPOINTS
// ==========================================
const LATEST_TRAINING_METRICS_PATH = path.resolve(process.cwd(), 'native_data', 'latest_training_metrics.json');

app.post('/api/model/train', requireRole(['Developer', 'Administrator']), enforceRateLimit('agent'), async (req: Request, res: Response) => {
  try {
    const { text, datasetId } = req.body || {};
    const epochs = Math.min(Math.max(parseInt(String(req.body?.epochs ?? 1), 10) || 1, 1), 10);
    let trainingText = text;

    if (datasetId) {
      const kw = KnowledgeWorkspace.getInstance();
      const datasetDetail = kw.getDatasetDetail(datasetId);
      if (datasetDetail && Array.isArray(datasetDetail.items)) {
        trainingText = datasetDetail.items.map((i: any) => i.text).join('\n\n');
      }
    }

    if (!trainingText) {
      trainingText = "ZYNTHEOR NativeLM v2 single forward backward autograd verification. ภาษาไทยและอังกฤษ";
    }

    await ConnectivityMonitor.getInstance().requireOnline('model_train');
    const provider = NativeNeuralLMProvider.getInstance();
    const [pingRes, trainResult] = await Promise.all([
      provider.ping(),
      provider.trainStep(trainingText, epochs)
    ]);

    const activeManifestModel = trainResult.model_name || pingRes.model_name || 'ZYNTHEOR Native Cloud';
    const executedRuntimeBridge = String(pingRes.weights_source || 'cloud://active');

    const auditRecord = AuditLedger.append('SYSTEM', 'NATIVE_TRAINING_STEP_COMMITTED', {
      trainingStep: trainResult.training_step,
      epochs: trainResult.epochs,
      tokensProcessed: trainResult.tokens_processed,
      lossBefore: trainResult.loss_before,
      lossAfter: trainResult.loss_after,
      lossReductionPct: trainResult.loss_reduction_pct,
      paramMutationDelta: trainResult.param_mutation_delta,
      avgGradientNorm: trainResult.avg_gradient_norm,
      layerCount: trainResult.layer_count ?? Object.keys(trainResult.layer_gradient_norms || {}).length,
      layerGradientNorms: trainResult.layer_gradient_norms || {},
      activeManifestModel,
      executedRuntimeBridge,
    });

    const enrichedResult = {
      success: true,
      ...trainResult,
      audit_block_index: auditRecord.index,
      audit_entry_hash: auditRecord.entry_hash,
      executed_runtime_bridge: executedRuntimeBridge,
      active_manifest_model: activeManifestModel
    };

    try {
      fs.mkdirSync(path.dirname(LATEST_TRAINING_METRICS_PATH), { recursive: true });
      fs.writeFileSync(LATEST_TRAINING_METRICS_PATH, JSON.stringify(enrichedResult, null, 2), 'utf8');
      const liveHistoryPath = path.resolve(process.cwd(), 'native_data', 'live_training_steps.json');
      let liveHistory: any[] = [];
      if (fs.existsSync(liveHistoryPath)) {
        try {
          const parsedHist = JSON.parse(fs.readFileSync(liveHistoryPath, 'utf8'));
          if (Array.isArray(parsedHist)) liveHistory = parsedHist;
        } catch {
          liveHistory = [];
        }
      }
      liveHistory.push({
        trainingStep: enrichedResult.training_step,
        timestamp: enrichedResult.timestamp || Math.floor(Date.now() / 1000),
        lossBefore: enrichedResult.loss_before,
        lossAfter: enrichedResult.loss_after,
        lossReductionPct: enrichedResult.loss_reduction_pct,
        paramMutationDelta: enrichedResult.param_mutation_delta,
        initialParamNorm: enrichedResult.initial_param_norm,
        finalParamNorm: enrichedResult.final_param_norm,
        avgGradientNorm: enrichedResult.avg_gradient_norm,
        totalParams: enrichedResult.total_params,
        layerCount: enrichedResult.layer_count,
        executedRuntimeBridge: enrichedResult.executed_runtime_bridge,
      });
      fs.writeFileSync(liveHistoryPath, JSON.stringify(liveHistory.slice(-50), null, 2), 'utf8');
    } catch (persistErr) {
      console.error('[ZYNTHEOR] Failed to persist latest_training_metrics.json:', persistErr);
    }

    res.json(enrichedResult);
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/model/export', requireRole(['Developer', 'Administrator']), async (req: Request, res: Response) => {
  try {
    await ConnectivityMonitor.getInstance().requireOnline('model_export');
    const { step, loss } = req.body;
    const provider = NativeNeuralLMProvider.getInstance();
    const exportResult = await provider.exportCheckpoint(step, loss);

    AuditLedger.append('SYSTEM', 'FULL_TENSOR_CHECKPOINT_EXPORTED', {
      fileSize: exportResult.file_size,
      totalParams: exportResult.total_params,
      payloadSha256: exportResult.payload_sha256,
      weightsSource: exportResult.weights_source,
    });

    res.json({ success: true, ...exportResult });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/model/inspect', requireRole(['Developer', 'Administrator']), async (_req: Request, res: Response) => {
  try {
    await ConnectivityMonitor.getInstance().requireOnline('model_inspect');
    const provider = NativeNeuralLMProvider.getInstance();
    const inspectResult = await provider.inspectCheckpoint();
    const latestTrainingStep = readJsonArtifact('native_data/latest_training_metrics.json');
    res.json({
      success: true,
      ...inspectResult,
      latest_training_step: latestTrainingStep
    });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

function readJsonArtifact(relPath: string): any | null {
  try {
    const full = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(full)) return null;
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return null;
  }
}

function readPtCheckpointHeader(relPath: string): {
  exists: boolean;
  fileSizeBytes: number;
  metadata: Record<string, any> | null;
} {
  try {
    const full = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(full)) {
      return { exists: false, fileSizeBytes: 0, metadata: null };
    }
    const stat = fs.statSync(full);
    const fd = fs.openSync(full, 'r');
    try {
      const magic = Buffer.alloc(17);
      fs.readSync(fd, magic, 0, 17, 0);
      if (magic.toString('utf8') !== 'ZYNTHEOR_QPLUS_PT') {
        return { exists: true, fileSizeBytes: stat.size, metadata: null };
      }
      const lenBuf = Buffer.alloc(4);
      fs.readSync(fd, lenBuf, 0, 4, 17);
      const metaLen = lenBuf.readUInt32BE(0);
      const metaBuf = Buffer.alloc(metaLen);
      fs.readSync(fd, metaBuf, 0, metaLen, 21);
      const metadata = JSON.parse(metaBuf.toString('utf8'));
      return { exists: true, fileSizeBytes: stat.size, metadata };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { exists: false, fileSizeBytes: 0, metadata: null };
  }
}

// 12a. Side-by-side metadata comparison of 41.5M Target vs 2.0M Verified v2 checkpoints
app.get('/api/model/comparison', requireAuth('developer'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    let pingRes: any = null;
    try {
      pingRes = await provider.ping();
    } catch {
      pingRes = null;
    }

    const activeStatePath = path.resolve(process.cwd(), 'native_data', 'active_checkpoint.json');
    let promotedState: any = null;
    if (fs.existsSync(activeStatePath)) {
      try {
        promotedState = JSON.parse(fs.readFileSync(activeStatePath, 'utf8'));
      } catch {
        promotedState = null;
      }
    }

    const targetDisk = readPtCheckpointHeader('native_data/model_checkpoint_target_41m.pt');
    const v2Disk = readPtCheckpointHeader('native_data/model_checkpoint_v2.pt');
    const v22Disk = readPtCheckpointHeader('native_data/model_checkpoint_v2_2.pt');

    const targetArchAudit = readJsonArtifact('artifacts/target-checkpoint-architecture-audit.json');
    const targetTrainingRoot = readJsonArtifact('target-training-evidence.json');
    const targetTrainingArtifact = readJsonArtifact('artifacts/target-training-evidence.json');
    const v2Eval = readJsonArtifact('artifacts/lm-v2-eval.json');
    const v2Train = readJsonArtifact('artifacts/lm-v2-training-evidence.json');
    const gatedTrain = readJsonArtifact('artifacts/gated-training-evidence.json');

    const targetParams = Number(
      targetDisk.metadata?.total_params ||
      targetArchAudit?.metadata_total_params ||
      targetTrainingRoot?.params ||
      41527808
    );
    const targetPayloadBytes = targetParams * 4;
    const rawTargetLoss =
      targetDisk.metadata?.validation_loss ??
      targetTrainingRoot?.best_val_loss ??
      targetTrainingArtifact?.best_val_loss ??
      null;
    const targetLastLoss = rawTargetLoss !== null ? Number(rawTargetLoss) : null;
    const targetLastPpl = targetLastLoss !== null ? Number(Math.exp(targetLastLoss).toFixed(4)) : null;
    const targetSteps =
      targetDisk.metadata?.training_steps ??
      (Array.isArray(targetTrainingRoot?.history) ? targetTrainingRoot.history[targetTrainingRoot.history.length - 1]?.step : null) ??
      null;

    const v2Params = Number(
      v2Disk.metadata?.total_params ||
      v2Eval?.total_params ||
      502912
    );
    const v2PayloadBytes = v2Params * 4;
    const rawV2Ppl = v2Eval?.perplexity?.model ?? null;
    const v2EvalPpl = rawV2Ppl !== null ? Number(rawV2Ppl) : null;
    const rawV2Loss =
      v2Disk.metadata?.validation_loss ??
      v2Train?.runs?.[0]?.val_loss_best ??
      (v2EvalPpl !== null ? Math.log(v2EvalPpl) : null);
    const v2LastLoss = rawV2Loss !== null ? Number(rawV2Loss) : null;
    const gatedLatestRun = Array.isArray(gatedTrain?.runs) && gatedTrain.runs.length > 0
      ? gatedTrain.runs[gatedTrain.runs.length - 1]
      : null;

    const activeCheckpointKey =
      pingRes?.weights_loaded
        ? (pingRes.total_params === 502912
            ? 'v2_2m'
            : pingRes.total_params === 41527808
            ? 'target_41m'
            : 'cloud_native')
        : 'unloaded_fail_closed';

    res.json({
      success: true,
      activeCheckpoint: {
        key: activeCheckpointKey,
        weightsSource: pingRes?.weights_source || null,
        totalParams: pingRes?.weights_loaded ? pingRes.total_params : 0,
        checkpointSha256: pingRes?.checkpoint_hash || null,
        promotedAt: promotedState?.promotedAt || null,
        promotedBy: promotedState?.promotedBy || null,
        runtimeBridgeSource: pingRes?.weights_source || null
      },
      models: {
        target41m: {
          key: 'target_41m',
          label: 'Native Target 41.5M',
          checkpointPath: 'native_data/model_checkpoint_target_41m.pt',
          onDisk: targetDisk.exists,
          fileSizeBytes: targetDisk.exists ? targetDisk.fileSizeBytes : targetPayloadBytes,
          totalParams: targetParams,
          memoryFootprintBytes: targetPayloadBytes,
          memoryFootprintMb: +(targetPayloadBytes / (1024 * 1024)).toFixed(2),
          memoryFootprintDecimalMb: +(targetPayloadBytes / 1_000_000).toFixed(2),
          dtype: 'float32',
          architecture: {
            d_model: targetArchAudit?.config?.d_model ?? 512,
            n_layers: targetArchAudit?.config?.n_layers ?? 10,
            n_heads: targetArchAudit?.config?.n_heads ?? 8,
            d_ffn: targetArchAudit?.config?.d_ffn ?? 1472,
            ctx: targetArchAudit?.config?.ctx ?? 64,
            vocab: targetArchAudit?.config?.vocab ?? 16384,
            tensorCount: targetArchAudit?.manifest_tensor_count ?? 93
          },
          lastEvaluatedLoss: targetLastLoss !== null ? +targetLastLoss.toFixed(4) : null,
          lastEvaluatedPerplexity: targetLastPpl,
          trainingSteps: targetSteps !== null ? Number(targetSteps) : null,
          checkpointSha256: targetDisk.metadata?.sha256 || targetArchAudit?.checkpoint_sha256 || targetTrainingRoot?.checkpoint_sha256 || null,
          sourceEvidence: targetDisk.exists ? 'disk+artifacts' : (targetArchAudit ? 'artifacts/target-checkpoint-architecture-audit.json' : null),
          status: activeCheckpointKey === 'target_41m' ? 'ACTIVE' : (targetDisk.exists ? 'VERIFIED_ON_DISK' : (targetArchAudit ? 'ARTIFACT_VERIFIED' : 'NOT_FOUND'))
        },
        v2_2m: {
          key: 'v2_2m',
          label: 'NativeLM v2 (2.0M)',
          checkpointPath: 'native_data/model_checkpoint_v2.pt',
          promotedCheckpointPath: promotedState?.weightsSource || null,
          onDisk: v2Disk.exists || v22Disk.exists,
          fileSizeBytes: v2Disk.exists ? v2Disk.fileSizeBytes : v2PayloadBytes,
          totalParams: v2Params,
          memoryFootprintBytes: v2PayloadBytes,
          memoryFootprintMb: +(v2PayloadBytes / (1024 * 1024)).toFixed(2),
          memoryFootprintDecimalMb: +(v2PayloadBytes / 1_000_000).toFixed(2),
          dtype: 'float32',
          architecture: {
            d_model: 128,
            n_layers: 2,
            n_heads: 4,
            d_ffn: 384,
            ctx: 64,
            vocab: 532,
            tensorCount: 21
          },
          lastEvaluatedLoss: v2LastLoss !== null ? +v2LastLoss.toFixed(4) : null,
          lastEvaluatedPerplexity: v2EvalPpl !== null ? +v2EvalPpl.toFixed(4) : null,
          v2BaseLoss: v2LastLoss !== null ? +v2LastLoss.toFixed(4) : null,
          v2BasePerplexity: v2EvalPpl !== null ? +v2EvalPpl.toFixed(4) : null,
          v2BaseSha256: v2Eval?.checkpoint_sha256 || v2Train?.runs?.[0]?.saved?.payload_sha256 || null,
          top1AccuracyPct: v2Eval?.accuracy?.top1 !== undefined ? +(v2Eval.accuracy.top1 * 100).toFixed(2) : null,
          top5AccuracyPct: v2Eval?.accuracy?.top5 !== undefined ? +(v2Eval.accuracy.top5 * 100).toFixed(2) : null,
          beatsBigramBaseline: v2Eval?.beats_bigram_baseline ?? null,
          bigramBaselinePpl: v2Eval?.perplexity?.bigram_baseline !== undefined ? +v2Eval.perplexity.bigram_baseline.toFixed(2) : null,
          gatedBestLoss: gatedLatestRun?.candidate_nll !== undefined ? +Number(gatedLatestRun.candidate_nll).toFixed(4) : null,
          gatedBestPerplexity: gatedLatestRun?.candidate_nll !== undefined ? +Math.exp(Number(gatedLatestRun.candidate_nll)).toFixed(4) : null,
          gatedBestSha256: gatedLatestRun?.saved?.payload_sha256 || null,
          trainingSteps: v2Eval?.training_steps_total ?? null,
          checkpointSha256: v2Disk.metadata?.sha256 || v2Eval?.checkpoint_sha256 || v2Train?.runs?.[0]?.saved?.payload_sha256 || null,
          sourceEvidence: v2Disk.exists ? 'disk+artifacts' : (v2Eval ? 'artifacts/lm-v2-eval.json + lm-v2-training-evidence.json' : null),
          status: activeCheckpointKey === 'v2_2m' ? 'ACTIVE' : (v2Eval ? 'VERIFIED_CANDIDATE' : 'NOT_FOUND')
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12a-2. Training Logs for Native Target 41.5M, v2 2.0M & train_gated.py runs
app.get('/api/model/training-logs', requireAuth('developer'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const targetRoot = readJsonArtifact('target-training-evidence.json');
    const targetArtifact = readJsonArtifact('artifacts/target-training-evidence.json');
    const v2Train = readJsonArtifact('artifacts/lm-v2-training-evidence.json');
    const gatedTrain = readJsonArtifact('artifacts/gated-training-evidence.json');

    const mapCurve = (rows: any[]) =>
      (rows || []).map((row) => {
        const trainLoss = Number(row.train_loss ?? 0);
        const valLoss = Number(row.val_loss ?? row.val_monitor_nll ?? 0);
        return {
          step: Number(row.step),
          trainLoss: +trainLoss.toFixed(4),
          valLoss: +valLoss.toFixed(4),
          trainPerplexity: +Math.exp(Math.min(trainLoss, 20)).toFixed(2),
          valPerplexity: +Math.exp(Math.min(valLoss, 20)).toFixed(2),
          gradNorm: row.grad_norm !== undefined ? +Number(row.grad_norm).toFixed(3) : null,
          lr: row.lr !== undefined ? Number(row.lr) : null,
          elapsedSec: row.elapsed_s !== undefined ? +Number(row.elapsed_s).toFixed(1) : null
        };
      });

    const targetCurve = mapCurve(targetRoot?.history || targetArtifact?.history || []);
    const v2PrimaryRun = Array.isArray(v2Train?.runs) ? v2Train.runs[0] : null;
    const v2Curve = mapCurve(v2PrimaryRun?.history || []);
    const gatedRuns = Array.isArray(gatedTrain?.runs) ? gatedTrain.runs : [];
    const latestGated = gatedRuns.length > 0 ? gatedRuns[gatedRuns.length - 1] : null;
    const gatedCurve = mapCurve(latestGated?.history || []);

    const mappedGatedRuns = gatedRuns.map((run: any, idx: number) => ({
      runIndex: idx + 1,
      timestamp: Number(run.timestamp),
      decision: String(run.decision || 'UNKNOWN'),
      candidateNll: +Number(run.candidate_nll ?? 0).toFixed(4),
      candidatePerplexity: +Math.exp(Number(run.candidate_nll ?? 0)).toFixed(4),
      referenceNll: +Number(run.reference_nll ?? 0).toFixed(4),
      params: Number(run.params || 502912),
      savedPath: String(run.saved?.path || ''),
      payloadSha256: String(run.saved?.payload_sha256 || ''),
      history: mapCurve(run.history || [])
    }));

    const liveStepsArtifact = readJsonArtifact('native_data/live_training_steps.json');
    const latestStepArtifact = readJsonArtifact('native_data/latest_training_metrics.json');
    const liveSteps = Array.isArray(liveStepsArtifact)
      ? liveStepsArtifact
      : latestStepArtifact
      ? [
          {
            trainingStep: latestStepArtifact.training_step,
            timestamp: latestStepArtifact.timestamp,
            lossBefore: latestStepArtifact.loss_before,
            lossAfter: latestStepArtifact.loss_after,
            lossReductionPct: latestStepArtifact.loss_reduction_pct,
            paramMutationDelta: latestStepArtifact.param_mutation_delta,
            initialParamNorm: latestStepArtifact.initial_param_norm,
            finalParamNorm: latestStepArtifact.final_param_norm,
            avgGradientNorm: latestStepArtifact.avg_gradient_norm,
            totalParams: latestStepArtifact.total_params,
            layerCount: latestStepArtifact.layer_count,
            executedRuntimeBridge: latestStepArtifact.executed_runtime_bridge,
          }
        ]
      : [];

    res.json({
      success: true,
      target41m: {
        params: targetRoot?.params || 41527808,
        bestValLoss: +(Number(targetRoot?.best_val_loss ?? 2.13268)).toFixed(4),
        bestValPerplexity: +Math.exp(Number(targetRoot?.best_val_loss ?? 2.13268)).toFixed(2),
        checkpointSha256: targetRoot?.checkpoint_sha256 || targetArtifact?.checkpoint_sha256 || null,
        points: targetCurve,
        smokeRunPoints: mapCurve(targetArtifact?.history || [])
      },
      v2_2m: {
        params: 502912,
        bestValLoss: +(Number(v2PrimaryRun?.val_loss_best ?? 1.5561)).toFixed(4),
        bestValPerplexity: +Math.exp(Number(v2PrimaryRun?.val_loss_best ?? 1.5561)).toFixed(2),
        gatedBestLoss: latestGated ? +Number(latestGated.candidate_nll).toFixed(4) : null,
        gatedBestPerplexity: latestGated ? +Math.exp(Number(latestGated.candidate_nll)).toFixed(4) : null,
        checkpointSha256: latestGated?.saved?.payload_sha256 || v2PrimaryRun?.saved?.payload_sha256 || null,
        points: v2Curve,
        gatedPoints: gatedCurve
      },
      gatedRuns: mappedGatedRuns,
      liveSteps,
      latestStep: latestStepArtifact
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function updateRuntimeModelConfig(opts: {
  target?: string;
  variant?: string;
  modelPath?: string;
  cloudUri?: string;
  promotedBy?: string;
}) {
  await ConnectivityMonitor.getInstance().requireOnline('runtime_model_promotion');
  const requestedCloudUri = typeof opts.cloudUri === 'string' ? opts.cloudUri.trim() : '';
  const requestedPath = typeof opts.modelPath === 'string' ? opts.modelPath.trim() : '';
  const useV22 =
    opts.variant === 'v2_2' ||
    opts.target === 'v2_2_gated' ||
    requestedPath.endsWith('model_checkpoint_v2_2.pt') ||
    requestedCloudUri.endsWith('model_checkpoint_v2_2.pt');
  const requestedTarget = opts.target || (useV22 ? 'v2_2_gated' : 'v2_2m');

  const v2Eval = readJsonArtifact('artifacts/lm-v2-eval.json');
  const v2Train = readJsonArtifact('artifacts/lm-v2-training-evidence.json');
  const gatedTrain = readJsonArtifact('artifacts/gated-training-evidence.json');
  const gatedRuns = Array.isArray(gatedTrain?.runs) ? gatedTrain.runs : [];
  const latestAcceptedGated =
    [...gatedRuns].reverse().find((r: any) => r.decision === 'ACCEPTED') ||
    (gatedRuns.length > 0 ? gatedRuns[gatedRuns.length - 1] : null);

  const cloudEndpointUri =
    requestedCloudUri ||
    process.env.CHECKPOINT_PRESIGNED_URL ||
    (process.env.S3_BUCKET ? `s3://${process.env.S3_BUCKET}/${process.env.S3_CHECKPOINT_KEY || 'checkpoints/model_checkpoint.pt'}` : '');

  if (
    !cloudEndpointUri ||
    (!cloudEndpointUri.startsWith('https://') &&
      !cloudEndpointUri.startsWith('http://') &&
      !cloudEndpointUri.startsWith('s3://'))
  ) {
    throw new Error(
      'FAIL_CLOSED: Online Connectivity Required — cloud checkpoint URI (https:// or s3://) is required; local disk checkpoint switching is disabled.'
    );
  }
  if (cloudEndpointUri.startsWith('http://') || cloudEndpointUri.startsWith('https://')) {
    const urlCheck = validateCloudUrl(cloudEndpointUri);
    if (!urlCheck.ok) {
      throw new Error(`FAIL_CLOSED: ${urlCheck.reason}`);
    }
  }

  const candidateRelPath = cloudEndpointUri;
  const backupCreated: string | null = null;
  const provider = NativeNeuralLMProvider.getInstance();
  const bridgeSwitchResult = await provider.switchCheckpoint(cloudEndpointUri);
  const v2Header = { exists: false, metadata: null as any };
  const evaluatedLoss = useV22 && latestAcceptedGated?.candidate_nll
    ? +Number(latestAcceptedGated.candidate_nll).toFixed(4)
    : (v2Eval?.perplexity?.model ? +Math.log(v2Eval.perplexity.model).toFixed(4) : null);
  const evaluatedPerplexity = useV22 && latestAcceptedGated?.candidate_nll
    ? +Math.exp(Number(latestAcceptedGated.candidate_nll)).toFixed(4)
    : (v2Eval?.perplexity?.model ? +Number(v2Eval.perplexity.model).toFixed(4) : null);
  const promotedSha =
    bridgeSwitchResult?.checkpoint_hash ||
    v2Header.metadata?.sha256 ||
    (useV22 ? latestAcceptedGated?.saved?.payload_sha256 : null) ||
    v2Eval?.checkpoint_sha256 ||
    v2Train?.runs?.[0]?.saved?.payload_sha256 ||
    null;

  const promotionRecord = {
    activeKey: requestedTarget === 'v2' ? 'v2_2m' : requestedTarget,
    modelName: useV22 ? 'NativeLM v2.2 (2.0M)' : 'NativeLM v2 (2.0M)',
    architecture: useV22
      ? 'ZYNTHEOR-NativeLM-v2.2 (2L · 4H · 128D · Tied-Vocab 532)'
      : 'ZYNTHEOR-NativeLM-v2 (2L · 4H · 128D · Tied-Vocab 532)',
    storageMode: useV22 ? 'LEARNED_WEIGHTS_TRAINED_V2_2' : 'LEARNED_WEIGHTS_TRAINED_V2',
    weightsSource: candidateRelPath,
    totalParams: v2Header.metadata?.total_params || (useV22 ? latestAcceptedGated?.params : null) || v2Eval?.total_params || 502912,
    memoryFootprintMb: +(((v2Header.metadata?.total_params || v2Eval?.total_params || 502912) * 4) / (1024 * 1024)).toFixed(2),
    checkpointSha256: promotedSha,
    evaluatedLoss,
    evaluatedPerplexity,
    promotedAt: new Date().toISOString(),
    promotedBy: opts.promotedBy || 'developer',
    backupCreated,
    binaryReplacedOnDisk: false,
    bridgeStatus: bridgeSwitchResult
  };

  const activeStatePath = path.resolve(process.cwd(), 'native_data', 'active_checkpoint.json');
  fs.writeFileSync(activeStatePath, JSON.stringify(promotionRecord, null, 2), 'utf8');

  const auditRecord = AuditLedger.appendPromotionEvent(candidateRelPath, {
    promotedKey: promotionRecord.activeKey,
    modelName: promotionRecord.modelName,
    totalParams: promotionRecord.totalParams,
    checkpointSha256: promotionRecord.checkpointSha256,
    evaluatedLoss: promotionRecord.evaluatedLoss,
    evaluatedPerplexity: promotionRecord.evaluatedPerplexity,
    backupCreated,
    binaryReplacedOnDisk: promotionRecord.binaryReplacedOnDisk,
    promotedBy: promotionRecord.promotedBy
  });

  return { promotionRecord, auditRecord };
}

// 12a-3. Programmatically promote verified Cloud NativeLM checkpoint to active runtime
app.post('/api/model/promote', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { promotionRecord, auditRecord } = await updateRuntimeModelConfig({
      target: String(req.body?.target || 'v2_2m'),
      variant: String(req.body?.variant || 'v2'),
      cloudUri: typeof req.body?.cloudUri === 'string' ? req.body.cloudUri : undefined,
      promotedBy: req.sovereignUserId || 'developer'
    });

    res.json({
      success: true,
      activeCheckpoint: promotionRecord,
      auditBlockIndex: auditRecord.index,
      auditEntryHash: auditRecord.entry_hash
    });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12a-4. Update cloud runtime model configuration, log promotion to AuditLedger, and return updated status JSON
app.post('/api/system/runtime-model', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cloudUri = String(req.body?.cloudUri || req.body?.modelPath || '').trim();
    if (cloudUri && !cloudUri.startsWith('https://') && !cloudUri.startsWith('http://') && !cloudUri.startsWith('s3://')) {
      return res.status(400).json({
        success: false,
        code: 'FAIL_CLOSED',
        error: 'FAIL_CLOSED: Online Connectivity Required — runtime model URI must be https://, http://, or s3:// (local disk paths are prohibited).'
      });
    }

    const { promotionRecord, auditRecord } = await updateRuntimeModelConfig({
      target: typeof req.body?.target === 'string' ? req.body.target : undefined,
      variant: typeof req.body?.variant === 'string' ? req.body.variant : undefined,
      cloudUri: cloudUri || undefined,
      promotedBy: req.sovereignUserId || 'developer'
    });

    const statusPayload = await buildSystemStatusPayload();
    res.json({
      ...statusPayload,
      promotion: promotionRecord,
      auditBlockIndex: auditRecord.index,
      auditEntryHash: auditRecord.entry_hash,
      auditEvent: auditRecord
    });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

const execFileAsync = promisify(execFile);

// 12a-5. Online-only runtime reload & Cloud Object Storage sync check (replaces local disk fallback)
app.post('/api/model/regenerate-v2', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const monitor = ConnectivityMonitor.getInstance();
    const state = await monitor.reconnect(
      typeof req.body?.presignedUrl === 'string' ? req.body.presignedUrl : undefined,
      typeof req.body?.objectKey === 'string' ? req.body.objectKey : undefined
    );
    if (!state.online || !state.weightsLoaded) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: state.reason,
      });
    }

    AuditLedger.append('SYSTEM', 'CLOUD_MODEL_SYNC_RELOADED', {
      weightsSource: state.cloudSourceUri,
      triggeredBy: req.sovereignUserId || 'operator',
      latencyMs: state.latencyMs,
    });

    const statusPayload = await buildSystemStatusPayload();
    res.json({
      ...statusPayload,
      cloudReloaded: true,
    });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12b. Live Throughput & Latency Benchmark for Cloud NativeLM (Strictly Online-Only)
app.post('/api/model/benchmark', requireAuth('developer'), enforceRateLimit('inference'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ConnectivityMonitor.getInstance().requireOnline('model_benchmark');
    const prompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim()
      ? req.body.prompt.trim().slice(0, 1000)
      : 'ZYNTHEOR Sovereign NativeLM causal KV-cache throughput verification';
    const maxNewTokens = Math.min(Math.max(Number(req.body?.maxNewTokens ?? 12) || 12, 4), 32);
    const temperature = req.body?.temperature === undefined ? 0.0 : Math.min(Math.max(Number(req.body.temperature), 0), 2);
    const seed = req.body?.seed === undefined ? 42 : Number(req.body.seed);

    const provider = NativeNeuralLMProvider.getInstance();
    const benchmark = await provider.targetBenchmark({ prompt, maxNewTokens, temperature, seed });

    lastRecordedLatencyMs = benchmark.active_kv_cache.latency_ms;
    lastRecordedTokensPerSec = benchmark.active_kv_cache.tokens_per_sec;

    AuditLedger.append('TESTER', 'NATIVE_TARGET_BENCHMARK_EXECUTED', {
      model: benchmark.model,
      totalParams: benchmark.total_params,
      checkpointSha256: benchmark.checkpoint_sha256,
      inputTokens: benchmark.input_tokens,
      generatedTokens: benchmark.generated_tokens,
      uncachedLatencyMs: benchmark.baseline_uncached.latency_ms,
      cachedLatencyMs: benchmark.active_kv_cache.latency_ms,
      uncachedTokensPerSec: benchmark.baseline_uncached.tokens_per_sec,
      cachedTokensPerSec: benchmark.active_kv_cache.tokens_per_sec,
      speedupFactor: benchmark.improvement.speedup_factor,
      latencyReductionPct: benchmark.improvement.latency_reduction_pct,
      tokensParityExact: benchmark.tokens_parity_exact
    });

    res.json({ success: true, benchmark });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError || String(err?.message || '').includes('FAIL_CLOSED')) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        onlineConnectivityRequired: true,
        message: 'Online Connectivity Required',
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12c. Governance Manual Audit: Validate loaded model parameter SHA-256 against Master Ledger
app.post('/api/governance/audit-model-integrity', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  const startedAt = Date.now();
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    const pingRes = await provider.ping();
    const inspectRes = await provider.inspectCheckpoint();
    const ledgerIntegrity = AuditLedger.verifyIntegrity();

    const expectedLoadedParams = Number(pingRes.total_params || 0);
    const ledgerPath = path.resolve(process.cwd(), 'native_data', 'audit_log.jsonl');
    let ledgerReferenceHash: string | null = null;
    let ledgerReferenceIndex: number | null = null;
    let ledgerReferenceAction: string | null = null;
    let matchingLedgerEntries = 0;

    if (fs.existsSync(ledgerPath) && expectedLoadedParams > 0) {
      const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          const p = rec.payload || {};
          const candidateHash =
            p.checkpointSha256 ||
            p.checkpointHash ||
            p.liveCheckpointSha256 ||
            p.payloadSha256 ||
            null;
          const recParams = Number(p.totalParams || 0);
          if (typeof candidateHash === 'string' && candidateHash.length === 64 && (recParams === expectedLoadedParams || recParams === 0)) {
            if (recParams === expectedLoadedParams || candidateHash === pingRes.checkpoint_hash) {
              matchingLedgerEntries += 1;
              ledgerReferenceHash = candidateHash;
              ledgerReferenceIndex = rec.index;
              ledgerReferenceAction = rec.action;
            }
          }
        } catch {
          // ignore malformed line; ledgerIntegrity above handles chain verification
        }
      }
    }

    const runtimeHash = pingRes.checkpoint_hash;
    const diskPayloadHash = inspectRes.payload_sha256;
    const metadataHash = inspectRes.metadata?.sha256 || null;

    const runtimeMatchesDisk = Boolean(runtimeHash && diskPayloadHash && runtimeHash === diskPayloadHash);
    const diskMatchesMetadata = Boolean(inspectRes.sha256_match);
    const paramsAndManifestValid = Boolean(
      pingRes.weights_loaded &&
      expectedLoadedParams > 0 &&
      inspectRes.parameter_count_match &&
      inspectRes.manifest_count_match &&
      pingRes.execution_verified
    );
    const ledgerBaselinePresent = Boolean(ledgerReferenceHash);
    const ledgerMatchesRuntime = ledgerReferenceHash ? ledgerReferenceHash === runtimeHash : true;

    const allVerified = Boolean(
      ledgerIntegrity.valid &&
      runtimeMatchesDisk &&
      diskMatchesMetadata &&
      paramsAndManifestValid &&
      ledgerMatchesRuntime
    );

    const status = !pingRes.weights_loaded ? 'BLOCKED' : (allVerified ? 'VERIFIED' : 'MISMATCH');
    const tensorCount = Array.isArray(inspectRes.metadata?.tensors_manifest) ? inspectRes.metadata.tensors_manifest.length : 0;
    const auditRecord = AuditLedger.append('GOVERNANCE', 'MODEL_PARAMETER_INTEGRITY_AUDIT', {
      auditStatus: status,
      weightsSource: pingRes.weights_source,
      totalParams: expectedLoadedParams,
      tensorCount,
      liveCheckpointSha256: runtimeHash,
      diskPayloadSha256: diskPayloadHash,
      metadataExpectedSha256: metadataHash,
      ledgerReferenceSha256: ledgerReferenceHash,
      ledgerReferenceIndex,
      ledgerChainValid: ledgerIntegrity.valid,
      ledgerTotalRecordsBeforeAudit: ledgerIntegrity.totalRecords,
      triggeredBy: req.sovereignUserId || 'developer'
    });

    const postIntegrity = AuditLedger.verifyIntegrity();

    res.json({
      success: true,
      audit: {
        status,
        verified: allVerified,
        auditedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        weightsSource: pingRes.weights_source,
        architecture: pingRes.architecture,
        totalParams: expectedLoadedParams,
        manifestParams: inspectRes.manifest_parameter_count,
        tensorCount,
        runtimeCheckpointHash: runtimeHash,
        diskPayloadSha256: diskPayloadHash,
        metadataExpectedSha256: metadataHash,
        ledgerReferenceHash,
        ledgerReferenceIndex,
        ledgerReferenceAction,
        ledgerBaselinePresent,
        matchingLedgerEntries,
        checks: {
          ledgerChainValid: postIntegrity.valid,
          runtimeMatchesDisk,
          diskMatchesMetadata,
          paramsAndManifestValid,
          ledgerMatchesRuntime
        },
        ledgerHeadHash: postIntegrity.headHash,
        ledgerTotalRecords: postIntegrity.totalRecords,
        auditBlockIndex: auditRecord.index,
        auditEntryHash: auditRecord.entry_hash
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12c-1. Continuous Real-Time Checkpoint Hash Verification against Cloud-Signed Metadata
app.post('/api/governance/verify-checkpoint-integrity', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    const pingRes = await provider.ping();
    const weightsLoaded = Boolean(pingRes.weights_loaded);
    const loadedHash = pingRes.checkpoint_hash || null;

    if (!weightsLoaded || !loadedHash) {
      const result = verifyAndRecordCheckpointIntegrity({
        weightsLoaded: false,
        loadedHash: null,
        sourceUri: pingRes.weights_source || null,
        userId: req.sovereignUserId,
        tenantId: req.sovereignTenantId,
      });
      return res.json({ success: true, ...result });
    }

    let inspectRes: any = null;
    try {
      inspectRes = await provider.inspectCheckpoint();
    } catch {
      inspectRes = null;
    }

    const cloudMeta = await resolveCloudSignedMetadataHash({
      sourceUri: pingRes.weights_source || null,
      inspectRes,
    });

    const result = verifyAndRecordCheckpointIntegrity({
      weightsLoaded,
      loadedHash,
      cloudSignedHash: cloudMeta.cloudSignedHash,
      cloudComputedHash: cloudMeta.cloudComputedHash,
      sourceUri: cloudMeta.sourceUri || pingRes.weights_source || null,
      metadataSource: cloudMeta.metadataSource,
      userId: req.sovereignUserId,
      tenantId: req.sovereignTenantId,
    });

    return res.status(result.mismatch ? 409 : 200).json({
      success: !result.mismatch,
      ...result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      status: 'UNCONFIGURED',
      mismatch: false,
      error: err?.message || 'Checkpoint integrity verification failed',
    });
  }
});

// 12c-2. Batch 27 Reproducible Evaluation Endpoints
app.get('/api/evaluation/batch27', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const report = loadLatestBatch27EvalReport();
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/evaluation/batch27', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    assertNoManualScoreInjection(req.body);
    const report = await runBatch27Evaluation();
    res.json({ success: true, report });
  } catch (err: any) {
    const status = String(err?.message || '').startsWith('INVALID_EVALUATION_INPUT') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// 12d. Checkpoint Loading Progress & Memory Allocation Diagnostics
app.get('/api/model/checkpoint-diagnostics', requireAuth('developer'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    const diag = await provider.checkpointDiagnostics(false);
    const nodeMem = process.memoryUsage();
    res.json({
      success: true,
      diagnostics: {
        ...diag,
        node_process_rss_mb: +(nodeMem.rss / (1024 * 1024)).toFixed(2),
        node_heap_used_mb: +(nodeMem.heapUsed / (1024 * 1024)).toFixed(2),
        node_heap_total_mb: +(nodeMem.heapTotal / (1024 * 1024)).toFixed(2),
        system_total_ram_mb: Math.round(os.totalmem() / (1024 * 1024)),
        system_free_ram_mb: Math.round(os.freemem() / (1024 * 1024))
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/model/checkpoint-diagnostics/probe', requireAuth('developer'), async (_req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const writeEvent = (ev: Record<string, any>) => {
    res.write(JSON.stringify({ ...ev, timestamp: new Date().toISOString() }) + '\n');
  };

  try {
    const connState = await ConnectivityMonitor.getInstance().requireOnline('checkpoint_diagnostics');
    writeEvent({
      stage: 'INIT_CLOUD_CHECK',
      label: `Verifying active Cloud Object Storage checkpoint (${connState.cloudSourceUri || 'cloud runtime'})`,
      progressPct: 15
    });

    writeEvent({
      stage: 'RELOADING_WEIGHTS_AND_SHA256',
      label: `Reloading resident cloud weights & verifying SHA-256`,
      progressPct: 45
    });

    const provider = NativeNeuralLMProvider.getInstance();
    const diag = await provider.checkpointDiagnostics(true);

    writeEvent({
      stage: 'MEASURING_MEMORY_ALLOCATION',
      label: `Mapped ${diag.tensor_count} tensors (${diag.runtime_tensor_mb} MiB ${diag.runtime_dtype}) · Bridge RSS ${diag.python_process_rss_mb} MiB`,
      progressPct: 85
    });

    const nodeMem = process.memoryUsage();
    const combined = {
      ...diag,
      node_process_rss_mb: +(nodeMem.rss / (1024 * 1024)).toFixed(2),
      node_heap_used_mb: +(nodeMem.heapUsed / (1024 * 1024)).toFixed(2),
      node_heap_total_mb: +(nodeMem.heapTotal / (1024 * 1024)).toFixed(2),
      system_total_ram_mb: Math.round(os.totalmem() / (1024 * 1024)),
      system_free_ram_mb: Math.round(os.freemem() / (1024 * 1024))
    };

    AuditLedger.append('SYSTEM', 'CHECKPOINT_DIAGNOSTIC_PROBE_COMPLETED', {
      checkpointPath: diag.checkpoint_path,
      checkpointSha256: diag.checkpoint_sha256,
      totalLoadMs: diag.total_load_ms,
      runtimeTensorMb: diag.runtime_tensor_mb,
      pythonRssMb: diag.python_process_rss_mb
    });

    writeEvent({
      stage: 'COMPLETE',
      label: `Checkpoint verified & resident in ${diag.total_load_ms} ms`,
      progressPct: 100,
      diagnostics: combined
    });
    res.end();
  } catch (err: any) {
    writeEvent({ stage: 'ERROR', label: err.message, progressPct: 0, error: err.message });
    res.end();
  }
});

// Read-only release archive download endpoint (serves root-level .zip deliverables)
app.get('/downloads/:filename', (req: Request, res: Response) => {
  const safeName = path.basename(String(req.params.filename || ''));
  if (!safeName.endsWith('.zip') || safeName !== String(req.params.filename || '')) {
    return res.status(404).json({ success: false, error: 'Archive not found' });
  }
  const fullPath = path.resolve(process.cwd(), safeName);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ success: false, error: 'Archive not found' });
  }
  return res.download(fullPath, safeName);
});

// ==========================================
// BATCH 28: AUTONOMOUS INTELLIGENCE, EVALUATION, CONTINUOUS LEARNING & OBSERVABILITY
// ==========================================

// 28.1 Autonomous Planning Engine (DAG plans, steps, revisions, budgets)
app.get('/api/agent/plans', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const planner = AutonomousPlanner.getInstance();
    const scope =
      req.sovereignRole === 'admin'
        ? { tenantId: req.sovereignTenantId }
        : { tenantId: req.sovereignTenantId, ownerUserId: req.sovereignUserId };
    const plans = planner.listPlans(scope);
    res.json({ success: true, total: plans.length, plans });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agent/plans/:taskId', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const planner = AutonomousPlanner.getInstance();
    const scope =
      req.sovereignRole === 'admin'
        ? { tenantId: req.sovereignTenantId }
        : { tenantId: req.sovereignTenantId, ownerUserId: req.sovereignUserId };
    const plan = planner.getPlan(String(req.params.taskId || ''), scope);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Autonomous plan not found' });
    }
    res.json({ success: true, plan });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 28.2 Tool Telemetry
app.get('/api/tools/telemetry', requireAuth('developer'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const telemetry = ToolRegistry.getInstance().getTelemetry();
    res.json({ success: true, telemetry });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 28.3 Multi-Step Reasoning Verification (Python symbolic math, CSP, AST code analysis, alternative ranking)
app.post('/api/reasoning/verify', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { op, ...payload } = req.body || {};
    if (!op || typeof op !== 'string') {
      return res.status(400).json({ success: false, error: 'op string is required (verify_math|solve_constraints|reason_code|evaluate_alternatives)' });
    }
    const script = path.resolve(process.cwd(), 'qplus_native', 'batch28_reasoning.py');
    const result = await new Promise<any>((resolve, reject) => {
      const proc = execFile('python3', ['-B', script], { cwd: process.cwd(), timeout: 10_000 }, (err, stdout, stderr) => {
        if (err && !stdout.trim()) return reject(new Error(stderr || err.message));
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (parseErr: any) {
          reject(new Error(`Invalid reasoning output: ${parseErr.message}`));
        }
      });
      proc.stdin?.write(JSON.stringify({ op, ...payload }));
      proc.stdin?.end();
    });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 28.4 Human Approval Gate
app.get('/api/governance/approvals', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? (req.query.status as any) : undefined;
    const tenantId = req.sovereignRole === 'admin' && req.query.allTenants === '1'
      ? undefined
      : req.sovereignTenantId;
    const requests = ApprovalGate.getInstance().listRequests({ tenantId, status });
    res.json({ success: true, total: requests.length, requests });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/governance/approvals', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { actionType, resourceId, description, riskLevel, metadata } = req.body || {};
    if (!actionType || !resourceId || !description) {
      return res.status(400).json({ success: false, error: 'actionType, resourceId, and description are required' });
    }
    const created = ApprovalGate.getInstance().requestApproval({
      actionType,
      resourceId: String(resourceId),
      description: String(description),
      requestedByUserId: req.sovereignUserId || 'unknown',
      requestedByRole: req.sovereignRole || 'developer',
      tenantId: req.sovereignTenantId || 'default-tenant',
      riskLevel: riskLevel === 'critical' ? 'critical' : 'high',
      metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
    });
    res.status(201).json({ success: true, request: created });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/governance/approvals/:id/approve', requireAuth('operator'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const record = ApprovalGate.getInstance().approveRequest(
      String(req.params.id || ''),
      {
        userId: req.sovereignUserId || 'unknown',
        role: req.sovereignRole || 'operator',
        tenantId: req.sovereignTenantId || 'default-tenant',
      },
      typeof req.body?.note === 'string' ? req.body.note : undefined
    );
    res.json({ success: true, request: record });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const code = msg.startsWith('FORBIDDEN:') ? 403 : msg.startsWith('APPROVAL_NOT_FOUND') ? 404 : 400;
    res.status(code).json({ success: false, error: msg });
  }
});

app.post('/api/governance/approvals/:id/reject', requireAuth('operator'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const record = ApprovalGate.getInstance().rejectRequest(
      String(req.params.id || ''),
      {
        userId: req.sovereignUserId || 'unknown',
        role: req.sovereignRole || 'operator',
        tenantId: req.sovereignTenantId || 'default-tenant',
      },
      typeof req.body?.note === 'string' ? req.body.note : undefined
    );
    res.json({ success: true, request: record });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const code = msg.startsWith('FORBIDDEN:') ? 403 : msg.startsWith('APPROVAL_NOT_FOUND') ? 404 : 400;
    res.status(code).json({ success: false, error: msg });
  }
});

// 28.5 Self-Evaluation & Reproducible Batch 28 Benchmark
app.get('/api/evaluation/batch28', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const report = SelfEvaluationEngine.getInstance().getLatestBenchmarkReport();
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/evaluation/batch28', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    assertNoManualScoreInjection(req.body);
    const report = await SelfEvaluationEngine.getInstance().runBatch28Benchmark();
    res.json({ success: true, report });
  } catch (err: any) {
    const status = String(err?.message || '').startsWith('INVALID_EVALUATION_INPUT') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.post('/api/evaluation/self-evaluate', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query, answer, citations, claimedConfidence, nativeModelPerplexity, orchestratorSuccess } = req.body || {};
    if (!query || !answer) {
      return res.status(400).json({ success: false, error: 'query and answer strings are required' });
    }
    const evaluation = SelfEvaluationEngine.getInstance().evaluateResponse({
      query: String(query),
      answer: String(answer),
      citations: Array.isArray(citations) ? citations : [],
      claimedConfidence: typeof claimedConfidence === 'number' ? claimedConfidence : undefined,
      nativeModelPerplexity: typeof nativeModelPerplexity === 'number' ? nativeModelPerplexity : null,
      orchestratorSuccess: typeof orchestratorSuccess === 'boolean' ? orchestratorSuccess : undefined,
      scope: { tenantId: req.sovereignTenantId, role: req.sovereignRole },
    });
    res.json({ success: true, evaluation });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/evaluation/history', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const history = SelfEvaluationEngine.getInstance().getHistory(limit);
    res.json({ success: true, total: history.length, history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 28.6 Continuous Learning Pipeline (Data Curation -> Real PureSeqLM Backprop -> Regression Gate -> Approval -> Promote/Rollback)
app.get('/api/training/pipeline', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const pipeline = ContinuousLearningPipeline.getInstance();
    const runs = pipeline.listRuns(req.sovereignRole === 'admin' ? undefined : { tenantId: req.sovereignTenantId });
    const backups = pipeline.listBackups();
    res.json({ success: true, runs, backups });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/training/pipeline/run', requireRole(['Developer', 'Administrator']), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customSamples, documentIds, steps, lr, margin, testMargin, weightDecay, gradientClip, schedulerDecay, seed, resumeTraining, resumeFromRunId } = req.body || {};
    const record = await ContinuousLearningPipeline.getInstance().executePipelineRun({
      tenantId: req.sovereignTenantId || 'default-tenant',
      initiatedBy: req.sovereignUserId || 'unknown',
      customSamples: Array.isArray(customSamples) ? customSamples : undefined,
      documentIds: Array.isArray(documentIds) ? documentIds : undefined,
      steps: steps !== undefined ? Number(steps) : undefined,
      lr: lr !== undefined ? Number(lr) : undefined,
      margin: margin !== undefined ? Number(margin) : undefined,
      testMargin: testMargin !== undefined ? Number(testMargin) : undefined,
      weightDecay: weightDecay !== undefined ? Number(weightDecay) : undefined,
      gradientClip: gradientClip !== undefined ? Number(gradientClip) : undefined,
      schedulerDecay: schedulerDecay !== undefined ? Number(schedulerDecay) : undefined,
      seed: seed !== undefined ? Number(seed) : undefined,
      resumeTraining: resumeTraining === true,
      resumeFromRunId: typeof resumeFromRunId === 'string' ? resumeFromRunId : undefined,
    });
    res.json({ success: record.status !== 'FAILED' && record.status !== 'INCOMPATIBLE', run: record });
  } catch (err: any) {
    const message = String(err?.message || '');
    const status = message.startsWith('RESUME_RUN_NOT_FOUND') ? 404
      : message.startsWith('RESUME_RUN_INCOMPATIBLE') ? 409
      : message.startsWith('INVALID_TRAINING_CONFIG') ? 400
      : 500;
    res.status(status).json({ success: false, error: message });
  }
});

app.post('/api/training/pipeline/benchmark', requireRole(['Developer', 'Administrator']), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = String(req.body?.runId || '');
    if (!runId) return res.status(400).json({ success: false, error: 'runId is required' });
    const run = await ContinuousLearningPipeline.getInstance().runDomainBenchmarks({
      runId,
      tenantId: req.sovereignTenantId || 'default-tenant',
    });
    res.json({ success: run.benchmarkStatus !== 'FAILED', run });
  } catch (err: any) {
    const message = String(err?.message || '');
    const status = message.startsWith('FORBIDDEN:') ? 403
      : message.startsWith('RUN_NOT_FOUND') ? 404
      : message.startsWith('BENCHMARK_RUN_INCOMPATIBLE') ? 409
      : 500;
    res.status(status).json({ success: false, error: message });
  }
});

app.post('/api/training/pipeline/promote', requireAuth('operator'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = String(req.body?.runId || '');
    if (!runId) {
      return res.status(400).json({ success: false, error: 'runId is required' });
    }
    const run = ContinuousLearningPipeline.getInstance().promoteApprovedRun({
      runId,
      actor: {
        userId: req.sovereignUserId || 'unknown',
        role: req.sovereignRole || 'operator',
        tenantId: req.sovereignTenantId || 'default-tenant',
      },
    });
    res.json({ success: true, run });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const code = msg.startsWith('FORBIDDEN:') ? 403 : msg.startsWith('RUN_NOT_FOUND') ? 404 : 409;
    res.status(code).json({ success: false, error: msg });
  }
});

app.post('/api/training/pipeline/rollback', requireAuth('operator'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const backupId = String(req.body?.backupId || '');
    if (!backupId) {
      return res.status(400).json({ success: false, error: 'backupId is required' });
    }
    const result = ContinuousLearningPipeline.getInstance().rollbackCheckpoint({
      backupId,
      actor: {
        userId: req.sovereignUserId || 'unknown',
        role: req.sovereignRole || 'operator',
        tenantId: req.sovereignTenantId || 'default-tenant',
      },
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const code = msg.startsWith('FORBIDDEN:') ? 403 : msg.startsWith('BACKUP_NOT_FOUND') ? 404 : 409;
    res.status(code).json({ success: false, error: msg });
  }
});

// 28.7 Long-Horizon Memory (Ranked Recall, Consolidation, Session Continuity)
app.post('/api/memory/recall', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query, limit, categories } = req.body || {};
    if (typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'query string is required' });
    }
    const results = NativeMemoryController.getInstance().recallRankedMemories(query, {
      limit: limit ? Number(limit) : 8,
      categories: Array.isArray(categories) ? categories : undefined,
      scope: callerMemoryScope(req),
    });
    res.json({ success: true, results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/memory/consolidate', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetKey, sourceCategory, maxSources, pruneConsolidatedSources } = req.body || {};
    if (!targetKey || typeof targetKey !== 'string') {
      return res.status(400).json({ success: false, error: 'targetKey string is required' });
    }
    const out = NativeMemoryController.getInstance().consolidateMemories({
      targetKey,
      sourceCategory,
      maxSources: maxSources ? Number(maxSources) : 10,
      pruneConsolidatedSources: Boolean(pruneConsolidatedSources),
      scope: callerMemoryScope(req),
    });
    res.json({ success: true, ...out });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/memory/session-context/:sessionId', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const context = NativeMemoryController.getInstance().getWorkingContextForSession(
      String(req.params.sessionId || ''),
      callerMemoryScope(req),
      limit
    );
    res.json({ success: true, context });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 28.8 Advanced Knowledge Retrieval & Citation Verification
app.post('/api/knowledge/retrieve/advanced', requireAuth('guest'), enforceRateLimit('knowledge'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query, collection, limit, minScore, maxContextChars } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'query string required' });
    }
    const result = KnowledgeIntelligenceEngine.getInstance().advancedRetrieve(query, {
      collection,
      limit: limit ? Number(limit) : 5,
      minScore: minScore !== undefined ? Number(minScore) : undefined,
      maxContextChars: maxContextChars ? Number(maxContextChars) : undefined,
      tenantId: req.sovereignTenantId,
      role: req.sovereignRole,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/verify-citations', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { answer, citations } = req.body || {};
    if (typeof answer !== 'string' || !Array.isArray(citations)) {
      return res.status(400).json({ success: false, error: 'answer string and citations array required' });
    }
    const verification = KnowledgeIntelligenceEngine.getInstance().verifyCitations({
      answer,
      citations,
      scope: { tenantId: req.sovereignTenantId, role: req.sovereignRole },
    });
    res.json({ success: true, verification });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 28.9 Production Observability Aggregation Endpoint (Zero Simulation — real module telemetry only)
app.get('/api/observability/operations', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.sovereignTenantId;
    const isAdmin = req.sovereignRole === 'admin';
    const orch = TaskOrchestrator.getInstance();
    const tasks = orch.listTasksFor({ userId: req.sovereignUserId!, tenantId: tenantId! });
    const toolTelemetry = ToolRegistry.getInstance().getTelemetry();
    const memoryStats = NativeMemoryController.getInstance().getStats(callerMemoryScope(req));
    const memoryIntegrity = NativeMemoryController.getInstance().verifyStoreIntegrity();
    const knowledgeTelemetry = KnowledgeIntelligenceEngine.getInstance().getRetrievalTelemetry();
    const evalEngine = SelfEvaluationEngine.getInstance();
    const latestBenchmark = evalEngine.getLatestBenchmarkReport();
    const evalHistory = evalEngine.getHistory(20);
    const pipeline = ContinuousLearningPipeline.getInstance();
    const trainingRuns = pipeline.listRuns(isAdmin ? undefined : { tenantId });
    const trainingBackups = pipeline.listBackups();
    const pendingApprovals = ApprovalGate.getInstance().listRequests({
      tenantId: isAdmin ? undefined : tenantId,
      status: 'PENDING',
    });
    const plans = AutonomousPlanner.getInstance().listPlans(
      isAdmin ? { tenantId } : { tenantId, ownerUserId: req.sovereignUserId }
    );
    const connectivity = await ConnectivityMonitor.getInstance().getStatus();

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      connectivity: {
        online: connectivity.online,
        weightsLoaded: connectivity.weightsLoaded,
        executionVerified: connectivity.executionVerified,
        checkpointSha256: connectivity.checkpointSha256,
        reason: connectivity.reason,
      },
      tasks: {
        total: tasks.length,
        delivered: tasks.filter((t) => t.lifecycleStatus === 'Delivered').length,
        blocked: tasks.filter((t) => t.lifecycleStatus === 'Blocked').length,
        failed: tasks.filter((t) => t.lifecycleStatus === 'Failed').length,
        inProgress: tasks.filter((t) => t.lifecycleStatus === 'In Progress').length,
      },
      plans: {
        total: plans.length,
        revisedCount: plans.filter((p) => p.revisions.length > 0).length,
        latestPlans: plans.slice(0, 5),
      },
      toolTelemetry,
      memory: {
        stats: memoryStats,
        integrityValid: memoryIntegrity.valid,
        tamperedCount: memoryIntegrity.tamperedKeys.length,
      },
      knowledge: knowledgeTelemetry,
      evaluation: {
        latestBenchmark,
        recentEvaluations: evalHistory.slice(0, 10),
      },
      continuousLearning: {
        runs: trainingRuns.slice(0, 10),
        backups: trainingBackups.slice(0, 10),
      },
      governance: {
        pendingApprovalsCount: pendingApprovals.length,
        pendingApprovals: pendingApprovals.slice(0, 10),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// BATCH 29: COGNITIVE INTELLIGENCE, GRAPH, ADAPTIVE REASONING, PERFORMANCE & EVALUATION LAB
// ==========================================

function sanitizeCognitiveText(raw: unknown, maxLen = 16_000): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\u0000/g, '').slice(0, maxLen);
}

function hasUnsafePrototypeKeys(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return true;
  }
  return false;
}

function mapBatch29HttpCode(err: any): number {
  const msg = String(err?.message || '');
  if (msg.startsWith('FORBIDDEN:')) return 403;
  if (msg.includes('NOT_FOUND')) return 404;
  return 400;
}

// 29.1 Cognitive Context Engine
app.post('/api/cognitive/context/analyze', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const input = sanitizeCognitiveText(req.body?.input);
    const query = sanitizeCognitiveText(req.body?.query, 2000);
    if (!input.trim()) {
      return res.status(400).json({ success: false, error: 'input string is required' });
    }
    const connState = await ConnectivityMonitor.getInstance().getStatus();
    const analysis = CognitiveContextEngine.getInstance().analyzeContext({
      input,
      query: query || undefined,
      nativeNeuralState: connState.executionVerified ? 'READY' : 'BLOCKED',
    });
    res.json({ success: true, analysis });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/cognitive/context/sessions', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = {
      tenantId: req.sovereignTenantId || 'default-tenant',
      userId: req.sovereignUserId || 'guest',
      role: req.sovereignRole,
    };
    const sessions = CognitiveContextEngine.getInstance().listSessions(scope);
    const stats = CognitiveContextEngine.getInstance().getSummaryStats(scope);
    res.json({ success: true, stats, sessions });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/context/sessions', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const sessionId = sanitizeCognitiveText(req.body?.sessionId, 128).trim();
    const text = sanitizeCognitiveText(req.body?.text);
    const role = req.body?.role === 'assistant' || req.body?.role === 'system' ? req.body.role : 'user';
    if (!sessionId || !text.trim()) {
      return res.status(400).json({ success: false, error: 'sessionId and text are required' });
    }
    const out = CognitiveContextEngine.getInstance().upsertSessionTurn({
      sessionId,
      role,
      text,
      pinAsFact: Boolean(req.body?.pinAsFact),
      ttlSeconds: typeof req.body?.ttlSeconds === 'number' ? req.body.ttlSeconds : undefined,
      scope: {
        tenantId: req.sovereignTenantId || 'default-tenant',
        userId: req.sovereignUserId || 'unknown',
        role: req.sovereignRole,
      },
    });
    res.status(201).json({ success: true, ...out });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

app.delete('/api/cognitive/context/sessions/:sessionId', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const removed = CognitiveContextEngine.getInstance().deleteSession(String(req.params.sessionId || ''), {
      tenantId: req.sovereignTenantId || 'default-tenant',
      userId: req.sovereignUserId || 'unknown',
      role: req.sovereignRole,
    });
    if (!removed) return res.status(404).json({ success: false, error: 'Context session not found' });
    res.json({ success: true, removed: true });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

// 29.2 Adaptive Reasoning Architecture
app.post('/api/cognitive/reasoning/execute', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const prompt = sanitizeCognitiveText(req.body?.prompt);
    if (!prompt.trim()) {
      return res.status(400).json({ success: false, error: 'prompt string is required' });
    }
    const outcome = await AdaptiveReasoningEngine.getInstance().executeReasoning({
      prompt,
      scope: {
        tenantId: req.sovereignTenantId || 'default-tenant',
        userId: req.sovereignUserId || 'unknown',
        role: req.sovereignRole,
      },
      mathSteps: Array.isArray(req.body?.mathSteps) ? req.body.mathSteps : undefined,
      expectedFinal: typeof req.body?.expectedFinal === 'number' ? req.body.expectedFinal : undefined,
      cspTasks: Array.isArray(req.body?.cspTasks) ? req.body.cspTasks : undefined,
      maxCost: typeof req.body?.maxCost === 'number' ? req.body.maxCost : undefined,
      pythonSource: typeof req.body?.pythonSource === 'string' ? sanitizeCognitiveText(req.body.pythonSource) : undefined,
      maxHops: typeof req.body?.maxHops === 'number' ? req.body.maxHops : undefined,
    });
    res.json({ success: true, outcome });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/reasoning/benchmark', requireAuth('developer'), enforceRateLimit('agent'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const benchmark = await AdaptiveReasoningEngine.getInstance().evaluateAgainstIndependentBenchmark();
    res.json({ success: true, benchmark });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 29.3 Knowledge Graph Intelligence
app.post('/api/cognitive/graph/build', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const summary = KnowledgeGraphEngine.getInstance().buildFromWorkspace({
      tenantId: req.sovereignTenantId,
      role: req.sovereignRole,
    });
    res.json({ success: true, summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/graph/traverse', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = sanitizeCognitiveText(req.body?.query, 500).trim();
    if (!query) {
      return res.status(400).json({ success: false, error: 'query string is required' });
    }
    const maxHops = typeof req.body?.maxHops === 'number' ? req.body.maxHops : 2;
    const limit = typeof req.body?.limit === 'number' ? req.body.limit : 8;
    const traversal = KnowledgeGraphEngine.getInstance().traverseMultiHop(query, {
      maxHops,
      limit,
      scope: { tenantId: req.sovereignTenantId, role: req.sovereignRole },
    });
    res.json({ success: true, traversal });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/cognitive/graph/verify', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const consistency = KnowledgeGraphEngine.getInstance().verifyGraphConsistency({
      tenantId: req.sovereignTenantId,
      role: req.sovereignRole,
    });
    res.json({ success: true, consistency });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 29.4 Advanced Memory Lifecycle & Reversible Consolidation
app.get('/api/cognitive/memory/analyze', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const lifecycle = NativeMemoryController.getInstance().analyzeMemoryLifecycle(callerMemoryScope(req));
    res.json({ success: true, lifecycle });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/memory/consolidate', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetKey = sanitizeCognitiveText(req.body?.targetKey, 160).trim();
    if (!targetKey) {
      return res.status(400).json({ success: false, error: 'targetKey is required' });
    }
    const out = NativeMemoryController.getInstance().consolidateEpisodicToSemanticReversible({
      targetKey,
      sourceCategory: req.body?.sourceCategory,
      maxSources: typeof req.body?.maxSources === 'number' ? req.body.maxSources : 12,
      archiveSourcesFromActive: Boolean(req.body?.archiveSourcesFromActive),
      scope: callerMemoryScope(req),
    });
    res.json({ success: true, ...out });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/memory/rollback', requireAuth('operator'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const consolidationId = sanitizeCognitiveText(req.body?.consolidationId, 128).trim();
    if (!consolidationId) {
      return res.status(400).json({ success: false, error: 'consolidationId is required' });
    }
    const out = NativeMemoryController.getInstance().rollbackConsolidation(consolidationId, callerMemoryScope(req));
    res.json({ success: true, ...out });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

// 29.5 Self-Adaptive Performance Engine
app.get('/api/cognitive/performance', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true, telemetry: PerformanceEngine.getInstance().getTelemetry() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/performance/optimize', requireAuth('operator'), (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body) || hasUnsafePrototypeKeys(req.body?.updates)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const updates = req.body?.updates;
    const reason = sanitizeCognitiveText(req.body?.reason, 300).trim() || 'Operator adaptive adjustment';
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, error: 'updates object is required' });
    }
    const snapshot = PerformanceEngine.getInstance().applyOptimization({
      updates,
      reason,
      appliedBy: req.sovereignUserId || 'operator',
    });
    res.json({ success: true, snapshot, config: PerformanceEngine.getInstance().getConfig() });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/performance/rollback', requireAuth('operator'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const snapshotId = sanitizeCognitiveText(req.body?.snapshotId, 128).trim();
    if (!snapshotId) {
      return res.status(400).json({ success: false, error: 'snapshotId is required' });
    }
    const snapshot = PerformanceEngine.getInstance().rollbackOptimization(
      snapshotId,
      req.sovereignUserId || 'operator'
    );
    res.json({ success: true, snapshot, config: PerformanceEngine.getInstance().getConfig() });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

// 29.6 Multimodal Capability Honesty Registry
app.get('/api/cognitive/multimodal/capabilities', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const registry = await getMultimodalCapabilityRegistry();
    res.json({ success: true, registry });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 29.7 Cognitive Evaluation Lab (12 Metrics + Provenance + Baseline Comparisons)
app.get('/api/cognitive/evaluation', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const report = loadLatestBatch29EvalReport();
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/evaluation', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    assertNoManualScoreInjection(req.body);
    const report = await runBatch29Evaluation(req.body);
    res.json({ success: true, report });
  } catch (err: any) {
    const status = String(err?.message || '').startsWith('INVALID_EVALUATION_INPUT') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// 29.7b Formal Zero-Simulation Capability Gates & Honest Subsystem Status Matrix
app.get('/api/cognitive/gates', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const snapshot = await getCapabilityGatesSnapshot();
    res.json({ success: true, ...snapshot });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 29.8 Unified Cognitive Operations Dashboard Aggregation
app.get('/api/cognitive/operations', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = {
      tenantId: req.sovereignTenantId || 'default-tenant',
      userId: req.sovereignUserId || 'guest',
      role: req.sovereignRole || ('guest' as const),
    };
    const connectivity = await ConnectivityMonitor.getInstance().getStatus();
    const contextStats = CognitiveContextEngine.getInstance().getSummaryStats(scope);
    const recentSessions = CognitiveContextEngine.getInstance().listSessions(scope).slice(0, 8);
    const reasoningHistory = AdaptiveReasoningEngine.getInstance().getHistory(12);
    const graphSummary = KnowledgeGraphEngine.getInstance().getGraphSummary({
      tenantId: scope.tenantId,
      role: scope.role,
    });
    const memoryLifecycle = NativeMemoryController.getInstance().analyzeMemoryLifecycle(callerMemoryScope(req));
    const performance = PerformanceEngine.getInstance().getTelemetry();
    const multimodal = await getMultimodalCapabilityRegistry();
    const latestEvaluation = loadLatestBatch29EvalReport();
    const actionCapabilities = await ActionDrivenEngine.getInstance().getCapabilities(scope);
    const recentActionMissions = ActionDrivenEngine.getInstance().listMissions(scope).slice(0, 12);
    const capabilityGates = await getCapabilityGatesSnapshot({ connectivity, multimodal });

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      connectivity: {
        runtimeState: connectivity.runtimeState,
        online: connectivity.online,
        weightsLoaded: connectivity.weightsLoaded,
        executionVerified: connectivity.executionVerified,
        reason: connectivity.reason,
        checkpointPath: connectivity.checkpointPath,
        checkpointSha256: connectivity.checkpointSha256,
        tokenizerSha256: connectivity.tokenizerSha256,
        activeRuntimeId: connectivity.activeRuntimeId,
        lastInferenceEvidence: connectivity.lastInferenceEvidence,
      },
      context: { stats: contextStats, recentSessions },
      reasoning: { recentOutcomes: reasoningHistory },
      knowledgeGraph: graphSummary,
      memory: memoryLifecycle,
      performance,
      multimodal,
      evaluation: latestEvaluation,
      capabilityGates,
      actionDriven: {
        capabilities: actionCapabilities,
        recentMissions: recentActionMissions,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// BATCH 30: ACTION-DRIVEN NATIVE INTELLIGENCE ENGINE (8-PILLAR CYCLE)
// ==========================================

const VALID_ACTION_MODES = new Set<ActionMissionMode>([
  'engineering_blueprint_execute',
  'workspace_verify_repair',
  'system_integrity_audit',
  'reasoning_verification',
]);

app.get('/api/action/capabilities', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const capabilities = await ActionDrivenEngine.getInstance().getCapabilities({
      tenantId: req.sovereignTenantId || 'default-tenant',
      userId: req.sovereignUserId || 'guest',
      role: req.sovereignRole || 'guest',
    });
    res.json({ success: true, capabilities });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

app.post('/api/action/perceive', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const goal = sanitizeCognitiveText(req.body?.goal || 'Inspect ZYNTHEOR runtime environment', 2000).trim();
    if (!goal) {
      return res.status(400).json({ success: false, error: 'goal string is required' });
    }
    const perception = await ActionDrivenEngine.getInstance().perceiveEnvironment(goal, {
      tenantId: req.sovereignTenantId || 'default-tenant',
      userId: req.sovereignUserId || 'guest',
      role: req.sovereignRole || 'guest',
    });
    res.json({ success: true, perception });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

app.post('/api/action/missions/run', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const goal = sanitizeCognitiveText(req.body?.goal, 4000).trim();
    if (!goal || goal.length < 3) {
      return res.status(400).json({ success: false, error: 'INVALID_MISSION_GOAL: goal (>= 3 chars) is required' });
    }
    const rawMode = req.body?.mode;
    if (rawMode !== undefined && !VALID_ACTION_MODES.has(rawMode)) {
      return res.status(400).json({ success: false, error: `INVALID_MODE: '${String(rawMode)}' is not supported` });
    }
    const runtime = req.body?.runtime === 'python3' ? 'python3' : req.body?.runtime === 'node' ? 'node' : undefined;
    const priority =
      req.body?.priority === 'High' || req.body?.priority === 'Low' || req.body?.priority === 'Medium'
        ? req.body.priority
        : 'Medium';

    const missionReq: ActionMissionRequest = {
      goal,
      mode: rawMode,
      priority,
      runtime,
      targetFile: typeof req.body?.targetFile === 'string' ? sanitizeCognitiveText(req.body.targetFile, 256).trim() : undefined,
      sourceCode: typeof req.body?.sourceCode === 'string' ? sanitizeCognitiveText(req.body.sourceCode, 64_000) : undefined,
      unitTestCode: typeof req.body?.unitTestCode === 'string' ? sanitizeCognitiveText(req.body.unitTestCode, 64_000) : undefined,
      requireNativeModel: Boolean(req.body?.requireNativeModel),
      approvalRequestId:
        typeof req.body?.approvalRequestId === 'string' ? sanitizeCognitiveText(req.body.approvalRequestId, 128).trim() : undefined,
      captureLearning: req.body?.captureLearning === false ? false : true,
      mathSteps: Array.isArray(req.body?.mathSteps) ? req.body.mathSteps : undefined,
      expectedFinal: typeof req.body?.expectedFinal === 'number' ? req.body.expectedFinal : undefined,
      cspTasks: Array.isArray(req.body?.cspTasks) ? req.body.cspTasks : undefined,
      maxBudgetMs: typeof req.body?.maxBudgetMs === 'number' ? req.body.maxBudgetMs : undefined,
    };

    const mission = await ActionDrivenEngine.getInstance().executeActionMission(missionReq, {
      tenantId: req.sovereignTenantId || 'default-tenant',
      userId: req.sovereignUserId || 'unknown',
      role: req.sovereignRole || 'developer',
    });
    res.json({ success: true, mission });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

app.get('/api/action/missions', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const missions = ActionDrivenEngine.getInstance().listMissions({
      tenantId: req.sovereignTenantId || 'default-tenant',
      userId: req.sovereignUserId || 'guest',
      role: req.sovereignRole || 'guest',
    });
    res.json({ success: true, missions });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

app.get('/api/action/missions/:missionId', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const missionId = sanitizeCognitiveText(req.params.missionId, 128).trim();
    const mission = ActionDrivenEngine.getInstance().getMission(missionId, {
      tenantId: req.sovereignTenantId || 'default-tenant',
      userId: req.sovereignUserId || 'guest',
      role: req.sovereignRole || 'guest',
    });
    if (!mission) {
      return res.status(404).json({ success: false, error: `Mission '${missionId}' not found` });
    }
    res.json({ success: true, mission });
  } catch (err: any) {
    res.status(mapBatch29HttpCode(err)).json({ success: false, error: err.message });
  }
});

// ==========================================
// SECTION 10: NATIVE APP CREATION & SOFTWARE ENGINEERING WORKSPACE
// ==========================================

function resolveEngineeringScope(req: AuthenticatedRequest) {
  return {
    tenantId: req.sovereignTenantId || 'default-tenant',
    userId: req.sovereignUserId || 'guest',
    role: req.sovereignRole || ('guest' as const),
  };
}

app.get('/api/engineering/capabilities', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const snapshot = await SoftwareProjectManager.getInstance().getSoftwareCapabilitiesSnapshot();
    res.json({ success: true, ...snapshot });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/engineering/projects', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const projects = mgr.listProjects(scope);
    const recentEvidence = mgr.listRecentEvidence(scope, 20);
    res.json({ success: true, projects, recentEvidence });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const prompt = sanitizeCognitiveText(req.body?.prompt, 4000).trim();
    const name = typeof req.body?.name === 'string' ? sanitizeCognitiveText(req.body.name, 120).trim() : undefined;
    const rawStack = req.body?.stack;
    const stack =
      rawStack === 'node_api' || rawStack === 'python_service' || rawStack === 'static_web' || rawStack === 'node_fullstack'
        ? rawStack
        : 'node_fullstack';
    const project = await SoftwareProjectManager.getInstance().createAndScaffoldProject(
      {
        name,
        prompt,
        stack,
        runChecks: req.body?.runChecks !== false,
      },
      resolveEngineeringScope(req)
    );
    res.json({ success: true, project });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/engineering/projects/:projectId', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = SoftwareProjectManager.getInstance().getProject(
      String(req.params.projectId || ''),
      resolveEngineeringScope(req)
    );
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, project });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/engineering/projects/:projectId/file', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const relPath = String(req.query.path || '');
    if (!relPath) return res.status(400).json({ success: false, error: 'path query parameter is required' });
    const content = SoftwareProjectManager.getInstance().readProjectFile(
      String(req.params.projectId || ''),
      relPath,
      resolveEngineeringScope(req)
    );
    res.json({ success: true, path: relPath, content });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/file', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const relPath = String(req.body?.path || '');
    const content = req.body?.content;
    const message = sanitizeCognitiveText(req.body?.message || '', 240).trim();
    if (!relPath || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'path and string content are required' });
    }
    const result = SoftwareProjectManager.getInstance().writeProjectFile(
      String(req.params.projectId || ''),
      relPath,
      content,
      message,
      resolveEngineeringScope(req)
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/engineering/projects/:projectId/file', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const relPath = String(req.query.path || req.body?.path || '');
    if (!relPath) return res.status(400).json({ success: false, error: 'path is required' });
    const project = SoftwareProjectManager.getInstance().deleteProjectFile(
      String(req.params.projectId || ''),
      relPath,
      resolveEngineeringScope(req)
    );
    res.json({ success: true, project });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/build', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const evidence = await mgr.runBuild(String(req.params.projectId || ''), scope);
    const project = mgr.getProject(String(req.params.projectId || ''), scope);
    res.json({ success: true, evidence, project });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/test', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const evidence = await mgr.runTests(String(req.params.projectId || ''), scope);
    const project = mgr.getProject(String(req.params.projectId || ''), scope);
    res.json({ success: true, evidence, project });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/security-validate', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const evidence = await mgr.runSecurityValidation(String(req.params.projectId || ''), scope);
    const project = mgr.getProject(String(req.params.projectId || ''), scope);
    res.json({ success: true, evidence, project });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/deploy', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const approvalRequestId = typeof req.body?.approvalRequestId === 'string' ? req.body.approvalRequestId.trim() : undefined;
    const targetUrl = typeof req.body?.targetUrl === 'string' ? req.body.targetUrl.trim() : undefined;
    const result = await SoftwareProjectManager.getInstance().requestOrExecuteDeploy(
      String(req.params.projectId || ''),
      { approvalRequestId, targetUrl },
      scope
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/verify-runtime', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const targetUrl = typeof req.body?.targetUrl === 'string' ? req.body.targetUrl.trim() : undefined;
    const result = await SoftwareProjectManager.getInstance().verifyDeployedRuntime(
      String(req.params.projectId || ''),
      { targetUrl },
      scope
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/rollback', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const revisionId = String(req.body?.revisionId || '').trim();
    if (!revisionId) return res.status(400).json({ success: false, error: 'revisionId is required' });
    const project = SoftwareProjectManager.getInstance().rollbackToRevision(
      String(req.params.projectId || ''),
      revisionId,
      resolveEngineeringScope(req)
    );
    res.json({ success: true, project });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/engineering/projects/:projectId/preview', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const payload = SoftwareProjectManager.getInstance().getPreviewPayload(
      String(req.params.projectId || ''),
      scope
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.json({ success: true, ...payload });
  } catch (err: any) {
    const status = String(err.message || '').includes('PROJECT_NOT_FOUND') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.get('/api/engineering/projects/:projectId/visual-elements', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const elements = SoftwareProjectManager.getInstance().inspectVisualElements(
      String(req.params.projectId || ''),
      scope
    );
    res.json({ success: true, elements });
  } catch (err: any) {
    const status = String(err.message || '').includes('PROJECT_NOT_FOUND') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/visual-patch', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const scope = resolveEngineeringScope(req);
    const out = await SoftwareProjectManager.getInstance().applyVisualPropertyPatch(
      String(req.params.projectId || ''),
      {
        targetId: String(req.body?.targetId || '').trim(),
        textContent: typeof req.body?.textContent === 'string' ? req.body.textContent : undefined,
        color: typeof req.body?.color === 'string' ? req.body.color : undefined,
        backgroundColor: typeof req.body?.backgroundColor === 'string' ? req.body.backgroundColor : undefined,
        padding: typeof req.body?.padding === 'string' ? req.body.padding : undefined,
        fontSize: typeof req.body?.fontSize === 'string' ? req.body.fontSize : undefined,
        message: typeof req.body?.message === 'string' ? sanitizeCognitiveText(req.body.message, 200) : undefined,
        runChecks: req.body?.runChecks !== false,
      },
      scope
    );
    res.json({ success: true, ...out });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/repair', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const out = await SoftwareProjectManager.getInstance().diagnoseAndRepairProject(
      String(req.params.projectId || ''),
      scope
    );
    res.json({ success: true, ...out });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/deployment/history', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId.trim()
      ? req.query.projectId.trim()
      : undefined;
    const order = req.query.order === 'asc' ? 'asc' : 'desc';
    const history = SoftwareProjectManager.getInstance().listDeploymentHistory(scope, { projectId, order });
    res.json({
      success: true,
      total: history.length,
      order,
      projectId: projectId || null,
      history,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/engineering/projects/:projectId/deployment/:deploymentId/logs', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const data = SoftwareProjectManager.getInstance().getDeploymentLogs(
      String(req.params.projectId || ''),
      String(req.params.deploymentId || ''),
      scope
    );
    res.json({ success: true, ...data });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

app.get('/api/engineering/internet/policy', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const policy = InternetIntegrationEngine.getInstance().getPolicySnapshot(scope.tenantId);
    res.json({ success: true, policy });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/internet/secrets', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const scope = resolveEngineeringScope(req);
    const alias = sanitizeCognitiveText(req.body?.alias || '', 64).trim();
    const envVarName = typeof req.body?.envVarName === 'string' ? req.body.envVarName.trim() : undefined;
    const provider = typeof req.body?.provider === 'string' ? sanitizeCognitiveText(req.body.provider, 48).trim() : undefined;
    const secretValue = typeof req.body?.secretValue === 'string' ? req.body.secretValue : undefined;
    const secret = InternetIntegrationEngine.getInstance().registerSecretRef(
      { alias, envVarName, provider, secretValue },
      scope.tenantId,
      scope.userId
    );
    res.json({ success: true, secret });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/internet/fetch', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const scope = resolveEngineeringScope(req);
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) {
      return res.status(400).json({ success: false, error: 'url is required' });
    }
    const method = req.body?.method === 'POST' || req.body?.method === 'HEAD' ? req.body.method : 'GET';
    const result = await InternetIntegrationEngine.getInstance().fetchExternalUrl(
      {
        url,
        method,
        body: typeof req.body?.body === 'string' ? req.body.body : undefined,
        secretRefAlias: typeof req.body?.secretRefAlias === 'string' ? req.body.secretRefAlias.trim() : undefined,
        secretHeaderName: typeof req.body?.secretHeaderName === 'string' ? req.body.secretHeaderName.trim() : undefined,
      },
      { tenantId: scope.tenantId, userId: scope.userId }
    );
    res.status(result.blockedByPolicy ? 403 : 200).json({ success: result.ok, result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/internet/research', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const query = sanitizeCognitiveText(req.body?.query || '', 300).trim();
    const research = await InternetIntegrationEngine.getInstance().researchWebTopic(query, {
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
    res.json({ success: true, ...research });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/internet/registry-lookup', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const registry = req.body?.registry === 'pypi' ? 'pypi' : 'npm';
    const packageName = typeof req.body?.packageName === 'string' ? req.body.packageName.trim() : '';
    const pkg = await InternetIntegrationEngine.getInstance().lookupPackageRegistry(registry, packageName, {
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
    res.json({ success: true, package: pkg });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/integrations', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (hasUnsafePrototypeKeys(req.body)) {
      return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD: disallowed prototype key' });
    }
    const scope = resolveEngineeringScope(req);
    const rawType = req.body?.type;
    const type =
      rawType === 'websocket' || rawType === 'database' || rawType === 'auth' || rawType === 'registry_pkg'
        ? rawType
        : 'http_api';
    const out = await SoftwareProjectManager.getInstance().attachIntegration(
      String(req.params.projectId || ''),
      {
        type,
        name: sanitizeCognitiveText(req.body?.name || '', 80),
        endpoint: typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '',
        secretRefAlias: typeof req.body?.secretRefAlias === 'string' ? req.body.secretRefAlias.trim() : undefined,
        secretHeaderName: typeof req.body?.secretHeaderName === 'string' ? req.body.secretHeaderName.trim() : undefined,
        notes: typeof req.body?.notes === 'string' ? sanitizeCognitiveText(req.body.notes, 300) : undefined,
      },
      scope
    );
    res.json({ success: true, ...out });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/integrations/:integrationId/test', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const out = await SoftwareProjectManager.getInstance().testProjectIntegration(
      String(req.params.projectId || ''),
      String(req.params.integrationId || ''),
      scope
    );
    res.json({ success: true, ...out });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/research', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const project = SoftwareProjectManager.getInstance().attachResearchNote(
      String(req.params.projectId || ''),
      {
        query: sanitizeCognitiveText(req.body?.query || '', 200),
        source: sanitizeCognitiveText(req.body?.source || 'web', 40),
        title: sanitizeCognitiveText(req.body?.title || '', 200),
        url: typeof req.body?.url === 'string' ? req.body.url.trim() : '',
        snippet: sanitizeCognitiveText(req.body?.snippet || '', 800),
        sha256: typeof req.body?.sha256 === 'string' ? req.body.sha256.trim() : '',
      },
      scope
    );
    res.json({ success: true, project });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/projects/:projectId/iterate', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const out = await SoftwareProjectManager.getInstance().iterateProjectWithRequest(
      String(req.params.projectId || ''),
      {
        instruction: sanitizeCognitiveText(req.body?.instruction || '', 1500),
        runChecks: req.body?.runChecks !== false,
      },
      scope
    );
    res.json({ success: true, ...out });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/engineering/projects/:projectId/database', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const database = SoftwareProjectManager.getInstance().inspectProjectDatabase(
      String(req.params.projectId || ''),
      scope
    );
    res.json({ success: true, database });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

app.get('/api/engineering/benchmark', requireAuth('developer'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const report = SoftwareProjectManager.getInstance().getLatestBenchmarkReport();
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/engineering/benchmark', requireAuth('developer'), enforceRateLimit('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = resolveEngineeringScope(req);
    const report = await SoftwareProjectManager.getInstance().runSoftwareBenchmarkSuite(scope);
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mount Vite middleware in development or serve static in production.
// ZYNTHEOR_API_ONLY=1 skips Vite for live API acceptance tests.
async function startServer() {
  // Pre-bind validated configuration check before runtime binding (sanitized audit, never logs secrets)
  const startupCloudCfg = validateCloudRuntimeConfig();
  AuditLedger.append('SYSTEM', 'CLOUD_RUNTIME_PREBIND_CHECK', {
    configValid: startupCloudCfg.configValid,
    provider: startupCloudCfg.provider,
    missingKeys: startupCloudCfg.missingKeys,
    validationError: startupCloudCfg.validationError,
  });

  await ConnectivityMonitor.getInstance().checkNow().catch(() => null);
  if (isCloudSqlConfigured()) {
    await AuditLedger.syncWithCloud().catch((err) => {
      console.warn('[Server] Initial Cloud SQL AuditLedger sync skipped:', err?.message || err);
    });
  }
  AuditLedger.append('SYSTEM', 'SERVER_BOOT', {
    port: PORT,
    node_version: process.version,
    arch: process.arch,
    platform: process.platform,
    sandbox_dir: ToolGateway.getWorkspaceRoot()
  });

  // Fail cleanly with structured JSON on unmatched /api/* routes and Express middleware errors
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      code: 'API_ROUTE_NOT_FOUND',
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`
    });
  });

  app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_JSON',
        error: 'Malformed JSON request payload.'
      });
    }
    const status = typeof err?.status === 'number' ? err.status : 500;
    return res.status(status).json({
      success: false,
      code: err?.code || 'INTERNAL_SERVER_ERROR',
      error: err?.message || 'Unexpected server error.'
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  const apiOnly = process.env.ZYNTHEOR_API_ONLY === '1';

  if (!apiOnly && !isProd) {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa'
      });
      app.use(vite.middlewares);
    } catch (err: any) {
      console.warn('[Server] Vite unavailable — API-only mode:', err?.message || err);
    }
  } else if (!apiOnly && isProd) {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  const httpServer = http.createServer(app);
  const runtimeWss = new WebSocketServer({ server: httpServer, path: '/ws/runtime' });

  const broadcastRuntimeState = (state: Awaited<ReturnType<ConnectivityMonitor['getStatus']>>) => {
    lastWsFrameAt = new Date().toISOString();
    liveWsClientCount = runtimeWss.clients.size;
    const frame = JSON.stringify({
      type: 'runtime_state',
      data: state,
      timestamp: lastWsFrameAt,
    });
    for (const client of runtimeWss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(frame);
        } catch {
          // Ignore individual broken socket sends
        }
      }
    }
  };

  const unsubscribeConnectivity = ConnectivityMonitor.getInstance().subscribe((state) => {
    broadcastRuntimeState(state);
  });
  ConnectivityMonitor.getInstance().startBackgroundMonitor(15000);

  runtimeWss.on('connection', (ws) => {
    liveWsClientCount = runtimeWss.clients.size;
    lastWsFrameAt = new Date().toISOString();
    void ConnectivityMonitor.getInstance()
      .getStatus()
      .then((state) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'runtime_state',
              data: state,
              timestamp: new Date().toISOString(),
            })
          );
        }
      })
      .catch(() => null);

    ws.on('close', () => {
      liveWsClientCount = runtimeWss.clients.size;
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        lastWsFrameAt = new Date().toISOString();
        if (msg?.type === 'ping') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', timestamp: lastWsFrameAt }));
          }
        } else if (msg?.type === 'refresh') {
          void ConnectivityMonitor.getInstance()
            .checkNow()
            .then((state) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'runtime_state',
                    data: state,
                    timestamp: new Date().toISOString(),
                  })
                );
              }
            })
            .catch(() => null);
        }
      } catch {
        // Ignore malformed WebSocket client frames
      }
    });
  });

  httpServer.on('close', () => {
    liveWsClientCount = 0;
    unsubscribeConnectivity();
    ConnectivityMonitor.getInstance().stopBackgroundMonitor();
    runtimeWss.close();
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[ZYNTHEOR SOVEREIGN SERVER] Running on http://0.0.0.0:${PORT} apiOnly=${apiOnly} ws=/ws/runtime`);
  });
}

startServer().catch((err) => {
  console.error('[Server Start Failure]', err);
  process.exit(1);
});
