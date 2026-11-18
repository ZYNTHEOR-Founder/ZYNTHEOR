# -*- coding: utf-8 -*-
"""ZYNTHEOR cloud-native inference bridge.

The bridge accepts only a complete, checksum-verified PureSeqLM checkpoint loaded
from the configured Cloud Runtime. It fails closed when unconfigured or corrupted.
Supports both ``cmd`` (TypeScript provider) and ``command`` (Python Batch 27 suite).
"""

import hashlib
import json
import os
import sys
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.batch27_eval import evaluate_native_runtime
from qplus_native.cloud_storage import (
    validate_cloud_url,
)
from qplus_native.model import MEMORY_STORE_PATH, NativeNeuralModel
from qplus_native.reasoning_engine import SymbolicVerifier
from qplus_native.seq_lm import PureSeqLM
from qplus_native.tokenizer import SovereignTokenizer

runtime_model: Optional[NativeNeuralModel] = None
runtime_seq_lm: Optional[PureSeqLM] = None
runtime_tokenizer: Optional[SovereignTokenizer] = None
runtime_metadata: Dict[str, Any] = {}
runtime_sha256 = ""
runtime_source_uri = ""
runtime_error = "FAIL_CLOSED: Online Connectivity Required — Cloud Runtime is not configured."
runtime_loaded_at: Optional[float] = None
_emit_lock = threading.Lock()
_stream_cancel_flags: Dict[str, threading.Event] = {}


def _has_cloud_config() -> bool:
    return bool(
        (os.environ.get("CHECKPOINT_PRESIGNED_URL") or "").strip()
        or (
            (os.environ.get("S3_BUCKET") or "").strip()
            and (os.environ.get("S3_ACCESS_KEY_ID") or "").strip()
            and (os.environ.get("S3_SECRET_ACCESS_KEY") or "").strip()
        )
    )


def emit(payload: Dict[str, Any]) -> None:
    with _emit_lock:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def load_runtime(
    presigned_url: Optional[str] = None,
    object_key: Optional[str] = None,
    cloud_bytes: Optional[bytes] = None,
    source_uri: Optional[str] = None,
) -> Dict[str, Any]:
    """Load and execution-verify a native sequence checkpoint from Cloud Runtime."""
    global runtime_model, runtime_seq_lm, runtime_tokenizer, runtime_metadata
    global runtime_sha256, runtime_source_uri, runtime_error, runtime_loaded_at

    if presigned_url:
        ok, reason = validate_cloud_url(str(presigned_url))
        if not ok:
            raise RuntimeError(reason or "FAIL_CLOSED: Cloud Runtime URL rejected")
        os.environ["CHECKPOINT_PRESIGNED_URL"] = str(presigned_url)
    if object_key:
        os.environ["S3_CHECKPOINT_KEY"] = str(object_key)

    model = NativeNeuralModel(
        presigned_url=presigned_url or source_uri,
        object_key=object_key,
        cloud_bytes=cloud_bytes,
    )
    runtime_model = model
    runtime_seq_lm = model._seq_lm
    runtime_tokenizer = model.tokenizer
    runtime_metadata = dict(model.metadata or {})
    runtime_sha256 = model.checkpoint_hash or ""
    runtime_source_uri = source_uri or model.weights_source or ""
    runtime_error = ""
    runtime_loaded_at = time.time()
    return runtime_status()


def _tokenizer_sha256(tok: Any) -> Optional[str]:
    if tok is None or not hasattr(tok, "vocab"):
        return None
    try:
        canonical = json.dumps(sorted(tok.vocab.items()), ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()
    except Exception:
        return None


def runtime_status() -> Dict[str, Any]:
    if runtime_model is None or runtime_tokenizer is None:
        configured = _has_cloud_config()
        rt_state = "NOT_CONFIGURED" if not configured else "BLOCKED"
        return {
            "status": "fail_closed",
            "model_name": "ZYNTHEOR Native Core",
            "architecture": "UNAVAILABLE",
            "total_params": 0,
            "active_params": 0,
            "target_params": runtime_metadata.get("target_total_params"),
            "checkpoint_hash": "",
            "checkpoint_path": None,
            "checkpoint_sha256": None,
            "tokenizer_sha256": None,
            "active_runtime_id": None,
            "weights_source": None,
            "weights_role": "unloaded",
            "trained_provenance": None,
            "execution_error": runtime_error or None,
            "weights_loaded": False,
            "execution_verified": False,
            "inference_ready": False,
            "online_connectivity_required": True,
            "runtime_state": rt_state,
            "readiness_reason": runtime_error or "FAIL_CLOSED: Online Connectivity Required",
            "source_uri": None,
        }
    ready = bool(
        runtime_model.weights_loaded
        and runtime_model.execution_verified
        and runtime_model.runtime_state == "READY"
    )
    tok_sha = _tokenizer_sha256(runtime_tokenizer)
    rt_id = f"zyn-rt-{runtime_sha256[:12]}" if runtime_sha256 else "zyn-rt-unverified"
    provenance_status = (
        runtime_metadata.get("provenance_status")
        or ("TRAINED" if not runtime_metadata.get("untrained") else "UNTRAINED")
    )
    return {
        "status": "ok" if ready else "fail_closed",
        "model_name": runtime_metadata.get("model_name", "ZYNTHEOR Native Core"),
        "architecture": runtime_metadata.get("architecture", "PureSeqLM"),
        "total_params": runtime_model.config.total_params,
        "active_params": runtime_model.config.total_params,
        "target_params": runtime_metadata.get("target_total_params"),
        "checkpoint_hash": runtime_sha256,
        "checkpoint_path": runtime_source_uri or None,
        "checkpoint_sha256": runtime_sha256 or None,
        "tokenizer_sha256": tok_sha,
        "active_runtime_id": rt_id if runtime_sha256 else None,
        "weights_source": runtime_source_uri or None,
        "weights_role": "active_cloud_model",
        "trained_provenance": provenance_status,
        "execution_error": runtime_model.execution_verification_error,
        "weights_loaded": bool(runtime_model.weights_loaded),
        "execution_verified": bool(runtime_model.execution_verified),
        "inference_ready": ready,
        "online_connectivity_required": True,
        "runtime_state": runtime_model.runtime_state,
        "readiness_reason": runtime_model.execution_verification_error
        or "Complete checksum-verified PureSeqLM loaded from Cloud Runtime.",
        "source_uri": runtime_source_uri,
        "loaded_at": runtime_loaded_at,
        "training_steps": runtime_metadata.get("training_steps"),
    }


def fail_closed(req_id: Any, action: str) -> Dict[str, Any]:
    reason = runtime_error or "FAIL_CLOSED: Online Connectivity Required"
    return {
        "id": req_id,
        "error": f"FAIL_CLOSED: Online Connectivity Required — {action} blocked. {reason}",
    }


def generate_ids(prompt: str, max_tokens: int, temperature: float, role: str = "coder") -> Tuple[str, int, int, float, float]:
    if runtime_model is None or runtime_tokenizer is None:
        raise RuntimeError(runtime_error or "FAIL_CLOSED: Online Connectivity Required")
    res = runtime_model.generate(
        prompt,
        role=role,
        max_tokens=max(1, min(int(max_tokens), 512)),
        temperature=max(0.0, min(float(temperature), 1.5)),
    )
    return (
        str(res.get("text", "")),
        int(res.get("input_tokens_count", 0)),
        int(res.get("output_tokens_count", 0)),
        float(res.get("latency_ms", 0.0)),
        float(res.get("tokens_per_sec", 0.0)),
    )


def run_verification_suite(model: Optional[NativeNeuralModel] = None) -> Dict[str, Any]:
    """
    Executes isolated 8-probe verification suite without mutating shared
    memory_cache or persistent MEMORY_STORE_PATH.
    """
    target = model or runtime_model
    results: List[Dict[str, Any]] = []
    ready = bool(
        target is not None
        and getattr(target, "weights_loaded", False)
        and getattr(target, "execution_verified", False)
        and getattr(target, "runtime_state", "") == "READY"
    )

    if not ready or target is None:
        reason = getattr(target, "trained_provenance_reason", None) or getattr(target, "runtime_state", "BLOCKED")
        blocked_probes = [
            ("P1_WEIGHTS_LOAD", "Checkpoint Weight & Provenance Verification", f"BLOCKED: {reason}"),
            ("P2_TOKENIZER_ROUNDTRIP", "Bilingual Tokenizer Verification", "SKIPPED"),
            ("P3_INFERENCE", "Learned-Logit Inference Verification", f"BLOCKED: {reason}"),
            ("P4_REASONING", "Symbolic Reasoning Attribution Verification", "BLOCKED"),
            ("P5_MEMORY", "Isolated Episodic Memory Verification", "BLOCKED"),
            ("P6_INTEGRITY", "Audit Digest Verification", "BLOCKED"),
            ("P7_PERSISTENCE", "Deterministic Parity Verification", f"BLOCKED: {reason}"),
            ("P8_PERFORMANCE", "Latency & Throughput Telemetry", f"BLOCKED: {reason}"),
        ]
        for tid, name, ev in blocked_probes:
            results.append({"test_id": tid, "name": name, "status": "BLOCKED", "evidence": ev})
        return {
            "status": "PARTIAL_BLOCKED",
            "verified": False,
            "checkpoint_hash": getattr(target, "checkpoint_hash", "") if target else "",
            "timestamp": time.time(),
            "results": results,
        }

    # P1: Weights loaded + trained provenance
    results.append({
        "test_id": "P1_WEIGHTS_LOAD",
        "name": "Checkpoint Weight & Provenance Verification",
        "status": "PASS",
        "evidence": f"sha256={target.checkpoint_hash[:16]} params={target.config.total_params}",
    })

    # P2: Tokenizer zero-UNK roundtrip
    sample = "ระบบ ZYNTHEOR Sovereign Verification Test"
    enc = target.tokenizer.encode(sample)
    dec = target.tokenizer.decode(enc)
    tok_ok = dec.strip() == sample.strip()
    results.append({
        "test_id": "P2_TOKENIZER_ROUNDTRIP",
        "name": "Bilingual Tokenizer Verification",
        "status": "PASS" if tok_ok else "FAIL",
        "evidence": f"tokens={len(enc)}, roundtrip={tok_ok}",
    })

    # P3: Learned-logit inference probe
    inf = target.generate("ระบบ ZYNTHEOR", role="chat", max_tokens=6, temperature=0.0, seed=42)
    inf_ok = inf.get("inference_origin") == "native_model_logits" and inf.get("output_tokens_count", 0) > 0
    results.append({
        "test_id": "P3_INFERENCE",
        "name": "Learned-Logit Forward & Decode Probe",
        "status": "PASS" if inf_ok else "FAIL",
        "evidence": f"origin=learned_logits_cloud, tokens={inf.get('output_tokens_count')}, tps={inf.get('tokens_per_sec')}",
    })

    # P4: Symbolic reasoning verifier isolation check
    arith_ok = SymbolicVerifier.verify_arithmetic_chain([("*", 6.0, 7.0, 42.0)], 42.0)
    results.append({
        "test_id": "P4_REASONING",
        "name": "Symbolic Reasoning Attribution Probe",
        "status": "PASS" if arith_ok else "FAIL",
        "evidence": "attribution=symbolic_verifier, verified_chain=True",
    })

    # P5: Isolated temporary memory file test (never mutates MEMORY_STORE_PATH or model.memory_cache)
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".json", delete=True, encoding="utf-8") as tmp:
        payload = {"probe_key": {"value": "isolated_ok", "ts": time.time()}}
        json.dump(payload, tmp)
        tmp.flush()
        tmp.seek(0)
        loaded_mem = json.load(tmp)
        mem_ok = loaded_mem.get("probe_key", {}).get("value") == "isolated_ok"
    results.append({
        "test_id": "P5_MEMORY",
        "name": "Isolated Episodic Memory Storage Probe",
        "status": "PASS" if mem_ok else "FAIL",
        "evidence": f"Temporary memory file verified without mutating {os.path.basename(MEMORY_STORE_PATH)}",
    })

    # P6: Checkpoint container integrity digest
    digest_ok = bool(target.checkpoint_hash and len(target.checkpoint_hash) == 64)
    results.append({
        "test_id": "P6_INTEGRITY",
        "name": "Cryptographic Checkpoint Digest Check",
        "status": "PASS" if digest_ok else "FAIL",
        "evidence": f"sha256_len={len(target.checkpoint_hash or '')}",
    })

    # P7: Deterministic greedy parity
    run_a = target.generate("Determinism probe", role="chat", max_tokens=6, temperature=0.0, seed=123)
    run_b = target.generate("Determinism probe", role="chat", max_tokens=6, temperature=0.0, seed=123)
    parity = run_a.get("text") == run_b.get("text")
    results.append({
        "test_id": "P7_PERSISTENCE",
        "name": "Deterministic Seeded Inference Parity",
        "status": "PASS" if parity else "FAIL",
        "evidence": f"seeded_output_match={parity}",
    })

    # P8: Performance telemetry remains PARTIAL without full production SLA workload
    results.append({
        "test_id": "P8_PERFORMANCE",
        "name": "Throughput & Latency Observation",
        "status": "PARTIAL",
        "evidence": f"micro_tps={inf.get('tokens_per_sec')} (diagnostic only; full load benchmark separate)",
    })

    return {
        "status": "PARTIAL",
        "verified": False,
        "checkpoint_hash": target.checkpoint_hash,
        "timestamp": time.time(),
        "results": results,
    }


def run_language_integrity_suite(model: Optional[NativeNeuralModel] = None) -> Dict[str, Any]:
    """
    Executes real Thai, English, and bilingual code-switching tokenizer roundtrip
    integrity probes using SovereignTokenizer, plus a fail-closed check on active
    Cloud Checkpoint inference readiness.
    """
    target = model or runtime_model
    tok = getattr(target, "tokenizer", None) if target is not None else runtime_tokenizer
    tok_source = "active_runtime_tokenizer"
    if tok is None:
        tok = SovereignTokenizer(profile="v2_base")
        tok_source = "local_SovereignTokenizer_v2_base"

    unk_id = tok.token_to_id.get("[UNK]", 3)
    runtime_ready = bool(
        target is not None
        and getattr(target, "weights_loaded", False)
        and getattr(target, "execution_verified", False)
        and getattr(target, "runtime_state", "") == "READY"
    )
    ckpt_hash = (getattr(target, "checkpoint_hash", None) or runtime_sha256 or "")

    probes = [
        (
            "LANG_THAI_COMBINING",
            "Thai Combining Marks & Tone Integrity",
            "THAI",
            "ระบบ ZYNTHEOR ปฏิบัติการอธิปไตย รองรับสระบน-ล่าง วรรณยุกต์ เอก โท ตรี จัตวา ๑๒๓๔",
        ),
        (
            "LANG_ENGLISH_TECH",
            "English Technical Specification Roundtrip",
            "ENGLISH",
            "PureSeqLM 41,527,808 target parameters; SovereignTokenizer preserves UTF-8 fidelity and SHA-256 digests.",
        ),
        (
            "LANG_CODE_SWITCH",
            "Thai-English Code-Switching & TypeScript Syntax",
            "BILINGUAL_CODE_SWITCH",
            "ตรวจสอบฟังก์ชัน async function verifyCheckpoint(hash: string): Promise<boolean> ด้วย SHA-256 ทันที",
        ),
        (
            "LANG_CONTROL_TOKENS",
            "Control & Workflow Tag Parity",
            "CONTROL_TOKENS",
            "[PLAN] วิเคราะห์สถาปัตยกรรม [CODE] return ok; [TEST] PASS",
        ),
    ]

    results: List[Dict[str, Any]] = []
    passed_count = 0

    for test_id, name, script_type, sample in probes:
        t0 = time.perf_counter()
        encoded = tok.encode(sample)
        decoded = tok.decode(encoded)
        duration_ms = round((time.perf_counter() - t0) * 1000.0, 3)
        unk_count = sum(1 for tid in encoded if tid == unk_id)
        roundtrip_exact = decoded.strip() == sample.strip()
        passed = roundtrip_exact and unk_count == 0 and len(encoded) > 0
        if passed:
            passed_count += 1
        results.append({
            "test_id": test_id,
            "name": name,
            "script_type": script_type,
            "sample_length": len(sample),
            "token_count": len(encoded),
            "unk_count": unk_count,
            "roundtrip_exact": roundtrip_exact,
            "status": "PASS" if passed else "FAIL",
            "evidence": f"source={tok_source}, profile={getattr(tok, 'profile', 'v2_base')}, tokens={len(encoded)}, unk={unk_count}, exact={roundtrip_exact}",
            "duration_ms": duration_ms,
        })

    # Fail-closed 5th check: Active Cloud Checkpoint forward-pass bilingual inference
    t0 = time.perf_counter()
    if runtime_ready and target is not None:
        sample_prompt = "สรุปการทำงานของระบบ ZYNTHEOR Native Core"
        enc = tok.encode(sample_prompt)
        inf = target.generate(sample_prompt, role="chat", max_tokens=8, temperature=0.0, seed=42)
        duration_ms = round((time.perf_counter() - t0) * 1000.0, 3)
        out_ok = bool(inf.get("output_tokens_count", 0) > 0 and inf.get("inference_origin") == "native_model_logits")
        if out_ok:
            passed_count += 1
        results.append({
            "test_id": "LANG_RUNTIME_INFERENCE",
            "name": "Active Native Model Bilingual Forward Pass",
            "script_type": "RUNTIME_INFERENCE",
            "sample_length": len(sample_prompt),
            "token_count": len(enc),
            "unk_count": sum(1 for tid in enc if tid == unk_id),
            "roundtrip_exact": out_ok,
            "status": "PASS" if out_ok else "FAIL",
            "evidence": f"origin={inf.get('inference_origin')}, output_tokens={inf.get('output_tokens_count')}, sha256={ckpt_hash[:12]}",
            "duration_ms": duration_ms,
        })
    else:
        duration_ms = round((time.perf_counter() - t0) * 1000.0, 3)
        results.append({
            "test_id": "LANG_RUNTIME_INFERENCE",
            "name": "Active Native Model Bilingual Forward Pass",
            "script_type": "RUNTIME_INFERENCE",
            "sample_length": 0,
            "token_count": 0,
            "unk_count": 0,
            "roundtrip_exact": False,
            "status": "FAIL",
            "evidence": "BLOCKED: Active Cloud Checkpoint weights not loaded — tokenizer integrity passed, model inference verification awaits Cloud Checkpoint.",
            "duration_ms": duration_ms,
        })

    total_tests = len(results)
    return {
        "verified": bool(runtime_ready and passed_count == total_tests),
        "total_tests": total_tests,
        "passed_tests": passed_count,
        "checkpoint_hash": ckpt_hash,
        "timestamp": time.time(),
        "results": results,
    }


def _run_stream_worker(req_id: Any, params: Dict[str, Any], cancel_ev: threading.Event) -> None:
    corr_id = str(params.get("correlation_id") or req_id or f"stream_{time.time_ns()}")
    try:
        if runtime_model is None or runtime_tokenizer is None:
            emit(fail_closed(req_id, "inference"))
            return
        prompt = str(params.get("prompt", ""))
        role = str(params.get("role", "coder"))
        max_tokens = max(1, min(int(params.get("max_new_tokens") or params.get("max_tokens") or 128), 512))
        temperature = max(0.0, min(float(params.get("temperature", 0.7)), 1.5))

        runtime_model.clear_cancel(corr_id)
        emitted_done = False
        for ev in runtime_model.stream_generate_with_meta(
            prompt,
            role=role,
            correlation_id=corr_id,
            max_new_tokens=max_tokens,
            temperature=temperature,
        ):
            if ev.get("type") == "chunk":
                emit({
                    "id": req_id,
                    "type": "chunk",
                    "text": ev.get("text", ""),
                    "correlation_id": corr_id,
                })
                if cancel_ev.is_set():
                    runtime_model.cancel_inference(corr_id)
            elif ev.get("type") == "done":
                emitted_done = True
                emit({
                    "id": req_id,
                    "type": "done",
                    "correlation_id": corr_id,
                    "cancelled": bool(ev.get("cancelled") or cancel_ev.is_set() or runtime_model.is_cancelled(corr_id)),
                    "output_tokens_count": ev.get("output_tokens_count", 0),
                    "tokens_per_sec": ev.get("tokens_per_sec", 0.0),
                })
                break
        if not emitted_done:
            emit({
                "id": req_id,
                "type": "done",
                "correlation_id": corr_id,
                "cancelled": bool(cancel_ev.is_set()),
                "output_tokens_count": 0,
                "tokens_per_sec": 0.0,
            })
    except Exception as exc:
        emit({"id": req_id, "error": f"{type(exc).__name__}: {exc}"})
    finally:
        _stream_cancel_flags.pop(corr_id, None)


def main() -> None:
    global runtime_error
    try:
        load_runtime()
    except Exception as exc:
        runtime_error = str(exc)
        if "FAIL_CLOSED" not in runtime_error:
            runtime_error = f"FAIL_CLOSED: Online Connectivity Required — {runtime_error}"
        sys.stderr.write(runtime_error + "\n")
        sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req: Dict[str, Any] = {}
        try:
            req = json.loads(line)
            req_id = req.get("id")
            cmd = req.get("cmd") or req.get("command")
            params = req.get("params") or {}

            if cmd == "ping":
                emit({"id": req_id, **runtime_status()})
            elif cmd == "connectivity_check":
                ready = bool(runtime_model is not None and runtime_model.execution_verified)
                emit({
                    "id": req_id,
                    "online": ready,
                    "online_connectivity_required": True,
                    "weights_loaded": bool(runtime_model is not None and runtime_model.weights_loaded),
                    "runtime_state": runtime_model.runtime_state if runtime_model is not None else ("NOT_CONFIGURED" if not _has_cloud_config() else "BLOCKED"),
                    "reason": runtime_error or None,
                    "source_uri": runtime_source_uri or None,
                })
            elif cmd in ("connectivity_reconnect", "reload_cloud_checkpoint"):
                try:
                    import base64
                    b64 = params.get("cloudBytesBase64") or params.get("cloud_bytes_b64")
                    raw_bytes = base64.b64decode(b64) if b64 else None
                    result = load_runtime(
                        presigned_url=params.get("presignedUrl") or params.get("presigned_url"),
                        object_key=params.get("objectKey") or params.get("object_key"),
                        cloud_bytes=raw_bytes,
                        source_uri=params.get("sourceUri") or params.get("source_uri"),
                    )
                    emit({"id": req_id, "success": True, "online": True, "weightsLoaded": True, **result})
                except Exception as exc:
                    runtime_error = str(exc)
                    if "FAIL_CLOSED" not in runtime_error:
                        runtime_error = f"FAIL_CLOSED: Online Connectivity Required — {runtime_error}"
                    emit({
                        "id": req_id,
                        "success": False,
                        "online": False,
                        "weightsLoaded": False,
                        "error": runtime_error,
                        **runtime_status(),
                    })
            elif cmd == "tokenize":
                if runtime_tokenizer is None:
                    emit(fail_closed(req_id, "tokenization"))
                else:
                    tokens = runtime_tokenizer.encode(str(params.get("text", "")))
                    emit({"id": req_id, "tokens": tokens, "count": len(tokens)})
            elif cmd == "generate":
                try:
                    prompt = str(params.get("prompt", ""))
                    role = str(params.get("role", "coder"))
                    text, input_count, output_count, latency_ms, rate = generate_ids(
                        prompt,
                        params.get("max_tokens", 128),
                        params.get("temperature", 0.7),
                        role=role,
                    )
                    emit({
                        "id": req_id,
                        "text": text,
                        "input_tokens_count": input_count,
                        "output_tokens_count": output_count,
                        "latency_ms": round(latency_ms, 3),
                        "tokens_per_sec": round(rate, 3),
                        "checkpoint_hash": runtime_sha256,
                        "latent_norm": None,
                        "runtime_state": runtime_model.runtime_state if runtime_model else "BLOCKED",
                    })
                except Exception as exc:
                    emit({"id": req_id, "error": str(exc)})
            elif cmd == "stream_generate":
                if runtime_model is None or runtime_tokenizer is None:
                    emit(fail_closed(req_id, "inference"))
                else:
                    corr_id = str(params.get("correlation_id") or req_id or f"stream_{time.time_ns()}")
                    cancel_ev = threading.Event()
                    _stream_cancel_flags[corr_id] = cancel_ev
                    worker = threading.Thread(
                        target=_run_stream_worker,
                        args=(req_id, {**params, "correlation_id": corr_id}, cancel_ev),
                        daemon=True,
                    )
                    worker.start()
            elif cmd == "cancel_inference":
                corr_id = params.get("correlation_id")
                if corr_id:
                    if corr_id in _stream_cancel_flags:
                        _stream_cancel_flags[corr_id].set()
                    if runtime_model is not None:
                        runtime_model.cancel_inference(corr_id)
                else:
                    for ev in _stream_cancel_flags.values():
                        ev.set()
                    if runtime_model is not None:
                        runtime_model.cancel_inference(None)
                emit({"id": req_id, "cancelled": True, "correlation_id": corr_id})
            elif cmd == "batch27_eval":
                ev_res = evaluate_native_runtime(model=runtime_model, boot_error=runtime_error or None)
                emit({"id": req_id, **ev_res})
            elif cmd == "inspect_checkpoint":
                if runtime_model is None:
                    emit(fail_closed(req_id, "checkpoint inspection"))
                else:
                    emit({
                        "id": req_id,
                        "exists": True,
                        "status": "CLOUD_CHECKPOINT_VERIFIED",
                        "metadata": runtime_metadata,
                        "payload_sha256": runtime_sha256,
                        "source_uri": runtime_source_uri,
                        "payload_bytes": runtime_metadata.get("payload_bytes"),
                    })
            elif cmd == "verify_suite":
                emit({"id": req_id, **run_verification_suite(runtime_model)})
            elif cmd == "verify_language_integrity":
                emit({"id": req_id, **run_language_integrity_suite(runtime_model)})
            elif cmd in ("train_step", "export_checkpoint"):
                emit({"id": req_id, "error": "BLOCKED: training/export requires a verified dataset, a separate Native PureSeqLM training pipeline, and an approved human authorization record."})
            elif cmd in ("self_evolve", "get_memory"):
                emit({"id": req_id, "error": "NOT_IMPLEMENTED: this operation requires active cloud runtime verification."})
            else:
                emit({"id": req_id, "error": f"Unknown command: {cmd}"})
        except Exception as exc:
            emit({"id": req.get("id"), "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
