# ZYNTHEOR Native LM v2 — Training Report (2026-11-15)

## Result

- Status: **CANDIDATE TRAINED / NOT PROMOTED TO ACTIVE RUNTIME**
- Training track: `ZYNTHEOR-NativeLM-v2-TiedEmbedding-CausalAttention`
- Completed optimizer steps in this candidate: **1,800** (six accepted 300-step runs)
- Measured parameter count: **502,912** (`float32` payload)
- Tokenizer vocabulary: **532**
- Architecture: `d_model=128`, `n_layers=2`, `n_heads=4`, `d_ffn=384`, `ctx=64`
- Candidate checkpoint: `native_data/model_checkpoint_v2_candidate.pt`
- Candidate file size: **2,017,657 bytes**
- Whole-file SHA-256: `cccbf386c5861a00633cc08612d330b063c568e9dadb7189ba429878b44c810c`
- Checkpoint payload SHA-256 (checkpoint metadata): `ca5cf806431d18dde2394328676f1f77207cba35379cc2a47b3f74b79d30652a`
- Corpus SHA-256: `c3a71c0356a5631b0754a9edbc566a4a93e0ff48dd4e54562b0e88832047313d`

## Corpus governance and split

The active corpus builder produced 221 unique documents: 176 train documents and 45 validation documents. Training corpus size was 2,644,617 characters; validation corpus size was 569,676 characters. It recorded 14,821 Thai-script characters across the corpus. Seventeen inputs were excluded, including secret-like literals, uncurated Knowledge Workspace uploads, duplicates, and contaminated test material. Split is document-level to prevent window leakage. The manifest and corpus hash are stored in `artifacts/lm-v2-corpus-manifest.json` and the run ledger in `artifacts/lm-v2-training-evidence.json`.

This is a repository-derived project corpus, not a broad general-language corpus. No separate third-party license audit was performed for every source file; do not treat this report as blanket rights clearance for external redistribution or commercial model release.

## Measured training progression

| Run | Steps | Validation loss before | Best sampled validation loss | Decision |
|---|---:|---:|---:|---|
| 1 | 300 | 6.2823 | 3.3674 | ACCEPTED |
| 2 | 300 | 3.3674 | 3.2877 | ACCEPTED |
| 3 | 300 | 3.2877 | 3.2092 | ACCEPTED |
| 4 | 300 | 3.2092 | 3.1892 | ACCEPTED |
| 5 | 300 | 3.1892 | 3.1790 | ACCEPTED |
| 6 | 300 | 3.1790 | 3.1719 | ACCEPTED |

Final sampled validation perplexity: **23.85**. Each run evaluated a fixed maximum of 128 validation windows; this is a sampled validation metric, not a full-corpus evaluation or an independent test-set score. There is no clean held-out test split in this corpus yet.

## Verification

- Candidate loaded successfully through `NativeLM.load`.
- Parameter count verified as 502,912.
- Forward pass returned logits with shape `(1, 1, 532)`.
- Checkpoint integrity and tokenizer compatibility tests: 5/5 PASS.
- Native LM math/causality/gradient tests: 3/3 PASS.
- Generation smoke test ran, but generated text quality was poor/noisy; this candidate is **not production-ready**.
- Existing active checkpoint SHA-256 remained `cb0263040f2e064ab317c1f45654f9ce9842d00a0637a98e36de9dd774e0ab82`.
- `native_data/memory_store.json` SHA-256 remained `b67206bdd28a2f896a403345b7a405845de2dc25a19467486199d2f77d0eed80`.

## Important boundaries

- This candidate is 502,912 parameters, **not** the 41,527,808-parameter target architecture.
- The 41.5M checkpoint files in this checkout are Git LFS pointer files, not the model payload; the actual 166,133,204-byte checkpoint object is unavailable in this workspace.
- The active runtime checkpoint was not replaced, and the candidate was not promoted to production inference.
- Training loss/validation loss improvements do not establish useful Thai/English reasoning, instruction following, or autonomous engineering ability.
- A separate clean test set, broader rights/provenance review, stronger Thai/English corpus balance, and end-to-end runtime integration remain required.
