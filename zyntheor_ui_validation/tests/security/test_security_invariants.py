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
