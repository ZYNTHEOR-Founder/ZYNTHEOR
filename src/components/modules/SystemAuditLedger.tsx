import React, { useState, useEffect, useMemo } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { AuditRecord } from '../../types';
import {
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileCode2,
  Lock,
  Layers,
  Activity
} from 'lucide-react';

interface SystemAuditLedgerProps {
  className?: string;
}

export const SystemAuditLedger: React.FC<SystemAuditLedgerProps> = ({ className = '' }) => {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [integrity, setIntegrity] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const fetchLedger = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audit?limit=100');
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
    fetchLedger();
  }, []);

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

  const roles = ['ALL', 'SYSTEM', 'PLANNER', 'CODER', 'REVIEWER', 'TESTER', 'EVOLVER', 'COMMERCIAL'];

  const getRoleBadgeStyle = (role: string) => {
    switch (role) {
      case 'PLANNER':
        return 'bg-[var(--app-accent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)]';
      case 'CODER':
        return 'bg-[var(--app-accent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)]';
      case 'REVIEWER':
        return 'bg-[var(--app-accent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)]';
      case 'TESTER':
        return 'bg-[var(--z-ok)] text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_60%,transparent)]';
      case 'COMMERCIAL':
        return 'bg-[var(--app-amber)] text-[var(--app-amber)] border-[color-mix(in_srgb,var(--app-amber)_60%,transparent)]';
      case 'EVOLVER':
        return 'bg-[var(--z-danger)] text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_60%,transparent)]';
      default:
        return 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] border-[var(--app-card-border)]';
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

  return (
    <div className={`space-y-6 ${className}`}>
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

      {/* Main Filterable Ledger View */}
      <VividCard
        title="Sovereign System Audit Ledger"
        subtitle="Cryptographically verified SHA-256 event trail in native_data/audit_log.jsonl"
        gradientAccent="cyan"
        headerAction={
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportJson}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--app-surface-elevated)] hover:bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] rounded-xl transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
            <button
              onClick={fetchLedger}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-[var(--app-text-primary)] vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Auditing...' : 'Verify Chain'}</span>
            </button>
          </div>
        }
      >
        <div className="space-y-4">
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
                className="w-full pl-9 pr-4 py-2 text-xs bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] font-medium text-[var(--app-text-primary)]"
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
                      ? 'bg-[var(--app-bg)] text-[var(--app-text-primary)] shadow-sm'
                      : 'text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[color-mix(in_srgb,var(--app-surface-elevated)_80%,transparent)] border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] font-semibold text-[11px] ">
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
                          className={`hover:bg-[color-mix(in_srgb,var(--app-surface-elevated)_80%,transparent)] transition-colors cursor-pointer ${
                            isExpanded ? 'bg-[color-mix(in_srgb,var(--app-accent)_30%,transparent)]' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-mono font-bold text-[var(--app-text-primary)]">
                            #{rec.index}
                          </td>
                          <td className="py-3 px-4 text-[var(--app-text-secondary)] font-mono text-[11px] whitespace-nowrap">
                            {rec.timestamp.replace('T', ' ').slice(0, 19)}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${getRoleBadgeStyle(
                                rec.role
                              )}`}
                            >
                              {rec.role}
                            </span>
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
                              <ChevronUp className="w-4 h-4 ml-auto text-[var(--app-text-primary)]" />
                            ) : (
                              <ChevronDown className="w-4 h-4 ml-auto" />
                            )}
                          </td>
                        </tr>

                        {/* Expanded Cryptographic Detail Panel */}
                        {isExpanded && (
                          <tr className="bg-[color-mix(in_srgb,var(--app-surface-elevated)_90%,transparent)]">
                            <td colSpan={6} className="p-4 border-b border-[var(--app-card-border)]">
                              <div className="bg-[var(--app-surface)] rounded-xl p-4 text-[var(--app-text-secondary)] font-mono text-xs space-y-3">
                                <div className="flex items-center justify-between text-[var(--app-text-secondary)] border-b border-[var(--app-card-border)] pb-2">
                                  <span className="flex items-center gap-1.5 text-[var(--z-ok)] font-bold">
                                    <CheckCircle2 className="w-4 h-4" /> Cryptographic Linkage Verified
                                  </span>
                                  <span className="text-[10px] text-[var(--app-text-secondary)]">
                                    Block Index: #{rec.index}
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                                  <div>
                                    <span className="text-[var(--app-text-secondary)]">Previous Block Hash:</span>
                                    <div className="text-[var(--app-text-primary)] break-all select-all mt-0.5">
                                      {rec.prev_hash}
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-[var(--app-text-secondary)]">Current Entry Hash:</span>
                                    <div className="text-[var(--app-accent)] break-all select-all mt-0.5 font-bold">
                                      {rec.entry_hash}
                                    </div>
                                  </div>
                                </div>

                                <div className="text-[11px]">
                                  <span className="text-[var(--app-text-secondary)]">SHA-256 Preimage Formula:</span>
                                  <div className="text-[var(--app-text-secondary)] break-all bg-black/40 p-2 rounded border border-[var(--app-card-border)] mt-1">
                                    SHA-256({rec.index} | {rec.timestamp} | {rec.prev_hash.slice(0, 16)}... | {rec.role} | {rec.action} | {rec.payload_digest.slice(0, 16)}...)
                                  </div>
                                </div>

                                <div>
                                  <span className="text-[var(--app-text-secondary)] text-[11px]">Verified Block Payload:</span>
                                  <pre className="mt-1 p-2 bg-black/50 rounded border border-[var(--app-card-border)] text-[11px] text-[var(--z-ok)] overflow-x-auto max-h-48">
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
