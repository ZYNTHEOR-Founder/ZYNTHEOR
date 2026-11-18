# -*- coding: utf-8 -*-
"""
Train Native LM with an **execution-first** corpus (not chatbot dialogue).

  cd /path/to/project && python3 -m qplus_native.train_execution --steps 200

Objective: next-token loss on goals, plans, source, repair traces, delivery gates.
Explicitly NOT chat greetings / roleplay pairs.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np  # type: ignore[no-redef]

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.execution_corpus import build_execution_corpus
from qplus_native.lm_v2 import NativeLM, LMConfig, AdamW, real_vocab_size, ROOT
from qplus_native.loss_mask import IGNORE_INDEX

EVIDENCE_PATH = os.path.join(ROOT, "artifacts", "execution-training-evidence.json")
MANIFEST_PATH = os.path.join(ROOT, "artifacts", "execution-corpus-manifest.json")
OUT_CKPT = os.path.join(ROOT, "native_data", "model_checkpoint_execution.pt")


def encode_docs(tok, docs):
    streams = []
    for d in docs:
        ids = tok.encode(d["text"])
        if len(ids) >= 2:
            streams.append(ids)
    return streams


def sample_batch(rng, streams, batch, T):
    X, Y = [], []
    for _ in range(batch):
        s = streams[int(rng.integers(0, len(streams)))]
        if len(s) <= T:
            ctx = (s[:-1] + [0] * T)[:T]
            tgt = (s[1:] + [IGNORE_INDEX] * T)[:T]
        else:
            i = int(rng.integers(0, len(s) - T))
            ctx = s[i : i + T]
            tgt = s[i + 1 : i + T + 1]
        X.append(ctx)
        Y.append(tgt)
    return np.array(X, dtype=np.int64), np.array(Y, dtype=np.int64)


def eval_stream_loss(model: NativeLM, streams, T: int, max_windows=48) -> float:
    if not streams:
        return float("inf")
    losses, n = [], 0
    for s in streams:
        if len(s) < 2:
            continue
        if len(s) <= T:
            ctx = np.array([(s[:-1] + [0] * T)[:T]], dtype=np.int64)
            tgt = np.array([(s[1:] + [IGNORE_INDEX] * T)[:T]], dtype=np.int64)
            lg, _ = model.forward(ctx, keep_cache=False)
            loss, _ = NativeLM.ce_loss(lg, tgt, ignore_index=IGNORE_INDEX)
            losses.append(float(loss))
            n += 1
        else:
            for i in range(0, min(len(s) - T, max_windows * T), T):
                ctx = np.array([s[i : i + T]], dtype=np.int64)
                tgt = np.array([s[i + 1 : i + T + 1]], dtype=np.int64)
                lg, _ = model.forward(ctx, keep_cache=False)
                loss, _ = NativeLM.ce_loss(lg, tgt, ignore_index=IGNORE_INDEX)
                losses.append(float(loss))
                n += 1
                if n >= max_windows:
                    break
        if n >= max_windows:
            break
    return float(sum(losses) / max(len(losses), 1))


def main():
    ap = argparse.ArgumentParser(description="Execution-first training (not chatbot)")
    ap.add_argument("--steps", type=int, default=150)
    ap.add_argument("--lr", type=float, default=8e-4)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--ctx", type=int, default=64)
    ap.add_argument("--weight_decay", type=float, default=0.01)
    ap.add_argument("--eval_every", type=int, default=50)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--d_model", type=int, default=128)
    ap.add_argument("--n_layers", type=int, default=2)
    ap.add_argument("--n_heads", type=int, default=4)
    ap.add_argument("--d_ffn", type=int, default=384)
    a = ap.parse_args()
    if not (1 <= a.steps <= 5000):
        raise SystemExit("--steps must be within [1, 5000]")

    os.makedirs(os.path.join(ROOT, "artifacts"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "native_data"), exist_ok=True)

    print("[execution-train] objective=execution_not_chatbot")
    corpus = build_execution_corpus()
    train_docs = [d for d in corpus["docs"] if d["split"] == "train"]
    val_docs = [d for d in corpus["docs"] if d["split"] == "val"]
    print("[execution-train] corpus:", json.dumps(corpus["summary"], ensure_ascii=False))

    tok = SovereignTokenizer()
    vocab = real_vocab_size(tok)
    cfg = LMConfig(
        vocab=vocab,
        d_model=a.d_model,
        n_layers=a.n_layers,
        n_heads=a.n_heads,
        d_ffn=a.d_ffn,
        ctx=a.ctx,
    )
    model = NativeLM(cfg, seed=a.seed)
    resumed = False
    prev_meta = None
    if os.path.exists(OUT_CKPT):
        try:
            model, prev_meta = NativeLM.load(OUT_CKPT, tok)
            resumed = True
            print(f"[execution-train] resumed from {OUT_CKPT}")
        except Exception as e:
            print(f"[execution-train] resume skipped: {e}")
            model = NativeLM(cfg, seed=a.seed)
    print(f"[execution-train] params={model.num_params():,} vocab={vocab} ctx={a.ctx} resumed={resumed}")

    tr = encode_docs(tok, train_docs)
    va = encode_docs(tok, val_docs) or tr
    if not tr:
        raise SystemExit("No train streams")

    opt = AdamW(model, lr=a.lr, weight_decay=a.weight_decay)
    seed_off = int((prev_meta or {}).get("timestamp", 0)) % 10000
    rng = np.random.default_rng(a.seed + seed_off)
    T = a.ctx
    history = []
    base_val = eval_stream_loss(model, va, T)
    best_val, best_state = base_val, {k: v.copy() for k, v in model.p.items()}
    print(f"[execution-train] val_loss_start={base_val:.4f}")

    warm = max(1, min(40, a.steps // 10))
    t0 = time.time()
    for step in range(1, a.steps + 1):
        lr = a.lr * min(1.0, step / warm) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * step / a.steps)))
        x, y = sample_batch(rng, tr, a.batch, T)
        lg, cache = model.forward(x, keep_cache=True)
        loss, dl = NativeLM.ce_loss(lg, y)
        if not math.isfinite(loss):
            raise SystemExit(f"FAIL_CLOSED: non-finite loss at step {step}")
        gnorm = opt.step(model, model.backward(dl, cache), lr=lr)
        if step % a.eval_every == 0 or step == a.steps:
            vl = eval_stream_loss(model, va, T)
            history.append({
                "step": step,
                "train_loss": round(float(loss), 4),
                "val_loss": round(float(vl), 4),
                "grad_norm": round(float(gnorm), 3),
                "lr": round(lr, 6),
            })
            print(f"  step {step:4d}  train {loss:.4f}  val {vl:.4f}  gnorm {gnorm:.2f}  {time.time()-t0:.0f}s", flush=True)
            if vl < best_val:
                best_val, best_state = vl, {k: v.copy() for k, v in model.p.items()}

    model.p = best_state
    meta = model.save(OUT_CKPT, tok, extra_meta={
        "training_objective": "execution_not_chatbot",
        "validation_loss": best_val,
        "validation_perplexity": math.exp(min(best_val, 20)),
        "corpus_sha256": corpus["corpus_sha256"],
        "corpus_summary": corpus["summary"],
        "hyperparameters": {
            "lr": a.lr, "weight_decay": a.weight_decay, "batch": a.batch,
            "steps": a.steps, "ctx": T, "d_model": a.d_model, "n_layers": a.n_layers,
        },
    })

    manifest = {
        "corpus_sha256": corpus["corpus_sha256"],
        "summary": corpus["summary"],
        "excluded": corpus["excluded"],
        "docs": [{k: d[k] for k in ("id", "kind", "sha256", "split", "chars")} for d in corpus["docs"]],
        "objective": "execution_not_chatbot",
    }
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    evidence = {
        "timestamp": int(time.time()),
        "objective": "execution_not_chatbot",
        "resumed": resumed,
        "steps": a.steps,
        "elapsed_s": round(time.time() - t0, 2),
        "val_loss_start": base_val,
        "val_loss_best": best_val,
        "params": model.num_params(),
        "corpus_sha256": corpus["corpus_sha256"],
        "corpus_summary": corpus["summary"],
        "history": history,
        "checkpoint_path": OUT_CKPT,
        "checkpoint_sha256": meta.get("sha256"),
        "saved": True,
        "note": "Next-token training on execution traces/source only — not chatbot dialogue.",
    }
    runs = []
    if os.path.exists(EVIDENCE_PATH):
        try:
            runs = json.load(open(EVIDENCE_PATH)).get("runs", [])
        except Exception:
            runs = []
    runs.append(evidence)
    with open(EVIDENCE_PATH, "w", encoding="utf-8") as f:
        json.dump({"runs": runs}, f, indent=2, ensure_ascii=False)

    print(json.dumps({k: evidence[k] for k in evidence if k != "history"}, indent=2, ensure_ascii=False))
    print("[execution-train] evidence ->", EVIDENCE_PATH)


if __name__ == "__main__":
    main()
