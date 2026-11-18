# -*- coding: utf-8 -*-
"""Security invariants for cloud SSRF, external brain endpoints, and sandbox escape prevention."""

import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.cloud_storage import validate_cloud_url
from qplus_native.external_brain import RealScaffoldAdapter, validate_brain_endpoint_url
from qplus_native.orchestrator import Orchestrator, validate_plan
from qplus_native.safe_exec import PolicyError, Sandbox


class SecurityInvariantsTests(unittest.TestCase):
    def test_security_ssrf_and_sandbox_escape_rejected(self):
        ok, _ = validate_cloud_url("http://169.254.169.254/latest/meta-data/")
        self.assertFalse(ok)
    def test_sandbox_blocks_internal_symlinks_and_nofollow_open(self):
        with tempfile.TemporaryDirectory() as tmp:
            sb = Sandbox(tmp)
            sb.write_file("real.txt", "safe")
            os.symlink("real.txt", os.path.join(tmp, "alias.txt"))
            with self.assertRaises(PolicyError):
                sb.read_file("alias.txt")
            with self.assertRaises(PolicyError):
                sb.write_file("alias.txt", "overwrite")
            with self.assertRaises(PolicyError):
                sb._open_no_follow(os.path.join(tmp, "alias.txt"), os.O_RDONLY, "read_file", "alias.txt")

    def test_sandbox_blocks_unittest_start_dir_escape_and_disallowed_flags(self):
        with tempfile.TemporaryDirectory() as tmp:
            sb = Sandbox(tmp)
            with self.assertRaises(PolicyError):
                sb.run(["python3", "-I", "-m", "unittest", "discover", "-s", "/etc"])
            with self.assertRaises(PolicyError):
                sb.run(["python3", "-I", "-m", "unittest", "../../../outside.py"])
            with self.assertRaises(PolicyError):
                sb.run(["python3", "-I", "-m", "unittest", "--unknown-flag"])

    def test_validate_plan_enforces_step_payloads_and_unhashable_ids(self):
        errs_unhashable = validate_plan({
            "steps": [{"id": ["bad"], "do": "write_file", "path": "a.py", "content": "x"}],
            "acceptance": [{"check": "file_exists", "path": "a.py"}],
        })
        self.assertTrue(any("non-string" in e for e in errs_unhashable))

        errs_shell = validate_plan({
            "steps": [{"id": "s1", "do": "run", "argv": "python3 -c 'print(1)'"}],
            "acceptance": [{"check": "returncode_zero", "step": "s1"}],
        })
        self.assertTrue(any("argv" in e for e in errs_shell))

        with tempfile.TemporaryDirectory() as tmp:
            res = Orchestrator(Sandbox(tmp)).execute({
                "steps": [{"id": "s1", "do": "write_file", "path": "a.py"}],
                "acceptance": [{"check": "file_exists", "path": "a.py"}],
            })
            self.assertEqual(res["status"], "INVALID_PLAN")


if __name__ == "__main__":
    unittest.main(verbosity=2)


def test_private_network_is_only_allowed_for_explicit_s3_endpoint():
    ok, _ = validate_cloud_url("http://10.20.0.5:9000", allow_private=True)
    assert ok is True
    ok, err = validate_cloud_url("http://169.254.169.254/latest/meta-data/", allow_private=True)
    assert ok is False
    assert "SSRF_BLOCKED" in (err or "")

def test_cloud_runtime_health_url_is_not_a_checkpoint_source(monkeypatch):
    from qplus_native.cloud_storage import validate_cloud_runtime_config
    for key in ("CHECKPOINT_PRESIGNED_URL", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("CLOUD_RUNTIME_URL", "https://runtime.example.test/health")
    monkeypatch.delenv("ZYNTHEOR_CONNECTIVITY_PROBE_URL", raising=False)
    result = validate_cloud_runtime_config()
    assert result["config_valid"] is False
    assert result["provider"] == "none"
    assert "CHECKPOINT_PRESIGNED_URL" in result["missing_keys"]

def test_health_endpoint_reachability_does_not_mark_checkpoint_ready(monkeypatch):
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from threading import Thread
    from qplus_native.cloud_storage import check_cloud_connectivity

    class HealthHandler(BaseHTTPRequestHandler):
        def do_HEAD(self):
            self.send_response(200)
            self.end_headers()
        def log_message(self, *_args):
            pass

    server = HTTPServer(("127.0.0.1", 0), HealthHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for key in ("CHECKPOINT_PRESIGNED_URL", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "ZYNTHEOR_CONNECTIVITY_PROBE_URL"):
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("CLOUD_RUNTIME_URL", f"http://127.0.0.1:{server.server_port}/health")
        monkeypatch.setenv("ZYNTHEOR_ALLOW_LOOPBACK_CLOUD", "true")
        result = check_cloud_connectivity(timeout_s=1.0)
        assert result["online"] is True
        assert result["checkpoint_configured"] is False
        assert result["code"] == "CHECKPOINT_NOT_CONFIGURED"
    finally:
        server.shutdown()
        server.server_close()
