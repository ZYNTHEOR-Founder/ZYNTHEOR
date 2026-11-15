import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gateway = fs.readFileSync(new URL('../lib/ToolGateway.ts', import.meta.url), 'utf8');
const orchestrator = fs.readFileSync(new URL('../lib/TaskOrchestrator.ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

test('execution child process does not inherit the server environment wholesale', () => {
  assert.doesNotMatch(gateway, /\.\.\.process\.env/);
  assert.match(gateway, /NODE_PATH: cwd/);
  assert.match(gateway, /PYTHONPATH: cwd/);
  assert.doesNotMatch(gateway, /'rm'/);
});

test('each orchestrated task receives a collision-resistant workspace path', () => {
  assert.match(orchestrator, /crypto\.randomUUID\(\)/);
  assert.match(orchestrator, /const ownerScope = crypto\.createHash\('sha256'\)/);
  assert.match(orchestrator, /const taskWorkspace = `tenants\/\$\{ownerScope\}\/tasks\/\$\{taskId\}`;/);
  assert.match(orchestrator, /VERIFIED_TASK_OWNER_REQUIRED/);
  assert.match(orchestrator, /runCommand\('node', \['--check', solutionPath\]\)/);
  assert.match(orchestrator, /BLOCKED_CLOUD_RUNNER/);
  assert.match(orchestrator, /runtimeExecuted: false/);
  assert.doesNotMatch(orchestrator, /writeFile\('solution\.js'/);
});

test('agent execution validates goal length before invoking the runtime', () => {
  assert.match(server, /goal\.length > 8000/);
  assert.match(server, /INVALID_TASK_GOAL/);
});
