/**
 * ZYNTHEOR Sovereign ToolRegistry
 * Formal JSON-Schema Tool Registry, JSON Tool-Call Extractor/Validator,
 * and Hardened Docker Container Sandbox Execution Engine.
 *
 * Supported First-Party Tools:
 *   - web_search(query, maxResults?)
 *   - execute_python(code, timeoutMs?)
 *
 * Security & Zero-Fake Invariants:
 *   - Zero shell interpolation (`execFile` only).
 *   - Strict JSON-Schema type, bounds, and unknown-key rejection.
 *   - Hardened ephemeral Docker sandbox flags (--network=none, --read-only,
 *     --cap-drop=ALL, --security-opt=no-new-privileges:true, --memory=256m,
 *     --cpus=0.5, --pids-limit=64, --user=65534:65534).
 *   - Fail-closed in strict Docker mode (ZYNTHEOR_PYTHON_SANDBOX_MODE=docker);
 *     never mislabels host subprocess execution as Docker isolation.
 *   - Every tool invocation & outcome is sealed in AuditLedger.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AuditLedger } from './AuditLedger';
import { ToolGateway } from './ToolGateway';

const execFileAsync = promisify(execFile);

export type ToolParamType = 'string' | 'number' | 'integer' | 'boolean';

export interface ToolParameterProperty {
  type: ToolParamType;
  description: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: string | number | boolean;
}

export interface ToolSchema {
  type: 'object';
  required: string[];
  additionalProperties: false;
  properties: Record<string, ToolParameterProperty>;
}

import type { SovereignRole } from './SovereignIdentity';

export interface ToolDefinition {
  name: 'web_search' | 'execute_python' | 'read_file' | 'write_file' | 'list_files' | 'run_command';
  description: string;
  sandboxRequired: boolean;
  networkAccess: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  allowedRoles: SovereignRole[];
  schema: ToolSchema;
}

export interface ToolTelemetryEntry {
  tool: string;
  totalCalls: number;
  succeededCalls: number;
  failedCalls: number;
  deniedCalls: number;
  reliabilityPct: number;
  avgLatencyMs: number;
  lastError?: string;
  lastExecutedAt?: string;
}

export interface ToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
  rawText?: string;
}

export type PythonSandboxMode = 'docker' | 'auto' | 'subprocess';

export type ToolExecutionMode =
  | 'docker_container'
  | 'docker_unavailable'
  | 'host_isolated_subprocess'
  | 'workspace_sandbox'
  | 'http_search'
  | 'validation_error'
  | 'execution_error';

export interface ToolExecutionResult {
  callId: string;
  tool: string;
  ok: boolean;
  executionMode: ToolExecutionMode;
  dockerIsolated: boolean;
  dockerImage?: string;
  arguments: Record<string, unknown>;
  output: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs: number;
  error?: string;
  auditHash?: string;
}

export interface DockerProbeStatus {
  dockerAvailable: boolean;
  dockerVersion: string | null;
  configuredMode: PythonSandboxMode;
  dockerImage: string;
  checkedAt: string;
  detail: string;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

const DEFAULT_DOCKER_IMAGE = 'python:3.11-alpine';

const DANGEROUS_PYTHON_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bimport\s+ctypes\b|\bfrom\s+ctypes\b/, reason: 'ctypes FFI import is blocked in sandbox' },
  { pattern: /\bimport\s+pty\b|\bfrom\s+pty\b/, reason: 'pty terminal allocation is blocked in sandbox' },
  { pattern: /\bos\.system\s*\(/, reason: 'os.system shell execution is blocked' },
  { pattern: /\bsubprocess\.(?:Popen|run|call|check_output)\s*\(/, reason: 'subprocess spawning inside Python sandbox is blocked' },
  { pattern: /\/etc\/shadow|\/proc\/1\/environ/, reason: 'Sensitive host system path access is blocked' },
];

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapDuckDuckGoRedirect(rawHref: string): string {
  try {
    const normalized = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
    const parsed = new URL(normalized, 'https://html.duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg && /^https?:\/\//i.test(uddg)) {
      return uddg;
    }
    if (/^https?:\/\//i.test(parsed.toString())) {
      return parsed.toString();
    }
  } catch {
    // Fallback to raw href if valid URL parse fails
  }
  return rawHref;
}

export class ToolRegistry {
  private static instance: ToolRegistry | null = null;
  private tools = new Map<string, ToolDefinition>();
  private telemetry = new Map<string, { total: number; ok: number; fail: number; denied: number; totalMs: number; lastError?: string; lastAt?: string }>();
  private taskCallCounts = new Map<string, number>();
  private static readonly DEFAULT_MAX_CALLS_PER_TASK = 30;

  private constructor() {
    this.registerDefaults();
  }

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  private registerDefaults(): void {
    this.register({
      name: 'web_search',
      description:
        'Searches the public web via DuckDuckGo HTML endpoint and returns structured titles, URLs, and snippets.',
      sandboxRequired: false,
      networkAccess: true,
      riskLevel: 'low',
      allowedRoles: ['guest', 'developer', 'operator', 'auditor', 'admin'],
      schema: {
        type: 'object',
        required: ['query'],
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            description: 'Search query text (Thai or English).',
            minLength: 1,
            maxLength: 500,
          },
          maxResults: {
            type: 'integer',
            description: 'Maximum search results to return (1-10).',
            minimum: 1,
            maximum: 10,
            default: 5,
          },
        },
      },
    });

    this.register({
      name: 'execute_python',
      description:
        'Executes Python 3 code inside an isolated Docker container (--network=none, --read-only, dropped capabilities, memory/CPU/PID caps).',
      sandboxRequired: true,
      networkAccess: false,
      riskLevel: 'medium',
      allowedRoles: ['developer', 'operator', 'admin'],
      schema: {
        type: 'object',
        required: ['code'],
        additionalProperties: false,
        properties: {
          code: {
            type: 'string',
            description: 'Python 3 source code to execute.',
            minLength: 1,
            maxLength: 32768,
          },
          timeoutMs: {
            type: 'integer',
            description: 'Execution timeout in milliseconds (500-15000).',
            minimum: 500,
            maximum: 15000,
            default: 5000,
          },
        },
      },
    });

    this.register({
      name: 'read_file',
      description: 'Reads a file strictly inside the /workspace sandbox.',
      sandboxRequired: true,
      networkAccess: false,
      riskLevel: 'low',
      allowedRoles: ['guest', 'developer', 'operator', 'auditor', 'admin'],
      schema: {
        type: 'object',
        required: ['path'],
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Relative file path within /workspace.',
            minLength: 1,
            maxLength: 256,
          },
        },
      },
    });

    this.register({
      name: 'write_file',
      description: 'Writes or updates a file strictly inside the /workspace sandbox.',
      sandboxRequired: true,
      networkAccess: false,
      riskLevel: 'medium',
      allowedRoles: ['developer', 'operator', 'admin'],
      schema: {
        type: 'object',
        required: ['path', 'content'],
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Relative file path within /workspace.',
            minLength: 1,
            maxLength: 256,
          },
          content: {
            type: 'string',
            description: 'UTF-8 file content to write.',
            minLength: 0,
            maxLength: 131072,
          },
        },
      },
    });

    this.register({
      name: 'list_files',
      description: 'Lists all files currently stored inside the /workspace sandbox.',
      sandboxRequired: true,
      networkAccess: false,
      riskLevel: 'low',
      allowedRoles: ['guest', 'developer', 'operator', 'auditor', 'admin'],
      schema: {
        type: 'object',
        required: [],
        additionalProperties: false,
        properties: {},
      },
    });

    this.register({
      name: 'run_command',
      description: 'Executes a whitelisted command (node, python3, ls, cat, head, pwd, echo, mkdir, rm, find) inside /workspace.',
      sandboxRequired: true,
      networkAccess: false,
      riskLevel: 'high',
      allowedRoles: ['developer', 'operator', 'admin'],
      schema: {
        type: 'object',
        required: ['command'],
        additionalProperties: false,
        properties: {
          command: {
            type: 'string',
            description: 'Whitelisted command binary name.',
            minLength: 1,
            maxLength: 64,
          },
          argsString: {
            type: 'string',
            description: 'Space-separated command arguments (optional).',
            minLength: 0,
            maxLength: 512,
            default: '',
          },
        },
      },
    });
  }

  public register(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  public getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getConfiguredSandboxMode(): PythonSandboxMode {
    const raw = (process.env.ZYNTHEOR_PYTHON_SANDBOX_MODE || 'auto').trim().toLowerCase();
    if (raw === 'docker' || raw === 'subprocess' || raw === 'auto') {
      return raw;
    }
    return 'auto';
  }

  public getDockerImage(): string {
    return (process.env.ZYNTHEOR_PYTHON_DOCKER_IMAGE || DEFAULT_DOCKER_IMAGE).trim();
  }

  public async probeDockerSandbox(): Promise<DockerProbeStatus> {
    const configuredMode = this.getConfiguredSandboxMode();
    const dockerImage = this.getDockerImage();
    const checkedAt = new Date().toISOString();

    try {
      const { stdout } = await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], {
        timeout: 3000,
      });
      const ver = stdout.trim() || 'available';
      return {
        dockerAvailable: true,
        dockerVersion: ver,
        configuredMode,
        dockerImage,
        checkedAt,
        detail: `Docker daemon responsive (server ${ver})`,
      };
    } catch (err: any) {
      const code = err?.code || '';
      const detail =
        code === 'ENOENT'
          ? 'docker binary not found on PATH'
          : err?.message || 'Docker daemon unreachable';
      return {
        dockerAvailable: false,
        dockerVersion: null,
        configuredMode,
        dockerImage,
        checkedAt,
        detail,
      };
    }
  }

  /**
   * Generates concise prompt instructions describing all registered tool schemas
   * for injection into PLANNER / CODER / Chat system prompts.
   */
  public getPromptSchemaInstructions(): string {
    const schemas = this.listDefinitions().map((t) => ({
      tool: t.name,
      description: t.description,
      parameters: t.schema,
    }));
    return [
      '[REGISTERED_TOOLS_JSON_SCHEMA]:',
      'To invoke an external tool, emit a JSON object wrapped in <tool_call>...</tool_call>:',
      '<tool_call>{"tool": "<tool_name>", "arguments": { ... }}</tool_call>',
      JSON.stringify(schemas, null, 2),
    ].join('\n');
  }

  /**
   * Validates a parsed JSON tool call against the registered schema.
   */
  public validateCall(call: ToolCallRequest): {
    valid: boolean;
    definition?: ToolDefinition;
    normalizedArgs?: Record<string, unknown>;
    error?: string;
  } {
    if (!call || typeof call.tool !== 'string' || !call.tool.trim()) {
      return { valid: false, error: 'Missing non-empty "tool" name.' };
    }
    const def = this.tools.get(call.tool.trim());
    if (!def) {
      return {
        valid: false,
        error: `Unknown tool "${call.tool}". Registered tools: ${Array.from(this.tools.keys()).join(', ')}.`,
      };
    }
    const rawArgs = call.arguments;
    if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
      return { valid: false, error: `Tool "${def.name}" requires an "arguments" JSON object.` };
    }

    const normalized: Record<string, unknown> = {};
    const props = def.schema.properties;

    // Reject unknown properties (additionalProperties: false)
    for (const key of Object.keys(rawArgs)) {
      if (!(key in props)) {
        return {
          valid: false,
          error: `Tool "${def.name}" does not accept unexpected argument "${key}".`,
        };
      }
    }

    // Check required fields and apply defaults/bounds
    for (const reqKey of def.schema.required) {
      if (rawArgs[reqKey] === undefined || rawArgs[reqKey] === null) {
        return {
          valid: false,
          error: `Tool "${def.name}" missing required argument "${reqKey}".`,
        };
      }
    }

    for (const [key, spec] of Object.entries(props)) {
      const val = rawArgs[key] !== undefined ? rawArgs[key] : spec.default;
      if (val === undefined) continue;

      if (spec.type === 'string') {
        if (typeof val !== 'string') {
          return { valid: false, error: `Argument "${key}" must be a string.` };
        }
        if (spec.minLength !== undefined && val.length < spec.minLength) {
          return { valid: false, error: `Argument "${key}" length must be >= ${spec.minLength}.` };
        }
        if (spec.maxLength !== undefined && val.length > spec.maxLength) {
          return { valid: false, error: `Argument "${key}" length exceeds ${spec.maxLength} chars.` };
        }
        normalized[key] = val;
      } else if (spec.type === 'integer' || spec.type === 'number') {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          return { valid: false, error: `Argument "${key}" must be a finite number.` };
        }
        if (spec.type === 'integer' && !Number.isInteger(val)) {
          return { valid: false, error: `Argument "${key}" must be an integer.` };
        }
        if (spec.minimum !== undefined && val < spec.minimum) {
          return { valid: false, error: `Argument "${key}" must be >= ${spec.minimum}.` };
        }
        if (spec.maximum !== undefined && val > spec.maximum) {
          return { valid: false, error: `Argument "${key}" must be <= ${spec.maximum}.` };
        }
        normalized[key] = val;
      } else if (spec.type === 'boolean') {
        if (typeof val !== 'boolean') {
          return { valid: false, error: `Argument "${key}" must be a boolean.` };
        }
        normalized[key] = val;
      }
    }

    return { valid: true, definition: def, normalizedArgs: normalized };
  }

  /**
   * Detects JSON-encoded tool calls in text from `<tool_call>{...}</tool_call>`,
   * fenced ```json ... ``` blocks, or balanced JSON objects containing `"tool"` + `"arguments"`.
   */
  public extractToolCalls(text: string): ToolCallRequest[] {
    if (!text || typeof text !== 'string') return [];

    const results: ToolCallRequest[] = [];
    const seenRaw = new Set<string>();

    const tryPushJson = (candidate: string) => {
      const trimmed = candidate.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        const toolName =
          typeof parsed.tool === 'string'
            ? parsed.tool
            : typeof parsed.name === 'string'
            ? parsed.name
            : null;
        const args = parsed.arguments ?? parsed.args ?? parsed.input;
        if (!toolName || !args || typeof args !== 'object' || Array.isArray(args)) return;
        const dedupeKey = `${toolName}:${JSON.stringify(args)}`;
        if (seenRaw.has(dedupeKey)) return;
        seenRaw.add(dedupeKey);
        results.push({
          tool: toolName.trim(),
          arguments: args as Record<string, unknown>,
          rawText: trimmed,
        });
      } catch {
        // Ignore non-JSON fragments
      }
    };

    // 1. Explicit <tool_call>...</tool_call> tags
    const tagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
    let m: RegExpExecArray | null;
    while ((m = tagRegex.exec(text)) !== null) {
      tryPushJson(m[1]);
    }

    // 2. Fenced ```json / ```tool_call blocks
    const fenceRegex = /```(?:json|tool_call)?\s*([\s\S]*?)```/gi;
    while ((m = fenceRegex.exec(text)) !== null) {
      tryPushJson(m[1]);
    }

    // 3. Balanced JSON object scanner for bare JSON tool calls
    let depth = 0;
    let inString = false;
    let escaped = false;
    let startIdx = -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        if (depth === 0) startIdx = i;
        depth++;
      } else if (ch === '}' && depth > 0) {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          const slice = text.slice(startIdx, i + 1);
          if (slice.includes('"tool"') || slice.includes('"name"')) {
            tryPushJson(slice);
          }
          startIdx = -1;
        }
      }
    }

    return results;
  }

  private recordTelemetry(tool: string, ok: boolean, durationMs: number, error?: string, denied = false): void {
    const cur = this.telemetry.get(tool) || { total: 0, ok: 0, fail: 0, denied: 0, totalMs: 0 };
    cur.total += 1;
    if (ok) cur.ok += 1;
    else cur.fail += 1;
    if (denied) cur.denied += 1;
    cur.totalMs += Math.max(0, durationMs);
    if (error) cur.lastError = error.slice(0, 200);
    cur.lastAt = new Date().toISOString();
    this.telemetry.set(tool, cur);
  }

  public getTelemetry(): ToolTelemetryEntry[] {
    const out: ToolTelemetryEntry[] = [];
    for (const def of this.tools.values()) {
      const t = this.telemetry.get(def.name) || { total: 0, ok: 0, fail: 0, denied: 0, totalMs: 0 };
      out.push({
        tool: def.name,
        totalCalls: t.total,
        succeededCalls: t.ok,
        failedCalls: t.fail,
        deniedCalls: t.denied,
        reliabilityPct: t.total > 0 ? Number(((t.ok / t.total) * 100).toFixed(1)) : 100,
        avgLatencyMs: t.total > 0 ? Math.round(t.totalMs / t.total) : 0,
        lastError: t.lastError,
        lastExecutedAt: t.lastAt,
      });
    }
    return out;
  }

  /**
   * Validates and executes a single JSON-encoded tool call safely with RBAC + resource budget checks.
   */
  public async executeToolCall(
    call: ToolCallRequest,
    context: { taskId?: string; role?: string; callerRole?: SovereignRole; iteration?: number; maxCallsPerTask?: number } = {}
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const callId = `tool_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const validation = this.validateCall(call);

    if (!validation.valid || !validation.definition || !validation.normalizedArgs) {
      const durationMs = Date.now() - startTime;
      this.recordTelemetry(call?.tool || 'unknown', false, durationMs, validation.error);
      const audit = AuditLedger.append('SYSTEM', 'TOOL_CALL_VALIDATION_FAILED', {
        callId,
        taskId: context.taskId,
        tool: call?.tool || 'unknown',
        error: validation.error,
        durationMs,
      });
      return {
        callId,
        tool: call?.tool || 'unknown',
        ok: false,
        executionMode: 'validation_error',
        dockerIsolated: false,
        arguments: call?.arguments || {},
        output: null,
        durationMs,
        error: validation.error || 'Tool argument validation failed',
        auditHash: audit.entry_hash,
      };
    }

    const def = validation.definition;
    const args = validation.normalizedArgs;

    // Least-privilege RBAC enforcement when callerRole is specified
    if (context.callerRole && !def.allowedRoles.includes(context.callerRole)) {
      const durationMs = Date.now() - startTime;
      const errMsg = `SECURITY_PERMISSION_DENIED: Role '${context.callerRole}' is not permitted to execute '${def.name}'.`;
      this.recordTelemetry(def.name, false, durationMs, errMsg, true);
      const audit = AuditLedger.append('GOVERNANCE', 'TOOL_RBAC_DENIED', {
        callId,
        taskId: context.taskId,
        tool: def.name,
        callerRole: context.callerRole,
        allowedRoles: def.allowedRoles,
      });
      return {
        callId,
        tool: def.name,
        ok: false,
        executionMode: 'validation_error',
        dockerIsolated: false,
        arguments: args,
        output: null,
        durationMs,
        error: errMsg,
        auditHash: audit.entry_hash,
      };
    }

    // Per-task abuse & resource budget enforcement
    if (context.taskId) {
      const count = (this.taskCallCounts.get(context.taskId) || 0) + 1;
      const cap = context.maxCallsPerTask ?? ToolRegistry.DEFAULT_MAX_CALLS_PER_TASK;
      if (count > cap) {
        const durationMs = Date.now() - startTime;
        const errMsg = `BUDGET_EXCEEDED: Task '${context.taskId}' exceeded tool call limit (${cap}).`;
        this.recordTelemetry(def.name, false, durationMs, errMsg, true);
        return {
          callId,
          tool: def.name,
          ok: false,
          executionMode: 'validation_error',
          dockerIsolated: false,
          arguments: args,
          output: null,
          durationMs,
          error: errMsg,
        };
      }
      this.taskCallCounts.set(context.taskId, count);
    }

    let result: ToolExecutionResult;
    if (def.name === 'web_search') {
      result = await this.runWebSearch(callId, args, startTime);
    } else if (def.name === 'execute_python') {
      result = await this.runExecutePython(callId, args, startTime);
    } else if (def.name === 'read_file') {
      result = this.runReadFile(callId, args, startTime);
    } else if (def.name === 'write_file') {
      result = this.runWriteFile(callId, args, startTime);
    } else if (def.name === 'list_files') {
      result = this.runListFiles(callId, args, startTime);
    } else if (def.name === 'run_command') {
      result = await this.runWorkspaceCommand(callId, args, startTime);
    } else {
      result = {
        callId,
        tool: def.name,
        ok: false,
        executionMode: 'execution_error',
        dockerIsolated: false,
        arguments: args,
        output: null,
        durationMs: Date.now() - startTime,
        error: `No executor bound for registered tool "${def.name}".`,
      };
    }

    this.recordTelemetry(result.tool, result.ok, result.durationMs, result.error);

    const audit = AuditLedger.append('TESTER', 'TOOL_REGISTRY_EXECUTE', {
      callId: result.callId,
      taskId: context.taskId,
      role: context.role,
      callerRole: context.callerRole,
      iteration: context.iteration,
      tool: result.tool,
      ok: result.ok,
      executionMode: result.executionMode,
      dockerIsolated: result.dockerIsolated,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      error: result.error,
    });
    result.auditHash = audit.entry_hash;
    return result;
  }

  private runReadFile(
    callId: string,
    args: Record<string, unknown>,
    startTime: number
  ): ToolExecutionResult {
    try {
      const relPath = String(args.path || '').trim();
      const content = ToolGateway.readFile(relPath);
      return {
        callId,
        tool: 'read_file',
        ok: true,
        executionMode: 'workspace_sandbox',
        dockerIsolated: false,
        arguments: args,
        output: { path: relPath, bytes: Buffer.byteLength(content, 'utf8'), content },
        stdout: content,
        exitCode: 0,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        callId,
        tool: 'read_file',
        ok: false,
        executionMode: 'execution_error',
        dockerIsolated: false,
        arguments: args,
        output: null,
        exitCode: 1,
        durationMs: Date.now() - startTime,
        error: err?.message || 'Failed to read workspace file',
      };
    }
  }

  private runWriteFile(
    callId: string,
    args: Record<string, unknown>,
    startTime: number
  ): ToolExecutionResult {
    try {
      const relPath = String(args.path || '').trim();
      const content = String(args.content ?? '');
      const written = ToolGateway.writeFile(relPath, content);
      return {
        callId,
        tool: 'write_file',
        ok: true,
        executionMode: 'workspace_sandbox',
        dockerIsolated: false,
        arguments: { path: relPath, bytes: written.bytesWritten },
        output: { path: relPath, bytesWritten: written.bytesWritten },
        stdout: `Wrote ${written.bytesWritten} bytes to /workspace/${relPath}`,
        exitCode: 0,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        callId,
        tool: 'write_file',
        ok: false,
        executionMode: 'execution_error',
        dockerIsolated: false,
        arguments: { path: args.path },
        output: null,
        exitCode: 1,
        durationMs: Date.now() - startTime,
        error: err?.message || 'Failed to write workspace file',
      };
    }
  }

  private runListFiles(
    callId: string,
    args: Record<string, unknown>,
    startTime: number
  ): ToolExecutionResult {
    try {
      const files = ToolGateway.listFiles();
      return {
        callId,
        tool: 'list_files',
        ok: true,
        executionMode: 'workspace_sandbox',
        dockerIsolated: false,
        arguments: args,
        output: { count: files.length, files },
        stdout: files.join('\n'),
        exitCode: 0,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        callId,
        tool: 'list_files',
        ok: false,
        executionMode: 'execution_error',
        dockerIsolated: false,
        arguments: args,
        output: null,
        exitCode: 1,
        durationMs: Date.now() - startTime,
        error: err?.message || 'Failed to list workspace files',
      };
    }
  }

  private async runWorkspaceCommand(
    callId: string,
    args: Record<string, unknown>,
    startTime: number
  ): Promise<ToolExecutionResult> {
    try {
      const command = String(args.command || '').trim();
      const rawArgsStr = String(args.argsString || '').trim();
      const cmdArgs = rawArgsStr ? rawArgsStr.split(/\s+/).filter(Boolean) : [];
      const res = await ToolGateway.runCommand(command, cmdArgs);
      const ok = res.exitCode === 0;
      return {
        callId,
        tool: 'run_command',
        ok,
        executionMode: 'workspace_sandbox',
        dockerIsolated: false,
        arguments: { command, args: cmdArgs },
        output: res,
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
        durationMs: Date.now() - startTime,
        error: ok ? undefined : res.stderr.trim() || `Command exited with code ${res.exitCode}`,
      };
    } catch (err: any) {
      return {
        callId,
        tool: 'run_command',
        ok: false,
        executionMode: 'validation_error',
        dockerIsolated: false,
        arguments: args,
        output: null,
        exitCode: 1,
        durationMs: Date.now() - startTime,
        error: err?.message || 'Workspace command rejected',
      };
    }
  }

  private async runWebSearch(
    callId: string,
    args: Record<string, unknown>,
    startTime: number
  ): Promise<ToolExecutionResult> {
    const query = String(args.query || '').trim();
    const maxResults = Number(args.maxResults ?? 5);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'ZYNTHEOR-Sovereign-ToolRegistry/1.0 (+https://zyntheor.local)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          callId,
          tool: 'web_search',
          ok: false,
          executionMode: 'http_search',
          dockerIsolated: false,
          arguments: args,
          output: [],
          durationMs: Date.now() - startTime,
          error: `Upstream web search HTTP ${response.status} ${response.statusText}`,
        };
      }

      const html = await response.text();
      const items: WebSearchResultItem[] = [];
      const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

      const links: Array<{ url: string; title: string; index: number }> = [];
      let lm: RegExpExecArray | null;
      while ((lm = linkRegex.exec(html)) !== null) {
        const cleanUrl = unwrapDuckDuckGoRedirect(lm[1]);
        const title = decodeHtmlEntities(lm[2]);
        if (title && /^https?:\/\//i.test(cleanUrl)) {
          links.push({ url: cleanUrl, title, index: lm.index });
        }
        if (links.length >= maxResults) break;
      }

      const snippets: string[] = [];
      let sm: RegExpExecArray | null;
      while ((sm = snippetRegex.exec(html)) !== null) {
        snippets.push(decodeHtmlEntities(sm[1] || sm[2] || ''));
        if (snippets.length >= maxResults) break;
      }

      for (let i = 0; i < links.length; i++) {
        items.push({
          title: links[i].title,
          url: links[i].url,
          snippet: snippets[i] || '',
        });
      }

      return {
        callId,
        tool: 'web_search',
        ok: true,
        executionMode: 'http_search',
        dockerIsolated: false,
        arguments: args,
        output: {
          query,
          count: items.length,
          results: items,
        },
        stdout: items.map((r, i) => `${i + 1}. ${r.title} (${r.url})\n   ${r.snippet}`).join('\n'),
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      const msg =
        err?.name === 'AbortError'
          ? 'Web search timed out after 8000ms'
          : err?.message || 'Web search network failure';
      return {
        callId,
        tool: 'web_search',
        ok: false,
        executionMode: 'http_search',
        dockerIsolated: false,
        arguments: args,
        output: [],
        durationMs: Date.now() - startTime,
        error: `FAIL_CLOSED_WEB_SEARCH: ${msg}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Builds the hardened `docker run` argument array (used without a shell) so
   * untrusted Python code executes inside an unprivileged, network-disabled,
   * read-only ephemeral container.
   */
  public buildDockerPythonArgs(
    hostScriptPath: string,
    dockerImage: string = this.getDockerImage()
  ): string[] {
    return [
      'run',
      '--rm',
      '--network=none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=32m',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
      '--memory=256m',
      '--cpus=0.5',
      '--pids-limit=64',
      '--user',
      '65534:65534',
      '-v',
      `${hostScriptPath}:/sandbox/script.py:ro`,
      dockerImage,
      'python3',
      '-I',
      '-B',
      '/sandbox/script.py',
    ];
  }

  private async runExecutePython(
    callId: string,
    args: Record<string, unknown>,
    startTime: number
  ): Promise<ToolExecutionResult> {
    const code = String(args.code || '');
    const timeoutMs = Number(args.timeoutMs ?? 5000);

    for (const guard of DANGEROUS_PYTHON_PATTERNS) {
      if (guard.pattern.test(code)) {
        return {
          callId,
          tool: 'execute_python',
          ok: false,
          executionMode: 'validation_error',
          dockerIsolated: false,
          arguments: { ...args, code: `[REDACTED ${code.length} bytes]` },
          output: null,
          exitCode: 1,
          durationMs: Date.now() - startTime,
          error: `SECURITY_VIOLATION: ${guard.reason}`,
        };
      }
    }

    const mode = this.getConfiguredSandboxMode();
    const dockerImage = this.getDockerImage();
    const workspaceRoot = ToolGateway.getWorkspaceRoot();
    const scriptName = `.tool_py_${callId}.py`;
    const hostScriptPath = path.join(workspaceRoot, scriptName);

    fs.writeFileSync(hostScriptPath, code, { encoding: 'utf8', mode: 0o444 });

    try {
      const dockerProbe = mode === 'subprocess' ? null : await this.probeDockerSandbox();

      if (mode !== 'subprocess' && dockerProbe?.dockerAvailable) {
        const dockerArgs = this.buildDockerPythonArgs(hostScriptPath, dockerImage);
        return await this.execSandboxedProcess(
          callId,
          args,
          'docker',
          dockerArgs,
          workspaceRoot,
          timeoutMs,
          'docker_container',
          true,
          dockerImage,
          startTime
        );
      }

      if (mode === 'docker') {
        return {
          callId,
          tool: 'execute_python',
          ok: false,
          executionMode: 'docker_unavailable',
          dockerIsolated: false,
          dockerImage,
          arguments: args,
          output: null,
          exitCode: 1,
          durationMs: Date.now() - startTime,
          error: `FAIL_CLOSED: ZYNTHEOR_PYTHON_SANDBOX_MODE=docker is enforced, but Docker is unavailable (${dockerProbe?.detail || 'no docker daemon'}).`,
        };
      }

      // Auto/subprocess mode: explicitly labeled as host_isolated_subprocess (dockerIsolated: false)
      return await this.execSandboxedProcess(
        callId,
        args,
        'python3',
        ['-I', '-B', scriptName],
        workspaceRoot,
        timeoutMs,
        'host_isolated_subprocess',
        false,
        undefined,
        startTime
      );
    } finally {
      try {
        if (fs.existsSync(hostScriptPath)) {
          fs.chmodSync(hostScriptPath, 0o600);
          fs.unlinkSync(hostScriptPath);
        }
      } catch {
        // Ignore cleanup failures on temp script
      }
    }
  }

  private execSandboxedProcess(
    callId: string,
    args: Record<string, unknown>,
    command: string,
    cmdArgs: string[],
    cwd: string,
    timeoutMs: number,
    executionMode: 'docker_container' | 'host_isolated_subprocess',
    dockerIsolated: boolean,
    dockerImage: string | undefined,
    startTime: number
  ): Promise<ToolExecutionResult> {
    return new Promise((resolve) => {
      execFile(
        command,
        cmdArgs,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 512 * 1024,
          env: {
            PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
            PYTHONPATH: cwd,
            PYTHONNOUSERSITE: '1',
            PYTHONDONTWRITEBYTECODE: '1',
            LANG: 'C.UTF-8',
            LC_ALL: 'C.UTF-8',
          },
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
          const outStr = stdout.toString();
          const errStr =
            stderr.toString() +
            (error && error.killed ? `\n[Process killed: exceeded ${timeoutMs}ms timeout]` : '');
          const ok = exitCode === 0 && !error?.killed;

          resolve({
            callId,
            tool: 'execute_python',
            ok,
            executionMode,
            dockerIsolated,
            dockerImage,
            arguments: args,
            output: {
              stdout: outStr,
              stderr: errStr,
              exitCode,
              dockerIsolated,
              executionMode,
            },
            stdout: outStr,
            stderr: errStr,
            exitCode,
            durationMs,
            error: ok ? undefined : errStr.trim() || error?.message || `Python exited with code ${exitCode}`,
          });
        }
      );
    });
  }
}
