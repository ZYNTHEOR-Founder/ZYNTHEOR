# -*- coding: utf-8 -*-
"""
ZYNTHEOR — HYBRID (ก) Stage Bench: วัดแยกขั้น ไม่รวมเป็นคะแนนเดียว

รันแบบนี้ (ต้องมี complete จริงถึงจะวัดสมองจริง):
  python3 -m qplus_native.stage_bench --tasks slugify,roman,brackets

ถ้าใช้ test fixture (ใน test_hybrid.py) ผลที่ได้คือผลของ fixture ไม่ใช่ผลของสมองจริง
ต้องติดป้ายทุกครั้งว่า FIXTURE / REAL อย่าสลับกัน
"""
import json
from typing import Any, Callable, Dict, List, Optional

try:
    from .hybrid_brain import HybridBrain
except ImportError:
    from hybrid_brain import HybridBrain

TASKS: List[Dict[str, Any]] = [
    {"id": "slugify", "goal": "Write function slugify(text: str) -> str. Lowercase; every run of chars outside a-z and 0-9 becomes single '-'; strip leading/trailing '-'. Non-ASCII counts as separator. Create it in app/core.py (and empty app/__init__.py). Stdlib only. Add tests in tests/test_app.py and run them.",
     "hidden": 'from app.core import slugify\nassert slugify("  Hello, World!  ") == "hello-world"\nassert slugify("A--B__C") == "a-b-c"\nassert slugify("") == "" and slugify("!!!") == ""\nassert slugify("Caf\\u00e9 au lait") == "caf-au-lait"\nassert slugify("Python 3.13") == "python-3-13"\nprint("HIDDEN_OK")\n'},
    {"id": "roman", "goal": "Write to_roman(n: int) -> str for 1..3999 and from_roman(s: str) -> int. Both raise ValueError for invalid input. Create it in app/core.py (and empty app/__init__.py). Stdlib only. Add tests in tests/test_app.py and run them.",
     "hidden": 'from app.core import to_roman, from_roman\nassert to_roman(1994) == "MCMXCIV" and from_roman("MCMXCIV") == 1994\nassert to_roman(4) == "IV" and to_roman(3999) == "MMMCMXCIX"\nassert all(from_roman(to_roman(i)) == i for i in range(1, 4000))\nprint("HIDDEN_OK")\n'},
    {"id": "brackets", "goal": "Write is_balanced(s: str) -> bool. True when every (), [] and {} in s is properly nested and closed; all other chars ignored. Create it in app/core.py (and empty app/__init__.py). Stdlib only. Add tests in tests/test_app.py and run them.",
     "hidden": 'from app.core import is_balanced\nassert is_balanced("()[]{}") is True\nassert is_balanced("([)]") is False\nassert is_balanced("") is True\nassert is_balanced("a(b[c]d)e") is True\nprint("HIDDEN_OK")\n'},
]

def run_bench(brain: HybridBrain, task_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    rows = []
    for t in TASKS:
        if task_ids and t["id"] not in task_ids:
            continue
        rep = brain.run_task(t["goal"], hidden_test_code=t["hidden"])
        stages = rep.get("stages", {})
        rows.append({
            "id": t["id"],
            "understand": stages.get("understand", {}).get("ok"),
            "plan": stages.get("plan", {}).get("ok"),
            "build": stages.get("build", {}).get("ok"),
            "test": stages.get("test", {}).get("ok"),
            "repair": stages.get("repair", {}).get("ok"),
            "deliver": stages.get("deliver", {}).get("ok"),
            "delivered": rep.get("delivered"),
            "hidden_ok": rep.get("hidden_ok"),
            "false_success": rep.get("false_success"),
            "detail": stages,
        })
    total = len(rows)
    hidden_pass = sum(1 for r in rows if r["hidden_ok"] is True)
    return {"mode": "HYBRID_EXTERNAL_BRAIN", "tasks": rows,
            "summary": {"total": total, "hidden_ok": hidden_pass, "false_success": sum(1 for r in rows if r["false_success"] is True)}}
