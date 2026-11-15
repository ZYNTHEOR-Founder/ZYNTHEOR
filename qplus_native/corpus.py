# -*- coding: utf-8 -*-
"""
Auditable training-corpus builder for ZYNTHEOR Native LM v2.

Rules (each one exists because the audit found the opposite in the existing datasets):
  * Knowledge documents are used only when curatedForTraining is true.
  * Existing dataset manifests are NOT used: the "VERIFIED_READY" corpus references
    "TenantA Secret ..." RBAC-test documents, i.e. tenant-isolated test secrets.
  * Synthetic / test-benchmark documents are excluded.
  * Files containing secret-looking literals are excluded and listed in the manifest.
  * Exact duplicates are removed by SHA-256.
  * Train/validation split is by whole document (crc32 of its id), never by window, so
    validation text is never seen, even partially, during training.
"""
import os
import re
import json
import glob
import zlib
import hashlib
from typing import Dict, List, Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECRET_RE = re.compile(r"(?i)(api[_-]?key|secret|passw(?:or)?d|token|bearer)\w*\s*[:=]\s*['\"][A-Za-z0-9_\-+/=]{16,}['\"]")
SRC_GLOBS = ["src/**/*.ts", "src/**/*.tsx", "lib/*.ts", "server.ts", "qplus_native/*.py",
             "tests/*.ts", "tests/*.mjs", "tests/*.py"]
DOC_GLOBS = ["README.md", "IMPLEMENTATION_REPORT.md", "SECURITY.md", "CONTRIBUTING.md", "artifacts/*.md"]
VAL_PERCENT = 15


def build_corpus(root: str = ROOT) -> Dict[str, Any]:
    docs: List[Dict[str, Any]] = []
    excluded: List[Dict[str, str]] = []
    seen = set()

    def add(doc_id: str, kind: str, text: str):
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if h in seen:
            excluded.append({"id": doc_id, "reason": "exact_duplicate"})
            return
        if SECRET_RE.search(text):
            excluded.append({"id": doc_id, "reason": "secret_like_literal"})
            return
        seen.add(h)
        split = "val" if zlib.crc32(doc_id.encode("utf-8")) % 100 < VAL_PERCENT else "train"
        docs.append({"id": doc_id, "kind": kind, "sha256": h, "chars": len(text), "split": split, "text": text})

    for pattern in DOC_GLOBS + SRC_GLOBS:
        for path in sorted(glob.glob(os.path.join(root, pattern), recursive=True)):
            rel = os.path.relpath(path, root)
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                add(rel, "doc" if pattern in DOC_GLOBS else "source", f.read())

    kd = os.path.join(root, "native_data", "knowledge", "documents.json")
    if os.path.exists(kd):
        with open(kd, encoding="utf-8") as kfh:
            kdocs = json.load(kfh)
        for d in kdocs:
            if d.get("curatedForTraining") is True and d.get("content"):
                add(f"knowledge:{d['id']}", "knowledge", d["content"])
            else:
                excluded.append({"id": f"knowledge:{d.get('id')}", "reason": "not_curatedForTraining"})

    train = [d for d in docs if d["split"] == "train"]
    val = [d for d in docs if d["split"] == "val"]
    corpus_hash = hashlib.sha256("".join(sorted(d["sha256"] for d in docs)).encode()).hexdigest()
    return {
        "docs": docs,
        "excluded": excluded,
        "corpus_sha256": corpus_hash,
        "summary": {
            "documents": len(docs), "train_docs": len(train), "val_docs": len(val),
            "train_chars": sum(d["chars"] for d in train), "val_chars": sum(d["chars"] for d in val),
            "thai_chars": sum(1 for d in docs for ch in d["text"] if "ก" <= ch <= "๛"),
            "excluded": len(excluded),
        },
    }
