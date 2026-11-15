import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import {
  computeExponentialBackoffMs,
  NativeNeuralLMProvider,
} from '../lib/providers.ts';
import { ConnectivityMonitor } from '../lib/ConnectivityMonitor.ts';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed to allocate port')));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServerReady(baseUrl: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.status < 500) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms: ${String(lastErr)}`);
}

async function run(): Promise<void> {
  console.log('1) Testing bounded exponential backoff schedule...');
  assert.equal(computeExponentialBackoffMs(1, 1000, 30000, 0), 1000);
  assert.equal(computeExponentialBackoffMs(2, 1000, 30000, 0), 2000);
  assert.equal(computeExponentialBackoffMs(3, 1000, 30000, 0), 4000);
  assert.equal(computeExponentialBackoffMs(4, 1000, 30000, 0), 8000);
  assert.equal(computeExponentialBackoffMs(5, 1000, 30000, 0), 16000);
  assert.equal(computeExponentialBackoffMs(6, 1000, 30000, 0), 30000);
  assert.equal(computeExponentialBackoffMs(10, 1000, 30000, 500), 30000);

  console.log('2) Testing NativeNeuralLMProvider 7-state lifecycle & ConnectivityMonitor reconciliation...');
  const provider = NativeNeuralLMProvider.getInstance();
  assert.equal(provider.getLifecycleTelemetry().state, 'Connecting');
  const observedStates: string[] = [];
  const unsub = provider.onLifecycleChange((t) => observedStates.push(t.state));
  provider.reconcileLifecycleState('Degraded', 'no_cloud_config_test');
  provider.reconcileLifecycleState('Reconnecting', 'transient_test');
  provider.reconcileLifecycleState('Connecting', null);
  unsub();
  assert.ok(observedStates.includes('Degraded'));
  assert.ok(observedStates.includes('Reconnecting'));
  assert.ok(observedStates.includes('Connecting'));

  const monitor = ConnectivityMonitor.getInstance();
  const state = await monitor.checkNow();
  assert.equal(state.pythonBridgeReachable, true);
  assert.equal(state.online, false);
  assert.equal(state.bridgeLifecycle.state, 'Degraded');
  assert.notEqual(state.bridgeLifecycle.state, 'Connected');

  const ssrfBlocked = await monitor.reconnect('http://169.254.169.254/latest/meta-data/');
  assert.equal(ssrfBlocked.online, false);
  assert.equal(ssrfBlocked.runtimeState, 'FAILED');
  assert.match(ssrfBlocked.reason, /SSRF_BLOCKED/i);

  await provider.shutdown();

  console.log('3) Testing live HTTP + /ws/runtime WebSocket telemetry frame & ping/pong...');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsxBin = './node_modules/.bin/tsx';
  const child = spawn(tsxBin, ['server.ts', '--port', String(port)], {
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      ZYNTHEOR_API_ONLY: '1',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  child.stderr.on('data', (d) => {
    stderrBuf += d.toString();
  });

  try {
    await waitForServerReady(baseUrl, 15000);

    const healthRes = await fetch(`${baseUrl}/api/connectivity/health`);
    const healthJson: any = await healthRes.json();
    assert.ok(healthJson.bridgeLifecycle, 'GET /api/connectivity/health must include bridgeLifecycle');
    assert.equal(healthJson.bridgeLifecycle.state, 'Degraded');
    assert.equal(healthJson.online, false);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/runtime`);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('WebSocket /ws/runtime timed out waiting for runtime_state + pong'));
      }, 8000);

      let gotRuntimeState = false;
      let gotPong = false;

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' }));
      });

      ws.on('message', (raw) => {
        const frame = JSON.parse(String(raw));
        if (frame.type === 'runtime_state') {
          assert.ok(frame.data?.bridgeLifecycle, 'WS runtime_state must contain bridgeLifecycle');
          assert.equal(frame.data.bridgeLifecycle.state, 'Degraded');
          assert.equal(frame.data.online, false);
          gotRuntimeState = true;
        } else if (frame.type === 'pong') {
          assert.ok(frame.timestamp, 'WS pong must carry timestamp');
          gotPong = true;
        }
        if (gotRuntimeState && gotPong) {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    console.log('SUCCESS: All bridge lifecycle, exponential backoff, and /ws/runtime WebSocket tests passed.');
  } finally {
    monitor.stopBackgroundMonitor();
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Ignore if already exited
      }
      await new Promise((r) => setTimeout(r, 250));
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Ignore if already exited
      }
    }
    if (stderrBuf && process.env.DEBUG_BRIDGE_TEST === '1') {
      console.error(stderrBuf);
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
  });
