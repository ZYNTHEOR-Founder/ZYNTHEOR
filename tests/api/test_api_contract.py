# -*- coding: utf-8 -*-
"""API contract and bridge protocol integration tests."""

import json
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class BridgeApiIntegrationTests(unittest.TestCase):
    def test_bridge_api_ping_endpoint_and_fail_closed_contract(self):
        env = dict(os.environ)
        env.pop("CHECKPOINT_PRESIGNED_URL", None)
        env.pop("S3_BUCKET", None)
        proc = subprocess.Popen(
            [sys.executable, os.path.join(ROOT, "qplus_native", "bridge.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        try:
            proc.stdin.write(json.dumps({"id": "1", "cmd": "ping"}) + "\n")
            proc.stdin.flush()
            msg = json.loads(proc.stdout.readline())
            self.assertEqual(msg["status"], "fail_closed")
            self.assertFalse(msg["weights_loaded"])
            self.assertFalse(msg["inference_ready"])
        finally:
            proc.kill()
            proc.wait(timeout=5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
