# -*- coding: utf-8 -*-
"""
Train / continue-train ZYNTHEOR Native LM v2 with a regression guard.

  python3 -m qplus_native.train_lm --steps 1500            # fresh or resume (auto)
  python3 -m qplus_native.train_lm --steps 800 --lr 5e-4   # continue with another LR

Regression guard: the candidate is written to native_data/model_checkpoint_v2.pt ONLY if its
validation loss (on whole held-out documents) beats the loss recorded in the current v2
checkpoint. The previous checkpoint is backed up first. A rejected candidate is reported,
never silently saved. Every run appends to artifacts/lm-v2-training-evidence.json.
"""
import os
import sys
import json
import time
import math
import shutil
import argparse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.corpus import build_corpus
from qplus_native.lm_v2 import (NativeLM, LMConfig, AdamW, real_vocab_size, V2_CHECKPOINT_PATH, ROOT)

EVIDENCE_PATH = os.path.join(ROOT, "artifacts", "lm-v2-training-evidence.json")
MANIFEST_PATH = os.path.join(ROOT, "artifacts", "lm-v2-corpus-manifest.json")


def encode_docs(tok, docs):
    return [np.array(tok.encode(d["text"]), dtype=np.int64) for d in docs]


def sample_batch(rng, streams, batch, T):
    xs, ys = [], []
    lens = np.array([max(len(s) - T - 1, 0) for s in streams], dtype=np.float64)
    prob = lens / lens.sum()
    for _ in range(batch):
        s = streams[rng.choice(len(streams), p=prob)]
        i = int(rng.integers(0, len(s) - T - 1))
        xs.append(s[i:i + T])
        ys.append(s[i + 1:i + T + 1])
    return np.stack(xs), np.stack(ys)


def eval_stream_loss(model: NativeLM, streams, T: int, max_windows=None) -> float:
    """Mean next-token cross-entropy over held-out windows (batched)."""
    X, Y = [], []
    for s in streams:
        for i in range(0, len(s) - T - 1, T):
            X.append(s[i:i + T]); Y.append(s[i + 1:i + T + 1])
            if max_windows and len(X) >= max_windows:
                break
        if max_windows and len(X) >= max_windows:
            break
    if not X:
        return float("nan")
    X, Y = np.stack(X), np.stack(Y)
    tot = 0.0
    for i in range(0, len(X), 64):
        lg, _ = model.forward(X[i:i + 64])
        tot += NativeLM.ce_loss(lg, Y[i:i + 64])[0] * len(X[i:i + 64])
    return float(tot / len(X))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=1500)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=float(os.getenv("ZYNTHEOR_LM_LR", "2e-3")))
    ap.add_argument("--weight-decay", type=float, default=float(os.getenv("ZYNTHEOR_LM_WEIGHT_DECAY", "0.01")))
    ap.add_argument("--eval-every", type=int, default=100)
    ap.add_argument("--max-eval-windows", type=int, default=0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=V2_CHECKPOINT_PATH)
    ap.add_argument("--no-save", action="store_true")
    a = ap.parse_args()
    if not (1 <= a.steps <= 20000):
        raise SystemExit("--steps must be within [1, 20000]")

    tok = SovereignTokenizer()
    corpus = build_corpus()
    train_docs = [d for d in corpus["docs"] if d["split"] == "train"]
    val_docs = [d for d in corpus["docs"] if d["split"] == "val"]
    tr, va = encode_docs(tok, train_docs), encode_docs(tok, val_docs)
    cfg = LMConfig(vocab=real_vocab_size(tok))
    T = cfg.ctx
    max_eval_win = a.max_eval_windows if a.max_eval_windows > 0 else None

    resumed, prev_meta = False, None
    if os.path.exists(a.out):
        model, prev_meta = NativeLM.load(a.out, tok)
        resumed = True
    else:
        model = NativeLM(cfg, seed=a.seed)
    opt = AdamW(model, lr=a.lr, weight_decay=a.weight_decay)
    rng = np.random.default_rng(a.seed + (prev_meta or {}).get("training_steps_total", 0))

    base_val = eval_stream_loss(model, va, T, max_windows=max_eval_win)
    print(f"params={model.num_params():,} vocab={cfg.vocab} resumed={resumed} "
          f"train_tokens={sum(len(s) for s in tr):,} val_tokens={sum(len(s) for s in va):,} val_loss_start={base_val:.4f}")
    history, t0 = [], time.time()
    warm = max(1, min(100, a.steps // 10))
    best_val, best_state = base_val, {k: v.copy() for k, v in model.p.items()}
    for step in range(1, a.steps + 1):
        lr = a.lr * min(1.0, step / warm) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * step / a.steps)))
        x, y = sample_batch(rng, tr, a.batch, T)
        lg, cache = model.forward(x, keep_cache=True)
        loss, dl = NativeLM.ce_loss(lg, y)
        if not math.isfinite(loss):
            raise SystemExit(f"FAIL_CLOSED: non-finite loss at step {step}")
        gnorm = opt.step(model, model.backward(dl, cache), lr=lr)
        if step % a.eval_every == 0 or step == a.steps:
            vl = eval_stream_loss(model, va, T, max_windows=max_eval_win)
            history.append({"step": step, "train_loss": round(loss, 4), "val_loss": round(vl, 4), "grad_norm": round(gnorm, 3), "lr": round(lr, 6)})
            print(f"step {step:5d}  train {loss:.4f}  val {vl:.4f}  gnorm {gnorm:.2f}  {time.time()-t0:.0f}s", flush=True)
            if vl < best_val:  # keep the best-by-validation state (early-stopping style)
                best_val, best_state = vl, {k: v.copy() for k, v in model.p.items()}
    model.p = best_state  # restore best-validation weights, not merely the last ones

    prev_val = (prev_meta or {}).get("validation_loss")
    # Compare on the SAME validation documents: the loaded model's loss on today's val split
    # (base_val), not a number recorded against a possibly different split.
    accepted = (not resumed) or (best_val < base_val)
    decision = "ACCEPTED" if accepted else "REJECTED_REGRESSION"
    saved = None
    if accepted and not a.no_save:
        if os.path.exists(a.out):
            shutil.copy2(a.out, a.out.replace(".pt", f".backup-{int(time.time())}.pt"))
        meta = model.save(a.out, tok, extra_meta={
            "validation_loss": best_val,
            "validation_perplexity": math.exp(best_val),
            "training_steps_total": (prev_meta or {}).get("training_steps_total", 0) + a.steps,
            "corpus_sha256": corpus["corpus_sha256"],
            "corpus_summary": corpus["summary"],
            "hyperparameters": {"lr": a.lr, "weight_decay": a.weight_decay, "batch": a.batch, "steps": a.steps, "ctx": T},
        })
        manifest = {"corpus_sha256": corpus["corpus_sha256"], "summary": corpus["summary"], "excluded": corpus["excluded"],
                    "docs": [{k: d[k] for k in ("id", "kind", "sha256", "split", "chars")} for d in corpus["docs"]]}
        json.dump(manifest, open(MANIFEST_PATH, "w"), indent=1)
        saved = {"path": a.out, "payload_sha256": meta["sha256"], "total_params": meta["total_params"]}

    run = {"timestamp": int(time.time()), "resumed": resumed, "decision": decision, "val_loss_start": base_val,
           "val_loss_best": best_val, "previous_val_loss": prev_val, "corpus_sha256": corpus["corpus_sha256"],
           "corpus_summary": corpus["summary"], "history": history, "saved": saved}
    ev = json.load(open(EVIDENCE_PATH)) if os.path.exists(EVIDENCE_PATH) else {"runs": []}
    ev["runs"].append(run)
    os.makedirs(os.path.dirname(EVIDENCE_PATH), exist_ok=True)
    json.dump(ev, open(EVIDENCE_PATH, "w"), indent=2)
    print(f"{decision}: val_loss {base_val:.4f} -> {best_val:.4f}  (ppl {math.exp(best_val):.2f})  saved={bool(saved)}")


if __name__ == "__main__":
    main()
