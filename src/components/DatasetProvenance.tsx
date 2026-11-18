import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { VividCard } from './ui/VividCard';
import { StatusBadge } from './ui/StatusBadge';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileCode2,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';

export type ProvenanceBucket = 'APPROVED' | 'BLOCKED' | 'NEEDS_REVIEW';

export interface DatasetProvenanceEntry {
  document_id: string;
  kind?: string;
  split?: string;
  chars?: number;
  sha256?: string;
  declared_source?: string;
  declared_license?: string;
  declared_hash?: string;
  source_file_present?: boolean;
  actual_file_sha256?: string | null;
  source?: {
    url?: string | null;
    local_path?: string | null;
    publisher?: string | null;
  };
  license?: {
    id?: string | null;
    url?: string | null;
  };
  rights?: {
    basis?: string | null;
    scope?: string[];
  };
  provenance_schema?: string | null;
  admission_bucket?: ProvenanceBucket;
  status?: string;
  issues?: string[];
}

export interface DatasetGovernanceAuditResponse {
  success: boolean;
  schemaVersion: string;
  auditStatus: string;
  trainingAdmissionAllowed: boolean;
  auditFilePath: string;
  generatedAt: string;
  totalInspectedDocuments: number;
  sourceDatasetsCount: number;
  excludedByCorpusFilterCount: number;
  bucketCounts: {
    APPROVED: number;
    BLOCKED: number;
    NEEDS_REVIEW: number;
  };
  buckets: {
    APPROVED: DatasetProvenanceEntry[];
    BLOCKED: DatasetProvenanceEntry[];
    NEEDS_REVIEW: DatasetProvenanceEntry[];
  };
  blockingReasons: string[];
  localDatasetFiles: Array<{
    path: string;
    exists: boolean;
    bytes: number;
    sha256: string | null;
    approved_for_training: boolean;
    reason: string;
  }>;
  workspaceSummary?: {
    documents?: number;
    train_docs?: number;
    val_docs?: number;
    train_chars?: number;
    val_chars?: number;
    thai_chars?: number;
    excluded?: number;
  } | null;
}

export const DatasetProvenance: React.FC = () => {
  const { lang } = useLanguage();
  const { authHeaders, authReady, isAuthenticated, role } = useAuth();
  const [audit, setAudit] = useState<DatasetGovernanceAuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedBucket, setSelectedBucket] = useState<ProvenanceBucket | 'ALL'>('BLOCKED');
  const [searchQuery, setSearchQuery] = useState('');
  const [splitFilter, setSplitFilter] = useState<'ALL' | 'train' | 'validation' | 'test' | 'unknown'>('ALL');
  const [pageLimit, setPageLimit] = useState(50);

  const isDevOrAdmin = role === 'Developer' || role === 'Administrator';

  const fetchAudit = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/knowledge/dataset-provenance-audit', {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error || `Audit HTTP ${res.status}`);
      }
      setAudit(json as DatasetGovernanceAuditResponse);
      const counts = json.bucketCounts || { APPROVED: 0, NEEDS_REVIEW: 0, BLOCKED: 0 };
      if (counts.APPROVED > 0) setSelectedBucket('APPROVED');
      else if (counts.NEEDS_REVIEW > 0) setSelectedBucket('NEEDS_REVIEW');
      else setSelectedBucket('BLOCKED');
    } catch (err: any) {
      setError(err?.message || 'Failed to load dataset governance audit manifest.');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, isAuthenticated]);

  const handleRerunAudit = async () => {
    if (!isAuthenticated || !isDevOrAdmin || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/knowledge/dataset-provenance-audit/refresh', {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error || `Audit refresh HTTP ${res.status}`);
      }
      setAudit(json as DatasetGovernanceAuditResponse);
    } catch (err: any) {
      setError(err?.message || 'Failed to re-run dataset admission audit.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      void fetchAudit();
    }
  }, [authReady, isAuthenticated, fetchAudit]);

  const allCategorizedEntries = useMemo(() => {
    if (!audit) return [];
    const tag = (items: DatasetProvenanceEntry[], bucket: ProvenanceBucket) =>
      items.map((item) => ({ ...item, admission_bucket: item.admission_bucket || bucket }));

    if (selectedBucket === 'APPROVED') return tag(audit.buckets.APPROVED, 'APPROVED');
    if (selectedBucket === 'NEEDS_REVIEW') return tag(audit.buckets.NEEDS_REVIEW, 'NEEDS_REVIEW');
    if (selectedBucket === 'BLOCKED') return tag(audit.buckets.BLOCKED, 'BLOCKED');
    return [
      ...tag(audit.buckets.APPROVED, 'APPROVED'),
      ...tag(audit.buckets.NEEDS_REVIEW, 'NEEDS_REVIEW'),
      ...tag(audit.buckets.BLOCKED, 'BLOCKED'),
    ];
  }, [audit, selectedBucket]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allCategorizedEntries.filter((entry) => {
      const entrySplit = entry.split || 'unknown';
      if (splitFilter !== 'ALL' && entrySplit !== splitFilter) return false;
      if (!q) return true;
      const hay = [
        entry.document_id,
        entry.kind,
        entry.split,
        entry.sha256,
        entry.declared_source,
        entry.source?.local_path,
        entry.license?.id,
        ...(entry.issues || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [allCategorizedEntries, searchQuery, splitFilter]);

  const visibleEntries = filteredEntries.slice(0, pageLimit);

  return (
    <div className="space-y-6" data-testid="dataset-provenance-manifest">
      <VividCard
        title={lang === 'th' ? 'บัญชีตรวจสอบแหล่งที่มาชุดข้อมูล (Dataset Provenance Manifest)' : 'Dataset Provenance & Governance Manifest'}
        subtitle={
          lang === 'th'
            ? 'จำแนกสถานะชุดข้อมูล 244 รายการเป็น APPROVED, BLOCKED และ NEEDS_REVIEW จากไฟล์ JSON Audit ในเครื่อง'
            : 'Structured provenance manifest categorizing all 244 source datasets (and inspected corpus artifacts) into APPROVED, BLOCKED, or NEEDS_REVIEW from artifacts/dataset-governance-audit.json.'
        }
        gradientAccent="cyan"
        headerAction={
          <div className="flex items-center gap-2">
            {audit && (
              <StatusBadge
                status={
                  audit.trainingAdmissionAllowed
                    ? 'VERIFIED'
                    : audit.bucketCounts.NEEDS_REVIEW > 0
                      ? 'PARTIAL'
                      : 'BLOCKED'
                }
              />
            )}
            <button
              type="button"
              onClick={() => void fetchAudit()}
              disabled={loading || !isAuthenticated}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Reload JSON</span>
            </button>
            {isDevOrAdmin && (
              <button
                type="button"
                onClick={() => void handleRerunAudit()}
                disabled={refreshing}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-slate-950 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{refreshing ? 'Auditing…' : 'Re-run Python Audit'}</span>
              </button>
            )}
          </div>
        }
      >
        {!isAuthenticated ? (
          <div className="p-4 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs text-[var(--app-text-secondary)]">
            Sign in to inspect the local dataset governance audit manifest.
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] border border-[var(--z-danger)] text-xs font-mono text-[var(--z-danger)]">
            {error}
          </div>
        ) : loading && !audit ? (
          <div className="p-6 text-center text-xs text-[var(--app-text-secondary)] font-mono">
            Loading artifacts/dataset-governance-audit.json…
          </div>
        ) : audit ? (
          <div className="space-y-5">
            {/* Summary Bucket Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedBucket('APPROVED');
                  setPageLimit(50);
                }}
                className={`text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                  selectedBucket === 'APPROVED'
                    ? 'border-[var(--z-ok)] bg-[color-mix(in_srgb,var(--z-ok)_10%,var(--app-surface-elevated))]'
                    : 'border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--z-ok)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--z-ok)]">
                    APPROVED
                  </span>
                  <CheckCircle2 className="w-4 h-4 text-[var(--z-ok)]" />
                </div>
                <div className="mt-2 text-2xl font-mono font-extrabold text-[var(--app-text-primary)]">
                  {audit.bucketCounts.APPROVED}
                </div>
                <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                  Signed HMAC + HTTPS provenance + split verified
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedBucket('NEEDS_REVIEW');
                  setPageLimit(50);
                }}
                className={`text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                  selectedBucket === 'NEEDS_REVIEW'
                    ? 'border-[var(--z-warn)] bg-[color-mix(in_srgb,var(--z-warn)_10%,var(--app-surface-elevated))]'
                    : 'border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--z-warn)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--z-warn)]">
                    NEEDS_REVIEW
                  </span>
                  <ShieldAlert className="w-4 h-4 text-[var(--z-warn)]" />
                </div>
                <div className="mt-2 text-2xl font-mono font-extrabold text-[var(--app-text-primary)]">
                  {audit.bucketCounts.NEEDS_REVIEW}
                </div>
                <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                  Evidence bundle present · awaiting human signature
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedBucket('BLOCKED');
                  setPageLimit(50);
                }}
                className={`text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                  selectedBucket === 'BLOCKED'
                    ? 'border-[var(--z-danger)] bg-[color-mix(in_srgb,var(--z-danger)_10%,var(--app-surface-elevated))]'
                    : 'border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--z-danger)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--z-danger)]">
                    BLOCKED
                  </span>
                  <ShieldX className="w-4 h-4 text-[var(--z-danger)]" />
                </div>
                <div className="mt-2 text-2xl font-mono font-extrabold text-[var(--app-text-primary)]">
                  {audit.bucketCounts.BLOCKED}
                </div>
                <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                  Missing provenance manifest, license, or test split
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedBucket('ALL');
                  setPageLimit(50);
                }}
                className={`text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                  selectedBucket === 'ALL'
                    ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,var(--app-surface-elevated))]'
                    : 'border-[var(--app-card-border)] bg-[var(--app-surface)] hover:border-[var(--app-accent)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--app-accent)]">
                    SOURCE DATASETS
                  </span>
                  <Database className="w-4 h-4 text-[var(--app-accent)]" />
                </div>
                <div className="mt-2 text-2xl font-mono font-extrabold text-[var(--app-text-primary)]">
                  {audit.sourceDatasetsCount}
                </div>
                <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                  {audit.totalInspectedDocuments} total inspected · {audit.excludedByCorpusFilterCount} excluded
                </div>
              </button>
            </div>

            {/* Audit File Metadata & Blocking Reasons */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] space-y-2">
                <div className="font-bold text-[var(--app-text-primary)] flex items-center justify-between">
                  <span>Audit Source & Corpus Breakdown</span>
                  <span className="font-mono text-[10px] text-[var(--app-accent)]">{audit.schemaVersion}</span>
                </div>
                <div className="font-mono text-[11px] text-[var(--app-text-secondary)] space-y-1">
                  <div>
                    File: <span className="text-[var(--app-text-primary)]">{audit.auditFilePath}</span>
                  </div>
                  <div>
                    Training Admission:{' '}
                    <span className={audit.trainingAdmissionAllowed ? 'text-[var(--z-ok)] font-bold' : 'text-[var(--z-danger)] font-bold'}>
                      {audit.trainingAdmissionAllowed ? 'ALLOWED' : 'BLOCKED (FAIL-CLOSED)'}
                    </span>
                  </div>
                  {audit.workspaceSummary && (
                    <div>
                      Splits: train={audit.workspaceSummary.train_docs ?? 0} · val={audit.workspaceSummary.val_docs ?? 0} · test=0 (missing)
                    </div>
                  )}
                  <div>Updated: {new Date(audit.generatedAt).toLocaleString()}</div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] space-y-2">
                <div className="font-bold text-[var(--app-text-primary)] flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-[var(--z-warn)]" />
                  <span>Active Governance Blocking Reasons ({audit.blockingReasons.length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {audit.blockingReasons.map((reason) => (
                    <span
                      key={reason}
                      className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] text-[var(--z-danger)] border border-[color-mix(in_srgb,var(--z-danger)_35%,transparent)]"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
              <div className="flex flex-1 items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[var(--app-text-secondary)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPageLimit(50);
                    }}
                    placeholder="Filter by dataset path, SHA-256, license, or issue…"
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-[var(--app-text-secondary)]" />
                  <select
                    value={splitFilter}
                    onChange={(e) => setSplitFilter(e.target.value as any)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)]"
                  >
                    <option value="ALL">All Splits</option>
                    <option value="train">train</option>
                    <option value="validation">validation</option>
                    <option value="test">test</option>
                    <option value="unknown">unspecified</option>
                  </select>
                </div>
              </div>
              <div className="text-[11px] font-mono text-[var(--app-text-secondary)] shrink-0">
                Showing {visibleEntries.length} of {filteredEntries.length} in{' '}
                <span className="font-bold text-[var(--app-text-primary)]">{selectedBucket}</span>
              </div>
            </div>

            {/* Structured Manifest Table */}
            {filteredEntries.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-xs text-[var(--app-text-secondary)]">
                No datasets in category <span className="font-mono font-bold">{selectedBucket}</span> matching the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--app-card-border)]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] border-b border-[var(--app-card-border)]">
                    <tr>
                      <th className="p-3">Dataset / Document ID</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Split / Kind</th>
                      <th className="p-3">Chars</th>
                      <th className="p-3">SHA-256 Digest</th>
                      <th className="p-3">Source & License</th>
                      <th className="p-3">Governance Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--app-card-border)] bg-[var(--app-bg)]">
                    {visibleEntries.map((item, idx) => {
                      const bucket = item.admission_bucket || 'BLOCKED';
                      const sha = item.sha256 || item.actual_file_sha256 || item.declared_hash || null;
                      const badgeClass =
                        bucket === 'APPROVED'
                          ? 'text-[var(--z-ok)] border-[color-mix(in_srgb,var(--z-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)]'
                          : bucket === 'NEEDS_REVIEW'
                            ? 'text-[var(--z-warn)] border-[color-mix(in_srgb,var(--z-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-warn)_12%,transparent)]'
                            : 'text-[var(--z-danger)] border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)]';

                      return (
                        <tr key={`${item.document_id}-${idx}`} className="hover:bg-[var(--app-surface)] transition-colors align-top">
                          <td className="p-3 font-semibold text-[var(--app-text-primary)] max-w-[240px] break-all">
                            <div className="flex items-start gap-1.5">
                              <FileCode2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--app-accent)]" />
                              <span>{item.document_id}</span>
                            </div>
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeClass}`}>
                              {bucket}
                            </span>
                          </td>
                          <td className="p-3 text-[var(--app-text-secondary)] whitespace-nowrap">
                            <div>{item.split || '—'}</div>
                            <div className="text-[10px] opacity-75">{item.kind || 'manifest'}</div>
                          </td>
                          <td className="p-3 text-[var(--app-text-primary)] tabular-nums whitespace-nowrap">
                            {typeof item.chars === 'number' ? item.chars.toLocaleString() : '—'}
                          </td>
                          <td className="p-3 text-[var(--app-text-secondary)] whitespace-nowrap">
                            {sha ? `${sha.slice(0, 14)}…` : '—'}
                          </td>
                          <td className="p-3 text-[11px] text-[var(--app-text-secondary)] max-w-[200px] break-all">
                            <div>{item.source?.url || item.source?.local_path || item.declared_source || '—'}</div>
                            <div className="text-[10px] opacity-80">
                              License: {item.license?.id || item.declared_license || 'missing'}
                            </div>
                          </td>
                          <td className="p-3 max-w-[260px]">
                            <div className="flex flex-wrap gap-1">
                              {(item.issues || []).slice(0, 3).map((iss) => (
                                <span
                                  key={iss}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-[var(--app-text-secondary)] break-all"
                                >
                                  {iss}
                                </span>
                              ))}
                              {(item.issues?.length || 0) > 3 && (
                                <span className="text-[10px] text-[var(--app-text-secondary)]">
                                  +{(item.issues?.length || 0) - 3} more
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {filteredEntries.length > visibleEntries.length && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setPageLimit((n) => n + 50)}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer"
                >
                  Show 50 more ({filteredEntries.length - visibleEntries.length} remaining)
                </button>
              </div>
            )}
          </div>
        ) : null}
      </VividCard>
    </div>
  );
};
