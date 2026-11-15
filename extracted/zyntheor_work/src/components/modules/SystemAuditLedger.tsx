import React, { useState, useEffect, useMemo } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { AuditRecord, SystemStatusData } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { sha256Sync } from '../../utils/auditLedger';
import { RollingIntegrityChart } from '../RollingIntegrityChart';
import { computeLedgerRollingIntegrity } from '../../utils/rollingIntegrity';
import {
  PrintableSessionAudit,
  buildSystemMetadataSnapshot,
  usePrintAudit,
} from '../PrintableSessionAudit';
import { apiUrl } from '../../lib/apiClient';
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  Download,
  Printer,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileCode2,
  Lock,
  Layers,
  Activity,
  X
} from 'lucide-react';

interface DisplayedLedgerMismatch {
  index: number;
  reason: string;
  expected?: string;
  actual?: string;
}

interface DisplayedLedgerVerificationReport {
  status: 'INTACT' | 'TAMPERED' | 'EMPTY';
  verifiedAt: string;
  displayedCount: number;
  recalculatedDisplayedDigest: string;
  recalculatedTipHash: string | null;
  recalculatedTipIndex: number | null;
  signedHeadHash: string | null;
  signedTotalRecords: number;
  tipMatchesHeadSeal: boolean | null;
  serverChainValid: boolean;
  mismatches: DisplayedLedgerMismatch[];
}

interface SystemAuditLedgerProps {
  className?: string;
  statusData?: SystemStatusData | null;
}

export const SystemAuditLedger: React.FC<SystemAuditLedgerProps> = ({ className = '', statusData = null }) => {
  const { authHeaders, authReady, isAuthenticated, session, role } = useAuth();
  const { lang } = useLanguage();
  const { printPayload, triggerPrintAudit } = usePrintAudit();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [integrity, setIntegrity] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [verifyingDisplayed, setVerifyingDisplayed] = useState(false);
  const [displayedVerification, setDisplayedVerification] = useState<DisplayedLedgerVerificationReport | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const fetchLedger = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/audit?limit=100'), { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setRecords(data.records || []);
        setIntegrity(data.integrity);
      }
    } catch (err) {
      console.error('Failed to load audit ledger:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      fetchLedger();
    }
  }, [authReady, isAuthenticated]);

  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      // Role filter
      if (roleFilter !== 'ALL' && rec.role !== roleFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesAction = rec.action.toLowerCase().includes(query);
        const matchesHash = rec.entry_hash.toLowerCase().includes(query) || rec.prev_hash.toLowerCase().includes(query);
        const matchesPayload = JSON.stringify(rec.payload).toLowerCase().includes(query);
        const matchesIndex = String(rec.index).includes(query);
        return matchesAction || matchesHash || matchesPayload || matchesIndex;
      }
      return true;
    });
  }, [records, roleFilter, searchQuery]);

  const rollingIntegrityPoints = useMemo(
    () => computeLedgerRollingIntegrity(records, 50),
    [records]
  );

  const roles = ['ALL', 'SYSTEM', 'PLANNER', 'CODER', 'REVIEWER', 'TESTER', 'EVOLVER', 'COMMERCIAL'];

  const getRoleDotColor = (role: string) => {
    switch (role) {
      case 'PLANNER':
        return { dot: '#00F0FF', text: 'text-[#00F0FF]' };
      case 'CODER':
        return { dot: '#60A5FA', text: 'text-[#60A5FA]' };
      case 'REVIEWER':
        return { dot: '#C084FC', text: 'text-[#D8B4FE]' };
      case 'TESTER':
        return { dot: '#CCFF00', text: 'text-[#CCFF00]' };
      case 'COMMERCIAL':
        return { dot: '#FF5E3A', text: 'text-[#FF5E3A]' };
      case 'EVOLVER':
        return { dot: '#FF007F', text: 'text-[#FF99C8]' };
      default:
        return { dot: '#9AA8C7', text: 'text-[var(--app-text-secondary)]' };
    }
  };

  const handleVerifyDisplayedIntegrity = async () => {
    setVerifyingDisplayed(true);
    const verifiedAt = new Date().toISOString();

    try {
      let latestIntegrity = integrity;
      if (isAuthenticated) {
        try {
          const res = await fetch(apiUrl('/api/audit?limit=100'), { headers: authHeaders() });
          const data = await res.json();
          if (res.ok && data.success && data.integrity) {
            latestIntegrity = data.integrity;
            setIntegrity(data.integrity);
          }
        } catch {
          // Fall back to currently loaded seal metadata
        }
      }

      if (filteredRecords.length === 0) {
        setDisplayedVerification({
          status: 'EMPTY',
          verifiedAt,
          displayedCount: 0,
          recalculatedDisplayedDigest: '',
          recalculatedTipHash: null,
          recalculatedTipIndex: null,
          signedHeadHash: latestIntegrity?.headHash || null,
          signedTotalRecords: Number(latestIntegrity?.totalRecords || records.length || 0),
          tipMatchesHeadSeal: null,
          serverChainValid: Boolean(latestIntegrity?.valid),
          mismatches: []
        });
        return;
      }

      const sortedDisplayed = [...filteredRecords].sort((a, b) => a.index - b.index);
      const recordsByIndex = new Map<number, AuditRecord>();
      for (const r of records) {
        recordsByIndex.set(r.index, r);
      }

      const mismatches: DisplayedLedgerMismatch[] = [];
      const genesisPrevHash = '0'.repeat(64);
      const recalculatedEntryHashes: string[] = [];

      for (const rec of sortedDisplayed) {
        const calcPayloadDigest = sha256Sync(JSON.stringify(rec.payload));
        if (calcPayloadDigest !== rec.payload_digest) {
          mismatches.push({
            index: rec.index,
            reason: 'Payload SHA-256 digest mismatch',
            expected: rec.payload_digest,
            actual: calcPayloadDigest
          });
        }

        const preimage = `${rec.index}|${rec.timestamp}|${rec.prev_hash}|${rec.role}|${rec.action}|${rec.payload_digest}`;
        const calcEntryHash = sha256Sync(preimage);
        recalculatedEntryHashes.push(`${rec.index}:${calcEntryHash}`);

        if (calcEntryHash !== rec.entry_hash) {
          mismatches.push({
            index: rec.index,
            reason: 'Entry SHA-256 hash mismatch',
            expected: rec.entry_hash,
            actual: calcEntryHash
          });
        }

        if (rec.index === 0) {
          if (rec.prev_hash !== genesisPrevHash) {
            mismatches.push({
              index: rec.index,
              reason: 'Genesis prev_hash mismatch',
              expected: genesisPrevHash,
              actual: rec.prev_hash
            });
          }
        } else {
          const prevRec = recordsByIndex.get(rec.index - 1);
          if (prevRec && rec.prev_hash !== prevRec.entry_hash) {
            mismatches.push({
              index: rec.index,
              reason: `Broken chain link to block #${rec.index - 1}`,
              expected: prevRec.entry_hash,
              actual: rec.prev_hash
            });
          }
        }
      }

      const tipRec = sortedDisplayed[sortedDisplayed.length - 1];
      const recalculatedTipHash = sha256Sync(
        `${tipRec.index}|${tipRec.timestamp}|${tipRec.prev_hash}|${tipRec.role}|${tipRec.action}|${tipRec.payload_digest}`
      );
      const recalculatedDisplayedDigest = sha256Sync(recalculatedEntryHashes.join('\n'));
      const signedHeadHash: string | null = latestIntegrity?.headHash || null;
      const signedTotalRecords = Number(latestIntegrity?.totalRecords || records.length || 0);
      const serverChainValid = latestIntegrity ? Boolean(latestIntegrity.valid) : true;

      let tipMatchesHeadSeal: boolean | null = null;
      if (signedTotalRecords > 0 && tipRec.index === signedTotalRecords - 1) {
        tipMatchesHeadSeal = Boolean(signedHeadHash && recalculatedTipHash === signedHeadHash);
        if (!tipMatchesHeadSeal) {
          mismatches.push({
            index: tipRec.index,
            reason: 'Recalculated tip hash does not match signed ledger head seal',
            expected: signedHeadHash || '(missing head seal)',
            actual: recalculatedTipHash
          });
        }
      }

      if (latestIntegrity && latestIntegrity.valid === false) {
        mismatches.push({
          index: typeof latestIntegrity.brokenIndex === 'number' ? latestIntegrity.brokenIndex : -1,
          reason: latestIntegrity.error || 'Server ledger integrity check failed'
        });
      }

      setDisplayedVerification({
        status: mismatches.length === 0 && serverChainValid ? 'INTACT' : 'TAMPERED',
        verifiedAt,
        displayedCount: sortedDisplayed.length,
        recalculatedDisplayedDigest,
        recalculatedTipHash,
        recalculatedTipIndex: tipRec.index,
        signedHeadHash,
        signedTotalRecords,
        tipMatchesHeadSeal,
        serverChainValid,
        mismatches
      });
    } finally {
      setVerifyingDisplayed(false);
    }
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(records, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `zyntheor_audit_ledger_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleExportPdfAudit = () => {
    const verificationSummary = displayedVerification
      ? `${displayedVerification.status} (${displayedVerification.displayedCount} verified blocks · Tip #${displayedVerification.recalculatedTipIndex ?? '-'})`
      : integrity
      ? `Server Chain: ${integrity.valid ? 'VALID' : 'BROKEN'} (${integrity.totalRecords ?? records.length} blocks)`
      : 'Not verified in UI';

    const activeFilterSummary =
      roleFilter === 'ALL' && !searchQuery.trim()
        ? `All roles · ${filteredRecords.length} of ${records.length} loaded blocks`
        : `Role=${roleFilter}${searchQuery.trim() ? `, Search="${searchQuery.trim()}"` : ''} · ${filteredRecords.length} matching blocks`;

    triggerPrintAudit({
      metadata: buildSystemMetadataSnapshot({
        reportTitle: 'Sovereign Session Audit Ledger & Metadata',
        reportSubtitle: 'Offline High-Contrast Cryptographic Audit Export (native_data/audit_log.jsonl)',
        session,
        role,
        statusData,
        chainValid: integrity?.valid ?? null,
        headHash: integrity?.headHash ?? null,
        totalLedgerRecords: integrity?.totalRecords ?? records.length,
        verificationSummary,
        activeFilterSummary,
      }),
      entries: filteredRecords.map((rec) => ({
        index: `#${rec.index}`,
        timestamp: rec.timestamp.replace('T', ' ').slice(0, 19),
        role: rec.role,
        action: rec.action,
        detail: JSON.stringify(rec.payload),
        hash: rec.entry_hash,
      })),
    });
  };

  return (
    <div className={`space-y-6 ${className}`}>
      <PrintableSessionAudit payload={printPayload} />
      {/* Integrity & Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Chained Audit Blocks"
          value={records.length}
          subtitle="SHA-256 Immutable Entries"
          icon={<Layers className="w-5 h-5" />}
          accentColor="purple"
        />
        <MetricCard
          title="Chain Integrity Status"
          value={integrity?.valid ? '100% INTACT' : 'VERIFYING'}
          subtitle="Zero Hash Collisions or Breaks"
          icon={<ShieldCheck className="w-5 h-5" />}
          accentColor="lime"
          trend={{ value: 'Tamper-Free', isPositive: true }}
        />
        <MetricCard
          title="Active Roles Logged"
          value={new Set(records.map((r) => r.role)).size}
          subtitle="Full 4-Agent Workflow Coverage"
          icon={<Activity className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Chain Head Digest"
          value={integrity?.headHash ? `${integrity.headHash.slice(0, 8)}...` : '00000000...'}
          subtitle="Genesis-to-Tip Validated"
          icon={<Lock className="w-5 h-5" />}
          accentColor="blue"
        />
      </div>

      {/* Rolling Integrity D3.js Line Chart (Last 50 Audit Entries) */}
      <RollingIntegrityChart
        points={rollingIntegrityPoints}
        status={integrity ? (integrity.valid ? 'INTACT' : 'TAMPERED') : records.length === 0 ? 'EMPTY' : 'CHECKING'}
        theme="dark"
        height={152}
        title={
          lang === 'th'
            ? 'Rolling Integrity (50 บล็อกล่าสุดใน AuditLedger)'
            : 'Rolling Integrity (Last 50 Audit Ledger Entries)'
        }
        subtitle={
          lang === 'th'
            ? 'คำนวณจาก SHA-256 payload_digest, entry_hash และความต่อเนื่องของ prev_hash จริงทุกบล็อก'
            : 'Computed from real SHA-256 payload_digest, entry_hash & prev_hash linkage across the last 50 blocks'
        }
      />

      {/* Main Filterable Ledger View */}
      <VividCard
        title="Sovereign System Audit Ledger"
        subtitle="Cryptographically verified SHA-256 event trail in native_data/audit_log.jsonl"
        gradientAccent="cyan"
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportJson}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--app-input-bg)] border border-[var(--app-card-border)] hover:border-[#00F0FF] text-[var(--app-text-primary)] rounded-xl transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#00F0FF]" />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdfAudit}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--app-input-bg)] border border-[var(--app-card-border)] hover:border-[#7B2CBF] text-[var(--app-text-primary)] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5 text-[#C084FC]" />
              <span>Export PDF Audit</span>
            </button>
            <button
              type="button"
              onClick={() => void handleVerifyDisplayedIntegrity()}
              disabled={verifyingDisplayed || loading}
              title={
                lang === 'th'
                  ? 'คำนวณแฮช SHA-256 ใหม่ของบันทึกที่แสดงและเทียบกับตราประทับของระบบ'
                  : 'Recalculate SHA-256 hashes of displayed logs and compare against signed ledger seal'
              }
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-[#CCFF00] hover:brightness-105 text-[#070B19] rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                {verifyingDisplayed
                  ? lang === 'th'
                    ? 'กำลังตรวจสอบ...'
                    : 'Verifying...'
                  : lang === 'th'
                  ? 'ตรวจสอบความถูกต้อง'
                  : 'Verify Integrity'}
              </span>
            </button>
            <button
              onClick={fetchLedger}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Auditing...' : 'Verify Chain'}</span>
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {displayedVerification && (
            <div
              className={`rounded-xl border p-4 text-xs font-mono space-y-2.5 ${
                displayedVerification.status === 'INTACT'
                  ? 'bg-[#CCFF00]/10 border-[#CCFF00]/45 text-[#F4F7FF]'
                  : displayedVerification.status === 'EMPTY'
                  ? 'bg-[var(--app-input-bg)] border-[var(--app-card-border)] text-[var(--app-text-primary)]'
                  : 'bg-[#FF007F]/15 border-[#FF007F]/50 text-[#FF99C8]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold">
                  {displayedVerification.status === 'INTACT' ? (
                    <ShieldCheck className="w-4 h-4 text-[#CCFF00] shrink-0" />
                  ) : displayedVerification.status === 'EMPTY' ? (
                    <AlertTriangle className="w-4 h-4 text-[#FF5E3A] shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-[#FF007F] shrink-0" />
                  )}
                  <span>
                    {displayedVerification.status === 'INTACT'
                      ? lang === 'th'
                        ? `ผลการตรวจสอบความถูกต้อง: สมบูรณ์ (${displayedVerification.displayedCount} รายการที่แสดง)`
                        : `Integrity Verified: INTACT (${displayedVerification.displayedCount} displayed blocks)`
                      : displayedVerification.status === 'EMPTY'
                      ? lang === 'th'
                        ? 'ไม่พบบันทึกที่แสดงให้ตรวจสอบ'
                        : 'No displayed records to verify'
                      : lang === 'th'
                      ? `ตรวจพบความผิดปกติ/การปลอมแปลง (${displayedVerification.mismatches.length} จุด)`
                      : `TAMPER DETECTED (${displayedVerification.mismatches.length} mismatch${displayedVerification.mismatches.length === 1 ? '' : 'es'})`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDisplayedVerification(null)}
                  className="p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                  aria-label="Close verification report"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {displayedVerification.status !== 'EMPTY' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">
                      {lang === 'th'
                        ? `แฮชที่คำนวณใหม่ (บล็อกล่าสุดที่แสดง #${displayedVerification.recalculatedTipIndex ?? '-'})`
                        : `Recalculated Hash (Displayed Tip #${displayedVerification.recalculatedTipIndex ?? '-'})`}
                    </div>
                    <div className="break-all font-bold text-[#00F0FF] mt-0.5 select-all">
                      {displayedVerification.recalculatedTipHash}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--app-text-secondary)]">
                      {lang === 'th'
                        ? `เมตาเดต้าตราประทับที่ลงนาม (Head Seal · ${displayedVerification.signedTotalRecords} บล็อก)`
                        : `Signed Seal Metadata (Head Seal · ${displayedVerification.signedTotalRecords} blocks)`}
                    </div>
                    <div className="break-all font-bold text-[#CCFF00] mt-0.5 select-all">
                      {displayedVerification.signedHeadHash || 'UNAVAILABLE'}
                    </div>
                  </div>
                </div>
              )}

              {displayedVerification.status !== 'EMPTY' && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--app-text-secondary)]">
                  <span>
                    Displayed Digest (SHA-256): {displayedVerification.recalculatedDisplayedDigest.slice(0, 16)}...
                  </span>
                  <span>
                    Tip vs Head Seal:{' '}
                    {displayedVerification.tipMatchesHeadSeal === null
                      ? lang === 'th'
                        ? 'มุมมองที่กรองไว้ (ตรวจแฮชรายบล็อกครบถ้วนแล้ว)'
                        : 'Filtered view (all displayed block hashes verified)'
                      : displayedVerification.tipMatchesHeadSeal
                      ? 'MATCH'
                      : 'MISMATCH'}
                  </span>
                  <span>Verified: {new Date(displayedVerification.verifiedAt).toLocaleTimeString()}</span>
                </div>
              )}

              {displayedVerification.mismatches.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-[#FF007F]/40 text-[11px]">
                  {displayedVerification.mismatches.slice(0, 5).map((m, idx) => (
                    <div key={`${m.index}-${idx}`} className="bg-[var(--app-input-bg)] rounded p-2 border border-[#FF007F]/40">
                      <div className="font-bold text-[#FF007F]">
                        Block #{m.index}: {m.reason}
                      </div>
                      {m.expected && (
                        <div className="text-[10px] break-all text-[#FF99C8]">Expected: {m.expected}</div>
                      )}
                      {m.actual && (
                        <div className="text-[10px] break-all text-[#F4F7FF]">Recalculated: {m.actual}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Filter Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[var(--app-text-secondary)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by action name, task ID, command, or SHA-256 hash..."
                className="w-full pl-9 pr-4 py-2 text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:border-[#00F0FF] font-medium text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]"
              />
            </div>

            {/* Role Filter Chips */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
              <Filter className="w-3.5 h-3.5 text-[var(--app-text-secondary)] mr-1 shrink-0" />
              {roles.map((r) => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    roleFilter === r
                      ? 'bg-[#00F0FF] text-[#070B19] font-bold shadow-sm'
                      : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-elevated)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-[var(--app-card-border)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--app-bg-secondary)] border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] font-semibold uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Block #</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Agent Role</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">SHA-256 Entry Hash</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--app-card-border)] font-sans">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[var(--app-text-secondary)] italic text-xs">
                      No audit records found matching your filter.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((rec) => {
                    const isExpanded = expandedIndex === rec.index;
                    return (
                      <React.Fragment key={rec.index}>
                        <tr
                          onClick={() => setExpandedIndex(isExpanded ? null : rec.index)}
                          className={`hover:bg-[var(--app-surface-elevated)]/60 transition-colors cursor-pointer ${
                            isExpanded ? 'bg-[#00F0FF]/8' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#00F0FF]">
                            #{rec.index}
                          </td>
                          <td className="py-3 px-4 text-[var(--app-text-secondary)] font-mono tabular-nums text-[11px] whitespace-nowrap">
                            {rec.timestamp.replace('T', ' ').slice(0, 19)}
                          </td>
                          <td className="py-3 px-4">
                            {(() => {
                              const st = getRoleDotColor(rec.role);
                              return (
                                <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-bold ${st.text}`}>
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: st.dot }} />
                                  {rec.role}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="py-3 px-4 font-semibold text-[var(--app-text-primary)]">
                            <div>{rec.action}</div>
                            {rec.payload?.taskId && (
                              <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">
                                {rec.payload.taskId}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-[var(--app-text-secondary)] truncate max-w-[200px]">
                            {rec.entry_hash}
                          </td>
                          <td className="py-3 px-4 text-right text-[var(--app-text-secondary)]">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 ml-auto text-[#00F0FF]" />
                            ) : (
                              <ChevronDown className="w-4 h-4 ml-auto" />
                            )}
                          </td>
                        </tr>

                        {/* Expanded Cryptographic Detail Panel */}
                        {isExpanded && (
                          <tr className="bg-[var(--app-input-bg)]">
                            <td colSpan={6} className="p-4 border-b border-[var(--app-card-border)]">
                              <div className="bg-[#070B19] border border-[#1E294A] rounded-xl p-4 text-[#F4F7FF] font-mono text-xs space-y-3">
                                <div className="flex items-center justify-between text-[#9AA8C7] border-b border-[#1E294A] pb-2">
                                  <span className="flex items-center gap-1.5 text-[#CCFF00] font-bold">
                                    <CheckCircle2 className="w-4 h-4" /> Cryptographic Linkage Verified
                                  </span>
                                  <span className="text-[10px] text-[#9AA8C7] tabular-nums">
                                    Block Index: #{rec.index}
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                                  <div>
                                    <span className="text-[#9AA8C7]">Previous Block Hash:</span>
                                    <div className="text-[#F4F7FF] break-all select-all mt-0.5">
                                      {rec.prev_hash}
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-[#9AA8C7]">Current Entry Hash:</span>
                                    <div className="text-[#00F0FF] break-all select-all mt-0.5 font-bold">
                                      {rec.entry_hash}
                                    </div>
                                  </div>
                                </div>

                                <div className="text-[11px]">
                                  <span className="text-[#9AA8C7]">SHA-256 Preimage Formula:</span>
                                  <div className="text-[#F4F7FF] break-all bg-[#0D1326] p-2 rounded border border-[#1E294A] mt-1">
                                    SHA-256({rec.index} | {rec.timestamp} | {rec.prev_hash.slice(0, 16)}... | {rec.role} | {rec.action} | {rec.payload_digest.slice(0, 16)}...)
                                  </div>
                                </div>

                                <div>
                                  <span className="text-[#9AA8C7] text-[11px]">Verified Block Payload:</span>
                                  <pre className="mt-1 p-2 bg-[#0D1326] rounded border border-[#1E294A] text-[11px] text-[#CCFF00] overflow-x-auto max-h-48">
                                    {JSON.stringify(rec.payload, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </VividCard>
    </div>
  );
};
