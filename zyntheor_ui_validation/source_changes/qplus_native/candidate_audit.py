# -*- coding: utf-8 -*-
"""Raw-byte candidate checkpoint audit; does not execute model inference or training."""
from __future__ import annotations

import hashlib
import json
import math
import struct
from pathlib import Path
from typing import Any, Dict, List, Tuple

MAGIC = b"ZYNTHEOR_QPLUS_PT"
RUNTIME_STORAGE_MODES = {"LEARNED_WEIGHTS_TRAINED_V2", "LEARNED_WEIGHTS_SEQ_PURE_PY"}


def expected_parameter_shapes(config: Dict[str, Any]) -> Dict[str, Tuple[int, ...]]:
    v, d, f, layers, ctx = (int(config[k]) for k in ("vocab", "d_model", "d_ffn", "n_layers", "ctx"))
    if min(v, d, f, layers, ctx) <= 0:
        raise ValueError("invalid model dimensions")
    shapes: Dict[str, Tuple[int, ...]] = {"tok_emb": (v, d), "pos_emb": (ctx, d)}
    for i in range(layers):
        shapes.update({f"b{i}.norm1": (d,), f"b{i}.wq": (d, d), f"b{i}.wk": (d, d),
                       f"b{i}.wv": (d, d), f"b{i}.wo": (d, d), f"b{i}.norm2": (d,),
                       f"b{i}.w_gate": (d, f), f"b{i}.w_up": (d, f), f"b{i}.w_down": (f, d)})
    shapes["norm_f"] = (d,)
    return shapes


def inspect_checkpoint(path: str | Path) -> Dict[str, Any]:
    p = Path(path)
    if p.stat().st_size > 512 * 1024 * 1024:
        return {"path": str(p), "integrity_status": "BLOCKED", "runtime_compatibility": "BLOCKED",
                "inference_executed": False, "quality_status": "NOT_EVALUATED", "errors": ["checkpoint exceeds 512 MiB audit limit"]}
    raw = p.read_bytes()
    result: Dict[str, Any] = {"path": str(p), "container_bytes": len(raw),
        "container_sha256": hashlib.sha256(raw).hexdigest(), "format": "UNKNOWN",
        "integrity_status": "BLOCKED", "runtime_compatibility": "BLOCKED",
        "inference_executed": False, "quality_status": "BLOCKED"}
    if len(raw) < len(MAGIC) + 4 or raw[:len(MAGIC)] != MAGIC:
        result["errors"] = ["checkpoint magic missing"]
        return result
    result["format"] = "ZYNTHEOR_QPLUS_PT"
    meta_len = struct.unpack(">I", raw[len(MAGIC):len(MAGIC) + 4])[0]
    start, end = len(MAGIC) + 4, len(MAGIC) + 4 + meta_len
    if end > len(raw):
        result["errors"] = ["metadata truncated"]
        return result
    try:
        meta = json.loads(raw[start:end].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        result["errors"] = [f"metadata invalid: {exc}"]
        return result
    payload = raw[end:]
    errors: List[str] = []
    if hashlib.sha256(payload).hexdigest() != meta.get("sha256"):
        errors.append("payload sha256 mismatch")
    cfg = meta.get("config")
    if not isinstance(cfg, dict):
        errors.append("model config missing")
        expected = {}
    else:
        try:
            expected = expected_parameter_shapes(cfg)
        except Exception as exc:
            expected = {}
            errors.append(f"model config invalid: {exc}")
    manifest = meta.get("tensors_manifest")
    if not isinstance(manifest, list) or not manifest:
        errors.append("tensor manifest missing")
        manifest = []
    names = [x.get("name") for x in manifest if isinstance(x, dict) and isinstance(x.get("name"), str)]
    if len(names) != len(manifest) or set(names) != set(expected):
        errors.append("tensor names do not match NativeLM v2 graph")
    offset, count, per_tensor_ok = 0, 0, True
    tensor_results = []
    for item in manifest:
        if not isinstance(item, dict):
            errors.append("invalid tensor manifest entry"); per_tensor_ok = False; continue
        name = item.get("name")
        if not isinstance(name, str):
            errors.append("tensor name invalid"); per_tensor_ok = False; continue
        try:
            shape = tuple(int(x) for x in item["shape"])
            n = int(item["params"])
        except Exception:
            errors.append(f"invalid tensor shape/count: {name}"); per_tensor_ok = False; continue
        exp_shape = expected.get(name)
        if not shape or any(dim <= 0 for dim in shape) or n <= 0 or exp_shape is None or shape != exp_shape or n != math.prod(shape):
            errors.append(f"tensor shape/count mismatch: {name}"); per_tensor_ok = False
            continue
        chunk = payload[offset:offset + 4 * n]
        if len(chunk) != 4 * n or hashlib.sha256(chunk).hexdigest() != item.get("sha256"):
            errors.append(f"tensor hash mismatch: {name}"); per_tensor_ok = False
        if len(chunk) == 4 * n:
            for (value,) in struct.iter_unpack("<f", chunk):
                if not math.isfinite(value):
                    errors.append(f"non-finite parameter: {name}"); per_tensor_ok = False; break
        offset += 4 * n
        count += n
        tensor_results.append({"name": name, "shape": list(shape), "parameters": n})
    if offset != len(payload):
        errors.append("manifest byte count differs from payload length")
    if count != meta.get("total_params") or count != meta.get("trained_subgraph_params"):
        errors.append("parameter count differs from metadata")
    if not errors:
        result["integrity_status"] = "STRUCTURAL_CHECKS_PASS"
    mode = meta.get("storage_mode")
    if mode in RUNTIME_STORAGE_MODES and meta.get("architecture") == "ZYNTHEOR-NativeLM-v2-TiedEmbedding-CausalAttention":
        result["runtime_compatibility"] = "PARTIAL_STRUCTURAL_SUPPORT"
    else:
        errors.append("storage mode/architecture not supported by Native runtime path")
    result.update({"errors": errors, "metadata": {k: meta.get(k) for k in (
        "architecture", "storage_mode", "config", "total_params", "trained_subgraph_params",
        "target_total_params", "training_steps_total", "validation_loss", "validation_perplexity",
        "corpus_sha256", "tokenizer_profile", "tokenizer_fingerprint")},
        "payload_bytes": len(payload), "payload_sha256": hashlib.sha256(payload).hexdigest(),
        "tensor_count": len(tensor_results), "parameter_count_from_manifest": count,
        "tensors": tensor_results, "inference_executed": False,
        "quality_status": "NOT_EVALUATED"})
    return result


def main(argv=None):
    import argparse
    import json
    ap = argparse.ArgumentParser(description="Read-only raw-byte Native checkpoint audit (no inference).")
    ap.add_argument("checkpoint")
    args = ap.parse_args(argv)
    result = inspect_checkpoint(args.checkpoint)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("integrity_status") == "STRUCTURAL_CHECKS_PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
