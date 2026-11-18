import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterAll } from '@jest/globals';
import {
  ASSISTANT_FUNCTION_DECLARATIONS,
  executeLocalTool,
  type AssistantGroundingSource,
  type AssistantProposedAction,
} from '../assistant';

const WORKSPACE_ROOT = path.resolve(process.cwd(), 'workspace');
const TEST_FILE = '__phase6_jest_probe__.js';
const TEST_ABS = path.join(WORKSPACE_ROOT, TEST_FILE);

describe('Phase 6 Assistant Autonomous Tools & RBAC Enforcement', () => {
  afterAll(() => {
    try {
      if (fs.existsSync(TEST_ABS)) fs.unlinkSync(TEST_ABS);
    } catch {
      // ignore cleanup failures
    }
  });

  it('registers write_workspace_file, run_terminal_command, execute_python_sandbox, and search_internet declarations', () => {
    const names = new Set(ASSISTANT_FUNCTION_DECLARATIONS.map((d) => d.name));
    expect(names.has('write_workspace_file')).toBe(true);
    expect(names.has('run_terminal_command')).toBe(true);
    expect(names.has('execute_python_sandbox')).toBe(true);
    expect(names.has('search_internet')).toBe(true);
  });

  it('denies privileged write/exec tools when verifiedCallerRole is guest even if client context role claims admin', async () => {
    const actions: AssistantProposedAction[] = [];
    const sources: AssistantGroundingSource[] = [];

    const writeDenied = await executeLocalTool(
      'write_workspace_file',
      { path: TEST_FILE, content: 'console.log("should not write");' },
      actions,
      sources,
      { role: 'admin', verifiedCallerRole: 'guest', sessionId: 'rbac-test' }
    );
    expect(writeDenied.ok).toBe(false);
    expect(String(writeDenied.data.error || '')).toContain('SECURITY_PERMISSION_DENIED');

    const cmdDenied = await executeLocalTool(
      'run_terminal_command',
      { command: 'node', argsString: '-e console.log(1)' },
      actions,
      sources,
      { role: 'admin', verifiedCallerRole: 'guest', sessionId: 'rbac-test' }
    );
    expect(cmdDenied.ok).toBe(false);
    expect(String(cmdDenied.data.error || '')).toContain('SECURITY_PERMISSION_DENIED');

    const pyDenied = await executeLocalTool(
      'execute_python_sandbox',
      { code: 'print(42)' },
      actions,
      sources,
      { role: 'admin', verifiedCallerRole: 'guest', sessionId: 'rbac-test' }
    );
    expect(pyDenied.ok).toBe(false);
    expect(String(pyDenied.data.error || '')).toContain('SECURITY_PERMISSION_DENIED');
  });

  it('enforces Path Jail on write_workspace_file for verified developer role', async () => {
    const actions: AssistantProposedAction[] = [];
    const sources: AssistantGroundingSource[] = [];

    const traversal = await executeLocalTool(
      'write_workspace_file',
      { path: '../escaped_secret.js', content: 'console.log("evil")' },
      actions,
      sources,
      { verifiedCallerRole: 'developer', sessionId: 'jail-test' }
    );
    expect(traversal.ok).toBe(false);
  });

  it('allows verified developer to write inside /workspace and run allowlisted node command', async () => {
    const actions: AssistantProposedAction[] = [];
    const sources: AssistantGroundingSource[] = [];

    const wrote = await executeLocalTool(
      'write_workspace_file',
      { path: TEST_FILE, content: 'console.log("PHASE6_NODE_OK");\n' },
      actions,
      sources,
      { verifiedCallerRole: 'developer', sessionId: 'exec-test' }
    );
    expect(wrote.ok).toBe(true);

    const ran = await executeLocalTool(
      'run_terminal_command',
      { command: 'node', argsString: TEST_FILE },
      actions,
      sources,
      { verifiedCallerRole: 'developer', sessionId: 'exec-test' }
    );
    expect(ran.ok).toBe(true);
    expect(String(ran.data.stdout || '')).toContain('PHASE6_NODE_OK');
  });
});
