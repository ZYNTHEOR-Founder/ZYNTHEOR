# -*- coding: utf-8 -*-
"""Unit & CLI preflight tests for `qplus_native.train_target` (NumPy-optional)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.train_target import (
    _inspect_approval_key,
    _sanitize_uri,
    main as train_target_main,
    run_preflight,
    run_training,
)


class TrainTargetPreflightCliTests(unittest.TestCase):
    def test_cli_help_succeeds_without_crashing(self):
        proc = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "train_target.py"), "--help"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        self.assertIn("--probe-s3", proc.stdout)
        self.assertIn("--preflight-only", proc.stdout)

    def test_cli_probe_s3_preflight_only_fails_closed_and_redacts_secrets(self):
        secret_token = "SUPER_SECRET_S3_KEY_DO_NOT_LEAK_12345"
        sig_token = "AMZ_SIGNATURE_SECRET_DO_NOT_LEAK_999"
        env = dict(os.environ)
        env["S3_ACCESS_KEY_ID"] = "AKIA_TEST_DO_NOT_LEAK"
        env["S3_SECRET_ACCESS_KEY"] = secret_token
        env["CHECKPOINT_PRESIGNED_URL"] = (
            f"https://example.invalid/zyntheor/ckpt.pt?X-Amz-Signature={sig_token}"
        )

        proc = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "train_target.py"),
                "--probe-s3",
                "--preflight-only",
            ],
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertEqual(proc.returncode, 2, msg=proc.stderr)
        payload = json.loads(proc.stdout)
        self.assertEqual(payload["status"], "BLOCKED")
        self.assertFalse(payload["training_executed"])
        self.assertIn("gates", payload)
        self.assertIn("s3_probe", payload)
        self.assertTrue(payload["s3_probe"]["probe_requested"])
        self.assertEqual(
            payload["s3_probe"]["source_uri"],
            "https://example.invalid/zyntheor/ckpt.pt?[REDACTED_QUERY]",
        )
        self.assertNotIn(secret_token, proc.stdout)
        self.assertNotIn(sig_token, proc.stdout)
        self.assertNotIn("AKIA_TEST_DO_NOT_LEAK", proc.stdout)

    def test_sanitize_uri_redacts_query_and_userinfo(self):
        self.assertEqual(
            _sanitize_uri("https://user:pass@bucket.example.com/a/b.pt?X-Amz-Signature=abc"),
            "https://bucket.example.com/a/b.pt?[REDACTED_QUERY]",
        )
        self.assertEqual(_sanitize_uri("s3://my-bucket/checkpoints/model.pt"), "s3://my-bucket/checkpoints/model.pt")
        self.assertIsNone(_sanitize_uri(""))

    def test_approval_key_inspection_enforces_0600_and_never_leaks_key_hex(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            key_path = tmp / "approval.key.json"
            secret_hex = "ab" * 32
            key_path.write_text(
                json.dumps({"key_id": "test-key-1", "key_hex": secret_hex}),
                encoding="utf-8",
            )
            os.chmod(key_path, 0o644)
            bad = _inspect_approval_key(str(key_path))
            self.assertFalse(bad["verifier_loaded"])
            self.assertFalse(bad["permissions_0600_or_stricter"])
            self.assertEqual(bad["mode_octal"], "0644")
            self.assertNotIn(secret_hex, json.dumps(bad))

            os.chmod(key_path, 0o600)
            good = _inspect_approval_key(str(key_path))
            self.assertTrue(good["verifier_loaded"])
            self.assertTrue(good["permissions_0600_or_stricter"])
            self.assertEqual(good["mode_octal"], "0600")
            self.assertNotIn(secret_hex, json.dumps(good))

    def test_run_training_remains_fail_closed_when_gates_blocked(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            preflight = run_preflight(
                init_checkpoint=tmp / "missing.pt",
                out_checkpoint=tmp / "out.pt",
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
                probe_s3=True,
            )
            self.assertEqual(preflight["status"], "BLOCKED")
            self.assertEqual(preflight["gates"]["gate_4_s3_credentials_and_bucket"], "BLOCKED")
            self.assertEqual(preflight["gates"]["gate_5_approval_key_0600"], "BLOCKED")
            self.assertEqual(preflight["gates"]["gate_6_human_approval"], "BLOCKED")

            with self.assertRaisesRegex(RuntimeError, "FAIL_CLOSED"):
                run_training(
                    init_checkpoint=tmp / "missing.pt",
                    out_checkpoint=tmp / "out.pt",
                    provenance_manifest=tmp / "missing_manifest.json",
                    evidence_root=tmp / "evidence",
                    approval_key_file=None,
                    dataset_file=None,
                    evidence_out=tmp / "evidence.json",
                    human_approval_confirmed=False,
                )

    def test_main_preflight_exit_code_is_2_when_blocked(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            code = train_target_main(
                [
                    "--init",
                    str(tmp / "missing.pt"),
                    "--out",
                    str(tmp / "out.pt"),
                    "--probe-s3",
                    "--preflight-only",
                ]
            )
            self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
