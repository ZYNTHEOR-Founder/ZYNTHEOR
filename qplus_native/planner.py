# -*- coding: utf-8 -*-
"""
Gate 5: Autonomous Task Interpreter, Planner, Multi-File Builder & Packager.

Transforms a natural-language goal + priority (High / Medium / Low) into:
  1. Parsed Task Specification (objective, domain, constraints, deliverables, risks).
  2. Multi-file Orchestrator Plan (module source, CLI runner, unit tests, README, acceptance gates).
  3. Execution + Self-Repair through Sandbox + Orchestrator + SelfRepairEngine.
  4. Verified Deliverable Packaging (.zip archive + extraction integrity check + SHA-256 manifest),
     created ONLY when all acceptance checks pass.
  5. End-to-End Acceptance Scenario proving: plan -> multi-file build -> run -> intentional defect
     detection -> autonomous repair -> regression verification -> zip delivery.
"""
import hashlib
import os
import re
import zipfile
from typing import Any, Dict, List, Optional

from qplus_native.repair import SelfRepairEngine
from qplus_native.safe_exec import Sandbox


VALID_PRIORITIES = ("High", "Medium", "Low")


def normalize_priority(raw: Optional[str]) -> str:
    if not raw or not isinstance(raw, str):
        return "Medium"
    cand = raw.strip().lower()
    if cand == "high":
        return "High"
    if cand == "low":
        return "Low"
    return "Medium"


def interpret_goal(goal: str, priority: Optional[str] = None) -> Dict[str, Any]:
    """Parses a natural-language engineering goal into structured requirements & domain."""
    clean_goal = (goal or "").strip()
    prio = normalize_priority(priority)
    g = clean_goal.lower()

    if any(k in g for k in ("expense", "ledger", "budget", "finance", "รายรับ", "รายจ่าย", "บัญชี")):
        domain = "expense_ledger"
    elif any(k in g for k in ("lru", "cache", "ttl", "แคช")):
        domain = "lru_cache"
    elif any(k in g for k in ("task", "todo", "queue", "priority", "งาน", "ลำดับความสำคัญ")):
        domain = "task_manager"
    elif any(k in g for k in ("token", "hmac", "auth", "crypto", "signature", "ความปลอดภัย")):
        domain = "crypto_auth"
    else:
        domain = "data_processor"

    constraints = [
        "Execute strictly inside sandbox workdir",
        "Zero external runtime dependencies (Python stdlib or Node.js built-ins only)",
        "Deliver only after unit tests and runtime smoke run both pass",
    ]
    if prio == "High":
        constraints.append("High-priority strict regression & integrity gate")

    target_runtime = "python3"
    if any(k in g for k in ("html", "website", "frontend", "web app", "landing", "css", "หน้าเว็บ")):
        target_runtime = "web_app"
    elif any(k in g for k in ("node", "javascript", "esm", ".js", "express", "typescript")):
        target_runtime = "node_esm"

    ambiguities = []
    if len(clean_goal) < 12:
        ambiguities.append("Short objective; inferred standard CLI + unit test deliverables")

    deliverables = (
        ["index.html", "src/app.js", "tests/app.test.js", "README.md"]
        if target_runtime == "web_app"
        else ["src/core.js", "src/cli.js", "tests/test_app.js", "README.md"]
        if target_runtime == "node_esm"
        else ["app/__init__.py", "app/core.py", "app/cli.py", "tests/test_app.py", "README.md"]
    )

    return {
        "goal": clean_goal,
        "priority": prio,
        "domain": domain,
        "target_runtime": target_runtime,
        "constraints": constraints,
        "ambiguities": ambiguities,
        "deliverables": deliverables,
    }


def resolve_dag_order(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Topologically orders plan steps according to optional `depends_on` lists without mutating step schemas."""
    by_id = {s["id"]: s for s in steps if isinstance(s, dict) and s.get("id")}
    visited: Dict[str, int] = {}
    ordered: List[Dict[str, Any]] = []

    def visit(sid: str) -> None:
        state = visited.get(sid, 0)
        if state == 2:
            return
        if state == 1:
            raise ValueError(f"Cycle detected in plan DAG at step '{sid}'")
        visited[sid] = 1
        step = by_id[sid]
        for dep in step.get("depends_on") or []:
            if dep in by_id:
                visit(dep)
        visited[sid] = 2
        ordered.append(step)

    for s in steps:
        if isinstance(s, dict) and s.get("id") and visited.get(s["id"], 0) == 0:
            visit(s["id"])
    return ordered


def _generate_project_files(spec: Dict[str, Any]) -> Dict[str, str]:
    domain = spec["domain"]
    target_runtime = spec.get("target_runtime", "python3")
    goal_safe = spec["goal"].replace('"', "'")
    prio = spec["priority"]

    if target_runtime == "node_esm":
        core_js = f'''// ZYNTHEOR Node.js ESM Core — Goal: {goal_safe} (Priority: {prio})
import crypto from 'node:crypto';

export function add(a, b) {{
  return a + b;
}}

export function createManifest(items) {{
  const cleaned = items.map((x) => String(x).trim()).filter(Boolean);
  const sha256 = crypto.createHash('sha256').update(cleaned.join('|')).digest('hex');
  return {{ count: cleaned.length, items: cleaned, sha256 }};
}}
'''
        cli_js = '''import { add, createManifest } from './core.js';

export function runDemo() {
  const m = createManifest(['intake', 'plan', 'build', 'verify', 'deliver']);
  return { ...m, checksum: add(21, 21) };
}

console.log('APP_RUN_OK:', JSON.stringify(runDemo()));
'''
        test_js = '''import assert from 'node:assert/strict';
import { add, createManifest } from '../src/core.js';

assert.equal(add(3, 4), 7);
const m = createManifest([' a ', '', 'b']);
assert.equal(m.count, 2);
assert.equal(m.sha256.length, 64);
console.log('OK: Node ESM assertions passed');
'''
        readme_md = f"""# ZYNTHEOR Autonomous Deliverable (Node.js ESM)

- **Goal**: {goal_safe}
- **Priority**: {prio}
- **Runtime**: Node.js ESM
"""
        return {
            "src/core.js": core_js,
            "src/cli.js": cli_js,
            "tests/test_app.js": test_js,
            "README.md": readme_md,
        }

    if target_runtime == "web_app":
        html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ZYNTHEOR App · {goal_safe}</title>
</head>
<body>
  <main id="app"><h1>{goal_safe}</h1><p id="status">Initialized</p></main>
  <script type="module" src="./src/app.js"></script>
</body>
</html>
'''
        app_js = '''export function summarizeState(items) {
  const clean = items.map((x) => String(x).trim()).filter(Boolean);
  return { total: clean.length, label: `Items: ${clean.length}` };
}
'''
        test_js = '''import assert from 'node:assert/strict';
import { summarizeState } from '../src/app.js';

const res = summarizeState(['alpha', '', 'beta']);
assert.equal(res.total, 2);
assert.equal(res.label, 'Items: 2');
console.log('OK: Web App module assertions passed');
'''
        readme_md = f"""# ZYNTHEOR Autonomous Deliverable (Web App)

- **Goal**: {goal_safe}
- **Priority**: {prio}
"""
        return {
            "index.html": html,
            "src/app.js": app_js,
            "tests/app.test.js": test_js,
            "README.md": readme_md,
        }

    if domain == "expense_ledger":
        core_py = f'''# -*- coding: utf-8 -*-
"""Expense & Budget Ledger core module. Priority: {prio}."""
from dataclasses import dataclass, asdict
from typing import Dict, List


@dataclass
class LedgerEntry:
    title: str
    amount: float
    category: str = "general"


class ExpenseLedger:
    def __init__(self):
        self.entries: List[LedgerEntry] = []

    def add_entry(self, title: str, amount: float, category: str = "general") -> LedgerEntry:
        if not title or not title.strip():
            raise ValueError("title must be non-empty")
        if amount < 0:
            raise ValueError("amount must be non-negative")
        entry = LedgerEntry(title=title.strip(), amount=round(float(amount), 2), category=category)
        self.entries.append(entry)
        return entry

    def total(self) -> float:
        total_val = 0.0
        for e in self.entries:
            total_val += e.amount
        return round(total_val, 2)

    def average(self) -> float:
        if not self.entries:
            return 0.0
        return round(self.total() / len(self.entries), 2)

    def by_category(self) -> Dict[str, float]:
        grouped: Dict[str, float] = {{}}
        for e in self.entries:
            grouped[e.category] = round(grouped.get(e.category, 0.0) + e.amount, 2)
        return grouped

    def export_summary(self) -> Dict[str, object]:
        return {{
            "count": len(self.entries),
            "total": self.total(),
            "average": self.average(),
            "categories": self.by_category(),
            "entries": [asdict(e) for e in self.entries],
        }}
'''
        cli_py = '''# -*- coding: utf-8 -*-
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core import ExpenseLedger


def run_demo() -> dict:
    ledger = ExpenseLedger()
    ledger.add_entry("Compute Node", 120.50, "infra")
    ledger.add_entry("Storage Volume", 45.25, "infra")
    ledger.add_entry("Audit Export", 14.25, "governance")
    return ledger.export_summary()


if __name__ == "__main__":
    summary = run_demo()
    print("APP_RUN_OK:", json.dumps(summary))
'''
        test_py = '''# -*- coding: utf-8 -*-
import unittest
from app.core import ExpenseLedger
from app.cli import run_demo


class TestExpenseLedger(unittest.TestCase):
    def test_totals_and_average(self):
        ledger = ExpenseLedger()
        self.assertEqual(ledger.average(), 0.0)
        ledger.add_entry("Item A", 10.5, "ops")
        ledger.add_entry("Item B", 20.5, "ops")
        self.assertEqual(ledger.total(), 31.0)
        self.assertEqual(ledger.average(), 15.5)
        self.assertEqual(ledger.by_category(), {"ops": 31.0})

    def test_validation_rejects_negative(self):
        ledger = ExpenseLedger()
        with self.assertRaises(ValueError):
            ledger.add_entry("Bad", -5.0)

    def test_cli_demo_smoke(self):
        summary = run_demo()
        self.assertEqual(summary["count"], 3)
        self.assertEqual(summary["total"], 180.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
'''
    elif domain == "lru_cache":
        core_py = f'''# -*- coding: utf-8 -*-
"""In-Memory LRU Cache with TTL support. Priority: {prio}."""
from collections import OrderedDict
import time
from typing import Any, Optional


class LRUCache:
    def __init__(self, capacity: int = 16, default_ttl_s: float = 60.0):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self.capacity = capacity
        self.default_ttl_s = default_ttl_s
        self._store: OrderedDict = OrderedDict()

    def set(self, key: str, value: Any, ttl_s: Optional[float] = None) -> None:
        ttl = self.default_ttl_s if ttl_s is None else ttl_s
        expiry = time.monotonic() + max(0.0, ttl)
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (value, expiry)
        while len(self._store) > self.capacity:
            self._store.popitem(last=False)

    def get(self, key: str) -> Any:
        if key not in self._store:
            return None
        val, expiry = self._store[key]
        if time.monotonic() > expiry:
            del self._store[key]
            return None
        self._store.move_to_end(key)
        return val

    def size(self) -> int:
        return len(self._store)
'''
        cli_py = '''# -*- coding: utf-8 -*-
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core import LRUCache


def run_demo() -> dict:
    c = LRUCache(capacity=2)
    c.set("k1", "v1")
    c.set("k2", "v2")
    _ = c.get("k1")
    c.set("k3", "v3")
    return {"size": c.size(), "k1": c.get("k1"), "k2_evicted": c.get("k2") is None, "k3": c.get("k3")}


if __name__ == "__main__":
    print("APP_RUN_OK:", json.dumps(run_demo()))
'''
        test_py = '''# -*- coding: utf-8 -*-
import unittest
from app.core import LRUCache
from app.cli import run_demo


class TestLRUCache(unittest.TestCase):
    def test_eviction_and_recency(self):
        c = LRUCache(capacity=2)
        c.set("a", 1)
        c.set("b", 2)
        self.assertEqual(c.get("a"), 1)
        c.set("c", 3)
        self.assertIsNone(c.get("b"))
        self.assertEqual(c.get("c"), 3)

    def test_cli_demo(self):
        res = run_demo()
        self.assertTrue(res["k2_evicted"])
        self.assertEqual(res["size"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
'''
    elif domain == "task_manager":
        core_py = f'''# -*- coding: utf-8 -*-
"""Priority Task Queue & State Manager. Priority: {prio}."""
from dataclasses import dataclass, asdict
from typing import Dict, List

PRIORITY_RANK = {{"High": 0, "Medium": 1, "Low": 2}}


@dataclass
class TaskItem:
    task_id: str
    title: str
    priority: str = "Medium"
    status: str = "Planned"


class PriorityTaskQueue:
    def __init__(self):
        self._tasks: Dict[str, TaskItem] = {{}}

    def add(self, task_id: str, title: str, priority: str = "Medium") -> TaskItem:
        if priority not in PRIORITY_RANK:
            raise ValueError(f"Unsupported priority: {{priority}}")
        item = TaskItem(task_id=task_id, title=title, priority=priority)
        self._tasks[task_id] = item
        return item

    def transition(self, task_id: str, status: str) -> TaskItem:
        item = self._tasks[task_id]
        item.status = status
        return item

    def ordered(self) -> List[Dict[str, str]]:
        ranked = sorted(self._tasks.values(), key=lambda t: (PRIORITY_RANK[t.priority], t.task_id))
        return [asdict(t) for t in ranked]
'''
        cli_py = '''# -*- coding: utf-8 -*-
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core import PriorityTaskQueue


def run_demo() -> dict:
    q = PriorityTaskQueue()
    q.add("t1", "Low cleanup", "Low")
    q.add("t2", "Critical fix", "High")
    q.add("t3", "Regular build", "Medium")
    q.transition("t2", "Delivered")
    return {"ordered": q.ordered()}


if __name__ == "__main__":
    print("APP_RUN_OK:", json.dumps(run_demo()))
'''
        test_py = '''# -*- coding: utf-8 -*-
import unittest
from app.core import PriorityTaskQueue
from app.cli import run_demo


class TestPriorityQueue(unittest.TestCase):
    def test_priority_ordering(self):
        q = PriorityTaskQueue()
        q.add("a", "Low", "Low")
        q.add("b", "High", "High")
        q.add("c", "Med", "Medium")
        self.assertEqual([t["priority"] for t in q.ordered()], ["High", "Medium", "Low"])

    def test_cli_demo(self):
        out = run_demo()
        self.assertEqual(out["ordered"][0]["status"], "Delivered")


if __name__ == "__main__":
    unittest.main(verbosity=2)
'''
    else:
        core_py = f'''# -*- coding: utf-8 -*-
"""Sovereign modular processor built for: {goal_safe} (Priority: {prio})."""
import hashlib
from typing import Dict, List


def add(a: int, b: int) -> int:
    return a + b


def process_records(items: List[str]) -> Dict[str, object]:
    cleaned = [str(x).strip() for x in items if str(x).strip()]
    joined = "|".join(cleaned)
    digest = hashlib.sha256(joined.encode("utf-8")).hexdigest()
    return {{"count": len(cleaned), "items": cleaned, "sha256": digest}}
'''
        cli_py = '''# -*- coding: utf-8 -*-
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core import add, process_records


def run_demo() -> dict:
    res = process_records(["intake", "plan", "build", "verify", "deliver"])
    res["checksum"] = add(21, 21)
    return res


if __name__ == "__main__":
    print("APP_RUN_OK:", json.dumps(run_demo()))
'''
        test_py = '''# -*- coding: utf-8 -*-
import unittest
from app.core import add, process_records
from app.cli import run_demo


class TestApp(unittest.TestCase):
    def test_add_and_process(self):
        self.assertEqual(add(2, 3), 5)
        res = process_records([" a ", "", "b"])
        self.assertEqual(res["count"], 2)
        self.assertEqual(len(res["sha256"]), 64)

    def test_cli_demo(self):
        res = run_demo()
        self.assertEqual(res["count"], 5)
        self.assertEqual(res["checksum"], 42)


if __name__ == "__main__":
    unittest.main(verbosity=2)
'''

    readme_md = f"""# ZYNTHEOR Autonomous Deliverable

- **Goal**: {goal_safe}
- **Priority**: {prio}
- **Domain**: {domain}

## Structure
- `app/core.py` — Domain logic & invariants
- `app/cli.py` — Runnable CLI entry point
- `tests/test_app.py` — Unit & integration tests
"""
    return {
        "app/__init__.py": "# ZYNTHEOR generated package\n",
        "app/core.py": core_py,
        "app/cli.py": cli_py,
        "tests/__init__.py": "",
        "tests/test_app.py": test_py,
        "README.md": readme_md,
    }


def plan_project(
    goal: str,
    priority: Optional[str] = None,
    read_only_rag_context: Optional[List[str]] = None,
) -> Dict[str, Any]:
    spec = interpret_goal(goal, priority)
    files = _generate_project_files(spec)
    target_runtime = spec.get("target_runtime", "python3")

    steps: List[Dict[str, Any]] = []
    build_ids: List[str] = []
    idx = 1
    for rel_path, content in files.items():
        sid = f"build_{idx}"
        steps.append({
            "id": sid,
            "do": "write_file",
            "path": rel_path,
            "content": content,
            "depends_on": [],
        })
        build_ids.append(sid)
        idx += 1

    if target_runtime == "node_esm":
        steps.append({"id": "run_app", "do": "run", "argv": ["node", "src/cli.js"], "depends_on": build_ids})
        steps.append({"id": "run_tests", "do": "run", "argv": ["node", "tests/test_app.js"], "depends_on": ["run_app"]})
        acceptance = [
            {"check": "file_exists", "path": "src/core.js"},
            {"check": "file_exists", "path": "src/cli.js"},
            {"check": "file_exists", "path": "tests/test_app.js"},
            {"check": "file_exists", "path": "README.md"},
            {"check": "returncode_zero", "step": "run_app"},
            {"check": "output_contains", "step": "run_app", "text": "APP_RUN_OK"},
            {"check": "returncode_zero", "step": "run_tests"},
            {"check": "output_contains", "step": "run_tests", "text": "OK"},
        ]
    elif target_runtime == "web_app":
        steps.append({"id": "run_tests", "do": "run", "argv": ["node", "tests/app.test.js"], "depends_on": build_ids})
        acceptance = [
            {"check": "file_exists", "path": "index.html"},
            {"check": "file_exists", "path": "src/app.js"},
            {"check": "file_exists", "path": "tests/app.test.js"},
            {"check": "file_exists", "path": "README.md"},
            {"check": "returncode_zero", "step": "run_tests"},
            {"check": "output_contains", "step": "run_tests", "text": "OK"},
        ]
    else:
        steps.append({"id": "run_app", "do": "run", "argv": ["python3", "-I", "app/cli.py"], "depends_on": build_ids})
        steps.append({"id": "run_tests", "do": "run", "argv": ["python3", "-I", "-m", "unittest", "discover", "-s", "tests", "-v"], "depends_on": ["run_app"]})
        acceptance = [
            {"check": "file_exists", "path": "app/core.py"},
            {"check": "file_exists", "path": "app/cli.py"},
            {"check": "file_exists", "path": "tests/test_app.py"},
            {"check": "file_exists", "path": "README.md"},
            {"check": "returncode_zero", "step": "run_app"},
            {"check": "output_contains", "step": "run_app", "text": "APP_RUN_OK"},
            {"check": "returncode_zero", "step": "run_tests"},
            {"check": "output_contains", "step": "run_tests", "text": "OK"},
        ]

    ordered_steps = resolve_dag_order(steps)
    return {
        "goal": spec["goal"],
        "priority": spec["priority"],
        "spec": spec,
        "read_only_rag_context": list(read_only_rag_context or []),
        "steps": ordered_steps,
        "acceptance": acceptance,
    }


def package_deliverable(sandbox: Sandbox, zip_rel_path: str = "deliverable.zip", exclude_dirs: tuple = (".zyntheor", "__pycache__")) -> Dict[str, Any]:
    """Packages verified workspace files into a valid extractable .zip inside sandbox.root."""
    out_full = sandbox.resolve(zip_rel_path, "package_deliverable")
    included: List[Dict[str, Any]] = []
    with zipfile.ZipFile(out_full, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(sandbox.root):
            dirnames[:] = sorted(d for d in dirnames if d not in exclude_dirs)
            for fn in sorted(filenames):
                if fn.endswith(".pyc") or fn == os.path.basename(out_full):
                    continue
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, sandbox.root).replace(os.sep, "/")
                zf.write(full, rel)
                with open(full, "rb") as rf:
                    digest = hashlib.sha256(rf.read()).hexdigest()
                included.append({"path": rel, "bytes": os.path.getsize(full), "sha256": digest})

    # Verify zip integrity independently via testzip()
    with zipfile.ZipFile(out_full, "r") as zf:
        bad_member = zf.testzip()
        namelist = zf.namelist()
    with open(out_full, "rb") as zrf:
        zip_sha256 = hashlib.sha256(zrf.read()).hexdigest()

    return {
        "zip_path": zip_rel_path,
        "zip_sha256": zip_sha256,
        "zip_bytes": os.path.getsize(out_full),
        "integrity_ok": bad_member is None and len(namelist) == len(included),
        "bad_member": bad_member,
        "files": included,
    }


def execute_goal_end_to_end(workdir: str, goal: str, priority: Optional[str] = "Medium", package_zip: bool = True) -> Dict[str, Any]:
    sb = Sandbox(workdir)
    plan = plan_project(goal, priority=priority)
    engine = SelfRepairEngine(sb, max_repairs=3)
    res = engine.execute_with_repair(plan)
    pkg = None
    if res["status"] == "SUCCEEDED" and package_zip:
        pkg = package_deliverable(sb)
    return {
        **res,
        "priority": plan["priority"],
        "spec": plan["spec"],
        "package": pkg,
    }


def run_acceptance_scenario(workdir: str, goal: str = "Build an expense ledger CLI module with totals, average, and tests", priority: str = "High") -> Dict[str, Any]:
    """
    Executes the real-world acceptance scenario (Prompt Section 9 / Acceptance):
      1. Interpret goal & generate multi-file project plan.
      2. Execute baseline build & verify initial tests PASS.
      3. Introduce an intentional defect into `app/core.py` on disk.
      4. Execute verification -> assert defect is DETECTED and delivery BLOCKED (`FAILED`).
      5. Trigger SelfRepairEngine -> diagnose root cause, patch defect, run regression checks.
      6. Verify all acceptance criteria PASS and package final deliverable ZIP.
    """
    sb = Sandbox(workdir)
    plan = plan_project(goal, priority=priority)
    engine = SelfRepairEngine(sb, max_repairs=3)

    # Phase 1: Baseline build & run
    baseline = engine.execute_with_repair(plan)
    if baseline["status"] != "SUCCEEDED":
        return {"scenario_passed": False, "phase": "baseline", "baseline": baseline}

    # Phase 2: Inject an intentional realistic defect into app/core.py (ZeroDivisionError / arithmetic corruption)
    orig_core = sb.read_file("app/core.py")
    defective_core = orig_core
    defect_type = "arithmetic_corruption"
    if "def total(self)" in defective_core:
        defective_core = defective_core.replace("total_val += e.amount", "total_val -= e.amount", 1)
        defect_type = "sign_inversion_total"
    elif "def add(a: int, b: int)" in defective_core:
        defective_core = defective_core.replace("return a + b", "return a - b", 1)
        defect_type = "operator_corruption_add"
    else:
        defective_core = defective_core + "\n_force_err = 1 / 0\n"
        defect_type = "zero_division"

    # Update plan's core.py step to reflect the defective source on disk before re-verifying
    defective_plan = {
        **plan,
        "steps": [
            {**s, "content": defective_core} if (s.get("do") == "write_file" and s.get("path") == "app/core.py") else dict(s)
            for s in plan["steps"]
        ],
    }

    # Phase 3: Raw Orchestrator must detect FAILED & block delivery
    detection = engine.orc.execute(defective_plan)
    defect_detected = detection["status"] == "FAILED" and detection["delivered"] is False

    # Phase 4: SelfRepairEngine must diagnose, repair, and verify regression
    repaired = engine.execute_with_repair(defective_plan)
    repair_succeeded = repaired["status"] == "SUCCEEDED" and repaired["delivered"] is True and repaired["repaired"] is True

    # Phase 5: Package deliverable only when repaired & verified
    package = package_deliverable(sb) if repair_succeeded else None

    scenario_passed = bool(
        baseline["status"] == "SUCCEEDED"
        and defect_detected
        and repair_succeeded
        and package is not None
        and package["integrity_ok"]
    )
    return {
        "scenario_passed": scenario_passed,
        "priority": plan["priority"],
        "defect_type": defect_type,
        "baseline_status": baseline["status"],
        "defect_detection_status": detection["status"],
        "defect_detected": defect_detected,
        "repair_status": repaired["status"],
        "repair_attempts": repaired["repair_attempts"],
        "regression_passed": repaired["regression_passed"],
        "deliverables": repaired["deliverables"],
        "package": package,
        "audit": repaired["audit"],
    }
