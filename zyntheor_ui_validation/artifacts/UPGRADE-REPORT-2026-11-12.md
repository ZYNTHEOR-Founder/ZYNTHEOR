# ZYNTHEOR — Native Intelligence Upgrade Report (P0–P4)

Base: `ZYNTHEOR-full-source-parameter-audit-2026-11-12.zip` (SHA-256 `37b458e6…59d4`, verified).
Principle: verify from source → do not tear down working parts → claim only what a test or measurement shows.

## What the source review found (and what was done)

| # | Finding (evidence) | Action |
|---|---|---|
| 1 | **v1 Q/K/V gradients were mathematically wrong.** Finite-difference check: relative error 1.0 (Q), 1.0 (K), 0.40 (V). `MultiHeadAttentionLayer.backward` ignored the sigmoid gate. The old numerical check only covered `lm_head`. | Exact backward implemented; all v1 tensors now match finite differences (test added). |
| 2 | **v1 trainer never loaded the checkpoint.** `bridge.py` created `NativeTrainer()` from fresh init; "continue training" restarted from scratch and `export_checkpoint` could overwrite the trained file with those weights. | `NativeTrainer.load_from_checkpoint()` (fail-closed on hash/count/shape); bridge resumes at start, refuses train/export if resume failed, backs up before export. |
| 3 | **v1 init was not reproducible.** `hash((name,i,1))` is salted per process. | Seeded `random.Random(crc32(name))`; test runs under 3 different `PYTHONHASHSEED`. |
| 4 | **v1 learned nothing on the input side.** Embedding = fixed `sin(hash(token))`; attention over a single token; target = `next_token % 128` (lossy bucket); 128-way head cannot express a 16,384 vocab. | New v2 model (below). v1 left in place. |
| 5 | **v1 checkpoint attention gates are saturated**: 73 of 80 sampled gate pre-activations have \|dot\|>15, so Q/K get zero gradient (14/18 tensors covered). Consequence of finding 1. | Reported only; v1 is superseded by v2. Not retrained. |
| 6 | **Dataset governance.** `VERIFIED_READY` datasets reference the `TenantA Secret …` RBAC-test documents. Only 7 unique items / 2,310 chars exist across 87 dataset items (8 unique texts). | v2 corpus does not use those datasets; uses `curatedForTraining=true` docs + project source/docs; secret-literal files excluded and listed. |
| 7 | `qplus_native/model.py` hard-codes a demo secret string inside a code template. | Reported; file excluded from training by the secret filter. Not changed (template tests depend on it). |
| 8 | **CI never ran Python tests**: `*.test.py` does not match pytest discovery. | `python-ci.yml` now installs numpy and runs both suites explicitly. |

## New: Native LM v2 (`qplus_native/lm_v2.py`)

- Learned token + position embeddings, **tied output head**, 2 pre-norm blocks (4-head **causal** attention, SwiGLU), context 64.
- Head covers the tokenizer's **real vocabulary: 532 ids** (the other 15,852 ids are `<tok_N>` fillers and are never emitted).
- **502,912 parameters**, all serialized as Float32, verified by `CheckpointManager.inspect_checkpoint` → `ACTIVE_TENSORS_VERIFIED`.
  `native_data/model_checkpoint_v2.pt` (payload SHA-256 `b9410f12…c387`). v1 checkpoint untouched (`70058acb…e5af`).
- Fail-closed load: magic, SHA-256, float count, storage mode, tokenizer fingerprint.
- Needs numpy only (`requirements-native.txt`); v1 remains pure Python.

## Evidence

| Check | Result |
|---|---|
| Gradients, every v2 tensor vs finite difference | max relative error ≈ 4e-8 |
| Causality (future tokens cannot change past logits) | pass |
| Python suites | `native-lm-v2` 13/13, `native-parameter-integrity` 4/4 |
| Node suites | identity-trust 20/20, knowledge-intelligence 18/18, security-rbac 22 pass / 0 fail / 1 blocked (no live server) |
| Training (2,500 steps, ~8 min CPU) | held-out val loss 6.23 → 1.56 |
| **Held-out perplexity** (16 whole documents never trained on, 183,104 positions) | **model 4.74** · bigram baseline 18.41 · unigram 57.96 · uniform 532 |
| Next-token accuracy (held-out) | top-1 60.5% · top-5 82.5% |
| Thai target positions (2,180) | model ppl 47.5 vs bigram 143.9 |
| Train/val gap | train ppl ≈ 3.16 vs val 4.74 (mild overfit) |
| Regression guard | LR 0.01 continuation made val loss worse → `REJECTED_REGRESSION`, checkpoint unchanged |

Files: `artifacts/lm-v2-eval.json`, `lm-v2-training-evidence.json`, `lm-v2-corpus-manifest.json` (frozen doc ids + hashes + split).

## Limits — read before relying on any number

- Validation documents are **held-out files from the same codebase**, which is highly repetitive TSX/TS. This measures "predicts this project's code/docs", **not** general language or reasoning.
- Thai is **not learned in any useful sense**: the corpus contains only ~9.4k Thai characters. Real Thai capability needs a real Thai corpus.
- Greedy generation degenerates into whitespace/indent loops; sampled text is code-shaped but often nonsense. This is a **base LM, not instruction-tuned**, not a chat model, and not production-ready.
- The 41,527,808-parameter target is still not built or trained. The role-based `generate()` path (chat/planner/coder/reviewer/tester) still uses templates and is unchanged; the new path is `learned_generate` (bridge) / `POST /api/native/learned-generate` (server), which returns `template_used:false`.
- Not run here: `npm ci`, `tsc --noEmit`, Vite build, browser E2E, live HTTP integration (no network/deps). `server.ts` / `providers.ts` changes passed `node --check` only.
- Audit ledger: the discontinuity at record 313 is **preserved**; test runs that appended to `native_data` were reverted to the original files.

## Next (priority order)

1. Real Thai + English instruction/dialogue corpus with provenance; then supervised fine-tuning on the v2 base (P2 → usable answers).
2. Subword (BPE) tokenizer trained on that corpus; current char/subword list is the main ceiling on Thai.
3. Grow the graph only when held-out perplexity on the new corpus stops improving with more data (P3/P4), using `train_lm.py` + `eval_lm.py` as the gate.
4. P5: connect Knowledge Workspace retrieval to the v2 prompt (kept separate from weight training). P6: install deps, `tsc`, Vite build, live security integration.
