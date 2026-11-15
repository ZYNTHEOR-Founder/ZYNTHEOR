/**
 * Live HTTP Knowledge acceptance test:
 * - PDF/DOCX multipart parsing via /api/knowledge/parse-binary
 * - Ingest -> Retrieve -> Grounded citation verification via live HTTP endpoints
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const BASE = process.env.SERVER_URL || 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;
const evidence = [];

function ok(name, detail = '') {
  console.log('✔', name, detail || '');
  evidence.push('PASS: ' + name + (detail ? ' | ' + detail : ''));
  passed++;
}

function bad(name, detail = '') {
  console.error('✖', name, detail || '');
  evidence.push('FAIL: ' + name + (detail ? ' | ' + detail : ''));
  failed++;
}

async function login(role = 'Developer', userId = 'live_tester', tenantId = 'tenant_live') {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, userId, tenantId })
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error('Login failed: ' + JSON.stringify(data));
  }
  return data.token;
}

async function run() {
  console.log('\n=== ZYNTHEOR LIVE HTTP KNOWLEDGE ACCEPTANCE ===');

  // 1. Health check
  try {
    const health = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(3000) });
    const hData = await health.json();
    if (health.ok && hData.status === 'healthy') {
      ok('Health check /api/health', `uptime=${Math.round(hData.uptime)}s apiOnly=${hData.apiOnly}`);
    } else {
      bad('Health check /api/health', JSON.stringify(hData));
    }
  } catch (err) {
    bad('Health check /api/health', String(err.message || err));
    process.exit(1);
  }

  // 2. Auth login
  let token;
  try {
    token = await login('Developer', 'knowledge_live_dev', 'tenant_primary');
    ok('Developer login token issued');
  } catch (err) {
    bad('Developer login', err.message);
    process.exit(1);
  }

  // 3. PDF/DOCX multipart parsing via /api/knowledge/parse-binary
  try {
    const pdfContent = Buffer.from(
      `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 52 >>stream
BT /F1 12 Tf 100 100 Td (ZYNTHEOR SOVEREIGN AI SYSTEM) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000368 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
449
%%EOF`
    );

    const boundary = '----ZyntheorLive' + Date.now();
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\npdf\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ingest"\r\n\r\nfalse\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sovereign_spec.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdfContent,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const res = await fetch(BASE + '/api/knowledge/parse-binary', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });
    const parsed = await res.json();
    if (res.ok && parsed.success && parsed.extracted && parsed.text.includes('ZYNTHEOR')) {
      ok('PDF multipart live parse', `extracted ${parsed.textLength} chars: "${parsed.text.slice(0, 32)}..."`);
    } else {
      bad('PDF multipart live parse', JSON.stringify(parsed));
    }
  } catch (err) {
    bad('PDF multipart live parse', err.message);
  }

  // 4. Ingest -> Retrieve -> Grounded Citation
  try {
    const uniqueToken = 'ZYN_SOVEREIGN_TOKEN_' + crypto.randomBytes(6).toString('hex');
    const docTitle = 'Sovereign Architecture Manual ' + uniqueToken;
    const docContent = `ZYNTHEOR Vivid Intelligence Specification. Key phrase: ${uniqueToken}. Audit integrity is mathematically anchored using rolling SHA-256 hash chains. Multi-layer memory shards maintain long-term persistence without reliance on third-party cloud engines.`;

    // 4a. Ingest
    const ingestRes = await fetch(BASE + '/api/knowledge/documents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: docTitle,
        content: docContent,
        collection: 'live_acceptance',
        tags: ['sovereign', 'live_http', uniqueToken],
        provenance: 'LIVE_ACCEPTANCE_TEST'
      })
    });
    const ingestData = await ingestRes.json();
    if (!ingestRes.ok || !ingestData.success || !ingestData.document?.id) {
      throw new Error('Document ingest failed: ' + JSON.stringify(ingestData));
    }
    const createdDocId = ingestData.document.id;
    ok('Document ingest via HTTP', `id=${createdDocId}`);

    // 4b. Retrieve (Hybrid search)
    const retrieveRes = await fetch(BASE + '/api/knowledge/retrieve/hybrid', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: uniqueToken,
        topK: 5
      })
    });
    const retrieveData = await retrieveRes.json();
    if (!retrieveRes.ok || !retrieveData.success || !Array.isArray(retrieveData.results)) {
      throw new Error('Document retrieve failed: ' + JSON.stringify(retrieveData));
    }

    // 4c. Verify grounded citation
    const match = retrieveData.results.find((r) => r.documentId === createdDocId || (r.text && r.text.includes(uniqueToken)));
    if (match && (match.documentId === createdDocId || match.text.includes(uniqueToken))) {
      ok('Grounded citation verified', `matched docId=${match.documentId || createdDocId} score=${match.score || match.rrfScore}`);
    } else {
      bad('Grounded citation verified', `token ${uniqueToken} not found in results: ${JSON.stringify(retrieveData.results)}`);
    }

    // Clean up test document
    await fetch(BASE + `/api/knowledge/documents/${createdDocId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    bad('Ingest -> Retrieve -> Citation', err.message);
  }

  console.log('\n======================================================');
  console.log(`  LIVE KNOWLEDGE RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  const report = {
    suite: 'knowledge-live-http',
    timestamp: new Date().toISOString(),
    passed,
    failed,
    evidence
  };
  fs.writeFileSync(
    path.join(root, 'native_data', 'knowledge_live_http_report.json'),
    JSON.stringify(report, null, 2)
  );

  process.exit(failed > 0 ? 1 : 0);
}

run();
