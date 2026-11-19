import React, { useEffect, useState } from 'react';
import { DeploymentHistoryTimelineItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
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
  const { lang } = useLanguage();
  const th = lang === 'th';
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
        throw new Error(
          json.error || (th ? 'โหลดประวัติการ Deploy ไม่สำเร็จ' : 'Failed to load deployment history')
        );
      }
      setItems(Array.isArray(json.history) ? json.history : []);
    } catch (err: any) {
      setError(
        err?.message ||
          (th
            ? 'ไม่สามารถดึงข้อมูลจาก /api/deployment/history ได้'
            : 'Unable to retrieve /api/deployment/history')
      );
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
          <Clock className="w-4 h-4 text-[var(--app-accent)]" />
          <div>
            <div className="text-xs font-bold text-[var(--app-text-primary)]">
              {th
                ? 'ไทม์ไลน์ประวัติการ Deploy และหลักฐานการตรวจสอบ'
                : 'Deployment History Timeline & Verification Evidence'}
            </div>
            <div className="text-[10px] font-mono text-[var(--app-text-secondary)] tabular-nums">
              {th ? 'แหล่งข้อมูล' : 'Source'}: GET /api/deployment/history · {items.length}{' '}
              {th ? 'เหตุการณ์' : 'event(s)'} ·{' '}
              <span className="text-[var(--z-ok)]">{verifiedCount} VERIFIED</span> ·{' '}
              <span className="text-[var(--z-warn)]">{unverifiedCount} UNVERIFIED</span> ·{' '}
              <span className="text-[var(--z-danger)]">{blockedCount} BLOCKED</span>
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
                  ? 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)]'
                  : 'bg-[var(--app-surface)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:text-[var(--app-text-primary)]'
              }`}
            >
              {f === 'ALL' ? (th ? 'ทั้งหมด' : 'ALL') : f}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            className="px-2.5 py-1 rounded-lg text-[10px] font-mono bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] flex items-center gap-1 cursor-pointer"
            title={th ? 'สลับทิศทางการเรียงลำดับเวลา' : 'Toggle chronological sort direction'}
          >
            <ArrowDownUp className="w-3 h-3 text-[var(--app-accent)]" />
            <span>
              {order === 'desc'
                ? th
                  ? 'ใหม่ล่าสุดก่อน'
                  : 'Newest First'
                : th
                  ? 'เรียงตามลำดับเวลา'
                  : 'Chronological'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void fetchHistory()}
            disabled={loading}
            className="p-1.5 rounded-lg bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] hover:text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
            title={th ? 'รีเฟรชไทม์ไลน์การ Deploy' : 'Refresh deployment timeline'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] text-xs font-mono text-[var(--z-danger)]">
          {error}
        </div>
      )}

      {!loading && filteredItems.length === 0 ? (
        <div className="p-5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-xs font-mono text-[var(--app-text-secondary)]">
          {items.length === 0
            ? th
              ? 'ยังไม่มีเหตุการณ์การ Deploy ที่บันทึกไว้ สั่งรันเวิร์กโฟลว์ Cloud Deployment เพื่อบันทึกหลักฐานตามลำดับเวลา'
              : 'No deployment events recorded yet. Trigger a cloud deployment workflow to record chronological verification evidence.'
            : th
              ? `ไม่พบเหตุการณ์การ Deploy ที่ตรงกับตัวกรอง '${filter}'`
              : `No deployment events match filter '${filter}'.`}
        </div>
      ) : (
        <div className="rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] p-4">
          <ol className="relative border-l border-[var(--app-card-border)] ml-2 space-y-6">
            {filteredItems.map((item) => {
              const itemKey = `${item.deploymentId}_${item.executionId}`;
              const isExpanded = expandedLogsId === itemKey;
              const isHighlighted = activeDeploymentId === item.deploymentId;
              const logs = fetchedLogsMap[itemKey] || item.linkedLogs || [];

              const nodeColor =
                item.verificationState === 'VERIFIED'
                  ? 'bg-[var(--z-ok)]'
                  : item.verificationState === 'BLOCKED'
                    ? 'bg-[var(--z-danger)]'
                    : 'bg-[var(--app-amber)]';

              const evidence = item.verificationEvidence;

              return (
                <li
                  key={itemKey}
                  className={`pl-5 relative rounded-lg transition-colors ${
                    isHighlighted ? 'bg-[color-mix(in_srgb,var(--app-accent)_5%,transparent)] py-2 pr-2' : ''
                  }`}
                >
                  <span
                    className={`absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full border border-[var(--app-bg)] ${nodeColor}`}
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
                        <span className="text-[var(--app-text-primary)] font-bold tabular-nums">{item.timestamp}</span>
                        {!projectId && (
                          <span className="text-[var(--app-accent)] font-semibold">{item.projectName}</span>
                        )}
                        <span className="text-[var(--app-accent)]">{item.revisionId}</span>
                        <span className="text-[var(--app-text-secondary)]">{item.deploymentId}</span>
                      </div>

                      <div className="text-xs text-[var(--app-text-secondary)]">{item.reason}</div>

                      <div className="text-[10px] font-mono text-[var(--app-text-secondary)] tabular-nums flex flex-wrap gap-x-2 gap-y-0.5">
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
                            ? 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] border-[var(--app-accent)] text-[var(--app-accent)]'
                            : 'bg-[var(--app-surface-elevated)] border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                        }`}
                      >
                        <Terminal className="w-3 h-3" />
                        <span>
                          {th ? `บันทึก Cloud Runtime (${logs.length})` : `Cloud Runtime Logs (${logs.length})`}
                        </span>
                      </button>
                      {onViewProjectLogs && (
                        <a
                          href="#project-runtime-logs"
                          onClick={() => onViewProjectLogs(item)}
                          className="p-1.5 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-secondary)] hover:text-[var(--app-accent)]"
                          title={th ? 'ข้ามไปยังแผงบันทึก Runtime ของโปรเจกต์' : 'Jump to project runtime logs panel'}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Verification Evidence Section */}
                  <div className="mt-3 p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-[var(--app-text-secondary)]">
                      <span className="font-bold text-[var(--app-text-primary)] flex items-center gap-1.5">
                        {item.verificationState === 'VERIFIED' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                        ) : (
                          <ShieldAlert className="w-3.5 h-3.5 text-[var(--z-warn)]" />
                        )}
                        {th ? 'หลักฐานการตรวจสอบ (Verification Evidence)' : 'Verification Evidence'}
                      </span>
                      <span
                        className={`font-bold ${
                          item.verificationState === 'VERIFIED'
                            ? 'text-[var(--z-ok)]'
                            : item.verificationState === 'BLOCKED'
                              ? 'text-[var(--z-danger)]'
                              : 'text-[var(--z-warn)]'
                        }`}
                      >
                        STATE: {item.verificationState}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] font-mono">
                      {/* 1. Verified Deployment Hash */}
                      <div className="p-2.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[var(--app-text-secondary)] font-sans font-semibold flex items-center gap-1">
                            <Hash className="w-3 h-3 text-[var(--app-accent)]" />
                            {th ? 'Hash การ Deploy' : 'Deployment Hash'}
                          </span>
                          <StatusDot
                            status={evidence.deploymentHash.hashVerified ? 'VERIFIED' : 'UNVERIFIED'}
                            label={evidence.deploymentHash.hashVerified ? 'VERIFIED' : 'UNVERIFIED'}
                          />
                        </div>
                        <div className="text-[10px] text-[var(--app-text-secondary)] truncate" title={evidence.deploymentHash.evidenceHash}>
                          ev: {evidence.deploymentHash.evidenceHash}
                        </div>
                        <div
                          className="text-[10px] text-[var(--app-accent)] truncate"
                          title={evidence.deploymentHash.artifactSha256 || (th ? 'ไม่มี Hash ของแพ็กเกจ' : 'No bundle artifact hash')}
                        >
                          zip-sha256: {evidence.deploymentHash.artifactSha256 || 'NONE (UNVERIFIED)'}
                        </div>
                        <div className="text-[10px] text-[var(--app-text-secondary)] truncate">
                          bundle: {evidence.deploymentHash.artifactZip || (th ? 'ยังไม่ได้รวมแพ็กเกจ' : 'Not bundled')} · {evidence.deploymentHash.revisionId}
                        </div>
                      </div>

                      {/* 2. Cloud Runtime Response */}
                      <div className="p-2.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[var(--app-text-secondary)] font-sans font-semibold flex items-center gap-1">
                            <Server className="w-3 h-3 text-[var(--app-accent)]" />
                            {th ? 'การตอบสนอง Cloud Runtime' : 'Cloud Runtime Response'}
                          </span>
                          <StatusDot
                            status={evidence.cloudRuntimeResponse.state}
                            label={evidence.cloudRuntimeResponse.state}
                          />
                        </div>
                        <div className="text-[10px] text-[var(--app-text-primary)] tabular-nums">
                          {evidence.cloudRuntimeResponse.httpStatus !== null
                            ? `HTTP ${evidence.cloudRuntimeResponse.httpStatus}${
                                evidence.cloudRuntimeResponse.latencyMs !== null
                                  ? ` · ${evidence.cloudRuntimeResponse.latencyMs}ms`
                                  : ''
                              }`
                            : th
                              ? 'ไม่มีการตอบสนอง HTTP จริง'
                              : 'No live HTTP response'}
                        </div>
                        <div
                          className="text-[10px] text-[var(--app-text-secondary)] truncate"
                          title={evidence.cloudRuntimeResponse.responseSha256 || ''}
                        >
                          resp-sha256:{' '}
                          {evidence.cloudRuntimeResponse.responseSha256
                            ? evidence.cloudRuntimeResponse.responseSha256.slice(0, 18) + '…'
                            : 'N/A'}
                        </div>
                        <div className="text-[10px] text-[var(--app-text-secondary)] line-clamp-2 font-sans">
                          {evidence.cloudRuntimeResponse.summary}
                        </div>
                      </div>

                      {/* 3. Automated Test Results */}
                      <div className="p-2.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[var(--app-text-secondary)] font-sans font-semibold flex items-center gap-1">
                            <Activity className="w-3 h-3 text-[var(--z-ok)]" />
                            {th ? 'ผลทดสอบอัตโนมัติ' : 'Automated Test Results'}
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
                        <div className="text-[10px] text-[var(--app-text-primary)] tabular-nums">
                          {th ? 'สถานะ' : 'Status'}: {evidence.automatedTestResults.status} ({evidence.automatedTestResults.passed}/
                          {evidence.automatedTestResults.total})
                        </div>
                        <div className="text-[10px] text-[var(--app-text-secondary)] truncate">
                          {evidence.automatedTestResults.executedAt
                            ? `${th ? 'รันเมื่อ' : 'Executed'} ${evidence.automatedTestResults.executedAt}`
                            : th
                              ? 'ยังไม่ได้รันทดสอบก่อน Deploy'
                              : 'Not executed before deployment'}
                        </div>
                        <div className="text-[10px] text-[var(--app-text-secondary)] line-clamp-2 font-sans">
                          {evidence.automatedTestResults.summary}
                        </div>
                      </div>
                    </div>

                    {/* Expandable Cloud Runtime Logs Drawer */}
                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-[var(--app-card-border)] space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-mono text-[var(--app-accent)]">
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {th ? 'บันทึก Cloud Runtime' : 'Cloud Runtime Logs'} ({item.logsUrl})
                          </span>
                          {loadingLogsId === itemKey && <span>{th ? 'กำลังดึงบันทึก…' : 'Fetching logs…'}</span>}
                        </div>
                        {logs.length === 0 ? (
                          <div className="text-[10px] font-mono text-[var(--app-text-secondary)] py-1">
                            {th
                              ? `ไม่มีบันทึก Cloud Runtime ที่เชื่อมโยงกับ ${item.deploymentId}`
                              : `No cloud runtime log entries linked directly to ${item.deploymentId}.`}
                          </div>
                        ) : (
                          <div className="max-h-40 overflow-y-auto divide-y divide-[var(--app-card-border)] rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)] font-mono text-[10px]">
                            {logs.map((lg, idx) => (
                              <div key={lg.logId || idx} className="px-2.5 py-1.5 flex items-start justify-between gap-2">
                                <span className="text-[var(--app-text-secondary)] min-w-0">
                                  <span
                                    className={
                                      lg.level === 'ERROR'
                                        ? 'text-[var(--z-danger)] font-bold'
                                        : lg.level === 'WARN'
                                          ? 'text-[var(--z-warn)] font-bold'
                                          : 'text-[var(--app-accent)] font-bold'
                                    }
                                  >
                                    [{lg.level}]
                                  </span>{' '}
                                  <span className="text-[var(--app-text-secondary)]">({lg.source})</span> {lg.message}
                                </span>
                                <span className="text-[var(--app-text-secondary)] shrink-0 tabular-nums">
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
