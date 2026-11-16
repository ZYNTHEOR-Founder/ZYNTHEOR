# -*- coding: utf-8 -*-
"""Security invariants for cloud SSRF, external brain endpoints, and sandbox escape prevention."""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.cloud_storage import validate_cloud_url
from qplus_native.external_brain import RealScaffoldAdapter, validate_brain_endpoint_url
from qplus_native.hybrid_brain import BrainError
from qplus_native.safe_exec import PolicyError


class SecurityInvariantsTests(unittest.TestCase):
    def test_security_ssrf_and_sandbox_escape_rejected(self):
        ok, _ = validate_cloud_url("http://169.254.169.254/latest/meta-data/")
        self.assertFalse(ok)
        with self.assertRaises(BrainError):
            validate_brain_endpoint_url("http://10.0.0.1/v1/chat/completions")
        adapter = RealScaffoldAdapter()
        try:
            with self.assertRaises(PolicyError):
                adapter.sandbox.write_file("../escape.py", "print(1)")
        finally:
            adapter.cleanup()


if __name__ == "__main__":
    unittest.main(verbosity=2)
