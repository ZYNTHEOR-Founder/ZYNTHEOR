import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../lib/apiClient';
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

export function useConnectivityMonitor(pollIntervalMs: number = 10000) {
  const [connectivity, setConnectivity] = useState<ConnectivityHealthState>(DEFAULT_STATE);
  const [isChecking, setIsChecking] = useState(false);

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
      const executionVerified = Boolean(data.executionVerified);
      const runtimeState = data.runtimeState || (data.online ? 'READY' : 'NOT_LOADED');
      const isOnline = Boolean(res.ok && data.online === true && !data.onlineConnectivityRequired && executionVerified);

      setConnectivity({
        online: isOnline,
        onlineConnectivityRequired: !isOnline,
        browserOnline: true,
        status: data.status || (isOnline ? 'ONLINE' : 'FAIL_CLOSED'),
        runtimeState,
        executionVerified,
        executionError: data.executionError || null,
        trainedProvenance: data.trainedProvenance || null,
        weightsRole: data.weightsRole || null,
        code: data.code || (isOnline ? null : 'FAIL_CLOSED'),
        reason: data.reason || (isOnline ? null : data.message || 'Online Connectivity Required'),
        cloudSource: data.cloudSource || null,
        cloudStorageConfigured: typeof data.cloudStorageConfigured === 'boolean' ? data.cloudStorageConfigured : undefined,
        cloudStorageReachable: typeof data.cloudStorageReachable === 'boolean' ? data.cloudStorageReachable : undefined,
        pythonBridgeReachable: typeof data.pythonBridgeReachable === 'boolean' ? data.pythonBridgeReachable : undefined,
        weightsLoaded: Boolean(data.weightsLoaded),
        weightsSource: data.weightsSource || null,
        checkpointSha256: data.checkpointSha256 || null,
        totalParams: Number(data.totalParams || 0),
        modelName: data.modelName || null,
        latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
        lastCheckedAt: data.lastCheckedAt || new Date().toISOString(),
        lastOnlineAt: data.lastOnlineAt || (isOnline ? new Date().toISOString() : null),
      });
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
        const executionVerified = Boolean(data.executionVerified);
        const runtimeState = data.runtimeState || (data.online ? 'READY' : 'NOT_LOADED');
        const isOnline = Boolean(res.ok && data.online === true && !data.onlineConnectivityRequired && executionVerified);
        setConnectivity({
          online: isOnline,
          onlineConnectivityRequired: !isOnline,
          browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
          status: data.status || (isOnline ? 'ONLINE' : 'FAIL_CLOSED'),
          runtimeState,
          executionVerified,
          executionError: data.executionError || null,
          trainedProvenance: data.trainedProvenance || null,
          weightsRole: data.weightsRole || null,
          code: data.code || (isOnline ? null : 'FAIL_CLOSED'),
          reason: data.reason || (isOnline ? null : data.message || 'Online Connectivity Required'),
          cloudSource: data.cloudSource || null,
          cloudStorageConfigured: typeof data.cloudStorageConfigured === 'boolean' ? data.cloudStorageConfigured : undefined,
          cloudStorageReachable: typeof data.cloudStorageReachable === 'boolean' ? data.cloudStorageReachable : undefined,
          pythonBridgeReachable: typeof data.pythonBridgeReachable === 'boolean' ? data.pythonBridgeReachable : undefined,
          weightsLoaded: Boolean(data.weightsLoaded),
          weightsSource: data.weightsSource || null,
          checkpointSha256: data.checkpointSha256 || null,
          totalParams: Number(data.totalParams || 0),
          modelName: data.modelName || null,
          latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
          lastCheckedAt: data.lastCheckedAt || new Date().toISOString(),
          lastOnlineAt: data.lastOnlineAt || (isOnline ? new Date().toISOString() : null),
        });
        return { ok: isOnline, data };
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
    void checkHealth();
    const timer = window.setInterval(() => {
      void checkHealth();
    }, pollIntervalMs);

    const handleOnline = () => {
      void checkHealth();
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

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkHealth, pollIntervalMs]);

  return {
    connectivity,
    isChecking,
    checkHealth,
    reconnect,
  };
}
