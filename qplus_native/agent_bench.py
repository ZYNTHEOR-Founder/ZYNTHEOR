# -*- coding: utf-8 -*-
"""
Gate 6 benchmark: how often does a brain turn a plain-language task into verified, working code?

Every task states the exact file and function names it needs. After the brain has finished (and claimed success or
not), this harness writes a HIDDEN check script that the brain never saw into the work directory and runs it in the
same Sandbox. That separates two things the brain's own tests cannot:
    delivered    - the brain's own plan passed its own acceptance checks and the package verified
    hidden_ok    - the code really satisfies the task
    false_success = delivered but not hidden_ok  (the brain trusted tests that could not catch its bug)

Usage (from the repository root):
    python3 -m qplus_native.agent_bench --brain template --out bench_template.json
    ZYNTHEOR_BRAIN_PROVIDER=external ZYNTHEOR_BRAIN_MODEL=<model> external_API_KEY=... \
        python3 -m qplus_native.agent_bench --brain model --out bench_model.json
"""
import argparse
import json
import os
import sys
import tempfile
import time
from typing import Any, Dict, List, Optional

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qplus_native.brain import TemplateBrain, brain_from_env, run_task
from qplus_native.safe_exec import Sandbox

STAGES = ("understand", "plan", "build", "test", "repair", "deliver")

_COMMON = " Create it in app/core.py (and an empty app/__init__.py). Python standard library only. Add unit tests in tests/test_app.py and run them."

TASKS: List[Dict[str, Any]] = [
    {"id": "slugify", "goal":
        "Write function slugify(text: str) -> str. Lowercase the text; every run of characters outside a-z and 0-9 "
        "becomes a single '-'; strip leading and trailing '-'. Non-ASCII letters count as separators." + _COMMON,
     "hidden": '''
from app.core import slugify
assert slugify("  Hello, World!  ") == "hello-world"
assert slugify("A--B__C") == "a-b-c"
assert slugify("") == "" and slugify("!!!") == ""
assert slugify("Caf\\u00e9 au lait") == "caf-au-lait"
assert slugify("Python 3.13") == "python-3-13"
print("HIDDEN_OK")
'''},
    {"id": "roman", "goal":
        "Write to_roman(n: int) -> str for 1..3999 and from_roman(s: str) -> int. Both raise ValueError for invalid "
        "input (n outside 1..3999; s that is not a canonical Roman numeral such as 'IIII' or 'VX')." + _COMMON,
     "hidden": '''
from app.core import to_roman, from_roman
assert to_roman(1994) == "MCMXCIV" and from_roman("MCMXCIV") == 1994
assert to_roman(4) == "IV" and to_roman(3999) == "MMMCMXCIX"
assert all(from_roman(to_roman(i)) == i for i in range(1, 4000))
for bad in (0, 4000, -1):
    try:
        to_roman(bad); raise SystemExit("to_roman accepted %r" % bad)
    except ValueError:
        pass
for bad in ("IIII", "VX", "", "ABC", "IC"):
    try:
        from_roman(bad); raise SystemExit("from_roman accepted %r" % bad)
    except ValueError:
        pass
print("HIDDEN_OK")
'''},
    {"id": "brackets", "goal":
        "Write is_balanced(s: str) -> bool. It is True when every (), [] and {} in s is properly nested and closed; "
        "all other characters are ignored." + _COMMON,
     "hidden": '''
from app.core import is_balanced
assert is_balanced("") and is_balanced("a(b)[c]{d}") and is_balanced("{[()]}")
assert not is_balanced("(") and not is_balanced(")") and not is_balanced("([)]") and not is_balanced("(()")
assert not is_balanced("}{") and is_balanced("no brackets at all")
print("HIDDEN_OK")
'''},
    {"id": "wordfreq", "goal":
        "Write top_words(text: str, k: int) -> list[tuple[str, int]]. Words are maximal runs of a-z after lowercasing the "
        "text. Return the k most frequent as (word, count), sorted by count descending then word ascending. k <= 0 "
        "returns []." + _COMMON,
     "hidden": '''
from app.core import top_words
assert top_words("the cat and The dog and THE bird", 2) == [("the", 3), ("and", 2)]
assert top_words("b a b a c", 3) == [("a", 2), ("b", 2), ("c", 1)]
assert top_words("", 5) == [] and top_words("x y", 0) == [] and top_words("x y", -1) == []
assert top_words("it's 42 ok", 5) == [("it", 1), ("ok", 1), ("s", 1)]
print("HIDDEN_OK")
'''},
    {"id": "intervals", "goal":
        "Write merge_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]. Merge intervals that overlap "
        "or touch (e.g. (1,3) and (3,5) -> (1,5)); input may be unsorted; return sorted tuples; empty input -> []; "
        "raise ValueError if any interval has start > end." + _COMMON,
     "hidden": '''
from app.core import merge_intervals
assert merge_intervals([(8, 10), (1, 3), (2, 6), (15, 18)]) == [(1, 6), (8, 10), (15, 18)]
assert merge_intervals([(1, 3), (3, 5)]) == [(1, 5)] and merge_intervals([]) == []
assert merge_intervals([(5, 5), (1, 2)]) == [(1, 2), (5, 5)]
assert merge_intervals([(1, 10), (2, 3)]) == [(1, 10)]
try:
    merge_intervals([(3, 1)]); raise SystemExit("accepted start > end")
except ValueError:
    pass
print("HIDDEN_OK")
'''},
    {"id": "lru", "goal":
        "Write class LRUCache(capacity: int) with get(key) -> value or None (a hit becomes most recently used), "
        "put(key, value) (updates and refreshes an existing key; evicts the least recently used key when over "
        "capacity) and __len__. capacity < 1 raises ValueError." + _COMMON,
     "hidden": '''
from app.core import LRUCache
c = LRUCache(2)
c.put("a", 1); c.put("b", 2); assert c.get("a") == 1
c.put("c", 3)
assert c.get("b") is None and c.get("a") == 1 and c.get("c") == 3 and len(c) == 2
c.put("a", 10); c.put("d", 4)
assert c.get("c") is None and c.get("a") == 10 and len(c) == 2
try:
    LRUCache(0); raise SystemExit("accepted capacity 0")
except ValueError:
    pass
print("HIDDEN_OK")
'''},
    {"id": "bsearch", "goal":
        "Write bsearch(a: list[int], x: int) -> int. a is sorted ascending and may contain duplicates. Return the index "
        "of the LEFTMOST occurrence of x, or -1 if absent. Must run in O(log n)." + _COMMON,
     "hidden": '''
from app.core import bsearch
assert bsearch([], 1) == -1 and bsearch([1], 1) == 0 and bsearch([1], 2) == -1
assert bsearch([1, 2, 2, 2, 3], 2) == 1 and bsearch([2, 2, 2], 2) == 0
assert bsearch(list(range(0, 2000, 2)), 1998) == 999 and bsearch(list(range(0, 2000, 2)), 7) == -1
class Counted(list):
    reads = 0
    def __getitem__(self, i):
        Counted.reads += 1
        return list.__getitem__(self, i)
big = Counted(range(100000)); bsearch(big, 77777)
assert Counted.reads < 100, "not logarithmic: %d reads" % Counted.reads
print("HIDDEN_OK")
'''},
    {"id": "thai_ratio", "goal":
        "Write thai_ratio(text: str) -> float: the fraction of NON-WHITESPACE characters that are in the Thai Unicode "
        "block U+0E00-U+0E7F. Text with no non-whitespace characters returns 0.0." + _COMMON,
     "hidden": '''
from app.core import thai_ratio
assert thai_ratio("") == 0.0 and thai_ratio("   \\n\\t") == 0.0
assert thai_ratio("\\u0e2a\\u0e27\\u0e31\\u0e2a\\u0e14\\u0e35") == 1.0
assert abs(thai_ratio("abc \\u0e01\\u0e02\\u0e03") - 0.5) < 1e-9
assert thai_ratio("hello world") == 0.0
print("HIDDEN_OK")
'''},
    {"id": "csvline", "goal":
        "Write parse_csv_line(line: str) -> list[str]. Fields are separated by commas. A field may be wrapped in double "
        "quotes, in which case it may contain commas and a doubled quote (\"\") means one literal quote. An empty line "
        "returns ['']. An unterminated quote raises ValueError. No newline handling is needed." + _COMMON,
     "hidden": '''
from app.core import parse_csv_line
assert parse_csv_line("a,b,c") == ["a", "b", "c"] and parse_csv_line("") == [""]
assert parse_csv_line('a,"b,c",d') == ["a", "b,c", "d"]
assert parse_csv_line('"he said ""hi"""') == ['he said "hi"']
assert parse_csv_line("a,,c") == ["a", "", "c"] and parse_csv_line(",") == ["", ""]
try:
    parse_csv_line('a,"b'); raise SystemExit("accepted unterminated quote")
except ValueError:
    pass
print("HIDDEN_OK")
'''},
    {"id": "base", "goal":
        "Write to_base(n: int, base: int) -> str using digits 0-9a-z (a negative n gets a leading '-', zero is '0') and "
        "from_base(s: str, base: int) -> int. Both raise ValueError when base is outside 2..36; from_base also raises "
        "ValueError for empty input or digits invalid for the base." + _COMMON,
     "hidden": '''
from app.core import to_base, from_base
assert to_base(255, 16) == "ff" and to_base(0, 2) == "0" and to_base(-10, 2) == "-1010" and to_base(35, 36) == "z"
assert from_base("ff", 16) == 255 and from_base("-1010", 2) == -10 and from_base("z", 36) == 35
assert all(from_base(to_base(n, b), b) == n for n in range(-300, 300) for b in (2, 3, 8, 16, 36))
for args in ((1, 1), (1, 37)):
    try:
        to_base(*args); raise SystemExit("to_base accepted %r" % (args,))
    except ValueError:
        pass
for args in (("", 10), ("12", 2), ("1", 99), ("-", 10)):
    try:
        from_base(*args); raise SystemExit("from_base accepted %r" % (args,))
    except ValueError:
        pass
print("HIDDEN_OK")
'''},
    {"id": "cli_sum", "goal":
        "Build a command line tool: running 'python3 -I app/cli.py 1 2 3' prints exactly 'SUM=6' (the sum of all integer "
        "arguments). With no arguments it prints 'SUM=0'. A non-integer argument prints 'ERROR' and exits with code 2. "
        "Put the logic in app/core.py as function total(args: list[str]) -> int and keep app/cli.py thin. "
        "Note: the script is started as a plain script, so the project root is not on sys.path unless the script adds it. "
        "Python standard library only. Add unit tests in tests/test_app.py and run them.",
     "hidden": '''
import subprocess, sys
def run(*a):
    return subprocess.run([sys.executable, "app/cli.py", *a], capture_output=True, text=True, timeout=10)
r = run("1", "2", "3"); assert r.returncode == 0 and r.stdout.strip() == "SUM=6", (r.returncode, r.stdout, r.stderr)
r = run(); assert r.returncode == 0 and r.stdout.strip() == "SUM=0"
r = run("-5", "5", "10"); assert r.stdout.strip() == "SUM=10"
r = run("1", "x"); assert r.returncode == 2 and "ERROR" in (r.stdout + r.stderr)
from app.core import total
assert total(["4", "5"]) == 9
print("HIDDEN_OK")
'''},
]


def hidden_check(workdir: str, code: str) -> Dict[str, Any]:
    """Write the hidden script into the work directory and run it through the Sandbox."""
    sb = Sandbox(workdir)
    try:
        sb.write_file("_hidden_check.py", code)
        r = sb.run(["python3", "-I", "_hidden_check.py"])
    except Exception as e:  # PolicyError and friends: count as failure, keep the reason
        return {"ok": False, "reason": f"{type(e).__name__}: {str(e)[:200]}"}
    ok = r.get("returncode") == 0 and "HIDDEN_OK" in r.get("output", "")
    if ok:
        return {"ok": True, "reason": None}
    return {"ok": False, "reason": "timed out" if r.get("timed_out") else (r.get("output", "")[-400:] or "failed")}


def run_bench(brain: Any, tasks: Optional[List[Dict[str, Any]]] = None, workroot: Optional[str] = None,
              max_repairs: int = 3, priority: str = "Medium") -> Dict[str, Any]:
    tasks = tasks if tasks is not None else TASKS
    root = workroot or tempfile.mkdtemp(prefix="zyntheor_bench_")
    t0, rows = time.time(), []
    for t in tasks:
        wd = os.path.join(root, t["id"])
        rep = run_task(brain, wd, t["goal"], t.get("priority", priority), max_repairs)
        hid = hidden_check(wd, t["hidden"]) if os.path.isdir(wd) else {"ok": False, "reason": "no work directory"}
        delivered = rep["status"] == "DELIVERED"
        rows.append({"task": t["id"], "delivered": delivered, "hidden_ok": hid["ok"],
                     "pass": delivered and hid["ok"], "false_success": delivered and not hid["ok"],
                     "failed_stage": rep["failed_stage"], "model_calls": rep.get("model_calls", 0),
                     "repair_attempts": rep["stages"].get("repair", {}).get("attempts", 0),
                     "first_try": rep["stages"].get("test", {}).get("first_try", False),
                     "seconds": rep.get("seconds"), "hidden_reason": hid.get("reason"),
                     "stage_errors": {k: v.get("error") or v.get("blocked_reason") for k, v in rep["stages"].items()
                                      if not v.get("ok") and (v.get("error") or v.get("blocked_reason"))}})
    n = len(rows) or 1
    stage_pass = {s: sum(1 for r in rows if _stage_ok(r, s)) for s in STAGES}
    return {
        "brain": getattr(brain, "label", brain.name), "tasks": len(rows), "workdir": root,
        "summary": {
            "pass": sum(r["pass"] for r in rows), "pass_rate": round(sum(r["pass"] for r in rows) / n, 3),
            "delivered": sum(r["delivered"] for r in rows), "hidden_ok": sum(r["hidden_ok"] for r in rows),
            "false_success": sum(r["false_success"] for r in rows),
            "first_try": sum(1 for r in rows if r["first_try"]),
            "repaired": sum(1 for r in rows if r["repair_attempts"] and r["delivered"]),
            "model_calls": sum(r["model_calls"] for r in rows), "seconds": round(time.time() - t0, 1),
            "stage_reached_ok": stage_pass,
        },
        "rows": rows,
        "note": "hidden_ok comes from check scripts the brain never saw; false_success = delivered but wrong.",
    }


_ORDER = {s: i for i, s in enumerate(STAGES)}


def _stage_ok(row: Dict[str, Any], stage: str) -> bool:
    """A stage counts as passed when the task got past it. 'repair' is recorded before 'test' in the report, so a
    task that failed at 'test' failed its repair stage too, and only a 'deliver' failure leaves repair intact."""
    f = row["failed_stage"]
    if f is None:
        return True
    if stage == "repair":
        return f == "deliver"
    return _ORDER[f] > _ORDER[stage]


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="ZYNTHEOR task-pipeline benchmark")
    ap.add_argument("--brain", choices=("template", "model"), default="template")
    ap.add_argument("--tasks", default="", help="comma separated task ids (default: all)")
    ap.add_argument("--max-repairs", type=int, default=3)
    ap.add_argument("--out", default="")
    a = ap.parse_args(argv)
    brain = TemplateBrain() if a.brain == "template" else brain_from_env()
    wanted = {x for x in a.tasks.split(",") if x}
    tasks = [t for t in TASKS if not wanted or t["id"] in wanted]
    report = run_bench(brain, tasks, max_repairs=a.max_repairs)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
