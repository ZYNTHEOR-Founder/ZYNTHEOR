/**
 * ZYNTHEOR Sovereign Knowledge Workspace & Native Retrieval Engine
 * 
 * Manages document intake, chunking, full-text inverted indexing,
 * verifiable source attribution, and training dataset curation.
 * 
 * CRITICAL ZERO-FAKE ARCHITECTURAL SEPARATION:
 * 1. Knowledge Workspace = Document repository & notes
 * 2. Retrieval Index = Chunked inverted search index
 * 3. Conversational Memory = Episodic chat sessions
 * 4. Training Dataset = Curated, packed token sequences
 * 5. Model Weights = Neural parameters in model_checkpoint.pt
 * 
 * Uploading a document does NOT automatically modify model weights!
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger';
import { semanticChunk, detectLang } from './knowledgeUtils';

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  source: string;
  format: 'markdown' | 'txt' | 'json' | 'csv' | 'pdf' | 'docx' | 'code';
  collection: string;
  tags: string[];
  language: 'th' | 'en' | 'mixed';
  version: number;
  createdAt: string;
  updatedAt: string;
  contentHash: string; // SHA-256
  status: 'indexed' | 'processing' | 'error';
  chunksCount: number;
  byteSize: number;
  provenance: string;
  curatedForTraining: boolean;
  tenantId?: string;
  readRoles?: string[];
  parsedMetadata?: Record<string, any>;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  collection: string;
  chunkIndex: number;
  text: string;
  language: 'th' | 'en' | 'mixed';
  hash: string;
}

export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  collection: string;
  chunkIndex: number;
  text: string;
  score: number;
  language: string;
}

export interface CuratedDatasetItem {
  id: string;
  sourceDocId: string;
  text: string;
  tokenCount: number;
  split: 'train' | 'val' | 'eval';
  qualityScore: number;
  isSynthetic: boolean;
  status: 'VERIFIED_READY' | 'NEEDS_REVIEW' | 'FLAGGED';
  flags?: string[];
}

export interface CuratedDatasetManifest {
  datasetId: string;
  name: string;
  version: string;
  createdAt: string;
  sourceDocIds: string[];
  totalSamples: number;
  trainSamples: number;
  valSamples: number;
  evalSamples: number;
  totalTokensEstimate: number;
  thaiScriptRatio: number;
  englishScriptRatio: number;
  datasetHash: string;
  syntheticCount: number;
  originalCount: number;
  qualityScoreAvg: number;
  status: 'VERIFIED_READY' | 'NEEDS_REVIEW' | 'FLAGGED';
}

export interface ParsedDocumentResult {
  cleanText: string;
  headings: string[];
  metadata: Record<string, any>;
  detectedFormat: KnowledgeDocument['format'];
}

/**
 * Native Document Parsers for TXT, Markdown, JSON, CSV, and Source Code
 */
export function parseDocumentContent(raw: string, format: KnowledgeDocument['format'] = 'markdown'): ParsedDocumentResult {
  const headings: string[] = [];
  const metadata: Record<string, any> = {};

  if (!raw || typeof raw !== 'string') {
    return { cleanText: '', headings: [], metadata: {}, detectedFormat: format };
  }

  // 1. JSON Parser
  if (format === 'json') {
    try {
      const parsed = JSON.parse(raw);
      metadata.isJson = true;
      let textOut = '';
      if (Array.isArray(parsed)) {
        metadata.recordCount = parsed.length;
        textOut = parsed.map((item, idx) => {
          if (typeof item === 'object' && item !== null) {
            const props = Object.entries(item).map(([k, v]) => `${k}: ${v}`).join(' | ');
            return `[Record #${idx + 1}] ${props}`;
          }
          return `[Item #${idx + 1}] ${item}`;
        }).join('\n\n');
      } else if (typeof parsed === 'object' && parsed !== null) {
        metadata.keyCount = Object.keys(parsed).length;
        textOut = Object.entries(parsed).map(([k, v]) => {
          headings.push(k);
          const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return `## ${k}\n${valStr}`;
        }).join('\n\n');
      } else {
        textOut = String(parsed);
      }
      return { cleanText: textOut, headings, metadata, detectedFormat: 'json' };
    } catch (e: any) {
      metadata.parseError = e.message;
      return { cleanText: raw, headings: [], metadata, detectedFormat: 'json' };
    }
  }

  // 2. CSV Parser
  if (format === 'csv') {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      const headers = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));
      headings.push(...headers);
      metadata.columns = headers;
      metadata.rowCount = lines.length - 1;

      const rowTexts = lines.slice(1).map((line, rIdx) => {
        const cols = line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
        const fields = headers.map((h, i) => `${h}: ${cols[i] || 'N/A'}`).join(' | ');
        return `[Row ${rIdx + 1}] ${fields}`;
      });

      return {
        cleanText: `# CSV Data: ${headers.join(', ')}\n\n${rowTexts.join('\n\n')}`,
        headings,
        metadata,
        detectedFormat: 'csv'
      };
    }
  }

  // 3. Source Code Parser (JavaScript, TypeScript, Python, Shell, HTML/CSS)
  if (format === 'code') {
    const lines = raw.split('\n');
    const symbols: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const fnMatch = trimmed.match(/(?:function|def|class|interface|type)\s+([a-zA-Z0-9_$]+)/);
      if (fnMatch && fnMatch[1]) {
        symbols.push(fnMatch[1]);
        headings.push(fnMatch[1]);
      }
    }
    metadata.symbols = symbols;
    metadata.lineCount = lines.length;
    return {
      cleanText: `# Source Code Manifest (${symbols.length} symbols)\n\n\`\`\`\n${raw.trim()}\n\`\`\``,
      headings,
      metadata,
      detectedFormat: 'code'
    };
  }

  // 4. Markdown Parser
  if (format === 'markdown') {
    const lines = raw.split('\n');
    for (const line of lines) {
      const hMatch = line.trim().match(/^(#{1,4})\s+(.+)$/);
      if (hMatch && hMatch[2]) {
        headings.push(hMatch[2].trim());
      }
    }
    metadata.headingCount = headings.length;
    return { cleanText: raw.trim(), headings, metadata, detectedFormat: 'markdown' };
  }

  // 5. Plain TXT
  const paragraphs = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return {
    cleanText: paragraphs.join('\n\n'),
    headings: [],
    metadata: { paragraphCount: paragraphs.length },
    detectedFormat: 'txt'
  };
}

export class KnowledgeWorkspace {
  private static instance: KnowledgeWorkspace | null = null;
  private baseDir = path.resolve(process.cwd(), 'native_data', 'knowledge');
  private datasetDir = path.resolve(process.cwd(), 'native_data', 'datasets');
  private docsFile = path.resolve(process.cwd(), 'native_data', 'knowledge', 'documents.json');
  private chunksFile = path.resolve(process.cwd(), 'native_data', 'knowledge', 'chunks.json');
  private datasetManifestFile = path.resolve(process.cwd(), 'native_data', 'datasets', 'manifest.json');

  private documents: Map<string, KnowledgeDocument> = new Map();
  private chunks: KnowledgeChunk[] = [];
  private datasets: CuratedDatasetManifest[] = [];

  private constructor() {
    this.ensureDirs();
    this.loadFromDisk();
    if (this.documents.size === 0) {
      this.seedInitialKnowledge();
    }
  }

  public parseDocumentContent(raw: string, format: KnowledgeDocument['format'] = 'markdown'): ParsedDocumentResult {
    return parseDocumentContent(raw, format);
  }

  public static getInstance(): KnowledgeWorkspace {
    if (!KnowledgeWorkspace.instance) {
      KnowledgeWorkspace.instance = new KnowledgeWorkspace();
    }
    return KnowledgeWorkspace.instance;
  }

  private ensureDirs(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.datasetDir)) {
      fs.mkdirSync(this.datasetDir, { recursive: true });
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.docsFile)) {
        const raw = fs.readFileSync(this.docsFile, 'utf8');
        const list: KnowledgeDocument[] = JSON.parse(raw);
        for (const doc of list) {
          this.documents.set(doc.id, doc);
        }
      }
      if (fs.existsSync(this.chunksFile)) {
        const raw = fs.readFileSync(this.chunksFile, 'utf8');
        this.chunks = JSON.parse(raw);
      }
      if (fs.existsSync(this.datasetManifestFile)) {
        const raw = fs.readFileSync(this.datasetManifestFile, 'utf8');
        this.datasets = JSON.parse(raw);
      }
    } catch (err) {
      console.error('[KnowledgeWorkspace] Error loading from disk:', err);
    }
  }

  private saveToDisk(): void {
    try {
      this.ensureDirs();
      const docsArray = Array.from(this.documents.values());
      fs.writeFileSync(this.docsFile, JSON.stringify(docsArray, null, 2), 'utf8');
      fs.writeFileSync(this.chunksFile, JSON.stringify(this.chunks, null, 2), 'utf8');
      fs.writeFileSync(this.datasetManifestFile, JSON.stringify(this.datasets, null, 2), 'utf8');
    } catch (err) {
      console.error('[KnowledgeWorkspace] Error saving to disk:', err);
    }
  }

  private detectLanguage(text: string): 'th' | 'en' | 'mixed' {
    const thaiChars = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
    const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
    if (thaiChars > 0 && latinChars > 0) return 'mixed';
    if (thaiChars > latinChars) return 'th';
    return 'en';
  }

  private chunkText(docId: string, docTitle: string, collection: string, text: string): KnowledgeChunk[] {
    const pieces = semanticChunk(text, { targetSize: 500, maxSize: 900, overlap: 80 });
    const chunks: KnowledgeChunk[] = [];
    let chunkIndex = 0;
    for (const piece of pieces) {
      const hash = crypto.createHash('sha256').update(piece).digest('hex');
      chunks.push({
        id: `chk_${docId}_${chunkIndex}`,
        documentId: docId,
        documentTitle: docTitle,
        collection,
        chunkIndex,
        text: piece.trim(),
        language: detectLang(piece),
        hash
      });
      chunkIndex++;
    }
    return chunks;
  }

  private seedInitialKnowledge(): void {
    const seeds: Array<Omit<KnowledgeDocument, 'id' | 'createdAt' | 'updatedAt' | 'contentHash' | 'chunksCount' | 'byteSize' | 'version' | 'status'>> = [
      {
        title: 'ZYNTHEOR Architecture Manifest & 33.7M Parameter Model Specification',
        collection: 'Architecture',
        source: 'docs/architecture_manifest.md',
        format: 'markdown',
        tags: ['architecture', 'transformer', 'rope', 'swiglu', 'sovereign'],
        language: 'mixed',
        provenance: 'First-party engineering specification authored by ZYNTHEOR Core Team',
        curatedForTraining: true,
        content: `# ZYNTHEOR Q+ Sovereign AI Architecture Manifest

## 1. Core Model Topology
ZYNTHEOR runs a 10-layer decoder-only Transformer with 8 Multi-Head Attention heads (d_k=64, d_model=512) and SwiGLU intermediate feed-forward dimension (d_ffn=1,472).
Total parameter count is 33,958,400 Float32 parameters (~135.8 MB).

## 2. Invariants & Fail-Closed Standard
- Absolute Zero External AI APIs: No third-party network egress in the reasoning loop.
- Cryptographic Integrity: Every block sealed in append-only SHA-256 chained audit ledger.
- Fail-Closed: Missing or corrupted model checkpoints trigger immediate safe halting.
- Memory Isolation: Episodic memory persisted separately from static model weights.`
      },
      {
        title: 'Thai-English Bilingual Tokenizer Standard & Character Preservation Protocol',
        collection: 'Bilingual Language',
        source: 'docs/bilingual_tokenizer.md',
        format: 'markdown',
        tags: ['tokenizer', 'thai', 'english', 'unicode', 'vocab'],
        language: 'th',
        provenance: 'Internal linguistic standard for zero-loss Thai character encoding',
        curatedForTraining: true,
        content: `# มาตรฐานโทเคไนเซอร์ภาษาไทย-อังกฤษ ZYNTHEOR Sovereign Tokenizer

## 1. ขอบเขตพจนานุกรม (Vocabulary Scope)
พจนานุกรมขนาด 16,384 โทเค็น ครอบคลุมชุดอักขระภาษาไทยทุกตัวตั้งแต่ U+0E01 (ก) ถึง U+0E5B (๙) รวมสระ วรรณยุกต์ และเครื่องหมายวรรคตอน
รับประกัน 0% UNK Loss (อัตราการหลุดเป็น [UNK] เท่ากับศูนย์)

## 2. การตัดคำและการสลับภาษา (Code-Switching)
รองรับการประมวลผลประโยคที่ผสมผสานระหว่างภาษาไทยและภาษาอังกฤษ เช่น "รัน Docker container ด้วยคำสั่ง compose up" โดยไม่ทำลายโครงสร้างไวยากรณ์`
      },
      {
        title: 'Sovereign Token Verification & Constant-Time Security Specification',
        collection: 'Security Invariants',
        source: 'docs/security_token_verification.md',
        format: 'markdown',
        tags: ['security', 'hmac', 'timing-attack', 'tenant-isolation', 'sha256'],
        language: 'en',
        provenance: 'Hardened cryptographic authentication protocol specification',
        curatedForTraining: true,
        content: `# Sovereign HMAC Token Verification Standard

## 1. Timing-Attack Defense
Token verification MUST utilize constant-time comparison via crypto.timingSafeEqual() to prevent side-channel timing attacks.
Under no circumstances may plain string equality (===) be used on HMAC signatures.

## 2. Minimum Entropy & Tenant Isolation
Secret keys must have at least 32 bytes of cryptographic entropy loaded from environment variables.
Each token payload enforces strict tenantId validation, role hierarchy checks, and expiration limits.`
      },
      {
        title: 'Zero-Fake Engineering Constitution & Evidence Classification Matrix',
        collection: 'Governance',
        source: 'docs/zero_fake_constitution.md',
        format: 'markdown',
        tags: ['governance', 'zero-fake', 'evidence', 'audit'],
        language: 'mixed',
        provenance: 'Foundational operating charter of the ZYNTHEOR project',
        curatedForTraining: true,
        content: `# รัฐธรรมนูญวิศวกรรม Zero-Fake Engineering Standard

## 1. กฎเหล็ก 7 ข้อ
1. ห้ามสร้างโมเดลจำลองหรือรายงานผล benchmark เท็จ
2. แยกแยะอย่างชัดเจนระหว่าง INITIALIZED WEIGHTS (ค่าน้ำหนักเริ่มต้น/สัญลักษณ์) และ LEARNED WEIGHTS (ค่าน้ำหนักที่ผ่านการฝึกจริง)
3. การอัปโหลดเอกสารเข้า Knowledge Workspace ไม่ถือว่าเป็นการฝึก Model Weights
4. จำแนกสถานะตามความเป็นจริง: VERIFIED, IMPLEMENTED, PARTIAL, BLOCKED, NOT IMPLEMENTED, MOCK
5. ทุกการเปลี่ยนแปลงต้องตรวจสอบผ่านหลักฐานจริงใน Filesystem และ Runtime Logs`
      }
    ];

    for (const seed of seeds) {
      this.createDocument(seed);
    }
  }

  public createDocument(data: {
    title: string;
    content: string;
    source?: string;
    format?: KnowledgeDocument['format'];
    collection?: string;
    tags?: string[];
    language?: 'th' | 'en' | 'mixed';
    provenance?: string;
    curatedForTraining?: boolean;
    tenantId?: string;
    readRoles?: string[];
  }): KnowledgeDocument {
    const id = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const format = data.format || 'markdown';
    const parsed = parseDocumentContent(data.content, format);
    const cleanContent = parsed.cleanText.trim();
    const contentHash = crypto.createHash('sha256').update(cleanContent).digest('hex');
    const now = new Date().toISOString();

    const doc: KnowledgeDocument = {
      id,
      title: data.title.trim(),
      content: cleanContent,
      source: data.source || 'Knowledge Workspace Upload',
      format,
      collection: data.collection || 'General',
      tags: data.tags || ['general'],
      language: data.language || this.detectLanguage(cleanContent),
      version: 1,
      createdAt: now,
      updatedAt: now,
      contentHash,
      status: 'indexed',
      chunksCount: 0,
      byteSize: Buffer.byteLength(cleanContent, 'utf8'),
      provenance: data.provenance || 'User imported knowledge note',
      curatedForTraining: Boolean(data.curatedForTraining),
      tenantId: data.tenantId,
      readRoles: data.readRoles,
      parsedMetadata: parsed.metadata
    };

    // Generate Chunks
    const newChunks = this.chunkText(doc.id, doc.title, doc.collection, cleanContent);
    doc.chunksCount = newChunks.length;

    this.documents.set(id, doc);
    this.chunks.push(...newChunks);
    this.saveToDisk();

    AuditLedger.append('SYSTEM', 'KNOWLEDGE_DOCUMENT_CREATED', {
      docId: id,
      title: doc.title,
      collection: doc.collection,
      chunksCount: doc.chunksCount,
      byteSize: doc.byteSize,
      contentHash: doc.contentHash,
      format: doc.format
    });

    return doc;
  }

  public updateDocument(id: string, updates: Partial<KnowledgeDocument>): KnowledgeDocument {
    const existing = this.documents.get(id);
    if (!existing) {
      throw new Error(`Document with ID '${id}' not found`);
    }

    const contentChanged = updates.content !== undefined && updates.content.trim() !== existing.content;
    const newContent = contentChanged ? updates.content!.trim() : existing.content;
    const newHash = contentChanged ? crypto.createHash('sha256').update(newContent).digest('hex') : existing.contentHash;
    const now = new Date().toISOString();

    const updated: KnowledgeDocument = {
      ...existing,
      ...updates,
      content: newContent,
      contentHash: newHash,
      version: existing.version + (contentChanged ? 1 : 0),
      updatedAt: now,
      byteSize: Buffer.byteLength(newContent, 'utf8'),
      language: this.detectLanguage(newContent)
    };

    // Re-chunk if content changed
    if (contentChanged) {
      this.chunks = this.chunks.filter((c) => c.documentId !== id);
      const newChunks = this.chunkText(id, updated.title, updated.collection, newContent);
      this.chunks.push(...newChunks);
      updated.chunksCount = newChunks.length;
    }

    this.documents.set(id, updated);
    this.saveToDisk();

    AuditLedger.append('SYSTEM', 'KNOWLEDGE_DOCUMENT_UPDATED', {
      docId: id,
      version: updated.version,
      contentHash: updated.contentHash
    });

    return updated;
  }

  public deleteDocument(id: string): boolean {
    const existing = this.documents.get(id);
    if (!existing) return false;

    this.documents.delete(id);
    this.chunks = this.chunks.filter((c) => c.documentId !== id);
    this.saveToDisk();

    AuditLedger.append('SYSTEM', 'KNOWLEDGE_DOCUMENT_DELETED', {
      docId: id,
      title: existing.title
    });

    return true;
  }

  public listDocuments(filter?: { collection?: string; search?: string; tag?: string }): KnowledgeDocument[] {
    let docs = Array.from(this.documents.values());

    if (filter?.collection) {
      docs = docs.filter((d) => d.collection.toLowerCase() === filter.collection!.toLowerCase());
    }
    if (filter?.tag) {
      docs = docs.filter((d) => d.tags.some((t) => t.toLowerCase() === filter.tag!.toLowerCase()));
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      docs = docs.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.content.toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    return docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public getDocument(id: string): KnowledgeDocument | null {
    return this.documents.get(id) || null;
  }

  /**
   * Native Knowledge Retrieval with Keyword, N-Gram & Heading Relevance
   */
  public retrieve(query: string, options: { limit?: number; collection?: string } = {}): RetrievalResult[] {
    const limit = options.limit || 4;
    const qLower = query.toLowerCase().trim();
    if (!qLower) return [];

    const queryTokens = qLower
      .replace(/[^\w\u0E00-\u0E7F]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);

    if (queryTokens.length === 0) return [];

    let targetChunks = this.chunks;
    if (options.collection) {
      targetChunks = targetChunks.filter((c) => c.collection.toLowerCase() === options.collection!.toLowerCase());
    }

    const scored: RetrievalResult[] = [];

    for (const chunk of targetChunks) {
      const chunkLower = chunk.text.toLowerCase();
      const titleLower = chunk.documentTitle.toLowerCase();
      let score = 0;

      // Exact substring match bonus
      if (chunkLower.includes(qLower)) {
        score += 8.0;
      }
      if (titleLower.includes(qLower)) {
        score += 10.0;
      }

      // Token overlap scoring
      for (const tok of queryTokens) {
        if (titleLower.includes(tok)) score += 3.5;
        const matches = (chunkLower.match(new RegExp(tok, 'g')) || []).length;
        if (matches > 0) {
          score += Math.min(matches, 6) * 1.5;
        }
      }

      if (score > 2.0) {
        scored.push({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          collection: chunk.collection,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          score: Number(score.toFixed(2)),
          language: chunk.language
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Curation Engine: Validates, deduplicates, and splits knowledge documents into training dataset
   */
  public curateDataset(
    name: string,
    documentIds: string[],
    splitRatio: { train: number; val: number; eval: number } = { train: 0.8, val: 0.1, eval: 0.1 }
  ): CuratedDatasetManifest {
    const selectedDocs = documentIds.map((id) => this.documents.get(id)).filter(Boolean) as KnowledgeDocument[];

    if (selectedDocs.length === 0) {
      throw new Error('At least one valid document must be selected for dataset curation');
    }

    const datasetId = `ds_${Date.now()}`;
    const datasetFile = path.join(this.datasetDir, `${datasetId}.json`);

    const items: CuratedDatasetItem[] = [];
    const seenHashes = new Set<string>();
    let totalTokensEstimate = 0;
    let thaiCharsCount = 0;
    let latinCharsCount = 0;
    let syntheticCount = 0;
    let originalCount = 0;
    let totalQualityScore = 0;

    for (const doc of selectedDocs) {
      const isDocSynthetic = Boolean(
        doc.tags.some((t) => t.toLowerCase().includes('synthetic')) ||
        doc.provenance.toLowerCase().includes('synthetic') ||
        doc.title.toLowerCase().includes('synthetic')
      );

      const docChunks = this.chunks.filter((c) => c.documentId === doc.id);
      for (const chk of docChunks) {
        // Deduplication check
        if (seenHashes.has(chk.hash)) continue;
        seenHashes.add(chk.hash);

        // Quality Scoring (0 - 100)
        let qualityScore = 80;
        const flags: string[] = [];

        if (chk.text.length < 50) {
          qualityScore -= 25;
          flags.push('SHORT_FRAGMENT');
        } else if (chk.text.length > 1200) {
          qualityScore -= 10;
          flags.push('OVERSIZED_CHUNK');
        }

        // Repetition check
        const words = chk.text.split(/\s+/);
        const uniqueWords = new Set(words);
        const uniqueRatio = uniqueWords.size / Math.max(1, words.length);
        if (uniqueRatio < 0.45) {
          qualityScore -= 30;
          flags.push('HIGH_REPETITION');
        }

        if (isDocSynthetic) {
          syntheticCount++;
          flags.push('SYNTHETIC_ORIGIN');
        } else {
          originalCount++;
        }

        // Determine item Quality Gate status
        let itemStatus: CuratedDatasetItem['status'] = 'VERIFIED_READY';
        if (isDocSynthetic || qualityScore < 70) {
          itemStatus = 'NEEDS_REVIEW';
        }

        totalQualityScore += qualityScore;

        // Count characters for script ratio
        thaiCharsCount += (chk.text.match(/[\u0E00-\u0E7F]/g) || []).length;
        latinCharsCount += (chk.text.match(/[a-zA-Z]/g) || []).length;

        const estTokens = Math.ceil(chk.text.length / 4);
        totalTokensEstimate += estTokens;

        // Assign split pseudo-randomly but deterministically based on hash
        const hashVal = parseInt(chk.hash.substring(0, 4), 16) / 65535;
        let split: 'train' | 'val' | 'eval' = 'train';
        if (hashVal > splitRatio.train + splitRatio.val) {
          split = 'eval';
        } else if (hashVal > splitRatio.train) {
          split = 'val';
        }

        items.push({
          id: `item_${datasetId}_${items.length}`,
          sourceDocId: doc.id,
          text: chk.text,
          tokenCount: estTokens,
          split,
          qualityScore,
          isSynthetic: isDocSynthetic,
          status: itemStatus,
          flags: flags.length > 0 ? flags : undefined
        });
      }
    }

    const totalSamples = items.length;
    const trainSamples = items.filter((i) => i.split === 'train').length;
    const valSamples = items.filter((i) => i.split === 'val').length;
    const evalSamples = items.filter((i) => i.split === 'eval').length;

    const totalChars = Math.max(1, thaiCharsCount + latinCharsCount);
    const thaiScriptRatio = Number((thaiCharsCount / totalChars).toFixed(3));
    const englishScriptRatio = Number((latinCharsCount / totalChars).toFixed(3));
    const qualityScoreAvg = totalSamples > 0 ? Math.round(totalQualityScore / totalSamples) : 0;

    const datasetDigest = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');

    // Quality Gate: If synthetic samples exist or average quality < 75, requires review
    const manifestStatus: CuratedDatasetManifest['status'] =
      syntheticCount > 0 || qualityScoreAvg < 75 || items.some((i) => i.status === 'NEEDS_REVIEW')
        ? 'NEEDS_REVIEW'
        : 'VERIFIED_READY';

    const manifest: CuratedDatasetManifest = {
      datasetId,
      name: name.trim(),
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      sourceDocIds: selectedDocs.map((d) => d.id),
      totalSamples,
      trainSamples,
      valSamples,
      evalSamples,
      totalTokensEstimate,
      thaiScriptRatio,
      englishScriptRatio,
      datasetHash: datasetDigest,
      syntheticCount,
      originalCount,
      qualityScoreAvg,
      status: manifestStatus
    };

    // Save dataset items to disk
    fs.writeFileSync(datasetFile, JSON.stringify({ manifest, items }, null, 2), 'utf8');

    this.datasets.unshift(manifest);
    this.saveToDisk();

    AuditLedger.append('SYSTEM', 'DATASET_CURATED', {
      datasetId,
      name: manifest.name,
      totalSamples,
      trainSamples,
      valSamples,
      evalSamples,
      syntheticCount,
      qualityScoreAvg,
      status: manifest.status,
      datasetHash: manifest.datasetHash
    });

    return manifest;
  }

  public getDatasets(): CuratedDatasetManifest[] {
    return [...this.datasets];
  }

  public getDatasetDetail(datasetId: string): any {
    const datasetFile = path.join(this.datasetDir, `${datasetId}.json`);
    if (fs.existsSync(datasetFile)) {
      try {
        return JSON.parse(fs.readFileSync(datasetFile, 'utf8'));
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  public getStats() {
    const docs = Array.from(this.documents.values());
    const collections = Array.from(new Set(docs.map((d) => d.collection)));
    const totalBytes = docs.reduce((acc, d) => acc + d.byteSize, 0);

    return {
      totalDocuments: docs.length,
      totalChunks: this.chunks.length,
      totalCollections: collections.length,
      collections,
      totalBytes,
      totalDatasets: this.datasets.length,
      lastUpdated: docs.length > 0 ? docs[0].updatedAt : new Date().toISOString()
    };
  }
}
