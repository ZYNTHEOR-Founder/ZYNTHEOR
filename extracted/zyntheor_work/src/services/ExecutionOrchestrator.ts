/**
 * ZYNTHEOR ExecutionOrchestrator Service
 *
 * Frontend service client connecting strictly to real ZYNTHEOR backend APIs:
 *   - Tool Registry discovery & sandbox diagnostics (/api/tools/registry)
 *   - Permission-aware tool invocation (/api/tools/execute, /api/tools/telemetry)
 *   - Priority task queue management (/api/agent/queue, /api/agent/queue/run-next, /api/agent/tasks)
 *   - Streaming 8-stage autonomous execution & DAG plans (/api/agent/execute, /api/agent/plans)
 *
 * Zero Simulation Policy: never fabricates tool outputs, RBAC grants, or execution results.
 */

import { getStoredAuthHeaders } from '../context/AuthContext';
import { apiUrl } from '../lib/apiClient';
import type { PersistentTaskRecord } from '../types';

export type SovereignRole = 'guest' | 'developer' | 'operator' | 'auditor' | 'admin';

export interface RegisteredToolDefinition {
  name: string;
  description: string;
  sandboxRequired: boolean;
  networkAccess: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  allowedRoles?: SovereignRole[];
  schema: Record<string, any>;
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

export interface ToolInvocationResult {
  callId: string;
  tool: string;
  ok: boolean;
  executionMode: string;
  dockerIsolated: boolean;
  arguments: Record<string, unknown>;
  output: unknown;
  durationMs: number;
  error?: string;
  auditHash?: string;
}

export interface ToolRegistrySnapshot {
  tools: RegisteredToolDefinition[];
  sandbox: { available: boolean; reason?: string; image?: string };
}

export interface AutonomousPlanSnapshot {
  planId: string;
  taskId: string;
  goal: string;
  priority: 'High' | 'Medium' | 'Low';
  runtime: 'node' | 'python3';
  status: 'ACTIVE' | 'REVISED' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
  steps: Array<{
    id: string;
    title: string;
    stage: string;
    tool?: string;
    dependsOn: string[];
    priority: number;
    status: string;
    error?: string;
  }>;
  executionOrder: string[];
  revisions: Array<{
    revision: number;
    timestamp: string;
    reason: string;
    failedStepId?: string;
    actionTaken: string;
    addedStepIds: string[];
  }>;
  budget: {
    maxToolCalls: number;
    usedToolCalls: number;
    maxRetries: number;
    usedRetries: number;
    maxDurationMs: number;
    elapsedMs: number;
    exhausted: boolean;
    exhaustedReason?: string;
  };
  completionVerified: boolean;
}

export class ExecutionOrchestratorService {
  private static instance: ExecutionOrchestratorService | null = null;
  private cachedTools: RegisteredToolDefinition[] = [];

  public static getInstance(): ExecutionOrchestratorService {
    if (!ExecutionOrchestratorService.instance) {
      ExecutionOrchestratorService.instance = new ExecutionOrchestratorService();
    }
    return ExecutionOrchestratorService.instance;
  }

  /** Maps UI role names or SovereignRole strings to canonical SovereignRole. */
  public normalizeRole(role?: string | null): SovereignRole {
    if (!role) return 'guest';
    const r = role.trim();
    if (r === 'Administrator' || r === 'admin') return 'admin';
    if (r === 'Developer' || r === 'developer') return 'developer';
    if (r === 'operator') return 'operator';
    if (r === 'auditor') return 'auditor';
    return 'guest';
  }

  /** Checks locally if the caller role satisfies a tool's advertised allowedRoles (server always enforces authoritatively). */
  public canInvokeTool(toolName: string, callerRole?: string | null): { allowed: boolean; reason?: string } {
    const def = this.cachedTools.find((t) => t.name === toolName);
    if (!def || !Array.isArray(def.allowedRoles) || def.allowedRoles.length === 0) {
      return { allowed: true };
    }
    const normalized = this.normalizeRole(callerRole);
    if (def.allowedRoles.includes(normalized)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `SECURITY_PERMISSION_DENIED: Role '${normalized}' is not permitted to invoke '${toolName}' (requires ${def.allowedRoles.join(', ')}).`,
    };
  }

  public async fetchToolRegistry(): Promise<ToolRegistrySnapshot> {
    const res = await fetch(apiUrl('/api/tools/registry'), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load tool registry (${res.status})`);
    }
    this.cachedTools = Array.isArray(data.tools) ? data.tools : [];
    return {
      tools: this.cachedTools,
      sandbox: data.sandbox || { available: false },
    };
  }

  public async fetchToolTelemetry(): Promise<ToolTelemetryEntry[]> {
    const res = await fetch(apiUrl('/api/tools/telemetry'), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load tool telemetry (${res.status})`);
    }
    return Array.isArray(data.telemetry) ? data.telemetry : [];
  }

  /**
   * Permission-aware tool invocation.
   * Performs optional client-side preflight check when registry metadata is loaded,
   * and always delegates authoritative execution & RBAC enforcement to POST /api/tools/execute.
   */
  public async invokeTool(params: {
    tool: string;
    arguments: Record<string, unknown>;
    taskId?: string;
    callerRole?: string | null;
  }): Promise<ToolInvocationResult> {
    if (params.callerRole) {
      const preflight = this.canInvokeTool(params.tool, params.callerRole);
      if (!preflight.allowed) {
        throw new Error(preflight.reason);
      }
    }

    const res = await fetch(apiUrl('/api/tools/execute'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify({
        tool: params.tool,
        arguments: params.arguments,
        taskId: params.taskId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || !res.ok) {
      const errMsg = data?.result?.error || data?.error || `Tool execution denied/failed (${res.status})`;
      throw new Error(errMsg);
    }
    return data.result as ToolInvocationResult;
  }

  public async enqueueTask(goal: string, priority: 'High' | 'Medium' | 'Low' = 'Medium'): Promise<PersistentTaskRecord> {
    const res = await fetch(apiUrl('/api/agent/queue'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify({ goal, priority }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to enqueue task (${res.status})`);
    }
    return data.task as PersistentTaskRecord;
  }

  public async listTasks(): Promise<PersistentTaskRecord[]> {
    const res = await fetch(apiUrl('/api/agent/tasks'), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to fetch tasks (${res.status})`);
    }
    return Array.isArray(data.tasks) ? data.tasks : [];
  }

  public async listPlans(): Promise<AutonomousPlanSnapshot[]> {
    const res = await fetch(apiUrl('/api/agent/plans'), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load autonomous plans (${res.status})`);
    }
    return Array.isArray(data.plans) ? data.plans : [];
  }

  public async getPlan(taskId: string): Promise<AutonomousPlanSnapshot | null> {
    const res = await fetch(apiUrl(`/api/agent/plans/${encodeURIComponent(taskId)}`), {
      headers: getStoredAuthHeaders(),
    });
    if (res.status === 404) return null;
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load plan '${taskId}' (${res.status})`);
    }
    return data.plan as AutonomousPlanSnapshot;
  }

  /**
   * Streams an autonomous task or queued task execution from NDJSON endpoint.
   */
  public async streamExecuteTask(
    params: {
      goal: string;
      priority?: 'High' | 'Medium' | 'Low';
      idempotencyKey?: string;
      approvalRequestId?: string;
    },
    onEvent?: (event: any) => void
  ): Promise<any> {
    const res = await fetch(apiUrl('/api/agent/execute'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || errBody.message || `Execution failed (${res.status})`);
    }
    if (!res.body) {
      throw new Error('Readable stream unavailable from /api/agent/execute');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: any = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          onEvent?.(ev);
          if (ev.type === 'final_result') finalResult = ev.data;
        } catch {
          // ignore partial JSON line
        }
      }
    }
    return finalResult;
  }

  public async runNextQueuedTask(onEvent?: (event: any) => void): Promise<any> {
    const res = await fetch(apiUrl('/api/agent/queue/run-next'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || errBody.message || `Failed to run queued task (${res.status})`);
    }
    if (!res.body) return res.json();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: any = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          onEvent?.(ev);
          if (ev.type === 'final_result') finalResult = ev.data;
        } catch {
          // ignore
        }
      }
    }
    return finalResult;
  }

  public async fetchCognitiveOperations(): Promise<any> {
    const res = await fetch(apiUrl('/api/cognitive/operations'), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load cognitive operations (${res.status})`);
    }
    return data;
  }

  public async analyzeContext(input: string, query?: string): Promise<any> {
    const res = await fetch(apiUrl('/api/cognitive/context/analyze'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify({ input, query }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Context analysis failed (${res.status})`);
    }
    return data.analysis;
  }

  public async executeAdaptiveReasoning(payload: {
    prompt: string;
    mathSteps?: Array<{ expr: string; claimed?: number }>;
    expectedFinal?: number;
    cspTasks?: Array<{ id: string; depends_on?: string[]; cost?: number; priority?: number }>;
    maxCost?: number;
    pythonSource?: string;
    maxHops?: number;
  }): Promise<any> {
    const res = await fetch(apiUrl('/api/cognitive/reasoning/execute'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Adaptive reasoning failed (${res.status})`);
    }
    return data.outcome;
  }

  public async runBatch29Evaluation(): Promise<any> {
    const res = await fetch(apiUrl('/api/cognitive/evaluation'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Batch 29 evaluation failed (${res.status})`);
    }
    return data.report;
  }

  // =========================================================================
  // Batch 30 — Action-Driven Native Intelligence (8 Pillars)
  // =========================================================================

  public async fetchActionCapabilities(): Promise<any> {
    const res = await fetch(apiUrl('/api/action/capabilities'), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load action capabilities (${res.status})`);
    }
    return data.capabilities;
  }

  public async perceiveActionEnvironment(goal: string): Promise<any> {
    const res = await fetch(apiUrl('/api/action/perceive'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify({ goal }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Environment perception failed (${res.status})`);
    }
    return data.perception;
  }

  public async runActionMission(payload: {
    goal: string;
    mode?: 'engineering_blueprint_execute' | 'workspace_verify_repair' | 'system_integrity_audit' | 'reasoning_verification';
    priority?: 'High' | 'Medium' | 'Low';
    runtime?: 'node' | 'python3';
    targetFile?: string;
    sourceCode?: string;
    unitTestCode?: string;
    requireNativeModel?: boolean;
    approvalRequestId?: string;
    captureLearning?: boolean;
  }): Promise<any> {
    const res = await fetch(apiUrl('/api/action/missions/run'), {
      method: 'POST',
      headers: getStoredAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Action mission failed (${res.status})`);
    }
    return data.mission;
  }

  public async fetchActionMissions(): Promise<any[]> {
    const res = await fetch(apiUrl('/api/action/missions'), {
      headers: getStoredAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to list action missions (${res.status})`);
    }
    return Array.isArray(data.missions) ? data.missions : [];
  }

  public async getActionMission(missionId: string): Promise<any | null> {
    const res = await fetch(apiUrl(`/api/action/missions/${encodeURIComponent(missionId)}`), {
      headers: getStoredAuthHeaders(),
    });
    if (res.status === 404) return null;
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to fetch action mission '${missionId}' (${res.status})`);
    }
    return data.mission;
  }
}

export const ExecutionOrchestrator = ExecutionOrchestratorService.getInstance();
