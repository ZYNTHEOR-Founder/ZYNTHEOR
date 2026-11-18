import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production server has no external-brain controller or status wiring', () => {
  const server = read('server.ts');
  const providers = read('lib/providers.ts');
  assert.doesNotMatch(server, /ExternalBrainProvider|externalBrain\s*:/);
  assert.doesNotMatch(providers, /ExternalBrainProvider|HYBRID_EXTERNAL_BRAIN|ZYNTHEOR_BRAIN_PROVIDER/);
  assert.match(server, /NATIVE_ONLY_POLICY/);
  assert.match(server, /External AI brain execution is disabled/);
});

test('stage benchmark CLI cannot start an external provider', () => {
  const stageBench = read('qplus_native/stage_bench.py');
  assert.doesNotMatch(stageBench, /add_argument\(["']--real/);
  assert.match(stageBench, /SPECIFICATION_ONLY/);
  assert.match(stageBench, /"executionPerformed": False/);
  assert.match(stageBench, /"scoresGenerated": False/);
});

test('navigation keeps the existing modules in task-oriented groups', () => {
  const sidebar = read('src/components/Sidebar.tsx');
  const mobile = read('src/components/MobileNav.tsx');
  for (const id of [
    'command_center', 'conversational_intelligence', 'intelligence_core', 'proof_of_intelligence',
    'dev_studio', 'research_lab', 'automation_center', 'knowledge_hub', 'model_laboratory',
    'experiment_center', 'infrastructure_cloud', 'api_platform', 'marketplace',
    'subscription_billing', 'analytics_bi', 'governance_security', 'user_settings', 'admin_console',
  ]) assert.ok(sidebar.includes(`'${id}'`), `missing navigation item ${id}`);
  assert.match(sidebar, /System Control/);
  assert.match(mobile, /All modules/);
  assert.doesNotMatch(mobile, /label: lang === 'th' \? 'แชท' : 'Chat'/);
});

test('duplicate validation snapshot is archived rather than left as a second project', () => {
  assert.equal(fs.existsSync(new URL('../zyntheor_ui_validation/', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../docs/archive/legacy/zyntheor-ui-validation/', import.meta.url)), true);
});

test('production source contains no Gemini integration references', () => {
  const files = ['src', 'server', 'server.ts', 'lib', 'qplus_native', 'scripts'];
  for (const path of files) {
    const stat = fs.statSync(new URL(`../${path}`, import.meta.url));
    if (stat.isFile()) {
      assert.doesNotMatch(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), /gemini|generativelanguage/i);
      continue;
    }
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx?|py|mjs|js)$/.test(entry.name)) {
          assert.doesNotMatch(fs.readFileSync(full, 'utf8'), /gemini|generativelanguage/i, full);
        }
      }
    };
    walk(new URL(`../${path}`, import.meta.url).pathname);
  }
});
