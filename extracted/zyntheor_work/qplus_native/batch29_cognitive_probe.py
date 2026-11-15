# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 29 — Native Model Capability Diagnostic & Pure-Python Cognitive Probe

Inspects existing SovereignTokenizer & PureSeqLM architecture with zero external dependencies,
distinguishing:
  - Pure-Python tokenizer & small causal sequence LM measurements (verified locally)
  - Target 41.53M Cloud Checkpoint (honestly reported as BLOCKED if cloud storage is not configured)
"""

import json
import math
import os
import sys
import time
from typing import Any, Dict, List

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from qplus_native.tokenizer import SovereignTokenizer, train_bpe_merges
from qplus_native.seq_lm import PureSeqLM, SeqLMConfig, real_vocab_size, verify_pure_seq_gradients
from qplus_native.architecture import (
    TARGET_VOCAB_SIZE,
    TARGET_D_MODEL,
    TARGET_N_LAYERS,
    TARGET_N_HEADS,
    TARGET_D_FFN,
    TARGET_CTX,
    TARGET_TOTAL_PARAMS,
)


def evaluate_tokenizer_profiles() -> Dict[str, Any]:
    sample_corpus = [
        "ระบบ ZYNTHEOR Cognitive Context Engine วิเคราะห์บริบทภาษาไทยและภาษาอังกฤษ",
        "Sovereign AuditLedger enforces SHA-256 chain integrity and tenantId isolation.",
        "การตรวจสอบ HMAC-SHA256 ต้องใช้ crypto.timingSafeEqual เสมอเพื่อป้องกัน Timing Attack",
        "def verify_constraints(budget: float, cost: float) -> bool:\n    return cost <= budget",
        "โมเดลภาษาท้องถิ่นต้องประเมิน Perplexity บน Validation Split ที่แยกขาดจากข้อมูลฝึก",
    ]

    v2 = SovereignTokenizer(vocab_size=16384, profile="v2_base")
    v4 = SovereignTokenizer(vocab_size=16384, profile="bilingual_v4")
    bpe_res = train_bpe_merges(sample_corpus, num_merges=24, min_pair_freq=2)
    bpe = SovereignTokenizer(vocab_size=16384, profile="bilingual_bpe", bpe_merges=bpe_res["merges"])

    a_v2 = v2.audit(sample_corpus)
    a_v4 = v4.audit(sample_corpus)
    a_bpe = bpe.audit(sample_corpus)

    return {
        "v2_base": {
            "real_vocab": a_v2["real_vocab_size"],
            "avg_chars_per_token": a_v2["benchmark"]["avg_chars_per_token"],
            "total_tokens": a_v2["benchmark"]["total_tokens"],
            "unk_count": a_v2["benchmark"]["total_unks"],
            "thai_block_coverage": a_v2["thai_unicode_block_coverage"],
        },
        "bilingual_v4": {
            "real_vocab": a_v4["real_vocab_size"],
            "avg_chars_per_token": a_v4["benchmark"]["avg_chars_per_token"],
            "total_tokens": a_v4["benchmark"]["total_tokens"],
            "unk_count": a_v4["benchmark"]["total_unks"],
            "compression_gain_vs_v2_pct": round(
                ((a_v2["benchmark"]["total_tokens"] - a_v4["benchmark"]["total_tokens"]) / max(1, a_v2["benchmark"]["total_tokens"])) * 100.0,
                2,
            ),
        },
        "bilingual_bpe": {
            "real_vocab": a_bpe["real_vocab_size"],
            "avg_chars_per_token": a_bpe["benchmark"]["avg_chars_per_token"],
            "total_tokens": a_bpe["benchmark"]["total_tokens"],
            "unk_count": a_bpe["benchmark"]["total_unks"],
            "merges_learned": bpe_res["merges_learned"],
            "compression_gain_vs_v2_pct": round(
                ((a_v2["benchmark"]["total_tokens"] - a_bpe["benchmark"]["total_tokens"]) / max(1, a_v2["benchmark"]["total_tokens"])) * 100.0,
                2,
            ),
        },
    }


def inspect_native_model_capabilities() -> Dict[str, Any]:
    t0 = time.perf_counter()
    tok_eval = evaluate_tokenizer_profiles()

    # PureSeqLM architecture & numerical stability check
    tok = SovereignTokenizer(vocab_size=16384, profile="bilingual_v4")
    real_v = real_vocab_size(tok)
    cfg = SeqLMConfig(vocab=real_v, d_model=32, n_layers=2, n_heads=4, d_ffn=64, ctx=16)
    probe_model = PureSeqLM(cfg, seed=29, tokenizer_profile="bilingual_v4")

    probes = {
        "thai": "สรุประบบความปลอดภัยของ ZYNTHEOR",
        "english": "Verify tenant isolation and SHA-256 audit chain",
        "math": "Compute (12 * 4) + 15 = 63",
        "code": "def check(x): return x > 0",
    }
    stability: Dict[str, Any] = {}
    all_finite = True
    for key, text in probes.items():
        ids = tok.encode(text)[: cfg.ctx]
        ids = [tid if 0 <= tid < real_v else 3 for tid in ids]
        logits, _ = probe_model.forward_seq(ids, keep_cache=False)
        last = logits[-1]
        finite = all(math.isfinite(v) for v in last)
        if not finite:
            all_finite = False
        m = max(last)
        exps = [math.exp(v - m) for v in last]
        s_exp = sum(exps)
        probs = [e / s_exp for e in exps]
        entropy = -sum(p * math.log(max(p, 1e-12)) for p in probs)
        stability[key] = {
            "tokens": len(ids),
            "logits_finite": finite,
            "entropy": round(entropy, 4),
            "vocab_support": len(last),
        }

    grad_check = verify_pure_seq_gradients(seed=11)

    cloud_configured = bool(os.environ.get("CHECKPOINT_PRESIGNED_URL") or os.environ.get("S3_BUCKET"))

    return {
        "schema": "ZYNTHEOR_BATCH29_MODEL_CAPABILITY_V1",
        "tokenizer_profiles": tok_eval,
        "pure_seq_lm": {
            "status": "VERIFIED" if (all_finite and grad_check["passed"]) else "FAILED",
            "params": probe_model.num_params(),
            "config": cfg.to_dict(),
            "all_logits_finite": all_finite,
            "gradient_parity": grad_check,
            "domain_stability_probes": stability,
        },
        "target_41m_cloud_model": {
            "status": "READY" if cloud_configured else "BLOCKED",
            "reason": "Cloud checkpoint configured" if cloud_configured else "Neither CHECKPOINT_PRESIGNED_URL nor S3_BUCKET is configured in runtime environment.",
            "spec_total_params": TARGET_TOTAL_PARAMS,
            "spec": {
                "vocab_size": TARGET_VOCAB_SIZE,
                "d_model": TARGET_D_MODEL,
                "n_layers": TARGET_N_LAYERS,
                "n_heads": TARGET_N_HEADS,
                "d_ffn": TARGET_D_FFN,
                "ctx": TARGET_CTX,
            },
        },
        "duration_ms": round((time.perf_counter() - t0) * 1000.0, 2),
    }


if __name__ == "__main__":
    print(json.dumps(inspect_native_model_capabilities(), ensure_ascii=False, indent=2))
