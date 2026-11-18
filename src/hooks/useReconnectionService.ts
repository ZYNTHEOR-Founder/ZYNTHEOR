import { useCallback, useEffect, useState } from 'react';
import { reconnectionService, type ReconnectionServiceState } from '../services/reconnectionService';

export function useReconnectionService() {
  const [state, setState] = useState<ReconnectionServiceState>(() => reconnectionService.getState());

  useEffect(() => {
    return reconnectionService.subscribe(setState);
  }, []);

  const checkNow = useCallback(() => reconnectionService.runHealthAndCloudCheck(), []);
  const reconnectNow = useCallback(
    (opts?: { headers?: Record<string, string>; presignedUrl?: string; objectKey?: string }) =>
      reconnectionService.attemptReconnect(opts),
    []
  );
  const setAutoReconnect = useCallback(
    (enabled: boolean) => reconnectionService.setAutoReconnectEnabled(enabled),
    []
  );
  const probeCloudRuntimeNow = useCallback(
    (urlOverride?: string) => reconnectionService.probeCloudRuntime(urlOverride),
    []
  );

  return {
    ...state,
    checkNow,
    reconnectNow,
    setAutoReconnect,
    probeCloudRuntimeNow,
  };
}
