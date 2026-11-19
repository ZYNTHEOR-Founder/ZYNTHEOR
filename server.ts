/**
 * ZYNTHEOR Sovereign Server
 * Express backend with Vite middleware mounting on port 3000.
 * Zero external AI APIs. 100% First-party sovereign native neural bridge and sandbox execution.
 */

import express, { Request, Response, NextFunction } from 'express';
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
import {
  ConnectivityMonitor,
  ConnectivityRequiredError,
  validateCloudUrl,
  probeCloudRuntimeEndpoint,
} from './lib/ConnectivityMonitor';
import {
  publishCheckpointBufferToCloud,
  getCloudSecretsSnapshot,
  persistCloudSecretsToEnv,
  clearCloudSecretKey,
  verifyS3BucketReachability,
  parseCheckpointBuffer,
} from './lib/CloudCheckpointStorage';
import { CloudObjectStorageService } from './lib/CloudObjectStorageService';
import {
  fetchVerifyAndLoad41MCheckpoint,
  verifyCheckpointBufferFor41M,
  TARGET_41M_PARAM_COUNT,
} from './lib/Cloud41MCheckpointVerifier';
import {
  probeNativeNumpyEnvironment,
  establishNativeNumpyEnvironment,
  initializeTrainingPipeline,
  loadLastInitializedTrainingPipeline,
  getTrainingLoopExecutionStatus,
  getTrainingPipelineStatusSummary,
  startInitializedTrainingLoop,
  resolveConfiguredApprovalKeyFile,
} from './lib/NativeNumpyTrainingService';
import { TaskOrchestrator, normalizeTaskPriority } from './lib/TaskOrchestrator';
import { ActionDrivenEngine } from './lib/ActionDrivenEngine';
import { AutonomousPlanner } from './lib/AutonomousPlanner';
import { ApprovalGate } from './lib/ApprovalGate';
import { CognitiveContextEngine } from './lib/CognitiveContextEngine';
import { CognitiveCore } from './lib/CognitiveCore';
import { AdaptiveReasoningEngine } from './lib/AdaptiveReasoningEngine';
import { KnowledgeGraphEngine } from './lib/KnowledgeGraphEngine';
import { PerformanceEngine } from './lib/PerformanceEngine';
import { ContinuousLearningPipeline } from './lib/ContinuousLearningPipeline';
import {
  buildSevenPhaseStatus,
  getPhaseDefinition,
  harvestPhase7Errors,
} from './lib/TrainingCurriculum';
import { SelfEvaluationEngine } from './lib/SelfEvaluationEngine';
import {
  runBatch29Evaluation,
  loadLatestBatch29EvalReport,
  assertNoManualScoreInjection,
} from './lib/CognitiveEvaluationLab';
import { getCapabilityGatesSnapshot } from './lib/CapabilityGates';
import { getMultimodalCapabilityRegistry } from './lib/MultimodalInterfaces';
import { ToolRegistry } from './lib/ToolRegistry';
import { buildTruthDashboardSnapshot } from './lib/DashboardTruth';
import { InternetIntegrationEngine } from './lib/InternetIntegrationEngine';
import { AuditLedger } from './lib/AuditLedger';
import { ToolGateway } from './lib/ToolGateway';
import { CommercialManager, LaunchPhase } from './lib/CommercialManager';
import { NativeMemoryController } from './lib/NativeMemoryController';
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
import { requireFirebaseAuth, type AuthRequest } from './src/middleware/auth';
import { BenchmarkRunner } from './server/benchmarks/runner';
import {
  SoftwareProjectManager,
  type EngineeringScope,
} from './lib/SoftwareProjectManager';
import {
  runUpgradedAssistant,
  isAssistantConfigured,
  getAssistantModelName,
  getAssistantBrainStatus,
  syncAssistantSessionContext,
  getAssistantSessionMemoryInfo,
  clearAssistantSessionMemory,
  type AssistantThinkingMode,
} from './server/assistant';

const execFileAsync = promisify(execFile);
const portArgIdx = process.argv.indexOf('--port');
const cliPort = portArgIdx >= 0 ? Number(process.argv[portArgIdx + 1]) : NaN;
const PORT = (Number.isFinite(cliPort) && cliPort > 0 ? cliPort : Number(process.env.PORT)) || 3000;
const app = express();

function hasDangerousProtoKeyInObject(obj: unknown, seen = new Set<unknown>()): boolean {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return false;
  seen.add(obj);
  if (Array.isArray(obj)) {
    return obj.some((item) => hasDangerousProtoKeyInObject(item, seen));
  }
  const ownKeys = Object.getOwnPropertyNames(obj);
  for (const key of ownKeys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    const val = (obj as Record<string, unknown>)[key];
    if (hasDangerousProtoKeyInObject(val, seen)) return true;
  }
  return false;
}

app.use(
  express.json({
    limit: '10mb',
    verify: (_req, _res, buf) => {
      const raw = buf.toString('utf8');
      if (/"(?:__proto__|constructor|prototype)"\s*:/.test(raw)) {
        const err = new Error('PROTOTYPE_POLLUTION_BLOCKED: Disallowed JSON key detected');
        (err as any).status = 400;
        (err as any).code = 'PROTOTYPE_POLLUTION_BLOCKED';
        throw err;
      }
    },
  })
);

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err && (err.code === 'PROTOTYPE_POLLUTION_BLOCKED' || err.status === 400 || err.type === 'entity.parse.failed')) {
    return res.status(400).json({
      success: false,
      code: err.code || 'BAD_REQUEST',
      error: err.message || 'Invalid JSON payload',
    });
  }
  return next(err);
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.body && hasDangerousProtoKeyInObject(req.body)) {
    return res.status(400).json({
      success: false,
      code: 'PROTOTYPE_POLLUTION_BLOCKED',
      error: 'Disallowed prototype key in payload',
    });
  }
  const reqStart = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      apiSamples.push(Math.max(1, Date.now() - reqStart));
      if (apiSamples.length > 100) apiSamples.shift();
    }
  });
  return next();
});

// Safe CORS middleware enabling Capacitor Android WebView (`https://localhost`, `capacitor://localhost`)
// and configured remote origins without unsafe wildcard credential exposure.
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    const extraOrigins = (process.env.ZYNTHEOR_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const isCapacitorOrLocal =
      origin === 'capacitor://localhost' ||
      origin === 'ionic://localhost' ||
      /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/i.test(origin);
    const isExplicitlyAllowed =
      extraOrigins.includes('*') || extraOrigins.includes(origin);

    if (isCapacitorOrLocal || isExplicitlyAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-zyntheor-tenant, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

const apiSamples: number[] = [];
let wsClientCount = 0;
let wsLastFrameAt: string | null = null;

function requireRole(allowedRoles: Array<'User' | 'Developer' | 'Administrator'>) {
  const rank: Record<string, number> = { User: 1, Developer: 2, Administrator: 3 };
  let lowest: 'User' | 'Developer' | 'Administrator' = allowedRoles[0] || 'User';
  for (const r of allowedRoles) {
    if ((rank[r] || 0) < (rank[lowest] || 0)) lowest = r;
  }
  const minSovereign = UI_TO_SOVEREIGN[lowest];
  return requireAuth(minSovereign);
}

// Log server start in AuditLedger
AuditLedger.append('SYSTEM', 'SERVER_BOOT', {
  port: PORT,
  node_version: process.version,
  arch: process.arch,
  platform: process.platform,
  sandbox_dir: ToolGateway.getWorkspaceRoot()
});

// Resource history buffer using authentic OS and measured inference telemetry (null until measured)
let lastRecordedTokensPerSec: number | null = null;
let lastRecordedLatencyMs: number | null = null;

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
    telemetryStatus: lastRecordedLatencyMs !== null ? 'MEASURED' : 'UNAVAILABLE',
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

// 0. Lightweight Health Check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    apiOnly: process.env.ZYNTHEOR_API_ONLY === '1',
    sovereign: true,
    version: '1.0.0'
  });
});

// Online Cloud Runtime readiness via ConnectivityMonitor.
app.get('/api/connectivity/health', async (_req: Request, res: Response) => {
  try {
    const state = await ConnectivityMonitor.getInstance().checkNow();
    const pingSnap = ConnectivityMonitor.getInstance().getLastPingResult();
    res.status(state.online ? 200 : 503).json({
      success: state.online,
      ...state,
      inferenceReady: Boolean(state.online && state.weightsLoaded && state.executionVerified),
      activeParams: Number(pingSnap?.active_params || 0),
      targetParams: pingSnap?.target_params ?? null,
      sourceUri: state.cloudSourceUri,
    });
  } catch (err: any) {
    res.status(503).json({
      success: false,
      online: false,
      onlineConnectivityRequired: true,
      weightsLoaded: false,
      inferenceReady: false,
      runtimeState: 'BLOCKED',
      code: 'FAIL_CLOSED',
      status: 'ONLINE_CONNECTIVITY_REQUIRED',
      reason: `FAIL_CLOSED: Online Connectivity Required — ${err.message}`,
    });
  }
});

app.post('/api/connectivity/reconnect', async (req: Request, res: Response) => {
  try {
    const presignedUrl = req.body?.presignedUrl;
    const objectKey = req.body?.objectKey;
    if (presignedUrl !== undefined && (typeof presignedUrl !== 'string' || presignedUrl.length > 4096)) {
      return res.status(400).json({ success: false, code: 'INVALID_URL', error: 'presignedUrl must be a valid URL string.' });
    }
    const state = await ConnectivityMonitor.getInstance().reconnect(presignedUrl, objectKey);
    const pingSnap = ConnectivityMonitor.getInstance().getLastPingResult();
    if (!state.online || !state.weightsLoaded || !state.executionVerified) {
      return res.status(503).json({
        success: false,
        ...state,
        online: false,
        weightsLoaded: state.weightsLoaded,
        inferenceReady: false,
        error: state.reason,
      });
    }
    AuditLedger.append('SYSTEM', 'CLOUD_RUNTIME_CHECKPOINT_LOADED', {
      sourceUri: state.cloudSourceUri,
      checkpointSha256: state.checkpointSha256,
      activeParams: pingSnap?.active_params || 0,
    });
    return res.json({
      success: true,
      ...state,
      online: true,
      onlineConnectivityRequired: false,
      weightsLoaded: true,
      inferenceReady: true,
      runtimeState: 'READY',
      activeParams: Number(pingSnap?.active_params || 0),
      sourceUri: state.cloudSourceUri,
    });
  } catch (err: any) {
    const error = String(err?.message || err);
    return res.status(503).json({
      success: false,
      online: false,
      onlineConnectivityRequired: true,
      weightsLoaded: false,
      inferenceReady: false,
      runtimeState: 'FAILED',
      code: 'FAIL_CLOSED',
      reason: error,
      error,
    });
  }
});

// 0b. Real End-to-End 6-Stage Online Verification & 8-Subsystem Compliance Matrix
app.post('/api/connectivity/verify-e2e', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const presignedUrl = typeof req.body?.presignedUrl === 'string' ? req.body.presignedUrl.trim() : undefined;
    const objectKey = typeof req.body?.objectKey === 'string' ? req.body.objectKey.trim() : undefined;
    const testPrompt = typeof req.body?.testPrompt === 'string' ? req.body.testPrompt.trim() : undefined;
    if (presignedUrl && presignedUrl.length > 4096) {
      return res.status(400).json({ success: false, code: 'INVALID_URL', error: 'presignedUrl is too long.' });
    }
    const report = await ConnectivityMonitor.getInstance().runEndToEndVerification({
      presignedUrl,
      objectKey,
      testPrompt,
    });
    AuditLedger.append('SYSTEM', 'CONNECTIVITY_E2E_VERIFICATION', {
      userId: req.sovereignUserId,
      overallStatus: report.overallStatus,
      onlineReady: report.onlineReady,
      internetConnected: report.internetConnected,
      cloudConnected: report.cloudConnected,
      checkpointVerified: report.checkpointVerified,
      inferenceVerified: report.inferenceVerified,
      totalLatencyMs: report.totalLatencyMs,
    });
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.get('/api/connectivity/diagnostics', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const state = await ConnectivityMonitor.getInstance().checkNow();
    res.json({ success: true, connectivity: state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

async function handleCloudRuntimeProbe(req: Request, res: Response) {
  try {
    const rawOverride =
      typeof req.body?.cloudRuntimeUrl === 'string'
        ? req.body.cloudRuntimeUrl
        : typeof req.query?.url === 'string'
          ? req.query.url
          : undefined;
    if (rawOverride !== undefined && rawOverride.length > 2048) {
      return res.status(400).json({ success: false, error: 'cloudRuntimeUrl exceeds maximum length.' });
    }
    const [probe, connectivity] = await Promise.all([
      probeCloudRuntimeEndpoint(rawOverride),
      ConnectivityMonitor.getInstance().getStatus(),
    ]);
    return res.json({
      success: true,
      probe,
      localHealth: {
        apiHealthStatus: 200,
        connectivityHealthStatus: connectivity.online ? 200 : 503,
        connectivityReason: connectivity.reason,
        runtimeState: connectivity.runtimeState,
        cloudStorageConfigured: connectivity.cloudStorageConfigured,
        cloudStorageReachable: connectivity.cloudStorageReachable,
        weightsLoaded: connectivity.weightsLoaded,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to execute active CLOUD_RUNTIME_URL probe.',
    });
  }
}

app.get('/api/connectivity/cloud-runtime-probe', handleCloudRuntimeProbe);
app.post('/api/connectivity/cloud-runtime-probe', handleCloudRuntimeProbe);

// 0c. Settings > Secrets (Persistent Cloud Runtime & Object Storage Env Configuration)
app.get('/api/settings/secrets', requireRole(['Developer', 'Administrator']), (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({
      success: true,
      ...getCloudSecretsSnapshot(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.put('/api/settings/secrets', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawPayload = req.body?.secrets && typeof req.body.secrets === 'object' ? req.body.secrets : req.body;
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      return res.status(400).json({ success: false, error: 'Secrets payload must be a key-value object.' });
    }
    const { updatedKeys, clearedKeys, snapshot } = persistCloudSecretsToEnv(rawPayload);
    const monitor = ConnectivityMonitor.getInstance();
    if (updatedKeys.includes('CHECKPOINT_PRESIGNED_URL') || clearedKeys.includes('CHECKPOINT_PRESIGNED_URL')) {
      monitor.setPresignedUrlOverride(process.env.CHECKPOINT_PRESIGNED_URL || undefined);
    }

    AuditLedger.append('GOVERNANCE', 'CLOUD_SECRETS_UPDATED', {
      userId: req.sovereignUserId || 'unknown',
      role: req.sovereignRole || 'unknown',
      updatedKeys,
      clearedKeys,
      configValid: snapshot.configValid,
      provider: snapshot.provider,
    });

    const connectivity = await monitor.reconnect(
      process.env.CHECKPOINT_PRESIGNED_URL || undefined,
      process.env.S3_CHECKPOINT_KEY || undefined
    );

    return res.json({
      success: true,
      updatedKeys,
      clearedKeys,
      snapshot,
      connectivity,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err?.message || 'Failed to save cloud secrets configuration.',
    });
  }
});

app.delete('/api/settings/secrets/:key', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const key = String(req.params.key || '').trim();
    const { cleared, snapshot } = clearCloudSecretKey(key);
    const monitor = ConnectivityMonitor.getInstance();
    if (key === 'CHECKPOINT_PRESIGNED_URL') {
      monitor.setPresignedUrlOverride(undefined);
    }

    AuditLedger.append('GOVERNANCE', 'CLOUD_SECRET_CLEARED', {
      userId: req.sovereignUserId || 'unknown',
      role: req.sovereignRole || 'unknown',
      key,
      cleared,
    });

    const connectivity = await monitor.checkNow();
    return res.json({
      success: true,
      key,
      cleared,
      snapshot,
      connectivity,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err?.message || 'Failed to clear cloud configuration key.',
    });
  }
});

app.post('/api/settings/s3/verify', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const result = await verifyS3BucketReachability({
      S3_BUCKET: typeof raw.S3_BUCKET === 'string' ? raw.S3_BUCKET : undefined,
      S3_REGION: typeof raw.S3_REGION === 'string' ? raw.S3_REGION : undefined,
      S3_ENDPOINT: typeof raw.S3_ENDPOINT === 'string' ? raw.S3_ENDPOINT : undefined,
      S3_ACCESS_KEY_ID: typeof raw.S3_ACCESS_KEY_ID === 'string' ? raw.S3_ACCESS_KEY_ID : undefined,
      S3_SECRET_ACCESS_KEY: typeof raw.S3_SECRET_ACCESS_KEY === 'string' ? raw.S3_SECRET_ACCESS_KEY : undefined,
      S3_CHECKPOINT_KEY: typeof raw.S3_CHECKPOINT_KEY === 'string' ? raw.S3_CHECKPOINT_KEY : undefined,
      S3_FORCE_PATH_STYLE:
        typeof raw.S3_FORCE_PATH_STYLE === 'string' || typeof raw.S3_FORCE_PATH_STYLE === 'boolean'
          ? raw.S3_FORCE_PATH_STYLE
          : undefined,
    });

    AuditLedger.append('GOVERNANCE', 'S3_BUCKET_REACHABILITY_CHECK', {
      userId: req.sovereignUserId || 'unknown',
      role: req.sovereignRole || 'unknown',
      bucket: result.bucket,
      region: result.region,
      endpoint: result.endpoint,
      bucketReachable: result.bucketReachable,
      objectExists: result.objectExists,
      httpStatusCode: result.httpStatusCode,
      latencyMs: result.latencyMs,
      errorCode: result.errorCode,
    });

    return res.json({
      success: true,
      result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to validate S3 bucket reachability.',
    });
  }
});

// 0d. Cloud Object Storage Service Layer (Configuration, R/W Probe, Artifact Listing)
app.get('/api/storage/config', requireRole(['Developer', 'Administrator']), (_req: AuthenticatedRequest, res: Response) => {
  try {
    return res.json({
      success: true,
      ...CloudObjectStorageService.getConfigurationStatus(),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.post('/api/storage/config', requireRole(['Developer', 'Administrator']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const result = CloudObjectStorageService.configureConnection({
      S3_BUCKET: typeof raw.S3_BUCKET === 'string' ? raw.S3_BUCKET : undefined,
      S3_REGION: typeof raw.S3_REGION === 'string' ? raw.S3_REGION : undefined,
      S3_ENDPOINT: typeof raw.S3_ENDPOINT === 'string' ? raw.S3_ENDPOINT : undefined,
      S3_CHECKPOINT_KEY: typeof raw.S3_CHECKPOINT_KEY === 'string' ? raw.S3_CHECKPOINT_KEY : undefined,
      S3_FORCE_PATH_STYLE:
        typeof raw.S3_FORCE_PATH_STYLE === 'string' || typeof raw.S3_FORCE_PATH_STYLE === 'boolean'
          ? raw.S3_FORCE_PATH_STYLE
          : undefined,
      S3_ACCESS_KEY_ID: typeof raw.S3_ACCESS_KEY_ID === 'string' ? raw.S3_ACCESS_KEY_ID : undefined,
      S3_SECRET_ACCESS_KEY: typeof raw.S3_SECRET_ACCESS_KEY === 'string' ? raw.S3_SECRET_ACCESS_KEY : undefined,
      CHECKPOINT_PRESIGNED_URL: typeof raw.CHECKPOINT_PRESIGNED_URL === 'string' ? raw.CHECKPOINT_PRESIGNED_URL : undefined,
      CHECKPOINT_UPLOAD_URL: typeof raw.CHECKPOINT_UPLOAD_URL === 'string' ? raw.CHECKPOINT_UPLOAD_URL : undefined,
    });
    return res.json({
      success: true,
      ...result,
      status: CloudObjectStorageService.getConfigurationStatus(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err?.message || 'Failed to configure Cloud Object Storage.',
    });
  }
});

app.post('/api/storage/test-connection', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const result = await CloudObjectStorageService.testBucketConnection({
      verifyReadWrite: raw.verifyReadWrite !== false,
      objectKey: typeof raw.objectKey === 'string' ? raw.objectKey.trim() : undefined,
      listPrefix: typeof raw.listPrefix === 'string' ? raw.listPrefix.trim() : undefined,
      overrides: raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : undefined,
    });
    return res.json({
      success: true,
      result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to execute Cloud Object Storage read/write test.',
    });
  }
});

app.get('/api/storage/preflight', async (req: Request, res: Response) => {
  try {
    const objectKey = typeof req.query?.objectKey === 'string' ? req.query.objectKey.trim() : undefined;
    const report = await CloudObjectStorageService.runCloudPreflight({
      objectKey: objectKey || undefined,
      verifyReadWrite: false,
      silent: true,
    });
    return res.json({
      success: report.passed,
      report,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to inspect Cloud Preflight status.',
    });
  }
});

app.post('/api/storage/preflight', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const report = await CloudObjectStorageService.runCloudPreflight({
      objectKey: typeof raw.objectKey === 'string' ? raw.objectKey.trim() : undefined,
      verifyReadWrite: raw.verifyReadWrite !== false,
      overrides: raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : undefined,
    });
    return res.status(report.passed ? 200 : 409).json({
      success: report.passed,
      report,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to execute Cloud Preflight validation.',
    });
  }
});

app.get('/api/storage/artifacts', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prefix = typeof req.query?.prefix === 'string' ? req.query.prefix : 'checkpoints/';
    const artifacts = await CloudObjectStorageService.listCheckpointArtifacts(prefix);
    return res.json({
      success: true,
      prefix,
      artifacts,
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    return res.status(msg.includes('FAIL_CLOSED') ? 503 : 500).json({
      success: false,
      error: msg,
    });
  }
});

app.post('/api/storage/sync-init-checkpoint', requireRole(['Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const localRel =
      typeof body.localPath === 'string' && body.localPath.trim()
        ? body.localPath.trim()
        : path.join('native_data', 'model_checkpoint_target_41m.pt');
    const localAbs = path.resolve(process.cwd(), localRel);
    const workspaceRoot = path.resolve(process.cwd());
    if (!localAbs.startsWith(workspaceRoot + path.sep)) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN: Checkpoint path escapes workspace root.' });
    }
    if (!fs.existsSync(localAbs)) {
      return res.status(404).json({
        success: false,
        error: `FAIL_CLOSED: Initialization checkpoint not found at '${localRel}'. Run scripts/init_target_checkpoint.py first.`,
      });
    }
    const cloudCfg = CloudObjectStorageService.getConfigurationStatus();
    if (!cloudCfg.s3Configured) {
      return res.status(503).json({
        success: false,
        error: 'FAIL_CLOSED: Cloud Object Storage S3 credentials missing (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).',
        missingKeys: cloudCfg.missingKeys,
      });
    }
    const buffer = fs.readFileSync(localAbs);
    const parsed = parseCheckpointBuffer(buffer, localRel);
    if (parsed.weightsFloat32.length !== TARGET_41M_PARAM_COUNT) {
      return res.status(422).json({
        success: false,
        error: `FAIL_CLOSED: Parameter count mismatch (${parsed.weightsFloat32.length} != ${TARGET_41M_PARAM_COUNT}).`,
      });
    }
    const objectKey =
      typeof body.objectKey === 'string' && body.objectKey.trim()
        ? body.objectKey.trim()
        : cloudCfg.checkpointKey;
    const uploaded = await CloudObjectStorageService.writeCheckpointArtifact(buffer, {
      objectKey,
      modelKey: 'target_41m_init_step0',
    });
    AuditLedger.append('SYSTEM', 'INIT_CHECKPOINT_SYNCED_TO_S3', {
      userId: req.sovereignUserId,
      localRel,
      objectKey,
      sourceUri: uploaded.sourceUri,
      payloadSha256: uploaded.payloadSha256,
      containerSha256: uploaded.containerSha256,
      totalParams: uploaded.totalParams,
      byteSize: uploaded.byteSize,
    });
    return res.json({
      success: true,
      uploaded,
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    return res.status(msg.includes('FAIL_CLOSED') ? 503 : 500).json({
      success: false,
      error: msg,
    });
  }
});

// 0e. 41.5M Cloud Checkpoint Fetch + SHA-256 + Parameter Count Verification & Runtime Loader
app.post('/api/model/fetch-verify-41m', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = req.body && typeof req.body === 'object' ? req.body : {};
    const presignedUrl = typeof raw.presignedUrl === 'string' && raw.presignedUrl.trim() ? raw.presignedUrl.trim() : undefined;
    const objectKey = typeof raw.objectKey === 'string' && raw.objectKey.trim() ? raw.objectKey.trim() : undefined;
    const expectedSha256 = typeof raw.expectedSha256 === 'string' && raw.expectedSha256.trim() ? raw.expectedSha256.trim() : undefined;
    const verifyOnly = raw.verifyOnly === true;

    const outcome = await fetchVerifyAndLoad41MCheckpoint({
      objectKey,
      presignedUrl,
      expectedSha256,
      verifyOnly,
    });
    return res.status(outcome.success ? 200 : outcome.stage === 'FETCH' ? 503 : 409).json(outcome);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      stage: 'FETCH',
      runtimeLoaded: false,
      error: err?.message || String(err),
    });
  }
});

// 1. System Status API
app.get('/api/system/status', async (_req: Request, res: Response) => {
  try {
    sampleResources();
    const monitor = ConnectivityMonitor.getInstance();
    const [connectivity, cloudPreflight] = await Promise.all([
      monitor.checkNow(),
      CloudObjectStorageService.runCloudPreflight({ verifyReadWrite: false, silent: true }).catch(() => null),
    ]);
    const provider = NativeNeuralLMProvider.getInstance();
    const pingRes = monitor.getLastPingResult() || (await provider.ping());
    const integrity = AuditLedger.verifyIntegrity();
    const commercial = CommercialManager.getInstance().getMetrics();
    const files = ToolGateway.listFiles();
    const lastEvidence = provider.getLastInferenceEvidence();

    res.json({
      success: true,
      connectivity,
      cloudPreflight,
      model: {
        name: pingRes.model_name,
        architecture: pingRes.architecture,
        totalParams: pingRes.total_params,
        checkpointHash: pingRes.checkpoint_hash,
        checkpointPath: connectivity.checkpointPath,
        checkpointSha256: connectivity.checkpointSha256,
        tokenizerSha256: connectivity.tokenizerSha256,
        activeRuntimeId: connectivity.activeRuntimeId,
        lastInferenceEvidence: lastEvidence,
        weightsLoaded: connectivity.weightsLoaded,
        activeParams:
          connectivity.weightsLoaded && connectivity.executionVerified && connectivity.runtimeState === 'READY'
            ? pingRes.active_params
            : null,
        targetParams: pingRes.target_params ?? null,
        inferenceReady: connectivity.online && connectivity.executionVerified,
        runtimeState: connectivity.runtimeState,
        readinessReason: connectivity.reason,
      },
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
      training: getTrainingPipelineStatusSummary(),
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime())
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
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

app.get('/api/system/training-readiness', async (_req: Request, res: Response) => {
  const checkedAt = new Date().toISOString();
  const envProbe = await probeNativeNumpyEnvironment();

  let pythonRssMb: number | null = null;
  let seqLmImportable = false;
  if (envProbe.pythonAvailable && envProbe.pythonExecutable) {
    try {
      const { stdout } = await execFileAsync(
        envProbe.pythonExecutable,
        [
          '-B',
          '-c',
          [
            'import json',
            'rss_mb = None',
            'try:',
            '  import resource',
            '  rss_mb = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 2)',
            'except Exception:',
            '  pass',
            'seq_lm_ok = False',
            'try:',
            '  import qplus_native.seq_lm',
            '  seq_lm_ok = True',
            'except Exception:',
            '  seq_lm_ok = False',
            'print(json.dumps({"pythonRssMb": rss_mb, "seqLmImportable": seq_lm_ok}))',
          ].join('\n'),
        ],
        { cwd: process.cwd(), timeout: 5000 }
      );
      const parsed = JSON.parse(stdout.trim() || '{}');
      if (typeof parsed.pythonRssMb === 'number') pythonRssMb = parsed.pythonRssMb;
      seqLmImportable = Boolean(parsed.seqLmImportable);
    } catch {
      // Optional RSS / seq_lm diagnostic probe
    }
  }

  const pythonBackend = {
    pythonAvailable: envProbe.pythonAvailable,
    pythonVersion: envProbe.pythonVersion,
    pythonExecutable: envProbe.pythonExecutable,
    numpyAvailable: envProbe.numpyAvailable,
    numpyVersion: envProbe.numpyVersion,
    numpyModuleFile: envProbe.numpyModuleFile,
    boto3Available: Boolean(envProbe.boto3Available),
    boto3Version: envProbe.boto3Version ?? null,
    float32Verified: envProbe.float32Verified,
    npCompatAvailable: envProbe.npCompatAvailable,
    seqLmImportable,
    pythonRssMb,
    backendMode: envProbe.numpyAvailable
      ? 'NUMPY_NATIVE'
      : envProbe.pythonAvailable
        ? 'NUMPY_MISSING_BLOCKED'
        : 'UNAVAILABLE',
    target41mNumpyGate: envProbe.numpyAvailable && envProbe.float32Verified ? 'READY' : 'BLOCKED',
    probeLatencyMs: envProbe.probeLatencyMs,
    error: envProbe.error,
  };

  // Memory usage (OS + Node + Python)
  const mem = process.memoryUsage();
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
  const usedMemMb = Math.max(0, totalMemMb - freeMemMb);
  const memory = {
    systemTotalMb: totalMemMb,
    systemUsedMb: usedMemMb,
    systemFreeMb: freeMemMb,
    systemUsedPct: totalMemMb > 0 ? +((usedMemMb / totalMemMb) * 100).toFixed(1) : 0,
    nodeHeapUsedMb: +(mem.heapUsed / (1024 * 1024)).toFixed(1),
    nodeHeapTotalMb: +(mem.heapTotal / (1024 * 1024)).toFixed(1),
    nodeRssMb: +(mem.rss / (1024 * 1024)).toFixed(1),
    pythonRssMb,
  };

  // Gradient stability metrics from recorded training evidence & pipeline runs
  const evidenceSources = [
    { rel: 'docs/target-training-evidence.json', label: 'Target 41.5M Training Evidence' },
    { rel: 'docs/archive/legacy/artifacts/lm-v2-training-evidence.json', label: 'LM v2 Training Evidence' },
  ];

  let gradPoints: Array<{
    step: number;
    gradNorm: number;
    trainLoss: number | null;
    valLoss: number | null;
    lr: number | null;
  }> = [];
  let sourceArtifact: string | null = null;
  let bestValLoss: number | null = null;

  for (const src of evidenceSources) {
    const abs = path.resolve(process.cwd(), src.rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
      const hist = Array.isArray(raw?.history)
        ? raw.history
        : Array.isArray(raw?.runs?.[0]?.history)
          ? raw.runs[0].history
          : [];
      const extracted = hist
        .filter((h: any) => typeof h?.grad_norm === 'number')
        .map((h: any) => ({
          step: Number(h.step ?? 0),
          gradNorm: Number(h.grad_norm),
          trainLoss: typeof h.train_loss === 'number' ? Number(h.train_loss) : null,
          valLoss: typeof h.val_loss === 'number' ? Number(h.val_loss) : null,
          lr: typeof h.lr === 'number' ? Number(h.lr) : null,
        }));
      if (extracted.length > 0) {
        gradPoints = extracted;
        sourceArtifact = src.rel;
        bestValLoss =
          typeof raw?.best_val_loss === 'number'
            ? raw.best_val_loss
            : typeof raw?.runs?.[0]?.val_loss_best === 'number'
              ? raw.runs[0].val_loss_best
              : null;
        break;
      }
    } catch {
      /* ignore malformed evidence file */
    }
  }

  const finiteNorms = gradPoints.map((p) => p.gradNorm).filter((v) => Number.isFinite(v));
  const nonFiniteCount = gradPoints.length - finiteNorms.length;
  const latestGradNorm = finiteNorms.length > 0 ? +finiteNorms[finiteNorms.length - 1].toFixed(4) : null;
  const minGradNorm = finiteNorms.length > 0 ? +Math.min(...finiteNorms).toFixed(4) : null;
  const maxGradNorm = finiteNorms.length > 0 ? +Math.max(...finiteNorms).toFixed(4) : null;
  const meanGradNorm =
    finiteNorms.length > 0
      ? +(finiteNorms.reduce((a, b) => a + b, 0) / finiteNorms.length).toFixed(4)
      : null;
  const variance =
    finiteNorms.length > 1 && meanGradNorm !== null
      ? finiteNorms.reduce((acc, v) => acc + Math.pow(v - meanGradNorm, 2), 0) / finiteNorms.length
      : 0;
  const stdDevGradNorm = finiteNorms.length > 0 ? +Math.sqrt(variance).toFixed(4) : null;

  const pipe = ContinuousLearningPipeline.getInstance();
  const allRuns = pipe.listRuns();
  const latestRun = allRuns[0] || null;
  const clipThreshold = latestRun?.trainingConfig?.gradientClip ?? 1.0;

  let stabilityStatus: 'STABLE' | 'ELEVATED' | 'UNSTABLE' | 'UNAVAILABLE' = 'UNAVAILABLE';
  if (gradPoints.length > 0) {
    if (nonFiniteCount > 0) {
      stabilityStatus = 'UNSTABLE';
    } else if (maxGradNorm !== null && maxGradNorm > 10) {
      stabilityStatus = 'ELEVATED';
    } else {
      stabilityStatus = 'STABLE';
    }
  }

  const gradientStability = {
    status: stabilityStatus,
    sourceArtifact,
    totalSamples: gradPoints.length,
    latestGradNorm,
    minGradNorm,
    maxGradNorm,
    meanGradNorm,
    stdDevGradNorm,
    nonFiniteCount,
    clipThreshold,
    bestValLoss: bestValLoss !== null ? +bestValLoss.toFixed(4) : null,
    recentPoints: gradPoints.slice(-16),
  };

  // Checkpoint Save Status
  const targetRelPath = 'native_data/model_checkpoint_target_41m.pt';
  const targetAbsPath = path.resolve(process.cwd(), targetRelPath);
  const targetExists = fs.existsSync(targetAbsPath);
  const candidateDirs = [
    path.resolve(process.cwd(), 'native_data', 'training_pipeline', 'checkpoints'),
    path.resolve(process.cwd(), 'native_data'),
    path.resolve(process.cwd(), 'checkpoints'),
  ];

  let writableDirs = 0;
  const checkpointFiles: Array<{ path: string; sizeBytes: number; modifiedAt: string }> = [];
  for (const dir of candidateDirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.accessSync(dir, fs.constants.W_OK);
        writableDirs += 1;
        for (const entry of fs.readdirSync(dir)) {
          if (!entry.endsWith('.pt')) continue;
          const full = path.join(dir, entry);
          try {
            const st = fs.statSync(full);
            if (st.isFile()) {
              checkpointFiles.push({
                path: path.relative(process.cwd(), full),
                sizeBytes: st.size,
                modifiedAt: st.mtime.toISOString(),
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* directory not writable */
    }
  }
  checkpointFiles.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  const cloudCfg = CloudObjectStorageService.getConfigurationStatus();
  const connectivity = await ConnectivityMonitor.getInstance().checkNow().catch(() => null);
  const checkpointSave = {
    status:
      writableDirs === 0
        ? 'READ_ONLY'
        : targetExists
          ? 'READY'
          : 'WRITABLE_TARGET_MISSING',
    storageWritable: writableDirs > 0,
    writableDirsCount: writableDirs,
    targetCheckpointPath: targetRelPath,
    targetCheckpointPresent: targetExists,
    localPtCount: checkpointFiles.length,
    latestCheckpoint: checkpointFiles[0] || null,
    pipelineRunsCount: allRuns.length,
    latestRunStatus: latestRun?.status ?? null,
    latestRunLifecycle: latestRun?.checkpointLifecycle ?? null,
    cloudStorageConfigured: Boolean(cloudCfg.s3Configured || connectivity?.cloudStorageConfigured),
    cloudStorageReachable: Boolean(connectivity?.cloudStorageReachable),
  };

  let datasetReadiness: Record<string, any> = {
    status: 'MISSING',
    splitsPresent: false,
    provenanceManifestPath: 'artifacts/dataset-provenance-manifest.json',
    provenanceManifestPresent: fs.existsSync(path.resolve(process.cwd(), 'artifacts', 'dataset-provenance-manifest.json')),
    recordCounts: null,
  };
  try {
    const qualityAbs = path.resolve(process.cwd(), 'artifacts', 'dataset-quality-report.json');
    const splitsExist = ['train.jsonl', 'validation.jsonl', 'test.jsonl'].every((f) =>
      fs.existsSync(path.resolve(process.cwd(), 'native_data', 'datasets', f))
    );
    if (fs.existsSync(qualityAbs)) {
      const q = JSON.parse(fs.readFileSync(qualityAbs, 'utf8'));
      datasetReadiness = {
        status: splitsExist ? (q?.quality_and_governance_checks?.audit_splits_status || 'READY_FOR_REVIEW') : 'MISSING',
        splitsPresent: splitsExist,
        datasetId: q?.dataset_id || null,
        provenanceManifestPath: 'artifacts/dataset-provenance-manifest.json',
        provenanceManifestPresent: fs.existsSync(path.resolve(process.cwd(), 'artifacts', 'dataset-provenance-manifest.json')),
        governanceGateStatus: q?.quality_and_governance_checks?.validate_manifest_gate_status || 'BLOCKED',
        recordCounts: q?.record_counts?.by_split || null,
      };
    }
  } catch {
    // Keep non-fatal fallback summary
  }

  const approvalKeyConfigured = Boolean(resolveConfiguredApprovalKeyFile());
  const missingEnvVars: string[] = [];
  if (!cloudCfg.fields.find((f) => f.key === 'S3_BUCKET')?.configured) missingEnvVars.push('S3_BUCKET');
  if (!cloudCfg.fields.find((f) => f.key === 'S3_ACCESS_KEY_ID')?.configured) missingEnvVars.push('S3_ACCESS_KEY_ID');
  if (!cloudCfg.fields.find((f) => f.key === 'S3_SECRET_ACCESS_KEY')?.configured) missingEnvVars.push('S3_SECRET_ACCESS_KEY');
  if (!cloudCfg.fields.find((f) => f.key === 'S3_REGION')?.configured) missingEnvVars.push('S3_REGION');
  if (!approvalKeyConfigured) missingEnvVars.push('ZYNTHEOR_APPROVAL_KEY_FILE');

  res.json({
    success: true,
    checkedAt,
    pythonBackend,
    memory,
    gradientStability,
    checkpointSave,
    datasetReadiness,
    environmentStatus: {
      s3Configured: cloudCfg.s3Configured,
      approvalKeyConfigured,
      missingEnvVars,
    },
    pipelineSummary: getTrainingPipelineStatusSummary(),
  });
});

// 1b. Direct Native Inference Endpoint
app.post('/api/native/inference', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prompt = req.body?.prompt || 'ทดสอบ';
    const role = req.body?.role || 'chat';
    const maxTokens = Number(req.body?.maxNewTokens ?? req.body?.max_tokens ?? 64);
    const temperature = Number(req.body?.temperature ?? 0.7);
    const monitor = ConnectivityMonitor.getInstance();
    const conn = await monitor.checkNow();
    if (!conn.online || !conn.weightsLoaded || !conn.executionVerified) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        message: 'Online Connectivity Required',
        error: conn.reason || 'FAIL_CLOSED: Online Connectivity Required',
        runtimeState: conn.runtimeState,
      });
    }

    const provider = NativeNeuralLMProvider.getInstance();
    const pingRes = monitor.getLastPingResult() || (await provider.ping());
    const result = await provider.chat(prompt, role, { max_tokens: maxTokens, temperature });
    lastRecordedLatencyMs = Math.max(1, Math.round(result.latency_ms || 1));
    lastRecordedTokensPerSec = result.tokens_per_sec || 0;
    sampleResources();

    const evidence = provider.getLastInferenceEvidence();
    const refreshedConn = await monitor.checkNow();

    AuditLedger.append('SYSTEM', 'NATIVE_INFERENCE_EXECUTED', {
      promptLength: prompt.length,
      inputTokens: result.input_tokens_count,
      outputTokens: result.output_tokens_count,
      latencyMs: result.latency_ms,
      tokensPerSec: result.tokens_per_sec,
      checkpointSha256: refreshedConn.checkpointSha256,
    });

    res.json({
      success: true,
      model: 'ZYNTHEOR Q+ Sovereign',
      architecture: pingRes.architecture,
      totalParams: pingRes.active_params,
      checkpointHash: result.checkpoint_hash,
      weightsSource: refreshedConn.cloudSourceUri,
      checkpointPath: evidence?.checkpointPath || refreshedConn.checkpointPath,
      checkpointSha256: evidence?.checkpointSha256 || refreshedConn.checkpointSha256,
      tokenizerSha256: evidence?.tokenizerSha256 || refreshedConn.tokenizerSha256,
      activeRuntimeId: evidence?.activeRuntimeId || refreshedConn.activeRuntimeId,
      inferenceTimestamp: evidence?.inferenceTimestamp || new Date().toISOString(),
      executionDurationMs: evidence?.executionDurationMs || lastRecordedLatencyMs,
      prompt,
      response: result.text,
      inputTokens: result.input_tokens_count,
      outputTokens: result.output_tokens_count,
      latency_ms: result.latency_ms,
      tokens_per_sec: result.tokens_per_sec,
      latentNorm: result.latent_norm,
    });
  } catch (err: any) {
    const blocked = String(err?.message || err).includes('FAIL_CLOSED');
    res.status(blocked ? 503 : 500).json({
      success: false,
      code: blocked ? 'FAIL_CLOSED' : 'INFERENCE_ERROR',
      message: blocked ? 'Online Connectivity Required' : err.message,
      error: err.message,
    });
  }
});

// 2. NDJSON Agent Execution Stream (Supports both Online Native LM and Unified 9-Stage Action Engine)
app.post('/api/agent/execute', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  const { goal, priority: rawPriority, mode } = req.body || {};
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 250000) {
    return res.status(400).json({ success: false, code: 'INVALID_TASK_GOAL', error: 'Goal must contain 1–250000 characters.' });
  }
  const priority = normalizeTaskPriority(rawPriority);
  const unifiedMode = typeof mode === 'string' && ['action_driven', 'unified', 'autonomous', 'hybrid'].includes(mode);

  if (unifiedMode) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const started = new Date().toISOString();
    res.write(
      JSON.stringify({
        type: 'init',
        priority,
        message: `Initiating Unified 9-Stage Action-Driven Pipeline for "${goal}" [Priority: ${priority}]`,
        data: { goal, priority, mode },
        timestamp: started,
      }) + '\n'
    );

    try {
      const mission = await ActionDrivenEngine.getInstance().executeActionMission(
        {
          goal,
          mode: req.body?.actionMode || 'engineering_blueprint_execute',
          priority,
          runtime: req.body?.runtime,
          targetFile: req.body?.targetFile,
          sourceCode: req.body?.sourceCode,
          unitTestCode: req.body?.unitTestCode,
          approvalRequestId: req.body?.approvalRequestId,
          requireNativeModel: Boolean(req.body?.requireNativeModel),
        },
        {
          tenantId: req.sovereignTenantId!,
          userId: req.sovereignUserId!,
          role: req.sovereignRole || 'developer',
        }
      );

      for (const pillar of mission.pillars) {
        res.write(
          JSON.stringify({
            type: 'step',
            role: pillar.name.toUpperCase(),
            priority,
            message: `[${pillar.id}] ${pillar.status}: ${pillar.summary}`,
            data: pillar,
            timestamp: new Date().toISOString(),
          }) + '\n'
        );
      }

      CommercialManager.getInstance().recordTask(mission.status === 'DELIVERED', 350);
      res.write(
        JSON.stringify({
          type: 'final_result',
          priority,
          data: {
            success: mission.status === 'DELIVERED',
            taskId: mission.missionId,
            mission,
            executionCycle: {
              taskId: mission.missionId,
              executionId: mission.executionId,
              priority,
              lifecycleStatus: mission.status === 'DELIVERED' ? 'Delivered' : mission.status === 'BLOCKED' ? 'Blocked' : 'Failed',
              deliveryStatus: mission.status,
              packageArtifact: mission.packageArtifact,
              artifacts: mission.artifacts,
              repairHistory: mission.repairHistory,
              acceptanceCriteria: mission.acceptanceCriteria,
              executionEvidenceHash: mission.executionEvidenceHash,
            },
          },
          timestamp: new Date().toISOString(),
        }) + '\n'
      );
      return res.end();
    } catch (err: any) {
      CommercialManager.getInstance().recordTask(false, 100);
      res.write(JSON.stringify({ type: 'error', message: err.message, timestamp: new Date().toISOString() }) + '\n');
      return res.end();
    }
  }

  const conn = await ConnectivityMonitor.getInstance().checkNow();
  if (!conn.online || !conn.weightsLoaded || !conn.executionVerified) {
    return res.status(503).json({
      success: false,
      code: 'FAIL_CLOSED',
      message: 'Online Connectivity Required',
      error: conn.reason || 'FAIL_CLOSED: Online Connectivity Required',
      runtimeState: conn.runtimeState,
    });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const orchestrator = TaskOrchestrator.getInstance();

  try {
    AuditLedger.append('SYSTEM', 'AGENT_DIRECT_EXECUTION_START', {
      goal,
      priority,
      ownerUserId: req.sovereignUserId, tenantId: req.sovereignTenantId,
    });
    const result = await orchestrator.executeTask(
      goal,
      (event) => {
        res.write(JSON.stringify(event) + '\n');
      },
      { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId!, priority }
    );

    CommercialManager.getInstance().recordTask(result.success, 350);

    res.write(
      JSON.stringify({
        type: 'final_result',
        data: result,
        timestamp: new Date().toISOString(),
      }) + '\n'
    );

    res.end();
  } catch (err: any) {
    CommercialManager.getInstance().recordTask(false, 100);
    res.write(
      JSON.stringify({
        type: 'error',
        message: err.message,
        timestamp: new Date().toISOString(),
      }) + '\n'
    );
    res.end();
  }
});

// 2b. Queue, Persistent Task History, Resume & Deliverable Downloads (Tenant-Isolated)
app.post('/api/agent/queue', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const goal = req.body?.goal;
    const priority = normalizeTaskPriority(req.body?.priority);
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 250000) {
      return res.status(400).json({ success: false, code: 'INVALID_TASK_GOAL', error: 'Goal must contain 1–250000 characters.' });
    }
    const task = TaskOrchestrator.getInstance().enqueueTask(goal, priority, { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! });
    return res.status(201).json({ success: true, task });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/agent/tasks', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const tasks = TaskOrchestrator.getInstance().listTasksFor({ userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! });
    return res.json({ success: true, tasks });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/agent/tasks/batch', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds.map(String) : [];
    const result = TaskOrchestrator.getInstance().deleteTasksBatch(taskIds, {
      userId: req.sovereignUserId!,
      tenantId: req.sovereignTenantId!,
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/agent/queue/run-next', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  const identity = { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! };
  const nextTask = TaskOrchestrator.getInstance().listTasksFor(identity).find((t) => t.lifecycleStatus === 'Planned');
  if (!nextTask) {
    return res.status(404).json({ success: false, error: 'NO_QUEUED_TASKS' });
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  try {
    await TaskOrchestrator.getInstance().resumeTask(nextTask.taskId, (ev) => {
      res.write(JSON.stringify(ev) + '\n');
    }, identity);
  } catch {
    // Error event already streamed cleanly
  }
  return res.end();
});

app.post('/api/agent/tasks/:taskId/resume', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  const identity = { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! };
  const taskId = String(req.params.taskId || '');
  const task = TaskOrchestrator.getInstance().getTaskFor(taskId, identity);
  if (!task) {
    return res.status(404).json({ success: false, error: 'TASK_NOT_FOUND_OR_FORBIDDEN' });
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  try {
    await TaskOrchestrator.getInstance().resumeTask(taskId, (ev) => {
      res.write(JSON.stringify(ev) + '\n');
    }, identity);
  } catch {
    // Error event with FAIL_CLOSED / Blocked / resumable=true already emitted
  }
  return res.end();
});

app.get('/api/agent/deliverables/:filename', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const filename = path.basename(String(req.params.filename || ''));
    const identity = { userId: req.sovereignUserId!, tenantId: req.sovereignTenantId! };
    const orchestrator = TaskOrchestrator.getInstance();
    const ownsDeliverable =
      orchestrator.listTasksFor(identity).some((t) => t.executionCycle?.packageArtifact?.zipFilename === filename) ||
      ActionDrivenEngine.getInstance()
        .listMissions({ ...identity, role: req.sovereignRole || 'developer' })
        .some((m) => m.packageArtifact?.zipFilename === filename);
    if (!ownsDeliverable) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN: Deliverable ownership verification failed.' });
    }
    const delivRoot = path.resolve(process.cwd(), 'native_data', 'deliverables');
    const fullPath = path.resolve(delivRoot, filename);
    if (!fullPath.startsWith(delivRoot + path.sep) || !fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: 'DELIVERABLE_NOT_FOUND' });
    }
    return res.download(fullPath, filename);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agent/scheduled-checks', requireAuth('admin'), async (_req: AuthenticatedRequest, res: Response) => {
  const conn = await ConnectivityMonitor.getInstance().checkNow();
  const audit = AuditLedger.verifyIntegrity();
  res.json({ success: true, connectivity: conn, auditIntegrity: audit, checkedAt: new Date().toISOString() });
});

app.get('/api/agent/metrics', requireAuth('admin'), (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, metrics: TaskOrchestrator.getInstance().getExecutionMetrics() });
});

app.get('/api/agent/cycles', requireAuth('admin'), (req: AuthenticatedRequest, res: Response) => {
  const limit = Number(req.query.limit || 50);
  res.json({ success: true, cycles: TaskOrchestrator.getInstance().listCycles(limit) });
});

app.get('/api/agent/plans', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const plans = AutonomousPlanner.getInstance().listPlans({
    tenantId: req.sovereignTenantId!,
    ownerUserId: req.sovereignUserId!,
  });
  res.json({ success: true, plans });
});

app.get('/api/agent/plans/:taskId', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const plan = AutonomousPlanner.getInstance().getPlan(String(req.params.taskId), {
    tenantId: req.sovereignTenantId!,
    ownerUserId: req.sovereignUserId!,
  });
  if (!plan) return res.status(404).json({ success: false, error: 'PLAN_NOT_FOUND' });
  return res.json({ success: true, plan });
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

    AuditLedger.append('SYSTEM', 'LANGUAGE_INTEGRITY_RUN', {
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
app.post('/api/self-evolve/run', requireRole(['Developer', 'Administrator']), async (req: Request, res: Response) => {
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
    const records = AuditLedger.getRecent(limit);
    const integrity = AuditLedger.verifyIntegrity();
    res.json({
      success: true,
      integrity,
      records
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Workspace Files & Content (shared workspace mutations/listings restricted to admin)
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

app.get('/api/workspace/file', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path query parameter is required' });
    const content = ToolGateway.readFile(filePath);
    res.json({ success: true, path: filePath, content });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

app.post('/api/workspace/file', requireRole(['Developer', 'Administrator']), async (req: Request, res: Response) => {
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

app.delete('/api/workspace/file', requireRole(['Developer', 'Administrator']), async (req: Request, res: Response) => {
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

// 6.1 GitHub-First Sync Inspection & Push (DevStudio)
const GIT_SENSITIVE_PATH_RE = /(?:^|\/)(?:\.env(?:\.(?!example$).*)?|.*\.pt|.*\.pth|.*\.pem|.*\.key|id_rsa.*|node_modules(?:\/|$)|dist(?:\/|$)|\.git(?:\/|$)|backups(?:\/|$)|native_data\/audit_log\.jsonl)$/i;

function sanitizeGitText(input: string): string {
  return String(input || '')
    .replace(/https?:\/\/([^:@\s]+):([^@\s]+)@/gi, 'https://$1:***@')
    .replace(/x-access-token:[^@\s]+@/gi, 'x-access-token:***@')
    .trim();
}

function isSafeGitStagePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return false;
  if (GIT_SENSITIVE_PATH_RE.test(normalized)) return false;
  return true;
}

async function inspectGitRepositoryState(requestedBranch?: string) {
  const cwd = process.cwd();
  const checkedAt = new Date().toISOString();
  const targetBranch =
    requestedBranch && !/^-/.test(requestedBranch) && /^[a-zA-Z0-9._/-]{1,80}$/.test(requestedBranch)
      ? requestedBranch
      : 'tidy-root';

  try {
    const { stdout: insideOut } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      timeout: 8_000,
    });
    if (insideOut.trim() !== 'true') {
      throw new Error('Not inside a Git work tree');
    }
  } catch {
    return {
      gitAvailable: false,
      connected: false,
      status: 'BLOCKED' as const,
      code: 'GIT_REPO_NOT_FOUND',
      branch: null,
      targetBranch,
      headSha: null,
      remoteName: 'origin',
      remoteUrl: null,
      aheadCount: 0,
      behindCount: 0,
      clean: false,
      changedFiles: [] as Array<{ path: string; code: string; safeToStage: boolean }>,
      safeStageableCount: 0,
      reason: 'No .git repository exists in this workspace runtime. Connect or run inside the ZYNTHEOR Git repository to sync changes.',
      checkedAt,
    };
  }

  let branch: string | null = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 8_000 });
    branch = stdout.trim() || null;
  } catch {
    branch = null;
  }

  let headSha: string | null = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd, timeout: 8_000 });
    headSha = stdout.trim() || null;
  } catch {
    headSha = null;
  }

  let remoteUrl: string | null = null;
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 8_000 });
    remoteUrl = sanitizeGitText(stdout.trim()) || null;
  } catch {
    remoteUrl = null;
  }

  let changedFiles: Array<{ path: string; code: string; safeToStage: boolean }> = [];
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-uall'], {
      cwd,
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    changedFiles = stdout
      .split(/\r?\n/)
      .filter((line) => line.length >= 4)
      .slice(0, 150)
      .map((line) => {
        const code = line.slice(0, 2);
        const rawPath = line.slice(3).trim();
        const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()!.trim() : rawPath;
        const cleanPath = filePath.replace(/^"+|"+$/g, '');
        return {
          path: cleanPath,
          code,
          safeToStage: isSafeGitStagePath(cleanPath),
        };
      });
  } catch {
    changedFiles = [];
  }

  let aheadCount = 0;
  let behindCount = 0;
  if (remoteUrl) {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-list', '--left-right', '--count', `origin/${targetBranch}...HEAD`],
        { cwd, timeout: 8_000 }
      );
      const parts = stdout.trim().split(/\s+/).map(Number);
      if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        behindCount = parts[0];
        aheadCount = parts[1];
      }
    } catch {
      // Remote branch ref may not exist locally yet; leave 0/0.
    }
  }

  const safeStageableCount = changedFiles.filter((f) => f.safeToStage).length;
  const connected = Boolean(remoteUrl);
  const status = connected ? 'READY' : 'BLOCKED';
  const code = connected ? null : 'GIT_REMOTE_MISSING';
  const reason = connected
    ? changedFiles.length === 0 && aheadCount === 0
      ? `Working tree is clean on '${branch || 'HEAD'}' and synchronized with origin/${targetBranch}.`
      : `${changedFiles.length} local change(s) (${safeStageableCount} safe to stage), ${aheadCount} commit(s) ahead of origin/${targetBranch}.`
    : 'Git remote "origin" is not configured in this repository.';

  return {
    gitAvailable: true,
    connected,
    status,
    code,
    branch,
    targetBranch,
    headSha,
    remoteName: 'origin',
    remoteUrl,
    aheadCount,
    behindCount,
    clean: changedFiles.length === 0,
    changedFiles,
    safeStageableCount,
    reason,
    checkedAt,
  };
}

app.get('/api/github/status', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const branchParam = typeof req.query.branch === 'string' ? req.query.branch.trim() : undefined;
    const state = await inspectGitRepositoryState(branchParam);
    return res.json({ success: true, ...state });
  } catch (err: any) {
    return res.status(500).json({ success: false, status: 'BLOCKED', error: sanitizeGitText(err?.message || String(err)) });
  }
});

app.post('/api/github/sync', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const requestedBranch = typeof body.branch === 'string' ? body.branch.trim() : 'tidy-root';
    if (!requestedBranch || /^-/.test(requestedBranch) || !/^[a-zA-Z0-9._/-]{1,80}$/.test(requestedBranch)) {
      return res.status(400).json({
        success: false,
        status: 'BLOCKED',
        pushStatus: 'BLOCKED',
        code: 'INVALID_BRANCH_NAME',
        error: 'Target branch name is invalid.',
      });
    }

    const commitMessageRaw =
      typeof body.commitMessage === 'string' && body.commitMessage.trim()
        ? body.commitMessage.trim()
        : 'chore(zyntheor): sync workspace changes from DevStudio';
    const commitMessage = commitMessageRaw.replace(/[\r\n\0]+/g, ' ').slice(0, 200);
    const scope = body.scope === 'workspace_only' ? 'workspace_only' : 'all_safe';

    const state = await inspectGitRepositoryState(requestedBranch);
    if (!state.gitAvailable || !state.connected || !state.remoteUrl) {
      AuditLedger.append('SYSTEM', 'GITHUB_SYNC_BLOCKED', {
        userId: req.sovereignUserId || 'unknown',
        role: req.sovereignRole || 'unknown',
        code: state.code || 'GIT_NOT_CONNECTED',
        targetBranch: requestedBranch,
      });
      return res.status(409).json({
        success: false,
        status: 'BLOCKED',
        pushStatus: 'BLOCKED',
        code: state.code || 'GIT_NOT_CONNECTED',
        branch: requestedBranch,
        remoteUrl: state.remoteUrl,
        error: state.reason,
        state,
      });
    }

    const cwd = process.cwd();
    const filesToStage = state.changedFiles
      .filter((f) => f.safeToStage && (scope === 'workspace_only' ? f.path.startsWith('workspace/') : true))
      .map((f) => f.path);

    if (filesToStage.length > 0) {
      await execFileAsync('git', ['add', '--', ...filesToStage], { cwd, timeout: 15_000 });
    }

    let stagedFiles: string[] = [];
    try {
      const { stdout: cachedOut } = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
        cwd,
        timeout: 10_000,
      });
      stagedFiles = cachedOut.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch {
      stagedFiles = [];
    }

    let didCommit = false;
    if (stagedFiles.length > 0) {
      await execFileAsync('git', ['commit', '-m', commitMessage], { cwd, timeout: 15_000 });
      didCommit = true;
    }

    let commitSha = state.headSha;
    try {
      const { stdout: shaOut } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd, timeout: 8_000 });
      commitSha = shaOut.trim() || commitSha;
    } catch {
      // Keep prior headSha if unavailable
    }

    const refspec = state.branch === requestedBranch ? requestedBranch : `HEAD:refs/heads/${requestedBranch}`;
    try {
      const { stdout: pushOut, stderr: pushErr } = await execFileAsync(
        'git',
        ['push', 'origin', refspec],
        { cwd, timeout: 25_000 }
      );
      const refreshedState = await inspectGitRepositoryState(requestedBranch);
      const pushSummary = sanitizeGitText([pushOut, pushErr].filter(Boolean).join('\n'));
      const pushStatus = didCommit || state.aheadCount > 0 ? 'PUSHED' : 'UP_TO_DATE';

      AuditLedger.append('SYSTEM', 'GITHUB_SYNC_PUSHED', {
        userId: req.sovereignUserId || 'unknown',
        role: req.sovereignRole || 'unknown',
        branch: requestedBranch,
        commitSha,
        stagedCount: stagedFiles.length,
        pushStatus,
      });

      return res.json({
        success: true,
        status: 'VERIFIED',
        pushStatus,
        branch: requestedBranch,
        sourceBranch: state.branch,
        commitSha,
        remoteUrl: state.remoteUrl,
        stagedFiles,
        didCommit,
        pushSummary: pushSummary || `Synchronized with origin/${requestedBranch}`,
        state: refreshedState,
      });
    } catch (pushErr: any) {
      const errDetail = sanitizeGitText(pushErr?.stderr || pushErr?.message || String(pushErr));
      const refreshedState = await inspectGitRepositoryState(requestedBranch);
      AuditLedger.append('SYSTEM', 'GITHUB_SYNC_PUSH_FAILED', {
        userId: req.sovereignUserId || 'unknown',
        role: req.sovereignRole || 'unknown',
        branch: requestedBranch,
        commitSha,
        error: errDetail.slice(0, 240),
      });
      return res.status(409).json({
        success: false,
        status: 'BLOCKED',
        pushStatus: 'BLOCKED',
        code: 'GIT_PUSH_FAILED',
        branch: requestedBranch,
        sourceBranch: state.branch,
        commitSha,
        remoteUrl: state.remoteUrl,
        stagedFiles,
        didCommit,
        error: `git push to origin/${requestedBranch} failed: ${errDetail || 'Authentication or remote branch protection rejected push.'}`,
        state: refreshedState,
      });
    }
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      status: 'BLOCKED',
      pushStatus: 'BLOCKED',
      error: sanitizeGitText(err?.message || String(err)),
    });
  }
});

// 6a. Evidence-gated competitive software benchmarks (L1-L4)
app.get('/api/benchmarks', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 200);
    res.json({ success: true, records: BenchmarkRunner.list(limit), ledgerIntegrity: BenchmarkRunner.ledgerIntegrity() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/benchmarks/:executionId', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const artifact = BenchmarkRunner.getArtifact(String(req.params.executionId || ''));
    if (!artifact) return res.status(404).json({ success: false, error: 'Benchmark artifact not found' });
    return res.json({ success: true, artifact });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/benchmarks/run', requireRole(['Developer', 'Administrator']), async (req: Request, res: Response) => {
  try {
    const level = Number(req.body?.level);
    const projectId = req.body?.projectId;
    if (!Number.isInteger(level) || ![1, 2, 3, 4].includes(level)) {
      return res.status(400).json({ success: false, error: 'level must be an integer from 1 to 4' });
    }
    if (typeof projectId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(projectId)) {
      return res.status(400).json({ success: false, error: 'projectId must be a valid project identifier' });
    }
    const result = await BenchmarkRunner.runLevel(level, projectId);
    const httpStatus = result.status === 'BLOCKED' ? 409 : 200;
    return res.status(httpStatus).json({ success: result.status === 'VERIFIED', result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
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

// 7. Commercial & Business Management
app.get('/api/commercial/metrics', requireAuth('developer'), (_req: Request, res: Response) => {
  const metrics = CommercialManager.getInstance().getMetrics();
  res.json({ success: true, metrics, plans: CommercialManager.PLANS });
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

// 8. Native Memory & Episodic Memory Controller
app.get('/api/memory', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    const memory = await provider.getMemory();
    res.json({ success: true, memory });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/memory/episodic', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const memoryCtrl = NativeMemoryController.getInstance();
    const scope = { tenantId: req.sovereignTenantId, userId: req.sovereignUserId, role: req.sovereignRole };
    const items = memoryCtrl.listAll(scope);
    const stats = memoryCtrl.getStats();
    res.json({ success: true, items, stats });
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
    const memoryCtrl = NativeMemoryController.getInstance();
    const scope = { tenantId: req.sovereignTenantId, userId: req.sovereignUserId, role: req.sovereignRole };
    const item = memoryCtrl.storeMemory(key, value, category, metadata, { scope, ttlSeconds });
    res.json({ success: true, item: { ...item, tenantId: req.sovereignTenantId } });
  } catch (err: any) {
    const forbidden = String(err?.message || '').includes('FORBIDDEN:');
    res.status(forbidden ? 403 : 500).json({ success: false, error: err.message });
  }
});

app.get('/api/memory/verify-integrity', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const integrity = NativeMemoryController.getInstance().verifyStoreIntegrity();
    res.json({ success: true, integrity });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/memory/episodic/:key', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const memoryCtrl = NativeMemoryController.getInstance();
    const scope = { tenantId: req.sovereignTenantId, userId: req.sovereignUserId, role: req.sovereignRole };
    const item = memoryCtrl.retrieveMemory(req.params.key, scope);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Memory item not found' });
    }
    res.json({ success: true, item });
  } catch (err: any) {
    const forbidden = String(err?.message || '').includes('FORBIDDEN:');
    res.status(forbidden ? 403 : 500).json({ success: false, error: err.message });
  }
});

app.put('/api/memory/episodic/:key', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { value, category, metadata, ttlSeconds } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'value is required for memory update' });
    }
    const memoryCtrl = NativeMemoryController.getInstance();
    const scope = { tenantId: req.sovereignTenantId, userId: req.sovereignUserId, role: req.sovereignRole };
    const item = memoryCtrl.updateMemory(req.params.key, value, category, metadata, { scope, ttlSeconds });
    res.json({ success: true, item });
  } catch (err: any) {
    const forbidden = String(err?.message || '').includes('FORBIDDEN:');
    res.status(forbidden ? 403 : 500).json({ success: false, error: err.message });
  }
});

app.delete('/api/memory/episodic/:key', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const memoryCtrl = NativeMemoryController.getInstance();
    const scope = { tenantId: req.sovereignTenantId, userId: req.sovereignUserId, role: req.sovereignRole };
    const deleted = memoryCtrl.deleteMemory(req.params.key, scope);
    res.json({ success: true, deleted });
  } catch (err: any) {
    const forbidden = String(err?.message || '').includes('FORBIDDEN:');
    res.status(forbidden ? 403 : 500).json({ success: false, error: err.message });
  }
});

// 9. Sovereign Identity & Security Simulation

// ---------------------------------------------------------------------------
// Identity & Trust Layer — session bootstrap + server-side log seals
// ---------------------------------------------------------------------------

/**
 * Bootstrap / login: issues a real HS256 ZY-TOKEN.
 * Local-first: accepts a role request for development seed accounts only.
 * Production deployments MUST set ZYNTHEOR_MASTER_SECRET and gate this further.
 * Client-supplied x-zyntheor-role headers are NOT used for subsequent API auth.
 */
app.get('/api/auth/mode', (_req: Request, res: Response) => {
  const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const devAccessEnabled = environment !== 'production' && process.env.ZYNTHEOR_ENABLE_DEV_LOGIN === 'true';
  res.json({
    success: true,
    environment,
    googleAuthEnabled: true,
    devAccessEnabled,
  });
});

app.post('/api/auth/firebase-session', requireFirebaseAuth, (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const rawClaimRole = typeof user.sovereignRole === 'string' ? user.sovereignRole.toLowerCase() : '';
    const sovereignRole: SovereignRole =
      rawClaimRole === 'admin' || rawClaimRole === 'developer' || rawClaimRole === 'operator' || rawClaimRole === 'auditor'
        ? (rawClaimRole as SovereignRole)
        : 'guest';
    const tenantId =
      typeof user.tenantId === 'string' && user.tenantId.trim()
        ? user.tenantId.trim()
        : 'Sovereign Enterprise Prime';

    const identity = SovereignIdentity.getInstance();
    const { token, payload } = identity.signToken({
      sub: user.uid,
      tenantId,
      role: sovereignRole,
      ttlSeconds: 3600,
      scope: ['workspace:read', 'workspace:execute', 'api:access'],
    });

    AuditLedger.append('GOVERNANCE', 'AUTH_FIREBASE_SESSION_ISSUED', {
      sub: payload.sub,
      email: user.email || null,
      tenantId: payload.tenantId,
      role: payload.role,
      exp: payload.exp,
      jti: payload.jti,
    });

    res.json({
      success: true,
      token,
      expiresAt: payload.exp,
      session: {
        userId: payload.sub,
        email: user.email || '',
        tenantId: payload.tenantId,
        role: SOVEREIGN_TO_UI[payload.role] || 'User',
        sovereignRole: payload.role,
        authMode: 'firebase',
        authenticatedAt: new Date(payload.iat * 1000).toISOString(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        code: 'DEV_LOGIN_DISABLED',
        error: 'IDENTITY_PROVIDER_REQUIRED',
      });
    }
    if (process.env.ZYNTHEOR_ENABLE_DEV_LOGIN !== 'true') {
      return res.status(403).json({
        success: false,
        code: 'DEV_LOGIN_DISABLED',
        error: 'DEVELOPMENT_LOGIN_DISABLED',
      });
    }
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
      status: result.match ? 'INTACT' : 'TAMPERED'
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
        content: 'ยินดีต้อนรับสู่ ZYNTHEOR VIVID INTELLIGENCE — Native Multi-Domain Intelligence สำหรับการวางแผน สร้าง ทดสอบ และส่งมอบงาน\n\nการอนุมานด้วย Native Model จะเปิดใช้งานต่อเมื่อ Cloud Runtime โหลด checkpoint ที่ตรวจสอบได้แล้วเท่านั้น',
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

app.get('/api/chat/sessions', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const sessions = loadChatSessions();
    res.json({ success: true, sessions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chat', (req: Request, res: Response, next) => { req.url = '/api/chat/message'; next(); });

app.post('/api/chat/message', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  const { sessionId = 'session-default', message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message string is required' });
  }

  const correlationId = (req.body?.correlationId || req.headers['x-correlation-id'] || `corr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`) as string;
  const startTime = Date.now();
  const monitor = ConnectivityMonitor.getInstance();
  const conn = await monitor.checkNow();
  const provider = NativeNeuralLMProvider.getInstance();
  const runtime = monitor.getLastPingResult() || (await provider.ping());
  if (!conn.online || !runtime.inference_ready || !runtime.weights_loaded) {
    return res.status(503).json({
      success: false,
      code: 'FAIL_CLOSED',
      message: 'Online Connectivity Required',
      error: conn.reason || runtime.readiness_reason || 'FAIL_CLOSED: Online Connectivity Required',
      runtimeState: conn.runtimeState || runtime.runtime_state,
    });
  }

  // Set up chunked streaming only after inference readiness has been established.
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Correlation-ID', correlationId);

  const sessions = loadChatSessions();
  let session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    session = {
      id: sessionId,
      title: message.slice(0, 32) + '...',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    sessions.unshift(session);
  }

  // Append user message
  session.messages.push({
    id: `msg-${Date.now()}-u`,
    sender: 'user',
    content: message,
    correlationId,
    timestamp: new Date().toISOString()
  });

  // Query Knowledge Workspace for authentic grounded context
  const kw = KnowledgeWorkspace.getInstance();
  const retrievedChunks = kw.retrieve(message, { limit: 2 });
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

  let accumulated = '';
  let tokenCount = 0;

  try {
    await provider.chatStream(effectivePrompt, 'chat', (chunk) => {
      accumulated += chunk;
      tokenCount += 1;
      res.write(JSON.stringify({ type: 'chunk', text: chunk, correlationId }) + '\n');
    }, { correlation_id: correlationId });

    const durationMs = Date.now() - startTime;
    lastRecordedLatencyMs = durationMs;
    lastRecordedTokensPerSec = +(tokenCount / Math.max(0.001, durationMs / 1000)).toFixed(1);

    // Parse thought block if present
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
      promptChars: message.length,
      responseChars: cleanContent.length,
      hasThought: Boolean(thoughtText),
      retrievedKnowledgeCount: retrievedChunks.length,
      durationMs,
      tokensPerSec: lastRecordedTokensPerSec
    });

    res.write(JSON.stringify({
      type: 'done',
      correlationId,
      fullText: cleanContent,
      thought: thoughtText,
      citations,
      weightsSource: conn.cloudSourceUri,
      totalParams: runtime.active_params,
      timestamp: new Date().toISOString()
    }) + '\n');
    res.end();
  } catch (err: any) {
    const blocked = String(err?.message || err).includes('FAIL_CLOSED');
    res.write(JSON.stringify({ type: 'error', correlationId, code: blocked ? 'FAIL_CLOSED' : 'INFERENCE_ERROR', error: err.message }) + '\n');
    res.end();
  }
});

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

app.post('/api/knowledge/documents', requireRole(['Developer', 'Administrator']), (req: AuthenticatedRequest, res: Response) => {
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

// 6b. Online Knowledge URL Ingestion (Requires live internet connectivity + SSRF guard)
app.post('/api/knowledge/ingest-url', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!targetUrl) {
      return res.status(400).json({ success: false, error: 'url is required' });
    }
    const netCheck = await ConnectivityMonitor.getInstance().requireInternetConnectivity('knowledge-ingest-url');
    const fetched = await InternetIntegrationEngine.getInstance().fetchExternalUrl(
      { url: targetUrl, method: 'GET', timeoutMs: 8000 },
      { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId! }
    );
    if (fetched.blockedByPolicy) {
      return res.status(400).json({ success: false, code: 'SSRF_BLOCKED', error: fetched.error || 'URL blocked by SSRF policy' });
    }
    if (!fetched.ok) {
      return res.status(503).json({
        success: false,
        code: 'FAIL_CLOSED',
        error: fetched.error || `Failed to fetch online source HTTP ${fetched.status}`,
      });
    }
    const isHtml = fetched.contentType.toLowerCase().includes('html');
    const titleMatch = fetched.bodyPreview.match(/<title[^>]*>([^<]+)<\/title>/i);
    const extractedText = isHtml
      ? fetched.bodyPreview
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : fetched.bodyPreview.trim();
    if (!extractedText) {
      return res.status(400).json({ success: false, error: 'Fetched online URL contained no readable text content.' });
    }
    const doc = KnowledgeWorkspace.getInstance().createDocument({
      title: (typeof req.body?.title === 'string' && req.body.title.trim()) || titleMatch?.[1]?.trim() || fetched.finalUrl,
      content: extractedText,
      collection: typeof req.body?.collection === 'string' && req.body.collection.trim() ? req.body.collection.trim() : 'online_research',
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : ['online-ingested'],
      format: fetched.contentType.includes('json') ? 'json' : 'markdown',
      source: fetched.finalUrl,
      provenance: `online_url_sha256:${fetched.contentSha256}`,
      curatedForTraining: Boolean(req.body?.curatedForTraining),
      tenantId: req.sovereignTenantId!,
    });
    res.json({
      success: true,
      document: doc,
      fetchEvidence: {
        finalUrl: fetched.finalUrl,
        httpStatus: fetched.status,
        latencyMs: fetched.latencyMs,
        internetCheckLatencyMs: netCheck.latencyMs,
        contentSha256: fetched.contentSha256,
        byteLength: fetched.byteLength,
      },
    });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError) {
      return res.status(503).json({ success: false, code: 'FAIL_CLOSED', error: err.message });
    }
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.get('/api/knowledge/documents/:id', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    const doc = kw.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
    res.json({ success: true, document: doc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/knowledge/documents/:id', requireRole(['Developer', 'Administrator']), (req: Request, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    const updated = kw.updateDocument(req.params.id, req.body);
    res.json({ success: true, document: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/knowledge/documents/:id', requireRole(['Developer', 'Administrator']), (req: Request, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    const deleted = kw.deleteDocument(req.params.id);
    res.json({ success: true, deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/retrieve', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query, collection, limit } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const kw = KnowledgeWorkspace.getInstance();
    const results = kw.retrieve(query, { collection, limit: limit ? Number(limit) : 5 });
    res.json({ success: true, count: results.length, query, results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/stats', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    res.json({ success: true, stats: kw.getStats() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/curate-dataset', requireRole(['Developer', 'Administrator']), (req: Request, res: Response) => {
  try {
    const { name, documentIds, splitRatio } = req.body;
    if (!name || !Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ error: 'name and non-empty documentIds array are required' });
    }
    const kw = KnowledgeWorkspace.getInstance();
    const manifest = kw.curateDataset(name, documentIds, splitRatio);
    res.json({ success: true, manifest });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/datasets', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    res.json({ success: true, datasets: kw.getDatasets() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/datasets/:id', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const kw = KnowledgeWorkspace.getInstance();
    const detail = kw.getDatasetDetail(req.params.id);
    if (!detail) return res.status(404).json({ success: false, error: 'Dataset not found' });
    res.json({ success: true, ...detail });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function loadDatasetGovernanceAuditResponse() {
  const auditRelPath = 'artifacts/dataset-governance-audit.json';
  const auditAbsPath = path.resolve(process.cwd(), auditRelPath);
  if (!fs.existsSync(auditAbsPath)) {
    return null;
  }
  const stat = fs.statSync(auditAbsPath);
  const raw = JSON.parse(fs.readFileSync(auditAbsPath, 'utf8'));
  const buckets = {
    APPROVED: Array.isArray(raw?.buckets?.APPROVED) ? raw.buckets.APPROVED : [],
    BLOCKED: Array.isArray(raw?.buckets?.BLOCKED) ? raw.buckets.BLOCKED : [],
    NEEDS_REVIEW: Array.isArray(raw?.buckets?.NEEDS_REVIEW) ? raw.buckets.NEEDS_REVIEW : [],
  };
  const allEntries = [...buckets.APPROVED, ...buckets.NEEDS_REVIEW, ...buckets.BLOCKED];
  const sourceDatasetsCount = allEntries.filter((e: any) => e?.kind === 'source').length;

  return {
    schemaVersion: raw?.schema_version || 'zyntheor.dataset-governance-audit.v1',
    auditStatus: raw?.status || 'BLOCKED',
    trainingAdmissionAllowed: Boolean(raw?.training_admission_allowed),
    auditFilePath: auditRelPath,
    generatedAt: stat.mtime.toISOString(),
    totalInspectedDocuments: raw?.total_inspected_documents ?? allEntries.length,
    sourceDatasetsCount,
    excludedByCorpusFilterCount: raw?.excluded_by_corpus_filter_count ?? 0,
    bucketCounts: {
      APPROVED: buckets.APPROVED.length,
      BLOCKED: buckets.BLOCKED.length,
      NEEDS_REVIEW: buckets.NEEDS_REVIEW.length,
    },
    buckets,
    blockingReasons: Array.isArray(raw?.blocking_reasons) ? raw.blocking_reasons : [],
    localDatasetFiles: Array.isArray(raw?.local_dataset_files) ? raw.local_dataset_files : [],
    workspaceSummary: raw?.workspace_corpus_audit?.summary || null,
  };
}

app.get('/api/knowledge/dataset-provenance-audit', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const report = loadDatasetGovernanceAuditResponse();
    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Dataset governance audit JSON file (artifacts/dataset-governance-audit.json) not found.',
      });
    }
    res.json({ success: true, ...report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to read dataset governance audit.' });
  }
});

app.post('/api/knowledge/dataset-provenance-audit/refresh', requireRole(['Developer', 'Administrator']), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    await execFileAsync('python3', ['-B', '-m', 'qplus_native.dataset_admission_audit'], {
      cwd: process.cwd(),
      timeout: 25000,
    });
    const report = loadDatasetGovernanceAuditResponse();
    if (!report) {
      return res.status(500).json({ success: false, error: 'Audit completed but output file was not created.' });
    }
    res.json({ success: true, ...report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to execute dataset admission audit.' });
  }
});


// ==========================================
// Knowledge Intelligence Engine endpoints
// ==========================================

app.post('/api/knowledge/ingest/bulk', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array required' });
    }
    if (items.length > 200) {
      return res.status(400).json({ success: false, error: 'Max 200 items per job' });
    }
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const job = engine.startIngestionJob(items);
    res.json({ success: true, job });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/ingest/jobs', requireAuth('developer'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    res.json({ success: true, jobs: engine.listJobs() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/ingest/jobs/:id', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const job = engine.getJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/ingest/jobs/:id/resume', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const job = engine.resumeJob(req.params.id);
    res.json({ success: true, job });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});


app.post('/api/knowledge/retrieve/hybrid', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query, collection, limit, minScore } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'query string required' });
    }
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const result = engine.hybridRetrieve(query, {
      collection,
      limit: limit ? Number(limit) : 5,
      minScore: minScore !== undefined ? Number(minScore) : undefined
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/knowledge/analyze', requireAuth('developer'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const analysis = engine.analyzeCorpus();
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

app.get('/api/knowledge/duplicates', requireAuth('developer'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    res.json({ success: true, duplicates: engine.findDuplicates() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/knowledge/graph', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const docEdges = engine.buildGraphEdges();
    const kgSummary = KnowledgeGraphEngine.getInstance().getGraphSummary({
      tenantId: req.sovereignTenantId,
      role: req.sovereignRole,
    });
    res.json({
      success: true,
      nodeCount: kgSummary.nodeCount,
      edgeCount: docEdges.length > 0 ? docEdges.length : kgSummary.edgeCount,
      docEdgeCount: docEdges.length,
      kgEdgeCount: kgSummary.edgeCount,
      consistencyValid: kgSummary.consistencyValid,
      topNodes: kgSummary.topNodes,
      edges: (docEdges.length > 0 ? docEdges : kgSummary.recentEdges).slice(0, 500),
    });
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
    const summary = engine.extractiveSummary(documentIds, Number(req.body?.maxSentences) || 5);
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
        pdf: caps.pdf ? 'pdf-parse available' : 'pdf-parse not installed',
        docx: caps.docx ? 'mammoth available' : 'mammoth not installed',
        ocr: caps.ocr ? 'tesseract.js available' : 'OCR not installed — scanned PDFs without text layer will fail closed'
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Parse binary PDF/DOCX — multipart file upload or JSON base64. Real extraction only. */
app.post('/api/knowledge/parse-binary', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
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
app.post('/api/model/train', requireRole(['Developer', 'Administrator']), async (_req: Request, res: Response) => {
  return res.status(409).json({
    success: false,
    status: 'BLOCKED',
    code: 'NATIVE_TRAINING_GATE_NOT_READY',
    error: 'Training is blocked until a provenance-verified dataset, explicit human approval, and a tested Native Cloud training runner are connected. No built-in placeholder corpus is permitted.'
  });
});

app.post('/api/model/export', requireRole(['Developer', 'Administrator']), async (_req: Request, res: Response) => {
  return res.status(409).json({
    success: false,
    status: 'BLOCKED',
    code: 'SYNTHETIC_CHECKPOINT_EXPORT_PROHIBITED',
    error: 'Checkpoint export is blocked. Only a real checkpoint produced by the approved Native training pipeline may be exported.'
  });
});

app.get('/api/model/inspect', requireRole(['Developer', 'Administrator']), async (_req: Request, res: Response) => {
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    const inspectResult = await provider.inspectCheckpoint();
    res.json({ success: true, ...inspectResult });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/model/verify-checkpoint-baseline', requireRole(['Developer', 'Administrator']), async (_req: Request, res: Response) => {
  const TARGET_REL_PATH = 'native_data/model_checkpoint_target_41m.pt';
  const EXPECTED_PARAMS = 41_527_808;
  const EXPECTED_BASELINES = [
    {
      label: 'architecture-audit-baseline',
      sha256: '18ed252176ec16f5e00c4a416d454b914f0e2a5f822103726c50177af8314ddd',
      source: 'docs/archive/legacy/artifacts/target-checkpoint-architecture-audit.json',
    },
    {
      label: 'target-training-step1000-baseline',
      sha256: '022b94d666a955f97fe8b6d6a8dd4332bd427cce02a60cca43729eceb5b42fe8',
      source: 'docs/target-training-evidence.json',
    },
  ];
  const targetPath = path.resolve(process.cwd(), TARGET_REL_PATH);
  const checkedAt = new Date().toISOString();

  if (!fs.existsSync(targetPath)) {
    return res.json({
      success: true,
      status: 'MISSING',
      checkpointPath: TARGET_REL_PATH,
      fileExists: false,
      fileSizeBytes: null,
      expectedParams: EXPECTED_PARAMS,
      actualParams: null,
      expectedBaselines: EXPECTED_BASELINES,
      actualContainerSha256: null,
      actualPayloadSha256: null,
      sha256Match: false,
      paramsMatch: false,
      matchedBaselineLabel: null,
      reason: `Original checkpoint ${TARGET_REL_PATH} is missing on disk (Git LFS artifact not recovered).`,
      checkedAt,
    });
  }

  try {
    const stat = fs.statSync(targetPath);
    const actualContainerSha256 = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(targetPath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });

    const auditOut = await new Promise<Record<string, any>>((resolve) => {
      const py =
        'import json, sys; from pathlib import Path; from qplus_native.candidate_audit import inspect_checkpoint; print(json.dumps(inspect_checkpoint(Path(sys.argv[1]))))';
      execFile('python3', ['-B', '-c', py, targetPath], { cwd: process.cwd(), timeout: 20_000 }, (err, stdout) => {
        if (err || !stdout.trim()) {
          return resolve({ integrity_status: 'AUDIT_ERROR', metadata: {} });
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ integrity_status: 'AUDIT_PARSE_ERROR', metadata: {} });
        }
      });
    });

    const actualPayloadSha256 =
      typeof auditOut?.payload_sha256 === 'string' ? auditOut.payload_sha256 : null;
    const actualParams =
      typeof auditOut?.metadata?.total_params === 'number' ? auditOut.metadata.total_params : null;

    const matchedBaseline = EXPECTED_BASELINES.find(
      (b) => b.sha256 === actualContainerSha256 || (actualPayloadSha256 && b.sha256 === actualPayloadSha256)
    );
    const sha256Match = Boolean(matchedBaseline);
    const paramsMatch = actualParams === EXPECTED_PARAMS;
    const status = sha256Match && paramsMatch && auditOut?.integrity_status === 'STRUCTURAL_CHECKS_PASS'
      ? 'VERIFIED'
      : 'MISMATCH';

    return res.json({
      success: true,
      status,
      checkpointPath: TARGET_REL_PATH,
      fileExists: true,
      fileSizeBytes: stat.size,
      expectedParams: EXPECTED_PARAMS,
      actualParams,
      expectedBaselines: EXPECTED_BASELINES,
      actualContainerSha256,
      actualPayloadSha256,
      sha256Match,
      paramsMatch,
      matchedBaselineLabel: matchedBaseline?.label || null,
      reason:
        status === 'VERIFIED'
          ? `SHA-256 (${matchedBaseline?.label}) and 41,527,808 parameter integrity verified.`
          : `Checkpoint failed baseline verification (sha256Match=${sha256Match}, paramsMatch=${paramsMatch}, audit=${auditOut?.integrity_status}).`,
      checkedAt,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      status: 'ERROR',
      checkpointPath: TARGET_REL_PATH,
      error: err?.message || 'Checkpoint baseline SHA-256 verification failed.',
      checkedAt,
    });
  }
});

// 12a. R0 Checkpoint (model_checkpoint_target_41m_step5800.pt) Native Runtime Status & Initialization
const R0_CHECKPOINT_FILENAME = 'model_checkpoint_target_41m_step5800.pt';
const R0_PRIMARY_REL_PATH = path.join('native_data', R0_CHECKPOINT_FILENAME);
const R0_FALLBACK_REL_PATH = path.join('native_data', 'model_checkpoint_target_41m.pt');
const R0_EXPECTED_STEPS = 5800;

async function inspectR0NativeRuntimeState() {
  const checkedAt = new Date().toISOString();
  const monitor = ConnectivityMonitor.getInstance();
  const provider = NativeNeuralLMProvider.getInstance();
  const [connectivity, pingRes] = await Promise.all([
    monitor.checkNow().catch(() => null),
    provider.ping().catch(() => null),
  ]);
  const storageCfg = CloudObjectStorageService.getConfigurationStatus();

  const primaryAbs = path.resolve(process.cwd(), R0_PRIMARY_REL_PATH);
  const fallbackAbs = path.resolve(process.cwd(), R0_FALLBACK_REL_PATH);
  const primaryExists = fs.existsSync(primaryAbs);
  const fallbackExists = fs.existsSync(fallbackAbs);

  const primarySizeBytes = primaryExists ? fs.statSync(primaryAbs).size : null;
  const fallbackSizeBytes = fallbackExists ? fs.statSync(fallbackAbs).size : null;

  const weightsLoaded = Boolean(connectivity?.weightsLoaded && pingRes?.weights_loaded);
  const executionVerified = Boolean(connectivity?.executionVerified && pingRes?.execution_verified);
  const inferenceReady = Boolean(weightsLoaded && executionVerified && connectivity?.runtimeState === 'READY');
  const activeParams = inferenceReady ? Number(pingRes?.active_params || 0) : null;
  const runtimeSha256 = connectivity?.checkpointSha256 || pingRes?.checkpoint_sha256 || null;
  const runtimePath = connectivity?.checkpointPath || pingRes?.checkpoint_path || null;
  const activeRuntimeId = connectivity?.activeRuntimeId || pingRes?.active_runtime_id || null;
  const loadedSteps = typeof (pingRes as any)?.training_steps === 'number' ? (pingRes as any).training_steps : null;

  const matchesR0Identity = Boolean(
    inferenceReady &&
      activeParams === TARGET_41M_PARAM_COUNT &&
      ((runtimePath && runtimePath.includes('step5800')) ||
        (runtimeSha256 && runtimeSha256.toLowerCase().startsWith('6e7f')) ||
        loadedSteps === R0_EXPECTED_STEPS)
  );

  let loadingStatus:
    | 'LOADED_READY'
    | 'DISK_AVAILABLE_UNLOADED'
    | 'CLOUD_READY_UNLOADED'
    | 'NOT_CONFIGURED'
    | 'BLOCKED';
  let statusReason: string;

  if (inferenceReady) {
    loadingStatus = 'LOADED_READY';
    statusReason = matchesR0Identity
      ? `R0 checkpoint (${R0_CHECKPOINT_FILENAME}) is loaded, SHA-256 verified, and ready for native inference (${TARGET_41M_PARAM_COUNT.toLocaleString()} params).`
      : `Native Runtime has verified weights loaded (${activeParams?.toLocaleString() || 0} params · ${runtimeSha256?.slice(0, 12) || 'unknown'}).`;
  } else if (primaryExists) {
    loadingStatus = 'DISK_AVAILABLE_UNLOADED';
    statusReason = `R0 artifact detected on disk at ${R0_PRIMARY_REL_PATH} (${((primarySizeBytes || 0) / (1024 * 1024)).toFixed(2)} MB) and ready to initialize into Native Runtime.`;
  } else if (storageCfg.configValid) {
    loadingStatus = 'CLOUD_READY_UNLOADED';
    statusReason = `Local ${R0_CHECKPOINT_FILENAME} is absent on disk; Cloud Storage (${storageCfg.provider}) is configured to stream and initialize weights.`;
  } else if (connectivity && !connectivity.pythonBridgeReachable) {
    loadingStatus = 'BLOCKED';
    statusReason = 'Python Native Bridge is unreachable; cannot initialize runtime.';
  } else {
    loadingStatus = 'NOT_CONFIGURED';
    statusReason = `${R0_CHECKPOINT_FILENAME} is not present in native_data/ and Cloud Object Storage / CHECKPOINT_PRESIGNED_URL is not configured.`;
  }

  return {
    checkpointFilename: R0_CHECKPOINT_FILENAME,
    expectedParams: TARGET_41M_PARAM_COUNT,
    expectedSteps: R0_EXPECTED_STEPS,
    readOnlyBaseline: true,
    loadingStatus,
    runtimeState: connectivity?.runtimeState || (loadingStatus === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'BLOCKED'),
    bridgeReachable: Boolean(connectivity?.pythonBridgeReachable),
    weightsLoaded,
    executionVerified,
    inferenceReady,
    matchesR0Identity,
    activeParams,
    checkpointPath: runtimePath,
    checkpointSha256: runtimeSha256,
    activeRuntimeId,
    loadedSteps,
    diskArtifact: {
      primaryPath: R0_PRIMARY_REL_PATH,
      primaryExists,
      primarySizeBytes,
      fallbackPath: R0_FALLBACK_REL_PATH,
      fallbackExists,
      fallbackSizeBytes,
    },
    cloudConfig: {
      configValid: storageCfg.configValid,
      s3Configured: storageCfg.s3Configured,
      provider: storageCfg.provider,
      checkpointKey: storageCfg.checkpointKey,
      missingKeys: storageCfg.missingKeys,
    },
    reason: statusReason,
    checkedAt,
  };
}

app.get('/api/model/r0-runtime', requireRole(['Developer', 'Administrator']), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await inspectR0NativeRuntimeState();
    return res.json({ success: true, ...status });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      loadingStatus: 'BLOCKED',
      error: err?.message || 'Failed to inspect R0 Native Runtime status.',
    });
  }
});

app.post('/api/model/r0-initialize', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const presignedUrl = typeof body.presignedUrl === 'string' && body.presignedUrl.trim() ? body.presignedUrl.trim() : undefined;
    const objectKey = typeof body.objectKey === 'string' && body.objectKey.trim() ? body.objectKey.trim() : undefined;
    const expectedSha256 = typeof body.expectedSha256 === 'string' && body.expectedSha256.trim() ? body.expectedSha256.trim() : undefined;

    if (presignedUrl) {
      const urlCheck = validateCloudUrl(presignedUrl);
      if (!urlCheck.ok) {
        return res.status(400).json({
          success: false,
          status: 'BLOCKED',
          code: 'INVALID_PRESIGNED_URL',
          error: urlCheck.reason || 'Invalid presignedUrl',
        });
      }
    }

    const storageCfg = CloudObjectStorageService.getConfigurationStatus();
    if (presignedUrl || objectKey || storageCfg.configValid) {
      const outcome = await fetchVerifyAndLoad41MCheckpoint({
        objectKey: objectKey || (storageCfg.s3Configured ? R0_CHECKPOINT_FILENAME : undefined),
        presignedUrl,
        expectedSha256,
        verifyOnly: false,
      });
      const state = await inspectR0NativeRuntimeState();
      AuditLedger.append('SYSTEM', outcome.success ? 'R0_RUNTIME_INITIALIZED_CLOUD' : 'R0_RUNTIME_INIT_BLOCKED', {
        userId: req.sovereignUserId || 'unknown',
        success: outcome.success,
        stage: outcome.stage,
        runtimeLoaded: outcome.runtimeLoaded,
        error: outcome.error,
      });
      return res.status(outcome.success ? 200 : outcome.stage === 'FETCH' ? 503 : 409).json({
        success: outcome.success,
        status: outcome.success ? 'VERIFIED' : 'BLOCKED',
        source: 'cloud',
        outcome,
        state,
        error: outcome.error,
      });
    }

    const primaryAbs = path.resolve(process.cwd(), R0_PRIMARY_REL_PATH);
    const workspaceRoot = path.resolve(process.cwd());
    if (!primaryAbs.startsWith(workspaceRoot + path.sep)) {
      return res.status(403).json({ success: false, status: 'BLOCKED', error: 'Invalid checkpoint path.' });
    }

    if (fs.existsSync(primaryAbs)) {
      const buffer = fs.readFileSync(primaryAbs);
      const verification = verifyCheckpointBufferFor41M(buffer, {
        sourceUri: `file://${R0_PRIMARY_REL_PATH}`,
        provider: 'buffer',
        expectedSha256,
        expectedParams: TARGET_41M_PARAM_COUNT,
      });

      if (!verification.verified) {
        const state = await inspectR0NativeRuntimeState();
        AuditLedger.append('SYSTEM', 'R0_RUNTIME_INIT_REJECTED', {
          userId: req.sovereignUserId || 'unknown',
          gateStatus: verification.gateStatus,
          reason: verification.reason,
        });
        return res.status(409).json({
          success: false,
          status: 'BLOCKED',
          code: verification.gateStatus,
          source: 'disk',
          verification,
          state,
          error: `FAIL_CLOSED: ${verification.reason}`,
        });
      }

      const provider = NativeNeuralLMProvider.getInstance();
      const loadRes = await provider.loadVerifiedCloudBytes(buffer, {
        sourceUri: `file://${R0_PRIMARY_REL_PATH}`,
      });
      await ConnectivityMonitor.getInstance().checkNow().catch(() => null);
      const state = await inspectR0NativeRuntimeState();

      if (!state.inferenceReady) {
        return res.status(409).json({
          success: false,
          status: 'BLOCKED',
          code: 'RUNTIME_PARITY_FAILED',
          source: 'disk',
          verification,
          loadRes,
          state,
          error: state.reason || 'Native Runtime did not reach READY state after loading R0 bytes.',
        });
      }

      AuditLedger.append('SYSTEM', 'R0_RUNTIME_INITIALIZED_DISK', {
        userId: req.sovereignUserId || 'unknown',
        checkpointPath: R0_PRIMARY_REL_PATH,
        activeParams: state.activeParams,
        checkpointSha256: state.checkpointSha256,
        activeRuntimeId: state.activeRuntimeId,
      });

      return res.json({
        success: true,
        status: 'VERIFIED',
        source: 'disk',
        verification,
        state,
      });
    }

    const state = await inspectR0NativeRuntimeState();
    AuditLedger.append('SYSTEM', 'R0_RUNTIME_INIT_BLOCKED', {
      userId: req.sovereignUserId || 'unknown',
      code: 'R0_CHECKPOINT_NOT_FOUND',
      primaryPath: R0_PRIMARY_REL_PATH,
    });
    return res.status(409).json({
      success: false,
      status: 'BLOCKED',
      code: 'R0_CHECKPOINT_NOT_FOUND',
      state,
      error: `BLOCKED: ${R0_CHECKPOINT_FILENAME} was not found at ${R0_PRIMARY_REL_PATH} and no Cloud Object Storage / CHECKPOINT_PRESIGNED_URL is configured.`,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      status: 'BLOCKED',
      error: err?.message || 'R0 Native Runtime initialization failed.',
    });
  }
});

app.get('/api/model/training-logs', requireRole(['Developer', 'Administrator']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const pipe = ContinuousLearningPipeline.getInstance();
    const runs = pipe.listRuns({ tenantId: req.sovereignTenantId! });
    const latestRun = runs[0] || null;
    const lmEvalFile = path.resolve(process.cwd(), 'artifacts', 'lm-v2-eval.json');
    const gatedEvidenceFile = path.resolve(process.cwd(), 'artifacts', 'gated-training-evidence.json');
    let evalJson: any = null;
    let gatedJson: any = null;
    try {
      if (fs.existsSync(lmEvalFile)) evalJson = JSON.parse(fs.readFileSync(lmEvalFile, 'utf8'));
    } catch { /* ignore */ }
    try {
      if (fs.existsSync(gatedEvidenceFile)) gatedJson = JSON.parse(fs.readFileSync(gatedEvidenceFile, 'utf8'));
    } catch { /* ignore */ }

    const points = runs
      .slice()
      .reverse()
      .map((r, idx) => ({
        step: r.cumulativeTrainingSteps ?? r.trainingConfig.steps * (idx + 1),
        trainLoss: Number(r.baselineEval?.nll ?? 0),
        valLoss: Number(r.candidateEval?.nll ?? 0),
        gradNorm: null,
      }))
      .filter((p) => p.valLoss > 0);

    const liveSteps = runs.slice(0, 12).reverse().map((r) => ({
      trainingStep: r.cumulativeTrainingSteps ?? r.trainingConfig.steps,
      timestamp: Date.parse(r.createdAt) || Date.now(),
      lossBefore: Number(r.baselineEval?.nll ?? 0),
      lossAfter: Number(r.candidateEval?.nll ?? 0),
      lossReductionPct:
        typeof r.baselineEval?.nll === 'number' && r.baselineEval.nll > 0 && typeof r.candidateEval?.nll === 'number'
          ? Number((((r.baselineEval.nll - r.candidateEval.nll) / r.baselineEval.nll) * 100).toFixed(2))
          : 0,
      paramMutationDelta: typeof r.nllDelta === 'number' ? Math.abs(r.nllDelta) : 0,
      initialParamNorm: 0,
      finalParamNorm: 0,
      avgGradientNorm: 0,
    }));

    const bestValLoss = points.length > 0
      ? Math.min(...points.map((p) => p.valLoss))
      : (typeof evalJson?.val_loss === 'number' ? evalJson.val_loss : null);
    const bestValPerplexity = typeof bestValLoss === 'number'
      ? Number(Math.exp(Math.min(bestValLoss, 50)).toFixed(2))
      : (typeof evalJson?.perplexity === 'number' ? evalJson.perplexity : null);

    res.json({
      success: true,
      v2_2m: {
        params: latestRun?.candidateEval?.total_params ?? evalJson?.total_params ?? null,
        bestValLoss,
        bestValPerplexity,
        checkpointSha256: latestRun?.candidateCheckpointSha256 ?? evalJson?.checkpoint_sha256 ?? null,
        points,
        gatedPoints: Array.isArray(gatedJson?.runs) ? gatedJson.runs : [],
      },
      liveSteps,
      latestStep: latestRun
        ? {
            training_step: latestRun.cumulativeTrainingSteps ?? latestRun.trainingConfig.steps,
            loss_before: latestRun.baselineEval?.nll,
            loss_after: latestRun.candidateEval?.nll,
            loss_reduction_pct:
              typeof latestRun.baselineEval?.nll === 'number' && latestRun.baselineEval.nll > 0 && typeof latestRun.candidateEval?.nll === 'number'
                ? Number((((latestRun.baselineEval.nll - latestRun.candidateEval.nll) / latestRun.baselineEval.nll) * 100).toFixed(2))
                : undefined,
            model_name: latestRun.phaseLabel || 'PureSeqLM Candidate',
            executed_runtime_bridge: latestRun.checkpointStorageMode || 'LOCAL_CANDIDATE_ONLY',
            timestamp: Date.parse(latestRun.createdAt) || Date.now(),
          }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/model/comparison', requireRole(['Developer', 'Administrator']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const pipe = ContinuousLearningPipeline.getInstance();
    const runs = pipe.listRuns({ tenantId: req.sovereignTenantId! });
    const latestTrained = runs.find((r) => r.candidateEval && r.candidateCheckpointPath) || null;
    const promoted = runs.find((r) => r.status === 'PROMOTED') || null;
    const valNll = typeof latestTrained?.candidateEval?.nll === 'number' ? latestTrained.candidateEval.nll : null;
    const valPpl = typeof valNll === 'number' ? Number(Math.exp(Math.min(valNll, 50)).toFixed(2)) : null;

    res.json({
      success: true,
      activeCheckpoint: promoted
        ? { key: 'v2_2m', label: `${promoted.phaseLabel || promoted.runId} (Promoted)` }
        : { key: 'none', label: 'No active Cloud Runtime checkpoint loaded' },
      models: {
        target41m: {
          key: 'target41m',
          label: 'Target 41.53M Specification',
          checkpointPath: 'native_data/model_checkpoint_target_41m.pt',
          status: 'SPECIFICATION_ONLY',
          totalParams: 41_527_808,
          architecture: { n_layers: 10, n_heads: 8, d_model: 512, vocab: 16384 },
          trainingSteps: 0,
          memoryFootprintMb: 158.42,
          dtype: 'float32',
          lastEvaluatedLoss: null,
          lastEvaluatedPerplexity: null,
          checkpointSha256: null,
        },
        v2_2m: {
          key: 'v2_2m',
          label: latestTrained ? `PureSeqLM (${latestTrained.phaseLabel || latestTrained.runId})` : 'PureSeqLM Local Candidate',
          checkpointPath: latestTrained?.candidateCheckpointPath || 'checkpoints/',
          promotedCheckpointPath: promoted?.candidateCheckpointPath || null,
          status: promoted ? 'ACTIVE' : latestTrained ? 'VERIFIED_CANDIDATE' : 'NOT_TRAINED',
          totalParams: latestTrained?.baselineEval?.total_params ?? null,
          architecture: { n_layers: 1, n_heads: 4, d_model: 24, vocab: 532 },
          trainingSteps: latestTrained?.cumulativeTrainingSteps ?? 0,
          memoryFootprintMb: 0.25,
          dtype: 'float32',
          lastEvaluatedLoss: valNll,
          lastEvaluatedPerplexity: valPpl,
          gatedBestLoss: promoted?.candidateEval?.nll ?? null,
          gatedBestPerplexity:
            typeof promoted?.candidateEval?.nll === 'number'
              ? Number(Math.exp(Math.min(promoted.candidateEval.nll, 50)).toFixed(2))
              : null,
          top1AccuracyPct:
            typeof latestTrained?.candidateEval?.top1_accuracy === 'number'
              ? Number((latestTrained.candidateEval.top1_accuracy * 100).toFixed(1))
              : null,
          top5AccuracyPct: null,
          bigramBaselinePpl: null,
          checkpointSha256: latestTrained?.candidateCheckpointSha256 || null,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/model/promote', requireRole(['Administrator']), (_req: AuthenticatedRequest, res: Response) => {
  return res.status(409).json({
    success: false,
    code: 'GOVERNANCE_PIPELINE_REQUIRED',
    error: 'Promotion requires a verified Continuous Learning runId, passed regression & domain benchmarks, and an approved ApprovalGate request via /api/training/pipeline/promote.',
  });
});

// ==========================================
// 13. BATCH 28 / 29 / 30 COGNITIVE, ACTION, GOVERNANCE, TRAINING & DASHBOARD ROUTES
// ==========================================
app.get('/api/observability/operations', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conn = await ConnectivityMonitor.getInstance().checkNow();
    res.json({
      success: true,
      connectivity: conn,
      tools: ToolRegistry.getInstance().getTelemetry(),
      plans: AutonomousPlanner.getInstance().listPlans({ tenantId: req.sovereignTenantId!, ownerUserId: req.sovereignUserId! }),
      metrics: TaskOrchestrator.getInstance().getExecutionMetrics(),
      evaluation: SelfEvaluationEngine.getInstance().getLatestBenchmarkReport(),
      performance: PerformanceEngine.getInstance().getTelemetry(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tools/telemetry', requireAuth('developer'), (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, telemetry: ToolRegistry.getInstance().getTelemetry(), tools: ToolRegistry.getInstance().listDefinitions() });
});

app.post('/api/reasoning/verify', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { op, steps, expected_final, tasks, max_total_cost, source, candidates } = req.body || {};
    const outcome = await AdaptiveReasoningEngine.getInstance().executeReasoning({
      prompt: `Verify reasoning op=${op || 'auto'}`,
      scope: { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'developer' },
      mathSteps: Array.isArray(steps) ? steps : undefined,
      expectedFinal: expected_final !== undefined ? Number(expected_final) : undefined,
      cspTasks: Array.isArray(tasks) ? tasks : undefined,
      maxCost: max_total_cost !== undefined ? Number(max_total_cost) : undefined,
      pythonSource: typeof source === 'string' ? source : undefined,
    });
    res.json({
      success: true,
      result: {
        verified: outcome.verified,
        strategy: outcome.selectedStrategy,
        problemClass: outcome.problemClass,
        outcome,
        candidatesCount: Array.isArray(candidates) ? candidates.length : 0,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/governance/approvals', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    requests: ApprovalGate.getInstance().listRequests({ tenantId: req.sovereignTenantId! }),
  });
});

app.post('/api/governance/approvals', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { actionType, resourceId, description } = req.body || {};
    const request = ApprovalGate.getInstance().requestApproval({
      actionType,
      resourceId,
      description,
      requestedByUserId: req.sovereignUserId!,
      requestedByRole: req.sovereignRole || 'developer',
      tenantId: req.sovereignTenantId!,
    });
    res.status(201).json({ success: true, request });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/governance/approvals/:requestId/approve', requireAuth('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const request = ApprovalGate.getInstance().approveRequest(
      String(req.params.requestId),
      { userId: req.sovereignUserId!, role: req.sovereignRole || 'admin', tenantId: req.sovereignTenantId! },
      req.body?.note
    );
    res.json({ success: true, request });
  } catch (err: any) {
    const forbidden = String(err?.message || '').includes('FORBIDDEN');
    res.status(forbidden ? 403 : 400).json({ success: false, error: err.message });
  }
});

app.post('/api/governance/approvals/:requestId/reject', requireAuth('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const request = ApprovalGate.getInstance().rejectRequest(
      String(req.params.requestId),
      { userId: req.sovereignUserId!, role: req.sovereignRole || 'admin', tenantId: req.sovereignTenantId! },
      req.body?.note
    );
    res.json({ success: true, request });
  } catch (err: any) {
    const forbidden = String(err?.message || '').includes('FORBIDDEN');
    res.status(forbidden ? 403 : 400).json({ success: false, error: err.message });
  }
});

app.post('/api/evaluation/batch28', requireAuth('developer'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const report = await SelfEvaluationEngine.getInstance().runBatch28Benchmark();
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/training/pipeline/runs', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const pipe = ContinuousLearningPipeline.getInstance();
  res.json({
    success: true,
    runs: pipe.listRuns({ tenantId: req.sovereignTenantId! }),
    backups: pipe.listBackups(),
  });
});

app.post('/api/training/pipeline/run', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const run = await ContinuousLearningPipeline.getInstance().executePipelineRun({
      tenantId: req.sovereignTenantId!,
      initiatedBy: req.sovereignUserId!,
      ...(req.body || {}),
    });
    res.json({ success: true, run });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const status = msg.includes('NOT_FOUND') ? 404 : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

app.post('/api/training/pipeline/benchmark', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const run = await ContinuousLearningPipeline.getInstance().runDomainBenchmarks({
      runId: String(req.body?.runId || ''),
      tenantId: req.sovereignTenantId!,
    });
    res.json({ success: true, run });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const status = msg.includes('NOT_FOUND') || msg.includes('RUN_NOT_FOUND') ? 404 : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

app.post('/api/training/pipeline/promote', requireAuth('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const run = ContinuousLearningPipeline.getInstance().promoteApprovedRun({
      runId: String(req.body?.runId || ''),
      actor: { userId: req.sovereignUserId!, role: req.sovereignRole || 'admin', tenantId: req.sovereignTenantId! },
    });
    res.json({ success: true, run });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.post('/api/training/pipeline/rollback', requireAuth('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const out = ContinuousLearningPipeline.getInstance().rollbackCheckpoint({
      backupId: String(req.body?.backupId || ''),
      actor: { userId: req.sovereignUserId!, role: req.sovereignRole || 'admin', tenantId: req.sovereignTenantId! },
    });
    res.json({ success: true, ...out });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.post('/api/training/pipeline/publish-cloud', requireAuth('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = String(req.body?.runId || '').trim();
    const objectKey = typeof req.body?.objectKey === 'string' && req.body.objectKey.trim()
      ? req.body.objectKey.trim()
      : undefined;
    const presignedUploadUrl = typeof req.body?.presignedUploadUrl === 'string' && req.body.presignedUploadUrl.trim()
      ? req.body.presignedUploadUrl.trim()
      : undefined;
    const loadAfterUpload = req.body?.loadAfterUpload === true;

    if (!runId) {
      return res.status(400).json({ success: false, error: 'runId is required to publish a verified checkpoint to Cloud Storage.' });
    }
    const effectiveUploadUrl = presignedUploadUrl || process.env.CHECKPOINT_UPLOAD_URL?.trim() || '';
    if (effectiveUploadUrl) {
      const check = validateCloudUrl(effectiveUploadUrl);
      if (!check.ok) {
        return res.status(400).json({ success: false, code: 'SSRF_BLOCKED', error: check.reason });
      }
    }

    const pipe = ContinuousLearningPipeline.getInstance();
    const run = pipe.listRuns({ tenantId: req.sovereignTenantId! }).find((r) => r.runId === runId);
    if (!run) {
      return res.status(404).json({ success: false, error: `RUN_NOT_FOUND: Run '${runId}' not found.` });
    }
    if (!run.candidateCheckpointPath || !fs.existsSync(run.candidateCheckpointPath)) {
      return res.status(404).json({ success: false, error: 'CHECKPOINT_NOT_FOUND: Candidate checkpoint file does not exist.' });
    }
    if (!run.regressionPassed) {
      return res.status(409).json({ success: false, code: 'REGRESSION_GATE_BLOCKED', error: 'Cannot publish a candidate checkpoint that failed regression gates.' });
    }

    const approvedAlready = run.status === 'PROMOTED' || ApprovalGate.getInstance().verifyAndConsume({
      actionType: 'MODEL_RELEASE',
      resourceId: run.runId,
      tenantId: run.tenantId,
      approvalRequestId: run.approvalRequestId || undefined,
      consume: false,
    }).approved;

    if (!approvedAlready) {
      return res.status(403).json({
        success: false,
        code: 'APPROVAL_REQUIRED',
        error: 'Human ApprovalGate sign-off (MODEL_RELEASE) is mandatory before publishing a trained checkpoint to Cloud Object Storage.',
      });
    }

    const inspection = await pipe.inspectCheckpointFile(run.candidateCheckpointPath);
    if (!inspection?.valid) {
      return res.status(409).json({
        success: false,
        code: 'CORRUPTED_CHECKPOINT',
        error: inspection?.error || 'Candidate checkpoint failed integrity verification before cloud upload.',
      });
    }

    const buffer = fs.readFileSync(run.candidateCheckpointPath);
    const actualFileSha = crypto.createHash('sha256').update(buffer).digest('hex');
    if (run.candidateCheckpointFileSha256 && actualFileSha !== run.candidateCheckpointFileSha256) {
      return res.status(409).json({
        success: false,
        code: 'CHECKPOINT_TAMPERED',
        error: 'Candidate checkpoint SHA-256 mismatch against recorded training run.',
      });
    }

    const uploaded = await publishCheckpointBufferToCloud(buffer, {
      objectKey,
      presignedUploadUrl,
      modelKey: run.phaseId || 'active_native',
    });

    AuditLedger.append('GOVERNANCE', 'TRAINING_CHECKPOINT_PUBLISHED_CLOUD', {
      runId: run.runId,
      actorUserId: req.sovereignUserId,
      provider: uploaded.provider,
      sourceUri: uploaded.sourceUri,
      payloadSha256: uploaded.payloadSha256,
      totalParams: uploaded.totalParams,
    });

    let connectivity = null;
    if (loadAfterUpload) {
      connectivity = await ConnectivityMonitor.getInstance().reconnect(undefined, objectKey);
    }

    return res.json({
      success: true,
      uploaded,
      connectivity,
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const isFailClosed = msg.includes('FAIL_CLOSED');
    return res.status(isFailClosed ? 503 : 400).json({
      success: false,
      code: isFailClosed ? 'FAIL_CLOSED' : 'CLOUD_PUBLISH_ERROR',
      error: msg,
    });
  }
});

app.get('/api/training/pipeline/phases', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const pipe = ContinuousLearningPipeline.getInstance();
    const status = buildSevenPhaseStatus(req.sovereignTenantId!, {
      userId: req.sovereignUserId,
      role: req.sovereignRole,
    });
    const checkpoints = pipe.discoverCheckpoints({ tenantId: req.sovereignTenantId! });
    res.json({ success: true, ...status, checkpoints });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/training/pipeline/checkpoints', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const pipe = ContinuousLearningPipeline.getInstance();
    const checkpoints = pipe.discoverCheckpoints({ tenantId: req.sovereignTenantId! });
    res.json({ success: true, checkpoints });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/training/pipeline/inspect-checkpoint', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pipe = ContinuousLearningPipeline.getInstance();
    let targetPath = typeof req.body?.checkpointPath === 'string' ? req.body.checkpointPath.trim() : '';
    if (!targetPath && typeof req.body?.runId === 'string' && req.body.runId.trim()) {
      const run = pipe.listRuns({ tenantId: req.sovereignTenantId! }).find((r) => r.runId === req.body.runId.trim());
      if (!run || !run.candidateCheckpointPath) {
        return res.status(404).json({ success: false, error: 'RUN_NOT_FOUND: No checkpoint associated with that runId.' });
      }
      targetPath = run.candidateCheckpointPath;
    }
    if (!targetPath) {
      return res.status(400).json({ success: false, error: 'checkpointPath or runId is required.' });
    }
    const inspection = await pipe.inspectCheckpointFile(targetPath);
    res.json({ success: true, inspection });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const status = msg.includes('FORBIDDEN') ? 403 : msg.includes('NOT_FOUND') ? 404 : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

app.post('/api/training/pipeline/harvest-errors', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const report = harvestPhase7Errors(req.sovereignTenantId!, {
      userId: req.sovereignUserId,
      role: req.sovereignRole,
    });
    res.json({ success: true, harvest: report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/training/pipeline/phase-run', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body || {};
    const phaseId = String(body.phaseId || 'phase_1_continuation');
    const phaseDef = getPhaseDefinition(phaseId);
    if (!phaseDef) {
      return res.status(400).json({ success: false, error: `UNKNOWN_PHASE: '${phaseId}' is not a valid training phase.` });
    }

    let customSamples: string[] | undefined = Array.isArray(body.customSamples) && body.customSamples.length > 0
      ? body.customSamples.map(String)
      : undefined;
    let curriculumSource = body.resumeFromRunId ? 'exact_resume_frozen_dataset' : `curated_${phaseId}`;

    if (!body.resumeFromRunId && !customSamples) {
      if (phaseId === 'phase_7_continuous_improvement') {
        const harvested = harvestPhase7Errors(req.sovereignTenantId!, {
          userId: req.sovereignUserId,
          role: req.sovereignRole,
        });
        customSamples = harvested.combinedSamples;
        curriculumSource = `phase_7_harvested(errors=${harvested.harvestedErrorSamples.length},supp=${harvested.supplementalKnowledgeSamples.length})`;
      } else {
        customSamples = phaseDef.curatedCorpus;
      }
    }

    const pipe = ContinuousLearningPipeline.getInstance();
    const run = await pipe.executePipelineRun({
      tenantId: req.sovereignTenantId!,
      initiatedBy: req.sovereignUserId!,
      phaseId: phaseDef.id,
      phaseLabel: phaseDef.titleEn,
      curriculumSource,
      customSamples,
      documentIds: Array.isArray(body.documentIds) ? body.documentIds : undefined,
      steps: body.steps !== undefined ? Number(body.steps) : phaseDef.recommendedSteps,
      lr: body.lr !== undefined ? Number(body.lr) : phaseDef.recommendedLr,
      margin: body.margin !== undefined ? Number(body.margin) : -0.25,
      testMargin: body.testMargin !== undefined ? Number(body.testMargin) : 2.0,
      weightDecay: body.weightDecay !== undefined ? Number(body.weightDecay) : 0.01,
      gradientClip: body.gradientClip !== undefined ? Number(body.gradientClip) : 1.0,
      schedulerDecay: body.schedulerDecay !== undefined ? Number(body.schedulerDecay) : 0.995,
      seed: body.seed !== undefined ? Number(body.seed) : 2028,
      baselineCheckpointPath: typeof body.baselineCheckpointPath === 'string' && body.baselineCheckpointPath.trim()
        ? body.baselineCheckpointPath.trim()
        : undefined,
      resumeTraining: body.resumeTraining === true,
      resumeFromRunId: typeof body.resumeFromRunId === 'string' && body.resumeFromRunId.trim()
        ? body.resumeFromRunId.trim()
        : undefined,
    });

    if (body.runPhaseVerification !== false && run.candidateCheckpointPath && fs.existsSync(run.candidateCheckpointPath)) {
      await pipe.runPhaseEvaluation({
        runId: run.runId,
        tenantId: req.sovereignTenantId!,
        phaseId: phaseDef.id,
      });
    }

    res.json({ success: true, run });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const status = msg.includes('NOT_FOUND') ? 404 : msg.includes('FORBIDDEN') ? 403 : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

app.post('/api/training/pipeline/phase-evaluate', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await ContinuousLearningPipeline.getInstance().runPhaseEvaluation({
      runId: String(req.body?.runId || ''),
      tenantId: req.sovereignTenantId!,
      phaseId: typeof req.body?.phaseId === 'string' ? req.body.phaseId : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const status = msg.includes('NOT_FOUND') ? 404 : msg.includes('FORBIDDEN') ? 403 : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

// Batch 29 Cognitive API Routes
app.get('/api/cognitive/operations', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const ctxEngine = CognitiveContextEngine.getInstance();
    const rsnEngine = AdaptiveReasoningEngine.getInstance();
    const kgEngine = KnowledgeGraphEngine.getInstance();
    const memCtrl = NativeMemoryController.getInstance();
    const perf = PerformanceEngine.getInstance();
    const multimodal = await getMultimodalCapabilityRegistry();
    const gates = await getCapabilityGatesSnapshot({ multimodal });
    const latestEval = loadLatestBatch29EvalReport();

    res.json({
      success: true,
      contextStats: ctxEngine.getSummaryStats({ tenantId: scope.tenantId }),
      reasoningHistory: rsnEngine.getHistory(10),
      knowledgeGraph: kgEngine.getGraphSummary({ tenantId: scope.tenantId, role: scope.role }),
      memoryLifecycle: memCtrl.analyzeMemoryLifecycle(scope),
      performance: perf.getTelemetry(),
      multimodal,
      gates,
      latestEvaluation: latestEval,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/context/analyze', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = String(req.body?.input || '');
    if (!input.trim()) return res.status(400).json({ success: false, error: 'input string required' });
    const conn = await ConnectivityMonitor.getInstance().getStatus();
    const analysis = CognitiveContextEngine.getInstance().analyzeContext({
      input,
      query: req.body?.query,
      nativeNeuralState: conn.runtimeState === 'READY' ? 'READY' : 'BLOCKED',
    });
    return res.json({ success: true, analysis });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/cognitive/context/sessions', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'developer' };
  res.json({ success: true, sessions: CognitiveContextEngine.getInstance().listSessions(scope) });
});

app.post('/api/cognitive/context/sessions', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId, role, text, pinAsFact } = req.body || {};
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'developer' };
    const result = CognitiveContextEngine.getInstance().upsertSessionTurn({
      sessionId: String(sessionId || `sess_${Date.now()}`),
      role: role === 'assistant' || role === 'system' ? role : 'user',
      text: String(text || ''),
      pinAsFact: Boolean(pinAsFact),
      scope,
    });
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN:') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.post('/api/cognitive/reasoning/execute', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'developer' };
    const outcome = await AdaptiveReasoningEngine.getInstance().executeReasoning({
      ...(req.body || {}),
      prompt: String(req.body?.prompt || ''),
      scope,
    });
    res.json({ success: true, outcome });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/reasoning/benchmark', requireAuth('developer'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const benchmark = await AdaptiveReasoningEngine.getInstance().evaluateAgainstIndependentBenchmark();
    res.json({ success: true, benchmark });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/graph/build', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const result = KnowledgeGraphEngine.getInstance().buildFromWorkspace({
    tenantId: req.sovereignTenantId!,
    role: req.sovereignRole || 'developer',
  });
  res.json({ success: true, result });
});

app.post('/api/cognitive/graph/traverse', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const result = KnowledgeGraphEngine.getInstance().traverseMultiHop(String(req.body?.query || ''), {
    maxHops: Number(req.body?.maxHops || 2),
    limit: Number(req.body?.limit || 5),
    scope: { tenantId: req.sovereignTenantId!, role: req.sovereignRole || 'developer' },
  });
  res.json({ success: true, result });
});

app.get('/api/cognitive/graph/verify', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const scope = { tenantId: req.sovereignTenantId!, role: req.sovereignRole || 'developer' };
  res.json({
    success: true,
    consistency: KnowledgeGraphEngine.getInstance().verifyGraphConsistency(scope),
    contradictions: KnowledgeGraphEngine.getInstance().detectGraphContradictions(scope),
  });
});

app.post('/api/cognitive/memory/consolidate', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = NativeMemoryController.getInstance().consolidateEpisodicToSemanticReversible({
      targetKey: String(req.body?.targetKey || `semantic_cons_${Date.now()}`),
      sourceCategory: req.body?.sourceCategory || 'episodic',
      maxSources: Number(req.body?.maxSources || 10),
      archiveSourcesFromActive: req.body?.archiveSourcesFromActive ?? true,
      scope: { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'developer' },
    });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/memory/rollback', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = NativeMemoryController.getInstance().rollbackConsolidation(String(req.body?.consolidationId || ''), {
      tenantId: req.sovereignTenantId!,
      userId: req.sovereignUserId!,
      role: req.sovereignRole || 'developer',
    });
    res.json({ success: true, result });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN:') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.get('/api/cognitive/memory/lifecycle', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'developer' };
  res.json({
    success: true,
    lifecycle: NativeMemoryController.getInstance().analyzeMemoryLifecycle(scope),
    integrity: NativeMemoryController.getInstance().verifyStoreIntegrity(),
  });
});

app.post('/api/cognitive/performance/optimize', requireAuth('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const snapshot = PerformanceEngine.getInstance().applyOptimization({
      updates: req.body?.updates || {},
      reason: String(req.body?.reason || 'Operator optimization'),
      appliedBy: req.sovereignUserId!,
    });
    res.json({ success: true, snapshot });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive/performance/rollback', requireAuth('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const snapshot = PerformanceEngine.getInstance().rollbackOptimization(
      String(req.body?.snapshotId || ''),
      req.sovereignUserId!
    );
    res.json({ success: true, snapshot });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/cognitive/multimodal/capabilities', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  const registry = await getMultimodalCapabilityRegistry();
  res.json({ success: true, registry });
});

app.get('/api/cognitive/evaluation', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, report: loadLatestBatch29EvalReport() });
});

app.post('/api/cognitive/evaluation', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    assertNoManualScoreInjection(req.body);
    const report = await runBatch29Evaluation();
    return res.json({ success: true, report });
  } catch (err: any) {
    const msg = String(err?.message || err);
    return res.status(msg.includes('INVALID_EVALUATION_INPUT') ? 400 : 500).json({ success: false, error: msg });
  }
});

app.get('/api/cognitive/gates', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const snapshot = await getCapabilityGatesSnapshot();
    res.json({ success: true, ...snapshot });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CognitiveCore Module API Routes (extends IntelligenceCore with persistent state, memory buffers, recursive planning)
app.get('/api/cognitive-core/snapshot', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const query = typeof req.query.query === 'string' ? req.query.query : undefined;
    const category = typeof req.query.category === 'string' ? (req.query.category as any) : undefined;
    const snapshot = await CognitiveCore.getInstance().getSnapshot(scope, { query, category });
    res.json({ success: true, snapshot });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/cognitive-core/state', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.sovereignTenantId || 'default-tenant';
    const state = CognitiveCore.getInstance().updateState(tenantId, req.body || {});
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive-core/state/checkpoint', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const { checkpoint, state } = CognitiveCore.getInstance().saveCheckpoint(scope, req.body?.label);
    res.status(201).json({ success: true, checkpoint, state });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.get('/api/cognitive-core/memory', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const query = typeof req.query.query === 'string' ? req.query.query : undefined;
    const category = typeof req.query.category === 'string' ? (req.query.category as any) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const memory = CognitiveCore.getInstance().listMemoryBuffers(scope, { query, category, limit });
    res.json({ success: true, memory });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive-core/memory', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const result = CognitiveCore.getInstance().commitMemoryBuffer(scope, req.body || {});
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.delete('/api/cognitive-core/memory/:key', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const deleted = CognitiveCore.getInstance().deleteMemoryBuffer(scope, req.params.key);
    res.json({ success: true, deleted });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.post('/api/cognitive-core/memory/consolidate', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const result = CognitiveCore.getInstance().consolidateMemoryBuffer(scope, req.body || {});
    res.json({ success: true, result });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.get('/api/cognitive-core/plans', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const plans = CognitiveCore.getInstance().listRecursivePlans(scope);
    res.json({ success: true, plans });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cognitive-core/plans', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const plan = CognitiveCore.getInstance().createRecursivePlan(scope, req.body || {});
    res.status(201).json({ success: true, plan });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.post('/api/cognitive-core/plans/:planId/expand', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const plan = CognitiveCore.getInstance().expandRecursiveNode(scope, {
      planId: req.params.planId,
      nodeId: String(req.body?.nodeId || ''),
      focusHint: req.body?.focusHint,
      branchFactor: req.body?.branchFactor ? Number(req.body.branchFactor) : undefined,
    });
    res.json({ success: true, plan });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const status = msg.includes('NOT_FOUND') ? 404 : msg.includes('FORBIDDEN') ? 403 : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

app.patch('/api/cognitive-core/plans/:planId/nodes/:nodeId', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const plan = CognitiveCore.getInstance().updateRecursiveNodeStatus(scope, {
      planId: req.params.planId,
      nodeId: req.params.nodeId,
      status: req.body?.status,
      note: req.body?.note,
    });
    res.json({ success: true, plan });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const status = msg.includes('NOT_FOUND') ? 404 : msg.includes('FORBIDDEN') ? 403 : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

app.delete('/api/cognitive-core/plans/:planId', requireAuth('guest'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'guest' };
    const deleted = CognitiveCore.getInstance().deleteRecursivePlan(scope, req.params.planId);
    res.json({ success: true, deleted });
  } catch (err: any) {
    const msg = String(err?.message || err);
    res.status(msg.includes('FORBIDDEN') ? 403 : 400).json({ success: false, error: msg });
  }
});

// Batch 30 Action-Driven Routes
app.get('/api/action/capabilities', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const capabilities = await ActionDrivenEngine.getInstance().getCapabilities({
      tenantId: req.sovereignTenantId!,
      userId: req.sovereignUserId!,
      role: req.sovereignRole || 'guest',
    });
    res.json({ success: true, capabilities });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/action/perceive', requireAuth('guest'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const perception = await ActionDrivenEngine.getInstance().perceiveEnvironment(String(req.body?.goal || ''), {
      tenantId: req.sovereignTenantId!,
      userId: req.sovereignUserId!,
      role: req.sovereignRole || 'guest',
    });
    res.json({ success: true, perception });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/action/missions', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const missions = ActionDrivenEngine.getInstance().listMissions({
    tenantId: req.sovereignTenantId!,
    userId: req.sovereignUserId!,
    role: req.sovereignRole || 'developer',
  });
  res.json({ success: true, missions });
});

app.get('/api/action/missions/:missionId', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const mission = ActionDrivenEngine.getInstance().getMission(String(req.params.missionId), {
      tenantId: req.sovereignTenantId!,
      userId: req.sovereignUserId!,
      role: req.sovereignRole || 'developer',
    });
    if (!mission) return res.status(404).json({ success: false, error: 'MISSION_NOT_FOUND' });
    return res.json({ success: true, mission });
  } catch (err: any) {
    const msg = String(err?.message || err);
    return res.status(msg.includes('FORBIDDEN') ? 403 : 400).json({ success: false, error: msg });
  }
});

app.post('/api/action/missions/run', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const mission = await ActionDrivenEngine.getInstance().executeActionMission(req.body || {}, {
      tenantId: req.sovereignTenantId!,
      userId: req.sovereignUserId!,
      role: req.sovereignRole || 'developer',
    });
    return res.json({ success: true, mission });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Unified Truth Dashboard + 20-Task Stage Benchmarks + Research & Automation Routes
app.get('/api/dashboard/truth', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const avgLatency =
      apiSamples.length > 0 ? Math.round(apiSamples.reduce((a, b) => a + b, 0) / apiSamples.length) : null;
    const connectivityState = await ConnectivityMonitor.getInstance().checkNow();
    const truth = await buildTruthDashboardSnapshot(connectivityState, {
      wsClientCount,
      wsLastFrameAt,
      apiAvgLatencyMs: avgLatency,
      apiSampleCount: apiSamples.length,
      lastRecordedTokensPerSec,
      lastInferenceLatencyMs: lastRecordedLatencyMs,
    });
    res.json({ success: true, truth });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const STAGE_BENCH_EVIDENCE_PATH = path.resolve(process.cwd(), 'native_data', 'stage_bench_latest.json');

app.get('/api/benchmarks/stages', requireAuth('developer'), (_req: AuthenticatedRequest, res: Response) => {
  let latest: any = null;
  if (fs.existsSync(STAGE_BENCH_EVIDENCE_PATH)) {
    try {
      latest = JSON.parse(fs.readFileSync(STAGE_BENCH_EVIDENCE_PATH, 'utf8'));
    } catch {
      latest = null;
    }
  }
  res.json({
    success: true,
    latest,
  });
});

app.post('/api/benchmarks/stages/run', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.body?.mode === 'external') {
      return res.status(403).json({
        success: false,
        code: 'NATIVE_ONLY_POLICY',
        error: 'External AI brain execution is disabled. ZYNTHEOR uses its Native Intelligence architecture as the only intelligence controller.',
      });
    }
    const mode = 'specification';
    const args = ['-m', 'qplus_native.stage_bench', '--json'];

    let stdout = '';
    try {
      const execRes = await execFileAsync('python3', args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONPATH: process.cwd() },
        timeout: 120000,
      });
      stdout = execRes.stdout || '';
    } catch (execErr: any) {
      const errStdout = typeof execErr?.stdout === 'string' ? execErr.stdout.trim() : '';
      if (errStdout.startsWith('{')) {
        const failPayload = JSON.parse(errStdout);
        return res.status(412).json({
          success: false,
          code: failPayload.status || 'FAIL_CLOSED',
          error: failPayload.error || execErr.message,
          report: {
            mode: 'FAIL_CLOSED_SPECIFICATION',
            attribution: failPayload.status || 'FAIL_CLOSED',
            total_tasks: 0,
            error: failPayload.error || execErr.message,
            status: failPayload.status || 'FAIL_CLOSED',
          },
        });
      }
      throw execErr;
    }

    const raw = JSON.parse(stdout.trim());
    const stagesObj = raw?.summary?.stages;
    const stagePassRates = stagesObj
      ? Object.fromEntries(
          Object.entries(stagesObj).map(([k, v]: [string, any]) => [
            k,
            {
              passed: Number(v?.passed || 0),
              total: Number(v?.total || 0),
              rate: Number(v?.ratePct || 0) / 100,
              ratePct: Number(v?.ratePct || 0),
            },
          ])
        )
      : undefined;

    const report = {
      ...raw,
      mode: raw.mode || raw.status || 'FAIL_CLOSED_SPECIFICATION',
      attribution: raw.mode || raw.status || 'FAIL_CLOSED_SPECIFICATION',
      total_tasks: typeof raw.evaluatedTasks === 'number' ? raw.evaluatedTasks : Number(raw.totalTasks || 0),
      delivered_count: raw?.summary?.delivered,
      hidden_pass_rate_pct: raw?.summary?.hiddenPassRatePct,
      stage_pass_rates: stagePassRates,
    };

    if (report.stage_pass_rates) {
      fs.mkdirSync(path.dirname(STAGE_BENCH_EVIDENCE_PATH), { recursive: true });
      fs.writeFileSync(STAGE_BENCH_EVIDENCE_PATH, JSON.stringify(report, null, 2), 'utf8');
    }

    AuditLedger.append('SYSTEM', 'STAGE_BENCHMARK_EXECUTED', {
      userId: req.sovereignUserId,
      mode: report.mode,
      attribution: report.attribution,
      totalTasks: report.total_tasks,
      stageRates: report.stage_pass_rates || null,
    });
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/research/investigate', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ success: false, error: 'query string required' });
    const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'developer' };
    const knowledgeHits = KnowledgeIntelligenceEngine.getInstance().advancedRetrieve(query, {
      tenantId: scope.tenantId,
      role: scope.role,
      limit: 5,
    });
    const graphPaths = KnowledgeGraphEngine.getInstance().traverseMultiHop(query, { maxHops: 2, limit: 5, scope });
    let webResearch: any = { ok: false, status: 'NOT_REQUESTED', items: [], warnings: [], note: 'Online topic lookup not requested' };
    let internetCheck: any = null;
    if (req.body?.includeWeb === true) {
      try {
        internetCheck = await ConnectivityMonitor.getInstance().requireInternetConnectivity('research-web-investigate');
        const webRes = await InternetIntegrationEngine.getInstance().researchWebTopic(query, {
          tenantId: scope.tenantId,
          userId: scope.userId,
        });
        const items = Array.isArray(webRes?.items) ? webRes.items : [];
        const warnings = Array.isArray(webRes?.warnings) ? webRes.warnings : [];
        webResearch = {
          ok: items.length > 0,
          status: items.length > 0 ? 'VERIFIED' : warnings.length > 0 ? 'BLOCKED' : 'PARTIAL',
          items,
          warnings,
          error: items.length === 0 && warnings.length > 0 ? warnings.join('; ') : undefined,
        };
      } catch (webErr: any) {
        const errMsg = webErr?.message || 'Online web investigation blocked (connectivity unavailable).';
        webResearch = {
          ok: false,
          status: 'BLOCKED',
          code: webErr instanceof ConnectivityRequiredError ? 'FAIL_CLOSED' : 'WEB_LOOKUP_FAILED',
          items: [],
          warnings: [errMsg],
          error: errMsg,
        };
      }
    }
    const reasoning = await AdaptiveReasoningEngine.getInstance().executeReasoning({ prompt: query, scope });
    res.json({
      success: true,
      query,
      knowledgeHits,
      graphPaths,
      internetCheck,
      webResearch,
      reasoning,
    });
  } catch (err: any) {
    if (err instanceof ConnectivityRequiredError) {
      return res.status(503).json({ success: false, code: 'FAIL_CLOSED', error: err.message });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

// Native NumPy Backend & 5,800-Step Training Pipeline Routes for ResearchLab
app.get('/api/research/numpy-env', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customBin = typeof req.query?.pythonBin === 'string' ? req.query.pythonBin.trim() : undefined;
    const report = await probeNativeNumpyEnvironment(customBin);
    return res.json({ success: true, report });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.post('/api/research/numpy-env/establish', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = req.body && typeof req.body === 'object' ? req.body : {};
    const pythonBin = typeof raw.pythonBin === 'string' && raw.pythonBin.trim() ? raw.pythonBin.trim() : undefined;
    const attemptInstall = raw.attemptInstall === true;
    const result = await establishNativeNumpyEnvironment({ pythonBin, attemptInstall });
    return res.status(result.established ? 200 : 409).json({
      success: result.established,
      ...result,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.get('/api/research/training-pipeline/status', requireAuth('developer'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const numpy = await probeNativeNumpyEnvironment();
    const lastInit = loadLastInitializedTrainingPipeline();
    const execution = getTrainingLoopExecutionStatus();
    return res.json({
      success: true,
      numpy,
      initializedPipeline: lastInit,
      execution,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.post('/api/research/training-pipeline/init', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const snapshot = await initializeTrainingPipeline({
      targetSteps: typeof body.targetSteps === 'number' ? body.targetSteps : undefined,
      steps: typeof body.steps === 'number' ? body.steps : undefined,
      evalEvery: typeof body.evalEvery === 'number' ? body.evalEvery : undefined,
      saveEvery: typeof body.saveEvery === 'number' ? body.saveEvery : undefined,
      batch: typeof body.batch === 'number' ? body.batch : undefined,
      lr: typeof body.lr === 'number' ? body.lr : undefined,
      weightDecay: typeof body.weightDecay === 'number' ? body.weightDecay : undefined,
      tokenizerProfile: body.tokenizerProfile === 'bilingual_v4' ? 'bilingual_v4' : 'v2_base',
      initCheckpoint: typeof body.initCheckpoint === 'string' ? body.initCheckpoint : undefined,
      outCheckpoint: typeof body.outCheckpoint === 'string' ? body.outCheckpoint : undefined,
      datasetFile: typeof body.datasetFile === 'string' ? body.datasetFile : undefined,
      provenanceManifest: typeof body.provenanceManifest === 'string' ? body.provenanceManifest : undefined,
      evidenceRoot: typeof body.evidenceRoot === 'string' ? body.evidenceRoot : undefined,
      approvalKeyFile: typeof body.approvalKeyFile === 'string' ? body.approvalKeyFile : undefined,
      approvalRequestId: typeof body.approvalRequestId === 'string' ? body.approvalRequestId : undefined,
      humanApprovalConfirmed: body.humanApprovalConfirmed === true,
      allowFreshInit: body.allowFreshInit === true,
      pythonBin: typeof body.pythonBin === 'string' ? body.pythonBin : undefined,
      cloudObjectKey: typeof body.cloudObjectKey === 'string' ? body.cloudObjectKey : undefined,
      verifyCloudReadWrite: body.verifyCloudReadWrite !== false,
      tenantId: req.sovereignTenantId,
    });
    return res.json({
      success: true,
      snapshot,
      execution: getTrainingLoopExecutionStatus(),
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

app.post('/api/research/training-pipeline/start', requireAuth('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const outcome = await startInitializedTrainingLoop({
      targetSteps: typeof body.targetSteps === 'number' ? body.targetSteps : undefined,
      steps: typeof body.steps === 'number' ? body.steps : undefined,
      evalEvery: typeof body.evalEvery === 'number' ? body.evalEvery : undefined,
      saveEvery: typeof body.saveEvery === 'number' ? body.saveEvery : undefined,
      batch: typeof body.batch === 'number' ? body.batch : undefined,
      lr: typeof body.lr === 'number' ? body.lr : undefined,
      weightDecay: typeof body.weightDecay === 'number' ? body.weightDecay : undefined,
      tokenizerProfile: body.tokenizerProfile === 'bilingual_v4' ? 'bilingual_v4' : 'v2_base',
      initCheckpoint: typeof body.initCheckpoint === 'string' ? body.initCheckpoint : undefined,
      outCheckpoint: typeof body.outCheckpoint === 'string' ? body.outCheckpoint : undefined,
      datasetFile: typeof body.datasetFile === 'string' ? body.datasetFile : undefined,
      provenanceManifest: typeof body.provenanceManifest === 'string' ? body.provenanceManifest : undefined,
      evidenceRoot: typeof body.evidenceRoot === 'string' ? body.evidenceRoot : undefined,
      approvalKeyFile: typeof body.approvalKeyFile === 'string' ? body.approvalKeyFile : undefined,
      approvalRequestId: typeof body.approvalRequestId === 'string' ? body.approvalRequestId : undefined,
      humanApprovalConfirmed: body.humanApprovalConfirmed === true,
      allowFreshInit: body.allowFreshInit === true,
      pythonBin: typeof body.pythonBin === 'string' ? body.pythonBin : undefined,
      cloudObjectKey: typeof body.cloudObjectKey === 'string' ? body.cloudObjectKey : undefined,
      verifyCloudReadWrite: body.verifyCloudReadWrite !== false,
      tenantId: req.sovereignTenantId,
    });
    return res.status(outcome.started ? 202 : 409).json({
      success: outcome.started,
      ...outcome,
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

app.post('/api/research/provenance/verify', requireRole(['Developer', 'Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const pyProbe = await probeNativeNumpyEnvironment();
    const pyBin = pyProbe.pythonExecutable || 'python3';
    const workspaceRoot = path.resolve(process.cwd());
    const args = ['-B', path.join(workspaceRoot, 'scripts', 'sign_dataset_provenance.py'), '--verify-only'];
    const rawKeyPath =
      resolveConfiguredApprovalKeyFile(
        typeof body.approvalKeyFile === 'string' ? body.approvalKeyFile : undefined
      ) || '';
    if (rawKeyPath) {
      const resolvedKey = path.resolve(workspaceRoot, rawKeyPath);
      if (!resolvedKey.startsWith(workspaceRoot + path.sep) && !path.isAbsolute(rawKeyPath)) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN: Key file path outside workspace.' });
      }
      args.push('--key-file', resolvedKey);
    }
    const execAsync = promisify(execFile);
    let stdout = '';
    try {
      const out = await execAsync(pyBin, args, { cwd: workspaceRoot, timeout: 15_000 });
      stdout = out.stdout;
    } catch (err: any) {
      stdout = String(err?.stdout || '');
      if (!stdout.trim().startsWith('{')) {
        return res.status(400).json({ success: false, error: err?.message || String(err) });
      }
    }
    const report = JSON.parse(stdout.trim());
    return res.json({
      success: report?.status === 'VERIFIED',
      report,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.post('/api/research/provenance/sign', requireRole(['Administrator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.humanApprovalConfirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'FAIL_CLOSED: Explicit Administrator confirmation (humanApprovalConfirmed=true) is required to sign dataset provenance.',
      });
    }
    const rawKeyPath =
      resolveConfiguredApprovalKeyFile(
        typeof body.approvalKeyFile === 'string' ? body.approvalKeyFile : undefined
      ) || '';
    if (!rawKeyPath) {
      return res.status(400).json({
        success: false,
        error: 'FAIL_CLOSED: External 0600 HMAC key path (ZYNTHEOR_APPROVAL_KEY_FILE) is required.',
      });
    }
    const sourceBaseUrl = typeof body.sourceBaseUrl === 'string' ? body.sourceBaseUrl.trim() : '';
    const licenseUrl = typeof body.licenseUrl === 'string' ? body.licenseUrl.trim() : '';
    if (!sourceBaseUrl.startsWith('https://') || !licenseUrl.startsWith('https://')) {
      return res.status(400).json({
        success: false,
        error: 'FAIL_CLOSED: sourceBaseUrl and licenseUrl must be valid https:// URLs.',
      });
    }
    const workspaceRoot = path.resolve(process.cwd());
    const resolvedKey = path.resolve(workspaceRoot, rawKeyPath);
    const pyProbe = await probeNativeNumpyEnvironment();
    const pyBin = pyProbe.pythonExecutable || 'python3';
    const args = [
      '-B',
      path.join(workspaceRoot, 'scripts', 'sign_dataset_provenance.py'),
      '--key-file',
      resolvedKey,
      '--approver',
      req.sovereignUserId || 'admin',
      '--source-base-url',
      sourceBaseUrl,
      '--license-url',
      licenseUrl,
    ];
    const execAsync = promisify(execFile);
    let stdout = '';
    try {
      const out = await execAsync(pyBin, args, { cwd: workspaceRoot, timeout: 20_000 });
      stdout = out.stdout;
    } catch (err: any) {
      stdout = String(err?.stdout || '');
      if (stdout.trim().startsWith('{')) {
        const errPayload = JSON.parse(stdout.trim());
        return res.status(400).json({ success: false, ...errPayload });
      }
      return res.status(400).json({ success: false, error: err?.message || String(err) });
    }
    const report = JSON.parse(stdout.trim());
    AuditLedger.append('GOVERNANCE', 'DATASET_PROVENANCE_HMAC_SIGNED', {
      approver: req.sovereignUserId,
      verifiedDocuments: report?.verified_documents,
      documentCount: report?.document_count,
      keyId: report?.key_id,
      corpusSha256: report?.corpus_sha256,
    });
    return res.json({
      success: report?.status === 'VERIFIED',
      report,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.get('/api/automation/jobs', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  const scope = { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'developer' };
  const missions = ActionDrivenEngine.getInstance().listMissions(scope).slice(0, 20);
  const plans = AutonomousPlanner.getInstance().listPlans({ tenantId: scope.tenantId, ownerUserId: scope.userId });
  res.json({
    success: true,
    missions,
    plans,
    metrics: TaskOrchestrator.getInstance().getExecutionMetrics(),
  });
});

app.post('/api/automation/run', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const mission = await ActionDrivenEngine.getInstance().executeActionMission(
      {
        goal: String(req.body?.goal || 'Run scheduled system integrity & security verification sweep'),
        mode: req.body?.mode || 'system_integrity_audit',
        priority: normalizeTaskPriority(req.body?.priority),
      },
      { tenantId: req.sovereignTenantId!, userId: req.sovereignUserId!, role: req.sovereignRole || 'developer' }
    );
    res.json({ success: true, mission });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/assistant/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    available: isAssistantConfigured(),
    model: getAssistantModelName(),
    brainCore: getAssistantBrainStatus(),
    capabilities: [
      'function_calling',
      'system_telemetry',
      'knowledge_hub_search',
      'workspace_inspection',
      'audit_ledger',
      'web_grounding',
      'url_context',
      'multimodal_attachments',
      'thinking_levels',
      'short_term_session_memory',
      'live_workspace_context',
      'assistant_brain_core',
      'adaptive_reasoning',
      'persistent_episodic_memory',
      'dag_goal_planning',
    ],
  });
});

app.get('/api/assistant/brain', (_req: Request, res: Response) => {
  res.json({
    success: true,
    brain: getAssistantBrainStatus(),
  });
});

app.post('/api/assistant/context', (req: Request, res: Response) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : 'default-session';
  const moduleState =
    req.body?.moduleState && typeof req.body.moduleState === 'object' ? req.body.moduleState : undefined;
  const workspaceMetadata =
    req.body?.workspaceMetadata && typeof req.body.workspaceMetadata === 'object'
      ? req.body.workspaceMetadata
      : undefined;
  const rawContext = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
  const context = {
    sessionId,
    activeModule: typeof rawContext.activeModule === 'string' ? rawContext.activeModule : moduleState?.moduleId,
    lang: rawContext.lang === 'en' ? ('en' as const) : ('th' as const),
    role: typeof rawContext.role === 'string' ? rawContext.role : undefined,
    runtimeReady: typeof rawContext.runtimeReady === 'boolean' ? rawContext.runtimeReady : undefined,
    recentLogs: Array.isArray(rawContext.recentLogs)
      ? rawContext.recentLogs.filter((l: unknown): l is string => typeof l === 'string').slice(-12)
      : undefined,
  };

  const session = syncAssistantSessionContext(sessionId, {
    moduleState,
    workspaceMetadata,
    context,
  });

  res.json({ success: true, session });
});

app.get('/api/assistant/session/:sessionId', (req: Request, res: Response) => {
  const session = getAssistantSessionMemoryInfo(req.params.sessionId);
  res.json({ success: true, session });
});

app.delete('/api/assistant/session/:sessionId', (req: Request, res: Response) => {
  const cleared = clearAssistantSessionMemory(req.params.sessionId);
  res.json({ success: true, cleared });
});

function resolveVerifiedAssistantCallerRole(req: Request): SovereignRole {
  let token: string | null = null;
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const trimmed = authHeader.slice(7).trim();
    if (trimmed) token = trimmed;
  }
  if (!token) {
    const dedicated = req.headers['x-zyntheor-token'];
    if (typeof dedicated === 'string' && dedicated.trim()) {
      token = dedicated.trim();
    }
  }
  if (!token) return 'guest';

  const verification = SovereignIdentity.getInstance().verifyToken(token);
  if (!verification.valid || !verification.payload) return 'guest';
  if (verification.payload.jti && TokenRevocation.isRevoked(verification.payload.jti)) {
    return 'guest';
  }
  return verification.payload.role;
}

app.post('/api/assistant/chat', async (req: Request, res: Response) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (!message && attachments.length === 0) {
    return res.status(400).json({ success: false, error: 'Message or attachment is required.' });
  }

  const verifiedCallerRole = resolveVerifiedAssistantCallerRole(req);

  const sessionId =
    typeof req.body?.sessionId === 'string'
      ? req.body.sessionId
      : typeof req.body?.context?.sessionId === 'string'
      ? req.body.context.sessionId
      : 'default-session';
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const rawThinking = req.body?.thinkingMode;
  const thinkingMode: AssistantThinkingMode =
    rawThinking === 'fast' || rawThinking === 'deep' ? rawThinking : 'balanced';
  const webGrounding = req.body?.webGrounding === true;
  const moduleState =
    req.body?.moduleState && typeof req.body.moduleState === 'object' ? req.body.moduleState : undefined;
  const workspaceMetadata =
    req.body?.workspaceMetadata && typeof req.body.workspaceMetadata === 'object'
      ? req.body.workspaceMetadata
      : undefined;
  const rawContext = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
  const context = {
    sessionId,
    activeModule: typeof rawContext.activeModule === 'string' ? rawContext.activeModule : moduleState?.moduleId,
    lang: rawContext.lang === 'en' ? ('en' as const) : ('th' as const),
    role: typeof rawContext.role === 'string' ? rawContext.role : undefined,
    runtimeReady: typeof rawContext.runtimeReady === 'boolean' ? rawContext.runtimeReady : undefined,
    recentLogs: Array.isArray(rawContext.recentLogs)
      ? rawContext.recentLogs.filter((l: unknown): l is string => typeof l === 'string').slice(-12)
      : undefined,
    moduleState,
    workspaceMetadata,
  };

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    await runUpgradedAssistant({
      sessionId,
      message:
        message ||
        (context.lang === 'en'
          ? 'Please analyze the attached file(s).'
          : 'กรุณาวิเคราะห์ไฟล์ที่แนบมา'),
      history,
      attachments,
      context,
      verifiedCallerRole,
      moduleState,
      workspaceMetadata,
      thinkingMode,
      webGrounding,
      onEvent: (event) => {
        res.write(JSON.stringify(event) + '\n');
      },
    });
    res.end();
  } catch (err: any) {
    const errMsg = err?.message || 'AI Assistant request failed.';
    if (res.headersSent) {
      res.write(JSON.stringify({ type: 'error', error: errMsg }) + '\n');
      res.end();
    } else {
      const status = typeof err?.status === 'number' ? err.status : 500;
      res.status(status).json({ success: false, error: errMsg });
    }
  }
});

function toEngineeringScope(req: AuthenticatedRequest): EngineeringScope {
  return {
    tenantId: req.sovereignTenantId || 'tenant_default',
    userId: req.sovereignUserId || 'anonymous',
    role: req.sovereignRole || 'developer',
  };
}

function mapEngineeringErrorStatus(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (/PROJECT_NOT_FOUND|FILE_NOT_FOUND|REVISION_NOT_FOUND|INTEGRATION_NOT_FOUND/.test(msg)) return 404;
  if (/INVALID_|UNSUPPORTED_|PROJECT_EMPTY/.test(msg)) return 400;
  if (/DEPLOYMENT_BLOCKED/.test(msg)) return 409;
  if (/SECURITY_VIOLATION/.test(msg)) return 403;
  return 500;
}

// Software Engineering & App Builder API (backed by SoftwareProjectManager)
app.get('/api/engineering/capabilities', requireAuth('guest'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const mgr = SoftwareProjectManager.getInstance();
    const snapshot = await mgr.getSoftwareCapabilitiesSnapshot();
    const deliveryTargets = mgr.getPlatformDeliveryTargets();
    res.json({
      success: true,
      ...snapshot,
      deliveryTargets,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Unable to inspect engineering capabilities.' });
  }
});

app.get('/api/engineering/projects', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const mgr = SoftwareProjectManager.getInstance();
    const projects = mgr.listProjects(toEngineeringScope(req));
    res.json({ success: true, projects });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to list projects.' });
  }
});

app.post('/api/engineering/projects', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
    const rawStack = req.body?.stack;
    const stack: 'node_fullstack' | 'node_api' | 'python_service' | 'static_web' =
      rawStack === 'node_api' || rawStack === 'python_service' || rawStack === 'static_web'
        ? rawStack
        : 'node_fullstack';
    const runChecks = req.body?.runChecks !== false;
    const project = await mgr.createAndScaffoldProject({ name, prompt, stack, runChecks }, scope);
    const files = mgr.getProjectFilesList(project.projectId, scope);
    res.status(201).json({ success: true, project, files });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to create project.' });
  }
});

app.get('/api/engineering/projects/:projectId', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const project = mgr.getProject(req.params.projectId, scope);
    if (!project) {
      return res.status(404).json({ success: false, error: `Project '${req.params.projectId}' not found.` });
    }
    const files = mgr.getProjectFilesList(project.projectId, scope);
    res.json({ success: true, project, files });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to load project.' });
  }
});

app.get('/api/engineering/projects/:projectId/files', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const files = SoftwareProjectManager.getInstance().getProjectFilesList(req.params.projectId, toEngineeringScope(req));
    res.json({ success: true, files });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to list files.' });
  }
});

app.get('/api/engineering/projects/:projectId/file', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relPath.trim()) {
      return res.status(400).json({ success: false, error: 'Query parameter path is required.' });
    }
    const content = SoftwareProjectManager.getInstance().readProjectFile(req.params.projectId, relPath, toEngineeringScope(req));
    res.json({ success: true, path: relPath, content });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to read project file.' });
  }
});

app.post('/api/engineering/projects/:projectId/file', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const relPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!relPath) {
      return res.status(400).json({ success: false, error: 'File path is required.' });
    }
    const mgr = SoftwareProjectManager.getInstance();
    const result = mgr.writeProjectFile(req.params.projectId, relPath, content, message, scope);
    const files = mgr.getProjectFilesList(req.params.projectId, scope);
    res.json({ success: true, ...result, files });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to save project file.' });
  }
});

app.delete('/api/engineering/projects/:projectId/file', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relPath.trim()) {
      return res.status(400).json({ success: false, error: 'Query parameter path is required.' });
    }
    const mgr = SoftwareProjectManager.getInstance();
    const project = mgr.deleteProjectFile(req.params.projectId, relPath, scope);
    const files = mgr.getProjectFilesList(req.params.projectId, scope);
    res.json({ success: true, project, files });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to delete project file.' });
  }
});

app.post('/api/engineering/projects/:projectId/build', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const evidence = await mgr.runBuild(req.params.projectId, scope);
    const project = mgr.getProject(req.params.projectId, scope);
    res.json({ success: true, project, evidence });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Build execution failed.' });
  }
});

app.post('/api/engineering/projects/:projectId/test', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const evidence = await mgr.runTests(req.params.projectId, scope);
    const project = mgr.getProject(req.params.projectId, scope);
    res.json({ success: true, project, evidence });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Automated test execution failed.' });
  }
});

app.post('/api/engineering/projects/:projectId/security-scan', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const evidence = await mgr.runSecurityValidation(req.params.projectId, scope);
    const project = mgr.getProject(req.params.projectId, scope);
    res.json({ success: true, project, evidence });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Security validation failed.' });
  }
});

app.post('/api/engineering/projects/:projectId/repair', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const mgr = SoftwareProjectManager.getInstance();
    const result = await mgr.diagnoseAndRepairProject(req.params.projectId, scope);
    const files = mgr.getProjectFilesList(req.params.projectId, scope);
    res.json({ success: true, ...result, files });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Project repair failed.' });
  }
});

app.post('/api/engineering/projects/:projectId/iterate', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction : '';
    const runChecks = req.body?.runChecks !== false;
    const mgr = SoftwareProjectManager.getInstance();
    const result = await mgr.iterateProjectWithRequest(req.params.projectId, { instruction, runChecks }, scope);
    const files = mgr.getProjectFilesList(req.params.projectId, scope);
    res.json({ success: true, ...result, files });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Project iteration failed.' });
  }
});

app.post('/api/engineering/projects/:projectId/rollback', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const revisionId = typeof req.body?.revisionId === 'string' ? req.body.revisionId.trim() : '';
    if (!revisionId) {
      return res.status(400).json({ success: false, error: 'revisionId is required.' });
    }
    const mgr = SoftwareProjectManager.getInstance();
    const project = mgr.rollbackToRevision(req.params.projectId, revisionId, scope);
    const files = mgr.getProjectFilesList(req.params.projectId, scope);
    res.json({ success: true, project, files });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Rollback failed.' });
  }
});

app.post('/api/engineering/projects/:projectId/deploy', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const approvalRequestId = typeof req.body?.approvalRequestId === 'string' ? req.body.approvalRequestId : undefined;
    const targetUrl = typeof req.body?.targetUrl === 'string' ? req.body.targetUrl : undefined;
    const result = await SoftwareProjectManager.getInstance().requestOrExecuteDeploy(
      req.params.projectId,
      { approvalRequestId, targetUrl },
      scope
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Deploy failed.' });
  }
});

app.post('/api/engineering/projects/:projectId/verify-runtime', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = toEngineeringScope(req);
    const targetUrl = typeof req.body?.targetUrl === 'string' ? req.body.targetUrl : undefined;
    const result = await SoftwareProjectManager.getInstance().verifyDeployedRuntime(req.params.projectId, { targetUrl }, scope);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Runtime verification failed.' });
  }
});

app.get('/api/engineering/projects/:projectId/preview', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const preview = SoftwareProjectManager.getInstance().getPreviewPayload(req.params.projectId, toEngineeringScope(req));
    res.json({ success: true, ...preview });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to generate preview.' });
  }
});

app.get('/api/engineering/projects/:projectId/database', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const database = SoftwareProjectManager.getInstance().inspectProjectDatabase(req.params.projectId, toEngineeringScope(req));
    res.json({ success: true, database });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to inspect database schema.' });
  }
});

app.get('/api/engineering/projects/:projectId/deliverable', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const bundle = await SoftwareProjectManager.getInstance().packageProjectZip(req.params.projectId, toEngineeringScope(req));
    if (req.query.meta === '1') {
      return res.json({ success: true, ...bundle });
    }
    return res.download(bundle.zipPath, bundle.zipFilename);
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to package deliverable ZIP.' });
  }
});

app.get('/api/engineering/projects/:projectId/deployment/:deploymentId/logs', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = SoftwareProjectManager.getInstance().getDeploymentLogs(
      req.params.projectId,
      req.params.deploymentId,
      toEngineeringScope(req)
    );
    res.json({ success: true, ...data });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to fetch deployment logs.' });
  }
});

app.get('/api/engineering/deployments', requireAuth('developer'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const order = req.query.order === 'asc' ? 'asc' : 'desc';
    const deployments = SoftwareProjectManager.getInstance().listDeploymentHistory(toEngineeringScope(req), { projectId, order });
    res.json({ success: true, deployments });
  } catch (err: any) {
    res.status(mapEngineeringErrorStatus(err)).json({ success: false, error: err?.message || 'Unable to list deployment history.' });
  }
});

app.get('/api/engineering/benchmark', requireAuth('developer'), (_req: AuthenticatedRequest, res: Response) => {
  const report = SoftwareProjectManager.getInstance().getLatestBenchmarkReport();
  res.json({ success: true, report });
});

app.post('/api/engineering/benchmark', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const report = await SoftwareProjectManager.getInstance().runSoftwareBenchmarkSuite(toEngineeringScope(req));
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Engineering benchmark execution failed.' });
  }
});

// Mount Vite middleware in development or serve static in production + WebSocket /ws/runtime.
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const apiOnly = process.env.ZYNTHEOR_API_ONLY === '1';
  const hmrDisabled = process.env.DISABLE_HMR === 'true';
  const server = http.createServer(app);
  let vite: Awaited<ReturnType<typeof createViteServer>> | null = null;

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server Error] Port ${PORT} is already in use (${err.message}).`);
      process.exit(1);
    }
    console.error('[HTTP Server Error]', err);
  });

  if (!apiOnly && !isProd) {
    try {
      vite = await createViteServer({
        server: {
          middlewareMode: true,
          ...(hmrDisabled
            ? { hmr: false, ws: false }
            : { ws: { server, path: '/vite-hmr' } }),
        },
        appType: 'spa',
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

  const wss = new WebSocketServer({ noServer: true });
  wss.on('error', (err) => {
    console.error('[WebSocketServer Error]', err);
  });

  server.on('upgrade', (request, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === '/ws/runtime') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
      return;
    }
    if (hmrDisabled || apiOnly || isProd || pathname !== '/vite-hmr') {
      socket.destroy();
    }
  });

  const monitor = ConnectivityMonitor.getInstance();
  monitor.subscribe((state) => {
    const frame = JSON.stringify({ type: 'runtime_state', data: state, timestamp: new Date().toISOString() });
    wsLastFrameAt = new Date().toISOString();
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frame);
      }
    }
  });

  const unsubscribeWorkflow = AuditLedger.subscribeWorkflowEvents((event) => {
    const frame = JSON.stringify({ type: 'workflow_event', event, timestamp: event.timestamp });
    wsLastFrameAt = new Date().toISOString();
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frame);
      }
    }
  });

  wss.on('connection', async (ws) => {
    wsClientCount = wss.clients.size;
    try {
      const state = await monitor.checkNow();
      wsLastFrameAt = new Date().toISOString();
      ws.send(JSON.stringify({ type: 'runtime_state', data: state, timestamp: wsLastFrameAt }));
    } catch {
      // Ignore transient probe errors
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === 'ping') {
          wsLastFrameAt = new Date().toISOString();
          ws.send(JSON.stringify({ type: 'pong', timestamp: wsLastFrameAt }));
        } else if (msg?.type === 'check') {
          const state = await monitor.checkNow();
          wsLastFrameAt = new Date().toISOString();
          ws.send(JSON.stringify({ type: 'runtime_state', data: state, timestamp: wsLastFrameAt }));
        }
      } catch {
        // Ignore malformed client WS frames
      }
    });

    ws.on('close', () => {
      wsClientCount = wss.clients.size;
    });
  });

  if (process.env.ZYNTHEOR_DISABLE_BG_MONITOR !== '1') {
    monitor.startBackgroundMonitor(15000);
  }

  const shutdown = async (signal: string) => {
    console.log(`[ZYNTHEOR SOVEREIGN SERVER] Received ${signal}, shutting down cleanly...`);
    try {
      unsubscribeWorkflow();
      monitor.stopBackgroundMonitor();
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      if (vite) {
        await vite.close();
      }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    } catch {
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ZYNTHEOR SOVEREIGN SERVER] Running on http://0.0.0.0:${PORT} apiOnly=${apiOnly}`);
  });
}

startServer().catch((err) => {
  console.error('[Server Start Failure]', err);
  process.exit(1);
});
