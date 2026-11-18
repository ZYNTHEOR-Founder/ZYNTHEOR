# -*- coding: utf-8 -*-
"""Verification tests for the 41,527,808-param NativeLM initialization checkpoint and dataset directory loader."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from qplus_native.architecture import TARGET_TOTAL_PARAMS  # noqa: E402
from qplus_native.lm_v2 import NativeLM  # noqa: E402
from qplus_native.tokenizer import SovereignTokenizer  # noqa: E402
from qplus_native.train_target import (  # noqa: E402
    DEFAULT_PROVENANCE_MANIFEST,
    load_frozen_documents,
    verify_numpy_backend,
)
from scripts.verify_target_checkpoint import verify_target_checkpoint  # noqa: E402


class InitTargetCheckpointTests(unittest.TestCase):
    def test_numpy_and_boto3_dependencies_verified(self) -> None:
        info = verify_numpy_backend()
        self.assertEqual(info["backend"], "numpy")
        self.assertTrue(info["numpy_available"])
        self.assertTrue(info["float32_verified"])
        self.assertTrue(info["boto3_available"])
        self.assertIsNotNone(info["boto3_version"])

    def test_target_41m_init_checkpoint_verified_and_loads_float32(self) -> None:
        ckpt_path = ROOT / "native_data" / "model_checkpoint_target_41m.pt"
        self.assertTrue(ckpt_path.is_file(), f"Missing initialized 41.5M checkpoint: {ckpt_path}")

        report = verify_target_checkpoint(ckpt_path, target_params=TARGET_TOTAL_PARAMS)
        self.assertEqual(report["status"], "VERIFIED", msg=json.dumps(report))
        self.assertTrue(report["verified"])
        self.assertTrue(report["parameter_count_matches_target"])
        self.assertEqual(report["manifest_param_count"], 41_527_808)
        self.assertEqual(report["metadata_total_params"], 41_527_808)

        tok = SovereignTokenizer(16384, profile="v2_base")
        model, meta = NativeLM.load(str(ckpt_path), tok, dtype=np.float32)
        self.assertEqual(model.num_params(), 41_527_808)
        self.assertEqual(meta.get("training_steps_total"), 0)
        self.assertFalse(meta.get("trained", True))
        self.assertTrue(meta.get("initialization_only", False))

        x = np.asarray([[1, 2, 3, 4]], dtype=np.int64)
        logits, _ = model.forward(x, keep_cache=False)
        self.assertEqual(logits.shape, (1, 4, 16384))
        self.assertEqual(logits.dtype, np.dtype(np.float32))
        self.assertTrue(bool(np.all(np.isfinite(logits))))

    def test_train_target_loads_prepared_split_directory_and_default_manifest(self) -> None:
        self.assertEqual(DEFAULT_PROVENANCE_MANIFEST, ROOT / "artifacts" / "dataset-provenance-manifest.json")
        docs = load_frozen_documents(str(ROOT / "native_data" / "datasets"))
        self.assertEqual(len(docs), 168)
        splits = {d["split"] for d in docs.values()}
        self.assertEqual(splits, {"train", "validation", "test"})

    def test_sign_dataset_provenance_roundtrip_ephemeral(self) -> None:
        import os
        import shutil
        import tempfile
        from scripts.sign_dataset_provenance import sign_provenance_manifest, verify_provenance_manifest

        src_manifest = ROOT / "artifacts" / "dataset-provenance-manifest.json"
        src_evidence = ROOT / "artifacts" / "dataset-provenance-evidence"
        src_dataset = ROOT / "native_data" / "datasets"

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            tmp_manifest = tmp_path / "dataset-provenance-manifest.json"
            tmp_evidence = tmp_path / "dataset-provenance-evidence"
            tmp_key = tmp_path / "approval-hmac.json"

            shutil.copy2(src_manifest, tmp_manifest)
            shutil.copytree(src_evidence, tmp_evidence)

            # Without key -> fail closed BLOCKED
            unverified = verify_provenance_manifest(
                manifest_path=tmp_manifest,
                evidence_root=tmp_evidence,
                dataset_path=src_dataset,
                key_file=None,
            )
            self.assertEqual(unverified["status"], "BLOCKED")
            self.assertFalse(unverified["approval_key_configured"])

            # Create ephemeral 0600 test HMAC key strictly inside TemporaryDirectory
            tmp_key.write_text(
                json.dumps({"key_id": "ephemeral-test-k1", "key_hex": os.urandom(32).hex()}),
                encoding="utf-8",
            )
            os.chmod(tmp_key, 0o600)

            signed = sign_provenance_manifest(
                manifest_path=tmp_manifest,
                evidence_root=tmp_evidence,
                dataset_path=src_dataset,
                key_file=tmp_key,
                approver="unit-test-admin@zyntheor.local",
                source_base_url="https://datasets.zyntheor.local/corpus",
                license_url="https://licenses.zyntheor.local/proprietary-v1",
            )
            self.assertEqual(signed["status"], "VERIFIED", msg=json.dumps(signed))
            self.assertEqual(signed["signed_documents"], 168)
            self.assertEqual(signed["verified_documents"], 168)

    def test_cloud_storage_aws_alias_fallback(self) -> None:
        import os
        from qplus_native.cloud_storage import hydrate_cloud_env_from_dotenv

        keys = (
            "S3_BUCKET",
            "S3_ACCESS_KEY_ID",
            "S3_SECRET_ACCESS_KEY",
            "S3_REGION",
            "S3_ENDPOINT",
            "AWS_S3_BUCKET",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_REGION",
            "AWS_ENDPOINT_URL",
        )
        saved = {k: os.environ.get(k) for k in keys}
        try:
            for k in keys:
                os.environ.pop(k, None)
            os.environ["AWS_S3_BUCKET"] = "alias-bucket"
            os.environ["AWS_ACCESS_KEY_ID"] = "AKIA_ALIAS_UNIT"
            os.environ["AWS_SECRET_ACCESS_KEY"] = "SECRET_ALIAS_UNIT"
            os.environ["AWS_REGION"] = "ap-southeast-1"
            os.environ["AWS_ENDPOINT_URL"] = "https://s3.ap-southeast-1.amazonaws.com"

            resolved = hydrate_cloud_env_from_dotenv()
            self.assertEqual(resolved.get("S3_BUCKET"), "alias-bucket")
            self.assertEqual(resolved.get("S3_REGION"), "ap-southeast-1")
            self.assertEqual(os.environ.get("S3_BUCKET"), "alias-bucket")
            self.assertEqual(os.environ.get("S3_ACCESS_KEY_ID"), "AKIA_ALIAS_UNIT")
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main(verbosity=2)
