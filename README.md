<p align="center">
  <img src="./assets/banner-top.svg" alt="ZYNTHEOR Vivid Intelligence" width="100%" />
</p>

# ZYNTHEOR — VIVID INTELLIGENCE

<p align="center">
  <b>Intelligence Without Boundaries.</b><br />
  Native Multi-Domain Intelligence · Online Cloud Architecture · First-Party Native Core
</p>

---

## Overview

**ZYNTHEOR** is a **Native Multi-Domain Intelligence Platform** built to unify reasoning, research, software engineering, planning, verification, and controlled execution inside one interconnected architecture.

Rather than wrapping third-party conversational APIs as its core brain, ZYNTHEOR is engineered around a first-party native intelligence stack:

- **Frontend & Mobile Delivery:** React + Vite web workspace packaged for Android via Capacitor (`APK` / `AAB`)
- **Control Plane & API Server:** Express / Node.js 22 with WebSocket live execution telemetry, RBAC, and an append-only SHA-256 Audit Ledger
- **Native Intelligence Bridge (`qplus_native`):** First-party `NativeLM` transformer architecture (`41,527,808` target parameters), `SovereignTokenizer`, governed training runner, and checkpoint auditor
- **Cloud Persistence:** S3-compatible Cloud Object Storage (`boto3` / AWS SDK v3 / presigned URLs) and PostgreSQL (Cloud SQL) when provisioned

ZYNTHEOR operates on a verifiable end-to-end work cycle:

```text
Understand → Reason → Plan → Create → Execute → Test → Improve → Deliver
```

### Zero-Fake Engineering Standard

Every capability in ZYNTHEOR is strictly classified as `IMPLEMENTED`, `VERIFIED`, `PARTIAL`, `BLOCKED`, or `NOT IMPLEMENTED`. Planned or unprovisioned components are never presented as active or completed without real execution evidence.

---

## Core Principles

- **Native Intelligence Core:** First-party model weights, tokenizer, training pipeline, inference, and memory remain the platform's primary intelligence engine.
- **Fail-Closed Execution:** Missing checkpoints, missing real NumPy C-extensions, unapproved datasets, missing S3 credentials, or missing human approval block execution immediately.
- **Evidence-Backed Delivery:** Tasks, checkpoints, and training runs produce traceable SHA-256 seals, execution logs, and immutable audit records.
- **Security & Accountability:** Server-side RBAC, tenant isolation, SSRF-hardened cloud probes, `0600` external trust keys, and zero secret exposure in logs or repositories.

---

## 6-Gate Preflight Process

Before any continuation or training run can begin on the target 41.53M model, ZYNTHEOR enforces a mandatory **6-Gate Fail-Closed Preflight**. Run the non-destructive preflight probe via:

```bash
python3 scripts/train_target.py --probe-s3 --preflight-only
```

The command emits structured JSON diagnostics (with S3 URLs and credentials redacted) and exits `0` only when all gates pass, or `2` (`BLOCKED`) when any prerequisite is missing.

| Gate | Name | Verification Criteria |
| :--- | :--- | :--- |
| **Gate 1** | **Checkpoint & Native NumPy** | Verifies real C-extension `numpy` (`float32` verified; pure-Python `np_compat` is strictly rejected) and inspects `native_data/model_checkpoint_target_41m.pt` (`41,527,808` parameters, SHA-256 integrity via `scripts/verify_checkpoint.py`, `STRUCTURAL_CHECKS_PASS`, `SovereignTokenizer` `v2_base` fingerprint lock). |
| **Gate 2** | **Dataset Provenance** | Validates `.jsonl` dataset records (`document_id`, `split` across `train`/`validation`/`test`, `text`), `source/artifacts/dataset-provenance-manifest.json` (`zyntheor.dataset-provenance.v1`), and SHA-256 pinned evidence under `source/artifacts/dataset-provenance-evidence/{source,license,rights,approval}/`. |
| **Gate 3** | **Dataset Governance** | Runs `validate_training_readiness` and `qplus_native.dataset_admission_audit` to enforce non-overlapping `train`/`validation`/`test` splits, zero exact or near-duplicate cross-split leakage (`< 0.90` Jaccard), and strict exclusion of the `test` split from training. |
| **Gate 4** | **S3 Connectivity** | Validates Cloud Object Storage configuration (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_CHECKPOINT_KEY`, or `CHECKPOINT_PRESIGNED_URL`) and probes live network reachability via `qplus_native.cloud_storage`. |
| **Gate 5** | **Approval Key (`0600`)** | Inspects `ZYNTHEOR_APPROVAL_KEY_FILE` (`trusted_approvals.load_hmac_verifier`): enforces non-symlink regular file, POSIX permissions `0600` or stricter, valid `key_id`, and `>= 256`-bit `key_hex` without exposing key material. |
| **Gate 6** | **Admin Human Approval** | Requires explicit human authorization (`--human-approval-confirmed` / verified `ApprovalGate` record). Training processes remain locked until Gates 1–5 report `VERIFIED` and Gate 6 is explicitly confirmed. |

See [`docs/preflight-integrity-report.md`](./docs/preflight-integrity-report.md) for the latest workspace preflight status and measured SHA-256 integrity records.

---

## Training Pipeline Architecture (5,800 Steps)

ZYNTHEOR's target continuation training pipeline (`qplus_native/train_target.py` and `qplus_native/training_state.py`) is locked to **5,800 total steps** across two governed phases:

- **Phase 1 — Warm Start:** `2,800` Steps
- **Phase 2 — Continuation:** `3,000` Steps
- **Total Training Plan:** `5,800` Steps

### Target Model Configuration (`41,527,808` Parameters)

| Parameter | Locked Value |
| :--- | :--- |
| `vocab` | `16,384` |
| `d_model` | `512` |
| `n_layers` | `10` |
| `n_heads` | `8` |
| `d_ffn` | `1,472` |
| `ctx` | `64` |
| `tokenizer_profile` | `v2_base` (`8829827ad56abe3fbcea531942e295f011646677777c4953e8976a2e7fad39a8`) |
| `target_total_params` | `41,527,808` |

### Pipeline Execution & Integrity Guarantees

1. **Non-Destructive Path Isolation:** `--out` must differ from `--init`, and existing output checkpoints or resume bundles are never overwritten.
2. **Exact Resume State Bundles (`qplus_native/training_state.py`):** Stores `weights.pt`, `model_state.npz`, `optimizer.npz` (`AdamW` first/second moments and step `t`), `training.json` (`PCG64` RNG state, cosine-with-warmup scheduler state, `corpus_sha256`, `configuration_sha256`), and `bundle.json` with per-member SHA-256 verification and atomic write via `os.link`.
3. **Finite Numerics Guards:** Verifies finite logits, cross-entropy loss, `dlogits`, every parameter gradient tensor, `grad_norm`, and updated weights before and after each optimizer step.
4. **Periodic Evaluation & Persisted Checkpoints:**
   - Evaluates held-out `validation` loss every **`25` steps** (`--eval-every 25`), logging JSONL metrics (`*.eval.jsonl`) and tracking the best validation state.
   - Persists intermediate `.pt` checkpoints every **`100` steps** (`--save-every 100`) and runs `_verify_persisted_checkpoint()` to re-read from disk and verify container/payload SHA-256 hashes and exact `41,527,808` parameter count.
5. **Final Evidence Generation:** Produces the final best-validation checkpoint and writes `artifacts/target-training-evidence.json` containing container/payload SHA-256 digests, step history, intermediate checkpoint proofs, and corpus hashes.

---

## Developer Setup & Running the Application

### Local Web Application (Development)

**Prerequisites:** Node.js `22+`, npm, and Python `3.11+` (`requirements.txt` installs `numpy`, `boto3`, and `pytest` required for real training runs and full Python test suites).

```bash
cp .env.example .env
npm install --no-audit --no-fund
python3 -m pip install -r requirements.txt
npm run dev
```

Open `http://localhost:3000`. The `npm run dev` script enables the development login flow and must only be used in trusted development environments. For production builds:

```bash
npm run build
NODE_ENV=production npm start
```

### Cloud Deployment with Docker Compose

1. Copy `.env.example` to `.env`.
2. Set strong, unique values for `SQL_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `ZYNTHEOR_MASTER_SECRET` (at least 32 characters). Set `ALLOWED_ORIGINS` to exact HTTPS origins (never `*`).
3. Configure `S3_BUCKET`, `S3_CHECKPOINT_KEY`, and either S3-compatible endpoint credentials or a signed checkpoint URL (`CLOUD_RUNTIME_URL` is a health/runtime probe only and never substitutes for a checkpoint).
4. Start the stack:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f zyntheor-cloud
```

- API liveness: `GET /api/health`
- Model & cloud readiness: `GET /api/connectivity/health`, `GET /api/storage/preflight`, `GET /api/system/training-readiness`

### Android (Capacitor)

After Node dependencies and Android SDK / JDK 17 are installed:

```bash
npm install --no-audit --no-fund
npm run cap:sync
cd android && ./gradlew assembleDebug
```

The Android app connects online to the Express API configured for your environment.

---

## Verification & Testing

```bash
# TypeScript & Production Build
npm run lint
npm run build

# Preflight & Checkpoint CLI (Read-only / Fail-closed)
python3 scripts/verify_checkpoint.py
python3 scripts/check_checkpoint.py
python3 scripts/train_target.py --probe-s3 --preflight-only
python3 -m qplus_native.dataset_admission_audit

# Node.js Test Suites
node --test tests/command-center-dispatch.test.mjs tests/execution-boundary.test.mjs
npm run test:identity
npm run test:knowledge
npm run test:security

# Python Test Suites (stdlib unittest; full suite via `npm run test:python` requires `requirements.txt`)
python3 -m unittest tests/training/test_verify_checkpoint.py tests/training/test_train_target_preflight_cli.py tests/training/test_training_pipeline.py tests/test_sovereign_token.py tests/test_tokenizer.py tests/security/test_security_invariants.py tests/api/test_api_contract.py tests/model/test_nativelm_and_tokenizer.py tests/runtime/test_runtime_smoke.py
```

---

## Operational & Training Safety Notice

- **Command Execution vs. NativeLM Inference:** The Command Center dispatches engineering tasks to the Action-Driven Engine (`node`/`python3` sandbox execution and verification). Successful deterministic task execution does not imply NativeLM weights are loaded; NativeLM inference remains blocked until a real checkpoint passes cloud retrieval, SHA-256 verification, and forward-pass validation.
- **Training Lock:** Application startup never triggers the 5,800-step training pipeline automatically. Training remains fail-closed until all 6 Preflight Gates pass and Admin approval is confirmed.

---

## License

Distributed under the **AGPL-3.0 License**.

<p align="center">
  <img src="./assets/banner-bottom.svg" alt="ZYNTHEOR Vivid Intelligence" width="100%" />
</p>
