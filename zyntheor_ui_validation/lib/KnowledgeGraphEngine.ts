/**
 * ZYNTHEOR Batch 29 — Provenance-Aware Knowledge Graph Intelligence Engine
 *
 * Integrates cleanly alongside KnowledgeWorkspace & KnowledgeIntelligenceEngine
 * without breaking or replacing existing lexical + TF hybrid retrieval.
 *
 * Capabilities:
 *  - Entity resolution (bilingual English/Thai alias canonicalization)
 *  - (subject, relation, object) relationship extraction from workspace documents
 *  - Temporal fact tracking (validFrom, updatedAt, exponential freshness score)
 *  - Multi-hop graph traversal (1..3 hops) with per-hop document provenance & SHA-256 hash
 *  - Cross-document contradiction detection on triples & assertions
 *  - Graph consistency verification
 *  - Strict tenant & role isolation
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuditLedger } from './AuditLedger.ts';
import { KnowledgeWorkspace, KnowledgeDocument } from './KnowledgeWorkspace.ts';
import { tokenize, detectContradictions } from './KnowledgeIntelligenceEngine.ts';
import { PerformanceEngine } from './PerformanceEngine.ts';
import {
  classifyTruthClaim,
  enforceTruthClaims,
  summarizeTruthClaims,
  type TruthClaimRecord,
  type TruthKernelSummary,
} from './TruthKernel.ts';

export interface KnowledgeGraphNode {
  nodeId: string;
  label: string;
  canonicalKey: string;
  kind: 'CONCEPT' | 'SYSTEM' | 'SECURITY' | 'MODEL' | 'THAI_TERM' | 'METRIC' | 'DOCUMENT';
  aliases: string[];
  documentIds: string[];
  tenantId?: string;
  updatedAt: string;
}

export interface KnowledgeGraphEdge {
  edgeId: string;
  subjectId: string;
  subjectLabel: string;
  relation: string;
  objectId: string;
  objectLabel: string;
  documentId: string;
  documentTitle: string;
  contentHash: string;
  provenance: string;
  confidence: number;
  validFrom: string;
  updatedAt: string;
  freshnessScore: number;
  tenantId?: string;
  snippet: string;
}

export interface GraphContradictionRecord {
  contradictionId: string;
  subjectLabel: string;
  relation: string;
  edgeAId: string;
  edgeBId: string;
  objectA: string;
  objectB: string;
  docAId: string;
  docBId: string;
  reason: string;
  confidence: number;
}

export interface GraphTraversalHop {
  hop: number;
  fromLabel: string;
  relation: string;
  toLabel: string;
  edgeId: string;
  documentId: string;
  documentTitle: string;
  contentHash: string;
  provenance: string;
  freshnessScore: number;
  confidence: number;
}

export interface GraphTraversalResult {
  query: string;
  seedNodes: string[];
  maxHops: number;
  paths: Array<{
    score: number;
    hops: GraphTraversalHop[];
    terminalLabel: string;
    provenanceHashes: string[];
  }>;
  latencyMs: number;
  truthClaims: TruthClaimRecord[];
  truthSummary: TruthKernelSummary;
}

export interface GraphConsistencyReport {
  valid: boolean;
  nodeCount: number;
  edgeCount: number;
  danglingEdgeIds: string[];
  missingProvenanceEdgeIds: string[];
  contradictions: GraphContradictionRecord[];
  staleEdgeCount: number;
  checkedAt: string;
  truthClaims: TruthClaimRecord[];
  truthSummary: TruthKernelSummary;
}

export interface GraphScope {
  tenantId?: string;
  role?: string;
}

const CANONICAL_ALIASES: Array<[RegExp, string, KnowledgeGraphNode['kind']]> = [
  [/^(?:zyntheor|ซินธีออร์|zyntheor\s+q\+)$/i, 'ZYNTHEOR', 'SYSTEM'],
  [/^(?:native\s*lm|nativelm|pureseqlm|โมเดลภาษาท้องถิ่น|โมเดลภาษา)$/i, 'NativeLM', 'MODEL'],
  [/^(?:audit\s*ledger|auditledger|sha-?256\s+chain)$/i, 'AuditLedger', 'SECURITY'],
  [/^(?:hmac|hmac-sha256|timingsafeequal|crypto\.timingsafeequal)$/i, 'HMAC_TimingSafeEqual', 'SECURITY'],
  [/^(?:knowledge\s+workspace|คลังปัญญาความรู้)$/i, 'KnowledgeWorkspace', 'SYSTEM'],
  [/^(?:episodic\s+memory|ความจำ|native\s*memory)$/i, 'NativeMemory', 'SYSTEM'],
  [/^(?:tokenizer|โทเคไนเซอร์|sovereign\s+tokenizer)$/i, 'SovereignTokenizer', 'MODEL'],
];

export class KnowledgeGraphEngine {
  private static instance: KnowledgeGraphEngine | null = null;
  private filePath: string;
  private nodes = new Map<string, KnowledgeGraphNode>();
  private edges: KnowledgeGraphEdge[] = [];

  private constructor() {
    this.filePath = process.env.ZYNTHEOR_KG_FILE
      ? path.resolve(process.env.ZYNTHEOR_KG_FILE)
      : path.resolve(process.cwd(), 'native_data', 'knowledge', 'knowledge_graph.json');
    this.loadFromDisk();
  }

  public static getInstance(): KnowledgeGraphEngine {
    if (!KnowledgeGraphEngine.instance) {
      KnowledgeGraphEngine.instance = new KnowledgeGraphEngine();
    }
    return KnowledgeGraphEngine.instance;
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
      if (Array.isArray(parsed?.nodes)) {
        for (const n of parsed.nodes) {
          if (n?.nodeId) this.nodes.set(n.nodeId, n);
        }
      }
      if (Array.isArray(parsed?.edges)) {
        this.edges = parsed.edges;
      }
    } catch {
      this.nodes.clear();
      this.edges = [];
    }
  }

  private persist(): void {
    this.ensureDir();
    const tmp = `${this.filePath}.tmp.${process.pid}`;
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        {
          version: 'ZYNTHEOR_KG_V1',
          updatedAt: new Date().toISOString(),
          nodes: Array.from(this.nodes.values()),
          edges: this.edges,
        },
        null,
        2
      ),
      'utf8'
    );
    fs.renameSync(tmp, this.filePath);
  }

  public resolveCanonicalEntity(raw: string): { canonical: string; displayLabel: string; kind: KnowledgeGraphNode['kind'] } {
    const cleaned = raw.trim().replace(/^["'`\[(]+|["'`\])]+$/g, '').replace(/\s+/g, ' ');
    for (const [pat, label, kind] of CANONICAL_ALIASES) {
      if (pat.test(cleaned)) {
        return { canonical: label.toLowerCase(), displayLabel: label, kind };
      }
    }
    const hasThai = /[\u0E00-\u0E7F]/.test(cleaned);
    const hasDigit = /\d/.test(cleaned);
    const kind: KnowledgeGraphNode['kind'] = hasThai
      ? 'THAI_TERM'
      : hasDigit
      ? 'METRIC'
      : 'CONCEPT';
    return { canonical: cleaned.toLowerCase(), displayLabel: cleaned, kind };
  }

  private nodeKey(canonical: string, tenantId?: string): string {
    const scopePart = tenantId || 'global';
    return `kgn_${crypto.createHash('sha1').update(`${scopePart}::${canonical}`).digest('hex').slice(0, 12)}`;
  }

  private computeFreshness(isoTime: string): number {
    const ts = Date.parse(isoTime);
    if (!Number.isFinite(ts)) return 0.5;
    const ageDays = Math.max(0, (Date.now() - ts) / 86_400_000);
    return Number(Math.exp(-ageDays / 60).toFixed(3));
  }

  private extractTriplesFromDocument(doc: KnowledgeDocument): Array<{
    subject: string;
    relation: string;
    object: string;
    confidence: number;
    snippet: string;
  }> {
    const triples: Array<{ subject: string; relation: string; object: string; confidence: number; snippet: string }> = [];
    const lines = doc.content.split(/\n+/).map((l) => l.trim()).filter((l) => l.length >= 8);

    const patterns: Array<{ re: RegExp; rel: string; conf: number }> = [
      {
        re: /\b([A-Za-z0-9_.\-/ ]{3,45}?)\s+(?:(?:must|should)\s+(?:always|never)\s+|(?:always|never)\s+|must\s+)?(?:utilize|utilizes|uses|enforce|enforces|require|requires|depends on|guarantee|guarantees|contain|contains)\s+([A-Za-z0-9_.\-+/()=: ]{3,75}?)(?:[.;,\n]|$)/gi,
        rel: 'REQUIRES_OR_USES',
        conf: 0.86,
      },
      {
        re: /\b([A-Za-z0-9_.\-/ ]{3,45}?)\s+(?:is|are|represents)\s+(?:a|an|the)?\s*([A-Za-z0-9_.\-+/()=: ]{3,75}?)(?:[.;,\n]|$)/gi,
        rel: 'IS_A',
        conf: 0.8,
      },
      {
        re: /([A-Za-z0-9_\u0E00-\u0E7F ]{2,40})\s*(?:->|→)\s*([A-Za-z0-9_\u0E00-\u0E7F ]{2,40})/g,
        rel: 'LEADS_TO',
        conf: 0.88,
      },
      {
        re: /([\u0E00-\u0E7FA-Za-z0-9_ ]{2,40}?)\s+(?:คือ|ใช้|รองรับ|รับประกัน|ต้องมี)\s+([\u0E00-\u0E7FA-Za-z0-9_+.\-/() ]{2,65})/g,
        rel: 'THAI_ASSERTION',
        conf: 0.84,
      },
    ];

    for (const line of lines) {
      const cleanLine = line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '');
      for (const { re, rel, conf } of patterns) {
        for (const m of cleanLine.matchAll(re)) {
          const s = m[1].trim();
          const o = m[2].trim();
          if (s.length >= 2 && o.length >= 2 && s.toLowerCase() !== o.toLowerCase() && s.split(' ').length <= 6) {
            triples.push({ subject: s, relation: rel, object: o, confidence: conf, snippet: cleanLine.slice(0, 180) });
          }
        }
      }
      // Also link document title/collection anchor to key headings or tags for reliable multi-hop reachability
      if (line.startsWith('#')) {
        const heading = cleanLine.slice(0, 56);
        if (heading.length >= 4 && doc.tags[0]) {
          triples.push({
            subject: doc.tags[0],
            relation: 'COVERED_IN',
            object: heading,
            confidence: 0.72,
            snippet: cleanLine.slice(0, 180),
          });
        }
      }
    }

    // Tag-to-tag structural linkage within the document
    for (let i = 0; i < Math.min(doc.tags.length - 1, 3); i++) {
      triples.push({
        subject: doc.tags[i],
        relation: 'RELATED_DOMAIN',
        object: doc.tags[i + 1],
        confidence: 0.7,
        snippet: `Document '${doc.title}' tags: ${doc.tags.join(', ')}`,
      });
    }

    return triples.slice(0, 32);
  }

  /**
   * Builds/refreshes the provenance-aware graph from accessible KnowledgeWorkspace documents.
   * Respects tenant boundaries strictly: scoped documents only link within that tenant (or unscoped global docs).
   */
  public buildFromWorkspace(scope?: GraphScope): {
    nodesCount: number;
    edgesCount: number;
    documentsProcessed: number;
    contradictionsCount: number;
  } {
    const kw = KnowledgeWorkspace.getInstance();
    const docs = kw.listDocuments(scope ? { tenantId: scope.tenantId, role: scope.role } : undefined);

    // Clear previous edges belonging to the target tenant (or all if unscoped rebuild)
    if (scope?.tenantId) {
      this.edges = this.edges.filter((e) => e.tenantId !== scope.tenantId);
    } else {
      this.edges = [];
      this.nodes.clear();
    }

    const upsertNode = (rawLabel: string, doc: KnowledgeDocument): KnowledgeGraphNode => {
      const resolved = this.resolveCanonicalEntity(rawLabel);
      const id = this.nodeKey(resolved.canonical, doc.tenantId);
      const existing = this.nodes.get(id);
      if (existing) {
        if (!existing.aliases.includes(rawLabel.trim())) {
          existing.aliases = [...existing.aliases, rawLabel.trim()].slice(0, 12);
        }
        if (!existing.documentIds.includes(doc.id)) {
          existing.documentIds.push(doc.id);
        }
        existing.updatedAt = doc.updatedAt;
        return existing;
      }
      const created: KnowledgeGraphNode = {
        nodeId: id,
        label: resolved.displayLabel,
        canonicalKey: resolved.canonical,
        kind: resolved.kind,
        aliases: [rawLabel.trim()],
        documentIds: [doc.id],
        tenantId: doc.tenantId,
        updatedAt: doc.updatedAt,
      };
      this.nodes.set(id, created);
      return created;
    };

    const edgeSeen = new Set<string>();
    for (const doc of docs) {
      const triples = this.extractTriplesFromDocument(doc);
      for (const tr of triples) {
        const sNode = upsertNode(tr.subject, doc);
        const oNode = upsertNode(tr.object, doc);
        if (sNode.nodeId === oNode.nodeId) continue;

        const edgeSig = `${doc.id}::${sNode.nodeId}::${tr.relation}::${oNode.nodeId}`;
        if (edgeSeen.has(edgeSig)) continue;
        edgeSeen.add(edgeSig);

        this.edges.push({
          edgeId: `kge_${crypto.createHash('sha1').update(edgeSig).digest('hex').slice(0, 12)}`,
          subjectId: sNode.nodeId,
          subjectLabel: sNode.label,
          relation: tr.relation,
          objectId: oNode.nodeId,
          objectLabel: oNode.label,
          documentId: doc.id,
          documentTitle: doc.title,
          contentHash: doc.contentHash,
          provenance: doc.provenance,
          confidence: tr.confidence,
          validFrom: doc.createdAt,
          updatedAt: doc.updatedAt,
          freshnessScore: this.computeFreshness(doc.updatedAt),
          tenantId: doc.tenantId,
          snippet: tr.snippet,
        });
      }
    }

    this.persist();
    if (scope?.tenantId) {
      PerformanceEngine.getInstance().invalidateTenantNamespace(scope.tenantId, 'kg_traverse');
    }

    const contradictions = this.detectGraphContradictions(scope);
    AuditLedger.append('SYSTEM', 'KNOWLEDGE_GRAPH_REBUILT', {
      tenantId: scope?.tenantId || 'global',
      documentsProcessed: docs.length,
      nodesCount: this.getScopedNodes(scope).length,
      edgesCount: this.getScopedEdges(scope).length,
      contradictionsCount: contradictions.length,
    });

    return {
      nodesCount: this.getScopedNodes(scope).length,
      edgesCount: this.getScopedEdges(scope).length,
      documentsProcessed: docs.length,
      contradictionsCount: contradictions.length,
    };
  }

  private getScopedEdges(scope?: GraphScope): KnowledgeGraphEdge[] {
    if (!scope?.tenantId) return [...this.edges];
    return this.edges.filter((e) => !e.tenantId || e.tenantId === scope.tenantId);
  }

  private getScopedNodes(scope?: GraphScope): KnowledgeGraphNode[] {
    const all = Array.from(this.nodes.values());
    if (!scope?.tenantId) return all;
    return all.filter((n) => !n.tenantId || n.tenantId === scope.tenantId);
  }

  /**
   * Multi-hop BFS traversal (1..3 hops) returning full provenance chains.
   */
  public traverseMultiHop(
    query: string,
    options: { maxHops?: number; limit?: number; scope?: GraphScope } = {}
  ): GraphTraversalResult {
    const t0 = Date.now();
    const maxHops = Math.min(3, Math.max(1, options.maxHops ?? 2));
    const limit = Math.min(20, Math.max(1, options.limit ?? 8));
    const tenantKey = options.scope?.tenantId || 'global';
    const cacheKey = `${query.trim().toLowerCase()}::h=${maxHops}::l=${limit}`;

    const perf = PerformanceEngine.getInstance();
    const cached = perf.getCached<GraphTraversalResult>('kg_traverse', tenantKey, cacheKey);
    if (cached) return cached;

    if (this.edges.length === 0) {
      this.buildFromWorkspace(options.scope);
    }

    const scopedNodes = this.getScopedNodes(options.scope);
    const scopedEdges = this.getScopedEdges(options.scope);
    const qLower = query.toLowerCase().trim();
    const qTokens = new Set(tokenize(query));

    // Identify seed nodes matching query tokens or canonical aliases
    const seedNodes = scopedNodes
      .map((n) => {
        let score = 0;
        if (qLower.includes(n.canonicalKey) || n.canonicalKey.includes(qLower)) score += 3;
        for (const al of n.aliases) {
          if (qLower.includes(al.toLowerCase())) score += 2.5;
        }
        for (const tok of tokenize(n.label)) {
          if (qTokens.has(tok)) score += 1.2;
        }
        return { node: n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.node);

    // Build adjacency list over scoped edges (undirected traversal keeping directional provenance)
    const adj = new Map<string, KnowledgeGraphEdge[]>();
    for (const e of scopedEdges) {
      const listS = adj.get(e.subjectId) || [];
      listS.push(e);
      adj.set(e.subjectId, listS);

      const listO = adj.get(e.objectId) || [];
      listO.push(e);
      adj.set(e.objectId, listO);
    }

    const paths: GraphTraversalResult['paths'] = [];
    for (const seed of seedNodes) {
      interface QueueState {
        nodeId: string;
        hops: GraphTraversalHop[];
        visited: Set<string>;
      }
      const queue: QueueState[] = [{ nodeId: seed.nodeId, hops: [], visited: new Set([seed.nodeId]) }];

      while (queue.length > 0 && paths.length < 40) {
        const cur = queue.shift()!;
        if (cur.hops.length > 0) {
          const score =
            cur.hops.reduce((acc, h) => acc + h.confidence * h.freshnessScore, 0) / cur.hops.length -
            (cur.hops.length - 1) * 0.08;
          paths.push({
            score: Number(Math.max(0.05, score).toFixed(3)),
            hops: cur.hops,
            terminalLabel: cur.hops[cur.hops.length - 1].toLabel,
            provenanceHashes: Array.from(new Set(cur.hops.map((h) => h.contentHash).filter(Boolean))),
          });
        }
        if (cur.hops.length >= maxHops) continue;

        for (const edge of adj.get(cur.nodeId) || []) {
          const forward = edge.subjectId === cur.nodeId;
          const nextId = forward ? edge.objectId : edge.subjectId;
          if (cur.visited.has(nextId)) continue;

          const nextVisited = new Set(cur.visited);
          nextVisited.add(nextId);
          queue.push({
            nodeId: nextId,
            visited: nextVisited,
            hops: [
              ...cur.hops,
              {
                hop: cur.hops.length + 1,
                fromLabel: forward ? edge.subjectLabel : edge.objectLabel,
                relation: forward ? edge.relation : `INVERSE_${edge.relation}`,
                toLabel: forward ? edge.objectLabel : edge.subjectLabel,
                edgeId: edge.edgeId,
                documentId: edge.documentId,
                documentTitle: edge.documentTitle,
                contentHash: edge.contentHash,
                provenance: edge.provenance,
                freshnessScore: edge.freshnessScore,
                confidence: edge.confidence,
              },
            ],
          });
        }
      }
    }

    paths.sort((a, b) => b.score - a.score || b.hops.length - a.hops.length);
    const slicedPaths = paths.slice(0, limit);
    const allHashes = Array.from(new Set(slicedPaths.flatMap((p) => p.provenanceHashes).filter(Boolean)));
    const traversalClaims = enforceTruthClaims([
      classifyTruthClaim({
        domain: 'knowledge_graph',
        statement:
          slicedPaths.length > 0
            ? `Traversed ${slicedPaths.length} knowledge-graph path(s) across ${seedNodes.length} seed node(s) with ${allHashes.length} SHA-256 provenance hash(es)`
            : `No provenance-backed knowledge-graph path matched query '${query.slice(0, 64)}'`,
        classification: slicedPaths.length > 0 && allHashes.length > 0 ? 'VERIFIED_FACT' : 'UNVERIFIED',
        basis:
          slicedPaths.length > 0
            ? 'Direct graph BFS traversal bounded to tenant-scoped document hashes'
            : 'Zero matching entity edges in scoped workspace graph',
        evidenceRefs: allHashes.slice(0, 8),
      }),
    ]);

    const result: GraphTraversalResult = {
      query,
      seedNodes: seedNodes.map((n) => n.label),
      maxHops,
      paths: slicedPaths,
      latencyMs: Date.now() - t0,
      truthClaims: traversalClaims,
      truthSummary: summarizeTruthClaims(traversalClaims),
    };

    perf.setCached('kg_traverse', tenantKey, cacheKey, result);
    return result;
  }

  public detectGraphContradictions(scope?: GraphScope): GraphContradictionRecord[] {
    const scopedEdges = this.getScopedEdges(scope);
    const contradictions: GraphContradictionRecord[] = [];
    const seen = new Set<string>();

    // 1. Conflicting object values for same canonical subject + relation across different docs
    for (let i = 0; i < scopedEdges.length; i++) {
      for (let j = i + 1; j < scopedEdges.length; j++) {
        const a = scopedEdges[i];
        const b = scopedEdges[j];
        if (a.documentId === b.documentId) continue;
        if (a.subjectId === b.subjectId && a.relation === b.relation && a.objectId !== b.objectId) {
          // Check opposing polarity or numeric mismatch in snippets
          const numA = a.objectLabel.match(/\b(\d+(?:,\d+)*(?:\.\d+)?)\b/);
          const numB = b.objectLabel.match(/\b(\d+(?:,\d+)*(?:\.\d+)?)\b/);
          const negRe = /\b(never|forbidden|disabled|not supported|no|ห้าม|ไม่ใช่)\b/i;
          const posRe = /\b(always|must|required|enabled|supported|อนุญาต|ต้อง)\b/i;
          const polarityClash =
            (negRe.test(a.snippet) && posRe.test(b.snippet)) || (posRe.test(a.snippet) && negRe.test(b.snippet));

          if ((numA && numB && numA[1] !== numB[1]) || polarityClash) {
            const pairKey = [a.edgeId, b.edgeId].sort().join(':');
            if (seen.has(pairKey)) continue;
            seen.add(pairKey);
            contradictions.push({
              contradictionId: `kgc_${crypto.createHash('sha1').update(pairKey).digest('hex').slice(0, 10)}`,
              subjectLabel: a.subjectLabel,
              relation: a.relation,
              edgeAId: a.edgeId,
              edgeBId: b.edgeId,
              objectA: a.objectLabel,
              objectB: b.objectLabel,
              docAId: a.documentId,
              docBId: b.documentId,
              reason: polarityClash
                ? `Opposing assertion polarity for '${a.subjectLabel}' across '${a.documentTitle}' vs '${b.documentTitle}'`
                : `Conflicting numeric assertion for '${a.subjectLabel}' (${numA?.[1]} vs ${numB?.[1]})`,
              confidence: polarityClash ? 0.84 : 0.79,
            });
          }
        }
      }
    }

    // 2. Fallback snippet-level contradiction pass
    const textFlags = detectContradictions(
      scopedEdges.slice(0, 40).map((e) => ({ documentId: e.documentId, text: e.snippet }))
    );
    for (const tf of textFlags) {
      const edgeA = scopedEdges.find((e) => e.documentId === tf.docA && e.snippet === tf.snippetA);
      const edgeB = scopedEdges.find((e) => e.documentId === tf.docB && e.snippet === tf.snippetB);
      if (edgeA && edgeB) {
        const pairKey = [edgeA.edgeId, edgeB.edgeId].sort().join(':');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        contradictions.push({
          contradictionId: `kgc_${crypto.createHash('sha1').update(pairKey).digest('hex').slice(0, 10)}`,
          subjectLabel: edgeA.subjectLabel,
          relation: edgeA.relation,
          edgeAId: edgeA.edgeId,
          edgeBId: edgeB.edgeId,
          objectA: edgeA.objectLabel,
          objectB: edgeB.objectLabel,
          docAId: edgeA.documentId,
          docBId: edgeB.documentId,
          reason: tf.reason,
          confidence: tf.confidence,
        });
      }
    }

    return contradictions;
  }

  public verifyGraphConsistency(scope?: GraphScope): GraphConsistencyReport {
    const nodes = this.getScopedNodes(scope);
    const edges = this.getScopedEdges(scope);
    const nodeIds = new Set(nodes.map((n) => n.nodeId));

    const danglingEdgeIds = edges
      .filter((e) => !nodeIds.has(e.subjectId) || !nodeIds.has(e.objectId))
      .map((e) => e.edgeId);

    const missingProvenanceEdgeIds = edges
      .filter((e) => !e.documentId || !e.contentHash || e.contentHash.length !== 64 || !e.provenance)
      .map((e) => e.edgeId);

    const staleEdgeCount = edges.filter((e) => e.freshnessScore < 0.25).length;
    const contradictions = this.detectGraphContradictions(scope);
    const valid = danglingEdgeIds.length === 0 && missingProvenanceEdgeIds.length === 0;

    const rawClaims: TruthClaimRecord[] = [
      classifyTruthClaim({
        domain: 'knowledge_graph',
        statement: `Graph consistency check across ${nodes.length} node(s) and ${edges.length} edge(s): valid=${valid}`,
        classification: valid ? 'VERIFIED_FACT' : 'UNVERIFIED',
        basis: `dangling=${danglingEdgeIds.length}, missingProvenance=${missingProvenanceEdgeIds.length}`,
      }),
    ];
    if (contradictions.length > 0) {
      rawClaims.push(
        classifyTruthClaim({
          domain: 'knowledge_graph',
          statement: `${contradictions.length} cross-document contradiction(s) detected in knowledge graph`,
          classification: 'CONTRADICTED',
          basis: 'Triple/assertion polarity and numeric conflict check',
          evidenceRefs: contradictions.slice(0, 5).map((c) => c.contradictionId),
        })
      );
    }
    if (staleEdgeCount > 0) {
      rawClaims.push(
        classifyTruthClaim({
          domain: 'knowledge_graph',
          statement: `${staleEdgeCount} edge(s) have low temporal freshness (<0.25) and may require re-verification`,
          classification: 'ASSUMPTION',
          basis: 'Exponential freshness decay heuristic',
        })
      );
    }
    const truthClaims = enforceTruthClaims(rawClaims);

    return {
      valid,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      danglingEdgeIds,
      missingProvenanceEdgeIds,
      contradictions,
      staleEdgeCount,
      checkedAt: new Date().toISOString(),
      truthClaims,
      truthSummary: summarizeTruthClaims(truthClaims),
    };
  }

  public getGraphSummary(scope?: GraphScope) {
    if (this.edges.length === 0) {
      this.buildFromWorkspace(scope);
    }
    const nodes = this.getScopedNodes(scope);
    const edges = this.getScopedEdges(scope);
    const consistency = this.verifyGraphConsistency(scope);
    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      contradictionsCount: consistency.contradictions.length,
      consistencyValid: consistency.valid,
      topNodes: nodes.slice(0, 12),
      recentEdges: edges.slice(0, 15),
      truthClaims: consistency.truthClaims,
      truthSummary: consistency.truthSummary,
    };
  }
}
