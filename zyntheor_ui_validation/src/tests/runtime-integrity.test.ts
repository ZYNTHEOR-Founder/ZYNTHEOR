/**
 * ZYNTHEOR Runtime Checkpoint SHA-256 Integrity Unit Tests
 *
 * Covers both TypeScript (lib/CloudCheckpointStorage.ts -> parseCheckpointBuffer)
 * and Python bridge (qplus_native/cloud_storage.py -> parse_checkpoint_container)
 * verification over valid and tampered ZYNTHEOR_QPLUS_PT binary containers.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { parseCheckpointBuffer } from '../../lib/CloudCheckpointStorage.ts';
import {
  evaluateCheckpointHashAgainstMetadata,
  resetCheckpointMonitorDebounceState,
  resolveCloudSignedMetadataHash,
  verifyAndRecordCheckpointIntegrity,
} from '../../lib/CheckpointIntegrityMonitor.ts';

const MAGIC = 'ZYNTHEOR_QPLUS_PT';

function buildCheckpointContainer(
  weights: number[],
  metaOverrides: Record<string, any> = {},
  options: { tamperPayloadByteIndex?: number; omitShaField?: boolean } = {}
): { buffer: Buffer; expectedSha256: string } {
  const floatArr = new Float32Array(weights);
  const payload = Buffer.from(floatArr.buffer, floatArr.byteOffset, floatArr.byteLength);
  const actualSha = crypto.createHash('sha256').update(payload).digest('hex');

  const metadata: Record<string, any> = {
    model_name: 'ZYNTHEOR-Integrity-UnitTest',
    architecture: 'PureSeqLM-1L-2H-16D',
    total_params: weights.length,
    ...(options.omitShaField ? {} : { sha256: actualSha }),
    ...metaOverrides,
  };

  const metaBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
  const lenHeader = Buffer.alloc(4);
  lenHeader.writeUInt32BE(metaBytes.length, 0);

  const finalPayload = Buffer.from(payload);
  if (
    typeof options.tamperPayloadByteIndex === 'number' &&
    options.tamperPayloadByteIndex >= 0 &&
    options.tamperPayloadByteIndex < finalPayload.length
  ) {
    finalPayload[options.tamperPayloadByteIndex] ^= 0xff;
  }

  return {
    buffer: Buffer.concat([Buffer.from(MAGIC, 'utf8'), lenHeader, metaBytes, finalPayload]),
    expectedSha256: actualSha,
  };
}

let passed = 0;
let failed = 0;

async function runCase(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`✖ ${name}: ${err?.message || err}`);
    failed++;
  }
}

console.log('\n======================================================');
console.log('  ZYNTHEOR CHECKPOINT SHA-256 INTEGRITY UNIT TESTS    ');
console.log('======================================================\n');

async function main() {
// Positive scenarios
await runCase('Positive 1: Valid SHA-256 digest in metadata.sha256 passes verification', () => {
  const weights = [0.25, -0.5, 1.125, -2.75, 0.0, 3.5];
  const { buffer, expectedSha256 } = buildCheckpointContainer(weights);
  const parsed = parseCheckpointBuffer(buffer, 'https://cloud.example/valid.pt');

  assert.equal(parsed.magic, MAGIC);
  assert.equal(parsed.payloadSha256, expectedSha256);
  assert.equal(parsed.weightsFloat32.length, weights.length);
  assert.equal(parsed.byteSize, buffer.length);
  for (let i = 0; i < weights.length; i++) {
    assert.ok(Math.abs(parsed.weightsFloat32[i] - weights[i]) < 1e-6);
  }
});

await runCase('Positive 2: Valid SHA-256 digest in metadata.payload_sha256 passes verification', () => {
  const weights = [1.0, 2.0, -3.0, 4.5];
  const floatArr = new Float32Array(weights);
  const payloadSha = crypto
    .createHash('sha256')
    .update(Buffer.from(floatArr.buffer))
    .digest('hex');

  const { buffer } = buildCheckpointContainer(
    weights,
    { payload_sha256: payloadSha },
    { omitShaField: true }
  );
  const parsed = parseCheckpointBuffer(buffer, 's3://zyntheor-bucket/valid-alt.pt');
  assert.equal(parsed.payloadSha256, payloadSha);
  assert.equal(parsed.weightsFloat32.length, weights.length);
});

await runCase('Positive 3: Real PureSeqLM Python container matches TypeScript SHA-256 verification', () => {
  const pyCode = `
import sys, base64, json
sys.path.insert(0, '.')
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.seq_lm import PureSeqLM, SeqLMConfig, real_vocab_size
from qplus_native.cloud_storage import parse_checkpoint_container
tok = SovereignTokenizer(vocab_size=16384, profile="v2_base")
rv = real_vocab_size(tok)
cfg = SeqLMConfig(vocab=rv, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=12)
lm = PureSeqLM(cfg, seed=7, tokenizer_profile="v2_base")
b, meta = lm.to_bytes(tok, extra_meta={"training_steps": 5, "provenance_status": "TRAINED"})
_, _, py_sha = parse_checkpoint_container(b)
sys.stdout.write(json.dumps({"b64": base64.b64encode(b).decode("ascii"), "py_sha": py_sha}))
`;
  const raw = execFileSync('python3', ['-c', pyCode], { encoding: 'utf8' });
  const { b64, py_sha } = JSON.parse(raw);
  const ckptBuf = Buffer.from(b64, 'base64');

  const parsed = parseCheckpointBuffer(ckptBuf, 'https://loopback.test/pureseq.pt');
  assert.equal(parsed.payloadSha256, py_sha);
  assert.equal(parsed.weightsFloat32.length, parsed.metadata.total_params);
});

await runCase('Positive 4: Real-time monitor verifies matching runtime hash & cloud-signed HTTP header without alarm', async () => {
  resetCheckpointMonitorDebounceState();
  const { buffer, expectedSha256 } = buildCheckpointContainer([0.5, 1.0, -1.5, 2.0]);
  const parsed = parseCheckpointBuffer(buffer, 'https://loopback.test/signed.pt');

  const server = http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'x-zyntheor-sha256': expectedSha256,
        'content-length': String(buffer.length),
      });
      res.end();
      return;
    }
    res.writeHead(200, { 'x-zyntheor-sha256': expectedSha256 });
    res.end(buffer);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/signed.pt`;
    const resolved = await resolveCloudSignedMetadataHash({
      sourceUri: url,
      inspectRes: { payload_sha256: parsed.payloadSha256, metadata: parsed.metadata },
    });
    assert.equal(resolved.metadataSource, 'cloud_http_signed_header');
    assert.equal(resolved.cloudSignedHash, expectedSha256);

    const emitted: Array<{ role: string; action: string; payload: Record<string, any> }> = [];
    const monitorRes = verifyAndRecordCheckpointIntegrity(
      {
        weightsLoaded: true,
        loadedHash: parsed.payloadSha256,
        cloudSignedHash: resolved.cloudSignedHash,
        cloudComputedHash: resolved.cloudComputedHash,
        sourceUri: resolved.sourceUri,
        metadataSource: resolved.metadataSource,
      },
      {
        appendAudit: (role, action, payload) => {
          emitted.push({ role, action, payload });
          return {
            index: 1,
            timestamp: new Date().toISOString(),
            prev_hash: '0'.repeat(64),
            role,
            action,
            payload_digest: 'a'.repeat(64),
            payload,
            entry_hash: 'b'.repeat(64),
          };
        },
      }
    );

    assert.equal(monitorRes.status, 'VERIFIED');
    assert.equal(monitorRes.mismatch, false);
    assert.equal(monitorRes.failClosed, false);
    assert.equal(monitorRes.auditEventTriggered, false);
    assert.equal(emitted.length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// Negative scenarios
await runCase('Negative 1: Tampered weight payload byte fails SHA-256 verification', () => {
  const weights = [0.1, 0.2, 0.3, 0.4];
  const { buffer } = buildCheckpointContainer(weights, {}, { tamperPayloadByteIndex: 4 });
  assert.throws(
    () => parseCheckpointBuffer(buffer, 'https://cloud.example/tampered-payload.pt'),
    /CORRUPTED_CHECKPOINT: SHA-256 checksum mismatch/
  );
});

await runCase('Negative 2: Tampered metadata.sha256 hash fails verification', () => {
  const weights = [0.5, -0.25, 0.75, 1.25];
  const { buffer, expectedSha256 } = buildCheckpointContainer(weights, {
    sha256: (expected => `${expected.startsWith('0') ? '1' : '0'}${expected.slice(1)}`)(
      crypto
        .createHash('sha256')
        .update(Buffer.from(new Float32Array(weights).buffer))
        .digest('hex')
    ),
  });
  assert.notEqual(buffer.length, 0);
  assert.equal(expectedSha256.length, 64);
  assert.throws(
    () => parseCheckpointBuffer(buffer, 'https://cloud.example/tampered-meta.pt'),
    /CORRUPTED_CHECKPOINT: SHA-256 checksum mismatch/
  );
});

await runCase('Negative 3: Payload truncated / misaligned or parameter count altered fails cleanly', () => {
  const weights = [1.0, 2.0, 3.0, 4.0];
  const { buffer } = buildCheckpointContainer(weights);

  // Drop 1 byte -> unaligned Float32 payload
  const unaligned = buffer.subarray(0, buffer.length - 1);
  assert.throws(
    () => parseCheckpointBuffer(unaligned, 'https://cloud.example/unaligned.pt'),
    /not aligned to 4 bytes/
  );

  // Drop 4 bytes -> parameter count mismatch before SHA check
  const truncatedParams = buffer.subarray(0, buffer.length - 4);
  assert.throws(
    () => parseCheckpointBuffer(truncatedParams, 'https://cloud.example/truncated.pt'),
    /Parameter count mismatch/
  );
});

await runCase('Negative 4: Invalid magic header & truncated container fail cleanly', () => {
  const { buffer } = buildCheckpointContainer([1.0, 2.0]);
  const badMagic = Buffer.from(buffer);
  badMagic.write('INVALID_MAGIC_HDR', 0, 'utf8');
  assert.throws(
    () => parseCheckpointBuffer(badMagic, 'https://cloud.example/bad-magic.pt'),
    /Invalid magic header/
  );

  assert.throws(
    () => parseCheckpointBuffer(Buffer.from('ZYNTHEOR', 'utf8'), 'https://cloud.example/short.pt'),
    /Buffer too short/
  );
});

await runCase('Negative 5: Python parse_checkpoint_container rejects tampered SHA-256 payload', () => {
  const { buffer } = buildCheckpointContainer([0.5, 1.5, -2.5, 3.5], {}, { tamperPayloadByteIndex: 0 });
  const b64 = buffer.toString('base64');
  const pyCheck = `
import sys, base64
sys.path.insert(0, '.')
from qplus_native.cloud_storage import parse_checkpoint_container
raw = base64.b64decode("${b64}")
try:
    parse_checkpoint_container(raw)
    sys.exit(2)
except RuntimeError as exc:
    assert "SHA-256 mismatch" in str(exc), str(exc)
    print("VERIFIED_PYTHON_REJECTED:", exc)
`;
  const out = execFileSync('python3', ['-c', pyCheck], { encoding: 'utf8' });
  assert.match(out, /VERIFIED_PYTHON_REJECTED/);
});

await runCase('Negative 6: Real-time monitor detects hash mismatch vs cloud-signed metadata and triggers security audit event', () => {
  resetCheckpointMonitorDebounceState();
  const loadedHash = crypto.createHash('sha256').update('loaded-weights-v1').digest('hex');
  const cloudSignedHash = crypto.createHash('sha256').update('tampered-cloud-weights-v2').digest('hex');

  const emitted: Array<{ role: string; action: string; payload: Record<string, any> }> = [];
  const res = verifyAndRecordCheckpointIntegrity(
    {
      weightsLoaded: true,
      loadedHash,
      cloudSignedHash,
      sourceUri: 'https://cloud.example/model.pt',
      metadataSource: 'cloud_http_signed_header',
      userId: 'unit-test-user',
      tenantId: 'unit-test-tenant',
    },
    {
      appendAudit: (role, action, payload) => {
        emitted.push({ role, action, payload });
        return {
          index: 42,
          timestamp: new Date().toISOString(),
          prev_hash: '0'.repeat(64),
          role,
          action,
          payload_digest: 'c'.repeat(64),
          payload,
          entry_hash: 'd'.repeat(64),
        };
      },
    }
  );

  assert.equal(res.status, 'MISMATCH');
  assert.equal(res.mismatch, true);
  assert.equal(res.verified, false);
  assert.equal(res.failClosed, true);
  assert.equal(res.auditEventTriggered, true);
  assert.equal(res.auditBlockIndex, 42);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].role, 'GOVERNANCE');
  assert.equal(emitted[0].action, 'CHECKPOINT_HASH_MISMATCH_DETECTED');
  assert.equal(emitted[0].payload.loadedSha256, loadedHash);
  assert.equal(emitted[0].payload.cloudSignedSha256, cloudSignedHash);
  assert.equal(emitted[0].payload.severity, 'CRITICAL');

  // Ensure unloaded weights report NOT_LOADED cleanly without spurious mismatch alerts
  const unloaded = evaluateCheckpointHashAgainstMetadata({
    weightsLoaded: false,
    loadedHash: null,
    cloudSignedHash,
  });
  assert.equal(unloaded.status, 'NOT_LOADED');
  assert.equal(unloaded.mismatch, false);
  assert.equal(unloaded.failClosed, true);
});

console.log('\n------------------------------------------------------');
console.log(`  Passed: ${passed}  Failed: ${failed}`);
console.log('------------------------------------------------------\n');

if (failed > 0) {
  process.exit(1);
}
}

void main();
