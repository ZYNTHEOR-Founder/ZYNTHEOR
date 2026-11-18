import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../src/db/schema.ts', import.meta.url), 'utf8');
const dbIndex = fs.readFileSync(new URL('../src/db/index.ts', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../src/db/task-repository.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../src/db/migrations/0001_execution_tasks.sql', import.meta.url), 'utf8');

assert.match(schema, /export const executionTasks = pgTable\(\s*'execution_tasks'/);
assert.match(schema, /tenantId: text\('tenant_id'\)\.notNull\(\)/);
assert.match(schema, /ownerUserId: text\('owner_user_id'\)\.notNull\(\)/);
assert.match(schema, /index\('execution_tasks_tenant_owner_created_idx'\)/);
assert.match(dbIndex, /CLOUD_SQL_NOT_CONFIGURED/);
assert.doesNotMatch(dbIndex, /createChainProxy|Promise\.resolve\(\[\]\)|findMany: async \(\) => \[\]/);
assert.match(repository, /isolationLevel: 'serializable'/);
assert.match(repository, /eq\(executionTasks\.tenantId, owner\.tenantId\)/);
assert.match(repository, /eq\(executionTasks\.ownerUserId, owner\.ownerUserId\)/);
assert.match(repository, /onConflictDoNothing/);
assert.match(repository, /TASK_ID_OWNERSHIP_CONFLICT/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS execution_tasks/);
assert.match(migration, /PRIMARY KEY/);
console.log('task-db-repository-integrity: 12/12 PASS (static source assertions only)');
