# -*- coding: utf-8 -*-
"""Readiness, fail-closed gate, and resume-safety tests for `qplus_native.train_target`.

Uses ephemeral TemporaryDirectory fixtures (not real datasets, approvals, or 41.53M training).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.architecture import TARGET_TOTAL_PARAMS
from qplus_native.candidate_audit import inspect_checkpoint
from qplus_native.dataset_governance import SCHEMA_VERSION, content_sha256
from qplus_native.lm_v2 import LMConfig, NativeLM
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.train_target import run_preflight, run_training, verify_numpy_backend
from qplus_native.trusted_approvals import approval_payload


def _write_evidence(root: Path, rel: str, content: bytes) -> dict:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
    return {"path": rel, "sha256": hashlib.sha256(content).hexdigest()}


def _build_signed_fixture(tmp_dir: Path) -> dict:
    """Create ephemeral test-only provenance bundle + dataset JSONL + 0600 HMAC key."""
    key_bytes = bytes(range(32, 64))
    key_file = tmp_dir / "test_trust_key.json"
    key_file.write_text(
        json.dumps({"key_id": "unit-test-key", "key_hex": key_bytes.hex()}),
        encoding="utf-8",
    )
    os.chmod(key_file, 0o600)

    ev_root = tmp_dir / "evidence"
    docs_spec = [
        (
            "unit-train-1",
            "train",
            "function computeSum(a, b) { return a + b; }\n" * 6,
        ),
        (
            "unit-val-1",
            "validation",
            "ระบบตรวจสอบความถูกต้องของข้อมูลและโครงสร้างโมเดลภาษา ZYNTHEOR\n" * 4,
        ),
        (
            "unit-test-1",
            "test",
            "Held-out evaluation prompt: verify determinism and accuracy without leakage.\n" * 4,
        ),
    ]

    dataset_file = tmp_dir / "dataset.jsonl"
    manifest_docs = []
    with dataset_file.open("w", encoding="utf-8") as fh:
        for doc_id, split, text in docs_spec:
            fh.write(
                json.dumps({"document_id": doc_id, "split": split, "text": text}, ensure_ascii=False)
                + "\n"
            )
            ev = {
                "source": _write_evidence(ev_root, f"{doc_id}/source.txt", b"unit test source fixture"),
                "license": _write_evidence(ev_root, f"{doc_id}/license.txt", b"unit test license fixture"),
                "rights": _write_evidence(ev_root, f"{doc_id}/rights.txt", b"unit test rights fixture"),
                "approval": _write_evidence(ev_root, f"{doc_id}/approval.txt", b"unit test approval fixture"),
            }
            rec = {
                "document_id": doc_id,
                "document_sha256": content_sha256(text),
                "split": split,
                "source": {"url": "https://example.invalid/unit-test-source", "publisher": "UNIT_TEST"},
                "license": {"id": "MIT", "url": "https://example.invalid/unit-test-license"},
                "rights": {"basis": "unit-test-fixture", "scope": ["unit-test"]},
                "approval": {
                    "decision": "APPROVED",
                    "approver": "unit-test-harness",
                    "signed_at": "2026-01-01T00:00:00Z",
                    "key_id": "unit-test-key",
                    "signature": "pending",
                },
                "evidence": ev,
            }
            rec["approval"]["signature"] = hmac.new(
                key_bytes, approval_payload(rec), hashlib.sha256
            ).hexdigest()
            manifest_docs.append(rec)

    manifest_path = tmp_dir / "provenance.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": SCHEMA_VERSION,
                "dataset_id": "unit-test-dataset",
                "near_duplicate_threshold": 0.90,
                "documents": manifest_docs,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return {
        "key_file": str(key_file),
        "evidence_root": ev_root,
        "manifest_path": manifest_path,
        "dataset_file": str(dataset_file),
    }


class TargetReadinessRemediationTests(unittest.TestCase):
    def test_numpy_backend_and_target_param_count(self):
        info = verify_numpy_backend()
        self.assertEqual(info["backend"], "numpy")
        self.assertTrue(info["float32_verified"])
        self.assertEqual(TARGET_TOTAL_PARAMS, 41_527_808)

    def test_preflight_blocks_missing_checkpoint_dataset_and_human_approval(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            preflight = run_preflight(
                init_checkpoint=tmp / "missing_init.pt",
                out_checkpoint=tmp / "out_step5800.pt",
                target_steps=5800,
                steps=None,
                tokenizer_profile="v2_base",
                provenance_manifest=tmp / "missing_manifest.json",
                evidence_root=tmp / "evidence",
                approval_key_file=None,
                dataset_file=None,
                resume_state=None,
                save_resume_state=None,
                human_approval_confirmed=False,
            )
            self.assertEqual(preflight["status"], "BLOCKED")
            self.assertFalse(preflight["training_executed"])
            self.assertTrue(any("init_checkpoint_missing" in b for b in preflight["blockers"]))
            self.assertIn("dataset_governance_blocked", preflight["blockers"])
            self.assertIn("human_approval_confirmation_missing", preflight["blockers"])

    def test_fail_closed_overwrite_protection_and_tokenizer_lock(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            fx = _build_signed_fixture(tmp)
            cfg = LMConfig(vocab=1024, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=8)
            tok_v2 = SovereignTokenizer(cfg.vocab, profile="v2_base")
            model = NativeLM(cfg, seed=5, dtype=np.float32, tokenizer_profile="v2_base")
            init_ckpt = tmp / "init_v2.pt"
            model.save(str(init_ckpt), tok_v2, extra_meta={"training_steps": 1000, "training_steps_total": 1000})

            # 1. --out == --init must block
            pf_same = run_preflight(
                init_checkpoint=init_ckpt,
                out_checkpoint=init_ckpt,
                target_steps=1010,
                steps=5,
                tokenizer_profile="v2_base",
                provenance_manifest=fx["manifest_path"],
                evidence_root=fx["evidence_root"],
                approval_key_file=fx["key_file"],
                dataset_file=fx["dataset_file"],
                resume_state=None,
                save_resume_state=None,
                human_approval_confirmed=True,
                expected_params=model.num_params(),
                vocab_size=cfg.vocab,
            )
            self.assertEqual(pf_same["status"], "BLOCKED")
            self.assertIn("out_path_equals_init_checkpoint_forbidden", pf_same["blockers"])

            # 2. Requesting bilingual_v4 against a v2_base checkpoint must block
            pf_tok = run_preflight(
                init_checkpoint=init_ckpt,
                out_checkpoint=tmp / "new_out.pt",
                target_steps=1010,
                steps=5,
                tokenizer_profile="bilingual_v4",
                provenance_manifest=fx["manifest_path"],
                evidence_root=fx["evidence_root"],
                approval_key_file=fx["key_file"],
                dataset_file=fx["dataset_file"],
                resume_state=None,
                save_resume_state=None,
                human_approval_confirmed=True,
                expected_params=model.num_params(),
                vocab_size=cfg.vocab,
            )
            self.assertEqual(pf_tok["status"], "BLOCKED")
            self.assertTrue(any("tokenizer profile mismatch" in b for b in pf_tok["blockers"]))

            # 3. Omitting human approval must block even when dataset + init are valid
            with self.assertRaisesRegex(RuntimeError, "human_approval_confirmation_missing"):
                run_training(
                    init_checkpoint=init_ckpt,
                    out_checkpoint=tmp / "new_out.pt",
                    provenance_manifest=fx["manifest_path"],
                    evidence_root=fx["evidence_root"],
                    approval_key_file=fx["key_file"],
                    dataset_file=fx["dataset_file"],
                    evidence_out=tmp / "ev.json",
                    target_steps=1010,
                    steps=2,
                    tokenizer_profile="v2_base",
                    human_approval_confirmed=False,
                    cfg_override=cfg,
                    expected_params=model.num_params(),
                )

    def test_non_overwriting_training_and_exact_resume_bundle_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            fx = _build_signed_fixture(tmp)
            cfg = LMConfig(vocab=1024, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=8)
            tok_v2 = SovereignTokenizer(cfg.vocab, profile="v2_base")
            model = NativeLM(cfg, seed=13, dtype=np.float32, tokenizer_profile="v2_base")
            init_ckpt = tmp / "model_init_step10.pt"
            model.save(
                str(init_ckpt),
                tok_v2,
                extra_meta={"training_steps": 10, "training_steps_total": 10},
            )
            init_sha_before = hashlib.sha256(init_ckpt.read_bytes()).hexdigest()

            out_ckpt_1 = tmp / "model_step13.pt"
            bundle_1 = tmp / "state_step13.bundle"
            ev_1 = run_training(
                init_checkpoint=init_ckpt,
                out_checkpoint=out_ckpt_1,
                provenance_manifest=fx["manifest_path"],
                evidence_root=fx["evidence_root"],
                approval_key_file=fx["key_file"],
                dataset_file=fx["dataset_file"],
                evidence_out=tmp / "evidence_13.json",
                save_resume_state=bundle_1,
                target_steps=15,
                steps=3,
                batch=1,
                eval_every=1,
                save_every=2,
                max_val_windows=4,
                seed=7,
                tokenizer_profile="v2_base",
                human_approval_confirmed=True,
                cfg_override=cfg,
                expected_params=model.num_params(),
            )
            # Original --init checkpoint must be byte-for-byte untouched
            self.assertEqual(hashlib.sha256(init_ckpt.read_bytes()).hexdigest(), init_sha_before)
            self.assertEqual(ev_1["start_step"], 10)
            self.assertEqual(ev_1["final_step"], 13)
            self.assertTrue(out_ckpt_1.is_file())
            self.assertTrue((tmp / "model_step13.step12.pt").is_file())
            self.assertTrue(bundle_1.is_file())
            audit_1 = inspect_checkpoint(out_ckpt_1)
            self.assertEqual(audit_1["integrity_status"], "STRUCTURAL_CHECKS_PASS")

            # Existing --out cannot be overwritten
            with self.assertRaisesRegex(RuntimeError, "out_checkpoint_already_exists"):
                run_training(
                    init_checkpoint=init_ckpt,
                    out_checkpoint=out_ckpt_1,
                    provenance_manifest=fx["manifest_path"],
                    evidence_root=fx["evidence_root"],
                    approval_key_file=fx["key_file"],
                    dataset_file=fx["dataset_file"],
                    evidence_out=tmp / "evidence_dup.json",
                    target_steps=15,
                    steps=1,
                    tokenizer_profile="v2_base",
                    human_approval_confirmed=True,
                    cfg_override=cfg,
                    expected_params=model.num_params(),
                )

            # Exact continuation via --resume-state to target step 15
            out_ckpt_2 = tmp / "model_step15.pt"
            ev_2 = run_training(
                init_checkpoint=out_ckpt_1,
                out_checkpoint=out_ckpt_2,
                provenance_manifest=fx["manifest_path"],
                evidence_root=fx["evidence_root"],
                approval_key_file=fx["key_file"],
                dataset_file=fx["dataset_file"],
                evidence_out=tmp / "evidence_15.json",
                resume_state=bundle_1,
                save_resume_state=tmp / "state_step15.bundle",
                target_steps=15,
                steps=2,
                batch=1,
                eval_every=1,
                save_every=0,
                max_val_windows=4,
                seed=7,
                tokenizer_profile="v2_base",
                human_approval_confirmed=True,
                cfg_override=cfg,
                expected_params=model.num_params(),
            )
            self.assertEqual(ev_2["start_step"], 13)
            self.assertEqual(ev_2["final_step"], 15)
            audit_2 = inspect_checkpoint(out_ckpt_2)
            self.assertEqual(audit_2["integrity_status"], "STRUCTURAL_CHECKS_PASS")
            self.assertEqual(audit_2["metadata"]["training_steps_total"], 15)


if __name__ == "__main__":
    unittest.main(verbosity=2)
