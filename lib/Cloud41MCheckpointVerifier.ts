/**
 * ZYNTHEOR 41.5M Cloud Checkpoint Pre-Load Verification & Runtime Loader
 * Fetches a 41,527,808-parameter checkpoint from Cloud Object Storage, computes
 * container + Float32 payload SHA-256 digests, validates exact parameter count and
 * tensor finiteness, and fails closed if any check fails before loading into Native Runtime.
 */

import crypto from 'crypto';
import { CloudObjectStorageService } from './CloudObjectStorageService.ts';
import { NativeNeuralLMProvider } from './providers.ts';
import { ConnectivityMonitor } from './ConnectivityMonitor.ts';
import { AuditLedger } from './AuditLedger.ts';

export const TARGET_41M_PARAM_COUNT = 41_527_808;
const MAGIC_HEADER = 'ZYNTHEOR_QPLUS_PT';

export const KNOWN_41M_BASELINES = [
  {
    label: 'architecture-audit-baseline',
    sha256: '18ed252176ec16f5e00c4a416d454b914f0e2a5f822103726c50177af8314ddd',
    source: 'docs/archive/legacy/artifacts/target-checkpoint-architecture-audit.json',
  },
  {
    label: 'target-training-step1000-baseline',
    sha256: '022b94d666a955f97fe8b6d6a8dd4332bd427cce02a60cca43729eceb5b42fe8',
    source: 'docs/target-training-evidence.json',
  },
] as const;

export type VerificationGateStatus =
  | 'VERIFIED'
  | 'REJECTED_PARAM_MISMATCH'
  | 'REJECTED_SHA256_MISMATCH'
  | 'REJECTED_CORRUPTED'
  | 'FETCH_FAILED';

export interface Cloud41MVerificationReport {
  verified: boolean;
  gateStatus: VerificationGateStatus;
  sourceUri: string;
  provider: 's3' | 'presigned_url' | 'buffer';
  byteSize: number;
  containerSha256: string;
  payloadSha256: string;
  embeddedSha256: string | null;
  expectedSha256: string | null;
  sha256Verified: boolean;
  matchedBaselineLabel: string | null;
  expectedParams: number;
  actualParams: number;
  metadataDeclaredParams: number | null;
  paramCountVerified: boolean;
  finiteWeightsVerified: boolean;
  architecture: string | null;
  storageMode: string | null;
  trainingSteps: number | null;
  tokenizerProfile: string | null;
  metadata: Record<string, any>;
  reason: string;
  checkedAt: string;
}

export interface RuntimeActivationReport {
  activated: boolean;
  sha256Matched: boolean;
  activeParamsMatched: boolean;
  inferenceReady: boolean;
  runtimeState: string | null;
  activeRuntimeId: string | null;
  runtimeSha256: string | null;
  verifiedPayloadSha256: string;
  verifiedContainerSha256: string;
  checkedAt: string;
}

export interface Cloud41MFetchVerifyLoadResult {
  success: boolean;
  stage: 'FETCH' | 'VERIFY' | 'RUNTIME_LOAD' | 'COMPLETE';
  fetchLatencyMs: number | null;
  verifyLatencyMs: number | null;
  loadLatencyMs: number | null;
  verification: Cloud41MVerificationReport | null;
  runtimeLoaded: boolean;
  runtimeActivation: RuntimeActivationReport | null;
  runtimeStatus: Record<string, any> | null;
  error: string | null;
}

/**
 * Pure verification of a downloaded `.pt` container buffer against 41,527,808 parameter count
 * and SHA-256 integrity prior to any runtime load.
 */
export function verifyCheckpointBufferFor41M(
  buffer: Buffer,
  opts: {
    sourceUri: string;
    provider?: 's3' | 'presigned_url' | 'buffer';
    expectedSha256?: string;
    expectedParams?: number;
  }
): Cloud41MVerificationReport {
  const checkedAt = new Date().toISOString();
  const expectedParams = opts.expectedParams ?? TARGET_41M_PARAM_COUNT;
  const expectedShaNormalized = opts.expectedSha256?.trim().toLowerCase() || null;
  const containerSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const fail = (
    gateStatus: VerificationGateStatus,
    reason: string,
    partial?: Partial<Cloud41MVerificationReport>
  ): Cloud41MVerificationReport => ({
    verified: false,
    gateStatus,
    sourceUri: opts.sourceUri,
    provider: opts.provider || 'buffer',
    byteSize: buffer.length,
    containerSha256,
    payloadSha256: partial?.payloadSha256 || '',
    embeddedSha256: partial?.embeddedSha256 ?? null,
    expectedSha256: expectedShaNormalized,
    sha256Verified: partial?.sha256Verified ?? false,
    matchedBaselineLabel: partial?.matchedBaselineLabel ?? null,
    expectedParams,
    actualParams: partial?.actualParams ?? 0,
    metadataDeclaredParams: partial?.metadataDeclaredParams ?? null,
    paramCountVerified: partial?.paramCountVerified ?? false,
    finiteWeightsVerified: partial?.finiteWeightsVerified ?? false,
    architecture: partial?.architecture ?? null,
    storageMode: partial?.storageMode ?? null,
    trainingSteps: partial?.trainingSteps ?? null,
    tokenizerProfile: partial?.tokenizerProfile ?? null,
    metadata: partial?.metadata || {},
    reason,
    checkedAt,
  });

  if (buffer.length < MAGIC_HEADER.length + 4) {
    return fail('REJECTED_CORRUPTED', `Container buffer too short (${buffer.length} bytes).`);
  }

  const magic = buffer.subarray(0, MAGIC_HEADER.length).toString('utf8');
  if (magic !== MAGIC_HEADER) {
    return fail('REJECTED_CORRUPTED', `Invalid checkpoint magic header '${magic}' (expected '${MAGIC_HEADER}').`);
  }

  const metaLen = buffer.readUInt32BE(MAGIC_HEADER.length);
  const metaStart = MAGIC_HEADER.length + 4;
  const metaEnd = metaStart + metaLen;
  if (metaLen <= 0 || metaEnd > buffer.length) {
    return fail('REJECTED_CORRUPTED', `Metadata length ${metaLen} exceeds container bounds (${buffer.length} bytes).`);
  }

  let metadata: Record<string, any>;
  try {
    metadata = JSON.parse(buffer.subarray(metaStart, metaEnd).toString('utf8'));
  } catch (err: any) {
    return fail('REJECTED_CORRUPTED', `Malformed JSON metadata block: ${err?.message || err}`);
  }

  const weightBytes = buffer.subarray(metaEnd);
  if (weightBytes.length % 4 !== 0) {
    return fail(
      'REJECTED_CORRUPTED',
      `Float32 payload byte length (${weightBytes.length}) is not a multiple of 4.`,
      { metadata }
    );
  }

  const actualParams = weightBytes.length / 4;
  const metadataDeclaredParams =
    typeof metadata.total_params === 'number' && Number.isFinite(metadata.total_params)
      ? metadata.total_params
      : null;

  const payloadSha256 = crypto.createHash('sha256').update(weightBytes).digest('hex');
  const embeddedShaRaw =
    typeof metadata.sha256 === 'string'
      ? metadata.sha256
      : typeof metadata.payload_sha256 === 'string'
        ? metadata.payload_sha256
        : null;
  const embeddedSha256 = embeddedShaRaw ? embeddedShaRaw.trim().toLowerCase() : null;

  const matchedBaseline =
    KNOWN_41M_BASELINES.find(
      (b) => b.sha256 === containerSha256 || b.sha256 === payloadSha256
    ) || null;

  const embeddedShaMatches = !embeddedSha256 || embeddedSha256 === payloadSha256;
  const expectedShaMatches =
    !expectedShaNormalized ||
    expectedShaNormalized === containerSha256 ||
    expectedShaNormalized === payloadSha256;
  const sha256Verified = embeddedShaMatches && expectedShaMatches;

  const paramCountVerified =
    actualParams === expectedParams &&
    (metadataDeclaredParams === null || metadataDeclaredParams === expectedParams);

  const metaFields = {
    payloadSha256,
    embeddedSha256,
    matchedBaselineLabel: matchedBaseline?.label || null,
    actualParams,
    metadataDeclaredParams,
    architecture: typeof metadata.architecture === 'string' ? metadata.architecture : null,
    storageMode: typeof metadata.storage_mode === 'string' ? metadata.storage_mode : null,
    trainingSteps:
      typeof metadata.training_steps_total === 'number'
        ? metadata.training_steps_total
        : typeof metadata.training_steps === 'number'
          ? metadata.training_steps
          : null,
    tokenizerProfile: typeof metadata.tokenizer_profile === 'string' ? metadata.tokenizer_profile : null,
    metadata,
  };

  if (!embeddedShaMatches) {
    return fail(
      'REJECTED_SHA256_MISMATCH',
      `Embedded metadata SHA-256 (${embeddedSha256}) does not match computed Float32 payload SHA-256 (${payloadSha256}).`,
      { ...metaFields, sha256Verified: false, paramCountVerified }
    );
  }

  if (!expectedShaMatches) {
    return fail(
      'REJECTED_SHA256_MISMATCH',
      `Expected SHA-256 (${expectedShaNormalized}) does not match container (${containerSha256}) or payload (${payloadSha256}).`,
      { ...metaFields, sha256Verified: false, paramCountVerified }
    );
  }

  if (!paramCountVerified) {
    return fail(
      'REJECTED_PARAM_MISMATCH',
      `Parameter count verification failed: expected ${expectedParams.toLocaleString()} params, got payload=${actualParams.toLocaleString()} params` +
        (metadataDeclaredParams !== null ? ` (metadata=${metadataDeclaredParams.toLocaleString()})` : '') +
        '.',
      { ...metaFields, sha256Verified, paramCountVerified: false }
    );
  }

  // Check finiteness of every Float32 parameter
  const aligned = new Uint8Array(weightBytes.length);
  aligned.set(weightBytes);
  const f32 = new Float32Array(aligned.buffer);
  for (let i = 0; i < f32.length; i++) {
    if (!Number.isFinite(f32[i])) {
      return fail(
        'REJECTED_CORRUPTED',
        `Non-finite Float32 weight detected at parameter index ${i}.`,
        { ...metaFields, sha256Verified, paramCountVerified, finiteWeightsVerified: false }
      );
    }
  }

  return {
    verified: true,
    gateStatus: 'VERIFIED',
    sourceUri: opts.sourceUri,
    provider: opts.provider || 'buffer',
    byteSize: buffer.length,
    containerSha256,
    payloadSha256,
    embeddedSha256,
    expectedSha256: expectedShaNormalized,
    sha256Verified: true,
    matchedBaselineLabel: matchedBaseline?.label || null,
    expectedParams,
    actualParams,
    metadataDeclaredParams,
    paramCountVerified: true,
    finiteWeightsVerified: true,
    architecture: metaFields.architecture,
    storageMode: metaFields.storageMode,
    trainingSteps: metaFields.trainingSteps,
    tokenizerProfile: metaFields.tokenizerProfile,
    metadata,
    reason: `Verified ${actualParams.toLocaleString()} finite Float32 parameters · Container SHA-256 ${containerSha256.slice(0, 16)}… · Payload SHA-256 ${payloadSha256.slice(0, 16)}…`,
    checkedAt,
  };
}

/**
 * Orchestrates:
 * 1. Fetch 41.5M checkpoint bytes from Cloud Object Storage (S3 or Presigned URL)
 * 2. Compute SHA-256 digests and verify exact 41,527,808 parameter count + weight finiteness
 * 3. Only if verification succeeds (and verifyOnly !== true), load into Native Runtime
 */
export async function fetchVerifyAndLoad41MCheckpoint(opts: {
  objectKey?: string;
  presignedUrl?: string;
  expectedSha256?: string;
  verifyOnly?: boolean;
}): Promise<Cloud41MFetchVerifyLoadResult> {
  let fetchLatencyMs: number | null = null;
  let verifyLatencyMs: number | null = null;
  let loadLatencyMs: number | null = null;

  AuditLedger.emitWorkflowEvent({
    source: 'checkpoint_recovery',
    tag: 'RESEARCH',
    isRunning: true,
    message: `Checkpoint Recovery: fetching 41.5M artifact (${opts.objectKey || opts.presignedUrl || 'configured cloud source'})`,
  });

  let artifact;
  try {
    artifact = await CloudObjectStorageService.readCheckpointArtifact({
      objectKey: opts.objectKey,
      presignedUrl: opts.presignedUrl,
    });
    fetchLatencyMs = artifact.fetchLatencyMs;
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    AuditLedger.append('SYSTEM', 'CLOUD_41M_CHECKPOINT_FETCH_FAILED', {
      objectKey: opts.objectKey || null,
      error: errMsg,
    });
    AuditLedger.emitWorkflowEvent({
      source: 'checkpoint_recovery',
      tag: 'ERROR',
      isRunning: false,
      message: `FAIL_CLOSED: Checkpoint Recovery fetch failed — ${errMsg}`,
    });
    return {
      success: false,
      stage: 'FETCH',
      fetchLatencyMs,
      verifyLatencyMs: null,
      loadLatencyMs: null,
      verification: null,
      runtimeLoaded: false,
      runtimeActivation: null,
      runtimeStatus: null,
      error: errMsg,
    };
  }

  const verifyStart = Date.now();
  const verification = verifyCheckpointBufferFor41M(artifact.buffer, {
    sourceUri: artifact.sourceUri,
    provider: artifact.provider,
    expectedSha256: opts.expectedSha256,
    expectedParams: TARGET_41M_PARAM_COUNT,
  });
  verifyLatencyMs = Math.max(1, Date.now() - verifyStart);

  AuditLedger.append('SYSTEM', 'CLOUD_41M_CHECKPOINT_VERIFIED', {
    sourceUri: verification.sourceUri,
    verified: verification.verified,
    gateStatus: verification.gateStatus,
    actualParams: verification.actualParams,
    expectedParams: verification.expectedParams,
    containerSha256: verification.containerSha256,
    payloadSha256: verification.payloadSha256,
    matchedBaselineLabel: verification.matchedBaselineLabel,
  });

  if (!verification.verified) {
    AuditLedger.emitWorkflowEvent({
      source: 'checkpoint_recovery',
      tag: 'ERROR',
      isRunning: false,
      message: `FAIL_CLOSED: Checkpoint Recovery verification rejected (${verification.gateStatus}) — ${verification.reason}`,
    });
    return {
      success: false,
      stage: 'VERIFY',
      fetchLatencyMs,
      verifyLatencyMs,
      loadLatencyMs: null,
      verification,
      runtimeLoaded: false,
      runtimeActivation: null,
      runtimeStatus: null,
      error: `FAIL_CLOSED: ${verification.reason}`,
    };
  }

  AuditLedger.emitWorkflowEvent({
    source: 'checkpoint_recovery',
    tag: 'RESEARCH',
    isRunning: !opts.verifyOnly,
    message: `Checkpoint Recovery verified: ${(verification.byteSize / (1024 * 1024)).toFixed(2)} MB · ${verification.actualParams.toLocaleString()} Float32 params · payload SHA-256 ${verification.payloadSha256.slice(0, 16)}…`,
  });

  if (opts.verifyOnly) {
    return {
      success: true,
      stage: 'VERIFY',
      fetchLatencyMs,
      verifyLatencyMs,
      loadLatencyMs: null,
      verification,
      runtimeLoaded: false,
      runtimeActivation: null,
      runtimeStatus: null,
      error: null,
    };
  }

  const loadStart = Date.now();
  try {
    const provider = NativeNeuralLMProvider.getInstance();
    const runtimeStatus = await provider.loadVerifiedCloudBytes(artifact.buffer, {
      sourceUri: artifact.sourceUri,
      objectKey: opts.objectKey,
      presignedUrl: opts.presignedUrl,
    });
    const pingSnapshot = await provider.ping().catch(() => null);
    loadLatencyMs = Math.max(1, Date.now() - loadStart);

    const effectiveStatus = pingSnapshot || runtimeStatus;
    const runtimeShaRaw =
      effectiveStatus?.checkpoint_sha256 ||
      effectiveStatus?.checkpoint_hash ||
      runtimeStatus?.checkpoint_sha256 ||
      runtimeStatus?.checkpoint_hash ||
      '';
    const runtimeSha = String(runtimeShaRaw).trim().toLowerCase();
    const sha256Matched = Boolean(
      runtimeSha &&
        (runtimeSha === verification.payloadSha256.toLowerCase() ||
          runtimeSha === verification.containerSha256.toLowerCase())
    );
    const activeParamsMatched = Number(effectiveStatus?.active_params) === TARGET_41M_PARAM_COUNT;
    const inferenceReady = Boolean(effectiveStatus?.inference_ready);

    const runtimeOk = Boolean(
      effectiveStatus?.weights_loaded &&
        (runtimeStatus?.execution_verified || effectiveStatus?.execution_verified) &&
        effectiveStatus?.runtime_state === 'READY' &&
        activeParamsMatched &&
        sha256Matched
    );

    const runtimeActivation: RuntimeActivationReport = {
      activated: runtimeOk,
      sha256Matched,
      activeParamsMatched,
      inferenceReady,
      runtimeState: effectiveStatus?.runtime_state ? String(effectiveStatus.runtime_state) : null,
      activeRuntimeId: effectiveStatus?.active_runtime_id ? String(effectiveStatus.active_runtime_id) : null,
      runtimeSha256: runtimeSha || null,
      verifiedPayloadSha256: verification.payloadSha256,
      verifiedContainerSha256: verification.containerSha256,
      checkedAt: new Date().toISOString(),
    };

    if (!runtimeOk) {
      const reason = !sha256Matched
        ? `FAIL_CLOSED: Runtime Activation parity check failed — Native Runtime reported SHA-256 '${runtimeSha || 'none'}', expected verified payload '${verification.payloadSha256}' or container '${verification.containerSha256}'.`
        : effectiveStatus?.error ||
          effectiveStatus?.readiness_reason ||
          `Native Runtime rejected checkpoint load (active_params=${effectiveStatus?.active_params}, state=${effectiveStatus?.runtime_state}).`;

      AuditLedger.emitWorkflowEvent({
        source: 'runtime_activation',
        tag: 'ERROR',
        isRunning: false,
        message: reason,
      });

      return {
        success: false,
        stage: 'RUNTIME_LOAD',
        fetchLatencyMs,
        verifyLatencyMs,
        loadLatencyMs,
        verification,
        runtimeLoaded: false,
        runtimeActivation,
        runtimeStatus: effectiveStatus,
        error: reason,
      };
    }

    await ConnectivityMonitor.getInstance().checkNow(opts.presignedUrl).catch(() => null);
    AuditLedger.append('SYSTEM', 'CLOUD_41M_CHECKPOINT_LOADED_RUNTIME', {
      sourceUri: verification.sourceUri,
      containerSha256: verification.containerSha256,
      payloadSha256: verification.payloadSha256,
      runtimeSha256: runtimeActivation.runtimeSha256,
      sha256Matched: runtimeActivation.sha256Matched,
      activeParams: effectiveStatus.active_params,
      runtimeId: runtimeActivation.activeRuntimeId,
    });

    AuditLedger.emitWorkflowEvent({
      source: 'runtime_activation',
      tag: 'CODER',
      isRunning: false,
      verificationHash: verification.containerSha256,
      durationMs: loadLatencyMs,
      message: `Runtime Activation verified: ${runtimeActivation.activeRuntimeId || 'zyn-rt'} loaded exact SHA-256 ${runtimeSha.slice(0, 16)}… (${TARGET_41M_PARAM_COUNT.toLocaleString()} params, state=READY)`,
    });

    return {
      success: true,
      stage: 'COMPLETE',
      fetchLatencyMs,
      verifyLatencyMs,
      loadLatencyMs,
      verification,
      runtimeLoaded: true,
      runtimeActivation,
      runtimeStatus: effectiveStatus,
      error: null,
    };
  } catch (err: any) {
    loadLatencyMs = Math.max(1, Date.now() - loadStart);
    const errMsg = String(err?.message || err);
    AuditLedger.emitWorkflowEvent({
      source: 'runtime_activation',
      tag: 'ERROR',
      isRunning: false,
      message: `FAIL_CLOSED: Runtime Activation failed — ${errMsg}`,
    });
    return {
      success: false,
      stage: 'RUNTIME_LOAD',
      fetchLatencyMs,
      verifyLatencyMs,
      loadLatencyMs,
      verification,
      runtimeLoaded: false,
      runtimeActivation: null,
      runtimeStatus: null,
      error: errMsg,
    };
  }
}
