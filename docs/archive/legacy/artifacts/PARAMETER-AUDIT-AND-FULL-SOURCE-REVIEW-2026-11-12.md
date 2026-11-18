# ZYNTHEOR — Full Source Review & Native Parameter Alignment

Date: 2026-11-12  
Scope: continuation source tree, Native Python model/training/checkpoint path, Node API contract, UI parameter surfaces, security/knowledge regression scripts.

## Executive result

The checkpoint metadata previously declared **41,527,808 parameters**, but its serialized payload contained only **231,168 Float32 values (924,672 bytes)**. The active model/trainer graph is a 128-dimensional, 1-block, 4-head Transformer subgraph with a 384-dimensional SwiGLU FFN and a 128-token LM-head output bucket. The 41,527,808-parameter / 512-dimensional / 10-block design remains a target specification and is not instantiated by this checkpoint.

The active checkpoint metadata and runtime configuration now report the measured active graph. The original payload bytes and SHA-256 remain unchanged; the previous checkpoint file is retained as `native_data/model_checkpoint.pre-parameter-audit-20261112.pt`.

## Changes applied

1. `qplus_native/model.py`
   - Runtime config now reports the measured active graph: 231,168 parameters, d_model=128, d_ffn=384, one block, four heads, d_head=32, tokenizer vocabulary 16,384, active LM-head bucket 128.
   - Target architecture values are kept in separate `target_*` fields.
   - Checkpoint load fails closed on metadata/payload count mismatch, non-Float32-aligned payload, and incomplete parameter mapping.
   - Runtime descriptions no longer claim the target-sized model is already loaded.
2. `qplus_native/trainer.py`
   - Default AdamW learning rate reduced from 0.005 to 0.0003 after the recorded continuation evidence showed loss regression in a later training round.
   - `ZYNTHEOR_TRAINING_LR` and `ZYNTHEOR_WEIGHT_DECAY` are configurable with bounds validation.
   - Epoch count is constrained to 1–10 and training text must be non-empty.
   - Checkpoint metadata records actual trained parameter count and separately records target size.
3. `qplus_native/bridge.py`
   - Checkpoint export now serializes the actual `NativeTrainer` parameters; it no longer routes through the synthetic target-sized tensor exporter.
4. `qplus_native/checkpoint.py` and `qplus_native/init_weights.py`
   - Inspection verifies payload SHA-256, Float32 count, and manifest count.
   - The old exporter and initializer that could create synthetic/hash-descriptor or zero-padded target tensors are disabled.
5. `native_data/model_checkpoint.pt`
   - Metadata aligned to the existing payload; payload bytes/hash preserved.
   - Previous file preserved as `native_data/model_checkpoint.pre-parameter-audit-20261112.pt`.
6. `server.ts` and UI
   - Native inference API reports active parameter count, not target parameter count.
   - Intelligence Core test now calls the real Native inference endpoint instead of displaying fabricated latency/throughput/latent metrics.
   - Model Laboratory reads parameter counts and tensor manifest from checkpoint inspection; removed fake 41.53M / 135.8MB fallback values.
   - High-visibility architecture and telemetry surfaces were updated to distinguish active graph from target roadmap; unmeasured throughput defaults were removed.
7. Added `tests/native-parameter-integrity.test.py` with four regression tests.
8. `.env.example` documents validated training hyperparameters.

## Validation evidence

- Python compileall: PASS.
- Native parameter integrity: 4/4 PASS.
- Identity & Trust: 20/20 PASS.
- Knowledge Intelligence: 18/18 PASS.
- Security RBAC static audit: 22 PASS, 0 FAIL, 1 BLOCKED (live server unavailable).
- Product Integrity: 15 assertions PASS.
- TypeScript/TSX syntax transpilation: 62 source files, 0 syntax errors.
- Native training smoke check (temporary in-memory trainer): loss 4.3610 → 3.0703 over 2 epochs; parameter mutation delta 0.006613; LR 0.0003.
- Temporary checkpoint export smoke check: 231,168 parameters / 18 tensors; read-back inspection `ACTIVE_TENSORS_VERIFIED`; SHA-256 matched. Temporary export was deleted after test; production checkpoint was not overwritten by this smoke test.
- Existing checkpoint payload SHA-256 remains `70058acbacb87fa32778ac7cc4e147065614d0c769de8da842daef7a20c0e5af`.
- ZIP integrity checked after packaging.

## Blocked / not claimed

- `npm ci --ignore-scripts --no-audit --no-fund` timed out twice. No partial `node_modules` tree was retained.
- Full `tsc --noEmit` blocked because dependency type declarations (`vite/client`) are unavailable. Vite production build and browser E2E therefore remain unverified.
- Live HTTP security integration remains blocked because the app server was not running in this environment.
- `tests/sovereignty.test.ts` could not execute under the current Node strip-types invocation because its extensionless TypeScript import (`lib/AuditLedger`) is not resolved by that runner. Its parameter assertions were updated, but this test itself is not counted as passed.
- The model's response path still contains deterministic/template-based response synthesis and does not yet decode user-facing language directly from learned logits. The 231,168 active parameters are real serialized trained-subgraph values, but this is not evidence of a complete general-purpose Native LLM.
- The 41,527,808-parameter target architecture has not been built or trained. No model capability, production readiness, benchmark score, cloud scaling, or commercial billing completion is claimed.
- Rate limiting remains process-local in this code line; a shared distributed store is required before multi-instance production deployment.

## Operational recommendation

Treat the checkpoint as `ACTIVE_SUBGRAPH / PARTIAL`, not a complete target model. Continue model work by expanding the actual graph, vocabulary projection, tokenizer-to-logit alignment, and learned-logit decoding; train and evaluate against curated held-out Thai/English corpora; only then promote checkpoint metadata and UI readiness from evidence. Keep RAG/Knowledge Workspace separate from model-weight training.
