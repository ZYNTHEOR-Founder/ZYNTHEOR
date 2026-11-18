import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { AuditLedger } from '../../lib/AuditLedger';

export type BenchmarkStatus = 'RUNNING' | 'VERIFIED' | 'FAILED' | 'BLOCKED' | 'UNVERIFIED';
export interface BenchmarkRecord {
  executionId: string;
  projectId: string;
  level: number;
  status: BenchmarkStatus;
  nativeCapabilityStatus: 'UNVERIFIED';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  passed: number;
  total: number;
  skipped: number;
  exitCode: number | null;
  sourceRevision: string | null;
  suiteSha256: string | null;
  reportSha256: string | null;
  stdoutSha256: string | null;
  stderrSha256: string | null;
  evidenceSha256: string | null;
  reason?: string;
  artifactPath?: string;
  previousRecordHash?: string;
  recordHash?: string;
}

const ROOT = path.resolve(process.cwd(), 'workspace', 'projects');
const LEDGER = path.resolve(process.cwd(), 'native_data', 'benchmark_runs.jsonl');
const ARTIFACT_DIR = path.resolve(process.cwd(), 'native_data', 'benchmark_artifacts');
const SUITE_BY_LEVEL: Record<number, string> = {
  1: 'level1-todo.spec.mjs',
  2: 'level2-blog.spec.mjs',
  3: 'level3-saas-auth.spec.mjs',
  4: 'level4-commerce.spec.mjs'
};
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LOG_BYTES = 1024 * 1024;
const RUN_TIMEOUT_MS = 180_000;
const active = new Set<string>();

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}
function validProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
}
function projectDirectory(projectId: string): string {
  const root = path.resolve(ROOT);
  const target = path.resolve(root, projectId);
  if (!target.startsWith(root + path.sep)) throw new Error('PROJECT_PATH_INVALID');
  return target;
}
function sourceManifest(projectDir: string): { files: Array<{ path: string; bytes: number; sha256: string }>; revision: string } {
  const entries: Array<{ path: string; bytes: number; sha256: string }> = [];
  let totalBytes = 0;
  const ignored = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '.cache']);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.')) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(projectDir, full).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`SOURCE_SYMLINK_BLOCKED:${rel}`);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(full);
      if (stat.size > MAX_FILE_BYTES) throw new Error(`SOURCE_FILE_TOO_LARGE:${rel}`);
      totalBytes += stat.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('SOURCE_MANIFEST_SIZE_LIMIT');
      const bytes = fs.readFileSync(full);
      entries.push({ path: rel, bytes: stat.size, sha256: sha256(bytes) });
      if (entries.length > MAX_FILES) throw new Error('SOURCE_FILE_COUNT_LIMIT');
    }
  };
  walk(projectDir);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { files: entries, revision: sha256(canonical(entries)) };
}
function suiteHash(suitePath: string): string {
  return sha256(fs.readFileSync(suitePath));
}
function verifyLedger(): { valid: boolean; records: BenchmarkRecord[]; headHash: string; error?: string } {
  if (!fs.existsSync(LEDGER)) return { valid: true, records: [], headHash: '0'.repeat(64) };
  const lines = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
  const records: BenchmarkRecord[] = [];
  let previous = '0'.repeat(64);
  for (let index = 0; index < lines.length; index++) {
    try {
      const record = JSON.parse(lines[index]) as BenchmarkRecord;
      const claimed = record.recordHash;
      if (!claimed || record.previousRecordHash !== previous) return { valid: false, records: [], headHash: '', error: `CHAIN_BREAK_AT_${index}` };
      const { recordHash: _recordHash, ...body } = record;
      const calculated = sha256(canonical(body));
      if (calculated !== claimed) return { valid: false, records: [], headHash: '', error: `RECORD_HASH_MISMATCH_AT_${index}` };
      previous = claimed;
      records.push(record);
    } catch {
      return { valid: false, records: [], headHash: '', error: `MALFORMED_RECORD_AT_${index}` };
    }
  }
  return { valid: true, records, headHash: previous };
}
function appendRecord(record: BenchmarkRecord): BenchmarkRecord {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  const integrity = verifyLedger();
  if (!integrity.valid) throw new Error(`BENCHMARK_LEDGER_INTEGRITY_FAILED:${integrity.error}`);
  const body = { ...record, previousRecordHash: integrity.headHash };
  const chained: BenchmarkRecord = { ...body, recordHash: sha256(canonical(body)) };
  fs.appendFileSync(LEDGER, `${JSON.stringify(chained)}\n`, { encoding: 'utf8', flag: 'a' });
  return chained;
}
function readRecords(limit = 40): BenchmarkRecord[] {
  const integrity = verifyLedger();
  if (!integrity.valid) return [];
  return integrity.records.slice(-Math.max(1, Math.min(limit, 200))).reverse();
}

function parsePlaywrightReport(raw: string): { passed: number; total: number; skipped: number; valid: boolean } {
  let report: any;
  try { report = JSON.parse(raw); } catch { return { passed: 0, total: 0, skipped: 0, valid: false }; }
  if (!report || !Array.isArray(report.suites)) return { passed: 0, total: 0, skipped: 0, valid: false };
  let passed = 0, total = 0, skipped = 0;
  const visit = (suite: any) => {
    for (const test of Array.isArray(suite.specs) ? suite.specs : []) {
      for (const item of Array.isArray(test.tests) ? test.tests : []) {
        total++;
        const results = Array.isArray(item.results) ? item.results : [];
        const last = results[results.length - 1];
        if (item.expectedStatus === 'skipped' || last?.status === 'skipped') skipped++;
        // Strict: retries/flakes and unexpected statuses do not count as a pass.
        else if (results.length === 1 && last?.status === 'passed' && item.expectedStatus === 'passed') passed++;
      }
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  return { passed, total, skipped, valid: total > 0 };
}
function runPlaywright(cliPath: string, suitePath: string, appUrl: string): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliPath, 'test', suitePath, '--reporter=json', '--workers=1'], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', TMPDIR: process.env.TMPDIR || '', TEMP: process.env.TEMP || '', TMP: process.env.TMP || '', SystemRoot: process.env.SystemRoot || '', WINDIR: process.env.WINDIR || '', LANG: process.env.LANG || 'C.UTF-8', NODE_ENV: process.env.NODE_ENV || 'production', BENCHMARK_APP_URL: appUrl, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, RUN_TIMEOUT_MS);
    child.stdout.on('data', chunk => { if (stdout.length < MAX_LOG_BYTES) stdout += chunk.toString().slice(0, MAX_LOG_BYTES - stdout.length); });
    child.stderr.on('data', chunk => { if (stderr.length < MAX_LOG_BYTES) stderr += chunk.toString().slice(0, MAX_LOG_BYTES - stderr.length); });
    child.on('error', err => { clearTimeout(timer); resolve({ exitCode: 127, stdout, stderr: `${stderr}\n${err.message}`, timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolve({ exitCode: code ?? 1, stdout, stderr, timedOut }); });
  });
}
function resolvePreviewUrl(projectDir: string): string | null {
  const configPath = path.join(projectDir, '.zyntheor-benchmark.json');
  if (!fs.existsSync(configPath)) return null;
  let url: URL;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (typeof config.previewUrl !== 'string') return null;
    url = new URL(config.previewUrl);
  } catch { return null; }
  const allowed = (process.env.ZYNTHEOR_BENCHMARK_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!allowed.includes(url.origin)) return null;
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && url.hostname === '127.0.0.1' && process.env.ZYNTHEOR_ALLOW_LOOPBACK_BENCHMARK === '1')) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

export class BenchmarkRunner {
  static list(limit = 40): BenchmarkRecord[] { return readRecords(limit); }
  static getArtifact(executionId: string): unknown | null {
    if (!/^[0-9a-f-]{36}$/i.test(executionId)) return null;
    const file = path.resolve(ARTIFACT_DIR, `${executionId}.json`);
    if (!file.startsWith(ARTIFACT_DIR + path.sep) || !fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  static ledgerIntegrity() { const result = verifyLedger(); return { valid: result.valid, totalRecords: result.records.length, headHash: result.headHash, error: result.error }; }

  static async runLevel(level: number, projectId: string): Promise<BenchmarkRecord> {
    const executionId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const start = process.hrtime.bigint();
    const key = projectId;
    const finish = (record: Omit<BenchmarkRecord, 'durationMs' | 'completedAt' | 'nativeCapabilityStatus'>): BenchmarkRecord => {
      const completedAt = new Date().toISOString();
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      let full: BenchmarkRecord = { ...record, nativeCapabilityStatus: 'UNVERIFIED', durationMs: Math.round(durationMs), completedAt };
      try {
        full = appendRecord(full);
      } catch (ledgerError: any) {
        full = { ...full, status: 'UNVERIFIED', evidenceSha256: null, reason: String(ledgerError?.message || ledgerError).slice(0, 500) };
      }
      try {
        AuditLedger.append('TESTER', 'COMPETITIVE_BENCHMARK_FINISHED', {
          executionId, projectId, level, status: full.status, durationMs: full.durationMs,
          evidenceSha256: full.evidenceSha256, sourceRevision: full.sourceRevision, benchmarkRecordHash: full.recordHash || null
        });
      } catch { /* the benchmark ledger remains the independent evidence store */ }
      return full;
    };

    if (![1, 2, 3, 4].includes(level) || !validProjectId(projectId)) {
      return finish({ executionId, projectId: String(projectId), level, status: 'BLOCKED', startedAt, passed: 0, total: 0, skipped: 0, exitCode: null, sourceRevision: null, suiteSha256: null, reportSha256: null, stdoutSha256: null, stderrSha256: null, evidenceSha256: null, reason: 'INVALID_LEVEL_OR_PROJECT_ID' });
    }
    if (active.has(key)) {
      return finish({ executionId, projectId, level, status: 'BLOCKED', startedAt, passed: 0, total: 0, skipped: 0, exitCode: null, sourceRevision: null, suiteSha256: null, reportSha256: null, stdoutSha256: null, stderrSha256: null, evidenceSha256: null, reason: 'BENCHMARK_ALREADY_RUNNING' });
    }
    active.add(key);
    try {
      const projectDir = projectDirectory(projectId);
      if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
        return finish({ executionId, projectId, level, status: 'BLOCKED', startedAt, passed: 0, total: 0, skipped: 0, exitCode: null, sourceRevision: null, suiteSha256: null, reportSha256: null, stdoutSha256: null, stderrSha256: null, evidenceSha256: null, reason: 'PROJECT_NOT_FOUND' });
      }
      const realProject = fs.realpathSync(projectDir);
      if (!realProject.startsWith(path.resolve(ROOT) + path.sep)) throw new Error('PROJECT_SYMLINK_ESCAPE_BLOCKED');
      const source = sourceManifest(realProject);
      const suitePath = path.resolve(process.cwd(), 'tests', 'benchmarks', SUITE_BY_LEVEL[level]);
      if (!fs.existsSync(suitePath)) throw new Error('BENCHMARK_SUITE_MISSING');
      const suiteDigest = suiteHash(suitePath);
      const previewUrl = resolvePreviewUrl(realProject);
      if (!previewUrl) {
        return finish({ executionId, projectId, level, status: 'BLOCKED', startedAt, passed: 0, total: 0, skipped: 0, exitCode: null, sourceRevision: source.revision, suiteSha256: suiteDigest, reportSha256: null, stdoutSha256: null, stderrSha256: null, evidenceSha256: null, reason: 'PREVIEW_URL_NOT_CONFIGURED_OR_ORIGIN_NOT_ALLOWLISTED' });
      }
      const cliPath = path.resolve(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js');
      if (!fs.existsSync(cliPath)) {
        return finish({ executionId, projectId, level, status: 'BLOCKED', startedAt, passed: 0, total: 0, skipped: 0, exitCode: null, sourceRevision: source.revision, suiteSha256: suiteDigest, reportSha256: null, stdoutSha256: null, stderrSha256: null, evidenceSha256: null, reason: 'PLAYWRIGHT_NOT_INSTALLED' });
      }
      AuditLedger.append('TESTER', 'COMPETITIVE_BENCHMARK_STARTED', { executionId, projectId, level, sourceRevision: source.revision, suiteSha256: suiteDigest });
      const result = await runPlaywright(cliPath, suitePath, previewUrl);
      const sourceAfter = sourceManifest(realProject);
      const sourceChangedDuringRun = sourceAfter.revision !== source.revision;
      const parsed = parsePlaywrightReport(result.stdout);
      const reportSha256 = sha256(result.stdout);
      const stdoutSha256 = sha256(result.stdout);
      const stderrSha256 = sha256(result.stderr);
      const passed = parsed.passed;
      const total = parsed.total;
      const status: BenchmarkStatus = sourceChangedDuringRun ? 'UNVERIFIED' : (result.timedOut ? 'FAILED' : (!parsed.valid ? 'UNVERIFIED' : (result.exitCode === 0 && passed === total && total > 0 && parsed.skipped === 0 ? 'VERIFIED' : 'FAILED')));
      const evidencePayload = {
        schema: 'zyntheor.benchmark.evidence.v1', executionId, projectId, level,
        startedAt, sourceRevision: source.revision, sourceRevisionAfter: sourceAfter.revision, sourceChangedDuringRun, suiteSha256: suiteDigest,
        reportSha256, stdoutSha256, stderrSha256, exitCode: result.exitCode,
        passed, total, skipped: parsed.skipped, status
      };
      const evidenceSha256 = sha256(canonical(evidencePayload));
      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
      const artifactPath = path.join(ARTIFACT_DIR, `${executionId}.json`);
      const artifact = { ...evidencePayload, evidenceSha256, stdout: result.stdout, stderr: result.stderr, sourceManifest: source.files };
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), { flag: 'wx' });
      return finish({ executionId, projectId, level, status, startedAt, passed, total, skipped: parsed.skipped, exitCode: result.exitCode, sourceRevision: source.revision, suiteSha256: suiteDigest, reportSha256, stdoutSha256, stderrSha256, evidenceSha256, artifactPath: path.relative(process.cwd(), artifactPath), ...(sourceChangedDuringRun ? { reason: 'SOURCE_CHANGED_DURING_BENCHMARK' } : (result.timedOut ? { reason: 'PLAYWRIGHT_TIMEOUT' } : (!parsed.valid ? { reason: 'PLAYWRIGHT_REPORT_INVALID_OR_EMPTY' } : {}))) });
    } catch (error: any) {
      return finish({ executionId, projectId, level, status: 'UNVERIFIED', startedAt, passed: 0, total: 0, skipped: 0, exitCode: null, sourceRevision: null, suiteSha256: null, reportSha256: null, stdoutSha256: null, stderrSha256: null, evidenceSha256: null, reason: String(error?.message || error).slice(0, 500) });
    } finally {
      active.delete(key);
    }
  }
}
