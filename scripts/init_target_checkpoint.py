#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Create & verify the step-0 ZYNTHEOR NativeLM (41,527,808 params, float32) initialization checkpoint.

Produces a genuine ZYNTHEOR_QPLUS_PT container for `native_data/model_checkpoint_target_41m.pt`
matching `qplus_native.architecture` (vocab=16384, d_model=512, n_layers=10, n_heads=8, d_ffn=1472, ctx=64)
and verifies:
  1. Real NumPy C-extension backend with float32 tensor storage.
  2. Exact parameter count == 41,527,808 across manifest, metadata, and binary payload.
  3. Structural audit & SHA-256 read-back via `scripts/verify_target_checkpoint.py`.
  4. Full round-trip reload via `NativeLM.load(..., dtype=np.float32)` + forward-pass check.

This creates an untrained step-0 initialization checkpoint (`training_steps=0`, `trained=False`);
it never claims training completion or evaluation convergence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.architecture import (  # noqa: E402
    TARGET_CTX,
    TARGET_D_FFN,
    TARGET_D_MODEL,
    TARGET_N_HEADS,
    TARGET_N_LAYERS,
    TARGET_TOTAL_PARAMS,
    TARGET_VOCAB_SIZE,
)
from qplus_native.lm_v2 import LMConfig, NativeLM, tokenizer_fingerprint  # noqa: E402
from qplus_native.tokenizer import SovereignTokenizer  # noqa: E402
from qplus_native.train_target import verify_numpy_backend  # noqa: E402
from scripts.verify_target_checkpoint import verify_target_checkpoint  # noqa: E402

DEFAULT_OUTPUT_PATH = ROOT / "native_data" / "model_checkpoint_target_41m.pt"


def init_target_checkpoint(
    out_path: Path = DEFAULT_OUTPUT_PATH,
    *,
    seed: int = 20261118,
    tokenizer_profile: str = "v2_base",
    force: bool = False,
) -> Dict[str, Any]:
    backend = verify_numpy_backend()
    import numpy as np

    resolved = Path(out_path)
    if not resolved.is_absolute():
        resolved = (ROOT / resolved).resolve()

    if resolved.exists() and not force:
        raise FileExistsError(
            f"FAIL_CLOSED: target initialization checkpoint already exists at {resolved} "
            "(pass --force to overwrite an existing file)"
        )

    cfg = LMConfig(
        vocab=TARGET_VOCAB_SIZE,
        d_model=TARGET_D_MODEL,
        n_layers=TARGET_N_LAYERS,
        n_heads=TARGET_N_HEADS,
        d_ffn=TARGET_D_FFN,
        ctx=TARGET_CTX,
    )
    tok = SovereignTokenizer(cfg.vocab, profile=tokenizer_profile)
    model = NativeLM(cfg, seed=seed, dtype=np.float32, tokenizer_profile=tokenizer_profile)
    param_count = model.num_params()
    if param_count != TARGET_TOTAL_PARAMS:
        raise RuntimeError(
            f"FAIL_CLOSED: initialized parameter count {param_count} != target {TARGET_TOTAL_PARAMS}"
        )

    fp = tokenizer_fingerprint(tok, cfg.vocab)
    extra_meta = {
        "training_track": "FULL_TARGET_41_53M",
        "training_steps": 0,
        "training_steps_total": 0,
        "initialization_only": True,
        "trained": False,
        "init_seed": int(seed),
        "tokenizer_profile": tokenizer_profile,
        "tokenizer_fingerprint": fp,
        "target_total_params": TARGET_TOTAL_PARAMS,
        "target_architecture_instantiated": True,
        "parameter_audit": {
            "status": "VERIFIED_TARGET_41M_INIT",
            "payload_float32_count": TARGET_TOTAL_PARAMS,
            "target_architecture_instantiated": True,
            "trained": False,
            "note": (
                "Step-0 float32 initialization checkpoint for the locked 41,527,808-param "
                "NativeLM architecture prior to 5,800-step governed training."
            ),
        },
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    resolved.parent.mkdir(parents=True, exist_ok=True)
    saved_meta = model.save(str(resolved), tok, extra_meta=extra_meta)

    verification = verify_target_checkpoint(resolved, target_params=TARGET_TOTAL_PARAMS)
    if not verification.get("verified"):
        raise RuntimeError(
            f"FAIL_CLOSED: post-save target verification failed: {verification.get('errors')}"
        )

    # Read back with NativeLM.load + execute finite forward-pass smoke test
    reloaded_model, reloaded_meta = NativeLM.load(str(resolved), tok, dtype=np.float32)
    if reloaded_model.num_params() != TARGET_TOTAL_PARAMS:
        raise RuntimeError(
            f"FAIL_CLOSED: reloaded param count {reloaded_model.num_params()} != {TARGET_TOTAL_PARAMS}"
        )

    sample_ids = tok.encode("ZYNTHEOR Native Intelligence initialization check สวัสดี")[: min(8, cfg.ctx)]
    if not sample_ids:
        sample_ids = [1, 2, 3, 4]
    tokens_arr = np.asarray([sample_ids], dtype=np.int64)
    logits, _ = reloaded_model.forward(tokens_arr, keep_cache=False)
    finite_logits = bool(np.all(np.isfinite(logits)))
    if not finite_logits or logits.shape != (1, len(sample_ids), cfg.vocab):
        raise RuntimeError(
            f"FAIL_CLOSED: reloaded forward-pass check failed (shape={logits.shape}, finite={finite_logits})"
        )

    return {
        "status": "INITIALIZED_VERIFIED",
        "trained": False,
        "initialization_only": True,
        "training_steps": int(reloaded_meta.get("training_steps_total", 0)),
        "checkpoint_path": str(os.path.relpath(resolved, ROOT)) if resolved.is_relative_to(ROOT) else str(resolved),
        "file_bytes": verification["file_bytes"],
        "container_sha256": verification["sha256"],
        "payload_sha256": verification["payload_sha256"],
        "total_params": reloaded_model.num_params(),
        "target_params": TARGET_TOTAL_PARAMS,
        "parameter_count_matches_target": True,
        "tokenizer_profile": reloaded_meta.get("tokenizer_profile"),
        "tokenizer_fingerprint": reloaded_meta.get("tokenizer_fingerprint"),
        "backend": backend,
        "forward_smoke_test": {
            "passed": True,
            "input_shape": list(tokens_arr.shape),
            "logits_shape": list(logits.shape),
            "logits_dtype": str(logits.dtype),
            "all_finite": finite_logits,
        },
        "verification": verification,
    }


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Initialize step-0 41,527,808-param NativeLM float32 checkpoint.")
    ap.add_argument("--out", default=str(DEFAULT_OUTPUT_PATH), help="Output .pt checkpoint path")
    ap.add_argument("--seed", type=int, default=20261118)
    ap.add_argument("--tokenizer-profile", default="v2_base", choices=["v2_base", "bilingual_v4"])
    ap.add_argument("--force", action="store_true", help="Overwrite if target initialization file already exists")
    args = ap.parse_args(argv)
    report = init_target_checkpoint(
        Path(args.out),
        seed=args.seed,
        tokenizer_profile=args.tokenizer_profile,
        force=args.force,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
