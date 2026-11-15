# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 28 — Continuous Learning Real Weight Trainer (PureSeqLM)

Executes genuine backpropagation + AdamW weight updates ONLY on an isolated
versioned dataset manifest (`train` vs `val` split), evaluates baseline vs
candidate on held-out `val` windows, and persists a candidate checkpoint
ONLY when regression & finiteness gates pass.

Zero Simulation Policy:
  - Never touches active production checkpoint directly.
  - Never mixes production memory into weights without prior dataset curation.
  - Never claims training occurred without real gradient steps & NLL delta.
"""

import hashlib
import json
import math
import os
import random
import sys
import time
from typing import Any, Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.seq_lm import (
    PureAdamW,
    PureSeqLM,
    SeqLMConfig,
    _evaluate_split,
    real_vocab_size,
)
from qplus_native.tokenizer import SovereignTokenizer, train_bpe_merges


def run_versioned_training(req: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()
    train_texts: List[str] = [str(x) for x in (req.get("train_texts") or []) if str(x).strip()]
    val_texts: List[str] = [str(x) for x in (req.get("val_texts") or []) if str(x).strip()]
    steps = max(2, min(int(req.get("steps", 12)), 80))
    lr = float(req.get("lr", 0.012))
    margin = float(req.get("margin", 0.0))
    baseline_path = req.get("baseline_checkpoint_path")
    candidate_out_path = str(req["candidate_checkpoint_path"])

    if not train_texts or not val_texts:
        return {
            "status": "FAILED",
            "reason": "Missing non-empty train_texts or val_texts for versioned Continuous Learning",
        }

    # Build/load tokenizer strictly from training split
    bpe_res = train_bpe_merges([t[:800] for t in train_texts], num_merges=24, min_pair_freq=2)
    tok = SovereignTokenizer(vocab_size=16384, profile="bilingual_bpe", bpe_merges=bpe_res["merges"])
    real_v = real_vocab_size(tok)
    ctx = 12

    def encode_stream(t: str) -> List[int]:
        ids = tok.encode(t[:600])
        return [tid if 0 <= tid < real_v else 3 for tid in ids]

    train_streams = [encode_stream(t) for t in train_texts]
    train_streams = [s for s in train_streams if len(s) >= ctx + 2]
    val_streams = [encode_stream(t) for t in val_texts]
    val_streams = [s for s in val_streams if len(s) >= ctx + 2]

    if not train_streams or not val_streams:
        return {
            "status": "FAILED",
            "reason": f"Insufficient sequence lengths for ctx={ctx} (train_streams={len(train_streams)}, val_streams={len(val_streams)})",
        }

    val_windows: List[Tuple[List[int], List[int]]] = []
    for s in val_streams:
        for i in range(0, min(len(s) - ctx - 1, ctx * 2), ctx):
            val_windows.append((s[i:i + ctx], s[i + 1:i + ctx + 1]))
    val_windows = val_windows[:8]

    resumed_from_sha256 = None
    if baseline_path and os.path.exists(baseline_path):
        try:
            model, base_meta = PureSeqLM.load(baseline_path, tok)
            resumed_from_sha256 = base_meta.get("sha256")
            ctx = model.cfg.ctx
        except Exception:
            cfg = SeqLMConfig(vocab=real_v, d_model=24, n_layers=1, n_heads=4, d_ffn=48, ctx=ctx)
            model = PureSeqLM(cfg, seed=42, tokenizer_profile="bilingual_bpe", bpe_merges=bpe_res["merges"])
    else:
        cfg = SeqLMConfig(vocab=real_v, d_model=24, n_layers=1, n_heads=4, d_ffn=48, ctx=ctx)
        model = PureSeqLM(cfg, seed=42, tokenizer_profile="bilingual_bpe", bpe_merges=bpe_res["merges"])

    baseline_eval = _evaluate_split(model, tok, val_windows, train_streams)
    snapshot_p = {k: list(v) for k, v in model.p.items()}
    opt = PureAdamW(model, lr=lr, weight_decay=0.01)

    rng = random.Random(int(req.get("seed", 2028)))
    train_losses: List[float] = []
    tokens_processed = 0
    for _ in range(steps):
        s = rng.choice(train_streams)
        start = rng.randint(0, len(s) - ctx - 1)
        x = s[start:start + ctx]
        y = s[start + 1:start + ctx + 1]
        logits, cache = model.forward_seq(x, keep_cache=True)
        loss, dlogits = PureSeqLM.ce_loss_seq(logits, y)
        if not math.isfinite(loss):
            model.p = snapshot_p
            return {"status": "FAILED", "reason": "Non-finite training loss encountered"}
        grads = model.backward_seq(dlogits, cache)
        opt.step(model, grads, clip=1.0)
        train_losses.append(loss)
        tokens_processed += ctx

    candidate_eval = _evaluate_split(model, tok, val_windows, train_streams)
    nll_delta = round(candidate_eval["nll"] - baseline_eval["nll"], 6)
    regression_passed = bool(
        math.isfinite(candidate_eval["nll"])
        and candidate_eval["nll"] < baseline_eval["nll"] - margin
    )

    candidate_sha256 = None
    if regression_passed:
        os.makedirs(os.path.dirname(candidate_out_path), exist_ok=True)
        saved_meta = model.save(
            candidate_out_path,
            tok,
            extra_meta={
                "training_track": "BATCH28_CONTINUOUS_LEARNING",
                "dataset_version": req.get("dataset_version"),
                "dataset_sha256": req.get("dataset_sha256"),
                "baseline_sha256": resumed_from_sha256,
                "steps": steps,
                "tokens_processed": tokens_processed,
                "baseline_val_nll": baseline_eval["nll"],
                "candidate_val_nll": candidate_eval["nll"],
            },
        )
        candidate_sha256 = saved_meta["sha256"]
    else:
        # Restore weights in memory; do NOT emit candidate checkpoint on failed regression gate
        model.p = snapshot_p

    return {
        "status": "CANDIDATE_READY" if regression_passed else "REJECTED_REGRESSION_GATE",
        "regression_passed": regression_passed,
        "dataset_version": req.get("dataset_version"),
        "dataset_sha256": req.get("dataset_sha256"),
        "baseline_checkpoint_sha256": resumed_from_sha256,
        "candidate_checkpoint_path": candidate_out_path if regression_passed else None,
        "candidate_checkpoint_sha256": candidate_sha256,
        "total_params": model.num_params(),
        "config": model.cfg.to_dict(),
        "training": {
            "steps": steps,
            "lr": lr,
            "tokens_processed": tokens_processed,
            "train_loss_first": round(train_losses[0], 4) if train_losses else None,
            "train_loss_last": round(train_losses[-1], 4) if train_losses else None,
        },
        "baseline_eval": baseline_eval,
        "candidate_eval": candidate_eval,
        "nll_delta": nll_delta,
        "duration_s": round(time.perf_counter() - t0, 3),
    }


def verify_checkpoint_integrity_file(ckpt_path: str) -> Dict[str, Any]:
    if not os.path.exists(ckpt_path):
        return {"valid": False, "error": f"Checkpoint not found at {ckpt_path}"}
    try:
        m, meta = PureSeqLM.load(ckpt_path, tok=None)
        return {
            "valid": True,
            "sha256": meta.get("sha256"),
            "total_params": m.num_params(),
            "storage_mode": meta.get("storage_mode"),
            "config": meta.get("config"),
        }
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"status": "FAILED", "reason": "Empty JSON payload"}))
        sys.exit(1)
    req = json.loads(raw)
    op = req.get("op", "train")
    if op == "verify_checkpoint":
        out = verify_checkpoint_integrity_file(str(req["checkpoint_path"]))
    else:
        out = run_versioned_training(req)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
