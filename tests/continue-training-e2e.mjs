import fs from 'node:fs';

const base = process.env.ZYNTHEOR_BASE_URL || 'http://127.0.0.1:3000';
const rounds = Number(process.env.ZYNTHEOR_CONTINUE_ROUNDS || 3);
const corpus = 'ZYNTHEOR ภาษาไทย English';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'Administrator', userId: 'continued-training', tenantId: 'tenant_sovereign_prime' })
});
if (!login.success || !login.token) throw new Error('Server-issued training token unavailable');
const auth = { Authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
const before = await request('/api/system/status');
const steps = [];

for (let index = 0; index < rounds; index += 1) {
  const result = await request('/api/model/train', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ text: corpus, epochs: 2 })
  });
  if (!result.success) throw new Error(`Training round ${index + 1} failed`);
  steps.push({
    round: index + 1,
    trainingStep: result.training_step,
    epochs: result.epochs,
    tokensProcessed: result.tokens_processed,
    lossBefore: result.loss_before,
    lossAfter: result.loss_after,
    lossReductionPct: result.loss_reduction_pct,
    paramMutationDelta: result.param_mutation_delta,
    gradientCoverage: result.gradient_coverage,
    numericalGradientCheck: result.numerical_gradient_check,
    forwardGraph: result.forward_graph
  });
}

const after = await request('/api/system/status');
const evidence = {
  status: 'VERIFIED',
  startedAt: new Date().toISOString(),
  base,
  policy: 'Continued native optimizer training; checkpoint export intentionally not performed.',
  corpus,
  rounds,
  checkpointHashBefore: before.model.checkpointHash,
  checkpointHashAfter: after.model.checkpointHash,
  weightsLoadedAfter: after.model.weightsLoaded,
  steps
};
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/continued-training-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
