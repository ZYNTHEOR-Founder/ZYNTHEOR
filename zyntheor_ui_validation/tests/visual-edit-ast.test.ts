import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyDirectWorkspaceVisualEdit,
  inspectJsxVisualElements,
  listWorkspaceVisualRevisions,
  patchJsxSourceWithBabel,
} from '../lib/VisualAstEditor.ts';
import { SoftwareProjectManager } from '../lib/SoftwareProjectManager.ts';
import { ToolGateway } from '../lib/ToolGateway.ts';

async function run(): Promise<void> {
  console.log('1) Testing Babel AST JSX/TSX inspection & patching...');
  const sampleTsx = `import React from 'react';

interface HeroProps {
  title: string;
}

export const HeroCard: React.FC<HeroProps> = ({ title }) => {
  return (
    <section
      data-z-id="hero_card"
      className="rounded-xl bg-slate-900"
      style={{ color: '#F4F7FF', padding: '16px' }}
    >
      <h1 data-z-id="hero_title" style={{ fontSize: '24px' }}>{title}</h1>
      <button id="primary_cta" type="button" disabled={false}>
        Launch App
      </button>
    </section>
  );
};
`;

  const inspected = inspectJsxVisualElements(sampleTsx, 'src/HeroCard.tsx');
  assert.ok(inspected.some((el) => el.zId === 'hero_card' && el.tagName === 'section'));
  assert.ok(inspected.some((el) => el.zId === 'hero_title' && el.tagName === 'h1'));
  assert.ok(inspected.some((el) => el.zId === 'primary_cta' && el.textContent === 'Launch App'));

  // Patch section styles + className via data-z-id
  const patched1 = patchJsxSourceWithBabel(
    sampleTsx,
    {
      targetId: 'hero_card',
      color: '#00F0FF',
      backgroundColor: '#070B19',
      className: 'rounded-2xl border border-cyan-500',
    },
    'src/HeroCard.tsx'
  );
  assert.equal(patched1.astEngine, 'babel');
  assert.ok(patched1.updatedCode.includes('color: "#00F0FF"') || patched1.updatedCode.includes("color: '#00F0FF'"));
  assert.ok(patched1.updatedCode.includes('backgroundColor: "#070B19"') || patched1.updatedCode.includes("backgroundColor: '#070B19'"));
  assert.ok(patched1.updatedCode.includes('rounded-2xl border border-cyan-500'));
  assert.match(patched1.afterSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(patched1.beforeSha256, patched1.afterSha256);

  // Patch button textContent + props via id attribute
  const patched2 = patchJsxSourceWithBabel(
    patched1.updatedCode,
    {
      targetId: 'primary_cta',
      textContent: 'Deploy Production',
      props: { disabled: true, 'data-track': 'cta_deploy' },
    },
    'src/HeroCard.tsx'
  );
  assert.ok(patched2.updatedCode.includes('Deploy Production'));
  assert.ok(patched2.updatedCode.includes('data-track="cta_deploy"') || patched2.updatedCode.includes("data-track='cta_deploy'"));

  // Security validation: reject dangerouslySetInnerHTML & unsafe CSS
  assert.throws(() => {
    patchJsxSourceWithBabel(
      sampleTsx,
      {
        targetId: 'hero_card',
        props: { dangerouslySetInnerHTML: 'bad' },
      },
      'src/HeroCard.tsx'
    );
  }, /SECURITY_VIOLATION/);

  assert.throws(() => {
    patchJsxSourceWithBabel(
      sampleTsx,
      {
        targetId: 'hero_card',
        styles: { backgroundColor: 'expression(alert(1))' },
      },
      'src/HeroCard.tsx'
    );
  }, /INVALID_STYLE_VALUE/);

  console.log('2) Testing direct /workspace TSX file edit + revision ID + SHA-256 evidence...');
  const tempWsRel = `__test_visual_edit_${Date.now()}.tsx`;
  ToolGateway.writeFile(tempWsRel, sampleTsx);
  let snapId = '';
  try {
    const wsRes = applyDirectWorkspaceVisualEdit(
      {
        filePath: tempWsRel,
        targetId: 'primary_cta',
        textContent: 'Verified Deploy',
        styles: { backgroundColor: '#131B36', color: '#CCFF00' },
        message: 'AST unit test patch',
      },
      { userId: 'dev-tester', tenantId: 'test-tenant-ast' }
    );
    snapId = wsRes.snapshotId;
    assert.equal(wsRes.mode, 'workspace');
    assert.match(wsRes.revisionId, /^rev_\d+_[a-f0-9]{8}$/);
    assert.match(wsRes.evidenceHash, /^[a-f0-9]{64}$/);
    assert.match(wsRes.fileSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(wsRes.beforeSha256, wsRes.fileSha256);
    assert.ok(wsRes.updatedCode.includes('Verified Deploy'));
    assert.ok(ToolGateway.readFile(tempWsRel).includes('Verified Deploy'));

    const revs = listWorkspaceVisualRevisions(tempWsRel);
    assert.ok(revs.some((r) => r.revisionId === wsRes.revisionId && r.evidenceHash === wsRes.evidenceHash));
  } finally {
    try {
      ToolGateway.deleteFile(tempWsRel);
    } catch {
      // ignore
    }
    if (snapId) {
      const snapFile = path.join(ToolGateway.getWorkspaceRoot(), '.zyntheor', 'snapshots', `${snapId}.json`);
      if (fs.existsSync(snapFile)) fs.unlinkSync(snapFile);
    }
  }

  console.log('3) Testing SoftwareProjectManager project-scoped JSX/TSX Babel AST visual edit...');
  const manager = SoftwareProjectManager.getInstance();
  const scope = {
    tenantId: 'test-tenant-ast',
    userId: 'dev-tester',
    role: 'developer' as const,
  };
  const project = await manager.createAndScaffoldProject(
    {
      name: 'AST Visual Component App',
      prompt: 'Build an interactive dashboard application with TSX components',
      stack: 'node_fullstack',
      runChecks: false,
    },
    scope
  );

  try {
    manager.writeProjectFile(
      project.projectId,
      'src/components/HeroCard.tsx',
      sampleTsx,
      'Add TSX component for AST visual edit test',
      scope
    );

    const inspectedProj = manager.inspectProjectJsxElements(
      project.projectId,
      'src/components/HeroCard.tsx',
      scope
    );
    assert.equal(inspectedProj.filePath, 'src/components/HeroCard.tsx');
    assert.ok(inspectedProj.elements.some((e) => e.zId === 'hero_card'));

    const projEdit = await manager.applyProjectAstVisualEdit(
      project.projectId,
      {
        filePath: 'src/components/HeroCard.tsx',
        targetId: 'hero_card',
        color: '#CCFF00',
        padding: '24px',
        className: 'rounded-2xl shadow-lg',
        message: 'Patch HeroCard via Babel AST',
        runChecks: false,
      },
      scope
    );

    assert.equal(projEdit.mode, 'project');
    assert.equal(projEdit.astEngine, 'babel');
    assert.match(projEdit.revisionId, /^rev_\d+$/);
    assert.match(projEdit.treeSha256, /^[a-f0-9]{64}$/);
    assert.match(projEdit.evidenceHash, /^[a-f0-9]{64}$/);
    assert.match(projEdit.fileSha256, /^[a-f0-9]{64}$/);
    assert.equal(projEdit.project.currentRevision, projEdit.revisionId);
    assert.equal(projEdit.project.evidenceHistory[0]?.operationType, 'VISUAL_EDIT');
    assert.equal(projEdit.project.evidenceHistory[0]?.evidenceHash, projEdit.evidenceHash);

    console.log('SUCCESS: All Babel AST /api/workspace/visual-edit tests passed.');
  } finally {
    const projAbs = path.join(process.cwd(), 'workspace', project.workspaceDir);
    if (fs.existsSync(projAbs)) fs.rmSync(projAbs, { recursive: true, force: true });
    const metaFile = path.join(process.cwd(), 'workspace', '.engineering', `${project.projectId}.json`);
    if (fs.existsSync(metaFile)) fs.rmSync(metaFile, { force: true });
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
  });
