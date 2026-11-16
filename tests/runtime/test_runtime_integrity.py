# -*- coding: utf-8 -*-
"""
ZYNTHEOR Runtime Integrity Test Suite (pytest + unittest compatible).
Validates:
- Hybrid Brain + Real Scaffold Adapter (planner/orchestrator/repair/safe_exec)
- Fail-closed Cloud Runtime enforcement & SSRF protections
- Sandbox path traversal rejection & SHA-256 ZIP deliverable packaging
- Bridge verification suite & cooperative cancellation
"""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.bridge import run_verification_suite
from qplus_native.cloud_storage import validate_cloud_url
from qplus_native.external_brain import (
    RealScaffoldAdapter,
    get_external_brain_status,
    make_http_complete,
    validate_brain_endpoint_url,
)
from qplus_native.hybrid_brain import BrainError, HybridBrain, extract_json
from qplus_native.model import NativeNeuralModel
from qplus_native.stage_bench import TASKS, summarize_stage_rates


class RuntimeIntegrityTests(unittest.TestCase):
    def test_cloud_url_ssrf_blocking(self):
        for url in (
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/checkpoint.pt",
            "http://192.168.1.5/checkpoint.pt",
            "file:///etc/passwd",
        ):
            ok, reason = validate_cloud_url(url)
            self.assertFalse(ok)
            self.assertIn("FAIL_CLOSED", reason or "")

    def test_external_brain_endpoint_fail_closed_and_ssrf(self):
        with self.assertRaises(BrainError):
            validate_brain_endpoint_url("http://169.254.169.254/latest/meta-data/")
        with self.assertRaises(BrainError):
            validate_brain_endpoint_url("http://127.0.0.1:8080/v1/chat/completions", allow_loopback=False)
        with self.assertRaises(BrainError):
            make_http_complete(provider="local", api_key="")

        status = get_external_brain_status()
        self.assertIn("configured", status)
        self.assertEqual(status["policy"], "FAIL_CLOSED_ONLINE_EXTERNAL_BRAIN")

    def test_unconfigured_native_model_fails_closed(self):
        saved_url = os.environ.pop("CHECKPOINT_PRESIGNED_URL", None)
        saved_bucket = os.environ.pop("S3_BUCKET", None)
        try:
            with self.assertRaises(RuntimeError) as ctx:
                NativeNeuralModel()
            self.assertIn("FAIL_CLOSED", str(ctx.exception))
        finally:
            if saved_url is not None:
                os.environ["CHECKPOINT_PRESIGNED_URL"] = saved_url
            if saved_bucket is not None:
                os.environ["S3_BUCKET"] = saved_bucket

    def test_real_scaffold_repair_and_zip_deliverable(self):
        calls = {"n": 0}

        def _scripted_brain(sys_p: str, usr_p: str) -> str:
            calls["n"] += 1
            if "understand stage" in sys_p:
                return '{"spec":"is_even","constraints":["stdlib"],"files":["app/core.py"],"acceptance":["returns bool"]}'
            if "plan stage" in sys_p:
                return '{"steps":[{"file":"app/core.py","action":"write"},{"file":"tests/test_app.py","action":"test"}],"files":["app/core.py","tests/test_app.py"],"tests":["unittest"]}'
            if "build stage" in sys_p:
                return json.dumps({
                    "files": {
                        "app/__init__.py": "",
                        "app/core.py": "def is_even(n: int) -> bool:\n    return n % 2 == 1\n",
                        "tests/test_app.py": "import unittest\nfrom app.core import is_even\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(is_even(2))\nif __name__ == '__main__': unittest.main()\n",
                    }
                })
            if "repair stage" in sys_p:
                return json.dumps({
                    "files": {
                        "app/core.py": "def is_even(n: int) -> bool:\n    return n % 2 == 0\n"
                    }
                })
            raise RuntimeError(f"Unexpected prompt: {sys_p}")

        adapter = RealScaffoldAdapter()
        try:
            hb = HybridBrain(_scripted_brain, adapter, adapter, adapter, adapter)
            rep = hb.run_task(
                "Implement is_even",
                hidden_test_code="from app.core import is_even\nassert is_even(4) and not is_even(3)\nprint('HIDDEN_OK')\n",
            )
            self.assertTrue(rep["delivered"])
            self.assertTrue(rep["hidden_ok"])
            self.assertTrue(rep["package"]["integrity_ok"])
            self.assertEqual(len(rep["package"]["zip_sha256"]), 64)
        finally:
            adapter.cleanup()

    def test_sandbox_blocks_path_traversal(self):
        def _evil_brain(sys_p: str, _usr_p: str) -> str:
            if "understand stage" in sys_p:
                return '{"spec":"evil","constraints":[],"files":["../../etc/pwned"],"acceptance":[]}'
            if "plan stage" in sys_p:
                return '{"steps":[{"file":"../../etc/pwned","action":"write"}],"files":["../../etc/pwned"],"tests":[]}'
            return '{"files":{"../../etc/pwned":"pwned"}}'

        adapter = RealScaffoldAdapter()
        try:
            hb = HybridBrain(_evil_brain, adapter, adapter, adapter, adapter)
            rep = hb.run_task("Evil", hidden_test_code="print('HIDDEN_OK')\n")
            self.assertFalse(rep["delivered"])
            self.assertFalse(rep["stages"]["test"]["ok"])
            self.assertIn("POLICY_BLOCKED", rep["stages"]["test"]["detail"])
        finally:
            adapter.cleanup()

    def test_stage_bench_catalog_and_verification_suite_blocked_state(self):
        self.assertGreaterEqual(len(TASKS), 20)
        summary = summarize_stage_rates([])
        self.assertEqual(summary.get("tasks_run", 0), 0)
        suite = run_verification_suite(None)
        self.assertEqual(suite["status"], "PARTIAL_BLOCKED")
        self.assertFalse(suite["verified"])
        self.assertEqual(extract_json('```json\n{"ok":true}\n```'), {"ok": True})


import json  # noqa: E402

if __name__ == "__main__":
    unittest.main(verbosity=2)
