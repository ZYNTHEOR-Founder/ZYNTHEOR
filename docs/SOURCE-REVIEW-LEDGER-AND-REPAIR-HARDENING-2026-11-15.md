# ZYNTHEOR Source Review & Hardening Report

Date: 2026-11-15

## Scope
Reviewed the supplied `zyntheor-native-intelligence-redesigned.zip` working source. Preserved the existing project layout and modified only targeted service, execution, test, and runtime metadata files.

## Changes made

### 1. Ledger currency isolation
- Fixed `LedgerService.getBalance()` so totals are calculated only for the requested currency; previously it summed all currencies while returning a single currency label.
- Added optional currency filtering to record retrieval, category breakdown, and timeline queries.
- Added currency-aware summaries and passed the currency through `LedgerClient` and the `/api/ledger/*` routes.
- Changed budget uniqueness from tenant-only to `(tenant_id, currency)` so each currency has its own threshold.
- Added an in-place SQLite schema migration that preserves existing tenant budget rows while upgrading the key.
- Ensured create/delete/budget API responses summarize the affected currency.
- Added `test:ledger` and declared Node `>=22.5.0`, required by the built-in `node:sqlite` API used by the service.

### 2. Self-repair snapshot collision
- Found that snapshot IDs used millisecond time plus a path-only hash. Two snapshots of the same file in one millisecond could collide and raise `FileExistsError` during repair verification.
- Changed snapshot creation to nanosecond-based IDs with exclusive directory creation and bounded collision retries.
- The self-repair regression now completes successfully.

### 3. Corpus ingestion file handling
- Replaced unclosed `open()` calls in corpus rule loading, manifest loading, test-access logging, and manifest output with context-managed file access.

### 4. Checkpoint-dependent test behavior
- The source package does not include `native_data/model_checkpoint.pt` or the v2 trained checkpoint.
- Updated the v1 resume test to skip only when its required checkpoint artifact is absent. It still runs and verifies the payload when that artifact is present; no weights or test result are fabricated.

## Verification evidence

| Check | Result |
|---|---|
| Ledger SQLite/CLI tests | PASS — 9 passed, 0 failed |
| Native LM / execution / repair Python suite | PASS — 34 tests, 2 skipped because trained checkpoint artifacts are not included |
| Self-repair syntax-repair regression | PASS within the Python suite |
| Python compile (`safe_exec.py`, `corpus_ingest.py`, native test) | PASS |
| TypeScript/TSX syntax transpilation | PASS — 77 files, 0 syntax diagnostics |
| Node syntax checks (`LedgerService.ts`, `LedgerClient.ts`, `server.ts`) | PASS |
| Full TypeScript typecheck | BLOCKED — `vite/client` type definitions are not installed |
| Vite production build | NOT RUN — Vite dependencies are unavailable in this workspace |
| Browser responsive visual verification | NOT RUN — production build cannot be served without dependencies |
| Live server/API integration | NOT RUN — no running deployment/runtime was attached to this source review |

## Remaining blockers
- Install project dependencies in the target online build environment, then run full `tsc --noEmit`, `npm run build`, and browser-level Desktop/Mobile checks.
- The two skipped checkpoint tests require the real trained checkpoint artifacts; they must not be replaced with generated or placeholder weights.
- `node:sqlite` is a built-in runtime dependency; the deployment Node version must satisfy `>=22.5.0` and use persistent storage for the SQLite database.

## Integrity / preservation
- The original uploaded archive was not modified.
- No trained weights, datasets, credentials, audit history, or user records were intentionally removed or overwritten.
- Changes are confined to the extracted working copy and the separately packaged output archive.
