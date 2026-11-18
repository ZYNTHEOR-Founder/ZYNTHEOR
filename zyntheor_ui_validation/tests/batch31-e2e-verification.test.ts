/**
 * BATCH 31 — End-to-End Native App Creation, Bug Recovery, ApprovalGate,
 * Live Deployed Runtime Probe & Deployment Timeline Verification Suite.
 *
 * Verifies against real child Express server, real generated Node HTTP app,
 * real HTTP deployment webhook, and strict unconfigured truth checks:
 *   1. /api/health separates HTTP service liveness from Native Intelligence & Cloud Runtime.
 *   2. Unauthenticated access to /api/engineering/projects is denied (401) & dev-login is blocked when disabled (403).
 *   3. NL specification -> architecture -> scaffold -> build -> unit test -> security scan.
 *   4. Intentional bug injection -> automated test catches FAILED -> fix -> rebuild & re-test VERIFIED.
 *   5. RBAC ApprovalGate: developer cannot self-approve (403); admin approves (200).
 *   6. Real HTTP POST deployment webhook + spawning generated app + live HTTP runtime probe (/api/health, POST/GET /api/items).
 *   7. All 13 workflow stages produce explicit stageExecutions records + SHA-256 evidence hashes.
 *   8. deploymentHistory contains timestamped records with linkedLogIds referencing runtimeLogs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

function getFreePort(): Promise<number> {
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

async function waitForHttpOk(url: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function killProcessTree(proc: ChildProcess | null) {
  if (!proc || !proc.pid) return;
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      // already dead
    }
  }
  await new Promise((r) => setTimeout(r, 250));
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // already dead
    }
  }
}

async function run(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-batch31-'));
  const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  let mainServer: ChildProcess | null = null;
  let disabledAuthServer: ChildProcess | null = null;
  let deployedAppProc: ChildProcess | null = null;
  let webhookServer: http.Server | null = null;
  let createdProjectDir: string | null = null;
  let createdZipPath: string | null = null;

  try {
    // ------------------------------------------------------------------
    // 1. Verify ZYNTHEOR_ENABLE_DEV_LOGIN=false hard-blocks /api/auth/login
    // ------------------------------------------------------------------
    const disabledAuthPort = await getFreePort();
    const disabledAuthUrl = `http://127.0.0.1:${disabledAuthPort}`;
    disabledAuthServer = spawn(tsxBin, ['server.ts'], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        PORT: String(disabledAuthPort),
        ZYNTHEOR_API_ONLY: '1',
        ZYNTHEOR_ENABLE_DEV_LOGIN: 'false',
        ZYNTHEOR_AUDIT_FILE: path.join(tmpDir, 'disabled_audit.jsonl'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForHttpOk(`${disabledAuthUrl}/api/health`);

    const blockedLoginRes = await fetch(`${disabledAuthUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'Developer', userId: 'dev-1', tenantId: 'default' }),
    });
    assert.equal(blockedLoginRes.status, 403, 'Dev login must return 403 when disabled');
    console.log(`[PASS] Dev login disabled check: HTTP ${blockedLoginRes.status}`);
    await killProcessTree(disabledAuthServer);
    disabledAuthServer = null;

    // ------------------------------------------------------------------
    // 2. Boot primary isolated ZYNTHEOR API server (no cloud weights configured)
    // ------------------------------------------------------------------
    const serverPort = await getFreePort();
    const serverUrl = `http://127.0.0.1:${serverPort}`;
    mainServer = spawn(tsxBin, ['server.ts'], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        PORT: String(serverPort),
        ZYNTHEOR_API_ONLY: '1',
        ZYNTHEOR_ENABLE_DEV_LOGIN: 'true',
        ZYNTHEOR_ALLOW_LOOPBACK_CLOUD: 'true',
        ZYNTHEOR_AUDIT_FILE: path.join(tmpDir, 'audit.jsonl'),
        ZYNTHEOR_PROJECTS_FILE: path.join(tmpDir, 'projects.json'),
        ZYNTHEOR_APPROVALS_FILE: path.join(tmpDir, 'approvals.json'),
        ZYNTHEOR_PLANS_DIR: path.join(tmpDir, 'plans'),
        ZYNTHEOR_EXEC_METRICS_FILE: path.join(tmpDir, 'exec_metrics.json'),
        ZYNTHEOR_CONTEXT_FILE: path.join(tmpDir, 'context.json'),
        ZYNTHEOR_KG_FILE: path.join(tmpDir, 'kg.json'),
        ZYNTHEOR_REASONING_LOG: path.join(tmpDir, 'reasoning.json'),
        ZYNTHEOR_MEMORY_FILE: path.join(tmpDir, 'memory.json'),
        CHECKPOINT_PRESIGNED_URL: '',
        CLOUD_RUNTIME_URL: '',
        CLOUD_DEPLOY_WEBHOOK_URL: '',
        S3_BUCKET: '',
        S3_ACCESS_KEY_ID: '',
        S3_SECRET_ACCESS_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForHttpOk(`${serverUrl}/api/health`);

    // Warning 1 Check: /api/health separates liveness from Native Intelligence readiness
    const healthRes = await fetch(`${serverUrl}/api/health`);
    const healthJson = await healthRes.json();
    console.log('[GET /api/health]:', JSON.stringify(healthJson));
    assert.equal(healthRes.status, 200);
    assert.equal(healthJson.status, 'healthy');
    assert.equal(healthJson.serviceLiveness, 'VERIFIED');
    assert.equal(healthJson.nativeIntelligenceReady, false);
    assert.equal(healthJson.cloudRuntimeStatus, 'NOT_CONFIGURED');
    assert.equal(healthJson.cloudConfigured, false);
    assert.equal(healthJson.cloudConnected, false);
    assert.ok(typeof healthJson.readinessNote === 'string' && healthJson.readinessNote.length > 20);

    // Unauthenticated engineering projects route must reject (401)
    const unauthProjRes = await fetch(`${serverUrl}/api/engineering/projects`);
    assert.equal(unauthProjRes.status, 401, 'Unauthenticated /api/engineering/projects must return 401');
    console.log(`[PASS] Unauthenticated /api/engineering/projects rejected with HTTP ${unauthProjRes.status}`);

    // Authenticate Developer + Administrator
    const devLoginRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'Developer', userId: 'b31-dev', tenantId: 'tenant-b31' }),
    });
    const devToken = (await devLoginRes.json()).token;
    assert.ok(devToken);

    const adminLoginRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'Administrator', userId: 'b31-admin', tenantId: 'tenant-b31' }),
    });
    const adminToken = (await adminLoginRes.json()).token;
    assert.ok(adminToken);

    const devHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${devToken}` };
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };

    // ------------------------------------------------------------------
    // 3. Natural Language Specification -> Scaffold -> Build -> Test -> Security Scan
    // ------------------------------------------------------------------
    const createRes = await fetch(`${serverUrl}/api/engineering/projects`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({
        name: 'Batch31 Incident Tracker',
        prompt: 'Build an online incident tracker service with REST API for listing and creating validated records',
        stack: 'node_fullstack',
        runChecks: true,
      }),
    });
    const createJson = await createRes.json();
    assert.equal(createRes.status, 200, `Create project failed: ${JSON.stringify(createJson)}`);
    let project = createJson.project;
    createdProjectDir = path.resolve(process.cwd(), 'workspace', project.workspaceDir);
    assert.equal(project.lastBuild?.status, 'VERIFIED');
    assert.equal(project.lastTests?.status, 'VERIFIED');
    assert.equal(project.lastTests?.passed, 1);
    assert.equal(project.lastSecurityScan?.status, 'VERIFIED');
    assert.equal(project.attribution, 'deterministic_engineering_engine');
    console.log(`[PASS] Scaffolded ${project.projectId} (${project.currentRevision}): build=${project.lastBuild.status}, tests=${project.lastTests.passed}/${project.lastTests.total}`);

    // ------------------------------------------------------------------
    // 4. Bug Injection -> Test Must Catch Failure -> Fix -> Rebuild & Re-Test
    // ------------------------------------------------------------------
    const readAppRes = await fetch(
      `${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/file?path=src/app.mjs`,
      { headers: devHeaders }
    );
    const originalAppSource = (await readAppRes.json()).content as string;
    const buggySource = originalAppSource.replace(
      `return { status: 400, body: { error: err.message } };`,
      `return { status: 500, body: { error: 'INJECTED_BUG: ' + err.message } };`
    );
    assert.notEqual(buggySource, originalAppSource, 'Bug injection must alter validation status');

    const injectRes = await fetch(
      `${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/file`,
      {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({
          path: 'src/app.mjs',
          content: buggySource,
          message: 'Inject validation regression for Batch 31 failure detection test',
        }),
      }
    );
    assert.equal(injectRes.status, 200);
    const afterInjectJson = await injectRes.json();
    assert.equal(afterInjectJson.project.stages.find((s: any) => s.stage === 'AUTOMATED_TESTING').status, 'UNVERIFIED');

    const failTestRes = await fetch(
      `${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/test`,
      { method: 'POST', headers: devHeaders }
    );
    const failTestJson = await failTestRes.json();
    assert.equal(failTestRes.status, 200);
    assert.equal(failTestJson.evidence.verificationStatus, 'FAILED');
    assert.equal(failTestJson.project.lastTests.status, 'FAILED');
    assert.equal(failTestJson.project.lastTests.passed, 0);
    console.log(`[PASS] Injected bug caught by Automated Testing: exec=${failTestJson.evidence.executionId}, status=${failTestJson.evidence.verificationStatus}, passed=${failTestJson.project.lastTests.passed}/${failTestJson.project.lastTests.total}`);

    // Restore fix & run full verification
    const fixRes = await fetch(
      `${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/file`,
      {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({
          path: 'src/app.mjs',
          content: originalAppSource,
          message: 'Restore HTTP 400 validation status code',
        }),
      }
    );
    assert.equal(fixRes.status, 200);

    const buildRes = await fetch(`${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/build`, { method: 'POST', headers: devHeaders });
    const buildJson = await buildRes.json();
    assert.equal(buildJson.evidence.verificationStatus, 'VERIFIED');

    const testFixRes = await fetch(`${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/test`, { method: 'POST', headers: devHeaders });
    const testFixJson = await testFixRes.json();
    assert.equal(testFixJson.evidence.verificationStatus, 'VERIFIED');
    assert.equal(testFixJson.project.lastTests.passed, 1);

    const secRes = await fetch(`${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/security-validate`, { method: 'POST', headers: devHeaders });
    const secJson = await secRes.json();
    assert.equal(secJson.evidence.verificationStatus, 'VERIFIED');
    project = secJson.project;
    console.log(`[PASS] Bug fixed & verified at ${project.currentRevision}: build=VERIFIED, test=1/1, security=VERIFIED, sha256=${testFixJson.evidence.evidenceHash}`);

    // ------------------------------------------------------------------
    // 5. RBAC ApprovalGate Enforcement
    // ------------------------------------------------------------------
    const reqDeployRes = await fetch(
      `${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/deploy`,
      { method: 'POST', headers: devHeaders, body: JSON.stringify({}) }
    );
    const reqDeployJson = await reqDeployRes.json();
    assert.equal(reqDeployRes.status, 200);
    assert.equal(reqDeployJson.project.deployment.status, 'PENDING_APPROVAL');
    const approvalId = reqDeployJson.approvalRequestId;
    assert.ok(approvalId);
    assert.ok(reqDeployJson.deploymentRecord?.deploymentId);
    assert.ok((reqDeployJson.deploymentRecord?.linkedLogIds || []).length >= 1);

    // Developer cannot approve own request -> 403
    const selfApproveRes = await fetch(`${serverUrl}/api/governance/approvals/${encodeURIComponent(approvalId)}/approve`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ notes: 'Illegal self-approval attempt' }),
    });
    assert.equal(selfApproveRes.status, 403, 'Developer must be denied ApprovalGate sign-off');

    // Administrator approves -> 200
    const adminApproveRes = await fetch(`${serverUrl}/api/governance/approvals/${encodeURIComponent(approvalId)}/approve`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ notes: 'Approved for Batch 31 Cloud Deployment verification' }),
    });
    assert.equal(adminApproveRes.status, 200);
    console.log(`[PASS] ApprovalGate RBAC enforced: dev denied (403), admin approved (${approvalId})`);

    // ------------------------------------------------------------------
    // 6. Boot generated application & Deploy Receiver -> Execute Real HTTP Deploy + Live Probe
    // ------------------------------------------------------------------
    const deployedAppPort = await getFreePort();
    const deployedAppUrl = `http://127.0.0.1:${deployedAppPort}`;
    deployedAppProc = spawn('node', ['src/server.mjs'], {
      cwd: createdProjectDir,
      detached: true,
      env: { ...process.env, PORT: String(deployedAppPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForHttpOk(`${deployedAppUrl}/api/health`);

    const receivedDeployPayloads: any[] = [];
    const webhookPort = await getFreePort();
    const webhookUrl = `http://127.0.0.1:${webhookPort}/deploy`;
    webhookServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/deploy') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          receivedDeployPayloads.push(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true, runtimeUrl: `${deployedAppUrl}/api/health` }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => webhookServer!.listen(webhookPort, '127.0.0.1', resolve));

    const execDeployRes = await fetch(
      `${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/deploy`,
      {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({ approvalRequestId: approvalId, targetUrl: webhookUrl }),
      }
    );
    const execDeployJson = await execDeployRes.json();
    assert.equal(execDeployRes.status, 200);
    assert.equal(execDeployJson.evidence.verificationStatus, 'VERIFIED');
    assert.equal(execDeployJson.project.deployment.status, 'DEPLOYED');
    assert.equal(execDeployJson.project.deployment.runtimeHttpStatus, 200);
    assert.equal(receivedDeployPayloads.length, 1);
    assert.equal(receivedDeployPayloads[0].projectId, project.projectId);
    assert.equal(receivedDeployPayloads[0].artifactSha256, execDeployJson.project.deployment.artifactSha256);
    if (execDeployJson.project.deployment.artifactZip) {
      createdZipPath = path.resolve(process.cwd(), 'native_data', 'deliverables', execDeployJson.project.deployment.artifactZip);
    }

    // Also run standalone /verify-runtime probe
    const verifyRtRes = await fetch(
      `${serverUrl}/api/engineering/projects/${encodeURIComponent(project.projectId)}/verify-runtime`,
      { method: 'POST', headers: devHeaders, body: JSON.stringify({}) }
    );
    const verifyRtJson = await verifyRtRes.json();
    assert.equal(verifyRtRes.status, 200);
    assert.equal(verifyRtJson.evidence.verificationStatus, 'VERIFIED');
    project = verifyRtJson.project;

    // Directly test real API behavior on the live deployed application!
    const liveHealth = await (await fetch(`${deployedAppUrl}/api/health`)).json();
    assert.equal(liveHealth.status, 'ok');
    const createItemRes = await fetch(`${deployedAppUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Batch 31 Live Incident', category: 'reliability' }),
    });
    assert.equal(createItemRes.status, 201);
    const listItems = await (await fetch(`${deployedAppUrl}/api/items`)).json();
    assert.ok(listItems.items.some((it: any) => it.title === 'Batch 31 Live Incident'));
    console.log(`[PASS] Deployed app live endpoints verified: GET /api/health -> ok, POST/GET /api/items -> ${listItems.items.length} item(s)`);

    // ------------------------------------------------------------------
    // 7. Warning 2 & Timeline Verification: All 13 Stage Executions + Deployment History Links
    // ------------------------------------------------------------------
    const recordedStageNames = new Set((project.stageExecutions || []).map((se: any) => se.stage));
    assert.equal(recordedStageNames.size, 13, `Expected all 13 stages recorded, got ${recordedStageNames.size}`);
    for (const se of project.stageExecutions) {
      assert.ok(se.executionId);
      assert.ok(se.revisionId);
      assert.ok(se.timestamp);
      assert.ok(typeof se.evidenceHash === 'string' && se.evidenceHash.length === 64);
    }

    assert.ok(Array.isArray(project.deploymentHistory) && project.deploymentHistory.length >= 3);
    const logIdsSet = new Set((project.runtimeLogs || []).map((l: any) => l.logId));
    for (const dep of project.deploymentHistory) {
      assert.ok(dep.deploymentId);
      assert.ok(dep.executionId);
      assert.ok(dep.timestamp);
      assert.ok(Array.isArray(dep.linkedLogIds) && dep.linkedLogIds.length >= 1);
      for (const lid of dep.linkedLogIds) {
        assert.ok(logIdsSet.has(lid), `Linked log ${lid} must resolve inside runtimeLogs`);
      }
    }

    const latestDeploy = project.deploymentHistory[0];
    console.log(`[EVIDENCE_SUMMARY] Project=${project.projectId} Revision=${project.currentRevision} ExecutionID=${latestDeploy.executionId} Timestamp=${latestDeploy.timestamp} EvidenceHash=${latestDeploy.evidenceHash}`);
    console.log(`[EVIDENCE_SUMMARY] StagesRecorded=${recordedStageNames.size}/13 DeploymentTimelineEntries=${project.deploymentHistory.length} LinkedLogsOnLatest=${latestDeploy.linkedLogIds.length}`);
    console.log('\n[PASS] BATCH 31 FULL E2E VERIFICATION SUCCEEDED.\n');
  } finally {
    await killProcessTree(deployedAppProc);
    await killProcessTree(mainServer);
    await killProcessTree(disabledAuthServer);
    if (webhookServer) {
      await new Promise<void>((resolve) => {
        if (webhookServer!.listening) {
          if (typeof (webhookServer as any).closeAllConnections === 'function') {
            (webhookServer as any).closeAllConnections();
          }
          webhookServer!.close(() => resolve());
        } else {
          resolve();
        }
      });
    }
    if (createdProjectDir && fs.existsSync(createdProjectDir)) {
      fs.rmSync(createdProjectDir, { recursive: true, force: true });
    }
    if (createdZipPath && fs.existsSync(createdZipPath)) {
      fs.rmSync(createdZipPath, { force: true });
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[FAIL] BATCH 31 E2E VERIFICATION FAILED:', err);
    process.exit(1);
  });
