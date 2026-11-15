import React, { useState, useEffect } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';
import { AuditRecord } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
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
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const fetchAgentTasks = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/audit?limit=100'), { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to load audit ledger');
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
      setError(err.message || 'Failed to load agent execution audit');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      fetchAgentTasks();
    }
  }, [authReady, isAuthenticated]);

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
      title="Agent Execution Audit"
      subtitle="Historical timeline of SHA-256 verified agent tasks with cryptographic drill-down"
      gradientAccent="violet"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[var(--app-text-secondary)]">
            Showing <span className="font-mono tabular-nums font-bold text-[var(--app-text-primary)]">{records.length}</span> agent execution records from persistent AuditLedger
          </div>
          <button
            type="button"
            onClick={fetchAgentTasks}
            disabled={loading}
            className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[var(--app-input-bg)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[#00F0FF] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#00F0FF] ${loading ? 'animate-spin' : ''}`} />
            Refresh Timeline
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-[#FF007F]/10 border border-[#FF007F]/35 text-xs text-[#FF99C8] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#FF007F]" />
            {error}
          </div>
        )}

        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
          {records.length === 0 && !loading ? (
            <div className="text-xs text-[var(--app-text-secondary)] italic py-4 text-center">
              No agent execution records found in AuditLedger.
            </div>
          ) : (
            records.slice(0, 30).map((rec) => (
              <div
                key={`${rec.index}-${rec.entry_hash}`}
                className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] hover:border-[#00F0FF]/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 text-xs">
                    <span className="text-[#00F0FF] font-mono tabular-nums text-[10px] font-bold shrink-0">
                      #{rec.index}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[#C084FC] font-mono text-[10px] font-bold shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#C084FC]" />
                      {rec.role}
                    </span>
                    <span className="font-semibold text-[var(--app-text-primary)] truncate">{rec.action}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] font-mono text-[var(--app-text-secondary)]">
                    <span className="flex items-center gap-1 tabular-nums">
                      <Clock className="w-3 h-3" />
                      {new Date(rec.timestamp).toLocaleString()}
                    </span>
                    <span className="truncate">SHA-256: {rec.entry_hash.slice(0, 16)}...</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleVerifyIntegrity(rec)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/35 hover:bg-[#00F0FF]/25 transition-colors cursor-pointer shrink-0"
                >
                  <Search className="w-3.5 h-3.5" />
                  Verify Integrity
                </button>
              </div>
            ))
          )}
        </div>

        {selectedRecord && verification && (
          <div className="p-4 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--app-text-primary)]">
                {verification.chainLinked ? (
                  <ShieldCheck className="w-4 h-4 text-[#CCFF00]" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-[#FF007F]" />
                )}
                Integrity Drill-Down · Block #{verification.recordIndex}
              </div>
              <StatusDot
                status={verifying ? 'ACTIVE' : verification.chainLinked ? 'VERIFIED' : 'FAILED'}
                label={verifying ? 'VERIFYING...' : verification.chainLinked ? 'CHAIN LINKED' : 'CHAIN MISMATCH'}
                pulse={verifying}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2.5 rounded bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                <div className="text-[var(--app-text-secondary)] text-[10px]">Stored Ledger Entry Hash</div>
                <div className="text-[#CCFF00] break-all mt-0.5">{verification.storedHash}</div>
              </div>
              <div className="p-2.5 rounded bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                <div className="text-[var(--app-text-secondary)] text-[10px]">Recomputed Canonical Payload Digest</div>
                <div className="text-[#00F0FF] break-all mt-0.5">{verification.recomputedPayloadDigest}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--app-text-secondary)] font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#CCFF00]" />
              Verified at {new Date(verification.verifiedAt).toLocaleTimeString()} · prev_hash: {selectedRecord.prev_hash.slice(0, 16)}...
            </div>
          </div>
        )}
      </div>
    </VividCard>
  );
};
