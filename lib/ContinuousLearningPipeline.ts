/**
 * ZYNTHEOR Batch 28 — Continuous Learning Pipeline
 *
 * End-to-End Versioned Training & Fail-Closed Promotion Pipeline:
 *   1. Data Collection (from KnowledgeWorkspace or explicit curated corpus — NEVER raw prod memory)
 *   2. Quality Filtering (length, repetition/entropy checks)
 *   3. Deduplication (exact SHA-256 + normalized hash + disjoint train/val split enforcement)
 *   4. Privacy Filtering (redacts/rejects API keys, Bearer tokens, passwords, private keys, emails/phones)
 *   5. Dataset Versioning (immutable manifest + datasetSha256 persisted on disk)
 *   6. Real Native Weight Training (invokes qplus_native/batch28_train.py PureSeqLM AdamW backprop)
 *   7. Validation & Baseline vs Candidate Held-Out Comparison
 *   8. Independent Quality Gate (regression blocks promotion; an intact candidate is still preserved)
 *   9. Human Approval Gate (requires authorized human approval via ApprovalGate before production release)
 *  10. Model Release & Rollback (preserves previous checkpoint backup with SHA-256 + supports full rollback)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AuditLedger } from './AuditLedger';
import { ApprovalGate } from './ApprovalGate';
import { KnowledgeWorkspace } from './KnowledgeWorkspace';
import { normalizeIntegrityText } from './knowledgeUtils';
import type { SovereignRole } from './SovereignIdentity';

const execFileAsync = promisify(execFile);

export type PipelineStageName =
  | 'DATA_COLLECTION'
  | 'QUALITY_FILTERING'
  | 'DEDUPLICATION'
  | 'PRIVACY_FILTERING'
  | 'DATASET_VERSIONING'
  | 'NATIVE_TRAINING'
  | 'VALIDATION_BENCHMARK'
  | 'DOMAIN_BENCHMARK'
  | 'REGRESSION_GATE'
  | 'HUMAN_APPROVAL_GATE'
  | 'MODEL_RELEASE';

export type PipelineRunStatus =
  | 'RUNNING'
  | 'REJECTED_QUALITY'
  | 'REJECTED_VALIDATION_GATE'
  | 'REJECTED_REGRESSION_GATE'
  | 'REJECTED_TEST_GATE'
  | 'INCOMPATIBLE'
  | 'TRAINED'
  | 'AWAITING_APPROVAL'
  | 'PROMOTED'
  | 'ROLLED_BACK'
  | 'FAILED';

export interface DatasetVersionManifest {
  datasetVersion: string;
  datasetSha256: string;
  createdAt: string;
  tenantId: string;
  sourceDocIds: string[];
  collectedCount: number;
  acceptedCount: number;
  rejectedQualityCount: number;
  dedupedCount: number;
  privacyRedactedCount: number;
  trainSamples: string[];
  valSamples: string[];
  testSamples: string[];
}

export interface CheckpointBackupRecord {
  backupId: string;
  createdAt: string;
  originalPath: string;
  backupPath: string;
  sha256: string;
  reason: string;
}

export interface ContinuousLearningRunRecord {
  runId: string;
  tenantId: string;
  initiatedBy: string;
  createdAt: string;
  updatedAt: string;
  status: PipelineRunStatus;
  stageHistory: Array<{ stage: PipelineStageName; status: 'PASS' | 'FAIL' | 'PENDING' | 'BLOCKED'; detail: string; at: string }>;
  datasetManifest: DatasetVersionManifest | null;
  trainingConfig: {
    steps: number;
    lr: number;
    margin: number;
    testMargin: number;
    weightDecay: number;
    gradientClip: number;
    schedulerDecay: number;
    seed: number;
  };
  baselineCheckpointPath: string;
  baselineCheckpointSha256: string | null;
  candidateCheckpointPath: string | null;
  candidateCheckpointSha256: string | null;
  candidateCheckpointFileSha256: string | null;
  parameterDeltaSha256: string | null;
  checkpointStorageMode: 'LOCAL_CANDIDATE_ONLY' | null;
  checkpointLifecycle: 'NOT_CREATED' | 'CREATED' | 'TRAINING' | 'TRAINED' | 'VALIDATING' | 'READY' | 'FAILED' | 'INCOMPATIBLE';
  qualityGateStatus: 'NOT_RUN' | 'PASS' | 'REJECTED_VALIDATION_GATE' | 'REJECTED_TEST_GATE';
  inferenceVerified: boolean;
  benchmarkStatus: string;
  benchmarkReport: Record<string, any> | null;
  baselineEval: Record<string, any> | null;
  candidateEval: Record<string, any> | null;
  baselineTestEval: Record<string, any> | null;
  candidateTestEval: Record<string, any> | null;
  nllDelta: number | null;
  regressionPassed: boolean;
  approvalRequestId: string | null;
  promotedAt: string | null;
  promotedBy: string | null;
  backupBeforePromote: CheckpointBackupRecord | null;
  error?: string;
}

const PII_PATTERNS: Array<{ name: string; regex: RegExp; mask: string }> = [
  { name: 'BEARER_TOKEN', regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, mask: '[REDACTED_BEARER]' },
  { name: 'PRIVATE_KEY', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, mask: '[REDACTED_PRIVATE_KEY]' },
  { name: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, mask: '[REDACTED_EMAIL]' },
  { name: 'SECRET_ASSIGN', regex: /\b(?:api_key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{8,}['"]?/gi, mask: '[REDACTED_SECRET]' },
  { name: 'PHONE_OR_ID', regex: /\b0[689]\d{8}\b|\b\d{13}\b/g, mask: '[REDACTED_ID]' },
];

const MIN_TRAIN_SAMPLES = 3;
const MIN_HELD_OUT_SAMPLES = 2;
const MIN_DATASET_SAMPLES = MIN_TRAIN_SAMPLES + 2 * MIN_HELD_OUT_SAMPLES;

export class ContinuousLearningPipeline {
  private static instance: ContinuousLearningPipeline | null = null;
  private rootDir: string;
  private checkpointDir: string;
  private runsFile: string;
  private backupsFile: string;
  private runs: ContinuousLearningRunRecord[] = [];
  private backups: CheckpointBackupRecord[] = [];

  private constructor() {
    this.rootDir = process.env.ZYNTHEOR_TRAINING_PIPELINE_DIR
      ? path.resolve(process.env.ZYNTHEOR_TRAINING_PIPELINE_DIR)
      : path.resolve(process.cwd(), 'native_data', 'training_pipeline');
    this.checkpointDir = process.env.ZYNTHEOR_TRAINING_CHECKPOINT_DIR
      ? path.resolve(process.env.ZYNTHEOR_TRAINING_CHECKPOINT_DIR)
      : path.resolve(process.cwd(), 'checkpoints');
    this.runsFile = path.join(this.rootDir, 'runs.json');
    this.backupsFile = path.join(this.rootDir, 'backups.json');
    this.ensureDirs();
    this.load();
  }

  public static getInstance(): ContinuousLearningPipeline {
    if (!ContinuousLearningPipeline.instance) {
      ContinuousLearningPipeline.instance = new ContinuousLearningPipeline();
    }
    return ContinuousLearningPipeline.instance;
  }

  private ensureDirs(): void {
    for (const sub of ['', 'datasets', 'checkpoints', 'backups']) {
      const p = sub ? path.join(this.rootDir, sub) : this.rootDir;
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }
  }

  private verifyCheckpointStorageWritable(): void {
    fs.mkdirSync(this.checkpointDir, { recursive: true });
    const probePath = path.join(
      this.checkpointDir,
      `.zyntheor-write-check-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
    );
    let fd: number | null = null;
    try {
      fd = fs.openSync(probePath, 'wx', 0o600);
      fs.writeSync(fd, 'checkpoint storage probe');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.unlinkSync(probePath);
    } catch (error: any) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* preserve the storage failure */ }
      }
      try {
        if (fs.existsSync(probePath)) fs.unlinkSync(probePath);
      } catch { /* preserve the storage failure */ }
      throw new Error(
        `CHECKPOINT_STORAGE_UNAVAILABLE: Local candidate directory '${this.checkpointDir}' is not writable: ${error.message}`
      );
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.runsFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.runsFile, 'utf8'));
        if (Array.isArray(parsed)) this.runs = parsed;
      }
    } catch {
      this.runs = [];
    }
    try {
      if (fs.existsSync(this.backupsFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.backupsFile, 'utf8'));
        if (Array.isArray(parsed)) this.backups = parsed;
      }
    } catch {
      this.backups = [];
    }
  }

  private save(): void {
    this.ensureDirs();
    const tmpR = `${this.runsFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmpR, JSON.stringify(this.runs.slice(0, 100), null, 2), 'utf8');
    fs.renameSync(tmpR, this.runsFile);

    const tmpB = `${this.backupsFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmpB, JSON.stringify(this.backups.slice(0, 100), null, 2), 'utf8');
    fs.renameSync(tmpB, this.backupsFile);
  }

  private fileSha256(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  public getActiveTargetCheckpointPath(): string {
    return process.env.ZYNTHEOR_PURE_SEQ_CHECKPOINT
      ? path.resolve(process.env.ZYNTHEOR_PURE_SEQ_CHECKPOINT)
      : path.resolve(process.cwd(), 'native_data', 'model_checkpoint_seq_pure.pt');
  }

  public scrubPrivacyPii(text: string): { sanitized: string; redactedCount: number } {
    let sanitized = text;
    let redactedCount = 0;
    for (const pat of PII_PATTERNS) {
      const matches = sanitized.match(pat.regex);
      if (matches && matches.length > 0) {
        redactedCount += matches.length;
        sanitized = sanitized.replace(pat.regex, pat.mask);
      }
    }
    return { sanitized, redactedCount };
  }

  /**
   * Executes steps 1 through 9 of the Continuous Learning Pipeline:
   * Collect -> Filter -> Dedupe -> Privacy Filter -> Version -> Train -> Validate -> Regression Gate -> Request Human Approval.
   */
  public async executePipelineRun(params: {
    tenantId: string;
    initiatedBy: string;
    customSamples?: string[];
    documentIds?: string[];
    steps?: number;
    lr?: number;
    margin?: number;
    testMargin?: number;
    weightDecay?: number;
    gradientClip?: number;
    schedulerDecay?: number;
    seed?: number;
    baselineCheckpointPath?: string;
    resumeTraining?: boolean;
    resumeFromRunId?: string;
  }): Promise<ContinuousLearningRunRecord> {
    const runId = `cl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();
    const resumeRun = params.resumeFromRunId
      ? this.runs.find((run) => run.runId === params.resumeFromRunId)
      : undefined;
    if (params.resumeFromRunId && !resumeRun) {
      throw new Error('RESUME_RUN_NOT_FOUND: The requested training run is unavailable.');
    }
    if (resumeRun && (
      resumeRun.tenantId !== params.tenantId
      || resumeRun.status !== 'TRAINED'
      || resumeRun.checkpointLifecycle !== 'TRAINED'
      || !resumeRun.candidateCheckpointPath
      || !fs.existsSync(resumeRun.candidateCheckpointPath)
      || !resumeRun.datasetManifest
    )) {
      throw new Error('RESUME_RUN_INCOMPATIBLE: Run must belong to this tenant and contain an intact TRAINED checkpoint with its frozen dataset.');
    }
    if (resumeRun) {
      const frozenManifest = resumeRun.datasetManifest!;
      const frozenDatasetPath = path.join(this.rootDir, 'datasets', `${frozenManifest.datasetVersion}.json`);
      const computedDatasetSha256 = crypto
        .createHash('sha256')
        .update(JSON.stringify({
          trainSamples: frozenManifest.trainSamples,
          valSamples: frozenManifest.valSamples,
          testSamples: frozenManifest.testSamples,
        }))
        .digest('hex');
      if (
        frozenManifest.tenantId !== params.tenantId
        || computedDatasetSha256 !== frozenManifest.datasetSha256
        || !fs.existsSync(frozenDatasetPath)
        || JSON.stringify(JSON.parse(fs.readFileSync(frozenDatasetPath, 'utf8'))) !== JSON.stringify(frozenManifest)
        || !resumeRun.candidateCheckpointFileSha256
        || this.fileSha256(resumeRun.candidateCheckpointPath!) !== resumeRun.candidateCheckpointFileSha256
      ) {
        throw new Error('RESUME_RUN_INCOMPATIBLE: Frozen dataset or checkpoint integrity verification failed.');
      }
      const verifyScript = 'import json,sys; from qplus_native.batch28_train import verify_checkpoint_integrity_file; print(json.dumps(verify_checkpoint_integrity_file(sys.argv[1])))';
      const verification = await execFileAsync('python3', ['-B', '-c', verifyScript, resumeRun.candidateCheckpointPath!], {
        cwd: process.cwd(),
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      });
      const checkpointBundle = JSON.parse(verification.stdout.trim());
      if (
        checkpointBundle.valid !== true
        || checkpointBundle.resume_state_valid !== true
        || checkpointBundle.file_sha256 !== resumeRun.candidateCheckpointFileSha256
        || checkpointBundle.sha256 !== resumeRun.candidateCheckpointSha256
      ) {
        throw new Error('RESUME_RUN_INCOMPATIBLE: Checkpoint bundle, optimizer state, or recorded hashes failed verification.');
      }
    }
    const previousConfig = resumeRun?.trainingConfig;
    const steps = Number(params.steps ?? 16);
    const lr = Number(params.lr ?? previousConfig?.lr ?? 0.015);
    const margin = Number(params.margin ?? previousConfig?.margin ?? 0);
    const testMargin = Number(params.testMargin ?? previousConfig?.testMargin ?? 0.02);
    const weightDecay = Number(params.weightDecay ?? previousConfig?.weightDecay ?? 0.01);
    const gradientClip = Number(params.gradientClip ?? previousConfig?.gradientClip ?? 1);
    const schedulerDecay = Number(params.schedulerDecay ?? previousConfig?.schedulerDecay ?? 0.995);
    const seed = Number(params.seed ?? previousConfig?.seed ?? 2028);
    const resumeTraining = params.resumeTraining === true || Boolean(resumeRun);
    if (
      !Number.isInteger(steps) || steps < 1 || steps > 80
      || !Number.isFinite(lr) || lr <= 0 || lr > 1
      || !Number.isFinite(margin)
      || !Number.isFinite(testMargin) || testMargin < 0
      || !Number.isFinite(weightDecay) || weightDecay < 0
      || !Number.isFinite(gradientClip) || gradientClip <= 0
      || !Number.isFinite(schedulerDecay) || schedulerDecay <= 0 || schedulerDecay > 1
      || !Number.isInteger(seed) || seed < 0
    ) {
      throw new Error('INVALID_TRAINING_CONFIG: steps, optimizer, scheduler, and seed values are outside supported ranges.');
    }
    const baselineCheckpointPath = resumeRun?.candidateCheckpointPath
      ? path.resolve(resumeRun.candidateCheckpointPath)
      : params.baselineCheckpointPath
      ? path.resolve(params.baselineCheckpointPath)
      : this.getActiveTargetCheckpointPath();

    const record: ContinuousLearningRunRecord = {
      runId,
      tenantId: params.tenantId,
      initiatedBy: params.initiatedBy,
      createdAt: now,
      updatedAt: now,
      status: 'RUNNING',
      stageHistory: [],
      datasetManifest: null,
      trainingConfig: { steps, lr, margin, testMargin, weightDecay, gradientClip, schedulerDecay, seed },
      baselineCheckpointPath,
      baselineCheckpointSha256: fs.existsSync(baselineCheckpointPath) ? this.fileSha256(baselineCheckpointPath) : null,
      candidateCheckpointPath: null,
      candidateCheckpointSha256: null,
      candidateCheckpointFileSha256: null,
      parameterDeltaSha256: null,
      checkpointStorageMode: null,
      checkpointLifecycle: 'NOT_CREATED',
      qualityGateStatus: 'NOT_RUN',
      inferenceVerified: false,
      benchmarkStatus: 'NOT_RUN',
      benchmarkReport: null,
      baselineEval: null,
      candidateEval: null,
      baselineTestEval: null,
      candidateTestEval: null,
      nllDelta: null,
      regressionPassed: false,
      approvalRequestId: null,
      promotedAt: null,
      promotedBy: null,
      backupBeforePromote: null,
    };

    const pushStage = (stage: PipelineStageName, status: 'PASS' | 'FAIL' | 'PENDING' | 'BLOCKED', detail: string) => {
      record.stageHistory.push({ stage, status, detail, at: new Date().toISOString() });
      record.updatedAt = new Date().toISOString();
      this.save();
    };
    this.runs.unshift(record);
    this.save();

    try {
      // 1. DATA COLLECTION (KnowledgeWorkspace docs or explicit corpus — NEVER auto-drains production episodic memory)
      const rawInputs: Array<{ docId: string; text: string }> = [];
      if (resumeRun?.datasetManifest) {
        const frozen = resumeRun.datasetManifest;
        [...frozen.trainSamples, ...frozen.valSamples, ...frozen.testSamples].forEach((text, index) => {
          rawInputs.push({ docId: `frozen_${index}`, text });
        });
        pushStage('DATA_COLLECTION', 'PASS', `Reusing frozen dataset ${frozen.datasetVersion}; no new source data was mixed into the exact resume.`);
      } else if (Array.isArray(params.customSamples) && params.customSamples.length > 0) {
        params.customSamples.forEach((txt, i) => {
          if (typeof txt === 'string' && txt.trim()) rawInputs.push({ docId: `corpus_sample_${i + 1}`, text: txt.trim() });
        });
      } else {
        const kw = KnowledgeWorkspace.getInstance();
        const docs = kw.listDocuments({ tenantId: params.tenantId });
        const picked = params.documentIds && params.documentIds.length > 0
          ? docs.filter((d) => params.documentIds!.includes(d.id))
          : docs;
        for (const d of picked) {
          rawInputs.push({ docId: d.id, text: `${d.title}\n${d.content}` });
        }
      }
      if (!resumeRun) {
        pushStage('DATA_COLLECTION', 'PASS', `Collected ${rawInputs.length} raw text source(s) (memory isolated)`);
      }

      // 2. QUALITY FILTERING + 3. DEDUPLICATION + 4. PRIVACY FILTERING
      let rejectedQuality = 0;
      let dedupedCount = 0;
      let privacyRedactedCount = 0;
      const seenHashes = new Set<string>();
      const cleanSamples: Array<{ docId: string; text: string }> = [];

      if (resumeRun?.datasetManifest) {
        for (const [index, text] of [
          ...resumeRun.datasetManifest.trainSamples,
          ...resumeRun.datasetManifest.valSamples,
          ...resumeRun.datasetManifest.testSamples,
        ].entries()) {
          cleanSamples.push({ docId: `frozen_${index}`, text });
        }
      } else {
        for (const item of rawInputs) {
          const trimmed = item.text.trim();
          if (trimmed.length < 60) {
            rejectedQuality += 1;
            continue;
          }
          const words = trimmed.split(/\s+/);
          const uniqueRatio = new Set(words).size / Math.max(1, words.length);
          if (uniqueRatio < 0.3) {
            rejectedQuality += 1;
            continue;
          }
          const normHash = crypto.createHash('sha256').update(normalizeIntegrityText(trimmed)).digest('hex');
          if (seenHashes.has(normHash)) {
            dedupedCount += 1;
            continue;
          }
          seenHashes.add(normHash);

          const { sanitized, redactedCount } = this.scrubPrivacyPii(trimmed);
          privacyRedactedCount += redactedCount;
          cleanSamples.push({ docId: item.docId, text: sanitized });
        }
      }

      if (!resumeRun) {
        pushStage(
          'QUALITY_FILTERING',
          cleanSamples.length >= MIN_DATASET_SAMPLES ? 'PASS' : 'FAIL',
          `Kept ${cleanSamples.length}; require at least ${MIN_DATASET_SAMPLES} disjoint samples for train/validation/test coverage; rejected ${rejectedQuality} low-quality sample(s).`
        );
        pushStage('DEDUPLICATION', 'PASS', `Removed ${dedupedCount} duplicate sample(s)`);
        pushStage('PRIVACY_FILTERING', 'PASS', `Scrubbed ${privacyRedactedCount} PII/secret pattern(s)`);
      }

      if (cleanSamples.length < MIN_DATASET_SAMPLES) {
        record.status = 'REJECTED_QUALITY';
        record.error = `Insufficient clean disjoint samples (minimum ${MIN_DATASET_SAMPLES}: ${MIN_TRAIN_SAMPLES} train, ${MIN_HELD_OUT_SAMPLES} validation, ${MIN_HELD_OUT_SAMPLES} test)`;
        this.save();
        return record;
      }

      let trainSamples: string[];
      let valSamples: string[];
      let testSamples: string[];
      let datasetVersion: string;
      let datasetSha256: string;
      let manifest: DatasetVersionManifest;
      if (resumeRun?.datasetManifest) {
        manifest = resumeRun.datasetManifest;
        trainSamples = manifest.trainSamples;
        valSamples = manifest.valSamples;
        testSamples = manifest.testSamples;
        datasetVersion = manifest.datasetVersion;
        datasetSha256 = manifest.datasetSha256;
        record.datasetManifest = manifest;
        pushStage('DATASET_VERSIONING', 'PASS', `Resuming dataset ${datasetVersion} (${datasetSha256.slice(0, 12)}...).`);
      } else {
        // Deterministic disjoint document-level split; test data is never used for updates.
        const testCount = Math.max(MIN_HELD_OUT_SAMPLES, Math.floor(cleanSamples.length * 0.15));
        const valCount = Math.max(MIN_HELD_OUT_SAMPLES, Math.floor(cleanSamples.length * 0.15));
        const trainEnd = cleanSamples.length - testCount - valCount;
        trainSamples = cleanSamples.slice(0, trainEnd).map((s) => s.text);
        valSamples = cleanSamples.slice(trainEnd, trainEnd + valCount).map((s) => s.text);
        testSamples = cleanSamples.slice(trainEnd + valCount).map((s) => s.text);

        // 5. DATASET VERSIONING
        datasetVersion = `ds_v_${Date.now()}`;
        datasetSha256 = crypto
          .createHash('sha256')
          .update(JSON.stringify({ trainSamples, valSamples, testSamples }))
          .digest('hex');

        manifest = {
          datasetVersion,
          datasetSha256,
          createdAt: new Date().toISOString(),
          tenantId: params.tenantId,
          sourceDocIds: Array.from(new Set(cleanSamples.map((s) => s.docId))),
          collectedCount: rawInputs.length,
          acceptedCount: cleanSamples.length,
          rejectedQualityCount: rejectedQuality,
          dedupedCount,
          privacyRedactedCount,
          trainSamples,
          valSamples,
          testSamples,
        };
        fs.writeFileSync(
          path.join(this.rootDir, 'datasets', `${datasetVersion}.json`),
          JSON.stringify(manifest, null, 2),
          { encoding: 'utf8', flag: 'wx' }
        );
        record.datasetManifest = manifest;
        pushStage('DATASET_VERSIONING', 'PASS', `Frozen ${datasetVersion} (sha256=${datasetSha256.slice(0, 12)}..., train=${trainSamples.length}, val=${valSamples.length}, test=${testSamples.length})`);
      }

      // 6 & 7 & 8. REAL NATIVE WEIGHT TRAINING + HELD-OUT VALIDATION + REGRESSION GATE
      this.verifyCheckpointStorageWritable();
      const candidatePath = path.join(this.checkpointDir, `${runId}_candidate.pt`);
      const scriptPath = path.resolve(process.cwd(), 'qplus_native', 'batch28_train.py');
      const trainReq = {
        op: 'train',
        run_id: runId,
        dataset_version: datasetVersion,
        dataset_sha256: datasetSha256,
        train_texts: trainSamples,
        val_texts: valSamples,
        test_texts: testSamples,
        steps,
        lr,
        margin,
        test_margin: testMargin,
        weight_decay: weightDecay,
        gradient_clip: gradientClip,
        scheduler_decay: schedulerDecay,
        seed,
        resume_training: resumeTraining,
        baseline_checkpoint_path: fs.existsSync(baselineCheckpointPath) ? baselineCheckpointPath : null,
        candidate_checkpoint_path: candidatePath,
      };

      pushStage('NATIVE_TRAINING', 'PENDING', `Native trainer running ${steps} real optimizer step(s); final metrics are not yet available.`);

      const pyResult = await new Promise<any>((resolve, reject) => {
        const proc = execFile(
          'python3',
          ['-B', scriptPath],
          { cwd: process.cwd(), timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err && !stdout.trim()) {
              return reject(new Error(stderr || err.message));
            }
            try {
              resolve(JSON.parse(stdout.trim()));
            } catch (parseErr: any) {
              reject(new Error(`Invalid training output: ${parseErr.message} | raw=${stdout.slice(0, 200)}`));
            }
          }
        );
        proc.stdin?.write(JSON.stringify(trainReq));
        proc.stdin?.end();
      });

      if (pyResult.status === 'FAILED' || pyResult.status === 'INCOMPATIBLE') {
        record.status = pyResult.status;
        record.checkpointLifecycle = pyResult.status;
        record.error = pyResult.reason || 'Native training failed';
        pushStage('NATIVE_TRAINING', 'FAIL', record.error || 'Native training failed');
        this.save();
        return record;
      }

      record.baselineEval = pyResult.baseline_eval || null;
      record.candidateEval = pyResult.candidate_eval || null;
      record.baselineTestEval = pyResult.baseline_test_eval || null;
      record.candidateTestEval = pyResult.candidate_test_eval || null;
      record.nllDelta = typeof pyResult.nll_delta === 'number' ? pyResult.nll_delta : null;
      record.regressionPassed = Boolean(pyResult.regression_passed);
      record.candidateCheckpointPath = pyResult.candidate_checkpoint_path || null;
      record.candidateCheckpointSha256 = pyResult.candidate_checkpoint_sha256 || null;
      record.candidateCheckpointFileSha256 = pyResult.candidate_checkpoint_file_sha256 || null;
      record.parameterDeltaSha256 = pyResult.parameter_delta_sha256 || null;
      record.checkpointStorageMode = pyResult.storage_mode || null;
      record.checkpointLifecycle = pyResult.checkpoint_lifecycle || 'NOT_CREATED';
      record.qualityGateStatus = pyResult.quality_gate_status || 'NOT_RUN';
      record.inferenceVerified = Boolean(pyResult.inference_verified);
      record.benchmarkStatus = pyResult.benchmark_status || 'NOT_RUN';

      pushStage(
        'NATIVE_TRAINING',
        pyResult.training ? 'PASS' : 'FAIL',
        pyResult.training
          ? `PureSeqLM completed ${pyResult.training.steps_this_run} optimizer step(s) (${pyResult.training.tokens_processed} tokens, ${pyResult.total_params} parameters); candidate storage=${record.checkpointStorageMode}.`
          : `Native trainer returned ${pyResult.status} without training metrics.`
      );
      pushStage(
        'VALIDATION_BENCHMARK',
        pyResult.validation_passed && pyResult.test_gate_passed ? 'PASS' : 'FAIL',
        `Validation NLL=${record.baselineEval?.nll} -> ${record.candidateEval?.nll}; test NLL=${record.baselineTestEval?.nll} -> ${record.candidateTestEval?.nll}; benchmark=${record.benchmarkStatus}.`
      );

      if (!record.regressionPassed || !record.candidateCheckpointSha256) {
        record.status = pyResult.status === 'REJECTED_TEST_GATE'
          ? 'REJECTED_TEST_GATE'
          : 'REJECTED_VALIDATION_GATE';
        pushStage(
          'REGRESSION_GATE',
          'FAIL',
          `Fail-closed: validation_passed=${Boolean(pyResult.validation_passed)}, test_gate_passed=${Boolean(pyResult.test_gate_passed)}. Active checkpoint untouched.`
        );
        this.save();
        AuditLedger.append('EVOLVER', 'CONTINUOUS_LEARNING_REJECTED_GATE', {
          runId,
          datasetVersion,
          baselineNll: record.baselineEval?.nll,
          candidateNll: record.candidateEval?.nll,
        });
        return record;
      }

      pushStage(
        'REGRESSION_GATE',
        'PASS',
        `Candidate passed validation and independent test regression gates (payload sha256=${record.candidateCheckpointSha256.slice(0, 12)}...).`
      );

      record.status = 'TRAINED';
      pushStage(
        'HUMAN_APPROVAL_GATE',
        'PENDING',
        'Release approval is blocked until the checkpoint passes the required domain benchmark suite and reaches READY.'
      );

      AuditLedger.append('EVOLVER', 'CONTINUOUS_LEARNING_CANDIDATE_TRAINED', {
        runId,
        datasetVersion,
        candidateCheckpointSha256: record.candidateCheckpointSha256,
        candidateCheckpointFileSha256: record.candidateCheckpointFileSha256,
        checkpointLifecycle: record.checkpointLifecycle,
        benchmarkStatus: record.benchmarkStatus,
      });

      return record;
    } catch (err: any) {
      record.status = 'FAILED';
      record.error = err?.message || String(err);
      pushStage('NATIVE_TRAINING', 'FAIL', record.error || 'Native training failed');
      this.save();
      return record;
    }
  }

  public async runDomainBenchmarks(params: {
    runId: string;
    tenantId: string;
  }): Promise<ContinuousLearningRunRecord> {
    const run = this.runs.find((candidate) => candidate.runId === params.runId);
    if (!run) throw new Error(`RUN_NOT_FOUND: Continuous learning run '${params.runId}' does not exist.`);
    if (run.tenantId !== params.tenantId) throw new Error('FORBIDDEN: Cross-tenant checkpoint benchmarking is denied.');
    if (
      !['TRAINED', 'REJECTED_VALIDATION_GATE', 'REJECTED_TEST_GATE'].includes(run.status)
      || run.checkpointLifecycle !== 'TRAINED'
      || !run.datasetManifest
      || !run.candidateCheckpointPath
      || !fs.existsSync(run.candidateCheckpointPath)
      || !run.candidateCheckpointFileSha256
      || this.fileSha256(run.candidateCheckpointPath) !== run.candidateCheckpointFileSha256
    ) {
      throw new Error('BENCHMARK_RUN_INCOMPATIBLE: Only intact trained checkpoints with frozen datasets can be benchmarked.');
    }

    const manifest = run.datasetManifest;
    const scriptPath = path.resolve(process.cwd(), 'qplus_native', 'domain_benchmark.py');
    const request = {
      op: 'benchmark',
      checkpoint_path: run.candidateCheckpointPath,
      dataset_version: manifest.datasetVersion,
      dataset_sha256: manifest.datasetSha256,
      train_texts: manifest.trainSamples,
      val_texts: manifest.valSamples,
      test_texts: manifest.testSamples,
    };
    run.stageHistory.push({
      stage: 'DOMAIN_BENCHMARK',
      status: 'PENDING',
      detail: 'Verifying checkpoint and measuring held-out text behavior; unsupported domains will remain blocked.',
      at: new Date().toISOString(),
    });
    run.updatedAt = new Date().toISOString();
    this.save();

    try {
      const report = await new Promise<Record<string, any>>((resolve, reject) => {
        const proc = execFile(
          'python3',
          ['-B', scriptPath],
          { cwd: process.cwd(), timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err && !stdout.trim()) {
              reject(new Error(stderr || err.message));
              return;
            }
            try {
              resolve(JSON.parse(stdout.trim()));
            } catch (parseError: any) {
              reject(new Error(`Invalid domain benchmark output: ${parseError.message}`));
            }
          }
        );
        proc.stdin?.write(JSON.stringify(request));
        proc.stdin?.end();
      });

      run.benchmarkReport = report;
      run.benchmarkStatus = report.status || 'FAILED';
      run.updatedAt = new Date().toISOString();
      run.stageHistory.push({
        stage: 'DOMAIN_BENCHMARK',
        status: report.status === 'PASS' && report.readiness_accepted === true
          ? 'PASS'
          : report.status === 'FAILED' ? 'FAIL' : 'BLOCKED',
        detail: `${report.status || 'FAILED'}: ${report.summary?.passed || 0}/${report.summary?.total || 10} required domains passed; general-text metrics are not domain capability scores.`,
        at: run.updatedAt,
      });
      this.save();
      AuditLedger.append('EVOLVER', 'NATIVE_DOMAIN_BENCHMARK_COMPLETED', {
        runId: run.runId,
        tenantId: run.tenantId,
        checkpointSha256: run.candidateCheckpointSha256,
        reportSchema: report.schema,
        benchmarkStatus: run.benchmarkStatus,
        summary: report.summary,
      });
      return run;
    } catch (error: any) {
      run.benchmarkStatus = 'FAILED';
      run.benchmarkReport = { schema: 'ZYNTHEOR_NATIVE_DOMAIN_BENCHMARK_V1', status: 'FAILED', error: error.message };
      run.updatedAt = new Date().toISOString();
      run.stageHistory.push({
        stage: 'DOMAIN_BENCHMARK',
        status: 'FAIL',
        detail: `Checkpoint benchmark failed: ${error.message}`,
        at: run.updatedAt,
      });
      this.save();
      throw error;
    }
  }

  /**
   * 10a. Model Release: backs up existing checkpoint and promotes candidate ONLY if
   *      regression gate passed AND ApprovalGate verifies authorized human approval.
   */
  public promoteApprovedRun(params: {
    runId: string;
    actor: { userId: string; role: SovereignRole; tenantId: string };
    targetPath?: string;
  }): ContinuousLearningRunRecord {
    const run = this.runs.find((r) => r.runId === params.runId);
    if (!run) {
      throw new Error(`RUN_NOT_FOUND: Continuous learning run '${params.runId}' does not exist.`);
    }
    if (run.tenantId !== params.actor.tenantId && params.actor.role !== 'admin') {
      throw new Error('FORBIDDEN: Cross-tenant model promotion is denied.');
    }
    if (run.checkpointLifecycle !== 'READY' || run.benchmarkStatus !== 'PASS') {
      throw new Error('PROMOTION_BLOCKED: Checkpoint requires successful required-domain benchmarks and READY lifecycle.');
    }
    if (!run.regressionPassed || !run.candidateCheckpointPath || !fs.existsSync(run.candidateCheckpointPath)) {
      throw new Error('PROMOTION_BLOCKED: Candidate checkpoint missing or failed regression gate.');
    }
    if (!run.candidateCheckpointFileSha256 || this.fileSha256(run.candidateCheckpointPath) !== run.candidateCheckpointFileSha256) {
      throw new Error('FAIL_CLOSED: Candidate checkpoint container SHA-256 does not match the recorded training run.');
    }

    const verify = ApprovalGate.getInstance().verifyAndConsume({
      actionType: 'MODEL_RELEASE',
      resourceId: run.runId,
      tenantId: run.tenantId,
      approvalRequestId: run.approvalRequestId || undefined,
      consume: true,
    });
    if (!verify.approved) {
      throw new Error(verify.reason || 'APPROVAL_REQUIRED: Human approval is mandatory before model release.');
    }

    const activeTarget = params.targetPath ? path.resolve(params.targetPath) : this.getActiveTargetCheckpointPath();
    let backupRec: CheckpointBackupRecord | null = null;
    if (fs.existsSync(activeTarget)) {
      const backupId = `bkp_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      const backupPath = path.join(this.rootDir, 'backups', `${path.basename(activeTarget)}.${backupId}`);
      fs.copyFileSync(activeTarget, backupPath);
      backupRec = {
        backupId,
        createdAt: new Date().toISOString(),
        originalPath: activeTarget,
        backupPath,
        sha256: this.fileSha256(backupPath),
        reason: `Pre-promotion backup before ${run.runId}`,
      };
      this.backups.unshift(backupRec);
    }

    fs.mkdirSync(path.dirname(activeTarget), { recursive: true });
    const tmp = `${activeTarget}.promote.${process.pid}`;
    fs.copyFileSync(run.candidateCheckpointPath, tmp);
    fs.renameSync(tmp, activeTarget);

    run.backupBeforePromote = backupRec;
    run.status = 'PROMOTED';
    run.promotedAt = new Date().toISOString();
    run.promotedBy = params.actor.userId;
    run.updatedAt = new Date().toISOString();
    run.stageHistory.push({
      stage: 'MODEL_RELEASE',
      status: 'PASS',
      detail: `Promoted candidate (${run.candidateCheckpointSha256?.slice(0, 12)}...) to ${path.basename(activeTarget)}${backupRec ? `; preserved backup ${backupRec.backupId}` : ''}`,
      at: run.promotedAt,
    });
    this.save();

    AuditLedger.append('GOVERNANCE', 'CONTINUOUS_LEARNING_PROMOTED', {
      runId: run.runId,
      promotedBy: params.actor.userId,
      candidateSha256: run.candidateCheckpointSha256,
      backupId: backupRec?.backupId || null,
      backupSha256: backupRec?.sha256 || null,
    });

    return run;
  }

  /**
   * 10b. Rollback: restores a preserved checkpoint backup after verifying SHA-256 integrity.
   */
  public rollbackCheckpoint(params: {
    backupId: string;
    actor: { userId: string; role: SovereignRole; tenantId: string };
  }): { restoredTo: string; backup: CheckpointBackupRecord; restoredSha256: string } {
    if (params.actor.role !== 'admin' && params.actor.role !== 'operator') {
      throw new Error('FORBIDDEN: Only administrator or operator may trigger checkpoint rollback.');
    }
    const backup = this.backups.find((b) => b.backupId === params.backupId);
    if (!backup || !fs.existsSync(backup.backupPath)) {
      throw new Error(`BACKUP_NOT_FOUND: Backup '${params.backupId}' is unavailable.`);
    }
    const actualSha = this.fileSha256(backup.backupPath);
    if (actualSha !== backup.sha256) {
      throw new Error('FAIL_CLOSED: Backup file SHA-256 integrity check failed; aborting rollback.');
    }

    const tmp = `${backup.originalPath}.rollback.${process.pid}`;
    fs.copyFileSync(backup.backupPath, tmp);
    fs.renameSync(tmp, backup.originalPath);
    const restoredSha256 = this.fileSha256(backup.originalPath);

    for (const r of this.runs) {
      if (r.backupBeforePromote?.backupId === backup.backupId) {
        r.status = 'ROLLED_BACK';
        r.updatedAt = new Date().toISOString();
      }
    }
    this.save();

    AuditLedger.append('GOVERNANCE', 'CHECKPOINT_ROLLBACK_EXECUTED', {
      backupId: backup.backupId,
      restoredTo: backup.originalPath,
      restoredSha256,
      actorUserId: params.actor.userId,
    });

    return { restoredTo: backup.originalPath, backup, restoredSha256 };
  }

  public listRuns(scope?: { tenantId?: string }): ContinuousLearningRunRecord[] {
    if (!scope?.tenantId) return [...this.runs];
    return this.runs.filter((r) => r.tenantId === scope.tenantId);
  }

  public listBackups(): CheckpointBackupRecord[] {
    return [...this.backups];
  }
}
