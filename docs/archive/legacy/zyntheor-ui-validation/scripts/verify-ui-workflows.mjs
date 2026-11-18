import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const types = read('src/types.ts');
const app = read('src/App.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const mobile = read('src/components/MobileNav.tsx');
const header = read('src/components/Header.tsx');
const failures = [];

const moduleBlock = types.match(/export type ModuleId\s*=([\s\S]*?);/);
if (!moduleBlock) {
  console.error('[FAIL] ModuleId union not found.');
  process.exit(1);
}
const moduleIds = [...moduleBlock[1].matchAll(/'([^']+)'/g)].map(([, id]) => id);
for (const id of moduleIds) {
  if (!new RegExp(`case\\s+['"]${id}['"]\\s*:`).test(app)) failures.push(`No renderActiveModule case for ${id}`);
  if (!sidebar.includes(`id: '${id}'`)) failures.push(`No sidebar route entry for ${id}`);
}
for (const [label, source, token] of [
  ['application shell', app, 'app-shell'],
  ['workspace frame', app, 'app-workspace'],
  ['mobile navigation', app, '<MobileNav'],
  ['header navigation', app, '<Header'],
  ['role-gated navigation', sidebar, 'roleAllows(role, item.minRole)'],
  ['role-gated route rendering', app, "role === 'Developer' || role === 'Administrator'"],
  ['administrator route gate', app, "role === 'Administrator'"],
  ['mobile selected-page state', mobile, 'aria-current={isActive ? "page" : undefined}'],
  ['responsive shell layout', read('src/index.css'), '.app-workspace > main'],
]) {
  if (!source.includes(token)) failures.push(`Missing ${label} integration (${token})`);
}

if (failures.length) {
  console.error('[FAIL] UI workflow structure:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[PASS] ${moduleIds.length} module routes have render and sidebar entries.`);
console.log('[PASS] Application shell, workspace, header, mobile nav, role gates and responsive frame are wired.');
console.log('[NOTE] These are source-structure checks, not browser interaction or production-runtime tests.');
