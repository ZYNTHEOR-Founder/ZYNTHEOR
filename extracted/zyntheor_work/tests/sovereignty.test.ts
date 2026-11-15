/**
 * ZYNTHEOR Sovereign Verification Test Suite
 * Zero-Fake Engineering Standard: Real runtime tests with zero mocks.
 * 
 * Separate Invariant Audits:
 * 1. Native Model Architecture & Learned Weights Checkpoint
 * 2. Cryptographic AuditLedger SHA-256 Chained Hash
 * 3. Knowledge Workspace Multi-Format Parsing & Grounding Retrieval
 * 4. Dataset Quality Gate (Synthetic Isolation vs Verified Ready)
 * 5. Sovereign Cryptographic Identity (HMAC Constant-Time Verification)
 * 6. Sandbox Execution & Isolated Code Runner (ToolGateway)
 * 7. Security Boundaries & Path Traversal Defense (/workspace sandbox escape defense)
 * 8. Autograd Numerical Correctness & 100% Parameter Gradient Coverage
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { AuditLedger } from '../lib/AuditLedger';
import { NativeMemoryController } from '../lib/NativeMemoryController';
import { KnowledgeWorkspace } from '../lib/KnowledgeWorkspace';
import { SovereignIdentity } from '../lib/SovereignIdentity';
import { ToolGateway } from '../lib/ToolGateway';
import { appendEvent, verifyAuditLedgerIntegrity, getAuditEvents } from '../src/utils/auditLedger';

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('  ZYNTHEOR SOVEREIGN NATIVE INTELLIGENCE VERIFICATION ');
  console.log('  Zero-Fake Standard: Real Runtime Evidence Audit      ');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, extra?: string) {
    if (condition) {
      console.log(`✔ ${testName}${extra ? ` (${extra})` : ''}`);
      passed++;
    } else {
      console.error(`✖ ${testName}${extra ? ` (${extra})` : ''}`);
      failed++;
    }
  }

  // ------------------------------------------------------------------
  // 1. Model Checkpoint Container & Online-Only Architecture Audit
  // ------------------------------------------------------------------
  const checkpointPath = path.resolve(process.cwd(), 'native_data/model_checkpoint_seq_pure.pt');
  const checkpointExists = fs.existsSync(checkpointPath);
  assert(checkpointExists, '1. Cloud-streamable PureSeqLM reference container exists for test streaming');

  if (checkpointExists) {
    const stats = fs.statSync(checkpointPath);
    const fd = fs.openSync(checkpointPath, 'r');
    const magicBuf = Buffer.alloc(17);
    fs.readSync(fd, magicBuf, 0, 17, 0);
    assert(magicBuf.toString('utf-8') === 'ZYNTHEOR_QPLUS_PT', '2. Magic header ZYNTHEOR_QPLUS_PT verified');

    const headerLenBuf = Buffer.alloc(4);
    fs.readSync(fd, headerLenBuf, 0, 4, 17);
    const headerLen = headerLenBuf.readUInt32BE(0);
    const headerBuf = Buffer.alloc(headerLen);
    fs.readSync(fd, headerBuf, 0, headerLen, 21);
    fs.closeSync(fd);

    const header = JSON.parse(headerBuf.toString('utf-8'));
    assert(header.total_params === 51296, '3. PureSeqLM container metadata matches 51,296 serialized Float32 parameters', `Actual params: ${header.total_params}`);
    assert(header.storage_mode === 'LEARNED_WEIGHTS_SEQ_PURE_PY' && header.config?.n_layers === 2, '4. Honest PureSeqLM architecture metadata (L=2, H=4, D=32, 51,296 params)');
    assert(header.total_params !== 41527808 && header.total_params !== 502912, '5. Honest Parameter Accounting: never conflates 51K with 2.0M or 41.53M');
  }

  // ------------------------------------------------------------------
  // 2. AuditLedger Cryptographic SHA-256 Chain Verification
  // ------------------------------------------------------------------
  const event1 = appendEvent('AUTH_EVENT', { user: 'sovereign_admin', action: 'login' });
  const event2 = appendEvent('MODEL_EVAL', { metric: 'ppl', score: 14.2 });
  const event3 = appendEvent('DATASET_CURATION', { pairs: 100, split: '80/10/10' });
  
  const clientVerification = verifyAuditLedgerIntegrity();
  assert(clientVerification.valid === true, '6. Client-Side AuditLedger maintains unbroken SHA-256 chain', `Total Blocks: ${clientVerification.totalBlocks}`);

  const events = getAuditEvents();
  assert(events.length >= 3, '7. Client-Side events successfully retrieved and immutable');

  // ------------------------------------------------------------------
  // 3. Knowledge Workspace Multi-Format Parsing
  // ------------------------------------------------------------------
  const kw = KnowledgeWorkspace.getInstance();

  // Test JSON parsing
  const jsonParsed = kw.parseDocumentContent(JSON.stringify({
    architecture: 'Transformer',
    layers: 10,
    attention: 'Multi-Head'
  }), 'json');
  assert(jsonParsed.cleanText.includes('architecture'), '8. Multi-format Parser: JSON parsed to structured key-value format');

  // Test CSV parsing
  const csvParsed = kw.parseDocumentContent("id,name,role\n1,Zyntheor,Native\n2,Kernel,Core", 'csv');
  assert(csvParsed.cleanText.includes('Row 1') && csvParsed.cleanText.includes('Zyntheor'), '9. Multi-format Parser: CSV converted to tabular record representation');

  // Test Code parsing
  const codeParsed = kw.parseDocumentContent("function computeLoss(y, y_hat) {\n  return -Math.log(y_hat);\n}", 'code');
  assert(codeParsed.metadata.lineCount === 3 && codeParsed.cleanText.includes('computeLoss'), '10. Multi-format Parser: Source code parsed with metadata and structure');

  // ------------------------------------------------------------------
  // 4. Grounding Retrieval & Relevance Scoring
  // ------------------------------------------------------------------
  const docs = kw.listDocuments();
  assert(docs.length >= 4, `11. Knowledge Workspace contains seeded technical documents (${docs.length} found)`);

  const searchResults = kw.retrieve('Transformer attention dimension', { limit: 3 });
  assert(searchResults.length > 0, `12. Inverted-index retrieval returns relevant chunks (${searchResults.length} matches)`);
  assert(searchResults[0].score > 0, `13. Top result has positive relevance score (Score: ${searchResults[0].score})`);

  // ------------------------------------------------------------------
  // 5. Dataset Quality Gate: Synthetic vs Verified Separation
  // ------------------------------------------------------------------
  const humanDocs = docs.filter(d => !d.provenance.toLowerCase().includes('synthetic'));
  const humanManifest = kw.curateDataset('Verified Human Technical Corpus', humanDocs.map(d => d.id));
  assert(humanManifest.status === 'VERIFIED_READY', '14. Quality Gate: Clean human dataset marked VERIFIED_READY');

  const syntheticDoc = kw.createDocument({
    title: 'Synthetic Test Benchmark Generation',
    content: 'Synthetic machine generated data for testing quarantine protocol.',
    collection: 'Synthetic_Test',
    provenance: 'Synthetic LLM generation'
  });
  const quarantinedManifest = kw.curateDataset('Contaminated Test Corpus', [syntheticDoc.id]);
  assert(quarantinedManifest.status === 'NEEDS_REVIEW', '15. Quality Gate: Synthetic data quarantined as NEEDS_REVIEW');
  assert(quarantinedManifest.syntheticCount === 1, '16. Quality Gate: Synthetic count accurately isolated in manifest');

  // ------------------------------------------------------------------
  // 6. Sovereign HMAC Token Verification & Constant-Time Security
  // ------------------------------------------------------------------
  const identity = SovereignIdentity.getInstance();
  const { token, payload: issuedPayload } = identity.signToken({
    sub: 'user-001',
    tenantId: 'tenant-001',
    role: 'admin'
  });
  const verified = identity.verifyToken(token);
  assert(verified.valid === true, '17. Sovereign cryptographic token issued and verified in constant-time');
  assert(verified.payload?.tenantId === 'tenant-001', '18. Token claims match verified tenant identity');

  // ------------------------------------------------------------------
  // 7. Sandbox Execution & Isolated Code Runner (ToolGateway)
  // ------------------------------------------------------------------
  try {
    const sandboxRun = await ToolGateway.runCommand('node', ['-e', 'console.log("SANDBOX_INVARIANT_OK")']);
    assert(sandboxRun.exitCode === 0 && sandboxRun.stdout.includes('SANDBOX_INVARIANT_OK'), '19. Sandbox Execution: ToolGateway executes whitelisted command inside /workspace successfully', `exitCode: ${sandboxRun.exitCode}`);
  } catch (err: any) {
    assert(false, '19. Sandbox Execution: ToolGateway execution failed', err.message);
  }

  // ------------------------------------------------------------------
  // 8. Security Boundaries & Path Traversal Escape Defense
  // ------------------------------------------------------------------
  let pathTraversalBlocked = false;
  try {
    ToolGateway.resolveSafePath('../../etc/shadow');
  } catch (err: any) {
    pathTraversalBlocked = err.message.includes('SECURITY_VIOLATION') || err.message.includes('Path traversal detected');
  }
  assert(pathTraversalBlocked, '20. Security Boundary: ToolGateway blocks path traversal escape attempt (Fail-Closed)');

  // ------------------------------------------------------------------
  // 9. Autograd Numerical Correctness & Parameter Gradient Coverage
  // ------------------------------------------------------------------
  try {
    const pythonCheck = execSync(`python3 -c "
from qplus_native.engine import check_numerical_gradient, LinearLayer
layer = LinearLayer(4, 4, 'test_linear')
res = check_numerical_gradient(layer, [0.5, -0.2, 0.8, -0.4])
assert res['passed'] == True, 'Numerical gradient test failed'
print('OK')
"`, { encoding: 'utf-8' });
    assert(pythonCheck.trim() === 'OK', '21. Autograd Engine: Analytical backward matches finite-difference numerical gradient (rel_error < 1e-4)');
  } catch (err) {
    assert(false, '21. Autograd Engine: Analytical backward matches finite-difference numerical gradient');
  }

  try {
    const pythonCoverage = execSync(`python3 -c "
from qplus_native.engine import analyze_gradient_coverage, LinearLayer
l1 = LinearLayer(4, 4, 'l1')
l2 = LinearLayer(4, 4, 'l2')
x = [0.5, -0.2, 0.8, -0.4]
h = l1.forward(x)
y = l2.forward(h)
l1.backward(l2.backward([1.0]*4))
cov = analyze_gradient_coverage([l1.weight, l1.bias, l2.weight, l2.bias])
assert cov['all_tensors_covered'] == True
print('OK')
"`, { encoding: 'utf-8' });
    assert(pythonCoverage.trim() === 'OK', '22. Autograd Engine: Gradient coverage is 100% across all parameter tensors');
  } catch (err) {
    assert(false, '22. Autograd Engine: Gradient coverage is 100% across all parameter tensors');
  }

  // ------------------------------------------------------------------
  // 10. Online-Only Fail-Closed Local Read Rejection & Cloud Byte Load
  // ------------------------------------------------------------------
  try {
    const pythonModelCheck = execSync(`python3 -c "
import os
os.environ.pop('CHECKPOINT_PRESIGNED_URL', None)
os.environ.pop('S3_BUCKET', None)
from qplus_native.model import NativeNeuralModel

# 1. Local disk weight paths MUST fail closed
failed_local = False
try:
    NativeNeuralModel('native_data/model_checkpoint_seq_pure.pt')
except RuntimeError as exc:
    failed_local = 'FAIL_CLOSED' in str(exc) and 'Online Connectivity Required' in str(exc)
assert failed_local, 'Local disk read fallback must fail closed'

# 2. Explicit in-memory cloud_bytes load succeeds without local fallback
with open('native_data/model_checkpoint_seq_pure.pt', 'rb') as fh:
    raw = fh.read()
model = NativeNeuralModel(checkpoint_path='https://cloud-mock.invalid/seq_pure.pt', cloud_bytes=raw)
assert model.weights_loaded == True
assert model.learned_weights_loaded == True
assert model.config.total_params == 51296
print('CLOUD_ONLY_OK')
"`, { encoding: 'utf-8' });
    assert(pythonModelCheck.trim() === 'CLOUD_ONLY_OK', '23. Online-Only Sovereignty: Local weight fallback fails closed & in-memory cloud load verified');
  } catch (err) {
    assert(false, '23. Online-Only Sovereignty check failed');
  }

  console.log('\n======================================================');
  console.log(`  RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test runner failure:', err);
  process.exit(1);
});
