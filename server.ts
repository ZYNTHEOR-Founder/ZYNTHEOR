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
import { NativeNeuralLMProvider, ExternalBrainProvider } from './lib/providers';
import { ConnectivityMonitor } from './lib/ConnectivityMonitor';
import { TaskOrchestrator, normalizeTaskPriority } from './lib/TaskOrchestrator';
import { ActionDrivenEngine } from './lib/ActionDrivenEngine';
import { AutonomousPlanner } from './lib/AutonomousPlanner';
import { ApprovalGate } from './lib/ApprovalGate';
import { CognitiveContextEngine } from './lib/CognitiveContextEngine';
import { AdaptiveReasoningEngine } from './lib/AdaptiveReasoningEngine';
import { KnowledgeGraphEngine } from './lib/KnowledgeGraphEngine';
import { PerformanceEngine } from './lib/PerformanceEngine';
import { ContinuousLearningPipeline } from './lib/ContinuousLearningPipeline';
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
import { BenchmarkRunner } from './server/benchmarks/runner';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT) || 3000;
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

// 1. System Status API
app.get('/api/system/status', async (_req: Request, res: Response) => {
  try {
    sampleResources();
    const monitor = ConnectivityMonitor.getInstance();
    const connectivity = await monitor.checkNow();
    const provider = NativeNeuralLMProvider.getInstance();
    const pingRes = monitor.getLastPingResult() || (await provider.ping());
    const integrity = AuditLedger.verifyIntegrity();
    const commercial = CommercialManager.getInstance().getMetrics();
    const files = ToolGateway.listFiles();
    const lastEvidence = provider.getLastInferenceEvidence();

    res.json({
      success: true,
      connectivity,
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
        activeParams: pingRes.active_params,
        targetParams: pingRes.target_params ?? null,
        inferenceReady: connectivity.online && connectivity.executionVerified,
        runtimeState: connectivity.runtimeState,
        readinessReason: connectivity.reason,
        externalBrain: ExternalBrainProvider.getStatus(),
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
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 8000) {
    return res.status(400).json({ success: false, code: 'INVALID_TASK_GOAL', error: 'Goal must contain 1–8000 characters.' });
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
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 8000) {
      return res.status(400).json({ success: false, code: 'INVALID_TASK_GOAL', error: 'Goal must contain 1–8000 characters.' });
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
app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, error: 'IDENTITY_PROVIDER_REQUIRED' });
    }
    if (process.env.ZYNTHEOR_ENABLE_DEV_LOGIN !== 'true') {
      return res.status(403).json({ success: false, error: 'DEVELOPMENT_LOGIN_DISABLED' });
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

app.get('/api/knowledge/graph', requireAuth('guest'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const engine = KnowledgeIntelligenceEngine.getInstance();
    const edges = engine.buildGraphEdges();
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

// ==========================================
// 13. BATCH 28 / 29 / 30 COGNITIVE, ACTION, GOVERNANCE, TRAINING & DASHBOARD ROUTES
// ==========================================
app.get('/api/observability/operations', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conn = await ConnectivityMonitor.getInstance().checkNow();
    res.json({
      success: true,
      connectivity: conn,
      externalBrain: ExternalBrainProvider.getStatus(),
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
    externalBrain: ExternalBrainProvider.getStatus(),
    latest,
  });
});

app.post('/api/benchmarks/stages/run', requireAuth('developer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const mode = req.body?.mode === 'external' ? 'external' : 'specification';
    const args = ['-m', 'qplus_native.stage_bench', '--json'];
    if (mode === 'external') {
      args.push('--real');
    }

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
            mode: mode === 'external' ? 'REAL_EXTERNAL_BRAIN_SANDBOX' : 'FAIL_CLOSED_SPECIFICATION',
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
    let webResearch: any = { ok: false, note: 'Online topic lookup not requested' };
    if (req.body?.includeWeb === true) {
      webResearch = await InternetIntegrationEngine.getInstance().researchWebTopic(query, {
        tenantId: scope.tenantId,
        userId: scope.userId,
      });
    }
    const reasoning = await AdaptiveReasoningEngine.getInstance().executeReasoning({ prompt: query, scope });
    res.json({
      success: true,
      query,
      knowledgeHits,
      graphPaths,
      webResearch,
      reasoning,
      externalBrain: ExternalBrainProvider.getStatus(),
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
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

// Mount Vite middleware in development or serve static in production + WebSocket /ws/runtime.
async function startServer() {
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

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/runtime' });

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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ZYNTHEOR SOVEREIGN SERVER] Running on http://0.0.0.0:${PORT} apiOnly=${apiOnly}`);
  });
}

startServer().catch((err) => {
  console.error('[Server Start Failure]', err);
  process.exit(1);
});
