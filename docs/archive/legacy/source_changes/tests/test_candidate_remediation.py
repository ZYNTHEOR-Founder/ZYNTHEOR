# -*- coding: utf-8 -*-
"""Unit tests for remediation plumbing. Fixtures are ephemeral test data, not dataset/license evidence.
No optimizer step, training loop, candidate inference, or test-set model scoring is performed.
"""
import hashlib
import hmac
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT))

from qplus_native.dataset_governance import (SCHEMA_VERSION, content_sha256, validate_document,
    audit_splits, validate_manifest, canonical_json)
from qplus_native.trusted_approvals import approval_payload, load_hmac_verifier
from qplus_native.benchmark_framework import (DOMAINS, empty_manifest_template, validate_benchmark_manifest,
    score_answer, compare_reports)
from qplus_native.candidate_audit import inspect_checkpoint
from qplus_native.lm_v2 import NativeLM, LMConfig, AdamW
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.training_state import save_resume_bundle, load_resume_bundle, config_fingerprint
from qplus_native.training_readiness import validate_training_readiness

CANDIDATE = ROOT / "native_data" / "model_checkpoint_v2_candidate.pt"


def _write_evidence(root, name, content):
    path = Path(root) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {"path": name, "sha256": hashlib.sha256(content).hexdigest()}


def _test_only_record(root, doc_id, split, text, key_id="test-key"):
    evidence = {
        "source": _write_evidence(root, f"{doc_id}/source.txt", b"UNIT TEST FIXTURE ONLY; no real source claim"),
        "license": _write_evidence(root, f"{doc_id}/license.txt", b"UNIT TEST FIXTURE ONLY; no license claim"),
        "rights": _write_evidence(root, f"{doc_id}/rights.txt", b"UNIT TEST FIXTURE ONLY; no rights claim"),
        "approval": _write_evidence(root, f"{doc_id}/approval.txt", b"UNIT TEST FIXTURE ONLY; no human approval"),
    }
    approval = {"decision": "APPROVED", "approver": "test-only", "signed_at": "2026-01-01T00:00:00Z", "key_id": key_id}
    return {"document_id": doc_id, "document_sha256": content_sha256(text), "split": split,
            "source": {"url": "https://example.invalid/unit-test", "publisher": "UNIT TEST ONLY"},
            "license": {"id": "TEST-ONLY-NOT-A-LICENSE", "url": "https://example.invalid/test-license"},
            "rights": {"basis": "UNIT TEST ONLY", "scope": ["test-only"]},
            "approval": {**approval, "signature": "not-a-real-signature"}, "evidence": evidence}


class DatasetGovernanceTests(unittest.TestCase):
    def test_no_trusted_verifier_never_marks_document_verified(self):
        with tempfile.TemporaryDirectory() as d:
            text = "unit-test-text-a"
            rec = _test_only_record(d, "a", "train", text)
            result = validate_document(rec, text, d, approval_verifier=None)
            self.assertEqual(result["status"], "EVIDENCE_PRESENT_REVIEW_REQUIRED")
            self.assertIn("trusted_approval_verifier_not_configured", result["issues"])

    def test_document_hash_and_evidence_hash_mismatch_block(self):
        with tempfile.TemporaryDirectory() as d:
            rec = _test_only_record(d, "a", "train", "correct")
            result = validate_document(rec, "changed", d, approval_verifier=lambda _: True)
            self.assertEqual(result["status"], "BLOCKED")
            self.assertIn("document_sha256_mismatch", result["issues"])
            rec["evidence"]["license"]["sha256"] = "0" * 64
            result = validate_document(rec, "correct", d, approval_verifier=lambda _: True)
            self.assertEqual(result["status"], "BLOCKED")
            self.assertIn("license_evidence_hash_mismatch", result["issues"])

    def test_signed_approval_trust_key_is_external_and_permission_checked(self):
        with tempfile.TemporaryDirectory() as d:
            key = bytes(range(32))
            p = Path(d) / "trust.json"
            p.write_text(json.dumps({"key_id": "test-key", "key_hex": key.hex()}), encoding="utf-8")
            os.chmod(p, 0o600)
            record = _test_only_record(d, "signed-test", "train", "unit-test-content")
            record["approval"]["signature"] = hmac.new(key, approval_payload(record), hashlib.sha256).hexdigest()
            verify = load_hmac_verifier(p)
            self.assertTrue(verify(record))
            record["document_sha256"] = "0" * 64
            self.assertFalse(verify(record))

    def test_exact_and_near_duplicate_cross_split_are_blocking(self):
        records = [
            {"document_id": "a", "split": "train"},
            {"document_id": "b", "split": "validation"},
            {"document_id": "c", "split": "test"},
        ]
        texts = {"a": "abcdefghijklmno", "b": "abcdefghijklmno", "c": "QRSTUVWXYZ012345"}
        result = audit_splits(records, texts)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertTrue(result["exact_duplicates"])

    def test_near_duplicate_cross_split_is_reported(self):
        base = "".join(chr(0x4E00 + i) for i in range(100))
        near = base[:-1] + "X"
        records = [{"document_id": "train", "split": "train"},
                   {"document_id": "test", "split": "test"}]
        result = audit_splits(records, {"train": base, "test": near}, near_duplicate_threshold=0.90)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertTrue(result["cross_split_near_duplicates"])

    def test_empty_manifest_template_is_draft_and_cannot_pass_training_gate(self):
        self.assertEqual(empty_manifest_template()["tasks"], [])
        with tempfile.TemporaryDirectory() as d:
            result = validate_training_readiness(str(Path(d) / "missing.json"), d, None,
                {"a": {"text": "x", "split": "train"}})
            self.assertEqual(result["status"], "BLOCKED")


class BenchmarkFrameworkTests(unittest.TestCase):
    def test_all_seven_domains_are_declared_but_empty_benchmark_is_blocked(self):
        self.assertEqual(len(DOMAINS), 7)
        result = validate_benchmark_manifest(empty_manifest_template())
        self.assertEqual(result["status"], "BLOCKED")
        self.assertIn("benchmark_tasks_missing", result["issues"])

    def test_scoring_is_deterministic_and_no_baseline_is_invented(self):
        self.assertTrue(score_answer("normalized_exact_match", " ไทย ", "ไทย"))
        self.assertFalse(score_answer("exact_match", "Answer", "answer"))
        self.assertIsNone(score_answer("human_rubric", "review criteria", "response"))
        self.assertEqual(compare_reports(None, None)["status"], "BLOCKED")

    def test_test_split_and_training_hash_overlap_are_rejected(self):
        task = {"task_id": "t", "document_id": "t", "document_sha256": "a" * 64,
                "domain": DOMAINS[0], "split": "train", "prompt": "x", "expected": "y",
                "scorer": "exact_match"}
        result = validate_benchmark_manifest({"schema_version": "zyntheor.benchmark.v1", "tasks": [task]},
                                             training_document_hashes=["a" * 64])
        self.assertEqual(result["status"], "BLOCKED")


class TrainingStateTests(unittest.TestCase):
    def test_save_load_resume_roundtrip_preserves_all_state_without_optimizer_step(self):
        tok = SovereignTokenizer()
        model = NativeLM(LMConfig(vocab=40, d_model=16, n_layers=1, n_heads=2, d_ffn=24, ctx=8), seed=11)
        optimizer = AdamW(model, lr=0.001, weight_decay=0.02)
        # Populate deterministic fixture state directly; do not run opt.step or train a model.
        for i, name in enumerate(model.param_names()):
            optimizer.m[name].fill(i + 0.125)
            optimizer.v[name].fill(i + 0.25)
        optimizer.t = 7
        rng = np.random.default_rng(2026)
        rng.integers(0, 100, size=13)
        scheduler = {"kind": "cosine_with_warmup", "base_lr": 0.001, "warmup_steps": 10,
                     "total_steps": 100, "global_step": 7}
        config = {"model": model.cfg.to_dict(), "batch": 4, "schedule_total_steps": 100}
        corpus_hash = hashlib.sha256(b"unit-test-corpus-id-only").hexdigest()
        snapshot_weights = {k: v.copy() for k, v in model.p.items()}
        snapshot_m = {k: v.copy() for k, v in optimizer.m.items()}
        snapshot_v = {k: v.copy() for k, v in optimizer.v.items()}
        expected_next_rng = np.random.default_rng()
        expected_next_rng.bit_generator.state = rng.bit_generator.state
        expected_draw = expected_next_rng.integers(0, 100, size=5)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "resume.bundle"
            info = save_resume_bundle(path, model, tok, optimizer, global_step=7,
                scheduler_state=scheduler, rng=rng, corpus_sha256=corpus_hash, configuration=config)
            self.assertEqual(info["configuration_sha256"], config_fingerprint(config))
            with self.assertRaises(FileExistsError):
                save_resume_bundle(path, model, tok, optimizer, global_step=7,
                    scheduler_state=scheduler, rng=rng, corpus_sha256=corpus_hash, configuration=config)
            # Change the source objects after saving to prove load is from the bundle.
            for value in model.p.values():
                value.fill(99)
            loaded = load_resume_bundle(path, tok, expected_corpus_sha256=corpus_hash, expected_configuration=config)
            for k in snapshot_weights:
                np.testing.assert_array_equal(loaded["model"].p[k], snapshot_weights[k])
                np.testing.assert_array_equal(loaded["optimizer"].m[k], snapshot_m[k])
                np.testing.assert_array_equal(loaded["optimizer"].v[k], snapshot_v[k])
            self.assertEqual(loaded["optimizer"].t, 7)
            self.assertEqual(loaded["scheduler_state"], scheduler)
            np.testing.assert_array_equal(loaded["rng"].integers(0, 100, size=5), expected_draw)
            self.assertEqual(loaded["global_step"], 7)
            self.assertEqual(loaded["corpus_sha256"], corpus_hash)

    def test_resume_refuses_configuration_or_corpus_drift(self):
        tok = SovereignTokenizer()
        model = NativeLM(LMConfig(vocab=40, d_model=16, n_layers=1, n_heads=2, d_ffn=24, ctx=8), seed=12)
        opt = AdamW(model, lr=0.001)
        config = {"batch": 2}
        digest = hashlib.sha256(b"test").hexdigest()
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "s.bundle"
            save_resume_bundle(path, model, tok, opt, global_step=0,
                scheduler_state={"global_step": 0}, rng=np.random.default_rng(1),
                corpus_sha256=digest, configuration=config)
            with self.assertRaisesRegex(ValueError, "corpus hash mismatch"):
                load_resume_bundle(path, tok, expected_corpus_sha256="0" * 64, expected_configuration=config)
            with self.assertRaisesRegex(ValueError, "configuration hash mismatch"):
                load_resume_bundle(path, tok, expected_corpus_sha256=digest, expected_configuration={"batch": 8})


class CandidateAuditTests(unittest.TestCase):
    @unittest.skipUnless(CANDIDATE.is_file(), "candidate checkpoint is not in this working copy")
    def test_candidate_raw_structure_and_runtime_mode_without_inference(self):
        before = hashlib.sha256(CANDIDATE.read_bytes()).hexdigest()
        result = inspect_checkpoint(CANDIDATE)
        after = hashlib.sha256(CANDIDATE.read_bytes()).hexdigest()
        self.assertEqual(before, after)
        self.assertEqual(result["integrity_status"], "STRUCTURAL_CHECKS_PASS")
        self.assertEqual(result["metadata"]["total_params"], 502912)
        self.assertNotEqual(result["metadata"]["target_total_params"], 502912)
        self.assertEqual(result["runtime_compatibility"], "PARTIAL_STRUCTURAL_SUPPORT")
        self.assertFalse(result["inference_executed"])
        self.assertEqual(result["quality_status"], "NOT_EVALUATED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
