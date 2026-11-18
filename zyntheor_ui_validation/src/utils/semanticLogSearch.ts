export interface SemanticLogSuggestion {
  originalIdx: number;
  log: string;
  scorePct: number;
  matchedConcepts: string[];
}

interface IntentCluster {
  name: string;
  triggers: string[];
  expansions: Array<{ term: string; weight: number }>;
}

const INTENT_CLUSTERS: IntentCluster[] = [
  {
    name: 'Failure & Error',
    triggers: [
      'error',
      'err',
      'fail',
      'failed',
      'failure',
      'fatal',
      'crash',
      'bug',
      'broken',
      'exception',
      'issue',
      'problem',
      'timeout',
      'reject',
      'rejected',
      'blocked',
      'tamper',
      'tampered',
      'พัง',
      'ผิดพลาด',
      'ล้มเหลว',
      'บั๊ก',
      'ปัญหา',
      'ติดขัด',
    ],
    expansions: [
      { term: 'error', weight: 1.4 },
      { term: 'fail', weight: 1.3 },
      { term: 'failed', weight: 1.3 },
      { term: 'fatal', weight: 1.3 },
      { term: 'exception', weight: 1.2 },
      { term: 'blocked', weight: 1.1 },
      { term: 'rejected', weight: 1.1 },
      { term: 'tampered', weight: 1.1 },
      { term: 'timeout', weight: 1.0 },
      { term: 'debugger', weight: 0.9 },
      { term: 'exitcode', weight: 0.8 },
    ],
  },
  {
    name: 'Auth & Audit',
    triggers: [
      'auth',
      'authentication',
      'login',
      'logout',
      'signin',
      'token',
      'jwt',
      'session',
      'rbac',
      'role',
      'permission',
      'security',
      'audit',
      'hash',
      'sha256',
      'sha-256',
      'unauthorized',
      'forbidden',
      '401',
      '403',
      'สิทธิ์',
      'ยืนยันตัวตน',
      'ความปลอดภัย',
      'ล็อกอิน',
    ],
    expansions: [
      { term: 'auth', weight: 1.4 },
      { term: 'audit', weight: 1.3 },
      { term: 'token', weight: 1.2 },
      { term: 'session', weight: 1.1 },
      { term: 'rbac', weight: 1.1 },
      { term: 'role', weight: 1.0 },
      { term: 'sha', weight: 1.0 },
      { term: '256', weight: 0.9 },
      { term: 'verified', weight: 0.9 },
      { term: 'unauthorized', weight: 1.1 },
      { term: 'forbidden', weight: 1.1 },
    ],
  },
  {
    name: 'Tests & Verification',
    triggers: [
      'test',
      'tester',
      'verify',
      'verified',
      'verification',
      'pass',
      'passed',
      'check',
      'assert',
      'spec',
      'done',
      'success',
      'complete',
      'completed',
      'ทดสอบ',
      'ผ่าน',
      'ตรวจสอบ',
      'สำเร็จ',
    ],
    expansions: [
      { term: 'tester', weight: 1.4 },
      { term: 'test', weight: 1.3 },
      { term: 'verified', weight: 1.3 },
      { term: 'passed', weight: 1.3 },
      { term: 'done', weight: 1.2 },
      { term: 'success', weight: 1.2 },
      { term: 'exitcode', weight: 1.1 },
      { term: 'assert', weight: 1.0 },
    ],
  },
  {
    name: 'Build & Code',
    triggers: [
      'build',
      'compile',
      'code',
      'coder',
      'architect',
      'plan',
      'implement',
      'create',
      'typescript',
      'python',
      'lint',
      'workspace',
      'lru',
      'cache',
      'api',
      'สร้าง',
      'เขียนโค้ด',
      'คอมไพล์',
      'สถาปัตยกรรม',
    ],
    expansions: [
      { term: 'architect', weight: 1.3 },
      { term: 'coder', weight: 1.3 },
      { term: 'init', weight: 1.1 },
      { term: 'step', weight: 1.0 },
      { term: 'build', weight: 1.2 },
      { term: 'compile', weight: 1.2 },
      { term: 'workspace', weight: 1.1 },
      { term: 'lint', weight: 1.0 },
      { term: 'cache', weight: 1.0 },
    ],
  },
  {
    name: 'Performance & Latency',
    triggers: [
      'slow',
      'fast',
      'speed',
      'performance',
      'latency',
      'duration',
      'time',
      'ms',
      'memory',
      'rss',
      'throughput',
      'ช้า',
      'เร็ว',
      'ประสิทธิภาพ',
      'หน่วยความจำ',
    ],
    expansions: [
      { term: 'latency', weight: 1.4 },
      { term: 'duration', weight: 1.3 },
      { term: 'ms', weight: 1.2 },
      { term: 'throughput', weight: 1.2 },
      { term: 'memory', weight: 1.1 },
      { term: 'ttl', weight: 1.0 },
      { term: 'cache', weight: 1.0 },
      { term: 'tokens', weight: 0.9 },
    ],
  },
  {
    name: 'Network & I/O',
    triggers: [
      'network',
      'http',
      'https',
      'fetch',
      'stream',
      'socket',
      'ws',
      'database',
      'db',
      'sql',
      'file',
      'export',
      'save',
      'load',
      'เชื่อมต่อ',
      'ไฟล์',
      'ฐานข้อมูล',
    ],
    expansions: [
      { term: 'http', weight: 1.3 },
      { term: 'fetch', weight: 1.2 },
      { term: 'stream', weight: 1.2 },
      { term: 'api', weight: 1.1 },
      { term: 'socket', weight: 1.1 },
      { term: 'file', weight: 1.1 },
      { term: 'database', weight: 1.1 },
      { term: 'json', weight: 0.9 },
    ],
  },
];

function tokenizeTerms(input: string): string[] {
  const normalized = input
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, ' ')
    .trim();
  if (!normalized) return [];
  const raw = normalized.split(/\s+/).filter((t) => t.length >= 2);
  const terms: string[] = [];
  for (const tok of raw) {
    terms.push(tok);
    // Split hyphenated/underscored parts for sub-token recall
    if (tok.includes('-') || tok.includes('_')) {
      for (const part of tok.split(/[-_]+/)) {
        if (part.length >= 2) terms.push(part);
      }
    }
    // Lightweight char 3-grams for morphological/fuzzy similarity
    if (tok.length >= 4 && tok.length <= 24) {
      for (let i = 0; i <= tok.length - 3; i += 1) {
        terms.push(`~${tok.slice(i, i + 3)}`);
      }
    }
  }
  return terms;
}

function buildQueryVector(query: string): {
  weights: Map<string, number>;
  matchedClusters: IntentCluster[];
  rawWords: string[];
} {
  const weights = new Map<string, number>();
  const matchedClusters: IntentCluster[] = [];
  const lower = query.toLowerCase().trim();
  const rawWords = lower
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  for (const term of tokenizeTerms(lower)) {
    const isGram = term.startsWith('~');
    weights.set(term, (weights.get(term) || 0) + (isGram ? 0.35 : 1.5));
  }

  for (const cluster of INTENT_CLUSTERS) {
    const hit = cluster.triggers.some(
      (trigger) =>
        lower.includes(trigger) ||
        rawWords.some((w) => w === trigger || (w.length >= 3 && trigger.startsWith(w)))
    );
    if (hit) {
      matchedClusters.push(cluster);
    }
  }

  return { weights, matchedClusters, rawWords };
}

export function getSemanticIntentPresets(): Array<{ label: string; query: string }> {
  return [
    { label: 'Failures & Errors', query: 'error failure blocked crash' },
    { label: 'Tests & Pass', query: 'tester verified passed exitCode' },
    { label: 'Auth & Audit', query: 'auth audit sha256 token' },
    { label: 'Build & Code', query: 'architect coder build compile' },
  ];
}

export function rankLogsBySemanticIntent(
  logs: string[],
  query: string,
  minScorePct = 16
): SemanticLogSuggestion[] {
  const trimmed = query.trim();
  if (!trimmed || logs.length === 0) return [];

  const { weights: queryVec, matchedClusters, rawWords } = buildQueryVector(trimmed);
  if (queryVec.size === 0) return [];

  // Build document token maps & document frequencies for TF-IDF weighting
  const docTokensList = logs.map((log) => tokenizeTerms(log));
  const df = new Map<string, number>();
  for (const tokens of docTokensList) {
    const unique = new Set(tokens);
    for (const tok of unique) {
      df.set(tok, (df.get(tok) || 0) + 1);
    }
  }

  const totalDocs = logs.length;
  const idf = (term: string) => Math.log(1 + totalDocs / (1 + (df.get(term) || 0))) + 0.5;

  let queryNormSq = 0;
  const weightedQuery = new Map<string, number>();
  for (const [term, w] of queryVec.entries()) {
    const qw = w * idf(term);
    weightedQuery.set(term, qw);
    queryNormSq += qw * qw;
  }
  const queryNorm = Math.sqrt(queryNormSq);
  if (queryNorm === 0) return [];

  const results: SemanticLogSuggestion[] = [];
  const lowerQuery = trimmed.toLowerCase();

  for (let idx = 0; idx < logs.length; idx += 1) {
    const log = logs[idx];
    const logLower = log.toLowerCase();
    const docTokens = docTokensList[idx];

    const docTf = new Map<string, number>();
    for (const tok of docTokens) {
      docTf.set(tok, (docTf.get(tok) || 0) + 1);
    }

    let dot = 0;
    let docNormSq = 0;
    const matchedTerms = new Set<string>();
    const matchedIntents = new Set<string>();

    for (const [term, tf] of docTf.entries()) {
      const dw = (1 + Math.log(tf)) * idf(term);
      docNormSq += dw * dw;
      const qw = weightedQuery.get(term);
      if (qw) {
        dot += dw * qw;
        if (!term.startsWith('~')) {
          matchedTerms.add(term);
        }
      }
    }

    const docNorm = Math.sqrt(docNormSq);
    const cosine = docNorm > 0 ? dot / (queryNorm * docNorm) : 0;

    // Semantic intent cluster pooling (matches synonym concepts without diluting queryNorm)
    let intentBoost = 0;
    for (const cluster of matchedClusters) {
      let clusterHits = 0;
      let clusterBestWeight = 0;
      for (const exp of cluster.expansions) {
        if (docTf.has(exp.term) || logLower.includes(exp.term)) {
          clusterHits += 1;
          clusterBestWeight = Math.max(clusterBestWeight, exp.weight);
          matchedTerms.add(exp.term);
        }
      }
      if (clusterHits > 0) {
        matchedIntents.add(cluster.name);
        intentBoost += Math.min(0.55, 0.22 * clusterBestWeight + 0.08 * (clusterHits - 1));
      }
    }

    // Direct phrase / word overlap boost
    let phraseBoost = 0;
    if (logLower.includes(lowerQuery)) {
      phraseBoost += 0.35;
    }
    if (rawWords.length > 0) {
      const wordHits = rawWords.filter((w) => logLower.includes(w)).length;
      phraseBoost += (wordHits / rawWords.length) * 0.25;
    }

    const combined = Math.min(1, cosine * 1.15 + intentBoost + phraseBoost);
    const scorePct = Math.round(combined * 100);

    if (scorePct >= minScorePct) {
      const concepts = Array.from(new Set([...Array.from(matchedIntents), ...Array.from(matchedTerms)])).slice(
        0,
        3
      );
      results.push({
        originalIdx: idx,
        log,
        scorePct,
        matchedConcepts: concepts,
      });
    }
  }

  results.sort((a, b) => b.scorePct - a.scorePct || a.originalIdx - b.originalIdx);
  return results;
}
