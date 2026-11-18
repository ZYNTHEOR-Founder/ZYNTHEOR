# -*- coding: utf-8 -*-
"""Calculate SHA-256 and verify parameter count of ZYNTHEOR's target 41.5M checkpoint."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.architecture import TARGET_TOTAL_PARAMS
from qplus_native.candidate_audit import inspect_checkpoint

DEFAULT_CHECKPOINT_PATH = Path("native_data/model_checkpoint_target_41m.pt")
CHUNK_SIZE = 65536


def compute_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def verify_target_checkpoint(
    checkpoint_path: Path | str = DEFAULT_CHECKPOINT_PATH,
    *,
    target_params: int = TARGET_TOTAL_PARAMS,
) -> Dict[str, Any]:
    raw_path = Path(checkpoint_path)
    resolved_path = raw_path if raw_path.is_absolute() else (ROOT / raw_path)

    if not resolved_path.is_file():
        return {
            "status": "MISSING",
            "verified": False,
            "checkpoint_path": str(raw_path),
            "resolved_path": str(resolved_path),
            "exists": False,
            "file_bytes": 0,
            "sha256": None,
            "payload_sha256": None,
            "format": None,
            "integrity_status": "MISSING",
            "target_params": int(target_params),
            "manifest_param_count": None,
            "metadata_total_params": None,
            "parameter_count_matches_target": False,
            "errors": [f"checkpoint_file_missing:{resolved_path}"],
        }

    file_bytes = resolved_path.stat().st_size
    container_sha256 = compute_file_sha256(resolved_path)
    audit = inspect_checkpoint(resolved_path)
    metadata = audit.get("metadata") or {}
    manifest_params = audit.get("parameter_count_from_manifest")
    meta_params = metadata.get("total_params")
    integrity_status = audit.get("integrity_status", "BLOCKED")
    errors = list(audit.get("errors") or [])

    param_match = (
        isinstance(manifest_params, int)
        and isinstance(meta_params, int)
        and manifest_params == int(target_params)
        and meta_params == int(target_params)
    )
    if not param_match:
        errors.append(
            f"parameter_count_mismatch:manifest={manifest_params},metadata={meta_params},target={int(target_params)}"
        )

    verified = bool(integrity_status == "STRUCTURAL_CHECKS_PASS" and param_match and not errors)
    return {
        "status": "VERIFIED" if verified else "FAILED",
        "verified": verified,
        "checkpoint_path": str(raw_path),
        "resolved_path": str(resolved_path),
        "exists": True,
        "file_bytes": file_bytes,
        "sha256": container_sha256,
        "payload_sha256": audit.get("payload_sha256"),
        "format": audit.get("format"),
        "integrity_status": integrity_status,
        "target_params": int(target_params),
        "manifest_param_count": manifest_params,
        "metadata_total_params": meta_params,
        "parameter_count_matches_target": param_match,
        "errors": list(dict.fromkeys(errors)),
    }


def format_console_report(report: Dict[str, Any]) -> str:
    manifest_params_str = (
        f"{report['manifest_param_count']:,}"
        if isinstance(report["manifest_param_count"], int)
        else "N/A"
    )
    meta_params_str = (
        f"{report['metadata_total_params']:,}"
        if isinstance(report["metadata_total_params"], int)
        else "N/A"
    )
    lines = [
        "=== ZYNTHEOR Target Checkpoint Verification ===",
        f"Checkpoint Path     : {report['checkpoint_path']} ({report['resolved_path']})",
        f"File Exists         : {report['exists']}",
        f"File Size (bytes)   : {report['file_bytes']:,}",
        f"Container SHA-256   : {report['sha256'] or 'N/A (file missing)'}",
        f"Payload SHA-256     : {report['payload_sha256'] or 'N/A'}",
        f"Format              : {report['format'] or 'N/A'}",
        f"Structural Audit    : {report['integrity_status']}",
        f"Target Parameters   : {report['target_params']:,}",
        f"Manifest Parameters : {manifest_params_str}",
        f"Metadata Parameters : {meta_params_str}",
        f"Parameter Match     : {'PASS' if report['parameter_count_matches_target'] else 'FAIL'}",
        f"Overall Status      : {report['status']}",
    ]
    if report["errors"]:
        lines.append("Findings / Errors   :")
        for err in report["errors"]:
            lines.append(f"  - {err}")
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Calculate SHA-256 hash and verify parameter count of ZYNTHEOR target checkpoint."
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
        help=f"Expected parameter count (default: {TARGET_TOTAL_PARAMS})",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output verification findings as JSON",
    )
    args = parser.parse_args(argv)

    report = verify_target_checkpoint(args.checkpoint, target_params=args.target_params)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_console_report(report))

    if report["status"] == "VERIFIED":
        return 0
    if report["status"] == "MISSING":
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
