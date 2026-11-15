import json
import os
import struct
import hashlib
import unittest
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.model import NativeNeuralModel
from qplus_native.trainer import NativeTrainer
from qplus_native.checkpoint import CheckpointManager
from qplus_native.architecture import (
    TARGET_TOTAL_PARAMS, TARGET_VOCAB_SIZE, TARGET_D_MODEL, TARGET_N_LAYERS,
    TARGET_N_HEADS, TARGET_D_FFN, TARGET_CTX, target_parameter_count
)

class NativeParameterIntegrityTests(unittest.TestCase):
    def test_reconciled_target_graph_parameter_count(self):
        self.assertEqual((TARGET_VOCAB_SIZE, TARGET_D_MODEL, TARGET_N_LAYERS, TARGET_N_HEADS, TARGET_D_FFN, TARGET_CTX),
                         (16384, 512, 10, 8, 1472, 64))
        self.assertEqual(target_parameter_count(), 41527808)
        self.assertEqual(TARGET_TOTAL_PARAMS, 41527808)

    def test_checkpoint_count_matches_real_payload_and_manifest(self):
        result = CheckpointManager.inspect_checkpoint()
        self.assertEqual(result["status"], "ACTIVE_TENSORS_VERIFIED")
        self.assertEqual(result["payload_float32_count"], 231168)
        self.assertTrue(result["sha256_match"])
        self.assertTrue(result["parameter_count_match"])
        self.assertTrue(result["manifest_count_match"])

        from qplus_native.model import TARGET_CHECKPOINT_PATH
        if os.path.exists(TARGET_CHECKPOINT_PATH):
            target_result = CheckpointManager.inspect_checkpoint(TARGET_CHECKPOINT_PATH)
            self.assertEqual(target_result["status"], "ACTIVE_TENSORS_VERIFIED")
            self.assertEqual(target_result["payload_float32_count"], 41527808)
            self.assertTrue(target_result["sha256_match"])
            self.assertTrue(target_result["parameter_count_match"])
            self.assertTrue(target_result["manifest_count_match"])

    def test_runtime_graph_fails_closed_offline_and_matches_cloud_bytes(self):
        # 1. Without Cloud Object Storage configured, NativeNeuralModel MUST fail closed
        saved_url = os.environ.pop("CHECKPOINT_PRESIGNED_URL", None)
        saved_bucket = os.environ.pop("S3_BUCKET", None)
        try:
            with self.assertRaisesRegex(RuntimeError, "FAIL_CLOSED"):
                NativeNeuralModel()
        finally:
            if saved_url is not None:
                os.environ["CHECKPOINT_PRESIGNED_URL"] = saved_url
            if saved_bucket is not None:
                os.environ["S3_BUCKET"] = saved_bucket

        # 2. PureSeqLM (51,296 params) & legacy 231,168 cloud-bytes verification
        ckpt_path, _, _ = CheckpointManager.get_paths()
        with open(ckpt_path, "rb") as fh:
            v1_bytes = fh.read()
        v1_model = NativeNeuralModel(checkpoint_path="s3://cloud-test/v1_231k.pt", cloud_bytes=v1_bytes)
        trainer = NativeTrainer()
        self.assertEqual(v1_model.config.total_params, 231168)
        self.assertTrue(v1_model.learned_weights_loaded)
        self.assertEqual(sum(p.size for p in trainer.parameters), 231168)

        # 3. When 41.53M checkpoint and numpy are present, verify Target 41.53M cloud bytes too
        from qplus_native.model import TARGET_CHECKPOINT_PATH
        try:
            import numpy as _np  # noqa: F401
            has_numpy = True
        except Exception:
            has_numpy = False
        if has_numpy and os.path.exists(TARGET_CHECKPOINT_PATH):
            with open(TARGET_CHECKPOINT_PATH, "rb") as fh:
                target_bytes = fh.read()
            model = NativeNeuralModel(checkpoint_path="s3://cloud-test/target_41m.pt", cloud_bytes=target_bytes)
            self.assertEqual(model.config.total_params, 41527808)
            self.assertTrue(model.learned_weights_loaded)
            self.assertEqual(model.config.d_model, 512)
            self.assertEqual(model.config.n_layers, 10)
            self.assertEqual(model.config.n_heads, 8)

    def test_legacy_subgraph_does_not_claim_target_size(self):
        result = CheckpointManager.inspect_checkpoint()
        metadata = result["metadata"]
        self.assertEqual(metadata["target_total_params"], 41527808)
        self.assertNotEqual(metadata["total_params"], metadata["target_total_params"])
        self.assertFalse(metadata["parameter_audit"]["target_architecture_instantiated"])

    def test_legacy_synthetic_export_is_disabled(self):
        with self.assertRaisesRegex(RuntimeError, "synthetic target-sized tensors are prohibited"):
            CheckpointManager.export_full_tensor_checkpoint()

if __name__ == "__main__":
    unittest.main(verbosity=2)
