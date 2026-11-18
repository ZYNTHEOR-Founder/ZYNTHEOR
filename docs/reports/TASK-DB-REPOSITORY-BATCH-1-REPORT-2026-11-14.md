# ZYNTHEOR — Task DB Repository Batch 1
Date: 2026-11-14

## Implemented
- Added PostgreSQL/Drizzle `execution_tasks` schema with tenant and owner columns, lifecycle status, timestamps, and JSONB task payload.
- Added SQL migration `src/db/migrations/0001_execution_tasks.sql` plus tenant/owner and tenant/status indexes.
- Added `src/db/task-repository.ts` with serializable transactional save, owner-scoped get/list/delete, strict owner validation, and task-ID collision protection.
- Removed the silent no-op/mock database proxy from `src/db/index.ts`. Database calls made without SQL configuration now fail explicitly with `CLOUD_SQL_NOT_CONFIGURED`.
- Added configurable `SQL_PORT` (default 5432) and conservative pool timeouts/application name.

## Verification
- `tests/task-db-repository-integrity.test.mjs`: 12/12 PASS (static source assertions only).
- `tests/task-persistence-integrity.test.mjs`: 8/8 PASS (static source assertions only).
- `tests/task-tenant-isolation.test.mjs`: 10/10 PASS (static source assertions only).
- `tests/security-hardening-static.test.mjs`: 10/10 PASS (static source assertions only).
- TypeScript `transpileModule` diagnostics: 0 for `src/db/index.ts`, `src/db/schema.ts`, and `src/db/task-repository.ts`.

## Explicit limitations / not yet verified
- The TaskOrchestrator still uses its existing JSON task store. The new PostgreSQL repository is a separate persistence foundation and is NOT yet wired into orchestration reads/writes; do not claim DB-backed task persistence is active.
- The SQL migration has not been applied to a live PostgreSQL instance.
- No live database transaction, concurrency, tenant-isolation integration, or recovery test was run.
- No dependencies were installed. `node_modules` is absent; full type-check, build, complete suite, API/E2E, deployment and production behavior are NOT VERIFIED.
- The prior JSON task store remains single-process and is not suitable for horizontal scaling. Keep customer execution restricted until Batch 2 wires the repository through async task lifecycle operations and validates it against a real PostgreSQL service.

## Operator migration
Apply the migration to the target PostgreSQL database before enabling the repository in a future integration batch:
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/migrations/0001_execution_tasks.sql`
Do not enable database-backed orchestration until the live migration and integration suite pass.
