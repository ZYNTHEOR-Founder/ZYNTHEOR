# -*- coding: utf-8 -*-
"""
Batch 4 Bilingual & Thai Held-Out Evaluation Harness.

Compares on the SAME frozen held-out validation documents (`artifacts/bilingual-corpus-manifest.json`):
  - Unigram & Smoothed Bigram baselines (trained on train split only)
  - v2 Baseline (`native_data/model_checkpoint_v2.pt`, profile=`v2_base`, 502,912 params)
  - v4 Thai Bilingual (`native_data/model_checkpoint_v4_thai.pt`, profile=`bilingual_v4`, 549,248 params)

Reports tokenization-invariant Bits-Per-Byte (BPB), Thai-position NLL/PPL/BPB,
Side-by-side Thai generation quality, Distinct-Bigram repetition control,
Thai-safe streaming cluster integrity, and writes `artifacts/bilingual-v4-eval.json`.
"""

import os
import sys
import json
import math
import time
from typing import Dict, List, Any
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.bilingual_corpus import build_bilingual_corpus, BILINGUAL_MANIFEST_PATH
from qplus_native.lm_v2 import NativeLM, V2_CHECKPOINT_PATH, V4_THAI_CHECKPOINT_PATH, ROOT
from qplus_native.checkpoint import CheckpointManager

EVAL_OUT_PATH = os.path.join(ROOT, "artifacts", "bilingual-v4-eval.json")

THAI_EVAL_PROMPTS = [
    "ระบบ ZYNTHEOR คือ",
    "<|user|> ระบบ ZYNTHEOR คืออะไรและมีเป้าหมายหลักอย่างไร <|assistant|>",
    "คำถาม: อธิบายหลักการ Fail-Closed\nคำตอบ:",
    "<|user|> สวัสดีครับ ช่วยแนะนำตัวสั้นๆ เป็นภาษาไทยหน่อย <|assistant|>",
    "การตรวจสอบความปลอดภัยด้วย HMAC-SHA256",
    "<|user|> Explain ZYNTHEOR Native Intelligence in Thai and English. <|assistant|>",
]


def _windows(streams: List[np.ndarray], ctx: int):
    X, Y = [], []
    for s in streams:
        for i in range(0, len(s) - ctx - 1, ctx):
            X.append(s[i:i + ctx])
            Y.append(s[i + 1:i + ctx + 1])
    if not X:
        return np.zeros((0, ctx), dtype=np.int64), np.zeros((0, ctx), dtype=np.int64)
    return np.stack(X), np.stack(Y)


def _token_tables(tok: SovereignTokenizer):
    bl = np.zeros(16384, dtype=np.int64)
    tm = np.zeros(16384, dtype=bool)
    for idx, s in tok.id_to_token.items():
        if not (s.startswith("<tok_") and s.endswith(">")) and not (s.startswith("[") and s.endswith("]")):
            bl[idx] = len(s.encode("utf-8"))
            tm[idx] = any("\u0e01" <= ch <= "\u0e5b" for ch in s)
    return bl, tm


def _eval_model(model: NativeLM, tok: SovereignTokenizer, val_docs: List[Dict[str, Any]], train_docs: List[Dict[str, Any]]) -> Dict[str, Any]:
    V = model.cfg.vocab
    T = model.cfg.ctx
    train_streams = [np.array(tok.encode(d["text"]), dtype=np.int64) for d in train_docs]
    val_streams = [np.array(tok.encode(d["text"]), dtype=np.int64) for d in val_docs]
    X, Y = _windows(val_streams, T)
    bl, tm = _token_tables(tok)

    uni = np.ones(V)
    big = np.zeros((V, V))
    for s in train_streams:
        valid = s[s < V]
        if valid.size < 2:
            continue
        np.add.at(uni, valid, 1)
        np.add.at(big, (valid[:-1], valid[1:]), 1)
    p_uni = uni / uni.sum()
    p_big = (big + 0.5 * p_uni[None]) / (big.sum(1, keepdims=True) + 0.5)

    nll_m, nll_b, nll_u, top1, top5 = [], [], [], [], []
    for i in range(0, len(X), 32):
        xb, yb = X[i:i + 32], Y[i:i + 32]
        lg, _ = model.forward(xb)
        lg = lg.astype(np.float64)
        z = lg - lg.max(-1, keepdims=True)
        lp = z - np.log(np.exp(z).sum(-1, keepdims=True))
        nll_m.append(-np.take_along_axis(lp, yb[..., None], -1)[..., 0])
        order = np.argsort(-lg, axis=-1)[..., :5]
        top1.append(order[..., 0] == yb)
        top5.append((order == yb[..., None]).any(-1))
        nll_u.append(-np.log(p_uni[yb]))
        nll_b.append(-np.log(p_big[xb, yb]))

    nll_m, nll_b, nll_u, top1, top5 = map(
        np.concatenate, ([a.reshape(-1) for a in arrs] for arrs in (nll_m, nll_b, nll_u, top1, top5))
    )
    y_flat = Y.reshape(-1)
    total_bytes = int(bl[y_flat].sum())
    tmask = tm[y_flat]
    thai_bytes = int(bl[y_flat[tmask]].sum()) if tmask.any() else 0

    def _bpb(nll_slice, bytes_count):
        return float(nll_slice.sum() / math.log(2) / max(1, bytes_count))

    return {
        "val_documents": len(val_docs),
        "val_windows": int(len(X)),
        "val_positions": int(nll_m.size),
        "val_bytes": total_bytes,
        "model_nll": float(nll_m.mean()),
        "model_ppl": float(math.exp(nll_m.mean())),
        "model_bpb": _bpb(nll_m, total_bytes),
        "bigram_bpb": _bpb(nll_b, total_bytes),
        "unigram_bpb": _bpb(nll_u, total_bytes),
        "bigram_ppl": float(math.exp(nll_b.mean())),
        "unigram_ppl": float(math.exp(nll_u.mean())),
        "top1_accuracy": float(top1.mean()),
        "top5_accuracy": float(top5.mean()),
        "beats_bigram_bpb": bool(_bpb(nll_m, total_bytes) < _bpb(nll_b, total_bytes)),
        "thai_positions": {
            "count": int(tmask.sum()),
            "bytes": thai_bytes,
            "model_ppl": float(math.exp(nll_m[tmask].mean())) if tmask.any() else None,
            "model_bpb": _bpb(nll_m[tmask], thai_bytes) if tmask.any() else None,
            "bigram_ppl": float(math.exp(nll_b[tmask].mean())) if tmask.any() else None,
            "bigram_bpb": _bpb(nll_b[tmask], thai_bytes) if tmask.any() else None,
            "beats_bigram": bool(_bpb(nll_m[tmask], thai_bytes) < _bpb(nll_b[tmask], thai_bytes)) if tmask.any() else None,
        },
    }


def _evaluate_prompts(model: NativeLM, tok: SovereignTokenizer, max_new_tokens: int = 36) -> List[Dict[str, Any]]:
    results = []
    unk_id = tok.token_to_id["[UNK]"]
    end_id = tok.token_to_id.get("<|end|>")
    stop_ids = {end_id} if (end_id is not None and end_id < model.cfg.vocab) else None

    for prompt in THAI_EVAL_PROMPTS:
        # Fallback cleanly if v2 tokenizer receives `<|user|>` etc. (still 0 UNK because chars map individually)
        p_ids = tok.encode(prompt)
        p_unks = sum(1 for t in p_ids if t == unk_id)

        t0 = time.perf_counter()
        ttft_ms = None
        dec = tok.create_stream_decoder(skip_instruction_markers=True)
        out_ids = []
        chunks = []
        for tid in model.generate_ids_stream(
            p_ids,
            max_new_tokens=max_new_tokens,
            temperature=0.72,
            top_k=20,
            top_p=0.92,
            repetition_penalty=1.18,
            rep_window=48,
            no_repeat_ngram=3,
            seed=42,
            stop_ids=stop_ids,
        ):
            out_ids.append(tid)
            ch = dec.push_token(tid)
            if ch:
                if ttft_ms is None:
                    ttft_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                chunks.append(ch)
        tail = dec.flush()
        if tail:
            chunks.append(tail)
        total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        text = "".join(chunks)

        # Also test greedy with no_repeat_ngram=3
        greedy_ids = model.generate_ids(
            p_ids,
            max_new_tokens=max_new_tokens,
            temperature=0.0,
            repetition_penalty=1.18,
            rep_window=48,
            no_repeat_ngram=3,
            stop_ids=stop_ids,
        )
        greedy_text = tok.decode(greedy_ids, skip_instruction_markers=True)

        orphan_combining = sum(1 for c in chunks if c and SovereignTokenizer.is_thai_combining(c[0]))
        bigrams = list(zip(out_ids, out_ids[1:]))
        distinct_bigram_ratio = round(len(set(bigrams)) / max(1, len(bigrams)), 4)
        thai_chars = sum(1 for ch in text if "\u0e01" <= ch <= "\u0e5b")
        results.append({
            "prompt": prompt,
            "prompt_tokens": len(p_ids),
            "prompt_unks": p_unks,
            "sampled_text": text,
            "greedy_text": greedy_text,
            "generated_tokens": len(out_ids),
            "thai_chars": thai_chars,
            "thai_char_ratio": round(thai_chars / max(1, len(text)), 4),
            "distinct_bigram_ratio": distinct_bigram_ratio,
            "stream_chunks_count": len(chunks),
            "orphan_combining_marks": orphan_combining,
            "ttft_ms": ttft_ms or total_ms,
            "latency_ms": total_ms,
            "tokens_per_sec": round(len(out_ids) / max(0.001, total_ms / 1000.0), 2),
        })
    return results


def main():
    tok_v2 = SovereignTokenizer(profile="v2_base")
    tok_v4 = SovereignTokenizer(profile="bilingual_v4")

    corpus = build_bilingual_corpus(write_manifest=True)
    manifest = json.load(open(BILINGUAL_MANIFEST_PATH, encoding="utf-8"))
    if manifest["corpus_sha256"] != corpus["corpus_sha256"]:
        raise SystemExit("FAIL_CLOSED: bilingual corpus manifest hash mismatch")

    train_docs = [d for d in corpus["docs"] if d["split"] == "train"]
    bi_val_docs = [d for d in corpus["docs"] if d["split"] == "val" and d["kind"] == "bilingual_dataset"]
    all_val_docs = [d for d in corpus["docs"] if d["split"] == "val"]

    v2_model, v2_meta = NativeLM.load(V2_CHECKPOINT_PATH, tok_v2)
    v2_model.p = {k: v.astype(np.float32) for k, v in v2_model.p.items()}
    v4_model, v4_meta = NativeLM.load(V4_THAI_CHECKPOINT_PATH, tok_v4)
    v4_model.p = {k: v.astype(np.float32) for k, v in v4_model.p.items()}

    v2_inspect = CheckpointManager.inspect_checkpoint(V2_CHECKPOINT_PATH)
    v4_inspect = CheckpointManager.inspect_checkpoint(V4_THAI_CHECKPOINT_PATH)

    v2_bi_eval = _eval_model(v2_model, tok_v2, bi_val_docs, train_docs)
    v4_bi_eval = _eval_model(v4_model, tok_v4, bi_val_docs, train_docs)
    v2_all_eval = _eval_model(v2_model, tok_v2, all_val_docs, train_docs)
    v4_all_eval = _eval_model(v4_model, tok_v4, all_val_docs, train_docs)

    v2_prompts = _evaluate_prompts(v2_model, tok_v2)
    v4_prompts = _evaluate_prompts(v4_model, tok_v4)

    bpb_delta_bi = v4_bi_eval["model_bpb"] - v2_bi_eval["model_bpb"]
    bpb_impr_pct = round(((v2_bi_eval["model_bpb"] - v4_bi_eval["model_bpb"]) / max(1e-9, v2_bi_eval["model_bpb"])) * 100.0, 2)
    thai_bpb_v2 = v2_bi_eval["thai_positions"]["model_bpb"]
    thai_bpb_v4 = v4_bi_eval["thai_positions"]["model_bpb"]
    thai_bpb_impr_pct = round(((thai_bpb_v2 - thai_bpb_v4) / max(1e-9, thai_bpb_v2)) * 100.0, 2)

    report = {
        "timestamp": int(time.time()),
        "corpus_sha256": corpus["corpus_sha256"],
        "corpus_summary": corpus["summary"],
        "tokenizer_audit": {
            "v2_base": tok_v2.audit(),
            "bilingual_v4": tok_v4.audit(),
        },
        "checkpoints": {
            "v2_baseline": {
                "path": os.path.relpath(V2_CHECKPOINT_PATH, ROOT),
                "sha256": v2_meta["sha256"],
                "total_params": v2_meta["total_params"],
                "config": v2_meta["config"],
                "inspect_status": v2_inspect["status"],
            },
            "v4_bilingual_thai": {
                "path": os.path.relpath(V4_THAI_CHECKPOINT_PATH, ROOT),
                "sha256": v4_meta["sha256"],
                "total_params": v4_meta["total_params"],
                "config": v4_meta["config"],
                "inspect_status": v4_inspect["status"],
            },
        },
        "held_out_bilingual_val": {
            "v2_baseline": v2_bi_eval,
            "v4_bilingual_thai": v4_bi_eval,
        },
        "held_out_all_val": {
            "v2_baseline": v2_all_eval,
            "v4_bilingual_thai": v4_all_eval,
        },
        "comparison_summary": {
            "bilingual_val_bpb_v2": round(v2_bi_eval["model_bpb"], 4),
            "bilingual_val_bpb_v4": round(v4_bi_eval["model_bpb"], 4),
            "bilingual_val_bpb_delta": round(bpb_delta_bi, 4),
            "bilingual_val_bpb_improvement_pct": bpb_impr_pct,
            "thai_positions_bpb_v2": round(thai_bpb_v2, 4),
            "thai_positions_bpb_v4": round(thai_bpb_v4, 4),
            "thai_positions_bpb_improvement_pct": thai_bpb_impr_pct,
            "all_val_bpb_v2": round(v2_all_eval["model_bpb"], 4),
            "all_val_bpb_v4": round(v4_all_eval["model_bpb"], 4),
            "v4_beats_v2_on_bilingual_val_bpb": bool(v4_bi_eval["model_bpb"] < v2_bi_eval["model_bpb"]),
            "v4_beats_v2_on_thai_positions_bpb": bool(thai_bpb_v4 < thai_bpb_v2),
            "v4_thai_chars_generated_avg": round(float(np.mean([p["thai_chars"] for p in v4_prompts])), 2),
            "v2_thai_chars_generated_avg": round(float(np.mean([p["thai_chars"] for p in v2_prompts])), 2),
            "v4_distinct_bigram_mean": round(float(np.mean([p["distinct_bigram_ratio"] for p in v4_prompts])), 4),
            "v4_orphan_combining_marks_total": sum(p["orphan_combining_marks"] for p in v4_prompts),
        },
        "prompt_generations": {
            "v2_baseline": v2_prompts,
            "v4_bilingual_thai": v4_prompts,
        },
    }

    os.makedirs(os.path.dirname(EVAL_OUT_PATH), exist_ok=True)
    with open(EVAL_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(json.dumps(report["comparison_summary"], indent=2, ensure_ascii=False))
    print("\n--- V4 THAI GENERATION SAMPLES ---")
    for g in v4_prompts:
        print(f"\nPROMPT: {g['prompt']!r}")
        print(f"  [SAMPLED t=0.72] {g['sampled_text']!r}")
        print(f"  [GREEDY nr3]     {g['greedy_text']!r}")
        print(f"  [STATS]          thai_chars={g['thai_chars']} distinct_bg={g['distinct_bigram_ratio']} orphans={g['orphan_combining_marks']} ttft={g['ttft_ms']}ms tps={g['tokens_per_sec']}")


if __name__ == "__main__":
    main()
