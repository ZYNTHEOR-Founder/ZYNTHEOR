<p align="center">
  <img src="./public/assets/banner-top.svg" alt="ZYNTHEOR Vivid Intelligence rainbow aurora neural banner" width="100%" />
</p>

# ZYNTHEOR — VIVID INTELLIGENCE

<p align="center">
  <b>Intelligence Without Boundaries.</b><br />
  Native Multi-Domain Intelligence · Online Cloud Runtime · Native model core · Evidence-labelled capabilities
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Target_Architecture-41.5M_params-7B2CBF?style=flat" alt="Target architecture 41.5 million parameters" />
  <img src="https://img.shields.io/badge/Training-BLOCKED-FF5E3A?style=flat" alt="Training blocked pending approval and cloud runner" />
  <img src="https://img.shields.io/badge/Runtime-Online_Cloud-00F0FF?style=flat" alt="Online Cloud Runtime" />
  <img src="https://img.shields.io/badge/Tokenizer-Thai_%26_English-10B981?style=flat" alt="Thai and English tokenizer" />
  <img src="https://img.shields.io/badge/Audit_Log-SHA--256_hash_chain-F59E0B?style=flat" alt="SHA-256 hash-chained audit log" />
  <img src="https://img.shields.io/badge/External_AI_APIs-none_in_core_path_(PARTIAL)-rose?style=flat" alt="No external AI APIs in core path, status PARTIAL" />
</p>

---

## Overview

**ZYNTHEOR** is a first-party **Native Multi-Domain Intelligence system**. Its own model architecture, tokenizer, weights, training and reasoning pipeline form the intelligence core; the model is served through the designated online Cloud Runtime. Internet research and external service integrations remain separate capabilities, not substitutes for the Native Core. The platform also includes persistent memory, a Thai/English tokenizer, structured planning/execution, a project workspace, and a SHA-256 hash-chained audit log.

> **Reading this document.** Every capability carries a status. **`VERIFIED`** means a reproducible command *and* its recorded output are attached to this repository. **`PARTIAL`** means the feature is implemented or specified but its evidence is missing, incomplete, or covers only a narrower claim than the one a reader might assume. See [§13](#13-evidence-based-verification-status) for the checks and limitations of this source archive. Architecture numbers describe the **model's shape**, not the quality of its **learned weights**.

---

## Table of Contents

1. [Intelligence Mission & Vision](#1-intelligence-mission--vision)
2. [Native Model Architecture](#2-native-model-architecture)
3. [Neural Inference Engine](#3-neural-inference-engine)
4. [Reasoning & Multi-Step Logic](#4-reasoning--multi-step-logic)
5. [Learning & Continuous Model Evolution](#5-learning--continuous-model-evolution)
6. [Persistent Episodic Memory](#6-persistent-episodic-memory)
7. [Real-Time Conversational Intelligence](#7-real-time-conversational-intelligence)
8. [Multilingual Intelligence (Thai & English)](#8-multilingual-intelligence-thai--english)
9. [Vivid Appearance & Multi-Theme Engine](#9-vivid-appearance--multi-theme-engine)
10. [Autonomous Sandboxing & Execution](#10-autonomous-sandboxing--execution)
11. [Performance & Runtime Telemetry](#11-performance--runtime-telemetry)
12. [Sovereign Identity & Access Security](#12-sovereign-identity--access-security)
13. [Evidence-Based Verification Status](#13-evidence-based-verification-status)
14. [Quickstart & Deployment](#14-quickstart--deployment)
15. [Recent Capabilities & UI Controls](#15-recent-capabilities--ui-controls)
16. [License](#16-license)

---

## 1. Intelligence Mission & Vision

ZYNTHEOR is designed so its Native Core owns model reasoning and generation. Internet retrieval and online integrations are separate from the model runtime; no third-party AI model is promoted as the Native Core.

| Principle | Engineering Standard | Status |
|---|---|---|
| **No external AI APIs in the core path** | The Native Core is not delegated to a third-party AI model. Internet retrieval and online service integrations are separate paths. A complete dependency and egress audit remains pending. | `PARTIAL` |
| **Native neural core** | Reasoning and generation must originate from the Native Transformer loaded by the designated Cloud Runtime via `qplus_native.bridge`; current inference readiness is blocked until a compatible checkpoint is fetched and verified. | `BLOCKED` |
| **Fail-closed checkpoint loading** | A missing or corrupted checkpoint should halt execution (`FAIL_CLOSED`) instead of simulating success. | `PARTIAL` |
| **Bilingual script fidelity** | The tokenizer contains Thai/English vocabulary and code paths. Unknown-token rate and round-trip fidelity still require recorded runtime evidence. | `PARTIAL` |
| **Tamper-evident accountability** | State transitions, inference checks, and memory mutations are appended to a SHA-256 hash-chained log (`native_data/audit_log.jsonl`). A hash chain is *tamper-evident*, not tamper-proof — see [§6](#6-persistent-episodic-memory). | `PARTIAL` |

---

## 2. Native Model Architecture

ZYNTHEOR specifies a first-party Native decoder Transformer whose weights are served by the online Cloud Runtime:

```
                  ┌─────────────────────────────────────┐
                  │  Token Embedding (16,384 capacity)  │
                  └──────────────────┬──────────────────┘
                                     ▼
                  ┌─────────────────────────────────────┐
                  │     Rotary Positional (RoPE)        │
                  └──────────────────┬──────────────────┘
                                     ▼
         ┌────────────────────────────────────────────────────────┐
         │ 10× Transformer Blocks:                                │
         │   ├─ RMSNorm (Pre-Attention Normalization)             │
         │   ├─ Multi-Head Attention (8 Heads, d_k=64, d_model=512)│
         │   ├─ Residual Add Connection                           │
         │   ├─ RMSNorm (Pre-FFN Normalization)                   │
         │   └─ SwiGLU Feed-Forward Network (d_ffn=1,472)         │
         └───────────────────────────┬────────────────────────────┘
                                     ▼
                  ┌─────────────────────────────────────┐
                  │       Final RMSNorm (512-dim)       │
                  └──────────────────┬──────────────────┘
                                     ▼
                  ┌─────────────────────────────────────┐
                  │  Latent Projection & Generation     │
                  └─────────────────────────────────────┘
```

### Architecture specification (shape — not a quality claim)

| Property | Value | Detail |
|---|---|---|
| **Transformer layers** | `10` | Sequential pre-norm blocks |
| **Attention heads** | `8` | $d_k = 64$, $d_{model} = 512$ |
| **Hidden dimension ($d_{model}$)** | `512` | |
| **FFN intermediate dimension** | `1,472` | SwiGLU gated network |
| **Configured vocabulary capacity** | `16,384` | Base `v2_base` tokenizer reports 532 non-reserved vocabulary entries before reserved/padding IDs; profile-specific builds must report their own count. |
| **Measured active checkpoint payload** | `231,168` Float32 values | Byte-count and tensor-manifest inspection; not the 41.5M target graph |
| **Primary checkpoint payload size** | `924,672` bytes | 231,168 × 4 bytes; the container includes a metadata header |
| **Legacy metadata declaration** | `33,958,400` | Does not match the serialized payload; do not use as active parameter count |
| **Target architecture specification** | `41,527,808` parameters | Design target only; not instantiated by the available target artifacts |
| **Checkpoint file** | `native_data/model_checkpoint.pt` | Container with magic header `ZYNTHEOR_QPLUS_PT` |
| **Checkpoint integrity check** | SHA-256 + payload count + tensor manifest + finite-value check | Integrity of this checkpoint is verified; this does not prove full target architecture or model quality |

> **Current evidence (`2026-11-15`).** The primary checkpoint has 231,168 Float32 payload values; its payload SHA-256 is `70058acbacb87fa32778ac7cc4e147065614d0c769de8da842daef7a20c0e5af`. The container metadata's `total_params=33,958,400` is inconsistent with the payload; `trained_subgraph_params=231,168` matches the payload and manifest. The `model_checkpoint_target_41m*.pt` files in this archive are 134-byte descriptors, not a 41,527,808-value tensor checkpoint. Cloud inference remains `BLOCKED` until a compatible checkpoint is fetched and verified by the Native Cloud Runtime.

### Learned parameters vs. architecture

| Question | Answer | Status |
|---|---|---|
| Does the architecture exist as specified? | Described above; reconciliation pending. | `PARTIAL` |
| Are all parameters *trained*? | **Not claimed.** The Model Laboratory's `MemoryShardMap` itself reports `PARTIAL` until full-model training is verified ([§15](#15-recent-capabilities--ui-controls)). | `PARTIAL` |
| Is there a published quality metric (perplexity, benchmark, eval set)? | None in this repository revision. | `PARTIAL` |

A float32 file of the right size says nothing about whether those weights encode learned behaviour. Do not read "33,958,400 parameters" as "33,958,400 trained parameters".

---

## 3. Neural Inference Engine

When configured, the online Cloud Runtime supplies Native model checkpoint bytes; the Node.js/TypeScript server communicates with the Python bridge over standard I/O JSON-RPC. In the inspected archive, required cloud checkpoint configuration was absent, so inference is blocked:

- **Entry point**: `python3 -m qplus_native.bridge`
- **Controller**: `NativeNeuralLMProvider` in `lib/providers.ts`
- **Bridge IPC**: stdio is used between the server and Python process; the model checkpoint itself must come from Cloud Object Storage / the configured Cloud Runtime. Latency is not published.
- **Fail-closed invariant**: checkpoint magic bytes and parameter counts are validated before inference commands are accepted.
- **Memory-grounded context**: entries from `native_data/memory_store.json` are supplied as context. This can reduce unsupported output but **does not eliminate hallucination**; no hallucination-rate measurement is published.

---

## 4. Reasoning & Multi-Step Logic

Responses include a structured **reasoning trace** summarising the pipeline stages:

1. **Input intent & token decomposition** — semantic intent is evaluated and the input is split into subword tokens.
2. **Latent vector-space projection** — token sequences are embedded in the 512-dimensional space.
3. **Memory context & sandbox invariant validation** — `native_data/memory_store.json` is queried and security constraints are evaluated.
4. **Dual-language synthesis** — the answer is generated in the user's selected language.

The trace describes an intended pipeline. It is a rendered summary, not evidence of the model's internal computation. Native Cloud inference is currently `BLOCKED`, so this section describes the target execution architecture rather than a verified live model run.

---

## 5. Learning & Continuous Model Improvement

Native model training and self-improvement are currently `BLOCKED` / `NOT IMPLEMENTED` at the runtime boundary. This source archive does not establish that an autonomous loop can modify model weights or improve model quality.

- `POST /api/model/train` returns `409 BLOCKED` until dataset provenance, explicit human approval, and a tested Native Cloud training runner are connected.
- `POST /api/model/export` returns `409 BLOCKED`; synthetic target-sized tensors are prohibited.
- `POST /api/self-evolve/run` must not be treated as proof of weight updates. Any future training run must record dataset identity, approval evidence, exact checkpoint hashes, optimizer/configuration, training logs, and held-out evaluation results.

---

## 6. Persistent Episodic Memory

First-party memory is managed by `NativeMemoryController` (`src/services/NativeMemoryController.ts`):

- **Persistence**: `native_data/memory_store.json`, kept across restarts.
- **CRUD**: `createMemory(key, value, category, metadata)`, `retrieveMemory(key)`, `updateMemory(key, value, category, metadata)`, `deleteMemory(key)`, `listAll()` / `getStats()`.
- **Audit transaction**: every write, update, or deletion records a SHA-256 digest in `SystemAuditLedger` (`native_data/audit_log.jsonl`).
- **Categories**: `episodic`, `semantic`, `user_preference`, `reasoning_trace`.

**What the hash chain does and does not give you.** A chain of SHA-256 hashes makes *edits to earlier records detectable*. It is not non-repudiation (that needs digital signatures bound to an identity), and anyone with write access to the file can recompute the whole chain unless the tip hash is anchored somewhere they cannot modify.

---

## 7. Real-Time Conversational Intelligence

The conversational interface (`src/components/modules/ConversationalIntelligence.tsx`) is an operational surface for the Native Cloud Runtime:

- **Token streaming** only when the Native Cloud Runtime reports inference readiness.
- **Live telemetry bar**: token count, throughput (tokens/sec), time-to-first-token (TTFT).
- **Persistent sessions** in `native_data/chat_sessions.json`, restored automatically.
- **Code-block highlighting** for JavaScript, TypeScript, Python, and shell, with one-click copy.
- **Session persistence**: session records are stored by the application in `native_data/chat_sessions.json`; persistence and retention depend on the configured deployment storage. No cross-device sync is claimed.

---

## 8. Multilingual Intelligence (Thai & English)

Language is treated as a core model capability rather than an interface translation layer.

### A. Dual-script tokenizer
`qplus_native/tokenizer.py` implements:
- The Thai Unicode block (`U+0E01` to `U+0E5B`): consonants, vowels, tone marks, digits.
- High-frequency Thai syntactic particles, technical terms, and architectural keywords.
- Longest-prefix matching, byte/character fallback, and profile-specific vocabulary expansion.
- The default `v2_base` profile currently reports 532 non-reserved vocabulary entries in the inspected source.

Unknown-token rate and full Thai/English round-trip fidelity are **not VERIFIED** by this review; consult a recorded runtime test result before making a quality claim.

### B. Language integrity test suite
In Governance & Security (`src/components/modules/GovernanceSecurity.tsx`):
- `LANG-01`: Thai pure-script tokenization & detokenization
- `LANG-02`: English technical-script tokenization
- `LANG-03`: Thai–English code-switching & dual vocabulary
- `LANG-04`: Thai complex vowels, tone marks & Unicode orthography
- `LANG-05`: Zero-UNK check across bilingual corpora

### C. Interface localization
A `LanguageSwitcher` in the header toggles the 15-module interface between Thai and English without a page reload.

---

## 9. Vivid Appearance & Multi-Theme Engine

A design-token engine (`src/context/ThemeContext.tsx`) driven by CSS variables in `src/index.css`:

### Supported themes
1. **Light Mode** — Clean · Bright · Vivid (`#F5F7FF` canvas, `#FFFFFF` surface)
2. **Dark Mode** — Midnight · Neon · Deep (`#070913` canvas, `#12182D` cards)
3. **Midnight Navy** — Space Blue & Deep Starlight (`#050711` canvas, `#0F152E` cards)
4. **Vivid Cyan** — Electric Cyan glow (`#040D14` canvas, `#00D9FF` accents)
5. **Royal Purple** — Violet luxury (`#0B0616` canvas, `#A855F7` accents)
6. **System Default** — follows the OS dark/light preference

### Customization & invariants
- **Instant switching** with no page reload; choice stored in `localStorage`.
- **Custom accent picker**: 8 preset colours plus arbitrary hex input.
- **Adjustable intensity**: accent vibrancy from 60% (Subtle) to 140% (Vibrant).
- **Fixed status colours**: safety badges (`VERIFIED` emerald, `BLOCKED` rose) are kept high-contrast across themes.

---

## 10. Autonomous Sandboxing & Execution

Operating-system interaction goes through `lib/ToolGateway.ts` (`PARTIAL`):

- **Confined root**: execution is directed to `/workspace`.
- **Path-traversal defence**: canonical path resolution blocks `../` and symlink escapes.
- **Allow-listed binaries**: `node`, `python3`, `ls`, `cat`.
- **Hard timeout**: 5,000 ms with `SIGKILL`.
- **Runtime tamper probe**: a no-op probe compares environment state against a Genesis SHA-256 digest (`POST /api/sandbox/tamper-verify`).

**Limits to be aware of.** Path checks govern the *arguments the gateway accepts*. `node` and `python3` can themselves open files, spawn processes, and use the network, so path confinement alone is not an isolation boundary. OS-level isolation and resource controls are not established by path checks alone. Before accepting untrusted tasks, use a dedicated unprivileged identity, strict filesystem boundaries, resource quotas, and an allowlist of required Cloud Runtime/service egress destinations.

---

## 11. Performance & Runtime Telemetry

The interface reads telemetry from the running application and reports throughput/latency only when measurements are returned by an actual execution. This source review does not certify any inference rate, time-to-first-token, or model memory benchmark.

To publish a benchmark, record the Cloud Runtime identity, hardware profile, model/checkpoint hash, prompt and output sizes, batch size, warm-up policy, concurrency, duration, and repeated-run statistics. A missing measurement must remain `—`, not be replaced with a sample figure.

---

## 12. Sovereign Identity & Access Security

Managed by `lib/SovereignIdentity.ts` (`PARTIAL`):

- **HMAC-SHA256 token signing** with base64url tokens.
- **Constant-time verification** via `crypto.timingSafeEqual`.
- **Tenant isolation**: namespace boundary checks between tenants.
- **Expiry checks**: `exp` and `iat` are validated. This bounds a stolen token's lifetime; it is not full replay protection, which additionally needs a one-time identifier (`jti`/nonce) store.
- **Security validation**: the source includes security validation routes, but this review did not run a complete live security suite. No overall security certification is claimed.

---

## 13. Evidence-Based Verification Status

Statuses below are limited to the checks actually run against this source archive. A UI label or architecture specification is not evidence that the corresponding runtime capability is ready.

| Area | Status | Evidence / boundary |
|---|---|---|
| **Primary checkpoint integrity** | `VERIFIED` | Container SHA-256, payload SHA-256, Float32 count, manifest sum, and finite-value checks pass for `native_data/model_checkpoint.pt`. |
| **Primary checkpoint active size** | `PARTIAL` | The serialized payload contains 231,168 Float32 values. Legacy `total_params=33,958,400` metadata does not match the payload and is not accepted as the active count. |
| **41.5M target checkpoint artifacts** | `BLOCKED` | Files present in this archive are 134-byte descriptors, not target-sized tensor payloads. The 41,527,808 value is a target architecture specification only. |
| **Native Cloud inference** | `BLOCKED` | The bridge now requires a verified checkpoint fetched through configured Cloud Runtime / Cloud Object Storage. No compatible cloud checkpoint or runtime credentials were present for this verification. |
| **Synthetic checkpoint export** | `BLOCKED` | Target-sized tensor fabrication is disabled; the export path fails closed instead of writing invented weights. |
| **Native training** | `BLOCKED` | Training requires dataset provenance, explicit human approval, and a verified Cloud training runner. The UI and API do not claim training succeeded. |
| **Dataset curation** | `PARTIAL` | Deduplication and heuristic quality scoring are present. New datasets and legacy manifests without approval evidence are presented as `NEEDS_REVIEW`; human approval evidence is not yet implemented end-to-end. |
| **Tokenizer integration** | `PARTIAL` | Restored tokenizer source compiles with the Native Python modules. Full bilingual behavioral regression and Cloud inference were not run in this environment. |
| **Checkpoint integrity regression suite** | `VERIFIED` | `python3 tests/native-parameter-integrity.test.py -v` completed 5/5 tests successfully. |
| **Python source compilation** | `VERIFIED` | `python3 -m py_compile qplus_native/*.py` completed successfully. |
| **Animated SVG assets** | `VERIFIED` | The icon, rainbow neural hero, and banner SVGs parse as XML, include animation, and provide reduced-motion handling. |
| **TypeScript / React build** | `BLOCKED` | Full `tsc` type-check and Vite build could not run because dependencies (including `vite/client`) are absent from this archive environment. |
| **Live Cloud E2E** | `NOT RUN` | No Cloud Runtime endpoint or credentials were supplied to this session; deployment and live connectivity are not claimed. |

**Checkpoint evidence (`2026-11-15`).** Primary container SHA-256: `cb0263040f2e064ab317c1f45654f9ce9842d00a0637a98e36de9dd774e0ab82`. Payload SHA-256: `70058acbacb87fa32778ac7cc4e147065614d0c769de8da842daef7a20c0e5af`. The original memory store SHA-256 remains `b67206bdd28a2f896a403345b7a405845de2dc25a19467486199d2f77d0eed80`. Checkpoint and memory files were preserved and rechecked after the changes.

## 14. Quickstart & Deployment

### Prerequisites
- Node.js 20 or Node.js 22
- Python 3.10+
- npm

### 1. Clone & install
```bash
git clone https://github.com/yutthaphum-phakphian/zyntheor.git
cd zyntheor
npm install
cp .env.example .env
```

Configure `.env` with the designated Cloud Runtime endpoint or Cloud Object Storage settings (`CHECKPOINT_PRESIGNED_URL`, or `S3_BUCKET` plus its credentials, region and endpoint). Do not commit secrets. Without a compatible remote checkpoint and credentials, Native inference remains `BLOCKED`.

### 2. Launch the development server
```bash
npm run dev
```
The development web server starts on `http://localhost:3000`. This is the application development endpoint only; Native model inference still requires the configured online Cloud Runtime.

### 3. Verify the codebase
```bash
npm run lint
npm run build
```

### 4. Check system status
```bash
curl -s http://localhost:3000/api/system/status
```

### 5. Run the dual-script language integrity test
```bash
curl -s -X POST http://localhost:3000/api/verify/language-integrity
```

---

## 15. Recent Capabilities & UI Controls

- **Quick Agent Launch modal**: auto-scrolling execution trace, one-click clipboard copy, and an **Emerald Dark / High Contrast** terminal colour toggle.
- **Governance & Security**: SHA-256 hash-chain validation for historical training epochs and signed JSON audit-trail export (`zyntheor-training-audit-*.json`).
- **Model Laboratory**:
  - `HardwareMonitor`: CPU, process RSS, and heap/tensor-buffer utilization against the memory budget.
  - `TrainingProgress`: cross-entropy loss, optimizer delta, and epoch/shard status.
  - Target architecture and measured active checkpoint are shown separately. The measured payload currently contains 231,168 Float32 values; the 41,527,808 target remains a design specification, not active weights.
  - `GradientNormOverlay`: per-layer gradient-norm inspector for vanishing or exploding gradients.

---

## 16. License

Distributed under the **AGPL-3.0 License**.

---

<p align="center">
  <img src="./public/assets/banner-bottom.svg" alt="ZYNTHEOR rainbow aurora neural banner" width="100%" />
</p>
