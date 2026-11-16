# -*- coding: utf-8 -*-
"""End-to-End Hybrid Brain + Sandbox execution & delivery verification tests."""

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.external_brain import RealScaffoldAdapter
from qplus_native.hybrid_brain import HybridBrain


class HybridE2ETests(unittest.TestCase):
    def test_e2e_intake_to_verified_zip_delivery(self):
        def _brain(sys_p: str, _usr_p: str) -> str:
            if "understand stage" in sys_p:
                return '{"spec":"slugify","constraints":["stdlib"],"files":["app/core.py"],"acceptance":["passes tests"]}'
            if "plan stage" in sys_p:
                return '{"steps":[{"file":"app/core.py","action":"write"},{"file":"tests/test_app.py","action":"test"}],"files":["app/core.py","tests/test_app.py"],"tests":["unittest"]}'
            if "build stage" in sys_p:
                return json.dumps({
                    "files": {
                        "app/__init__.py": "",
                        "app/core.py": "import re\ndef slugify(t: str) -> str:\n    return re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')\n",
                        "tests/test_app.py": "import unittest\nfrom app.core import slugify\nclass T(unittest.TestCase):\n    def test_slug(self):\n        self.assertEqual(slugify('Hello World!'), 'hello-world')\nif __name__ == '__main__': unittest.main()\n",
                    }
                })
            raise RuntimeError("unexpected")

        adapter = RealScaffoldAdapter()
        try:
            res = HybridBrain(_brain, adapter, adapter, adapter, adapter).run_task(
                "Create slugify",
                hidden_test_code="from app.core import slugify\nassert slugify('A--B!') == 'a-b'\nprint('HIDDEN_OK')\n",
            )
            self.assertTrue(res["delivered"])
            self.assertTrue(res["hidden_ok"])
            self.assertFalse(res["false_success"])
        finally:
            adapter.cleanup()


if __name__ == "__main__":
    unittest.main(verbosity=2)
