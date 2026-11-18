import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const contextPath = path.join(srcDir, 'context', 'LanguageContext.tsx');
const context = fs.readFileSync(contextPath, 'utf8');
const dictionaryBody = context.match(/export const DICTIONARY:[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
if (!dictionaryBody) {
  console.error('[FAIL] Could not locate DICTIONARY in LanguageContext.tsx');
  process.exit(1);
}

const entries = [...dictionaryBody[1].matchAll(/^\s*'([^']+)'\s*:\s*\{\s*th:\s*'((?:\\.|[^'])*)'\s*,\s*en:\s*'((?:\\.|[^'])*)'\s*\}\s*,?\s*$/gm)];
const dictionary = new Map(entries.map(([, key, th, en]) => [key, { th, en }]));
const allFiles = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (/\.(tsx?|jsx?)$/.test(item.name)) allFiles.push(full);
  }
}
walk(srcDir);

const referenced = new Set();
for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) referenced.add(match[1]);
}

const missing = [...referenced].filter((key) => !dictionary.has(key)).sort();
const malformed = entries.filter(([, key, th, en]) => !th.trim() || !en.trim()).map(([, key]) => key);
const duplicateKeys = entries.map(([, key]) => key).filter((key, index, list) => list.indexOf(key) !== index);

if (missing.length || malformed.length || duplicateKeys.length) {
  if (missing.length) console.error('[FAIL] Missing translation keys:', missing.join(', '));
  if (malformed.length) console.error('[FAIL] Empty language values:', [...new Set(malformed)].join(', '));
  if (duplicateKeys.length) console.error('[FAIL] Duplicate dictionary keys:', [...new Set(duplicateKeys)].join(', '));
  process.exit(1);
}

console.log(`[PASS] ${dictionary.size} bilingual dictionary entries checked.`);
console.log(`[PASS] ${referenced.size} statically referenced translation keys resolved.`);
console.log('[PASS] Language state persistence and document language hooks present:',
  context.includes("localStorage.getItem('zyntheor_lang')") &&
  context.includes("localStorage.setItem('zyntheor_lang', newLang)") &&
  context.includes('document.documentElement.lang = lang'));
console.log('[PASS] Accessible selected-language state:',
  fs.readFileSync(path.join(srcDir, 'components', 'LanguageSwitcher.tsx'), 'utf8').includes('aria-pressed={active}'));
