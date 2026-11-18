# -*- coding: utf-8 -*-
"""
ZYNTHEOR — HYBRID (ก) Stage Bench: วัดแยกขั้น (20 โจทย์มาตรฐาน ไม่รวมเป็นคะแนนเดียว)

รายงานอัตราผ่านแยกตามขั้น:
  understand (เข้าใจ) | plan (วางแผน) | build (สร้าง) | test (ทดสอบ) | repair (แก้ไข) | deliver (ส่งมอบ)
พร้อม hidden_ok (ตรวจจริงแบบอิสระ) และ false_success (กันระบบอ้างสำเร็จเท็จ)

สำคัญ:
  - ถ้าต่อสมองภายนอกจริง -> ป้าย mode_label="REAL_EXTERNAL_BRAIN"
  - ถ้าใช้ test fixture -> ป้าย mode_label="FIXTURE_NOT_REAL_BRAIN" ห้ามสลับกัน
  - ถ้าระบบสมองภายนอกไม่พร้อม (ไม่มี key/offline) -> fail-closed
"""
import argparse
import json
import sys
from typing import Any, Dict, List, Optional

try:
    from .hybrid_brain import HybridBrain, BrainError
except ImportError:
    from hybrid_brain import HybridBrain, BrainError

TASKS: List[Dict[str, Any]] = [
    {
        "id": "slugify",
        "category": "text_normalization",
        "goal": "Write function slugify(text: str) -> str. Lowercase; every run of chars outside a-z and 0-9 becomes single '-'; strip leading/trailing '-'. Non-ASCII counts as separator. Create it in app/core.py (and empty app/__init__.py). Stdlib only. Add tests in tests/test_app.py and run them.",
        "hidden": 'from app.core import slugify\nassert slugify("  Hello, World!  ") == "hello-world"\nassert slugify("A--B__C") == "a-b-c"\nassert slugify("") == "" and slugify("!!!") == ""\nassert slugify("Caf\\u00e9 au lait") == "caf-au-lait"\nassert slugify("Python 3.13") == "python-3-13"\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "roman",
        "category": "encoding_math",
        "goal": "Write to_roman(n: int) -> str for 1..3999 and from_roman(s: str) -> int. Both raise ValueError for invalid input. Create it in app/core.py (and empty app/__init__.py). Stdlib only. Add tests in tests/test_app.py and run them.",
        "hidden": 'from app.core import to_roman, from_roman\nassert to_roman(1994) == "MCMXCIV" and from_roman("MCMXCIV") == 1994\nassert to_roman(4) == "IV" and to_roman(3999) == "MMMCMXCIX"\nassert all(from_roman(to_roman(i)) == i for i in range(1, 4000))\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "brackets",
        "category": "parsing_stack",
        "goal": "Write is_balanced(s: str) -> bool. True when every (), [] and {} in s is properly nested and closed; all other chars ignored. Create it in app/core.py (and empty app/__init__.py). Stdlib only. Add tests in tests/test_app.py and run them.",
        "hidden": 'from app.core import is_balanced\nassert is_balanced("()[]{}") is True\nassert is_balanced("([)]") is False\nassert is_balanced("") is True\nassert is_balanced("a(b[c]d)e") is True\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "lru_cache",
        "category": "data_structures",
        "goal": "Implement class LRUCache(capacity: int) with get(key) -> Optional[Any] and put(key, value) -> None in O(1) average time. Raise ValueError if capacity <= 0. Create in app/core.py and empty app/__init__.py with tests in tests/test_app.py.",
        "hidden": 'from app.core import LRUCache\nc = LRUCache(2)\nc.put("a", 1)\nc.put("b", 2)\nassert c.get("a") == 1\nc.put("c", 3)\nassert c.get("b") is None\nassert c.get("c") == 3\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "merge_intervals",
        "category": "algorithms",
        "goal": "Write merge_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]] that merges overlapping or touching integer intervals in sorted order. Create in app/core.py (with app/__init__.py) and tests in tests/test_app.py.",
        "hidden": 'from app.core import merge_intervals\nassert merge_intervals([]) == []\nassert merge_intervals([(1, 3), (2, 6), (8, 10), (10, 12)]) == [(1, 6), (8, 12)]\nassert merge_intervals([(5, 7), (1, 4)]) == [(1, 4), (5, 7)]\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "topo_sort",
        "category": "graphs_planning",
        "goal": "Write topo_sort(edges: dict[str, list[str]]) -> list[str] where edges[node] lists dependencies that must appear BEFORE node, breaking ties lexicographically. Raise ValueError on cycles. Create in app/core.py and tests in tests/test_app.py.",
        "hidden": 'from app.core import topo_sort\norder = topo_sort({"plan": ["understand"], "build": ["plan"], "understand": []})\nassert order.index("understand") < order.index("plan") < order.index("build")\ntry:\n    topo_sort({"a": ["b"], "b": ["a"]})\n    raise AssertionError("cycle not caught")\nexcept ValueError:\n    pass\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "semver_sort",
        "category": "parsing_sorting",
        "goal": "Write parse_semver(v: str) -> tuple[int, int, int] and sort_semver(versions: list[str]) -> list[str] ascending. Strip optional leading 'v'. Raise ValueError on malformed version. Put in app/core.py with tests in tests/test_app.py.",
        "hidden": 'from app.core import parse_semver, sort_semver\nassert parse_semver("v1.10.2") == (1, 10, 2)\nassert sort_semver(["1.10.0", "1.2.9", "v0.9.1"]) == ["v0.9.1", "1.2.9", "1.10.0"]\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "hmac_token",
        "category": "security_crypto",
        "goal": "Implement sign_payload(payload: str, secret: str) -> str and verify_payload(payload: str, signature: str, secret: str) -> bool using HMAC-SHA256 hex and hmac.compare_digest in app/core.py. Reject empty secret with ValueError.",
        "hidden": 'from app.core import sign_payload, verify_payload\nsig = sign_payload("user=1", "topsecret")\nassert len(sig) == 64\nassert verify_payload("user=1", sig, "topsecret") is True\nassert verify_payload("user=2", sig, "topsecret") is False\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "rle_codec",
        "category": "compression",
        "goal": "Write rle_encode(text: str) -> str and rle_decode(encoded: str) -> str using length+char pairs (handle digits safely or escape) for ASCII letters, or count:char format e.g. '3a2b' in app/core.py.",
        "hidden": 'from app.core import rle_encode, rle_decode\nfor sample in ("aaabbc", "x", "zzzzzy", ""):\n    assert rle_decode(rle_encode(sample)) == sample\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "csv_summary",
        "category": "data_processing",
        "goal": "Write summarize_csv(csv_text: str, group_col: str, val_col: str) -> dict[str, float] using Python csv.DictReader in app/core.py. Sum numeric values per group and ignore blank lines.",
        "hidden": 'from app.core import summarize_csv\nres = summarize_csv("dept,cost\\nops,10.5\\nops,4.5\\ndev,20\\n", "dept", "cost")\nassert round(res["ops"], 2) == 15.0 and round(res["dev"], 2) == 20.0\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "safe_eval_math",
        "category": "ast_symbolic",
        "goal": "Write eval_arith(expr: str) -> float using ast.parse (NO eval/exec) supporting +, -, *, /, //, **, unary +/- and parentheses in app/core.py. Raise ValueError for disallowed AST nodes or division by zero.",
        "hidden": 'from app.core import eval_arith\nassert eval_arith("2 + 3 * (4 - 1)") == 11\nassert eval_arith("-5 ** 2") == -25\ntry:\n    eval_arith("__import__(\'os\')")\n    raise AssertionError("unsafe allowed")\nexcept ValueError:\n    pass\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "thai_text_clean",
        "category": "bilingual_nlp",
        "goal": "สร้างฟังก์ชัน normalize_bilingual(text: str) -> str ใน app/core.py: บีบช่องว่างซ้ำเป็นช่องว่างเดียว ตัดหัวท้าย ลบ zero-width space (\\u200b/\\ufeff) โดยรักษาวรรณยุกต์และสระภาษาไทยครบถ้วน",
        "hidden": 'from app.core import normalize_bilingual\ns = "  สวัสดี\\u200b   ZYNTHEOR\\ufeff  ทดสอบ\\tน้ำใจ  "\nassert normalize_bilingual(s) == "สวัสดี ZYNTHEOR ทดสอบ น้ำใจ"\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "token_bucket",
        "category": "rate_limiting",
        "goal": "Implement TokenBucket(capacity: float, refill_per_sec: float) with allow(tokens: float = 1.0, now: Optional[float] = None) -> bool in app/core.py using deterministic injectable `now` timestamps.",
        "hidden": 'from app.core import TokenBucket\ntb = TokenBucket(capacity=3.0, refill_per_sec=1.0)\nassert tb.allow(2.0, now=0.0) is True\nassert tb.allow(2.0, now=0.1) is False\nassert tb.allow(2.0, now=1.5) is True\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "json_flatten",
        "category": "structured_transform",
        "goal": "Write flatten_dict(data: dict, sep: str = '.') -> dict[str, Any] that recursively flattens nested dicts (preserve non-dict lists/values intact) in app/core.py.",
        "hidden": 'from app.core import flatten_dict\nassert flatten_dict({"a": {"b": 1, "c": {"d": 2}}, "x": [3, 4]}) == {"a.b": 1, "a.c.d": 2, "x": [3, 4]}\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "matrix_transpose",
        "category": "linear_algebra",
        "goal": "Write transpose(mat: list[list[float]]) -> list[list[float]] and matmul(a: list[list[float]], b: list[list[float]]) -> list[list[float]] in app/core.py. Raise ValueError on ragged or incompatible dimensions.",
        "hidden": 'from app.core import transpose, matmul\nassert transpose([[1, 2, 3], [4, 5, 6]]) == [[1, 4], [2, 5], [3, 6]]\nassert matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]]) == [[19, 22], [43, 50]]\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "state_machine",
        "category": "workflow_validation",
        "goal": "Implement class OrderFSM in app/core.py with states NEW -> PAID -> SHIPPED -> DELIVERED (plus CANCELLED from NEW/PAID), method transition(target: str) -> str raising ValueError on illegal transitions.",
        "hidden": 'from app.core import OrderFSM\nf = OrderFSM()\nassert f.state == "NEW"\nassert f.transition("PAID") == "PAID"\ntry:\n    f.transition("DELIVERED")\n    raise AssertionError("illegal transition allowed")\nexcept ValueError:\n    pass\nassert f.transition("SHIPPED") == "SHIPPED"\nassert f.transition("DELIVERED") == "DELIVERED"\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "bloom_counter",
        "category": "counting_analytics",
        "goal": "Write top_k_words(text: str, k: int) -> list[tuple[str, int]] in app/core.py: lowercase ASCII/Unicode words sorted by frequency desc then word asc.",
        "hidden": 'from app.core import top_k_words\nassert top_k_words("Beta alpha beta gamma alpha delta", 2) == [("alpha", 2), ("beta", 2)]\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "path_guard",
        "category": "security_sandbox",
        "goal": "Write is_safe_relpath(rel: str) -> bool in app/core.py: reject absolute paths, null bytes, '..' segments, Windows drive letters, and backslashes.",
        "hidden": 'from app.core import is_safe_relpath\nassert is_safe_relpath("app/core.py") is True\nassert is_safe_relpath("../secret.txt") is False\nassert is_safe_relpath("/etc/passwd") is False\nassert is_safe_relpath("a\\\\..\\\\b") is False\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "moving_stats",
        "category": "time_series",
        "goal": "Implement class RollingStats(window: int) with add(x: float) -> None, mean() -> float, and variance() -> float (population variance) over the most recent `window` samples in app/core.py.",
        "hidden": 'from app.core import RollingStats\nrs = RollingStats(3)\nfor v in (10.0, 20.0, 30.0, 40.0):\n    rs.add(v)\nassert abs(rs.mean() - 30.0) < 1e-9\nassert abs(rs.variance() - (200.0 / 3.0)) < 1e-6\nprint("HIDDEN_OK")\n',
    },
    {
        "id": "dedup_preserve",
        "category": "collections",
        "goal": "Write dedup_stable(items: list[Any], key: Optional[Callable] = None) -> list[Any] in app/core.py preserving first occurrence order even with optional key function.",
        "hidden": 'from app.core import dedup_stable\nassert dedup_stable(["Apple", "apple", "Banana", "BANANA"], key=str.lower) == ["Apple", "Banana"]\nassert dedup_stable([3, 1, 3, 2, 1]) == [3, 1, 2]\nprint("HIDDEN_OK")\n',
    },
]

STAGE_KEYS = ("understand", "plan", "build", "test", "repair", "deliver")


def summarize_stage_rates(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    total = len(rows)
    stage_stats: Dict[str, Dict[str, Any]] = {}
    for key in STAGE_KEYS:
        passed = sum(1 for r in rows if r.get(key) is True)
        stage_stats[key] = {
            "passed": passed,
            "total": total,
            "ratePct": round((passed / total) * 100.0, 1) if total > 0 else 0.0,
        }
    hidden_pass = sum(1 for r in rows if r.get("hidden_ok") is True)
    delivered = sum(1 for r in rows if r.get("delivered") is True)
    false_success = sum(1 for r in rows if r.get("false_success") is True)
    return {
        "total": total,
        "delivered": delivered,
        "hidden_ok": hidden_pass,
        "false_success": false_success,
        "deliveryRatePct": round((delivered / total) * 100.0, 1) if total > 0 else 0.0,
        "hiddenPassRatePct": round((hidden_pass / total) * 100.0, 1) if total > 0 else 0.0,
        "stages": stage_stats,
    }


def run_bench(
    brain: HybridBrain,
    task_ids: Optional[List[str]] = None,
    *,
    mode_label: str = "HYBRID_EXTERNAL_BRAIN",
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    selected = [t for t in TASKS if (not task_ids or t["id"] in task_ids)]
    if limit is not None and limit > 0:
        selected = selected[:limit]

    for t in selected:
        rep = brain.run_task(t["goal"], hidden_test_code=t["hidden"])
        stages = rep.get("stages", {})
        rows.append({
            "id": t["id"],
            "category": t.get("category", "general"),
            "understand": stages.get("understand", {}).get("ok") is True,
            "plan": stages.get("plan", {}).get("ok") is True,
            "build": stages.get("build", {}).get("ok") is True,
            "test": stages.get("test", {}).get("ok") is True,
            "repair": stages.get("repair", {}).get("ok") is True,
            "deliver": stages.get("deliver", {}).get("ok") is True,
            "delivered": rep.get("delivered") is True,
            "hidden_ok": rep.get("hidden_ok") is True,
            "false_success": rep.get("false_success") is True,
            "detail": stages,
        })

    return {
        "mode": mode_label,
        "taskCount": len(TASKS),
        "evaluatedTasks": len(rows),
        "tasks": rows,
        "summary": summarize_stage_rates(rows),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="ZYNTHEOR 20-Task Per-Stage Benchmark (Hybrid External Brain)")
    parser.add_argument("--tasks", default="", help="Comma-separated task IDs (default: all 20)")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of tasks")
    parser.add_argument("--real", action="store_true", help="Invoke configured real online external brain via env vars")
    parser.add_argument("--json", action="store_true", help="Output compact JSON report")
    args = parser.parse_args()

    task_ids = [s.strip() for s in args.tasks.split(",") if s.strip()] if args.tasks else None
    if not args.real:
        print(json.dumps({
            "status": "FAIL_CLOSED_SPECIFICATION",
            "message": "Pass --real with ZYNTHEOR_BRAIN_PROVIDER and ZYNTHEOR_BRAIN_API_KEY configured to evaluate a live external brain. Refusing to fabricate scores.",
            "availableTasks": [{"id": t["id"], "category": t["category"]} for t in TASKS],
            "totalTasks": len(TASKS),
        }, ensure_ascii=False, indent=2))
        return 0

    try:
        try:
            from .external_brain import RealScaffoldAdapter, make_http_complete
        except ImportError:
            from external_brain import RealScaffoldAdapter, make_http_complete

        complete = make_http_complete()
        scaffold = RealScaffoldAdapter()
        try:
            brain = HybridBrain(
                complete=complete,
                planner=scaffold,
                orchestrator=scaffold,
                repair=scaffold,
                sandbox=scaffold,
                validate_plan_fn=scaffold.validate_plan,
            )
            report = run_bench(
                brain,
                task_ids=task_ids,
                mode_label="REAL_EXTERNAL_BRAIN_SANDBOX",
                limit=args.limit if args.limit > 0 else None,
            )
            print(json.dumps(report, ensure_ascii=False, indent=None if args.json else 2))
            return 0
        finally:
            scaffold.cleanup()
    except BrainError as exc:
        print(json.dumps({"status": "FAIL_CLOSED", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    sys.exit(main())
