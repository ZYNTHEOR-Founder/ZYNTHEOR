<p align="center">
  <img src="./assets/banner-top.svg" alt="ZYNTHEOR Vivid Intelligence" width="100%" />
</p>

<h1 align="center">ZYNTHEOR — VIVID INTELLIGENCE</h1>

<p align="center">
  <b>Intelligence Without Boundaries.</b><br />
  Native Multi-Domain Intelligence · Online Cloud Intelligence · First-Party Native Core
</p>

---

## Overview

ZYNTHEOR is an online, cloud-connected intelligence platform built around a first-party native model, tokenizer, training pipeline and inference runtime.

The platform is designed around one work cycle:

**Understand → Reason → Plan → Create → Execute → Test → Improve → Deliver**

Capabilities are described only as far as they are implemented and verified. Planned functionality is not presented as available.

## Project status

| Area | Status |
| --- | --- |
| Web application (Command Center, Chat, Lab, Evidence) | Implemented; `lint` and production `build` pass |
| Action-Driven Engine (task dispatch, file creation, tests) | Implemented; independent of NativeLM |
| Native model (41,527,808 parameters, tokenizer `v2_base`) | Trained for 5,800 steps; checkpoint integrity checks pass |
| Native runtime | Smoke verified: checkpoint loads and the generate loop runs |
| Thai / English answer quality | **Not ready.** Outputs are not yet usable as an assistant |
| Dataset provenance and approval evidence | Recorded; signature reconciliation in progress |
| Production readiness | Not verified |

Do not describe the native model as a working assistant until a measurable Thai/English evaluation passes.

## Principles

- **Native intelligence:** one interconnected first-party core.
- **Online only:** the platform is designed for connected cloud infrastructure. There is no offline operating mode.
- **No third-party model providers:** answers never come from external LLM APIs. Firebase is used only for Google sign-in.
- **Evidence-based engineering:** implemented, verified, partial and unavailable capabilities are kept separate.
- **Security and accountability:** access control, audit logging and fail-closed behaviour are part of the architecture.

## Run the application

### Web application (development)

Requirements: Node.js 22+ and Python 3.11+ (for native services).

```bash
cp .env.example .env
npm install --no-audit --no-fund
python -m pip install -r requirements.txt
npm run dev
```

Open `http://localhost:3000` (in Codespaces, open the forwarded port 3000). Sign in first; protected API calls return HTTP 401 until you do. The development command enables the repository's development login and must only be used on a trusted development machine.

Production build:

```bash
npm run build
NODE_ENV=production npm start
```

A static host (for example GitHub Pages or a preview without the Express server) cannot sign in or run tasks, because the API is not reachable there.

### Checks

```bash
npm run lint        # TypeScript type check
npm run build
npm run test:all
python -m pytest -q
```

### Cloud deployment with Docker Compose

1. Copy `.env.example` to `.env`.
2. Set strong, unique values for `SQL_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `ZYNTHEOR_MASTER_SECRET` (at least 32 characters). Set `ALLOWED_ORIGINS` to the exact HTTPS origins that will use the API; never `*`.
3. Configure `S3_BUCKET`, `S3_CHECKPOINT_KEY`, and either S3-compatible storage settings or a signed checkpoint URL. `CLOUD_RUNTIME_URL` is a health endpoint only; it is not a model checkpoint.
4. Start the services:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f zyntheor-cloud
```

`GET /api/health` reports web-server liveness. `GET /api/connectivity/health` reports model readiness separately; a healthy server does not mean the native weights are loaded and verified. MinIO ports are bound to loopback only; use a tunnel for remote administration.

## Command Center and task execution

The Command Center sends tasks to the Action-Driven Engine, which writes artifacts into the workspace and runs syntax, runtime and unit-test checks. Results are attributed to that deterministic engine. They are not evidence that native model inference is active or that the model answers questions well.

## Native model and training

- Architecture: native model with 41,527,808 parameters and tokenizer profile `v2_base`.
- Training: 5,800 steps (warm start 2,800 + continuation 3,000), completed. The final checkpoint is kept as an immutable baseline; do not overwrite it. Any further training must write a new checkpoint and be compared against the baseline.
- Runtime: the checkpoint loads in under a second and the generate loop completes in Thai and English prompts (smoke test only).
- Quality: the current training set is small, so outputs are not usable answers yet. The next training round needs a larger dataset and a measurable Thai/English evaluation.
- Storage: checkpoint payloads (`*.pt`) are never committed to Git. Keep them in object storage (S3) or Git LFS and verify the SHA-256 before loading.

### Dataset provenance and approval

Training data must have recorded provenance, train/validation/test splits and explicit human approval. The approval signature uses an external HMAC key (file mode `0600`). Keys are never committed, never printed, and are excluded by `.gitignore`. Verification uses `scripts/sign_dataset_provenance.py --verify-only`. An approval is treated as verified only when that check passes.

## Repository and access

- Keep one source of truth (the GitHub `main` branch). Do not edit the same files in several workspaces at once.
- Training data, audit logs and runtime state belong in a **private** repository or in object storage.
- Do not commit `.env`, key files, tokens or checkpoint binaries.

## Android

After Node dependencies and the Android SDK/JDK 17 are installed:

```bash
npm install --no-audit --no-fund
npm run cap:sync
cd android && ./gradlew assembleDebug
```

The Android app connects to the configured online Express API. Set the production API origin in the mobile build configuration.

## License

Distributed under the AGPL-3.0 License.

---

<p align="center">
  <img src="./assets/banner-bottom.svg" alt="ZYNTHEOR Vivid Intelligence" width="100%" />
</p>
