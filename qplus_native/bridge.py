# -*- coding: utf-8 -*-
"""ZYNTHEOR cloud-native inference bridge.

The bridge accepts only a complete, checksum-verified PureSeqLM checkpoint loaded
from the configured Cloud Runtime. It never instantiates the legacy local model.
"""

import json
import os
import sys
import time
import traceback
from typing import Any, Dict, Optional, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from qplus_native.cloud_storage import load_checkpoint_container_from_cloud, validate_cloud_url
from qplus_native.seq_lm import PureSeqLM
from qplus_native.tokenizer import SovereignTokenizer

runtime_model: Optional[PureSeqLM] = None
runtime_tokenizer: Optional[SovereignTokenizer] = None
runtime_metadata: Dict[str, Any] = {}
runtime_sha256 = ""
runtime_source_uri = ""
runtime_error = "FAIL_CLOSED: Online Connectivity Required — Cloud Runtime is not configured."
runtime_loaded_at: Optional[float] = None


def emit(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def load_runtime(presigned_url: Optional[str] = None) -> Dict[str, Any]:
    """Load a fully validated native sequence model directly from Cloud Runtime memory."""
    global runtime_model, runtime_tokenizer, runtime_metadata
    global runtime_sha256, runtime_source_uri, runtime_error, runtime_loaded_at

    if presigned_url:
        ok, reason = validate_cloud_url(str(presigned_url))
        if not ok:
            raise RuntimeError(reason or "FAIL_CLOSED: Cloud Runtime URL rejected")
        os.environ["CHECKPOINT_PRESIGNED_URL"] = str(presigned_url)

    timeout_s = float(os.environ.get("ZYNTHEOR_CLOUD_CONNECT_TIMEOUT", "8"))
    meta, _payload, payload_sha, raw, source_uri = load_checkpoint_container_from_cloud(
        timeout_s=max(1.0, min(timeout_s, 30.0))
    )
    model, decoded_meta = PureSeqLM.from_bytes(raw, tok=None)
    profile = decoded_meta.get("tokenizer_profile", "v2_base")
    merges = decoded_meta.get("bpe_merges") or []
    tokenizer = SovereignTokenizer(
        vocab_size=max(16384, model.cfg.vocab),
        profile=profile,
        bpe_merges=merges,
    )
    if decoded_meta.get("total_params") != model.num_params():
        raise RuntimeError("FAIL_CLOSED: Native graph parameter count differs from verified checkpoint")
    if not payload_sha or payload_sha != decoded_meta.get("sha256"):
        raise RuntimeError("FAIL_CLOSED: Cloud payload checksum metadata mismatch")

    runtime_model = model
    runtime_tokenizer = tokenizer
    runtime_metadata = decoded_meta
    runtime_sha256 = payload_sha
    runtime_source_uri = source_uri
    runtime_error = ""
    runtime_loaded_at = time.time()
    return runtime_status()


def runtime_status() -> Dict[str, Any]:
    if runtime_model is None or runtime_tokenizer is None:
        return {
            "status": "fail_closed",
            "model_name": "ZYNTHEOR Native Core",
            "architecture": "UNAVAILABLE",
            "total_params": 0,
            "active_params": 0,
            "target_params": runtime_metadata.get("target_total_params"),
            "checkpoint_hash": "",
            "weights_loaded": False,
            "inference_ready": False,
            "online_connectivity_required": True,
            "runtime_state": "BLOCKED",
            "readiness_reason": runtime_error or "FAIL_CLOSED: Online Connectivity Required",
            "source_uri": None,
        }
    return {
        "status": "ok",
        "model_name": runtime_metadata.get("model_name", "ZYNTHEOR Native Core"),
        "architecture": runtime_metadata.get("architecture", "PureSeqLM"),
        "total_params": runtime_model.num_params(),
        "active_params": runtime_model.num_params(),
        "target_params": runtime_metadata.get("target_total_params"),
        "checkpoint_hash": runtime_sha256,
        "weights_loaded": True,
        "inference_ready": True,
        "online_connectivity_required": True,
        "runtime_state": "READY",
        "readiness_reason": "Complete checksum-verified PureSeqLM loaded from Cloud Runtime.",
        "source_uri": runtime_source_uri,
        "loaded_at": runtime_loaded_at,
        "training_steps": runtime_metadata.get("training_steps"),
    }


def fail_closed(req_id: Any, action: str) -> Dict[str, Any]:
    reason = runtime_error or "FAIL_CLOSED: Online Connectivity Required"
    return {"id": req_id, "error": f"FAIL_CLOSED: Online Connectivity Required — {action} blocked. {reason}"}


def generate_ids(prompt: str, max_tokens: int, temperature: float) -> Tuple[str, int, int, float, float]:
    if runtime_model is None or runtime_tokenizer is None:
        raise RuntimeError(runtime_error or "FAIL_CLOSED: Online Connectivity Required")
    prompt_ids = runtime_tokenizer.encode(prompt)
    if not prompt_ids:
        prompt_ids = [1]
    prompt_ids = prompt_ids[-runtime_model.cfg.ctx:]
    limit = max(1, min(int(max_tokens), 512))
    temp = max(0.0, min(float(temperature), 1.5))
    start = time.perf_counter()
    output_ids = list(runtime_model.generate_ids_stream(
        prompt_ids,
        max_new_tokens=limit,
        temperature=temp,
        stop_ids={runtime_tokenizer.token_to_id.get("[EOS]", 2)},
    ))
    elapsed = max(time.perf_counter() - start, 1e-9)
    text = runtime_tokenizer.decode(output_ids, skip_instruction_markers=True)
    rate = len(output_ids) / elapsed
    return text, len(prompt_ids), len(output_ids), elapsed * 1000, rate


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
            cmd = req.get("cmd")
            params = req.get("params") or {}

            if cmd == "ping":
                emit({"id": req_id, **runtime_status()})
            elif cmd == "connectivity_check":
                emit({
                    "id": req_id,
                    "online": bool(runtime_model is not None),
                    "online_connectivity_required": True,
                    "weights_loaded": bool(runtime_model is not None),
                    "runtime_state": "READY" if runtime_model is not None else "BLOCKED",
                    "reason": runtime_error or None,
                    "source_uri": runtime_source_uri or None,
                })
            elif cmd in ("connectivity_reconnect", "reload_cloud_checkpoint"):
                try:
                    result = load_runtime(params.get("presignedUrl") or params.get("presigned_url"))
                    emit({"id": req_id, "success": True, "online": True, "weightsLoaded": True, **result})
                except Exception as exc:
                    runtime_error = str(exc)
                    if "FAIL_CLOSED" not in runtime_error:
                        runtime_error = f"FAIL_CLOSED: Online Connectivity Required — {runtime_error}"
                    emit({"id": req_id, "success": False, "online": False, "weightsLoaded": False, "error": runtime_error, **runtime_status()})
            elif cmd == "tokenize":
                if runtime_tokenizer is None:
                    emit(fail_closed(req_id, "tokenization"))
                else:
                    tokens = runtime_tokenizer.encode(str(params.get("text", "")))
                    emit({"id": req_id, "tokens": tokens, "count": len(tokens)})
            elif cmd == "generate":
                try:
                    prompt = str(params.get("prompt", ""))
                    text, input_count, output_count, latency_ms, rate = generate_ids(
                        prompt,
                        params.get("max_tokens", 128),
                        params.get("temperature", 0.7),
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
                        "runtime_state": "READY",
                    })
                except Exception as exc:
                    emit({"id": req_id, "error": str(exc)})
            elif cmd == "stream_generate":
                if runtime_model is None or runtime_tokenizer is None:
                    emit(fail_closed(req_id, "inference"))
                else:
                    prompt = str(params.get("prompt", ""))
                    prompt_ids = runtime_tokenizer.encode(prompt) or [1]
                    prompt_ids = prompt_ids[-runtime_model.cfg.ctx:]
                    max_tokens = max(1, min(int(params.get("max_tokens", 128)), 512))
                    temperature = max(0.0, min(float(params.get("temperature", 0.7)), 1.5))
                    generated = []
                    previous_text = ""
                    pending_tail = ""
                    started = time.perf_counter()
                    for token_id in runtime_model.generate_ids_stream(
                        prompt_ids,
                        max_new_tokens=max_tokens,
                        temperature=temperature,
                        stop_ids={runtime_tokenizer.token_to_id.get("[EOS]", 2)},
                    ):
                        generated.append(token_id)
                        full_text = runtime_tokenizer.decode(generated, skip_instruction_markers=True)
                        delta = full_text[len(previous_text):] if full_text.startswith(previous_text) else full_text
                        previous_text = full_text
                        safe, pending_tail = runtime_tokenizer.split_thai_safe_stream_prefix(pending_tail + delta, flush=False)
                        if safe:
                            emit({"id": req_id, "type": "chunk", "text": safe, "correlation_id": params.get("correlation_id")})
                    if pending_tail:
                        emit({"id": req_id, "type": "chunk", "text": pending_tail, "correlation_id": params.get("correlation_id")})
                    emit({
                        "id": req_id,
                        "type": "done",
                        "correlation_id": params.get("correlation_id"),
                        "output_tokens_count": len(generated),
                        "tokens_per_sec": round(len(generated) / max(time.perf_counter() - started, 1e-9), 3),
                    })
            elif cmd == "inspect_checkpoint":
                if runtime_model is None:
                    emit(fail_closed(req_id, "checkpoint inspection"))
                else:
                    emit({"id": req_id, "exists": True, "status": "CLOUD_CHECKPOINT_VERIFIED", "metadata": runtime_metadata, "payload_sha256": runtime_sha256, "source_uri": runtime_source_uri, "payload_bytes": runtime_metadata.get("payload_bytes")})
            elif cmd in ("train_step", "export_checkpoint"):
                emit({"id": req_id, "error": "BLOCKED: training/export requires a verified dataset, a separate Native PureSeqLM training pipeline, and an approved human authorization record."})
            elif cmd in ("verify_suite", "verify_language_integrity", "self_evolve", "get_memory"):
                emit({"id": req_id, "error": "NOT_IMPLEMENTED: this operation is not wired to evidence-backed Native PureSeqLM runtime yet."})
            else:
                emit({"id": req_id, "error": f"Unknown command: {cmd}"})
        except Exception as exc:
            emit({"id": req.get("id"), "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
