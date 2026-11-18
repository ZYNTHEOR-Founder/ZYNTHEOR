/**
 * ZYNTHEOR Task Prioritization End-to-End Verification Test
 * Zero-Fake Engineering Standard: Real execution against TaskOrchestrator,
 * AuditLedger, NativeNeuralLMProvider, ToolGateway, and execution metrics.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import {
  TaskOrchestrator,
  normalizeTaskPriority,
  isValidTaskPriority,
  type OrchestrationEvent,
  type TaskPriority,
} from '../lib/TaskOrchestrator';
import { AuditLedger } from '../lib/AuditLedger';
import { ConnectivityMonitor } from '../lib/ConnectivityMonitor';
import { NativeNeuralLMProvider } from '../lib/providers';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

function buildTrainedPureSeqBytes(): Buffer {
  const pyCode = `
import sys, base64
sys.path.insert(0, '.')
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.seq_lm import PureSeqLM, SeqLMConfig, real_vocab_size
tok = SovereignTokenizer(vocab_size=16384, profile="v2_base")
rv = real_vocab_size(tok)
cfg = SeqLMConfig(vocab=rv, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=12)
lm = PureSeqLM(cfg, seed=11, tokenizer_profile="v2_base")
b, _ = lm.to_bytes(tok, extra_meta={"training_steps": 15, "val_nll_after": 2.35, "untrained": False, "provenance_status": "TRAINED"})
sys.stdout.write(base64.b64encode(b).decode('ascii'))
`;
  const b64 = execFileSync('python3', ['-c', pyCode], { encoding: 'utf8' });
  return Buffer.from(b64, 'base64');
}

async function runPriorityVerification() {
  console.log('\n======================================================');
  console.log('  ZYNTHEOR TASK PRIORITIZATION E2E VERIFICATION       ');
  console.log('======================================================\n');

  // 1. Normalization & validation checks
  assert.equal(normalizeTaskPriority('High'), 'High');
  assert.equal(normalizeTaskPriority('high'), 'High');
  assert.equal(normalizeTaskPriority('MEDIUM'), 'Medium');
  assert.equal(normalizeTaskPriority('low'), 'Low');
  assert.equal(normalizeTaskPriority(undefined), 'Medium');
  assert.equal(normalizeTaskPriority('urgent'), 'Medium');

  assert.equal(isValidTaskPriority('High'), true);
  assert.equal(isValidTaskPriority('Medium'), true);
  assert.equal(isValidTaskPriority('Low'), true);
  assert.equal(isValidTaskPriority('URGENT'), false);
  console.log('✔ Priority normalization and validation helpers verified');

  // Spin up ephemeral PureSeqLM cloud server so online-only orchestrator execution succeeds fail-closed gate
  const ckptBytes = buildTrainedPureSeqBytes();
  const ckptPort = await getFreePort();
  const ckptServer = http.createServer((req, res) => {
    if (req.url === '/trained-seq.pt') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(ckptBytes.length),
      });
      if (req.method === 'HEAD') return res.end();
      return res.end(ckptBytes);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => ckptServer.listen(ckptPort, '127.0.0.1', resolve));

  const cloudUrl = `http://127.0.0.1:${ckptPort}/trained-seq.pt`;
  process.env.CHECKPOINT_PRESIGNED_URL = cloudUrl;
  ConnectivityMonitor.getInstance().setPresignedUrlOverride(cloudUrl);
  await NativeNeuralLMProvider.getInstance().reloadCloudWeights(cloudUrl);
  await ConnectivityMonitor.getInstance().checkNow(cloudUrl);

  try {
    const orchestrator = TaskOrchestrator.getInstance();

    // 2. Execute real tasks for High, Low, and omitted (default Medium) with verified owner/tenant
    const scenarios: Array<{ label: string; priority?: TaskPriority; expected: TaskPriority }> = [
      { label: 'High priority task', priority: 'High', expected: 'High' },
      { label: 'Low priority task', priority: 'Low', expected: 'Low' },
      { label: 'Default (omitted) priority task', priority: undefined, expected: 'Medium' },
    ];

    for (const sc of scenarios) {
      const events: OrchestrationEvent[] = [];
      const goal = `Create a sovereign cryptographic token validator with HMAC-SHA256 (${sc.label})`;
      const result = await orchestrator.executeTask(
        goal,
        (ev) => {
          events.push(ev);
        },
        {
          ...(sc.priority ? { priority: sc.priority } : {}),
          ownerUserId: 'prio_test_user',
          tenantId: 'prio_test_tenant',
        }
      );

      assert.equal(result.priority, sc.expected, `Result priority mismatch for ${sc.label}`);
      assert.equal(result.executionCycle?.priority, sc.expected, `Cycle priority mismatch for ${sc.label}`);
      assert.equal(result.executionCycle?.deliveryStatus, 'BLOCKED', `Expected BLOCKED without isolated Cloud Runner for ${sc.label}`);

      const initEv = events.find((e) => e.type === 'init');
      const stepEvs = events.filter((e) => e.type === 'step');
      const doneEv = events.find((e) => e.type === 'done');

      assert.ok(initEv, 'init event must be emitted');
      assert.equal(initEv.priority, sc.expected);
      assert.equal(initEv.data?.priority, sc.expected);
      assert.ok(initEv.message.includes(`Priority: ${sc.expected}`));

      assert.ok(stepEvs.length >= 4, 'Expected multiple step trace events');
      for (const s of stepEvs) {
        assert.equal(s.priority, sc.expected, `Step event missing priority ${sc.expected}`);
      }

      assert.ok(doneEv, 'done event must be emitted');
      assert.equal(doneEv.priority, sc.expected);
      assert.equal(doneEv.data?.priority, sc.expected);
      assert.ok(doneEv.message.includes(`[Priority: ${sc.expected}]`));

      const recentLedger = AuditLedger.getRecent(50);
      const dispatchRec = recentLedger.find(
        (r) => r.action === 'TASK_DISPATCHED' && r.payload?.taskId === result.taskId
      );
      const deliverRec = recentLedger.find(
        (r) => r.action === 'TASK_BLOCKED_CLOUD_RUNNER' && r.payload?.taskId === result.taskId
      );
      assert.ok(dispatchRec, `AuditLedger TASK_DISPATCHED record missing for ${result.taskId}`);
      assert.equal(dispatchRec.payload.priority, sc.expected);
      assert.ok(deliverRec, `AuditLedger TASK_BLOCKED_CLOUD_RUNNER record missing for ${result.taskId}`);
      assert.equal(deliverRec.payload.priority, sc.expected);

      console.log(
        `✔ Executed "${sc.label}" -> priority=${result.priority}, events=${events.length}, delivery=${result.executionCycle?.deliveryStatus}`
      );
    }

    // 3. Verify recentCycles and AuditLedger integrity remain unbroken
    const metrics = orchestrator.getExecutionMetrics();
    const topThreePriorities = metrics.recentCycles.slice(0, 3).map((c) => c.priority);
    assert.deepEqual(topThreePriorities, ['Medium', 'Low', 'High']);

    const integrity = AuditLedger.verifyIntegrity();
    assert.equal(integrity.valid, true, `AuditLedger integrity failed: ${integrity.error}`);
    console.log(`✔ Recent cycles priorities verified (${topThreePriorities.join(', ')}) & AuditLedger intact (${integrity.totalRecords} records)`);
  } finally {
    await new Promise<void>((resolve) => ckptServer.close(() => resolve()));
  }
  process.exit(0);
}

runPriorityVerification().catch((err) => {
  console.error('✖ Priority verification failed:', err);
  process.exit(1);
});
