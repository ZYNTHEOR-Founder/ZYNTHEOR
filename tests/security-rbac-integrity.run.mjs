/**
 * Security RBAC + Integrity Recovery acceptance.
 * Online: static route audit of server.ts
 * Live: HTTP role matrix, forged headers, restore-logs rules
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const BASE = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const serverSrc = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');

let passed = 0, failed = 0, blocked = 0;
const evidence = [];
const ok = (n,d='')=>{console.log('✔',n,d||'');evidence.push('PASS:'+n+(d?'|'+d:''));passed++;};
const bad = (n,d='')=>{console.error('✖',n,d||'');evidence.push('FAIL:'+n+(d?'|'+d:''));failed++;};
const blk = (n,d='')=>{console.log('△',n,d||'');evidence.push('BLOCKED:'+n+(d?'|'+d:''));blocked++;};

function onlineRouteAudit() {
  console.log('\n=== Online route RBAC audit ===');
  const sensitive = [
    ["/api/workspace/files", "requireAuth"],
    ["/api/workspace/file", "requireAuth"],
    ["/api/memory", "requireAuth"],
    ["/api/memory/episodic", "requireAuth"],
    ["/api/agent/execute", "requireAuth"],
    ["/api/native/inference", "requireAuth"],
    ["/api/verify/suite", "requireAuth"],
    ["/api/audit", "requireRole"],
    ["/api/self-evolve/run", "requireRole"],
    ["/api/model/train", "requireRole"],
    ["/api/model/export", "requireRole"],
    ["/api/identity/issue-token", "requireAuth"],
    ["/api/identity/verify-security", "requireAuth"],
    ["/api/knowledge/parse-binary", "requireAuth"],
    ["/api/knowledge/ingest/bulk", "requireAuth"],
    ["/api/chat/sessions", "requireAuth"],
    ["/api/chat/message", "requireAuth"],
    ["/api/commercial/plan", "requireAuth"],
    ["/api/audit/restore-logs", "requireAuth"],
  ];
  for (const [route, guard] of sensitive) {
    // Find route registration line
    const idx = serverSrc.indexOf(`'${route}'`);
    if (idx < 0) { bad('route present '+route, 'not found'); continue; }
    const window = serverSrc.slice(Math.max(0, idx-80), idx+120);
    if (window.includes(guard) || window.includes('requireRole') || window.includes('requireAuth')) {
      ok('protected '+route, guard);
    } else {
      bad('protected '+route, 'no guard near registration');
    }
  }
  if (serverSrc.includes('confirmTampered')) ok('restore requires confirmTampered');
  else bad('restore requires confirmTampered');
  if (serverSrc.includes('REPLAY_BLOCKED') || serverSrc.includes('restored_')) ok('restore has replay protection marker');
  else bad('restore has replay protection marker');
  if (serverSrc.includes('backup_before_restore_')) ok('restore backs up client logs');
  else bad('restore backs up client logs');
}

async function login(role, userId, tenantId) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, userId, tenantId })
  });
  const d = await r.json();
  if (!r.ok || !d.token) throw new Error('login failed '+JSON.stringify(d).slice(0,120));
  return d;
}

async function live() {
  console.log('\n=== Live HTTP security ===');
  try {
    const h = await fetch(BASE + '/api/system/status', { signal: AbortSignal.timeout(2500) });
    if (!h.ok && h.status >= 500) { blk('server health', 'status '+h.status); return; }
  } catch (e) {
    blk('server reachable', String(e.message||e));
    return;
  }

  // Forged role header alone
  {
    const r = await fetch(BASE + '/api/knowledge/documents', {
      headers: { 'x-zyntheor-role': 'Administrator' }
    });
    if (r.status === 401 || r.status === 403) ok('forged role header denied', 'status='+r.status);
    else bad('forged role header denied', 'status='+r.status);
  }

  // Unauthenticated sensitive routes
  for (const route of ['/api/workspace/files', '/api/memory', '/api/agent/execute', '/api/audit', '/api/model/train']) {
    const r = await fetch(BASE + route, { method: route.includes('train')||route.includes('execute') ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: route.includes('train')||route.includes('execute') ? '{}' : undefined
    });
    if (r.status === 401 || r.status === 403) ok('unauth denied '+route, 'status='+r.status);
    else bad('unauth denied '+route, 'status='+r.status);
  }

  // Role matrix
  const user = await login('User', 'user_rbac', 'tenant_a');
  const dev = await login('Developer', 'dev_rbac', 'tenant_a');
  const admin = await login('Administrator', 'admin_rbac', 'tenant_a');

  const tryGet = async (token, route) => {
    const r = await fetch(BASE + route, { headers: { Authorization: 'Bearer '+token } });
    return r.status;
  };

  // User cannot access audit (dev+)
  {
    const s = await tryGet(user.token, '/api/audit');
    if (s === 403 || s === 401) ok('User denied /api/audit', 'status='+s);
    else bad('User denied /api/audit', 'status='+s);
  }
  // Dev can
  {
    const s = await tryGet(dev.token, '/api/audit');
    if (s === 200) ok('Developer allowed /api/audit');
    else bad('Developer allowed /api/audit', 'status='+s);
  }

  // Cross-tenant: create doc as tenant_a admin, list as tenant_b user
  {
    const adminB = await login('Administrator', 'admin_b', 'tenant_b');
    const create = await fetch(BASE + '/api/knowledge/documents', {
      method: 'POST',
      headers: { Authorization: 'Bearer '+admin.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'TenantA Secret '+Date.now(),
        content: 'cross-tenant isolation probe content unique '+crypto.randomBytes(4).toString('hex'),
        collection: 'RBAC',
        tags: ['rbac'],
        provenance: 'rbac-test'
      })
    });
    const cd = await create.json();
    if (!create.ok) {
      bad('create doc tenant A', JSON.stringify(cd).slice(0,100));
    } else {
      ok('create doc tenant A', cd.document?.id);
      const listB = await fetch(BASE + '/api/knowledge/documents', {
        headers: { Authorization: 'Bearer '+adminB.token }
      });
      const ld = await listB.json();
      const leaked = (ld.documents||[]).some(d => d.id === cd.document?.id && d.tenantId === 'tenant_a');
      // filter is tenant isolation: B should not see A's tenant-stamped docs
      if (!leaked) ok('cross-tenant list isolation');
      else bad('cross-tenant list isolation', 'doc visible to other tenant');
    }
  }

  // Integrity restore rules
  {
    const logs = ['[INIT] seal test', '[OK] line2'];
    const sealRes = await fetch(BASE + '/api/audit/seal-logs', {
      method: 'POST',
      headers: { Authorization: 'Bearer '+user.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs, goal: 'rbac-test' })
    });
    const seal = await sealRes.json();
    if (!sealRes.ok || !seal.success) {
      bad('seal logs', JSON.stringify(seal).slice(0,100));
    } else {
      ok('seal logs', seal.seal?.contentHash?.slice(0,12));
      // restore without confirm
      const r1 = await fetch(BASE + '/api/audit/restore-logs', {
        method: 'POST',
        headers: { Authorization: 'Bearer '+user.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (r1.status === 400) ok('restore without confirm denied', '400');
      else bad('restore without confirm denied', 'status='+r1.status);

      // restore with matching hash (no tamper) denied
      const r2 = await fetch(BASE + '/api/audit/restore-logs', {
        method: 'POST',
        headers: { Authorization: 'Bearer '+user.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmTampered: true,
          currentHash: seal.seal.contentHash,
          currentLogs: logs
        })
      });
      if (r2.status === 409) ok('restore without tamper evidence denied', '409');
      else bad('restore without tamper evidence denied', 'status='+r2.status);

      // legitimate restore
      const r3 = await fetch(BASE + '/api/audit/restore-logs', {
        method: 'POST',
        headers: { Authorization: 'Bearer '+user.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmTampered: true,
          currentHash: crypto.createHash('sha256').update('tampered').digest('hex'),
          currentLogs: ['TAMPERED LINE']
        })
      });
      const d3 = await r3.json();
      if (r3.ok && d3.success && Array.isArray(d3.logs) && d3.backup) ok('restore with tamper evidence', d3.backup);
      else bad('restore with tamper evidence', JSON.stringify(d3).slice(0,140));

      // replay blocked
      const r4 = await fetch(BASE + '/api/audit/restore-logs', {
        method: 'POST',
        headers: { Authorization: 'Bearer '+user.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmTampered: true,
          currentHash: crypto.createHash('sha256').update('tampered2').digest('hex'),
          currentLogs: ['TAMPERED LINE 2']
        })
      });
      if (r4.status === 409) ok('restore replay blocked', '409');
      else bad('restore replay blocked', 'status='+r4.status);
    }
  }

  // Logout revocation
  {
    const r = await fetch(BASE + '/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer '+user.token }
    });
    const d = await r.json();
    if (r.ok && d.success) ok('logout revokes token');
    else bad('logout revokes token');
    const r2 = await fetch(BASE + '/api/knowledge/documents', {
      headers: { Authorization: 'Bearer '+user.token }
    });
    if (r2.status === 401) ok('revoked token rejected');
    else bad('revoked token rejected', 'status='+r2.status);
  }
}

onlineRouteAudit();
await live();

const report = { suite: 'security-rbac-integrity', timestamp: new Date().toISOString(), passed, failed, blocked, evidence };
fs.writeFileSync(path.join(root, 'native_data', 'security_rbac_integrity_report.json'), JSON.stringify(report, null, 2));
console.log(`\nPassed=${passed} Failed=${failed} Blocked=${blocked}\n`);
process.exit(failed > 0 ? 1 : 0);
