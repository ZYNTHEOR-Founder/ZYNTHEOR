/**
 * ZYNTHEOR Batch 29 — Cognitive Context Engine
 *
 * Unified context understanding & cross-session lifecycle system.
 * Strictly separates deterministic preprocessing (`attribution: 'deterministic_preprocessor'`)
 * from Native Model neural inference (`attribution: 'native_model_logits'`).
 *
 * Capabilities:
 *  - Context representation & structural segmentation (Thai/English/Code/Constraint/Question)
 *  - Intent recognition with matched evidence signals
 *  - Entity & candidate relationship extraction
 *  - Temporal context markers & freshness decay
 *  - Context prioritization & relevance scoring
 *  - Context conflict detection (numeric/directive/temporal contradictions)
 *  - Tenant- & owner-isolated cross-session context lifecycle in native_data/cognitive_context.json
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger.ts';
import { detectLang, tokenize } from './KnowledgeIntelligenceEngine.ts';

export type ContextSegmentKind =
  | 'instruction'
  | 'constraint'
  | 'code'
  | 'question'
  | 'reference'
  | 'context_fact';

export type CognitiveIntent =
  | 'coding'
  | 'debugging'
  | 'math_reasoning'
  | 'knowledge_qa'
  | 'planning'
  | 'security_audit'
  | 'bilingual_translation'
  | 'general';

export interface ContextSegment {
  segmentId: string;
  index: number;
  kind: ContextSegmentKind;
  language: 'th' | 'en' | 'mixed';
  text: string;
  priority: number; // 1 (highest) .. 5
  relevanceScore: number;
  temporalHint?: string;
  tokenEstimate: number;
}

export interface ContextEntity {
  text: string;
  canonical: string;
  type: 'FILE_PATH' | 'API_ROUTE' | 'SYMBOL' | 'THAI_TERM' | 'NUMBER' | 'CONSTRAINT' | 'CONCEPT';
  segmentId: string;
}

export interface ContextRelationCandidate {
  subject: string;
  predicate: string;
  object: string;
  segmentId: string;
  confidence: number;
}

export interface ContextConflict {
  conflictId: string;
  segmentA: string;
  segmentB: string;
  kind: 'NUMERIC_MISMATCH' | 'DIRECTIVE_NEGATION' | 'TEMPORAL_SUPERSESSION';
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ContextAnalysisResult {
  contextId: string;
  analyzedAt: string;
  attribution: 'deterministic_preprocessor';
  nativeNeuralState: 'UNINVOKED' | 'READY' | 'BLOCKED';
  language: 'th' | 'en' | 'mixed';
  intent: {
    primary: CognitiveIntent;
    confidence: number;
    secondary: CognitiveIntent[];
    matchedSignals: string[];
  };
  segments: ContextSegment[];
  entities: ContextEntity[];
  relations: ContextRelationCandidate[];
  conflicts: ContextConflict[];
  temporalMarkers: string[];
  prioritizedOrder: string[];
  contentSha256: string;
}

export interface ContextSessionWindow {
  sessionId: string;
  tenantId: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'EXPIRED';
  turns: Array<{
    turnId: string;
    timestamp: string;
    role: 'user' | 'system' | 'assistant';
    summary: string;
    intent: CognitiveIntent;
    entities: string[];
    contentSha256: string;
    priority: number;
  }>;
  pinnedFacts: Array<{
    factId: string;
    text: string;
    createdAt: string;
    priority: number;
    sourceTurnId?: string;
  }>;
}

export interface ContextScope {
  tenantId: string;
  userId: string;
  role?: string;
}

const INTENT_RULES: Array<{
  intent: CognitiveIntent;
  patterns: RegExp[];
  weight: number;
}> = [
  {
    intent: 'security_audit',
    patterns: [
      /\b(hmac|sha-?256|rbac|ssrf|tenant|isolation|tamper|audit|vulnerability|exploit|sanitize|auth|token)\b/i,
      /(ความปลอดภัย|สิทธิ์|ตรวจสอบบัญชี|แฮช|แยกผู้เช่า)/,
    ],
    weight: 1.25,
  },
  {
    intent: 'debugging',
    patterns: [
      /\b(bug|fix|error|exception|stack\s?trace|fail(ed|ing)?|broken|crash|repair|debug|regression)\b/i,
      /(แก้ไข|บั๊ก|ข้อผิดพลาด|พัง|ล้มเหลว|ซ่อมแซม)/,
    ],
    weight: 1.2,
  },
  {
    intent: 'math_reasoning',
    patterns: [
      /\b(calculate|compute|solve|equation|sum|product|budget|constraint|probability|perplexity|loss|math)\b/i,
      /[0-9]+\s*[\+\-\*\/]\s*[0-9]+/,
      /(คำนวณ|สมการ|คณิตศาสตร์|ความน่าจะเป็น|งบประมาณ)/,
    ],
    weight: 1.15,
  },
  {
    intent: 'planning',
    patterns: [
      /\b(plan|roadmap|dag|schedule|workflow|steps|decompose|milestones|architecture|design)\b/i,
      /(วางแผน|ขั้นตอน|สถาปัตยกรรม|ออกแบบ|จัดลำดับ)/,
    ],
    weight: 1.1,
  },
  {
    intent: 'coding',
    patterns: [
      /\b(build|create|implement|write|function|class|module|typescript|python|api|endpoint|test|compile)\b/i,
      /```[\s\S]*```/,
      /(สร้าง|เขียนโค้ด|ฟังก์ชัน|โปรแกรม|ทดสอบ|โมดูล)/,
    ],
    weight: 1.05,
  },
  {
    intent: 'bilingual_translation',
    patterns: [
      /\b(translate|bilingual|thai\s+to\s+english|english\s+to\s+thai)\b/i,
      /(แปลภาษา|สองภาษา|ภาษาไทย|ภาษาอังกฤษ)/,
    ],
    weight: 1.1,
  },
  {
    intent: 'knowledge_qa',
    patterns: [
      /\b(what|why|how|when|where|which|explain|summarize|compare|retrieve|citation|document|graph)\b/i,
      /(คืออะไร|อย่างไร|ทำไม|อธิบาย|สรุป|เปรียบเทียบ|เอกสาร|ความรู้)/,
    ],
    weight: 1.0,
  },
];

export class CognitiveContextEngine {
  private static instance: CognitiveContextEngine | null = null;
  private filePath: string;
  private sessions = new Map<string, ContextSessionWindow>();

  private constructor() {
    this.filePath = process.env.ZYNTHEOR_CONTEXT_FILE
      ? path.resolve(process.env.ZYNTHEOR_CONTEXT_FILE)
      : path.resolve(process.cwd(), 'native_data', 'cognitive_context.json');
    this.loadFromDisk();
  }

  public static getInstance(): CognitiveContextEngine {
    if (!CognitiveContextEngine.instance) {
      CognitiveContextEngine.instance = new CognitiveContextEngine();
    }
    return CognitiveContextEngine.instance;
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private loadFromDisk(): void {
    try {
      this.ensureDir();
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.sessions)) {
        for (const s of parsed.sessions) {
          if (s?.sessionId && s?.tenantId) {
            this.sessions.set(this.sessionKey(s.tenantId, s.sessionId), s);
          }
        }
      }
    } catch {
      this.sessions.clear();
    }
  }

  private persist(): void {
    this.ensureDir();
    const payload = {
      version: 'ZYNTHEOR_CONTEXT_V1',
      updatedAt: new Date().toISOString(),
      sessions: Array.from(this.sessions.values()).slice(0, 500),
    };
    const tmp = `${this.filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  private sessionKey(tenantId: string, sessionId: string): string {
    return `${tenantId}::${sessionId}`;
  }

  public recognizeIntent(text: string): ContextAnalysisResult['intent'] {
    const trimmed = (text || '').trim();
    const scores = new Map<CognitiveIntent, number>();
    const signals: string[] = [];

    for (const rule of INTENT_RULES) {
      let hits = 0;
      for (const pat of rule.patterns) {
        const m = trimmed.match(pat);
        if (m) {
          hits += 1;
          signals.push(`${rule.intent}:${m[0].slice(0, 32)}`);
        }
      }
      if (hits > 0) {
        scores.set(rule.intent, Number((hits * rule.weight).toFixed(3)));
      }
    }

    if (scores.size === 0) {
      return {
        primary: 'general',
        confidence: trimmed.length > 0 ? 0.55 : 0.0,
        secondary: [],
        matchedSignals: [],
      };
    }

    const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    const topScore = sorted[0][1];
    const totalScore = sorted.reduce((acc, [, s]) => acc + s, 0);
    const confidence = Number(Math.min(0.98, Math.max(0.5, topScore / Math.max(1, totalScore) + 0.25)).toFixed(3));

    return {
      primary: sorted[0][0],
      confidence,
      secondary: sorted.slice(1, 3).map(([k]) => k),
      matchedSignals: signals.slice(0, 12),
    };
  }

  public segmentContext(rawInput: string, query?: string): ContextSegment[] {
    const clean = (rawInput || '').replace(/\r\n/g, '\n').trim();
    if (!clean) return [];

    // Split code fences cleanly while preserving paragraph / sentence lines
    const rawBlocks: string[] = [];
    const fenceRegex = /```[\s\S]*?```/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(clean)) !== null) {
      const before = clean.slice(lastIdx, match.index).trim();
      if (before) {
        rawBlocks.push(...before.split(/\n+/).map((l) => l.trim()).filter(Boolean));
      }
      rawBlocks.push(match[0].trim());
      lastIdx = match.index + match[0].length;
    }
    const tail = clean.slice(lastIdx).trim();
    if (tail) {
      rawBlocks.push(...tail.split(/\n+/).map((l) => l.trim()).filter(Boolean));
    }

    const qTokens = new Set(tokenize(query || clean));
    const segments: ContextSegment[] = rawBlocks.map((block, idx) => {
      let kind: ContextSegmentKind = 'context_fact';
      let priority = 3;
      if (block.startsWith('```') || /\b(function|class|def|import|export|const)\b/.test(block)) {
        kind = 'code';
        priority = 2;
      } else if (/\b(must|never|always|required|strictly|constraint|limit|max|min|ห้าม|ต้อง|เงื่อนไข)\b/i.test(block)) {
        kind = 'constraint';
        priority = 1;
      } else if (block.endsWith('?') || /\b(what|why|how|when|where|which|explain|คืออะไร|อย่างไร|ทำไม)\b/i.test(block)) {
        kind = 'question';
        priority = 1;
      } else if (/\b(build|create|implement|verify|fix|run|analyze|สร้าง|แก้ไข|ตรวจสอบ|รัน)\b/i.test(block)) {
        kind = 'instruction';
        priority = 2;
      } else if (/^(\[|source:|ref:|http|\/[a-z0-9_.\-/]+)/i.test(block)) {
        kind = 'reference';
        priority = 3;
      }

      const bTokens = tokenize(block);
      let overlap = 0;
      for (const bt of bTokens) if (qTokens.has(bt)) overlap += 1;
      const priorityBoost = (6 - priority) * 0.25;
      const relevanceScore = Number(
        Math.min(1, (overlap / Math.max(1, Math.min(8, qTokens.size))) * 0.7 + priorityBoost * 0.3).toFixed(3)
      );

      const tempMatch = block.match(/\b(\d{4}-\d{2}-\d{2}|today|yesterday|now|latest|before|after|วันนี้|ล่าสุด|ก่อนหน้า)\b/i);

      return {
        segmentId: `seg_${idx + 1}`,
        index: idx,
        kind,
        language: detectLang(block),
        text: block,
        priority,
        relevanceScore,
        temporalHint: tempMatch ? tempMatch[0] : undefined,
        tokenEstimate: Math.max(1, Math.ceil(block.length / 3.8)),
      };
    });

    return segments;
  }

  public extractEntitiesAndRelations(segments: ContextSegment[]): {
    entities: ContextEntity[];
    relations: ContextRelationCandidate[];
    temporalMarkers: string[];
  } {
    const entities: ContextEntity[] = [];
    const relations: ContextRelationCandidate[] = [];
    const temporalSet = new Set<string>();
    const seenEnt = new Set<string>();

    const addEntity = (text: string, type: ContextEntity['type'], segmentId: string) => {
      const clean = text.trim();
      if (!clean || clean.length < 2) return;
      const canonical = clean.toLowerCase();
      const key = `${type}:${canonical}:${segmentId}`;
      if (seenEnt.has(key)) return;
      seenEnt.add(key);
      entities.push({ text: clean, canonical, type, segmentId });
    };

    for (const seg of segments) {
      if (seg.temporalHint) temporalSet.add(seg.temporalHint);

      for (const m of seg.text.matchAll(/\b(?:src|lib|qplus_native|tests|native_data)\/[A-Za-z0-9_.\-/]+\b/g)) {
        addEntity(m[0], 'FILE_PATH', seg.segmentId);
      }
      for (const m of seg.text.matchAll(/\/api\/[A-Za-z0-9_.\-\/:]+/g)) {
        addEntity(m[0], 'API_ROUTE', seg.segmentId);
      }
      for (const m of seg.text.matchAll(/\b[A-Z][A-Za-z0-9]{2,}(?:[A-Z][a-z0-9]+)+\b/g)) {
        addEntity(m[0], 'SYMBOL', seg.segmentId);
      }
      for (const m of seg.text.matchAll(/[\u0E00-\u0E7F]{3,}/g)) {
        addEntity(m[0], 'THAI_TERM', seg.segmentId);
      }
      for (const m of seg.text.matchAll(/\b\d+(?:\.\d+)?(?:ms|mb|gb|%|s)?\b/gi)) {
        addEntity(m[0], 'NUMBER', seg.segmentId);
      }
      if (seg.kind === 'constraint') {
        addEntity(seg.text.slice(0, 64), 'CONSTRAINT', seg.segmentId);
      }

      // Extract explicit SVO / definition relation patterns: "X uses Y", "X depends on Y", "X -> Y", "X คือ Y"
      const relPatterns: Array<{ re: RegExp; pred: string }> = [
        { re: /\b([A-Za-z0-9_.\-/]{3,40})\s+(?:uses|requires|depends on|calls|verifies|implements|contains)\s+([A-Za-z0-9_.\-/]{3,40})/gi, pred: 'DEPENDS_ON' },
        { re: /\b([A-Za-z0-9_.\-/]{3,40})\s+is\s+(?:a|an|the)?\s*([A-Za-z0-9_.\-/ ]{3,40}?)(?:[.,;]|$)/gi, pred: 'IS_A' },
        { re: /([A-Za-z0-9_\u0E00-\u0E7F]{2,32})\s*(?:->|→)\s*([A-Za-z0-9_\u0E00-\u0E7F]{2,32})/g, pred: 'FLOWS_TO' },
        { re: /([\u0E00-\u0E7FA-Za-z0-9_]{2,32})\s+คือ\s+([\u0E00-\u0E7FA-Za-z0-9_ ]{2,40})/g, pred: 'IS_A' },
      ];
      for (const { re, pred } of relPatterns) {
        for (const rm of seg.text.matchAll(re)) {
          const subj = rm[1].trim();
          const obj = rm[2].trim();
          if (subj && obj && subj.toLowerCase() !== obj.toLowerCase()) {
            relations.push({
              subject: subj,
              predicate: pred,
              object: obj,
              segmentId: seg.segmentId,
              confidence: 0.78,
            });
          }
        }
      }
    }

    return {
      entities: entities.slice(0, 120),
      relations: relations.slice(0, 60),
      temporalMarkers: Array.from(temporalSet),
    };
  }

  public detectContextConflicts(segments: ContextSegment[]): ContextConflict[] {
    const conflicts: ContextConflict[] = [];
    const negPairRe = [
      { pos: /\b(allow|enable|online|persist|include|อนุญาต|เปิดใช้|บันทึก)\b/i, neg: /\b(forbid|disable|offline|never|exclude|block|ห้าม|ปิด|ปฏิเสธ)\b/i },
      { pos: /\b(strict|required|must)\b/i, neg: /\b(optional|skip|ignore)\b/i },
    ];

    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i];
        const b = segments[j];

        // Numeric mismatch on shared key constraint (e.g., max=10 vs max=50)
        const numA = a.text.match(/\b(port|limit|timeout|max|min|version|ขั้นตอน|พอร์ต)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        const numB = b.text.match(/\b(port|limit|timeout|max|min|version|ขั้นตอน|พอร์ต)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        if (numA && numB && numA[1].toLowerCase() === numB[1].toLowerCase() && numA[2] !== numB[2]) {
          conflicts.push({
            conflictId: `ctx_num_${i + 1}_${j + 1}`,
            segmentA: a.segmentId,
            segmentB: b.segmentId,
            kind: 'NUMERIC_MISMATCH',
            description: `Conflicting value for '${numA[1]}': ${numA[2]} (${a.segmentId}) vs ${numB[2]} (${b.segmentId}).`,
            severity: 'medium',
          });
        }

        const tokA = new Set(tokenize(a.text));
        const tokB = new Set(tokenize(b.text));
        let shared = 0;
        for (const t of tokA) if (tokB.has(t) && t.length > 3) shared += 1;
        if (shared < 2) continue;

        for (const pair of negPairRe) {
          if ((pair.pos.test(a.text) && pair.neg.test(b.text)) || (pair.neg.test(a.text) && pair.pos.test(b.text))) {
            conflicts.push({
              conflictId: `ctx_conf_${i + 1}_${j + 1}`,
              segmentA: a.segmentId,
              segmentB: b.segmentId,
              kind: 'DIRECTIVE_NEGATION',
              description: `Conflicting directive polarity over shared topic (${shared} shared terms) between ${a.segmentId} and ${b.segmentId}.`,
              severity: 'high',
            });
            break;
          }
        }
      }
    }

    return conflicts;
  }

  public analyzeContext(params: {
    input: string;
    query?: string;
    nativeNeuralState?: 'UNINVOKED' | 'READY' | 'BLOCKED';
  }): ContextAnalysisResult {
    const clean = (params.input || '').trim();
    const segments = this.segmentContext(clean, params.query);
    const intent = this.recognizeIntent(params.query || clean);
    const { entities, relations, temporalMarkers } = this.extractEntitiesAndRelations(segments);
    const conflicts = this.detectContextConflicts(segments);
    const prioritizedOrder = [...segments]
      .sort((a, b) => a.priority - b.priority || b.relevanceScore - a.relevanceScore)
      .map((s) => s.segmentId);

    const contentSha256 = crypto.createHash('sha256').update(clean).digest('hex');

    return {
      contextId: `ctx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      analyzedAt: new Date().toISOString(),
      attribution: 'deterministic_preprocessor',
      nativeNeuralState: params.nativeNeuralState ?? 'UNINVOKED',
      language: detectLang(clean),
      intent,
      segments,
      entities,
      relations,
      conflicts,
      temporalMarkers,
      prioritizedOrder,
      contentSha256,
    };
  }

  /**
   * Cross-session context lifecycle management (strictly tenant + owner scoped).
   */
  public upsertSessionTurn(params: {
    sessionId: string;
    role: 'user' | 'system' | 'assistant';
    text: string;
    scope: ContextScope;
    ttlSeconds?: number;
    pinAsFact?: boolean;
  }): { session: ContextSessionWindow; analysis: ContextAnalysisResult } {
    if (!params.scope.tenantId || !params.scope.userId) {
      throw new Error('VERIFIED_CONTEXT_SCOPE_REQUIRED');
    }
    const key = this.sessionKey(params.scope.tenantId, params.sessionId);
    const existing = this.sessions.get(key);
    if (!existing) {
      for (const s of this.sessions.values()) {
        if (s.sessionId === params.sessionId && s.tenantId !== params.scope.tenantId) {
          AuditLedger.append('SYSTEM', 'CONTEXT_CROSS_TENANT_WRITE_BLOCKED', {
            sessionId: params.sessionId,
            callerTenant: params.scope.tenantId,
            ownerTenant: s.tenantId,
          });
          throw new Error('FORBIDDEN: Cross-tenant context session write denied');
        }
      }
    }
    if (existing && existing.ownerUserId !== params.scope.userId && params.scope.role !== 'admin') {
      AuditLedger.append('SYSTEM', 'CONTEXT_CROSS_USER_ACCESS_BLOCKED', {
        sessionId: params.sessionId,
        tenantId: params.scope.tenantId,
        callerUserId: params.scope.userId,
      });
      throw new Error('FORBIDDEN: Cross-owner context session access denied');
    }

    const analysis = this.analyzeContext({ input: params.text });
    const now = new Date().toISOString();
    const expiresAt =
      typeof params.ttlSeconds === 'number' && params.ttlSeconds > 0
        ? new Date(Date.now() + params.ttlSeconds * 1000).toISOString()
        : existing?.expiresAt;

    const win: ContextSessionWindow = existing || {
      sessionId: params.sessionId,
      tenantId: params.scope.tenantId,
      ownerUserId: params.scope.userId,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      status: 'ACTIVE',
      turns: [],
      pinnedFacts: [],
    };

    const turnId = `turn_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    win.updatedAt = now;
    if (expiresAt) win.expiresAt = expiresAt;
    win.status = 'ACTIVE';
    win.turns.push({
      turnId,
      timestamp: now,
      role: params.role,
      summary: params.text.trim().slice(0, 500),
      intent: analysis.intent.primary,
      entities: analysis.entities.slice(0, 12).map((e) => e.text),
      contentSha256: analysis.contentSha256,
      priority: analysis.segments[0]?.priority ?? 3,
    });
    if (win.turns.length > 50) {
      win.turns = win.turns.slice(-50);
    }

    if (params.pinAsFact) {
      win.pinnedFacts.push({
        factId: `fact_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        text: params.text.trim().slice(0, 320),
        createdAt: now,
        priority: 1,
        sourceTurnId: turnId,
      });
      if (win.pinnedFacts.length > 30) {
        win.pinnedFacts = win.pinnedFacts.slice(-30);
      }
    }

    this.sessions.set(key, win);
    this.persist();

    AuditLedger.append('SYSTEM', 'COGNITIVE_CONTEXT_UPDATED', {
      sessionId: params.sessionId,
      tenantId: params.scope.tenantId,
      intent: analysis.intent.primary,
      segmentsCount: analysis.segments.length,
      conflictsCount: analysis.conflicts.length,
    });

    return { session: win, analysis };
  }

  public getSessionContext(sessionId: string, scope: ContextScope): ContextSessionWindow | null {
    this.purgeExpiredSessions();
    // Enforce tenant isolation: never return another tenant's session even if sessionId matches
    const key = this.sessionKey(scope.tenantId, sessionId);
    const win = this.sessions.get(key);
    if (!win) {
      // Check if session exists under another tenant to log attempted leakage probe
      for (const s of this.sessions.values()) {
        if (s.sessionId === sessionId && s.tenantId !== scope.tenantId) {
          AuditLedger.append('SYSTEM', 'CONTEXT_CROSS_TENANT_READ_BLOCKED', {
            sessionId,
            callerTenant: scope.tenantId,
            ownerTenant: s.tenantId,
          });
          throw new Error('FORBIDDEN: Cross-tenant cognitive context access denied');
        }
      }
      return null;
    }
    if (win.ownerUserId !== scope.userId && scope.role !== 'admin') {
      throw new Error('FORBIDDEN: Cross-owner cognitive context access denied');
    }
    return win;
  }

  public listSessions(scope: ContextScope): ContextSessionWindow[] {
    this.purgeExpiredSessions();
    return Array.from(this.sessions.values())
      .filter(
        (s) =>
          s.tenantId === scope.tenantId &&
          (scope.role === 'admin' || s.ownerUserId === scope.userId)
      )
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  public archiveSession(sessionId: string, scope: ContextScope): ContextSessionWindow | null {
    const win = this.getSessionContext(sessionId, scope);
    if (!win) return null;
    win.status = 'ARCHIVED';
    win.updatedAt = new Date().toISOString();
    this.sessions.set(this.sessionKey(scope.tenantId, sessionId), win);
    this.persist();
    return win;
  }

  public deleteSession(sessionId: string, scope: ContextScope): boolean {
    const win = this.getSessionContext(sessionId, scope);
    if (!win) return false;
    this.sessions.delete(this.sessionKey(scope.tenantId, sessionId));
    this.persist();
    return true;
  }

  public purgeExpiredSessions(): number {
    const now = Date.now();
    let count = 0;
    for (const [k, s] of this.sessions.entries()) {
      if (s.expiresAt && Number.isFinite(Date.parse(s.expiresAt)) && Date.parse(s.expiresAt) <= now) {
        this.sessions.delete(k);
        count += 1;
      }
    }
    if (count > 0) this.persist();
    return count;
  }

  public getSummaryStats(scope?: Partial<ContextScope>) {
    this.purgeExpiredSessions();
    const visible = Array.from(this.sessions.values()).filter(
      (s) => !scope?.tenantId || s.tenantId === scope.tenantId
    );
    const totalTurns = visible.reduce((acc, s) => acc + s.turns.length, 0);
    const activeCount = visible.filter((s) => s.status === 'ACTIVE').length;
    return {
      totalSessions: visible.length,
      activeSessions: activeCount,
      archivedSessions: visible.filter((s) => s.status === 'ARCHIVED').length,
      totalTurns,
      pinnedFactsCount: visible.reduce((acc, s) => acc + s.pinnedFacts.length, 0),
    };
  }
}
