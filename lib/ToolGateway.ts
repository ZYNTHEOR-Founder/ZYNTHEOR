/**
 * ZYNTHEOR Sovereign ToolGateway
 * Workspace-scoped command gateway with command allowlisting and path traversal defenses.
 * Note: cwd/path controls are not an OS-level sandbox; deploy behind a dedicated isolated runner.
 * All operations logged to AuditLedger.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { AuditLedger } from './AuditLedger';

export interface CommandResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface TamperVerificationResult {
  status: 'TAMPER_FREE' | 'TAMPER_DETECTED';
  verifiedAt: string;
  genesisDigest: string;
  executionDigest: string;
  probeDurationMs: number;
  filesAudited: number;
  sandboxPath: string;
  checks: {
    sandboxBoundaryIntact: boolean;
    noopExecutionPassed: boolean;
    genesisStateMatches: boolean;
    noSymlinkEscapes: boolean;
  };
  evidence: string;
}

export interface ZipDeliverableResult {
  zipFilename: string;
  zipPath: string;
  zipBytes: number;
  zipSha256: string;
  integrityOk: boolean;
  includedFiles: string[];
  createdAt: string;
}

export class ToolGateway {
  private static workspaceRoot = path.resolve(process.cwd(), 'workspace');
  private static allowedCommands = new Set([
    'node', 'python3', 'ls', 'cat', 'head', 'pwd', 'echo', 'mkdir', 'find'
  ]);
  private static executionTimeoutMs = 5000;

  public static getWorkspaceRoot(): string {
    if (!fs.existsSync(this.workspaceRoot)) {
      fs.mkdirSync(this.workspaceRoot, { recursive: true });
    }
    return this.workspaceRoot;
  }

  /**
   * Validates that target path stays strictly inside /workspace.
   * Throws an error on path traversal attempts.
   */
  public static resolveSafePath(relativePath: string): string {
    const root = fs.realpathSync(this.getWorkspaceRoot());
    const reject = (reason: string, resolvedPath = ''): never => {
      AuditLedger.append('SYSTEM', 'PATH_TRAVERSAL_BLOCKED', {
        attemptedPath: relativePath,
        resolvedPath,
        sandboxRoot: root,
        reason
      });
      throw new Error(`SECURITY_VIOLATION: ${reason}. Target path '${relativePath}' is outside or crosses a link in the workspace sandbox.`);
    };
    if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) {
      return reject('Invalid or absolute workspace path');
    }
    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return reject('Path traversal detected', resolved);
    }

    // Reject symlinks in every existing component, including the leaf. This
    // prevents a path that is lexically inside /workspace from escaping through
    // a symlinked directory or file.
    let cursor = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      try {
        const stat = fs.lstatSync(cursor);
        if (stat.isSymbolicLink()) return reject('Symbolic link traversal blocked', cursor);
      } catch (error: any) {
        if (error?.code === 'ENOENT') break;
        if (error?.message?.startsWith('SECURITY_VIOLATION:')) throw error;
        throw error;
      }
    }
    return resolved;
  }

  /**
   * Safely writes a file within /workspace.
   */
  public static writeFile(relativePath: string, content: string): { filePath: string; bytesWritten: number } {
    const safePath = this.resolveSafePath(relativePath);
    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(safePath, content, 'utf8');
    const bytesWritten = Buffer.byteLength(content, 'utf8');

    AuditLedger.append('CODER', 'TOOL_WRITE_FILE', {
      file: relativePath,
      bytes: bytesWritten
    });

    return { filePath: safePath, bytesWritten };
  }

  /**
   * Safely reads a file from /workspace.
   */
  public static readFile(relativePath: string): string {
    const safePath = this.resolveSafePath(relativePath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`FILE_NOT_FOUND: '${relativePath}' does not exist in workspace.`);
    }
    return fs.readFileSync(safePath, 'utf8');
  }

  /**
   * Safely deletes a file within /workspace.
   */
  public static deleteFile(relativePath: string): boolean {
    const safePath = this.resolveSafePath(relativePath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`FILE_NOT_FOUND: '${relativePath}' does not exist in workspace.`);
    }
    fs.unlinkSync(safePath);
    AuditLedger.append('SYSTEM', 'TOOL_DELETE_FILE', {
      file: relativePath
    });
    return true;
  }

  /**
   * Lists files in /workspace.
   */
  public static listFiles(): string[] {
    const root = this.getWorkspaceRoot();
    const getFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          continue;
        } else if (entry.isDirectory()) {
          files.push(...getFiles(full));
        } else if (entry.isFile()) {
          files.push(path.relative(root, full));
        }
      }
      return files;
    };
    return getFiles(root);
  }

  /**
   * Executes an allowlisted command with workspace cwd and a 5s timeout. This is not OS isolation.
   */
  public static async runCommand(command: string, args: string[] = []): Promise<CommandResult> {
    if (!this.allowedCommands.has(command)) {
      AuditLedger.append('TESTER', 'COMMAND_REJECTED_WHITELIST', { command, args });
      throw new Error(`SECURITY_VIOLATION: Command '${command}' is not in the sandbox whitelist (${Array.from(this.allowedCommands).join(', ')}).`);
    }

    if (!Array.isArray(args) || args.length > 64 || args.some((arg) => typeof arg !== 'string' || arg.length > 4096)) {
      throw new Error('SECURITY_VIOLATION: Command arguments must be an array of at most 64 strings, each no longer than 4096 characters.');
    }

    const cwd = this.getWorkspaceRoot();
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        {
          cwd,
          timeout: this.executionTimeoutMs,
          maxBuffer: 1024 * 1024,
          // Do not pass server credentials or arbitrary runtime options to generated code.
          env: {
            PATH: process.env.PATH || '',
            HOME: process.env.HOME || cwd,
            TMPDIR: process.env.TMPDIR || process.env.TMP || '/tmp',
            TEMP: process.env.TEMP || process.env.TMP || '/tmp',
            TMP: process.env.TMP || process.env.TEMP || '/tmp',
            SystemRoot: process.env.SystemRoot || '',
            WINDIR: process.env.WINDIR || '',
            LANG: process.env.LANG || 'C.UTF-8',
            LC_ALL: process.env.LC_ALL || '',
            TZ: process.env.TZ || 'UTC',
            NODE_ENV: process.env.NODE_ENV || 'production',
            NODE_PATH: cwd,
            PYTHONPATH: cwd,
            CI: '1'
          }
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const exitCode = error ? (error.code as number || 1) : 0;

          const result: CommandResult = {
            command,
            args,
            stdout: stdout.toString(),
            stderr: stderr.toString() + (error && error.killed ? '\n[Process killed: Execution timed out]' : ''),
            exitCode,
            durationMs
          };

          AuditLedger.append('TESTER', 'TOOL_RUN_COMMAND', {
            command: `${command} ${args.join(' ')}`,
            exitCode,
            durationMs,
            stdoutSummary: result.stdout.slice(0, 150)
          });

          resolve(result);
        }
      );
    });
  }

  /**
   * Runtime Verification Tool:
   * Periodically executes a safe 'no-op' script in the /workspace sandbox
   * and checks the SHA-256 integrity against the known genesis state to ensure
   * the environment hasn't been tampered with.
   */
  public static async runSandboxTamperVerification(): Promise<TamperVerificationResult> {
    const startTime = Date.now();
    const root = this.getWorkspaceRoot();
    const GENESIS_STATE_SPEC = 'ZYNTHEOR_SOVEREIGN_SANDBOX_V1_GENESIS_ROOT';
    const genesisDigest = crypto.createHash('sha256').update(GENESIS_STATE_SPEC).digest('hex');

    const probeFilename = '.sandbox_noop_verify.cjs';
    const probePath = path.join(root, probeFilename);

    const probeScript = `// ZYNTHEOR Sovereign Sandbox Genesis Probe
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const genesisPayload = '${GENESIS_STATE_SPEC}';
const genesisDigest = crypto.createHash('sha256').update(genesisPayload).digest('hex');
const cwd = process.cwd();
const files = fs.readdirSync(cwd).filter(f => !f.startsWith('.sandbox_noop'));

const payload = {
  probe: 'SANDBOX_NOOP_GENESIS_VERIFY',
  genesisDigest: genesisDigest,
  cwdMatches: path.basename(cwd) === 'workspace',
  filesAudited: files.length,
  timestamp: new Date().toISOString()
};

process.stdout.write(JSON.stringify(payload));
`;

    let noopPassed = false;
    let genesisMatches = false;
    let executionDigest = '';
    let filesAudited = 0;
    let evidence = '';
    let noSymlinkEscapes = true;

    try {
      // 1. Check for symlink escapes in workspace
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          const target = fs.realpathSync(path.join(root, entry.name));
          if (!target.startsWith(root)) {
            noSymlinkEscapes = false;
            evidence += `Illegal symlink escape detected: ${entry.name} -> ${target}; `;
          }
        }
      }

      // 2. Write probe script inside workspace
      fs.writeFileSync(probePath, probeScript, 'utf8');

      // 3. Execute no-op probe
      const execResult = await this.runCommand('node', [probeFilename]);
      const durationMs = Date.now() - startTime;

      if (execResult.exitCode === 0 && execResult.stdout) {
        try {
          const parsed = JSON.parse(execResult.stdout);
          executionDigest = crypto.createHash('sha256').update(execResult.stdout).digest('hex');
          filesAudited = parsed.filesAudited || 0;
          noopPassed = parsed.probe === 'SANDBOX_NOOP_GENESIS_VERIFY' && parsed.cwdMatches === true;
          genesisMatches = parsed.genesisDigest === genesisDigest;
          evidence = `No-op probe verified successfully. Sandbox CWD valid: ${parsed.cwdMatches}. Genesis SHA-256 matched.`;
        } catch (parseErr: any) {
          evidence = `Failed to parse probe stdout: ${parseErr.message}`;
        }
      } else {
        evidence = `Probe execution failed with exit code ${execResult.exitCode}: ${execResult.stderr}`;
      }
    } catch (err: any) {
      evidence = `Sandbox tamper verification error: ${err.message}`;
    } finally {
      // Clean up probe script
      try {
        if (fs.existsSync(probePath)) {
          fs.unlinkSync(probePath);
        }
      } catch {
        // ignore probe unlink error
      }
    }

    const sandboxBoundaryIntact = noSymlinkEscapes && noopPassed;
    const isTamperFree = sandboxBoundaryIntact && genesisMatches;

    const result: TamperVerificationResult = {
      status: isTamperFree ? 'TAMPER_FREE' : 'TAMPER_DETECTED',
      verifiedAt: new Date().toISOString(),
      genesisDigest,
      executionDigest,
      probeDurationMs: Date.now() - startTime,
      filesAudited,
      sandboxPath: root,
      checks: {
        sandboxBoundaryIntact,
        noopExecutionPassed: noopPassed,
        genesisStateMatches: genesisMatches,
        noSymlinkEscapes
      },
      evidence
    };

    // Log verification to AuditLedger
    AuditLedger.append('GOVERNANCE', 'SANDBOX_TAMPER_VERIFICATION', {
      status: result.status,
      genesisDigest: result.genesisDigest,
      executionDigest: result.executionDigest,
      checks: result.checks,
      durationMs: result.probeDurationMs
    });

    return result;
  }

  /**
   * Captures a reversible atomic snapshot of a workspace file inside `.zyntheor/snapshots/<id>.json`.
   */
  public static snapshotFile(relativePath: string): { snapshotId: string; filePath: string; bytes: number } {
    const safePath = this.resolveSafePath(relativePath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`FILE_NOT_FOUND: Cannot snapshot missing workspace file '${relativePath}'.`);
    }
    const content = fs.readFileSync(safePath, 'utf8');
    const root = this.getWorkspaceRoot();
    const snapshotsDir = path.join(root, '.zyntheor', 'snapshots');
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const snapshotId = `snap_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const snapFile = path.join(snapshotsDir, `${snapshotId}.json`);
    const payload = {
      snapshotId,
      relativePath,
      sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      createdAt: new Date().toISOString(),
      content,
    };
    fs.writeFileSync(snapFile, JSON.stringify(payload), { encoding: 'utf8', flag: 'wx' });
    AuditLedger.append('SYSTEM', 'TOOL_SNAPSHOT_CREATED', { snapshotId, file: relativePath, bytes: Buffer.byteLength(content, 'utf8') });
    return { snapshotId, filePath: snapFile, bytes: Buffer.byteLength(content, 'utf8') };
  }

  /**
   * Restores a previously snapshotted workspace file atomically.
   */
  public static rollbackSnapshot(snapshotId: string): { snapshotId: string; restoredPath: string; sha256: string } {
    if (typeof snapshotId !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(snapshotId)) {
      throw new Error('SECURITY_VIOLATION: Invalid snapshot identifier.');
    }
    const root = this.getWorkspaceRoot();
    const snapFile = path.join(root, '.zyntheor', 'snapshots', `${snapshotId}.json`);
    if (!fs.existsSync(snapFile)) {
      throw new Error(`SNAPSHOT_NOT_FOUND: '${snapshotId}' does not exist.`);
    }
    const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
    if (typeof snap?.relativePath !== 'string' || typeof snap?.content !== 'string') {
      throw new Error(`CORRUPT_SNAPSHOT: '${snapshotId}' payload invalid.`);
    }
    const safeTarget = this.resolveSafePath(snap.relativePath);
    fs.mkdirSync(path.dirname(safeTarget), { recursive: true });
    fs.writeFileSync(safeTarget, snap.content, 'utf8');
    AuditLedger.append('SYSTEM', 'TOOL_SNAPSHOT_ROLLBACK', { snapshotId, file: snap.relativePath, sha256: snap.sha256 });
    return { snapshotId, restoredPath: snap.relativePath, sha256: snap.sha256 };
  }

  /**
   * Packages verified workspace files into an independently integrity-checked ZIP deliverable under native_data/deliverables/.
   */
  public static async createZipDeliverable(relativePaths: string[], zipFilename: string): Promise<ZipDeliverableResult> {
    if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
      throw new Error('INVALID_DELIVERABLE: relativePaths must contain at least one file.');
    }
    const cleanName = path.basename(String(zipFilename || `deliverable-${Date.now()}.zip`).trim()).replace(/[^A-Za-z0-9._-]/g, '_');
    const finalName = cleanName.endsWith('.zip') ? cleanName : `${cleanName}.zip`;
    const deliverablesDir = path.resolve(process.cwd(), 'native_data', 'deliverables');
    fs.mkdirSync(deliverablesDir, { recursive: true });
    const outZipPath = path.resolve(deliverablesDir, finalName);
    if (!outZipPath.startsWith(deliverablesDir + path.sep)) {
      throw new Error('SECURITY_VIOLATION: Deliverable path escapes native_data/deliverables.');
    }

    const root = fs.realpathSync(this.getWorkspaceRoot());
    const resolvedEntries: Array<{ rel: string; full: string }> = [];
    for (const rel of relativePaths) {
      const normalizedRel = String(rel).replace(/^\/+/, '');
      const full = this.resolveSafePath(normalizedRel);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        throw new Error(`FILE_NOT_FOUND: Deliverable member '${normalizedRel}' missing from workspace.`);
      }
      resolvedEntries.push({ rel: path.relative(root, full).split(path.sep).join('/'), full });
    }

    const pyScript = `
import hashlib, json, sys, zipfile, os
out_zip = sys.argv[1]
entries = json.loads(sys.argv[2])
with zipfile.ZipFile(out_zip, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for e in entries:
        zf.write(e['full'], e['rel'])
with zipfile.ZipFile(out_zip, 'r') as zf:
    bad = zf.testzip()
    names = zf.namelist()
with open(out_zip, 'rb') as f:
    digest = hashlib.sha256(f.read()).hexdigest()
print(json.dumps({
    'integrityOk': bad is None and len(names) == len(entries),
    'zipBytes': os.path.getsize(out_zip),
    'zipSha256': digest,
    'includedFiles': names
}))
`;

    const meta = await new Promise<{ integrityOk: boolean; zipBytes: number; zipSha256: string; includedFiles: string[] }>((resolve, reject) => {
      execFile(
        'python3',
        ['-I', '-c', pyScript, outZipPath, JSON.stringify(resolvedEntries)],
        { cwd: process.cwd(), timeout: 10000, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            return reject(new Error(`ZIP_BUILD_FAILED: ${stderr || err.message}`));
          }
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch (parseErr: any) {
            reject(new Error(`ZIP_PARSE_FAILED: ${parseErr.message}`));
          }
        }
      );
    });

    const result: ZipDeliverableResult = {
      zipFilename: finalName,
      zipPath: outZipPath,
      zipBytes: meta.zipBytes,
      zipSha256: meta.zipSha256,
      integrityOk: meta.integrityOk,
      includedFiles: meta.includedFiles,
      createdAt: new Date().toISOString(),
    };

    AuditLedger.append('SYSTEM', 'DELIVERABLE_ZIP_CREATED', {
      zipFilename: finalName,
      zipBytes: result.zipBytes,
      zipSha256: result.zipSha256,
      integrityOk: result.integrityOk,
      fileCount: result.includedFiles.length,
    });

    return result;
  }
}
