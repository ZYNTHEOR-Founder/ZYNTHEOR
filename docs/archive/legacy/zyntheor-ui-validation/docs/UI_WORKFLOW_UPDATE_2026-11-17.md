# ZYNTHEOR UI workflow update — 2026-11-17

## Changes applied to this source copy

- Kept the existing application shell and all 16 `ModuleId` routes; no model checkpoints, training data, server APIs, or database files were modified.
- Kept the TH/EN language selector as a two-button segmented control with a visible active check, `aria-pressed`, accessible group naming, and persisted language state.
- Expanded the language dictionary for the shared shell, user-role labels, context rail, audit state, and runtime state.
- Localized the shared header/session and sidebar role labels, mobile navigation labels, and context-rail labels.
- Replaced the static “Invariants Verified (SHA-256)” claim in the header with an audit-chain indicator rendered only when API status data is present; the label and visual state now depend on `statusData.audit.chainValid`.
- Removed the hard-coded commercial launch default from the header. The phase indicator is hidden until the API supplies a phase.
- Reworded the context-rail runtime descriptor to “Native Runtime · Online Cloud”.
- Retained the responsive sidebar/mobile navigation behavior and top/bottom animated edge treatment, including reduced-motion handling.
- Added dependency-free source checks: `npm run verify:i18n`, `npm run verify:ui-workflows`, and combined `npm run test:ui`.

## Checks executed

- `node scripts/verify-language-keys.mjs` — PASS: 116 bilingual dictionary entries; 85 statically referenced translation keys resolve; language persistence/document language hooks and selected-state accessibility marker are present.
- `node scripts/verify-ui-workflows.mjs` — PASS: all 16 module identifiers have render cases and sidebar route entries; the shared shell, workspace, header, mobile navigation, and role-gate integration points are present.
- `pytest -q tests/test_tokenizer.py tests/test_sovereign_token.py tests/model/test_nativelm_and_tokenizer.py tests/runtime/test_runtime_smoke.py tests/security/test_security_invariants.py tests/training/test_training_pipeline.py` — PASS: 25 passed, 1 skipped in 1.57s. This covers native tokenizer round-trip, model/checkpoint validation, runtime smoke structure, security invariants, and bounded training-step checks.
- Archive integrity is checked separately after packaging.

## Not yet verified

- Frontend production build and TypeScript compile were not completed. `npm install --package-lock=false --ignore-scripts --no-audit --no-fund` timed out and left no installed dependencies; `npm run build` therefore stops with `vite: not found`.
- Browser-level mobile/desktop interaction, visual layout, language-switch persistence after reload, and live API wiring have not been executed in a browser.
- Full bilingual copy coverage is still incomplete in some active modules. In particular, `DevStudio`, `ResearchLab`, `AutomationCenter`, `ExperimentCenter`, `ApiPlatform`, `Marketplace`, `SubscriptionBilling`, `AnalyticsBI`, and `AdminConsole` contain English UI strings without their own language hook. The global shell is localized; those module-specific screens still need a dedicated language pass.
- The source checks validate static structure only. They do not prove successful production runtime, backend connectivity, model readiness, or end-to-end task execution.
