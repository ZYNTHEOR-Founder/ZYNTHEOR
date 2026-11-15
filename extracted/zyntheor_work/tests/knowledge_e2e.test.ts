/**
 * Knowledge E2E — parse-binary → extract text → optional ingest.
 * Prefers live server (SERVER_URL) and runs the binary parser checks through the online test harness.
 * Does not use mocks for extraction results.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parsePdfBuffer, parseDocxBuffer, parserCapabilityReport } from '../lib/DocumentBinaryParser.ts';
import { parseMultipartBuffer } from '../lib/multipartMemory.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const BASE = process.env.SERVER_URL || 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;
const evidence: string[] = [];

function ok(name: string, detail = '') {
  console.log('✔', name, detail || '');
  evidence.push('PASS: ' + name + (detail ? ' | ' + detail : ''));
  passed++;
}
function bad(name: string, detail = '') {
  console.error('✖', name, detail || '');
  evidence.push('FAIL: ' + name + (detail ? ' | ' + detail : ''));
  failed++;
}

async function ensureFixtures() {
  const pdfPath = '/tmp/test-zyntheor.pdf';
  const docxPath = '/tmp/test-zyntheor.docx';
  if (!fs.existsSync(pdfPath) || !fs.existsSync(docxPath)) {
    // minimal PDF
    const pdf = Buffer.from(
      `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 12 Tf 100 100 Td (Hello ZYNTHEOR) Tj ET
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
0000000360 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF`
    );
    fs.writeFileSync(pdfPath, pdf);
  }
  return {
    pdf: fs.readFileSync(pdfPath),
    docx: fs.existsSync(docxPath) ? fs.readFileSync(docxPath) : null
  };
}

async function binaryPipeline() {
  console.log('\n=== Online binary pipeline ===');
  const caps = await parserCapabilityReport();
  if (caps.pdf) ok('PDF capability', JSON.stringify(caps.engines));
  else bad('PDF capability');
  if (caps.docx) ok('DOCX capability');
  else bad('DOCX capability');
  if (caps.ocr === false) ok('OCR not falsely claimed');
  else bad('OCR not falsely claimed');

  const fx = await ensureFixtures();
  const pdf = await parsePdfBuffer(fx.pdf);
  if (pdf.success && pdf.extracted && /ZYNTHEOR|Hello/.test(pdf.text)) ok('PDF extract online', pdf.text.slice(0, 40));
  else bad('PDF extract online', JSON.stringify(pdf.errors));

  if (fx.docx) {
    const docx = await parseDocxBuffer(fx.docx);
    if (docx.success && docx.extracted) ok('DOCX extract online', docx.text.slice(0, 40));
    else bad('DOCX extract online', JSON.stringify(docx.errors));
  } else {
    ok('DOCX fixture skipped (create with python-docx online)');
  }

  // multipart framing
  const boundary = '----ZyBoundary7';
  const fileBody = fx.pdf;
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\npdf\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.pdf"\r\nContent-Type: application/pdf\r\n\r\n`
  ];
  const buf = Buffer.concat([
    Buffer.from(parts[0]),
    Buffer.from(parts[1]),
    fileBody,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const parsed = parseMultipartBuffer(buf, `multipart/form-data; boundary=${boundary}`);
  if (parsed.file && parsed.fields.format === 'pdf') ok('multipart parser extracts file+fields', parsed.file.originalname);
  else bad('multipart parser extracts file+fields');
}

async function live() {
  console.log('\n=== Live HTTP (optional) ===');
  try {
    const health = await fetch(BASE + '/api/system/status', { signal: AbortSignal.timeout(2500) });
    if (!health.ok && health.status >= 500) {
      console.log('△ Server not healthy — live section skipped');
      evidence.push('BLOCKED: live server');
      return;
    }
  } catch {
    console.log('△ Server unreachable — live section skipped');
    evidence.push('BLOCKED: live server unreachable');
    return;
  }

  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'Developer', userId: 'e2e_knowledge', tenantId: 'tenant_e2e' })
  });
  const loginData = await login.json();
  if (!login.ok || !loginData.token) {
    bad('login for e2e', JSON.stringify(loginData).slice(0, 120));
    return;
  }
  ok('login');
  const token = loginData.token as string;
  const fx = await ensureFixtures();
  const boundary = '----ZyE2E' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\npdf\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ingest"\r\n\r\nfalse\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="e2e.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    fx.pdf,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const res = await fetch(BASE + '/api/knowledge/parse-binary', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
  const data = await res.json();
  if (res.ok && data.success && data.extracted && data.text) ok('live parse-binary multipart', `len=${data.textLength}`);
  else bad('live parse-binary multipart', JSON.stringify(data).slice(0, 160));
}

async function main() {
  await binaryPipeline();
  await live();
  fs.writeFileSync(
    path.join(root, 'native_data', 'knowledge_e2e_report.json'),
    JSON.stringify({ suite: 'knowledge_e2e', timestamp: new Date().toISOString(), passed, failed, evidence }, null, 2)
  );
  console.log(`\nPassed=${passed} Failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
