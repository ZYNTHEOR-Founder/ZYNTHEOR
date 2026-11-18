/**
 * ZYNTHEOR Batch 27 — End-to-End Sovereignty, Lifecycle, Isolation & Evaluation Test
 *
 * Spawns an ephemeral Express API server + ephemeral loopback cloud checkpoint server:
 * 1. Verifies fail-closed NOT_CONFIGURED health & system status when no cloud checkpoint exists.
 * 2. Verifies SSRF blocking on /api/connectivity/reconnect for IMDS & RFC1918 IPs.
 * 3. Verifies 404 -> NOT_FOUND on /api/connectivity/reconnect.
 * 4. Verifies valid PureSeqLM cloud URL -> READY with executionVerified=true & weightsLoaded=true.
 * 5. Verifies /api/chat/message streaming & cooperative client abort cancellation.
 * 6. Verifies strict cross-tenant isolation across /api/memory/episodic and /api/knowledge/*.
 * 7. Verifies /api/memory/verify-integrity and POST /api/evaluation/batch27 reproducible schema.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
  });
}

function buildTrainedPureSeqBytes() {
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

async function waitForServer(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/health`);
}

async function devLogin(baseUrl, role, tenantId) {
  const roleMap = {
    admin: 'Administrator',
    developer: 'Developer',
    guest: 'User',
    Administrator: 'Administrator',
    Developer: 'Developer',
    User: 'User',
  };
  const uiRole = roleMap[role] || 'User';
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: uiRole,
      tenantId,
      userId: `u_${uiRole.toLowerCase()}_${tenantId}`,
    }),
  });
  const data = await res.json();
  assert.equal(res.status, 200, `login failed for ${uiRole}/${tenantId}: ${JSON.stringify(data)}`);
  assert.ok(data.token);
  return data.token;
}

async function main() {
  const ckptBytes = buildTrainedPureSeqBytes();
  const ckptPort = await getFreePort();
  const apiPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${apiPort}`;

  let servedHeaderSha = okHeaderShaFor(ckptBytes);
  function okHeaderShaFor(buf) {
    const metaLen = buf.readUInt32BE(17);
    const meta = JSON.parse(buf.subarray(21, 21 + metaLen).toString('utf8'));
    return meta.sha256;
  }

  const ckptServer = http.createServer((req, res) => {
    if (req.url === '/redir-imds') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      return res.end();
    }
    if (req.url === '/trained-seq.pt') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(ckptBytes.length),
        'x-zyntheor-sha256': servedHeaderSha,
      });
      if (req.method === 'HEAD') return res.end();
      return res.end(ckptBytes);
    }
    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise((resolve) => ckptServer.listen(ckptPort, '127.0.0.1', resolve));

  const cleanEnv = { ...process.env };
  delete cleanEnv.CHECKPOINT_PRESIGNED_URL;
  delete cleanEnv.S3_BUCKET;
  delete cleanEnv.CHECKPOINT_OBJECT_KEY;
  cleanEnv.PORT = String(apiPort);
  cleanEnv.ZYNTHEOR_API_ONLY = '1';
  cleanEnv.ZYNTHEOR_ENABLE_DEV_LOGIN = 'true';

  const srvProc = spawn('./node_modules/.bin/tsx', ['server.ts', '--port', String(apiPort)], {
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const createdDocIds = [];
  const createdMemKeys = [];
  let tokenTenantA = '';
  let tokenTenantB = '';

  try {
    await waitForServer(baseUrl);
    console.log(`[B27 E2E] Ephemeral API server up at ${baseUrl}`);

    // 1. Fail-closed NOT_CONFIGURED health check
    const h1 = await fetch(`${baseUrl}/api/connectivity/health`);
    assert.equal(h1.status, 503);
    const h1Data = await h1.json();
    assert.equal(h1Data.online, false);
    assert.equal(h1Data.runtimeState, 'NOT_CONFIGURED');
    assert.equal(h1Data.executionVerified, false);

    // 2. SSRF block on /api/connectivity/reconnect (direct IMDS + 302 IMDS redirect)
    const ssrfRes = await fetch(`${baseUrl}/api/connectivity/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presignedUrl: 'http://169.254.169.254/latest/meta-data/' }),
    });
    assert.equal(ssrfRes.status, 503);
    const ssrfData = await ssrfRes.json();
    assert.equal(ssrfData.online, false);
    assert.match(String(ssrfData.reason || ''), /SSRF_BLOCKED|Blocked/i);

    const redirRes = await fetch(`${baseUrl}/api/connectivity/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presignedUrl: `http://127.0.0.1:${ckptPort}/redir-imds` }),
    });
    assert.equal(redirRes.status, 503);
    const redirData = await redirRes.json();
    assert.equal(redirData.online, false);
    assert.match(String(redirData.reason || ''), /SSRF_BLOCKED/i);

    // 3. 404 -> NOT_FOUND on reconnect
    const nfRes = await fetch(`${baseUrl}/api/connectivity/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presignedUrl: `http://127.0.0.1:${ckptPort}/missing.pt` }),
    });
    assert.equal(nfRes.status, 503);
    const nfData = await nfRes.json();
    assert.equal(nfData.runtimeState, 'NOT_FOUND');

    // 4. Valid loopback PureSeqLM -> READY & executionVerified=true
    const okRes = await fetch(`${baseUrl}/api/connectivity/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presignedUrl: `http://127.0.0.1:${ckptPort}/trained-seq.pt` }),
    });
    assert.equal(okRes.status, 200);
    const okData = await okRes.json();
    assert.equal(okData.online, true);
    assert.equal(okData.runtimeState, 'READY');
    assert.equal(okData.executionVerified, true);
    assert.equal(okData.weightsLoaded, true);

    tokenTenantA = await devLogin(baseUrl, 'admin', 'b27_tenant_alpha');
    tokenTenantB = await devLogin(baseUrl, 'developer', 'b27_tenant_beta');

    // 5. Cross-tenant Episodic Memory isolation + integrity check
    const memKey = `b27_e2e_mem_${Date.now()}`;
    createdMemKeys.push(memKey);
    const memCreate = await fetch(`${baseUrl}/api/memory/episodic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenTenantA}`,
      },
      body: JSON.stringify({ key: memKey, value: 'alpha-only-secret', category: 'episodic', ttlSeconds: 300 }),
    });
    assert.equal(memCreate.status, 200);
    const memCreateJson = await memCreate.json();
    assert.equal(memCreateJson.item.tenantId, 'b27_tenant_alpha');

    const memCrossRead = await fetch(`${baseUrl}/api/memory/episodic/${encodeURIComponent(memKey)}`, {
      headers: { Authorization: `Bearer ${tokenTenantB}` },
    });
    assert.equal(memCrossRead.status, 403, 'Tenant B must be blocked from reading Tenant A memory');

    const memIntRes = await fetch(`${baseUrl}/api/memory/verify-integrity`, {
      headers: { Authorization: `Bearer ${tokenTenantA}` },
    });
    assert.equal(memIntRes.status, 200);
    const memIntJson = await memIntRes.json();
    assert.equal(memIntJson.integrity.valid, true);
    assert.ok(memIntJson.integrity.storeSha256.length >= 64);

    // 6. Cross-tenant Knowledge isolation
    const docCreate = await fetch(`${baseUrl}/api/knowledge/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenTenantA}`,
      },
      body: JSON.stringify({
        title: 'Alpha Confidential Doc',
        content: 'UniqueTokenXYZ987 sovereign alpha telemetry secret specification.',
        collection: 'AlphaPrivate',
      }),
    });
    assert.equal(docCreate.status, 200);
    const docJson = await docCreate.json();
    const docId = docJson.document.id;
    createdDocIds.push(docId);

    const docCrossGet = await fetch(`${baseUrl}/api/knowledge/documents/${encodeURIComponent(docId)}`, {
      headers: { Authorization: `Bearer ${tokenTenantB}` },
    });
    assert.equal(docCrossGet.status, 403, 'Tenant B must be blocked from reading Tenant A document');

    const docCrossSearch = await fetch(`${baseUrl}/api/knowledge/retrieve/hybrid`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenTenantB}`,
      },
      body: JSON.stringify({ query: 'UniqueTokenXYZ987', limit: 5 }),
    });
    assert.equal(docCrossSearch.status, 200);
    const searchJson = await docCrossSearch.json();
    const leaked = (searchJson.results || []).some((r) => r.documentId === docId);
    assert.equal(leaked, false, 'Tenant B hybrid RAG must never see Tenant A confidential doc');

    // 7. Streaming chat inference + provenance + cross-tenant chat isolation + mid-stream abort recovery
    const chatSessId = `b27_e2e_session_${Date.now()}`;
    const chatRes = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenTenantA}`,
      },
      body: JSON.stringify({
        sessionId: chatSessId,
        message: 'อธิบาย ZYNTHEOR',
        maxNewTokens: 8,
      }),
    });
    assert.equal(chatRes.status, 200);
    const bodyText = await chatRes.text();
    assert.ok(bodyText.includes('"type":"done"'));
    const lines = bodyText.trim().split('\n').map((l) => JSON.parse(l));
    const doneEvt = lines.find((e) => e.type === 'done');
    assert.ok(doneEvt);
    assert.equal(doneEvt.inferenceOrigin, 'native_model_logits');
    assert.equal(doneEvt.weightsRole, 'learned_sequence_lm');

    // Cross-tenant chat session isolation
    const bSessListRes = await fetch(`${baseUrl}/api/chat/sessions`, {
      headers: { Authorization: `Bearer ${tokenTenantB}` },
    });
    assert.equal(bSessListRes.status, 200);
    const bSessList = await bSessListRes.json();
    assert.equal((bSessList.sessions || []).some((s) => s.id === chatSessId), false, 'Tenant B must not list Tenant A chat session');

    const bChatWrite = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenTenantB}`,
      },
      body: JSON.stringify({ sessionId: chatSessId, message: 'hijack', maxNewTokens: 4 }),
    });
    assert.equal(bChatWrite.status, 403, 'Tenant B must get 403 writing into Tenant A session');

    // Real mid-stream client abort -> runtime recovers cleanly
    const abortCtrl = new AbortController();
    let abortedCleanly = false;
    try {
      const abortRes = await fetch(`${baseUrl}/api/chat/message`, {
        method: 'POST',
        signal: abortCtrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenTenantA}`,
        },
        body: JSON.stringify({
          sessionId: chatSessId,
          message: 'ทดสอบยกเลิกกลาง stream',
          maxNewTokens: 120,
        }),
      });
      const reader = abortRes.body.getReader();
      await reader.read();
      abortCtrl.abort();
      await reader.cancel().catch(() => {});
      abortedCleanly = true;
    } catch (err) {
      if (err?.name === 'AbortError') abortedCleanly = true;
      else throw err;
    }
    assert.equal(abortedCleanly, true, 'Mid-stream abort must complete cleanly');
    const postAbortHealth = await fetch(`${baseUrl}/api/connectivity/health`);
    assert.equal(postAbortHealth.status, 200, 'Bridge must stay healthy after mid-stream client abort');

    // 8. Reproducible Batch 27 Evaluation Endpoint while READY
    const evalRes = await fetch(`${baseUrl}/api/evaluation/batch27`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenTenantA}`,
      },
    });
    assert.equal(evalRes.status, 200);
    const evalJson = await evalRes.json();
    assert.equal(evalJson.success, true);
    assert.equal(evalJson.report.provenance.runtimeState, 'READY');
    assert.equal(evalJson.report.provenance.executionVerified, true);
    assert.equal(evalJson.report.summary.failed, 0);
    assert.equal(evalJson.report.summary.blocked, 0);
    assert.ok(evalJson.report.baselineComparison?.lmV2Baseline, 'Baseline LM v2 comparison should be attached');

    // 9. Honest binary parser capability reporting
    const parserRes = await fetch(`${baseUrl}/api/knowledge/parsers`, {
      headers: { Authorization: `Bearer ${tokenTenantA}` },
    });
    assert.equal(parserRes.status, 200);
    const parserJson = await parserRes.json();
    assert.equal(parserJson.parsers.pdf, false);
    assert.equal(parserJson.parsers.docx, false);
    assert.doesNotMatch(String(parserJson.notes.pdf), /pdf-parse/);

    // 10. Real-time checkpoint hash monitor: positive match & negative mismatch -> security audit event
    const monOkRes = await fetch(`${baseUrl}/api/governance/verify-checkpoint-integrity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenTenantA}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(monOkRes.status, 200);
    const monOkJson = await monOkRes.json();
    assert.equal(monOkJson.status, 'VERIFIED');
    assert.equal(monOkJson.mismatch, false);
    assert.equal(monOkJson.auditEventTriggered, false);
    assert.equal(monOkJson.metadataSource, 'cloud_http_signed_header');

    // Simulate cloud-signed metadata drift -> monitor must detect mismatch and emit GOVERNANCE security audit event
    servedHeaderSha = 'f'.repeat(64);
    const monMismatchRes = await fetch(`${baseUrl}/api/governance/verify-checkpoint-integrity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenTenantA}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(monMismatchRes.status, 409);
    const monMismatchJson = await monMismatchRes.json();
    assert.equal(monMismatchJson.status, 'MISMATCH');
    assert.equal(monMismatchJson.mismatch, true);
    assert.equal(monMismatchJson.failClosed, true);
    assert.equal(monMismatchJson.auditEventTriggered, true);

    const auditFeedRes = await fetch(`${baseUrl}/api/audit?limit=15`, {
      headers: { Authorization: `Bearer ${tokenTenantA}` },
    });
    assert.equal(auditFeedRes.status, 200);
    const auditFeedJson = await auditFeedRes.json();
    const mismatchEvents = (auditFeedJson.records || auditFeedJson.entries || []).filter(
      (r) => r.action === 'CHECKPOINT_HASH_MISMATCH_DETECTED'
    );
    assert.ok(mismatchEvents.length >= 1, 'CHECKPOINT_HASH_MISMATCH_DETECTED must appear in AuditLedger');

    console.log('[B27 E2E] ALL 10 CHECKS PASSED.');
  } finally {
    // Cleanup temporary test items so persistent stores stay clean
    for (const k of createdMemKeys) {
      if (tokenTenantA) {
        await fetch(`${baseUrl}/api/memory/episodic/${encodeURIComponent(k)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenTenantA}` },
        }).catch(() => {});
      }
    }
    for (const d of createdDocIds) {
      if (tokenTenantA) {
        await fetch(`${baseUrl}/api/knowledge/documents/${encodeURIComponent(d)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenTenantA}` },
        }).catch(() => {});
      }
    }
    try {
      if (srvProc.pid) process.kill(-srvProc.pid, 'SIGTERM');
      else srvProc.kill('SIGTERM');
    } catch {}
    await Promise.race([
      new Promise((resolve) => srvProc.once('exit', resolve)),
      new Promise((resolve) => setTimeout(() => {
        try {
          if (srvProc.pid) process.kill(-srvProc.pid, 'SIGKILL');
          else srvProc.kill('SIGKILL');
        } catch {}
        resolve();
      }, 2000)),
    ]);
    try { ckptServer.closeAllConnections?.(); } catch {}
    await new Promise((resolve) => ckptServer.close(resolve));
  }
}

main().catch((err) => {
  console.error('[B27 E2E FAILED]', err);
  process.exit(1);
});
