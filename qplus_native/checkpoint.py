# -*- coding: utf-8 -*-
"""Checkpoint inspection and safe export boundary for ZYNTHEOR Native weights."""
import os
import json
import struct
import hashlib
from typing import Dict, Any, Tuple, Optional

MAGIC_HEADER = b"ZYNTHEOR_QPLUS_PT"


class CheckpointManager:
    @staticmethod
    def get_paths() -> Tuple[str, str, str]:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        native_data = os.path.join(root, "native_data")
        checkpoint_path = os.path.join(native_data, "model_checkpoint.pt")
        backup_dir = os.path.join(native_data, "checkpoints")
        os.makedirs(native_data, exist_ok=True)
        os.makedirs(backup_dir, exist_ok=True)
        return checkpoint_path, backup_dir, native_data

    @staticmethod
    def inspect_checkpoint(checkpoint_path: Optional[str] = None) -> Dict[str, Any]:
        if checkpoint_path is None:
            checkpoint_path, _, _ = CheckpointManager.get_paths()
        if not os.path.exists(checkpoint_path):
            return {"exists": False, "error": f"File not found: {checkpoint_path}", "status": "NOT_FOUND"}

        file_size = os.path.getsize(checkpoint_path)
        with open(checkpoint_path, "rb") as f:
            header = f.read(len(MAGIC_HEADER))
            if header != MAGIC_HEADER:
                return {"exists": True, "file_size": file_size, "valid_magic": False, "status": "CORRUPTED_HEADER"}
            meta_len_bytes = f.read(4)
            if len(meta_len_bytes) != 4:
                return {"exists": True, "file_size": file_size, "status": "TRUNCATED_METADATA"}
            meta_len = struct.unpack(">I", meta_len_bytes)[0]
            meta_raw = f.read(meta_len)
            if len(meta_raw) != meta_len:
                return {"exists": True, "file_size": file_size, "status": "TRUNCATED_METADATA"}
            try:
                metadata = json.loads(meta_raw.decode("utf-8"))
            except Exception as exc:
                return {"exists": True, "file_size": file_size, "status": "INVALID_METADATA", "error": str(exc)}
            payload = f.read()

        actual_sha256 = hashlib.sha256(payload).hexdigest()
        payload_aligned = len(payload) % 4 == 0
        payload_params = len(payload) // 4 if payload_aligned else None
        manifest = metadata.get("tensors_manifest") or metadata.get("tensors") or []
        manifest_params = sum(int(item.get("params", 0)) for item in manifest if isinstance(item, dict))
        count_matches = payload_params is not None and metadata.get("total_params") == payload_params
        manifest_matches = not manifest or manifest_params == payload_params
        hash_matches = actual_sha256 == metadata.get("sha256")
        integrity_ok = bool(hash_matches and count_matches and manifest_matches)

        return {
            "exists": True,
            "file_size": file_size,
            "valid_magic": True,
            "metadata": metadata,
            "payload_bytes": len(payload),
            "payload_float32_count": payload_params,
            "manifest_parameter_count": manifest_params,
            "payload_sha256": actual_sha256,
            "sha256_match": hash_matches,
            "parameter_count_match": count_matches,
            "manifest_count_match": manifest_matches,
            "is_full_tensor": bool(payload_params and payload_params > 0 and integrity_ok),
            "is_seed_descriptor": False,
            "status": "ACTIVE_TENSORS_VERIFIED" if integrity_ok else "FAILED_VERIFICATION"
        }

    @staticmethod
    def export_full_tensor_checkpoint(*args, **kwargs) -> Dict[str, Any]:
        raise RuntimeError(
            "DISABLED: synthetic target-sized tensors are prohibited. "
            "Export only actual trained weights via NativeTrainer.save_learned_checkpoint()."
        )


if __name__ == "__main__":
    print(json.dumps(CheckpointManager.inspect_checkpoint(), indent=2))
