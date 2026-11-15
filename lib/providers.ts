/**
 * ZYNTHEOR Sovereign Neural Providers
 * 100% First-Party Native Neural LM Provider.
 * ABSOLUTE ZERO-TOLERANCE for external AI APIs (@google/genai, openai, anthropic, gemini, etc.)
 * Communicates with python3 -m qplus_native.bridge using stdin/stdout.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import readline from 'readline';

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

export class NativeNeuralLMProvider {
  private static instance: NativeNeuralLMProvider | null = null;
  private bridgeProcess: ChildProcessWithoutNullStreams | null = null;
  private reqCounter = 0;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private activeStreamCallback: ((chunk: string) => void) | null = null;
  private activeStreamDone: (() => void) | null = null;

  private constructor() {
    this.startBridge();
  }

  public static getInstance(): NativeNeuralLMProvider {
    if (!NativeNeuralLMProvider.instance) {
      NativeNeuralLMProvider.instance = new NativeNeuralLMProvider();
    }
    return NativeNeuralLMProvider.instance;
  }

  private startBridge(): void {
    const cwd = process.cwd();
    this.bridgeProcess = spawn('python3', ['-m', 'qplus_native.bridge'], {
      cwd,
      env: {
        ...process.env,
        PYTHONPATH: cwd
      }
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
        
        // Handle stream chunk events
        if (msg.type === 'chunk' && this.activeStreamCallback) {
          this.activeStreamCallback(msg.text);
          return;
        }
        if (msg.type === 'done' && this.activeStreamDone) {
          this.activeStreamDone();
          this.activeStreamDone = null;
          this.activeStreamCallback = null;
          return;
        }

        const reqId = msg.id;
        if (reqId !== undefined && this.pendingRequests.has(reqId)) {
          const { resolve, reject } = this.pendingRequests.get(reqId)!;
          this.pendingRequests.delete(reqId);
          if (msg.error) {
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
      if (errStr.includes('FATAL') || errStr.includes('FAIL_CLOSED')) {
        console.error('[Native Bridge Fatal]', errStr);
      }
    });

    this.bridgeProcess.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[Native Bridge Exited] with code ${code}. Failing closed.`);
      }
      this.bridgeProcess = null;
    });
  }

  private async sendCommand<T>(cmd: string, params: Record<string, any> = {}, timeoutMs = 10000): Promise<T> {
    if (!this.bridgeProcess || this.bridgeProcess.killed) {
      this.startBridge();
    }

    const reqId = ++this.reqCounter;
    const payload = JSON.stringify({ id: reqId, cmd, params }) + '\n';

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`Native Model command '${cmd}' timed out after 10000ms`));
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
        }
      });

      this.bridgeProcess?.stdin.write(payload);
    });
  }

  public async ping(): Promise<{
    status: string;
    model_name: string;
    architecture: string;
    total_params: number;
    checkpoint_hash: string;
    weights_loaded: boolean;
  }> {
    return this.sendCommand('ping');
  }

  public async chat(
    prompt: string,
    role: string = 'coder',
    options: { max_tokens?: number; temperature?: number; correlation_id?: string } = {}
  ): Promise<InferenceResponse> {
    return this.sendCommand<InferenceResponse>('generate', {
      prompt,
      role,
      max_tokens: options.max_tokens || 1024,
      temperature: options.temperature || 0.2,
      correlation_id: options.correlation_id || `corr_${Date.now()}`
    });
  }

  public async chatStream(
    prompt: string,
    role: string = 'coder',
    onChunk: (chunk: string) => void,
    options: { correlation_id?: string } = {}
  ): Promise<void> {
    if (!this.bridgeProcess || this.bridgeProcess.killed) {
      this.startBridge();
    }

    const reqId = ++this.reqCounter;
    this.activeStreamCallback = onChunk;

    return new Promise<void>((resolve, reject) => {
      this.activeStreamDone = resolve;

      const timeout = setTimeout(() => {
        this.activeStreamDone = null;
        this.activeStreamCallback = null;
        reject(new Error(`Stream timed out for prompt`));
      }, 15000);

      const origDone = this.activeStreamDone;
      this.activeStreamDone = () => {
        clearTimeout(timeout);
        if (origDone) origDone();
      };

      const payload = JSON.stringify({
        id: reqId,
        cmd: 'stream_generate',
        params: {
          prompt,
          role,
          correlation_id: options.correlation_id || `corr_${Date.now()}`
        }
      }) + '\n';

      this.bridgeProcess?.stdin.write(payload);
    });
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
    // CPU-native training is intentionally allowed more time than inference/health calls.
    return this.sendCommand<any>('train_step', { text, epochs }, 60000);
  }

  public async exportCheckpoint(step?: number, loss?: number): Promise<any> {
    return this.sendCommand<any>('export_checkpoint', { step, loss });
  }

  public async inspectCheckpoint(): Promise<any> {
    return this.sendCommand<any>('inspect_checkpoint');
  }
}
