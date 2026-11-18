#!/usr/bin/env node
/**
 * Verifies that every TypeScript definition package directory under `types/`
 * (supporting both `types/<pkg>` and scoped `types/@<scope>/<pkg>`)
 * contains a valid `tsconfig.json` and a non-empty `index.d.ts`.
 *
 * Usage:
 *   node scripts/verify-type-packages.mjs [--dir types] [--strict] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const strictMode = args.includes('--strict');
const dirFlagIndex = args.findIndex((arg) => arg === '--dir' || arg.startsWith('--dir='));
let targetDir = 'types';
if (dirFlagIndex !== -1) {
  const flag = args[dirFlagIndex];
  if (flag.startsWith('--dir=')) {
    targetDir = flag.slice('--dir='.length) || 'types';
  } else if (args[dirFlagIndex + 1]) {
    targetDir = args[dirFlagIndex + 1];
  }
}

const repoRoot = process.cwd();
const typesRoot = path.resolve(repoRoot, targetDir);

/**
 * Discovers package directories under `types/` (including `@scope/pkg`).
 */
function discoverPackageDirs(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const pkgDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.name.startsWith('@')) {
      const scopedEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const scoped of scopedEntries) {
        if (!scoped.isDirectory() || scoped.name.startsWith('.')) continue;
        pkgDirs.push({
          name: `${entry.name}/${scoped.name}`,
          dir: path.join(fullPath, scoped.name),
        });
      }
    } else {
      pkgDirs.push({
        name: entry.name,
        dir: fullPath,
      });
    }
  }

  return pkgDirs.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Strips single-line and multi-line comments from JSONC (like tsconfig.json)
 * while preserving string literals, plus trailing commas.
 */
function parseJsonWithComments(raw) {
  let out = '';
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < raw.length && raw[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  // Remove trailing commas before } or ]
  const sanitized = out.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(sanitized);
}

function validatePackage(pkg) {
  const errors = [];
  const tsconfigPath = path.join(pkg.dir, 'tsconfig.json');
  const indexDtsPath = path.join(pkg.dir, 'index.d.ts');

  if (!fs.existsSync(tsconfigPath)) {
    errors.push('Missing tsconfig.json');
  } else {
    try {
      const raw = fs.readFileSync(tsconfigPath, 'utf8');
      const parsed = parseJsonWithComments(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push('tsconfig.json must be a JSON object');
      } else if (!parsed.compilerOptions || typeof parsed.compilerOptions !== 'object') {
        errors.push('tsconfig.json must define a "compilerOptions" object');
      }
    } catch (err) {
      errors.push(`Invalid tsconfig.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!fs.existsSync(indexDtsPath)) {
    errors.push('Missing index.d.ts');
  } else {
    try {
      const dtsContent = fs.readFileSync(indexDtsPath, 'utf8');
      const stripped = dtsContent
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .trim();
      if (!stripped) {
        errors.push('index.d.ts is empty (contains no TypeScript declarations)');
      }
    } catch (err) {
      errors.push(`Unreadable index.d.ts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    name: pkg.name,
    path: path.relative(repoRoot, pkg.dir),
    valid: errors.length === 0,
    errors,
  };
}

function validateRootTsConfig() {
  const rootTsConfig = path.join(repoRoot, 'tsconfig.json');
  if (!fs.existsSync(rootTsConfig)) {
    return { valid: false, error: 'Root tsconfig.json is missing' };
  }
  try {
    const parsed = parseJsonWithComments(fs.readFileSync(rootTsConfig, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.compilerOptions) {
      return { valid: false, error: 'Root tsconfig.json is missing compilerOptions' };
    }
    return { valid: true, error: null };
  } catch (err) {
    return {
      valid: false,
      error: `Invalid root tsconfig.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

const rootCheck = validateRootTsConfig();
const packages = discoverPackageDirs(typesRoot);
const results = packages.map(validatePackage);
const failed = results.filter((r) => !r.valid);

const summary = {
  targetDir: path.relative(repoRoot, typesRoot) || '.',
  directoryExists: fs.existsSync(typesRoot),
  rootTsConfigValid: rootCheck.valid,
  rootTsConfigError: rootCheck.error,
  checkedCount: results.length,
  passedCount: results.length - failed.length,
  failedCount: failed.length,
  results,
};

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Root tsconfig.json: ${rootCheck.valid ? 'OK' : `FAIL (${rootCheck.error})`}`);
  if (!summary.directoryExists) {
    console.log(`Directory '${summary.targetDir}' does not exist yet (0 definition packages checked).`);
  } else if (results.length === 0) {
    console.log(`Directory '${summary.targetDir}' contains 0 package subdirectories.`);
  } else {
    console.log(`Checked ${results.length} package(s) in '${summary.targetDir}':`);
    for (const item of results) {
      if (item.valid) {
        console.log(`  [PASS] ${item.name} (${item.path})`);
      } else {
        console.error(`  [FAIL] ${item.name} (${item.path}): ${item.errors.join('; ')}`);
      }
    }
  }
}

const shouldFail =
  !rootCheck.valid ||
  failed.length > 0 ||
  (strictMode && (!summary.directoryExists || results.length === 0));

process.exit(shouldFail ? 1 : 0);
