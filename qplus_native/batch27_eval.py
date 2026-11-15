# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 27 Reproducible Native Runtime, Tokenizer & Inference Evaluator.

ZERO SIMULATION POLICY:
- Evaluates ONLY real tokenizer behavior, real process memory, and real model
  forward/generation execution when verified weights are READY.
- When weights are missing, untrained, or unconfigured, inference metrics are
  strictly reported as BLOCKED (metrics=None), never fabricated.
"""

import hashlib
import json
import math
import os
import platform
import time
from typing import Any, Dict, List, Optional

from qplus_native.tokenizer import SovereignTokenizer


BILINGUAL_EVAL_PROBES = [
    {"id": "th_arch", "lang": "th", "text": "สถาปัตยกรรมระบบ ZYNTHEOR Sovereign AI ต้องตรวจสอบความถูกต้องทุกขั้นตอน"},
    {"id": "en_sec", "lang": "en", "text": "Constant-time HMAC verification prevents timing side-channel attacks across tenants."},
    {"id": "mix_ops", "lang": "mixed", "text": "รัน Docker container ด้วยคำสั่ง docker compose up และตรวจ SHA-256 checksum"},
    {"id": "math_logic", "lang": "en", "text": "If A > B and B > C then A > C; compute 24 * 7 + 15 = 183."},
    {"id": "th_mem", "lang": "th", "text": "หน่วยความจำระยะยาวต้องแยกตาม tenantId และ userId อย่างเคร่งครัด"},
]


def _get_process_rss_mb() -> float:
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as sf:
            for line in sf:
                if line.startswith("VmRSS:"):
                    kb = int(line.split()[1])
                    return round(kb / 1024.0, 2)
    except Exception:
        pass
    try:
        import resource
        return round((int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) * 1024) / (1024.0 * 1024.0), 2)
    except Exception:
        return 0.0


def evaluate_tokenizer(tok: SovereignTokenizer) -> Dict[str, Any]:
    t0 = time.perf_counter()
    total_tokens = 0
    total_unk = 0
    exact_roundtrips = 0
    per_probe: List[Dict[str, Any]] = []
    thai_roundtrips = 0
    thai_total = 0
    en_roundtrips = 0
    en_total = 0

    unk_id = tok.token_to_id.get("[UNK]", 3)

    for probe in BILINGUAL_EVAL_PROBES:
        txt = probe["text"]
        p0 = time.perf_counter()
        ids = tok.encode(txt)
        dec = tok.decode(ids)
        dt_ms = round((time.perf_counter() - p0) * 1000.0, 3)
        unk_cnt = sum(1 for tid in ids if tid == unk_id)
        exact = dec.strip() == txt.strip()
        total_tokens += len(ids)
        total_unk += unk_cnt
        if exact:
            exact_roundtrips += 1
        if probe["lang"] in ("th", "mixed"):
            thai_total += 1
            if exact:
                thai_roundtrips += 1
        if probe["lang"] in ("en", "mixed"):
            en_total += 1
            if exact:
                en_roundtrips += 1
        per_probe.append({
            "id": probe["id"],
            "lang": probe["lang"],
            "chars": len(txt),
            "tokens": len(ids),
            "unk_count": unk_cnt,
            "exact_roundtrip": exact,
            "latency_ms": dt_ms,
        })

    elapsed_s = max(time.perf_counter() - t0, 1e-6)
    unk_rate = round(total_unk / max(1, total_tokens), 6)
    roundtrip_accuracy = round(exact_roundtrips / max(1, len(BILINGUAL_EVAL_PROBES)), 4)

    return {
        "status": "PASS" if unk_rate == 0.0 and roundtrip_accuracy == 1.0 else "FAIL",
        "tokenizer_profile": getattr(tok, "profile", "v2_base"),
        "vocab_size": tok.vocab_size,
        "probes_count": len(BILINGUAL_EVAL_PROBES),
        "total_tokens": total_tokens,
        "total_unk": total_unk,
        "unk_rate": unk_rate,
        "roundtrip_exact_count": exact_roundtrips,
        "roundtrip_accuracy": roundtrip_accuracy,
        "thai_roundtrip_accuracy": round(thai_roundtrips / max(1, thai_total), 4),
        "english_roundtrip_accuracy": round(en_roundtrips / max(1, en_total), 4),
        "tokenizer_tok_per_sec": round(total_tokens / elapsed_s, 1),
        "elapsed_ms": round(elapsed_s * 1000.0, 2),
        "probes": per_probe,
    }


def evaluate_native_runtime(
    model: Optional[Any] = None,
    boot_error: Optional[str] = None,
) -> Dict[str, Any]:
    tok = getattr(model, "tokenizer", None) or SovereignTokenizer(16384)
    tok_eval = evaluate_tokenizer(tok)
    rss_before = _get_process_rss_mb()

    rt_state = getattr(model, "runtime_state", None)
    if rt_state is None:
        err_u = (boot_error or "").upper()
        if "NOT_CONFIGURED" in err_u or "NEITHER CHECKPOINT_PRESIGNED_URL NOR S3_BUCKET" in err_u:
            rt_state = "NOT_CONFIGURED"
        elif "NOT_FOUND" in err_u or "HTTP 404" in err_u:
            rt_state = "NOT_FOUND"
        elif boot_error:
            rt_state = "FAILED"
        else:
            rt_state = "NOT_LOADED"

    runtime_verification = {
        "runtime_state": rt_state,
        "weights_loaded": bool(getattr(model, "weights_loaded", False)),
        "execution_verified": bool(getattr(model, "execution_verified", False)),
        "tensor_validation_ok": bool(getattr(model, "tensor_validation_ok", False)),
        "trained_provenance": bool(getattr(model, "trained_provenance", False)),
        "trained_provenance_reason": getattr(model, "trained_provenance_reason", None),
        "weights_role": getattr(model, "weights_role", "unloaded"),
        "weights_source": getattr(model, "weights_source", None),
        "checkpoint_sha256": getattr(model, "checkpoint_hash", None) or None,
        "total_params": getattr(getattr(model, "config", None), "total_params", 0) if getattr(model, "weights_loaded", False) else 0,
        "boot_error": boot_error or getattr(model, "execution_verification_error", None),
    }

    hardware = {
        "python_version": platform.python_version(),
        "machine": platform.machine(),
        "system": platform.system(),
        "cpu_count": os.cpu_count() or 1,
        "rss_mb_before": rss_before,
    }

    provenance = {
        "dataset_version": "bilingual_eval_probes_v1",
        "dataset_sha256": hashlib.sha256(json.dumps(BILINGUAL_EVAL_PROBES, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest(),
        "checkpoint_sha256": runtime_verification["checkpoint_sha256"],
        "runtime_version": "zyntheor-batch27-py-1.0",
        "hardware": hardware,
        "config": {
            "max_new_tokens_probe": 12,
            "temperature": 0.0,
            "seed": 42,
        },
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    if model is None or not getattr(model, "weights_loaded", False) or not getattr(model, "execution_verified", False) or rt_state != "READY":
        return {
            "status": "PARTIAL_BLOCKED",
            "tokenizer": tok_eval,
            "runtime_verification": runtime_verification,
            "inference": {
                "status": "BLOCKED",
                "reason": runtime_verification["boot_error"] or f"Runtime state is {rt_state} — verified READY model required for native inference benchmarks.",
                "metrics": None,
            },
            "reasoning_separation": {
                "status": "BLOCKED",
                "reason": f"Runtime state is {rt_state}",
                "native_model_logits_proven": False,
                "orchestrator_structured_distinct": False,
            },
            "provenance": provenance,
            "rss_mb_after": _get_process_rss_mb(),
        }

    # Live model forward-pass & streaming inference benchmark
    lm_instance, _, _ = model._resolve_active_lm()
    nll_val: Optional[float] = None
    ppl_val: Optional[float] = None
    next_tok_acc: Optional[float] = None
    thai_metrics: Optional[Dict[str, Any]] = None
    english_metrics: Optional[Dict[str, Any]] = None
    context_clamped_ok = False
    finite_logits_all = True
    eval_errors = 0
    eval_attempts = 0

    if lm_instance is not None:
        # Real cross-entropy NLL/PPL over bilingual evaluation probes on active LM
        total_loss = 0.0
        total_pos = 0
        top1_hits = 0
        th_loss, th_pos, th_hits = 0.0, 0, 0
        en_loss, en_pos, en_hits = 0.0, 0, 0
        ctx = max(2, int(lm_instance.cfg.ctx))
        vocab = int(lm_instance.cfg.vocab)

        for probe in BILINGUAL_EVAL_PROBES:
            eval_attempts += 1
            try:
                ids = [tid if 0 <= tid < vocab else 3 for tid in model.tokenizer.encode(probe["text"])]
                if len(ids) < 2:
                    continue
                win = ids[: min(len(ids), ctx + 1)]
                x = win[:-1]
                y = win[1:]
                logits, _ = lm_instance.forward_seq(x, keep_cache=False)
                for t_idx, tgt in enumerate(y):
                    row = logits[t_idx]
                    if not all(math.isfinite(float(v)) for v in row):
                        finite_logits_all = False
                        break
                    m_val = max(float(v) for v in row)
                    exps = [math.exp(float(v) - m_val) for v in row]
                    s_exp = sum(exps)
                    p_tgt = max(exps[tgt] / max(s_exp, 1e-12), 1e-12)
                    step_nll = -math.log(p_tgt)
                    is_hit = int(max(range(len(row)), key=lambda idx: row[idx])) == tgt
                    total_loss += step_nll
                    if is_hit:
                        top1_hits += 1
                    total_pos += 1
                    if probe["lang"] == "th":
                        th_loss += step_nll
                        th_pos += 1
                        if is_hit:
                            th_hits += 1
                    elif probe["lang"] == "en":
                        en_loss += step_nll
                        en_pos += 1
                        if is_hit:
                            en_hits += 1
            except Exception:
                eval_errors += 1

        if total_pos > 0:
            nll_val = round(total_loss / total_pos, 4)
            ppl_val = round(math.exp(min(nll_val, 20.0)), 4)
            next_tok_acc = round(top1_hits / total_pos, 4)
        if th_pos > 0:
            th_nll = round(th_loss / th_pos, 4)
            thai_metrics = {
                "nll": th_nll,
                "perplexity": round(math.exp(min(th_nll, 20.0)), 4),
                "next_token_accuracy": round(th_hits / th_pos, 4),
                "positions": th_pos,
            }
        if en_pos > 0:
            en_nll = round(en_loss / en_pos, 4)
            english_metrics = {
                "nll": en_nll,
                "perplexity": round(math.exp(min(en_nll, 20.0)), 4),
                "next_token_accuracy": round(en_hits / en_pos, 4),
                "positions": en_pos,
            }

        # Context-length boundary check
        long_prompt = ("ZYNTHEOR context test " * 40).strip()
        long_events = list(
            model.stream_generate_with_meta(
                long_prompt,
                role="chat",
                correlation_id="b27_ctx_probe",
                max_new_tokens=4,
                temperature=0.0,
                seed=42,
            )
        )
        done_ctx = next((e for e in long_events if e.get("type") == "done"), {})
        context_clamped_ok = bool(
            done_ctx.get("effective_context_len", 0) <= ctx
            and (done_ctx.get("input_tokens_count", 0) <= ctx or done_ctx.get("prompt_truncated") is True)
        )

    # Streaming TTFT & tok/s & determinism probe
    stream_runs: List[Dict[str, Any]] = []
    for run_idx in range(2):
        eval_attempts += 1
        t_start = time.perf_counter()
        t_first: Optional[float] = None
        chunks: List[str] = []
        done_meta: Dict[str, Any] = {}
        try:
            for ev in model.stream_generate_with_meta(
                "ระบบ ZYNTHEOR Sovereign NativeLM",
                role="chat",
                correlation_id=f"b27_stream_{run_idx}",
                max_new_tokens=12,
                temperature=0.0,
                seed=42,
            ):
                if ev.get("type") == "chunk":
                    if t_first is None:
                        t_first = time.perf_counter()
                    chunks.append(ev.get("text", ""))
                elif ev.get("type") == "done":
                    done_meta = ev
        except Exception:
            eval_errors += 1
        total_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
        ttft_ms = round((t_first - t_start) * 1000.0, 2) if t_first is not None else total_ms
        stream_runs.append({
            "run": run_idx + 1,
            "ttft_ms": ttft_ms,
            "latency_ms": total_ms,
            "tokens_per_sec": done_meta.get("tokens_per_sec", 0.0),
            "output_tokens": done_meta.get("output_tokens_count", 0),
            "text": "".join(chunks),
            "inference_origin": done_meta.get("inference_origin"),
        })

    deterministic_exact = (
        len(stream_runs) == 2
        and stream_runs[0]["text"] == stream_runs[1]["text"]
    )

    # Reasoning vs orchestrator separation proof (+ SymbolicVerifier deterministic check)
    chat_res = model.generate("ระบบ ZYNTHEOR", role="chat", max_tokens=8, temperature=0.0)
    plan_res = model.generate("Goal: Build validator\nPriority: High", role="planner", max_tokens=64)
    from qplus_native.reasoning_engine import SymbolicVerifier
    arith_valid = SymbolicVerifier.verify_arithmetic_chain(
        [("*", 24.0, 7.0, 168.0), ("+", 168.0, 15.0, 183.0)], 183.0
    )
    arith_rejects_bad = not SymbolicVerifier.verify_arithmetic_chain(
        [("*", 24.0, 7.0, 168.0), ("+", 168.0, 15.0, 999.0)], 999.0
    )
    causal_valid = SymbolicVerifier.verify_causal_plan(
        {"intake": [], "analyze": ["intake"], "build": ["analyze"], "verify": ["build"]},
        ["intake", "analyze", "build", "verify"],
    )
    causal_rejects_cycle = not SymbolicVerifier.verify_causal_plan(
        {"intake": [], "analyze": ["intake"], "build": ["analyze"]},
        ["build", "analyze", "intake"],
    )
    symbolic_ok = bool(arith_valid and arith_rejects_bad and causal_valid and causal_rejects_cycle)

    separation_ok = (
        chat_res.get("inference_origin") in ("native_model_logits", "orchestrator_structured")
        and plan_res.get("inference_origin") == "orchestrator_structured"
        and symbolic_ok
        and (
            chat_res.get("inference_origin") == "native_model_logits"
            if lm_instance is not None
            else True
        )
    )

    rss_after = _get_process_rss_mb()
    avg_ttft = round(sum(r["ttft_ms"] for r in stream_runs) / max(1, len(stream_runs)), 2)
    avg_lat = round(sum(r["latency_ms"] for r in stream_runs) / max(1, len(stream_runs)), 2)
    avg_tps = round(sum(float(r["tokens_per_sec"]) for r in stream_runs) / max(1, len(stream_runs)), 2)
    runtime_error_rate = round(eval_errors / max(1, eval_attempts), 4)

    return {
        "status": "PASS" if (finite_logits_all and separation_ok and eval_errors == 0) else "FAIL",
        "tokenizer": tok_eval,
        "runtime_verification": runtime_verification,
        "inference": {
            "status": "PASS" if (finite_logits_all and eval_errors == 0) else "FAIL",
            "metrics": {
                "nll": nll_val,
                "perplexity": ppl_val,
                "next_token_accuracy": next_tok_acc,
                "thai_metrics": thai_metrics,
                "english_metrics": english_metrics,
                "first_token_latency_ms": avg_ttft,
                "end_to_end_latency_ms": avg_lat,
                "tokens_per_sec": avg_tps,
                "runtime_error_rate": runtime_error_rate,
                "deterministic_greedy_parity": deterministic_exact,
                "finite_logits_all": finite_logits_all,
                "context_window_bounded": context_clamped_ok,
                "rss_mb_before": rss_before,
                "rss_mb_after": rss_after,
                "rss_delta_mb": round(rss_after - rss_before, 2),
            },
            "runs": stream_runs,
        },
        "reasoning_separation": {
            "status": "PASS" if separation_ok else "FAIL",
            "chat_inference_origin": chat_res.get("inference_origin"),
            "planner_inference_origin": plan_res.get("inference_origin"),
            "weights_role": model.weights_role,
            "native_model_logits_proven": chat_res.get("inference_origin") == "native_model_logits",
            "orchestrator_structured_distinct": plan_res.get("inference_origin") == "orchestrator_structured",
            "orchestrator_symbolic_verifier": {
                "arithmetic_chain_verified": arith_valid and arith_rejects_bad,
                "causal_dag_verified": causal_valid and causal_rejects_cycle,
            },
        },
        "provenance": provenance,
        "rss_mb_after": rss_after,
    }


if __name__ == "__main__":
    try:
        from qplus_native.model import NativeNeuralModel
        m = NativeNeuralModel()
        print(json.dumps(evaluate_native_runtime(model=m), ensure_ascii=False, indent=2))
    except Exception as exc:
        print(json.dumps(evaluate_native_runtime(model=None, boot_error=str(exc)), ensure_ascii=False, indent=2))
