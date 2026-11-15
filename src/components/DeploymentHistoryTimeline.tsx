import React, { useEffect, useState } from 'react';
import { DeploymentHistoryTimelineItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/apiClient';
import { StatusDot, MinimalIndicatorState } from './ui/StatusBadge';
import {
  Activity,
  ArrowDownUp,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Hash,
  RefreshCw,
  Server,
  ShieldAlert,
  Terminal,
} from 'lucide-react';

interface DeploymentHistoryTimelineProps {
  projectId?: string;
  refreshKey?: number | string;
  activeDeploymentId?: string | null;
  onViewProjectLogs?: (item: DeploymentHistoryTimelineItem) => void;
}

type VerificationFilter = 'ALL' | 'VERIFIED' | 'UNVERIFIED' | 'BLOCKED';

function statusToDot(status: DeploymentHistoryTimelineItem['status']): MinimalIndicatorState {
  switch (status) {
    case 'DEPLOYED':
      return 'VERIFIED';
    case 'PENDING_APPROVAL':
      return 'UNVERIFIED';
    case 'NOT_CONFIGURED':
      return 'NOT_CONFIGURED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'BLOCKED';
  }
}

export const DeploymentHistoryTimeline: React.FC<DeploymentHistoryTimelineProps> = ({
  projectId,
  refreshKey,
  activeDeploymentId,
  onViewProjectLogs,
}) => {
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const [items, setItems] = useState<DeploymentHistoryTimelineItem[]>([]);
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState<VerificationFilter>('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedLogsId, setExpandedLogsId] = useState<string | null>(null);
  const [fetchedLogsMap, setFetchedLogsMap] = useState<
    Record<string, DeploymentHistoryTimelineItem['linkedLogs']>
  >({});
  const [loadingLogsId, setLoadingLogsId] = useState<string | null>(null);

  const fetchHistory = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('order', order);
      if (projectId) params.set('projectId', projectId);
      const res = await fetch(apiUrl(`/api/deployment/history?${params.toString()}`), {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load deployment history');
      }
      setItems(Array.isArray(json.history) ? json.history : []);
    } catch (err: any) {
      setError(err?.message || 'Unable to retrieve /api/deployment/history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      void fetchHistory();
    }
  }, [authReady, isAuthenticated, projectId, order, refreshKey]);

  const handleToggleRuntimeLogs = async (item: DeploymentHistoryTimelineItem) => {
    onViewProjectLogs?.(item);
    const key = `${item.deploymentId}_${item.executionId}`;
    if (expandedLogsId === key) {
      setExpandedLogsId(null);
      return;
    }
    setExpandedLogsId(key);
    if (!item.logsUrl) return;
    setLoadingLogsId(key);
    try {
      const res = await fetch(apiUrl(item.logsUrl), { headers: authHeaders() });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.logs)) {
        setFetchedLogsMap((prev) => ({ ...prev, [key]: json.logs }));
      }
    } catch {
      // Fallback gracefully to item.linkedLogs if network request fails
    } finally {
      setLoadingLogsId(null);
    }
  };

  const filteredItems = items.filter((it) =>
    filter === 'ALL' ? true : it.verificationState === filter
  );

  const verifiedCount = items.filter((i) => i.verificationState === 'VERIFIED').length;
  const unverifiedCount = items.filter((i) => i.verificationState === 'UNVERIFIED').length;
  const blockedCount = items.filter((i) => i.verificationState === 'BLOCKED').length;

  return (
    <div className="space-y-3">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#00F0FF]" />
          <div>
            <div className="text-xs font-bold text-white">
              Deployment History Timeline &amp; Verification Evidence
            </div>
            <div className="text-[10px] font-mono text-[#9AA8C7] tabular-nums">
              Source: GET /api/deployment/history · {items.length} event(s) ·{' '}
              <span className="text-[#CCFF00]">{verifiedCount} VERIFIED</span> ·{' '}
              <span className="text-[#FBBF24]">{unverifiedCount} UNVERIFIED</span> ·{' '}
              <span className="text-[#FF66B2]">{blockedCount} BLOCKED</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', 'VERIFIED', 'UNVERIFIED', 'BLOCKED'] as VerificationFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border cursor-pointer transition-colors ${
                filter === f
                  ? 'bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/50'
                  : 'bg-[#0D1326] text-[#9AA8C7] border-[#1E294A] hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            className="px-2.5 py-1 rounded-lg text-[10px] font-mono bg-[#131B36] text-[#CBD5E1] border border-[#1E294A] hover:border-[#00F0FF] flex items-center gap-1 cursor-pointer"
            title="Toggle chronological sort direction"
          >
            <ArrowDownUp className="w-3 h-3 text-[#00F0FF]" />
            <span>{order === 'desc' ? 'Newest First' : 'Chronological'}</span>
          </button>
          <button
            type="button"
            onClick={() => void fetchHistory()}
            disabled={loading}
            className="p-1.5 rounded-lg bg-[#131B36] text-[#9AA8C7] border border-[#1E294A] hover:text-white cursor-pointer disabled:opacity-50"
            title="Refresh deployment timeline"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-[#FF007F]/12 border border-[#FF007F]/45 text-xs font-mono text-[#FF99C8]">
          {error}
        </div>
      )}

      {!loading && filteredItems.length === 0 ? (
        <div className="p-5 rounded-xl bg-[#0D1326] border border-[#1E294A] text-xs font-mono text-[#9AA8C7]">
          {items.length === 0
            ? 'No deployment events recorded yet. Trigger a cloud deployment workflow to record chronological verification evidence.'
            : `No deployment events match filter '${filter}'.`}
        </div>
      ) : (
        <div className="rounded-xl bg-[#0D1326] border border-[#1E294A] p-4">
          <ol className="relative border-l border-[#1E294A] ml-2 space-y-6">
            {filteredItems.map((item) => {
              const itemKey = `${item.deploymentId}_${item.executionId}`;
              const isExpanded = expandedLogsId === itemKey;
              const isHighlighted = activeDeploymentId === item.deploymentId;
              const logs = fetchedLogsMap[itemKey] || item.linkedLogs || [];

              const nodeColor =
                item.verificationState === 'VERIFIED'
                  ? 'bg-[#CCFF00]'
                  : item.verificationState === 'BLOCKED'
                    ? 'bg-[#FF007F]'
                    : 'bg-[#F59E0B]';

              const evidence = item.verificationEvidence;

              return (
                <li
                  key={itemKey}
                  className={`pl-5 relative rounded-lg transition-colors ${
                    isHighlighted ? 'bg-[#00F0FF]/5 py-2 pr-2' : ''
                  }`}
                >
                  <span
                    className={`absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full border border-[#070B19] ${nodeColor}`}
                  />

                  {/* Event Header */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono">
                        <StatusDot status={statusToDot(item.status)} label={item.status} />
                        <StatusDot
                          status={item.verificationState}
                          label={`EVIDENCE: ${item.verificationState}`}
                        />
                        <span className="text-white font-bold tabular-nums">{item.timestamp}</span>
                        {!projectId && (
                          <span className="text-[#C084FC] font-semibold">{item.projectName}</span>
                        )}
                        <span className="text-[#00F0FF]">{item.revisionId}</span>
                        <span className="text-[#9AA8C7]">{item.deploymentId}</span>
                      </div>

                      <div className="text-xs text-[#CBD5E1]">{item.reason}</div>

                      <div className="text-[10px] font-mono text-[#9AA8C7] tabular-nums flex flex-wrap gap-x-2 gap-y-0.5">
                        <span>exec:{item.executionId}</span>
                        {item.targetProvider && <span>· provider:{item.targetProvider}</span>}
                        {item.approvalRequestId && <span>· gate:{item.approvalRequestId}</span>}
                        {item.targetEndpoint && <span>· url:{item.targetEndpoint}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleToggleRuntimeLogs(item)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold border flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                          isExpanded || isHighlighted
                            ? 'bg-[#00F0FF]/15 border-[#00F0FF] text-[#00F0FF]'
                            : 'bg-[#131B36] border-[#1E294A] hover:border-[#00F0FF] text-[#CBD5E1] hover:text-white'
                        }`}
                      >
                        <Terminal className="w-3 h-3" />
                        <span>Cloud Runtime Logs ({logs.length})</span>
                      </button>
                      {onViewProjectLogs && (
                        <a
                          href="#project-runtime-logs"
                          onClick={() => onViewProjectLogs(item)}
                          className="p-1.5 rounded-lg bg-[#131B36] border border-[#1E294A] hover:border-[#00F0FF] text-[#9AA8C7] hover:text-[#00F0FF]"
                          title="Jump to project runtime logs panel"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Verification Evidence Section */}
                  <div className="mt-3 p-3 rounded-xl bg-[#070B19] border border-[#1E294A] space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-wider text-[#9AA8C7]">
                      <span className="font-bold text-[#F4F7FF] flex items-center gap-1.5">
                        {item.verificationState === 'VERIFIED' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#CCFF00]" />
                        ) : (
                          <ShieldAlert className="w-3.5 h-3.5 text-[#FF8C73]" />
                        )}
                        Verification Evidence
                      </span>
                      <span
                        className={`font-bold ${
                          item.verificationState === 'VERIFIED'
                            ? 'text-[#CCFF00]'
                            : item.verificationState === 'BLOCKED'
                              ? 'text-[#FF66B2]'
                              : 'text-[#FBBF24]'
                        }`}
                      >
                        STATE: {item.verificationState}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] font-mono">
                      {/* 1. Verified Deployment Hash */}
                      <div className="p-2.5 rounded-lg bg-[#0D1326] border border-[#1E294A] space-y-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[#CBD5E1] font-sans font-semibold flex items-center gap-1">
                            <Hash className="w-3 h-3 text-[#00F0FF]" />
                            Deployment Hash
                          </span>
                          <StatusDot
                            status={evidence.deploymentHash.hashVerified ? 'VERIFIED' : 'UNVERIFIED'}
                            label={evidence.deploymentHash.hashVerified ? 'VERIFIED' : 'UNVERIFIED'}
                          />
                        </div>
                        <div className="text-[10px] text-[#9AA8C7] truncate" title={evidence.deploymentHash.evidenceHash}>
                          ev: {evidence.deploymentHash.evidenceHash}
                        </div>
                        <div
                          className="text-[10px] text-[#00F0FF] truncate"
                          title={evidence.deploymentHash.artifactSha256 || 'No bundle artifact hash'}
                        >
                          zip-sha256: {evidence.deploymentHash.artifactSha256 || 'NONE (UNVERIFIED)'}
                        </div>
                        <div className="text-[10px] text-[#64748B] truncate">
                          bundle: {evidence.deploymentHash.artifactZip || 'Not bundled'} · {evidence.deploymentHash.revisionId}
                        </div>
                      </div>

                      {/* 2. Cloud Runtime Response */}
                      <div className="p-2.5 rounded-lg bg-[#0D1326] border border-[#1E294A] space-y-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[#CBD5E1] font-sans font-semibold flex items-center gap-1">
                            <Server className="w-3 h-3 text-[#C084FC]" />
                            Cloud Runtime Response
                          </span>
                          <StatusDot
                            status={evidence.cloudRuntimeResponse.state}
                            label={evidence.cloudRuntimeResponse.state}
                          />
                        </div>
                        <div className="text-[10px] text-[#F4F7FF] tabular-nums">
                          {evidence.cloudRuntimeResponse.httpStatus !== null
                            ? `HTTP ${evidence.cloudRuntimeResponse.httpStatus}${
                                evidence.cloudRuntimeResponse.latencyMs !== null
                                  ? ` · ${evidence.cloudRuntimeResponse.latencyMs}ms`
                                  : ''
                              }`
                            : 'No live HTTP response'}
                        </div>
                        <div
                          className="text-[10px] text-[#9AA8C7] truncate"
                          title={evidence.cloudRuntimeResponse.responseSha256 || ''}
                        >
                          resp-sha256:{' '}
                          {evidence.cloudRuntimeResponse.responseSha256
                            ? evidence.cloudRuntimeResponse.responseSha256.slice(0, 18) + '…'
                            : 'N/A'}
                        </div>
                        <div className="text-[10px] text-[#64748B] line-clamp-2 font-sans">
                          {evidence.cloudRuntimeResponse.summary}
                        </div>
                      </div>

                      {/* 3. Automated Test Results */}
                      <div className="p-2.5 rounded-lg bg-[#0D1326] border border-[#1E294A] space-y-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[#CBD5E1] font-sans font-semibold flex items-center gap-1">
                            <Activity className="w-3 h-3 text-[#CCFF00]" />
                            Automated Test Results
                          </span>
                          <StatusDot
                            status={evidence.automatedTestResults.state}
                            label={
                              evidence.automatedTestResults.total > 0
                                ? `${evidence.automatedTestResults.passed}/${evidence.automatedTestResults.total}`
                                : evidence.automatedTestResults.state
                            }
                          />
                        </div>
                        <div className="text-[10px] text-[#F4F7FF] tabular-nums">
                          Status: {evidence.automatedTestResults.status} ({evidence.automatedTestResults.passed}/
                          {evidence.automatedTestResults.total})
                        </div>
                        <div className="text-[10px] text-[#9AA8C7] truncate">
                          {evidence.automatedTestResults.executedAt
                            ? `Executed ${evidence.automatedTestResults.executedAt}`
                            : 'Not executed before deployment'}
                        </div>
                        <div className="text-[10px] text-[#64748B] line-clamp-2 font-sans">
                          {evidence.automatedTestResults.summary}
                        </div>
                      </div>
                    </div>

                    {/* Expandable Cloud Runtime Logs Drawer */}
                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-[#1E294A] space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-mono text-[#00F0FF]">
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            Cloud Runtime Logs ({item.logsUrl})
                          </span>
                          {loadingLogsId === itemKey && <span>Fetching logs…</span>}
                        </div>
                        {logs.length === 0 ? (
                          <div className="text-[10px] font-mono text-[#9AA8C7] py-1">
                            No cloud runtime log entries linked directly to {item.deploymentId}.
                          </div>
                        ) : (
                          <div className="max-h-40 overflow-y-auto divide-y divide-[#1E294A] rounded-lg bg-[#0D1326] border border-[#1E294A] font-mono text-[10px]">
                            {logs.map((lg, idx) => (
                              <div key={lg.logId || idx} className="px-2.5 py-1.5 flex items-start justify-between gap-2">
                                <span className="text-[#CBD5E1] min-w-0">
                                  <span
                                    className={
                                      lg.level === 'ERROR'
                                        ? 'text-[#FF66B2] font-bold'
                                        : lg.level === 'WARN'
                                          ? 'text-[#FF8C73] font-bold'
                                          : 'text-[#00F0FF] font-bold'
                                    }
                                  >
                                    [{lg.level}]
                                  </span>{' '}
                                  <span className="text-[#9AA8C7]">({lg.source})</span> {lg.message}
                                </span>
                                <span className="text-[#64748B] shrink-0 tabular-nums">
                                  {lg.timestamp.slice(11, 19)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
};

export default DeploymentHistoryTimeline;
