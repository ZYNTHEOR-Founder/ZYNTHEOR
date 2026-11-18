/**
 * ZYNTHEOR Native NumPy Backend & 5,800-Step Training Pipeline Service
 *
 * Manages:
 * 1. Native NumPy backend probing and interpreter binding (`ZYNTHEOR_PYTHON_BIN`).
 * 2. Fail-closed 5,800-step training pipeline initialization with verification checkpoints.
 * 3. Execution gating: refuses to start actual training unless real NumPy, verified dataset,
 *    cryptographic provenance manifest + HMAC key, and explicit human approval all pass.
 */

import fs from 'fs';
import path from 'path';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { AuditLedger } from './AuditLedger.ts';
import { ApprovalGate } from './ApprovalGate.ts';
import { CloudObjectStorageService, type CloudPreflightReport } from './CloudObjectStorageService.ts';

const execFileAsync = promisify(execFile);

export const DEFAULT_TARGET_STEPS = 5800;
export const TARGET_41M_PARAMS = 41_527_808;
const PIPELINE_DIR_REL = path.join('native_data', 'training_pipeline');
const PIPELINE_INIT_FILE = 'pipeline_5800_init.json';
const VENV_DIR_REL = '.venv-numpy';

export interface NativeNumpyEnvReport {
  status: 'NUMPY_NATIVE_READY' | 'NP_COMPAT_ONLY_BLOCKED' | 'PYTHON_UNAVAILABLE';
  pythonAvailable: boolean;
  pythonExecutable: string | null;
  pythonVersion: string | null;
  numpyAvailable: boolean;
  numpyVersion: string | null;
  numpyModuleFile: string | null;
  boto3Available?: boolean;
  boto3Version?: string | null;
  float32Verified: boolean;
  npCompatAvailable: boolean;
  pipAvailable: boolean;
  ensurepipAvailable: boolean;
  venvAvailable: boolean;
  trainTargetScriptPresent: boolean;
  configuredPythonBin: string | null;
  probeLatencyMs: number;
  error: string | null;
  remediationCommands: string[];
  checkedAt: string;
}

export interface VerificationCheckpointMilestone {
  kind: 'periodic_verification' | 'final_verification';
  localStep: number;
  globalStep: number;
  checks: string[];
}

export interface TrainingSchedule5800 {
  startStep: number;
  targetSteps: number;
  plannedRunSteps: number;
  finalStep: number;
  evalEvery: number;
  saveEvery: number;
  evalCount: number;
  checkpointCount: number;
  milestones: VerificationCheckpointMilestone[];
}

export interface InitializeTrainingPipelineInput {
  targetSteps?: number;
  steps?: number;
  evalEvery?: number;
  saveEvery?: number;
  batch?: number;
  lr?: number;
  weightDecay?: number;
  tokenizerProfile?: 'v2_base' | 'bilingual_v4';
  initCheckpoint?: string;
  outCheckpoint?: string;
  datasetFile?: string;
  provenanceManifest?: string;
  evidenceRoot?: string;
  approvalKeyFile?: string;
  approvalRequestId?: string;
  humanApprovalConfirmed?: boolean;
  allowFreshInit?: boolean;
  pythonBin?: string;
  tenantId?: string;
  cloudObjectKey?: string;
  verifyCloudReadWrite?: boolean;
}

export interface TrainingPipelineGateCheck {
  id: 'cloud_preflight' | 'native_numpy' | 'checkpoint_paths' | 'verified_dataset' | 'provenance_manifest' | 'human_approval';
  label: string;
  passed: boolean;
  detail: string;
}

export interface TrainingPipelineInitSnapshot {
  schemaVersion: 'zyntheor.training-pipeline-init.v1';
  pipelineId: string;
  initializedAt: string;
  trainingExecuted: false;
  canExecuteTraining: boolean;
  status: 'READY' | 'BLOCKED';
  cloudPreflight: CloudPreflightReport;
  numpyEnvironment: NativeNumpyEnvReport;
  config: {
    targetSteps: number;
    steps: number | null;
    evalEvery: number;
    saveEvery: number;
    batch: number;
    lr: number;
    weightDecay: number;
    tokenizerProfile: 'v2_base' | 'bilingual_v4';
    initCheckpoint: string;
    outCheckpoint: string;
    cloudObjectKey: string;
    datasetFile: string | null;
    provenanceManifest: string;
    evidenceRoot: string;
    approvalKeyFile: string | null;
    approvalRequestId: string | null;
    humanApprovalConfirmed: boolean;
    allowFreshInit: boolean;
  };
  schedule: TrainingSchedule5800;
  gates: TrainingPipelineGateCheck[];
  blockers: string[];
  pythonPreflight: Record<string, any> | null;
  cliCommand: string;
  manifestPath: string;
}

const PIPELINE_EXEC_STATUS_FILE = 'execution_status.json';

export interface TrainingProgressAlert {
  id: 'stalled_progress' | 'val_loss_rising';
  severity: 'warning';
  title: string;
  detail: string;
  detectedAt: string;
}

export interface TimeToEpochEstimate {
  windowSteps: number;
  maxWindowSteps: number;
  averageStepSeconds: number | null;
  remainingStepsInEpoch: number;
  estimatedSecondsToEpoch: number | null;
  recentStepDurationsSec: number[];
  basis: 'last_10_steps' | 'completed' | 'awaiting_step_history';
}

export interface TrainingLoopExecutionStatus {
  running: boolean;
  trainingCompletedVerified: boolean;
  pid: number | null;
  pipelineId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastStepAdvanceAt: string | null;
  exitCode: number | null;
  currentStep: number;
  targetSteps: number;
  evaluationsRecorded: number;
  evalEvidencePath: string | null;
  latestTrainLoss: number | null;
  latestValLoss: number | null;
  latestGradNorm: number | null;
  latestLr: number | null;
  recentStepDurationsSec?: number[];
  verifiedCheckpoints: Array<{
    globalStep: number;
    kind?: string;
    path: string;
    totalParams?: number;
    byteSize?: number;
    payloadSha256: string;
    containerSha256: string;
    verified: boolean;
  }>;
  eventsTail: Array<Record<string, any>>;
  error: string | null;
}

function resolveWorkspacePath(relOrAbs: string): string {
  const root = process.cwd();
  return path.isAbsolute(relOrAbs) ? path.resolve(relOrAbs) : path.resolve(root, relOrAbs);
}

function isInsideWorkspace(targetPath: string): boolean {
  const root = path.resolve(process.cwd());
  const resolved = path.resolve(targetPath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function readPersistedPythonBin(): string | null {
  const envVal = (process.env.ZYNTHEOR_PYTHON_BIN || '').trim();
  if (envVal) return envVal;
  const envLocalPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envLocalPath)) {
    try {
      const raw = fs.readFileSync(envLocalPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        if (key === 'ZYNTHEOR_PYTHON_BIN') {
          let val = trimmed.slice(idx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1).trim();
          }
          if (val) {
            process.env.ZYNTHEOR_PYTHON_BIN = val;
            return val;
          }
        }
      }
    } catch {
      // Ignore env read failure
    }
  }
  const venvPy = path.join(process.cwd(), VENV_DIR_REL, 'bin', 'python3');
  if (fs.existsSync(venvPy)) {
    return venvPy;
  }
  return null;
}

function persistPythonBin(pythonBin: string): void {
  const cleaned = pythonBin.replace(/[\r\n]/g, '').trim();
  process.env.ZYNTHEOR_PYTHON_BIN = cleaned;
  const envLocalPath = path.join(process.cwd(), '.env.local');
  const existing = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, 'utf8').split(/\r?\n/) : [];
  const filtered = existing.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return !trimmed.startsWith('ZYNTHEOR_PYTHON_BIN=');
  });
  const escaped = cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  filtered.push(`ZYNTHEOR_PYTHON_BIN="${escaped}"`);
  fs.writeFileSync(envLocalPath, `${filtered.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function resolveConfiguredApprovalKeyFile(overridePath?: string): string | null {
  const direct = (overridePath || '').trim();
  if (direct) return direct;
  const fromEnv = (process.env.ZYNTHEOR_APPROVAL_KEY_FILE || '').trim();
  if (fromEnv) return fromEnv;
  const cwd = process.cwd();
  for (const fname of ['.env.local', '.env']) {
    const fpath = path.join(cwd, fname);
    try {
      if (!fs.existsSync(fpath)) continue;
      const lines = fs.readFileSync(fpath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const stripped = line.trim();
        if (!stripped || stripped.startsWith('#')) continue;
        const match = stripped.match(/^(?:export\s+)?ZYNTHEOR_APPROVAL_KEY_FILE\s*=\s*(.+)$/);
        if (!match) continue;
        let val = match[1].trim();
        if (
          (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
          (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
        ) {
          val = val.slice(1, -1).trim();
        }
        if (val) {
          process.env.ZYNTHEOR_APPROVAL_KEY_FILE = val;
          return val;
        }
      }
    } catch {
      // Ignore unreadable env file
    }
  }
  return null;
}

export function resolvePythonBinary(customPythonBin?: string): { bin: string; explicit: boolean } {
  const candidate = (customPythonBin || '').trim();
  if (candidate) {
    return { bin: candidate, explicit: true };
  }
  const persisted = readPersistedPythonBin();
  if (persisted) {
    return { bin: persisted, explicit: true };
  }
  return { bin: 'python3', explicit: false };
}

export async function probeNativeNumpyEnvironment(customPythonBin?: string): Promise<NativeNumpyEnvReport> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  const { bin: pythonBin, explicit } = resolvePythonBinary(customPythonBin);
  const trainTargetAbs = path.resolve(process.cwd(), 'qplus_native', 'train_target.py');
  const trainTargetScriptPresent = fs.existsSync(trainTargetAbs);

  const remediationBase = [
    'Install NumPy in a Python virtualenv and bind its interpreter path via ZYNTHEOR_PYTHON_BIN',
    'Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y python3-numpy python3-pip',
    'Or venv: python3 -m venv .venv-numpy && .venv-numpy/bin/pip install numpy',
  ];

  if (explicit && !fs.existsSync(pythonBin)) {
    return {
      status: 'PYTHON_UNAVAILABLE',
      pythonAvailable: false,
      pythonExecutable: pythonBin,
      pythonVersion: null,
      numpyAvailable: false,
      numpyVersion: null,
      numpyModuleFile: null,
      boto3Available: false,
      boto3Version: null,
      float32Verified: false,
      npCompatAvailable: false,
      pipAvailable: false,
      ensurepipAvailable: false,
      venvAvailable: false,
      trainTargetScriptPresent,
      configuredPythonBin: readPersistedPythonBin(),
      probeLatencyMs: Math.max(1, Date.now() - started),
      error: `Configured Python interpreter not found: ${pythonBin}`,
      remediationCommands: remediationBase,
      checkedAt,
    };
  }

  const pyProbe = [
    'import importlib.util, json, sys',
    'numpy_ok = False',
    'numpy_ver = None',
    'numpy_file = None',
    'float32_ok = False',
    'if importlib.util.find_spec("numpy") is not None:',
    '  try:',
    '    import numpy as np',
    '    numpy_ver = getattr(np, "__version__", None)',
    '    numpy_file = str(getattr(np, "__file__", ""))',
    '    if getattr(np, "__name__", "") == "numpy" and "np_compat" not in numpy_file:',
    '      arr = np.zeros((2, 2), dtype=np.float32)',
    '      float32_ok = (str(arr.dtype) == "float32")',
    '      numpy_ok = bool(numpy_ver and float32_ok)',
    '  except Exception:',
    '    numpy_ok = False',
    'boto3_ok = False',
    'boto3_ver = None',
    'if importlib.util.find_spec("boto3") is not None:',
    '  try:',
    '    import boto3',
    '    boto3_ver = getattr(boto3, "__version__", None)',
    '    boto3_ok = bool(boto3_ver)',
    '  except Exception:',
    '    boto3_ok = False',
    'np_compat_ok = False',
    'try:',
    '  from qplus_native import np_compat',
    '  np_compat_ok = hasattr(np_compat, "array")',
    'except Exception:',
    '  np_compat_ok = False',
    'print(json.dumps({',
    '  "pythonVersion": sys.version.split()[0],',
    '  "pythonExecutable": sys.executable,',
    '  "numpyAvailable": numpy_ok,',
    '  "numpyVersion": numpy_ver,',
    '  "numpyModuleFile": numpy_file,',
    '  "boto3Available": boto3_ok,',
    '  "boto3Version": boto3_ver,',
    '  "float32Verified": float32_ok,',
    '  "npCompatAvailable": np_compat_ok,',
    '  "pipAvailable": importlib.util.find_spec("pip") is not None,',
    '  "ensurepipAvailable": importlib.util.find_spec("ensurepip") is not None,',
    '  "venvAvailable": importlib.util.find_spec("venv") is not None,',
    '}))',
  ].join('\n');

  try {
    const { stdout } = await execFileAsync(pythonBin, ['-B', '-c', pyProbe], {
      cwd: process.cwd(),
      timeout: 8000,
    });
    const parsed = JSON.parse(stdout.trim() || '{}');
    const numpyAvailable = Boolean(parsed.numpyAvailable && parsed.float32Verified);
    const npCompatAvailable = Boolean(parsed.npCompatAvailable);
    const status: NativeNumpyEnvReport['status'] = numpyAvailable
      ? 'NUMPY_NATIVE_READY'
      : 'NP_COMPAT_ONLY_BLOCKED';

    return {
      status,
      pythonAvailable: true,
      pythonExecutable: parsed.pythonExecutable ?? pythonBin,
      pythonVersion: parsed.pythonVersion ?? null,
      numpyAvailable,
      numpyVersion: parsed.numpyVersion ?? null,
      numpyModuleFile: parsed.numpyModuleFile ?? null,
      boto3Available: Boolean(parsed.boto3Available),
      boto3Version: parsed.boto3Version ?? null,
      float32Verified: Boolean(parsed.float32Verified),
      npCompatAvailable,
      pipAvailable: Boolean(parsed.pipAvailable),
      ensurepipAvailable: Boolean(parsed.ensurepipAvailable),
      venvAvailable: Boolean(parsed.venvAvailable),
      trainTargetScriptPresent,
      configuredPythonBin: readPersistedPythonBin(),
      probeLatencyMs: Math.max(1, Date.now() - started),
      error: numpyAvailable
        ? null
        : 'Real C-extension NumPy is not installed in this Python runtime (np_compat fallback is forbidden for 5,800-step 41.5M training).',
      remediationCommands: numpyAvailable ? [] : remediationBase,
      checkedAt,
    };
  } catch (err: any) {
    return {
      status: 'PYTHON_UNAVAILABLE',
      pythonAvailable: false,
      pythonExecutable: pythonBin,
      pythonVersion: null,
      numpyAvailable: false,
      numpyVersion: null,
      numpyModuleFile: null,
      boto3Available: false,
      boto3Version: null,
      float32Verified: false,
      npCompatAvailable: false,
      pipAvailable: false,
      ensurepipAvailable: false,
      venvAvailable: false,
      trainTargetScriptPresent,
      configuredPythonBin: readPersistedPythonBin(),
      probeLatencyMs: Math.max(1, Date.now() - started),
      error: err?.message || 'Failed to invoke Python interpreter.',
      remediationCommands: remediationBase,
      checkedAt,
    };
  }
}

export async function establishNativeNumpyEnvironment(opts?: {
  pythonBin?: string;
  attemptInstall?: boolean;
}): Promise<{
  established: boolean;
  report: NativeNumpyEnvReport;
  actionTaken: string;
  error: string | null;
}> {
  const customBin = opts?.pythonBin?.trim();
  if (customBin) {
    const stat = fs.existsSync(customBin) ? fs.statSync(customBin) : null;
    if (!stat || !stat.isFile()) {
      const report = await probeNativeNumpyEnvironment();
      return {
        established: false,
        report,
        actionTaken: 'VALIDATE_CUSTOM_PYTHON_BIN',
        error: `Provided Python interpreter path does not exist or is not a file: ${customBin}`,
      };
    }
    const probe = await probeNativeNumpyEnvironment(customBin);
    if (!probe.numpyAvailable) {
      return {
        established: false,
        report: probe,
        actionTaken: 'VALIDATE_CUSTOM_PYTHON_BIN',
        error: probe.error || `Python at '${customBin}' does not have real NumPy + float32 installed.`,
      };
    }
    persistPythonBin(customBin);
    AuditLedger.append('SYSTEM', 'NATIVE_NUMPY_ENV_BOUND', {
      pythonExecutable: probe.pythonExecutable,
      numpyVersion: probe.numpyVersion,
    });
    return {
      established: true,
      report: { ...probe, configuredPythonBin: customBin },
      actionTaken: 'BOUND_VERIFIED_PYTHON_INTERPRETER',
      error: null,
    };
  }

  const initialProbe = await probeNativeNumpyEnvironment();
  if (initialProbe.numpyAvailable) {
    return {
      established: true,
      report: initialProbe,
      actionTaken: 'ALREADY_READY',
      error: null,
    };
  }

  if (!opts?.attemptInstall) {
    return {
      established: false,
      report: initialProbe,
      actionTaken: 'PROBE_ONLY',
      error: initialProbe.error,
    };
  }

  // Attempt safe virtualenv provisioning ONLY if pip or ensurepip is actually present
  if (!initialProbe.pipAvailable && !initialProbe.ensurepipAvailable) {
    return {
      established: false,
      report: initialProbe,
      actionTaken: 'PIP_UNAVAILABLE_FAIL_CLOSED',
      error:
        'Cannot install NumPy automatically: system python3 lacks both pip and ensurepip. Install python3-numpy via OS packages or provide a venv Python path containing NumPy.',
    };
  }

  const venvDir = path.resolve(process.cwd(), VENV_DIR_REL);
  const venvPy = path.join(venvDir, 'bin', 'python3');
  try {
    if (!fs.existsSync(venvPy)) {
      await execFileAsync('python3', ['-m', 'venv', venvDir], { cwd: process.cwd(), timeout: 30_000 });
    }
    if (!initialProbe.pipAvailable && initialProbe.ensurepipAvailable) {
      await execFileAsync(venvPy, ['-m', 'ensurepip', '--upgrade'], { cwd: process.cwd(), timeout: 30_000 });
    }
    await execFileAsync(venvPy, ['-m', 'pip', 'install', '--no-input', 'numpy'], {
      cwd: process.cwd(),
      timeout: 180_000,
    });
    const postProbe = await probeNativeNumpyEnvironment(venvPy);
    if (postProbe.numpyAvailable) {
      persistPythonBin(venvPy);
      AuditLedger.append('SYSTEM', 'NATIVE_NUMPY_ENV_INSTALLED', {
        pythonExecutable: postProbe.pythonExecutable,
        numpyVersion: postProbe.numpyVersion,
      });
      return {
        established: true,
        report: postProbe,
        actionTaken: 'PROVISIONED_VENV_NUMPY',
        error: null,
      };
    }
    return {
      established: false,
      report: postProbe,
      actionTaken: 'POST_INSTALL_VERIFICATION_FAILED',
      error: postProbe.error || 'NumPy installation did not verify float32 support.',
    };
  } catch (err: any) {
    const postProbe = await probeNativeNumpyEnvironment();
    return {
      established: false,
      report: postProbe,
      actionTaken: 'INSTALL_FAILED',
      error: `NumPy environment installation failed: ${err?.message || String(err)}`,
    };
  }
}

export function build5800VerificationSchedule(params: {
  startStep?: number;
  targetSteps?: number;
  steps?: number | null;
  evalEvery?: number;
  saveEvery?: number;
}): TrainingSchedule5800 {
  const startStep = Math.max(0, Math.floor(params.startStep ?? 0));
  const targetSteps = Math.max(1, Math.floor(params.targetSteps ?? DEFAULT_TARGET_STEPS));
  const evalEvery = Math.max(1, Math.floor(params.evalEvery ?? 25));
  const saveEvery = Math.max(1, Math.floor(params.saveEvery ?? 100));
  const plannedRunSteps =
    params.steps !== undefined && params.steps !== null
      ? Math.max(0, Math.floor(params.steps))
      : Math.max(0, targetSteps - startStep);

  const milestones: VerificationCheckpointMilestone[] = [];
  if (plannedRunSteps > 0) {
    for (let localStep = saveEvery; localStep < plannedRunSteps; localStep += saveEvery) {
      milestones.push({
        kind: 'periodic_verification',
        localStep,
        globalStep: startStep + localStep,
        checks: [
          'finite_logits_loss',
          'finite_gradients_and_norm',
          'finite_float32_weights',
          'sha256_payload_seal',
          'sha256_container_seal',
        ],
      });
    }
    milestones.push({
      kind: 'final_verification',
      localStep: plannedRunSteps,
      globalStep: startStep + plannedRunSteps,
      checks: [
        'finite_logits_loss',
        'finite_gradients_and_norm',
        'finite_float32_weights',
        'sha256_payload_seal',
        'sha256_container_seal',
        'param_count_41527808',
        'best_val_checkpoint_selection',
      ],
    });
  }

  const evalCount =
    plannedRunSteps <= 0
      ? 0
      : Math.floor(plannedRunSteps / evalEvery) + (plannedRunSteps % evalEvery !== 0 ? 1 : 0);

  return {
    startStep,
    targetSteps,
    plannedRunSteps,
    finalStep: startStep + plannedRunSteps,
    evalEvery,
    saveEvery,
    evalCount,
    checkpointCount: milestones.length,
    milestones,
  };
}

export async function initializeTrainingPipeline(
  input: InitializeTrainingPipelineInput = {}
): Promise<TrainingPipelineInitSnapshot> {
  const targetSteps = Math.max(1, Math.min(50_000, Math.floor(input.targetSteps ?? DEFAULT_TARGET_STEPS)));
  const steps = input.steps !== undefined && input.steps !== null ? Math.floor(input.steps) : null;
  const evalEvery = Math.max(1, Math.min(5000, Math.floor(input.evalEvery ?? 25)));
  const saveEvery = Math.max(1, Math.min(5000, Math.floor(input.saveEvery ?? 100)));
  const batch = Math.max(1, Math.min(32, Math.floor(input.batch ?? 2)));
  const lr = typeof input.lr === 'number' && Number.isFinite(input.lr) && input.lr > 0 ? input.lr : 3e-4;
  const weightDecay =
    typeof input.weightDecay === 'number' && Number.isFinite(input.weightDecay) && input.weightDecay >= 0
      ? input.weightDecay
      : 0.01;
  const tokenizerProfile: 'v2_base' | 'bilingual_v4' =
    input.tokenizerProfile === 'bilingual_v4' ? 'bilingual_v4' : 'v2_base';
  const allowFreshInit = Boolean(input.allowFreshInit);

  const initCheckpointRel = (input.initCheckpoint || 'native_data/model_checkpoint_target_41m.pt').trim();
  const outCheckpointRel = (input.outCheckpoint || `native_data/model_checkpoint_target_41m_step${targetSteps}.pt`).trim();
  const provenanceRel = (input.provenanceManifest || 'artifacts/dataset-provenance-manifest.json').trim();
  const evidenceRootRel = (input.evidenceRoot || 'artifacts/dataset-provenance-evidence').trim();
  const datasetRel = (input.datasetFile?.trim() || 'native_data/datasets');
  const approvalKeyRel = resolveConfiguredApprovalKeyFile(input.approvalKeyFile);
  const approvalRequestId = input.approvalRequestId?.trim() || null;

  // Ensure workspace paths do not escape project root
  const initAbs = resolveWorkspacePath(initCheckpointRel);
  const outAbs = resolveWorkspacePath(outCheckpointRel);
  const provAbs = resolveWorkspacePath(provenanceRel);
  const evidAbs = resolveWorkspacePath(evidenceRootRel);
  const datasetAbs = datasetRel ? resolveWorkspacePath(datasetRel) : null;
  const approvalKeyAbs = approvalKeyRel ? resolveWorkspacePath(approvalKeyRel) : null;

  if (!isInsideWorkspace(initAbs) || !isInsideWorkspace(outAbs) || !isInsideWorkspace(provAbs) || !isInsideWorkspace(evidAbs)) {
    throw new Error('FORBIDDEN: Training pipeline paths must remain inside the workspace root.');
  }
  if (datasetAbs && !isInsideWorkspace(datasetAbs)) {
    throw new Error('FORBIDDEN: Dataset path must remain inside the workspace root.');
  }

  // Ensure pipeline directory exists so initialization state & checkpoints have a writable root
  const pipelineDirAbs = resolveWorkspacePath(PIPELINE_DIR_REL);
  fs.mkdirSync(pipelineDirAbs, { recursive: true });
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });

  const cloudPreflight = await CloudObjectStorageService.runCloudPreflight({
    objectKey: input.cloudObjectKey?.trim() || undefined,
    verifyReadWrite: input.verifyCloudReadWrite !== false,
  });

  const numpyEnvironment = await probeNativeNumpyEnvironment(input.pythonBin);

  // Inspect human approval gate (ApprovalGate record and/or explicit human confirmation)
  let gateApproved = Boolean(input.humanApprovalConfirmed);
  let approvalDetail = gateApproved
    ? 'Explicit human approval confirmation provided.'
    : 'Human approval not confirmed.';
  let approvedGateRecord: ReturnType<ApprovalGate['getRequest']> = undefined;

  if (approvalRequestId) {
    const scopeTenant = input.tenantId || undefined;
    const rec = ApprovalGate.getInstance().getRequest(approvalRequestId, scopeTenant ? { tenantId: scopeTenant } : undefined);
    const validAction = rec && (rec.actionType === 'MODEL_RELEASE' || rec.actionType === 'SYSTEM_CONFIG_MUTATION');
    const validReviewer = Boolean(rec?.reviewedByUserId && (rec.reviewedByRole === 'admin' || rec.reviewedByRole === 'operator'));
    if (!rec) {
      gateApproved = false;
      approvalDetail = `ApprovalGate '${approvalRequestId}' not found for current tenant.`;
    } else if (!validAction) {
      gateApproved = false;
      approvalDetail = `ApprovalGate '${approvalRequestId}' has unsupported actionType '${rec.actionType}'.`;
    } else if (rec.status !== 'APPROVED' || !validReviewer) {
      gateApproved = false;
      approvalDetail = `ApprovalGate '${approvalRequestId}' status is ${rec.status} (human admin review required).`;
    } else {
      approvedGateRecord = rec;
      gateApproved = true;
      approvalDetail = `Approved via ApprovalGate '${rec.requestId}' (${rec.resourceId}) by ${rec.reviewedByUserId} (${rec.reviewedByRole}).`;
    }
  } else {
    const scopeTenant = input.tenantId || 'tenant_sovereign_prime';
    const matchingApproved = ApprovalGate.getInstance()
      .listRequests({ tenantId: scopeTenant, status: 'APPROVED' })
      .find((r) => (r.actionType === 'MODEL_RELEASE' || r.actionType === 'SYSTEM_CONFIG_MUTATION') && /training|5800|41m/i.test(r.resourceId));
    if (matchingApproved && gateApproved) {
      approvedGateRecord = matchingApproved;
      approvalDetail = `Confirmed + linked to ApprovalGate '${matchingApproved.requestId}' (${matchingApproved.reviewedByUserId}).`;
    }
  }

  // Try Python preflight when real NumPy is available
  let pythonPreflight: Record<string, any> | null = null;
  const pythonBin = numpyEnvironment.pythonExecutable || resolvePythonBinary(input.pythonBin).bin;
  if (numpyEnvironment.numpyAvailable && numpyEnvironment.trainTargetScriptPresent) {
    const args = [
      '-B',
      '-m',
      'qplus_native.train_target',
      '--preflight-only',
      '--probe-s3',
      '--init',
      initAbs,
      '--out',
      outAbs,
      '--target-steps',
      String(targetSteps),
      '--eval-every',
      String(evalEvery),
      '--save-every',
      String(saveEvery),
      '--tokenizer-profile',
      tokenizerProfile,
      '--dataset-provenance',
      provAbs,
      '--evidence-root',
      evidAbs,
    ];
    if (steps !== null) args.push('--steps', String(steps));
    if (approvalKeyAbs) args.push('--approval-key-file', approvalKeyAbs);
    if (datasetAbs) args.push('--dataset-file', datasetAbs);
    if (gateApproved) args.push('--human-approval-confirmed');
    if (allowFreshInit) args.push('--allow-fresh-init');

    try {
      const { stdout } = await execFileAsync(pythonBin, args, { cwd: process.cwd(), timeout: 20_000 });
      pythonPreflight = JSON.parse(stdout.trim()) as Record<string, any>;
    } catch (err: any) {
      // train_target.py exits 2 when preflight status is BLOCKED, still printing JSON to stdout
      if (err?.stdout && String(err.stdout).trim().startsWith('{')) {
        try {
          pythonPreflight = JSON.parse(String(err.stdout).trim()) as Record<string, any>;
        } catch {
          pythonPreflight = null;
        }
      } else {
        pythonPreflight = null;
      }
    }
  }

  // Evaluate 6 mandatory fail-closed gates (Cloud Preflight + Native NumPy + Paths + Dataset + Provenance + Human Approval)
  const blockers: string[] = [];

  // Gate 0: AWS S3 Cloud Preflight (credentials, bucket availability, checkpoint existence & accessibility)
  const cloudPreflightPassed = Boolean(cloudPreflight.passed);
  if (!cloudPreflightPassed) {
    if (cloudPreflight.blockers.length > 0) {
      blockers.push(...cloudPreflight.blockers);
    } else {
      blockers.push('cloud_preflight_blocked');
    }
  }

  // Gate 1: Native NumPy
  const numpyPassed = Boolean(numpyEnvironment.numpyAvailable && numpyEnvironment.float32Verified);
  if (!numpyPassed) {
    blockers.push('native_numpy_backend_unavailable');
  }

  // Gate 2: Checkpoint Paths & Non-Destructive Invariant
  const pathIssues: string[] = [];
  if (path.resolve(initAbs) === path.resolve(outAbs)) {
    pathIssues.push('out_path_equals_init_checkpoint_forbidden');
  }
  if (fs.existsSync(outAbs)) {
    pathIssues.push(`out_checkpoint_already_exists:${outCheckpointRel}`);
  }
  if (!allowFreshInit && !fs.existsSync(initAbs)) {
    pathIssues.push(`init_checkpoint_missing:${initCheckpointRel}`);
  }
  if (pythonPreflight?.init_checkpoint?.structural_audit?.integrity_status &&
      pythonPreflight.init_checkpoint.structural_audit.integrity_status !== 'STRUCTURAL_CHECKS_PASS') {
    pathIssues.push('init_checkpoint_structural_audit_failed');
  }
  blockers.push(...pathIssues);
  const pathsPassed = pathIssues.length === 0;

  // Gate 3: Verified Dataset File or Prepared Split Directory
  const datasetIssues: string[] = [];
  if (!datasetAbs) {
    datasetIssues.push('verified_dataset_file_missing');
  } else if (!fs.existsSync(datasetAbs)) {
    datasetIssues.push(`dataset_file_not_found:${datasetRel}`);
  } else {
    const stat = fs.statSync(datasetAbs);
    if (stat.isDirectory()) {
      for (const sp of ['train.jsonl', 'validation.jsonl', 'test.jsonl']) {
        if (!fs.existsSync(path.join(datasetAbs, sp))) {
          datasetIssues.push(`dataset_split_missing:${datasetRel}/${sp}`);
        }
      }
    }
    if (pythonPreflight?.blockers) {
      for (const b of pythonPreflight.blockers as string[]) {
        if (b.startsWith('dataset_file_invalid')) datasetIssues.push(b);
      }
    }
  }
  blockers.push(...datasetIssues);
  const datasetPassed = datasetIssues.length === 0;

  // Gate 4: Provenance Manifest + Evidence Root + Trusted Approval Key
  const provenanceIssues: string[] = [];
  if (!fs.existsSync(provAbs)) {
    provenanceIssues.push('dataset_provenance_manifest_missing');
  }
  if (!fs.existsSync(evidAbs)) {
    provenanceIssues.push('dataset_provenance_evidence_dir_missing');
  }
  if (!approvalKeyAbs || !fs.existsSync(approvalKeyAbs)) {
    provenanceIssues.push('trusted_approval_key_missing');
  }
  if (pythonPreflight?.dataset_governance?.status && pythonPreflight.dataset_governance.status !== 'VERIFIED') {
    const subIssues: string[] = Array.isArray(pythonPreflight.dataset_governance.issues)
      ? pythonPreflight.dataset_governance.issues
      : ['dataset_governance_blocked'];
    for (const iss of subIssues) {
      if (!provenanceIssues.includes(iss)) provenanceIssues.push(iss);
    }
  } else if (!pythonPreflight && provenanceIssues.length === 0) {
    // Even if files exist, if NumPy wasn't available to run Python HMAC check, inspect pending status if manifest is placeholder
    try {
      const m = JSON.parse(fs.readFileSync(provAbs, 'utf8'));
      if (!Array.isArray(m?.documents) || m.documents.length === 0) {
        provenanceIssues.push('dataset_provenance_manifest_empty');
      }
    } catch {
      provenanceIssues.push('dataset_provenance_manifest_invalid');
    }
  }
  blockers.push(...provenanceIssues);
  const provenancePassed = provenanceIssues.length === 0 && Boolean(
    !pythonPreflight || pythonPreflight.dataset_governance?.status === 'VERIFIED'
  );

  // Gate 5: Human Approval Gate
  if (!gateApproved) {
    blockers.push('human_approval_confirmation_missing');
  }

  // Merge any extra blockers reported by Python preflight
  if (Array.isArray(pythonPreflight?.blockers)) {
    for (const b of pythonPreflight.blockers as string[]) {
      if (!blockers.includes(b)) blockers.push(b);
    }
  }

  const dedupedBlockers = Array.from(new Set(blockers));
  const startStep = typeof pythonPreflight?.start_step === 'number' ? pythonPreflight.start_step : 0;
  const schedule = build5800VerificationSchedule({
    startStep,
    targetSteps,
    steps,
    evalEvery,
    saveEvery,
  });

  const gates: TrainingPipelineGateCheck[] = [
    {
      id: 'cloud_preflight',
      label: 'AWS S3 Cloud Preflight & Checkpoint Access',
      passed: cloudPreflightPassed,
      detail: cloudPreflightPassed
        ? `Bucket '${cloudPreflight.bucket}' available · Checkpoint '${cloudPreflight.checkpointKey}' accessible (${cloudPreflight.checkpointSizeBytes ?? 0} bytes)`
        : cloudPreflight.error || cloudPreflight.blockers.join('; ') || 'Cloud Preflight blocked',
    },
    {
      id: 'native_numpy',
      label: 'Native NumPy C-Extension Backend',
      passed: numpyPassed,
      detail: numpyPassed
        ? `NumPy ${numpyEnvironment.numpyVersion} (float32 verified) via ${numpyEnvironment.pythonExecutable}`
        : numpyEnvironment.error || 'Real NumPy not available',
    },
    {
      id: 'checkpoint_paths',
      label: 'Checkpoint & Output Path Integrity',
      passed: pathsPassed,
      detail: pathsPassed
        ? `Init: ${allowFreshInit ? 'fresh-init' : initCheckpointRel} → Out: ${outCheckpointRel}`
        : pathIssues.join('; '),
    },
    {
      id: 'verified_dataset',
      label: 'Frozen Dataset Splits (test excluded)',
      passed: datasetPassed,
      detail: datasetPassed ? `Dataset file present: ${datasetRel}` : datasetIssues.join('; '),
    },
    {
      id: 'provenance_manifest',
      label: 'Dataset Provenance Manifest & HMAC Key',
      passed: provenancePassed,
      detail: provenancePassed
        ? `Verified manifest (${provenanceRel}) with trusted HMAC key`
        : provenanceIssues.join('; ') ||
          (pythonPreflight?.dataset_governance?.status === 'BLOCKED'
            ? '0 documents verified — awaiting Admin HTTPS source/license URLs and HMAC signature'
            : 'dataset_governance_blocked'),
    },
    {
      id: 'human_approval',
      label: 'Explicit Human Approval Gate',
      passed: gateApproved,
      detail: approvalDetail,
    },
  ];

  const canExecuteTraining = dedupedBlockers.length === 0 && gates.every((g) => g.passed);
  const pipelineId = `pipe5800_${Date.now()}`;
  const cliParts = [
    pythonBin,
    '-m qplus_native.train_target',
    `--init ${initCheckpointRel}`,
    `--out ${outCheckpointRel}`,
    `--target-steps ${targetSteps}`,
    `--eval-every ${evalEvery}`,
    `--save-every ${saveEvery}`,
    `--batch ${batch}`,
    `--lr ${lr}`,
    `--tokenizer-profile ${tokenizerProfile}`,
    datasetRel ? `--dataset-file ${datasetRel}` : '--dataset-file <REQUIRED_DATASET_JSONL>',
    approvalKeyRel ? `--approval-key-file ${approvalKeyRel}` : '--approval-key-file <REQUIRED_HMAC_KEY>',
    '--human-approval-confirmed',
  ];

  const snapshot: TrainingPipelineInitSnapshot = {
    schemaVersion: 'zyntheor.training-pipeline-init.v1',
    pipelineId,
    initializedAt: new Date().toISOString(),
    trainingExecuted: false,
    canExecuteTraining,
    status: canExecuteTraining ? 'READY' : 'BLOCKED',
    cloudPreflight,
    numpyEnvironment,
    config: {
      targetSteps,
      steps,
      evalEvery,
      saveEvery,
      batch,
      lr,
      weightDecay,
      tokenizerProfile,
      initCheckpoint: initCheckpointRel,
      outCheckpoint: outCheckpointRel,
      cloudObjectKey: cloudPreflight.checkpointKey,
      datasetFile: datasetRel,
      provenanceManifest: provenanceRel,
      evidenceRoot: evidenceRootRel,
      approvalKeyFile: approvalKeyRel,
      approvalRequestId: approvedGateRecord?.requestId ?? approvalRequestId,
      humanApprovalConfirmed: gateApproved,
      allowFreshInit,
    },
    schedule,
    gates,
    blockers: dedupedBlockers,
    pythonPreflight,
    cliCommand: cliParts.join(' '),
    manifestPath: path.join(PIPELINE_DIR_REL, PIPELINE_INIT_FILE),
  };

  const manifestAbs = path.join(pipelineDirAbs, PIPELINE_INIT_FILE);
  fs.writeFileSync(manifestAbs, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  if (!executionStatus.running && !executionStatus.startedAt) {
    try {
      fs.writeFileSync(
        path.join(pipelineDirAbs, PIPELINE_METRICS_FILE),
        JSON.stringify(
          {
            updatedAt: snapshot.initializedAt,
            initializedAt: snapshot.initializedAt,
            pipelineId: snapshot.pipelineId,
            status: snapshot.status,
            running: false,
            trainingCompletedVerified: false,
            currentStep: startStep,
            targetSteps,
            warmStartSteps: 2800,
            continuationSteps: 3000,
            targetParams: TARGET_41M_PARAMS,
            gatesPassed: gates.filter((g) => g.passed).length,
            gatesTotal: gates.length,
            blockers: dedupedBlockers,
            evaluationsRecorded: 0,
            verifiedCheckpoints: [],
            error: null,
          },
          null,
          2
        ) + '\n',
        'utf8'
      );
    } catch {
      // Best-effort baseline metrics write
    }
  }

  AuditLedger.append('SYSTEM', 'TRAINING_PIPELINE_5800_INITIALIZED', {
    pipelineId,
    status: snapshot.status,
    canExecuteTraining,
    targetSteps,
    checkpointCount: schedule.checkpointCount,
    blockers: dedupedBlockers,
  });

  AuditLedger.emitWorkflowEvent({
    source: 'training_pipeline',
    tag: 'PLANNER',
    isRunning: false,
    message: canExecuteTraining
      ? `Training Plan READY (${pipelineId}): ${schedule.plannedRunSteps} steps, ${schedule.checkpointCount} SHA-256 checkpoints (every ${saveEvery}), ${schedule.evalCount} evals (every ${evalEvery})`
      : `Training Plan BLOCKED (${pipelineId}): ${schedule.plannedRunSteps} steps configured, blockers=[${dedupedBlockers.join(', ')}]`,
  });

  return snapshot;
}

export function loadLastInitializedTrainingPipeline(): TrainingPipelineInitSnapshot | null {
  const manifestAbs = resolveWorkspacePath(path.join(PIPELINE_DIR_REL, PIPELINE_INIT_FILE));
  if (!fs.existsSync(manifestAbs)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestAbs, 'utf8')) as TrainingPipelineInitSnapshot;
  } catch {
    return null;
  }
}

let activeTrainingChild: ChildProcess | null = null;
const executionStatus: TrainingLoopExecutionStatus = {
  running: false,
  trainingCompletedVerified: false,
  pid: null,
  pipelineId: null,
  startedAt: null,
  finishedAt: null,
  lastStepAdvanceAt: null,
  exitCode: null,
  currentStep: 0,
  targetSteps: DEFAULT_TARGET_STEPS,
  evaluationsRecorded: 0,
  evalEvidencePath: null,
  latestTrainLoss: null,
  latestValLoss: null,
  latestGradNorm: null,
  latestLr: null,
  recentStepDurationsSec: [],
  verifiedCheckpoints: [],
  eventsTail: [],
  error: null,
};

const PIPELINE_METRICS_FILE = 'pipeline_metrics_latest.json';

function persistExecutionStatusSnapshot(): void {
  try {
    const dir = resolveWorkspacePath(PIPELINE_DIR_REL);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, PIPELINE_EXEC_STATUS_FILE),
      JSON.stringify(executionStatus, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(dir, PIPELINE_METRICS_FILE),
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          pipelineId: executionStatus.pipelineId,
          running: executionStatus.running,
          trainingCompletedVerified: executionStatus.trainingCompletedVerified,
          currentStep: executionStatus.currentStep,
          targetSteps: executionStatus.targetSteps,
          warmStartSteps: 2800,
          continuationSteps: 3000,
          targetParams: TARGET_41M_PARAMS,
          evaluationsRecorded: executionStatus.evaluationsRecorded,
          evalEvidencePath: executionStatus.evalEvidencePath,
          latestTrainLoss: executionStatus.latestTrainLoss,
          latestValLoss: executionStatus.latestValLoss,
          latestGradNorm: executionStatus.latestGradNorm,
          latestLr: executionStatus.latestLr,
          verifiedCheckpoints: executionStatus.verifiedCheckpoints,
          error: executionStatus.error,
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  } catch {
    // Best-effort status persistence
  }
}

function readPersistedExecutionStatusSnapshot(): TrainingLoopExecutionStatus | null {
  try {
    const fileAbs = resolveWorkspacePath(path.join(PIPELINE_DIR_REL, PIPELINE_EXEC_STATUS_FILE));
    if (!fs.existsSync(fileAbs)) return null;
    const parsed = JSON.parse(fs.readFileSync(fileAbs, 'utf8')) as TrainingLoopExecutionStatus;
    if (!parsed || typeof parsed.currentStep !== 'number') return null;
    return {
      ...parsed,
      // If no live child process is attached in this Node process, never claim running: true
      running: false,
      pid: null,
      error: parsed.running && !parsed.error ? 'Training process interrupted by server restart.' : parsed.error ?? null,
    };
  } catch {
    return null;
  }
}

export function getTrainingLoopExecutionStatus(): TrainingLoopExecutionStatus & { latestPerplexity: number | null } {
  const effectiveStatus =
    executionStatus.running || executionStatus.startedAt
      ? executionStatus
      : readPersistedExecutionStatusSnapshot() ?? executionStatus;
  const latestPerplexity =
    typeof effectiveStatus.latestValLoss === 'number' && Number.isFinite(effectiveStatus.latestValLoss)
      ? Number(Math.exp(Math.min(effectiveStatus.latestValLoss, 50)).toFixed(4))
      : null;
  return {
    ...effectiveStatus,
    latestPerplexity,
    recentStepDurationsSec: [...(effectiveStatus.recentStepDurationsSec || [])],
    verifiedCheckpoints: [...(effectiveStatus.verifiedCheckpoints || [])],
    eventsTail: [...(effectiveStatus.eventsTail || [])],
  };
}

export const STALL_THRESHOLD_MS = 5 * 60 * 1000;

export function evaluateTrainingProgressAlerts(params: {
  running: boolean;
  startedAt: string | null;
  lastStepAdvanceAt: string | null;
  valLosses: number[];
  nowMs?: number;
}): {
  stalledMinutes: number | null;
  valLossDelta: number | null;
  alerts: TrainingProgressAlert[];
} {
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const alerts: TrainingProgressAlert[] = [];

  let stalledMinutes: number | null = null;
  if (params.running) {
    const refIso = params.lastStepAdvanceAt || params.startedAt;
    const refMs = refIso ? Date.parse(refIso) : NaN;
    if (Number.isFinite(refMs)) {
      const stalledMs = Math.max(0, nowMs - refMs);
      stalledMinutes = Number((stalledMs / 60_000).toFixed(1));
      if (stalledMs > STALL_THRESHOLD_MS) {
        alerts.push({
          id: 'stalled_progress',
          severity: 'warning',
          title: 'Training progress stalled',
          detail: `No step increase detected for ${stalledMinutes.toFixed(1)} min (threshold: 5.0 min).`,
          detectedAt: nowIso,
        });
      }
    }
  }

  let valLossDelta: number | null = null;
  const finiteLosses = params.valLosses.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (finiteLosses.length >= 3) {
    const n = finiteLosses.length;
    const latest = finiteLosses[n - 1];
    const prev1 = finiteLosses[n - 2];
    const prev2 = finiteLosses[n - 3];
    const minPrior = Math.min(...finiteLosses.slice(0, n - 1));
    valLossDelta = Number((latest - minPrior).toFixed(4));
    const significantIncreaseThreshold = Math.max(0.05, minPrior * 0.05);
    const risingThreeConsecutive = prev2 < prev1 && prev1 < latest;
    if (risingThreeConsecutive && valLossDelta >= significantIncreaseThreshold) {
      alerts.push({
        id: 'val_loss_rising',
        severity: 'warning',
        title: 'Validation loss trending upward',
        detail: `Validation loss increased +${valLossDelta.toFixed(4)} (${prev2.toFixed(4)} → ${prev1.toFixed(4)} → ${latest.toFixed(4)}) over recent evaluations.`,
        detectedAt: nowIso,
      });
    }
  }

  return { stalledMinutes, valLossDelta, alerts };
}

export const TIME_TO_EPOCH_WINDOW_STEPS = 10;

export function calculateTimeToEpoch(params: {
  recentStepDurationsSec: number[];
  currentStep: number;
  targetSteps: number;
  currentEpoch?: number | null;
  totalEpochs?: number | null;
  trainingCompletedVerified?: boolean;
}): TimeToEpochEstimate {
  const maxWindowSteps = TIME_TO_EPOCH_WINDOW_STEPS;
  const sanitizedWindow = (params.recentStepDurationsSec || [])
    .filter((d) => typeof d === 'number' && Number.isFinite(d) && d > 0)
    .slice(-maxWindowSteps)
    .map((d) => Number(d.toFixed(4)));

  const safeTargetSteps = Math.max(1, Math.floor(params.targetSteps || DEFAULT_TARGET_STEPS));
  const safeCurrentStep = Math.max(0, Math.min(safeTargetSteps, Math.floor(params.currentStep || 0)));
  const safeTotalEpochs = Math.max(1, Math.floor(params.totalEpochs ?? 1));
  const safeCurrentEpoch = Math.max(1, Math.min(safeTotalEpochs, Math.floor(params.currentEpoch ?? 1)));
  const stepsPerEpoch = Math.max(1, Math.ceil(safeTargetSteps / safeTotalEpochs));
  const epochEndStep =
    safeTotalEpochs === 1
      ? safeTargetSteps
      : Math.min(safeTargetSteps, safeCurrentEpoch * stepsPerEpoch);
  const remainingStepsInEpoch = Math.max(0, epochEndStep - safeCurrentStep);

  const windowSteps = sanitizedWindow.length;
  const averageStepSeconds =
    windowSteps > 0
      ? Number((sanitizedWindow.reduce((sum, val) => sum + val, 0) / windowSteps).toFixed(4))
      : null;

  if (params.trainingCompletedVerified && safeCurrentStep >= safeTargetSteps) {
    return {
      windowSteps,
      maxWindowSteps,
      averageStepSeconds,
      remainingStepsInEpoch: 0,
      estimatedSecondsToEpoch: 0,
      recentStepDurationsSec: sanitizedWindow,
      basis: 'completed',
    };
  }

  if (averageStepSeconds === null) {
    return {
      windowSteps: 0,
      maxWindowSteps,
      averageStepSeconds: null,
      remainingStepsInEpoch,
      estimatedSecondsToEpoch: null,
      recentStepDurationsSec: [],
      basis: 'awaiting_step_history',
    };
  }

  return {
    windowSteps,
    maxWindowSteps,
    averageStepSeconds,
    remainingStepsInEpoch,
    estimatedSecondsToEpoch: Math.max(0, Math.round(remainingStepsInEpoch * averageStepSeconds)),
    recentStepDurationsSec: sanitizedWindow,
    basis: 'last_10_steps',
  };
}

export interface TrainingPipelineStatusSummary {
  pipelineId: string | null;
  status: 'RUNNING' | 'VERIFIED' | 'FAILED' | 'READY' | 'BLOCKED';
  running: boolean;
  trainingCompletedVerified: boolean;
  currentStep: number;
  targetSteps: number;
  warmStartSteps: number;
  continuationSteps: number;
  currentEpoch: number | null;
  totalEpochs: number | null;
  elapsedSeconds: number | null;
  estimatedSecondsRemaining: number | null;
  secondsPerStep: number | null;
  timeToEpoch: TimeToEpochEstimate;
  lastStepAdvanceAt: string | null;
  stalledMinutes: number | null;
  valLossDelta: number | null;
  recentValLosses: number[];
  alerts: TrainingProgressAlert[];
  evalEvery: number;
  saveEvery: number;
  targetParams: number;
  evaluationsRecorded: number;
  verifiedCheckpointsCount: number;
  plannedCheckpointsCount: number;
  latestTrainLoss: number | null;
  latestValLoss: number | null;
  latestPerplexity: number | null;
  latestGradNorm: number | null;
  latestLr: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  initializedAt: string | null;
  gatesPassed: number;
  gatesTotal: number;
  blockers: string[];
  error: string | null;
}

export function getTrainingPipelineStatusSummary(): TrainingPipelineStatusSummary {
  const execStatus = getTrainingLoopExecutionStatus();
  const lastInit = loadLastInitializedTrainingPipeline();
  const hasRunRecord = Boolean(execStatus.running || execStatus.startedAt);

  const targetSteps = hasRunRecord
    ? execStatus.targetSteps
    : (lastInit?.config?.targetSteps ?? DEFAULT_TARGET_STEPS);
  const currentStep = hasRunRecord
    ? execStatus.currentStep
    : (lastInit?.schedule?.startStep ?? 0);
  const evalEvery = lastInit?.config?.evalEvery ?? 25;
  const saveEvery = lastInit?.config?.saveEvery ?? 100;
  const plannedCheckpointsCount =
    lastInit?.schedule?.checkpointCount ?? Math.max(1, Math.ceil(targetSteps / Math.max(1, saveEvery)));

  let status: TrainingPipelineStatusSummary['status'] = 'BLOCKED';
  if (execStatus.running) {
    status = 'RUNNING';
  } else if (execStatus.trainingCompletedVerified && execStatus.exitCode === 0) {
    status = 'VERIFIED';
  } else if (execStatus.error || (typeof execStatus.exitCode === 'number' && execStatus.exitCode !== 0)) {
    status = 'FAILED';
  } else if (lastInit?.canExecuteTraining) {
    status = 'READY';
  } else {
    status = 'BLOCKED';
  }

  const events = Array.isArray(execStatus.eventsTail) ? execStatus.eventsTail : [];
  let startEventStep: number | null = null;
  let latestProgressEvent: Record<string, any> | null = null;
  const valLossSeries: number[] = [];
  const progressEvents: Array<Record<string, any>> = [];
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (ev?.event === 'TARGET_TRAINING_PROGRESS') {
      latestProgressEvent = ev;
      progressEvents.push(ev);
      if (typeof ev.val_loss === 'number' && Number.isFinite(ev.val_loss)) {
        valLossSeries.push(ev.val_loss);
      }
    }
    if (startEventStep === null && ev?.event === 'TARGET_TRAINING_STARTED' && typeof ev?.start_step === 'number') {
      startEventStep = ev.start_step;
    }
  }
  const recentValLosses = valLossSeries.slice(-12);

  // Extract historical per-step durations for the last up to 10 completed steps
  let recentStepDurationsSec: number[] = Array.isArray(execStatus.recentStepDurationsSec)
    ? execStatus.recentStepDurationsSec.filter((d) => typeof d === 'number' && Number.isFinite(d) && d > 0).slice(-TIME_TO_EPOCH_WINDOW_STEPS)
    : [];
  if (
    recentStepDurationsSec.length === 0 &&
    latestProgressEvent &&
    Array.isArray(latestProgressEvent.last_10_step_durations_s)
  ) {
    recentStepDurationsSec = (latestProgressEvent.last_10_step_durations_s as unknown[])
      .filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0)
      .slice(-TIME_TO_EPOCH_WINDOW_STEPS);
  }
  if (recentStepDurationsSec.length === 0 && progressEvents.length > 0) {
    const derived: number[] = [];
    const baseStartStep = startEventStep ?? lastInit?.schedule?.startStep ?? 0;
    let prevStep = baseStartStep;
    let prevElapsed = 0;
    for (const ev of progressEvents) {
      const evStep = typeof ev.global_step === 'number' ? ev.global_step : prevStep;
      const evElapsed = typeof ev.elapsed_s === 'number' ? ev.elapsed_s : prevElapsed;
      const deltaSteps = evStep - prevStep;
      const deltaSec = evElapsed - prevElapsed;
      if (deltaSteps > 0 && deltaSec > 0) {
        const avgPerStep = Number((deltaSec / deltaSteps).toFixed(4));
        const fillCount = Math.min(deltaSteps, TIME_TO_EPOCH_WINDOW_STEPS);
        for (let k = 0; k < fillCount; k += 1) {
          derived.push(avgPerStep);
        }
      }
      prevStep = evStep;
      prevElapsed = evElapsed;
    }
    recentStepDurationsSec = derived.slice(-TIME_TO_EPOCH_WINDOW_STEPS);
  }

  const explicitEpoch = typeof latestProgressEvent?.epoch === 'number' ? latestProgressEvent.epoch : null;
  const explicitTotalEpochs = typeof latestProgressEvent?.total_epochs === 'number' ? latestProgressEvent.total_epochs : null;
  const totalEpochs = explicitTotalEpochs ?? 1;
  const currentEpoch = explicitEpoch ?? (execStatus.running || currentStep > 0 ? 1 : 0);

  let elapsedSeconds: number | null = null;
  const startMs = execStatus.startedAt ? Date.parse(execStatus.startedAt) : NaN;
  const finishMs = execStatus.finishedAt ? Date.parse(execStatus.finishedAt) : NaN;
  if (execStatus.running && Number.isFinite(startMs)) {
    elapsedSeconds = Math.max(0, Math.round((Date.now() - startMs) / 1000));
  } else if (Number.isFinite(startMs) && Number.isFinite(finishMs)) {
    elapsedSeconds = Math.max(0, Math.round((finishMs - startMs) / 1000));
  } else if (typeof latestProgressEvent?.elapsed_s === 'number' && Number.isFinite(latestProgressEvent.elapsed_s)) {
    elapsedSeconds = Math.max(0, Math.round(latestProgressEvent.elapsed_s));
  }

  const runStartStep = startEventStep ?? lastInit?.schedule?.startStep ?? 0;
  const stepsCompletedInRun =
    typeof latestProgressEvent?.local_step === 'number' && Number.isFinite(latestProgressEvent.local_step)
      ? Math.max(0, latestProgressEvent.local_step)
      : Math.max(0, currentStep - runStartStep);
  const measuredPaceElapsed =
    typeof latestProgressEvent?.elapsed_s === 'number' && Number.isFinite(latestProgressEvent.elapsed_s) && latestProgressEvent.elapsed_s > 0
      ? latestProgressEvent.elapsed_s
      : elapsedSeconds !== null && elapsedSeconds > 0
        ? elapsedSeconds
        : null;

  const timeToEpoch = calculateTimeToEpoch({
    recentStepDurationsSec,
    currentStep,
    targetSteps,
    currentEpoch,
    totalEpochs,
    trainingCompletedVerified: execStatus.trainingCompletedVerified,
  });

  let secondsPerStep: number | null = null;
  let estimatedSecondsRemaining: number | null = null;
  if (execStatus.trainingCompletedVerified && currentStep >= targetSteps) {
    estimatedSecondsRemaining = 0;
    if (timeToEpoch.averageStepSeconds !== null) {
      secondsPerStep = Number(timeToEpoch.averageStepSeconds.toFixed(3));
    } else if (stepsCompletedInRun > 0 && measuredPaceElapsed !== null) {
      secondsPerStep = Number((measuredPaceElapsed / stepsCompletedInRun).toFixed(3));
    }
  } else if (timeToEpoch.averageStepSeconds !== null && (execStatus.running || stepsCompletedInRun > 0)) {
    secondsPerStep = Number(timeToEpoch.averageStepSeconds.toFixed(3));
    estimatedSecondsRemaining = timeToEpoch.estimatedSecondsToEpoch;
  } else if (execStatus.running && stepsCompletedInRun > 0 && measuredPaceElapsed !== null && measuredPaceElapsed > 0) {
    const rate = measuredPaceElapsed / stepsCompletedInRun;
    secondsPerStep = Number(rate.toFixed(3));
    const remainingSteps = Math.max(0, targetSteps - currentStep);
    estimatedSecondsRemaining = Math.max(0, Math.round(remainingSteps * rate));
  }

  const alertEval = evaluateTrainingProgressAlerts({
    running: execStatus.running,
    startedAt: execStatus.startedAt,
    lastStepAdvanceAt: execStatus.lastStepAdvanceAt ?? execStatus.startedAt,
    valLosses: recentValLosses,
  });

  return {
    pipelineId: execStatus.pipelineId ?? lastInit?.pipelineId ?? null,
    status,
    running: execStatus.running,
    trainingCompletedVerified: execStatus.trainingCompletedVerified,
    currentStep: Math.max(0, currentStep),
    targetSteps: Math.max(1, targetSteps),
    warmStartSteps: 2800,
    continuationSteps: 3000,
    currentEpoch,
    totalEpochs,
    elapsedSeconds,
    estimatedSecondsRemaining,
    secondsPerStep,
    timeToEpoch,
    lastStepAdvanceAt: execStatus.lastStepAdvanceAt ?? execStatus.startedAt,
    stalledMinutes: alertEval.stalledMinutes,
    valLossDelta: alertEval.valLossDelta,
    recentValLosses,
    alerts: alertEval.alerts,
    evalEvery,
    saveEvery,
    targetParams: TARGET_41M_PARAMS,
    evaluationsRecorded: execStatus.evaluationsRecorded ?? 0,
    verifiedCheckpointsCount: execStatus.verifiedCheckpoints.filter((c) => c.verified !== false).length,
    plannedCheckpointsCount,
    latestTrainLoss: execStatus.latestTrainLoss,
    latestValLoss: execStatus.latestValLoss,
    latestPerplexity: execStatus.latestPerplexity,
    latestGradNorm: execStatus.latestGradNorm,
    latestLr: execStatus.latestLr,
    startedAt: execStatus.startedAt,
    finishedAt: execStatus.finishedAt,
    exitCode: execStatus.exitCode,
    initializedAt: lastInit?.initializedAt ?? null,
    gatesPassed: lastInit ? lastInit.gates.filter((g) => g.passed).length : 0,
    gatesTotal: lastInit ? lastInit.gates.length : 6,
    blockers: lastInit ? [...lastInit.blockers] : ['training_pipeline_not_initialized'],
    error: execStatus.error,
  };
}

export async function startInitializedTrainingLoop(
  input: InitializeTrainingPipelineInput = {}
): Promise<{
  started: boolean;
  snapshot: TrainingPipelineInitSnapshot;
  execution: TrainingLoopExecutionStatus;
  error: string | null;
}> {
  if (executionStatus.running && activeTrainingChild) {
    const currentSnap = loadLastInitializedTrainingPipeline() || (await initializeTrainingPipeline(input));
    return {
      started: false,
      snapshot: currentSnap,
      execution: getTrainingLoopExecutionStatus(),
      error: 'A 5,800-step training loop is already running.',
    };
  }

  const snapshot = await initializeTrainingPipeline(input);
  if (!snapshot.canExecuteTraining) {
    const blockErr = `FAIL_CLOSED: Training execution blocked until all gates pass: ${snapshot.blockers.join(', ')}`;
    AuditLedger.emitWorkflowEvent({
      source: 'training_pipeline',
      tag: 'ERROR',
      isRunning: false,
      message: blockErr,
    });
    return {
      started: false,
      snapshot,
      execution: getTrainingLoopExecutionStatus(),
      error: blockErr,
    };
  }

  // Consume bound ApprovalGate record (if linked) immediately before launching training process
  if (snapshot.config.approvalRequestId) {
    const scopeTenant = input.tenantId || undefined;
    const gateRec = ApprovalGate.getInstance().getRequest(
      snapshot.config.approvalRequestId,
      scopeTenant ? { tenantId: scopeTenant } : undefined
    );
    if (!gateRec) {
      const err = `FAIL_CLOSED: ApprovalGate record '${snapshot.config.approvalRequestId}' missing at execution launch.`;
      return { started: false, snapshot, execution: getTrainingLoopExecutionStatus(), error: err };
    }
    const consumed = ApprovalGate.getInstance().verifyAndConsume({
      actionType: gateRec.actionType,
      resourceId: gateRec.resourceId,
      tenantId: gateRec.tenantId,
      approvalRequestId: gateRec.requestId,
      consume: true,
    });
    if (!consumed.approved) {
      const err = `FAIL_CLOSED: ${consumed.reason || 'ApprovalGate consumption rejected.'}`;
      return { started: false, snapshot, execution: getTrainingLoopExecutionStatus(), error: err };
    }
  }

  const pyBin = snapshot.numpyEnvironment.pythonExecutable || resolvePythonBinary(input.pythonBin).bin;
  const args = [
    '-B',
    '-m',
    'qplus_native.train_target',
    '--init',
    resolveWorkspacePath(snapshot.config.initCheckpoint),
    '--out',
    resolveWorkspacePath(snapshot.config.outCheckpoint),
    '--target-steps',
    String(snapshot.config.targetSteps),
    '--eval-every',
    String(snapshot.config.evalEvery),
    '--save-every',
    String(snapshot.config.saveEvery),
    '--batch',
    String(snapshot.config.batch),
    '--lr',
    String(snapshot.config.lr),
    '--weight-decay',
    String(snapshot.config.weightDecay),
    '--tokenizer-profile',
    snapshot.config.tokenizerProfile,
    '--dataset-provenance',
    resolveWorkspacePath(snapshot.config.provenanceManifest),
    '--evidence-root',
    resolveWorkspacePath(snapshot.config.evidenceRoot),
    '--probe-s3',
    '--human-approval-confirmed',
  ];
  if (snapshot.config.steps !== null) args.push('--steps', String(snapshot.config.steps));
  if (snapshot.config.datasetFile) args.push('--dataset-file', resolveWorkspacePath(snapshot.config.datasetFile));
  if (snapshot.config.approvalKeyFile) args.push('--approval-key-file', resolveWorkspacePath(snapshot.config.approvalKeyFile));
  if (snapshot.config.allowFreshInit) args.push('--allow-fresh-init');

  executionStatus.running = true;
  executionStatus.trainingCompletedVerified = false;
  executionStatus.pipelineId = snapshot.pipelineId;
  executionStatus.startedAt = new Date().toISOString();
  executionStatus.finishedAt = null;
  executionStatus.lastStepAdvanceAt = executionStatus.startedAt;
  executionStatus.exitCode = null;
  executionStatus.currentStep = snapshot.schedule.startStep;
  executionStatus.targetSteps = snapshot.config.targetSteps;
  executionStatus.evaluationsRecorded = 0;
  executionStatus.evalEvidencePath = null;
  executionStatus.latestTrainLoss = null;
  executionStatus.latestValLoss = null;
  executionStatus.latestGradNorm = null;
  executionStatus.latestLr = null;
  executionStatus.recentStepDurationsSec = [];
  executionStatus.verifiedCheckpoints = [];
  executionStatus.eventsTail = [];
  executionStatus.error = null;
  persistExecutionStatusSnapshot();

  const child = spawn(pyBin, args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: process.cwd() },
  });
  activeTrainingChild = child;
  executionStatus.pid = child.pid ?? null;

  AuditLedger.append('SYSTEM', 'TRAINING_LOOP_5800_STARTED', {
    pipelineId: snapshot.pipelineId,
    pid: child.pid ?? null,
    targetSteps: snapshot.config.targetSteps,
  });
  AuditLedger.emitWorkflowEvent({
    source: 'training_pipeline',
    tag: 'CODER',
    goal: `5,800-Step Native Training (${snapshot.pipelineId})`,
    isRunning: true,
    message: `Training Execution started (PID ${child.pid ?? 'unknown'}): target ${snapshot.config.targetSteps} steps, eval every ${snapshot.config.evalEvery}, save+verify every ${snapshot.config.saveEvery}`,
  });

  let finalContainerSha256: string | null = null;
  let finalValLoss: number | null = null;
  let prevProgressElapsedS = 0;
  let prevProgressStep = snapshot.schedule.startStep;
  let cloudSyncChain: Promise<void> = Promise.resolve();
  let cloudSyncError: string | null = null;

  const scheduleCloudCheckpointSync = (entry: {
    globalStep: number;
    kind?: string;
    path: string;
    payloadSha256: string;
  }) => {
    const cloudCfg = CloudObjectStorageService.getConfigurationStatus();
    if (!cloudCfg.s3Configured || !entry.path) return;
    cloudSyncChain = cloudSyncChain
      .then(async () => {
        const absCkpt = resolveWorkspacePath(entry.path);
        if (!fs.existsSync(absCkpt)) return;
        const buf = fs.readFileSync(absCkpt);
        const objectKey =
          entry.kind === 'final_verification' && snapshot.config.cloudObjectKey
            ? snapshot.config.cloudObjectKey
            : `checkpoints/${path.basename(absCkpt)}`;
        const uploaded = await CloudObjectStorageService.writeCheckpointArtifact(buf, {
          objectKey,
          modelKey: `target_41m_step${entry.globalStep}`,
        });
        AuditLedger.append('SYSTEM', 'TRAINING_CHECKPOINT_CLOUD_SYNCED', {
          pipelineId: snapshot.pipelineId,
          globalStep: entry.globalStep,
          kind: entry.kind,
          sourceUri: uploaded.sourceUri,
          payloadSha256: uploaded.payloadSha256,
          byteSize: uploaded.byteSize,
        });
      })
      .catch((syncErr: any) => {
        const msg = syncErr?.message || String(syncErr);
        cloudSyncError = `Cloud checkpoint upload failed at step ${entry.globalStep}: ${msg}`;
        AuditLedger.emitWorkflowEvent({
          source: 'training_pipeline',
          tag: 'ERROR',
          isRunning: false,
          message: `FAIL_CLOSED: ${cloudSyncError}`,
        });
      });
  };

  const scheduleCloudMetricsSync = (label: string) => {
    const cloudCfg = CloudObjectStorageService.getConfigurationStatus();
    if (!cloudCfg.s3Configured) return;
    cloudSyncChain = cloudSyncChain
      .then(async () => {
        const metricsPath = resolveWorkspacePath(path.join(PIPELINE_DIR_REL, PIPELINE_METRICS_FILE));
        if (fs.existsSync(metricsPath)) {
          await CloudObjectStorageService.uploadTrainingTelemetryObject(
            `metrics/${snapshot.pipelineId}/${PIPELINE_METRICS_FILE}`,
            fs.readFileSync(metricsPath, 'utf8'),
            'application/json'
          );
        }
        if (executionStatus.evalEvidencePath) {
          const evalAbs = resolveWorkspacePath(executionStatus.evalEvidencePath);
          if (fs.existsSync(evalAbs)) {
            await CloudObjectStorageService.uploadTrainingTelemetryObject(
              `metrics/${snapshot.pipelineId}/${path.basename(evalAbs)}`,
              fs.readFileSync(evalAbs, 'utf8'),
              'application/x-ndjson'
            );
          }
        }
        AuditLedger.append('SYSTEM', 'TRAINING_METRICS_CLOUD_SYNCED', {
          pipelineId: snapshot.pipelineId,
          trigger: label,
          currentStep: executionStatus.currentStep,
          evaluationsRecorded: executionStatus.evaluationsRecorded,
        });
      })
      .catch((syncErr: any) => {
        const msg = syncErr?.message || String(syncErr);
        AuditLedger.append('SYSTEM', 'TRAINING_METRICS_CLOUD_SYNC_WARN', {
          pipelineId: snapshot.pipelineId,
          trigger: label,
          error: msg,
        });
      });
  };

  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed);
        executionStatus.eventsTail.push(ev);
        if (executionStatus.eventsTail.length > 50) executionStatus.eventsTail.shift();

        if (ev.event === 'TARGET_TRAINING_STARTED') {
          if (typeof ev.eval_evidence_path === 'string') {
            executionStatus.evalEvidencePath = ev.eval_evidence_path;
          }
          if (typeof ev.start_step === 'number' && Number.isFinite(ev.start_step)) {
            prevProgressStep = ev.start_step;
          }
          persistExecutionStatusSnapshot();
        } else if (ev.event === 'TARGET_TRAINING_PROGRESS') {
          const nextStep = Number(ev.global_step ?? executionStatus.currentStep);
          if (nextStep > executionStatus.currentStep) {
            executionStatus.lastStepAdvanceAt = new Date().toISOString();
          }
          if (Array.isArray(ev.last_10_step_durations_s)) {
            const cleaned = (ev.last_10_step_durations_s as unknown[])
              .filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0)
              .slice(-TIME_TO_EPOCH_WINDOW_STEPS);
            if (cleaned.length > 0) {
              executionStatus.recentStepDurationsSec = cleaned;
            }
          } else if (typeof ev.elapsed_s === 'number' && Number.isFinite(ev.elapsed_s) && nextStep > prevProgressStep) {
            const deltaSteps = nextStep - prevProgressStep;
            const deltaSec = Math.max(0, ev.elapsed_s - prevProgressElapsedS);
            if (deltaSec > 0) {
              const avgStepSec = Number((deltaSec / deltaSteps).toFixed(4));
              const existing = executionStatus.recentStepDurationsSec || [];
              const fillCount = Math.min(deltaSteps, TIME_TO_EPOCH_WINDOW_STEPS);
              executionStatus.recentStepDurationsSec = [
                ...existing,
                ...Array.from({ length: fillCount }, () => avgStepSec),
              ].slice(-TIME_TO_EPOCH_WINDOW_STEPS);
            }
          }
          if (typeof ev.elapsed_s === 'number' && Number.isFinite(ev.elapsed_s)) {
            prevProgressElapsedS = ev.elapsed_s;
          }
          prevProgressStep = nextStep;
          executionStatus.currentStep = nextStep;
          executionStatus.evaluationsRecorded += 1;
          if (typeof ev.eval_evidence_path === 'string') {
            executionStatus.evalEvidencePath = ev.eval_evidence_path;
          }
          executionStatus.latestTrainLoss = typeof ev.train_loss === 'number' ? ev.train_loss : executionStatus.latestTrainLoss;
          executionStatus.latestValLoss = typeof ev.val_loss === 'number' ? ev.val_loss : executionStatus.latestValLoss;
          executionStatus.latestGradNorm = typeof ev.grad_norm === 'number' ? ev.grad_norm : executionStatus.latestGradNorm;
          executionStatus.latestLr = typeof ev.lr === 'number' ? ev.lr : executionStatus.latestLr;
          persistExecutionStatusSnapshot();
          AuditLedger.emitWorkflowEvent({
            source: 'training_pipeline',
            tag: 'TESTER',
            isRunning: true,
            message: `Evaluation step ${executionStatus.currentStep}/${executionStatus.targetSteps}: train_loss=${executionStatus.latestTrainLoss?.toFixed(4) ?? '—'}, val_loss=${executionStatus.latestValLoss?.toFixed(4) ?? '—'}, grad_norm=${executionStatus.latestGradNorm?.toFixed(4) ?? '—'} (eval #${executionStatus.evaluationsRecorded} persisted)`,
          });
        } else if (ev.event === 'TARGET_CHECKPOINT_PERSISTED') {
          const entry = {
            globalStep: Number(ev.global_step ?? 0),
            kind: typeof ev.kind === 'string' ? ev.kind : 'periodic_verification',
            path: String(ev.path || ''),
            totalParams: typeof ev.total_params === 'number' ? ev.total_params : undefined,
            byteSize: typeof ev.byte_size === 'number' ? ev.byte_size : undefined,
            payloadSha256: String(ev.payload_sha256 || ''),
            containerSha256: String(ev.container_sha256 || ''),
            verified: ev.verified === true,
          };
          if (!executionStatus.verifiedCheckpoints.some((c) => c.globalStep === entry.globalStep && c.path === entry.path)) {
            executionStatus.verifiedCheckpoints.push(entry);
          }
          persistExecutionStatusSnapshot();
          scheduleCloudCheckpointSync(entry);
          scheduleCloudMetricsSync(`checkpoint_step_${entry.globalStep}`);
          AuditLedger.emitWorkflowEvent({
            source: 'training_pipeline',
            tag: 'TESTER',
            isRunning: true,
            message: `Checkpoint Persistence step ${entry.globalStep} verified=${String(entry.verified)} · payload SHA-256 ${entry.payloadSha256.slice(0, 16)}…`,
          });
        } else if (ev.event === 'TARGET_TRAINING_COMPLETE') {
          executionStatus.currentStep = Number(ev.final_step ?? executionStatus.currentStep);
          finalContainerSha256 = typeof ev.checkpoint_container_sha256 === 'string' ? ev.checkpoint_container_sha256 : null;
          finalValLoss = typeof ev.best_val_loss === 'number' ? ev.best_val_loss : executionStatus.latestValLoss;
          const hasFinalSeal = Boolean(
            finalContainerSha256 &&
              typeof ev.checkpoint_payload_sha256 === 'string' &&
              ev.checkpoint_payload_sha256.length === 64
          );
          if (Array.isArray(ev.intermediate_checkpoints)) {
            for (const c of ev.intermediate_checkpoints) {
              const gStep = Number(c.global_step ?? 0);
              const p = String(c.path || '');
              if (!executionStatus.verifiedCheckpoints.some((x) => x.globalStep === gStep && x.path === p)) {
                executionStatus.verifiedCheckpoints.push({
                  globalStep: gStep,
                  kind: typeof c.kind === 'string' ? c.kind : 'periodic_verification',
                  path: p,
                  totalParams: typeof c.total_params === 'number' ? c.total_params : undefined,
                  byteSize: typeof c.byte_size === 'number' ? c.byte_size : undefined,
                  payloadSha256: String(c.payload_sha256 || ''),
                  containerSha256: String(c.container_sha256 || ''),
                  verified: c.verified !== false,
                });
              }
            }
          }
          if (ev.checkpoint && ev.checkpoint_payload_sha256) {
            const fStep = Number(ev.final_step ?? snapshot.config.targetSteps);
            const fPath = String(ev.checkpoint);
            if (!executionStatus.verifiedCheckpoints.some((x) => x.globalStep === fStep && x.path === fPath)) {
              executionStatus.verifiedCheckpoints.push({
                globalStep: fStep,
                kind: 'final_verification',
                path: fPath,
                totalParams: typeof ev.params === 'number' ? ev.params : undefined,
                payloadSha256: String(ev.checkpoint_payload_sha256),
                containerSha256: String(ev.checkpoint_container_sha256 || ''),
                verified: true,
              });
            }
          }
          executionStatus.trainingCompletedVerified = hasFinalSeal;
          persistExecutionStatusSnapshot();
          scheduleCloudMetricsSync('training_complete');
        }
      } catch {
        // Ignore non-JSON lines
      }
    }
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });

  child.on('exit', async (code) => {
    await cloudSyncChain;
    activeTrainingChild = null;
    executionStatus.running = false;
    executionStatus.pid = null;
    executionStatus.exitCode = code;
    executionStatus.finishedAt = new Date().toISOString();
    if (cloudSyncError) {
      executionStatus.trainingCompletedVerified = false;
      executionStatus.error = cloudSyncError;
    } else if (code !== 0) {
      executionStatus.trainingCompletedVerified = false;
      executionStatus.error = stderrBuf.trim() || `Training exited with code ${code}`;
      AuditLedger.emitWorkflowEvent({
        source: 'training_pipeline',
        tag: 'ERROR',
        isRunning: false,
        message: `FAIL_CLOSED: Training Execution failed (exit=${code}) — ${executionStatus.error}`,
      });
    } else if (executionStatus.trainingCompletedVerified && finalContainerSha256) {
      AuditLedger.emitWorkflowEvent({
        source: 'training_pipeline',
        tag: 'DONE',
        isRunning: false,
        isDone: true,
        verificationHash: finalContainerSha256,
        message: `Delivered verified trained checkpoint (step=${executionStatus.currentStep}, evidenceHash=${finalContainerSha256})`,
      });
      AuditLedger.emitWorkflowEvent({
        source: 'training_pipeline',
        tag: 'LEARNING',
        isRunning: false,
        isDone: true,
        verificationHash: finalContainerSha256,
        message: `Learning & Adaptation recorded ${executionStatus.verifiedCheckpoints.length} verified checkpoints and ${executionStatus.evaluationsRecorded} persisted evaluations (best_val_loss=${finalValLoss?.toFixed(4) ?? '—'})`,
      });
    } else {
      executionStatus.trainingCompletedVerified = false;
      executionStatus.error = 'Training exited 0 without verified TARGET_TRAINING_COMPLETE evidence.';
      AuditLedger.emitWorkflowEvent({
        source: 'training_pipeline',
        tag: 'ERROR',
        isRunning: false,
        message: `FAIL_CLOSED: ${executionStatus.error}`,
      });
    }
    persistExecutionStatusSnapshot();
    AuditLedger.append('SYSTEM', 'TRAINING_LOOP_5800_FINISHED', {
      pipelineId: snapshot.pipelineId,
      exitCode: code,
      finalStep: executionStatus.currentStep,
      trainingCompletedVerified: executionStatus.trainingCompletedVerified,
      evaluationsRecorded: executionStatus.evaluationsRecorded,
      checkpointsVerified: executionStatus.verifiedCheckpoints.length,
      error: executionStatus.error,
    });
  });

  return {
    started: true,
    snapshot,
    execution: getTrainingLoopExecutionStatus(),
    error: null,
  };
}
