# ZYNTHEOR — Vivid Intelligence & TypeScript Definitions Hub

ZYNTHEOR Vivid Intelligence is a full-stack multi-domain intelligence platform built with React, Vite, Express, and TypeScript, alongside a first-party native sequence-model pipeline (`qplus_native/`), verification suites, and TypeScript definition tooling.

---

## Available Components & Packages

- **Web Platform & Sovereign Server (`server.ts`, `src/`, `lib/`)**: Full-stack Express + Vite TypeScript application with WebSocket runtime monitoring, knowledge workspace, governance/audit ledger, and evaluation modules.
- **Native Intelligence Core (`qplus_native/`, `tests/`)**: Python sequence-model architecture, tokenizer, training curriculum, and integrity verification suite.
- **TypeScript Definition Packages (`types/`)**: Dedicated directory for TypeScript declaration packages (`types/<package>/` or scoped `types/@<scope>/<package>/`), each containing:
  - `index.d.ts` — TypeScript declaration entry point
  - `tsconfig.json` — Package-level TypeScript configuration
  - `*-tests.ts` / `*.test.ts` — Type-level test files validated by ESLint and `tsc`
- **Verification & CI Workflows (`.github/workflows/`, `scripts/`)**:
  - `scripts/verify-type-packages.mjs` — Node.js verification script validating `tsconfig.json` and `index.d.ts` across all package directories
  - `.github/workflows/ci.yml` — Runs core validation, ESLint on `types/` TypeScript test files, `tsc` compilation checks, and posts a summary comment on Pull Requests
  - `.github/workflows/typecheck-packages.yml` — Runs `tsc --noEmit` against every updated package on push and pull request

---

## Installation & Using TypeScript Definitions

### 1. Install Project Dependencies

```bash
npm install
```

### 2. Configure TypeScript Definitions in `tsconfig.json`

To consume type definitions from the `types/` directory in a TypeScript project, add `types` to `typeRoots` or configure `paths` in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "typeRoots": ["./node_modules/@types", "./types"],
    "paths": {
      "*": ["./types/*"]
    }
  }
}
```

If you are publishing or referencing an individual package from `types/<package>/`, verify its local `tsconfig.json` includes `"noEmit": true` and references `index.d.ts` and any `*-tests.ts` files.

---

## Development Guidelines

### Running the Application Locally

```bash
npm run dev
```

The server binds to `0.0.0.0:3000` and serves both the Express API and the Vite frontend middleware.

### Adding or Updating a Definition Package

1. Create a directory under `types/<package-name>/` (or `types/@<scope>/<package-name>/`).
2. Add `index.d.ts` containing the public TypeScript declarations.
3. Add a valid `tsconfig.json` inside the package directory:
   ```json
   {
     "compilerOptions": {
       "module": "commonjs",
       "lib": ["es2022"],
       "noImplicitAny": true,
       "noImplicitThis": true,
       "strictNullChecks": true,
       "strictFunctionTypes": true,
       "types": [],
       "noEmit": true,
       "forceConsistentCasingInFileNames": true
     },
     "files": ["index.d.ts", "<package-name>-tests.ts"]
   }
   ```
4. Add `<package-name>-tests.ts` exercising the type definitions, and ensure it passes ESLint and `tsc --noEmit`.

### Type Checking & Linting

- **Root TypeScript check**:
  ```bash
  npm run lint
  ```
- **Build production bundle**:
  ```bash
  npm run build
  ```
- **Per-package `tsc` check**:
  ```bash
  npx tsc --noEmit -p types/<package-name>/tsconfig.json
  ```

### CI Pull Request & Push Workflows

- **`.github/workflows/ci.yml`**:
  - `validate`: Runs Python syntax, model integrity, pytest suites, and Vite frontend build.
  - `eslint-types`: Runs ESLint across all TypeScript test files in `types/`.
  - `typecheck-and-pr-summary`: Runs `tsc --noEmit` on root and `types/*` packages, verifies package structure, and posts/updates a PR summary comment listing all checked package definitions and highlighting any compilation errors.
- **`.github/workflows/typecheck-packages.yml`**:
  - Detects every updated package in `types/` on `push` / `pull_request` and runs `tsc --noEmit` on each updated package along with the structural verification script.

---

## Node.js Package Verification Script

Use the built-in Node.js verification script to directly check that every package directory under `types/` (and the root project) contains a valid `tsconfig.json` and a non-empty `index.d.ts`:

```bash
# Run directly with Node.js
node scripts/verify-type-packages.mjs

# Or via npm script
npm run verify:types

# Fail if types/ does not exist or has 0 packages, or output JSON
node scripts/verify-type-packages.mjs --strict
node scripts/verify-type-packages.mjs --json
```

You can also run a quick inline Node.js check directly from the root directory:

```bash
node -e '
const fs = require("node:fs");
const path = require("node:path");
const root = "types";
if (!fs.existsSync(root)) { console.log("No types/ directory present."); process.exit(0); }
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(root, entry.name);
  const hasTsconfig = fs.existsSync(path.join(dir, "tsconfig.json"));
  const hasIndexDts = fs.existsSync(path.join(dir, "index.d.ts"));
  if (!hasTsconfig || !hasIndexDts) {
    console.error("INVALID:", dir, { hasTsconfig, hasIndexDts });
    process.exitCode = 1;
  } else {
    JSON.parse(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8"));
    console.log("OK:", dir);
  }
}
'
```

---

## ZYNTHEOR Candidate Remediation Package (Verification Notes)

แพ็กนี้ประกอบด้วย source files ที่เพิ่ม/แก้, schemas/templates, non-training tests, raw candidate audit summary, test log และ technical report. รวมไฟล์เข้ากับ repository โดยรักษา relative paths ภายใน `source_changes/`.

```bash
sha256sum -c SHA256SUMS.txt
python3 -m unittest discover -s tests -p 'test_candidate_remediation.py' -v
```

ตรวจ candidate แบบ raw bytes (ไม่โหลด model):

```bash
python3 qplus_native/candidate_audit.py native_data/model_checkpoint_v2_candidate.pt
```

`train_lm.py` และ `train_gated.py` มี fail-closed governance gate. ห้ามเริ่ม training จนกว่าจะมี provenance manifest จากข้อมูลจริง, evidence ที่ hash ตรง, external trusted approval key ที่ออกโดยผู้มีอำนาจ และผล split/leakage audit ผ่าน.

ดูสถานะและข้อจำกัดทั้งหมดใน [TECHNICAL_REPORT.md](TECHNICAL_REPORT.md).