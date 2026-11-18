import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApprovalGate } from '../../lib/ApprovalGate.ts';
import {
  CloudObjectStorageService,
  type S3ClientLike,
} from '../../lib/CloudObjectStorageService.ts';
import {
  TARGET_41M_PARAM_COUNT,
  verifyCheckpointBufferFor41M,
} from '../../lib/Cloud41MCheckpointVerifier.ts';
import { AuditLedger, type WorkflowRuntimeEvent } from '../../lib/AuditLedger.ts';
import {
  build5800VerificationSchedule,
  getTrainingLoopExecutionStatus,
  initializeTrainingPipeline,
  probeNativeNumpyEnvironment,
  startInitializedTrainingLoop,
} from '../../lib/NativeNumpyTrainingService.ts';
import { deriveWorkflowSnapshot } from '../utils/workflowStages.ts';
import { CloudPreflightService } from '../services/CloudPreflightService.ts';
import { TrainingInitializer } from '../modules/ResearchLab.tsx';

function buildValidPtBuffer(paramCount: number, opts?: { corruptSha?: boolean; injectNaN?: boolean }): {
  buffer: Buffer;
  payloadSha256: string;
  containerSha256: string;
} {
  const weights = Buffer.allocUnsafe(paramCount * 4);
  const f32View = new Float32Array(weights.buffer, weights.byteOffset, paramCount);
  // Zero-filled by allocUnsafe? Zero explicitly so tests are deterministic and finite
  f32View.fill(0.0125);
  if (opts?.injectNaN && paramCount > 0) {
    f32View[0] = Number.NaN;
  }
  const payloadSha256 = crypto.createHash('sha256').update(weights).digest('hex');
  const metaJson = JSON.stringify({
    architecture: 'PureSeqLM',
    total_params: paramCount,
    sha256: opts?.corruptSha ? '0'.repeat(64) : payloadSha256,
    training_steps_total: 1000,
    tokenizer_profile: 'v2_base',
  });
  const metaBuf = Buffer.from(metaJson, 'utf8');
  const magicBuf = Buffer.from('ZYNTHEOR_QPLUS_PT', 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(metaBuf.length, 0);
  const buffer = Buffer.concat([magicBuf, lenBuf, metaBuf, weights]);
  const containerSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { buffer, payloadSha256, containerSha256 };
}

async function runTests() {
  const prevApprovalsFile = process.env.ZYNTHEOR_APPROVALS_FILE;
  const tempApprovalsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-approvals-test-'));
  process.env.ZYNTHEOR_APPROVALS_FILE = path.join(tempApprovalsDir, 'approval_requests.json');

  // 1. CloudObjectStorageService: missing credentials fail closed
  const prevEnv = {
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_REGION: process.env.S3_REGION,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
  };
  try {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;

    const missingRes = await CloudObjectStorageService.testBucketConnection({
      overrides: { S3_BUCKET: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' },
    });
    assert.equal(missingRes.success, false);
    assert.equal(missingRes.validConfig, false);
    assert.equal(missingRes.errorCode, 'MISSING_CREDENTIALS');

    // 2. CloudObjectStorageService: mocked S3 client full read/write/delete probe roundtrip
    const memStore = new Map<string, Buffer>();
    memStore.set(
      'checkpoints/model_checkpoint_target_41m.pt',
      Buffer.concat([Buffer.from('ZYNTHEOR_QPLUS_PT', 'utf8'), Buffer.from('\x00\x00\x00\x02{}')])
    );
    let denyCheckpointRead = false;
    CloudObjectStorageService.setClientFactoryForTesting((): S3ClientLike => ({
      async send(command: any) {
        const name = command?.constructor?.name || '';
        const key = command?.input?.Key;
        if (name === 'HeadBucketCommand') {
          return { $metadata: { httpStatusCode: 200 } };
        }
        if (name === 'HeadObjectCommand') {
          if (!memStore.has(key)) {
            const err: any = new Error('NotFound');
            err.$metadata = { httpStatusCode: 404 };
            err.name = 'NotFound';
            throw err;
          }
          return {
            $metadata: { httpStatusCode: 200 },
            ContentLength: memStore.get(key)!.length,
            ETag: '"etag-ckpt"',
            LastModified: new Date('2026-11-17T00:00:00Z'),
          };
        }
        if (name === 'ListObjectsV2Command') {
          return {
            Contents: Array.from(memStore.entries()).map(([k, buf]) => ({
              Key: k,
              Size: buf.length,
              LastModified: new Date('2026-11-17T00:00:00Z'),
              ETag: '"etag-mock"',
            })),
          };
        }
        if (name === 'PutObjectCommand') {
          memStore.set(key, Buffer.from(command.input.Body));
          return { $metadata: { httpStatusCode: 200 } };
        }
        if (name === 'GetObjectCommand') {
          if (denyCheckpointRead && key === 'checkpoints/model_checkpoint_target_41m.pt') {
            const err: any = new Error('AccessDenied');
            err.$metadata = { httpStatusCode: 403 };
            err.name = 'AccessDenied';
            throw err;
          }
          const buf = memStore.get(key);
          if (!buf) throw new Error('NoSuchKey');
          let outBuf = buf;
          if (typeof command?.input?.Range === 'string' && command.input.Range.startsWith('bytes=')) {
            const [s, e] = command.input.Range.slice(6).split('-').map((n: string) => Number(n));
            outBuf = buf.subarray(Number.isFinite(s) ? s : 0, Number.isFinite(e) ? e + 1 : buf.length);
          }
          return {
            $metadata: { httpStatusCode: 200 },
            Body: {
              async transformToByteArray() {
                return new Uint8Array(outBuf);
              },
            },
          };
        }
        if (name === 'DeleteObjectCommand') {
          memStore.delete(key);
          return { $metadata: { httpStatusCode: 204 } };
        }
        throw new Error(`Unexpected S3 command ${name}`);
      },
      destroy() {},
    }));

    const rwRes = await CloudObjectStorageService.testBucketConnection({
      verifyReadWrite: true,
      objectKey: 'checkpoints/model_checkpoint_target_41m.pt',
      overrides: {
        S3_BUCKET: 'zyntheor-test-bucket',
        S3_ACCESS_KEY_ID: 'AKIA_TEST',
        S3_SECRET_ACCESS_KEY: 'SECRET_TEST',
        S3_REGION: 'us-east-1',
      },
    });
    assert.equal(rwRes.success, true);
    assert.equal(rwRes.preflightReady, true);
    assert.equal(rwRes.bucketReachable, true);
    assert.equal(rwRes.readVerified, true);
    assert.equal(rwRes.writeVerified, true);
    assert.equal(rwRes.cleanupVerified, true);
    assert.equal(rwRes.roundtripSha256Match, true);
    assert.equal(rwRes.objectExists, true);
    assert.equal(rwRes.artifacts.length, 1);
    assert.equal(memStore.size, 1, 'probe object must be cleaned up after R/W test');

    // Missing checkpoint object (404) passes R/W probe but preflightReady MUST remain false
    const missingObjRes = await CloudObjectStorageService.testBucketConnection({
      verifyReadWrite: true,
      objectKey: 'checkpoints/does_not_exist.pt',
      overrides: {
        S3_BUCKET: 'zyntheor-test-bucket',
        S3_ACCESS_KEY_ID: 'AKIA_TEST',
        S3_SECRET_ACCESS_KEY: 'SECRET_TEST',
        S3_REGION: 'us-east-1',
      },
    });
    assert.equal(missingObjRes.success, true);
    assert.equal(missingObjRes.objectExists, false);
    assert.equal(missingObjRes.preflightReady, false);

    // 2b. Dedicated runCloudPreflight checks
    const preflightMissingCreds = await CloudObjectStorageService.runCloudPreflight({
      overrides: { S3_BUCKET: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' },
    });
    assert.equal(preflightMissingCreds.passed, false);
    assert.equal(preflightMissingCreds.status, 'PREFLIGHT_BLOCKED');
    assert.equal(preflightMissingCreds.checks.credentialsValid, false);
    assert.ok(preflightMissingCreds.blockers.includes('missing_s3_credentials'));

    const preflightMissingCkpt = await CloudObjectStorageService.runCloudPreflight({
      objectKey: 'checkpoints/does_not_exist.pt',
      overrides: {
        S3_BUCKET: 'zyntheor-test-bucket',
        S3_ACCESS_KEY_ID: 'AKIA_TEST',
        S3_SECRET_ACCESS_KEY: 'SECRET_TEST',
        S3_REGION: 'us-east-1',
      },
    });
    assert.equal(preflightMissingCkpt.passed, false);
    assert.equal(preflightMissingCkpt.status, 'PREFLIGHT_BLOCKED');
    assert.equal(preflightMissingCkpt.checks.credentialsValid, true);
    assert.equal(preflightMissingCkpt.checks.bucketAvailable, true);
    assert.equal(preflightMissingCkpt.checks.checkpointExists, false);
    assert.equal(preflightMissingCkpt.checks.checkpointAccessible, false);

    denyCheckpointRead = true;
    const preflightDeniedCkpt = await CloudObjectStorageService.runCloudPreflight({
      objectKey: 'checkpoints/model_checkpoint_target_41m.pt',
      overrides: {
        S3_BUCKET: 'zyntheor-test-bucket',
        S3_ACCESS_KEY_ID: 'AKIA_TEST',
        S3_SECRET_ACCESS_KEY: 'SECRET_TEST',
        S3_REGION: 'us-east-1',
      },
    });
    denyCheckpointRead = false;
    assert.equal(preflightDeniedCkpt.passed, false);
    assert.equal(preflightDeniedCkpt.checks.checkpointExists, true);
    assert.equal(preflightDeniedCkpt.checks.checkpointAccessible, false);

    const preflightPass = await CloudObjectStorageService.runCloudPreflight({
      objectKey: 'checkpoints/model_checkpoint_target_41m.pt',
      overrides: {
        S3_BUCKET: 'zyntheor-test-bucket',
        S3_ACCESS_KEY_ID: 'AKIA_TEST',
        S3_SECRET_ACCESS_KEY: 'SECRET_TEST',
        S3_REGION: 'us-east-1',
      },
    });
    assert.equal(preflightPass.passed, true);
    assert.equal(preflightPass.status, 'PREFLIGHT_PASS');
    assert.equal(preflightPass.checks.credentialsValid, true);
    assert.equal(preflightPass.checks.bucketAvailable, true);
    assert.equal(preflightPass.checks.checkpointExists, true);
    assert.equal(preflightPass.checks.checkpointAccessible, true);
    assert.equal(preflightPass.checks.readWriteVerified, true);
    assert.equal(preflightPass.headerMagicValid, true);

    // 2c. AWS_* environment alias fallback + uploadTrainingTelemetryObject
    process.env.AWS_S3_BUCKET = 'zyntheor-test-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_ALIAS_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'SECRET_ALIAS_TEST';
    process.env.AWS_REGION = 'us-east-1';
    const aliasPreflight = await CloudObjectStorageService.runCloudPreflight({
      silent: true,
      objectKey: 'checkpoints/model_checkpoint_target_41m.pt',
    });
    assert.equal(aliasPreflight.passed, true);
    assert.equal(aliasPreflight.bucket, 'zyntheor-test-bucket');

    const telemetrySync = await CloudObjectStorageService.uploadTrainingTelemetryObject(
      'metrics/test_pipe/pipeline_metrics_latest.json',
      JSON.stringify({ warmStartSteps: 2800, continuationSteps: 3000 }),
      'application/json'
    );
    assert.equal(telemetrySync.sourceUri, 's3://zyntheor-test-bucket/metrics/test_pipe/pipeline_metrics_latest.json');
    assert.equal(telemetrySync.httpStatusCode, 200);
    assert.ok(memStore.has('metrics/test_pipe/pipeline_metrics_latest.json'));

    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
  } finally {
    CloudObjectStorageService.setClientFactoryForTesting(undefined);
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  // 3. Cloud41MCheckpointVerifier: exact 41,527,808 parameter + SHA-256 verification
  const valid41M = buildValidPtBuffer(TARGET_41M_PARAM_COUNT);
  const okReport = verifyCheckpointBufferFor41M(valid41M.buffer, {
    sourceUri: 's3://zyntheor-test-bucket/checkpoints/model_checkpoint_target_41m.pt',
    provider: 's3',
    expectedSha256: valid41M.containerSha256,
  });
  assert.equal(okReport.verified, true);
  assert.equal(okReport.gateStatus, 'VERIFIED');
  assert.equal(okReport.actualParams, 41_527_808);
  assert.equal(okReport.paramCountVerified, true);
  assert.equal(okReport.sha256Verified, true);
  assert.equal(okReport.finiteWeightsVerified, true);

  // Reject wrong parameter count
  const smallBuf = buildValidPtBuffer(1024);
  const mismatchParams = verifyCheckpointBufferFor41M(smallBuf.buffer, {
    sourceUri: 's3://zyntheor-test-bucket/checkpoints/small.pt',
  });
  assert.equal(mismatchParams.verified, false);
  assert.equal(mismatchParams.gateStatus, 'REJECTED_PARAM_MISMATCH');
  assert.equal(mismatchParams.paramCountVerified, false);

  // Reject SHA-256 mismatch
  const mismatchSha = verifyCheckpointBufferFor41M(valid41M.buffer, {
    sourceUri: 's3://zyntheor-test-bucket/checkpoints/model_checkpoint_target_41m.pt',
    expectedSha256: 'f'.repeat(64),
  });
  assert.equal(mismatchSha.verified, false);
  assert.equal(mismatchSha.gateStatus, 'REJECTED_SHA256_MISMATCH');
  assert.equal(mismatchSha.sha256Verified, false);

  // Reject NaN tensor weights
  const nanBuf = buildValidPtBuffer(TARGET_41M_PARAM_COUNT, { injectNaN: true });
  const nanReport = verifyCheckpointBufferFor41M(nanBuf.buffer, {
    sourceUri: 's3://zyntheor-test-bucket/checkpoints/nan.pt',
  });
  assert.equal(nanReport.verified, false);
  assert.equal(nanReport.gateStatus, 'REJECTED_CORRUPTED');
  assert.equal(nanReport.finiteWeightsVerified, false);

  // 4. NativeNumpyTrainingService: 5,800-step verification checkpoint schedule & fail-closed initializer
  const schedule = build5800VerificationSchedule({
    startStep: 0,
    targetSteps: 5800,
    evalEvery: 25,
    saveEvery: 100,
  });
  assert.equal(schedule.plannedRunSteps, 5800);
  assert.equal(schedule.finalStep, 5800);
  assert.equal(schedule.checkpointCount, 58);
  assert.equal(schedule.evalCount, 232);
  assert.equal(schedule.milestones[0].globalStep, 100);
  assert.equal(schedule.milestones[0].kind, 'periodic_verification');
  assert.equal(schedule.milestones[57].globalStep, 5800);
  assert.equal(schedule.milestones[57].kind, 'final_verification');

  const envProbe = await probeNativeNumpyEnvironment();
  assert.equal(envProbe.pythonAvailable, true);
  assert.ok(['NUMPY_NATIVE_READY', 'NP_COMPAT_ONLY_BLOCKED'].includes(envProbe.status));

  const initSnap = await initializeTrainingPipeline({
    targetSteps: 5800,
    evalEvery: 25,
    saveEvery: 100,
    humanApprovalConfirmed: false,
  });
  assert.equal(initSnap.trainingExecuted, false);
  assert.equal(initSnap.canExecuteTraining, false);
  assert.equal(initSnap.status, 'BLOCKED');
  assert.equal(initSnap.schedule.targetSteps, 5800);
  assert.equal(initSnap.schedule.checkpointCount, 58);
  assert.ok(initSnap.gates.some((g) => g.id === 'cloud_preflight' && !g.passed));
  assert.equal(initSnap.cloudPreflight.passed, false);
  assert.ok(initSnap.blockers.includes('human_approval_confirmation_missing'));
  assert.ok(fs.existsSync(path.resolve(process.cwd(), initSnap.manifestPath)));

  // Execution strictly refuses to start when Cloud Preflight / blockers fail + emits real workflow events
  const emittedEvents: WorkflowRuntimeEvent[] = [];
  const unsub = AuditLedger.subscribeWorkflowEvents((ev) => emittedEvents.push(ev));
  try {
    const startAttempt = await startInitializedTrainingLoop({
      targetSteps: 5800,
      humanApprovalConfirmed: false,
    });
    assert.equal(startAttempt.started, false);
    assert.ok(startAttempt.error && startAttempt.error.includes('FAIL_CLOSED'));
    assert.equal(getTrainingLoopExecutionStatus().trainingCompletedVerified, false);

    assert.ok(emittedEvents.some((e) => e.tag === 'PLANNER'));
    assert.ok(emittedEvents.some((e) => e.tag === 'ERROR'));
    const wfSnap = deriveWorkflowSnapshot({
      logs: emittedEvents.map((e) => e.logLine),
      isRunning: false,
      isDone: false,
    });
    assert.equal(wfSnap.overallState, 'FAILED');
  } finally {
    unsub();
  }

  // 5. Silent preflight does NOT emit workflow events (safe for CommandCenter status checks)
  const silentEvents: WorkflowRuntimeEvent[] = [];
  const unsubSilent = AuditLedger.subscribeWorkflowEvents((ev) => silentEvents.push(ev));
  try {
    const silentRep = await CloudObjectStorageService.runCloudPreflight({
      silent: true,
      overrides: { S3_BUCKET: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' },
    });
    assert.equal(silentRep.passed, false);
    assert.equal(silentEvents.length, 0);
  } finally {
    unsubSilent();
  }

  // 6. CloudPreflightService: CommandCenter check mapping & client-side fail-closed behavior
  const unverifiedItem = CloudPreflightService.toCommandCenterCheck(null);
  assert.equal(unverifiedItem.status, 'UNVERIFIED');

  const blockedCheck = CloudPreflightService.toCommandCenterCheck({
    passed: false,
    status: 'PREFLIGHT_BLOCKED',
    checks: {
      credentialsValid: false,
      bucketAvailable: false,
      checkpointExists: false,
      checkpointAccessible: false,
      readWriteVerified: false,
    },
    bucket: null,
    region: 'us-east-1',
    endpoint: null,
    checkpointKey: 'checkpoints/model_checkpoint.pt',
    checkpointSizeBytes: null,
    checkpointETag: null,
    checkpointLastModified: null,
    headerMagicValid: null,
    httpStatusCode: null,
    missingCredentials: ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
    blockers: ['missing_s3_credentials'],
    error: 'Missing AWS S3 credentials',
    latencyMs: 1,
    checkedAt: new Date().toISOString(),
  });
  assert.equal(blockedCheck.status, 'BLOCKED');
  assert.ok(blockedCheck.detail.includes('Creds: MISSING'));

  const svc = CloudPreflightService.getInstance();
  const svcRes = await svc.runPreflightCheck({
    fetcher: (async () =>
      new Response(
        JSON.stringify({
          success: true,
          report: {
            passed: true,
            status: 'PREFLIGHT_PASS',
            checks: {
              credentialsValid: true,
              bucketAvailable: true,
              checkpointExists: true,
              checkpointAccessible: true,
              readWriteVerified: false,
            },
            bucket: 'prod-bucket',
            region: 'us-east-1',
            endpoint: null,
            checkpointKey: 'checkpoints/model_checkpoint_target_41m.pt',
            checkpointSizeBytes: 166111232,
            checkpointETag: '"etag"',
            checkpointLastModified: null,
            headerMagicValid: true,
            httpStatusCode: 200,
            missingCredentials: [],
            blockers: [],
            error: null,
            latencyMs: 18,
            checkedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch,
  });
  assert.equal(svcRes.passed, true);
  assert.equal(CloudPreflightService.toCommandCenterCheck(svcRes).status, 'VERIFIED');

  // 7. TrainingInitializer (src/modules/ResearchLab.tsx): 5,800 steps, 100-step checkpoints & Human Approval gate
  let startEndpointCalled = false;
  const mockInitBlockedSnap = {
    ...initSnap,
    canExecuteTraining: false,
    gates: initSnap.gates.map((g) => (g.id === 'human_approval' ? { ...g, passed: false } : g)),
  };
  const initOnlyResult = await TrainingInitializer({
    targetSteps: 5800,
    saveEvery: 100,
    humanApprovalConfirmed: false,
    execute: true,
    fetcher: (async (url: RequestInfo | URL) => {
      if (String(url).includes('/start')) {
        startEndpointCalled = true;
      }
      return new Response(
        JSON.stringify({ success: true, snapshot: mockInitBlockedSnap, execution: getTrainingLoopExecutionStatus() }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch,
  });
  assert.equal(initOnlyResult.targetSteps, 5800);
  assert.equal(initOnlyResult.checkpointIntervalSteps, 100);
  assert.equal(initOnlyResult.verificationCheckpointsPlanned, 58);
  assert.equal(initOnlyResult.milestones[0].globalStep, 100);
  assert.equal(initOnlyResult.milestones[57].globalStep, 5800);
  assert.equal(initOnlyResult.humanApprovalPassed, false);
  assert.equal(initOnlyResult.executed, false);
  assert.equal(initOnlyResult.status, 'BLOCKED_HUMAN_APPROVAL');
  assert.equal(startEndpointCalled, false, 'TrainingInitializer MUST NOT call /start without Human Approval');

  // 8. ApprovalGate real Admin request -> approve -> initializeTrainingPipeline passes human_approval gate
  // without APPROVAL_MISMATCH while still remaining BLOCKED fail-closed on missing S3/HMAC key
  try {
    const gate = ApprovalGate.getInstance();
    const aprReq = gate.requestApproval({
      actionType: 'MODEL_RELEASE',
      resourceId: 'native_training_5800_41m_test',
      description: 'Unit test human approval for 5,800-step NativeLM training',
      requestedByUserId: 'usr_dev_test',
      requestedByRole: 'developer',
      tenantId: 'tenant_sovereign_prime',
    });
    gate.approveRequest(
      aprReq.requestId,
      { userId: 'usr_admin_test', role: 'admin', tenantId: 'tenant_sovereign_prime' },
      'Integration test approval'
    );

    const approvedInitSnap = await initializeTrainingPipeline({
      targetSteps: 5800,
      evalEvery: 25,
      saveEvery: 100,
      humanApprovalConfirmed: true,
      approvalRequestId: aprReq.requestId,
      tenantId: 'tenant_sovereign_prime',
    });
    const humanGate = approvedInitSnap.gates.find((g) => g.id === 'human_approval');
    assert.ok(humanGate && humanGate.passed, `Expected human_approval gate passed, got detail=${humanGate?.detail}`);
    assert.ok(humanGate.detail.includes(aprReq.requestId));
    assert.equal(approvedInitSnap.config.approvalRequestId, aprReq.requestId);
    assert.equal(approvedInitSnap.config.humanApprovalConfirmed, true);
    // Still strictly fail-closed on S3 & provenance HMAC key
    assert.equal(approvedInitSnap.canExecuteTraining, false);
    assert.equal(approvedInitSnap.status, 'BLOCKED');

    // Verify baseline pipeline_metrics_latest.json captures locked 2,800 + 3,000 schedule
    const baselineMetricsPath = path.resolve(process.cwd(), 'native_data/training_pipeline/pipeline_metrics_latest.json');
    assert.ok(fs.existsSync(baselineMetricsPath), 'pipeline_metrics_latest.json should be initialized');
    const baselineMetrics = JSON.parse(fs.readFileSync(baselineMetricsPath, 'utf8'));
    assert.equal(baselineMetrics.warmStartSteps, 2800);
    assert.equal(baselineMetrics.continuationSteps, 3000);
    assert.equal(baselineMetrics.targetSteps, 5800);
  } finally {
    if (prevApprovalsFile === undefined) delete process.env.ZYNTHEOR_APPROVALS_FILE;
    else process.env.ZYNTHEOR_APPROVALS_FILE = prevApprovalsFile;
    fs.rmSync(tempApprovalsDir, { recursive: true, force: true });
  }

  console.log('ALL CLOUD STORAGE, PREFLIGHT, 41.5M VERIFIER & 5,800-STEP PIPELINE TESTS PASSED');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
