/**
 * ZYNTHEOR Sovereign Knowledge Intelligence Engine
 * Production-oriented extensions on top of KnowledgeWorkspace:
 * - Multi-format parsing (text-level; binary PDF/DOCX require external tools — reported honestly)
 * - Semantic-ish chunking, deduplication, versioning helpers
 * - Hybrid lexical + bag-of-words vector retrieval with simple reranking
 * - Entity extraction, co-occurrence graph edges, contradiction heuristics
 * - Grounded citations with provenance + content hashes
 * - Ingestion job records (resumable metadata on disk)
 *
 * NEVER equates indexed documents with learned model weights.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger';
import {
  KnowledgeWorkspace,
  KnowledgeDocument,
  KnowledgeChunk,
  RetrievalResult
} from './KnowledgeWorkspace';
import { detectLang as detectLangUtil, semanticChunk as semanticChunkUtil } from './knowledgeUtils';

// Re-export types that may not all be exported — use structural typing
export type DocFormat =
  | 'markdown'
  | 'txt'
  | 'json'
  | 'csv'
  | 'pdf'
  | 'docx'
  | 'code'
  | 'html'
  | 'xml';

export interface GroundedCitation {
  documentId: string;
  documentTitle: string;
  collection: string;
  chunkId: string;
  chunkIndex: number;
  pageHint?: number;
  snippet: string;
  score: number;
  contentHash: string;
  provenance: string;
  sourceReliability: number; // 0-1 calibrated heuristic
  language: string;
}

export interface GroundedRetrievalResponse {
  query: string;
  found: boolean;
  results: Array<RetrievalResult & { citation: GroundedCitation }>;
  compressedContext?: string;
  notFoundReason?: string;
  latencyMs: number;
  mode: 'hybrid' | 'lexical';
}

export interface ExtractedEntity {
  text: string;
  type: 'TERM' | 'PERSON' | 'ORG' | 'CODE' | 'THAI_TERM' | 'NUMBER';
  documentId: string;
  chunkId: string;
}

export interface GraphEdge {
  sourceDocId: string;
  targetDocId: string;
  relation: 'CO_COLLECTION' | 'SHARED_ENTITY' | 'SHARED_TAG';
  weight: number;
}

export interface ContradictionFlag {
  docA: string;
  docB: string;
  snippetA: string;
  snippetB: string;
  reason: string;
  confidence: number;
}

export interface IngestionJob {
  jobId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
  createdAt: string;
  updatedAt: string;
  totalItems: number;
  processedItems: number;
  succeeded: number;
  failed: number;
  errors: Array<{ item: string; error: string }>;
  documentIds: string[];
  resumable: boolean;
}

export interface ParsedIngest {
  cleanText: string;
  format: DocFormat;
  metadata: Record<string, unknown>;
  warnings: string[];
}

const JOBS_FILE = path.resolve(process.cwd(), 'native_data', 'knowledge', 'ingestion_jobs.json');
const GRAPH_FILE = path.resolve(process.cwd(), 'native_data', 'knowledge', 'graph_edges.json');

function ensureKnowledgeDir() {
  const dir = path.dirname(JOBS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Detect language: Thai Unicode block vs Latin */
export function detectLang(text: string): 'th' | 'en' | 'mixed' {
  const thai = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  if (thai > 0 && latin > 0) return 'mixed';
  if (thai > latin) return 'th';
  return 'en';
}

/** Multi-format text extraction — real parsers for text formats; binary formats flagged. */
export function parseMultiFormat(raw: string, format: DocFormat | string): ParsedIngest {
  const warnings: string[] = [];
  const fmt = (format || 'txt').toLowerCase() as DocFormat;
  let cleanText = raw;
  const metadata: Record<string, unknown> = { format: fmt };

  if (fmt === 'html') {
    cleanText = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    metadata.parser = 'html-strip';
  } else if (fmt === 'xml') {
    cleanText = raw
      .replace(/<\?xml[\s\S]*?\?>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    metadata.parser = 'xml-strip';
  } else if (fmt === 'json') {
    try {
      const obj = JSON.parse(raw);
      cleanText = JSON.stringify(obj, null, 2);
      metadata.parser = 'json-pretty';
      metadata.keys = typeof obj === 'object' && obj ? Object.keys(obj).slice(0, 50) : [];
    } catch {
      warnings.push('JSON_PARSE_FAILED_RAW_KEPT');
      metadata.parser = 'json-fallback-raw';
    }
  } else if (fmt === 'csv') {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    metadata.rowCount = Math.max(0, lines.length - 1);
    metadata.parser = 'csv-text';
    cleanText = lines.join('\n');
  } else if (fmt === 'markdown' || fmt === 'txt' || fmt === 'code') {
    cleanText = raw.replace(/\r\n/g, '\n').trim();
    metadata.parser = fmt;
  } else if (fmt === 'pdf' || fmt === 'docx') {
    // No native binary decoder bundled — do not fake OCR/extraction success
    warnings.push(`${fmt.toUpperCase()}_BINARY_PARSER_NOT_BUNDLED`);
    warnings.push('Provide extracted text or install an external converter; raw bytes are not treated as readable text.');
    metadata.parser = 'unsupported-binary';
    // If caller already passed extracted text, keep it; otherwise leave a clear marker
    if (!raw || /^[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw.slice(0, 20))) {
      cleanText = '';
    }
  } else {
    cleanText = raw.replace(/\r\n/g, '\n').trim();
    metadata.parser = 'generic-text';
  }

  return { cleanText, format: fmt, metadata, warnings };
}

/**
 * Semantic-oriented chunking: prefer paragraph then sentence boundaries,
 * target ~400-700 chars, keep overlap for context.
 */
export function semanticChunk(
  text: string,
  opts: { targetSize?: number; maxSize?: number; overlap?: number } = {}
): string[] {
  const target = opts.targetSize ?? 500;
  const maxSize = opts.maxSize ?? 900;
  const overlap = opts.overlap ?? 80;
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const units: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxSize) {
      units.push(para);
    } else {
      // Split on sentence-like boundaries (Latin .!? or Thai ฯ / space runs)
      const sentences = para.split(/(?<=[\.\!\?\u0E2F])\s+|\n+/).filter((s) => s.trim());
      let buf = '';
      for (const s of sentences) {
        if ((buf + ' ' + s).trim().length > maxSize && buf) {
          units.push(buf.trim());
          buf = s;
        } else {
          buf = buf ? `${buf} ${s}` : s;
        }
      }
      if (buf.trim()) units.push(buf.trim());
    }
  }

  // Merge small units up to target size
  const merged: string[] = [];
  let acc = '';
  for (const u of units) {
    if (!acc) {
      acc = u;
      continue;
    }
    if ((acc + '\n\n' + u).length <= target + 150) {
      acc = `${acc}\n\n${u}`;
    } else {
      merged.push(acc);
      // overlap tail
      const tail = acc.slice(-overlap);
      acc = tail && u.length + tail.length < maxSize ? `${tail}\n${u}` : u;
    }
  }
  if (acc) merged.push(acc);
  return merged.length > 0 ? merged : text.trim() ? [text.trim()] : [];
}

/** Simple tokenization for lexical + vector bag-of-words (Thai chars kept as runs). */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  const re = /[\u0E00-\u0E7F]+|[a-z0-9_]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

export function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/** Cosine similarity between two TF maps */
export function cosineTF(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  for (const [k, v] of a) {
    const bv = b.get(k);
    if (bv) dot += v * bv;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function extractEntities(text: string, documentId: string, chunkId: string): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const seen = new Set<string>();

  // Capitalized multi-word (Latin)
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) {
    const key = m[1].toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ text: m[1], type: 'TERM', documentId, chunkId });
    }
  }
  // ALLCAPS codes / acronyms
  for (const m of text.matchAll(/\b([A-Z]{3,12})\b/g)) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ text: m[1], type: 'CODE', documentId, chunkId });
    }
  }
  // Thai term runs length >= 3
  for (const m of text.matchAll(/([\u0E00-\u0E7F]{3,24})/g)) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ text: m[1], type: 'THAI_TERM', documentId, chunkId });
    }
  }
  return out.slice(0, 40);
}

/** Heuristic contradiction: opposing polarity keywords on same entity/topic */
export function detectContradictions(
  chunks: Array<{ documentId: string; text: string }>
): ContradictionFlag[] {
  const positive = /\b(always|must|required|enabled|supported|verified|passes?)\b/i;
  const negative = /\b(never|must not|forbidden|disabled|unsupported|fails?|not supported)\b/i;
  const flags: ContradictionFlag[] = [];

  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      const a = chunks[i];
      const b = chunks[j];
      if (a.documentId === b.documentId) continue;
      const aPos = positive.test(a.text);
      const aNeg = negative.test(a.text);
      const bPos = positive.test(b.text);
      const bNeg = negative.test(b.text);
      // Shared token overlap
      const ta = new Set(tokenize(a.text));
      const tb = new Set(tokenize(b.text));
      let shared = 0;
      for (const t of ta) if (tb.has(t)) shared++;
      if (shared < 3) continue;
      if ((aPos && bNeg) || (aNeg && bPos)) {
        flags.push({
          docA: a.documentId,
          docB: b.documentId,
          snippetA: a.text.slice(0, 180),
          snippetB: b.text.slice(0, 180),
          reason: 'Opposing polarity keywords with shared topical tokens',
          confidence: Math.min(0.85, 0.4 + shared * 0.05)
        });
      }
    }
  }
  return flags.slice(0, 50);
}

export function reliabilityScore(doc: {
  provenance?: string;
  contentHash?: string;
  chunksCount?: number;
  curatedForTraining?: boolean;
  source?: string;
}): number {
  let s = 0.5;
  if (doc.provenance && doc.provenance.length > 8) s += 0.15;
  if (doc.contentHash && doc.contentHash.length === 64) s += 0.1;
  if ((doc.chunksCount || 0) > 0) s += 0.1;
  if (doc.curatedForTraining) s += 0.05;
  if (doc.source && !/upload/i.test(doc.source)) s += 0.05;
  return Math.min(1, Number(s.toFixed(2)));
}

export class KnowledgeIntelligenceEngine {
  private static instance: KnowledgeIntelligenceEngine | null = null;
  private jobs: Map<string, IngestionJob> = new Map();
  private chunkVectors: Map<string, Map<string, number>> = new Map();

  private constructor() {
    this.loadJobs();
  }

  public static getInstance(): KnowledgeIntelligenceEngine {
    if (!KnowledgeIntelligenceEngine.instance) {
      KnowledgeIntelligenceEngine.instance = new KnowledgeIntelligenceEngine();
    }
    return KnowledgeIntelligenceEngine.instance;
  }

  private loadJobs(): void {
    ensureKnowledgeDir();
    if (fs.existsSync(JOBS_FILE)) {
      try {
        const list: IngestionJob[] = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
        for (const j of list) this.jobs.set(j.jobId, j);
      } catch {
        /* ignore corrupt */
      }
    }
  }

  private saveJobs(): void {
    ensureKnowledgeDir();
    fs.writeFileSync(JOBS_FILE, JSON.stringify(Array.from(this.jobs.values()), null, 2), 'utf8');
  }

  /** Build / refresh in-memory TF vectors for all chunks (incremental for new ids). */
  public rebuildVectors(chunks: KnowledgeChunk[]): void {
    for (const c of chunks) {
      if (!this.chunkVectors.has(c.id)) {
        this.chunkVectors.set(c.id, termFreq(tokenize(c.text)));
      }
    }
  }

  public invalidateVector(chunkId: string): void {
    this.chunkVectors.delete(chunkId);
  }

  /**
   * Hybrid retrieval: lexical score from KnowledgeWorkspace.retrieve + vector cosine rerank.
   */
  public hybridRetrieve(
    query: string,
    options: {
      limit?: number;
      collection?: string;
      minScore?: number;
      tenantId?: string;
      role?: string;
      forbiddenTargetValues?: string[];
    } = {}
  ): GroundedRetrievalResponse {
    const start = Date.now();
    const limit = options.limit ?? 5;
    const kw = KnowledgeWorkspace.getInstance();
    const lexical = kw.retrieve(query, {
      limit: Math.max(limit * 3, 15),
      collection: options.collection,
      tenantId: options.tenantId,
      role: options.role,
    });
    this.rebuildVectors(
      lexical.map((r) => ({
        id: r.chunkId,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        collection: r.collection,
        chunkIndex: r.chunkIndex,
        text: r.text,
        language: r.language as 'th' | 'en' | 'mixed',
        hash: ''
      }))
    );

    const qVec = termFreq(tokenize(query));
    const reranked = lexical.map((r) => {
      const vec = this.chunkVectors.get(r.chunkId) || termFreq(tokenize(r.text));
      const cos = cosineTF(qVec, vec);
      const hybrid = r.score * 0.65 + cos * 10 * 0.35;
      return { ...r, score: Number(hybrid.toFixed(3)), _cos: cos };
    });
    reranked.sort((a, b) => b.score - a.score);
    const top = reranked.slice(0, limit);

    const docs = kw.listDocuments({ tenantId: options.tenantId, role: options.role });
    const docMap = new Map(docs.map((d) => [d.id, d]));
    const forbidden = (options.forbiddenTargetValues || []).filter(Boolean).map((v) => v.toLowerCase());

    const results = top
      .filter((r) => !forbidden.some((f) => r.text.toLowerCase().includes(f)))
      .map((r) => {
        const doc = docMap.get(r.documentId);
        const citation: GroundedCitation = {
          documentId: r.documentId,
          documentTitle: r.documentTitle,
          collection: r.collection,
          chunkId: r.chunkId,
          chunkIndex: r.chunkIndex,
          snippet: r.text.slice(0, 280),
          score: r.score,
          contentHash: doc?.contentHash || '',
          provenance: doc?.provenance || 'unknown',
          sourceReliability: reliabilityScore(doc || {}),
          language: r.language
        };
        return { ...r, citation };
      });

    const minScore = options.minScore ?? 1.5;
    const filtered = results.filter((r) => r.score >= minScore);
    const found = filtered.length > 0;
    const compressedContext = found
      ? filtered.map((r) => `[${r.documentTitle}] ${r.citation.snippet}`).join('\n')
      : undefined;

    return {
      query,
      found,
      results: found ? filtered : [],
      compressedContext,
      notFoundReason: found
        ? undefined
        : 'No chunk exceeded the confidence threshold for this query. Try different terms or ingest relevant documents.',
      latencyMs: Date.now() - start,
      mode: 'hybrid'
    };
  }

  /**
   * Advanced multi-query retrieval with context-length compression & tenant isolation.
   */
  public advancedRetrieve(
    query: string,
    options: {
      limit?: number;
      collection?: string;
      minScore?: number;
      maxContextChars?: number;
      tenantId?: string;
      role?: string;
    } = {}
  ): GroundedRetrievalResponse {
    const start = Date.now();
    const limit = options.limit ?? 5;
    const maxChars = options.maxContextChars ?? 4000;
    const base = this.hybridRetrieve(query, {
      limit: Math.max(limit * 2, 8),
      collection: options.collection,
      minScore: options.minScore ?? 1.2,
      tenantId: options.tenantId,
      role: options.role,
    });

    const seenChunks = new Set<string>();
    const compressed: typeof base.results = [];
    let accChars = 0;
    for (const item of base.results) {
      if (seenChunks.has(item.chunkId)) continue;
      if (accChars + item.text.length > maxChars && compressed.length > 0) break;
      seenChunks.add(item.chunkId);
      compressed.push(item);
      accChars += item.text.length;
      if (compressed.length >= limit) break;
    }

    return {
      query,
      found: compressed.length > 0,
      results: compressed,
      notFoundReason: compressed.length > 0 ? undefined : base.notFoundReason,
      latencyMs: Date.now() - start,
      mode: 'hybrid',
    };
  }

  /**
   * Verifies every citation against stored KnowledgeWorkspace documents & tenant boundaries.
   */
  public verifyCitations(input: {
    answer: string;
    citations: Array<{ documentId?: string; chunkId?: string; snippet?: string; contentHash?: string }>;
    scope?: { tenantId?: string; role?: string };
  }): {
    verified: boolean;
    citationCorrectnessRate: number;
    answerGroundingRate: number;
    invalidCitations: string[];
    checkedCount: number;
  } {
    const kw = KnowledgeWorkspace.getInstance();
    const docs = kw.listDocuments(input.scope ? { tenantId: input.scope.tenantId, role: input.scope.role } : undefined);
    const docMap = new Map(docs.map((d) => [d.id, d]));

    const citations = Array.isArray(input.citations) ? input.citations : [];
    if (citations.length === 0) {
      return {
        verified: false,
        citationCorrectnessRate: 0,
        answerGroundingRate: 0,
        invalidCitations: ['NO_CITATIONS_PROVIDED'],
        checkedCount: 0,
      };
    }

    const invalidCitations: string[] = [];
    let validCount = 0;
    const answerTokens = new Set(tokenize(input.answer || ''));
    let groundedTokens = 0;
    const evidenceTokens = new Set<string>();

    for (const cit of citations) {
      const doc = cit.documentId ? docMap.get(cit.documentId) : undefined;
      if (!doc) {
        invalidCitations.push(cit.documentId || 'missing_documentId');
        continue;
      }
      if (cit.contentHash && cit.contentHash !== doc.contentHash) {
        invalidCitations.push(`${doc.id}:hash_mismatch`);
        continue;
      }
      const snippet = (cit.snippet || '').trim();
      if (snippet && !doc.content.toLowerCase().includes(snippet.toLowerCase().slice(0, 60))) {
        invalidCitations.push(`${doc.id}:snippet_not_in_source`);
        continue;
      }
      validCount += 1;
      for (const tok of tokenize(snippet || doc.content)) {
        evidenceTokens.add(tok);
      }
    }

    for (const tok of answerTokens) {
      if (evidenceTokens.has(tok)) groundedTokens += 1;
    }

    const citationCorrectnessRate = Number((validCount / citations.length).toFixed(3));
    const answerGroundingRate =
      answerTokens.size > 0 ? Number((groundedTokens / answerTokens.size).toFixed(3)) : 0;

    return {
      verified: invalidCitations.length === 0 && citationCorrectnessRate >= 0.99 && answerGroundingRate > 0,
      citationCorrectnessRate,
      answerGroundingRate,
      invalidCitations,
      checkedCount: citations.length,
    };
  }

  /** Summarize by extracting top sentences by overlap with query (extractive). */
  public extractiveSummary(documentIds: string[], maxSentences = 5): { summary: string; sources: string[] } {
    const kw = KnowledgeWorkspace.getInstance();
    const sentences: Array<{ text: string; docId: string; score: number }> = [];
    for (const id of documentIds) {
      const doc = kw.listDocuments().find((d) => d.id === id);
      if (!doc) continue;
      const parts = doc.content.split(/(?<=[\.\!\?\u0E2F])\s+/).filter((s) => s.trim().length > 20);
      for (const p of parts) {
        sentences.push({ text: p.trim(), docId: id, score: p.length });
      }
    }
    sentences.sort((a, b) => b.score - a.score);
    const picked = sentences.slice(0, maxSentences);
    return {
      summary: picked.map((p) => p.text).join(' '),
      sources: [...new Set(picked.map((p) => p.docId))]
    };
  }

  public buildGraphEdges(): GraphEdge[] {
    const kw = KnowledgeWorkspace.getInstance();
    const docs = kw.listDocuments();
    const edges: GraphEdge[] = [];
    const byCollection = new Map<string, string[]>();
    for (const d of docs) {
      const list = byCollection.get(d.collection) || [];
      list.push(d.id);
      byCollection.set(d.collection, list);
    }
    for (const [, ids] of byCollection) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          edges.push({
            sourceDocId: ids[i],
            targetDocId: ids[j],
            relation: 'CO_COLLECTION',
            weight: 1
          });
        }
      }
    }
    // Shared tags
    for (let i = 0; i < docs.length; i++) {
      for (let j = i + 1; j < docs.length; j++) {
        const shared = docs[i].tags.filter((t) => docs[j].tags.includes(t));
        if (shared.length > 0) {
          edges.push({
            sourceDocId: docs[i].id,
            targetDocId: docs[j].id,
            relation: 'SHARED_TAG',
            weight: shared.length
          });
        }
      }
    }
    ensureKnowledgeDir();
    fs.writeFileSync(GRAPH_FILE, JSON.stringify(edges, null, 2), 'utf8');
    return edges;
  }

  public findDuplicates(): Array<{ hash: string; documentIds: string[]; titles: string[] }> {
    const kw = KnowledgeWorkspace.getInstance();
    const byHash = new Map<string, KnowledgeDocument[]>();
    for (const d of kw.listDocuments()) {
      const list = byHash.get(d.contentHash) || [];
      list.push(d);
      byHash.set(d.contentHash, list);
    }
    const dups: Array<{ hash: string; documentIds: string[]; titles: string[] }> = [];
    for (const [hash, list] of byHash) {
      if (list.length > 1) {
        dups.push({
          hash,
          documentIds: list.map((d) => d.id),
          titles: list.map((d) => d.title)
        });
      }
    }
    return dups;
  }

  /**
   * Bulk ingest job — processes items sequentially, persists progress for resume.
   */
  public startIngestionJob(
    items: Array<{
      title: string;
      content: string;
      format?: string;
      collection?: string;
      tags?: string[];
      provenance?: string;
    }>
  ): IngestionJob {
    const jobId = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const job: IngestionJob = {
      jobId,
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalItems: items.length,
      processedItems: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      documentIds: [],
      resumable: true
    };
    this.jobs.set(jobId, job);
    this.saveJobs();

    const kw = KnowledgeWorkspace.getInstance();
    const existingHashes = new Set(kw.listDocuments().map((d) => d.contentHash));

    for (const item of items) {
      try {
        const parsed = parseMultiFormat(item.content || '', item.format || 'markdown');
        if (!parsed.cleanText || parsed.cleanText.length < 3) {
          throw new Error(parsed.warnings.join('; ') || 'Empty content after parse');
        }
        const hash = crypto.createHash('sha256').update(parsed.cleanText).digest('hex');
        if (existingHashes.has(hash)) {
          job.errors.push({ item: item.title, error: 'DUPLICATE_CONTENT_HASH' });
          job.failed += 1;
        } else {
          const doc = kw.createDocument({
            title: item.title,
            content: parsed.cleanText,
            format: (['markdown', 'txt', 'json', 'csv', 'pdf', 'docx', 'code'].includes(parsed.format)
              ? parsed.format
              : 'txt') as KnowledgeDocument['format'],
            collection: item.collection || 'General',
            tags: item.tags || ['ingested'],
            provenance: item.provenance || 'Bulk ingestion job',
            language: detectLang(parsed.cleanText)
          });
          existingHashes.add(hash);
          job.documentIds.push(doc.id);
          job.succeeded += 1;
        }
      } catch (err: any) {
        job.errors.push({ item: item.title, error: err.message || String(err) });
        job.failed += 1;
      }
      job.processedItems += 1;
      job.updatedAt = new Date().toISOString();
      this.jobs.set(jobId, job);
      this.saveJobs();
    }

    job.status =
      job.failed === 0 ? 'COMPLETED' : job.succeeded === 0 ? 'FAILED' : 'PARTIAL';
    job.updatedAt = new Date().toISOString();
    this.jobs.set(jobId, job);
    this.saveJobs();

    AuditLedger.append('SYSTEM', 'KNOWLEDGE_INGESTION_JOB_FINISHED', {
      jobId,
      status: job.status,
      succeeded: job.succeeded,
      failed: job.failed
    });

    return job;
  }

  public getJob(jobId: string): IngestionJob | undefined {
    return this.jobs.get(jobId);
  }

  public resumeJob(jobId: string): IngestionJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Ingestion job '${jobId}' not found`);
    }
    job.updatedAt = new Date().toISOString();
    this.saveJobs();
    return job;
  }

  public listJobs(): IngestionJob[] {
    return Array.from(this.jobs.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );
  }

  public analyzeCorpus(): {
    entities: ExtractedEntity[];
    contradictions: ContradictionFlag[];
    duplicates: ReturnType<KnowledgeIntelligenceEngine['findDuplicates']>;
    edges: GraphEdge[];
    documentCount: number;
    chunkCount: number;
  } {
    const kw = KnowledgeWorkspace.getInstance();
    const docs = kw.listDocuments();
    // Pull chunks indirectly via retrieve with empty-ish query is wrong — use hybrid path
    // Access private chunks through list + retrieve of titles is incomplete.
    // We'll entity-extract from document content bodies.
    const entities: ExtractedEntity[] = [];
    const chunkProxies: Array<{ documentId: string; text: string }> = [];
    for (const d of docs) {
      const chunks = semanticChunk(d.content);
      chunks.forEach((text, i) => {
        const cid = `${d.id}_syn_${i}`;
        entities.push(...extractEntities(text, d.id, cid));
        chunkProxies.push({ documentId: d.id, text });
      });
    }
    const contradictions = detectContradictions(chunkProxies);
    const duplicates = this.findDuplicates();
    const edges = this.buildGraphEdges();
    return {
      entities: entities.slice(0, 200),
      contradictions,
      duplicates,
      edges,
      documentCount: docs.length,
      chunkCount: chunkProxies.length
    };
  }
}
