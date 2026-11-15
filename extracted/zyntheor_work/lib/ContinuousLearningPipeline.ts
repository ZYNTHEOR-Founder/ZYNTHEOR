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
 *   8. Fail-Closed Regression Gate (candidate.nll < baseline.nll - margin; finite weights; valid SHA-256)
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
  | 'REGRESSION_GATE'
  | 'HUMAN_APPROVAL_GATE'
  | 'MODEL_RELEASE';

export type PipelineRunStatus =
  | 'RUNNING'
  | 'REJECTED_QUALITY'
  | 'REJECTED_REGRESSION_GATE'
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
  stageHistory: Array<{ stage: PipelineStageName; status: 'PASS' | 'FAIL' | 'PENDING'; detail: string; at: string }>;
  datasetManifest: DatasetVersionManifest | null;
  trainingConfig: { steps: number; lr: number; margin: number };
  baselineCheckpointPath: string;
  baselineCheckpointSha256: string | null;
  candidateCheckpointPath: string | null;
  candidateCheckpointSha256: string | null;
  baselineEval: Record<string, any> | null;
  candidateEval: Record<string, any> | null;
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

export class ContinuousLearningPipeline {
  private static instance: ContinuousLearningPipeline | null = null;
  private rootDir: string;
  private runsFile: string;
  private backupsFile: string;
  private runs: ContinuousLearningRunRecord[] = [];
  private backups: CheckpointBackupRecord[] = [];

  private constructor() {
    this.rootDir = process.env.ZYNTHEOR_TRAINING_PIPELINE_DIR
      ? path.resolve(process.env.ZYNTHEOR_TRAINING_PIPELINE_DIR)
      : path.resolve(process.cwd(), 'native_data', 'training_pipeline');
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
    baselineCheckpointPath?: string;
    seed?: number;
  }): Promise<ContinuousLearningRunRecord> {
    const runId = `cl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();
    const steps = Math.max(4, Math.min(Number(params.steps ?? 16), 60));
    const lr = Number(params.lr ?? 0.015);
    const margin = Number(params.margin ?? -0.02); // Default requires strict or improved NLL; callers can pass > 0 for stricter gating
    const baselineCheckpointPath = params.baselineCheckpointPath
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
      trainingConfig: { steps, lr, margin },
      baselineCheckpointPath,
      baselineCheckpointSha256: fs.existsSync(baselineCheckpointPath) ? this.fileSha256(baselineCheckpointPath) : null,
      candidateCheckpointPath: null,
      candidateCheckpointSha256: null,
      baselineEval: null,
      candidateEval: null,
      nllDelta: null,
      regressionPassed: false,
      approvalRequestId: null,
      promotedAt: null,
      promotedBy: null,
      backupBeforePromote: null,
    };

    const pushStage = (stage: PipelineStageName, status: 'PASS' | 'FAIL' | 'PENDING', detail: string) => {
      record.stageHistory.push({ stage, status, detail, at: new Date().toISOString() });
      record.updatedAt = new Date().toISOString();
    };

    try {
      // 1. DATA COLLECTION (KnowledgeWorkspace docs or explicit corpus — NEVER auto-drains production episodic memory)
      const rawInputs: Array<{ docId: string; text: string }> = [];
      if (Array.isArray(params.customSamples) && params.customSamples.length > 0) {
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
      pushStage('DATA_COLLECTION', 'PASS', `Collected ${rawInputs.length} raw text source(s) (memory isolated)`);

      // 2. QUALITY FILTERING + 3. DEDUPLICATION + 4. PRIVACY FILTERING
      let rejectedQuality = 0;
      let dedupedCount = 0;
      let privacyRedactedCount = 0;
      const seenHashes = new Set<string>();
      const cleanSamples: Array<{ docId: string; text: string }> = [];

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

      pushStage('QUALITY_FILTERING', cleanSamples.length >= 2 ? 'PASS' : 'FAIL', `Kept ${cleanSamples.length}, rejected ${rejectedQuality} low-quality sample(s)`);
      pushStage('DEDUPLICATION', 'PASS', `Removed ${dedupedCount} duplicate sample(s)`);
      pushStage('PRIVACY_FILTERING', 'PASS', `Scrubbed ${privacyRedactedCount} PII/secret pattern(s)`);

      if (cleanSamples.length < 2) {
        record.status = 'REJECTED_QUALITY';
        record.error = 'Insufficient clean disjoint samples (minimum 2 required for train + held-out val split)';
        this.runs.unshift(record);
        this.save();
        return record;
      }

      // Deterministic disjoint train/val split (last 25%, min 1 doc in val)
      const valCount = Math.max(1, Math.floor(cleanSamples.length * 0.25));
      const trainSamples = cleanSamples.slice(0, cleanSamples.length - valCount).map((s) => s.text);
      const valSamples = cleanSamples.slice(cleanSamples.length - valCount).map((s) => s.text);

      // 5. DATASET VERSIONING
      const datasetVersion = `ds_v_${Date.now()}`;
      const datasetSha256 = crypto
        .createHash('sha256')
        .update(JSON.stringify({ trainSamples, valSamples }))
        .digest('hex');

      const manifest: DatasetVersionManifest = {
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
      };
      fs.writeFileSync(path.join(this.rootDir, 'datasets', `${datasetVersion}.json`), JSON.stringify(manifest, null, 2), 'utf8');
      record.datasetManifest = manifest;
      pushStage('DATASET_VERSIONING', 'PASS', `Frozen ${datasetVersion} (sha256=${datasetSha256.slice(0, 12)}..., train=${trainSamples.length}, val=${valSamples.length})`);

      // 6 & 7 & 8. REAL NATIVE WEIGHT TRAINING + HELD-OUT VALIDATION + REGRESSION GATE
      const candidatePath = path.join(this.rootDir, 'checkpoints', `${runId}_candidate.pt`);
      const scriptPath = path.resolve(process.cwd(), 'qplus_native', 'batch28_train.py');
      const trainReq = {
        op: 'train',
        dataset_version: datasetVersion,
        dataset_sha256: datasetSha256,
        train_texts: trainSamples,
        val_texts: valSamples,
        steps,
        lr,
        margin: params.margin ?? 0.0,
        seed: params.seed ?? 2028,
        baseline_checkpoint_path: fs.existsSync(baselineCheckpointPath) ? baselineCheckpointPath : null,
        candidate_checkpoint_path: candidatePath,
      };

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

      if (pyResult.status === 'FAILED') {
        record.status = 'FAILED';
        record.error = pyResult.reason || 'Native training failed';
        pushStage('NATIVE_TRAINING', 'FAIL', record.error || 'Native training failed');
        this.runs.unshift(record);
        this.save();
        return record;
      }

      record.baselineEval = pyResult.baseline_eval || null;
      record.candidateEval = pyResult.candidate_eval || null;
      record.nllDelta = typeof pyResult.nll_delta === 'number' ? pyResult.nll_delta : null;
      record.regressionPassed = Boolean(pyResult.regression_passed);
      record.candidateCheckpointPath = pyResult.candidate_checkpoint_path || null;
      record.candidateCheckpointSha256 = pyResult.candidate_checkpoint_sha256 || null;

      pushStage(
        'NATIVE_TRAINING',
        'PASS',
        `PureSeqLM trained ${steps} steps (${pyResult.training?.tokens_processed || 0} tokens, ${pyResult.total_params} params)`
      );
      pushStage(
        'VALIDATION_BENCHMARK',
        'PASS',
        `Baseline NLL=${record.baselineEval?.nll} -> Candidate NLL=${record.candidateEval?.nll} (delta=${record.nllDelta})`
      );

      if (!record.regressionPassed || !record.candidateCheckpointSha256) {
        record.status = 'REJECTED_REGRESSION_GATE';
        pushStage(
          'REGRESSION_GATE',
          'FAIL',
          `Fail-closed: candidate did not improve held-out NLL by margin=${params.margin ?? 0.0}. Active checkpoint untouched.`
        );
        this.runs.unshift(record);
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
        `Candidate beat baseline on held-out split (NLL delta=${record.nllDelta}, sha256=${record.candidateCheckpointSha256.slice(0, 12)}...)`
      );

      // 9. HUMAN APPROVAL GATE (mandatory before Model Release)
      const approval = ApprovalGate.getInstance().requestApproval({
        actionType: 'MODEL_RELEASE',
        resourceId: runId,
        description: `Promote trained PureSeqLM candidate ${runId} (NLL ${record.baselineEval?.nll} -> ${record.candidateEval?.nll}) into active target checkpoint`,
        requestedByUserId: params.initiatedBy,
        requestedByRole: 'AUTONOMOUS_AGENT',
        tenantId: params.tenantId,
        riskLevel: 'critical',
        metadata: {
          datasetVersion,
          datasetSha256,
          candidateCheckpointSha256: record.candidateCheckpointSha256,
          baselineNll: record.baselineEval?.nll,
          candidateNll: record.candidateEval?.nll,
        },
      });
      record.approvalRequestId = approval.requestId;
      record.status = 'AWAITING_APPROVAL';
      pushStage('HUMAN_APPROVAL_GATE', 'PENDING', `Awaiting human approval (${approval.requestId}) before checkpoint promotion`);

      this.runs.unshift(record);
      this.save();

      AuditLedger.append('EVOLVER', 'CONTINUOUS_LEARNING_CANDIDATE_READY', {
        runId,
        datasetVersion,
        candidateCheckpointSha256: record.candidateCheckpointSha256,
        approvalRequestId: approval.requestId,
      });

      return record;
    } catch (err: any) {
      record.status = 'FAILED';
      record.error = err?.message || String(err);
      pushStage('NATIVE_TRAINING', 'FAIL', record.error || 'Native training failed');
      this.runs.unshift(record);
      this.save();
      return record;
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
    if (!run.regressionPassed || !run.candidateCheckpointPath || !fs.existsSync(run.candidateCheckpointPath)) {
      throw new Error('PROMOTION_BLOCKED: Candidate checkpoint missing or failed regression gate.');
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
