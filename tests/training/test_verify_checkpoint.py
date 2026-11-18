# -*- coding: utf-8 -*-
"""Unit tests for scripts/verify_checkpoint.py (torch/safetensors/native fallback)."""
from __future__ import annotations

import hashlib
import json
import struct
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from qplus_native.architecture import TARGET_TOTAL_PARAMS
from qplus_native.candidate_audit import MAGIC
from scripts.verify_checkpoint import inspect_target_checkpoint, main


def _write_safetensors_header_only(path: Path, shapes: dict[str, list[int]]) -> str:
    header = {
        name: {"dtype": "F32", "shape": shape, "data_offsets": [0, 0]}
        for name, shape in shapes.items()
    }
    header_bytes = json.dumps(header).encode("utf-8")
    raw = len(header_bytes).to_bytes(8, "little") + header_bytes
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


class VerifyCheckpointTests(unittest.TestCase):
    def test_missing_checkpoint_reports_missing_and_exit_1(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            missing = Path(td) / "model_checkpoint_target_41m.pt"
            report = inspect_target_checkpoint(missing)
            self.assertEqual(report["status"], "MISSING")
            self.assertFalse(report["exists"])
            self.assertIsNone(report["sha256"])
            self.assertFalse(report["matches_target"])
            self.assertEqual(report["target_params"], 41_527_808)
            self.assertEqual(main([str(missing), "--json"]), 1)

    def test_torch_state_dict_verifies_41527808_target(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            ckpt = Path(td) / "model_checkpoint_target_41m.pt"
            ckpt.write_bytes(b"synthetic-pt-container")
            expected_sha = hashlib.sha256(b"synthetic-pt-container").hexdigest()

            class FakeTensor:
                def __init__(self, count: int, ptr: int) -> None:
                    self._count = count
                    self._ptr = ptr
                    self.shape = (count,)

                def numel(self) -> int:
                    return self._count

                def data_ptr(self) -> int:
                    return self._ptr

            fake_torch = types.SimpleNamespace(
                load=lambda path, map_location="cpu", weights_only=True: {
                    "state_dict": {
                        "tok_emb": FakeTensor(8_388_608, 1),
                        "blocks": FakeTensor(33_139_200, 2),
                    }
                }
            )
            with mock.patch.dict(sys.modules, {"torch": fake_torch}):
                report = inspect_target_checkpoint(ckpt)
                self.assertEqual(report["status"], "VERIFIED")
                self.assertEqual(report["sha256"], expected_sha)
                self.assertEqual(report["loader"], "torch")
                self.assertEqual(report["parameter_count"], 41_527_808)
                self.assertTrue(report["matches_target"])
                self.assertEqual(main([str(ckpt)]), 0)

    def test_safetensors_mismatch_reports_failed_and_exit_2(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            st_path = Path(td) / "model.safetensors"
            expected_sha = _write_safetensors_header_only(
                st_path, {"w1": [4, 8], "w2": [8, 2]}
            )

            class FakeSlice:
                def __init__(self, shape: list[int]) -> None:
                    self._shape = shape

                def get_shape(self) -> list[int]:
                    return self._shape

            class FakeSafeOpen:
                def __init__(self, path: str, framework: str = "pt", device: str = "cpu") -> None:
                    self._shapes = {"w1": [4, 8], "w2": [8, 2]}

                def __enter__(self) -> "FakeSafeOpen":
                    return self

                def __exit__(self, exc_type, exc, tb) -> None:
                    return None

                def keys(self) -> list[str]:
                    return list(self._shapes.keys())

                def get_slice(self, key: str) -> FakeSlice:
                    return FakeSlice(self._shapes[key])

            fake_st = types.SimpleNamespace(safe_open=FakeSafeOpen)
            with mock.patch.dict(sys.modules, {"safetensors": fake_st}):
                report = inspect_target_checkpoint(st_path)
                self.assertEqual(report["status"], "FAILED")
                self.assertEqual(report["sha256"], expected_sha)
                self.assertEqual(report["loader"], "safetensors")
                self.assertEqual(report["parameter_count"], 48)
                self.assertEqual(report["target_params"], TARGET_TOTAL_PARAMS)
                self.assertFalse(report["matches_target"])
                self.assertEqual(main([str(st_path)]), 2)

    def test_zyntheor_qplus_pt_format_counts_manifest_params(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            ckpt = Path(td) / "native.pt"
            tensors = [
                ("tok_emb", (4, 2)),
                ("pos_emb", (2, 2)),
                ("b0.norm1", (2,)),
                ("b0.wq", (2, 2)),
                ("b0.wk", (2, 2)),
                ("b0.wv", (2, 2)),
                ("b0.wo", (2, 2)),
                ("b0.norm2", (2,)),
                ("b0.w_gate", (2, 2)),
                ("b0.w_up", (2, 2)),
                ("b0.w_down", (2, 2)),
                ("norm_f", (2,)),
            ]
            parts = []
            manifest = []
            total = 0
            for name, shape in tensors:
                n = 1
                for d in shape:
                    n *= d
                chunk = struct.pack(f"<{n}f", *([0.1] * n))
                parts.append(chunk)
                manifest.append({"name": name, "shape": list(shape), "params": n, "sha256": hashlib.sha256(chunk).hexdigest()})
                total += n
            payload = b"".join(parts)
            meta = {
                "architecture": "ZYNTHEOR-NativeLM-v2-TiedEmbedding-CausalAttention",
                "storage_mode": "LEARNED_WEIGHTS_TRAINED_V2",
                "config": {"vocab": 4, "d_model": 2, "d_ffn": 2, "n_layers": 1, "ctx": 2},
                "total_params": total,
                "trained_subgraph_params": total,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "tensors_manifest": manifest,
            }
            meta_bytes = json.dumps(meta).encode("utf-8")
            ckpt.write_bytes(MAGIC + struct.pack(">I", len(meta_bytes)) + meta_bytes + payload)

            report = inspect_target_checkpoint(ckpt, target_params=total)
            self.assertEqual(report["status"], "VERIFIED")
            self.assertEqual(report["loader"], "zyntheor_qplus_pt")
            self.assertEqual(report["parameter_count"], total)
            self.assertTrue(report["matches_target"])


if __name__ == "__main__":
    unittest.main()
