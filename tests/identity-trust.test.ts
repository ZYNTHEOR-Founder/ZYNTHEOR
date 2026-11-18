/**
 * ZYNTHEOR Identity & Trust Layer — Security Control Tests
 * No mocks: real SovereignIdentity crypto, real AuditLedger, real middleware logic.
 * Run: npm run test:identity   (requires tsx)
 * Or:  node tests/identity-trust.run.mjs
 */

import fs from 'fs';
import path from 'path';
import { SovereignIdentity } from '../lib/SovereignIdentity';
import { AuditLedger } from '../lib/AuditLedger';
import {
  sealLogsServerSide,
  verifyLogsAgainstSeal,
  UI_TO_SOVEREIGN,
  roleAtLeast
} from '../lib/AuthMiddleware';

let passed = 0;
let failed = 0;
const evidence: string[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`✔ ${name}${detail ? ` — ${detail}` : ''}`);
    evidence.push(`PASS: ${name}`);
    passed++;
  } else {
    console.error(`✖ ${name}${detail ? ` — ${detail}` : ''}`);
    evidence.push(`FAIL: ${name}`);
    failed++;
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('  ZYNTHEOR IDENTITY & TRUST LAYER — CONTROL TESTS');
  console.log('======================================================\n');

  const identity = SovereignIdentity.getInstance();

  const { token: adminToken } = identity.signToken({
    sub: 'usr_admin_test',
    tenantId: 'tenant_alpha',
    role: 'admin',
    ttlSeconds: 600
  });
  const ok = identity.verifyToken(adminToken);
  assert(ok.valid === true && ok.code === 'VERIFIED', 'T01 Legitimate admin token verifies', ok.code);

  const { token: guestToken } = identity.signToken({
    sub: 'usr_guest',
    tenantId: 'tenant_alpha',
    role: 'guest',
    ttlSeconds: 600
  });
  const guestAsAdmin = identity.verifyToken(guestToken, { requiredRole: 'admin' });
  assert(
    guestAsAdmin.valid === false && guestAsAdmin.code === 'UNAUTHORIZED_ROLE',
    'T02 Forged privilege: guest token denied for admin-required operation',
    guestAsAdmin.code
  );

  const { token: devToken } = identity.signToken({
    sub: 'usr_dev',
    tenantId: 'tenant_alpha',
    role: 'developer',
    ttlSeconds: 600
  });
  const escalated = identity.verifyToken(devToken, { requiredRole: 'admin' });
  assert(
    escalated.valid === false && escalated.code === 'UNAUTHORIZED_ROLE',
    'T03 Privilege escalation blocked (developer < admin)',
    escalated.code
  );

  const { token: shortLived } = identity.signToken({
    sub: 'usr_exp',
    tenantId: 'tenant_alpha',
    role: 'developer',
    ttlSeconds: 1
  });
  const future = Math.floor(Date.now() / 1000) + 10;
  const expired = identity.verifyToken(shortLived, { currentTimestamp: future });
  assert(
    expired.valid === false && expired.code === 'TOKEN_EXPIRED',
    'T04 Expired session rejected',
    expired.code
  );

  const tampered = adminToken.slice(0, -8) + 'AAAAAAAA';
  const tamperRes = identity.verifyToken(tampered);
  assert(
    tamperRes.valid === false && tamperRes.code === 'SIGNATURE_MISMATCH',
    'T05 Tampered signature rejected',
    tamperRes.code
  );

  const garbage = identity.verifyToken('not.a.real.token.at.all');
  assert(garbage.valid === false, 'T06 Malformed/garbage token rejected (direct API bypass blocked)', garbage.code);

  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'ZY-TOKEN' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'hacker',
      tenantId: 'tenant_alpha',
      role: 'admin',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    })
  ).toString('base64url');
  const noneRes = identity.verifyToken(`${header}.${payload}.`);
  assert(
    noneRes.valid === false &&
      (noneRes.code === 'UNSUPPORTED_ALGORITHM' ||
        noneRes.code === 'MALFORMED_STRUCTURE' ||
        noneRes.code === 'SIGNATURE_MISMATCH'),
    'T07 alg:none / unsupported algorithm rejected',
    noneRes.code
  );

  const cross = identity.verifyToken(adminToken, { expectedTenantId: 'tenant_beta' });
  assert(
    cross.valid === false && cross.code === 'TENANT_MISMATCH',
    'T08 Cross-tenant access blocked',
    cross.code
  );

  const logs = ['[INIT] test', '[DONE] ok'];
  const seal = sealLogsServerSide(logs, {
    userId: 'usr_admin_test',
    tenantId: 'tenant_alpha',
    goal: 'unit-test'
  });
  assert(
    typeof seal.contentHash === 'string' && seal.contentHash.length === 64,
    'T09 Server seal produces SHA-256 content hash',
    seal.contentHash.slice(0, 16)
  );

  const intact = verifyLogsAgainstSeal(logs, seal.contentHash);
  assert(intact.match === true, 'T10 Unmodified logs match server seal');

  const mutated = verifyLogsAgainstSeal(['[INIT] test', '[DONE] TAMPERED'], seal.contentHash);
  assert(mutated.match === false, 'T11 Mutated logs fail server seal verification');

  const chain = AuditLedger.verifyIntegrity();
  assert(chain.valid === true, 'T12 Audit ledger hash chain remains valid after seals', `records=${chain.totalRecords}`);

  assert(UI_TO_SOVEREIGN.User === 'guest', 'T13 UI User maps to guest');
  assert(UI_TO_SOVEREIGN.Developer === 'developer', 'T14 UI Developer maps to developer');
  assert(UI_TO_SOVEREIGN.Administrator === 'admin', 'T15 UI Administrator maps to admin');
  assert(roleAtLeast('admin', 'developer') === true, 'T16 admin >= developer');
  assert(roleAtLeast('guest', 'admin') === false, 'T17 guest < admin');

  const roleOnly = identity.verifyToken('Administrator');
  assert(roleOnly.valid === false, 'T18 Raw role string is not accepted as token', roleOnly.code);

  const sim = identity.runSecuritySimulation();
  const simPass = sim.every((r) => r.status === 'PASS');
  assert(
    simPass,
    'T19 SovereignIdentity security simulation all PASS',
    `${sim.filter((s) => s.status === 'PASS').length}/${sim.length}`
  );

  console.log('\n------------------------------------------------------');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log('------------------------------------------------------\n');

  const outDir = path.resolve(process.cwd(), 'native_data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'identity_trust_test_report.json'),
    JSON.stringify({ suite: 'identity-trust', timestamp: new Date().toISOString(), passed, failed, evidence, simulation: sim }, null, 2),
    'utf8'
  );

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
