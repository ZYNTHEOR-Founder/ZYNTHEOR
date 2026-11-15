# -*- coding: utf-8 -*-
"""
Batch 4 Real Training Pipeline for ZYNTHEOR Native Thai Intelligence (bilingual_v4).

Key guarantees:
  1. Preserves native_data/model_checkpoint_v2.pt and native_data/model_checkpoint.pt untouched.
  2. Warm-starts from model_checkpoint_v2.pt into an expanded bilingual_v4 vocabulary
     (initializing new Thai/instruction subwords from the mean of their base-tokenizer embeddings).
  3. Trains only on crc32-isolated `train` documents using balanced bilingual sampling
     (80% bilingual TH/EN dataset + 20% project replay) to prevent English/code forgetting.
  4. Enforces Regression Guard on held-out `bilingual_val` Bits-Per-Byte (BPB) against both
     the initial warm-start state and the v2 baseline checkpoint on identical held-out text.
  5. Writes full evidence to artifacts/bilingual-v4-training-evidence.json.
"""

import os
import sys
import json
import time
import math
import shutil
import argparse
from typing import Dict, List, Tuple, Any
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.bilingual_corpus import build_bilingual_corpus, BILINGUAL_MANIFEST_PATH
from qplus_native.lm_v2 import (
    NativeLM,
    AdamW,
    V2_CHECKPOINT_PATH,
    V4_THAI_CHECKPOINT_PATH,
    ROOT,
)
from qplus_native.checkpoint import CheckpointManager

EVIDENCE_PATH = os.path.join(ROOT, "artifacts", "bilingual-v4-training-evidence.json")


def build_windows(streams: List[np.ndarray], ctx: int) -> Tuple[np.ndarray, np.ndarray]:
    X, Y = [], []
    for s in streams:
        if len(s) <= ctx + 1:
            continue
        for i in range(0, len(s) - ctx - 1, ctx):
            X.append(s[i:i + ctx])
            Y.append(s[i + 1:i + ctx + 1])
    if not X:
        return np.zeros((0, ctx), dtype=np.int64), np.zeros((0, ctx), dtype=np.int64)
    return np.stack(X), np.stack(Y)


def pack_short_docs(docs: List[Dict[str, Any]], tok: SovereignTokenizer, ctx: int) -> List[np.ndarray]:
    """Packs train docs into token streams of length >= ctx + 2 without crossing split boundaries."""
    streams: List[np.ndarray] = []
    eos_id = tok.token_to_id.get("[EOS]", 2)
    buf: List[int] = []
    for d in docs:
        ids = tok.encode(d["text"])
        if len(ids) > ctx + 1:
            streams.append(np.array(ids, dtype=np.int64))
        else:
            if buf:
                buf.append(eos_id)
            buf.extend(ids)
            if len(buf) > ctx + 1:
                streams.append(np.array(buf, dtype=np.int64))
                buf = []
    if len(buf) > ctx + 1:
        streams.append(np.array(buf, dtype=np.int64))
    elif buf and streams:
        streams[-1] = np.concatenate([streams[-1], np.array([eos_id] + buf, dtype=np.int64)])
    return streams


def eval_bpb_and_nll(
    model: NativeLM,
    X: np.ndarray,
    Y: np.ndarray,
    byte_len: np.ndarray,
    thai_mask_arr: np.ndarray,
    bs: int = 32,
) -> Dict[str, Any]:
    if len(X) == 0:
        return {"positions": 0, "nll": float("nan"), "ppl": float("nan"), "bpb": float("nan")}
    nll_all = []
    for i in range(0, len(X), bs):
        xb, yb = X[i:i + bs], Y[i:i + bs]
        lg, _ = model.forward(xb)
        lg = lg.astype(np.float64)
        z = lg - lg.max(-1, keepdims=True)
        lp = z - np.log(np.exp(z).sum(-1, keepdims=True))
        nll_all.append(-np.take_along_axis(lp, yb[..., None], -1)[..., 0].reshape(-1))
    nll = np.concatenate(nll_all)
    y_flat = Y.reshape(-1)
    nbytes = int(byte_len[y_flat].sum())
    tm = thai_mask_arr[y_flat]
    thai_nll = float(nll[tm].mean()) if tm.any() else None
    thai_bytes = int(byte_len[y_flat[tm]].sum()) if tm.any() else 0
    thai_bpb = float(nll[tm].sum() / math.log(2) / max(1, thai_bytes)) if tm.any() else None
    mean_nll = float(nll.mean())
    return {
        "positions": int(nll.size),
        "bytes": nbytes,
        "nll": mean_nll,
        "ppl": float(math.exp(mean_nll)),
        "bpb": float(nll.sum() / math.log(2) / max(1, nbytes)),
        "thai_positions": int(tm.sum()),
        "thai_nll": thai_nll,
        "thai_ppl": float(math.exp(thai_nll)) if thai_nll is not None else None,
        "thai_bpb": thai_bpb,
    }


def sample_bilingual_batch(
    rng: np.random.Generator,
    bi_streams: List[np.ndarray],
    proj_streams: List[np.ndarray],
    batch: int,
    ctx: int,
    bi_prob: float,
) -> Tuple[np.ndarray, np.ndarray]:
    bi_lens = np.array([max(len(s) - ctx - 1, 0) for s in bi_streams], dtype=np.float64)
    pr_lens = np.array([max(len(s) - ctx - 1, 0) for s in proj_streams], dtype=np.float64)
    bi_p = bi_lens / bi_lens.sum() if bi_lens.sum() > 0 else None
    pr_p = pr_lens / pr_lens.sum() if pr_lens.sum() > 0 else None
    xs, ys = [], []
    for _ in range(batch):
        use_bi = (bi_p is not None) and (pr_p is None or rng.random() < bi_prob)
        if use_bi:
            s = bi_streams[rng.choice(len(bi_streams), p=bi_p)]
        else:
            s = proj_streams[rng.choice(len(proj_streams), p=pr_p)]
        i = int(rng.integers(0, len(s) - ctx - 1))
        xs.append(s[i:i + ctx])
        ys.append(s[i + 1:i + ctx + 1])
    return np.stack(xs), np.stack(ys)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=260)
    ap.add_argument("--batch", type=int, default=10)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--weight-decay", type=float, default=0.01)
    ap.add_argument("--bilingual-mix", type=float, default=0.82)
    ap.add_argument("--eval-every", type=int, default=26)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--base", default=V2_CHECKPOINT_PATH)
    ap.add_argument("--out", default=V4_THAI_CHECKPOINT_PATH)
    ap.add_argument("--no-save", action="store_true")
    a = ap.parse_args()

    if os.path.abspath(a.out) == os.path.abspath(a.base):
        raise SystemExit("FAIL_CLOSED: --out must never overwrite the v2 baseline checkpoint.")

    tok_v2 = SovereignTokenizer(profile="v2_base")
    tok_v4 = SovereignTokenizer(profile="bilingual_v4")
    corpus = build_bilingual_corpus(write_manifest=True)
    docs = corpus["docs"]

    bi_train_docs = [d for d in docs if d["split"] == "train" and d["kind"] == "bilingual_dataset"]
    proj_train_docs = [d for d in docs if d["split"] == "train" and d["kind"] != "bilingual_dataset"]
    bi_val_docs = [d for d in docs if d["split"] == "val" and d["kind"] == "bilingual_dataset"]
    all_val_docs = [d for d in docs if d["split"] == "val"]

    base_model, base_meta = NativeLM.load(a.base, tok_v2)
    ctx = base_model.cfg.ctx
    bi_train_streams = pack_short_docs(bi_train_docs, tok_v4, ctx)
    proj_train_streams = pack_short_docs(proj_train_docs, tok_v4, ctx)

    # Evaluation tensors for v2 (v2_base tokenization) and v4 (bilingual_v4 tokenization) on identical held-out docs
    v2_bi_val = [np.array(tok_v2.encode(d["text"]), dtype=np.int64) for d in bi_val_docs]
    v4_bi_val = [np.array(tok_v4.encode(d["text"]), dtype=np.int64) for d in bi_val_docs]
    v4_all_val = [np.array(tok_v4.encode(d["text"]), dtype=np.int64) for d in all_val_docs]

    X_v2_bi, Y_v2_bi = build_windows(v2_bi_val, ctx)
    X_v4_bi, Y_v4_bi = build_windows(v4_bi_val, ctx)
    X_v4_all, Y_v4_all = build_windows(v4_all_val, ctx)

    def _tok_tables(tok: SovereignTokenizer):
        bl = np.zeros(16384, dtype=np.int64)
        tm = np.zeros(16384, dtype=bool)
        for idx, s in tok.id_to_token.items():
            if not (s.startswith("<tok_") and s.endswith(">")) and not (s.startswith("[") and s.endswith("]")):
                bl[idx] = len(s.encode("utf-8"))
                tm[idx] = any("\u0e01" <= ch <= "\u0e5b" for ch in s)
        return bl, tm

    bl_v2, tm_v2 = _tok_tables(tok_v2)
    bl_v4, tm_v4 = _tok_tables(tok_v4)

    base_model_f32 = NativeLM(base_model.cfg, dtype=np.float32, tokenizer_profile="v2_base")
    base_model_f32.p = {k: v.astype(np.float32) for k, v in base_model.p.items()}
    v2_ref_bi = eval_bpb_and_nll(base_model_f32, X_v2_bi, Y_v2_bi, bl_v2, tm_v2)

    model = NativeLM.warm_start_from(base_model, tok_v2, tok_v4, seed=a.seed, dtype=np.float32)
    start_bi = eval_bpb_and_nll(model, X_v4_bi, Y_v4_bi, bl_v4, tm_v4)
    start_all = eval_bpb_and_nll(model, X_v4_all, Y_v4_all, bl_v4, tm_v4)

    print(json.dumps({
        "event": "START_BILINGUAL_V4_TRAINING",
        "params": model.num_params(),
        "vocab": model.cfg.vocab,
        "tokenizer_profile": tok_v4.profile,
        "v2_baseline_bi_val_bpb": round(v2_ref_bi["bpb"], 4),
        "v4_init_bi_val_bpb": round(start_bi["bpb"], 4),
        "v4_init_bi_val_nll": round(start_bi["nll"], 4),
        "v4_init_all_val_bpb": round(start_all["bpb"], 4),
        "steps": a.steps,
        "batch": a.batch,
        "lr": a.lr,
        "bilingual_mix": a.bilingual_mix,
    }), flush=True)

    opt = AdamW(model, lr=a.lr, weight_decay=a.weight_decay)
    rng = np.random.default_rng(a.seed)
    warm = max(1, min(30, a.steps // 8))
    best_bi_bpb = start_bi["bpb"]
    best_bi_metrics = start_bi
    best_state = {k: v.copy() for k, v in model.p.items()}
    history: List[Dict[str, Any]] = []
    t0 = time.time()

    for step in range(1, a.steps + 1):
        lr = a.lr * min(1.0, step / warm) * (0.1 + 0.9 * 0.5 * (1.0 + math.cos(math.pi * step / a.steps)))
        xb, yb = sample_bilingual_batch(rng, bi_train_streams, proj_train_streams, a.batch, ctx, a.bilingual_mix)
        lg, cache = model.forward(xb, keep_cache=True)
        loss, dl = NativeLM.ce_loss(lg.astype(np.float64), yb)
        if not math.isfinite(loss):
            raise SystemExit(f"FAIL_CLOSED: non-finite loss at step {step}")
        gn = opt.step(model, model.backward(dl.astype(np.float32), cache), lr=lr)

        if step % a.eval_every == 0 or step == a.steps:
            bi_m = eval_bpb_and_nll(model, X_v4_bi, Y_v4_bi, bl_v4, tm_v4)
            entry = {
                "step": step,
                "train_loss": round(float(loss), 4),
                "bi_val_nll": round(bi_m["nll"], 4),
                "bi_val_ppl": round(bi_m["ppl"], 4),
                "bi_val_bpb": round(bi_m["bpb"], 4),
                "thai_val_ppl": round(bi_m["thai_ppl"], 4) if bi_m["thai_ppl"] is not None else None,
                "thai_val_bpb": round(bi_m["thai_bpb"], 4) if bi_m["thai_bpb"] is not None else None,
                "grad_norm": round(float(gn), 3),
                "lr": round(float(lr), 6),
                "elapsed_s": round(time.time() - t0, 1),
            }
            history.append(entry)
            print(json.dumps({"event": "PROGRESS", **entry}), flush=True)
            if bi_m["bpb"] < best_bi_bpb:
                best_bi_bpb = bi_m["bpb"]
                best_bi_metrics = bi_m
                best_state = {k: v.copy() for k, v in model.p.items()}

    model.p = best_state
    final_bi = eval_bpb_and_nll(model, X_v4_bi, Y_v4_bi, bl_v4, tm_v4)
    final_all = eval_bpb_and_nll(model, X_v4_all, Y_v4_all, bl_v4, tm_v4)

    beats_init = final_bi["bpb"] < start_bi["bpb"]
    beats_v2 = final_bi["bpb"] < v2_ref_bi["bpb"]
    accepted = bool(beats_init and beats_v2)
    decision = "ACCEPTED" if accepted else "REJECTED_REGRESSION"

    saved = None
    inspect_res = None
    if accepted and not a.no_save:
        if os.path.exists(a.out):
            os.makedirs(os.path.join(ROOT, "native_data", "checkpoints"), exist_ok=True)
            backup_path = os.path.join(ROOT, "native_data", "checkpoints", f"model_checkpoint_v4_thai.backup-{int(time.time())}.pt")
            shutil.copy2(a.out, backup_path)
        meta = model.save(
            a.out,
            tok_v4,
            extra_meta={
                "model_name": "ZYNTHEOR Q+ Native Bilingual TH/EN LM (Batch 4)",
                "architecture": f"ZYNTHEOR-NativeLM-v4-Bilingual ({model.cfg.n_layers}L · {model.cfg.n_heads}H · {model.cfg.d_model}D · Tied-Vocab {model.cfg.vocab})",
                "version": "4.0.0",
                "training_track": "BATCH4_BILINGUAL_TH_EN",
                "warm_start_from": os.path.relpath(a.base, ROOT),
                "warm_start_base_sha256": base_meta["sha256"],
                "validation_loss": final_all["nll"],
                "validation_perplexity": final_all["ppl"],
                "validation_bpb": final_all["bpb"],
                "bilingual_val_nll": final_bi["nll"],
                "bilingual_val_perplexity": final_bi["ppl"],
                "bilingual_val_bpb": final_bi["bpb"],
                "thai_val_bpb": final_bi["thai_bpb"],
                "v2_baseline_bilingual_val_bpb": v2_ref_bi["bpb"],
                "training_steps_total": a.steps,
                "tokens_exposed_upper_bound": a.steps * a.batch * ctx,
                "corpus_sha256": corpus["corpus_sha256"],
                "manifest_path": os.path.relpath(BILINGUAL_MANIFEST_PATH, ROOT),
                "hyperparameters": {
                    "steps": a.steps,
                    "batch": a.batch,
                    "lr": a.lr,
                    "weight_decay": a.weight_decay,
                    "bilingual_mix": a.bilingual_mix,
                    "ctx": ctx,
                    "seed": a.seed,
                },
            },
        )
        inspect_res = CheckpointManager.inspect_checkpoint(a.out)
        if inspect_res.get("status") != "ACTIVE_TENSORS_VERIFIED":
            raise SystemExit(f"FAIL_CLOSED: saved checkpoint failed verification: {inspect_res}")
        saved = {
            "path": os.path.relpath(a.out, ROOT),
            "file_size_bytes": os.path.getsize(a.out),
            "payload_sha256": meta["sha256"],
            "total_params": meta["total_params"],
            "tokenizer_profile": meta["tokenizer_profile"],
            "tokenizer_fingerprint": meta["tokenizer_fingerprint"],
            "verification_status": inspect_res["status"],
        }

    run_record = {
        "timestamp": int(time.time()),
        "decision": decision,
        "beats_init": beats_init,
        "beats_v2_baseline": beats_v2,
        "warm_start_from": os.path.relpath(a.base, ROOT),
        "warm_start_base_sha256": base_meta["sha256"],
        "corpus_sha256": corpus["corpus_sha256"],
        "corpus_summary": corpus["summary"],
        "config": model.cfg.to_dict(),
        "total_params": model.num_params(),
        "hyperparameters": {
            "steps": a.steps,
            "batch": a.batch,
            "lr": a.lr,
            "weight_decay": a.weight_decay,
            "bilingual_mix": a.bilingual_mix,
            "seed": a.seed,
            "elapsed_sec": round(time.time() - t0, 2),
        },
        "v2_baseline_bilingual_val": v2_ref_bi,
        "v4_init_bilingual_val": start_bi,
        "v4_final_bilingual_val": final_bi,
        "v4_final_all_val": final_all,
        "history": history,
        "saved": saved,
    }

    ev = json.load(open(EVIDENCE_PATH, encoding="utf-8")) if os.path.exists(EVIDENCE_PATH) else {"runs": []}
    ev["runs"].append(run_record)
    os.makedirs(os.path.dirname(EVIDENCE_PATH), exist_ok=True)
    with open(EVIDENCE_PATH, "w", encoding="utf-8") as ef:
        json.dump(ev, ef, indent=2, ensure_ascii=False)

    print(json.dumps({
        "event": decision,
        "v2_bilingual_bpb": round(v2_ref_bi["bpb"], 4),
        "v4_init_bilingual_bpb": round(start_bi["bpb"], 4),
        "v4_final_bilingual_bpb": round(final_bi["bpb"], 4),
        "v4_final_thai_bpb": round(final_bi["thai_bpb"], 4) if final_bi["thai_bpb"] is not None else None,
        "saved": saved,
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
