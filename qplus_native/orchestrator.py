# -*- coding: utf-8 -*-
"""
Gate 3: minimal Orchestrator (layer A, deterministic code, no model involved).

Runs an explicit plan through the Sandbox (qplus_native/safe_exec.py) and delivers only when every acceptance
check passes. It does NOT invent plans and does NOT repair failures (Gate 4); it reports them truthfully.

Plan format (plain dicts so it can be stored, diffed and tested):
  {"goal": "...",
   "steps": [{"id": "s1", "do": "write_file", "path": "m.py", "content": "..."},
             {"id": "s2", "do": "run", "argv": ["python3", "-I", "t.py"]},
             {"id": "s3", "do": "read_file", "path": "m.py"}],
   "acceptance": [{"check": "returncode_zero", "step": "s2"},
                  {"check": "output_contains", "step": "s2", "text": "OK"},
                  {"check": "file_exists", "path": "m.py"},
                  {"check": "file_contains", "path": "m.py", "text": "def add"}]}

Statuses: SUCCEEDED (all steps ran, all acceptance checks passed) | FAILED (a step ran but an acceptance check or
a process failed) | BLOCKED (policy refused a step; later steps are not executed) | INVALID_PLAN.
Every step result is tagged layer "A": nothing here is evidence about the language model.
"""
import os
import json
import hashlib
from typing import Any, Dict, List

from qplus_native.safe_exec import Sandbox, PolicyError

STEP_KINDS = {"write_file", "read_file", "run"}
CHECKS = {"returncode_zero", "output_contains", "file_exists", "file_contains"}


def validate_plan(plan: Any) -> List[str]:
    errs: List[str] = []
    if not isinstance(plan, dict) or not isinstance(plan.get("steps"), list) or not plan["steps"]:
        return ["plan must be a dict with a non-empty 'steps' list"]
    if not isinstance(plan.get("acceptance"), list) or not plan["acceptance"]:
        errs.append("plan needs at least one acceptance check (no acceptance criteria = cannot claim success)")
    ids = set()
    for i, s in enumerate(plan["steps"]):
        if not isinstance(s, dict):
            errs.append(f"step {i}: must be a dict")
            continue
        sid = s.get("id")
        if not isinstance(sid, str) or not sid.strip() or sid in ids:
            errs.append(f"step {i}: missing, non-string, or duplicate id")
        else:
            ids.add(sid)
        do = s.get("do")
        if do not in STEP_KINDS:
            errs.append(f"step {i}: unknown 'do' (allowed: {sorted(STEP_KINDS)})")
            continue
        if do == "write_file":
            if not isinstance(s.get("path"), str) or not s["path"].strip():
                errs.append(f"step {i}: write_file requires non-empty string 'path'")
            if not isinstance(s.get("content"), str):
                errs.append(f"step {i}: write_file requires string 'content'")
        elif do == "read_file":
            if not isinstance(s.get("path"), str) or not s["path"].strip():
                errs.append(f"step {i}: read_file requires non-empty string 'path'")
        elif do == "run":
            argv = s.get("argv")
            if not isinstance(argv, list) or not argv or not all(isinstance(a, str) and a for a in argv):
                errs.append(f"step {i}: run requires non-empty list of strings 'argv'")
    for i, c in enumerate(plan.get("acceptance") or []):
        if not isinstance(c, dict) or c.get("check") not in CHECKS:
            errs.append(f"acceptance {i}: unknown check (allowed: {sorted(CHECKS)})")
            continue
        chk = c["check"]
        if chk in ("returncode_zero", "output_contains"):
            step_ref = c.get("step")
            if not isinstance(step_ref, str) or step_ref not in ids:
                errs.append(f"acceptance {i}: refers to unknown step")
        if chk == "output_contains" and (not isinstance(c.get("text"), str) or not c["text"]):
            errs.append(f"acceptance {i}: output_contains requires non-empty string 'text'")
        if chk in ("file_exists", "file_contains"):
            if not isinstance(c.get("path"), str) or not c["path"].strip():
                errs.append(f"acceptance {i}: {chk} requires non-empty string 'path'")
        if chk == "file_contains" and (not isinstance(c.get("text"), str) or not c["text"]):
            errs.append(f"acceptance {i}: file_contains requires non-empty string 'text'")
    return errs


class Orchestrator:
    def __init__(self, sandbox: Sandbox):
        self.sb = sandbox

    def _exec_step(self, s: Dict) -> Dict:
        if s["do"] == "write_file":
            snap = self.sb.write_file(s["path"], s["content"])
            return {"snapshot": snap}
        if s["do"] == "read_file":
            return {"chars": len(self.sb.read_file(s["path"]))}
        return self.sb.run(s["argv"])

    def _check(self, c: Dict, results: Dict[str, Dict]) -> Dict:
        k = c["check"]
        try:
            if k == "returncode_zero":
                r = results.get(c["step"])
                ok = bool(r) and r.get("returncode") == 0 and not r.get("timed_out")
            elif k == "output_contains":
                r = results.get(c["step"])
                ok = bool(r) and c["text"] in r.get("output", "")
            elif k == "file_exists":
                ok = os.path.isfile(self.sb.resolve(c["path"], "check"))
            else:
                ok = c["text"] in self.sb.read_file(c["path"])
        except (PolicyError, OSError, KeyError):
            ok = False
        return {**c, "passed": bool(ok)}

    def execute(self, plan: Dict) -> Dict:
        errs = validate_plan(plan)
        if errs:
            return {"status": "INVALID_PLAN", "errors": errs, "delivered": False, "layer_summary": {"A": 0, "B": 0}}
        steps_out, results = [], {}
        status, blocked_reason = "RUNNING", None
        for s in plan["steps"]:
            try:
                r = self._exec_step(s)
                results[s["id"]] = r
                steps_out.append({"id": s["id"], "do": s["do"], "layer": "A", "outcome": "EXECUTED"})
            except PolicyError as e:
                steps_out.append({"id": s["id"], "do": s["do"], "layer": "A", "outcome": "REFUSED", "reason": str(e)})
                status, blocked_reason = "BLOCKED", str(e)
                break
            except (OSError, KeyError, TypeError) as e:
                steps_out.append({"id": s["id"], "do": s["do"], "layer": "A", "outcome": "ERROR", "reason": repr(e)[:200]})
                status = "FAILED"
                break
        not_run = [s["id"] for s in plan["steps"][len(steps_out):]]
        checks = [self._check(c, results) for c in plan["acceptance"]] if status == "RUNNING" else []
        if status == "RUNNING":
            status = "SUCCEEDED" if all(c["passed"] for c in checks) else "FAILED"
        deliverables = []
        if status == "SUCCEEDED":
            for s in plan["steps"]:
                if s["do"] == "write_file":
                    data = self.sb.read_file(s["path"])
                    deliverables.append({"path": s["path"], "sha256": hashlib.sha256(data.encode()).hexdigest()})
        failing = {k: v.get("output", "")[-400:] for k, v in results.items()
                   if isinstance(v, dict) and v.get("returncode") not in (None, 0)}
        return {"goal": plan.get("goal"), "status": status, "delivered": status == "SUCCEEDED",
                "steps": steps_out, "steps_not_run": not_run, "acceptance": checks,
                "blocked_reason": blocked_reason, "failing_process_output": failing, "deliverables": deliverables,
                "audit": self.sb.verify_audit(),
                "layer_summary": {"A": len(steps_out), "B": 0},
                "note": "Layer A is deterministic code. No language-model capability is evidenced by this result."}

    def execute_tool_call(self, call: Dict[str, Any], max_repairs: int = 3) -> Dict[str, Any]:
        """Dispatch a Phase 6 JSON tool call through Sandbox + SelfRepairEngine."""
        dispatcher = AutonomousToolDispatcher(self.sb, max_repairs=max_repairs)
        return dispatcher.dispatch(call)


# Re-export Phase 6 autonomous tools after Orchestrator is defined (repair.py imports Orchestrator).
from qplus_native.autonomous_tools import (  # noqa: E402
    AUTONOMOUS_TOOL_SCHEMAS,
    AutonomousToolDispatcher,
    write_workspace_file,
    read_workspace_file,
    run_terminal_command,
    run_test,
    search_internet,
)


def main():  # python3 qplus_native/orchestrator.py plan.json --workdir DIR
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--workdir", required=True)
    a = ap.parse_args()
    with open(a.plan, encoding="utf-8") as f:
        plan = json.load(f)
    print(json.dumps(Orchestrator(Sandbox(a.workdir)).execute(plan), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    main()
