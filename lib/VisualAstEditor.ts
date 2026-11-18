/**
 * ZYNTHEOR — Babel AST Visual Component Editor
 *
 * Parses and patches JSX/TSX component source files via @babel/parser,
 * @babel/traverse, @babel/generator, and @babel/types based on Visual
 * Inspector payloads, verifying syntactic validity on the generated output
 * and recording SHA-256 revision evidence.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parse, type ParserOptions } from '@babel/parser';
import traverseModule, { type NodePath } from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';
import { ToolGateway } from './ToolGateway.ts';
import { AuditLedger } from './AuditLedger.ts';
import { computeExecutionEvidenceHash } from './TruthKernel.ts';

const traverse = ((traverseModule as unknown as { default?: typeof traverseModule }).default ??
  traverseModule) as typeof traverseModule;
const generate = ((generateModule as unknown as { default?: typeof generateModule }).default ??
  generateModule) as typeof generateModule;

export interface JsxVisualElementSummary {
  zId: string;
  tagName: string;
  label: string;
  textContent: string;
  className?: string;
  line: number | null;
  column: number | null;
  styles: Record<string, string>;
  props: Record<string, string | number | boolean>;
}

export interface VisualEditAstPayload {
  targetId?: string;
  tagName?: string;
  componentName?: string;
  elementIndex?: number;
  loc?: { line: number; column?: number };
  textContent?: string;
  color?: string;
  backgroundColor?: string;
  padding?: string;
  fontSize?: string;
  className?: string | null;
  styles?: Record<string, string | null | undefined>;
  props?: Record<string, string | number | boolean | null | undefined>;
  attributes?: Record<string, string | number | boolean | null | undefined>;
  removeProps?: string[];
}

export interface VisualEditAstResult {
  updatedCode: string;
  astEngine: 'babel';
  matchedTarget: {
    targetId: string;
    tagName: string;
    line: number | null;
    column: number | null;
  };
  appliedChanges: string[];
  beforeSha256: string;
  afterSha256: string;
}

export interface WorkspaceVisualRevisionEntry {
  revisionId: string;
  revisionNumber: number;
  filePath: string;
  createdAt: string;
  createdBy: string;
  tenantId: string;
  message: string;
  astEngine: 'babel';
  matchedTarget: VisualEditAstResult['matchedTarget'];
  appliedChanges: string[];
  beforeSha256: string;
  fileSha256: string;
  prevRevisionHash: string;
  evidenceHash: string;
  snapshotId: string;
}

const DISALLOWED_PROP_KEYS = new Set([
  'dangerouslySetInnerHTML',
  '__proto__',
  'constructor',
  'prototype',
]);

const VALID_PROP_NAME_RE = /^[a-zA-Z_$][a-zA-Z0-9_:-]*$/;
const SAFE_STYLE_VALUE_RE = /^[a-zA-Z0-9#(),.%+\s/"'_-]{1,120}$/;

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function isJsxOrTsxPath(filePath: string): boolean {
  return /\.(tsx|jsx|ts|js|mts|mjs|cts|cjs)$/i.test((filePath || '').trim());
}

export function sanitizeCssValueForAst(val: string | undefined | null): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('expression(') ||
    lower.includes('javascript:') ||
    lower.includes('url(') ||
    trimmed.includes(';') ||
    trimmed.includes('{') ||
    trimmed.includes('}') ||
    trimmed.includes('<') ||
    trimmed.includes('>')
  ) {
    return undefined;
  }
  if (!SAFE_STYLE_VALUE_RE.test(trimmed)) return undefined;
  return trimmed;
}

function toCamelCssKey(rawKey: string): string | null {
  const clean = rawKey.trim();
  if (!clean) return null;
  if (/^[a-z][a-zA-Z0-9]*$/.test(clean)) return clean;
  if (/^[a-z]+(-[a-z]+)+$/i.test(clean)) {
    return clean
      .toLowerCase()
      .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
  }
  return null;
}

function getBabelParserOptions(filePath = 'Component.tsx'): ParserOptions {
  const lower = filePath.toLowerCase();
  const plugins: NonNullable<ParserOptions['plugins']> = ['jsx'];
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.mts') || lower.endsWith('.cts') || !lower.endsWith('.js')) {
    plugins.push('typescript');
  }
  plugins.push('decorators-legacy');
  return {
    sourceType: 'unambiguous',
    plugins,
    errorRecovery: false,
  };
}

function getJsxElementTagName(opening: t.JSXOpeningElement): string {
  const name = opening.name;
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    const parts: string[] = [];
    let cur: t.JSXMemberExpression | t.JSXIdentifier = name;
    while (t.isJSXMemberExpression(cur)) {
      parts.unshift(cur.property.name);
      cur = cur.object;
    }
    if (t.isJSXIdentifier(cur)) parts.unshift(cur.name);
    return parts.join('.');
  }
  if (t.isJSXNamespacedName(name)) {
    return `${name.namespace.name}:${name.name.name}`;
  }
  return 'unknown';
}

function readJsxAttrStringValue(attr: t.JSXAttribute): string | null {
  if (!attr.value) return null;
  if (t.isStringLiteral(attr.value)) return attr.value.value;
  if (t.isJSXExpressionContainer(attr.value)) {
    if (t.isStringLiteral(attr.value.expression)) {
      return attr.value.expression.value;
    }
    if (
      t.isTemplateLiteral(attr.value.expression) &&
      attr.value.expression.expressions.length === 0 &&
      attr.value.expression.quasis.length === 1
    ) {
      return attr.value.expression.quasis[0].value.cooked ?? null;
    }
  }
  return null;
}

function findJsxAttribute(
  opening: t.JSXOpeningElement,
  attrName: string
): t.JSXAttribute | undefined {
  return opening.attributes.find(
    (attr): attr is t.JSXAttribute =>
      t.isJSXAttribute(attr) &&
      t.isJSXIdentifier(attr.name) &&
      attr.name.name === attrName
  );
}

function extractInlineStyleObject(opening: t.JSXOpeningElement): Record<string, string> {
  const styleAttr = findJsxAttribute(opening, 'style');
  if (!styleAttr || !styleAttr.value || !t.isJSXExpressionContainer(styleAttr.value)) {
    return {};
  }
  const expr = styleAttr.value.expression;
  if (!t.isObjectExpression(expr)) return {};
  const result: Record<string, string> = {};
  for (const prop of expr.properties) {
    if (!t.isObjectProperty(prop) || prop.computed) continue;
    const key = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;
    if (!key) continue;
    if (t.isStringLiteral(prop.value)) {
      result[key] = prop.value.value;
    } else if (t.isNumericLiteral(prop.value)) {
      result[key] = String(prop.value.value);
    }
  }
  return result;
}

function extractDirectJsxText(node: t.JSXElement): string {
  const hasNestedJsx = node.children.some((c) => t.isJSXElement(c) || t.isJSXFragment(c));
  if (hasNestedJsx) return '';
  const chunks: string[] = [];
  for (const child of node.children) {
    if (t.isJSXText(child)) {
      const cleaned = child.value.replace(/\s+/g, ' ').trim();
      if (cleaned) chunks.push(cleaned);
    } else if (t.isJSXExpressionContainer(child) && t.isStringLiteral(child.expression)) {
      chunks.push(child.expression.value);
    }
  }
  return chunks.join(' ').trim().slice(0, 240);
}

export function inspectJsxVisualElements(
  sourceCode: string,
  filePath = 'Component.tsx'
): JsxVisualElementSummary[] {
  const ast = parse(sourceCode, getBabelParserOptions(filePath));
  const elements: JsxVisualElementSummary[] = [];
  const tagCounts: Record<string, number> = {};

  traverse(ast, {
    JSXElement(jsxPath: NodePath<t.JSXElement>) {
      const opening = jsxPath.node.openingElement;
      const tagName = getJsxElementTagName(opening);
      const idx = tagCounts[tagName] || 0;
      tagCounts[tagName] = idx + 1;

      const zAttr = findJsxAttribute(opening, 'data-z-id');
      const idAttr = findJsxAttribute(opening, 'id');
      const classAttr = findJsxAttribute(opening, 'className');

      const zVal = zAttr ? readJsxAttrStringValue(zAttr) : null;
      const idVal = idAttr ? readJsxAttrStringValue(idAttr) : null;
      const className = classAttr ? readJsxAttrStringValue(classAttr) ?? undefined : undefined;
      const zId = zVal || idVal || `${tagName}#${idx}`;

      const props: Record<string, string | number | boolean> = {};
      for (const attr of opening.attributes) {
        if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
        const name = attr.name.name;
        if (name === 'style' || name === 'className' || name === 'data-z-id') continue;
        if (attr.value === null) {
          props[name] = true;
        } else if (t.isStringLiteral(attr.value)) {
          props[name] = attr.value.value;
        } else if (t.isJSXExpressionContainer(attr.value)) {
          const ex = attr.value.expression;
          if (t.isBooleanLiteral(ex) || t.isNumericLiteral(ex) || t.isStringLiteral(ex)) {
            props[name] = ex.value;
          }
        }
      }

      elements.push({
        zId,
        tagName,
        label: (zVal || idVal || tagName).replace(/[_-]+/g, ' '),
        textContent: extractDirectJsxText(jsxPath.node),
        ...(className !== undefined ? { className } : {}),
        line: opening.loc?.start.line ?? null,
        column: opening.loc?.start.column ?? null,
        styles: extractInlineStyleObject(opening),
        props,
      });
    },
  });

  return elements;
}

function buildStyleObjectProperty(key: string, value: string): t.ObjectProperty {
  const keyNode = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
    ? t.identifier(key)
    : t.stringLiteral(key);
  return t.objectProperty(keyNode, t.stringLiteral(value));
}

function setOrRemoveObjectStyleProps(
  opening: t.JSXOpeningElement,
  styleUpdates: Record<string, string | null>
): string[] {
  const applied: string[] = [];
  const entries = Object.entries(styleUpdates);
  if (entries.length === 0) return applied;

  let styleAttr = findJsxAttribute(opening, 'style');
  let objExpr: t.ObjectExpression | null = null;

  if (styleAttr) {
    if (
      styleAttr.value &&
      t.isJSXExpressionContainer(styleAttr.value) &&
      t.isObjectExpression(styleAttr.value.expression)
    ) {
      objExpr = styleAttr.value.expression;
    } else {
      throw new Error(
        'AST_STYLE_UNSUPPORTED: Existing style prop is not an inline object literal (style={{ ... }}).'
      );
    }
  } else {
    const hasNonDeletion = entries.some(([, v]) => v !== null && v !== '');
    if (!hasNonDeletion) return applied;
    objExpr = t.objectExpression([]);
    styleAttr = t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(objExpr));
    opening.attributes.push(styleAttr);
  }

  for (const [rawKey, rawVal] of entries) {
    const camelKey = toCamelCssKey(rawKey);
    if (!camelKey) {
      throw new Error(`INVALID_STYLE_PROPERTY: '${rawKey}' is not a valid style key.`);
    }

    const existingIdx = objExpr.properties.findIndex(
      (p) =>
        t.isObjectProperty(p) &&
        !p.computed &&
        ((t.isIdentifier(p.key) && p.key.name === camelKey) ||
          (t.isStringLiteral(p.key) && p.key.value === camelKey))
    );

    if (rawVal === null || rawVal === '') {
      if (existingIdx >= 0) {
        objExpr.properties.splice(existingIdx, 1);
        applied.push(`style.${camelKey}:removed`);
      }
      continue;
    }

    const cleanVal = sanitizeCssValueForAst(rawVal);
    if (cleanVal === undefined) {
      throw new Error(`INVALID_STYLE_VALUE: Disallowed CSS value for '${camelKey}'.`);
    }

    const nextProp = buildStyleObjectProperty(camelKey, cleanVal);
    if (existingIdx >= 0) {
      objExpr.properties[existingIdx] = nextProp;
    } else {
      objExpr.properties.push(nextProp);
    }
    applied.push(`style.${camelKey}=${cleanVal}`);
  }

  if (objExpr.properties.length === 0 && styleAttr) {
    const idx = opening.attributes.indexOf(styleAttr);
    if (idx >= 0) opening.attributes.splice(idx, 1);
  }

  return applied;
}

function buildJsxAttrValue(
  value: string | number | boolean
): t.StringLiteral | t.JSXExpressionContainer | null {
  if (typeof value === 'string') {
    return t.stringLiteral(value.slice(0, 500));
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('INVALID_PROP_VALUE: Numeric prop must be finite.');
    }
    return t.jsxExpressionContainer(t.numericLiteral(value));
  }
  if (typeof value === 'boolean') {
    return value ? null : t.jsxExpressionContainer(t.booleanLiteral(false));
  }
  throw new Error('INVALID_PROP_VALUE: Unsupported prop value type.');
}

function setOrRemoveJsxAttribute(
  opening: t.JSXOpeningElement,
  propName: string,
  value: string | number | boolean | null
): string | null {
  if (DISALLOWED_PROP_KEYS.has(propName)) {
    throw new Error(`SECURITY_VIOLATION: Attribute '${propName}' cannot be modified via visual edit.`);
  }
  if (!VALID_PROP_NAME_RE.test(propName)) {
    throw new Error(`INVALID_PROP_NAME: '${propName}' is not a valid JSX attribute identifier.`);
  }

  const existingIdx = opening.attributes.findIndex(
    (attr) =>
      t.isJSXAttribute(attr) &&
      t.isJSXIdentifier(attr.name) &&
      attr.name.name === propName
  );

  if (value === null || (propName === 'className' && value === '')) {
    if (existingIdx >= 0) {
      opening.attributes.splice(existingIdx, 1);
      return `prop.${propName}:removed`;
    }
    return null;
  }

  const nextAttr = t.jsxAttribute(t.jsxIdentifier(propName), buildJsxAttrValue(value));
  if (existingIdx >= 0) {
    opening.attributes[existingIdx] = nextAttr;
  } else {
    opening.attributes.push(nextAttr);
  }
  return `prop.${propName}=${String(value)}`;
}

export function patchJsxSourceWithBabel(
  sourceCode: string,
  payload: VisualEditAstPayload,
  filePath = 'Component.tsx'
): VisualEditAstResult {
  if (!sourceCode || typeof sourceCode !== 'string') {
    throw new Error('INVALID_SOURCE: Source code must be a non-empty string.');
  }

  const beforeSha256 = sha256Text(sourceCode);
  const ast = parse(sourceCode, getBabelParserOptions(filePath));

  const rawTargetId = typeof payload.targetId === 'string' ? payload.targetId.trim() : '';
  const explicitTag = (payload.tagName || payload.componentName || '').trim();
  const explicitIndex =
    typeof payload.elementIndex === 'number' && Number.isInteger(payload.elementIndex) && payload.elementIndex >= 0
      ? payload.elementIndex
      : undefined;

  let indexedSelectorTag = '';
  let indexedSelectorNum: number | undefined;
  if (rawTargetId.includes('#')) {
    const [tagPart, idxPart] = rawTargetId.split('#');
    if (tagPart && /^\d+$/.test(idxPart || '')) {
      indexedSelectorTag = tagPart;
      indexedSelectorNum = Number(idxPart);
    }
  }

  if (!rawTargetId && !explicitTag && !payload.loc?.line) {
    throw new Error(
      'INVALID_VISUAL_TARGET: targetId, tagName/componentName, or loc.line is required.'
    );
  }

  let matchedPath: NodePath<t.JSXElement> | null = null;
  let matchedResolvedId = rawTargetId || explicitTag || `line:${payload.loc?.line}`;
  const tagCounters: Record<string, number> = {};

  traverse(ast, {
    JSXElement(jsxPath: NodePath<t.JSXElement>) {
      if (matchedPath) {
        jsxPath.stop();
        return;
      }

      const opening = jsxPath.node.openingElement;
      const tagName = getJsxElementTagName(opening);
      const currentIdx = tagCounters[tagName] || 0;
      tagCounters[tagName] = currentIdx + 1;

      const zAttr = findJsxAttribute(opening, 'data-z-id');
      const idAttr = findJsxAttribute(opening, 'id');
      const zVal = zAttr ? readJsxAttrStringValue(zAttr) : null;
      const idVal = idAttr ? readJsxAttrStringValue(idAttr) : null;

      // Priority 1: Exact data-z-id match
      if (rawTargetId && zVal === rawTargetId) {
        matchedPath = jsxPath;
        matchedResolvedId = zVal;
        jsxPath.stop();
        return;
      }

      // Priority 2: Exact id attribute match
      if (rawTargetId && idVal === rawTargetId) {
        matchedPath = jsxPath;
        matchedResolvedId = idVal;
        jsxPath.stop();
        return;
      }

      // Priority 3: loc.line (+ optional column) match
      if (payload.loc && typeof payload.loc.line === 'number') {
        const startLoc = opening.loc?.start;
        if (
          startLoc &&
          startLoc.line === payload.loc.line &&
          (payload.loc.column === undefined || startLoc.column === payload.loc.column)
        ) {
          matchedPath = jsxPath;
          matchedResolvedId = zVal || idVal || `${tagName}#${currentIdx}`;
          jsxPath.stop();
          return;
        }
      }

      // Priority 4: tagName#index selector
      if (
        indexedSelectorTag &&
        tagName === indexedSelectorTag &&
        currentIdx === indexedSelectorNum
      ) {
        matchedPath = jsxPath;
        matchedResolvedId = zVal || idVal || `${tagName}#${currentIdx}`;
        jsxPath.stop();
        return;
      }

      // Priority 5: explicit tagName/componentName + optional elementIndex
      if (
        explicitTag &&
        tagName === explicitTag &&
        currentIdx === (explicitIndex ?? 0)
      ) {
        matchedPath = jsxPath;
        matchedResolvedId = zVal || idVal || `${tagName}#${currentIdx}`;
        jsxPath.stop();
        return;
      }
    },
  });

  if (!matchedPath) {
    const targetDesc = rawTargetId || explicitTag || `line:${payload.loc?.line}`;
    throw new Error(
      `VISUAL_TARGET_NOT_FOUND: No JSX element matching '${targetDesc}' found in ${filePath}.`
    );
  }

  const targetNode = (matchedPath as NodePath<t.JSXElement>).node;
  const opening = targetNode.openingElement;
  const matchedTagName = getJsxElementTagName(opening);
  const appliedChanges: string[] = [];

  // 1. Collect style updates (both structured styles map and flat Inspector fields)
  const mergedStyles: Record<string, string | null> = {};
  if (payload.styles && typeof payload.styles === 'object') {
    for (const [k, v] of Object.entries(payload.styles)) {
      if (v === null) mergedStyles[k] = null;
      else if (typeof v === 'string') mergedStyles[k] = v;
    }
  }
  if (payload.color !== undefined) mergedStyles.color = payload.color;
  if (payload.backgroundColor !== undefined) mergedStyles.backgroundColor = payload.backgroundColor;
  if (payload.padding !== undefined) mergedStyles.padding = payload.padding;
  if (payload.fontSize !== undefined) mergedStyles.fontSize = payload.fontSize;

  appliedChanges.push(...setOrRemoveObjectStyleProps(opening, mergedStyles));

  // 2. Patch className
  if (payload.className !== undefined) {
    const change = setOrRemoveJsxAttribute(opening, 'className', payload.className);
    if (change) appliedChanges.push(change);
  }

  // 3. Patch arbitrary props / attributes
  const propSources = [payload.props, payload.attributes];
  for (const propObj of propSources) {
    if (!propObj || typeof propObj !== 'object') continue;
    for (const [key, val] of Object.entries(propObj)) {
      if (val === undefined) continue;
      if (key === 'style') {
        throw new Error('INVALID_PROP_NAME: Use payload.styles to patch inline style properties.');
      }
      const change = setOrRemoveJsxAttribute(opening, key, val);
      if (change) appliedChanges.push(change);
    }
  }

  // 4. Remove requested props
  if (Array.isArray(payload.removeProps)) {
    for (const propName of payload.removeProps) {
      if (typeof propName !== 'string' || !propName.trim()) continue;
      const change = setOrRemoveJsxAttribute(opening, propName.trim(), null);
      if (change) appliedChanges.push(change);
    }
  }

  // 5. Patch textContent safely
  if (typeof payload.textContent === 'string') {
    const sanitizedText = payload.textContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim().slice(0, 500);
    if (opening.selfClosing) {
      opening.selfClosing = false;
      targetNode.closingElement = t.jsxClosingElement(t.cloneNode(opening.name, true));
    }
    const hasChildElement = targetNode.children.some(
      (c) => t.isJSXElement(c) || t.isJSXFragment(c)
    );
    if (!hasChildElement) {
      targetNode.children = [t.jsxText(sanitizedText)];
      appliedChanges.push('textContent');
    } else {
      const textChild = targetNode.children.find(
        (c): c is t.JSXText => t.isJSXText(c) && c.value.trim().length > 0
      );
      if (textChild) {
        textChild.value = sanitizedText;
        appliedChanges.push('textContent');
      } else {
        targetNode.children.unshift(t.jsxText(sanitizedText));
        appliedChanges.push('textContent');
      }
    }
  }

  if (appliedChanges.length === 0) {
    throw new Error('NO_VISUAL_CHANGES: Inspector payload did not specify any valid AST mutations.');
  }

  const output = generate(ast, {
    retainLines: false,
    jsescOption: { minimal: true },
  });

  // Verify generated code parses cleanly with Babel before persisting
  parse(output.code, getBabelParserOptions(filePath));

  const afterSha256 = sha256Text(output.code);
  return {
    updatedCode: output.code,
    astEngine: 'babel',
    matchedTarget: {
      targetId: matchedResolvedId,
      tagName: matchedTagName,
      line: opening.loc?.start.line ?? null,
      column: opening.loc?.start.column ?? null,
    },
    appliedChanges,
    beforeSha256,
    afterSha256,
  };
}

function getWorkspaceRevisionsLedgerPath(): string {
  const root = ToolGateway.getWorkspaceRoot();
  const dir = path.join(root, '.zyntheor');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'visual-revisions.json');
}

export function listWorkspaceVisualRevisions(filePath?: string): WorkspaceVisualRevisionEntry[] {
  const ledgerPath = getWorkspaceRevisionsLedgerPath();
  if (!fs.existsSync(ledgerPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (!Array.isArray(raw)) return [];
    if (!filePath) return raw;
    const norm = filePath.replace(/\\/g, '/').trim();
    return raw.filter((r: WorkspaceVisualRevisionEntry) => r.filePath === norm);
  } catch {
    return [];
  }
}

export function applyDirectWorkspaceVisualEdit(
  input: VisualEditAstPayload & {
    filePath: string;
    message?: string;
  },
  actor: { userId: string; tenantId: string }
): {
  mode: 'workspace';
  filePath: string;
  revisionId: string;
  revision: WorkspaceVisualRevisionEntry;
  snapshotId: string;
  beforeSha256: string;
  fileSha256: string;
  evidenceHash: string;
  astEngine: 'babel';
  appliedChanges: string[];
  matchedTarget: VisualEditAstResult['matchedTarget'];
  updatedCode: string;
} {
  const cleanRel = (input.filePath || '').replace(/\\/g, '/').trim();
  if (!cleanRel) {
    throw new Error('INVALID_FILE_PATH: filePath is required.');
  }
  if (!isJsxOrTsxPath(cleanRel)) {
    throw new Error(
      `UNSUPPORTED_SOURCE_TYPE: '${cleanRel}' must be a JSX/TSX/JS/TS component source file.`
    );
  }

  const startedMs = Date.now();
  const startIso = new Date().toISOString();
  const currentSource = ToolGateway.readFile(cleanRel);
  const astResult = patchJsxSourceWithBabel(currentSource, input, cleanRel);

  const snapshot = ToolGateway.snapshotFile(cleanRel);
  ToolGateway.writeFile(cleanRel, astResult.updatedCode);

  const existing = listWorkspaceVisualRevisions();
  const revNumber = existing.length + 1;
  const revisionId = `rev_${revNumber}_${astResult.afterSha256.slice(0, 8)}`;
  const prevRevisionHash = existing[0]?.evidenceHash || '0'.repeat(64);
  const finishIso = new Date().toISOString();
  const durationMs = Math.max(1, Date.now() - startedMs);

  const evidenceHash = computeExecutionEvidenceHash({
    executionId: `visual_edit_${revisionId}`,
    taskId: `ws_visual_${sha256Text(cleanRel).slice(0, 12)}`,
    startTimestamp: startIso,
    finishTimestamp: finishIso,
    executionDurationMs: durationMs,
    executionResult: 'VERIFIED',
    artifacts: [
      {
        path: cleanRel,
        bytes: Buffer.byteLength(astResult.updatedCode, 'utf8'),
        verified: true,
      },
    ],
    testsPassed: 1,
    testsTotal: 1,
  });

  const revisionEntry: WorkspaceVisualRevisionEntry = {
    revisionId,
    revisionNumber: revNumber,
    filePath: cleanRel,
    createdAt: finishIso,
    createdBy: actor.userId,
    tenantId: actor.tenantId,
    message:
      input.message?.trim() ||
      `AST Visual Edit (${astResult.matchedTarget.targetId}) in ${cleanRel}`,
    astEngine: 'babel',
    matchedTarget: astResult.matchedTarget,
    appliedChanges: astResult.appliedChanges,
    beforeSha256: astResult.beforeSha256,
    fileSha256: astResult.afterSha256,
    prevRevisionHash,
    evidenceHash,
    snapshotId: snapshot.snapshotId,
  };

  existing.unshift(revisionEntry);
  fs.writeFileSync(
    getWorkspaceRevisionsLedgerPath(),
    JSON.stringify(existing.slice(0, 500), null, 2),
    'utf8'
  );

  AuditLedger.append('CODER', 'WORKSPACE_VISUAL_EDIT_APPLIED', {
    filePath: cleanRel,
    revisionId,
    targetId: astResult.matchedTarget.targetId,
    appliedChanges: astResult.appliedChanges,
    beforeSha256: astResult.beforeSha256,
    fileSha256: astResult.afterSha256,
    evidenceHash,
    snapshotId: snapshot.snapshotId,
    tenantId: actor.tenantId,
    userId: actor.userId,
  });

  return {
    mode: 'workspace',
    filePath: cleanRel,
    revisionId,
    revision: revisionEntry,
    snapshotId: snapshot.snapshotId,
    beforeSha256: astResult.beforeSha256,
    fileSha256: astResult.afterSha256,
    evidenceHash,
    astEngine: 'babel',
    appliedChanges: astResult.appliedChanges,
    matchedTarget: astResult.matchedTarget,
    updatedCode: astResult.updatedCode,
  };
}
