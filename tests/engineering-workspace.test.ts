import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SoftwareProjectManager } from '../lib/SoftwareProjectManager.ts';
import { buildTruthDashboardSnapshot } from '../lib/DashboardTruth.ts';
import { ConnectivityMonitor } from '../lib/ConnectivityMonitor.ts';

async function run(): Promise<void> {
  const manager = SoftwareProjectManager.getInstance();
  const scope = {
    tenantId: 'test-tenant-sec10',
    userId: 'dev-user-1',
    role: 'developer' as const,
  };

  console.log('1) Scaffolding full-stack Node project in Section 10 sandbox...');
  const project = await manager.createAndScaffoldProject(
    {
      name: 'Incident Telemetry Service',
      prompt: 'Create a service health monitor with REST endpoints for incidents and SLA reports',
      stack: 'node_fullstack',
      runChecks: true,
    },
    scope
  );

  try {
    assert.ok(project.projectId.startsWith('proj_'));
    assert.equal(project.tenantId, scope.tenantId);
    assert.equal(project.stages.length, 13, 'Must track all 13 lifecycle stages');
    assert.equal(project.lastBuild?.status, 'VERIFIED');
    assert.equal(project.lastTests?.status, 'VERIFIED');
    assert.ok((project.lastTests?.passed ?? 0) > 0);
    assert.equal(project.lastSecurityScan?.status, 'VERIFIED');

    console.log('2) Editing project file + committing SHA-256 revision & testing rollback...');
    const rev1Id = project.currentRevision;
    const beforePkg = manager.readProjectFile(project.projectId, 'package.json', scope);
    assert.ok(beforePkg.includes('"name"'));

    const writeRes = manager.writeProjectFile(
      project.projectId,
      'src/notes.js',
      'export const MODULE_NOTE = "section10-rev2";\n',
      'Add notes module',
      scope
    );
    assert.notEqual(writeRes.revision.revisionId, rev1Id);
    assert.equal(writeRes.project.revisions.length, 2);

    const rolledBack = manager.rollbackToRevision(project.projectId, rev1Id, scope);
    assert.equal(rolledBack.revisions.length, 3, 'Rollback creates restorative revision snapshot');
    const latestFiles = rolledBack.revisions[rolledBack.revisions.length - 1].files.map((f) => f.relativePath);
    assert.ok(!latestFiles.includes('src/notes.js'), 'Rolled back revision must exclude src/notes.js');

    console.log('3) Verifying ApprovalGate enforcement on deployment...');
    const deployBlocked = await manager.requestOrExecuteDeploy(project.projectId, {}, scope);
    assert.equal(deployBlocked.project.deployment.status, 'PENDING_APPROVAL');
    assert.ok(deployBlocked.approvalRequestId, 'Deployment without approval must create ApprovalGate request');

    console.log('4) Inspecting honest 13-capability matrix & Section 1-10 TruthDashboard snapshot...');
    const capsSnapshot = await manager.getSoftwareCapabilitiesSnapshot();
    assert.equal(capsSnapshot.capabilities.length, 13);

    const connState = await ConnectivityMonitor.getInstance().checkNow();
    const dashboard = await buildTruthDashboardSnapshot(connState, {
      wsClientCount: 0,
      wsLastFrameAt: null,
      apiAvgLatencyMs: 12,
      apiSampleCount: 1,
      lastRecordedTokensPerSec: null,
      lastInferenceLatencyMs: null,
    });

    assert.equal(dashboard.systemStatusOverview.length, 9, 'Section 1 must contain 9 required statuses');
    assert.equal(dashboard.nativeIntelligenceGates.length, 7, 'Section 2 must contain 7 intelligence gates');
    assert.ok(
      dashboard.multimodalCapabilities.some((m) => m.id === 'document_understanding' && m.status === 'PARTIAL'),
      'Document Understanding must report PARTIAL'
    );
    assert.ok(
      dashboard.multimodalCapabilities.some((m) => m.id === 'ocr' && m.status === 'NOT_IMPLEMENTED'),
      'OCR must report NOT_IMPLEMENTED'
    );
    assert.equal(typeof dashboard.onlineRuntimeConnectivity.configured, 'boolean');
    assert.equal(typeof dashboard.onlineRuntimeConnectivity.connected, 'boolean');
    assert.equal(typeof dashboard.onlineRuntimeConnectivity.operational, 'boolean');
    assert.equal(dashboard.softwareEngineering.capabilities.length, 13);

    console.log('SUCCESS: Section 10 SoftwareProjectManager & TruthDashboard verification passed.');
  } finally {
    ConnectivityMonitor.getInstance().stopBackgroundMonitor();
    // Cleanup temporary test project directory cleanly
    const projAbs = path.join(process.cwd(), 'workspace', project.workspaceDir);
    if (fs.existsSync(projAbs)) {
      fs.rmSync(projAbs, { recursive: true, force: true });
    }
    const metaFile = path.join(process.cwd(), 'workspace', '.engineering', `${project.projectId}.json`);
    if (fs.existsSync(metaFile)) {
      fs.rmSync(metaFile, { force: true });
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
  });
