# -*- coding: utf-8 -*-
"""
ZYNTHEOR — HYBRID (ก) : External Brain adapter — ONLINE-ONLY, FAIL-CLOSED, NO-MOCK

สถานะที่ต้องติดป้ายไว้ทุกที่:
- ไฟล์นี้คือโหมด HYBRID / EXTERNAL-BRAIN ไม่ใช่ Native Brain
- Native track (ข) ยังแยกอยู่ ไฟล์นี้ไม่ทำให้ ZYNTHEOR กลายเป็น Native
- ถ้าไม่มี complete() ที่เป็นของจริง (มี API key + online) -> ต้อง fail-closed ทันที ห้าม fallback เป็น Template / Mock / คิดเอง

API ที่อ้างอิงจริง (ไม่ได้เดา):
- จาก brain.py บรรทัด 1-81 ที่เห็นในวิดีโอ: Complete = Callable[[str, str], str], validate_plan, Orchestrator,
  interpret_goal / normalize_priority / package_deliverable / plan_project, SelfRepairEngine, Sandbox
- จาก agent_bench.py บรรทัด 1-72: STAGES = understand/plan/build/test/repair/deliver, รายงาน delivered / hidden_ok / false_success
- ยังไม่เห็นไฟล์ตัวเต็มของ planner.py / orchestrator.py / repair.py / safe_exec.py ในรอบนี้
  ดังนั้นไฟล์นี้จึงไม่ import ฟังก์ชันที่ยังไม่เห็นโดยตรง แต่รับ dependency ผ่าน constructor (DI)
  ผู้วางแพตช์ต้องเทียบชื่อฟังก์ชันกับไฟล์ตัวเต็มใน Repo ก่อน merge

กฏ:
1. สมองภายนอกเสนอได้อย่างเดียว: spec / plan / code / repair proposal เป็น JSON เท่านั้น
2. ทุก proposal ต้องผ่าน validate_plan + ขนาดจำกัด + Sandbox เท่านั้นถึงจะรันได้
3. สมองไม่มี shell, ไม่เห็น secret, prompt มีแค่ goal / spec / plan / failing test output
4. ถ้า complete() พัง / ไม่มี key / JSON ไม่ผ่าน / validate ไม่ผ่าน -> BrainError, รายงาน stage นั้นเป็น FAILED, ห้ามอ้าง SUCCESS
"""
import json
import re
from typing import Any, Callable, Dict, Optional, Protocol

Complete = Callable[[str, str], str]  # (system_prompt, user_prompt) -> model text

MAX_STEPS = 40
MAX_FILE_CHARS = 60_000
MAX_PLAN_CHARS = 300_000
MAX_PATH_CHARS = 200


class BrainError(Exception):
    """External brain could not produce a usable result. Fail-closed."""


def extract_json(text: str) -> Any:
    """Copy ตรงจาก brain.py 1-81: plain JSON / fenced block / first balanced {...}."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("empty reply")
    t = text.strip()
    fence = re.search(r"""```(?:json)?\s*(.*?)```""", t, re.S)
    if fence:
        t = fence.group(1).strip()
    try:
        return json.loads(t)
    except ValueError:
        pass
    start = t.find("{")
    if start < 0:
        raise ValueError("no JSON object found")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(t)):
        ch = t[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(t[start:i + 1])
    raise ValueError("unbalanced JSON object")


class PlannerProto(Protocol):
    def interpret_goal(self, goal: str) -> dict: ...
    def plan_project(self, spec: dict) -> dict: ...
    def package_deliverable(self, plan: dict, files: dict) -> dict: ...


class OrchestratorProto(Protocol):
    def validate_plan(self, plan: dict) -> bool: ...
    def run(self, plan: dict, files: dict) -> dict: ...


class RepairProto(Protocol):
    def repair(self, plan: dict, files: dict, failing_output: str) -> dict: ...


class SandboxProto(Protocol):
    def run_tests(self, files: dict, test_code: str) -> dict: ...


class HybridBrain:
    """
    ต่อสมองภายนอกเข้ากับสายงานเดิมโดยไม่ให้สมองสั่งรันเอง
    complete: ฟังก์ชันจริงที่คุยกับ API ภายนอก (ต้องฉีดเข้ามา ห้ามสร้าง mock ในนี้)
    """

    def __init__(self, complete: Optional[Complete], planner: Any, orchestrator: Any,
                 repair: Any, sandbox: Any, validate_plan_fn: Optional[Callable[[dict], bool]] = None):
        if complete is None:
            raise BrainError("HYBRID requires a real online complete() — got None. Fail-closed, no Template fallback.")
        self.complete = complete
        self.planner = planner
        self.orchestrator = orchestrator
        self.repair = repair
        self.sandbox = sandbox
        # validate_plan อาจมาทาง orchestrator.validate_plan หรือฟังก์ชันแยก ให้รับทั้งสองแบบ
        if validate_plan_fn is not None:
            self.validate_plan = validate_plan_fn
        elif hasattr(orchestrator, "validate_plan"):
            self.validate_plan = orchestrator.validate_plan
        elif hasattr(orchestrator, "validate"):
            self.validate_plan = orchestrator.validate
        else:
            raise BrainError("HybridBrain needs validate_plan (orchestrator.validate_plan). Not found.")

    def _call_brain(self, system: str, user: str, stage: str) -> dict:
        # ห้ามใส่ secret / path จริง / env ลง prompt — ใส่แค่ goal/spec/plan/failing output ที่ caller ส่งมา
        if len(user) > MAX_PLAN_CHARS:
            raise BrainError(f"[{stage}] user_prompt too long: {len(user)} > {MAX_PLAN_CHARS}")
        try:
            raw = self.complete(system, user)
        except Exception as e:
            raise BrainError(f"[{stage}] complete() failed (online brain unreachable?): {e!r}") from e
        try:
            data = extract_json(raw)
        except Exception as e:
            raise BrainError(f"[{stage}] brain reply is not valid JSON: {e}") from e
        if not isinstance(data, dict):
            raise BrainError(f"[{stage}] brain reply must be a JSON object, got {type(data).__name__}")
        return data

    def understand(self, goal: str) -> Dict[str, Any]:
        if not goal or not goal.strip():
            raise BrainError("[understand] empty goal")
        spec = self._call_brain(
            "You are the understand stage. Return JSON only: {spec, constraints, files, acceptance}. No code, no shell.",
            f"GOAL:\n{goal}",
            "understand",
        )
        if "spec" not in spec and "goal" not in spec:
            raise BrainError("[understand] missing 'spec' in brain reply")
        return spec

    def plan(self, spec: Dict[str, Any]) -> Dict[str, Any]:
        plan = self._call_brain(
            "You are the plan stage. Return JSON only: {steps, files, tests}. Steps must be <= 40, each step has file + action.",
            f"SPEC:\n{json.dumps(spec, ensure_ascii=False)[:10000]}",
            "plan",
        )
        # ตรวจรับด้วยของเดิม ไม่ใช่ตรวจเอง
        res = self.validate_plan(plan)
        ok = (len(res) == 0) if isinstance(res, list) else bool(res)
        if not ok:
            detail = "; ".join(str(x) for x in res[:5]) if isinstance(res, list) else "rejected"
            raise BrainError(f"[plan] validate_plan rejected brain plan ({detail}) — fail-closed, not auto-fixed")
        return plan

    def build(self, plan: Dict[str, Any], spec: Dict[str, Any]) -> Dict[str, str]:
        proposal = self._call_brain(
            "You are the build stage. Return JSON only: {files: {path: content}}. No shell commands, no extra keys.",
            f"PLAN:\n{json.dumps(plan, ensure_ascii=False)[:12000]}\nSPEC:\n{json.dumps(spec, ensure_ascii=False)[:6000]}",
            "build",
        )
        files = proposal.get("files")
        if not isinstance(files, dict) or not files:
            raise BrainError("[build] brain must return {files: {path: content}} non-empty")
        for path, content in files.items():
            if not isinstance(path, str) or not path.strip() or len(path) > MAX_PATH_CHARS:
                raise BrainError(f"[build] invalid or overly long path: {str(path)[:80]}")
            if not isinstance(content, str) or len(content) > MAX_FILE_CHARS:
                raise BrainError(f"[build] file too long or not str: {path}")
        return files

    def repair_proposal(self, plan: Dict[str, Any], files: Dict[str, str], failing_output: str) -> Dict[str, str]:
        proposal = self._call_brain(
            "You are the repair stage. Return JSON only: {files: {path: content}} with only the files that need fixing.",
            f"PLAN:\n{json.dumps(plan, ensure_ascii=False)[:8000]}\nFAILING OUTPUT:\n{failing_output[:8000]}",
            "repair",
        )
        new_files = proposal.get("files")
        if not isinstance(new_files, dict) or not new_files:
            raise BrainError("[repair] brain must return {files: {...}} non-empty")
        merged = dict(files)
        for path, content in new_files.items():
            if not isinstance(path, str) or len(path) > MAX_PATH_CHARS or not isinstance(content, str) or len(content) > MAX_FILE_CHARS:
                raise BrainError(f"[repair] invalid repaired file entry: {str(path)[:80]}")
            merged[path] = content
        return merged

    def run_task(self, goal: str, hidden_test_code: Optional[str] = None) -> Dict[str, Any]:
        """รัน 1 goal ครบทุกขั้น รายงานแยกขั้น — ไม่เคยอ้าง hidden_ok ถ้าไม่ได้รัน hidden test จริง"""
        report: Dict[str, Any] = {
            "goal": goal,
            "mode": "HYBRID_EXTERNAL_BRAIN",
            "stages": {},
            "delivered": False,
            "hidden_ok": None,
            "false_success": None,
        }

        def mark(stage: str, ok: bool, detail: str = ""):
            report["stages"][stage] = {"ok": ok, "detail": detail}

        try:
            spec = self.understand(goal)
            mark("understand", True, "spec returned")
        except BrainError as e:
            mark("understand", False, str(e))
            return report

        try:
            plan = self.plan(spec)
            mark("plan", True, "validate_plan passed")
        except BrainError as e:
            mark("plan", False, str(e))
            return report

        try:
            files = self.build(plan, spec)
            mark("build", True, f"{len(files)} files proposed")
        except BrainError as e:
            mark("build", False, str(e))
            return report

        # test: ต้องรันผ่าน sandbox ที่ฉีดมาเท่านั้น ห้ามสมมติว่าผ่าน
        try:
            if hasattr(self.sandbox, "run_tests") and hidden_test_code is not None:
                result = self.sandbox.run_tests(files, hidden_test_code)
                passed = bool(result.get("passed")) if isinstance(result, dict) else False
                mark("test", passed, str(result)[:500])
                if not passed:
                    try:
                        files = self.repair_proposal(plan, files, str(result)[:8000])
                        # Also apply deterministic repair hook if scaffold supports repair_deterministic
                        if hasattr(self.sandbox, "repair_deterministic"):
                            det = self.sandbox.repair_deterministic(plan, files, goal=goal)
                            if isinstance(det, dict) and isinstance(det.get("files"), dict):
                                files = det["files"]
                        result2 = self.sandbox.run_tests(files, hidden_test_code)
                        passed2 = bool(result2.get("passed")) if isinstance(result2, dict) else False
                        mark("repair", passed2, f"repair_retest={'PASS' if passed2 else 'FAIL'}: {str(result2)[:300]}")
                        mark("test_after_repair", passed2, str(result2)[:500])
                        passed = passed2
                    except BrainError as e:
                        mark("repair", False, str(e))
                        return report
                else:
                    mark("repair", True, "not needed")
            else:
                mark("test", False, "no sandbox.run_tests or no hidden_test_code — test not executed")
                mark("repair", False, "skipped — test not executed")
                return report
        except Exception as e:
            mark("test", False, f"sandbox error: {e!r}")
            return report

        # deliver: ถ้า test ผ่านจริงถึงจะ deliver ได้
        if passed:
            try:
                if hasattr(self.planner, "package_deliverable"):
                    pkg = self.planner.package_deliverable(plan, files)
                    mark("deliver", True, str(pkg)[:300])
                    report["package"] = pkg
                else:
                    mark("deliver", True, "no package_deliverable — files ready, not packaged")
                report["delivered"] = True
                report["files"] = files
                report["hidden_ok"] = passed
                report["false_success"] = bool(report["delivered"] and not passed)
            except Exception as e:
                mark("deliver", False, f"package failed: {e!r}")
                return report
        else:
            mark("deliver", False, "test failed — not delivered")
            report["hidden_ok"] = False
            report["false_success"] = False
        return report

