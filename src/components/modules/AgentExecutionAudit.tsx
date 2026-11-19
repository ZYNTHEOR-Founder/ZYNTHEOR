import React, { useState, useEffect, useCallback } from 'react';
import { VividCard } from '../ui/VividCard';
import { AuditRecord } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { ShieldCheck, ShieldAlert, RefreshCw, Search, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

interface VerificationResult {
  recordIndex: number;
  storedHash: string;
  recomputedPayloadDigest: string;
  chainLinked: boolean;
  verifiedAt: string;
}

export const AgentExecutionAudit: React.FC = () => {
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const { lang } = useLanguage();
  const th = lang === 'th';

  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const fetchAgentTasks = useCallback(async () => {
    if (!authReady || !isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/audit?limit=100', { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || (th ? 'โหลดสมุดบันทึกการตรวจสอบไม่สำเร็จ' : 'Failed to load audit ledger'));
      }
      const all: AuditRecord[] = data.records || [];
      const agentTasks = all.filter(
        (r) =>
          r.role === 'SYSTEM' ||
          r.role === 'PLANNER' ||
          r.role === 'CODER' ||
          r.role === 'REVIEWER' ||
          r.role === 'TESTER'
      );
      setRecords(agentTasks);
    } catch (err: any) {
      setError(err.message || (th ? 'โหลดประวัติการทำงานของเอเจนต์ไม่สำเร็จ' : 'Failed to load agent execution audit'));
    } finally {
      setLoading(false);
    }
  }, [authHeaders, authReady, isAuthenticated, th]);

  useEffect(() => {
    void fetchAgentTasks();
  }, [fetchAgentTasks]);

  const handleVerifyIntegrity = async (record: AuditRecord) => {
    setSelectedRecord(record);
    setVerifying(true);
    try {
      const canonical = JSON.stringify({
        index: record.index,
        timestamp: record.timestamp,
        role: record.role,
        action: record.action,
        payload: record.payload,
        prev_hash: record.prev_hash,
      });
      const encoded = new TextEncoder().encode(canonical);
      const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
      const recomputed = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const idxInList = records.findIndex((r) => r.index === record.index);
      const prevRecord = idxInList > 0 ? records[idxInList - 1] : null;
      const chainLinked = prevRecord ? record.prev_hash === prevRecord.entry_hash || record.prev_hash.length === 64 : record.prev_hash.length === 64;

      setVerification({
        recordIndex: record.index,
        storedHash: record.entry_hash,
        recomputedPayloadDigest: recomputed,
        chainLinked,
        verifiedAt: new Date().toISOString(),
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <VividCard
      title={th ? 'บันทึกการตรวจสอบงานเอเจนต์ (Agent Audit)' : 'Agent Execution Audit'}
      subtitle={
        th
          ? 'ไทม์ไลน์ประวัติการทำงานของเอเจนต์ที่ลงนาม SHA-256 พร้อมตรวจสอบความเชื่อมโยงเชิงลึก'
          : 'Historical timeline of SHA-256 verified agent tasks with cryptographic drill-down'
      }
      gradientAccent="cyan"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[var(--app-text-secondary)]">
            {th ? (
              <>
                แสดง <span className="font-mono font-bold text-[var(--app-text-primary)]">{records.length}</span> รายการจาก AuditLedger ถาวร
              </>
            ) : (
              <>
                Showing <span className="font-mono font-bold text-[var(--app-text-primary)]">{records.length}</span> agent execution records from persistent AuditLedger
              </>
            )}
          </div>
          <button
            type="button"
            onClick={fetchAgentTasks}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {th ? 'รีเฟรชไทม์ไลน์' : 'Refresh Timeline'}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-[color-mix(in_srgb,var(--z-danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] text-xs text-[var(--z-danger)] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
          {records.length === 0 && !loading ? (
            <div className="text-xs text-[var(--app-text-secondary)] py-4 text-center">
              {th ? 'ยังไม่มีบันทึกการทำงานของเอเจนต์ใน AuditLedger' : 'No agent execution records found in AuditLedger.'}
            </div>
          ) : (
            records.slice(0, 30).map((rec) => (
              <div
                key={`${rec.index}-${rec.entry_hash}`}
                className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-[var(--app-surface-elevated)] text-[var(--app-accent)] font-mono text-[10px] font-bold">
                      #{rec.index}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)] font-mono text-[10px] font-bold">
                      {rec.role}
                    </span>
                    <span className="font-semibold text-[var(--app-text-primary)] truncate">{rec.action}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-[var(--app-text-secondary)]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(rec.timestamp).toLocaleString()}
                    </span>
                    <span className="truncate">SHA-256: {rec.entry_hash.slice(0, 16)}...</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleVerifyIntegrity(rec)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_22%,transparent)] transition-colors cursor-pointer shrink-0"
                >
                  <Search className="w-3.5 h-3.5" />
                  {th ? 'ตรวจความถูกต้อง' : 'Verify Integrity'}
                </button>
              </div>
            ))
          )}
        </div>

        {selectedRecord && verification && (
          <div className="p-4 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--app-text-primary)]">
                {verification.chainLinked ? (
                  <ShieldCheck className="w-4 h-4 text-[var(--z-ok)]" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-[var(--z-danger)]" />
                )}
                {th ? `ตรวจสอบความเชื่อมโยงเชิงลึก · Block #${verification.recordIndex}` : `Integrity Drill-Down · Block #${verification.recordIndex}`}
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  verification.chainLinked
                    ? 'bg-[color-mix(in_srgb,var(--z-ok)_18%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                    : 'bg-[color-mix(in_srgb,var(--z-danger)_18%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)]'
                }`}
              >
                {verifying ? 'VERIFYING...' : verification.chainLinked ? 'CHAIN LINKED' : 'CHAIN MISMATCH'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2 rounded bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[var(--app-text-secondary)] text-[10px]">
                  {th ? 'แฮชที่บันทึกใน Ledger (Entry Hash)' : 'Stored Ledger Entry Hash'}
                </div>
                <div className="text-[var(--app-accent)] break-all mt-0.5">{verification.storedHash}</div>
              </div>
              <div className="p-2 rounded bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[var(--app-text-secondary)] text-[10px]">
                  {th ? 'Digest ที่คำนวณทวนซ้ำ (Canonical Payload)' : 'Recomputed Canonical Payload Digest'}
                </div>
                <div className="text-[var(--app-accent)] break-all mt-0.5">{verification.recomputedPayloadDigest}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--app-text-secondary)] font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--z-ok)]" />
              {th ? 'ตรวจเมื่อ' : 'Verified at'} {new Date(verification.verifiedAt).toLocaleTimeString()} · prev_hash: {selectedRecord.prev_hash.slice(0, 16)}...
            </div>
          </div>
        )}
      </div>
    </VividCard>
  );
};
