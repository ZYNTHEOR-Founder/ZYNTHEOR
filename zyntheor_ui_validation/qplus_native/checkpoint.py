# -*- coding: utf-8 -*-
"""Evidence-based checkpoint inspection. Synthetic tensor export is intentionally disabled."""
from __future__ import annotations
import os
import json
import struct
import hashlib
import math
from typing import Dict, Any, Tuple, Optional

MAGIC_HEADER = b"ZYNTHEOR_QPLUS_PT"

class CheckpointManager:
    @staticmethod
    def get_paths() -> Tuple[str, str, str]:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        native_data = os.path.join(root, "native_data")
        checkpoint_path = os.path.join(native_data, "model_checkpoint.pt")
        backup_dir = os.path.join(native_data, "checkpoints")
        return checkpoint_path, backup_dir, native_data

    @staticmethod
    def inspect_checkpoint(checkpoint_path: Optional[str] = None) -> Dict[str, Any]:
        if checkpoint_path is None:
            checkpoint_path, _, _ = CheckpointManager.get_paths()
        if not os.path.isfile(checkpoint_path):
            return {"exists": False, "error": f"File not found: {checkpoint_path}", "status": "NOT_FOUND"}

        file_size = os.path.getsize(checkpoint_path)
        try:
            with open(checkpoint_path, "rb") as fh:
                if fh.read(len(MAGIC_HEADER)) != MAGIC_HEADER:
                    return {"exists": True, "file_size": file_size, "valid_magic": False, "status": "CORRUPTED_HEADER"}
                length = fh.read(4)
                if len(length) != 4:
                    return {"exists": True, "file_size": file_size, "valid_magic": True, "status": "TRUNCATED"}
                meta_len = struct.unpack(">I", length)[0]
                if meta_len > 16 * 1024 * 1024:
                    return {"exists": True, "file_size": file_size, "valid_magic": True, "status": "INVALID_METADATA_LENGTH"}
                meta_bytes = fh.read(meta_len)
                if len(meta_bytes) != meta_len:
                    return {"exists": True, "file_size": file_size, "valid_magic": True, "status": "TRUNCATED_METADATA"}
                metadata = json.loads(meta_bytes.decode("utf-8"))
                payload = fh.read()
            from qplus_native.architecture import TARGET_TOTAL_PARAMS
            actual_sha = hashlib.sha256(payload).hexdigest()
            expected_sha = metadata.get("sha256") or metadata.get("payload_sha256")
            sha_match = bool(expected_sha) and actual_sha == expected_sha
            aligned = len(payload) % 4 == 0
            float_count = len(payload) // 4 if aligned else 0
            trained_count = metadata.get("trained_subgraph_params")
            declared_count = trained_count if trained_count is not None else metadata.get("total_params")
            parameter_match = isinstance(declared_count, int) and float_count == declared_count
            manifest = metadata.get("tensors_manifest") or metadata.get("tensor_manifest") or metadata.get("tensors") or []
            manifest_count = sum(int(item.get("params", 0)) for item in manifest if isinstance(item, dict))
            manifest_match = bool(manifest) and manifest_count == float_count
            finite = False
            if aligned:
                import array
                values = array.array("f")
                values.frombytes(payload)
                finite = all(math.isfinite(value) for value in values)
            integrity_ok = aligned and finite and sha_match and parameter_match and manifest_match
            if not aligned or not finite or not sha_match:
                status = "PAYLOAD_INTEGRITY_FAILED"
            elif integrity_ok:
                status = "ACTIVE_TENSORS_VERIFIED"
            else:
                status = "PARAMETER_MANIFEST_MISMATCH"

            enriched = dict(metadata)
            enriched["target_total_params"] = int(TARGET_TOTAL_PARAMS)
            enriched["parameter_audit"] = {
                "payload_float32_count": float_count,
                "declared_trained_subgraph_params": declared_count,
                "declared_total_params": metadata.get("total_params"),
                "manifest_params": manifest_count,
                "target_total_params": int(TARGET_TOTAL_PARAMS),
                "target_architecture_instantiated": float_count == int(TARGET_TOTAL_PARAMS) and integrity_ok,
                "active_graph_status": "TARGET_ARCHITECTURE_VERIFIED" if float_count == int(TARGET_TOTAL_PARAMS) and integrity_ok else "PARTIAL_NATIVE_SUBGRAPH",
            }
            return {
                "exists": True, "file_size": file_size, "valid_magic": True,
                "metadata": enriched, "payload_bytes": len(payload),
                "payload_float32_count": float_count, "payload_sha256": actual_sha,
                "sha256_match": sha_match, "parameter_count_match": parameter_match,
                "manifest_count_match": manifest_match, "finite_values": finite,
                "is_seed_descriptor": float_count == 0,
                "is_full_tensor": float_count == int(TARGET_TOTAL_PARAMS) and integrity_ok,
                "status": status,
            }
        except (OSError, ValueError, TypeError, json.JSONDecodeError, struct.error) as exc:
            return {"exists": True, "file_size": file_size, "status": "INSPECTION_FAILED", "error": str(exc)}

    @staticmethod
    def export_full_tensor_checkpoint(*args, **kwargs) -> Dict[str, Any]:
        raise RuntimeError(
            "FAIL_CLOSED: synthetic target-sized tensors are prohibited; "
            "export requires a real checkpoint produced by approved Native training."
        )

if __name__ == "__main__":
    print(json.dumps(CheckpointManager.inspect_checkpoint(), indent=2, ensure_ascii=False))
