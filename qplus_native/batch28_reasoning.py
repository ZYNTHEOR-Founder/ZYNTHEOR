# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 28 — Multi-Step Reasoning, Constraint Satisfaction & Code Verifier

Provides genuine, deterministic multi-step reasoning verification alongside
the Native Neural Core:
  1. Multi-step arithmetic & symbolic expression verification
  2. Constraint satisfaction solver (dependency / ordering / linear bounds)
  3. Python source AST structural & invariant verification + error correction hints
  4. Alternative solution objective scoring (measured runtime/test/constraint pass;
     explicitly attributed as orchestrator/symbolic verification — NEVER claimed as
     neural weight improvement).
"""

import ast
import json
import math
import operator
import re
import sys
from typing import Any, Dict, List, Optional, Tuple


_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


def safe_eval_math_expr(expr: str) -> float:
    """Safely evaluates an arithmetic expression using AST nodes only (zero eval)."""
    node = ast.parse(expr.strip(), mode="eval")

    def _eval(n: ast.AST) -> float:
        if isinstance(n, ast.Expression):
            return _eval(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return float(n.value)
        if isinstance(n, ast.BinOp) and type(n.op) in _BIN_OPS:
            left = _eval(n.left)
            right = _eval(n.right)
            if isinstance(n.op, (ast.Div, ast.FloorDiv, ast.Mod)) and abs(right) < 1e-12:
                raise ZeroDivisionError("Division by zero in reasoning step")
            if isinstance(n.op, ast.Pow) and abs(right) > 32:
                raise ValueError("Exponent bound exceeded")
            return float(_BIN_OPS[type(n.op)](left, right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _UNARY_OPS:
            return float(_UNARY_OPS[type(n.op)](_eval(n.operand)))
        raise ValueError(f"Disallowed AST node in math verifier: {type(n).__name__}")

    val = _eval(node)
    if not math.isfinite(val):
        raise ValueError("Non-finite arithmetic result")
    return val


def verify_multistep_math(steps: List[Dict[str, Any]], expected_final: Optional[float] = None) -> Dict[str, Any]:
    """
    Verifies a multi-step mathematical derivation step-by-step.
    Each step may reference `expr` and `claimed` (numerical output).
    """
    step_results = []
    all_valid = True
    last_val: Optional[float] = None

    for idx, step in enumerate(steps):
        expr = str(step.get("expr", "")).strip()
        claimed = step.get("claimed")
        try:
            computed = safe_eval_math_expr(expr)
            matches_claim = claimed is None or abs(computed - float(claimed)) <= 1e-6
            if not matches_claim:
                all_valid = False
            last_val = computed
            step_results.append({
                "step": idx + 1,
                "expr": expr,
                "computed": round(computed, 6),
                "claimed": claimed,
                "valid": matches_claim,
                "error": None if matches_claim else f"Claimed {claimed} != computed {round(computed, 6)}",
            })
        except Exception as exc:
            all_valid = False
            step_results.append({
                "step": idx + 1,
                "expr": expr,
                "computed": None,
                "claimed": claimed,
                "valid": False,
                "error": str(exc),
            })

    final_match = True
    if expected_final is not None:
        final_match = last_val is not None and abs(last_val - float(expected_final)) <= 1e-6
        if not final_match:
            all_valid = False

    return {
        "verified": bool(all_valid and len(steps) > 0),
        "final_value": round(last_val, 6) if last_val is not None else None,
        "expected_final": expected_final,
        "final_match": final_match,
        "steps": step_results,
        "attribution": "symbolic_math_ast_verifier",
    }


def solve_dependency_and_budget_constraints(
    tasks: List[Dict[str, Any]],
    max_total_cost: float,
) -> Dict[str, Any]:
    """
    Constraint satisfaction solver for scheduling ordered tasks with dependencies & cost ceiling.
    Detects dependency cycles and resource budget infeasibility.
    """
    by_id = {t["id"]: t for t in tasks if isinstance(t, dict) and t.get("id")}
    if len(by_id) != len(tasks):
        return {"satisfiable": False, "reason": "Duplicate or missing task ids", "schedule": []}

    total_cost = sum(float(t.get("cost", 0.0)) for t in tasks)
    if total_cost > max_total_cost + 1e-9:
        return {
            "satisfiable": False,
            "reason": f"Budget constraint violated: total cost {total_cost} > ceiling {max_total_cost}",
            "total_cost": total_cost,
            "max_total_cost": max_total_cost,
            "schedule": [],
        }

    # Topological Kahn ordering broken by highest priority (lowest numeric rank)
    in_deg = {tid: 0 for tid in by_id}
    adj: Dict[str, List[str]] = {tid: [] for tid in by_id}
    for tid, t in by_id.items():
        for dep in t.get("depends_on") or []:
            if dep not in by_id:
                return {"satisfiable": False, "reason": f"Unknown dependency '{dep}' for '{tid}'", "schedule": []}
            adj[dep].append(tid)
            in_deg[tid] += 1

    ready = sorted([tid for tid, deg in in_deg.items() if deg == 0], key=lambda k: by_id[k].get("priority", 5))
    schedule: List[str] = []
    while ready:
        cur = ready.pop(0)
        schedule.append(cur)
        for nxt in adj[cur]:
            in_deg[nxt] -= 1
            if in_deg[nxt] == 0:
                ready.append(nxt)
                ready.sort(key=lambda k: by_id[k].get("priority", 5))

    if len(schedule) != len(by_id):
        return {"satisfiable": False, "reason": "Cyclic dependency detected in constraint graph", "schedule": []}

    return {
        "satisfiable": True,
        "schedule": schedule,
        "total_cost": round(total_cost, 4),
        "remaining_budget": round(max_total_cost - total_cost, 4),
        "attribution": "deterministic_csp_scheduler",
    }


def reason_over_python_code(source: str) -> Dict[str, Any]:
    """Analyzes Python source via AST for syntax, unsafe calls, defined symbols, and repair hints."""
    findings: List[str] = []
    repair_hints: List[str] = []
    unsafe_calls = {"eval", "exec", "compile", "__import__"}
    detected_unsafe: List[str] = []
    functions: List[str] = []
    classes: List[str] = []

    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {
            "syntax_valid": False,
            "error_type": "SyntaxError",
            "line": exc.lineno,
            "message": exc.msg,
            "findings": [f"SyntaxError on line {exc.lineno}: {exc.msg}"],
            "repair_hints": ["Fix malformed Python syntax or missing delimiter near reported line."],
            "safe": False,
        }

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            functions.append(node.name)
        elif isinstance(node, ast.ClassDef):
            classes.append(node.name)
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in unsafe_calls:
                detected_unsafe.append(node.func.id)
                findings.append(f"Unsafe builtin call '{node.func.id}()' detected")
                repair_hints.append(f"Replace {node.func.id}() with ast.literal_eval or structured logic.")
        elif isinstance(node, ast.ExceptHandler) and node.type is None:
            findings.append("Bare except: clause suppresses unexpected failures")
            repair_hints.append("Catch explicit exception classes instead of bare except:.")

    return {
        "syntax_valid": True,
        "safe": len(detected_unsafe) == 0,
        "unsafe_calls": sorted(set(detected_unsafe)),
        "functions": functions,
        "classes": classes,
        "findings": findings,
        "repair_hints": repair_hints,
        "attribution": "ast_code_reasoning",
    }


def evaluate_alternative_solutions(candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compares candidate solutions strictly on verified objective criteria:
      - tests_passed / tests_total
      - constraints_satisfied (bool)
      - safety_passed (bool)
      - latency_ms (lower is better)
    """
    scored = []
    for idx, c in enumerate(candidates):
        cid = str(c.get("id") or f"candidate_{idx + 1}")
        tests_total = max(1, int(c.get("tests_total", 1)))
        tests_passed = min(tests_total, max(0, int(c.get("tests_passed", 0))))
        constraints_ok = bool(c.get("constraints_satisfied", False))
        safety_ok = bool(c.get("safety_passed", True))
        latency = max(1.0, float(c.get("latency_ms", 100.0)))

        # Fail-closed gate: unsafe or constraint-violating candidate cannot win top rank
        eligible = safety_ok and constraints_ok and tests_passed == tests_total
        pass_ratio = tests_passed / tests_total
        score = round(
            (50.0 * pass_ratio)
            + (25.0 if constraints_ok else 0.0)
            + (20.0 if safety_ok else -100.0)
            + min(5.0, 500.0 / latency),
            3,
        )
        scored.append({
            "id": cid,
            "eligible": eligible,
            "score": score,
            "pass_ratio": round(pass_ratio, 3),
            "constraints_satisfied": constraints_ok,
            "safety_passed": safety_ok,
            "latency_ms": latency,
        })

    scored.sort(key=lambda r: (1 if r["eligible"] else 0, r["score"]), reverse=True)
    return {
        "selected": scored[0]["id"] if scored and scored[0]["eligible"] else None,
        "ranked": scored,
        "attribution": "objective_candidate_evaluator",
    }


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"error": "Empty JSON payload on stdin"}))
        sys.exit(1)
    req = json.loads(raw)
    op = req.get("op")
    if op == "verify_math":
        out = verify_multistep_math(req.get("steps") or [], req.get("expected_final"))
    elif op == "solve_constraints":
        out = solve_dependency_and_budget_constraints(req.get("tasks") or [], float(req.get("max_total_cost", 100.0)))
    elif op == "reason_code":
        out = reason_over_python_code(str(req.get("source") or ""))
    elif op == "evaluate_alternatives":
        out = evaluate_alternative_solutions(req.get("candidates") or [])
    else:
        print(json.dumps({"error": f"Unknown reasoning op: {op}"}))
        sys.exit(2)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
