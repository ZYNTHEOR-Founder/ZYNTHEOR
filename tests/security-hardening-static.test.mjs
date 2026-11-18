/** Static security regression tests for auth, tenant ownership, and development login. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const authContext = fs.readFileSync(path.join(root, 'src/context/AuthContext.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const checks = [
  ["production blocks role-selectable login", /process\.env\.NODE_ENV\s*===\s*'production'/.test(server)],
  ["development login requires explicit opt-in", /process\.env\.ZYNTHEOR_ENABLE_DEV_LOGIN\s*!==\s*'true'/.test(server)],
  ["task execution requires verified developer identity", /app\.post\('\/api\/agent\/execute',\s*requireAuth\('developer'\)/.test(server)],
  ["task history is developer-authenticated", /app\.get\('\/api\/agent\/tasks',\s*requireAuth\('developer'\)/.test(server)],
  ["queue mutation is developer-authenticated", /app\.post\('\/api\/agent\/queue',\s*requireAuth\('developer'\)/.test(server)],
  ["task resume is developer-authenticated", /app\.post\('\/api\/agent\/tasks\/:taskId\/resume',\s*requireAuth\('developer'\)/.test(server)],
  ["deliverable downloads require developer auth and owner check", /app\.get\('\/api\/agent\/deliverables\/:filename',\s*requireAuth\('developer'\)/.test(server) && /ownsDeliverable/.test(server)],
  ["development login is disabled by default in env template", /ZYNTHEOR_ENABLE_DEV_LOGIN=false/.test(envExample)],
  ["no automatic privileged administrator bootstrap", !/await login\('Administrator'\)/.test(authContext)],
  ["customer UI offers explicit identity-provider sign-in", /loginWithGoogle\(\)/.test(app) && /Continue with Google/.test(app)],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} security regression checks passed`);
if (failed) process.exit(1);
