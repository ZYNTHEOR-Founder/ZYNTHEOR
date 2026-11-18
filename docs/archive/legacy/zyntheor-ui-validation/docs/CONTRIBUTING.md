# Contributing to ZYNTHEOR

Thank you for contributing to **ZYNTHEOR — VIVID INTELLIGENCE**.

## Core Engineering Principles

1. **Native Sovereignty**: All intelligence capabilities must be engineered first-party (`qplus_native/`, `lib/`). Do not introduce external AI APIs or third-party LLM fallbacks.
2. **Zero-Fake Engineering**: Never fabricate benchmark scores, model capabilities, training progress, or telemetry. Missing or corrupted assets must fail closed (`FAIL_CLOSED`).
3. **Evidence-Based Verification**: Every change must be verified with `npm run lint`, `npm run build`, and runtime checks.

## Development Workflow

1. Fork the repository and create a feature branch (`git checkout -b feat/your-feature`).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Verify TypeScript types and production build before submitting:
   ```bash
   npm run lint
   npm run build
   ```

## Pull Request Guidelines

- Keep changes focused and modular.
- Document what was inspected, changed, and verified in your PR description.
- Preserve existing checkpoints, datasets, and audit ledger integrity.
