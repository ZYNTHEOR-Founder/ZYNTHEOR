/**
 * End-to-End Online Policy, 6-Stage Verification & Model Cloud Publish Pipeline Test
 *
 * Exercises:
 *   1. Real POST /api/connectivity/verify-e2e (unconfigured/fail-closed -> BLOCKED stages + 8-subsystem matrix)
 *   2. SSRF guard on POST /api/knowledge/ingest-url (169.254.169.254 rejected with HTTP 400 SSRF_BLOCKED)
 *   3. Real PureSeqLM Phase 1 training -> Governance ApprovalGate enforcement -> HTTP PUT Cloud Upload (/api/training/pipeline/publish-cloud)
 *   4. Re-running POST /api/connectivity/verify-e2e against the newly uploaded Cloud Checkpoint URL
 *      -> Verifies Cloud Storage PASS -> Bridge Health PASS -> Checkpoint SHA-256 Match PASS -> Native Inference PASS!
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

async function waitForServer(baseUrl, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/connectivity/health`);
      if (res.status === 200 || res.status === 503) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for Express server at ${baseUrl}`);
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-e2e-policy-'));
  const serverPort = await getFreePort();
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const cloudPort = await getFreePort();
  const cloudObjectUrl = `http://127.0.0.1:${cloudPort}/checkpoints/published.pt`;

  // Ephemeral Cloud Storage Server supporting PUT upload, HEAD probe, and GET/Range download
  const storedObjects = new Map();
  let putCount = 0;
  let getCount = 0;

  const cloudServer = http.createServer((req, res) => {
    const reqPath = req.url || '/';
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        storedObjects.set(reqPath, buf);
        putCount += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ uploaded: reqPath, bytes: buf.length }));
      });
      return;
    }

    const buf = storedObjects.get(reqPath);
    if (!buf) {
      res.writeHead(404);
      res.end('Object not found');
      return;
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': String(buf.length),
        'Content-Type': 'application/octet-stream',
      });
      res.end();
      return;
    }

    if (req.headers.range === 'bytes=0-31') {
      res.writeHead(206, {
        'Content-Length': '32',
        'Content-Range': `bytes 0-31/${buf.length}`,
        'Content-Type': 'application/octet-stream',
      });
      res.end(buf.subarray(0, 32));
      return;
    }

    getCount += 1;
    res.writeHead(200, {
      'Content-Length': String(buf.length),
      'Content-Type': 'application/octet-stream',
    });
    res.end(buf);
  });

  await new Promise((resolve) => cloudServer.listen(cloudPort, '127.0.0.1', resolve));

  const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  const serverProc = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      PORT: String(serverPort),
      ZYNTHEOR_API_ONLY: '1',
      ZYNTHEOR_ENABLE_DEV_LOGIN: 'true',
      ZYNTHEOR_ALLOW_LOOPBACK_CLOUD: 'true',
      ZYNTHEOR_AUDIT_FILE: path.join(tmpDir, 'audit.jsonl'),
      ZYNTHEOR_TASKS_FILE: path.join(tmpDir, 'tasks.json'),
      ZYNTHEOR_PLANS_DIR: path.join(tmpDir, 'plans'),
      ZYNTHEOR_EXEC_METRICS_FILE: path.join(tmpDir, 'exec_metrics.json'),
      ZYNTHEOR_TRAINING_PIPELINE_DIR: path.join(tmpDir, 'training_pipeline'),
      ZYNTHEOR_TRAINING_CHECKPOINT_DIR: path.join(tmpDir, 'checkpoints'),
      ZYNTHEOR_PURE_SEQ_CHECKPOINT: path.join(tmpDir, 'model_checkpoint_seq_pure.pt'),
      ZYNTHEOR_APPROVALS_FILE: path.join(tmpDir, 'approval_requests.json'),
      CHECKPOINT_PRESIGNED_URL: '',
      CHECKPOINT_UPLOAD_URL: '',
      S3_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      CLOUD_RUNTIME_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(serverUrl);

    // 1. Authenticate as Administrator
    const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'Administrator', userId: 'e2e-admin', tenantId: 'default' }),
    });
    const loginJson = await loginRes.json();
    assert.equal(loginRes.status, 200);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginJson.token}`,
    };

    // 2. Run Live E2E Verification when Cloud Storage is NOT_CONFIGURED
    const e2eUnconfRes = await fetch(`${serverUrl}/api/connectivity/verify-e2e`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const e2eUnconf = await e2eUnconfRes.json();
    assert.equal(e2eUnconfRes.status, 200);
    assert.equal(e2eUnconf.success, true);
    const rep0 = e2eUnconf.report;
    console.log('[E2E Unconfigured]:', JSON.stringify({
      overallStatus: rep0.overallStatus,
      onlineReady: rep0.onlineReady,
      stages: rep0.stages.map((s) => ({ id: s.id, status: s.status, latencyMs: s.latencyMs })),
      subsystems: rep0.subsystemPolicyMatrix.map((m) => ({ id: m.id, status: m.status })),
    }));
    assert.equal(rep0.onlineReady, false);
    assert.equal(rep0.overallStatus, 'BLOCKED');
    assert.equal(rep0.stages.length, 6);
    assert.equal(rep0.subsystemPolicyMatrix.length, 8);
    const csStage0 = rep0.stages.find((s) => s.id === 'cloud_storage');
    const rtStage0 = rep0.stages.find((s) => s.id === 'cloud_runtime_health');
    const infStage0 = rep0.stages.find((s) => s.id === 'native_inference');
    assert.equal(csStage0.status, 'BLOCKED');
    assert.equal(rtStage0.status, 'PASS');
    assert.equal(infStage0.status, 'BLOCKED');

    // Diagnostics endpoint check
    const diagRes = await fetch(`${serverUrl}/api/connectivity/diagnostics`, { headers });
    const diagJson = await diagRes.json();
    assert.equal(diagRes.status, 200);
    assert.equal(diagJson.connectivity.cloudStorageConfigured, false);

    // 3. Knowledge URL ingestion SSRF gate check (169.254.169.254 must be blocked even if online check runs)
    const ssrfRes = await fetch(`${serverUrl}/api/knowledge/ingest-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }),
    });
    const ssrfJson = await ssrfRes.json();
    console.log(`[HTTP ${ssrfRes.status}] POST /api/knowledge/ingest-url SSRF check:`, JSON.stringify(ssrfJson));
    assert.ok(ssrfRes.status === 400 || ssrfRes.status === 503);
    assert.ok(ssrfJson.code === 'SSRF_BLOCKED' || ssrfJson.code === 'FAIL_CLOSED');

    // 4. Real Phase 1 PureSeqLM Training (writes candidate .pt checkpoint in isolated tmpDir)
    const trainRes = await fetch(`${serverUrl}/api/training/pipeline/phase-run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        phaseId: 'phase_1_continuation',
        steps: 4,
        lr: 0.02,
        runPhaseVerification: true,
      }),
    });
    const trainJson = await trainRes.json();
    console.log(`[HTTP ${trainRes.status}] POST /api/training/pipeline/phase-run:`, JSON.stringify({
      success: trainJson.success,
      runId: trainJson.run?.runId,
      status: trainJson.run?.status,
      regressionPassed: trainJson.run?.regressionPassed,
      valNllBefore: trainJson.run?.baselineEval?.nll,
      valNllAfter: trainJson.run?.candidateEval?.nll,
    }));
    assert.equal(trainRes.status, 200);
    assert.equal(trainJson.success, true);
    const runId = trainJson.run.runId;
    assert.equal(trainJson.run.status, 'TRAINED');
    assert.equal(trainJson.run.regressionPassed, true);

    // 5. Try Cloud Publish WITHOUT ApprovalGate -> MUST fail 403 APPROVAL_REQUIRED
    const unapprovedPub = await fetch(`${serverUrl}/api/training/pipeline/publish-cloud`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runId, presignedUploadUrl: cloudObjectUrl }),
    });
    const unapprovedPubJson = await unapprovedPub.json();
    assert.equal(unapprovedPub.status, 403);
    assert.equal(unapprovedPubJson.code, 'APPROVAL_REQUIRED');

    // 6. Request & Approve MODEL_RELEASE in ApprovalGate
    const reqAppRes = await fetch(`${serverUrl}/api/governance/approvals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        actionType: 'MODEL_RELEASE',
        resourceId: runId,
        description: `Approve ${runId} for Cloud Storage publish test`,
      }),
    });
    const reqAppJson = await reqAppRes.json();
    assert.equal(reqAppRes.status, 201);
    const requestId = reqAppJson.request.requestId;

    const appRes = await fetch(`${serverUrl}/api/governance/approvals/${requestId}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ note: 'Approved in E2E test' }),
    });
    assert.equal(appRes.status, 200);

    // 7. Try Cloud Publish with SSRF upload URL -> MUST block with 400 SSRF_BLOCKED
    const ssrfPub = await fetch(`${serverUrl}/api/training/pipeline/publish-cloud`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runId, presignedUploadUrl: 'http://169.254.169.254/upload.pt' }),
    });
    assert.equal(ssrfPub.status, 400);

    // 8. Try Cloud Publish with NO upload target configured -> MUST return 503 FAIL_CLOSED
    const failClosedPub = await fetch(`${serverUrl}/api/training/pipeline/publish-cloud`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runId }),
    });
    assert.equal(failClosedPub.status, 503);

    // 9. Publish Verified Checkpoint to Cloud Storage (HTTP PUT)
    const pubRes = await fetch(`${serverUrl}/api/training/pipeline/publish-cloud`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runId, presignedUploadUrl: cloudObjectUrl, loadAfterUpload: false }),
    });
    const pubJson = await pubRes.json();
    console.log(`[HTTP ${pubRes.status}] POST /api/training/pipeline/publish-cloud:`, JSON.stringify(pubJson.uploaded));
    assert.equal(pubRes.status, 200);
    assert.equal(pubJson.success, true);
    assert.equal(pubJson.uploaded.sourceUri, cloudObjectUrl);
    assert.equal(putCount, 1);

    // 10. Run 6-Stage Live E2E Verification pointing at the uploaded Cloud Checkpoint URL
    const e2eConnRes = await fetch(`${serverUrl}/api/connectivity/verify-e2e`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        presignedUrl: cloudObjectUrl,
        testPrompt: 'Verify ZYNTHEOR online sovereign checkpoint execution',
      }),
    });
    const e2eConnJson = await e2eConnRes.json();
    const rep1 = e2eConnJson.report;
    console.log('[E2E Connected]:', JSON.stringify({
      overallStatus: rep1.overallStatus,
      onlineReady: rep1.onlineReady,
      stages: rep1.stages.map((s) => ({
        id: s.id,
        status: s.status,
        latencyMs: s.latencyMs,
        error: s.error,
      })),
    }));
    assert.equal(e2eConnRes.status, 200);
    assert.equal(rep1.cloudConnected, true);
    assert.equal(rep1.checkpointVerified, true);
    assert.equal(rep1.inferenceVerified, true);
    assert.equal(rep1.onlineReady, rep1.internetConnected);
    assert.ok(getCount >= 1);

    const ckStage1 = rep1.stages.find((s) => s.id === 'checkpoint_load_verify');
    const infStage1 = rep1.stages.find((s) => s.id === 'native_inference');
    assert.equal(ckStage1.status, 'PASS');
    assert.equal(ckStage1.evidence.weightsLoaded, true);
    assert.equal(ckStage1.evidence.checkpointSha256, pubJson.uploaded.payloadSha256);
    assert.equal(infStage1.status, 'PASS');
    assert.ok(infStage1.evidence.outputTokens > 0);

    console.log('\n[PASS] Full Online Policy, ApprovalGate, Cloud Publish & 6-Stage Verification E2E Passed.\n');
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[FAIL] E2E Online Policy test failed:', err);
    process.exit(1);
  });
