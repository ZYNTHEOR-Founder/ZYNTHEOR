import fs from 'node:fs';

const base = process.env.ZYNTHEOR_BASE_URL || 'http://127.0.0.1:3000';
const evidencePath = process.env.ZYNTHEOR_EVIDENCE || 'artifacts/training-evidence.json';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION_FAILED: ${message}`);
}

const startedAt = new Date().toISOString();
const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'Administrator', userId: 'live-training-e2e', tenantId: 'tenant_sovereign_prime' })
});
assert(login.success && login.token, 'server-issued Administrator token is required');
const auth = { Authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };

const health = await request('/api/health');
assert(health.sovereign === true, 'health must identify sovereign runtime');

const beforeStatus = await request('/api/system/status');
const beforeInspect = await request('/api/model/inspect', { headers: auth });
assert(beforeStatus.model?.weightsLoaded === true, 'native learned weights must be loaded');
assert(beforeInspect.success === true, 'checkpoint inspect must succeed');
assert(beforeInspect.sha256_match === true, 'checkpoint SHA-256 must match before training');

const train = await request('/api/model/train', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    text: 'ZYNTHEOR ภาษาไทย English',
    epochs: 2
  })
});
assert(train.success === true, 'native training endpoint must return success');
assert(Number(train.loss_after) < Number(train.loss_before), 'empirical loss must decrease');
assert(train.param_changed_verified === true, 'training must mutate learned parameters');
assert(train.gradient_coverage?.all_covered === true, 'all trainable tensors must receive gradients');
assert(train.numerical_gradient_check?.passed === true && Number(train.numerical_gradient_check?.max_relative_error ?? 1) < 1e-4, 'numerical gradient check must pass');

const afterStatus = await request('/api/system/status');
const afterInspect = await request('/api/model/inspect', { headers: auth });
assert(afterStatus.model?.weightsLoaded === true, 'weights must remain loaded after training');
assert(afterInspect.sha256_match === true, 'checkpoint on disk must remain cryptographically valid');
assert(afterStatus.model.checkpointHash === beforeStatus.model.checkpointHash, 'training E2E must not overwrite checkpoint without explicit export');

const evidence = {
  startedAt,
  finishedAt: new Date().toISOString(),
  base,
  status: 'VERIFIED',
  policy: 'Training step executed against native runtime; no checkpoint export performed.',
  health: { sovereign: health.sovereign, version: health.version },
  checkpoint: {
    beforeHash: beforeStatus.model.checkpointHash,
    afterHash: afterStatus.model.checkpointHash,
    sha256Before: beforeInspect.sha256_match,
    sha256After: afterInspect.sha256_match,
    weightsLoadedBefore: beforeStatus.model.weightsLoaded,
    weightsLoadedAfter: afterStatus.model.weightsLoaded
  },
  training: {
    trainingStep: train.training_step,
    epochs: train.epochs,
    tokensProcessed: train.tokens_processed,
    lossBefore: train.loss_before,
    lossAfter: train.loss_after,
    lossReductionPct: train.loss_reduction_pct,
    paramMutationDelta: train.param_mutation_delta,
    gradientCoverage: train.gradient_coverage,
    numericalGradientCheck: train.numerical_gradient_check,
    forwardGraph: train.forward_graph
  }
};

fs.mkdirSync(new URL('.', `file://${process.cwd()}/${evidencePath}`).pathname, { recursive: true });
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
