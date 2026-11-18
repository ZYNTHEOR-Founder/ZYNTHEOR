# ZYNTHEOR — Preflight & Integrity Report

- **Report Date (UTC):** `2026-11-18T13:26:30Z`
- **Target Model Track:** NativeLM 5,800-Step Training Plan (`Phase 1: 2,800 Steps` + `Phase 2: 3,000 Steps`)
- **Locked Architecture:** `41,527,808` Parameters (`vocab=16384`, `d_model=512`, `n_layers=10`, `n_heads=8`, `d_ffn=1472`, `ctx=64`, `tokenizer_profile=v2_base`)
- **Preflight Probe Command:** `python3 scripts/train_target.py --probe-s3 --preflight-only` (Exit Code: `2`, `training_executed: false`)

---

## Readiness Status

| Metric | Status / Value |
| :--- | :--- |
| **Overall Training Readiness** | **`BLOCKED`** |
| **Gates Passed** | `0 / 6` |
| **Gates Blocked** | `6 / 6` (Checkpoint/NumPy, Dataset Provenance, Governance, S3 Connectivity, Approval Key, Admin Approval) |
| **5,800-Step Training Executed** | `false` (Strictly fail-closed; not started) |
| **Runtime Environment** | `/usr/bin/python3` (`3.11.2`) — `numpy` absent (`NP_COMPAT_FALLBACK` prohibited for 41.53M target) |
| **Target Checkpoint Present** | `false` (`native_data/model_checkpoint_target_41m.pt` missing) |

All six mandatory fail-closed gates must transition from `BLOCKED` to `VERIFIED` before Gate 6 Admin Human Approval can authorize execution of the 5,800-step training pipeline.

---

## 6 ZYNTHEOR Preflight Gates

### Gate 1 — Checkpoint (`41,527,808` Parameters) & Native NumPy
- **Status:** `BLOCKED`
- **Checks Executed:**
  - `python3 scripts/check_checkpoint.py` -> Exit `1` (`{"status": "MISSING", "path": "/app/applet/native_data/model_checkpoint_target_41m.pt", "exists": false}`)
  - `python3 scripts/train_target.py --probe-s3 --preflight-only` -> `backend.numpy_available: false`, `backend.float32_verified: false`
  - `GET /api/system/training-readiness` -> `target41mNumpyGate: "BLOCKED"`, `targetCheckpointPresent: false`
- **Blocking Reasons:**
  1. `native_data/model_checkpoint_target_41m.pt` is absent on disk; structural audit, tensor integrity, parameter count (`41,527,808`), and container/payload SHA-256 cannot be verified.
  2. Real C-extension `numpy` is not installed in `/usr/bin/python3` (`3.11.2`). Pure-Python `np_compat` is strictly rejected for 41.53M training.

### Gate 2 — Dataset Provenance (`.jsonl` Splits & Evidence Bundle)
- **Status:** `BLOCKED`
- **Checks Executed:**
  - `qplus_native.train_target` dataset inspection -> `dataset.exists: false`, `split_counts: {"train": 0, "validation": 0, "test": 0, "total": 0}`
  - Inspected `source/artifacts/dataset-provenance-manifest.json` -> `schema_version: "zyntheor.dataset-provenance.v1"`, `dataset_id: "zyntheor-native-41m-pending-review"`, `documents: []`
  - Inspected `source/artifacts/dataset-provenance-evidence/` subdirectories -> `source/`: 0 files, `license/`: 0 files, `rights/`: 0 files, `approval/`: 1 legacy file (`approval.json`)
- **Blocking Reasons:**
  1. Missing verified `.jsonl` dataset files (`native_data/real_dataset.jsonl` and `native_data/tool_call_dataset.jsonl` do not exist).
  2. Empty provenance manifest (`documents: []`) and empty `source/`, `license/`, `rights/` evidence directories.

### Gate 3 — Governance (`validate_training_readiness` & Admission Audit)
- **Status:** `BLOCKED`
- **Checks Executed:**
  - `python3 -m qplus_native.dataset_admission_audit` -> `status: "BLOCKED"`, `training_admission_allowed: false`, `approved_document_count: 0`, `needs_review_document_count: 0`, `blocked_document_count: 262`
- **Blocking Reasons:**
  1. `trusted_approval_key_missing`
  2. `workspace_corpus_unapproved_and_missing_test_split`
  3. Existing local JSON files (`native_data/knowledge/documents.json`, `native_data/datasets/*.json`) are unprovenanced (`approved_for_training: false`, no signed `zyntheor.dataset-provenance.v1` manifest).

### Gate 4 — S3 Connectivity (Credentials, Bucket & Cloud Runtime)
- **Status:** `BLOCKED`
- **Checks Executed:**
  - `python3 scripts/train_target.py --probe-s3 --preflight-only` -> `s3_probe.config_valid: false`, `connectivity.online: false`, `connectivity.error_code: "NOT_CONFIGURED"`
  - `GET /api/storage/preflight` -> `status: "PREFLIGHT_BLOCKED"`, `blockers: ["missing_s3_credentials"]`
- **Blocking Reasons:**
  1. Neither `.env` nor `.env.local` exists in the workspace root.
  2. Required environment variables (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_CHECKPOINT_KEY`, `CHECKPOINT_PRESIGNED_URL`) are all unset.

### Gate 5 — Approval Key (`0600` POSIX Trust Root)
- **Status:** `BLOCKED`
- **Checks Executed:**
  - `qplus_native.train_target` `_inspect_approval_key()` -> `configured: false`, `exists: false`, `permissions_0600_or_stricter: false`, `verifier_loaded: false`, `error: "trusted_approval_key_missing"`
  - `qplus_native.trusted_approvals.load_hmac_verifier` enforces non-symlink regular file with mode `0600` or stricter and >=256-bit `key_hex`.
- **Blocking Reasons:**
  1. `ZYNTHEOR_APPROVAL_KEY_FILE` is unset and no HMAC approval trust key file is provisioned in the environment.
  2. Legacy `source/artifacts/dataset-provenance-evidence/approval/approval.json` cannot be verified without the external trust key and does not conform to canonical v1 signed payloads.

### Gate 6 — Admin Approval (Human Authorization Gate)
- **Status:** `BLOCKED`
- **Checks Executed:**
  - `human_approval_confirmed: false` in preflight output (`blocker: "human_approval_confirmation_missing"`).
- **Blocking Reasons:**
  1. Explicit Admin approval (`--human-approval-confirmed` / `ApprovalGate` approval record) has not been granted and remains locked until Gates 1–5 are `VERIFIED`.

---

## SHA-256 Integrity Verification Results

All SHA-256 digests below were measured directly from the workspace filesystem using `sha256sum` and `qplus_native.candidate_audit`.

```text
# Model Checkpoints & Candidate State Artifacts
MISSING  native_data/model_checkpoint_target_41m.pt                         [STATUS: BLOCKED — Target 41,527,808-param checkpoint absent]
MISSING  checkpoints/cl_1794907544268_9dccb1_candidate.pt                   [STATUS: BLOCKED — Declared 2dc98255e8cd33ea4cb58eba7a7ced19dd955163a60f6ee9ae70f074a9a9f346]
MATCH    checkpoints/cl_1794907544268_9dccb1_candidate.pt.resume.json       cd31b6322d05110c6c3c794b3d441a625b3598d50d87dca11506619bc4962b97  (matches manifest resume_state_sha256; 1-layer non-target candidate)
PRESENT  checkpoints/cl_1794907544268_9dccb1_candidate.pt.manifest.json     09af7377748bbcdf4f211f917a534b8101d63c1a360bcf0f8d111cb5bd45b754

# Provenance, Approval & Governance Artifacts
PRESENT  source/artifacts/dataset-provenance-manifest.json                  b2d96d1f25b5e1e5ed30e6f007dd304f089745a7728b119e9bb0b86cd29c2910  (BLOCKED: documents=[])
PRESENT  source/artifacts/dataset-provenance-evidence/approval/approval.json d80217b33cb66e0bfb4ab3eb76332a533d4df3711c4d74f6728bb66eb70fab2a  (BLOCKED: legacy schema, unverified without trust key)
PRESENT  artifacts/dataset-governance-audit.json                            e6c77534fd55a4414c4103a192dc6957e200c682d565b319d10596cb54bd59de  (BLOCKED: 0 approved, 262 blocked)
PRESENT  artifacts/dataset-provenance-manifest.pending.json                 784bea43363c0baa60075f97be340d9eb0dfc47448fba11551772b557be903a4  (template only)

# Local Unprovenanced Dataset & Knowledge Files (Not Admitted for Training)
MISSING  native_data/real_dataset.jsonl                                     [STATUS: BLOCKED]
MISSING  native_data/tool_call_dataset.jsonl                                [STATUS: BLOCKED]
PRESENT  native_data/knowledge/documents.json                               9e44f30a1d7c8fdeef1e3df5877f620cd38917eafa2ca2f944d927b395bd6802  (BLOCKED: unprovenanced)
PRESENT  native_data/datasets/ds_1794922200463.json                         6e5e5d16481f93a6b13375050023b9178929032a1326486cda353bfa5483bde5  (BLOCKED: unprovenanced)
PRESENT  native_data/datasets/ds_1794922200466.json                         8683e609ca750c9e2df0136ccd896004bb551ef7a92b66a13dd5c7618e1b0545  (BLOCKED: unprovenanced)
PRESENT  native_data/datasets/ds_1794922258067.json                         37d80ec0aabfed9e79c46b925d304605617139ebb56d1e902a4e240adc02ee4a  (BLOCKED: unprovenanced)
PRESENT  native_data/datasets/manifest.json                                 4e9cbdda1877552d13e2d2dc754f54e56dc5d6eb079443c8da97d1128828cf84  (BLOCKED: unprovenanced)

# Training Pipeline Core Scripts & Tokenizer Lock
PRESENT  qplus_native/train_target.py                                       da35f6b70526b2c823fcfb82ae5d508981217e5399defc2637941d53dcf49323  (VERIFIED: CLI preflight & fail-closed gates)
PRESENT  qplus_native/training_state.py                                     179ec320d85a01e44999030e30a89aea97a87c4e4f9c9f1b9de80c12b505aafd  (PARTIAL: requires NumPy to execute bundle tests)
LOCKED   Tokenizer Fingerprint (v2_base, vocab=16384)                       8829827ad56abe3fbcea531942e295f011646677777c4953e8976a2e7fad39a8
```

---

## Required Actions to Reach `READY`

1. Install native `numpy` and `boto3` in the training Python environment (`pip install -r requirements-native.txt`).
2. Configure S3 credentials (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_CHECKPOINT_KEY`) or `CHECKPOINT_PRESIGNED_URL` in runtime secrets / `.env.local`.
3. Provision `native_data/model_checkpoint_target_41m.pt` (`41,527,808` params) and verify via `python3 scripts/check_checkpoint.py`.
4. Provision real `.jsonl` Train / Validation / Test datasets, complete `source/artifacts/dataset-provenance-manifest.json` with SHA-256 pinned evidence under `source/artifacts/dataset-provenance-evidence/{source,license,rights,approval}/`, and configure `ZYNTHEOR_APPROVAL_KEY_FILE` (`chmod 0600`).
5. Re-run `python3 scripts/train_target.py --probe-s3 --preflight-only` to confirm Gates 1–5 are `VERIFIED` before requesting Gate 6 Admin approval.
