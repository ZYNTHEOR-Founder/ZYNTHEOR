# -*- coding: utf-8 -*-
"""Reference solutions and scripted 'models' used to test the pipeline and the benchmark harness itself.

They prove that (1) every benchmark task is solvable and its hidden check accepts a correct solution,
(2) the hidden check rejects plausible wrong solutions, and (3) the pipeline copes with badly behaved model output.
No real model is involved."""
import json
import re
import textwrap
from typing import Any, Dict

from qplus_native.agent_bench import TASKS

CORE: Dict[str, str] = {}
CORE["slugify"] = '''import re


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
'''
CORE["roman"] = '''_PAIRS = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"),
          (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def to_roman(n):
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 3999:
        raise ValueError("n must be an int in 1..3999")
    out = []
    for value, symbol in _PAIRS:
        while n >= value:
            out.append(symbol)
            n -= value
    return "".join(out)


def from_roman(s):
    if not isinstance(s, str) or not s or any(ch not in _VALUES for ch in s):
        raise ValueError("invalid Roman numeral")
    total = 0
    for i, ch in enumerate(s):
        v = _VALUES[ch]
        total += -v if i + 1 < len(s) and _VALUES[s[i + 1]] > v else v
    if not 1 <= total <= 3999 or to_roman(total) != s:
        raise ValueError("not a canonical Roman numeral")
    return total
'''
CORE["brackets"] = '''def is_balanced(s):
    closers = {")": "(", "]": "[", "}": "{"}
    stack = []
    for ch in s:
        if ch in "([{":
            stack.append(ch)
        elif ch in closers:
            if not stack or stack.pop() != closers[ch]:
                return False
    return not stack
'''
CORE["wordfreq"] = '''import re
from collections import Counter


def top_words(text, k):
    if k <= 0:
        return []
    counts = Counter(re.findall(r"[a-z]+", text.lower()))
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:k]
'''
CORE["intervals"] = '''def merge_intervals(intervals):
    for start, end in intervals:
        if start > end:
            raise ValueError("start > end")
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged
'''
CORE["lru"] = '''from collections import OrderedDict


class LRUCache:
    def __init__(self, capacity):
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        self.capacity = capacity
        self._d = OrderedDict()

    def get(self, key):
        if key not in self._d:
            return None
        self._d.move_to_end(key)
        return self._d[key]

    def put(self, key, value):
        self._d[key] = value
        self._d.move_to_end(key)
        if len(self._d) > self.capacity:
            self._d.popitem(last=False)

    def __len__(self):
        return len(self._d)
'''
CORE["bsearch"] = '''def bsearch(a, x):
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < x:
            lo = mid + 1
        else:
            hi = mid
    return lo if lo < len(a) and a[lo] == x else -1
'''
CORE["thai_ratio"] = '''def thai_ratio(text):
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return 0.0
    return sum(1 for c in chars if "\\u0e00" <= c <= "\\u0e7f") / len(chars)
'''
CORE["csvline"] = '''def parse_csv_line(line):
    fields, cur, i, in_quotes = [], [], 0, False
    while i < len(line):
        ch = line[i]
        if in_quotes:
            if ch == '"':
                if line[i + 1:i + 2] == '"':
                    cur.append('"')
                    i += 1
                else:
                    in_quotes = False
            else:
                cur.append(ch)
        elif ch == '"':
            in_quotes = True
        elif ch == ",":
            fields.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    if in_quotes:
        raise ValueError("unterminated quote")
    fields.append("".join(cur))
    return fields
'''
CORE["base"] = '''_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


def to_base(n, base):
    if not 2 <= base <= 36:
        raise ValueError("base must be 2..36")
    if n == 0:
        return "0"
    sign, n, out = ("-" if n < 0 else ""), abs(n), []
    while n:
        n, r = divmod(n, base)
        out.append(_DIGITS[r])
    return sign + "".join(reversed(out))


def from_base(s, base):
    if not 2 <= base <= 36:
        raise ValueError("base must be 2..36")
    neg = s.startswith("-")
    body = s[1:] if neg else s
    if not body:
        raise ValueError("no digits")
    value = 0
    for ch in body.lower():
        d = _DIGITS.find(ch)
        if d < 0 or d >= base:
            raise ValueError("invalid digit")
        value = value * base + d
    return -value if neg else value
'''
CORE["cli_sum"] = '''def total(args):
    return sum(int(a) for a in args)
'''
CLI_SUM = '''import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core import total


def main(argv):
    try:
        print("SUM=%d" % total(argv))
    except ValueError:
        print("ERROR")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
'''

# One real assertion per task for the plan's own unit test (deliberately weaker than the hidden check).
_UNIT_BODY = {
    "slugify": ("slugify", 'self.assertEqual(slugify("  Hello, World!  "), "hello-world")'),
    "roman": ("to_roman, from_roman", 'self.assertEqual(to_roman(1994), "MCMXCIV")\n        self.assertEqual(from_roman("MCMXCIV"), 1994)'),
    "brackets": ("is_balanced", 'self.assertTrue(is_balanced("{[()]}"))\n        self.assertFalse(is_balanced("(]"))'),
    "wordfreq": ("top_words", 'self.assertEqual(top_words("b a b", 1), [("b", 2)])'),
    "intervals": ("merge_intervals", 'self.assertEqual(merge_intervals([(1, 3), (2, 4)]), [(1, 4)])'),
    "lru": ("LRUCache", 'c = LRUCache(1)\n        c.put("a", 1)\n        c.put("b", 2)\n        self.assertIsNone(c.get("a"))'),
    "bsearch": ("bsearch", 'self.assertEqual(bsearch([1, 2, 2, 3], 2), 1)'),
    "thai_ratio": ("thai_ratio", 'self.assertEqual(thai_ratio(""), 0.0)'),
    "csvline": ("parse_csv_line", 'self.assertEqual(parse_csv_line(\'a,"b,c"\'), ["a", "b,c"])'),
    "base": ("to_base, from_base", 'self.assertEqual(to_base(255, 16), "ff")\n        self.assertEqual(from_base("ff", 16), 255)'),
    "cli_sum": ("total", 'self.assertEqual(total(["1", "2"]), 3)'),
}


def unit_test(task_id: str) -> str:
    names, body = _UNIT_BODY[task_id]
    return ("import unittest\nfrom app.core import " + names + "\n\n\nclass T(unittest.TestCase):\n"
            "    def test_basic(self):\n        " + body + "\n\n\nif __name__ == '__main__':\n    unittest.main()\n")


# Plausible wrong first attempts: the plan's own test catches them, so the repair loop must fix them.
BUGGY: Dict[str, str] = {
    "slugify": CORE["slugify"].replace('.strip("-")', ""),
    "roman": CORE["roman"].replace("(900, \"CM\"), ", "").replace("(400, \"CD\"), ", ""),
}
# A wrong implementation paired with a test too weak to notice: the pipeline will "deliver" it.
CHEATER_CORE = 'def slugify(text):\n    return text.lower().replace(" ", "-")\n'
CHEATER_TEST = ("import unittest\nfrom app.core import slugify\n\n\nclass T(unittest.TestCase):\n"
                "    def test_basic(self):\n        self.assertEqual(slugify('a b'), 'a-b')\n\n\n"
                "if __name__ == '__main__':\n    unittest.main()\n")

_BY_GOAL = {t["goal"]: t["id"] for t in TASKS}
_TEST_CMD = ["python3", "-I", "-m", "unittest", "discover", "-s", "tests", "-v"]


def build_plan(task_id: str, core: str, test: str, goal: str) -> Dict[str, Any]:
    steps = [{"id": "b1", "do": "write_file", "path": "app/__init__.py", "content": ""},
             {"id": "b2", "do": "write_file", "path": "app/core.py", "content": core}]
    if task_id == "cli_sum":
        steps.append({"id": "b3", "do": "write_file", "path": "app/cli.py", "content": CLI_SUM})
    steps += [{"id": "b4", "do": "write_file", "path": "tests/test_app.py", "content": test},
              {"id": "t1", "do": "run", "argv": _TEST_CMD}]
    return {"goal": goal, "steps": steps,
            "acceptance": [{"check": "file_exists", "path": "app/core.py"},
                           {"check": "returncode_zero", "step": "t1"},
                           {"check": "output_contains", "step": "t1", "text": "OK"}]}


class Scripted:
    """A fake model. `mode` picks the behaviour; calls are counted per stage in self.seen."""

    def __init__(self, mode: str = "perfect"):
        self.mode = mode
        self.seen = []
        self.task = None
        self.plan_replies = 0

    def __call__(self, system: str, user: str) -> str:
        stage = re.search(r"\[ZYNTHEOR-STAGE:(\w+)\]", system).group(1)
        self.seen.append(stage)
        if self.mode == "garbage":
            return "I'm sorry, I cannot help with that."
        reply = self._reply(stage, user)
        if self.mode == "fenced":
            return "Sure! Here is the JSON you asked for:\n```json\n" + reply + "\n```\nHope that helps."
        return reply

    def _reply(self, stage: str, user: str) -> str:
        if stage == "interpret":
            goal = re.search(r"<goal>\n(.*?)\n</goal>", user, re.S).group(1)
            self.task = _BY_GOAL[goal]
            return json.dumps({"objective": goal, "runtime": "python3", "files": ["app/core.py", "tests/test_app.py"],
                               "interfaces": [], "edge_cases": [], "risks": []})
        if stage == "plan":
            spec = json.loads(re.search(r"<spec>\n(.*?)\n</spec>", user, re.S).group(1))
            tid, goal = _BY_GOAL[spec["objective"]], spec["objective"]
            self.task = tid
            self.plan_replies += 1
            if self.mode == "malicious":
                plan = build_plan(tid, CORE[tid], unit_test(tid), goal)
                plan["steps"][-1] = {"id": "t1", "do": "run", "argv": ["python3", "-c", "import os; os.system('id')"]}
                return json.dumps(plan)
            if self.mode == "traversal":
                plan = build_plan(tid, CORE[tid], unit_test(tid), goal)
                plan["steps"][0]["path"] = "../escaped.txt"
                return json.dumps(plan)
            if self.mode == "invalid_then_valid" and self.plan_replies == 1:
                plan = build_plan(tid, CORE[tid], unit_test(tid), goal)
                plan["acceptance"] = []
                return json.dumps(plan)
            if self.mode == "buggy_then_fix" and tid in BUGGY:
                return json.dumps(build_plan(tid, BUGGY[tid], unit_test(tid), goal))
            if self.mode == "cheater" and tid == "slugify":
                return json.dumps(build_plan(tid, CHEATER_CORE, CHEATER_TEST, goal))
            return json.dumps(build_plan(tid, CORE[tid], unit_test(tid), goal))
        if stage == "repair":
            return json.dumps({"diagnosis": "restore the canonical implementation", "files": {"app/core.py": CORE[self.task]}})
        raise AssertionError(stage)
