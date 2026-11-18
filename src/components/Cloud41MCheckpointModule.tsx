import React, { useCallback, useEffect, useState } from 'react';
import { VividCard } from './ui/VividCard';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { cloudPreflightService } from '../services/CloudPreflightService';
import {
  CheckCircle2,
  Cloud,
  Database,
  FileCheck2,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

const EXPECTED_41M_PARAMS = 41_527_808;

interface CloudStorageStatus {
  configValid: boolean;
  s3Configured: boolean;
  provider: string;
  bucket: string | null;
  region: string;
  endpoint: string | null;
  checkpointKey: string;
  forcePathStyle: boolean;
  missingKeys: string[];
  validationError: string | null;
}

interface StorageConnectionTestResult {
  success: boolean;
  preflightReady?: boolean;
  validConfig: boolean;
  bucketReachable: boolean;
  readVerified: boolean;
  writeVerified: boolean;
  cleanupVerified: boolean;
  roundtripSha256Match: boolean;
  objectExists: boolean | null;
  objectSizeBytes: number | null;
  bucket: string | null;
  region: string;
  endpoint: string | null;
  checkpointKey: string;
  httpStatusCode: number | null;
  latencyMs: number;
  probeKey: string | null;
  probeSha256: string | null;
  artifacts: Array<{
    key: string;
    sizeBytes: number;
    lastModified: string | null;
  }>;
  errorCode: string | null;
  errorMessage: string | null;
  checkedAt: string;
}

interface CloudPreflightReport {
  passed: boolean;
  status: 'PREFLIGHT_PASS' | 'PREFLIGHT_BLOCKED';
  checks: {
    credentialsValid: boolean;
    bucketAvailable: boolean;
    checkpointExists: boolean;
    checkpointAccessible: boolean;
    readWriteVerified: boolean;
  };
  bucket: string | null;
  region: string;
  endpoint: string | null;
  checkpointKey: string;
  checkpointSizeBytes: number | null;
  checkpointETag: string | null;
  checkpointLastModified: string | null;
  headerMagicValid: boolean | null;
  httpStatusCode: number | null;
  missingCredentials: string[];
  blockers: string[];
  error: string | null;
  latencyMs: number;
  checkedAt: string;
}

interface FetchVerify41MOutcome {
  success: boolean;
  stage: 'FETCH' | 'VERIFY' | 'RUNTIME_LOAD' | 'COMPLETE';
  fetchLatencyMs: number | null;
  verifyLatencyMs: number | null;
  loadLatencyMs: number | null;
  verification: {
    verified: boolean;
    gateStatus: string;
    sourceUri: string;
    byteSize: number;
    containerSha256: string;
    payloadSha256: string;
    sha256Verified: boolean;
    matchedBaselineLabel: string | null;
    expectedParams: number;
    actualParams: number;
    paramCountVerified: boolean;
    finiteWeightsVerified: boolean;
    architecture: string | null;
    trainingSteps: number | null;
    reason: string;
  } | null;
  runtimeLoaded: boolean;
  runtimeActivation?: {
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
  } | null;
  runtimeStatus: Record<string, any> | null;
  error: string | null;
}

interface Cloud41MCheckpointModuleProps {
  onAfterRuntimeLoad?: () => Promise<void> | void;
}

export const Cloud41MCheckpointModule: React.FC<Cloud41MCheckpointModuleProps> = ({
  onAfterRuntimeLoad,
}) => {
  const { lang } = useLanguage();
  const { authHeaders, isAuthenticated, role } = useAuth();
  const isDevOrAdmin = role === 'Developer' || role === 'Administrator';

  const [storageStatus, setStorageStatus] = useState<CloudStorageStatus | null>(null);
  const [testResult, setTestResult] = useState<StorageConnectionTestResult | null>(null);
  const [testingStorage, setTestingStorage] = useState(false);
  const [preflightReport, setPreflightReport] = useState<CloudPreflightReport | null>(null);
  const [runningPreflight, setRunningPreflight] = useState(false);

  const [objectKeyInput, setObjectKeyInput] = useState('');
  const [presignedUrlInput, setPresignedUrlInput] = useState('');
  const [expectedShaInput, setExpectedShaInput] = useState('');
  const [busyMode, setBusyMode] = useState<'verify' | 'load' | null>(null);
  const [outcome, setOutcome] = useState<FetchVerify41MOutcome | null>(null);
  const [storageError, setStorageError] = useState('');

  const loadStorageConfig = useCallback(async () => {
    if (!isAuthenticated || !isDevOrAdmin) return;
    setStorageError('');
    try {
      const res = await fetch('/api/storage/config', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Storage config HTTP ${res.status}`);
      }
      setStorageStatus(data as CloudStorageStatus);
      if (!objectKeyInput && data.checkpointKey) {
        setObjectKeyInput(String(data.checkpointKey));
      }
    } catch (err: any) {
      setStorageError(err?.message || 'Unable to read Cloud Object Storage status.');
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin, objectKeyInput]);

  useEffect(() => {
    void loadStorageConfig();
  }, [loadStorageConfig]);

  const handleTestBucketRW = async () => {
    if (!isAuthenticated || !isDevOrAdmin || testingStorage) return;
    setTestingStorage(true);
    setStorageError('');
    try {
      const res = await fetch('/api/storage/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          verifyReadWrite: true,
          objectKey: objectKeyInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Bucket test HTTP ${res.status}`);
      }
      setTestResult(data.result as StorageConnectionTestResult);
    } catch (err: any) {
      setStorageError(err?.message || 'Cloud Object Storage read/write probe failed.');
    } finally {
      setTestingStorage(false);
    }
  };

  const handleRunCloudPreflight = async () => {
    if (!isAuthenticated || !isDevOrAdmin || runningPreflight) return;
    setRunningPreflight(true);
    setStorageError('');
    try {
      const report = await cloudPreflightService.runPreflightCheck({
        verifyReadWrite: true,
        objectKey: objectKeyInput.trim() || undefined,
        headers: authHeaders(),
      });
      setPreflightReport(report);
    } catch (err: any) {
      setStorageError(err?.message || 'Cloud Preflight check failed.');
    } finally {
      setRunningPreflight(false);
    }
  };

  const handleFetchAndVerify = async (verifyOnly: boolean) => {
    if (!isAuthenticated || !isDevOrAdmin || busyMode) return;
    setBusyMode(verifyOnly ? 'verify' : 'load');
    setOutcome(null);
    setStorageError('');
    try {
      const payload: Record<string, any> = { verifyOnly };
      if (objectKeyInput.trim()) payload.objectKey = objectKeyInput.trim();
      if (presignedUrlInput.trim()) payload.presignedUrl = presignedUrlInput.trim();
      if (expectedShaInput.trim()) payload.expectedSha256 = expectedShaInput.trim();

      const res = await fetch('/api/model/fetch-verify-41m', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as FetchVerify41MOutcome;
      setOutcome(data);
      if (data.runtimeLoaded && onAfterRuntimeLoad) {
        await onAfterRuntimeLoad();
      }
    } catch (err: any) {
      setOutcome({
        success: false,
        stage: 'FETCH',
        fetchLatencyMs: null,
        verifyLatencyMs: null,
        loadLatencyMs: null,
        verification: null,
        runtimeLoaded: false,
        runtimeStatus: null,
        error: err?.message || 'Network error contacting /api/model/fetch-verify-41m.',
      });
    } finally {
      setBusyMode(null);
    }
  };

  const v = outcome?.verification || null;
  const fetchGateState = !outcome
    ? 'IDLE'
    : outcome.stage === 'FETCH' && !outcome.success
    ? 'FAILED'
    : 'PASS';
  const shaGateState = !outcome
    ? 'IDLE'
    : !v
    ? outcome.stage === 'FETCH'
      ? 'BLOCKED'
      : 'IDLE'
    : v.sha256Verified
    ? 'PASS'
    : 'FAILED';
  const paramGateState = !outcome
    ? 'IDLE'
    : !v
    ? 'BLOCKED'
    : v.paramCountVerified
    ? 'PASS'
    : 'FAILED';
  const loadGateState = !outcome
    ? 'IDLE'
    : outcome.runtimeLoaded && outcome.runtimeActivation?.activated
    ? 'PASS'
    : outcome.stage === 'RUNTIME_LOAD' || (!v?.verified && outcome.stage === 'VERIFY')
    ? 'FAILED'
    : 'PENDING';

  const renderGateIcon = (state: string) => {
    if (state === 'PASS') return <CheckCircle2 className="w-4 h-4 text-[var(--z-ok)] shrink-0" />;
    if (state === 'FAILED') return <XCircle className="w-4 h-4 text-[var(--z-danger)] shrink-0" />;
    if (state === 'BLOCKED') return <ShieldAlert className="w-4 h-4 text-[var(--z-warn)] shrink-0" />;
    return <FileCheck2 className="w-4 h-4 text-[var(--app-text-secondary)] shrink-0" />;
  };

  if (!isAuthenticated || !isDevOrAdmin) {
    return null;
  }

  return (
    <VividCard
      title={
        lang === 'th'
          ? 'ตัวโหลดและตรวจยืนยัน Checkpoint 41.5M จาก Cloud Object Storage'
          : '41.5M Cloud Checkpoint Fetch, SHA-256 & Parameter Verifier'
      }
      subtitle={
        lang === 'th'
          ? 'ทดสอบอ่าน/เขียน Bucket จริง ดาวน์โหลด Checkpoint 41,527,808 พารามิเตอร์ คำนวณ SHA-256 และตรวจครบก่อนโหลดเข้า Native Runtime'
          : 'Tests live Cloud Object Storage read/write access, fetches the 41,527,808-parameter checkpoint, computes SHA-256, and verifies parameter count prior to Native Runtime load.'
      }
      gradientAccent="purple"
    >
      <div className="space-y-5 text-xs">
        {/* Cloud Object Storage Service Status & Read/Write Probe */}
        <div className="border-b border-[var(--app-card-border)] pb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
              <span className="font-bold text-[var(--app-text-primary)]">
                Cloud Object Storage Service (Read / Write Artifact Probe)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadStorageConfig()}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh Env
              </button>
              <button
                type="button"
                data-testid="run-cloud-preflight-btn"
                disabled={runningPreflight}
                onClick={() => void handleRunCloudPreflight()}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[var(--app-surface-elevated)] border border-[var(--app-accent)]/60 hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {runningPreflight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-[var(--app-accent)]" />}
                <span>{runningPreflight ? 'Running Preflight…' : 'Run Cloud Preflight'}</span>
              </button>
              <button
                type="button"
                data-testid="test-storage-rw-btn"
                disabled={testingStorage}
                onClick={() => void handleTestBucketRW()}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {testingStorage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5 text-[var(--app-accent)]" />}
                <span>{testingStorage ? 'Testing Bucket R/W…' : 'Test Bucket Read/Write'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums text-[11px]">
            <div>
              <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Bucket</div>
              <div className="mt-0.5 font-semibold text-[var(--app-text-primary)] truncate">
                {storageStatus?.bucket || 'NOT_CONFIGURED'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Endpoint / Region</div>
              <div className="mt-0.5 font-semibold text-[var(--app-text-primary)] truncate">
                {storageStatus?.endpoint || (storageStatus?.bucket ? `AWS (${storageStatus.region})` : '—')}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Credentials</div>
              <div
                className={`mt-0.5 font-semibold ${
                  storageStatus?.s3Configured ? 'text-[var(--z-ok)]' : 'text-[var(--z-warn)]'
                }`}
              >
                {storageStatus?.s3Configured
                  ? 'S3 KEYS SET'
                  : storageStatus?.missingKeys?.length
                  ? `MISSING (${storageStatus.missingKeys.join(', ')})`
                  : 'NOT_CONFIGURED'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Preflight &amp; R/W Probe</div>
              <div
                className={`mt-0.5 font-semibold ${
                  testResult?.preflightReady
                    ? 'text-[var(--z-ok)]'
                    : testResult?.success
                    ? 'text-[var(--z-warn)]'
                    : testResult
                    ? 'text-[var(--z-danger)]'
                    : 'text-[var(--app-text-secondary)]'
                }`}
              >
                {testResult
                  ? testResult.preflightReady
                    ? `PREFLIGHT READY (${testResult.latencyMs}ms)`
                    : testResult.success
                    ? `R/W OK · CKPT 404`
                    : `${testResult.errorCode || 'FAILED'}`
                  : 'NOT_RUN'}
              </div>
            </div>
          </div>

          {storageStatus && !storageStatus.configValid && (
            <div className="text-[11px] font-mono text-[var(--z-warn)]">
              {storageStatus.validationError ||
                'Bucket environment variables (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY or CHECKPOINT_PRESIGNED_URL) are not configured yet. Configure real values in Settings -> Cloud Secrets without inventing placeholders.'}
            </div>
          )}

          {storageError && (
            <div className="text-[11px] font-mono text-[var(--z-danger)]">{storageError}</div>
          )}

          {testResult && (
            <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] font-mono text-[11px] space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[var(--app-text-primary)]">
                  Bucket: {testResult.bucket || '—'} · HTTP {testResult.httpStatusCode ?? '—'}
                </span>
                <span className="text-[var(--app-text-secondary)] tabular-nums">
                  Read: {testResult.readVerified ? 'PASS' : 'FAIL'} · Write: {testResult.writeVerified ? 'PASS' : 'FAIL'} · SHA-256 Match: {testResult.roundtripSha256Match ? 'PASS' : 'FAIL'}
                </span>
              </div>
              {testResult.errorMessage && (
                <div className={testResult.success ? 'text-[var(--z-warn)]' : 'text-[var(--z-danger)]'}>
                  {testResult.errorMessage}
                </div>
              )}
              {testResult.artifacts.length > 0 && (
                <div className="text-[var(--app-text-secondary)]">
                  Bucket artifacts ({testResult.artifacts.length}):{' '}
                  {testResult.artifacts.map((a) => `${a.key} (${(a.sizeBytes / (1024 * 1024)).toFixed(2)} MB)`).join(', ')}
                </div>
              )}
            </div>
          )}

          {preflightReport && (
            <div
              className={`p-3 rounded-xl border font-mono text-[11px] space-y-1.5 ${
                preflightReport.passed
                  ? 'bg-[color-mix(in_srgb,var(--z-ok)_8%,var(--app-surface))] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)]'
                  : 'bg-[color-mix(in_srgb,var(--z-danger)_8%,var(--app-surface))] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[var(--app-text-primary)]">
                  Cloud Preflight: {preflightReport.status} ({preflightReport.latencyMs}ms)
                </span>
                <span className="text-[var(--app-text-secondary)] tabular-nums">
                  Credentials: {preflightReport.checks.credentialsValid ? 'PASS' : 'FAIL'} ·
                  Bucket: {preflightReport.checks.bucketAvailable ? 'PASS' : 'FAIL'} ·
                  Exists: {preflightReport.checks.checkpointExists ? 'PASS' : 'FAIL'} ·
                  Accessible: {preflightReport.checks.checkpointAccessible ? 'PASS' : 'FAIL'} ·
                  R/W: {preflightReport.checks.readWriteVerified ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <div className="text-[var(--app-text-secondary)]">
                Target: {preflightReport.bucket || '—'}/{preflightReport.checkpointKey}
                {preflightReport.checkpointSizeBytes !== null ? ` · Size: ${preflightReport.checkpointSizeBytes} bytes` : ''}
                {preflightReport.headerMagicValid !== null ? ` · Header Magic: ${preflightReport.headerMagicValid ? 'VALID' : 'INVALID'}` : ''}
              </div>
              {preflightReport.error && (
                <div className="text-[var(--z-danger)] break-words">{preflightReport.error}</div>
              )}
            </div>
          )}
        </div>

        {/* 41.5M Cloud Fetch + SHA-256 + Parameter Count Verification Controls */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-[var(--app-text-secondary)] mb-1">
                S3 Checkpoint Object Key
              </label>
              <input
                type="text"
                value={objectKeyInput}
                onChange={(e) => setObjectKeyInput(e.target.value)}
                placeholder="checkpoints/model_checkpoint_target_41m.pt"
                className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[var(--app-text-secondary)] mb-1">
                Optional Presigned Download URL
              </label>
              <input
                type="url"
                value={presignedUrlInput}
                onChange={(e) => setPresignedUrlInput(e.target.value)}
                placeholder="https://... (leave empty to use S3 env)"
                className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[var(--app-text-secondary)] mb-1">
                Optional Expected SHA-256 Digest
              </label>
              <input
                type="text"
                value={expectedShaInput}
                onChange={(e) => setExpectedShaInput(e.target.value)}
                placeholder="64-char hex digest (optional pin)"
                className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] font-mono text-[var(--app-text-secondary)] tabular-nums">
              Required Parameter Target: <strong className="text-[var(--app-text-primary)]">{EXPECTED_41M_PARAMS.toLocaleString()}</strong> (Float32)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="verify-41m-cloud-only-btn"
                disabled={busyMode !== null}
                onClick={() => void handleFetchAndVerify(true)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {busyMode === 'verify' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-[var(--app-accent)]" />}
                <span>Fetch &amp; Verify Only</span>
              </button>
              <button
                type="button"
                data-testid="fetch-verify-load-41m-btn"
                disabled={busyMode !== null}
                onClick={() => void handleFetchAndVerify(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-slate-950 cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {busyMode === 'load' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
                <span>{busyMode === 'load' ? 'Verifying & Loading…' : 'Fetch, Verify SHA-256 & Load Runtime'}</span>
              </button>
            </div>
          </div>

          {/* 4-Gate Verification Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            {[
              {
                label: '1. Cloud Fetch',
                state: fetchGateState,
                detail: outcome?.fetchLatencyMs ? `${outcome.fetchLatencyMs} ms` : 'Cloud Object Storage GET',
              },
              {
                label: '2. SHA-256 Hash',
                state: shaGateState,
                detail: v?.containerSha256 ? `${v.containerSha256.slice(0, 14)}…` : 'Container + Payload',
              },
              {
                label: '3. Param Count (41.5M)',
                state: paramGateState,
                detail: v ? `${v.actualParams.toLocaleString()} / ${v.expectedParams.toLocaleString()}` : '41,527,808 required',
              },
              {
                label: '4. Native Runtime Load',
                state: loadGateState,
                detail:
                  outcome?.runtimeLoaded && outcome?.runtimeActivation?.activated
                    ? `ACTIVE · SHA MATCH (${outcome.loadLatencyMs ?? '—'} ms)`
                    : 'Blocked until verified',
              },
            ].map((gate) => (
              <div
                key={gate.label}
                className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-start gap-2.5"
              >
                {renderGateIcon(gate.state)}
                <div className="min-w-0">
                  <div className="font-bold text-[var(--app-text-primary)]">{gate.label}</div>
                  <div className="text-[11px] font-mono tabular-nums text-[var(--app-text-secondary)] truncate mt-0.5">
                    {gate.state} · {gate.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {outcome && (
            <div
              className={`p-3.5 rounded-xl border font-mono text-[11px] space-y-1.5 ${
                outcome.success
                  ? 'bg-[color-mix(in_srgb,var(--z-ok)_8%,var(--app-surface))] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)]'
                  : 'bg-[color-mix(in_srgb,var(--z-danger)_8%,var(--app-surface))] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)]'
              }`}
            >
              <div className="font-bold text-[var(--app-text-primary)]">
                {outcome.success
                  ? outcome.runtimeLoaded && outcome.runtimeActivation?.activated
                    ? 'ACTIVE & VERIFIED IN NATIVE RUNTIME'
                    : 'PRE-LOAD VERIFICATION PASSED'
                  : `FAIL-CLOSED AT STAGE ${outcome.stage}`}
              </div>
              {outcome.error && <div className="text-[var(--z-danger)] break-words">{outcome.error}</div>}
              {v && (
                <div className="space-y-0.5 text-[var(--app-text-secondary)] break-all">
                  <div>Source URI: {v.sourceUri} · Size: {(v.byteSize / (1024 * 1024)).toFixed(2)} MB</div>
                  <div>Container SHA-256: {v.containerSha256}</div>
                  <div>Payload SHA-256: {v.payloadSha256}</div>
                  <div>
                    Params Verified: {String(v.paramCountVerified)} ({v.actualParams.toLocaleString()} / {v.expectedParams.toLocaleString()}) · Finite Float32: {String(v.finiteWeightsVerified)}
                    {v.matchedBaselineLabel ? ` · Matched Baseline: ${v.matchedBaselineLabel}` : ''}
                  </div>
                  {outcome.runtimeActivation && (
                    <div>
                      Runtime Activation: {outcome.runtimeActivation.activated ? 'ACTIVE' : 'BLOCKED'} · SHA-256 Parity:{' '}
                      {String(outcome.runtimeActivation.sha256Matched)} · Runtime ID:{' '}
                      {outcome.runtimeActivation.activeRuntimeId || '—'} · Runtime SHA-256:{' '}
                      {outcome.runtimeActivation.runtimeSha256 || '—'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </VividCard>
  );
};
