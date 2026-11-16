# ZYNTHEOR — Round 2 (gated upgrade), 2026-11-13

## Evidence that drove this round
| Check | Result |
|---|---|
| Target 41.53M vs v2 on the same 400 held-out windows (9 docs) | NLL 1.910 (ppl 6.75, top-1 51.1%) vs v2 1.551 (ppl 4.72, top-1 59.9%) — v2 better |
| NumPy greedy on 41.53M checkpoint | `'ZYNTHEOR is and and and an'` |
| PyTorch (Colab) greedy, same prompt | `'ZYNTHEOR istengrengrensten'` — **parity FAILED** (different weights file or port bug; checkpoint payload SHA in Codespaces = `700ffb67…16ec`, correct) |
| 41.53M token exposure | ≤ 5,000 × 2 × 64 = 640k tokens (~0.015 tokens/param): undertrained, not overfit |

## New
- `qplus_native/train_gated.py`: config-driven trainer. Frozen manifest only; never writes the reference (v2) or `--init`;
  saves a candidate **only if full held-out NLL beats the reference** (and the previous `--out`); honest metadata;
  evidence appended to `artifacts/gated-training-evidence.json`; backups pruned.
- `qplus_native/compare_models.py`: same-window comparison (NLL/token, perplexity, bits-per-byte, top-1).
- Test: `GatePolicy` (equal is not an improvement, margin, previous-best, NaN). Suite: 14/14; v1 integrity 4/4.

## Result: v2.1 (`native_data/model_checkpoint_v2_1.pt`, payload SHA-256 see `artifacts/gated-training-evidence.json`)
Continued from v2's weights, 3,000 steps, lr 1e-3 cosine, weight decay 0.05, batch 16 — written to a NEW file; v2 untouched (`7fb3118f…`).

| Full held-out validation (16 docs, 183,104 positions) | v2 | v2.1 |
|---|---|---|
| NLL/token | 1.5561 | **1.4995** |
| Perplexity | 4.74 | **4.48** |
| Bits per byte | 1.693 | **1.632** |
| Top-1 | 60.5% | **63.2%** |

Gate decision: ACCEPTED (Δ NLL −0.057).

## Limits
- Best state was picked by a 256-window monitor drawn from the same validation documents the gate then scores in full (12 candidate states): a small optimistic bias is possible. There is no untouched third split yet.
- Same corpus (project source/docs). This is not general-language or Thai capability; Thai ppl remains weak, generation is code-shaped and often nonsense.
- The 41.53M checkpoint is a research checkpoint; do not continue it without far more data.
- The Colab/PyTorch port does not match the NumPy graph on the 41.53M checkpoint; treat NumPy as the reference until parity passes.

---
## Round 2b (2026-11-13, later)

**v2.2** (`native_data/model_checkpoint_v2_2.pt`, payload SHA-256 `59d401c5…85ed`): continued from v2.1, 3,000 steps, lr 5e-4, wd 0.05,
`--select last` (final state kept; no selection on validation), gated against v2.1 as reference. Written to a new file; v2 (`7fb3118f…`) and v2.1 untouched.

| Full held-out validation (183,104 positions) | v2 | v2.1 | v2.2 |
|---|---|---|---|
| NLL/token | 1.5561 | 1.4995 | **1.4893** |
| Perplexity | 4.74 | 4.48 | **4.43** |

Diminishing returns (−0.057, then −0.010): on this ~0.6M-token corpus the 0.5M-param model is near its ceiling. More steps will not help; more and better data will.

**`qplus_native/decoding.py`**: `generate()` with multiplicative repetition penalty on a recent window only, hard `no_repeat_ngram`, top-k/top-p, greedy, seed. Replaces the constant-subtraction hack that also penalised prompt tokens.
Distinct-bigram ratio on 5 prompts (v2.2, 60 tokens): greedy 0.88 → 0.91 (ngram 3 + rep 1.15) → 0.94 (nucleus T0.7 p0.9 + ngram 3).
Decoding changes how text is picked, not what the model knows; output is still code-shaped and often nonsense. Tests: 17/17.
`train_gated.py` gained `--select {best,last}`.

## Round 2c — provenance-first ingestion, leakage-safe splits (2026-11-13)

New: `qplus_native/corpus_ingest.py` (manifest v3). Every doc needs a matching rule in `SOURCES.json` with a known
license; secret-like literals, e-mail addresses, short/garbled text and exact duplicates are excluded with a recorded
reason. MinHash near-duplicate clusters are assigned to ONE split together. A TEST split exists; every use goes through
`log_test_access()` into `artifacts/test-split-access.json`.
Wired: `train_gated.py --corpus-root` (test docs are never trained on or gated against; legacy manifests still load),
`compare_models.py --split val|test` (test fails closed on legacy manifests).
Tests: 20 pass (3 new: fail-closed exclusions + no cross-split near-duplicates + determinism, changed-doc skip + access log,
missing SOURCES.json).
Not shown by this round: no model was retrained, no quality number changed. Legacy manifest now reports 1 skipped doc
whose text changed since freeze (project files were edited), so val has 16 docs instead of 17 for fresh runs.
Still missing: a real Thai/English corpus (val/test need >=200k chars, >=50k Thai chars to be measurable) and a BPE tokenizer.

## Round 2d — Gate 2: controlled execution layer (2026-11-13)
New: `qplus_native/safe_exec.py` (Sandbox). Path confinement incl. symlink resolution, secret-name refusal, snapshot-before-write
with rollback, delete only with approval, allowlisted argv (no shell; `python3 -I script` / `-I -m unittest` only),
scrubbed env, timeout + CPU/memory/file-size limits, capped and redacted output, hash-chained audit log with tamper detection.
Tests: 26 pass (6 new SafeExec). Gate 2 status: PASS for the listed checks only.
NOT covered: no OS-level isolation (namespaces/seccomp/network block); a script run by the allowlisted python3 can still open
network sockets or read files outside the workdir by absolute path. Use a container before running untrusted generated code.
Gates 3-12 not started in this tree. The External/AI Studio TypeScript changes (lib/TaskOrchestrator.ts etc.) are unreviewed.

## Round 2e — Gate 3: minimal Orchestrator (2026-11-13)
New: `qplus_native/orchestrator.py`. Executes an explicit plan through Sandbox; delivers only if every acceptance check passes.
Statuses SUCCEEDED / FAILED / BLOCKED / INVALID_PLAN; a plan with no acceptance criteria is invalid; a policy refusal stops later steps;
a timeout or failing process is FAILED; every step is tagged layer A and layer B count is 0.
Acceptance criteria were written before the tests ran. Tests: 31 pass (5 new). Gate 3 status: PASS for the listed behaviours only.
Defect found by the Gate 3 test and fixed: `python3 -I` removes the script directory from sys.path, so a generated multi-file
project could not import its own module (ModuleNotFoundError). Sandbox now runs `-E -s` when `-I` is requested (still ignores
PYTHON* env vars and user site). The test was first written too leniently and accepted failure; it now requires SUCCEEDED.
Not done: the Orchestrator does not create plans (a human/code supplies them), does not repair (Gate 4), and does not use the model (layer B = 0).
Known cosmetic issue: some older tests/corpus code open files without closing them (ResourceWarning only).
