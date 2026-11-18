# -*- coding: utf-8 -*-
"""Verify SHA-256 hash and parameter count of native_data/model_checkpoint_target_41m.pt.

Supports PyTorch checkpoints (`torch.load(..., weights_only=True)`), `safetensors`
files (`safetensors.safe_open`), and ZYNTHEOR native `ZYNTHEOR_QPLUS_PT` containers,
and outputs a formatted console summary checking against the 41,527,808 target.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.architecture import TARGET_TOTAL_PARAMS
from qplus_native.candidate_audit import MAGIC as ZYNTHEOR_MAGIC, inspect_checkpoint

DEFAULT_CHECKPOINT_PATH = Path("native_data/model_checkpoint_target_41m.pt")
CHUNK_SIZE = 65536


def calculate_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _count_torch_params(obj: Any, *, seen_ptrs: Optional[set[int]] = None) -> int:
    if seen_ptrs is None:
        seen_ptrs = set()

    # torch.nn.Module-like
    if hasattr(obj, "parameters") and callable(obj.parameters):
        total = 0
        for param in obj.parameters():
            data_ptr = param.data_ptr() if hasattr(param, "data_ptr") else id(param)
            if data_ptr in seen_ptrs:
                continue
            seen_ptrs.add(data_ptr)
            total += int(param.numel())
        return total

    # torch.Tensor-like
    if hasattr(obj, "numel") and callable(obj.numel) and hasattr(obj, "shape"):
        data_ptr = obj.data_ptr() if hasattr(obj, "data_ptr") else id(obj)
        if data_ptr in seen_ptrs:
            return 0
        seen_ptrs.add(data_ptr)
        return int(obj.numel())

    if isinstance(obj, dict):
        for key in ("state_dict", "model_state_dict", "model", "weights", "params"):
            if key in obj and isinstance(obj[key], dict):
                return _count_torch_params(obj[key], seen_ptrs=seen_ptrs)
        return sum(_count_torch_params(v, seen_ptrs=seen_ptrs) for v in obj.values())

    if isinstance(obj, (list, tuple)):
        return sum(_count_torch_params(v, seen_ptrs=seen_ptrs) for v in obj)

    return 0


def _inspect_with_safetensors(path: Path) -> Tuple[Optional[int], str, List[str]]:
    errors: List[str] = []
    try:
        from safetensors import safe_open  # type: ignore
    except ImportError as exc:
        return None, "safetensors_unavailable", [f"safetensors not installed: {exc}"]

    try:
        total = 0
        with safe_open(str(path), framework="pt", device="cpu") as fh:  # type: ignore[arg-type]
            for key in fh.keys():
                slice_obj = fh.get_slice(key)
                shape = slice_obj.get_shape()
                total += math.prod(int(dim) for dim in shape)
        return int(total), "safetensors", errors
    except Exception:
        # Retry framework="np" or fallback to raw JSON header parsing if torch isn't installed
        try:
            with path.open("rb") as fh:
                header_len_bytes = fh.read(8)
                if len(header_len_bytes) != 8:
                    return None, "safetensors", ["invalid safetensors header"]
                header_len = int.from_bytes(header_len_bytes, "little")
                header = json.loads(fh.read(header_len).decode("utf-8"))
            total = 0
            for k, meta in header.items():
                if k == "__metadata__" or not isinstance(meta, dict):
                    continue
                shape = meta.get("shape") or []
                total += math.prod(int(dim) for dim in shape)
            return int(total), "safetensors", errors
        except Exception as exc:
            return None, "safetensors", [f"safetensors inspection failed: {exc}"]


def _inspect_with_torch(path: Path) -> Tuple[Optional[int], str, List[str]]:
    try:
        import torch  # type: ignore
    except ImportError as exc:
        return None, "torch_unavailable", [f"torch not installed: {exc}"]

    try:
        try:
            payload = torch.load(str(path), map_location="cpu", weights_only=True)
        except TypeError:
            payload = torch.load(str(path), map_location="cpu")
        total = _count_torch_params(payload)
        if total <= 0:
            return None, "torch", ["no tensor parameters found in PyTorch checkpoint"]
        return int(total), "torch", []
    except Exception as exc:
        return None, "torch", [f"torch.load failed: {exc}"]


def inspect_target_checkpoint(
    checkpoint_path: Path | str = DEFAULT_CHECKPOINT_PATH,
    *,
    target_params: int = TARGET_TOTAL_PARAMS,
) -> Dict[str, Any]:
    raw_path = Path(checkpoint_path)
    resolved_path = raw_path if raw_path.is_absolute() else (ROOT / raw_path)

    if not resolved_path.is_file():
        return {
            "status": "MISSING",
            "exists": False,
            "checkpoint_path": str(raw_path),
            "resolved_path": str(resolved_path),
            "file_bytes": 0,
            "sha256": None,
            "loader": None,
            "parameter_count": None,
            "target_params": int(target_params),
            "matches_target": False,
            "errors": [f"checkpoint file not found: {resolved_path}"],
        }

    file_bytes = resolved_path.stat().st_size
    sha256_hex = calculate_sha256(resolved_path)
    errors: List[str] = []
    param_count: Optional[int] = None
    loader: Optional[str] = None

    with resolved_path.open("rb") as fh:
        head = fh.read(len(ZYNTHEOR_MAGIC))

    if resolved_path.suffix.lower() == ".safetensors":
        param_count, loader, sub_errors = _inspect_with_safetensors(resolved_path)
        errors.extend(sub_errors)
    elif head == ZYNTHEOR_MAGIC:
        audit = inspect_checkpoint(resolved_path)
        loader = "zyntheor_qplus_pt"
        if audit.get("integrity_status") != "STRUCTURAL_CHECKS_PASS":
            errors.extend(audit.get("errors") or ["zyntheor structural audit failed"])
        else:
            manifest_count = audit.get("parameter_count_from_manifest")
            meta_count = (audit.get("metadata") or {}).get("total_params")
            if isinstance(manifest_count, int):
                param_count = manifest_count
            elif isinstance(meta_count, int):
                param_count = meta_count
            else:
                errors.append("parameter count missing from ZYNTHEOR checkpoint metadata")
    else:
        param_count, loader, torch_errors = _inspect_with_torch(resolved_path)
        if param_count is None:
            errors.extend(torch_errors)
            st_count, st_loader, st_errors = _inspect_with_safetensors(resolved_path)
            if st_count is not None:
                param_count = st_count
                loader = st_loader
                errors.clear()
            else:
                errors.extend(st_errors)

    matches_target = isinstance(param_count, int) and param_count == int(target_params)
    if isinstance(param_count, int) and not matches_target:
        errors.append(
            f"parameter count mismatch: got {param_count:,}, expected {int(target_params):,}"
        )

    verified = bool(param_count is not None and matches_target and not errors)
    return {
        "status": "VERIFIED" if verified else "FAILED",
        "exists": True,
        "checkpoint_path": str(raw_path),
        "resolved_path": str(resolved_path),
        "file_bytes": file_bytes,
        "sha256": sha256_hex,
        "loader": loader,
        "parameter_count": param_count,
        "target_params": int(target_params),
        "matches_target": matches_target,
        "errors": list(dict.fromkeys(errors)),
    }


def format_summary(report: Dict[str, Any]) -> str:
    param_str = (
        f"{report['parameter_count']:,}"
        if isinstance(report["parameter_count"], int)
        else "N/A"
    )
    match_label = (
        "YES (MATCHES 41,527,808 TARGET)"
        if report["matches_target"] and report["target_params"] == TARGET_TOTAL_PARAMS
        else ("YES (MATCHES TARGET)" if report["matches_target"] else "NO")
    )
    lines = [
        "==========================================================",
        "  ZYNTHEOR Checkpoint SHA-256 & Parameter Count Summary",
        "==========================================================",
        f"  Checkpoint      : {report['checkpoint_path']}",
        f"  Resolved Path   : {report['resolved_path']}",
        f"  File Exists     : {report['exists']}",
        f"  File Size       : {report['file_bytes']:,} bytes",
        f"  SHA-256         : {report['sha256'] or 'N/A (file missing)'}",
        f"  Inspector       : {report['loader'] or 'N/A'}",
        f"  Parameter Count : {param_str}",
        f"  Target Count    : {report['target_params']:,}",
        f"  Target Match    : {match_label}",
        f"  Status          : {report['status']}",
        "==========================================================",
    ]
    if report["errors"]:
        lines.append("  Details:")
        for err in report["errors"]:
            lines.append(f"    - {err}")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Calculate SHA-256 hash and verify parameter count of a checkpoint file."
    )
    parser.add_argument(
        "checkpoint",
        nargs="?",
        default=str(DEFAULT_CHECKPOINT_PATH),
        help="Path to checkpoint file (default: native_data/model_checkpoint_target_41m.pt)",
    )
    parser.add_argument(
        "--target-params",
        type=int,
        default=TARGET_TOTAL_PARAMS,
        help=f"Expected target parameter count (default: {TARGET_TOTAL_PARAMS})",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit summary as JSON",
    )
    args = parser.parse_args(argv)

    report = inspect_target_checkpoint(args.checkpoint, target_params=args.target_params)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_summary(report))

    if report["status"] == "VERIFIED":
        return 0
    if report["status"] == "MISSING":
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
