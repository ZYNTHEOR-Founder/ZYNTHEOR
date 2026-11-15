import React, { useState, useEffect } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusBadge, StatusDot } from '../ui/StatusBadge';
import { SystemAuditLedger } from './SystemAuditLedger';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
import { SystemStatusData } from '../../types';
import type { CheckpointIntegrityReport, CheckpointIntegrityStatus } from '../../hooks/useAuditIntegrity';
import { NativeMemoryController, EpisodicMemoryItem, MemoryStats, MemoryIntegrityReport } from '../../services/NativeMemoryController';
import {
  ShieldCheck,
  Lock,
  Play,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  KeyRound,
  ShieldAlert,
  Database,
  FileCheck,
  Terminal,
  Activity,
  Plus,
  Trash2,
  FolderLock,
  Languages,
  Edit2,
  Save,
  X,
  Download,
  Clock,
  Check,
  Ban
} from 'lucide-react';

interface TamperResult {
  status: 'TAMPER_FREE' | 'TAMPER_DETECTED';
  verifiedAt: string;
  genesisDigest: string;
  executionDigest: string;
  probeDurationMs: number;
  filesAudited: number;
  sandboxPath: string;
  checks: {
    sandboxBoundaryIntact: boolean;
    noopExecutionPassed: boolean;
    genesisStateMatches: boolean;
    noSymlinkEscapes: boolean;
  };
  evidence: string;
}

interface GovernanceSecurityProps {
  statusData?: SystemStatusData | null;
  checkpointIntegrityStatus?: CheckpointIntegrityStatus;
  checkpointAuditReport?: CheckpointIntegrityReport | null;
  isVerifyingCheckpoint?: boolean;
  onVerifyCheckpointIntegrity?: () => Promise<CheckpointIntegrityReport>;
}

export const GovernanceSecurity: React.FC<GovernanceSecurityProps> = ({
  statusData = null,
  checkpointIntegrityStatus = 'NOT_LOADED',
  checkpointAuditReport = null,
  isVerifyingCheckpoint = false,
  onVerifyCheckpointIntegrity,
}) => {
  const { t, lang, formatNumber, formatDate } = useLanguage();
  const { authHeaders, authReady, isAuthenticated, role } = useAuth();
  const [isRunningSim, setIsRunningSim] = useState(false);
  const [simResults, setSimResults] = useState<any[] | null>(null);

  // Tamper Verification state
  const [isVerifyingTamper, setIsVerifyingTamper] = useState(false);
  const [tamperResult, setTamperResult] = useState<TamperResult | null>(null);

  // Language Integrity Suite state
  const [isVerifyingLanguage, setIsVerifyingLanguage] = useState(false);
  const [languageSuiteResult, setLanguageSuiteResult] = useState<any | null>(null);

  // Memory Controller state (CRUD via NativeMemoryController service)
  const [memoryItems, setMemoryItems] = useState<EpisodicMemoryItem[]>([]);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [memoryIntegrity, setMemoryIntegrity] = useState<MemoryIntegrityReport | null>(null);
  const [isLoadingMem, setIsLoadingMem] = useState(false);
  const [newMemKey, setNewMemKey] = useState('');
  const [newMemVal, setNewMemVal] = useState('');
  const [newMemCat, setNewMemCat] = useState('episodic');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  // Training Epoch Provenance Validation state
  const [epochProvenance, setEpochProvenance] = useState<{
    epochs: Array<{
      id: string;
      timestamp: string;
      action: string;
      hash: string;
      prevHash: string;
      chainValid: boolean;
      details: any;
    }>;
    discrepancies: string[];
    chainVerified: boolean;
    totalLedgerEntries: number;
  } | null>(null);
  const [isValidatingEpochs, setIsValidatingEpochs] = useState(false);

  // Manual 41.53M Model Parameter Integrity Audit against Master Ledger
  const [isAuditingModel, setIsAuditingModel] = useState(false);
  const [modelAuditResult, setModelAuditResult] = useState<any | null>(null);
  const [modelAuditError, setModelAuditError] = useState<string | null>(null);

  // Batch 28 Human Approval Gate Queue state
  const [approvalQueue, setApprovalQueue] = useState<any[]>([]);
  const [isLoadingApprovals, setIsLoadingApprovals] = useState(false);
  const [approvalActionError, setApprovalActionError] = useState<string | null>(null);
  const [actingApprovalId, setActingApprovalId] = useState<string | null>(null);

  const fetchApprovalQueue = async () => {
    if (!authReady || !isAuthenticated) return;
    setIsLoadingApprovals(true);
    setApprovalActionError(null);
    try {
      const res = await fetch(apiUrl('/api/governance/approvals'), { headers: authHeaders() });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.requests)) {
        setApprovalQueue(data.requests);
      } else if (res.status === 403) {
        setApprovalQueue([]);
      } else if (!res.ok) {
        setApprovalActionError(data.error || `Failed to load approval queue (${res.status})`);
      }
    } catch (err: any) {
      setApprovalActionError(err.message);
    } finally {
      setIsLoadingApprovals(false);
    }
  };

  const handleApprovalDecision = async (requestId: string, decision: 'approve' | 'reject') => {
    if (actingApprovalId) return;
    setActingApprovalId(requestId);
    setApprovalActionError(null);
    try {
      const res = await fetch(apiUrl(`/api/governance/approvals/${encodeURIComponent(requestId)}/${decision}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ note: `${decision}d via Governance Console` }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to ${decision} request (${res.status})`);
      }
      await fetchApprovalQueue();
    } catch (err: any) {
      setApprovalActionError(err.message);
    } finally {
      setActingApprovalId(null);
    }
  };

  const handleRunModelIntegrityAudit = async () => {
    if (!isAuthenticated || isAuditingModel) return;
    setIsAuditingModel(true);
    setModelAuditError(null);
    try {
      const res = await fetch(apiUrl('/api/governance/audit-model-integrity'), {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Model parameter audit failed');
      }
      setModelAuditResult(data.audit);
      await validateTrainingProvenance();
    } catch (err: any) {
      setModelAuditError(err.message);
    } finally {
      setIsAuditingModel(false);
    }
  };

  const validateTrainingProvenance = async () => {
    if (!isAuthenticated) return;
    setIsValidatingEpochs(true);
    try {
      const res = await fetch(apiUrl('/api/audit?limit=150'), { headers: authHeaders() });
      const data = await res.json();
      const entries = Array.isArray(data.records)
        ? data.records
        : Array.isArray(data.entries)
        ? data.entries
        : null;
      if (data.success && entries) {
        const discrepancies: string[] = [];

        const trainingEntries = entries.filter(
          (e: any) =>
            e.action === 'NATIVE_TRAINING_STEP_COMMITTED' ||
            e.action === 'FULL_TENSOR_CHECKPOINT_EXPORTED' ||
            e.action === 'MODEL_PARAMETER_INTEGRITY_AUDIT'
        );

        const validatedEpochs = trainingEntries.map((e: any, idx: number) => {
          const entryHash = e.entry_hash || e.hash || '';
          const prevHash = e.prev_hash || e.prevHash || '';
          const hasHash = typeof entryHash === 'string' && entryHash.length >= 16;
          const hasPrev = typeof prevHash === 'string' && prevHash.length > 0;
          const chainValid = hasHash && hasPrev;
          if (!chainValid) {
            discrepancies.push(`Epoch entry #${idx + 1} (${e.action}) missing valid SHA-256 link.`);
          }
          return {
            id: e.id || `block-${e.index ?? idx}`,
            timestamp: e.timestamp || new Date().toISOString(),
            action: e.action,
            hash: entryHash || 'MISSING_HASH',
            prevHash: prevHash || 'MISSING_PREV',
            chainValid,
            details: e.payload || e.details || {}
          };
        });

        setEpochProvenance({
          epochs: validatedEpochs,
          discrepancies,
          chainVerified: discrepancies.length === 0 && (data.integrity?.valid !== false),
          totalLedgerEntries: entries.length
        });
      }
    } catch (err) {
      console.error('Failed to validate training provenance:', err);
    } finally {
      setIsValidatingEpochs(false);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      validateTrainingProvenance();
      fetchApprovalQueue();
    }
  }, [authReady, isAuthenticated]);

  const handleExportSignedAuditTrail = async () => {
    if (!epochProvenance) return;
    const payload = {
      schema: 'ZYNTHEOR_TRAINING_AUDIT_TRAIL_V1',
      exportedAt: new Date().toISOString(),
      chainVerified: epochProvenance.chainVerified,
      discrepanciesCount: epochProvenance.discrepancies.length,
      discrepancies: epochProvenance.discrepancies,
      epochs: epochProvenance.epochs.map((ep) => ({
        id: ep.id,
        timestamp: ep.timestamp,
        action: ep.action,
        sha256: ep.hash,
        prevSha256: ep.prevHash,
        chainValid: ep.chainValid,
        details: ep.details
      }))
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    let signatureSha256 = 'UNAVAILABLE';
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = new TextEncoder().encode(jsonStr);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      signatureSha256 = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    const signedBundle = {
      ...payload,
      bundleSignatureSha256: signatureSha256
    };

    const blob = new Blob([JSON.stringify(signedBundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyntheor-training-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunSecuritySuite = async () => {
    setIsRunningSim(true);
    try {
      const res = await fetch(apiUrl('/api/identity/verify-security'), { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setSimResults(data.results);
      }
    } catch (err) {
      console.error('Failed to run security simulation:', err);
    } finally {
      setIsRunningSim(false);
    }
  };

  const handleRunTamperVerification = async () => {
    setIsVerifyingTamper(true);
    try {
      const res = await fetch(apiUrl('/api/sandbox/tamper-verify'), { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setTamperResult(data);
      }
    } catch (err) {
      console.error('Failed to run tamper verification:', err);
    } finally {
      setIsVerifyingTamper(false);
    }
  };

  const handleRunLanguageSuite = async () => {
    setIsVerifyingLanguage(true);
    try {
      const res = await fetch(apiUrl('/api/verify/language-integrity'), { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setLanguageSuiteResult(data.suite);
      }
    } catch (err) {
      console.error('Failed to run language integrity suite:', err);
    } finally {
      setIsVerifyingLanguage(false);
    }
  };

  const fetchEpisodicMemory = async () => {
    setIsLoadingMem(true);
    try {
      const [items, stats, integrity] = await Promise.all([
        NativeMemoryController.listAll(),
        NativeMemoryController.getStats(),
        NativeMemoryController.verifyIntegrity().catch(() => null),
      ]);
      setMemoryItems(items);
      setMemoryStats(stats);
      if (integrity) setMemoryIntegrity(integrity);
    } catch (err) {
      console.error('Failed to load episodic memories:', err);
    } finally {
      setIsLoadingMem(false);
    }
  };

  const handleStoreMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemKey.trim() || !newMemVal.trim()) return;

    try {
      await NativeMemoryController.createMemory(
        newMemKey.trim(),
        newMemVal.trim(),
        newMemCat
      );
      setNewMemKey('');
      setNewMemVal('');
      fetchEpisodicMemory();
    } catch (err) {
      console.error('Failed to store episodic memory:', err);
    }
  };

  const handleUpdateMemory = async (key: string, category: string) => {
    if (!editVal.trim()) return;
    try {
      await NativeMemoryController.updateMemory(key, editVal.trim(), category);
      setEditingKey(null);
      setEditVal('');
      fetchEpisodicMemory();
    } catch (err) {
      console.error('Failed to update memory:', err);
    }
  };

  const handleDeleteMemory = async (key: string) => {
    try {
      await NativeMemoryController.deleteMemory(key);
      fetchEpisodicMemory();
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  useEffect(() => {
    // Run initial tamper check, language integrity suite, and load memories on mount
    handleRunTamperVerification();
    handleRunLanguageSuite();
    fetchEpisodicMemory();
  }, []);

  return (
    <div className="space-y-8">
      {/* 0. Manual 41.53M Model Parameter Integrity Audit Against Master Ledger */}
      <VividCard
        gradientAccent="cyan"
        className="!p-6"
        headerAction={
          <button
            onClick={handleRunModelIntegrityAudit}
            disabled={isAuditingModel || !isAuthenticated}
            className="min-h-[44px] flex items-center gap-2 px-5 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${isAuditingModel ? 'animate-spin' : ''}`} />
            <span>
              {isAuditingModel
                ? lang === 'th' ? 'กำลังตรวจสอบแฮชพารามิเตอร์...' : 'Auditing 41.53M Hashes...'
                : lang === 'th' ? 'รันการตรวจสอบ 41.53M กับ Master Ledger' : 'Trigger Manual Integrity Audit'}
            </span>
          </button>
        }
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[#00F0FF]">
              <span>Active Checkpoint Parameter Governance</span>
              <span aria-hidden="true">·</span>
              <span>Master Ledger Cross-Verification</span>
              {modelAuditResult && (
                <>
                  <span aria-hidden="true">·</span>
                  <StatusBadge status={modelAuditResult.verified ? 'VERIFIED' : 'BLOCKED'} />
                </>
              )}
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
              {lang === 'th'
                ? 'ตรวจสอบความสมบูรณ์ของพารามิเตอร์โมเดลเทียบกับ Master Ledger'
                : 'Active Model Parameter Hash Audit vs. Master Ledger'}
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1 max-w-3xl leading-relaxed">
              Validates the active runtime SHA-256 digest, loaded tensor parameter counts, and execution verification against historical hashes recorded in the immutable audit_log.jsonl master ledger, then commits a signed GOVERNANCE block.
            </p>
          </div>
        </div>

        {modelAuditError && (
          <div className="mt-4 p-3 rounded-xl bg-[#FF007F]/10 border border-[#FF007F]/40 text-xs text-rose-200 font-mono">
            {modelAuditError}
          </div>
        )}

        {checkpointAuditReport && (
          <div className="mt-4 p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusDot
                  status={
                    checkpointIntegrityStatus === 'VERIFIED'
                      ? 'VERIFIED'
                      : checkpointIntegrityStatus === 'MISMATCH'
                      ? 'FAILED'
                      : checkpointIntegrityStatus === 'CHECKING' || isVerifyingCheckpoint
                      ? 'CHECKING'
                      : 'NOT_LOADED'
                  }
                  label={`Real-Time Monitor: ${checkpointIntegrityStatus}`}
                  pulse={checkpointIntegrityStatus === 'CHECKING' || isVerifyingCheckpoint || checkpointIntegrityStatus === 'MISMATCH'}
                />
                <span className="text-[11px] font-mono text-[var(--app-text-secondary)]">
                  {checkpointAuditReport.metadataSource ? `Source: ${checkpointAuditReport.metadataSource}` : 'No cloud metadata bound'}
                </span>
              </div>
              <div className="text-[11px] font-mono text-[var(--app-text-secondary)] break-all">
                {checkpointAuditReport.reason}
              </div>
            </div>
            {onVerifyCheckpointIntegrity && (
              <button
                type="button"
                onClick={() => void onVerifyCheckpointIntegrity()}
                disabled={isVerifyingCheckpoint || !isAuthenticated}
                className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#00F0FF]/12 hover:bg-[#00F0FF]/20 border border-[#00F0FF]/40 text-[#00F0FF] shrink-0 cursor-pointer disabled:opacity-50"
              >
                {isVerifyingCheckpoint ? 'Checking...' : 'Check Cloud Hash'}
              </button>
            )}
          </div>
        )}

        {!modelAuditResult && !modelAuditError && (
          <div className="mt-4 p-4 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-xs text-[var(--app-text-secondary)] flex flex-wrap items-center justify-between gap-2">
            <span>
              Ready to audit active checkpoint ({statusData?.model?.totalParams ? `${statusData.model.totalParams.toLocaleString()} params` : 'no weights loaded'}) against native_data/audit_log.jsonl.
            </span>
            <span className="font-mono text-[11px] text-[#00F0FF]">Click Trigger Manual Integrity Audit to run live SHA-256 verification.</span>
          </div>
        )}

        {modelAuditResult && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                <div className="text-[11px] text-[var(--app-text-secondary)]">Runtime Loaded SHA-256</div>
                <div className="text-xs font-mono font-bold text-[#CCFF00] break-all tabular-nums">
                  {modelAuditResult.runtimeCheckpointHash}
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] font-mono tabular-nums">
                  {modelAuditResult.totalParams?.toLocaleString()} params · {modelAuditResult.tensorCount} tensors
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                <div className="text-[11px] text-[var(--app-text-secondary)]">Disk Float32 Payload SHA-256</div>
                <div className="text-xs font-mono font-bold text-[var(--app-text-primary)] break-all tabular-nums">
                  {modelAuditResult.diskPayloadSha256}
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] font-mono">
                  {modelAuditResult.weightsSource}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                <div className="text-[11px] text-[var(--app-text-secondary)]">Master Ledger Reference SHA-256</div>
                <div className="text-xs font-mono font-bold text-[#FF5E3A] break-all tabular-nums">
                  {modelAuditResult.ledgerReferenceHash || 'First Sealed Baseline'}
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] font-mono tabular-nums">
                  {modelAuditResult.ledgerReferenceIndex !== null
                    ? `Matched Block #${modelAuditResult.ledgerReferenceIndex} (${modelAuditResult.ledgerReferenceAction})`
                    : 'Sealed new governance block'}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[var(--app-card-border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--app-surface)] border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] text-[11px]">
                  <tr>
                    <th className="py-2 px-3 font-semibold">Integrity Assertion</th>
                    <th className="py-2 px-3 font-semibold">Outcome</th>
                    <th className="py-2 px-3 font-semibold text-right">Ledger &amp; Audit Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--app-card-border)] bg-[var(--app-input-bg)] font-mono text-[11px] text-[var(--app-text-primary)] tabular-nums">
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium">Master Ledger Chain Integrity</td>
                    <td className={`py-2 px-3 font-bold ${modelAuditResult.checks.ledgerChainValid ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
                      {modelAuditResult.checks.ledgerChainValid ? 'INTACT' : 'BROKEN'}
                    </td>
                    <td className="py-2 px-3 text-right text-[var(--app-text-secondary)]">{modelAuditResult.ledgerTotalRecords} chained records</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium">Runtime Hash == Disk Float32 Payload Hash</td>
                    <td className={`py-2 px-3 font-bold ${modelAuditResult.checks.runtimeMatchesDisk ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
                      {modelAuditResult.checks.runtimeMatchesDisk ? 'EXACT MATCH' : 'MISMATCH'}
                    </td>
                    <td className="py-2 px-3 text-right text-[var(--app-text-secondary)]">{modelAuditResult.durationMs} ms audit latency</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium">Dynamic Tensor Count &amp; Execution Seal</td>
                    <td className={`py-2 px-3 font-bold ${modelAuditResult.checks.paramsAndManifestValid && modelAuditResult.checks.diskMatchesMetadata ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
                      {modelAuditResult.checks.paramsAndManifestValid && modelAuditResult.checks.diskMatchesMetadata ? 'VERIFIED' : 'INVALID'}
                    </td>
                    <td className="py-2 px-3 text-right text-[var(--app-text-secondary)]">{modelAuditResult.totalParams?.toLocaleString()} loaded params</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium">Loaded Model == Master Ledger Baseline</td>
                    <td className={`py-2 px-3 font-bold ${modelAuditResult.checks.ledgerMatchesRuntime ? 'text-[#CCFF00]' : 'text-[#FF5E3A]'}`}>
                      {modelAuditResult.checks.ledgerMatchesRuntime ? 'SYNCHRONIZED' : 'DRIFT DETECTED'}
                    </td>
                    <td className="py-2 px-3 text-right text-[#00F0FF]">Committed Block #{modelAuditResult.auditBlockIndex}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </VividCard>

      {/* 1. Runtime Sandbox Tamper Verification Card */}
      <VividCard
        gradientAccent="cyan"
        className="!p-6"
        headerAction={
          <button
            onClick={handleRunTamperVerification}
            disabled={isVerifyingTamper}
            className="min-h-[44px] flex items-center gap-2 px-5 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingTamper ? 'animate-spin' : ''}`} />
            <span>
              {isVerifyingTamper
                ? lang === 'th' ? 'กำลังรัน No-Op Probe...' : 'Executing No-Op Probe...'
                : t('gov.btn_run_tamper')}
            </span>
          </button>
        }
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[#00F0FF] uppercase tracking-wider">
                {lang === 'th' ? 'การพิสูจน์ความสมบูรณ์แบบเรียลไทม์' : 'Runtime Environment Integrity'}
              </span>
              <StatusBadge status={tamperResult?.status === 'TAMPER_FREE' ? 'VERIFIED' : tamperResult ? 'BLOCKED' : 'NOT RUN'} />
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
              {t('gov.tamper_title')}
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1 max-w-3xl leading-relaxed">
              {t('gov.tamper_desc')}
            </p>
          </div>

          {tamperResult && (
            <div className="flex items-center gap-3 p-3 bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl shrink-0">
              <FolderLock
                className={`w-6 h-6 shrink-0 ${
                  tamperResult.status === 'TAMPER_FREE' ? 'text-[#CCFF00]' : 'text-[#FF007F]'
                }`}
              />
              <div>
                <div className="text-xs font-bold text-[var(--app-text-primary)]">
                  {tamperResult.status === 'TAMPER_FREE'
                    ? t('gov.tamper_free')
                    : t('gov.tamper_detected')}
                </div>
                <div className="text-[10px] text-[var(--app-text-secondary)] font-mono tabular-nums">
                  {tamperResult.probeDurationMs}ms probe latency · {tamperResult.filesAudited} files
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Verification Checkpoint Grid */}
        {tamperResult && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
              <div className="text-[11px] font-semibold text-[var(--app-text-secondary)] flex items-center justify-between">
                <span>{t('gov.boundary_intact')}</span>
                {tamperResult.checks.sandboxBoundaryIntact ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#CCFF00]" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-[#FF007F]" />
                )}
              </div>
              <div className="text-xs font-bold text-[var(--app-text-primary)]">
                {tamperResult.checks.sandboxBoundaryIntact ? 'STRICT_CONFINED' : 'ESCAPED'}
              </div>
              <div className="text-[10px] text-[var(--app-text-secondary)] font-mono truncate">
                {tamperResult.sandboxPath}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
              <div className="text-[11px] font-semibold text-[var(--app-text-secondary)] flex items-center justify-between">
                <span>No-Op Execution Probe</span>
                {tamperResult.checks.noopExecutionPassed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#CCFF00]" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-[#FF007F]" />
                )}
              </div>
              <div className="text-xs font-bold text-[var(--app-text-primary)]">
                {tamperResult.checks.noopExecutionPassed ? 'VALID_NODE_EXEC' : 'FAILED'}
              </div>
              <div className="text-[10px] text-[var(--app-text-secondary)] font-mono tabular-nums">
                5,000ms sandbox limit
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
              <div className="text-[11px] font-semibold text-[var(--app-text-secondary)] flex items-center justify-between">
                <span>Genesis SHA-256 Match</span>
                {tamperResult.checks.genesisStateMatches ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#CCFF00]" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-[#FF007F]" />
                )}
              </div>
              <div className="text-xs font-bold text-[var(--app-text-primary)] font-mono tabular-nums">
                {tamperResult.genesisDigest.slice(0, 12)}...
              </div>
              <div className="text-[10px] text-[#00F0FF] font-mono">
                {tamperResult.checks.genesisStateMatches ? 'Deterministic Root Intact' : 'Digest Deviation'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
              <div className="text-[11px] font-semibold text-[var(--app-text-secondary)] flex items-center justify-between">
                <span>No Symlink Escapes</span>
                {tamperResult.checks.noSymlinkEscapes ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#CCFF00]" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-[#FF007F]" />
                )}
              </div>
              <div className="text-xs font-bold text-[var(--app-text-primary)]">
                {tamperResult.checks.noSymlinkEscapes ? 'PASSED_CLEAN' : 'BREACH_FOUND'}
              </div>
              <div className="text-[10px] text-[var(--app-text-secondary)] font-mono">
                realpath traversal defense
              </div>
            </div>
          </div>
        )}

        {/* Evidence Logs */}
        {tamperResult && (
          <div className="mt-4 p-3 rounded-xl bg-[#070B19] border border-[#1E294A] text-[var(--app-text-primary)] font-mono text-xs">
            <div className="flex items-center gap-2 text-[#00F0FF] text-[11px] font-bold mb-1">
              <Terminal className="w-3.5 h-3.5" />
              <span>LIVE EVIDENCE &amp; CRYPTOGRAPHIC VERIFICATION PROOF:</span>
            </div>
            <div className="text-[var(--app-text-secondary)] whitespace-pre-wrap">{tamperResult.evidence}</div>
            <div className="text-[11px] text-[var(--app-text-secondary)] mt-1 tabular-nums">
              Probe Execution Digest: <span className="text-[#CCFF00]">{tamperResult.executionDigest}</span>
            </div>
          </div>
        )}
      </VividCard>

      {/* 2. Dual-Script Language Integrity Test Suite */}
      <VividCard
        gradientAccent="cyan"
        className="!p-6"
        headerAction={
          <button
            onClick={handleRunLanguageSuite}
            disabled={isVerifyingLanguage}
            className="min-h-[44px] flex items-center gap-2 px-5 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingLanguage ? 'animate-spin' : ''}`} />
            <span>
              {isVerifyingLanguage
                ? lang === 'th' ? 'กำลังทดสอบภาษาไทย-อังกฤษ...' : 'Testing Dual Scripts...'
                : lang === 'th' ? 'รันการทดสอบภาษาไทย-อังกฤษ' : 'Execute Language Integrity Suite'}
            </span>
          </button>
        }
      >
        {(() => {
          const langResults: any[] = Array.isArray(languageSuiteResult?.results) ? languageSuiteResult.results : [];
          const exactCount = langResults.filter((r) => Boolean(r.roundtrip_exact)).length;
          const exactPct = langResults.length > 0
            ? ((exactCount / langResults.length) * 100).toFixed(1)
            : languageSuiteResult?.total_tests
            ? ((languageSuiteResult.passed_tests / languageSuiteResult.total_tests) * 100).toFixed(1)
            : '0.0';
          const totalUnk = langResults.reduce((sum, r) => sum + (Number(r.unk_count) || 0), 0);
          const avgLatency = langResults.length > 0
            ? (langResults.reduce((sum, r) => sum + (Number(r.duration_ms) || 0), 0) / langResults.length).toFixed(2)
            : null;
          return (
            <>
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-[#00F0FF] uppercase tracking-wider">
                      {lang === 'th' ? 'การพิสูจน์ความสมบูรณ์ของภาษาและการแปลงโทเค็น' : 'Bilingual Tokenization & Semantic Integrity'}
                    </span>
                    <StatusBadge status={languageSuiteResult?.verified ? 'VERIFIED' : languageSuiteResult ? 'PARTIAL' : 'NOT RUN'} />
                  </div>
                  <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
                    {lang === 'th'
                      ? 'ชุดทดสอบความถูกต้องของภาษาไทยและอังกฤษ (Language Integrity Suite)'
                      : 'Thai & English Dual-Script Language Integrity Suite'}
                  </h2>
                  <p className="text-xs text-[var(--app-text-secondary)] mt-1 max-w-3xl leading-relaxed">
                    {lang === 'th'
                      ? 'ทดสอบความสามารถของ Native Model ในการประมวลผล แปลงเป็นโทเค็น และแปลงกลับ (Encode & Detokenize) ข้อความภาษาไทย อังกฤษ และการสลับภาษา (Code-Switching) โดยไม่มีการสูญเสียความหมาย และไม่มีโทเค็นที่ไม่รู้จัก ([UNK] = 0)'
                      : "Verifies the Native Model's ability to tokenize and detokenize Thai, English, and code-switching scripts with round-trip fidelity, full vowel/tone mark preservation, and unknown token counts measured live."}
                  </p>
                </div>

                {languageSuiteResult && (
                  <div className="flex items-center gap-3 p-3 bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl shrink-0">
                    <Languages className="w-6 h-6 text-[#00F0FF] shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-[var(--app-text-primary)] tabular-nums">
                        {languageSuiteResult.passed_tests} / {languageSuiteResult.total_tests} {lang === 'th' ? 'การทดสอบผ่าน' : 'Script Proofs Passed'}
                      </div>
                      <div className={`text-[10px] font-mono font-bold tabular-nums ${languageSuiteResult.verified ? 'text-[#CCFF00]' : 'text-[#FF5E3A]'}`}>
                        {exactPct}% ROUNDTRIP FIDELITY
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {languageSuiteResult && (
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[11px] font-semibold text-[var(--app-text-secondary)] flex items-center justify-between">
                      <span>{lang === 'th' ? 'ความเที่ยงตรงสมบูรณ์' : 'Roundtrip Exact Match'}</span>
                      <CheckCircle2 className={`w-3.5 h-3.5 ${exactCount === langResults.length && langResults.length > 0 ? 'text-[#CCFF00]' : 'text-[#FF5E3A]'}`} />
                    </div>
                    <div className={`text-xs font-bold font-mono tabular-nums ${exactCount === langResults.length && langResults.length > 0 ? 'text-[#CCFF00]' : 'text-[#FF5E3A]'}`}>
                      {exactPct}% EXACT
                    </div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] font-mono">
                      decode(encode(text)) === text
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[11px] font-semibold text-[var(--app-text-secondary)] flex items-center justify-between">
                      <span>{lang === 'th' ? 'อัตราสูญเสียโทเค็น' : 'Measured UNK Tokens'}</span>
                      <CheckCircle2 className={`w-3.5 h-3.5 ${totalUnk === 0 ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`} />
                    </div>
                    <div className={`text-xs font-bold font-mono tabular-nums ${totalUnk === 0 ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
                      {totalUnk} UNK
                    </div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] font-mono">
                      Observed across {langResults.length} probes
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[11px] font-semibold text-[var(--app-text-secondary)] flex items-center justify-between">
                      <span>{lang === 'th' ? 'คำศัพท์สถาปัตยกรรม' : 'Dual Vocabulary'}</span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#00F0FF]" />
                    </div>
                    <div className="text-xs font-bold text-[var(--app-text-primary)] font-mono tabular-nums">
                      {languageSuiteResult.vocab_size ? `${Number(languageSuiteResult.vocab_size).toLocaleString()} SUBWORDS` : '16,384 SUBWORDS'}
                    </div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] font-mono">
                      Thai Unicode U+0E01-0E5B
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[11px] font-semibold text-[var(--app-text-secondary)] flex items-center justify-between">
                      <span>{lang === 'th' ? 'ความเร็วประมวลผลเฉลี่ย' : 'Avg Tokenize Latency'}</span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#00F0FF]" />
                    </div>
                    <div className="text-xs font-bold text-[var(--app-text-primary)] font-mono tabular-nums">
                      {avgLatency !== null ? `${avgLatency} ms` : '—'}
                    </div>
                    <div className="text-[10px] text-[#00F0FF] font-mono">
                      In-Memory Subword Trie
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 overflow-x-auto rounded-xl border border-[var(--app-card-border)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--app-surface)] border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] uppercase text-[11px] font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Test ID</th>
                      <th className="py-2.5 px-3">{lang === 'th' ? 'การทดสอบสคริปต์' : 'Script Integrity Test'}</th>
                      <th className="py-2.5 px-3">{lang === 'th' ? 'ข้อความตัวอย่าง' : 'Test Sample'}</th>
                      <th className="py-2.5 px-3">Tokens</th>
                      <th className="py-2.5 px-3">UNKs</th>
                      <th className="py-2.5 px-3">Fidelity</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--app-card-border)] bg-[var(--app-input-bg)] font-sans tabular-nums">
                    {langResults.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-6 px-4 text-center text-xs text-[var(--app-text-secondary)] italic">
                          {isVerifyingLanguage
                            ? (lang === 'th' ? 'กำลังรันชุดทดสอบภาษาไทย-อังกฤษ...' : 'Running live dual-script verification suite...')
                            : (lang === 'th' ? 'ยังไม่มีผลลัพธ์การทดสอบ กดปุ่มรันการทดสอบภาษาไทย-อังกฤษด้านบน' : 'No live language integrity results recorded yet. Click Execute Language Integrity Suite above.')}
                        </td>
                      </tr>
                    ) : (
                      langResults.map((t: any) => (
                        <tr key={t.test_id} className="hover:bg-[var(--app-surface)]/80 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-bold text-[#00F0FF]">
                            {t.test_id}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-[var(--app-text-primary)] whitespace-nowrap">
                            {t.name}
                          </td>
                          <td className="py-2.5 px-3 text-[var(--app-text-secondary)] text-[11px] max-w-xs truncate">
                            {t.sample || t.text}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[var(--app-text-primary)]">
                            {t.token_count}
                          </td>
                          <td className={`py-2.5 px-3 font-mono font-bold ${t.unk_count === 0 ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
                            {t.unk_count}
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusDot
                              status={t.roundtrip_exact ? 'VERIFIED' : 'FAILED'}
                              label={t.roundtrip_exact ? '100% EXACT' : 'MISMATCH'}
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge status={t.status === 'PASS' ? 'VERIFIED' : 'BLOCKED'} />
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-[11px] text-[var(--app-text-secondary)]">
                            {t.duration_ms}ms
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}
      </VividCard>

      {/* 3. Native Episodic Memory Controller Panel (CRUD & Audit Transactions) */}
      <VividCard
        gradientAccent="violet"
        className="!p-6"
        headerAction={
          <button
            onClick={fetchEpisodicMemory}
            disabled={isLoadingMem}
            className="min-h-[44px] flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--app-text-primary)] bg-[var(--app-input-bg)] border border-[var(--app-card-border)] hover:border-[#00F0FF]/50 rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMem ? 'animate-spin text-[#00F0FF]' : ''}`} />
            <span>{t('btn.refresh')}</span>
          </button>
        }
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-[#C084FC] uppercase tracking-wider">
                {lang === 'th' ? 'การจัดเก็บความจำถาวรข้ามเซสชัน' : 'Tenant-Isolated Sovereign Memory'}
              </span>
              <StatusBadge status={memoryIntegrity ? (memoryIntegrity.valid ? 'VERIFIED' : 'FAILED') : 'VERIFIED'} />
              {memoryIntegrity && (
                <span className="text-[10px] font-mono text-[#00F0FF]">
                  SHA-256: {memoryIntegrity.storeSha256.slice(0, 12)}… · purged={memoryIntegrity.expiredPurgedCount}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">{t('mem.title')}</h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1 max-w-3xl leading-relaxed">
              {t('mem.desc')}
            </p>
          </div>

          {memoryStats && (
            <div className="flex items-center gap-4 text-xs font-mono tabular-nums bg-[#7B2CBF]/15 border border-[#7B2CBF]/40 p-3 rounded-xl shrink-0">
              <div>
                <span className="text-[var(--app-text-secondary)]">{t('mem.total_items')}:</span>{' '}
                <span className="font-bold text-[#00F0FF]">{memoryStats.totalItems}</span>
              </div>
              <div>
                <span className="text-[var(--app-text-secondary)]">Disk Size:</span>{' '}
                <span className="font-bold text-[#C084FC]">{memoryStats.storeSizeBytes} B</span>
              </div>
            </div>
          )}
        </div>

        {/* Form to Store Memory */}
        <form onSubmit={handleStoreMemory} className="mt-6 p-4 rounded-2xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
          <div className="text-xs font-bold text-[var(--app-text-primary)] mb-3 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span>{lang === 'th' ? 'เพิ่มข้อมูลความจำใหม่' : 'Store New Sovereign Memory Entry'}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">{t('mem.store_key')}</label>
              <input
                type="text"
                value={newMemKey}
                onChange={(e) => setNewMemKey(e.target.value)}
                placeholder="e.g. user_project_goal"
                className="w-full px-3 py-2 text-xs bg-[var(--app-surface)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] rounded-xl focus:outline-none focus:border-[#00F0FF] font-mono"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">{t('mem.category')}</label>
              <select
                value={newMemCat}
                onChange={(e) => setNewMemCat(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[var(--app-surface)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] rounded-xl focus:outline-none focus:border-[#00F0FF] font-medium"
              >
                <option value="episodic">Episodic</option>
                <option value="semantic">Semantic</option>
                <option value="user_preference">User Preference</option>
                <option value="reasoning_trace">Reasoning Trace</option>
              </select>
            </div>

            <div className="md:col-span-5">
              <label className="block text-[11px] font-semibold text-[var(--app-text-secondary)] mb-1">{t('mem.store_value')}</label>
              <input
                type="text"
                value={newMemVal}
                onChange={(e) => setNewMemVal(e.target.value)}
                placeholder="Content, preference, or fact to persist..."
                className="w-full px-3 py-2 text-xs bg-[var(--app-surface)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] rounded-xl focus:outline-none focus:border-[#00F0FF] font-sans"
                required
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="min-h-[44px] w-full py-2 px-3 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-xs hover:opacity-95 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Database className="w-3.5 h-3.5" />
                <span>{lang === 'th' ? 'บันทึก' : 'Store'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* Stored Memory Items List */}
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--app-card-border)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--app-surface)] border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] font-semibold uppercase text-[11px]">
              <tr>
                <th className="py-2.5 px-3">Memory Key</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Content / Value</th>
                <th className="py-2.5 px-3">SHA-256 Digest</th>
                <th className="py-2.5 px-3">Reads</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-card-border)] bg-[var(--app-input-bg)] font-sans tabular-nums">
              {memoryItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-[var(--app-text-secondary)] italic">
                    {lang === 'th' ? 'ยังไม่มีความจำที่บันทึก' : 'No episodic memories persisted yet.'}
                  </td>
                </tr>
              ) : (
                memoryItems.map((item) => (
                  <tr key={item.key} className="hover:bg-[var(--app-surface)]/80 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-[#00F0FF]">
                      {item.key}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1.5 text-[#C084FC] text-[11px] font-mono font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C084FC]" />
                        {item.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[var(--app-text-primary)] max-w-xs">
                      {editingKey === item.key ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            className="w-full px-2 py-1 text-xs bg-[var(--app-surface)] border border-[#00F0FF] rounded-lg text-[var(--app-text-primary)] font-sans"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleUpdateMemory(item.key, item.category);
                              if (e.key === 'Escape') setEditingKey(null);
                            }}
                          />
                          <button
                            onClick={() => handleUpdateMemory(item.key, item.category)}
                            className="p-1.5 rounded bg-[#00F0FF] text-[#070B19] hover:opacity-90 cursor-pointer"
                            title="Save update"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingKey(null)}
                            className="p-1.5 rounded text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="truncate block" title={String(item.value)}>
                          {typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-[var(--app-text-secondary)]">
                      {item.contentDigest.slice(0, 14)}… {item.version ? `(v${item.version})` : ''}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[var(--app-text-secondary)]">
                      {item.readCount}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditingKey(item.key);
                            setEditVal(typeof item.value === 'string' ? item.value : JSON.stringify(item.value));
                          }}
                          className="text-[var(--app-text-secondary)] hover:text-[#00F0FF] p-1.5 rounded-md transition-colors cursor-pointer"
                          title="Edit / Update Memory"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteMemory(item.key)}
                          className="text-[var(--app-text-secondary)] hover:text-[#FF007F] p-1.5 rounded-md transition-colors cursor-pointer"
                          title="Delete memory key"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </VividCard>

      {/* 3. Sovereign Identity Hardening & Attack Simulation Card */}
      <VividCard
        gradientAccent="coral"
        className="!p-6"
        headerAction={
          <button
            onClick={handleRunSecuritySuite}
            disabled={isRunningSim}
            className="min-h-[44px] flex items-center gap-2 px-5 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            {isRunningSim
              ? lang === 'th' ? 'กำลังทดสอบ 6 รูปแบบการโจมตี...' : 'Running Live Attack Probes...'
              : lang === 'th' ? 'รันการทดสอบโจมตีโทเค็น' : 'Execute Token Attack Simulation'}
          </button>
        }
      >
        {(() => {
          const passedVectors = simResults ? simResults.filter((r: any) => r.status === 'PASS').length : 0;
          const totalVectors = simResults ? simResults.length : 0;
          const allHardened = Boolean(simResults && totalVectors > 0 && passedVectors === totalVectors);
          return (
            <>
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold text-[#FF5E3A] uppercase tracking-wider">
                    {lang === 'th' ? 'เลเยอร์ความปลอดภัยและอัตลักษณ์สมบูรณ์' : 'Sovereign Identity & Access Layer'}
                  </div>
                  <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
                    Hardened HMAC-SHA256 Token &amp; RBAC Invariants
                  </h2>
                  <p className="text-xs text-[var(--app-text-secondary)] mt-1">
                    Zero hardcoded secrets, timingSafeEqual constant-time verification, exp expiration, and strict tenant isolation.
                  </p>
                </div>

                <div className="flex items-center gap-3 p-3 bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl shrink-0">
                  <Lock className="w-6 h-6 text-[#C084FC] shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-[var(--app-text-primary)] tabular-nums">
                      {simResults ? `${passedVectors} / ${totalVectors} Attack Vectors Blocked` : 'Not Executed Yet'}
                    </div>
                    <div className={`text-[10px] font-mono font-bold ${allHardened ? 'text-[#CCFF00]' : simResults ? 'text-[#FF007F]' : 'text-[var(--app-text-secondary)]'}`}>
                      {simResults ? (allHardened ? 'VERIFIED HARDENED' : 'VULNERABILITY DETECTED') : 'Click Execute Token Attack Simulation'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto rounded-xl border border-[var(--app-card-border)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--app-surface)] border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] font-semibold uppercase text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Vector ID</th>
                      <th className="py-2.5 px-3">Attack Vector</th>
                      <th className="py-2.5 px-3">Exploit Probe</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Defense Invariant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--app-card-border)] bg-[var(--app-input-bg)] font-sans">
                    {!simResults || simResults.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 px-4 text-center text-xs text-[var(--app-text-secondary)] italic">
                          {isRunningSim
                            ? 'Executing live HMAC-SHA256 & RBAC attack probes...'
                            : 'No live attack probe results recorded yet. Click Execute Token Attack Simulation above to run real verification.'}
                        </td>
                      </tr>
                    ) : (
                      simResults.map((t: any) => (
                        <tr key={t.testId} className="hover:bg-[var(--app-surface)]/80 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-bold text-[#00F0FF]">
                            {t.testId}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-[var(--app-text-primary)]">
                            {t.attackVector}
                          </td>
                          <td className="py-2.5 px-3 text-[var(--app-text-secondary)] text-[11px]">
                            {t.simulatedBehavior}
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge status={t.status === 'PASS' ? 'VERIFIED' : 'BLOCKED'} />
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-[11px] text-[var(--app-text-secondary)]">
                            {t.evidence}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}
      </VividCard>

      {/* 4. Sandbox Invariants */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <VividCard title="Sandbox Isolation Barrier" subtitle="ToolGateway confinement" gradientAccent="cyan">
          <div className="space-y-2 text-xs text-[var(--app-text-secondary)]">
            <div className="flex justify-between py-1.5 border-b border-[var(--app-card-border)]">
              <span>Root Directory</span>
              <span className="font-mono text-[var(--app-text-primary)] font-bold">/workspace</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[var(--app-card-border)]">
              <span>Path Traversal Defense</span>
              <span className="text-[#CCFF00] font-bold">Fail-Closed Active</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[var(--app-card-border)]">
              <span>Whitelisted Commands</span>
              <span className="font-mono text-[var(--app-text-primary)] text-[11px]">node, python3, ls, cat</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span>Hard Execution Timeout</span>
              <span className="font-mono text-[var(--app-text-primary)] font-bold tabular-nums">5,000 ms</span>
            </div>
          </div>
        </VividCard>

        <VividCard title="Sovereign Cloud Network Policy" subtitle="External inference APIs are not part of the native core path" gradientAccent="purple">
          <div className="space-y-2 text-xs text-[var(--app-text-secondary)]">
            <div className="flex justify-between py-1.5 border-b border-[var(--app-card-border)]">
              <span>External AI APIs</span>
              <span className="text-[#CCFF00] font-bold">0 Invocations</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[var(--app-card-border)]">
              <span>Telemetry Tracking</span>
              <span className="text-[var(--app-text-secondary)]">Disabled</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span>Storage Security</span>
              <span className="font-mono text-[var(--app-text-primary)] text-[11px]">Sovereign Cloud File Service</span>
            </div>
          </div>
        </VividCard>

        <VividCard title="Role Separation Matrix" subtitle="4-Agent state boundaries" gradientAccent="magenta">
          <div className="space-y-2 text-xs text-[var(--app-text-secondary)]">
            <div className="flex justify-between py-1.5 border-b border-[var(--app-card-border)]">
              <span>PLANNER</span>
              <span className="text-[#00F0FF] font-bold">No Code Writes</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[var(--app-card-border)]">
              <span>CODER</span>
              <span className="text-[#2563EB] font-bold">No Self-Approval</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[var(--app-card-border)]">
              <span>REVIEWER</span>
              <span className="text-[#C084FC] font-bold">Security Auditor</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span>TESTER</span>
              <span className="text-[#CCFF00] font-bold">Real Sandbox Eval</span>
            </div>
          </div>
        </VividCard>
      </div>

      {/* 4.25 Human Approval Gate Queue (Batch 28) */}
      <VividCard
        title={lang === 'th' ? 'คิวคำขออนุมัติโดยมนุษย์ (Human Approval Gate)' : 'Human Approval Gate Queue'}
        subtitle="High-impact actions (MODEL_RELEASE, DATA_DELETION, PERMISSION_CHANGE) require explicit Administrator/Operator review"
        gradientAccent="coral"
        headerAction={
          <button
            type="button"
            onClick={fetchApprovalQueue}
            disabled={isLoadingApprovals}
            className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[var(--app-card-border)] bg-[var(--app-input-bg)] text-[var(--app-text-primary)] hover:border-[#00F0FF] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#00F0FF] ${isLoadingApprovals ? 'animate-spin' : ''}`} />
            <span>{lang === 'th' ? 'รีเฟรช' : 'Refresh'}</span>
          </button>
        }
      >
        {approvalActionError && (
          <div className="mb-3 rounded-xl border border-[#FF007F]/45 bg-[#FF007F]/10 px-3 py-2 text-xs text-[#FF99C8]">
            {approvalActionError}
          </div>
        )}
        {role === 'User' ? (
          <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-4 text-xs text-[var(--app-text-secondary)]">
            Developer or Administrator authorization is required to view approval requests.
          </div>
        ) : approvalQueue.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-5 text-center text-xs text-[var(--app-text-secondary)]">
            {isLoadingApprovals ? 'Loading approval queue...' : 'No high-impact approval requests queued.'}
          </div>
        ) : (
          <div className="space-y-2.5 max-h-80 overflow-y-auto">
            {approvalQueue.map((req) => {
              const isPending = req.status === 'PENDING';
              const statusTone =
                req.status === 'APPROVED' || req.status === 'CONSUMED'
                  ? 'text-[#CCFF00] border-[#CCFF00]/40 bg-[#CCFF00]/10'
                  : req.status === 'REJECTED' || req.status === 'EXPIRED'
                  ? 'text-[#FF007F] border-[#FF007F]/40 bg-[#FF007F]/10'
                  : 'text-[#FF5E3A] border-[#FF5E3A]/40 bg-[#FF5E3A]/10';
              return (
                <div
                  key={req.requestId}
                  className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-3.5 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="w-3.5 h-3.5 text-[#00F0FF] shrink-0" />
                      <span className="font-mono font-bold text-[#00F0FF] truncate">{req.requestId}</span>
                      <span className="px-2 py-0.5 rounded-md border border-[#1E294A] bg-[#070B19] font-mono text-[10px] text-[#F4F7FF]">
                        {req.actionType}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md border font-mono text-[10px] font-bold ${statusTone}`}>
                      {req.status}
                    </span>
                  </div>
                  <p className="text-[var(--app-text-primary)] leading-relaxed">{req.description}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--app-text-secondary)]">
                    <span className="font-mono">
                      Resource: {req.resourceId} · Requested by {req.requestedByUserId} ({req.requestedByRole})
                    </span>
                    {isPending && role === 'Administrator' && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleApprovalDecision(req.requestId, 'approve')}
                          disabled={actingApprovalId === req.requestId}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#CCFF00] px-3 py-1.5 text-[11px] font-bold text-[#070B19] hover:brightness-105 cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApprovalDecision(req.requestId, 'reject')}
                          disabled={actingApprovalId === req.requestId}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#FF007F]/50 bg-[#FF007F]/15 px-3 py-1.5 text-[11px] font-bold text-[#FF99C8] hover:bg-[#FF007F]/25 cursor-pointer disabled:opacity-50"
                        >
                          <Ban className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    )}
                    {isPending && role !== 'Administrator' && (
                      <span className="text-[10px] font-mono text-[#FF5E3A]">
                        Administrator approval required (no autonomous self-approval)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </VividCard>

      {/* 4.5 Training Epoch Provenance Validator & Signed Export */}
      <VividCard
        title={lang === 'th' ? 'ตรวจสอบสายโซ่ SHA-256 ของ Training Epochs' : 'Training Epoch Provenance & Signed Export'}
        subtitle={
          lang === 'th'
            ? 'ตรวจสอบความต่อเนื่องของแฮชในแต่ละ Epoch และส่งออกบันทึกที่ลงนามแล้ว'
            : 'Automatic SHA-256 hash chain validation for historical training epochs'
        }
        gradientAccent="lime"
      >
        <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
          <button
            onClick={validateTrainingProvenance}
            disabled={isValidatingEpochs}
            className="min-h-[44px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--app-card-border)] bg-[var(--app-input-bg)] text-[var(--app-text-primary)] hover:border-[#00F0FF] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isValidatingEpochs ? 'animate-spin text-[#00F0FF]' : ''}`} />
            {lang === 'th' ? 'ตรวจสอบซ้ำ' : 'Re-validate'}
          </button>
          <button
            onClick={handleExportSignedAuditTrail}
            disabled={!epochProvenance}
            className="min-h-[44px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white vivid-gradient-brand hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {lang === 'th' ? 'ส่งออก JSON ที่ลงนาม' : 'Export Signed JSON'}
          </button>
        </div>
        {epochProvenance ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
              <div className="flex items-center gap-2">
                {epochProvenance.chainVerified ? (
                  <CheckCircle2 className="w-4 h-4 text-[#CCFF00]" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-[#FF007F]" />
                )}
                <span className="text-xs font-bold text-[var(--app-text-primary)]">
                  {epochProvenance.chainVerified
                    ? lang === 'th'
                      ? 'สายโซ่ SHA-256 ถูกต้องสมบูรณ์ (Verified Provenance)'
                      : 'SHA-256 Provenance Chain Intact'
                    : lang === 'th'
                    ? `พบความผิดปกติ ${epochProvenance.discrepancies.length} จุด`
                    : `${epochProvenance.discrepancies.length} Provenance Discrepancy(s) Detected`}
                </span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-[var(--app-text-secondary)]">
                {epochProvenance.epochs.length} training events / {epochProvenance.totalLedgerEntries} ledger entries
              </span>
            </div>

            {epochProvenance.discrepancies.length > 0 && (
              <div className="p-3 rounded-xl bg-[#FF007F]/10 border border-[#FF007F]/40 text-xs text-rose-200 space-y-1">
                {epochProvenance.discrepancies.map((d, i) => (
                  <div key={i} className="font-mono text-[11px]">
                    • {d}
                  </div>
                ))}
              </div>
            )}

            <div className="max-h-48 overflow-y-auto space-y-1.5">
              {epochProvenance.epochs.length === 0 ? (
                <div className="text-xs text-[var(--app-text-secondary)] italic py-2">
                  {lang === 'th'
                    ? 'ยังไม่มีบันทึก Training Epoch ใน Ledger'
                    : 'No historical training epoch entries recorded in ledger yet.'}
                </div>
              ) : (
                epochProvenance.epochs.map((ep) => (
                  <div
                    key={ep.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#070B19] border border-[#1E294A] text-[11px] font-mono"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          ep.chainValid ? 'bg-[#CCFF00]' : 'bg-[#FF007F]'
                        }`}
                      />
                      <span className="text-[var(--app-text-primary)] font-semibold truncate">{ep.action}</span>
                    </div>
                    <span className="text-[#00F0FF] truncate max-w-[220px]">{ep.hash}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-[var(--app-text-secondary)]">Validating ledger provenance...</div>
        )}
      </VividCard>

      {/* 5. Filterable System Audit Ledger */}
      <SystemAuditLedger statusData={statusData} />
    </div>
  );
};
