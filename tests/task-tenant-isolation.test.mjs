/** Static regression checks for task ownership and tenant isolation. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const orchestrator = fs.readFileSync(path.join(root, 'lib/TaskOrchestrator.ts'), 'utf8');
const checks = [
  ['persistent tasks carry verified owner and tenant', /ownerUserId:\s*string/.test(orchestrator) && /tenantId:\s*string/.test(orchestrator)],
  ['queue creation requires server-supplied identity', /enqueueTask\(goal, priority, \{ userId: req\.sovereignUserId!, tenantId: req\.sovereignTenantId! \}\)/.test(server)],
  ['task history is scoped to verified identity', /listTasksFor\(\{ userId: req\.sovereignUserId!, tenantId: req\.sovereignTenantId! \}\)/.test(server)],
  ['queued execution only selects caller-owned tasks', /listTasksFor\(identity\)\.find\(\(t\) => t\.lifecycleStatus === 'Planned'\)/.test(server)],
  ['resume lookup checks both owner and tenant', /getTaskFor\(taskId, identity\)/.test(server) && /getTaskFor\(taskId, identity\)/.test(orchestrator)],
  ['direct execution records verified owner and tenant', /ownerUserId: req\.sovereignUserId, tenantId: req\.sovereignTenantId/.test(server)],
  ['deliverable download verifies task ownership', /ownsDeliverable[\s\S]*listTasksFor\(identity\)[\s\S]*zipFilename === filename/.test(server)],
  ['global execution aggregates are administrator-only', (server.match(/app\.get\('\/api\/agent\/(?:scheduled-checks|metrics|cycles)', requireAuth\('admin'\)/g) || []).length === 3],
  ['shared workspace endpoints are administrator-only', /app\.get\('\/api\/workspace\/files', requireAuth\('admin'\)/.test(server) && /app\.post\('\/api\/workspace\/run', requireRole\(\['Administrator'\]\)/.test(server)],
  ['client request body cannot supply task owner fields', !/ownerUserId\s*:\s*req\.body/.test(server) && !/tenantId\s*:\s*req\.body/.test(server)],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} tenant isolation checks passed`);
if (failed) process.exit(1);
