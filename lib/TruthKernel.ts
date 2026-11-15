/**
 * ZYNTHEOR Core 0.3 — Truth Kernel & Cryptographic Execution Verification
 *
 * Enforces Zero-Simulation epistemic discipline across all intelligence subsystems:
 *  - Every claim emitted by Cognitive, Reasoning, Knowledge Graph, Memory, Performance,
 *    and Execution engines MUST carry an explicit TruthClassification.
 *  - Every completed execution record MUST carry deterministic timestamps, duration,
 *    outcome, and a verifiable SHA-256 executionEvidenceHash.
 */

import crypto from 'crypto';

export type TruthClassification =
  | 'VERIFIED_FACT'
  | 'ASSUMPTION'
  | 'UNVERIFIED'
  | 'CONTRADICTED'
  | 'PROPOSED';

export const VALID_TRUTH_CLASSIFICATIONS = new Set<TruthClassification>([
  'VERIFIED_FACT',
  'ASSUMPTION',
  'UNVERIFIED',
  'CONTRADICTED',
  'PROPOSED',
]);

export interface TruthClaimRecord {
  claimId: string;
  domain:
    | 'cognitive_context'
    | 'adaptive_reasoning'
    | 'knowledge_graph'
    | 'memory_controller'
    | 'performance_engine'
    | 'execution_orchestrator'
    | 'capability_gate';
  statement: string;
  classification: TruthClassification;
  basis: string;
  evidenceRefs?: string[];
  evidenceHash: string;
  timestamp: string;
}

export interface TruthKernelSummary {
  totalClaims: number;
  countsByClass: Record<TruthClassification, number>;
  verifiedCount: number;
  unverifiedCount: number;
  contradictedCount: number;
  assumptionCount: number;
  proposedCount: number;
  allClassified: boolean;
}

export function classifyTruthClaim(input: {
  claimId?: string;
  domain: TruthClaimRecord['domain'];
  statement: string;
  classification: TruthClassification;
  basis: string;
  evidenceRefs?: string[];
}): TruthClaimRecord {
  if (!VALID_TRUTH_CLASSIFICATIONS.has(input.classification)) {
    throw new Error(`TRUTH_KERNEL_VIOLATION: Invalid claim classification '${String(input.classification)}'`);
  }
  const statement = String(input.statement || '').trim();
  const basis = String(input.basis || '').trim();
  if (!statement || !basis) {
    throw new Error('TRUTH_KERNEL_VIOLATION: Truth claim requires non-empty statement and basis');
  }
  const evidenceRefs = Array.isArray(input.evidenceRefs)
    ? input.evidenceRefs.map((r) => String(r)).filter(Boolean)
    : undefined;
  const timestamp = new Date().toISOString();
  const canonicalPayload = JSON.stringify({
    domain: input.domain,
    statement,
    classification: input.classification,
    basis,
    evidenceRefs: evidenceRefs || [],
  });
  const evidenceHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  return {
    claimId:
      input.claimId ||
      `claim_${input.domain.slice(0, 6)}_${evidenceHash.slice(0, 10)}`,
    domain: input.domain,
    statement,
    classification: input.classification,
    basis,
    ...(evidenceRefs && evidenceRefs.length > 0 ? { evidenceRefs } : {}),
    evidenceHash,
    timestamp,
  };
}

export function enforceTruthClaims(claims: TruthClaimRecord[]): TruthClaimRecord[] {
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new Error('TRUTH_KERNEL_VIOLATION: Missing required Truth Kernel claims');
  }
  for (const c of claims) {
    if (!c || !VALID_TRUTH_CLASSIFICATIONS.has(c.classification)) {
      throw new Error(`TRUTH_KERNEL_VIOLATION: Unclassified or invalid truth claim '${c?.claimId || 'unknown'}'`);
    }
    if (!c.statement || !c.basis || !/^[a-f0-9]{64}$/i.test(c.evidenceHash || '')) {
      throw new Error(`TRUTH_KERNEL_VIOLATION: Claim '${c.claimId}' lacks statement, basis, or SHA-256 evidenceHash`);
    }
  }
  return claims;
}

export function summarizeTruthClaims(claims: TruthClaimRecord[]): TruthKernelSummary {
  const countsByClass: Record<TruthClassification, number> = {
    VERIFIED_FACT: 0,
    ASSUMPTION: 0,
    UNVERIFIED: 0,
    CONTRADICTED: 0,
    PROPOSED: 0,
  };
  let allClassified = claims.length > 0;
  for (const c of claims) {
    if (!c || !VALID_TRUTH_CLASSIFICATIONS.has(c.classification)) {
      allClassified = false;
      continue;
    }
    countsByClass[c.classification] += 1;
  }
  return {
    totalClaims: claims.length,
    countsByClass,
    verifiedCount: countsByClass.VERIFIED_FACT,
    unverifiedCount: countsByClass.UNVERIFIED,
    contradictedCount: countsByClass.CONTRADICTED,
    assumptionCount: countsByClass.ASSUMPTION,
    proposedCount: countsByClass.PROPOSED,
    allClassified,
  };
}

export interface ExecutionEvidenceHashInput {
  executionId: string;
  taskId: string;
  startTimestamp: string;
  finishTimestamp: string;
  executionDurationMs: number;
  executionResult: string;
  artifacts: Array<{ path: string; bytes: number; verified: boolean }>;
  testsPassed: number;
  testsTotal: number;
}

export function computeExecutionEvidenceHash(input: ExecutionEvidenceHashInput): string {
  const normalizedArtifacts = (Array.isArray(input.artifacts) ? input.artifacts : []).map((a) => ({
    path: String(a.path || ''),
    bytes: Number(a.bytes || 0),
    verified: Boolean(a.verified),
  }));
  const canonical = JSON.stringify({
    executionId: String(input.executionId || ''),
    taskId: String(input.taskId || ''),
    startTimestamp: String(input.startTimestamp || ''),
    finishTimestamp: String(input.finishTimestamp || ''),
    executionDurationMs: Number(input.executionDurationMs),
    executionResult: String(input.executionResult || ''),
    artifacts: normalizedArtifacts,
    testsPassed: Number(input.testsPassed || 0),
    testsTotal: Number(input.testsTotal || 0),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

const VALID_EXECUTION_RESULTS = new Set(['DELIVERED', 'BLOCKED', 'FAILED']);

export function verifyExecutionEvidenceRecord(rec: any): { valid: boolean; reason?: string } {
  if (!rec || typeof rec !== 'object') {
    return { valid: false, reason: 'Execution record is not an object' };
  }
  const executionId = typeof rec.executionId === 'string' ? rec.executionId.trim() : '';
  const taskId = typeof rec.taskId === 'string' ? rec.taskId.trim() : '';
  const startTimestamp = typeof rec.startTimestamp === 'string' ? rec.startTimestamp : '';
  const finishTimestamp = typeof rec.finishTimestamp === 'string' ? rec.finishTimestamp : '';
  const executionDurationMs = Number(rec.executionDurationMs);
  const executionResult = typeof rec.executionResult === 'string' ? rec.executionResult : '';
  const executionEvidenceHash = typeof rec.executionEvidenceHash === 'string' ? rec.executionEvidenceHash : '';

  if (!executionId || !taskId) {
    return { valid: false, reason: 'Missing executionId or taskId' };
  }
  const startMs = Date.parse(startTimestamp);
  const finishMs = Date.parse(finishTimestamp);
  if (!Number.isFinite(startMs) || !Number.isFinite(finishMs) || finishMs < startMs) {
    return { valid: false, reason: 'Invalid or non-monotonic startTimestamp/finishTimestamp' };
  }
  if (!Number.isFinite(executionDurationMs) || executionDurationMs < 0) {
    return { valid: false, reason: 'Invalid executionDurationMs' };
  }
  if (!VALID_EXECUTION_RESULTS.has(executionResult)) {
    return { valid: false, reason: `Invalid executionResult '${executionResult}'` };
  }
  if (!/^[a-f0-9]{64}$/i.test(executionEvidenceHash)) {
    return { valid: false, reason: 'Missing or malformed SHA-256 executionEvidenceHash' };
  }

  const expectedHash = computeExecutionEvidenceHash({
    executionId,
    taskId,
    startTimestamp,
    finishTimestamp,
    executionDurationMs,
    executionResult,
    artifacts: Array.isArray(rec.artifacts) ? rec.artifacts : [],
    testsPassed: Number(rec.testsPassed || 0),
    testsTotal: Number(rec.testsTotal || 0),
  });
  if (expectedHash !== executionEvidenceHash.toLowerCase()) {
    return { valid: false, reason: 'executionEvidenceHash mismatch (record tampered or fabricated)' };
  }
  return { valid: true };
}
