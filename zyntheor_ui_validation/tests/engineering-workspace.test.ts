import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SoftwareProjectManager } from '../lib/SoftwareProjectManager.ts';
import { InternetIntegrationEngine } from '../lib/InternetIntegrationEngine.ts';
import { buildTruthDashboardSnapshot } from '../lib/DashboardTruth.ts';
import { ConnectivityMonitor } from '../lib/ConnectivityMonitor.ts';

async function run(): Promise<void> {
  const manager = SoftwareProjectManager.getInstance();
  const internetEngine = InternetIntegrationEngine.getInstance();
  const scope = {
    tenantId: 'test-tenant-sec10',
    userId: 'dev-user-1',
    role: 'developer' as const,
  };

  console.log('1) Scaffolding complete Application-First project in Section 10 sandbox...');
  const project = await manager.createAndScaffoldProject(
    {
      name: 'Incident Telemetry Service',
      prompt: 'Create a SaaS service health monitor portal with analytics, user registration, and incident tracking',
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

    const html = manager.readProjectFile(project.projectId, 'public/index.html', scope);
    assert.ok(html.includes('data-view="analytics"') && html.includes('data-view="users"'), 'Must render multi-view interactive UI');
    assert.ok(!html.includes('innerHTML'), 'Must never use unsafe innerHTML');

    console.log('2) Testing Database inspector & Natural Language app iteration...');
    const dbInfo = manager.inspectProjectDatabase(project.projectId, scope);
    assert.ok(dbInfo.schema, 'Must detect application data schema');
    assert.ok(dbInfo.dataFiles.some((f) => f.relativePath === 'data/schema.json'));

    const iterRes = await manager.iterateProjectWithRequest(
      project.projectId,
      { instruction: 'Add SLA escalation matrix panel and audit timestamp badge', runChecks: true },
      scope
    );
    assert.ok(iterRes.modifiedFiles.includes('public/index.html'));
    assert.equal(iterRes.project.lastBuild?.status, 'VERIFIED');
    assert.equal(iterRes.project.lastTests?.status, 'VERIFIED');
    assert.equal(iterRes.project.lastSecurityScan?.status, 'VERIFIED');

    console.log('3) Editing project file + committing SHA-256 revision & testing rollback...');
    const revBeforeEdit = iterRes.project.currentRevision;
    const beforePkg = manager.readProjectFile(project.projectId, 'package.json', scope);
    assert.ok(beforePkg.includes('"name"'));

    const writeRes = manager.writeProjectFile(
      project.projectId,
      'src/notes.js',
      'export const MODULE_NOTE = "section10-rev-notes";\n',
      'Add notes module',
      scope
    );
    assert.notEqual(writeRes.revision.revisionId, revBeforeEdit);

    const rolledBack = manager.rollbackToRevision(project.projectId, revBeforeEdit, scope);
    const latestFiles = rolledBack.revisions[0].files.map((f) => f.relativePath);
    assert.ok(!latestFiles.includes('src/notes.js'), 'Rolled back revision must exclude src/notes.js');

    console.log('4) Testing Visual Inspector, Preview Bridge & Real Source Patching...');
    const preview = manager.getPreviewPayload(project.projectId, scope);
    assert.ok(preview.html.includes('ZYNTHEOR_ELEMENT_SELECTED'), 'Preview copy must include postMessage bridge');
    assert.ok(!preview.rawHtml.includes('ZYNTHEOR_ELEMENT_SELECTED'), 'Disk public/index.html must remain unpolluted');
    assert.ok(preview.visualElements.some((v) => v.zId === 'brand_title'), 'Must index data-z-id="brand_title"');

    const patchRes = await manager.applyVisualPropertyPatch(
      project.projectId,
      {
        targetId: 'brand_title',
        textContent: 'Telemetry Control Hub',
        color: '#CCFF00',
        fontSize: '1.35rem',
        runChecks: true,
      },
      scope
    );
    assert.equal(patchRes.updatedElement?.textContent, 'Telemetry Control Hub');
    assert.equal(patchRes.updatedElement?.styles.color, '#CCFF00');
    assert.equal(patchRes.project.lastBuild?.status, 'VERIFIED');
    assert.equal(patchRes.project.lastTests?.status, 'VERIFIED');
    assert.equal(patchRes.project.lastSecurityScan?.status, 'VERIFIED');

    console.log('5) Testing Debug Diagnosis & Deterministic Auto-Repair...');
    const brokenHtml = manager
      .readProjectFile(project.projectId, 'public/index.html', scope)
      .replace('</body>', '<script>document.body.innerHTML = ""; eval("1+1");</script></body>');
    manager.writeProjectFile(project.projectId, 'public/index.html', brokenHtml, 'Inject test defect', scope);
    const brokenSchema = '{\n  "engine": "json_file_store",\n}\n';
    manager.writeProjectFile(project.projectId, 'data/schema.json', brokenSchema, 'Inject JSON trailing comma', scope);

    await manager.runBuild(project.projectId, scope);
    await manager.runSecurityValidation(project.projectId, scope);
    const brokenProject = manager.getProject(project.projectId, scope)!;
    assert.equal(brokenProject.lastBuild?.status, 'FAILED', 'Corrupted JSON must fail build');
    assert.equal(brokenProject.lastSecurityScan?.status, 'BLOCKED', 'eval() must block security validation');

    const repairRes = await manager.diagnoseAndRepairProject(project.projectId, scope);
    assert.equal(repairRes.repaired, true, `Auto-repair should succeed: ${repairRes.summary}`);
    assert.ok(repairRes.modifiedFiles.includes('public/index.html'));
    assert.ok(repairRes.modifiedFiles.includes('data/schema.json'));
    assert.equal(repairRes.project.lastBuild?.status, 'VERIFIED');
    assert.equal(repairRes.project.lastTests?.status, 'VERIFIED');
    assert.equal(repairRes.project.lastSecurityScan?.status, 'VERIFIED');
    assert.equal(repairRes.project.lastSecurityScan?.findings.length, 0);

    console.log('6) Verifying ApprovalGate & /api/deployment/history Verification Evidence...');
    const deployBlocked = await manager.requestOrExecuteDeploy(project.projectId, {}, scope);
    assert.equal(deployBlocked.project.deployment.status, 'PENDING_APPROVAL');
    assert.ok(deployBlocked.approvalRequestId, 'Deployment without approval must create ApprovalGate request');

    const timeline = manager.listDeploymentHistory(scope, { projectId: project.projectId, order: 'desc' });
    assert.ok(timeline.length >= 1, 'Deployment history timeline must contain recorded event');
    const latestEv = timeline[0];
    assert.equal(latestEv.projectId, project.projectId);
    assert.ok(latestEv.logsUrl.includes(latestEv.deploymentId), 'Must include cloud runtime logs URL');
    assert.equal(latestEv.verificationState, 'UNVERIFIED', 'Unapproved/unprobed deploy must clearly indicate UNVERIFIED');
    assert.ok(latestEv.verificationEvidence.deploymentHash.evidenceHash.length >= 32);
    assert.equal(latestEv.verificationEvidence.cloudRuntimeResponse.state, 'UNVERIFIED');
    assert.ok(['VERIFIED', 'UNVERIFIED', 'BLOCKED'].includes(latestEv.verificationEvidence.automatedTestResults.state));

    console.log('7) Verifying InternetIntegrationEngine SSRF guardrails & secret masking...');
    const ssrfLocal = await internetEngine.validateOutboundTarget('http://127.0.0.1:3000/api/system');
    assert.equal(ssrfLocal.ok, false, 'Must block loopback SSRF target');
    const ssrfMetadata = await internetEngine.validateOutboundTarget('http://169.254.169.254/latest/meta-data/');
    assert.equal(ssrfMetadata.ok, false, 'Must block cloud metadata SSRF target');
    const ssrfPrivate = await internetEngine.validateOutboundTarget('http://10.0.0.1/admin');
    assert.equal(ssrfPrivate.ok, false, 'Must block private RFC1918 SSRF target');

    const secretSummary = internetEngine.registerSecretRef(
      {
        alias: 'test_sec10_secret',
        provider: 'test_provider',
        secretValue: 'sk_live_secret_9876543210',
      },
      scope.tenantId,
      scope.userId
    );
    assert.ok(!secretSummary.maskedPreview.includes('987654'), 'Secret preview must be masked');
    assert.ok(secretSummary.maskedPreview.endsWith('3210'));

    console.log('8) Executing Software Capability Benchmark Suite (Levels 1-4)...');
    const benchReport = await manager.runSoftwareBenchmarkSuite(scope);
    assert.equal(benchReport.levelsAttempted, 4);
    assert.equal(benchReport.levelsPassed, 4, `Expected 4/4 benchmark tasks passing, got ${benchReport.levelsPassed}`);
    assert.ok(benchReport.dimensions.length >= 5);

    console.log('9) Inspecting honest 13-capability matrix & Section 1-10 TruthDashboard snapshot...');
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

    console.log('SUCCESS: All Section 10 Application Engine, Timeline, SSRF & Benchmark tests passed.');
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
