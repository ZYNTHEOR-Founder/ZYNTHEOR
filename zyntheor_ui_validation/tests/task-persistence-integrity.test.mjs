/** Regression checks for durable task-state persistence guarantees. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'lib/TaskOrchestrator.ts'), 'utf8');
const checks = [
  ['corrupt task state fails closed instead of silently resetting', /const parsed: unknown = JSON\.parse\(raw\)/.test(source) && /throw new Error\('TASK_STATE_INVALID/.test(source) && !/Ignore corrupt tasks state file/.test(source)],
  ['task state writes use exclusive temporary file', /openSync\(tempPath, 'wx', 0o600\)/.test(source)],
  ['task state writes are flushed before atomic rename', /fsyncSync\(fd\)[\s\S]*renameSync\(tempPath, this\.tasksFilePath\)/.test(source)],
  ['persistence failures propagate to callers', /TASK_STATE_PERSIST_FAILED/.test(source) && /throw err;/.test(source)],
  ['failed persistence rolls back in-memory task mutation', /catch \(err\) \{[\s\S]*if \(idx >= 0 && previous\) this\.tasks\[idx\] = previous;[\s\S]*else this\.tasks\.shift\(\);[\s\S]*throw err;/.test(source)],
  ['task retention no longer silently truncates to 100 records', !/this\.tasks\.slice\(0, 100\)/.test(source) && /MAX_TASK_RECORDS = 10_000/.test(source)],
  ['task writes require owner and tenant', /if \(!record\.ownerUserId \|\| !record\.tenantId\)/.test(source)],
  ['legacy records remain excluded from identity-scoped reads', /task\.ownerUserId === identity\.userId && task\.tenantId === identity\.tenantId/.test(source)],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} task persistence checks passed`);
if (failed) process.exit(1);
