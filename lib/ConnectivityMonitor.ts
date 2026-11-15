/**
 * ZYNTHEOR Backend ConnectivityMonitor
 * Enforces strict ONLINE-ONLY, FAIL-CLOSED operation across Cloud Object Storage
 * (S3/R2/Presigned HTTPS), Cloud Runtime, and the Native Python Bridge.
 * Zero offline fallbacks: reports "Online Connectivity Required" when unreachable.
 */

import { AuditLedger } from './AuditLedger.ts';
import {
  isCloudCheckpointStorageConfigured,
  statCheckpointInCloudStorage,
} from './CloudCheckpointStorage.ts';
import { NativeNeuralLMProvider, type RuntimeLifecycleState } from './providers.ts';
import net from 'net';

export type { RuntimeLifecycleState };

export interface BackendConnectivityState {
  online: boolean;
  status: 'ONLINE' | 'ONLINE_CONNECTIVITY_REQUIRED';
  code: 'FAIL_CLOSED' | null;
  reason: string;
  onlineConnectivityRequired: boolean;
  failClosed: boolean;
  weightsLoaded: boolean;
  runtimeState: RuntimeLifecycleState;
  executionVerified: boolean;
  executionError: string | null;
  trainedProvenance: string | null;
  weightsRole: string | null;
  cloudStorageConfigured: boolean;
  cloudStorageReachable: boolean;
  cloudSourceUri: string | null;
  pythonBridgeReachable: boolean;
  checkpointSha256: string | null;
  latencyMs: number;
  checkedAt: string;
  lastTransitionAt: string | null;
}

export class ConnectivityRequiredError extends Error {
  public readonly code = 'FAIL_CLOSED';
  public readonly httpStatus = 503;
  public readonly onlineConnectivityRequired = true;
  public readonly state: BackendConnectivityState;

  constructor(operation: string, state: BackendConnectivityState) {
    super(`FAIL_CLOSED: Online Connectivity Required (${operation}) — ${state.reason}`);
    this.name = 'ConnectivityRequiredError';
    this.state = state;
  }
}

export function validateCloudUrl(rawUrl: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'SSRF_BLOCKED: Malformed cloud URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `SSRF_BLOCKED: Disallowed URL scheme ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'SSRF_BLOCKED: Embedded URL credentials are not permitted' };
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return { ok: false, reason: 'SSRF_BLOCKED: Empty hostname' };
  }
  if (
    host === 'metadata.google.internal' ||
    host === 'metadata.goog' ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '::'
  ) {
    return { ok: false, reason: `SSRF_BLOCKED: Restricted host '${host}'` };
  }
  const allowLoopback = process.env.ZYNTHEOR_ALLOW_LOOPBACK_CLOUD !== 'false';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return allowLoopback ? { ok: true } : { ok: false, reason: 'SSRF_BLOCKED: Loopback cloud URL disabled' };
  }
  const ipVer = net.isIP(host);
  if (ipVer === 4) {
    const oct = host.split('.').map(Number);
    if (
      oct[0] === 169 && oct[1] === 254 ||
      oct[0] === 10 ||
      (oct[0] === 172 && oct[1] >= 16 && oct[1] <= 31) ||
      (oct[0] === 192 && oct[1] === 168) ||
      oct[0] === 127 ||
      oct[0] === 0
    ) {
      return { ok: false, reason: `SSRF_BLOCKED: Restricted private/link-local IPv4 '${host}'` };
    }
  } else if (ipVer === 6) {
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd') || host === '::1') {
      return { ok: false, reason: `SSRF_BLOCKED: Restricted IPv6 '${host}'` };
    }
  }
  return { ok: true };
}

async function probeHttpEndpoint(url: string, timeoutMs = 3000): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  const urlCheck = validateCloudUrl(url);
  if (!urlCheck.ok) {
    return { ok: false, error: urlCheck.reason || `Blocked URL: ${url}` };
  }
  const initialHost = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const initialIsLoopback =
    initialHost === 'localhost' || initialHost === '127.0.0.1' || initialHost === '::1';

  for (const method of ['HEAD', 'GET'] as const) {
    let currentUrl = url;
    for (let hop = 0; hop <= 2; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(currentUrl, {
          method,
          redirect: 'manual',
          headers: method === 'GET'
            ? { 'User-Agent': 'ZYNTHEOR-ConnectivityMonitor/1.0', Range: 'bytes=0-31' }
            : { 'User-Agent': 'ZYNTHEOR-ConnectivityMonitor/1.0' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (method === 'HEAD' && res.status === 405) {
          break;
        }
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) {
            return { ok: false, status: res.status, error: 'SSRF_BLOCKED: HTTP redirect without Location header' };
          }
          let resolved: URL;
          try {
            resolved = new URL(location, currentUrl);
          } catch {
            return { ok: false, status: res.status, error: 'SSRF_BLOCKED: Malformed HTTP redirect Location' };
          }
          const redirCheck = validateCloudUrl(resolved.href);
          if (!redirCheck.ok) {
            return {
              ok: false,
              status: res.status,
              error: `SSRF_BLOCKED: Redirect target rejected (${redirCheck.reason})`,
            };
          }
          const targetHost = resolved.hostname.toLowerCase();
          const targetIsLoopback =
            targetHost === 'localhost' || targetHost === '127.0.0.1' || targetHost === '::1';
          if (!initialIsLoopback && targetIsLoopback) {
            return {
              ok: false,
              status: res.status,
              error: 'SSRF_BLOCKED: External endpoint cannot redirect to loopback host',
            };
          }
          if (hop >= 2) {
            return { ok: false, status: res.status, error: 'SSRF_BLOCKED: Too many HTTP redirects' };
          }
          currentUrl = resolved.href;
          continue;
        }
        if (res.ok || (res.status >= 200 && res.status < 300)) {
          return { ok: true, status: res.status };
        }
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      } catch (err: any) {
        clearTimeout(timer);
        return { ok: false, error: err?.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : (err?.message || String(err)) };
      }
    }
  }
  return { ok: false, error: 'HTTP probe exhausted' };
}

export class ConnectivityMonitor {
  private static instance: ConnectivityMonitor | null = null;
  private lastState: BackendConnectivityState | null = null;
  private lastPingResult: Awaited<ReturnType<NativeNeuralLMProvider['ping']>> | null = null;
  private lastCheckAtMs = 0;
  private lastTransitionAt: string | null = null;
  private overridePresignedUrl: string | undefined;

  private constructor() {}

  public static getInstance(): ConnectivityMonitor {
    if (!ConnectivityMonitor.instance) {
      ConnectivityMonitor.instance = new ConnectivityMonitor();
    }
    return ConnectivityMonitor.instance;
  }

  public setPresignedUrlOverride(url?: string): void {
    this.overridePresignedUrl = url?.trim() || undefined;
  }

  public getLastPingResult(): Awaited<ReturnType<NativeNeuralLMProvider['ping']>> | null {
    return this.lastPingResult;
  }

  public async checkNow(presignedUrlOverride?: string): Promise<BackendConnectivityState> {
    const started = Date.now();
    const activeUrl =
      presignedUrlOverride?.trim() ||
      this.overridePresignedUrl ||
      process.env.CHECKPOINT_PRESIGNED_URL ||
      process.env.ZYNTHEOR_CONNECTIVITY_PROBE_URL ||
      process.env.CLOUD_RUNTIME_URL ||
      '';

    const s3Configured = isCloudCheckpointStorageConfigured();
    const cloudStorageConfigured = Boolean(activeUrl || s3Configured);

    let cloudStorageReachable = false;
    let cloudSourceUri: string | null = activeUrl || null;
    let cloudErrorReason = '';
    let lastHttpStatus: number | undefined;

    if (activeUrl) {
      const httpRes = await probeHttpEndpoint(activeUrl, 3000);
      cloudStorageReachable = httpRes.ok;
      lastHttpStatus = httpRes.status;
      if (!httpRes.ok) {
        cloudErrorReason = `Cloud checkpoint/runtime endpoint unreachable (${httpRes.error || 'network failure'})`;
      }
    } else if (s3Configured) {
      try {
        const stat = await statCheckpointInCloudStorage();
        cloudStorageReachable = true;
        cloudSourceUri = stat.sourceUri;
      } catch (s3Err: any) {
        cloudStorageReachable = false;
        cloudErrorReason = `Cloud Object Storage (S3/R2) unreachable (${s3Err?.message || s3Err})`;
      }
    } else {
      cloudErrorReason =
        'No Cloud Object Storage (S3_BUCKET / CHECKPOINT_PRESIGNED_URL) or CLOUD_RUNTIME_URL configured';
    }

    const provider = NativeNeuralLMProvider.getInstance();
    let pythonBridgeReachable = false;
    let weightsLoaded = false;
    let executionVerified = false;
    let executionError: string | null = null;
    let trainedProvenance: string | null = null;
    let weightsRole: string | null = null;
    let runtimeState: RuntimeLifecycleState = cloudStorageConfigured ? 'NOT_LOADED' : 'NOT_CONFIGURED';
    let bridgeReason = '';

    try {
      const [pingRes, pyProbe] = await Promise.all([
        provider.ping(),
        provider.connectivityCheck(activeUrl || undefined),
      ]);
      this.lastPingResult = pingRes;
      pythonBridgeReachable = true;
      weightsLoaded = Boolean(pingRes.weights_loaded);
      executionVerified = Boolean(pingRes.execution_verified);
      executionError = pingRes.execution_error ?? null;
      trainedProvenance = pingRes.trained_provenance ?? null;
      weightsRole = pingRes.weights_role ?? null;
      if (pingRes.runtime_state) {
        runtimeState = pingRes.runtime_state;
      } else if (weightsLoaded && executionVerified) {
        runtimeState = 'READY';
      } else if (weightsLoaded) {
        runtimeState = 'FAILED';
      } else if (!cloudStorageConfigured) {
        runtimeState = 'NOT_CONFIGURED';
      } else if (lastHttpStatus === 404) {
        runtimeState = 'NOT_FOUND';
      } else {
        runtimeState = pyProbe.runtime_state || 'NOT_LOADED';
      }
      if (pingRes.weights_source) {
        cloudSourceUri = pingRes.weights_source;
      }
      if (!cloudStorageReachable && pyProbe.online) {
        cloudStorageReachable = true;
      }
      if (!weightsLoaded) {
        bridgeReason = pingRes.error || pyProbe.reason || 'Native cloud weights are not loaded';
      } else if (!executionVerified) {
        bridgeReason = executionError || 'Native weights loaded but forward-pass execution verification failed';
      } else if (!cloudStorageReachable) {
        bridgeReason = cloudErrorReason || pyProbe.reason || 'Cloud endpoint unreachable';
      }
    } catch (pyErr: any) {
      this.lastPingResult = null;
      pythonBridgeReachable = false;
      weightsLoaded = false;
      executionVerified = false;
      runtimeState = 'FAILED';
      bridgeReason = `Native inference runtime unreachable (${pyErr?.message || pyErr})`;
    }

    if (!cloudStorageConfigured && !weightsLoaded) {
      runtimeState = 'NOT_CONFIGURED';
    } else if (lastHttpStatus === 404 && !weightsLoaded) {
      runtimeState = 'NOT_FOUND';
    } else if (cloudErrorReason.includes('SSRF_BLOCKED') && !weightsLoaded) {
      runtimeState = 'FAILED';
    }

    const online = Boolean(
      cloudStorageConfigured &&
      cloudStorageReachable &&
      pythonBridgeReachable &&
      weightsLoaded &&
      executionVerified &&
      runtimeState === 'READY'
    );

    const reason = online
      ? `Online connectivity verified (${cloudSourceUri || 'cloud runtime'})`
      : cloudErrorReason || bridgeReason || 'Online Connectivity Required';

    const nowIso = new Date().toISOString();
    if (this.lastState && this.lastState.online !== online) {
      this.lastTransitionAt = nowIso;
      AuditLedger.append('SYSTEM', online ? 'CONNECTIVITY_RESTORED' : 'CONNECTIVITY_LOST_FAIL_CLOSED', {
        online,
        runtimeState,
        executionVerified,
        cloudSourceUri,
        reason,
      });
    } else if (!this.lastState) {
      this.lastTransitionAt = nowIso;
    }

    const nextState: BackendConnectivityState = {
      online,
      status: online ? 'ONLINE' : 'ONLINE_CONNECTIVITY_REQUIRED',
      code: online ? null : 'FAIL_CLOSED',
      reason: online ? reason : (reason.includes('Online Connectivity Required') ? reason : `Online Connectivity Required: ${reason}`),
      onlineConnectivityRequired: !online,
      failClosed: !online,
      weightsLoaded,
      runtimeState,
      executionVerified,
      executionError,
      trainedProvenance,
      weightsRole,
      cloudStorageConfigured,
      cloudStorageReachable,
      cloudSourceUri,
      pythonBridgeReachable,
      checkpointSha256: (weightsLoaded && this.lastPingResult?.checkpoint_hash) ? String(this.lastPingResult.checkpoint_hash) : null,
      latencyMs: Date.now() - started,
      checkedAt: nowIso,
      lastTransitionAt: this.lastTransitionAt,
    };

    this.lastState = nextState;
    this.lastCheckAtMs = Date.now();
    return nextState;
  }

  public async getStatus(): Promise<BackendConnectivityState> {
    if (this.lastState && Date.now() - this.lastCheckAtMs < 4000) {
      return this.lastState;
    }
    return this.checkNow();
  }

  public async requireOnline(operation: string): Promise<BackendConnectivityState> {
    const state = await this.checkNow();
    if (!state.online || !state.weightsLoaded || !state.executionVerified || state.runtimeState !== 'READY') {
      throw new ConnectivityRequiredError(operation, state);
    }
    return state;
  }

  public async reconnect(presignedUrl?: string, objectKey?: string): Promise<BackendConnectivityState> {
    if (presignedUrl) {
      const urlCheck = validateCloudUrl(presignedUrl);
      if (!urlCheck.ok) {
        const current = await this.checkNow();
        return {
          ...current,
          online: false,
          status: 'ONLINE_CONNECTIVITY_REQUIRED',
          code: 'FAIL_CLOSED',
          runtimeState: 'FAILED',
          reason: `Online Connectivity Required: ${urlCheck.reason}`,
        };
      }
      this.setPresignedUrlOverride(presignedUrl);
    }
    const provider = NativeNeuralLMProvider.getInstance();
    try {
      await provider.reloadCloudWeights(
        presignedUrl || this.overridePresignedUrl,
        objectKey
      );
    } catch {
      // checkNow() below captures exact fail-closed state and reason
    }
    return this.checkNow(presignedUrl);
  }
}
