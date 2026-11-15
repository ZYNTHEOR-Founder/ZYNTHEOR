/**
 * End-to-End Online-Only Connectivity & Fail-Closed Execution Proof Test
 *
 * Tests BOTH required operational scenarios against real Python Bridge + Express Server + TaskOrchestrator:
 *   Scenario A (Network/Cloud Storage Blocked):
 *     - Native bridge `ping` reports `status: "fail_closed"`, `online_connectivity_required: true`, `weights_loaded: false`.
 *     - Native bridge `generate` rejects with `FAIL_CLOSED: Online Connectivity Required`.
 *     - Live Express `/api/connectivity/health`, `/api/native/inference`, `/api/chat`, `/api/agent/execute`
 *       ALL return HTTP 503 `code: "FAIL_CLOSED"`, `message: "Online Connectivity Required"` (zero 231K local fallback!).
 *     - TaskOrchestrator persists recoverable `lifecycleStatus: "Blocked"`, `resumable: true` state in `native_data/tasks_state.json`.
 *   Scenario B (Connectivity & Cloud Object Storage Restored):
 *     - Ephemeral HTTP Cloud Object Server streams verified PureSeqLM (51,296 params) bytes into RAM.
 *     - `POST /api/connectivity/reconnect` restores cloud weights (HTTP 200, `online: true`, `weightsLoaded: true`).
 *     - `POST /api/native/inference` & `POST /api/chat` succeed with cloud-served NativeLM.
 *     - Resuming preserved blocked task via `TaskOrchestrator.resumeTask()` transitions Blocked -> Delivered.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function callBridgeOnce(env, commands) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-u', '-m', 'qplus_native.bridge'], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const rl = readline.createInterface({ input: proc.stdout });
    const responses = [];
    let stderr = '';
    rl.on('line', (line) => {
      if (line.trim()) {
        responses.push(JSON.parse(line));
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, responses, stderr }));
    for (const cmd of commands) {
      proc.stdin.write(JSON.stringify(cmd) + '\n');
    }
    proc.stdin.end();
  });
}

async function waitForServer(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/connectivity/health`);
      if (res.status === 200 || res.status === 503) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for Express test server at ${baseUrl}`);
}

async function run() {
  const deadPort = await getFreePort();
  const deadUrl = `http://127.0.0.1:${deadPort}/checkpoints/seq_pure.pt`;

  console.log('\n================================================================');
  console.log('SCENARIO A: BLOCKED / UNREACHABLE CLOUD NETWORK (FAIL-CLOSED)');
  console.log('================================================================');

  // 1. Direct Python Bridge fail-closed verification
  const bridgeOffline = await callBridgeOnce(
    {
      CHECKPOINT_PRESIGNED_URL: deadUrl,
      S3_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
    },
    [
      { id: 1, cmd: 'ping', params: {} },
      { id: 2, cmd: 'connectivity_check', params: {} },
      { id: 3, cmd: 'generate', params: { prompt: 'Test offline rejection' } },
    ]
  );

  const pingOffline = bridgeOffline.responses.find((r) => r.id === 1);
  const checkOffline = bridgeOffline.responses.find((r) => r.id === 2);
  const genOffline = bridgeOffline.responses.find((r) => r.id === 3);

  console.log('[Bridge Offline ping]:', JSON.stringify(pingOffline));
  console.log('[Bridge Offline connectivity_check]:', JSON.stringify(checkOffline));
  console.log('[Bridge Offline generate]:', JSON.stringify(genOffline));

  assert.equal(pingOffline.status, 'fail_closed');
  assert.equal(pingOffline.online_connectivity_required, true);
  assert.equal(pingOffline.weights_loaded, false);
  assert.equal(checkOffline.online, false);
  assert.equal(checkOffline.online_connectivity_required, true);
  assert.match(genOffline.error, /FAIL_CLOSED.*Online Connectivity Required/);

  // 2. Live Express Server with dead cloud endpoint -> HTTP 503 FAIL_CLOSED on all routes
  const serverPort = await getFreePort();
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const ckptBytes = fs.readFileSync(path.resolve(process.cwd(), 'native_data/model_checkpoint_seq_pure.pt'));

  let cloudRequests = 0;
  const cloudServer = http.createServer((req, res) => {
    cloudRequests += 1;
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': String(ckptBytes.length),
        'Content-Type': 'application/octet-stream',
      });
      res.end();
      return;
    }
    if (req.headers.range === 'bytes=0-31') {
      res.writeHead(206, {
        'Content-Length': '32',
        'Content-Range': `bytes 0-31/${ckptBytes.length}`,
        'Content-Type': 'application/octet-stream',
      });
      res.end(ckptBytes.subarray(0, 32));
      return;
    }
    res.writeHead(200, {
      'Content-Length': String(ckptBytes.length),
      'Content-Type': 'application/octet-stream',
    });
    res.end(ckptBytes);
  });

  const liveCloudPort = await getFreePort();
  const liveCloudUrl = `http://127.0.0.1:${liveCloudPort}/checkpoints/seq_pure.pt`;

  const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  const serverProc = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      PORT: String(serverPort),
      ZYNTHEOR_API_ONLY: '1',
      CHECKPOINT_PRESIGNED_URL: deadUrl,
      S3_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLogs = '';
  serverProc.stdout.on('data', (c) => { serverLogs += c.toString('utf8'); });
  serverProc.stderr.on('data', (c) => { serverLogs += c.toString('utf8'); });

  try {
    await waitForServer(serverUrl);

    const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'Administrator', userId: 'test-admin', tenantId: 'default' }),
    });
    const loginJson = await loginRes.json();
    assert.equal(loginRes.status, 200, `Expected 200 login, got ${loginRes.status}: ${JSON.stringify(loginJson)}`);
    assert.ok(loginJson.token, 'Login must return cryptographic Bearer token');

    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginJson.token}`,
    };

    const healthOfflineRes = await fetch(`${serverUrl}/api/connectivity/health`);
    const healthOfflineJson = await healthOfflineRes.json();
    console.log(`[HTTP ${healthOfflineRes.status}] GET /api/connectivity/health:`, JSON.stringify(healthOfflineJson));
    assert.equal(healthOfflineRes.status, 503);
    assert.equal(healthOfflineJson.code, 'FAIL_CLOSED');
    assert.equal(healthOfflineJson.onlineConnectivityRequired, true);
    assert.equal(healthOfflineJson.online, false);

    const inferOfflineRes = await fetch(`${serverUrl}/api/native/inference`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ prompt: 'Test offline block' }),
    });
    const inferOfflineJson = await inferOfflineRes.json();
    console.log(`[HTTP ${inferOfflineRes.status}] POST /api/native/inference:`, JSON.stringify(inferOfflineJson));
    assert.equal(inferOfflineRes.status, 503);
    assert.equal(inferOfflineJson.code, 'FAIL_CLOSED');
    assert.equal(inferOfflineJson.message, 'Online Connectivity Required');

    const chatOfflineRes = await fetch(`${serverUrl}/api/chat`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ message: 'Hello', stream: false }),
    });
    const chatOfflineJson = await chatOfflineRes.json();
    console.log(`[HTTP ${chatOfflineRes.status}] POST /api/chat:`, JSON.stringify(chatOfflineJson));
    assert.equal(chatOfflineRes.status, 503);
    assert.equal(chatOfflineJson.code, 'FAIL_CLOSED');
    assert.equal(chatOfflineJson.message, 'Online Connectivity Required');

    const agentOfflineRes = await fetch(`${serverUrl}/api/agent/execute`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ goal: 'Build utility while offline', priority: 'High' }),
    });
    const agentOfflineJson = await agentOfflineRes.json();
    console.log(`[HTTP ${agentOfflineRes.status}] POST /api/agent/execute:`, JSON.stringify(agentOfflineJson));
    assert.equal(agentOfflineRes.status, 503);
    assert.equal(agentOfflineJson.code, 'FAIL_CLOSED');

    // Enqueue task while offline -> Verify recoverable task state stays preserved
    const enqueueRes = await fetch(`${serverUrl}/api/agent/queue`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ goal: 'Build an expense ledger CLI module with tests', priority: 'High' }),
    });
    const enqueueJson = await enqueueRes.json();
    assert.equal(enqueueRes.status, 201);
    const queuedTaskId = enqueueJson.task.taskId;
    assert.equal(enqueueJson.task.resumable, true);
    assert.equal(enqueueJson.task.lifecycleStatus, 'Planned');

    // Attempt direct resume while STILL offline -> must fail closed & persist Blocked + resumable state
    const resumeOfflineRes = await fetch(`${serverUrl}/api/agent/tasks/${queuedTaskId}/resume`, {
      method: 'POST',
      headers: authHeaders,
    });
    const resumeOfflineText = await resumeOfflineRes.text();
    console.log('[POST /api/agent/tasks/:id/resume while offline]:', resumeOfflineText.trim());
    assert.match(resumeOfflineText, /FAIL_CLOSED/);
    assert.match(resumeOfflineText, /"resumable":true/);
    assert.match(resumeOfflineText, /"lifecycleStatus":"Blocked"/);

    console.log('\n================================================================');
    console.log('SCENARIO B: CLOUD STORAGE RESTORED -> RECONNECT & EXECUTE');
    console.log('================================================================');

    await new Promise((resolve) => cloudServer.listen(liveCloudPort, '127.0.0.1', resolve));

    const reconnectRes = await fetch(`${serverUrl}/api/connectivity/reconnect`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ presignedUrl: liveCloudUrl }),
    });
    const reconnectJson = await reconnectRes.json();
    console.log(`[HTTP ${reconnectRes.status}] POST /api/connectivity/reconnect:`, JSON.stringify(reconnectJson));
    assert.equal(reconnectRes.status, 200);
    assert.equal(reconnectJson.online, true);
    assert.equal(reconnectJson.onlineConnectivityRequired, false);
    assert.equal(reconnectJson.weightsLoaded, true);
    assert.equal(reconnectJson.cloudSourceUri, liveCloudUrl);
    assert.ok(cloudRequests >= 1, 'Cloud Object Server must receive real HTTP requests');

    const inferOnlineRes = await fetch(`${serverUrl}/api/native/inference`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ prompt: 'ระบบ ZYNTHEOR คือ', maxNewTokens: 16, seed: 42 }),
    });
    const inferOnlineJson = await inferOnlineRes.json();
    console.log(`[HTTP ${inferOnlineRes.status}] POST /api/native/inference:`, JSON.stringify({
      success: inferOnlineJson.success,
      weightsSource: inferOnlineJson.weightsSource,
      totalParams: inferOnlineJson.totalParams,
      outputTokens: inferOnlineJson.outputTokens,
      responsePreview: String(inferOnlineJson.response || '').slice(0, 60),
    }));
    assert.equal(inferOnlineRes.status, 200);
    assert.equal(inferOnlineJson.success, true);
    assert.equal(inferOnlineJson.weightsSource, liveCloudUrl);
    assert.equal(inferOnlineJson.totalParams, 51296);

    const chatOnlineRes = await fetch(`${serverUrl}/api/chat`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ message: 'Explain ZYNTHEOR online-only architecture', maxNewTokens: 16, seed: 42 }),
    });
    const chatOnlineText = await chatOnlineRes.text();
    const chatEvents = chatOnlineText.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const chatDone = chatEvents.find((e) => e.type === 'done');
    const chatChunkCount = chatEvents.filter((e) => e.type === 'chunk').length;
    console.log(`[HTTP ${chatOnlineRes.status}] POST /api/chat (NDJSON):`, JSON.stringify({
      type: chatDone?.type,
      chunkCount: chatChunkCount,
      weightsSource: chatDone?.weightsSource,
      totalParams: chatDone?.totalParams,
      correlationId: chatDone?.correlationId,
    }));
    assert.equal(chatOnlineRes.status, 200);
    assert.ok(chatDone, 'Stream must emit done event');
    assert.ok(chatChunkCount >= 1, 'Stream must emit at least one token chunk');
    assert.equal(chatDone.weightsSource, liveCloudUrl);
    assert.equal(chatDone.totalParams, 51296);

    // Resume the previously Blocked task -> must recover & complete cleanly!
    const resumeOnlineRes = await fetch(`${serverUrl}/api/agent/tasks/${queuedTaskId}/resume`, {
      method: 'POST',
      headers: authHeaders,
    });
    const resumeOnlineText = await resumeOnlineRes.text();
    const lines = resumeOnlineText.trim().split('\n').map((l) => JSON.parse(l));
    const finalEvent = lines.find((e) => e.type === 'final_result');
    console.log('[POST /api/agent/tasks/:id/resume after reconnect]:', JSON.stringify({
      success: finalEvent?.data?.success,
      deliveryStatus: finalEvent?.data?.executionCycle?.deliveryStatus,
      lifecycleStatus: finalEvent?.data?.executionCycle?.lifecycleStatus,
      zipSha256: finalEvent?.data?.executionCycle?.packageArtifact?.zipSha256 || null,
    }));
    assert.equal(finalEvent?.data?.executionCycle?.lifecycleStatus, 'Delivered');
    assert.equal(finalEvent?.data?.executionCycle?.deliveryStatus, 'DELIVERED');

    console.log('\n[PASS] Online-Only Enforcement & Cloud Reconnection E2E Verified.\n');
  } finally {
    if (serverProc.pid) {
      try {
        process.kill(-serverProc.pid, 'SIGTERM');
      } catch {
        // already exited
      }
      await new Promise((r) => setTimeout(r, 250));
      try {
        process.kill(-serverProc.pid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
    await new Promise((resolve) => {
      if (cloudServer.listening) {
        if (typeof cloudServer.closeAllConnections === 'function') {
          cloudServer.closeAllConnections();
        }
        cloudServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[FAIL] Online-Only Connectivity E2E Test failed:', err);
    process.exit(1);
  });
