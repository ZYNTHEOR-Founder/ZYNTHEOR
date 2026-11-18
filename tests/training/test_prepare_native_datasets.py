# -*- coding: utf-8 -*-
"""Verification and regression tests for ZYNTHEOR Native Dataset Preparation."""
from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

from qplus_native.dataset_governance import (  # noqa: E402
    SCHEMA_VERSION,
    audit_splits,
    content_sha256,
    validate_manifest,
)
from qplus_native.train_target import load_frozen_documents  # noqa: E402
from scripts.prepare_native_datasets import (  # noqa: E402
    EMAIL_RE,
    PRIVATE_KEY_RE,
    RBAC_PROBE_RE,
    SECRET_RE,
    SYNTHETIC_MARKER_RE,
)


class PrepareNativeDatasetsTests(unittest.TestCase):
    def test_prepared_splits_load_via_target_loader_and_remain_disjoint(self) -> None:
        all_records = []
        texts = {}
        ids_by_split = {}
        for split in ("train", "validation", "test"):
            path = ROOT / "native_data" / "datasets" / f"{split}.jsonl"
            self.assertTrue(path.is_file(), f"Missing split file: {path}")
            loaded = load_frozen_documents(str(path))
            self.assertGreater(len(loaded), 0, f"Empty split: {split}")
            ids_by_split[split] = set(loaded.keys())
            for doc_id, rec in loaded.items():
                self.assertEqual(rec["split"], split)
                text = rec["text"]
                self.assertFalse(SECRET_RE.search(text), f"Secret literal leaked in {doc_id}")
                self.assertFalse(PRIVATE_KEY_RE.search(text), f"Private key leaked in {doc_id}")
                self.assertFalse(EMAIL_RE.search(text), f"Email PII leaked in {doc_id}")
                self.assertFalse(RBAC_PROBE_RE.search(text), f"RBAC probe leaked in {doc_id}")
                self.assertFalse(SYNTHETIC_MARKER_RE.search(text), f"Synthetic marker leaked in {doc_id}")
                all_records.append({"document_id": doc_id, "split": split})
                texts[doc_id] = text

        # Strict split disjointness (test strictly separated from train & validation)
        self.assertEqual(ids_by_split["train"] & ids_by_split["validation"], set())
        self.assertEqual(ids_by_split["train"] & ids_by_split["test"], set())
        self.assertEqual(ids_by_split["validation"] & ids_by_split["test"], set())

        audit = audit_splits(all_records, texts, near_duplicate_threshold=0.90)
        self.assertEqual(audit["status"], "READY_FOR_REVIEW", msg=json.dumps(audit))
        self.assertEqual(audit["exact_duplicates"], [])
        self.assertEqual(audit["cross_split_near_duplicates"], [])

    def test_each_jsonl_record_has_required_governance_and_hash_fields(self) -> None:
        required_keys = {
            "document_id",
            "split",
            "domain",
            "language",
            "source",
            "license",
            "sha256",
            "text",
        }
        for split in ("train", "validation", "test"):
            path = ROOT / "native_data" / "datasets" / f"{split}.jsonl"
            for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                obj = json.loads(raw)
                self.assertTrue(
                    required_keys.issubset(obj.keys()),
                    f"{path}:{line_no} missing keys: {required_keys - set(obj.keys())}",
                )
                self.assertEqual(obj["split"], split)
                self.assertEqual(obj["sha256"], content_sha256(obj["text"]))

    def test_governance_manifest_evidence_sha256_and_fail_closed_gate(self) -> None:
        manifest_path = ROOT / "artifacts" / "dataset-provenance-manifest.json"
        evidence_root = ROOT / "artifacts" / "dataset-provenance-evidence"
        quality_path = ROOT / "artifacts" / "dataset-quality-report.json"
        sha_path = ROOT / "artifacts" / "dataset-sha256.txt"

        self.assertTrue(manifest_path.is_file())
        self.assertTrue(evidence_root.is_dir())
        self.assertTrue(quality_path.is_file())
        self.assertTrue(sha_path.is_file())

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema_version"], SCHEMA_VERSION)
        self.assertEqual(manifest["governance_status"], "PENDING_ADMIN_REVIEW")
        self.assertFalse(manifest["training_plan_target"]["total_steps"] != 5800)

        texts = {}
        for split in ("train", "validation", "test"):
            for doc_id, rec in load_frozen_documents(str(ROOT / "native_data" / "datasets" / f"{split}.jsonl")).items():
                texts[doc_id] = rec["text"]

        # Must fail-closed honestly without trusted external approval key
        gate = validate_manifest(manifest, texts, evidence_root, approval_verifier=None)
        self.assertEqual(gate["status"], "BLOCKED")

        quality = json.loads(quality_path.read_text(encoding="utf-8"))
        self.assertTrue(quality["preparation_only"])
        self.assertFalse(quality["training_started"])
        self.assertEqual(quality["training_plan_preserved"]["total_steps"], 5800)
        self.assertEqual(quality["quality_and_governance_checks"]["exact_duplicates_in_output"], 0)
        self.assertEqual(quality["quality_and_governance_checks"]["cross_split_near_duplicates_in_output"], 0)

        # Every checksum entry in artifacts/dataset-sha256.txt must match actual disk bytes
        lines = [ln.strip() for ln in sha_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
        self.assertGreaterEqual(len(lines), 10)
        for ln in lines:
            expected_digest, rel_path = ln.split(None, 1)
            target = ROOT / rel_path
            self.assertTrue(target.is_file(), f"Missing checksummed file: {rel_path}")
            actual_digest = hashlib.sha256(target.read_bytes()).hexdigest()
            self.assertEqual(actual_digest, expected_digest, f"SHA-256 mismatch for {rel_path}")

    def test_original_legacy_datasets_preserved_untouched(self) -> None:
        self.assertTrue((ROOT / "native_data" / "datasets" / "ds_1794922200463.json").is_file())
        self.assertTrue((ROOT / "native_data" / "datasets" / "ds_1794922200466.json").is_file())
        self.assertTrue((ROOT / "native_data" / "datasets" / "ds_1794922258067.json").is_file())
        self.assertTrue((ROOT / "native_data" / "training_pipeline" / "datasets" / "verified_dataset.jsonl").is_file())
        src_manifest = json.loads((ROOT / "source" / "artifacts" / "dataset-provenance-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(src_manifest["documents"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
