/**
 * ZYNTHEOR Sovereign Neural Providers
 * 100% First-Party Native Neural LM Provider.
 * ABSOLUTE ZERO-TOLERANCE for external AI APIs (@google/genai, openai, anthropic, gemini, etc.)
 * Communicates with python3 -m qplus_native.bridge using stdin/stdout.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import readline from 'readline';

export type RuntimeLifecycleState =
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'NOT_LOADED'
  | 'NOT_TRAINED'
  | 'INITIALIZING'
  | 'READY'
  | 'QUALITY_BLOCKED'
  | 'FAILED';

export type BridgeLifecycleState =
  | 'Initializing'
  | 'Connecting'
  | 'Connected'
  | 'Degraded'
  | 'Reconnecting'
  | 'Unreachable'
  | 'Service Error';

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
}

export function computeExponentialBackoffMs(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
  jitterMs = 0
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const raw = baseDelayMs * Math.pow(2, safeAttempt - 1) + Math.max(0, jitterMs);
  return Math.min(maxDelayMs, Math.round(raw));
}

export interface InferenceEvidence {
  checkpointPath: string | null;
  checkpointSha256: string | null;
  tokenizerSha256: string | null;
  activeRuntimeId: string | null;
  inferenceTimestamp: string;
  executionDurationMs: number;
}

export interface InferenceResponse {
  text: string;
  input_tokens_count: number;
  output_tokens_count: number;
  latency_ms: number;
  tokens_per_sec: number;
  checkpoint_hash: string;
  checkpoint_path?: string | null;
  checkpoint_sha256?: string | null;
  tokenizer_sha256?: string | null;
  active_runtime_id?: string | null;
  inference_timestamp?: string;
  execution_duration_ms?: number;
  latent_norm: number;
  total_params?: number;
  inference_origin?: string;
  weights_role?: string;
  grounding_origin?: string;
  max_context_len?: number;
  effective_context_len?: number;
  prompt_truncated?: boolean;
  cancelled?: boolean;
}

export interface VerificationResult {
  verified: boolean;
  status: 'VERIFIED' | 'PARTIAL' | 'PARTIAL_BLOCKED' | 'FAILED';
  total_tests: number;
  passed_tests: number;
  summary: {
    passed: number;
    failed: number;
    blocked: number;
    partial: number;
  };
  checkpoint_hash: string;
  runtime_state: RuntimeLifecycleState;
  weights_role: string;
  execution_verified: boolean;
  timestamp: number;
  results: Array<{
    test_id: string;
    name: string;
    status: 'PASS' | 'FAIL' | 'BLOCKED' | 'PARTIAL';
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

export class NativeNeuralLMProvider {
  private static instance: NativeNeuralLMProvider | null = null;
  private bridgeProcess: ChildProcessWithoutNullStreams | null = null;
  private reqCounter = 0;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private activeStreamCallback: ((chunk: string, meta?: any) => void) | null = null;
  private activeStreamDone: ((doneMeta?: any) => void) | null = null;
  private activeStreamError: ((err: Error) => void) | null = null;
  private activeStreamReqId: number | null = null;

  private readonly events = new EventEmitter();
  private lifecycleState: BridgeLifecycleState = 'Initializing';
  private previousLifecycleState: BridgeLifecycleState | null = null;
  private transitionAt: string = new Date().toISOString();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalMs = 15000;
  private heartbeatInFlight = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private readonly maxReconnectAttempts = 6;
  private nextRetryDelayMs: number | null = null;
  private nextRetryAt: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private lastHeartbeatLatencyMs: number | null = null;
  private consecutiveFailures = 0;
  private totalPings = 0;
  private totalFailures = 0;
  private lastLifecycleError: string | null = null;
  private isShuttingDown = false;
  private lastInferenceEvidence: InferenceEvidence | null = null;

  private constructor() {
    this.startBridge();
  }

  public getLastInferenceEvidence(): InferenceEvidence | null {
    return this.lastInferenceEvidence ? { ...this.lastInferenceEvidence } : null;
  }

  private recordInferenceEvidence(res: any): void {
    if (!res || typeof res !== 'object') return;
    if (res.cancelled) return;
    const ckptSha = res.checkpoint_sha256 || res.checkpoint_hash || null;
    const tokSha = res.tokenizer_sha256 || null;
    const rtId = res.active_runtime_id || null;
    if (!ckptSha || !tokSha || !rtId) return;
    this.lastInferenceEvidence = {
      checkpointPath: res.checkpoint_path || res.weights_source || null,
      checkpointSha256: String(ckptSha),
      tokenizerSha256: String(tokSha),
      activeRuntimeId: String(rtId),
      inferenceTimestamp: String(res.inference_timestamp || new Date().toISOString()),
      executionDurationMs: Number(res.execution_duration_ms ?? res.latency_ms ?? 0),
    };
  }

  public static getInstance(): NativeNeuralLMProvider {
    if (!NativeNeuralLMProvider.instance) {
      NativeNeuralLMProvider.instance = new NativeNeuralLMProvider();
    }
    return NativeNeuralLMProvider.instance;
  }

  private lastStderr = '';

  public onLifecycleChange(listener: (telemetry: BridgeLifecycleTelemetry) => void): () => void {
    this.events.on('lifecycle', listener);
    return () => {
      this.events.off('lifecycle', listener);
    };
  }

  public getLifecycleTelemetry(): BridgeLifecycleTelemetry {
    return {
      state: this.lifecycleState,
      previousState: this.previousLifecycleState,
      transitionAt: this.transitionAt,
      pid: this.bridgeProcess?.pid ?? null,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastHeartbeatLatencyMs: this.lastHeartbeatLatencyMs,
      reconnectAttempt: this.reconnectAttempt,
      maxReconnectAttempts: this.maxReconnectAttempts,
      nextRetryDelayMs: this.nextRetryDelayMs,
      nextRetryAt: this.nextRetryAt,
      consecutiveFailures: this.consecutiveFailures,
      totalPings: this.totalPings,
      totalFailures: this.totalFailures,
      lastError: this.lastLifecycleError,
    };
  }

  public reconcileLifecycleState(nextState: BridgeLifecycleState, errorReason: string | null = null): BridgeLifecycleTelemetry {
    this.transitionLifecycle(nextState, errorReason);
    return this.getLifecycleTelemetry();
  }

  private transitionLifecycle(nextState: BridgeLifecycleState, errorReason: string | null = null): void {
    const changed = this.lifecycleState !== nextState || errorReason !== this.lastLifecycleError;
    if (this.lifecycleState !== nextState) {
      this.previousLifecycleState = this.lifecycleState;
      this.lifecycleState = nextState;
      this.transitionAt = new Date().toISOString();
    }
    if (errorReason !== undefined) {
      this.lastLifecycleError = errorReason;
    }
    if (changed) {
      this.events.emit('lifecycle', this.getLifecycleTelemetry());
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.nextRetryDelayMs = null;
    this.nextRetryAt = null;
  }

  private scheduleReconnect(reason: string): void {
    if (this.reconnectTimer) {
      return;
    }
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.transitionLifecycle('Unreachable', `Bridge reconnect exhausted after ${this.reconnectAttempt} attempts (${reason})`);
      return;
    }
    this.reconnectAttempt += 1;
    const jitter = Math.floor(Math.random() * 200);
    const delayMs = computeExponentialBackoffMs(this.reconnectAttempt, 1000, 30000, jitter);
    this.nextRetryDelayMs = delayMs;
    this.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    this.transitionLifecycle('Reconnecting', reason);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.nextRetryDelayMs = null;
      this.nextRetryAt = null;
      this.startBridge();
      void this.probeHeartbeat().catch(() => null);
    }, delayMs);
    if (typeof this.reconnectTimer.unref === 'function') {
      this.reconnectTimer.unref();
    }
  }

  public async probeHeartbeat(timeoutMs = 5000): Promise<BridgeLifecycleTelemetry> {
    if (this.heartbeatInFlight) {
      return this.getLifecycleTelemetry();
    }
    this.heartbeatInFlight = true;
    const started = Date.now();
    try {
      const pingRes = await this.sendCommand<any>('ping', {}, timeoutMs);
      const latency = Math.max(1, Date.now() - started);
      this.totalPings += 1;
      this.consecutiveFailures = 0;
      this.reconnectAttempt = 0;
      this.lastHeartbeatAt = new Date().toISOString();
      this.lastHeartbeatLatencyMs = latency;

      const isReady = Boolean(
        pingRes?.weights_loaded &&
        pingRes?.execution_verified &&
        pingRes?.runtime_state === 'READY'
      );
      if (isReady) {
        this.transitionLifecycle('Connected', null);
      } else {
        const reason = pingRes?.error || pingRes?.execution_error || `Runtime state=${pingRes?.runtime_state || 'NOT_CONFIGURED'}`;
        this.transitionLifecycle('Degraded', reason);
      }
    } catch (err: any) {
      this.totalFailures += 1;
      this.consecutiveFailures += 1;
      const msg = err?.message || String(err);
      if (msg.includes('timed out')) {
        this.transitionLifecycle('Unreachable', msg);
      } else if (!this.reconnectTimer) {
        this.transitionLifecycle('Service Error', msg);
      }
    } finally {
      this.heartbeatInFlight = false;
    }
    return this.getLifecycleTelemetry();
  }

  public startHeartbeat(intervalMs = 15000): void {
    const safeInterval = Math.max(2000, intervalMs);
    if (this.heartbeatTimer && this.heartbeatIntervalMs === safeInterval) {
      return;
    }
    this.stopHeartbeat();
    this.heartbeatIntervalMs = safeInterval;
    this.heartbeatTimer = setInterval(() => {
      if (!this.isBridgeDead()) {
        void this.probeHeartbeat().catch(() => null);
      }
    }, safeInterval);
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearReconnectTimer();
  }

  public forceReconnectNow(): void {
    this.isShuttingDown = false;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    if (this.isBridgeDead()) {
      this.bridgeProcess = null;
      this.startBridge();
    }
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.stopHeartbeat();
    const proc = this.bridgeProcess;
    this.bridgeProcess = null;
    if (proc && !proc.killed && proc.exitCode === null) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        proc.once('exit', done);
        try {
          proc.kill('SIGTERM');
        } catch {
          resolve();
          return;
        }
        const t = setTimeout(() => {
          try {
            if (proc.exitCode === null) proc.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 500);
        if (typeof t.unref === 'function') t.unref();
      });
    }
    this.transitionLifecycle('Unreachable', 'Bridge intentionally shut down');
  }

  private startBridge(): void {
    this.isShuttingDown = false;
    this.clearReconnectTimer();
    const cwd = process.cwd();
    this.lastStderr = '';
    this.transitionLifecycle('Connecting', this.lastLifecycleError);
    try {
      this.bridgeProcess = spawn('python3', ['-m', 'qplus_native.bridge'], {
        cwd,
        env: {
          ...process.env,
          PYTHONPATH: cwd
        }
      });
    } catch (spawnErr: any) {
      this.bridgeProcess = null;
      this.totalFailures += 1;
      this.consecutiveFailures += 1;
      this.scheduleReconnect(`Spawn failure: ${spawnErr?.message || spawnErr}`);
      return;
    }

    this.bridgeProcess.on('error', (procErr) => {
      this.totalFailures += 1;
      this.consecutiveFailures += 1;
      this.bridgeProcess = null;
      this.scheduleReconnect(`Bridge process error: ${procErr.message}`);
    });

    const rl = readline.createInterface({
      input: this.bridgeProcess.stdout,
      terminal: false
    });

    rl.on('line', (line) => {
      line = line.trim();
      if (!line) return;
      try {
        const msg = JSON.parse(line);
        
        // Handle stream chunk & done events
        if (msg.type === 'chunk' && this.activeStreamCallback && msg.id === this.activeStreamReqId) {
          this.activeStreamCallback(msg.text, msg);
          return;
        }
        if (msg.type === 'done' && this.activeStreamDone && msg.id === this.activeStreamReqId) {
          const doneCb = this.activeStreamDone;
          this.activeStreamDone = null;
          this.activeStreamCallback = null;
          this.activeStreamError = null;
          this.activeStreamReqId = null;
          doneCb(msg);
          return;
        }
        if (msg.id === this.activeStreamReqId && msg.error && this.activeStreamError) {
          const errCb = this.activeStreamError;
          this.activeStreamDone = null;
          this.activeStreamCallback = null;
          this.activeStreamError = null;
          this.activeStreamReqId = null;
          errCb(new Error(`Native Model Error: ${msg.error}`));
          return;
        }

        const reqId = msg.id;
        if (reqId !== undefined && this.pendingRequests.has(reqId)) {
          const { resolve, reject } = this.pendingRequests.get(reqId)!;
          this.pendingRequests.delete(reqId);
          if (msg.error && msg.status !== 'fail_closed') {
            reject(new Error(`Native Model Error: ${msg.error}`));
          } else {
            resolve(msg);
          }
        }
      } catch (err) {
        console.error('[Native Bridge Parse Error]', line, err);
      }
    });

    this.bridgeProcess.stderr.on('data', (data) => {
      const errStr = data.toString();
      this.lastStderr = (this.lastStderr + errStr).slice(-2000);
      if (errStr.includes('FATAL') || errStr.includes('FAIL_CLOSED')) {
        console.error('[Native Bridge Fatal]', errStr);
      }
    });

    this.bridgeProcess.on('exit', (code) => {
      const reason = this.lastStderr.trim() || `Native Bridge exited with code ${code}`;
      if (code !== 0) {
        console.error(`[Native Bridge Exited] with code ${code}. Failing closed: ${reason}`);
      }
      for (const [reqId, pending] of this.pendingRequests.entries()) {
        this.pendingRequests.delete(reqId);
        pending.reject(new Error(reason));
      }
      if (this.activeStreamError) {
        const errCb = this.activeStreamError;
        this.activeStreamDone = null;
        this.activeStreamCallback = null;
        this.activeStreamError = null;
        this.activeStreamReqId = null;
        errCb(new Error(reason));
      } else if (this.activeStreamDone) {
        this.activeStreamDone({});
        this.activeStreamDone = null;
        this.activeStreamCallback = null;
        this.activeStreamError = null;
        this.activeStreamReqId = null;
      }
      this.bridgeProcess = null;
      if (this.isShuttingDown) {
        return;
      }
      this.totalFailures += 1;
      this.consecutiveFailures += 1;
      if (code !== 0) {
        this.transitionLifecycle('Service Error', reason);
      }
      this.scheduleReconnect(reason);
    });
  }

  private isBridgeDead(): boolean {
    return (
      !this.bridgeProcess ||
      this.bridgeProcess.killed ||
      this.bridgeProcess.exitCode !== null ||
      !this.bridgeProcess.stdin ||
      !this.bridgeProcess.stdin.writable
    );
  }

  private async sendCommand<T>(cmd: string, params: Record<string, any> = {}, timeoutMs = 10000): Promise<T> {
    if (this.isBridgeDead()) {
      if (this.reconnectTimer) {
        throw new Error(
          `FAIL_CLOSED: Bridge lifecycle='${this.lifecycleState}' (retry scheduled at ${this.nextRetryAt || 'pending'})`
        );
      }
      this.bridgeProcess = null;
      this.startBridge();
    }

    const reqId = ++this.reqCounter;
    const payload = JSON.stringify({ id: reqId, cmd, params }) + '\n';

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          this.totalFailures += 1;
          this.consecutiveFailures += 1;
          this.transitionLifecycle('Unreachable', `Native Model command '${cmd}' timed out after ${timeoutMs}ms`);
          reject(new Error(`Native Model command '${cmd}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(reqId, {
        resolve: (val) => {
          clearTimeout(timeout);
          this.totalPings += 1;
          this.consecutiveFailures = 0;
          this.lastHeartbeatAt = new Date().toISOString();
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });

      try {
        this.bridgeProcess?.stdin.write(payload, (writeErr) => {
          if (writeErr && this.pendingRequests.has(reqId)) {
            this.pendingRequests.delete(reqId);
            clearTimeout(timeout);
            reject(writeErr);
          }
        });
      } catch (err: any) {
        this.pendingRequests.delete(reqId);
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /** P2: text from learned logits only (v2 checkpoint). Fails closed if the checkpoint is absent. */
  public async learnedGenerate(prompt: string, opts: { maxNewTokens?: number; temperature?: number; topK?: number; seed?: number } = {}): Promise<any> {
    const out = await this.sendCommand('learned_generate', {
      prompt,
      max_new_tokens: opts.maxNewTokens ?? 64,
      temperature: opts.temperature ?? 0.8,
      top_k: opts.topK ?? 20,
      seed: opts.seed
    }, 30000);
    this.recordInferenceEvidence(out);
    return out;
  }

  /** Generate directly from the verified 41.53M NativeLM target checkpoint. */
  public async targetGenerate(prompt: string, opts: {
    maxNewTokens?: number;
    temperature?: number;
    topK?: number;
    repetitionPenalty?: number;
    seed?: number;
  } = {}): Promise<any> {
    const out = await this.sendCommand('target_generate', {
      prompt,
      max_new_tokens: opts.maxNewTokens ?? 64,
      temperature: opts.temperature ?? 0.8,
      top_k: opts.topK ?? 20,
      repetition_penalty: opts.repetitionPenalty ?? 1.08,
      seed: opts.seed
    }, 300000);
    this.recordInferenceEvidence(out);
    return out;
  }

  public async connectivityCheck(presignedUrl?: string): Promise<{
    online: boolean;
    status: string;
    code: string | null;
    reason: string;
    source_uri: string | null;
    weights_loaded: boolean;
    weights_source: string | null;
    checkpoint_path?: string | null;
    checkpoint_sha256?: string | null;
    tokenizer_sha256?: string | null;
    active_runtime_id?: string | null;
    boot_error?: string | null;
    runtime_state?: RuntimeLifecycleState;
    execution_verified?: boolean;
    execution_error?: string | null;
    trained_provenance?: string | null;
    weights_role?: string | null;
    tensor_validation_ok?: boolean;
  }> {
    return this.sendCommand('connectivity_check', { presigned_url: presignedUrl }, 10000);
  }

  public async reloadCloudWeights(presignedUrl?: string, objectKey?: string): Promise<any> {
    this.lastInferenceEvidence = null;
    return this.sendCommand('reload_cloud_weights', {
      presigned_url: presignedUrl,
      object_key: objectKey,
    }, 30000);
  }

  public async ping(): Promise<{
    status: string;
    fail_closed?: boolean;
    code?: string;
    message?: string;
    online_connectivity_required?: boolean;
    error?: string;
    runtime_state?: RuntimeLifecycleState;
    execution_verified?: boolean;
    execution_error?: string | null;
    trained_provenance?: string | null;
    weights_role?: string | null;
    tensor_validation_ok?: boolean;
    model_name: string | null;
    architecture: string | null;
    total_params: number;
    trained_subgraph_params: number;
    target_total_params: number;
    vocab_size: number;
    storage_mode: string;
    weights_source: string | null;
    checkpoint_path?: string | null;
    checkpoint_hash: string;
    checkpoint_sha256?: string | null;
    tokenizer_sha256?: string | null;
    active_runtime_id?: string | null;
    weights_loaded: boolean;
  }> {
    return this.sendCommand('ping', {}, 30000);
  }

  public async cancelInference(correlationId?: string): Promise<{ cancelled: boolean; correlation_id?: string | null }> {
    if (this.isBridgeDead()) {
      return { cancelled: false, correlation_id: correlationId || null };
    }
    return this.sendCommand('cancel_inference', { correlation_id: correlationId }, 5000);
  }

  public async batch27Eval(): Promise<any> {
    return this.sendCommand('batch27_eval', {}, 60000);
  }

  public async chat(
    prompt: string,
    role: string = 'coder',
    options: { max_tokens?: number; temperature?: number; correlation_id?: string } = {}
  ): Promise<InferenceResponse & { architecture?: string }> {
    const isChatRole = role === 'chat' || role === 'assistant';
    const out = await this.sendCommand<InferenceResponse & { architecture?: string }>('generate', {
      prompt,
      role,
      max_tokens: options.max_tokens || 1024,
      temperature: options.temperature || (isChatRole ? 0.8 : 0.2),
      correlation_id: options.correlation_id || `corr_${Date.now()}`
    }, isChatRole ? 180000 : 15000);
    this.recordInferenceEvidence(out);
    return out;
  }

  public async chatStream(
    prompt: string,
    role: string = 'coder',
    onChunk: (chunk: string, meta?: any) => void,
    options: {
      correlation_id?: string;
      max_new_tokens?: number;
      temperature?: number;
      top_k?: number;
      repetition_penalty?: number;
      seed?: number;
      signal?: AbortSignal;
    } = {}
  ): Promise<any> {
    if (this.isBridgeDead()) {
      this.bridgeProcess = null;
      this.startBridge();
    }

    const correlationId = options.correlation_id || `corr_${Date.now()}`;
    if (options.signal?.aborted) {
      return {
        output_tokens_count: 0,
        cancelled: true,
        correlation_id: correlationId,
      };
    }

    const reqId = ++this.reqCounter;
    this.activeStreamReqId = reqId;
    this.activeStreamCallback = onChunk;

    return new Promise<any>((resolve, reject) => {
      const cleanupAbort = () => {
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        void this.cancelInference(correlationId).catch(() => null);
      };

      if (options.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const timeout = setTimeout(() => {
        cleanupAbort();
        if (this.activeStreamReqId === reqId) {
          this.activeStreamDone = null;
          this.activeStreamCallback = null;
          this.activeStreamError = null;
          this.activeStreamReqId = null;
        }
        reject(new Error('Stream timed out for prompt'));
      }, 120000);

      this.activeStreamDone = (doneMeta?: any) => {
        clearTimeout(timeout);
        cleanupAbort();
        this.recordInferenceEvidence(doneMeta);
        resolve(doneMeta || {});
      };

      this.activeStreamError = (err: Error) => {
        clearTimeout(timeout);
        cleanupAbort();
        reject(err);
      };

      const payload = JSON.stringify({
        id: reqId,
        cmd: 'stream_generate',
        params: {
          prompt,
          role,
          correlation_id: correlationId,
          max_new_tokens: options.max_new_tokens ?? 32,
          temperature: options.temperature ?? 0.8,
          top_k: options.top_k ?? 20,
          repetition_penalty: options.repetition_penalty ?? 1.08,
          seed: options.seed
        }
      }) + '\n';

      try {
        this.bridgeProcess?.stdin.write(payload, (writeErr) => {
          if (writeErr && this.activeStreamError && this.activeStreamReqId === reqId) {
            const errCb = this.activeStreamError;
            this.activeStreamDone = null;
            this.activeStreamCallback = null;
            this.activeStreamError = null;
            this.activeStreamReqId = null;
            errCb(writeErr);
          }
        });
      } catch (writeErr: any) {
        if (this.activeStreamError && this.activeStreamReqId === reqId) {
          const errCb = this.activeStreamError;
          this.activeStreamDone = null;
          this.activeStreamCallback = null;
          this.activeStreamError = null;
          this.activeStreamReqId = null;
          errCb(writeErr);
        }
      }
    });
  }

  public async verifySuite(): Promise<VerificationResult> {
    return this.sendCommand<VerificationResult>('verify_suite', {}, 30000);
  }

  public async verifyLanguageIntegrity(): Promise<LanguageIntegrityResult> {
    return this.sendCommand<LanguageIntegrityResult>('verify_language_integrity', {}, 30000);
  }

  public async selfEvolve(domain: string = 'algorithm_resilience'): Promise<EvolutionRecord> {
    return this.sendCommand<EvolutionRecord>('self_evolve', { domain });
  }

  public async getMemory(): Promise<any> {
    return this.sendCommand<any>('get_memory');
  }

  public async trainStep(text: string, epochs: number = 2): Promise<any> {
    // CPU-native training is intentionally allowed more time than inference/health calls.
    return this.sendCommand<any>('train_step', { text, epochs }, 60000);
  }

  public async exportCheckpoint(step?: number, loss?: number): Promise<any> {
    return this.sendCommand<any>('export_checkpoint', { step, loss });
  }

  public async inspectCheckpoint(): Promise<any> {
    return this.sendCommand<any>('inspect_checkpoint', {}, 20000);
  }

  public async checkpointDiagnostics(reload: boolean = false): Promise<any> {
    return this.sendCommand<any>('checkpoint_diagnostics', { reload }, 60000);
  }

  public async targetBenchmark(opts: {
    prompt?: string;
    maxNewTokens?: number;
    temperature?: number;
    seed?: number;
  } = {}): Promise<any> {
    return this.sendCommand<any>('benchmark_target', {
      prompt: opts.prompt ?? 'ZYNTHEOR Sovereign NativeLM benchmark',
      max_new_tokens: opts.maxNewTokens ?? 12,
      temperature: opts.temperature ?? 0.0,
      seed: opts.seed ?? 42
    }, 180000);
  }

  public async switchCheckpoint(opts: {
    checkpointSource?: string;
    presignedUrl?: string;
    objectKey?: string;
  } | string): Promise<any> {
    const params = typeof opts === 'string'
      ? { checkpoint_path: opts }
      : {
          checkpoint_path: opts.checkpointSource,
          presigned_url: opts.presignedUrl,
          object_key: opts.objectKey,
        };
    return this.sendCommand<any>('switch_checkpoint', params, 30000);
  }

  public async autonomousBuild(opts: {
    goal: string;
    priority?: 'High' | 'Medium' | 'Low';
    subdir?: string;
    packageZip?: boolean;
  }): Promise<any> {
    return this.sendCommand<any>('autonomous_build', {
      goal: opts.goal,
      priority: opts.priority ?? 'Medium',
      subdir: opts.subdir,
      package_zip: opts.packageZip ?? true
    }, 60000);
  }

  public async runAcceptanceScenario(opts: {
    goal?: string;
    priority?: 'High' | 'Medium' | 'Low';
    subdir?: string;
  } = {}): Promise<any> {
    return this.sendCommand<any>('run_acceptance_scenario', {
      goal: opts.goal,
      priority: opts.priority ?? 'High',
      subdir: opts.subdir
    }, 60000);
  }
}
