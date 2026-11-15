# ZYNTHEOR Competitive Benchmark Suites (L1–L4)

These suites are real browser acceptance tests. They do not create or simulate an application and they do not award a result based on a model response.

## Required project contract

Create the tested application under `workspace/projects/<projectId>/`. Add `.zyntheor-benchmark.json`:

```json
{
  "previewUrl": "https://<approved-preview-origin>/<project-preview-path>"
}
```

The exact URL origin must be present in the server environment variable `ZYNTHEOR_BENCHMARK_ALLOWED_ORIGINS` (comma-separated exact origins). HTTPS is required. Loopback is permitted only in test mode with `ZYNTHEOR_ALLOW_LOOPBACK_BENCHMARK=1`.

Install Playwright Test and its browser runtime in the target online build environment before running. The current source archive does not include Playwright or browser binaries; until provisioned, the API returns `BLOCKED`, never `VERIFIED`.

## Accessibility contract

Applications should expose semantic labels, roles and accessible names for interactive controls. L1–L4 suites intentionally test user-visible behavior rather than implementation internals. L4 additionally requires `data-testid="cart-total"` for a stable total assertion.

## Run

```sh
npx playwright install chromium
node_modules/.bin/playwright test tests/benchmarks/level1-todo.spec.mjs --reporter=json
```

Then call `POST /api/benchmarks/run` with `{ "level": 1, "projectId": "your-project" }` using an authenticated Developer or Administrator session.

## Evidence interpretation

`VERIFIED` means the application E2E suite passed with exit code 0, no skipped/flaky tests, an unchanged source revision during the run, and a SHA-256 evidence manifest. It does **not** by itself prove Native Engine authorship. Native capability remains explicitly `UNVERIFIED` until an auditable Native Engine project-generation event is connected to the project and revision.

Install the runner in the online project environment with:

```sh
npm install --save-dev @playwright/test
npx playwright install chromium
```

The installation must be reflected in both `package.json` and the lockfile before production deployment.
