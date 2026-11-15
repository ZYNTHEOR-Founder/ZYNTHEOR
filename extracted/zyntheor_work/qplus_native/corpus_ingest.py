# -*- coding: utf-8 -*-
"""
Provenance-first corpus ingestion with leakage-safe train / val / test splits (manifest v3).

Why this exists: the current corpus is project source plus ~9k Thai characters, and the only
held-out data (val) has already been used for model selection. Before any real Thai/English data
is added it needs (a) provenance and license on every document, (b) no near-duplicate text across
splits, and (c) a TEST split that nothing selects against.

Input directory layout
  <root>/SOURCES.json   list of rules, first match wins, fnmatch on the relative posix path:
       [{"glob": "wiki/*.txt", "source": "th.wikipedia", "license": "CC-BY-SA-4.0",
         "url": "https://...", "language": "th"},
        {"glob": "private/*", "exclude": true}]
  <root>/**/*.txt|md|jsonl   (jsonl: one {"text": ...} object per line; each line is one document)

Fail-closed rules: no matching rule, empty/unknown license, secret-like literal, e-mail address,
too short, high replacement-character ratio -> excluded with a recorded reason.

  python3 qplus_native/corpus_ingest.py --root /path/to/corpus --out artifacts/corpus-manifest-v3.json
"""
import os
import re
import json
import time
import zlib
import fnmatch
import hashlib
import argparse
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECRET_RE = re.compile(r"(?i)(api[_-]?key|secret|passw(?:or)?d|token|bearer)\w*\s*[:=]\s*['\"][A-Za-z0-9_\-+/=]{16,}['\"]")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​‌‍﻿]")
BAD_LICENSES = {"", "unknown", "none", "n/a", "tbd"}
TEXT_EXT = (".txt", ".md", ".jsonl")
TEST_ACCESS_LOG = os.path.join(ROOT, "artifacts", "test-split-access.json")


def normalize_text(t: str) -> str:
    t = unicodedata.normalize("NFC", t)
    t = CTRL_RE.sub("", t)
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def is_thai(ch: str) -> bool:
    return "ก" <= ch <= "๛"


# ------------------------------------------------------------------ near-duplicate clustering
_P = (1 << 61) - 1
_rng = np.random.default_rng(20261113)
_A = _rng.integers(1, _P, 32, dtype=np.uint64)
_B = _rng.integers(0, _P, 32, dtype=np.uint64)


def minhash(text: str, k: int = 8) -> np.ndarray:
    s = text if len(text) >= k else text + " " * (k - len(text))
    sh = np.unique(np.array([zlib.crc32(s[i:i + k].encode("utf-8")) for i in range(len(s) - k + 1)], dtype=np.uint64))
    # (a*x + b) mod P kept in uint64 by reducing x first; collisions are acceptable for clustering
    return np.array([((_A[i] % np.uint64(1 << 31)) * sh + _B[i] % np.uint64(1 << 31)).min() for i in range(32)])


def cluster_near_duplicates(sigs: Dict[str, np.ndarray], threshold: float = 0.8) -> Dict[str, str]:
    parent = {k: k for k in sigs}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    buckets: Dict[Tuple[int, bytes], List[str]] = {}
    for k, s in sigs.items():
        for b in range(8):  # 8 bands x 4 rows
            buckets.setdefault((b, s[b * 4:(b + 1) * 4].tobytes()), []).append(k)
    for members in buckets.values():
        for i in range(1, len(members)):
            a, b = members[0], members[i]
            if float(np.mean(sigs[a] == sigs[b])) >= threshold:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
    return {k: find(k) for k in sigs}


def split_for(cluster_key: str, val_pct: int, test_pct: int) -> str:
    h = zlib.crc32(cluster_key.encode("utf-8")) % 100
    return "test" if h < test_pct else ("val" if h < test_pct + val_pct else "train")


# ------------------------------------------------------------------ reading
def iter_raw_docs(root: str):
    for dp, _, files in os.walk(root):
        for fn in sorted(files):
            if not fn.lower().endswith(TEXT_EXT):
                continue
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            with open(full, "r", encoding="utf-8", errors="replace") as f:
                if fn.lower().endswith(".jsonl"):
                    for n, line in enumerate(f, 1):
                        try:
                            yield f"{rel}#{n}", rel, str(json.loads(line).get("text", ""))
                        except (ValueError, AttributeError):
                            yield f"{rel}#{n}", rel, ""
                else:
                    yield rel, rel, f.read()


def read_doc_text(root: str, path: str) -> Optional[str]:
    try:
        if "#" in path:
            rel, n = path.rsplit("#", 1)
            with open(os.path.join(root, rel), "r", encoding="utf-8", errors="replace") as f:
                for i, line in enumerate(f, 1):
                    if i == int(n):
                        return normalize_text(str(json.loads(line).get("text", "")))
            return None
        with open(os.path.join(root, path), "r", encoding="utf-8", errors="replace") as f:
            return normalize_text(f.read())
    except (OSError, ValueError):
        return None


def match_rule(rules, rel: str):
    for r in rules:
        if fnmatch.fnmatch(rel, r["glob"]):
            return r
    return None


# ------------------------------------------------------------------ ingest
def ingest(root: str, val_pct: int = 5, test_pct: int = 5, min_chars: int = 200) -> Dict[str, Any]:
    sp = os.path.join(root, "SOURCES.json")
    if not os.path.exists(sp):
        raise SystemExit("FAIL_CLOSED: SOURCES.json (provenance rules) is required in the corpus root")
    with open(sp, "r", encoding="utf-8") as f:
        rules = json.load(f)
    docs, excluded, seen, sigs = [], [], {}, {}
    for doc_id, rel, raw in iter_raw_docs(root):
        rule = match_rule(rules, rel)
        if rule is None:
            excluded.append({"id": doc_id, "reason": "no_provenance_rule"}); continue
        if rule.get("exclude"):
            excluded.append({"id": doc_id, "reason": "excluded_by_rule"}); continue
        if str(rule.get("license", "")).strip().lower() in BAD_LICENSES:
            excluded.append({"id": doc_id, "reason": "missing_or_unknown_license"}); continue
        text = normalize_text(raw)
        if len(text) < min_chars:
            excluded.append({"id": doc_id, "reason": "too_short"}); continue
        if text.count("�") / len(text) > 0.01:
            excluded.append({"id": doc_id, "reason": "encoding_errors"}); continue
        if SECRET_RE.search(text):
            excluded.append({"id": doc_id, "reason": "secret_like_literal"}); continue
        if EMAIL_RE.search(text):
            excluded.append({"id": doc_id, "reason": "contains_email_address"}); continue
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if h in seen:
            excluded.append({"id": doc_id, "reason": "exact_duplicate_of:" + seen[h]}); continue
        seen[h] = doc_id
        thai = sum(1 for c in text if is_thai(c))
        docs.append({"id": doc_id, "path": doc_id, "source": rule.get("source"), "license": rule["license"],
                     "url": rule.get("url"), "language": rule.get("language"), "sha256": h, "chars": len(text),
                     "thai_chars": thai, "thai_ratio": round(thai / len(text), 4)})
        sigs[doc_id] = minhash(text)
    clusters = cluster_near_duplicates(sigs)
    for d in docs:
        d["cluster"] = clusters[d["id"]]
        d["split"] = split_for(d["cluster"], val_pct, test_pct)  # whole clusters stay in ONE split
    summary = {s: {"docs": sum(1 for d in docs if d["split"] == s),
                   "chars": sum(d["chars"] for d in docs if d["split"] == s),
                   "thai_chars": sum(d["thai_chars"] for d in docs if d["split"] == s)} for s in ("train", "val", "test")}
    warnings = []
    for s in ("val", "test"):
        if summary[s]["chars"] < 200_000:
            warnings.append(f"{s} split has only {summary[s]['chars']} chars: too small for a reliable estimate")
        if summary[s]["thai_chars"] < 50_000:
            warnings.append(f"{s} split has only {summary[s]['thai_chars']} Thai chars: Thai quality cannot be measured")
    return {"version": 3, "created": int(time.time()), "corpus_root": os.path.abspath(root),
            "params": {"val_pct": val_pct, "test_pct": test_pct, "min_chars": min_chars,
                       "near_duplicate_jaccard": 0.8, "normalization": "NFC+strip control/zero-width"},
            "corpus_sha256": hashlib.sha256("".join(sorted(d["sha256"] + d["split"] for d in docs)).encode()).hexdigest(),
            "summary": summary, "warnings": warnings, "docs": docs, "excluded": excluded,
            "near_duplicate_clusters": sum(1 for k, v in clusters.items() if k != v)}


# ------------------------------------------------------------------ loading (v3 and legacy manifests)
def load_split_docs(manifest_path: str, corpus_root: Optional[str] = None) -> Dict[str, Any]:
    """Returns {"train": [...], "val": [...], "test": [...], "skipped": n, "manifest": {...}} with texts.
    A document whose current text no longer matches the recorded sha256 is skipped and counted."""
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    out: Dict[str, Any] = {"train": [], "val": [], "test": [], "skipped": 0, "manifest": manifest}
    if manifest.get("version") == 3:
        root = corpus_root or manifest["corpus_root"]
        for d in manifest["docs"]:
            text = read_doc_text(root, d["path"])
            if text is None or hashlib.sha256(text.encode("utf-8")).hexdigest() != d["sha256"]:
                out["skipped"] += 1
                continue
            out[d["split"]].append({**d, "text": text})
        return out
    from qplus_native.corpus import build_corpus  # legacy project-source manifest
    current = {d["id"]: d for d in build_corpus()["docs"]}
    for m in manifest["docs"]:
        cur = current.get(m["id"])
        if cur is None or cur["sha256"] != m["sha256"]:
            out["skipped"] += 1
        else:
            out[m["split"]].append(cur)
    return out


def log_test_access(purpose: str, checkpoint_sha256: str) -> int:
    """The TEST split must be touched rarely. Every access is recorded; the count is visible in reports."""
    if os.path.exists(TEST_ACCESS_LOG):
        with open(TEST_ACCESS_LOG, "r", encoding="utf-8") as f:
            log = json.load(f)
    else:
        log = {"accesses": []}
    log["accesses"].append({"timestamp": int(time.time()), "purpose": purpose, "checkpoint_sha256": checkpoint_sha256})
    os.makedirs(os.path.dirname(TEST_ACCESS_LOG), exist_ok=True)
    with open(TEST_ACCESS_LOG, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2)
    return len(log["accesses"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts", "corpus-manifest-v3.json"))
    ap.add_argument("--val-pct", type=int, default=5)
    ap.add_argument("--test-pct", type=int, default=5)
    ap.add_argument("--min-chars", type=int, default=200)
    a = ap.parse_args()
    if not (0 < a.val_pct <= 30 and 0 < a.test_pct <= 30):
        raise SystemExit("val/test percentages must be within (0, 30]")
    m = ingest(a.root, a.val_pct, a.test_pct, a.min_chars)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=1, ensure_ascii=False)
    print(json.dumps({"summary": m["summary"], "excluded": len(m["excluded"]), "near_duplicate_clusters": m["near_duplicate_clusters"],
                      "warnings": m["warnings"], "corpus_sha256": m["corpus_sha256"]}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
