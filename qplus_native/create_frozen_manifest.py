#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Create a reproducible corpus manifest without fabricating a SHA-256 value.

The script uses the canonical qplus_native.corpus.build_corpus() rules. It writes
only a manifest derived from real source files, then verifies the computed hash
against the expected checkpoint hash. If the snapshot is not exact, it exits
non-zero and does not claim success.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

EXPECTED_SHA256 = "3127a77dafa1dd6e36be9af8fc2794ac044f8d520774ab4a7f5e20113a2dbe1b"
EXPECTED_SUMMARY = {
    "documents": 91,
    "train_docs": 74,
    "val_docs": 17,
    "train_chars": 770280,
    "val_chars": 239448,
    "thai_chars": 9449,
    "excluded": 13,
}


def canonical_manifest(corpus: dict) -> dict:
    """Remove training text and emit deterministic, provenance-only metadata."""
    docs = []
    for doc in sorted(corpus["docs"], key=lambda x: x["id"]):
        docs.append({
            "id": doc["id"],
            "kind": doc["kind"],
            "sha256": doc["sha256"],
            "chars": doc["chars"],
            "split": doc["split"],
        })
    return {
        "format": "zyntheor-frozen-corpus-manifest-v1",
        "hash_algorithm": "sha256",
        "corpus_sha256": corpus["corpus_sha256"],
        "summary": corpus["summary"],
        "excluded": sorted(corpus.get("excluded", []), key=lambda x: (x.get("id", ""), x.get("reason", ""))),
        "docs": docs,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True,
                        help="Frozen project snapshot root used for corpus construction")
    parser.add_argument("--output", type=Path, required=True,
                        help="Output JSON manifest path")
    parser.add_argument("--expected-sha256", default=EXPECTED_SHA256)
    parser.add_argument("--snapshot-output", type=Path,
                        help="Optional full snapshot JSON including document text for later training")
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.exists():
        raise SystemExit(f"ERROR: snapshot root does not exist: {root}")

    # The script may live in /content while the project lives elsewhere.
    # Import only after --root is known, so Colab does not need PYTHONPATH setup.
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    try:
        from qplus_native.corpus import build_corpus
    except ModuleNotFoundError as exc:
        raise SystemExit(
            f"ERROR: {root} is not a project root containing qplus_native/corpus.py"
        ) from exc

    corpus = build_corpus(str(root))
    manifest = canonical_manifest(corpus)
    actual = manifest["corpus_sha256"]

    print(json.dumps({
        "root": str(root),
        "actual_corpus_sha256": actual,
        "expected_corpus_sha256": args.expected_sha256,
        "summary": manifest["summary"],
        "hash_match": actual == args.expected_sha256,
    }, ensure_ascii=False, indent=2))

    # Never write a misleading frozen manifest when the snapshot is wrong.
    if actual != args.expected_sha256:
        print("ERROR: snapshot does not match the requested checkpoint corpus; manifest not written.", file=sys.stderr)
        return 2

    if manifest["summary"] != EXPECTED_SUMMARY and args.expected_sha256 == EXPECTED_SHA256:
        print("ERROR: SHA matched but expected summary does not; refusing to write.", file=sys.stderr)
        return 3

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.snapshot_output:
        snapshot = {
            "format": "zyntheor-frozen-corpus-snapshot-v1",
            "corpus_sha256": corpus["corpus_sha256"],
            "summary": corpus["summary"],
            "excluded": corpus.get("excluded", []),
            "docs": sorted(corpus["docs"], key=lambda x: x["id"]),
        }
        args.snapshot_output.parent.mkdir(parents=True, exist_ok=True)
        args.snapshot_output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"OK: wrote verified manifest to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
