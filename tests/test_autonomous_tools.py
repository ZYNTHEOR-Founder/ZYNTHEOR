# -*- coding: utf-8 -*-
"""Unit tests for Phase 6 AutonomousToolDispatcher, Path Jail, Sandbox runner, and Self-Repair loop."""

import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.autonomous_tools import (
    AUTONOMOUS_TOOL_SCHEMAS,
    AutonomousToolDispatcher,
    run_terminal_command,
    run_test,
    write_workspace_file,
)
from qplus_native.safe_exec import Sandbox


class AutonomousToolsTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.sandbox = Sandbox(self.tmpdir.name)
        self.dispatcher = AutonomousToolDispatcher(self.sandbox)

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_schemas_and_prompt_instructions_present(self):
        names = {s["tool"] for s in AUTONOMOUS_TOOL_SCHEMAS}
        self.assertTrue(
            {"write_workspace_file", "run_terminal_command", "run_test", "search_internet", "execute_plan_with_repair"}.issubset(names)
        )
        prompt = self.dispatcher.get_prompt_schema_instructions()
        self.assertIn("write_workspace_file", prompt)
        self.assertIn("run_terminal_command", prompt)

    def test_write_workspace_file_enforces_path_jail_and_secret_block(self):
        escape = write_workspace_file(self.sandbox, "../outside.py", "print(1)")
        self.assertFalse(escape["ok"])
        self.assertIn("escapes workdir", escape["error"])

        secret = write_workspace_file(self.sandbox, ".env.production", "API_KEY=123456")
        self.assertFalse(secret["ok"])
        self.assertIn("secret-like", secret["error"])

        ok = self.dispatcher.dispatch({
            "tool": "write_workspace_file",
            "arguments": {"filepath": "app/calc.py", "content": "def add(a, b):\n    return a + b\n"},
        })
        self.assertTrue(ok["ok"])
        read_back = self.dispatcher.dispatch({
            "tool": "read_workspace_file",
            "arguments": {"filepath": "app/calc.py"},
        })
        self.assertTrue(read_back["ok"])
        self.assertIn("def add", read_back["content"])

    def test_run_terminal_command_blocks_disallowed_shell_and_runs_python(self):
        blocked = run_terminal_command(self.sandbox, "bash -c 'echo pwned'")
        self.assertFalse(blocked["ok"])
        self.assertIn("not in allowlist", blocked["error"])

        write_workspace_file(self.sandbox, "hello.py", "print('AUTONOMOUS_OK')\n")
        ran = self.dispatcher.dispatch({
            "tool": "run_terminal_command",
            "arguments": {"command": "python3 -I hello.py"},
        })
        self.assertTrue(ran["ok"])
        self.assertIn("AUTONOMOUS_OK", ran["output"])

    def test_run_test_executes_unittest_inside_sandbox(self):
        write_workspace_file(self.sandbox, "math_mod.py", "def add(a, b):\n    return a + b\n")
        write_workspace_file(
            self.sandbox,
            "test_math_mod.py",
            "import unittest\nfrom math_mod import add\n\nclass T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n",
        )
        res = run_test(self.sandbox, target="test_math_mod.py", runner="unittest")
        self.assertTrue(res["ok"])
        self.assertTrue(res["passed"])
        self.assertEqual(res["returncode"], 0)

    def test_execute_plan_with_repair_self_heals_defective_code(self):
        plan = {
            "goal": "Implement add(a, b) and pass unit tests",
            "steps": [
                {
                    "id": "write_impl",
                    "do": "write_file",
                    "path": "adder.py",
                    "content": "def add(a, b):\n    return a - b\n",
                },
                {
                    "id": "write_test",
                    "do": "write_file",
                    "path": "test_adder.py",
                    "content": (
                        "import unittest\n"
                        "from adder import add\n\n"
                        "class AdderTest(unittest.TestCase):\n"
                        "    def test_add(self):\n"
                        "        self.assertEqual(add(4, 6), 10)\n\n"
                        "if __name__ == '__main__':\n"
                        "    unittest.main()\n"
                    ),
                },
                {"id": "run_tests", "do": "run", "argv": ["python3", "-I", "test_adder.py"]},
            ],
            "acceptance": [
                {"check": "returncode_zero", "step": "run_tests"},
                {"check": "file_exists", "path": "adder.py"},
            ],
        }
        out = self.dispatcher.dispatch({
            "tool": "execute_plan_with_repair",
            "arguments": {"plan": plan, "max_repairs": 3},
        })
        self.assertTrue(out["ok"])
        self.assertEqual(out["status"], "SUCCEEDED")
        self.assertTrue(out["repaired"])
        self.assertGreaterEqual(len(out["repair_attempts"]), 1)

    def test_dispatcher_rejects_unknown_arguments(self):
        bad = self.dispatcher.dispatch({
            "tool": "write_workspace_file",
            "arguments": {"filepath": "x.py", "content": "1", "evil": True},
        })
        self.assertFalse(bad["ok"])
        self.assertIn("Unexpected arguments", bad["error"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
