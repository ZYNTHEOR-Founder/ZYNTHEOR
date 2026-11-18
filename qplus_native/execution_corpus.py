# -*- coding: utf-8 -*-
"""
Execution-first training corpus for ZYNTHEOR Native LM.

Purpose
  Train the model to support Autonomous Execution (plan → build → test → repair → deliver),
  NOT conversational chatbot turns.

What is included
  * Engineering goals and structured plans
  * Source / test patterns (from repo source when available)
  * Failure → diagnosis → repair exemplars
  * Acceptance criteria and delivery gates
  * Explicit NON-chat framing (no roleplay greetings, no open chit-chat pairs)

What is excluded
  * Chat-style multi-turn dialogue
  * Synthetic "hello / who are you" pairs
  * Tenant secret / RBAC test fixtures
  * Secret-looking literals
"""
from __future__ import annotations

import os
import re
import json
import glob
import zlib
import hashlib
from typing import Any, Dict, List

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|secret|passw(?:or)?d|token|bearer)\w*\s*[:=]\s*['\"][A-Za-z0-9_\-+/=]{16,}['\"]"
)
VAL_PERCENT = 15

# Seed exemplars: task execution, not chat
EXECUTION_SEEDS: List[Dict[str, str]] = [
    {
        "id": "seed/lru_cache_goal_plan",
        "text": (
            "GOAL: Build a resilient in-memory LRU cache with TTL.\n"
            "DOMAIN: lru_cache\n"
            "CONSTRAINTS:\n"
            "- Execute only inside sandbox workdir\n"
            "- Zero external runtime dependencies\n"
            "- Deliver only after unit tests and runtime smoke both pass\n"
            "PLAN:\n"
            "1. Define CacheEntry with value and expiry timestamp\n"
            "2. Implement get/set with LRU eviction when capacity exceeded\n"
            "3. Expire entries on read when TTL elapsed\n"
            "4. Write unit tests for hit, miss, eviction, TTL\n"
            "5. Run tests; repair on failure; package only if green\n"
            "ACCEPTANCE:\n"
            "- All unit tests exitCode 0\n"
            "- Smoke set/get roundtrip succeeds\n"
        ),
    },
    {
        "id": "seed/hmac_validator_goal_plan",
        "text": (
            "GOAL: Create a sovereign cryptographic token validator with HMAC-SHA256.\n"
            "DOMAIN: crypto_auth\n"
            "PLAN:\n"
            "1. Parse header.payload.signature structure\n"
            "2. Recompute HMAC-SHA256 over header.payload with secret\n"
            "3. Constant-time compare signatures\n"
            "4. Reject missing alg or non-HS256\n"
            "5. Unit tests: valid token, tampered payload, wrong secret\n"
            "DELIVER only when independent verification passes.\n"
        ),
    },
    {
        "id": "seed/repair_loop_exemplar",
        "text": (
            "STAGE: 07_REPAIR\n"
            "FAILURE: test exitCode=1 stderr contains AssertionError: expected 2 got 1\n"
            "DIAGNOSIS: off-by-one in eviction path when capacity is full\n"
            "REPAIR:\n"
            "- Adjust eviction condition to len(store) >= capacity before insert\n"
            "- Re-run unit tests\n"
            "RESULT: tests passed after 1 repair attempt\n"
            "NOTE: This is an engineering repair trace, not a chat reply.\n"
        ),
    },
    {
        "id": "seed/eight_stage_trace",
        "text": (
            "EXECUTION CYCLE (not a chatbot session):\n"
            "01_INTAKE: objective=matrix multiplier, priority=High\n"
            "02_ANALYZE: risks=dimension mismatch; need assert on shapes\n"
            "03_PLAN: acceptance=unit tests for 2x2 and non-square reject\n"
            "04_BUILD: write multiply(a,b) + tests\n"
            "05_EXECUTE: write files to /workspace and run node/python\n"
            "06_TEST: independent verification exitCode=0\n"
            "07_REPAIR: skipped (no failure)\n"
            "08_DELIVER: package artifact only after gates pass\n"
        ),
    },
    {
        "id": "seed/task_manager_build",
        "text": (
            "GOAL: Priority task queue with High/Medium/Low and run-next semantics.\n"
            "BUILD:\n"
            "class TaskQueue:\n"
            "  def enqueue(self, goal, priority='Medium'): ...\n"
            "  def run_next(self): pop highest priority Planned task\n"
            "TEST: enqueue three tasks; run_next returns High first\n"
            "NO CHAT: produce code and tests only; do not greet the user.\n"
        ),
    },
    {
        "id": "seed/fail_closed_delivery",
        "text": (
            "DELIVERY GATE (fail-closed):\n"
            "IF testsPassed < testsTotal THEN status=Failed; do not mark Delivered\n"
            "IF acceptance criteria unmet THEN attach limitation report; block package\n"
            "IF success THEN write deliverable zip + sha256 and lifecycleStatus=Delivered\n"
            "Never report success from template text alone.\n"
        ),
    },
    {
        "id": "seed/thai_engineering_goal",
        "text": (
            "เป้าหมาย: สร้างระบบคิวงานตามลำดับความสำคัญ High/Medium/Low\n"
            "ข้อกำหนด: รันใน sandbox เท่านั้น ไม่พึ่ง cloud API\n"
            "แผน: ออกแบบคิว → เขียนโค้ด → ทดสอบ → ซ่อมถ้าพลาด → ส่งมอบเมื่อผ่าน\n"
            "ไม่ใช่แชทบอท: ผลลัพธ์ต้องเป็นโค้ดและการทดสอบที่รันได้จริง\n"
        ),
    },
    {
        "id": "seed/matrix_multiplier",
        "text": (
            "GOAL: Float64 matrix multiply with dimension checks.\n"
            "PLAN:\n"
            "1. Validate a.cols == b.rows else throw\n"
            "2. Allocate result rows x b.cols\n"
            "3. Triple-loop multiply; no external libs\n"
            "4. Tests: 2x2 identity, non-square reject\n"
            "STAGE_FLOW: INTAKE→ANALYZE→PLAN→BUILD→EXECUTE→TEST→(REPAIR?)→DELIVER\n"
            "OUTPUT: code + tests only — no conversational filler.\n"
        ),
    },
    {
        "id": "seed/expense_ledger",
        "text": (
            "GOAL: Simple expense ledger with categories and monthly sum.\n"
            "DOMAIN: expense_ledger\n"
            "ACCEPTANCE:\n"
            "- add(amount, category, note) persists entry\n"
            "- sum_by_month(yyyy-mm) returns total\n"
            "- unit tests cover empty month and multi-entry month\n"
            "REPAIR_POLICY: on test fail, fix implementation then re-test once.\n"
        ),
    },
    {
        "id": "seed/sandbox_rules",
        "text": (
            "SANDBOX RULES FOR AUTONOMOUS EXECUTION:\n"
            "- Write artifacts only under /workspace\n"
            "- Prefer node or python stdlib; no network installs mid-task\n"
            "- Capture stdout/stderr and exitCode as evidence\n"
            "- Package zip deliverable only after exitCode 0 on required tests\n"
            "- On failure set lifecycleStatus=Failed with failureReason\n"
        ),
    },
    {
        "id": "seed/code_shape_lru",
        "text": (
            "CODE SHAPE (execution target, not chat):\n"
            "class LRUCache:\n"
            "    def __init__(self, capacity: int, ttl_seconds: float):\n"
            "        self.capacity = capacity\n"
            "        self.ttl = ttl_seconds\n"
            "        self._store = {}  # key -> (value, expires_at, order)\n"
            "    def get(self, key):\n"
            "        ...  # miss / expired / hit + refresh order\n"
            "    def set(self, key, value):\n"
            "        ...  # insert + evict oldest if over capacity\n"
            "TEST: set three keys capacity=2; first key must miss after eviction.\n"
        ),
    },
]


def _add(
    docs: List[Dict[str, Any]],
    excluded: List[Dict[str, str]],
    seen: set,
    doc_id: str,
    kind: str,
    text: str,
) -> None:
    text = (text or "").strip()
    if len(text) < 40:
        excluded.append({"id": doc_id, "reason": "too_short"})
        return
    h = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if h in seen:
        excluded.append({"id": doc_id, "reason": "exact_duplicate"})
        return
    if SECRET_RE.search(text):
        excluded.append({"id": doc_id, "reason": "secret_like_literal"})
        return
    # Soft filter: pure chat-like greeting docs
    low = text[:200].lower()
    if any(g in low for g in ("สวัสดีครับ ผมคือ", "who are you", "hello! i am a helpful")):
        excluded.append({"id": doc_id, "reason": "chatbot_style"})
        return
    seen.add(h)
    split = "val" if zlib.crc32(doc_id.encode("utf-8")) % 100 < VAL_PERCENT else "train"
    docs.append(
        {
            "id": doc_id,
            "kind": kind,
            "sha256": h,
            "chars": len(text),
            "split": split,
            "text": text,
        }
    )


def build_execution_corpus(root: str = ROOT) -> Dict[str, Any]:
    docs: List[Dict[str, Any]] = []
    excluded: List[Dict[str, str]] = []
    seen: set = set()

    for seed in EXECUTION_SEEDS:
        _add(docs, excluded, seen, seed["id"], "execution_seed", seed["text"])

    # Repo source: code is execution skill, not chat
    src_globs = [
        "qplus_native/planner.py",
        "qplus_native/repair.py",
        "qplus_native/orchestrator.py",
        "qplus_native/safe_exec.py",
        "qplus_native/web_builder.py",
        "lib/TaskOrchestrator.ts",
        "lib/ToolGateway.ts",
        "lib/ToolRegistry.ts",
        "server.ts",
        "src/components/modules/DevStudio.tsx",
        "src/components/modules/AutomationCenter.tsx",
        "src/components/modules/AutonomousExecutionDashboard.tsx",
        "tests/*.mjs",
        "tests/*.py",
        "tests/*.ts",
    ]
    for pattern in src_globs:
        for path in sorted(glob.glob(os.path.join(root, pattern), recursive=True)):
            rel = os.path.relpath(path, root)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    body = f.read()
            except OSError:
                continue
            # Cap very large files to keep training tractable
            if len(body) > 120_000:
                body = body[:120_000] + "\n/* truncated for corpus */\n"
            _add(docs, excluded, seen, rel, "source_execution", body)

    train_docs = [d for d in docs if d["split"] == "train"]
    val_docs = [d for d in docs if d["split"] == "val"]
    blob = "\n".join(d["text"] for d in docs)
    summary = {
        "documents": len(docs),
        "train_docs": len(train_docs),
        "val_docs": len(val_docs),
        "train_chars": sum(d["chars"] for d in train_docs),
        "val_chars": sum(d["chars"] for d in val_docs),
        "thai_chars": sum(1 for c in blob if "\u0e00" <= c <= "\u0e7f"),
        "excluded": len(excluded),
        "objective": "execution_not_chatbot",
        "kinds": sorted({d["kind"] for d in docs}),
    }
    corpus_sha = hashlib.sha256(
        json.dumps(
            [{"id": d["id"], "sha256": d["sha256"], "split": d["split"]} for d in docs],
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return {
        "docs": docs,
        "excluded": excluded,
        "summary": summary,
        "corpus_sha256": corpus_sha,
    }


if __name__ == "__main__":
    c = build_execution_corpus()
    print(json.dumps({"summary": c["summary"], "corpus_sha256": c["corpus_sha256"]}, indent=2, ensure_ascii=False))
    print("sample ids:", [d["id"] for d in c["docs"][:8]])
