# -*- coding: utf-8 -*-
"""Tests for HYBRID (ก) — ใช้ TEST DOUBLE เท่านั้น ผลนี้พิสูจน์ logic ของ adapter/bench ไม่ใช่พิสูจน์สมองจริง"""
import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from hybrid_brain import HybridBrain, BrainError, extract_json
from stage_bench import run_bench, TASKS

# --- Test doubles ที่เลียนแบบ API ที่เห็นใน brain.py 1-81 ---
class FakePlanner:
    def package_deliverable(self, plan, files):
        return {"ok": True, "files": list(files.keys())}

class FakeOrchestrator:
    def validate_plan(self, plan):
        # เหมือน validate_plan ตัวจริงขั้นต่ำ: ต้องมี steps/files
        return isinstance(plan, dict) and "steps" in plan and "files" in plan

class FakeRepair:
    def repair(self, plan, files, out):
        return files

class FakeSandbox:
    """รัน hidden test จริงด้วย exec ใน namespace เปล่า — ไม่ใช่ mock ว่าผ่าน"""
    def run_tests(self, files, test_code):
        # files: {path: content} — เอาเฉพาะ app/core.py มารัน
        ns = {}
        core = files.get("app/core.py", "")
        try:
            exec(core, ns)
            # hidden test ใช้ `from app.core import X` — จำลองด้วยการใส่ module ปลอมใน sys.modules
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
    """FIXTURE: ไม่ใช่สมองจริง ใช้พิสูจน์ว่า adapter จับถูก/ผิดได้"""
    def complete(system, user):
        if kind == "bad_json":
            return "not json at all {{{"
        if kind == "good_slugify_only":
            # ตอบถูกเฉพาะ slugify (ดูจาก goal ใน user) ที่เหลือตอบ code ผิดเพื่อให้ bench จับ false_success ได้
            if "slugify" in user:
                code = "import re\ndef slugify(text: str) -> str:\n    t=text.lower()\n    t=re.sub(r'[^a-z0-9]+','-',t)\n    return t.strip('-')\n"
            else:
                code = "def dummy(): pass\n"
            if "understand" in system.lower():
                return json.dumps({"spec": "spec", "constraints": [], "files": ["app/core.py"], "acceptance": "hidden"})
            if "plan" in system.lower():
                return json.dumps({"steps": [{"file": "app/core.py", "action": "create"}], "files": ["app/core.py"], "tests": ["tests/test_app.py"]})
            return json.dumps({"files": {"app/core.py": code, "app/__init__.py": "", "tests/test_app.py": "def test_x(): pass\n"}})
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
    assert by["roman"]["hidden_ok"] is False, by  # fixture ตอบ code ผิดให้ roman -> ต้องจับได้ว่าไม่ผ่าน
    assert by["roman"]["false_success"] is False  # ไม่ใช่ false_success เพราะ delivered=False
    print("PASS bench distinguishes slugify PASS / roman FAIL")
    print(json.dumps(out["summary"], ensure_ascii=False))

def test_validate_rejects_bad_plan():
    class BadPlanComplete:
        def __call__(self, system, user):
            if "understand" in system.lower():
                return json.dumps({"spec": "x"})
            if "plan" in system.lower():
                return json.dumps({"no_steps": True})  # validate ต้องปฏิเสธ
            return json.dumps({"files": {}})
    b = HybridBrain(BadPlanComplete(), FakePlanner(), FakeOrchestrator(), FakeRepair(), FakeSandbox())
    rep = b.run_task("goal", hidden_test_code="assert True")
    assert rep["stages"]["plan"]["ok"] is False
    print("PASS validate_plan rejects bad plan")

if __name__ == "__main__":
    test_extract_json()
    test_fail_closed_no_complete()
    test_bad_json_fails_stage()
    test_bench_distinguishes_pass_fail()
    test_validate_rejects_bad_plan()
    print("ALL 5 HYBRID TESTS PASSED (FIXTURE — not real brain)")
