import React, { useState } from 'react';
import { VividCard } from './ui/VividCard';
import { StatusBadge } from './ui/StatusBadge';
import { useReconnectionService } from '../hooks/useReconnectionService';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import type { StatusLevel } from '../types';
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  Cloud,
  Cpu,
  Globe,
  HardDrive,
  KeyRound,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';

interface CloudConnectivityDiagnosticsProps {
  onOpenSecrets: () => void;
}

export const CloudConnectivityDiagnostics: React.FC<CloudConnectivityDiagnosticsProps> = ({
  onOpenSecrets,
}) => {
  const { lang } = useLanguage();
  const { authHeaders } = useAuth();
  const [probeUrlInput, setProbeUrlInput] = useState('');
  const {
    apiHealthy,
    apiHttpStatus,
    apiLatencyMs,
    apiError,
    lastHealthPingAt,
    connectivity,
    cloudRuntimeProbe,
    localHealthBreakdown,
    isChecking,
    isProbingCloudRuntime,
    isReconnecting,
    autoReconnectEnabled,
    reconnectAttempts,
    nextReconnectAt,
    lastReconnectOutcome,
    recentEvents,
    checkNow,
    reconnectNow,
    setAutoReconnect,
    probeCloudRuntimeNow,
  } = useReconnectionService();

  const storageStatus: StatusLevel = connectivity.cloudStorageReachable
    ? 'VERIFIED'
    : connectivity.cloudStorageConfigured
    ? 'BLOCKED'
    : 'NOT_CONFIGURED';

  const runtimeStatus: StatusLevel =
    connectivity.online && connectivity.weightsLoaded && connectivity.executionVerified
      ? 'VERIFIED'
      : 'BLOCKED';

  const apiStatus: StatusLevel = apiHealthy ? 'VERIFIED' : 'BLOCKED';

  const probeStatus: StatusLevel = cloudRuntimeProbe?.healthy
    ? 'VERIFIED'
    : cloudRuntimeProbe?.configured
    ? 'BLOCKED'
    : 'NOT_CONFIGURED';

  const activeError =
    apiError ||
    connectivity.executionError ||
    connectivity.cloudConfigError ||
    (!connectivity.online ? connectivity.reason : null);

  return (
    <VividCard
      title={
        lang === 'th'
          ? 'ศูนย์วิเคราะห์การเชื่อมต่อ Cloud Storage & Native Cloud Runtime'
          : 'Cloud Storage & Native Cloud Runtime Diagnostics'
      }
      subtitle={
        lang === 'th'
          ? 'ตรวจสอบ /api/health, Cloud Object Storage, Native Cloud Runtime และระบบเชื่อมต่อใหม่อัตโนมัติแบบเรียลไทม์'
          : 'Live diagnostics for /api/health, Cloud Object Storage, Native Cloud Runtime, and background reconnection telemetry.'
      }
      gradientAccent={connectivity.online ? 'emerald' : 'coral'}
    >
      <div className="space-y-4">
        {/* Top Reconnection Service & /api/health Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-2 font-semibold text-[var(--app-text-primary)]">
              {apiHealthy ? (
                <Wifi className="w-4 h-4 text-[var(--z-ok)]" />
              ) : (
                <WifiOff className="w-4 h-4 text-[var(--z-danger)]" />
              )}
              <span>/api/health:</span>
              <StatusBadge status={apiStatus} />
              <span className="font-mono text-[11px] text-[var(--app-text-secondary)]">
                {apiHttpStatus ? `HTTP ${apiHttpStatus}` : 'OFFLINE'}
                {typeof apiLatencyMs === 'number' ? ` · ${apiLatencyMs}ms` : ''}
              </span>
            </div>

            <div className="h-4 w-px bg-[var(--app-card-border)] hidden sm:block" />

            <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--app-text-secondary)]">
              <Activity className="w-3.5 h-3.5 text-[var(--app-accent)]" />
              <span>
                {isReconnecting
                  ? lang === 'th'
                    ? 'กำลังเชื่อมต่อใหม่...'
                    : 'Reconnecting...'
                  : connectivity.online
                  ? lang === 'th'
                    ? 'เชื่อมต่อสมบูรณ์'
                    : 'Link Verified'
                  : connectivity.cloudConfigValid
                  ? lang === 'th'
                    ? `รอเชื่อมซ้ำ (ครั้งที่ ${reconnectAttempts})`
                    : `Auto-retry queued (#${reconnectAttempts})`
                  : lang === 'th'
                  ? 'รอตั้งค่า Secrets'
                  : 'Awaiting Secrets'}
              </span>
              {nextReconnectAt && !connectivity.online && (
                <span>· Next {new Date(nextReconnectAt).toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--app-text-secondary)] cursor-pointer select-none px-2 py-1 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)]">
              <input
                type="checkbox"
                checked={autoReconnectEnabled}
                onChange={(e) => setAutoReconnect(e.target.checked)}
                className="accent-[var(--app-accent)]"
              />
              <span>{lang === 'th' ? 'เชื่อมต่อใหม่อัตโนมัติ' : 'Auto-Reconnect'}</span>
            </label>

            <button
              type="button"
              data-testid="diagnostics-check-now-btn"
              disabled={isChecking}
              onClick={() => void checkNow()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              <span>{lang === 'th' ? 'ตรวจทันที' : 'Check Now'}</span>
            </button>

            <button
              type="button"
              data-testid="diagnostics-reconnect-btn"
              disabled={isReconnecting}
              onClick={() => void reconnectNow({ headers: authHeaders() })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[var(--app-accent)] text-[var(--app-bg)] disabled:opacity-50 cursor-pointer"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
              <span>{lang === 'th' ? 'เชื่อม Cloud Runtime' : 'Reconnect'}</span>
            </button>

            <button
              type="button"
              data-testid="diagnostics-open-secrets-btn"
              onClick={onOpenSecrets}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[color-mix(in_srgb,var(--app-amber)_16%,var(--app-surface-elevated))] border border-[color-mix(in_srgb,var(--app-amber)_45%,transparent)] text-[var(--app-amber)] hover:brightness-110 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{lang === 'th' ? 'ตั้งค่า Settings > Secrets' : 'Settings > Secrets'}</span>
            </button>
          </div>
        </div>

        {/* Immediate API & Connectivity Error Banner */}
        {activeError && (
          <div
            data-testid="connectivity-error-feedback"
            className="p-3.5 rounded-2xl border border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_10%,var(--app-surface))] space-y-2"
          >
            <div className="flex items-start gap-2.5">
              <AlertOctagon className="w-4 h-4 text-[var(--z-danger)] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-xs font-bold text-[var(--z-danger)]">
                  {lang === 'th'
                    ? 'ตรวจพบข้อผิดพลาดการเชื่อมต่อ API / Cloud Runtime (Fail-Closed)'
                    : 'Active API / Cloud Connectivity Error (Fail-Closed)'}
                </div>
                <div className="text-xs font-mono text-[var(--app-text-primary)] break-all">
                  {activeError}
                </div>
              </div>
            </div>

            {Array.isArray(connectivity.remediationSteps) && connectivity.remediationSteps.length > 0 && (
              <ul className="pl-6 list-disc space-y-0.5 text-[11px] text-[var(--app-text-secondary)]">
                {connectivity.remediationSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Active CLOUD_RUNTIME_URL & /api/health 503 Network Probe */}
        <div
          data-testid="cloud-runtime-active-probe-panel"
          className="p-4 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--app-text-primary)]">
              <Globe className="w-4 h-4 text-[var(--app-accent)]" />
              <span>
                {lang === 'th'
                  ? 'Active Network Probe: CLOUD_RUNTIME_URL & /api/health'
                  : 'Active Network Probe: CLOUD_RUNTIME_URL & /api/health'}
              </span>
              <StatusBadge status={probeStatus} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="url"
                data-testid="cloud-probe-url-input"
                value={probeUrlInput}
                onChange={(e) => setProbeUrlInput(e.target.value)}
                placeholder="Optional probe URL override (defaults to CLOUD_RUNTIME_URL)"
                className="w-64 sm:w-80 px-3 py-1.5 rounded-xl font-mono text-[11px] bg-[var(--app-bg)] border border-[var(--app-card-border)] focus:border-[var(--app-accent)] outline-none text-[var(--app-text-primary)]"
              />
              <button
                type="button"
                data-testid="cloud-probe-run-btn"
                disabled={isProbingCloudRuntime}
                onClick={() => void probeCloudRuntimeNow(probeUrlInput || undefined)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isProbingCloudRuntime ? 'animate-spin' : ''}`} />
                <span>{lang === 'th' ? 'ยิง Probe CLOUD_RUNTIME_URL' : 'Probe CLOUD_RUNTIME_URL'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono">
            <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
              <div className="text-[10px] text-[var(--app-text-secondary)]">HTTP Status</div>
              <div
                className={`font-bold mt-0.5 ${
                  cloudRuntimeProbe?.healthy
                    ? 'text-[var(--z-ok)]'
                    : cloudRuntimeProbe?.httpStatus === 503 || !cloudRuntimeProbe?.configured
                      ? 'text-[var(--z-danger)]'
                      : 'text-[var(--z-warn)]'
                }`}
              >
                {cloudRuntimeProbe?.httpStatus !== null && cloudRuntimeProbe?.httpStatus !== undefined
                  ? `HTTP ${cloudRuntimeProbe.httpStatus} ${cloudRuntimeProbe.statusText || ''}`.trim()
                  : cloudRuntimeProbe?.failureCategory || 'PENDING'}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
              <div className="text-[10px] text-[var(--app-text-secondary)]">Probe Latency</div>
              <div
                className={`font-bold mt-0.5 ${
                  cloudRuntimeProbe?.latencyStatus === 'FAST'
                    ? 'text-[var(--z-ok)]'
                    : cloudRuntimeProbe?.latencyStatus === 'TIMEOUT' ||
                        cloudRuntimeProbe?.latencyStatus === 'HIGH_LATENCY'
                      ? 'text-[var(--z-danger)]'
                      : 'text-[var(--app-text-primary)]'
                }`}
              >
                {typeof cloudRuntimeProbe?.latencyMs === 'number'
                  ? `${cloudRuntimeProbe.latencyMs}ms · ${cloudRuntimeProbe.latencyStatus}`
                  : cloudRuntimeProbe?.latencyStatus || 'UNCONFIGURED'}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
              <div className="text-[10px] text-[var(--app-text-secondary)]">DNS Resolution</div>
              <div className="font-bold mt-0.5 text-[var(--app-text-primary)] truncate">
                {cloudRuntimeProbe?.dnsResolved
                  ? cloudRuntimeProbe.dnsAddress || 'RESOLVED'
                  : cloudRuntimeProbe?.dnsError || (cloudRuntimeProbe?.configured ? 'FAILED' : 'N/A')}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
              <div className="text-[10px] text-[var(--app-text-secondary)]">/api/connectivity/health</div>
              <div
                className={`font-bold mt-0.5 ${
                  localHealthBreakdown?.connectivityHealthStatus === 200
                    ? 'text-[var(--z-ok)]'
                    : 'text-[var(--z-danger)]'
                }`}
              >
                {localHealthBreakdown
                  ? `HTTP ${localHealthBreakdown.connectivityHealthStatus} (${
                      localHealthBreakdown.connectivityHealthStatus === 503 ? 'Service Unavailable' : 'OK'
                    })`
                  : connectivity.online
                    ? 'HTTP 200 OK'
                    : 'HTTP 503 Service Unavailable'}
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] font-mono text-[11px] space-y-1">
            <div className="flex justify-between gap-2">
              <span className="text-[var(--app-text-secondary)]">Target Health URL:</span>
              <span className="text-[var(--app-text-primary)] break-all text-right">
                {cloudRuntimeProbe?.healthEndpointUrl || 'CLOUD_RUNTIME_URL not configured'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--app-text-secondary)]">Failure Category:</span>
              <span className="text-[var(--app-amber)] font-bold text-right">
                {cloudRuntimeProbe?.failureCategory || 'PENDING'}
              </span>
            </div>
            <div className="text-[var(--app-text-primary)] pt-1 break-all">
              {cloudRuntimeProbe?.diagnosticSummary ||
                'Running active network probe to CLOUD_RUNTIME_URL...'}
            </div>
            {cloudRuntimeProbe?.responsePreview && (
              <div className="text-[10px] text-[var(--app-text-secondary)] pt-1 break-all border-t border-[var(--app-card-border)]">
                Response preview: {cloudRuntimeProbe.responsePreview}
              </div>
            )}
          </div>
        </div>

        {/* Dual Status Cards: Cloud Object Storage + Native Cloud Runtime */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Cloud Object Storage */}
          <div className="p-4 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-[var(--app-text-primary)]">
                <HardDrive className="w-4 h-4 text-[var(--app-accent)]" />
                <span>{lang === 'th' ? 'Cloud Object Storage (.pt)' : 'Cloud Object Storage'}</span>
              </div>
              <StatusBadge status={storageStatus} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">Provider Mode</div>
                <div className="font-bold text-[var(--app-text-primary)] mt-0.5">
                  {connectivity.cloudConfigProvider || 'none'}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">Reachability</div>
                <div
                  className={`font-bold mt-0.5 ${
                    connectivity.cloudStorageReachable ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'
                  }`}
                >
                  {connectivity.cloudStorageReachable
                    ? 'REACHABLE'
                    : connectivity.cloudStorageConfigured
                    ? 'UNREACHABLE'
                    : 'NOT_CONFIGURED'}
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] font-mono text-[11px] space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Source URI:</span>
                <span className="text-[var(--app-text-primary)] break-all text-right">
                  {connectivity.cloudSource || connectivity.cloudSourceUri || 'Not configured'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Missing Vars:</span>
                <span className="text-[var(--z-warn)] break-all text-right">
                  {connectivity.cloudConfigMissingKeys && connectivity.cloudConfigMissingKeys.length > 0
                    ? connectivity.cloudConfigMissingKeys.join(', ')
                    : 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Native Cloud Runtime */}
          <div className="p-4 rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-[var(--app-text-primary)]">
                <Cloud className="w-4 h-4 text-[var(--app-accent)]" />
                <span>{lang === 'th' ? 'Native Cloud Runtime' : 'Native Cloud Runtime'}</span>
              </div>
              <StatusBadge status={runtimeStatus} />
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
              <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">Runtime State</div>
                <div className="font-bold text-[var(--app-text-primary)] mt-0.5 truncate">
                  {connectivity.runtimeState}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">Weights</div>
                <div
                  className={`font-bold mt-0.5 ${
                    connectivity.weightsLoaded ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'
                  }`}
                >
                  {connectivity.weightsLoaded ? 'LOADED' : 'UNLOADED'}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">Python Bridge</div>
                <div
                  className={`font-bold mt-0.5 flex items-center gap-1 ${
                    connectivity.pythonBridgeReachable ? 'text-[var(--z-ok)]' : 'text-[var(--z-warn)]'
                  }`}
                >
                  <Cpu className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {connectivity.pythonBridgeReachable
                      ? connectivity.bridgeLifecycle || 'Connected'
                      : 'Down'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] font-mono text-[11px] space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Exec Proof:</span>
                <span className={connectivity.executionVerified ? 'text-[var(--z-ok)] font-bold' : 'text-[var(--z-danger)] font-bold'}>
                  {connectivity.executionVerified ? 'VERIFIED' : 'BLOCKED'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--app-text-secondary)]">Checkpoint SHA:</span>
                <span className="text-[var(--app-text-primary)] break-all text-right">
                  {connectivity.checkpointSha256
                    ? `${connectivity.checkpointSha256.slice(0, 16)}…`
                    : 'Not loaded'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Background Reconnection Telemetry Log */}
        <div className="p-3 rounded-2xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[var(--app-text-secondary)]">
            <span className="font-bold text-[var(--app-text-primary)] flex items-center gap-1.5">
              {connectivity.online ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--z-ok)]" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-[var(--z-warn)]" />
              )}
              {lang === 'th' ? 'บันทึกการเชื่อมต่องานเบื้องหลัง (Reconnection Service)' : 'Reconnection Service Event Stream'}
            </span>
            <span>
              {lastHealthPingAt ? `Last /api/health ping: ${new Date(lastHealthPingAt).toLocaleTimeString()}` : 'Pending ping'}
              {lastReconnectOutcome ? ` · ${lastReconnectOutcome}` : ''}
            </span>
          </div>

          {recentEvents.length === 0 ? (
            <div className="text-[11px] font-mono text-[var(--app-text-secondary)]">
              Waiting for initial health & Cloud Runtime probe...
            </div>
          ) : (
            <div className="space-y-1 max-h-28 overflow-y-auto font-mono text-[11px]">
              {recentEvents.slice(0, 5).map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 text-[var(--app-text-secondary)]">
                  <span className="shrink-0 opacity-70">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                  <span
                    className={`shrink-0 font-bold ${
                      ev.kind === 'reconnect_ok' || ev.kind === 'health_ok'
                        ? 'text-[var(--z-ok)]'
                        : ev.kind === 'health_fail' || ev.kind === 'reconnect_fail'
                        ? 'text-[var(--z-danger)]'
                        : 'text-[var(--app-accent)]'
                    }`}
                  >
                    [{ev.kind.toUpperCase()}]
                  </span>
                  <span className="text-[var(--app-text-primary)] break-all">{ev.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </VividCard>
  );
};

