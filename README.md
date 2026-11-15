<p align="center">
  <img src="./assets/banner-top.gif" alt="ZYNTHEOR — Vivid Intelligence. Animated banner: a Thai water buffalo walks across a dusk paddy while emerald neural-network pulses travel through its silhouette and amber particles drift upward." width="100%" />
</p>

# ZYNTHEOR — VIVID INTELLIGENCE

<p align="center">
  <b>Intelligence Without Boundaries.</b><br />
  Local-first · Native Transformer core (architecture spec) · No external AI APIs in the intended core path · Evidence-labelled claims
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Architecture-~34M_params_(reported)-8B5CF6?style=flat" alt="Architecture ~34M parameters (reported)" />
  <img src="https://img.shields.io/badge/Training-PARTIAL-F59E0B?style=flat" alt="Training status PARTIAL" />
  <img src="https://img.shields.io/badge/Runtime-Local--first-06B6D4?style=flat" alt="Local-first runtime" />
  <img src="https://img.shields.io/badge/Tokenizer-Thai_%26_English-10B981?style=flat" alt="Thai and English tokenizer" />
  <img src="https://img.shields.io/badge/Audit_Log-SHA--256_hash_chain-F59E0B?style=flat" alt="SHA-256 hash-chained audit log" />
  <img src="https://img.shields.io/badge/External_AI_APIs-none_in_core_path_(PARTIAL)-rose?style=flat" alt="No external AI APIs in core path, status PARTIAL" />
</p>

---

## Overview

**ZYNTHEOR** is a first-party **native intelligence system**. Rather than wrapping a hosted API, it is designed to run its own decoder Transformer locally, with persistent episodic memory, a Thai/English tokenizer, structured reasoning traces, a path-confined tool sandbox, and a SHA-256 hash-chained audit log.

> **Reading this document.** Every capability carries a status. **`VERIFIED`** means a reproducible command *and* its recorded output are attached to this repository. **`PARTIAL`** means the feature is implemented or specified but its evidence is missing, incomplete, or covers only a narrower claim than the one a reader might assume. See [§13](#13-evidence-based-verification-status) and the [claims audit](./docs/CLAIMS_AUDIT.md). Architecture numbers describe the **model's shape**, not the quality of its **learned weights**.

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

ZYNTHEOR avoids thin wrappers, placeholder mocks, and third-party API dependencies in its core reasoning path.

| Principle | Engineering Standard | Status |
|---|---|---|
| **No external AI APIs in the core path** | The core reasoning path is intended to contain no OpenAI, Google Gemini, Anthropic Claude, or other hosted inference endpoints. *Scope: AI inference only — `npm install` and `git clone` still need network access, and a source scan has not been published.* | `PARTIAL` |
| **Native neural core** | Reasoning, code generation, and conversation are intended to originate from the local Transformer via `qplus_native.bridge`. | `PARTIAL` |
| **Fail-closed checkpoint loading** | A missing or corrupted checkpoint should halt execution (`FAIL_CLOSED`) instead of simulating success. | `PARTIAL` |
| **Bilingual script fidelity** | Thai and English text is tokenized with no unknown tokens (`[UNK]`) **on the project's test corpora**. Arbitrary Unicode (emoji, CJK, other scripts) is not covered by that claim. | `PARTIAL` |
| **Tamper-evident accountability** | State transitions, inference checks, and memory mutations are appended to a SHA-256 hash-chained log (`native_data/audit_log.jsonl`). A hash chain is *tamper-evident*, not tamper-proof — see [§6](#6-persistent-episodic-memory). | `PARTIAL` |

---

## 2. Native Model Architecture

ZYNTHEOR specifies a first-party decoder Transformer intended for local execution:

```
                  ┌─────────────────────────────────────┐
                  │    Token Embedding (16,384 Vocab)   │
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
| **Vocabulary size** | `16,384` | Subwords for Thai Unicode + English + technical code |
| **Reported parameter count** | `33,958,400` | From the checkpoint metadata; **see reconciliation note below** |
| **Reported weight size** | `135.8 MB` | 33,958,400 × 4 bytes (Float32); weights only, excluding activations/KV cache |
| **Checkpoint file** | `native_data/model_checkpoint.pt` | Container with magic header `ZYNTHEOR_QPLUS_PT` |
| **Checkpoint integrity check** | SHA-256 at startup | Detects corruption; proves authenticity only if the expected hash is pinned or signed separately |

> **Parameter-count reconciliation (open item, `PARTIAL`).** The earlier 33.7-million label disagreed with the stated 33,958,400 (≈34.0M). Separately, a standard layout at the dimensions above (separate Q/K/V/O projections, 3-matrix SwiGLU, two RMSNorms per block, 16,384×512 embedding) works out to **41,495,040** parameters with a tied output head and **49,883,648** with an untied one. One of the published dimensions, the layout, or the reported count therefore needs correcting. Resolve it by printing the parameter count from the loaded model and updating this table.

### Learned parameters vs. architecture

| Question | Answer | Status |
|---|---|---|
| Does the architecture exist as specified? | Described above; reconciliation pending. | `PARTIAL` |
| Are all parameters *trained*? | **Not claimed.** The Model Laboratory's `MemoryShardMap` itself reports `PARTIAL` until full-model training is verified ([§15](#15-recent-capabilities--ui-controls)). | `PARTIAL` |
| Is there a published quality metric (perplexity, benchmark, eval set)? | None in this repository revision. | `PARTIAL` |

A float32 file of the right size says nothing about whether those weights encode learned behaviour. Do not read "33,958,400 parameters" as "33,958,400 trained parameters".

---

## 3. Neural Inference Engine

The inference engine bridges the Node.js/TypeScript runtime and the native Python tensor model over standard I/O JSON-RPC:

- **Entry point**: `python3 -m qplus_native.bridge`
- **Controller**: `NativeNeuralLMProvider` in `lib/providers.ts`
- **Local IPC**: stdio instead of a network socket (no port exhaustion, no network exposure). Latency is not published.
- **Fail-closed invariant**: checkpoint magic bytes and parameter counts are validated before inference commands are accepted.
- **Memory-grounded context**: entries from `native_data/memory_store.json` are supplied as context. This can reduce unsupported output but **does not eliminate hallucination**; no hallucination-rate measurement is published.

---

## 4. Reasoning & Multi-Step Logic

Responses include a structured **reasoning trace** summarising the pipeline stages:

1. **Input intent & token decomposition** — semantic intent is evaluated and the input is split into subword tokens.
2. **Latent vector-space projection** — token sequences are embedded in the 512-dimensional space.
3. **Memory context & sandbox invariant validation** — `native_data/memory_store.json` is queried and security constraints are evaluated.
4. **Dual-language synthesis** — the answer is generated in the user's selected language.

The trace describes the *pipeline*. It is a rendered summary, not evidence of the model's internal computation, and it should not be treated as a faithful explanation of why a particular answer was produced.

---

## 5. Learning & Continuous Model Evolution

An automated 5-stage self-evolution loop is exposed at `POST /api/self-evolve/run` (`PARTIAL`):

```
 1. LEARN          Harvests runtime performance and error logs from AuditLedger.
      │
      ▼
 2. ANALYZE        Identifies computational bottlenecks and algorithmic variances.
      │
      ▼
 3. SELF-DEVELOP   Proposes internal adjustments and optimized code templates.
      │
      ▼
 4. EVALUATE       Runs automated benchmarks in the isolated sandbox.
      │
      ▼
 5. IMPROVE        Commits adjustments that pass evaluation into persistent memory.
```

- **Scope**: bottleneck analysis, token-validation efficiency, and sandbox-confinement checks.
- **Audit**: each cycle writes an audit record with before/after benchmark scores.
- **Caveat**: before/after scores are only meaningful against a fixed baseline and a held-out evaluation set. Evidence that this loop changes *model weights* and improves *model quality* is not attached.

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

The conversational core (`src/components/modules/ConversationalIntelligence.tsx`) provides an interactive local dialog:

- **Token streaming** from the native Transformer forward pass.
- **Live telemetry bar**: token count, throughput (tokens/sec), time-to-first-token (TTFT).
- **Persistent sessions** in `native_data/chat_sessions.json`, restored automatically.
- **Code-block highlighting** for JavaScript, TypeScript, Python, and shell, with one-click copy.
- **Local storage of conversations**: chat data is written to the host's disk by the application; no cloud upload is intended. Treat as `PARTIAL` until a network-egress test is attached.

---

## 8. Multilingual Intelligence (Thai & English)

Language is treated as a core model capability rather than an interface translation layer.

### A. Dual-script tokenizer
`qplus_native/tokenizer.py` integrates:
- The Thai Unicode block (`U+0E01` to `U+0E5B`): consonants, vowels, tone marks, digits.
- High-frequency Thai syntactic particles, technical terms, and architectural keywords.
- Longest-prefix matching intended to give `[UNK] = 0` **on the tested bilingual corpora**.
- Round-trip `decode(encode(text)) === text` **on the tested strings**.

Characters outside the covered ranges are not guaranteed to round-trip.

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

**Limits to be aware of.** Path checks govern the *arguments the gateway accepts*. `node` and `python3` can themselves open files, spawn processes, and use the network, so path confinement alone is not an isolation boundary. OS-level isolation (container, namespaces, seccomp, or a dedicated unprivileged user with no network) is not documented here and is recommended before running untrusted input.

---

## 11. Performance & Runtime Telemetry

Metrics come from OS and process counters inside the running app. **No benchmark methodology is published with this revision**, so earlier headline figures are retained only as unverified reference points.

| Metric | Measurement method | Previously reported (unverified) | Status |
|---|---|---|---|
| **Inference rate** | Tokens emitted over elapsed time | 38,000 – 45,000 tokens/sec (hardware, batch size, and prompt not stated) | `PARTIAL` |
| **Weight memory** | Float32 weight size | 135.8 MB (weights only; unspecified whether GPU or CPU heap) | `PARTIAL` |
| **Time to first token** | Request-to-stream latency | 12 – 18 ms | `PARTIAL` |
| **Sandbox timeout** | Child-process OS timer | 5,000 ms max | `PARTIAL` |
| **Hash-chain cost** | SHA-256 block calculation | < 1 ms per record | `PARTIAL` |

The Command Center charts timestamped telemetry samples (CPU, RAM, model memory, token throughput). To publish a benchmark, record: CPU/GPU model, OS, Python and Node versions, prompt length, generation length, batch size, warm-up policy, and the number of runs.

---

## 12. Sovereign Identity & Access Security

Managed by `lib/SovereignIdentity.ts` (`PARTIAL`):

- **HMAC-SHA256 token signing** with base64url tokens.
- **Constant-time verification** via `crypto.timingSafeEqual`.
- **Tenant isolation**: namespace boundary checks between tenants.
- **Expiry checks**: `exp` and `iat` are validated. This bounds a stolen token's lifetime; it is not full replay protection, which additionally needs a one-time identifier (`jti`/nonce) store.
- **Automated security suite**: a 6-vector simulation covering signature tampering, token replay, untrusted keys, `alg:none` injection, tenant escalation, and role escalation. Simulated results are not a substitute for an independent security review.

---

## 13. Evidence-Based Verification Status

**Legend** — `VERIFIED`: reproducible command and recorded output attached to the repository. `PARTIAL`: implemented or specified, but evidence is absent, incomplete, or narrower than the headline claim.

This revision of the document was prepared without access to the running project, so no runtime claim below could be re-executed. Statuses were therefore downgraded from the previous revision rather than assumed. Original wording, the reason for each change, and the exact evidence to attach are in [docs/CLAIMS_AUDIT.md](./docs/CLAIMS_AUDIT.md).

| Subsystem | Status | What is claimed | Evidence to attach to reach `VERIFIED` |
|---|---|---|---|
| **Checkpoint (architecture + reported size)** | `PARTIAL` | File loads; reported size 135.8 MB; tensor count reported as 74. Parameter count does not reconcile with the published dimensions. | Printed parameter and tensor counts from the loaded model; reconciled table in §2. |
| **Trained-weight quality** | `PARTIAL` | Not claimed. | Training log, final loss, held-out eval set and score. |
| **Tokenizer** | `PARTIAL` | 16,384 entries; round-trip on tested Thai/English strings. | Test output for `LANG-01…05`; a random-Unicode round-trip fuzz result. |
| **Inference forward pass** | `PARTIAL` | Local forward pass produces tokens without external API calls. | A recorded run with network disabled. |
| **Reasoning trace** | `PARTIAL` | A 4-stage trace is emitted and rendered. | UI capture; note that the trace is descriptive, not a faithfulness guarantee. |
| **Episodic memory controller** | `PARTIAL` | CRUD persists to disk and is logged. | Test run showing create/read/update/delete plus matching ledger entries. |
| **Dual-script integrity** | `PARTIAL` | 5/5 tests, 0 UNK, via `/api/verify/language-integrity`. | Saved JSON response from that endpoint. |
| **Multi-theme engine** | `PARTIAL` | 6 themes, accent picker, no reload. | Screenshots or a UI test per theme. |
| **ToolGateway sandbox** | `PARTIAL` | Path confinement and 5 s timeout. Not an OS-level isolation boundary. | Test showing traversal and symlink attempts blocked and the timeout firing. |
| **Audit ledger hash chain** | `PARTIAL` | Continuous SHA-256 chain from genesis to tip (`chainValid: true`). Tamper-evident only. | Verification output plus a deliberate-tamper test that is detected. |
| **No external AI API calls** | `PARTIAL` | None in the core path. | Dependency/source scan and a packet capture or firewall-denied run. |
| **Air-gapped operation** | `PARTIAL` | Not claimed. Local-first is the accurate description. | A run on a host with no network at all, from install artifacts. |
| **README banners (animated GIF)** | `VERIFIED` | Two animated, looping GIFs referenced by this file. | [docs/BANNER_EVIDENCE.md](./docs/BANNER_EVIDENCE.md), reproducible with `python3 scripts/verify_readme.py`. |

---

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
```

### 2. Launch the development server
```bash
npm run dev
```
The server starts on `http://localhost:3000`.

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
  - `MemoryShardMap`: 12-shard coverage map for the reported 33,958,400 parameters. **Status `PARTIAL` until full-model training is verified.**
  - `GradientNormOverlay`: per-layer gradient-norm inspector for vanishing or exploding gradients.

---

## 16. License

Distributed under the **AGPL-3.0 License**.

---

<p align="center">
  <img src="./assets/banner-bottom.gif" alt="Intelligence Without Boundaries. Animated banner: a Thai water buffalo walks away through reeds at dusk, with emerald neural pulses in its silhouette, amber particles rising, and a scrolling stream of hexadecimal hash fragments along the bottom edge." width="100%" />
</p>
