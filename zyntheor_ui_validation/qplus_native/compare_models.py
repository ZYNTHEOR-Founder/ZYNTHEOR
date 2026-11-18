# -*- coding: utf-8 -*-
"""
Fair, reproducible comparison of two NativeLM v2-format checkpoints on the SAME frozen
validation documents and the SAME windows.

  python3 qplus_native/compare_models.py --a native_data/model_checkpoint_v2.pt \
      --b native_data/model_checkpoint_target_41m.pt [--manifest artifacts/lm-v2-corpus-manifest.json]

Why this is comparable: both checkpoints use the same SovereignTokenizer segmentation (a
16,384-id head only adds filler ids that the tokenizer never emits), so per-token NLL is on
identical targets. Bits-per-byte is also reported because it does not depend on tokenization at
all. Validation documents are taken from the frozen manifest; a document whose text changed since
the manifest was written is skipped and counted. Split membership is by crc32(doc id), so these
documents are held out for any checkpoint trained through qplus_native.corpus.build_corpus().

Protocol A  = first 128 windows only (reproduces the in-training metric used by train_target.py)
Protocol B  = every non-overlapping window of every validation document (the real evaluation)
Nothing is written over any checkpoint; output goes to artifacts/model-comparison.json.
"""
import os
import sys
import json
import math
import argparse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.corpus import build_corpus
from qplus_native.lm_v2 import NativeLM, ROOT


def load(path, tok):
    m, meta = NativeLM.load(path, tok)
    m.p = {k: v.astype(np.float32) for k, v in m.p.items()}  # faster; weights were float32 on disk
    return m, meta


def evaluate(model, X, Y, byte_len, limit=None):
    if limit:
        X, Y = X[:limit], Y[:limit]
    nll, hit1 = [], []
    for i in range(0, len(X), 32):
        xb, yb = X[i:i + 32], Y[i:i + 32]
        lg, _ = model.forward(xb)
        lg = lg.astype(np.float64)
        z = lg - lg.max(-1, keepdims=True)
        lp = z - np.log(np.exp(z).sum(-1, keepdims=True))
        nll.append(-np.take_along_axis(lp, yb[..., None], -1)[..., 0].reshape(-1))
        hit1.append((lg.argmax(-1) == yb).reshape(-1))
    nll, hit1 = np.concatenate(nll), np.concatenate(hit1)
    nbytes = byte_len[Y.reshape(-1)].sum()
    return {"positions": int(nll.size), "nll_per_token": float(nll.mean()), "perplexity": float(math.exp(nll.mean())),
            "bits_per_byte": float(nll.sum() / math.log(2) / max(nbytes, 1)), "top1": float(hit1.mean())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--manifest", default=os.path.join(ROOT, "artifacts", "lm-v2-corpus-manifest.json"))
    ap.add_argument("--split", choices=["val", "test"], default="val",
                    help="test (v3 manifests only) is logged to artifacts/test-split-access.json; use it for final reports, not selection")
    ap.add_argument("--corpus-root", default=None)
    ap.add_argument("--max-windows", type=int, default=0, help="cap protocol B (0 = all)")
    args = ap.parse_args()

    tok = SovereignTokenizer()
    tok_target = SovereignTokenizer(16384)
    probe = "ZYNTHEOR is verifyToken(สวัสดี) {}"
    assert tok.encode(probe) == tok_target.encode(probe), "tokenizers segment text differently; per-token numbers not comparable"

    from qplus_native.corpus_ingest import load_split_docs, log_test_access
    r = load_split_docs(args.manifest, args.corpus_root)
    if args.split == "test" and r["manifest"].get("version") != 3:
        raise SystemExit("FAIL_CLOSED: legacy manifests have no test split; ingest a corpus with corpus_ingest.py first")
    docs, changed = r[args.split], r["skipped"]
    streams = [np.array(tok.encode(d["text"]), dtype=np.int64) for d in docs]

    models = {}
    for name, path in (("A", args.a), ("B", args.b)):
        m, meta = load(path, tok)
        models[name] = (m, meta, os.path.basename(path))
    T = min(models["A"][0].cfg.ctx, models["B"][0].cfg.ctx)
    if models["A"][0].cfg.ctx != models["B"][0].cfg.ctx:
        print(f"NOTE: context lengths differ; both evaluated at ctx={T}")
    X, Y = [], []
    for s in streams:
        for i in range(0, len(s) - T - 1, T):
            X.append(s[i:i + T]); Y.append(s[i + 1:i + T + 1])
    X, Y = np.stack(X), np.stack(Y)
    if args.max_windows:
        X, Y = X[:args.max_windows], Y[:args.max_windows]
    byte_len = np.zeros(max(len(tok.id_to_token), 16384), dtype=np.int64)
    for i, s in tok.id_to_token.items():
        byte_len[i] = len(s.encode("utf-8")) if not (s.startswith("<") and s.endswith(">") and len(s) > 2) else 0

    if args.split == "test":
        n = log_test_access("compare_models", models["A"][1]["sha256"] + "+" + models["B"][1]["sha256"])
        print(f"NOTE: test split access #{n} logged")
    out = {"split": args.split, "val_documents": len(docs), "manifest_docs_changed_skipped": changed, "windows": int(len(X)),
           "ctx": T, "models": {}}
    for name, (m, meta, label) in models.items():
        out["models"][name] = {
            "file": label, "params": meta["total_params"], "sha256": meta["sha256"],
            "protocol_A_first128_windows": evaluate(m, X, Y, byte_len, limit=128),
            "protocol_B_all_windows": evaluate(m, X, Y, byte_len),
        }
    a, b = out["models"]["A"]["protocol_B_all_windows"], out["models"]["B"]["protocol_B_all_windows"]
    out["verdict"] = {"B_beats_A_on_full_validation": b["nll_per_token"] < a["nll_per_token"],
                      "delta_nll_per_token_(B-A)": b["nll_per_token"] - a["nll_per_token"]}
    os.makedirs(os.path.join(ROOT, "artifacts"), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, "artifacts", "model-comparison.json"), "w"), indent=2)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
