/**
 * ZYNTHEOR P0-P6 Autonomous Engineering End-to-End Acceptance Suite
 *
 * Verifies:
 *   1. P0/P6 Reproducible Capability & Parameter Integrity Benchmark (`qplus_native.benchmark`)
 *   2. P1/P2/P4 Multi-Runtime DAG Planning, Intentional Defect Injection, Self-Repair & Regression Safety
 *      across Python AND Node.js ESM deliverables (`qplus_native.planner` + `qplus_native.repair`)
 *   3. P5 Full `TaskOrchestrator.executeTask()` against Cloud-Served Native Weights
 *      producing verified multi-file workspace outputs + extractable ZIP deliverable.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ConnectivityMonitor } from '../lib/ConnectivityMonitor.ts';
import { TaskOrchestrator } from '../lib/TaskOrchestrator.ts';

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

async function run() {
  console.log('\n======================================================');
  console.log('  ZYNTHEOR P0-P6 AUTONOMOUS E2E ACCEPTANCE SUITE');
  console.log('======================================================\n');

  // 1. P0 & P6 Capability Benchmark
  const benchRaw = execSync('python3 -m qplus_native.benchmark', { encoding: 'utf8' });
  const bench = JSON.parse(benchRaw);
  assert.equal(bench.all_checks_passed, true, 'Capability benchmark must pass all invariant & validation checks');
  assert.equal(bench.parameter_accounting.anti_conflation_verified, true);
  assert.equal(bench.training_benchmark.improved_over_initial, true);
  assert.equal(bench.gradient_verification.passed, true);
  console.log(`✔ P0/P6 Capability Benchmark passed (val NLL ${bench.training_benchmark.val_before.nll} -> ${bench.training_benchmark.val_after.nll}, params=${bench.parameter_accounting.pure_seq_actual_params})`);

  // 2. P1/P2/P4 DAG Planning + Node.js ESM Intentional Defect Self-Repair + ZIP Check
  const nodeWorkdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyn-node-repair-'));
  const pyCheck = execSync(
    `python3 -c "
import json, zipfile, os
from qplus_native.safe_exec import Sandbox
from qplus_native.planner import plan_project, package_deliverable
from qplus_native.repair import SelfRepairEngine

plan = plan_project('Build a Node.js ESM module for manifest calculation', priority='High')
assert plan['spec']['target_runtime'] == 'node_esm'
assert all('depends_on' in s for s in plan['steps'])

# Inject intentional arithmetic defect into src/core.js
for s in plan['steps']:
    if s.get('do') == 'write_file' and s.get('path') == 'src/core.js':
        s['content'] = s['content'].replace('return a + b;', 'return a - b;', 1)

sb = Sandbox(${JSON.stringify(nodeWorkdir)})
engine = SelfRepairEngine(sb, max_repairs=3)
repaired = engine.execute_with_repair(plan)
assert repaired['status'] == 'SUCCEEDED', repaired
assert repaired['repaired'] == True
assert repaired['regression_passed'] == True
pkg = package_deliverable(sb)
assert pkg['integrity_ok'] == True
print(json.dumps({'status': repaired['status'], 'attempts': len(repaired['repair_attempts']), 'zip_sha256': pkg['zip_sha256']}))
"`,
    { encoding: 'utf8' }
  );
  const nodeRepairSummary = JSON.parse(pyCheck.trim());
  assert.equal(nodeRepairSummary.status, 'SUCCEEDED');
  assert.ok(nodeRepairSummary.attempts >= 1);
  console.log(`✔ P1/P2/P4 Node.js ESM DAG Build & Autonomous Self-Repair passed (attempts=${nodeRepairSummary.attempts}, zip=${nodeRepairSummary.zip_sha256.slice(0, 12)}...)`);

  // 3. P5 TaskOrchestrator End-to-End Execution via Online Cloud Checkpoint
  const ckptBytes = fs.readFileSync(path.resolve(process.cwd(), 'native_data/model_checkpoint_seq_pure.pt'));
  const port = await getFreePort();
  const cloudUrl = `http://127.0.0.1:${port}/checkpoints/seq_pure.pt`;

  const cloudServer = http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': String(ckptBytes.length) });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Length': String(ckptBytes.length) });
    res.end(ckptBytes);
  });

  await new Promise<void>((resolve) => cloudServer.listen(port, '127.0.0.1', resolve));

  try {
    process.env.CHECKPOINT_PRESIGNED_URL = cloudUrl;
    const state = await ConnectivityMonitor.getInstance().reconnect(cloudUrl);
    assert.equal(state.online, true);
    assert.equal(state.weightsLoaded, true);

    const events: string[] = [];
    const result = await TaskOrchestrator.getInstance().executeTask(
      'Build a Node.js utility with unit tests and summary CLI',
      (ev) => events.push(`${ev.cycleStage || '-'}:${ev.type}`),
      { priority: 'High' }
    );

    assert.equal(result.success, true);
    assert.equal(result.executionCycle?.deliveryStatus, 'DELIVERED');
    assert.equal(result.executionCycle?.lifecycleStatus, 'Delivered');
    assert.ok((result.executionCycle?.artifacts?.length || 0) >= 3);
    assert.equal(result.executionCycle?.packageArtifact?.integrityOk, true);
    assert.ok(
      result.executionCycle?.limitations.some((l) => l.includes('ONLINE-ONLY')),
      'Limitation report must document strict ONLINE-ONLY execution'
    );
    console.log(`✔ P5 TaskOrchestrator E2E Delivery passed (${result.executionCycle?.artifacts.length} verified artifacts, zip=${result.executionCycle?.packageArtifact?.zipFilename})`);
  } finally {
    await new Promise<void>((resolve) => {
      if (typeof (cloudServer as any).closeAllConnections === 'function') {
        (cloudServer as any).closeAllConnections();
      }
      cloudServer.close(() => resolve());
    });
  }

  console.log('\nAll P0-P6 autonomous E2E acceptance checks PASSED.\n');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Autonomous E2E test failed:', err);
    process.exit(1);
  });
