import { apiUrl, resolveWebSocketUrl, API_BASE_CHANGED_EVENT } from '../lib/apiClient';
import type { ConnectivityHealthState } from '../types';

export type ReconnectionEventKind =
  | 'health_ok'
  | 'health_fail'
  | 'cloud_check'
  | 'cloud_probe'
  | 'reconnect_attempt'
  | 'reconnect_ok'
  | 'reconnect_fail'
  | 'credentials_updated';

export interface CloudRuntimeProbeReport {
  configured: boolean;
  reachable: boolean;
  healthy: boolean;
  targetBaseUrl: string | null;
  healthEndpointUrl: string | null;
  dnsResolved: boolean;
  dnsAddress: string | null;
  dnsError: string | null;
  httpStatus: number | null;
  statusText: string | null;
  latencyMs: number | null;
  latencyStatus: 'FAST' | 'NORMAL' | 'HIGH_LATENCY' | 'TIMEOUT' | 'NETWORK_ERROR' | 'UNCONFIGURED';
  failureCategory:
    | 'HEALTHY'
    | 'NOT_CONFIGURED'
    | 'HTTP_503_SERVICE_UNAVAILABLE'
    | 'HTTP_5XX_ERROR'
    | 'HTTP_4XX_ERROR'
    | 'REDIRECT'
    | 'TIMEOUT'
    | 'DNS_OR_NETWORK_ERROR'
    | 'SSRF_BLOCKED';
  contentType: string | null;
  responsePreview: string | null;
  diagnosticSummary: string;
  checkedAt: string;
}

export interface LocalHealthBreakdown {
  apiHealthStatus: number;
  connectivityHealthStatus: number;
  connectivityReason: string;
  runtimeState: string;
  cloudStorageConfigured: boolean;
  cloudStorageReachable: boolean;
  weightsLoaded: boolean;
}

export interface ReconnectionEvent {
  id: string;
  timestamp: string;
  kind: ReconnectionEventKind;
  detail: string;
}

export interface ReconnectionServiceState {
  apiHealthy: boolean;
  apiHttpStatus: number | null;
  apiLatencyMs: number | null;
  apiError: string | null;
  serverUptimeSec: number | null;
  lastHealthPingAt: string | null;
  connectivity: ConnectivityHealthState;
  cloudRuntimeProbe: CloudRuntimeProbeReport | null;
  localHealthBreakdown: LocalHealthBreakdown | null;
  isChecking: boolean;
  isProbingCloudRuntime: boolean;
  isReconnecting: boolean;
  autoReconnectEnabled: boolean;
  reconnectAttempts: number;
  nextReconnectAt: string | null;
  lastReconnectAt: string | null;
  lastReconnectOutcome: string | null;
  credentialsRevision: number;
  recentEvents: ReconnectionEvent[];
}

const DEFAULT_CONNECTIVITY: ConnectivityHealthState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  onlineConnectivityRequired: true,
  browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  status: 'CHECKING',
  runtimeState: 'INITIALIZING',
  executionVerified: false,
  executionError: null,
  trainedProvenance: null,
  weightsRole: null,
  code: null,
  reason: 'Awaiting initial /api/health & Cloud Runtime probe',
  cloudSource: null,
  cloudStorageConfigured: false,
  cloudStorageReachable: false,
  cloudConfigValid: false,
  cloudConfigProvider: 'none',
  cloudConfigMissingKeys: ['CHECKPOINT_PRESIGNED_URL', 'S3_BUCKET', 'CLOUD_RUNTIME_URL'],
  cloudConfigError: null,
  pythonBridgeReachable: false,
  bridgeLifecycle: 'Connecting',
  weightsLoaded: false,
  weightsSource: null,
  checkpointPath: null,
  checkpointSha256: null,
  tokenizerSha256: null,
  activeRuntimeId: null,
  totalParams: 0,
  modelName: null,
  lastCheckedAt: null,
  lastOnlineAt: null,
};

function mapConnectivityPayload(data: any, okResponse = true): ConnectivityHealthState {
  const executionVerified = Boolean(data?.executionVerified);
  const runtimeState = data?.runtimeState || (data?.online ? 'READY' : 'NOT_LOADED');
  const isOnline = Boolean(
    okResponse &&
      data?.online === true &&
      !data?.onlineConnectivityRequired &&
      executionVerified &&
      runtimeState === 'READY'
  );

  return {
    online: isOnline,
    onlineConnectivityRequired: !isOnline,
    failClosed: !isOnline,
    browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    status: data?.status || (isOnline ? 'ONLINE' : 'ONLINE_CONNECTIVITY_REQUIRED'),
    runtimeState,
    internetReachable: typeof data?.internetReachable === 'boolean' ? data.internetReachable : undefined,
    internetStatus: data?.internetStatus,
    internetProbeDetail: data?.internetProbeDetail,
    modelConnectivityReady: typeof data?.modelConnectivityReady === 'boolean' ? data.modelConnectivityReady : isOnline,
    remediationSteps: Array.isArray(data?.remediationSteps) ? data.remediationSteps : [],
    executionVerified,
    executionError: data?.executionError || null,
    trainedProvenance: data?.trainedProvenance || null,
    weightsRole: data?.weightsRole || null,
    code: data?.code || (isOnline ? null : 'FAIL_CLOSED'),
    reason: data?.reason || (isOnline ? null : data?.message || data?.error || 'Online Connectivity Required'),
    cloudSource: data?.cloudSource || data?.cloudSourceUri || null,
    cloudSourceUri: data?.cloudSourceUri || data?.cloudSource || null,
    cloudStorageConfigured: typeof data?.cloudStorageConfigured === 'boolean' ? data.cloudStorageConfigured : false,
    cloudStorageReachable: typeof data?.cloudStorageReachable === 'boolean' ? data.cloudStorageReachable : false,
    cloudConfigValid: typeof data?.cloudConfigValid === 'boolean' ? data.cloudConfigValid : false,
    cloudConfigProvider: data?.cloudConfigProvider || 'none',
    cloudConfigMissingKeys: Array.isArray(data?.cloudConfigMissingKeys) ? data.cloudConfigMissingKeys : [],
    cloudConfigError: data?.cloudConfigError || null,
    pythonBridgeReachable: typeof data?.pythonBridgeReachable === 'boolean' ? data.pythonBridgeReachable : false,
    bridgeLifecycle:
      typeof data?.bridgeLifecycle === 'string'
        ? data.bridgeLifecycle
        : data?.bridgeLifecycle?.state || undefined,
    weightsLoaded: Boolean(data?.weightsLoaded),
    weightsSource: data?.weightsSource || data?.cloudSourceUri || null,
    checkpointPath: data?.checkpointPath || null,
    checkpointSha256: data?.checkpointSha256 || null,
    tokenizerSha256: data?.tokenizerSha256 || null,
    activeRuntimeId: data?.activeRuntimeId || null,
    totalParams: Number(data?.totalParams || 0),
    modelName: data?.modelName || null,
    latencyMs: typeof data?.latencyMs === 'number' ? data.latencyMs : undefined,
    lastCheckedAt: data?.lastCheckedAt || data?.checkedAt || new Date().toISOString(),
    lastOnlineAt: data?.lastOnlineAt || (isOnline ? new Date().toISOString() : null),
  };
}

class ReconnectionService {
  private static instance: ReconnectionService | null = null;

  private state: ReconnectionServiceState = {
    apiHealthy: false,
    apiHttpStatus: null,
    apiLatencyMs: null,
    apiError: null,
    serverUptimeSec: null,
    lastHealthPingAt: null,
    connectivity: DEFAULT_CONNECTIVITY,
    cloudRuntimeProbe: null,
    localHealthBreakdown: null,
    isChecking: false,
    isProbingCloudRuntime: false,
    isReconnecting: false,
    autoReconnectEnabled: true,
    reconnectAttempts: 0,
    nextReconnectAt: null,
    lastReconnectAt: null,
    lastReconnectOutcome: null,
    credentialsRevision: 0,
    recentEvents: [],
  };

  private listeners = new Set<(state: ReconnectionServiceState) => void>();
  private subscriberRefCount = 0;
  private pollTimer: number | null = null;
  private backoffTimer: number | null = null;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: number | null = null;
  private wsAttempt = 0;
  private inFlightCheck: Promise<ReconnectionServiceState> | null = null;
  private inFlightReconnect: Promise<{ ok: boolean; data?: any; error?: string }> | null = null;
  private onlineListener = () => {
    this.state = { ...this.state, reconnectAttempts: 0 };
    this.emit();
    void this.runHealthAndCloudCheck();
    if (!this.ws) {
      this.connectWebSocket();
    }
  };
  private offlineListener = () => {
    this.appendEvent('health_fail', 'Browser network interface went offline');
    this.state = {
      ...this.state,
      apiHealthy: false,
      apiError: 'Browser network interface offline',
      connectivity: {
        ...this.state.connectivity,
        online: false,
        onlineConnectivityRequired: true,
        browserOnline: false,
        status: 'FAIL_CLOSED',
        runtimeState: 'FAILED',
        reason: 'FAIL_CLOSED: Browser network connection lost',
        lastCheckedAt: new Date().toISOString(),
      },
    };
    this.emit();
  };

  private apiBaseChangedListener = () => {
    this.wsAttempt = 0;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    void this.runHealthAndCloudCheck();
    this.connectWebSocket();
  };

  private constructor() {}

  public static getInstance(): ReconnectionService {
    if (!ReconnectionService.instance) {
      ReconnectionService.instance = new ReconnectionService();
    }
    return ReconnectionService.instance;
  }

  public getState(): ReconnectionServiceState {
    return this.state;
  }

  public subscribe(listener: (state: ReconnectionServiceState) => void): () => void {
    this.listeners.add(listener);
    this.retain();
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
      this.release();
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private appendEvent(kind: ReconnectionEventKind, detail: string): void {
    const entry: ReconnectionEvent = {
      id: `reconn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      kind,
      detail,
    };
    this.state = {
      ...this.state,
      recentEvents: [entry, ...this.state.recentEvents].slice(0, 12),
    };
  }

  private retain(): void {
    this.subscriberRefCount += 1;
    if (this.subscriberRefCount === 1 && typeof window !== 'undefined') {
      void this.runHealthAndCloudCheck();
      this.pollTimer = window.setInterval(() => {
        void this.runHealthAndCloudCheck();
      }, 15000);
      this.connectWebSocket();
      window.addEventListener('online', this.onlineListener);
      window.addEventListener('offline', this.offlineListener);
      window.addEventListener(API_BASE_CHANGED_EVENT, this.apiBaseChangedListener);
    }
  }

  private release(): void {
    this.subscriberRefCount = Math.max(0, this.subscriberRefCount - 1);
    if (this.subscriberRefCount === 0 && typeof window !== 'undefined') {
      if (this.pollTimer !== null) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.backoffTimer !== null) {
        window.clearTimeout(this.backoffTimer);
        this.backoffTimer = null;
      }
      if (this.wsReconnectTimer !== null) {
        window.clearTimeout(this.wsReconnectTimer);
        this.wsReconnectTimer = null;
      }
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // ignore
        }
        this.ws = null;
      }
      window.removeEventListener('online', this.onlineListener);
      window.removeEventListener('offline', this.offlineListener);
      window.removeEventListener(API_BASE_CHANGED_EVENT, this.apiBaseChangedListener);
    }
  }

  private resolveWsUrl(): string | null {
    return resolveWebSocketUrl('/ws/runtime');
  }

  private connectWebSocket(): void {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    if (this.subscriberRefCount === 0) return;
    const wsUrl = this.resolveWsUrl();
    if (!wsUrl) return;
    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        this.wsAttempt = 0;
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          if (payload?.type === 'runtime_state' && payload.data) {
            const mapped = mapConnectivityPayload(payload.data, Boolean(payload.data.online));
            this.state = {
              ...this.state,
              connectivity: mapped,
            };
            this.emit();
          } else if (payload?.type === 'workflow_event' && payload.event && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('zyntheor:workflow-event', { detail: payload.event }));
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        this.ws = null;
        if (this.subscriberRefCount === 0 || this.wsAttempt >= 6) return;
        this.wsAttempt += 1;
        const delayMs = Math.min(30000, 1000 * Math.pow(2, this.wsAttempt - 1));
        this.wsReconnectTimer = window.setTimeout(() => {
          this.wsReconnectTimer = null;
          this.connectWebSocket();
        }, delayMs);
      };
      ws.onerror = () => {
        // handled on close
      };
    } catch {
      // HTTP polling remains active
    }
  }

  public setAutoReconnectEnabled(enabled: boolean): void {
    this.state = {
      ...this.state,
      autoReconnectEnabled: enabled,
      nextReconnectAt: enabled ? this.state.nextReconnectAt : null,
    };
    if (!enabled && this.backoffTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    this.emit();
  }

  public async pingHealth(): Promise<{ ok: boolean; status: number | null; latencyMs: number; error: string | null }> {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const res = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
      const latencyMs = Math.max(
        1,
        Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started)
      );
      const data = await res.json().catch(() => ({}));
      const healthy = Boolean(res.ok && data?.status === 'healthy');
      const error = healthy
        ? null
        : data?.error || `HTTP ${res.status} ${res.statusText || 'Health check failed'}`;

      this.state = {
        ...this.state,
        apiHealthy: healthy,
        apiHttpStatus: res.status,
        apiLatencyMs: latencyMs,
        apiError: error,
        serverUptimeSec: typeof data?.uptime === 'number' ? Math.round(data.uptime) : this.state.serverUptimeSec,
        lastHealthPingAt: new Date().toISOString(),
      };
      if (!healthy) {
        this.appendEvent('health_fail', `/api/health returned HTTP ${res.status}`);
      } else if (this.state.recentEvents.length === 0 || this.state.recentEvents[0]?.kind === 'health_fail') {
        this.appendEvent('health_ok', `/api/health OK (${latencyMs}ms)`);
      }
      this.emit();
      return { ok: healthy, status: res.status, latencyMs, error };
    } catch (err: any) {
      const latencyMs = Math.max(
        1,
        Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started)
      );
      const error = err?.message || 'Unable to reach /api/health';
      this.state = {
        ...this.state,
        apiHealthy: false,
        apiHttpStatus: null,
        apiLatencyMs: latencyMs,
        apiError: error,
        lastHealthPingAt: new Date().toISOString(),
      };
      this.appendEvent('health_fail', `/api/health unreachable: ${error}`);
      this.emit();
      return { ok: false, status: null, latencyMs, error };
    }
  }

  public async probeCloudRuntime(urlOverride?: string): Promise<CloudRuntimeProbeReport | null> {
    this.state = { ...this.state, isProbingCloudRuntime: true };
    this.emit();
    try {
      const payload = urlOverride?.trim() ? { cloudRuntimeUrl: urlOverride.trim() } : {};
      const res = await fetch(apiUrl('/api/connectivity/cloud-runtime-probe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data?.probe) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const probe = data.probe as CloudRuntimeProbeReport;
      const localHealthBreakdown = (data.localHealth || null) as LocalHealthBreakdown | null;
      this.state = {
        ...this.state,
        cloudRuntimeProbe: probe,
        localHealthBreakdown,
      };
      const statusPart = probe.httpStatus !== null ? `HTTP ${probe.httpStatus}` : probe.failureCategory;
      const latencyPart = typeof probe.latencyMs === 'number' ? `${probe.latencyMs}ms (${probe.latencyStatus})` : 'no latency';
      this.appendEvent(
        'cloud_probe',
        probe.configured
          ? `CLOUD_RUNTIME_URL probe → ${statusPart} · ${latencyPart}`
          : 'CLOUD_RUNTIME_URL unconfigured · /api/connectivity/health returns 503 fail-closed'
      );
      this.emit();
      return probe;
    } catch (err: any) {
      const msg = err?.message || 'Active CLOUD_RUNTIME_URL probe failed';
      this.appendEvent('cloud_probe', `Active probe error: ${msg}`);
      this.emit();
      return null;
    } finally {
      this.state = { ...this.state, isProbingCloudRuntime: false };
      this.emit();
    }
  }

  public async runHealthAndCloudCheck(): Promise<ReconnectionServiceState> {
    if (this.inFlightCheck) return this.inFlightCheck;

    this.inFlightCheck = (async () => {
      this.state = { ...this.state, isChecking: true };
      this.emit();

      try {
        const health = await this.pingHealth();
        if (!health.ok) {
          this.state = {
            ...this.state,
            connectivity: {
              ...this.state.connectivity,
              online: false,
              onlineConnectivityRequired: true,
              status: 'FAIL_CLOSED',
              runtimeState: 'FAILED',
              reason: `API server health check failed: ${health.error}`,
              lastCheckedAt: new Date().toISOString(),
            },
          };
          return this.state;
        }

        const [res] = await Promise.all([
          fetch(apiUrl('/api/connectivity/health'), { cache: 'no-store' }),
          this.probeCloudRuntime(),
        ]);
        const data = await res.json().catch(() => ({}));
        const mapped = mapConnectivityPayload(data, res.ok);
        const prevOnline = this.state.connectivity.online;
        const prevRuntime = this.state.connectivity.runtimeState;

        this.state = {
          ...this.state,
          connectivity: mapped,
          reconnectAttempts: mapped.online ? 0 : this.state.reconnectAttempts,
          nextReconnectAt: mapped.online ? null : this.state.nextReconnectAt,
        };

        if (mapped.online !== prevOnline || mapped.runtimeState !== prevRuntime) {
          this.appendEvent(
            'cloud_check',
            `Cloud Runtime ${mapped.runtimeState} · Storage ${
              mapped.cloudStorageReachable ? 'REACHABLE' : mapped.cloudStorageConfigured ? 'UNREACHABLE' : 'NOT_CONFIGURED'
            }`
          );
        }

        // Schedule automatic background reconnect only when credentials exist and runtime is not yet online
        if (
          this.state.autoReconnectEnabled &&
          !mapped.online &&
          mapped.cloudConfigValid &&
          !this.state.isReconnecting &&
          this.backoffTimer === null &&
          this.state.reconnectAttempts < 6 &&
          typeof window !== 'undefined'
        ) {
          const delayMs = Math.min(30000, 3000 * Math.pow(2, this.state.reconnectAttempts));
          const nextIso = new Date(Date.now() + delayMs).toISOString();
          this.state = { ...this.state, nextReconnectAt: nextIso };
          this.backoffTimer = window.setTimeout(() => {
            this.backoffTimer = null;
            void this.attemptReconnect();
          }, delayMs);
        }

        return this.state;
      } catch (err: any) {
        const msg = err?.message || 'Unable to probe /api/connectivity/health';
        this.state = {
          ...this.state,
          connectivity: {
            ...this.state.connectivity,
            online: false,
            onlineConnectivityRequired: true,
            status: 'FAIL_CLOSED',
            runtimeState: 'FAILED',
            reason: `Cloud probe error: ${msg}`,
            lastCheckedAt: new Date().toISOString(),
          },
        };
        this.appendEvent('cloud_check', `Probe failed: ${msg}`);
        return this.state;
      } finally {
        this.state = { ...this.state, isChecking: false };
        this.inFlightCheck = null;
        this.emit();
      }
    })();

    return this.inFlightCheck;
  }

  public async attemptReconnect(opts?: {
    headers?: Record<string, string>;
    presignedUrl?: string;
    objectKey?: string;
  }): Promise<{ ok: boolean; data?: any; error?: string }> {
    if (this.inFlightReconnect) return this.inFlightReconnect;

    if (this.backoffTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }

    this.inFlightReconnect = (async () => {
      const nextAttempt = this.state.reconnectAttempts + 1;
      this.state = {
        ...this.state,
        isReconnecting: true,
        reconnectAttempts: nextAttempt,
        nextReconnectAt: null,
        lastReconnectAt: new Date().toISOString(),
      };
      this.appendEvent('reconnect_attempt', `Reconnect attempt #${nextAttempt} to Cloud Object Storage & Native Runtime`);
      this.emit();

      try {
        await this.pingHealth();
        const bodyPayload: Record<string, string> = {};
        if (opts?.presignedUrl) bodyPayload.presignedUrl = opts.presignedUrl;
        if (opts?.objectKey) bodyPayload.objectKey = opts.objectKey;

        const res = await fetch(apiUrl('/api/connectivity/reconnect'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(opts?.headers || {}),
          },
          body: JSON.stringify(bodyPayload),
        });
        const data = await res.json().catch(() => ({}));
        const mapped = mapConnectivityPayload(data, res.ok);
        const outcome = mapped.online
          ? `Connected (${mapped.cloudSource || mapped.runtimeState})`
          : mapped.reason || data?.error || `HTTP ${res.status} FAIL_CLOSED`;

        this.state = {
          ...this.state,
          connectivity: mapped,
          reconnectAttempts: mapped.online ? 0 : nextAttempt,
          lastReconnectOutcome: outcome,
        };
        this.appendEvent(mapped.online ? 'reconnect_ok' : 'reconnect_fail', outcome);
        await this.probeCloudRuntime();
        this.emit();
        return { ok: mapped.online, data };
      } catch (err: any) {
        const msg = err?.message || 'Reconnect request failed';
        this.state = {
          ...this.state,
          lastReconnectOutcome: msg,
        };
        this.appendEvent('reconnect_fail', msg);
        this.emit();
        return { ok: false, error: msg };
      } finally {
        this.state = { ...this.state, isReconnecting: false };
        this.inFlightReconnect = null;
        this.emit();
      }
    })();

    return this.inFlightReconnect;
  }

  public async notifyCredentialsUpdated(
    updatedKeys: string[],
    headers?: Record<string, string>
  ): Promise<{ ok: boolean; data?: any; error?: string }> {
    this.state = {
      ...this.state,
      credentialsRevision: this.state.credentialsRevision + 1,
      reconnectAttempts: 0,
    };
    this.appendEvent(
      'credentials_updated',
      `Secrets updated (${updatedKeys.join(', ') || 'config refreshed'}) — triggering link re-establishment`
    );
    this.emit();
    return this.attemptReconnect({ headers });
  }
}

export const reconnectionService = ReconnectionService.getInstance();
