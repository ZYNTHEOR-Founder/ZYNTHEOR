import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, resolveWebSocketUrl, API_BASE_CHANGED_EVENT } from '../lib/apiClient';
import type { ConnectivityHealthState } from '../types';

const DEFAULT_STATE: ConnectivityHealthState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  onlineConnectivityRequired: typeof navigator === 'undefined' ? false : !navigator.onLine,
  browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  status: 'CHECKING',
  runtimeState: 'INITIALIZING',
  executionVerified: false,
  executionError: null,
  trainedProvenance: null,
  weightsRole: null,
  code: null,
  reason: null,
  cloudSource: null,
  weightsLoaded: false,
  weightsSource: null,
  checkpointSha256: null,
  totalParams: 0,
  modelName: null,
  lastCheckedAt: null,
  lastOnlineAt: null,
};

function mapHealthPayload(data: any, okResponse = true): ConnectivityHealthState {
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
    browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    status: data?.status || (isOnline ? 'ONLINE' : 'ONLINE_CONNECTIVITY_REQUIRED'),
    runtimeState,
    executionVerified,
    executionError: data?.executionError || null,
    trainedProvenance: data?.trainedProvenance || null,
    weightsRole: data?.weightsRole || null,
    code: data?.code || (isOnline ? null : 'FAIL_CLOSED'),
    reason: data?.reason || (isOnline ? null : data?.message || 'Online Connectivity Required'),
    cloudSource: data?.cloudSource || data?.cloudSourceUri || null,
    cloudStorageConfigured: typeof data?.cloudStorageConfigured === 'boolean' ? data.cloudStorageConfigured : undefined,
    cloudStorageReachable: typeof data?.cloudStorageReachable === 'boolean' ? data.cloudStorageReachable : undefined,
    cloudConfigValid: typeof data?.cloudConfigValid === 'boolean' ? data.cloudConfigValid : undefined,
    cloudConfigProvider: data?.cloudConfigProvider || undefined,
    cloudConfigMissingKeys: Array.isArray(data?.cloudConfigMissingKeys) ? data.cloudConfigMissingKeys : undefined,
    cloudConfigError: data?.cloudConfigError || null,
    pythonBridgeReachable: typeof data?.pythonBridgeReachable === 'boolean' ? data.pythonBridgeReachable : undefined,
    bridgeLifecycle: data?.bridgeLifecycle || undefined,
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

function resolveRuntimeWsUrl(): string | null {
  return resolveWebSocketUrl('/ws/runtime');
}

export function useConnectivityMonitor(pollIntervalMs: number = 15000) {
  const [connectivity, setConnectivity] = useState<ConnectivityHealthState>(DEFAULT_STATE);
  const [isChecking, setIsChecking] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimerRef = useRef<number | null>(null);
  const wsAttemptRef = useRef<number>(0);

  const checkHealth = useCallback(async () => {
    const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (!browserOnline) {
      setConnectivity((prev) => ({
        ...prev,
        online: false,
        onlineConnectivityRequired: true,
        browserOnline: false,
        status: 'FAIL_CLOSED',
        runtimeState: 'FAILED',
        executionVerified: false,
        code: 'FAIL_CLOSED',
        reason: 'FAIL_CLOSED: Online Connectivity Required — browser network interface is offline.',
        weightsLoaded: false,
        lastCheckedAt: new Date().toISOString(),
      }));
      return;
    }

    setIsChecking(true);
    try {
      const res = await fetch(apiUrl('/api/connectivity/health'), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      setConnectivity(mapHealthPayload(data, res.ok));
    } catch (err: any) {
      setConnectivity((prev) => ({
        ...prev,
        online: false,
        onlineConnectivityRequired: true,
        browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
        status: 'FAIL_CLOSED',
        runtimeState: 'FAILED',
        executionVerified: false,
        code: 'FAIL_CLOSED',
        reason: `FAIL_CLOSED: Online Connectivity Required — ${err?.message || 'unable to reach ZYNTHEOR cloud backend'}`,
        weightsLoaded: false,
        lastCheckedAt: new Date().toISOString(),
      }));
    } finally {
      setIsChecking(false);
    }
  }, []);

  const reconnect = useCallback(
    async (headers?: Record<string, string>, presignedUrl?: string) => {
      setIsChecking(true);
      try {
        const res = await fetch(apiUrl('/api/connectivity/reconnect'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(headers || {}),
          },
          body: JSON.stringify(presignedUrl ? { presignedUrl } : {}),
        });
        const data = await res.json().catch(() => ({}));
        const mapped = mapHealthPayload(data, res.ok);
        setConnectivity(mapped);
        return { ok: mapped.online, data };
      } catch (err: any) {
        await checkHealth();
        return { ok: false, error: err?.message || 'Reconnect failed' };
      } finally {
        setIsChecking(false);
      }
    },
    [checkHealth]
  );

  useEffect(() => {
    let disposed = false;
    void checkHealth();
    const timer = window.setInterval(() => {
      void checkHealth();
    }, pollIntervalMs);

    const connectWebSocket = () => {
      if (disposed || typeof WebSocket === 'undefined') return;
      const wsUrl = resolveRuntimeWsUrl();
      if (!wsUrl) return;
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          wsAttemptRef.current = 0;
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data));
            if (payload?.type === 'runtime_state' && payload.data) {
              setConnectivity(mapHealthPayload(payload.data, true));
            }
          } catch {
            // Ignore malformed telemetry messages
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (disposed) return;
          if (wsAttemptRef.current >= 6) return;
          wsAttemptRef.current += 1;
          const delayMs = Math.min(30000, 1000 * Math.pow(2, wsAttemptRef.current - 1));
          wsReconnectTimerRef.current = window.setTimeout(() => {
            wsReconnectTimerRef.current = null;
            connectWebSocket();
          }, delayMs);
        };

        ws.onerror = () => {
          // Close triggers bounded exponential backoff reconnect
        };
      } catch {
        // Fallback HTTP polling stays active
      }
    };

    connectWebSocket();

    const handleOnline = () => {
      wsAttemptRef.current = 0;
      void checkHealth();
      if (!wsRef.current) {
        connectWebSocket();
      }
    };
    const handleOffline = () => {
      setConnectivity((prev) => ({
        ...prev,
        online: false,
        onlineConnectivityRequired: true,
        browserOnline: false,
        status: 'FAIL_CLOSED',
        runtimeState: 'FAILED',
        executionVerified: false,
        code: 'FAIL_CLOSED',
        reason: 'FAIL_CLOSED: Online Connectivity Required — network connection lost.',
        weightsLoaded: false,
        lastCheckedAt: new Date().toISOString(),
      }));
    };

    const handleApiBaseChanged = () => {
      wsAttemptRef.current = 0;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      void checkHealth();
      connectWebSocket();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(API_BASE_CHANGED_EVENT, handleApiBaseChanged);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (wsReconnectTimerRef.current !== null) {
        window.clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // Ignore close errors during unmount
        }
        wsRef.current = null;
      }
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(API_BASE_CHANGED_EVENT, handleApiBaseChanged);
    };
  }, [checkHealth, pollIntervalMs]);

  return {
    connectivity,
    isChecking,
    checkHealth,
    reconnect,
  };
}
