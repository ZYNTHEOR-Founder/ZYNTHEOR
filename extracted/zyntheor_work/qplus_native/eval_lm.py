# -*- coding: utf-8 -*-
"""
Evaluation harness for ZYNTHEOR Native LM v2 (P4).

Measures held-out next-token prediction against honest baselines that need no learning
of long context (unigram, smoothed bigram) trained on the SAME training split. A model that
cannot beat the bigram baseline has not learned anything beyond corpus statistics, and the
report says so. Results are written to artifacts/lm-v2-eval.json. No capability beyond what
these numbers show is claimed.
"""
import os
import sys
import json
import math
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.corpus import build_corpus
from qplus_native.lm_v2 import NativeLM, V2_CHECKPOINT_PATH, ROOT

EVAL_PATH = os.path.join(ROOT, "artifacts", "lm-v2-eval.json")
PROMPTS = [
    "function verifyToken(",
    "class LRUCache {",
    "def forward(self,",
    "## Executive result\n",
    "การตรวจสอบ",
]


def windows(streams, T):
    X, Y = [], []
    for s in streams:
        for i in range(0, len(s) - T - 1, T):
            X.append(s[i:i + T])
            Y.append(s[i + 1:i + T + 1])
    return np.stack(X), np.stack(Y)


def thai_mask(tok, Y):
    thai_ids = np.zeros(len(tok.id_to_token), dtype=bool)
    for i, s in tok.id_to_token.items():
        if any("ก" <= ch <= "๛" for ch in s):
            thai_ids[i] = True
    return thai_ids[Y]


def main():
    tok = SovereignTokenizer()
    model, meta = NativeLM.load(V2_CHECKPOINT_PATH, tok)
    V, T = model.cfg.vocab, model.cfg.ctx
    manifest = json.load(open(os.path.join(ROOT, "artifacts", "lm-v2-corpus-manifest.json")))
    if manifest["corpus_sha256"] != meta.get("corpus_sha256"):
        raise SystemExit("FAIL_CLOSED: corpus manifest does not belong to this checkpoint")
    # Use exactly the documents that existed at training time. A document whose text has since
    # changed is skipped and counted, so the evaluation is reproducible and never silently drifts.
    current = {d["id"]: d for d in build_corpus()["docs"]}
    frozen, changed = [], 0
    for m in manifest["docs"]:
        cur = current.get(m["id"])
        if cur is not None and cur["sha256"] == m["sha256"]:
            frozen.append(cur)
        else:
            changed += 1
    train = [np.array(tok.encode(d["text"]), dtype=np.int64) for d in frozen if d["split"] == "train"]
    val_docs = [d for d in frozen if d["split"] == "val"]
    val = [np.array(tok.encode(d["text"]), dtype=np.int64) for d in val_docs]

    # --- baselines fitted on train only
    uni = np.ones(V)
    big = np.zeros((V, V))
    for s in train:
        np.add.at(uni, s, 1)
        np.add.at(big, (s[:-1], s[1:]), 1)
    p_uni = uni / uni.sum()
    k = 0.5
    p_big = (big + k * p_uni[None]) / (big.sum(1, keepdims=True) + k)

    X, Y = windows(val, T)
    nll_m, top1, top5, nll_u, nll_b = [], [], [], [], []
    for i in range(0, len(X), 64):
        xb, yb = X[i:i + 64], Y[i:i + 64]
        lg, _ = model.forward(xb)
        z = lg - lg.max(-1, keepdims=True)
        lp = z - np.log(np.exp(z).sum(-1, keepdims=True))
        nll_m.append(-np.take_along_axis(lp, yb[..., None], -1)[..., 0])
        order = np.argsort(-lg, axis=-1)[..., :5]
        top1.append(order[..., 0] == yb)
        top5.append((order == yb[..., None]).any(-1))
        nll_u.append(-np.log(p_uni[yb]))
        nll_b.append(-np.log(p_big[xb, yb]))
    nll_m, top1, top5, nll_u, nll_b = map(np.concatenate, ([a.reshape(-1) for a in x] for x in (nll_m, top1, top5, nll_u, nll_b)))
    tm = thai_mask(tok, Y).reshape(-1)

    def ppl(a):
        return float(math.exp(a.mean()))

    result = {
        "timestamp": int(time.time()),
        "checkpoint_sha256": meta["sha256"],
        "total_params": meta["total_params"],
        "training_steps_total": meta.get("training_steps_total"),
        "val_positions": int(nll_m.size),
        "val_documents": len(val_docs),
        "manifest_docs_changed_since_training_skipped": changed,
        "corpus_sha256": manifest["corpus_sha256"],
        "perplexity": {"model": ppl(nll_m), "bigram_baseline": ppl(nll_b), "unigram_baseline": ppl(nll_u),
                       "uniform_random": float(V)},
        "accuracy": {"top1": float(top1.mean()), "top5": float(top5.mean())},
        "thai_target_positions": {"count": int(tm.sum()), "model_ppl": ppl(nll_m[tm]) if tm.sum() else None,
                                  "bigram_ppl": ppl(nll_b[tm]) if tm.sum() else None},
        "beats_bigram_baseline": bool(ppl(nll_m) < ppl(nll_b)),
        "generation_samples": [],
    }
    train_X, train_Y = windows(train, T)
    sel = np.random.default_rng(0).choice(len(train_X), min(640, len(train_X)), replace=False)
    tl = []
    for i in range(0, len(sel), 64):
        idx = sel[i:i + 64]
        lg, _ = model.forward(train_X[idx])
        tl.append(NativeLM.ce_loss(lg, train_Y[idx])[0])
    result["train_val_gap"] = {"train_ppl_sample": float(math.exp(np.mean(tl))), "val_ppl": ppl(nll_m)}

    distinct = []
    for p in PROMPTS:
        ids = tok.encode(p)
        out = model.generate_ids(ids, max_new_tokens=60, temperature=0.0)
        out_t = model.generate_ids(ids, max_new_tokens=60, temperature=0.8, top_k=20, seed=11)
        bigrams = list(zip(out, out[1:]))
        distinct.append(len(set(bigrams)) / max(1, len(bigrams)))
        result["generation_samples"].append({"prompt": p, "greedy": tok.decode(out), "sampled_t0.8": tok.decode(out_t)})
    result["greedy_distinct_bigram_ratio_mean"] = float(np.mean(distinct))
    os.makedirs(os.path.dirname(EVAL_PATH), exist_ok=True)
    json.dump(result, open(EVAL_PATH, "w"), indent=2, ensure_ascii=False)
    print(json.dumps({k: v for k, v in result.items() if k != "generation_samples"}, indent=2))
    for g in result["generation_samples"]:
        print("\n>>>", repr(g["prompt"]), "\n[greedy]", repr(g["greedy"][:200]), "\n[t=0.8]", repr(g["sampled_t0.8"][:200]))


if __name__ == "__main__":
    main()
