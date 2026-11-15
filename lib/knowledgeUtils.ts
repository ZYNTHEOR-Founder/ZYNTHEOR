/**
 * Shared knowledge utilities — no imports from Workspace/Engine (breaks cycles).
 */
import crypto from 'crypto';

export function detectLang(text: string): 'th' | 'en' | 'mixed' {
  const thai = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  if (thai > 0 && latin > 0) return 'mixed';
  if (thai > latin) return 'th';
  return 'en';
}

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
      const tail = acc.slice(-overlap);
      acc = tail && u.length + tail.length < maxSize ? `${tail}\n${u}` : u;
    }
  }
  if (acc) merged.push(acc);
  return merged.length > 0 ? merged : text.trim() ? [text.trim()] : [];
}

export function contentHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export class RetrievalQueryLeakageError extends Error {
  public readonly matchedTargets: string[];
  constructor(message: string, matchedTargets: string[]) {
    super(message);
    this.name = 'RetrievalQueryLeakageError';
    this.matchedTargets = matchedTargets;
  }
}

export class TrainEvalOverlapError extends Error {
  public readonly overlapCount: number;
  public readonly overlappingHashes: string[];
  constructor(message: string, overlapCount: number, overlappingHashes: string[]) {
    super(message);
    this.name = 'TrainEvalOverlapError';
    this.overlapCount = overlapCount;
    this.overlappingHashes = overlappingHashes;
  }
}

export function normalizeIntegrityText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectRetrievalQueryLeakage(
  query: string,
  targetAnswers: Array<string | number>,
  options: { minTokenLength?: number } = {}
): { leaked: boolean; matchedTargets: string[] } {
  const minTokenLength = options.minTokenLength ?? 2;
  const normQuery = normalizeIntegrityText(query);
  if (!normQuery) {
    return { leaked: false, matchedTargets: [] };
  }

  const matchedTargets: string[] = [];
  for (const rawTarget of targetAnswers) {
    if (rawTarget === null || rawTarget === undefined) continue;
    const targetStr = String(rawTarget);
    const normTarget = normalizeIntegrityText(targetStr);
    if (!normTarget) continue;

    // Require boundary-aware check for short or purely numeric/ASCII-word tokens to avoid trivial substring noise,
    // while catching exact multi-word / Thai / numeric answer leakage reliably.
    if (normTarget.length < minTokenLength && normQuery !== normTarget) {
      continue;
    }

    const isAsciiWordOrNumber = /^[a-z0-9_.,-]+$/i.test(normTarget);
    let matched = false;
    if (isAsciiWordOrNumber) {
      const pattern = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(normTarget)}([^a-z0-9_]|$)`, 'i');
      matched = pattern.test(normQuery);
    } else {
      matched = normQuery.includes(normTarget);
    }

    if (matched) {
      matchedTargets.push(targetStr);
    }
  }

  return {
    leaked: matchedTargets.length > 0,
    matchedTargets,
  };
}

export function assertRetrievalQueryNoTargetLeakage(
  query: string,
  targetAnswers: Array<string | number>,
  options: { minTokenLength?: number } = {}
): void {
  const check = detectRetrievalQueryLeakage(query, targetAnswers, options);
  if (check.leaked) {
    throw new RetrievalQueryLeakageError(
      `FAIL_CLOSED: Retrieval query contains prohibited target answer value(s): ${check.matchedTargets.join(', ')}`,
      check.matchedTargets
    );
  }
}

export function assertDisjointTrainEvalSamples(
  trainSamples: Array<{ id?: string; text: string }>,
  evalSamples: Array<{ id?: string; text: string }>
): { disjoint: true; trainCount: number; evalCount: number } {
  const trainHashes = new Set<string>();
  const trainIds = new Set<string>();

  for (const sample of trainSamples) {
    const norm = normalizeIntegrityText(sample.text);
    if (norm) {
      trainHashes.add(contentHash(norm));
    }
    if (sample.id) {
      trainIds.add(sample.id);
    }
  }

  const overlappingHashes: string[] = [];
  const overlappingIds: string[] = [];
  for (const sample of evalSamples) {
    const norm = normalizeIntegrityText(sample.text);
    if (norm) {
      const h = contentHash(norm);
      if (trainHashes.has(h)) {
        overlappingHashes.push(h);
      }
    }
    if (sample.id && trainIds.has(sample.id)) {
      overlappingIds.push(sample.id);
    }
  }

  const totalOverlaps = overlappingHashes.length + overlappingIds.length;
  if (totalOverlaps > 0) {
    throw new TrainEvalOverlapError(
      `FAIL_CLOSED: Overlapping train/evaluation samples detected (${overlappingHashes.length} content overlaps, ${overlappingIds.length} ID overlaps).`,
      totalOverlaps,
      overlappingHashes
    );
  }

  return {
    disjoint: true,
    trainCount: trainSamples.length,
    evalCount: evalSamples.length,
  };
}

