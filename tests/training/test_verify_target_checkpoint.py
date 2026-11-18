# -*- coding: utf-8 -*-
"""Unit tests for scripts/verify_target_checkpoint.py (no numpy dependency)."""
from __future__ import annotations

import hashlib
import json
import struct
import tempfile
import unittest
from pathlib import Path

from qplus_native.architecture import TARGET_TOTAL_PARAMS
from qplus_native.candidate_audit import MAGIC
from scripts.verify_target_checkpoint import main, verify_target_checkpoint


def _build_synthetic_pt(path: Path, *, vocab: int = 4, d_model: int = 2, d_ffn: int = 2, n_layers: int = 1, ctx: int = 2) -> tuple[int, str, str]:
    tensors_spec = [
        ("tok_emb", (vocab, d_model)),
        ("pos_emb", (ctx, d_model)),
        ("b0.norm1", (d_model,)),
        ("b0.wq", (d_model, d_model)),
        ("b0.wk", (d_model, d_model)),
        ("b0.wv", (d_model, d_model)),
        ("b0.wo", (d_model, d_model)),
        ("b0.norm2", (d_model,)),
        ("b0.w_gate", (d_model, d_ffn)),
        ("b0.w_up", (d_model, d_ffn)),
        ("b0.w_down", (d_ffn, d_model)),
        ("norm_f", (d_model,)),
    ]
    payload_parts = []
    manifest = []
    total_params = 0
    for name, shape in tensors_spec:
        n = 1
        for dim in shape:
            n *= dim
        chunk = struct.pack(f"<{n}f", *([0.1] * n))
        payload_parts.append(chunk)
        manifest.append({
            "name": name,
            "shape": list(shape),
            "params": n,
            "sha256": hashlib.sha256(chunk).hexdigest(),
        })
        total_params += n

    payload = b"".join(payload_parts)
    payload_sha256 = hashlib.sha256(payload).hexdigest()
    meta = {
        "architecture": "ZYNTHEOR-NativeLM-v2-TiedEmbedding-CausalAttention",
        "storage_mode": "LEARNED_WEIGHTS_TRAINED_V2",
        "config": {"vocab": vocab, "d_model": d_model, "d_ffn": d_ffn, "n_layers": n_layers, "ctx": ctx},
        "total_params": total_params,
        "trained_subgraph_params": total_params,
        "target_total_params": TARGET_TOTAL_PARAMS,
        "sha256": payload_sha256,
        "tensors_manifest": manifest,
    }
    meta_bytes = json.dumps(meta).encode("utf-8")
    raw = MAGIC + struct.pack(">I", len(meta_bytes)) + meta_bytes + payload
    path.write_bytes(raw)
    return total_params, hashlib.sha256(raw).hexdigest(), payload_sha256


class VerifyTargetCheckpointTests(unittest.TestCase):
    def test_missing_default_checkpoint_returns_missing_and_exit_1(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            missing = Path(td) / "model_checkpoint_target_41m.pt"
            report = verify_target_checkpoint(missing)
            self.assertEqual(report["status"], "MISSING")
            self.assertFalse(report["exists"])
            self.assertFalse(report["verified"])
            self.assertEqual(report["target_params"], 41_527_808)
            self.assertIsNone(report["sha256"])
            self.assertEqual(main([str(missing), "--json"]), 1)

    def test_small_checkpoint_fails_against_41527808_target(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            ckpt = Path(td) / "small.pt"
            total_params, container_sha, payload_sha = _build_synthetic_pt(ckpt)
            report = verify_target_checkpoint(ckpt)
            self.assertEqual(report["status"], "FAILED")
            self.assertTrue(report["exists"])
            self.assertEqual(report["sha256"], container_sha)
            self.assertEqual(report["payload_sha256"], payload_sha)
            self.assertEqual(report["manifest_param_count"], total_params)
            self.assertEqual(report["target_params"], 41_527_808)
            self.assertFalse(report["parameter_count_matches_target"])
            self.assertEqual(main([str(ckpt)]), 2)

    def test_matching_target_params_passes_sha256_and_count(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            ckpt = Path(td) / "matched.pt"
            total_params, container_sha, payload_sha = _build_synthetic_pt(ckpt)
            report = verify_target_checkpoint(ckpt, target_params=total_params)
            self.assertEqual(report["status"], "VERIFIED")
            self.assertTrue(report["verified"])
            self.assertEqual(report["sha256"], container_sha)
            self.assertEqual(report["payload_sha256"], payload_sha)
            self.assertTrue(report["parameter_count_matches_target"])
            self.assertEqual(main([str(ckpt), "--target-params", str(total_params)]), 0)


if __name__ == "__main__":
    unittest.main()
