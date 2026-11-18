import fs from 'node:fs';
import assert from 'node:assert/strict';

const admin = fs.readFileSync('src/components/modules/AdminConsole.tsx', 'utf8');
const chat = fs.readFileSync('src/components/modules/ConversationalIntelligence.tsx', 'utf8');
const research = fs.readFileSync('src/components/modules/ResearchLab.tsx', 'utf8');
const bridge = fs.readFileSync('qplus_native/bridge.py', 'utf8');
const audit = fs.readFileSync('src/utils/auditLedger.ts', 'utf8');
const initializer = fs.readFileSync('qplus_native/init_weights.py', 'utf8');
const trainer = fs.readFileSync('qplus_native/trainer.py', 'utf8');

assert.doesNotMatch(admin, /sess_sovereign_01|46,500 tokens\/sec|100% MATHEMATICALLY VERIFIED/);
assert.match(admin, /No verification run recorded/);
assert.match(admin, /No verification evidence is available yet/);
assert.match(admin, /does not display fabricated sessions or simulate token revocation/);
assert.match(chat, /Sovereign Runtime/);
assert.doesNotMatch(chat, /Sovereign Localhost|Persisted on sovereign disk/);
assert.match(research, /No PDF export is offered here until a real report-generation endpoint exists/);
assert.doesNotMatch(research, /exceptional resilience|100% adherence|Download PDF/);
assert.match(bridge, /validate_cloud_url/);
assert.match(bridge, /P6_INTEGRITY/);
assert.match(bridge, /"status": "PARTIAL"/);
assert.doesNotMatch(bridge, /P6_LOCAL_ONLY|Peak inference rate/);
assert.match(audit, /Client-Side Audit Cache \(Non-Authoritative\)/);
assert.doesNotMatch(audit, /airgapped:\s*true/);
assert.doesNotMatch(initializer + trainer, /online_execution_verified/);

console.log('Online product integrity: 15 assertions passed.');
