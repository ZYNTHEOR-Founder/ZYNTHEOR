import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeWorkspace } from '../lib/KnowledgeWorkspace';
import { KnowledgeGraphEngine } from '../lib/KnowledgeGraphEngine';
import {
  getTrainingPipelineStatusSummary,
  evaluateTrainingProgressAlerts,
  calculateTimeToEpoch,
} from '../lib/NativeNumpyTrainingService';
import { apiUrl, getApiBaseUrl, setApiBaseUrl, resolveWebSocketUrl, installApiBaseFetchRewrite } from '../src/lib/apiClient';

function installMockBrowserGlobals() {
  const store = new Map<string, string>();
  const events: Array<{ type: string; detail: unknown }> = [];
  (globalThis as any).window = {
    location: { protocol: 'http:', host: 'localhost:3000', origin: 'http://localhost:3000', href: 'http://localhost:3000/' },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    },
    dispatchEvent: (ev: any) => {
      events.push({ type: ev?.type, detail: ev?.detail });
      return true;
    },
  };
  (globalThis as any).CustomEvent = class MockCustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  return { store, events };
}

async function run() {
  console.log('1. Testing Python bridge language integrity fail-closed suite...');
  const pyOut = execFileSync(
    'python3',
    [
      '-c',
      'import json; from qplus_native.bridge import run_language_integrity_suite; print(json.dumps(run_language_integrity_suite(None)))',
    ],
    { encoding: 'utf8' }
  );
  const suite = JSON.parse(pyOut.trim());
  assert.equal(suite.total_tests, 5, 'Expected 5 language integrity probes');
  assert.equal(suite.passed_tests, 4, 'Expected 4 SovereignTokenizer TH/EN probes to pass');
  assert.equal(suite.verified, false, 'Suite must fail-closed when Cloud Checkpoint model is unloaded');
  const infProbe = suite.results.find((r: any) => r.test_id === 'LANG_RUNTIME_INFERENCE');
  assert.ok(infProbe && infProbe.status === 'FAIL', 'LANG_RUNTIME_INFERENCE must fail closed without weights');
  assert.ok(String(infProbe.evidence).includes('BLOCKED'), 'LANG_RUNTIME_INFERENCE evidence must state BLOCKED');
  console.log('   PASS: 4 tokenizer probes PASS, inference fail-closed BLOCKED');

  console.log('2. Testing KnowledgeWorkspace Thai n-gram + regex escaping retrieval...');
  const kw = KnowledgeWorkspace.getInstance();
  const createdDoc = kw.createDocument({
    title: 'Thai-English SovereignTokenizer Architecture Test',
    content:
      'SovereignTokenizer defines 16,384 bilingual Thai and English subwords.\nTokenizer: v2_base\nภาษาไทยและระบบประมวลผลอัจฉริยะทำงานร่วมกับ KnowledgeGraphEngine.',
    collection: 'architecture',
    tags: ['tokenizer', 'thai'],
  });
  try {
    // Should not throw on regex metacharacters like () [] * + ?
    const metaHits = kw.retrieve('SovereignTokenizer (16,384) [v2_base]? *+', { limit: 5 });
    assert.ok(metaHits.length >= 1, 'Expected grounded hit with regex metacharacters safely escaped');

    const thaiHits = kw.retrieve('ระบบประมวลผลอัจฉริยะ tokenizer', { limit: 5 });
    assert.ok(thaiHits.length >= 1, 'Expected Thai shingle + English query to return grounded hit');
    assert.ok(thaiHits[0].text && thaiHits[0].score > 0, 'Expected non-empty text and positive score');
    console.log(`   PASS: Retrieved ${thaiHits.length} grounded hit(s) (top score=${thaiHits[0].score})`);

    console.log('3. Testing KnowledgeGraphEngine multi-hop alias traversal for "tokenizer"...');
    const kg = KnowledgeGraphEngine.getInstance();
    kg.buildFromWorkspace();
    const traversal = kg.traverseMultiHop('tokenizer', { maxHops: 3, limit: 5 });
    assert.ok(traversal.paths.length >= 1, 'Expected at least 1 multi-hop path for "tokenizer"');
    const firstPath = traversal.paths[0];
    assert.equal(typeof firstPath.score, 'number', 'Path must expose numeric p.score');
    assert.ok(firstPath.hops.length >= 1, 'Path must include hop details');
    assert.ok(firstPath.hops[0].contentHash, 'Hop must retain document SHA-256 contentHash');
    console.log(`   PASS: Found ${traversal.paths.length} multi-hop path(s) (top score=${firstPath.score})`);
  } finally {
    kw.deleteDocument(createdDoc.id);
    KnowledgeGraphEngine.getInstance().buildFromWorkspace();
  }

  console.log('4. Testing apiClient URL + WebSocket resolution for Capacitor Android...');
  const { events } = installMockBrowserGlobals();
  assert.equal(getApiBaseUrl(), '');
  assert.equal(apiUrl('/api/health'), '/api/health');
  assert.equal(resolveWebSocketUrl('/ws/runtime'), 'ws://localhost:3000/ws/runtime');

  const bad = setApiBaseUrl('ftp://invalid-host');
  assert.equal(bad.ok, false, 'Invalid scheme must be rejected');

  const good = setApiBaseUrl('https://runtime.zyntheor.ai///');
  assert.equal(good.ok, true);
  assert.equal(good.normalized, 'https://runtime.zyntheor.ai');
  assert.equal(apiUrl('/api/health'), 'https://runtime.zyntheor.ai/api/health');
  assert.equal(resolveWebSocketUrl('/ws/runtime'), 'wss://runtime.zyntheor.ai/ws/runtime');
  assert.ok(events.some((e) => e.type === 'zyntheor:api-base-changed'), 'API base change must broadcast event');

  // Verify installApiBaseFetchRewrite handles getter-only Window.fetch descriptors cleanly
  const fetchedUrls: string[] = [];
  const mockNativeFetch = async (input: RequestInfo | URL) => {
    fetchedUrls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    return { ok: true, status: 200 } as Response;
  };
  Object.defineProperty((globalThis as any).window, 'fetch', {
    get: () => mockNativeFetch,
    configurable: true,
    enumerable: true,
  });
  installApiBaseFetchRewrite();
  setApiBaseUrl('https://runtime.zyntheor.ai');
  await (globalThis as any).window.fetch('/api/health');
  assert.equal(fetchedUrls[0], 'https://runtime.zyntheor.ai/api/health', 'Getter-only window.fetch must be safely wrapped and rewrite /api/*');

  setApiBaseUrl('');
  assert.equal(getApiBaseUrl(), '');
  console.log('   PASS: apiClient URL, WebSocket & getter-only fetch wrapper verified');

  console.log('5. Verifying repaired UI source contracts (App.tsx & ResearchLab.tsx)...');
  const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  assert.equal(appSrc.includes('lg:pl-72'), false, 'App.tsx must not have leftover lg:pl-72 blank gutter');
  assert.ok(appSrc.includes('hidden={hasBlockingOverlay}'), 'MobileNav must receive hidden={hasBlockingOverlay}');
  assert.ok(appSrc.includes("case 'proof_of_intelligence':"), 'App.tsx must route proof_of_intelligence');
  assert.ok(appSrc.includes("case 'infrastructure_cloud':"), 'App.tsx must route infrastructure_cloud');
  assert.ok(appSrc.includes('<EvidenceViewerDrawer'), 'App.tsx must mount EvidenceViewerDrawer');
  assert.ok(appSrc.includes('<GlobalSearchModal'), 'App.tsx must mount GlobalSearchModal');
  assert.ok(
    appSrc.includes('isAuthenticated && headers.Authorization'),
    'App.tsx must gate authenticated /api/dashboard/truth fetches behind Bearer token presence'
  );

  const researchSrc = fs.readFileSync(path.resolve('src/components/modules/ResearchLab.tsx'), 'utf8');
  assert.ok(researchSrc.includes('suite?.results'), 'ResearchLab must parse data.suite?.results');
  assert.ok(researchSrc.includes('p.score'), 'ResearchLab graph view must render p.score');
  assert.ok(researchSrc.includes('latestPerplexity'), 'ResearchLab must display latestPerplexity');

  console.log('6. Verifying 5,800-step training summary & CommandCenter gauge invariants...');
  const trainingSummary = getTrainingPipelineStatusSummary();
  assert.equal(trainingSummary.targetSteps, 5800, 'Expected targetSteps to match locked 5,800-step plan');
  assert.equal(trainingSummary.targetParams, 41_527_808, 'Expected targetParams to match 41,527,808');
  assert.ok(trainingSummary.currentStep >= 0 && trainingSummary.currentStep <= trainingSummary.targetSteps);
  assert.equal(trainingSummary.running, false, 'No training process should be falsely reported as running');
  assert.equal(trainingSummary.totalEpochs, 1, 'Expected 1 locked 5,800-step training cycle');
  assert.equal(trainingSummary.currentEpoch, 0, 'Expected epoch 0 when 0 steps have run');
  assert.equal(trainingSummary.estimatedSecondsRemaining, null, 'ETA must remain null when no live step rate exists');
  assert.deepEqual(trainingSummary.alerts, [], 'No false alerts should fire when training is idle/blocked');
  assert.ok(trainingSummary.timeToEpoch, 'Expected timeToEpoch estimate object on training summary');
  assert.equal(trainingSummary.timeToEpoch.maxWindowSteps, 10, 'Expected 10-step historical window');
  assert.equal(trainingSummary.timeToEpoch.windowSteps, 0, 'Expected 0 recorded steps while idle');
  assert.equal(trainingSummary.timeToEpoch.estimatedSecondsToEpoch, null, 'Time-to-Epoch must be null without step samples');

  // Verify Time-to-Epoch calculator strictly averages only the last 10 completed steps
  const tteEmpty = calculateTimeToEpoch({
    recentStepDurationsSec: [],
    currentStep: 0,
    targetSteps: 5800,
    currentEpoch: 0,
    totalEpochs: 1,
  });
  assert.equal(tteEmpty.basis, 'awaiting_step_history');
  assert.equal(tteEmpty.estimatedSecondsToEpoch, null);
  assert.equal(tteEmpty.remainingStepsInEpoch, 5800);

  const tteWindowed = calculateTimeToEpoch({
    // First two outliers (10s) must be dropped; last 10 sum to 18.0 -> avg 1.8s/step
    recentStepDurationsSec: [10, 10, 1.0, 2.0, 1.5, 2.5, 2.0, 1.0, 2.0, 2.0, 1.5, 2.5],
    currentStep: 100,
    targetSteps: 5800,
    currentEpoch: 1,
    totalEpochs: 1,
  });
  assert.equal(tteWindowed.basis, 'last_10_steps');
  assert.equal(tteWindowed.windowSteps, 10);
  assert.equal(tteWindowed.averageStepSeconds, 1.8);
  assert.equal(tteWindowed.remainingStepsInEpoch, 5700);
  assert.equal(tteWindowed.estimatedSecondsToEpoch, 10260);

  const tteCompleted = calculateTimeToEpoch({
    recentStepDurationsSec: [1.5, 1.6],
    currentStep: 5800,
    targetSteps: 5800,
    currentEpoch: 1,
    totalEpochs: 1,
    trainingCompletedVerified: true,
  });
  assert.equal(tteCompleted.basis, 'completed');
  assert.equal(tteCompleted.estimatedSecondsToEpoch, 0);
  assert.equal(tteCompleted.remainingStepsInEpoch, 0);

  // Verify stall (> 5 minutes) and validation loss upward-trend alert evaluator
  const baseNow = Date.parse('2026-11-18T12:00:00.000Z');
  const stalledEval = evaluateTrainingProgressAlerts({
    running: true,
    startedAt: '2026-11-18T11:50:00.000Z',
    lastStepAdvanceAt: '2026-11-18T11:54:00.000Z', // 6.0 min stalled
    valLosses: [4.2, 4.1, 4.0],
    nowMs: baseNow,
  });
  assert.equal(stalledEval.alerts.length, 1);
  assert.equal(stalledEval.alerts[0].id, 'stalled_progress');

  const risingValEval = evaluateTrainingProgressAlerts({
    running: true,
    startedAt: '2026-11-18T11:58:00.000Z',
    lastStepAdvanceAt: '2026-11-18T11:59:30.000Z', // 0.5 min (not stalled)
    valLosses: [3.2, 3.35, 3.55, 3.8],
    nowMs: baseNow,
  });
  assert.equal(risingValEval.alerts.length, 1);
  assert.equal(risingValEval.alerts[0].id, 'val_loss_rising');

  const commandCenterSrc = fs.readFileSync(path.resolve('src/components/modules/CommandCenter.tsx'), 'utf8');
  assert.ok(commandCenterSrc.includes('statusData?.training'), 'CommandCenter must read training progress from statusData.training');
  assert.ok(commandCenterSrc.includes('role="progressbar"'), 'CommandCenter gauge must expose accessible progressbar');
  assert.ok(commandCenterSrc.includes('training-progress-gauge-section'), 'CommandCenter must mount training progress gauge section');
  assert.ok(commandCenterSrc.includes('training-gauge-epoch'), 'CommandCenter must display current epoch');
  assert.ok(commandCenterSrc.includes('training-gauge-eta'), 'CommandCenter must display estimated time remaining');
  assert.ok(commandCenterSrc.includes('training-alert-banner'), 'CommandCenter must surface stall/val_loss warning alert banner');
  assert.ok(commandCenterSrc.includes('interpolateBlueToEmerald'), 'CommandCenter gauge must interpolate percentage fill from blue to emerald');
  assert.ok(commandCenterSrc.includes('time-to-epoch-calculator'), 'CommandCenter must mount Time-to-Epoch Calculator section');
  assert.ok(commandCenterSrc.includes('time-to-epoch-avg-step'), 'CommandCenter must show last-10-step average step duration');
  assert.ok(commandCenterSrc.includes('time-to-epoch-manual-input'), 'CommandCenter must support planning pace input');
  console.log('   PASS: UI repair & 5,800-step gauge source invariants verified');

  console.log('\nALL UI & BACKEND REPAIR REGRESSION CHECKS PASSED.');
}

run().catch((err) => {
  console.error('REGRESSION FAILURE:', err);
  process.exit(1);
});
