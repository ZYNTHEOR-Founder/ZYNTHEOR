/**
 * ZYNTHEOR Sovereign Neural Providers
 * 100% First-Party Native Neural LM Provider + Bridge Lifecycle & Pluggable External Brain Slot.
 * Zero external AI SDK packages. Communicates with `python3 -m qplus_native.bridge` via NDJSON stdio.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import readline from 'readline';
import { validateCloudRuntimeConfig } from './CloudCheckpointStorage';

export type RuntimeLifecycleState =
  | 'NOT_CONFIGURED'
  | 'NOT_LOADED'
  | 'NOT_FOUND'
  | 'INITIALIZING'
  | 'LOADING'
  | 'READY'
  | 'FAILED'
  | 'BLOCKED';

export type BridgeLifecycleState =
  | 'Connecting'
  | 'Connected'
  | 'Degraded'
  | 'Reconnecting'
  | 'Session Timeout'
  | 'Initialization Error'
  | 'Service Error'
  | 'Unreachable';

export type BridgeFailureCategory =
  | 'none'
  | 'session_timeout'
  | 'initialization_error'
  | 'unreachable';

export interface InferenceEvidence {
  checkpointPath: string;
  checkpointSha256: string;
  tokenizerSha256: string;
  activeRuntimeId: string;
  inferenceTimestamp: string;
  executionDurationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface BridgeLifecycleTelemetry {
  state: BridgeLifecycleState;
  previousState: BridgeLifecycleState | null;
  transitionAt: string;
  pid: number | null;
  heartbeatIntervalMs: number;
  lastHeartbeatAt: string | null;
  lastHeartbeatLatencyMs: number | null;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  nextRetryDelayMs: number | null;
  nextRetryAt: string | null;
  consecutiveFailures: number;
  totalPings: number;
  totalFailures: number;
  lastError: string | null;
  failureCategory: BridgeFailureCategory;
  backoffPolicy: {
    category: BridgeFailureCategory;
    baseDelayMs: number;
    maxDelayMs: number;
    multiplier: number;
  };
  lastVerifiedHeartbeatAt: string | null;
  cloudConfigValid: boolean;
  cloudConfigMissingKeys: string[];
  cloudConfigError: string | null;
}

export interface InferenceResponse {
  text: string;
  input_tokens_count: number;
  output_tokens_count: number;
  latency_ms: number;
  tokens_per_sec: number;
  checkpoint_hash: string;
  latent_norm: number;
}

export interface VerificationResult {
  verified: boolean;
  total_tests: number;
  passed_tests: number;
  checkpoint_hash: string;
  timestamp: number;
  results: Array<{
    test_id: string;
    name: string;
    status: 'PASS' | 'FAIL';
    evidence: string;
    duration_ms: number;
  }>;
}

export interface LanguageIntegrityResult {
  verified: boolean;
  total_tests: number;
  passed_tests: number;
  checkpoint_hash: string;
  timestamp: number;
  results: Array<{
    test_id: string;
    name: string;
    script_type: string;
    sample_length: number;
    token_count: number;
    unk_count: number;
    roundtrip_exact: boolean;
    status: 'PASS' | 'FAIL';
    evidence: string;
    duration_ms: number;
  }>;
}

export interface EvolutionRecord {
  cycle_id: string;
  timestamp: number;
  domain: string;
  score_before: number;
  score_after: number;
  improvement_pct: number;
  stages: Array<{
    stage: string;
    action: string;
    findings?: string;
    score_before?: string;
    score_after?: string;
    delta?: string;
    status?: string;
    evidence?: string;
  }>;
}

export interface PingResult {
  status: string;
  model_name: string;
  architecture: string;
  total_params: number;
  active_params: number;
  target_params?: number | null;
  checkpoint_hash: string;
  checkpoint_path?: string | null;
  checkpoint_sha256?: string | null;
  tokenizer_sha256?: string | null;
  active_runtime_id?: string | null;
  weights_source?: string | null;
  weights_role?: string | null;
  trained_provenance?: string | null;
  execution_verified?: boolean;
  execution_error?: string | null;
  weights_loaded: boolean;
  inference_ready: boolean;
  online_connectivity_required: boolean;
  runtime_state: RuntimeLifecycleState;
  readiness_reason?: string;
  source_uri?: string | null;
  error?: string;
}

export function classifyBridgeFailureCategory(reason?: string | null): BridgeFailureCategory {
  if (!reason) return 'none';
  const low = reason.toLowerCase();
  if (low.includes('timeout') || low.includes('timed out')) return 'session_timeout';
  if (low.includes('exited') || low.includes('spawn') || low.includes('import') || low.includes('initialization')) {
    return 'initialization_error';
  }
  return 'unreachable';
}

export function computeExponentialBackoffMs(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
  jitterMs = 0
): number {
  const exp = Math.max(0, attempt - 1);
  const raw = baseDelayMs * Math.pow(2, exp) + Math.max(0, jitterMs);
  return Math.min(maxDelayMs, Math.round(raw));
}

export function computeCategoryBackoffMs(
  attempt: number,
  category: BridgeFailureCategory,
  jitterMs = 0
): number {
  const policy: Record<BridgeFailureCategory, { base: number; max: number }> = {
    none: { base: 1000, max: 30000 },
    session_timeout: { base: 500, max: 15000 },
    unreachable: { base: 1000, max: 30000 },
    initialization_error: { base: 3000, max: 60000 },
  };
  const cfg = policy[category] || policy.unreachable;
  return computeExponentialBackoffMs(attempt, cfg.base, cfg.max, jitterMs);
}

export class NativeNeuralLMProvider {
  private static instance: NativeNeuralLMProvider | null = null;
  private bridgeProcess: ChildProcessWithoutNullStreams | null = null;
  private reqCounter = 0;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private activeStreamCallback: ((chunk: string) => void) | null = null;
  private lifecycleListeners = new Set<(telemetry: BridgeLifecycleTelemetry) => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private cloudOverrides: { presignedUrl?: string } = {};
  private lastPingSnapshot: PingResult | null = null;
  private lastInferenceEvidence: InferenceEvidence | null = null;
  private telemetry: BridgeLifecycleTelemetry;

  private constructor() {
    const cfg = validateCloudRuntimeConfig();
    this.telemetry = {
      state: 'Connecting',
      previousState: null,
      transitionAt: new Date().toISOString(),
      pid: null,
      heartbeatIntervalMs: 15000,
      lastHeartbeatAt: null,
      lastHeartbeatLatencyMs: null,
      reconnectAttempt: 0,
      maxReconnectAttempts: 6,
      nextRetryDelayMs: null,
      nextRetryAt: null,
      consecutiveFailures: 0,
      totalPings: 0,
      totalFailures: 0,
      lastError: null,
      failureCategory: 'none',
      backoffPolicy: {
        category: 'none',
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        multiplier: 2,
      },
      lastVerifiedHeartbeatAt: null,
      cloudConfigValid: cfg.configValid,
      cloudConfigMissingKeys: cfg.missingKeys,
      cloudConfigError: cfg.validationError,
    };
  }

  public static getInstance(): NativeNeuralLMProvider {
    if (!NativeNeuralLMProvider.instance) {
      NativeNeuralLMProvider.instance = new NativeNeuralLMProvider();
    }
    return NativeNeuralLMProvider.instance;
  }

  public onLifecycleChange(listener: (telemetry: BridgeLifecycleTelemetry) => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => {
      this.lifecycleListeners.delete(listener);
    };
  }

  private emitLifecycle(): void {
    const snapshot = this.getLifecycleTelemetry();
    for (const listener of this.lifecycleListeners) {
      try {
        listener(snapshot);
      } catch {
        // Ignore subscriber exceptions
      }
    }
  }

  public getLifecycleTelemetry(): BridgeLifecycleTelemetry {
    return {
      ...this.telemetry,
      backoffPolicy: { ...this.telemetry.backoffPolicy },
      cloudConfigMissingKeys: [...this.telemetry.cloudConfigMissingKeys],
    };
  }

  public reconcileLifecycleState(
    targetState: BridgeLifecycleState,
    lastError: string | null,
    failureCategory?: BridgeFailureCategory
  ): BridgeLifecycleTelemetry {
    const cfg = validateCloudRuntimeConfig({ presignedUrl: this.cloudOverrides.presignedUrl });
    const prev = this.telemetry.state;
    const cat = failureCategory ?? (lastError ? classifyBridgeFailureCategory(lastError) : 'none');
    const nowIso = new Date().toISOString();

    if (prev !== targetState) {
      this.telemetry.previousState = prev;
      this.telemetry.state = targetState;
      this.telemetry.transitionAt = nowIso;
    }
    this.telemetry.lastError = lastError;
    this.telemetry.failureCategory = cat;
    this.telemetry.cloudConfigValid = cfg.configValid;
    this.telemetry.cloudConfigMissingKeys = cfg.missingKeys;
    this.telemetry.cloudConfigError = cfg.validationError;

    const baseMap: Record<BridgeFailureCategory, { base: number; max: number }> = {
      none: { base: 1000, max: 30000 },
      session_timeout: { base: 500, max: 15000 },
      unreachable: { base: 1000, max: 30000 },
      initialization_error: { base: 3000, max: 60000 },
    };
    const bCfg = baseMap[cat] || baseMap.none;
    this.telemetry.backoffPolicy = {
      category: cat,
      baseDelayMs: bCfg.base,
      maxDelayMs: bCfg.max,
      multiplier: 2,
    };

    if (targetState === 'Connected') {
      this.telemetry.consecutiveFailures = 0;
      this.telemetry.reconnectAttempt = 0;
      this.telemetry.nextRetryDelayMs = null;
      this.telemetry.nextRetryAt = null;
      this.telemetry.lastVerifiedHeartbeatAt = nowIso;
    }

    this.emitLifecycle();
    return this.getLifecycleTelemetry();
  }

  public setCloudOverrides(overrides: { presignedUrl?: string }): void {
    this.cloudOverrides = { ...overrides };
    const cfg = validateCloudRuntimeConfig({ presignedUrl: this.cloudOverrides.presignedUrl });
    this.telemetry.cloudConfigValid = cfg.configValid;
    this.telemetry.cloudConfigMissingKeys = cfg.missingKeys;
    this.telemetry.cloudConfigError = cfg.validationError;
  }

  public startHeartbeat(intervalMs = 15000): void {
    this.telemetry.heartbeatIntervalMs = Math.max(3000, intervalMs);
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.ping().catch(() => null);
    }, this.telemetry.heartbeatIntervalMs);
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public forceReconnectNow(): void {
    this.telemetry.reconnectAttempt = 0;
    this.telemetry.consecutiveFailures = 0;
    this.reconcileLifecycleState('Reconnecting', 'Manual/explicit reconnect requested', 'none');
  }

  public getLastInferenceEvidence(): InferenceEvidence | null {
    return this.lastInferenceEvidence ? { ...this.lastInferenceEvidence } : null;
  }

  public async shutdown(): Promise<void> {
    this.stopHeartbeat();
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Native bridge shutdown'));
    }
    this.pendingRequests.clear();
    if (this.bridgeProcess && !this.bridgeProcess.killed) {
      try {
        this.bridgeProcess.kill('SIGTERM');
      } catch {
        // Ignore cleanup errors
      }
    }
    this.bridgeProcess = null;
    this.telemetry.pid = null;
  }

  private startBridge(): void {
    const cwd = process.cwd();
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONPATH: cwd };
    if (this.cloudOverrides.presignedUrl) {
      env.CHECKPOINT_PRESIGNED_URL = this.cloudOverrides.presignedUrl;
    }
    this.bridgeProcess = spawn('python3', ['-m', 'qplus_native.bridge'], {
      cwd,
      env,
    });
    this.telemetry.pid = this.bridgeProcess.pid ?? null;

    const rl = readline.createInterface({
      input: this.bridgeProcess.stdout,
      terminal: false,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        const reqId = msg.id;

        if (msg.type === 'chunk') {
          this.activeStreamCallback?.(msg.text);
          return;
        }
        if (msg.type === 'done' || msg.error) {
          if (reqId !== undefined && this.pendingRequests.has(reqId)) {
            const pending = this.pendingRequests.get(reqId)!;
            this.pendingRequests.delete(reqId);
            if (msg.error) pending.reject(new Error(`Native Model Error: ${msg.error}`));
            else pending.resolve(msg);
          }
          this.activeStreamCallback = null;
          return;
        }

        if (reqId !== undefined && this.pendingRequests.has(reqId)) {
          const { resolve, reject } = this.pendingRequests.get(reqId)!;
          this.pendingRequests.delete(reqId);
          if (msg.error) reject(new Error(`Native Model Error: ${msg.error}`));
          else resolve(msg);
        }
      } catch (err) {
        console.error('[Native Bridge Parse Error]', trimmed, err);
      }
    });

    this.bridgeProcess.stderr.on('data', (data) => {
      const errStr = data.toString();
      if (errStr.includes('FATAL') || errStr.includes('FAIL_CLOSED')) {
        console.error('[Native Bridge Fatal]', errStr);
      }
    });

    this.bridgeProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[Native Bridge Exited] with code ${code}. Failing closed.`);
        this.reconcileLifecycleState(
          'Initialization Error',
          `Python bridge exited with code ${code}`,
          'initialization_error'
        );
      }
      this.bridgeProcess = null;
      this.telemetry.pid = null;
    });
  }

  private async sendCommand<T>(cmd: string, params: Record<string, any> = {}, timeoutMs = 15000): Promise<T> {
    if (!this.bridgeProcess || this.bridgeProcess.killed) {
      this.startBridge();
    }

    const reqId = ++this.reqCounter;
    const payload = JSON.stringify({ id: reqId, cmd, params }) + '\n';

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          this.telemetry.totalFailures += 1;
          this.telemetry.consecutiveFailures += 1;
          this.reconcileLifecycleState(
            'Session Timeout',
            `Native Model command '${cmd}' timed out after ${timeoutMs}ms`,
            'session_timeout'
          );
          reject(new Error(`Native Model command '${cmd}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(reqId, {
        resolve: (val) => {
          clearTimeout(timeout);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.bridgeProcess?.stdin.write(payload, (err) => {
        if (err && this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  public async ping(): Promise<PingResult> {
    const started = Date.now();
    this.telemetry.totalPings += 1;
    try {
      const res = await this.sendCommand<PingResult>('ping');
      this.telemetry.lastHeartbeatAt = new Date().toISOString();
      this.telemetry.lastHeartbeatLatencyMs = Math.max(1, Date.now() - started);
      this.lastPingSnapshot = res;
      if (res.inference_ready && res.weights_loaded) {
        this.telemetry.lastVerifiedHeartbeatAt = this.telemetry.lastHeartbeatAt;
      }
      return res;
    } catch (err: any) {
      this.telemetry.totalFailures += 1;
      this.telemetry.consecutiveFailures += 1;
      throw err;
    }
  }

  public async connectivityCheck(presignedUrl?: string): Promise<any> {
    return this.sendCommand('connectivity_check', presignedUrl ? { presignedUrl } : {}, 12000);
  }

  public async reconnect(presignedUrl?: string, objectKey?: string): Promise<any> {
    const params: Record<string, any> = {};
    if (presignedUrl) {
      params.presignedUrl = presignedUrl;
      this.setCloudOverrides({ presignedUrl });
    }
    if (objectKey) params.objectKey = objectKey;
    return this.sendCommand('connectivity_reconnect', params, 45000);
  }

  public async reloadCloudWeights(presignedUrl?: string, objectKey?: string): Promise<any> {
    return this.reconnect(presignedUrl, objectKey);
  }

  public async chat(
    prompt: string,
    role: string = 'coder',
    options: { max_tokens?: number; temperature?: number; correlation_id?: string } = {}
  ): Promise<InferenceResponse> {
    const started = Date.now();
    const res = await this.sendCommand<InferenceResponse>('generate', {
      prompt,
      role,
      max_tokens: options.max_tokens ?? 128,
      temperature: options.temperature ?? 0.7,
      correlation_id: options.correlation_id || `corr_${Date.now()}`,
    });
    const elapsed = Math.max(1, Math.round(res.latency_ms || Date.now() - started));
    const snap = this.lastPingSnapshot;
    if (snap && (snap.weights_loaded || res.checkpoint_hash)) {
      this.lastInferenceEvidence = {
        checkpointPath: snap.checkpoint_path || snap.weights_source || snap.source_uri || '',
        checkpointSha256: snap.checkpoint_sha256 || res.checkpoint_hash || '',
        tokenizerSha256: snap.tokenizer_sha256 || '',
        activeRuntimeId: snap.active_runtime_id || `zyn-rt-${(res.checkpoint_hash || 'unknown').slice(0, 12)}`,
        inferenceTimestamp: new Date().toISOString(),
        executionDurationMs: elapsed,
        inputTokens: res.input_tokens_count || 0,
        outputTokens: res.output_tokens_count || 0,
      };
    }
    return res;
  }

  public async chatStream(
    prompt: string,
    role: string = 'coder',
    onChunk: (chunk: string) => void,
    options: { correlation_id?: string; max_tokens?: number; temperature?: number } = {}
  ): Promise<void> {
    if (!this.bridgeProcess || this.bridgeProcess.killed) this.startBridge();
    const reqId = ++this.reqCounter;
    this.activeStreamCallback = onChunk;
    const timeoutMs = 120000;
    const started = Date.now();
    let chunkCount = 0;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          this.activeStreamCallback = null;
          reject(new Error(`Native inference stream timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const originalCb = onChunk;
      this.activeStreamCallback = (chunk) => {
        chunkCount += 1;
        originalCb(chunk);
      };

      this.pendingRequests.set(reqId, {
        resolve: () => {
          clearTimeout(timeout);
          const snap = this.lastPingSnapshot;
          if (snap && snap.weights_loaded) {
            this.lastInferenceEvidence = {
              checkpointPath: snap.checkpoint_path || snap.weights_source || snap.source_uri || '',
              checkpointSha256: snap.checkpoint_sha256 || snap.checkpoint_hash || '',
              tokenizerSha256: snap.tokenizer_sha256 || '',
              activeRuntimeId: snap.active_runtime_id || `zyn-rt-${(snap.checkpoint_hash || 'unknown').slice(0, 12)}`,
              inferenceTimestamp: new Date().toISOString(),
              executionDurationMs: Math.max(1, Date.now() - started),
              inputTokens: Math.max(1, prompt.length),
              outputTokens: Math.max(1, chunkCount),
            };
          }
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      const payload =
        JSON.stringify({
          id: reqId,
          cmd: 'stream_generate',
          params: {
            prompt,
            role,
            max_tokens: options.max_tokens ?? 128,
            temperature: options.temperature ?? 0.7,
            correlation_id: options.correlation_id || `corr_${Date.now()}`,
          },
        }) + '\n';

      this.bridgeProcess?.stdin.write(payload, (err) => {
        if (err && this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          clearTimeout(timeout);
          this.activeStreamCallback = null;
          reject(err);
        }
      });
    });
  }

  public async batch27Eval(): Promise<any> {
    return this.sendCommand<any>('batch27_eval', {}, 60000);
  }

  public async verifySuite(): Promise<VerificationResult> {
    return this.sendCommand<VerificationResult>('verify_suite');
  }

  public async verifyLanguageIntegrity(): Promise<LanguageIntegrityResult> {
    return this.sendCommand<LanguageIntegrityResult>('verify_language_integrity');
  }

  public async selfEvolve(domain: string = 'algorithm_resilience'): Promise<EvolutionRecord> {
    return this.sendCommand<EvolutionRecord>('self_evolve', { domain });
  }

  public async getMemory(): Promise<any> {
    return this.sendCommand<any>('get_memory');
  }

  public async trainStep(text: string, epochs: number = 2): Promise<any> {
    return this.sendCommand<any>('train_step', { text, epochs }, 60000);
  }

  public async exportCheckpoint(step?: number, loss?: number): Promise<any> {
    return this.sendCommand<any>('export_checkpoint', { step, loss });
  }

  public async inspectCheckpoint(): Promise<any> {
    return this.sendCommand<any>('inspect_checkpoint');
  }
}

export interface ExternalBrainStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  hasBaseUrlOverride: boolean;
  hasApiKey: boolean;
  mode: 'HYBRID_EXTERNAL_BRAIN' | 'UNCONFIGURED';
  reason: string;
}

/**
 * Pluggable External Brain Slot (Hybrid Path A).
 * Connects via standard HTTPS fetch only when ZYNTHEOR_BRAIN_PROVIDER + ZYNTHEOR_BRAIN_API_KEY
 * (or local Ollama) are explicitly configured in environment variables. Fails closed otherwise.
 */
export class ExternalBrainProvider {
  public static getStatus(): ExternalBrainStatus {
    const provider = (process.env.ZYNTHEOR_BRAIN_PROVIDER || '').trim().toLowerCase();
    const model = (process.env.ZYNTHEOR_BRAIN_MODEL || '').trim();
    const baseUrl = (process.env.ZYNTHEOR_BRAIN_BASE_URL || '').trim();
    const hasKey = Boolean((process.env.ZYNTHEOR_BRAIN_API_KEY || '').trim());
    const configured = Boolean(provider && (hasKey || provider === 'ollama'));

    return {
      configured,
      provider: provider || null,
      model: model || null,
      hasBaseUrlOverride: Boolean(baseUrl),
      hasApiKey: hasKey,
      mode: configured ? 'HYBRID_EXTERNAL_BRAIN' : 'UNCONFIGURED',
      reason: configured
        ? `External reasoning slot configured (${provider}${model ? `:${model}` : ''}); deterministic sandbox still gates every execution.`
        : 'FAIL_CLOSED: ZYNTHEOR_BRAIN_PROVIDER / ZYNTHEOR_BRAIN_API_KEY not configured (Zero-Simulation active; deterministic scaffold handles verified blueprints).',
    };
  }
}
