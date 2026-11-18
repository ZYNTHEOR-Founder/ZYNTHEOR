# -*- coding: utf-8 -*-
"""Tests for HYBRID (ก) — Fixture logic tests + REAL Sandbox/Orchestrator/Repair/Deliver integration tests."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.external_brain import RealScaffoldAdapter, make_http_complete, validate_brain_endpoint_url
from qplus_native.hybrid_brain import BrainError, HybridBrain, extract_json
from qplus_native.orchestrator import validate_plan as real_validate_plan
from qplus_native.stage_bench import TASKS, run_bench


# --- Test doubles for isolated adapter unit checks ---
class FakePlanner:
    def package_deliverable(self, plan, files):
        return {"ok": True, "files": list(files.keys())}


class FakeOrchestrator:
    def validate_plan(self, plan):
        return isinstance(plan, dict) and "steps" in plan and "files" in plan


class FakeRepair:
    def repair(self, plan, files, out):
        return files


class FakeSandbox:
    def run_tests(self, files, test_code):
        ns = {}
        core = files.get("app/core.py", "")
        try:
            exec(core, ns)
            import types
            mod = types.ModuleType("app.core")
            mod.__dict__.update(ns)
            pkg = types.ModuleType("app")
            pkg.core = mod
            sys.modules["app"] = pkg
            sys.modules["app.core"] = mod
            exec(test_code, {"__name__": "__hidden__"})
            return {"passed": True}
        except Exception as e:
            return {"passed": False, "error": repr(e)}


def make_complete(kind: str):
    """FIXTURE: deterministic test responder (not a real language model)."""
    calls = {"repair_count": 0}

    def complete(system, user):
        if kind == "bad_json":
            return "not json at all {{{"
        if kind == "good_slugify_only":
            if "slugify" in user:
                code = "import re\ndef slugify(text: str) -> str:\n    t=text.lower()\n    t=re.sub(r'[^a-z0-9]+','-',t)\n    return t.strip('-')\n"
            else:
                code = "def dummy(): pass\n"
            if "understand" in system.lower():
                return json.dumps({"spec": "spec", "constraints": [], "files": ["app/core.py"], "acceptance": "hidden"})
            if "plan" in system.lower():
                return json.dumps({"steps": [{"file": "app/core.py", "action": "create"}], "files": ["app/core.py"], "tests": ["tests/test_app.py"]})
            return json.dumps({"files": {"app/core.py": code, "app/__init__.py": "", "tests/test_app.py": "import unittest\nclass T(unittest.TestCase):\n    def test_ok(self): self.assertTrue(True)\n"}})
        if kind == "defect_then_repaired":
            if "understand" in system.lower():
                return json.dumps({"spec": "Implement slugify", "constraints": ["stdlib"], "files": ["app/core.py"], "acceptance": "hidden"})
            if "plan" in system.lower():
                return json.dumps({"steps": [{"file": "app/core.py", "action": "create"}], "files": ["app/core.py"], "tests": ["tests/test_app.py"]})
            if "repair" in system.lower():
                calls["repair_count"] += 1
                fixed = "import re\ndef slugify(text: str) -> str:\n    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')\n"
                return json.dumps({"files": {"app/core.py": fixed}})
            # Initial buggy build (leaves underscores unreplaced!)
            buggy = "def slugify(text: str) -> str:\n    return text.lower().strip()\n"
            return json.dumps({
                "files": {
                    "app/__init__.py": "",
                    "app/core.py": buggy,
                    "tests/__init__.py": "",
                    "tests/test_app.py": "import unittest\nfrom app.core import slugify\nclass T(unittest.TestCase):\n    def test_basic(self): self.assertEqual(slugify('hello'), 'hello')\n",
                }
            })
        if kind == "path_escape":
            if "understand" in system.lower():
                return json.dumps({"spec": "escape probe", "constraints": [], "files": ["../evil.py"], "acceptance": "blocked"})
            if "plan" in system.lower():
                return json.dumps({"steps": [{"file": "../evil.py", "action": "create"}], "files": ["../evil.py"], "tests": []})
            return json.dumps({"files": {"../evil.py": "print('owned')\n"}})
        if "plan" in system.lower():
            return json.dumps({"steps": [{"file": "app/core.py", "action": "create"}], "files": ["app/core.py"], "tests": []})
        if "understand" in system.lower():
            return json.dumps({"spec": "spec", "constraints": [], "files": ["app/core.py"], "acceptance": "hidden"})
        return json.dumps({"files": {"app/core.py": "x=1\n"}})

    return complete


def test_extract_json():
    assert extract_json('{"a":1}') == {"a": 1}
    assert extract_json('```json\n{"a":2}\n```') == {"a": 2}
    assert extract_json('hello {"a":3} bye') == {"a": 3}
    print("PASS extract_json")


def test_fail_closed_no_complete():
    try:
        HybridBrain(None, FakePlanner(), FakeOrchestrator(), FakeRepair(), FakeSandbox())
        raise AssertionError("should have raised")
    except BrainError:
        print("PASS fail-closed no complete")


def test_bad_json_fails_stage():
    b = HybridBrain(make_complete("bad_json"), FakePlanner(), FakeOrchestrator(), FakeRepair(), FakeSandbox())
    rep = b.run_task("Write slugify", hidden_test_code="assert True")
    assert rep["stages"]["understand"]["ok"] is False
    assert rep["delivered"] is False
    print("PASS bad_json -> understand FAILED, not delivered")


def test_bench_distinguishes_pass_fail():
    b = HybridBrain(make_complete("good_slugify_only"), FakePlanner(), FakeOrchestrator(), FakeRepair(), FakeSandbox())
    out = run_bench(b, task_ids=["slugify", "roman"])
    by = {r["id"]: r for r in out["tasks"]}
    assert by["slugify"]["hidden_ok"] is True, by
    assert by["roman"]["hidden_ok"] is False, by
    assert by["roman"]["false_success"] is False
    assert out["taskCount"] == 20
    assert out["summary"]["stages"]["understand"]["ratePct"] == 100.0
    assert out["summary"]["hiddenPassRatePct"] == 50.0
    print("PASS bench distinguishes slugify PASS / roman FAIL + 20-task catalog + per-stage rates")


def test_validate_rejects_bad_plan():
    class BadPlanComplete:
        def __call__(self, system, user):
            if "understand" in system.lower():
                return json.dumps({"spec": "x"})
            if "plan" in system.lower():
                return json.dumps({"no_steps": True})
            return json.dumps({"files": {}})

    b = HybridBrain(BadPlanComplete(), FakePlanner(), FakeOrchestrator(), FakeRepair(), FakeSandbox())
    rep = b.run_task("goal", hidden_test_code="assert True")
    assert rep["stages"]["plan"]["ok"] is False
    print("PASS validate_plan rejects bad plan")


def test_real_orchestrator_list_validate_plan():
    # Real validate_plan returns List[str] (empty = valid, non-empty = invalid)
    assert real_validate_plan({"goal": "x", "steps": [{"id": "s1", "do": "write_file", "path": "a.py", "content": "x=1"}], "acceptance": [{"check": "file_exists", "path": "a.py"}]}) == []
    assert len(real_validate_plan({"no_steps": True})) > 0

    class RawOrc:
        validate_plan = staticmethod(real_validate_plan)

    class OrcPlanComplete:
        def __call__(self, system, user):
            if "understand" in system.lower():
                return json.dumps({"spec": "hello", "constraints": [], "files": ["a.py"], "acceptance": "ok"})
            if "plan" in system.lower():
                return json.dumps({
                    "goal": "hello",
                    "steps": [{"id": "s1", "do": "write_file", "path": "a.py", "content": "x = 1\n"}],
                    "acceptance": [{"check": "file_exists", "path": "a.py"}],
                })
            return json.dumps({"files": {"app/core.py": "x=1\n"}})

    b = HybridBrain(OrcPlanComplete(), FakePlanner(), RawOrc(), FakeRepair(), FakeSandbox())
    rep = b.run_task("hello", hidden_test_code="assert True")
    assert rep["stages"]["plan"]["ok"] is True, rep
    print("PASS real orchestrator validate_plan (List[str]) works cleanly in HybridBrain")


def test_real_scaffold_repair_and_zip_delivery():
    scaffold = RealScaffoldAdapter()
    try:
        b = HybridBrain(
            make_complete("defect_then_repaired"),
            planner=scaffold,
            orchestrator=scaffold,
            repair=scaffold,
            sandbox=scaffold,
            validate_plan_fn=scaffold.validate_plan,
        )
        slug_task = next(t for t in TASKS if t["id"] == "slugify")
        rep = b.run_task(slug_task["goal"], hidden_test_code=slug_task["hidden"])
        assert rep["stages"]["understand"]["ok"] is True
        assert rep["stages"]["plan"]["ok"] is True
        assert rep["stages"]["build"]["ok"] is True
        assert rep["stages"]["test"]["ok"] is False  # initial buggy code MUST fail hidden test
        assert rep["stages"]["repair"]["ok"] is True
        assert rep["stages"]["test_after_repair"]["ok"] is True
        assert rep["stages"]["deliver"]["ok"] is True
        assert rep["delivered"] is True
        assert rep["hidden_ok"] is True
        assert rep["false_success"] is False
        assert rep["package"]["integrity_ok"] is True
        assert len(rep["package"]["zip_sha256"]) == 64
        print("PASS real Sandbox + Orchestrator + Repair + Verified SHA-256 ZIP delivery")
    finally:
        scaffold.cleanup()


def test_real_sandbox_blocks_path_escape():
    scaffold = RealScaffoldAdapter()
    try:
        b = HybridBrain(
            make_complete("path_escape"),
            planner=scaffold,
            orchestrator=scaffold,
            repair=scaffold,
            sandbox=scaffold,
            validate_plan_fn=scaffold.validate_plan,
        )
        rep = b.run_task("escape test", hidden_test_code="assert True")
        assert rep["delivered"] is False
        assert rep["stages"]["test"]["ok"] is False
        assert "POLICY_BLOCKED" in rep["stages"]["test"]["detail"]
        print("PASS real Sandbox rejects path traversal proposals from external brain")
    finally:
        scaffold.cleanup()


def test_external_http_connector_security_and_fail_closed():
    try:
        validate_brain_endpoint_url("http://169.254.169.254/latest/meta-data/")
        raise AssertionError("Should reject IMDS")
    except BrainError as exc:
        assert "SSRF_BLOCKED" in str(exc)

    try:
        make_http_complete(provider="local", api_key="")
        raise AssertionError("Should fail closed without API key")
    except BrainError as exc:
        assert "FAIL_CLOSED" in str(exc)
    print("PASS make_http_complete SSRF + fail-closed checks")


if __name__ == "__main__":
    test_extract_json()
    test_fail_closed_no_complete()
    test_bad_json_fails_stage()
    test_bench_distinguishes_pass_fail()
    test_validate_rejects_bad_plan()
    test_real_orchestrator_list_validate_plan()
    test_real_scaffold_repair_and_zip_delivery()
    test_real_sandbox_blocks_path_escape()
    test_external_http_connector_security_and_fail_closed()
    print("ALL 9 HYBRID ADAPTER & REAL SCAFFOLD TESTS PASSED")
