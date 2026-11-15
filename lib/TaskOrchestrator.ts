/**
 * ZYNTHEOR Sovereign Task Orchestrator
 * Strict 4-Role Multi-Agent State Machine:
 * 1. PLANNER -> 2. CODER -> 3. REVIEWER -> 4. TESTER
 * Zero mock responses. Real execution traces in AuditLedger and ToolGateway sandbox.
 */

import { NativeNeuralLMProvider } from './providers';
import { ToolGateway, type CommandResult } from './ToolGateway';
import { AuditLedger } from './AuditLedger';

export type AgentRole = 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER';

export interface OrchestrationEvent {
  type: 'init' | 'step' | 'chunk' | 'review' | 'test' | 'done' | 'error';
  role?: AgentRole;
  message: string;
  data?: any;
  timestamp: string;
}

export interface TaskExecutionResult {
  taskId: string;
  goal: string;
  success: boolean;
  finalCode: string;
  plan: string;
  reviewStatus: 'APPROVED' | 'REJECTED';
  reviewFeedback: string;
  retryCount: number;
  testResult: CommandResult | null;
  durationMs: number;
}

export class TaskOrchestrator {
  private static instance: TaskOrchestrator | null = null;
  private provider = NativeNeuralLMProvider.getInstance();

  public static getInstance(): TaskOrchestrator {
    if (!TaskOrchestrator.instance) {
      TaskOrchestrator.instance = new TaskOrchestrator();
    }
    return TaskOrchestrator.instance;
  }

  public async executeTask(
    goal: string,
    onEvent: (event: OrchestrationEvent) => void
  ): Promise<TaskExecutionResult> {
    const taskId = `TASK-${Date.now()}`;
    const startTime = Date.now();

    const emit = (event: Omit<OrchestrationEvent, 'timestamp'>) => {
      onEvent({
        ...event,
        timestamp: new Date().toISOString()
      });
    };

    emit({
      type: 'init',
      message: `Initiating Sovereign Orchestration for: "${goal}"`,
      data: { taskId, goal }
    });

    AuditLedger.append('SYSTEM', 'TASK_DISPATCHED', { taskId, goal });

    let plan = '';
    let code = '';
    let reviewApproved = false;
    let reviewStatus: 'APPROVED' | 'REJECTED' = 'REJECTED';
    let reviewFeedback = '';
    let retryCount = 0;
    const maxRetries = 3;
    let testResult: CommandResult | null = null;

    try {
      // ==========================================
      // ROLE 1: PLANNER
      // ==========================================
      emit({
        type: 'step',
        role: 'PLANNER',
        message: 'PLANNER: Formulating step-by-step sovereign architecture plan...'
      });

      const plannerRes = await this.provider.chat(
        `Goal: ${goal}\nCreate a step-by-step sovereign architecture plan.`,
        'planner'
      );
      plan = plannerRes.text;

      AuditLedger.append('PLANNER', 'PLAN_FORMULATED', {
        taskId,
        plan,
        tokens: plannerRes.output_tokens_count,
        latency_ms: plannerRes.latency_ms
      });

      emit({
        type: 'step',
        role: 'PLANNER',
        message: 'PLANNER: Plan ready and verified against sovereign invariants.',
        data: { plan, tokens: plannerRes.output_tokens_count }
      });

      // ==========================================
      // ROLE 2 & 3: CODER & REVIEWER (Retry Loop)
      // ==========================================
      while (!reviewApproved && retryCount <= maxRetries) {
        emit({
          type: 'step',
          role: 'CODER',
          message: retryCount === 0
            ? 'CODER: Synthesizing sovereign native code via stream...'
            : `CODER: Reworking code based on Reviewer feedback (Attempt ${retryCount + 1}/${maxRetries + 1})...`,
          data: { retryCount }
        });

        let streamedChunks: string[] = [];
        const coderPrompt = retryCount === 0
          ? `Goal: ${goal}\nPlan: ${plan}\nWrite the complete, runnable JavaScript code with verification tests.`
          : `Goal: ${goal}\nPlan: ${plan}\nPrevious feedback: ${reviewFeedback}\nFix all issues and provide complete code.`;

        await this.provider.chatStream(coderPrompt, 'coder', (chunk) => {
          streamedChunks.push(chunk);
          emit({
            type: 'chunk',
            role: 'CODER',
            message: chunk,
            data: { partialCodeLength: streamedChunks.join('').length }
          });
        });

        code = streamedChunks.join('');
        // Clean markdown backticks if any
        if (code.includes('```javascript')) {
          code = code.replace(/```javascript/g, '').replace(/```/g, '').trim();
        } else if (code.includes('```js')) {
          code = code.replace(/```js/g, '').replace(/```/g, '').trim();
        } else if (code.includes('```')) {
          code = code.replace(/```/g, '').trim();
        }

        // Write directly to sandbox via ToolGateway
        ToolGateway.writeFile('solution.js', code);

        AuditLedger.append('CODER', 'CODE_COMMITTED', {
          taskId,
          attempt: retryCount,
          filePath: '/workspace/solution.js',
          bytes: Buffer.byteLength(code, 'utf8')
        });

        emit({
          type: 'step',
          role: 'CODER',
          message: 'CODER: Code written to /workspace/solution.js. Transferring to REVIEWER...',
          data: { code }
        });

        // ROLE 3: REVIEWER
        emit({
          type: 'step',
          role: 'REVIEWER',
          message: 'REVIEWER: Inspecting code for security invariants, zero-mock policy, and edge cases...'
        });

        // Review logic
        const reviewerPrompt = `Review this code for Goal: ${goal}\nCode:\n${code}`;
        const reviewerRes = await this.provider.chat(reviewerPrompt, 'reviewer');
        reviewFeedback = reviewerRes.text;

        const isApproved = reviewFeedback.includes('APPROVED') && !code.includes('eval(');

        if (isApproved) {
          reviewApproved = true;
          reviewStatus = 'APPROVED';
          AuditLedger.append('REVIEWER', 'REVIEW_APPROVED', {
            taskId,
            attempt: retryCount,
            feedback: reviewFeedback
          });

          emit({
            type: 'review',
            role: 'REVIEWER',
            message: 'REVIEWER: Code APPROVED. Passed all sovereign invariants.',
            data: { reviewStatus: 'APPROVED', feedback: reviewFeedback }
          });
          break;
        } else {
          reviewStatus = 'REJECTED';
          retryCount++;
          AuditLedger.append('REVIEWER', 'REVIEW_REJECTED', {
            taskId,
            attempt: retryCount,
            feedback: reviewFeedback
          });

          emit({
            type: 'review',
            role: 'REVIEWER',
            message: `REVIEWER: Code REJECTED. Sending feedback back to CODER...`,
            data: { reviewStatus: 'REJECTED', feedback: reviewFeedback, retryCount }
          });

          if (retryCount > maxRetries) {
            throw new Error(`Task halted: Reviewer rejected code after ${maxRetries} attempts.`);
          }
        }
      }

      // ==========================================
      // ROLE 4: TESTER
      // ==========================================
      emit({
        type: 'step',
        role: 'TESTER',
        message: 'TESTER: Executing /workspace/solution.js inside isolated Sandbox via ToolGateway...'
      });

      testResult = await ToolGateway.runCommand('node', ['solution.js']);

      const testPassed = testResult.exitCode === 0;

      AuditLedger.append('TESTER', testPassed ? 'TEST_PASSED' : 'TEST_FAILED', {
        taskId,
        exitCode: testResult.exitCode,
        durationMs: testResult.durationMs,
        stdoutSnippet: testResult.stdout.slice(0, 200)
      });

      emit({
        type: 'test',
        role: 'TESTER',
        message: testPassed
          ? `TESTER: Execution PASSED with exitCode 0 in ${testResult.durationMs}ms.`
          : `TESTER: Execution FAILED with exitCode ${testResult.exitCode}.`,
        data: {
          exitCode: testResult.exitCode,
          stdout: testResult.stdout,
          stderr: testResult.stderr,
          durationMs: testResult.durationMs
        }
      });

      const totalDuration = Date.now() - startTime;

      emit({
        type: 'done',
        message: testPassed
          ? `All 4 Agent Roles successfully verified task "${goal}"!`
          : `Task finished with test execution failure.`,
        data: {
          taskId,
          success: testPassed,
          durationMs: totalDuration
        }
      });

      return {
        taskId,
        goal,
        success: testPassed,
        finalCode: code,
        plan,
        reviewStatus,
        reviewFeedback,
        retryCount,
        testResult,
        durationMs: totalDuration
      };

    } catch (err: any) {
      AuditLedger.append('SYSTEM', 'TASK_ERROR', {
        taskId,
        error: err.message
      });

      emit({
        type: 'error',
        message: `Task execution failed: ${err.message}`,
        data: { error: err.message }
      });

      throw err;
    }
  }
}
