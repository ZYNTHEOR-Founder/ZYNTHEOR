# -*- coding: utf-8 -*-
"""
Gated trainer for NativeLM v2-format checkpoints (replaces the ungated train_target.py flow).

Guarantees
  * Never writes to the reference checkpoint (default: native_data/model_checkpoint_v2.pt) or to --init.
  * Trains and evaluates ONLY on documents from a frozen manifest (id + sha256 must still match), so
    every run, and every model, is compared on the same held-out text.
  * A candidate is saved only if its FULL held-out NLL beats the reference by --margin (and beats the
    previous contents of --out when that file already exists). Otherwise: REJECTED, nothing is written.
  * Honest metadata (real parameter audit, token-exposure upper bound, optimizer state not restored).
  * Evidence is appended to artifacts/gated-training-evidence.json, never overwritten.

Examples
  # continue v2's weights into a NEW file (v2 stays untouched)
  python3 qplus_native/train_gated.py --init native_data/model_checkpoint_v2.pt \
      --out native_data/model_checkpoint_v2_1.pt --steps 3000 --lr 1e-3 --weight-decay 0.05
  # fresh, larger graph, must beat v2 to be saved
  python3 qplus_native/train_gated.py --out native_data/model_checkpoint_big.pt \
      --d-model 256 --layers 4 --heads 8 --ffn 768 --steps 4000
"""
import os
import sys
import json
import time
import math
import shutil
import argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.corpus import build_corpus
from qplus_native.lm_v2 import NativeLM, LMConfig, AdamW, real_vocab_size, V2_CHECKPOINT_PATH, ROOT

DEFAULT_MANIFEST = os.path.join(ROOT, "artifacts", "lm-v2-corpus-manifest.json")
EVIDENCE = os.path.join(ROOT, "artifacts", "gated-training-evidence.json")


def gate_decision(cand_nll: float, ref_nll: float, margin: float, prev_nll=None) -> dict:
    """Pure function so the policy is unit-testable."""
    beats_ref = (cand_nll == cand_nll) and cand_nll < ref_nll - margin
    beats_prev = prev_nll is None or cand_nll < prev_nll
    return {"accepted": bool(beats_ref and beats_prev), "beats_reference": bool(beats_ref),
            "beats_previous_out": bool(beats_prev), "margin": margin}


def load_frozen(manifest_path, corpus_root=None):
    """Works with legacy and v3 manifests. The TEST split (v3) is never returned for training or gating."""
    from qplus_native.corpus_ingest import load_split_docs
    r = load_split_docs(manifest_path, corpus_root)
    return r["manifest"], r["train"], r["val"], r["skipped"]


def windows(streams, T):
    X, Y = [], []
    for s in streams:
        for i in range(0, len(s) - T - 1, T):
            X.append(s[i:i + T]); Y.append(s[i + 1:i + T + 1])
    return np.stack(X), np.stack(Y)


def nll_on(model, X, Y, bs=32):
    tot = 0.0
    for i in range(0, len(X), bs):
        lg, _ = model.forward(X[i:i + bs])
        tot += NativeLM.ce_loss(lg.astype(np.float64), Y[i:i + bs])[0] * len(X[i:i + bs])
    return float(tot / len(X))


def sample_batch(rng, streams, batch, T):
    xs, ys = [], []
    lens = np.array([len(s) - T - 1 for s in streams], dtype=np.float64)
    p = lens / lens.sum()
    for _ in range(batch):
        s = streams[rng.choice(len(streams), p=p)]
        i = int(rng.integers(0, len(s) - T - 1))
        xs.append(s[i:i + T]); ys.append(s[i + 1:i + T + 1])
    return np.stack(xs), np.stack(ys)


def prune_backups(path, keep):
    d, base = os.path.dirname(path), os.path.basename(path)
    olds = sorted(f for f in os.listdir(d) if f.startswith(base + ".backup-"))
    for f in olds[:-keep] if keep > 0 else olds:
        os.remove(os.path.join(d, f))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--ref", default=V2_CHECKPOINT_PATH)
    ap.add_argument("--init", default=None)
    ap.add_argument("--manifest", default=DEFAULT_MANIFEST)
    ap.add_argument("--corpus-root", default=None, help="root of a v3 ingested corpus (defaults to the path in the manifest)")
    ap.add_argument("--d-model", type=int, default=128)
    ap.add_argument("--layers", type=int, default=2)
    ap.add_argument("--heads", type=int, default=4)
    ap.add_argument("--ffn", type=int, default=384)
    ap.add_argument("--ctx", type=int, default=64)
    ap.add_argument("--vocab", type=int, default=0, help="0 = real tokenizer vocabulary")
    ap.add_argument("--steps", type=int, default=1000)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--weight-decay", type=float, default=0.01)
    ap.add_argument("--eval-every", type=int, default=250)
    ap.add_argument("--margin", type=float, default=0.0)
    ap.add_argument("--keep-backups", type=int, default=2)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--select", choices=["best", "last"], default="best",
                    help="best = keep the state with the lowest monitor NLL (mild selection bias); "
                         "last = keep the final state (no selection on validation)")
    a = ap.parse_args()
    if not (1 <= a.steps <= 50000):
        raise SystemExit("--steps must be within [1, 50000]")
    protected = {os.path.abspath(a.ref)} | ({os.path.abspath(a.init)} if a.init else set())
    if os.path.abspath(a.out) in protected:
        raise SystemExit("FAIL_CLOSED: --out must not be the reference or --init checkpoint")

    tok = SovereignTokenizer()
    manifest, train_docs, val_docs, skipped = load_frozen(a.manifest, a.corpus_root)
    tr = [np.array(tok.encode(d["text"]), dtype=np.int64) for d in train_docs]
    va = [np.array(tok.encode(d["text"]), dtype=np.int64) for d in val_docs]

    ref, ref_meta = NativeLM.load(a.ref, tok)
    ref.p = {k: v.astype(np.float32) for k, v in ref.p.items()}
    T_eval = ref.cfg.ctx
    Xv, Yv = windows(va, T_eval)
    ref_nll = nll_on(ref, Xv, Yv)

    init_meta = None
    if a.init:
        model, init_meta = NativeLM.load(a.init, tok)
    else:
        cfg = LMConfig(vocab=a.vocab or real_vocab_size(tok), d_model=a.d_model, n_layers=a.layers,
                       n_heads=a.heads, d_ffn=a.ffn, ctx=a.ctx)
        model = NativeLM(cfg, seed=a.seed)
    cfg = model.cfg
    if cfg.ctx < T_eval:
        raise SystemExit(f"FAIL_CLOSED: candidate ctx {cfg.ctx} < evaluation window {T_eval}")
    if cfg.d_model >= 256:
        model.p = {k: v.astype(np.float32) for k, v in model.p.items()}
    T = cfg.ctx
    trw = [s for s in tr if len(s) > T + 1]
    opt = AdamW(model, lr=a.lr, weight_decay=a.weight_decay)
    rng = np.random.default_rng(a.seed)
    mon = np.linspace(0, len(Xv) - 1, min(256, len(Xv))).astype(int)  # spread over ALL val docs, not the first few
    start_nll = nll_on(model, Xv, Yv) if a.init else float("nan")
    print(json.dumps({"event": "START", "params": model.num_params(), "config": cfg.to_dict(),
                      "train_docs": len(trw), "val_docs": len(va), "val_docs_skipped_changed": skipped,
                      "val_windows": int(len(Xv)), "reference_nll": ref_nll, "init_nll": start_nll}), flush=True)

    best_state, best_mon, history, t0 = {k: v.copy() for k, v in model.p.items()}, float("inf"), [], time.time()
    warm = max(1, min(100, a.steps // 10))
    for step in range(1, a.steps + 1):
        lr = a.lr * min(1.0, step / warm) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * step / a.steps)))
        x, y = sample_batch(rng, trw, a.batch, T)
        lg, cache = model.forward(x, keep_cache=True)
        loss, dl = NativeLM.ce_loss(lg.astype(np.float64), y)
        if not math.isfinite(loss):
            raise SystemExit(f"FAIL_CLOSED: non-finite loss at step {step}")
        gn = opt.step(model, model.backward(dl.astype(lg.dtype), cache), lr=lr)
        if step % a.eval_every == 0 or step == a.steps:
            vm = nll_on(model, Xv[mon], Yv[mon])
            history.append({"step": step, "train_loss": round(float(loss), 4), "val_monitor_nll": round(vm, 4),
                            "grad_norm": round(float(gn), 3), "lr": round(lr, 6), "elapsed_s": round(time.time() - t0)})
            print(json.dumps({"event": "PROGRESS", **history[-1]}), flush=True)
            if vm < best_mon:
                best_mon, best_state = vm, {k: v.copy() for k, v in model.p.items()}
    if a.select == "best":
        model.p = best_state
    cand_nll = nll_on(model, Xv, Yv)  # FULL held-out evaluation for the gate

    prev_nll = None
    if os.path.exists(a.out):
        prev, _ = NativeLM.load(a.out, tok)
        prev.p = {k: v.astype(np.float32) for k, v in prev.p.items()}
        prev_nll = nll_on(prev, Xv, Yv)
    gate = gate_decision(cand_nll, ref_nll, a.margin, prev_nll)
    saved = None
    if gate["accepted"]:
        if os.path.exists(a.out):
            shutil.copy2(a.out, f"{a.out}.backup-{int(time.time())}")
            prune_backups(a.out, a.keep_backups)
        meta = model.save(a.out, tok, extra_meta={
            "training_track": "GATED",
            "validation_loss": cand_nll, "validation_perplexity": math.exp(cand_nll),
            "reference_nll": ref_nll, "reference_checkpoint_sha256": ref_meta["sha256"],
            "init_checkpoint_sha256": (init_meta or {}).get("sha256"),
            "manifest_corpus_sha256": manifest["corpus_sha256"], "val_docs_skipped_changed": skipped,
            "tokens_exposed_upper_bound": a.steps * a.batch * T, "optimizer_state_restored": False,
            "parameter_audit": {"status": "VERIFIED_FULL_GRAPH", "payload_float32_count": model.num_params(),
                                "target_architecture_instantiated": False,
                                "note": "Measured graph; held-out quality is recorded in validation_loss."},
            "hyperparameters": {k: v for k, v in vars(a).items() if k not in ("out", "ref", "init", "manifest", "corpus_root")},
        })
        saved = {"path": a.out, "payload_sha256": meta["sha256"], "total_params": meta["total_params"]}
    run = {"timestamp": int(time.time()), "decision": "ACCEPTED" if gate["accepted"] else "REJECTED",
           "candidate_nll": cand_nll, "reference_nll": ref_nll, "previous_out_nll": prev_nll, "gate": gate,
           "params": model.num_params(), "config": cfg.to_dict(), "history": history, "saved": saved,
           "manifest_corpus_sha256": manifest["corpus_sha256"], "val_windows": int(len(Xv))}
    ev = json.load(open(EVIDENCE)) if os.path.exists(EVIDENCE) else {"runs": []}
    ev["runs"].append(run)
    json.dump(ev, open(EVIDENCE, "w"), indent=2)
    print(json.dumps({"event": run["decision"], "candidate_nll": cand_nll, "reference_nll": ref_nll,
                      "candidate_ppl": math.exp(cand_nll), "reference_ppl": math.exp(ref_nll), "saved": bool(saved)}))


if __name__ == "__main__":
    main()
