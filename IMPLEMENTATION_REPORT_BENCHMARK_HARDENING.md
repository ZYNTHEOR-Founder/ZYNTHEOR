# ZYNTHEOR — Evidence-Gated Benchmark Foundation & Workspace Boundary Hardening

Date: 2026-11-15

## Source boundary

This work continues from the latest accessible source archive in the Library: `zyntheor-intelligence-first-v1-merged.zip` (6,383,944 bytes; archive internal timestamps 2026-11-11/12; SHA-256 `7fe26b13cfdcda392dfebfc0469c571bde1c4c127855cd086aaab2c7ea2f8dbd`). The archive is older than the separately referenced redesigned source package, which is not present in the accessible files. This output is therefore a targeted continuation of the accessible source, not a claim that it is the later redesigned tree.

## Changes made

1. Added `server/benchmarks/runner.ts`:
   - L1–L4 Playwright runner using `spawn()` without a shell.
   - Strict project ID and project path checks.
   - Rejects symlinks in project source manifests and enforces file-count/size limits.
   - Requires a project preview URL whose exact origin is explicitly allowlisted by server configuration.
   - Requires Playwright to be installed; missing project, preview configuration, or Playwright returns BLOCKED rather than a fabricated result.
   - Parses the Playwright JSON suite tree; requires at least one test, exit code 0, no skipped tests, no flaky/retried tests, and all tests passed.
   - Hashes the source manifest, suite, raw report, stdout/stderr, and evidence payload.
   - Re-hashes the source after the run; source changes during a run force UNVERIFIED.
   - Stores bounded artifacts and an append-only SHA-256 chained benchmark ledger.
   - Detects benchmark-ledger tampering and fails closed.
   - Explicitly leaves Native Engine generation provenance UNVERIFIED; application E2E success alone does not prove Native Engine authorship.
2. Added real browser acceptance suites:
   - `tests/benchmarks/level1-todo.spec.mjs`
   - `tests/benchmarks/level2-blog.spec.mjs`
   - `tests/benchmarks/level3-saas-auth.spec.mjs`
   - `tests/benchmarks/level4-commerce.spec.mjs`
3. Added authenticated API endpoints:
   - `GET /api/benchmarks`
   - `GET /api/benchmarks/:executionId`
   - `POST /api/benchmarks/run`
4. Added `BenchmarkArena` to the existing DevStudio tab layout; results are fetched from the backend and the UI does not set VERIFIED locally.
5. Hardened `ToolGateway.resolveSafePath()` against sibling-prefix traversal, absolute paths, and symlink traversal; file listing skips symlinks.
6. Added regression assertions for sibling-prefix and symlink escapes to `tests/sovereignty.test.ts`.

## Verification performed in this workspace

| Check | Result |
|---|---|
| ZIP integrity | PASS |
| TypeScript syntax transpilation: changed TS/TSX files | PASS — 4 files, 0 syntax diagnostics |
| Focused TypeScript typecheck: benchmark runner, AuditLedger, ToolGateway | PASS |
| Playwright suite JavaScript syntax | PASS — 4 suites |
| Python source compilation | PASS |
| ToolGateway boundary smoke tests | PASS — traversal, sibling prefix, absolute path, symlink, valid path |
| Benchmark runner smoke test | PASS — missing project is BLOCKED and persisted as a chained record |
| Benchmark ledger tamper test | PASS — modified record detected as hash mismatch |
| Full `tsc --noEmit` | BLOCKED — archive lacks installed `vite/client` type definitions/dependencies |
| Vite production build | NOT RUN — `node_modules` is absent in the workspace |
| Playwright browser E2E | BLOCKED — `@playwright/test`, browser runtime, a real project preview, and an allowlisted preview origin are not configured in this archive |
| Live API/Cloud Runtime | NOT RUN — no live deployment/runtime credentials or target attached |

## Explicit capability boundary

The accessible archive's current `TaskOrchestrator` generates a sandbox `solution.js`; it is not yet a multi-file application project generator with auditable project provenance. Therefore this patch does not claim that L1–L4 prove Native Engine application creation. The benchmark runner reports application E2E status separately and keeps `nativeCapabilityStatus: UNVERIFIED` until a first-party project-generation trace is integrated.

## Preservation

The original ZIP is not modified. The checkpoint, memory store, and original audit log are not intentionally changed by this patch. The extracted working copy and output archive are separate artifacts.
