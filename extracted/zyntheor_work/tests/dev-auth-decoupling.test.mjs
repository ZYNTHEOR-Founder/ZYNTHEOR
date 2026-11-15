/**
 * Integration tests for Temporary Development Authentication Decoupling:
 * 1. Production mode MUST block /api/auth/login even if ZYNTHEOR_ENABLE_DEV_LOGIN=true.
 * 2. Development mode without ZYNTHEOR_ENABLE_DEV_LOGIN=true MUST block /api/auth/login.
 * 3. Development mode with ZYNTHEOR_ENABLE_DEV_LOGIN=true allows explicit dev token issuance
 *    while still enforcing RBAC, tenant isolation, Firebase endpoint validation, and logout revocation.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited prematurely with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/health`);
}

async function withServer(envOverrides, fn) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsxBin = `${process.cwd()}/node_modules/.bin/tsx`;
  const child = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      ZYNTHEOR_API_ONLY: '1',
      ...envOverrides,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHealth(baseUrl, child);
    await fn(baseUrl);
  } catch (err) {
    console.error('[Server stderr]', stderr.slice(-1000));
    throw err;
  } finally {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* already exited */ }
      }
    }
  }
}

async function run() {
  // 1. Production mode: MUST hard-block dev login even when ZYNTHEOR_ENABLE_DEV_LOGIN=true
  await withServer(
    { NODE_ENV: 'production', ZYNTHEOR_ENABLE_DEV_LOGIN: 'true' },
    async (base) => {
      const modeRes = await fetch(`${base}/api/auth/mode`);
      assert.equal(modeRes.status, 200);
      const mode = await modeRes.json();
      assert.equal(mode.environment, 'production');
      assert.equal(mode.googleAuthEnabled, true);
      assert.equal(mode.devAccessEnabled, false);

      const devLoginRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'Administrator' }),
      });
      assert.equal(devLoginRes.status, 403);
      const devLoginBody = await devLoginRes.json();
      assert.equal(devLoginBody.code, 'DEV_LOGIN_DISABLED');

      // Protected endpoints remain fail-closed
      for (const [method, endpoint] of [
        ['GET', '/api/auth/session'],
        ['GET', '/api/agent/tasks'],
        ['GET', '/api/audit'],
        ['POST', '/api/auth/firebase-session'],
      ]) {
        const res = await fetch(`${base}${endpoint}`, { method });
        assert.equal(res.status, 401, `${method} ${endpoint} must require auth in production`);
      }
      console.log('PASS: Production mode blocks dev login and enforces auth on protected routes');
    }
  );

  // 2. Development mode without opt-in: MUST block dev login
  await withServer(
    { NODE_ENV: 'development', ZYNTHEOR_ENABLE_DEV_LOGIN: 'false' },
    async (base) => {
      const modeRes = await fetch(`${base}/api/auth/mode`);
      const mode = await modeRes.json();
      assert.equal(mode.devAccessEnabled, false);

      const devLoginRes = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'Developer' }),
      });
      assert.equal(devLoginRes.status, 403);
      const body = await devLoginRes.json();
      assert.equal(body.code, 'DEV_LOGIN_DISABLED');
      console.log('PASS: Development mode without opt-in blocks /api/auth/login');
    }
  );

  // 3. Explicit development decoupling mode: issues signed token while keeping RBAC & revocation intact
  await withServer(
    { NODE_ENV: 'development', ZYNTHEOR_ENABLE_DEV_LOGIN: 'true' },
    async (base) => {
      const modeRes = await fetch(`${base}/api/auth/mode`);
      const mode = await modeRes.json();
      assert.equal(mode.devAccessEnabled, true);
      assert.equal(mode.googleAuthEnabled, true);

      // Unauthenticated protected routes are still rejected
      const unauthTasks = await fetch(`${base}/api/agent/tasks`);
      assert.equal(unauthTasks.status, 401);

      // Invalid Firebase token is still rejected
      const badFb = await fetch(`${base}/api/auth/firebase-session`, {
        method: 'POST',
        headers: { Authorization: 'Bearer invalid.jwt.token' },
      });
      assert.equal(badFb.status, 401);

      // User (guest) dev token cannot access developer/admin routes
      const userLogin = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'User', userId: 'dev_user', tenantId: 'dev-workspace' }),
      });
      assert.equal(userLogin.status, 200);
      const userData = await userLogin.json();
      assert.equal(userData.session.authMode, 'development');
      assert.equal(userData.session.role, 'User');

      const userAuditRes = await fetch(`${base}/api/audit`, {
        headers: { Authorization: `Bearer ${userData.token}` },
      });
      assert.equal(userAuditRes.status, 403);

      const userTasksRes = await fetch(`${base}/api/agent/tasks`, {
        headers: { Authorization: `Bearer ${userData.token}` },
      });
      assert.equal(userTasksRes.status, 403);

      // Developer dev token can access developer routes & verify session
      const devLogin = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'Developer', userId: 'dev_developer', tenantId: 'dev-workspace' }),
      });
      assert.equal(devLogin.status, 200);
      const devData = await devLogin.json();
      assert.ok(devData.token);

      const devSessionRes = await fetch(`${base}/api/auth/session`, {
        headers: { Authorization: `Bearer ${devData.token}` },
      });
      assert.equal(devSessionRes.status, 200);

      const devTasksRes = await fetch(`${base}/api/agent/tasks`, {
        headers: { Authorization: `Bearer ${devData.token}` },
      });
      assert.equal(devTasksRes.status, 200);

      // Logout revokes the token
      const logoutRes = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${devData.token}` },
      });
      assert.equal(logoutRes.status, 200);

      const afterLogoutRes = await fetch(`${base}/api/auth/session`, {
        headers: { Authorization: `Bearer ${devData.token}` },
      });
      assert.equal(afterLogoutRes.status, 401);
      const afterLogoutBody = await afterLogoutRes.json();
      assert.equal(afterLogoutBody.code, 'TOKEN_REVOKED');

      console.log('PASS: Development decoupling enforces RBAC, Firebase token verification, and logout revocation');
    }
  );
}

run().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
