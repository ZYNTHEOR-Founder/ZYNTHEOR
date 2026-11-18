# -*- coding: utf-8 -*-
"""Full-target training runner for the reconciled 41,527,808-parameter graph.

This runner never overwrites the active 231,168-parameter checkpoint. It trains a
separate target checkpoint and writes it only when validation improves. The graph
uses the canonical target configuration from qplus_native.architecture.
"""
import argparse
import json
import math
import os
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np

from qplus_native.architecture import (
    TARGET_TOTAL_PARAMS, TARGET_VOCAB_SIZE, TARGET_D_MODEL, TARGET_N_LAYERS,
    TARGET_N_HEADS, TARGET_D_FFN, TARGET_CTX,
)
from qplus_native.corpus import build_corpus
from qplus_native.lm_v2 import AdamW, NativeLM, LMConfig
from qplus_native.tokenizer import SovereignTokenizer

TARGET_CHECKPOINT = ROOT / "native_data" / "model_checkpoint_target_41m.pt"
EVIDENCE_PATH = ROOT / "artifacts" / "target-training-evidence.json"


def encode_docs(tok, docs):
    return [np.asarray(tok.encode(d["text"]), dtype=np.int64) for d in docs]


def sample_batch(rng, streams, batch, ctx):
    valid = [s for s in streams if len(s) > ctx + 1]
    lengths = np.asarray([len(s) - ctx - 1 for s in valid], dtype=np.float64)
    probs = lengths / lengths.sum()
    xs, ys = [], []
    for _ in range(batch):
        s = valid[int(rng.choice(len(valid), p=probs))]
        i = int(rng.integers(0, len(s) - ctx - 1))
        xs.append(s[i:i + ctx])
        ys.append(s[i + 1:i + ctx + 1])
    return np.stack(xs), np.stack(ys)


def eval_loss(model, streams, ctx, max_windows=128):
    windows = []
    for s in streams:
        for i in range(0, len(s) - ctx - 1, ctx):
            windows.append((s[i:i + ctx], s[i + 1:i + ctx + 1]))
            if len(windows) >= max_windows:
                break
        if len(windows) >= max_windows:
            break
    if not windows:
        return float("nan")
    total = 0.0
    for i in range(0, len(windows), 2):
        x = np.stack([w[0] for w in windows[i:i + 2]])
        y = np.stack([w[1] for w in windows[i:i + 2]])
        logits, _ = model.forward(x)
        total += NativeLM.ce_loss(logits, y)[0] * len(x)
    return float(total / len(windows))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=2000)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--weight-decay", type=float, default=0.01)
    ap.add_argument("--eval-every", type=int, default=25)
    ap.add_argument("--save-every", type=int, default=100)
    ap.add_argument("--max-val-windows", type=int, default=128)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--out", default=str(TARGET_CHECKPOINT))
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()
    if args.steps < 1 or args.steps > 20000:
        raise SystemExit("--steps must be within [1, 20000]")
    if args.save_every < 1:
        raise SystemExit("--save-every must be at least 1")

    tok = SovereignTokenizer(TARGET_VOCAB_SIZE)
    corpus = build_corpus()
    train_docs = [d for d in corpus["docs"] if d["split"] == "train"]
    val_docs = [d for d in corpus["docs"] if d["split"] == "val"]
    train_streams, val_streams = encode_docs(tok, train_docs), encode_docs(tok, val_docs)
    cfg = LMConfig(vocab=TARGET_VOCAB_SIZE, d_model=TARGET_D_MODEL,
                   n_layers=TARGET_N_LAYERS, n_heads=TARGET_N_HEADS,
                   d_ffn=TARGET_D_FFN, ctx=TARGET_CTX)
    previous_meta = {}
    if args.resume and Path(args.out).exists():
        model, previous_meta = NativeLM.load(args.out, tok)
        model.p = {k: v.astype(np.float32, copy=False) for k, v in model.p.items()}
    else:
        model = NativeLM(cfg, seed=args.seed, dtype=np.float32)
    if model.num_params() != TARGET_TOTAL_PARAMS:
        raise SystemExit(f"FAIL_CLOSED: target graph count {model.num_params()} != {TARGET_TOTAL_PARAMS}")
    opt = AdamW(model, lr=args.lr, weight_decay=args.weight_decay)
    rng = np.random.default_rng(args.seed)
    base_val = eval_loss(model, val_streams, cfg.ctx, args.max_val_windows)
    print(json.dumps({"event": "TARGET_TRAINING_STARTED", "params": model.num_params(),
                      "config": cfg.to_dict(), "train_tokens": sum(map(len, train_streams)),
                      "val_tokens": sum(map(len, val_streams)), "val_loss_start": base_val}, ensure_ascii=False), flush=True)

    best_val = base_val
    best_state = {k: v.copy() for k, v in model.p.items()}
    history = []
    started = time.time()
    warmup = max(1, min(100, args.steps // 10))
    for step in range(1, args.steps + 1):
        lr = args.lr * min(1.0, step / warmup) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * step / args.steps)))
        x, y = sample_batch(rng, train_streams, args.batch, cfg.ctx)
        logits, cache = model.forward(x, keep_cache=True)
        loss, dlogits = NativeLM.ce_loss(logits, y)
        if not math.isfinite(loss):
            raise SystemExit(f"FAIL_CLOSED: non-finite loss at step {step}")
        grad_norm = opt.step(model, model.backward(dlogits, cache), lr=lr)
        if step % args.eval_every == 0 or step == args.steps:
            val = eval_loss(model, val_streams, cfg.ctx, args.max_val_windows)
            rec = {"step": step, "train_loss": float(loss), "val_loss": float(val),
                   "grad_norm": float(grad_norm), "lr": float(lr), "elapsed_s": time.time() - started}
            history.append(rec)
            print(json.dumps({"event": "TARGET_TRAINING_PROGRESS", **rec}), flush=True)
            if val < best_val:
                best_val = val
                best_state = {k: v.copy() for k, v in model.p.items()}
        if step % args.save_every == 0:
            model.save(args.out, tok, extra_meta={
                "training_track": "FULL_TARGET_41_53M",
                "target_total_params": TARGET_TOTAL_PARAMS,
                "target_architecture_instantiated": True,
                "training_steps": int(previous_meta.get("training_steps", 0)) + step,
                "resumed_from_steps": int(previous_meta.get("training_steps", 0)),
                "corpus_sha256": corpus["corpus_sha256"],
                "corpus_summary": corpus["summary"],
                "hyperparameters": vars(args),
            })

    model.p = best_state
    out = Path(args.out)
    if out.exists():
        shutil.copy2(out, out.with_suffix(out.suffix + f".backup-{int(time.time())}"))
    total_steps = int(previous_meta.get("training_steps", 0)) + args.steps
    meta = model.save(str(out), tok, extra_meta={
        "training_track": "FULL_TARGET_41_53M",
        "target_total_params": TARGET_TOTAL_PARAMS,
        "target_architecture_instantiated": True,
        "validation_loss": best_val,
        "validation_perplexity": math.exp(best_val),
        "training_steps": total_steps,
        "resumed_from_steps": int(previous_meta.get("training_steps", 0)),
        "corpus_sha256": corpus["corpus_sha256"],
        "corpus_summary": corpus["summary"],
        "hyperparameters": vars(args),
    })
    evidence = {"timestamp": int(time.time()), "checkpoint": str(out),
                "params": model.num_params(), "target_params": TARGET_TOTAL_PARAMS,
                "best_val_loss": best_val, "history": history,
                "corpus_sha256": corpus["corpus_sha256"], "checkpoint_sha256": meta["sha256"]}
    EVIDENCE_PATH.write_text(json.dumps(evidence, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"event": "TARGET_TRAINING_COMPLETE", **evidence}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
