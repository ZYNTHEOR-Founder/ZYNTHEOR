/**
 * ZYNTHEOR Batch 28 — Autonomous Planning Engine (DAG + Resource Budget + Plan Revisions)
 *
 * Capabilities:
 *  - Goal decomposition into structured multi-step DAG
 *  - Dependency cycle detection & topological ordering
 *  - Priority & resource budget allocation (tool calls, retries, time, tokens)
 *  - Live step progress tracking
 *  - Failure detection & dynamic plan revision with explicit traceable reasons
 *  - Completion verification against measurable acceptance gates
 *  - Disk persistence in native_data/plans/
 */

import fs from 'fs';
import path from 'path';
import { AuditLedger } from './AuditLedger';
import type { TaskPriority } from './TaskOrchestrator';

export type PlanStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface PlanStep {
  id: string;
  title: string;
  stage: string;
  tool?: string;
  dependsOn: string[];
  priority: number; // 1 (highest) .. 10
  estimatedMs: number;
  status: PlanStepStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  outputSummary?: string;
  error?: string;
}

export interface PlanRevisionRecord {
  revision: number;
  timestamp: string;
  reason: string;
  failedStepId?: string;
  actionTaken: string;
  addedStepIds: string[];
}

export interface ResourceBudget {
  maxToolCalls: number;
  usedToolCalls: number;
  maxRetries: number;
  usedRetries: number;
  maxDurationMs: number;
  elapsedMs: number;
  maxTokens: number;
  usedTokens: number;
  exhausted: boolean;
  exhaustedReason?: string;
}

export interface AutonomousPlan {
  planId: string;
  taskId: string;
  tenantId: string;
  ownerUserId: string;
  goal: string;
  priority: TaskPriority;
  runtime: 'node' | 'python3';
  createdAt: string;
  updatedAt: string;
  status: 'ACTIVE' | 'REVISED' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
  steps: PlanStep[];
  executionOrder: string[];
  revisions: PlanRevisionRecord[];
  budget: ResourceBudget;
  completionVerified: boolean;
  completionSummary?: string;
}

export function resolveDagOrder(steps: PlanStep[]): string[] {
  const byId = new Map<string, PlanStep>();
  for (const s of steps) {
    if (!s.id || !s.id.trim()) {
      throw new Error('PLAN_INVALID_STEP: Every plan step requires a non-empty id.');
    }
    if (byId.has(s.id)) {
      throw new Error(`PLAN_DUPLICATE_STEP: Duplicate step id '${s.id}'.`);
    }
    byId.set(s.id, s);
  }

  // Validate unknown dependencies upfront
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      if (!byId.has(dep)) {
        throw new Error(`PLAN_UNKNOWN_DEPENDENCY: Step '${s.id}' depends on missing step '${dep}'.`);
      }
    }
  }

  // Sort candidates by priority ascending so higher-priority steps execute earliest when deps allow
  const sortedCandidates = [...steps].sort((a, b) => a.priority - b.priority);
  const state = new Map<string, 0 | 1 | 2>();
  const ordered: string[] = [];

  const visit = (id: string) => {
    const cur = state.get(id) ?? 0;
    if (cur === 2) return;
    if (cur === 1) {
      throw new Error(`PLAN_CYCLE_DETECTED: Cyclic dependency detected involving step '${id}'.`);
    }
    state.set(id, 1);
    const step = byId.get(id)!;
    const deps = [...step.dependsOn].sort(
      (a, b) => (byId.get(a)?.priority ?? 5) - (byId.get(b)?.priority ?? 5)
    );
    for (const dep of deps) {
      visit(dep);
    }
    state.set(id, 2);
    ordered.push(id);
  };

  for (const s of sortedCandidates) {
    if ((state.get(s.id) ?? 0) === 0) {
      visit(s.id);
    }
  }

  return ordered;
}

export class AutonomousPlanner {
  private static instance: AutonomousPlanner | null = null;
  private plansDir: string;
  private plans = new Map<string, AutonomousPlan>();

  private constructor() {
    this.plansDir = process.env.ZYNTHEOR_PLANS_DIR
      ? path.resolve(process.env.ZYNTHEOR_PLANS_DIR)
      : path.resolve(process.cwd(), 'native_data', 'plans');
    this.loadAll();
  }

  public static getInstance(): AutonomousPlanner {
    if (!AutonomousPlanner.instance) {
      AutonomousPlanner.instance = new AutonomousPlanner();
    }
    return AutonomousPlanner.instance;
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.plansDir)) {
      fs.mkdirSync(this.plansDir, { recursive: true });
    }
  }

  private loadAll(): void {
    try {
      this.ensureDir();
      for (const fn of fs.readdirSync(this.plansDir)) {
        if (!fn.endsWith('.json')) continue;
        try {
          const parsed: AutonomousPlan = JSON.parse(fs.readFileSync(path.join(this.plansDir, fn), 'utf8'));
          if (parsed?.taskId) this.plans.set(parsed.taskId, parsed);
        } catch {
          // skip unreadable plan file
        }
      }
    } catch {
      // ignore initial dir errors
    }
  }

  private persistPlan(plan: AutonomousPlan): void {
    this.ensureDir();
    plan.updatedAt = new Date().toISOString();
    const target = path.join(this.plansDir, `${plan.taskId}.json`);
    const tmp = `${target}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(plan, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    this.plans.set(plan.taskId, plan);
  }

  public decomposeGoal(params: {
    taskId: string;
    goal: string;
    priority: TaskPriority;
    runtime: 'node' | 'python3';
    tenantId: string;
    ownerUserId: string;
    customSteps?: PlanStep[];
    budgetOverrides?: Partial<ResourceBudget>;
  }): AutonomousPlan {
    const g = params.goal.toLowerCase();
    const basePrio = params.priority === 'High' ? 1 : params.priority === 'Medium' ? 3 : 5;
    const steps: PlanStep[] = params.customSteps
      ? params.customSteps
      : [
          {
            id: 'step_intake',
            title: 'Decompose goal constraints and target runtime',
            stage: '01_INTAKE',
            dependsOn: [],
            priority: basePrio,
            estimatedMs: 120,
            status: 'PENDING',
            attempts: 0,
          },
          {
            id: 'step_analyze_context',
            title: 'Audit workspace files and retrieve grounded knowledge',
            stage: '02_ANALYZE',
            tool: 'list_files',
            dependsOn: ['step_intake'],
            priority: basePrio + 1,
            estimatedMs: 250,
            status: 'PENDING',
            attempts: 0,
          },
          {
            id: 'step_plan_architecture',
            title: 'Formulate DAG execution steps & acceptance gates',
            stage: '03_PLAN',
            dependsOn: ['step_analyze_context'],
            priority: basePrio + 1,
            estimatedMs: 300,
            status: 'PENDING',
            attempts: 0,
          },
          {
            id: 'step_build_source',
            title: `Synthesize ${params.runtime === 'python3' ? 'Python 3' : 'Node.js'} entry & companion modules`,
            stage: '04_BUILD',
            dependsOn: ['step_plan_architecture'],
            priority: basePrio + 2,
            estimatedMs: 800,
            status: 'PENDING',
            attempts: 0,
          },
          {
            id: 'step_execute_sandbox',
            title: 'Write artifacts into /workspace and run static syntax + security review',
            stage: '05_EXECUTE',
            tool: 'write_file',
            dependsOn: ['step_build_source'],
            priority: basePrio + 2,
            estimatedMs: 600,
            status: 'PENDING',
            attempts: 0,
          },
          {
            id: 'step_verify_tests',
            title: /\bweb\b|html|ui|dashboard/.test(g)
              ? 'Run runtime smoke + unit + DOM/UI artifact checks'
              : 'Execute sandbox runtime and isolated unit test suite',
            stage: '06_TEST',
            tool: 'run_command',
            dependsOn: ['step_execute_sandbox'],
            priority: basePrio + 2,
            estimatedMs: 900,
            status: 'PENDING',
            attempts: 0,
          },
          {
            id: 'step_deliver_package',
            title: 'Verify acceptance criteria and seal deliverable ZIP manifest',
            stage: '08_DELIVER',
            dependsOn: ['step_verify_tests'],
            priority: basePrio + 3,
            estimatedMs: 400,
            status: 'PENDING',
            attempts: 0,
          },
        ];

    const executionOrder = resolveDagOrder(steps);
    const now = new Date().toISOString();
    const maxRetries = params.priority === 'High' ? 3 : 2;

    const plan: AutonomousPlan = {
      planId: `plan_${params.taskId}`,
      taskId: params.taskId,
      tenantId: params.tenantId,
      ownerUserId: params.ownerUserId,
      goal: params.goal,
      priority: params.priority,
      runtime: params.runtime,
      createdAt: now,
      updatedAt: now,
      status: 'ACTIVE',
      steps,
      executionOrder,
      revisions: [],
      budget: {
        maxToolCalls: params.budgetOverrides?.maxToolCalls ?? 24,
        usedToolCalls: 0,
        maxRetries: params.budgetOverrides?.maxRetries ?? maxRetries,
        usedRetries: 0,
        maxDurationMs: params.budgetOverrides?.maxDurationMs ?? 45_000,
        elapsedMs: 0,
        maxTokens: params.budgetOverrides?.maxTokens ?? 16_384,
        usedTokens: 0,
        exhausted: false,
      },
      completionVerified: false,
    };

    this.persistPlan(plan);
    AuditLedger.append('PLANNER', 'AUTONOMOUS_DAG_PLAN_CREATED', {
      planId: plan.planId,
      taskId: plan.taskId,
      stepCount: plan.steps.length,
      executionOrder: plan.executionOrder,
      tenantId: plan.tenantId,
    });
    return plan;
  }

  public updateStepStatus(
    taskId: string,
    stepId: string,
    status: PlanStepStatus,
    details?: { outputSummary?: string; error?: string }
  ): AutonomousPlan | null {
    const plan = this.plans.get(taskId);
    if (!plan) return null;
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return plan;

    const now = new Date().toISOString();
    if (status === 'RUNNING') {
      step.attempts += 1;
      step.startedAt = step.startedAt || now;
    } else if (status === 'COMPLETED' || status === 'FAILED') {
      step.completedAt = now;
    }
    step.status = status;
    if (details?.outputSummary !== undefined) step.outputSummary = details.outputSummary;
    if (details?.error !== undefined) step.error = details.error;

    this.persistPlan(plan);
    return plan;
  }

  public recordResourceUsage(
    taskId: string,
    delta: { toolCalls?: number; retries?: number; elapsedMs?: number; tokens?: number }
  ): ResourceBudget | null {
    const plan = this.plans.get(taskId);
    if (!plan) return null;
    const b = plan.budget;
    if (delta.toolCalls) b.usedToolCalls += delta.toolCalls;
    if (delta.retries) b.usedRetries += delta.retries;
    if (delta.elapsedMs !== undefined) b.elapsedMs = Math.max(b.elapsedMs, delta.elapsedMs);
    if (delta.tokens) b.usedTokens += delta.tokens;

    if (b.usedToolCalls > b.maxToolCalls) {
      b.exhausted = true;
      b.exhaustedReason = `Tool call budget exceeded (${b.usedToolCalls}/${b.maxToolCalls})`;
    } else if (b.usedRetries > b.maxRetries) {
      b.exhausted = true;
      b.exhaustedReason = `Retry budget exceeded (${b.usedRetries}/${b.maxRetries})`;
    } else if (b.elapsedMs > b.maxDurationMs) {
      b.exhausted = true;
      b.exhaustedReason = `Duration budget exceeded (${b.elapsedMs}ms/${b.maxDurationMs}ms)`;
    } else if (b.usedTokens > b.maxTokens) {
      b.exhausted = true;
      b.exhaustedReason = `Token budget exceeded (${b.usedTokens}/${b.maxTokens})`;
    }

    if (b.exhausted && plan.status === 'ACTIVE') {
      plan.status = 'BLOCKED';
    }
    this.persistPlan(plan);
    return { ...b };
  }

  /**
   * Revises a plan dynamically when a defect/failure occurs, adding traceable repair steps
   * wired cleanly into the DAG before final verification & delivery.
   */
  public revisePlan(
    taskId: string,
    params: { reason: string; failedStepId?: string; actionTaken: string }
  ): AutonomousPlan | null {
    const plan = this.plans.get(taskId);
    if (!plan) return null;

    const revNum = plan.revisions.length + 1;
    const repairStepId = `step_repair_${revNum}`;
    const depSource = params.failedStepId && plan.steps.some((s) => s.id === params.failedStepId)
      ? [params.failedStepId]
      : ['step_execute_sandbox'];

    const repairStep: PlanStep = {
      id: repairStepId,
      title: `Autonomous Repair #${revNum}: ${params.actionTaken.slice(0, 100)}`,
      stage: '07_REPAIR',
      tool: 'write_file',
      dependsOn: depSource,
      priority: 1,
      estimatedMs: 500,
      status: 'RUNNING',
      attempts: 1,
      startedAt: new Date().toISOString(),
    };

    plan.steps.push(repairStep);
    const deliverStep = plan.steps.find((s) => s.id === 'step_deliver_package');
    if (deliverStep && !deliverStep.dependsOn.includes(repairStepId)) {
      deliverStep.dependsOn.push(repairStepId);
    }

    plan.executionOrder = resolveDagOrder(plan.steps);
    plan.status = 'REVISED';
    const revision: PlanRevisionRecord = {
      revision: revNum,
      timestamp: new Date().toISOString(),
      reason: params.reason,
      failedStepId: params.failedStepId,
      actionTaken: params.actionTaken,
      addedStepIds: [repairStepId],
    };
    plan.revisions.push(revision);
    this.persistPlan(plan);

    AuditLedger.append('PLANNER', 'AUTONOMOUS_PLAN_REVISED', {
      planId: plan.planId,
      taskId: plan.taskId,
      revision: revNum,
      reason: params.reason,
      failedStepId: params.failedStepId,
    });

    return plan;
  }

  public finalizePlan(
    taskId: string,
    verified: boolean,
    summary: string,
    blocked = false
  ): AutonomousPlan | null {
    const plan = this.plans.get(taskId);
    if (!plan) return null;
    plan.completionVerified = verified;
    plan.completionSummary = summary;
    plan.status = verified ? 'COMPLETED' : blocked ? 'BLOCKED' : 'FAILED';
    this.persistPlan(plan);
    return plan;
  }

  public getPlan(taskId: string, scope?: { tenantId?: string; ownerUserId?: string }): AutonomousPlan | null {
    const plan = this.plans.get(taskId);
    if (!plan) return null;
    if (scope?.tenantId && plan.tenantId !== scope.tenantId) return null;
    if (scope?.ownerUserId && plan.ownerUserId !== scope.ownerUserId) return null;
    return plan;
  }

  public listPlans(scope?: { tenantId?: string; ownerUserId?: string }): AutonomousPlan[] {
    return Array.from(this.plans.values())
      .filter((p) => {
        if (scope?.tenantId && p.tenantId !== scope.tenantId) return false;
        if (scope?.ownerUserId && p.ownerUserId !== scope.ownerUserId) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
}
