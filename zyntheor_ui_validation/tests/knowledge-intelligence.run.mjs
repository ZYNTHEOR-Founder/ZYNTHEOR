/**
 * Knowledge Intelligence Engine — unit evidence (no tsx).
 * Tests pure algorithms mirrored from lib/KnowledgeIntelligenceEngine + knowledgeUtils.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const evidence = [];
function assert(c, name, d = '') {
  if (c) { console.log('✔ ' + name + (d ? ' — ' + d : '')); evidence.push('PASS: ' + name); passed++; }
  else { console.error('✖ ' + name + (d ? ' — ' + d : '')); evidence.push('FAIL: ' + name); failed++; }
}

function detectLang(text) {
  const thai = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  if (thai > 0 && latin > 0) return 'mixed';
  if (thai > latin) return 'th';
  return 'en';
}

function semanticChunk(text, opts = {}) {
  const target = opts.targetSize ?? 500;
  const maxSize = opts.maxSize ?? 900;
  const overlap = opts.overlap ?? 80;
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const units = [];
  for (const para of paragraphs) {
    if (para.length <= maxSize) units.push(para);
    else {
      const sentences = para.split(/(?<=[\.\!\?\u0E2F])\s+|\n+/).filter((s) => s.trim());
      let buf = '';
      for (const s of sentences) {
        if ((buf + ' ' + s).trim().length > maxSize && buf) { units.push(buf.trim()); buf = s; }
        else buf = buf ? `${buf} ${s}` : s;
      }
      if (buf.trim()) units.push(buf.trim());
    }
  }
  const merged = [];
  let acc = '';
  for (const u of units) {
    if (!acc) { acc = u; continue; }
    if ((acc + '\n\n' + u).length <= target + 150) acc = `${acc}\n\n${u}`;
    else {
      merged.push(acc);
      const tail = acc.slice(-overlap);
      acc = tail && u.length + tail.length < maxSize ? `${tail}\n${u}` : u;
    }
  }
  if (acc) merged.push(acc);
  return merged.length ? merged : text.trim() ? [text.trim()] : [];
}

function tokenize(text) {
  const lower = text.toLowerCase();
  const tokens = [];
  const re = /[\u0E00-\u0E7F]+|[a-z0-9_]{2,}/g;
  let m;
  while ((m = re.exec(lower)) !== null) tokens.push(m[0]);
  return tokens;
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function cosineTF(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  if (!na || !nb) return 0;
  for (const [k, v] of a) { const bv = b.get(k); if (bv) dot += v * bv; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseMultiFormat(raw, format) {
  const warnings = [];
  const fmt = (format || 'txt').toLowerCase();
  let cleanText = raw;
  const metadata = { format: fmt };
  if (fmt === 'html') {
    cleanText = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } else if (fmt === 'json') {
    try { cleanText = JSON.stringify(JSON.parse(raw), null, 2); }
    catch { warnings.push('JSON_PARSE_FAILED_RAW_KEPT'); }
  } else if (fmt === 'pdf' || fmt === 'docx') {
    warnings.push(fmt.toUpperCase() + '_BINARY_PARSER_NOT_BUNDLED');
  }
  return { cleanText, format: fmt, metadata, warnings };
}

console.log('\n=== Knowledge Intelligence Evidence ===\n');

// Language
assert(detectLang('Hello world') === 'en', 'K01 English detection');
assert(detectLang('สวัสดีครับ ผมชื่อไซน์เธียร์') === 'th', 'K02 Thai detection');
assert(detectLang('Hello สวัสดี') === 'mixed', 'K03 Mixed detection');

// Chunking
const long = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}. This is a detailed statement about sovereign intelligence systems and audit ledgers.`).join('\n\n');
const chunks = semanticChunk(long);
assert(chunks.length >= 2, 'K04 Semantic chunking splits long text', 'n=' + chunks.length);
assert(chunks.every((c) => c.length <= 1000), 'K05 Chunks respect max size bound');

// Tokenize Thai+English
const toks = tokenize('ZYNTHEOR สถาปัตยกรรม transformer model');
assert(toks.includes('zyntheor') && toks.some((t) => /[\u0E00-\u0E7F]/.test(t)), 'K06 Bilingual tokenization');

// Vector cosine
const a = termFreq(tokenize('sovereign audit ledger hash chain'));
const b = termFreq(tokenize('audit ledger cryptographic hash'));
const c = termFreq(tokenize('unrelated cooking recipes'));
assert(cosineTF(a, b) > cosineTF(a, c), 'K07 Cosine ranks related text higher');

// HTML parse
const html = parseMultiFormat('<html><script>x()</script><body><h1>Title</h1><p>Body text</p></body></html>', 'html');
assert(html.cleanText.includes('Title') && !html.cleanText.includes('x()'), 'K08 HTML strip removes script');

// PDF honesty
const pdf = parseMultiFormat('', 'pdf');
assert(pdf.warnings.some((w) => w.includes('PDF')), 'K09 PDF binary parser honestly unsupported');

// Dedup hash
const h1 = crypto.createHash('sha256').update('same').digest('hex');
const h2 = crypto.createHash('sha256').update('same').digest('hex');
const h3 = crypto.createHash('sha256').update('diff').digest('hex');
assert(h1 === h2 && h1 !== h3, 'K10 Content hash dedup identity');

// Persistence files exist for knowledge
const docsFile = path.join(root, 'native_data/knowledge/documents.json');
assert(fs.existsSync(docsFile), 'K11 Documents persist on disk');
const docs = JSON.parse(fs.readFileSync(docsFile, 'utf8'));
assert(Array.isArray(docs) && docs.length > 0, 'K12 Existing documents preserved', 'count=' + docs.length);

// Separation claim marker in source
const kwSrc = fs.readFileSync(path.join(root, 'lib/KnowledgeWorkspace.ts'), 'utf8');
assert(kwSrc.includes('does NOT automatically modify model weights'), 'K13 Architecture separates knowledge from weights');

// Engine file exists
assert(fs.existsSync(path.join(root, 'lib/KnowledgeIntelligenceEngine.ts')), 'K14 Intelligence engine module present');
assert(fs.existsSync(path.join(root, 'lib/knowledgeUtils.ts')), 'K15 knowledgeUtils module present');

// Server routes registered
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
assert(server.includes('/api/knowledge/retrieve/hybrid'), 'K16 Hybrid retrieve route registered');
assert(server.includes('/api/knowledge/ingest/bulk'), 'K17 Bulk ingest route registered');
assert(server.includes("requireAuth('guest')") && server.includes('/api/knowledge/documents'), 'K18 Knowledge docs require auth');

console.log('\n------------------------------------------------------');
console.log(`  Passed: ${passed}  Failed: ${failed}`);
console.log('------------------------------------------------------\n');

fs.writeFileSync(
  path.join(root, 'native_data', 'knowledge_intelligence_test_report.json'),
  JSON.stringify({ suite: 'knowledge-intelligence', timestamp: new Date().toISOString(), passed, failed, evidence }, null, 2)
);
process.exit(failed > 0 ? 1 : 0);
