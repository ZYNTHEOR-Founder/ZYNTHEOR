# -*- coding: utf-8 -*-
"""
Bilingual Thai-English Corpus Builder for ZYNTHEOR Batch 4.

Provenance, Licensing & Anti-Leakage Rules:
  1. First-party curated Thai/English bilingual dataset (`native_data/datasets/bilingual_th_en_v4.jsonl`),
     explicitly tagged with source + license (`CC0-1.0`).
  2. Curated project documentation & `curatedForTraining: true` knowledge records from `qplus_native.corpus`,
     strictly filtered by SECRET_RE and SHA-256 exact deduplication.
  3. Deterministic document-level train/validation split via crc32(doc_id) % 100 < 15.
  4. Emits `artifacts/bilingual-corpus-manifest.json` with full language, license, provenance,
     deduplication, and exclusion telemetry.
"""

import os
import json
import zlib
import hashlib
from typing import Dict, List, Any, Optional

from qplus_native.corpus import ROOT, SECRET_RE, build_corpus as build_project_corpus

BILINGUAL_DATASET_PATH = os.path.join(ROOT, "native_data", "datasets", "bilingual_th_en_v4.jsonl")
BILINGUAL_MANIFEST_PATH = os.path.join(ROOT, "artifacts", "bilingual-corpus-manifest.json")
VAL_PERCENT = 15


def _count_thai_chars(text: str) -> int:
    return sum(1 for ch in text if "\u0e01" <= ch <= "\u0e5b")


def _count_ascii_letters(text: str) -> int:
    return sum(1 for ch in text if ("a" <= ch <= "z") or ("A" <= ch <= "Z"))


def build_bilingual_corpus(
    root: str = ROOT,
    dataset_path: str = BILINGUAL_DATASET_PATH,
    include_project_corpus: bool = True,
    write_manifest: bool = False,
    manifest_path: str = BILINGUAL_MANIFEST_PATH,
) -> Dict[str, Any]:
    docs: List[Dict[str, Any]] = []
    excluded: List[Dict[str, str]] = []
    seen_hashes = set()

    def _add_doc(
        doc_id: str,
        kind: str,
        text: str,
        language: str,
        source: str,
        license_id: str,
        domain: str = "general",
        forced_split: Optional[str] = None,
    ):
        clean_text = text.strip()
        if not clean_text:
            excluded.append({"id": doc_id, "reason": "empty_text"})
            return
        h = hashlib.sha256(clean_text.encode("utf-8")).hexdigest()
        if h in seen_hashes:
            excluded.append({"id": doc_id, "reason": "exact_duplicate"})
            return
        if SECRET_RE.search(clean_text):
            excluded.append({"id": doc_id, "reason": "secret_like_literal"})
            return
        seen_hashes.add(h)
        split = forced_split or ("val" if zlib.crc32(doc_id.encode("utf-8")) % 100 < VAL_PERCENT else "train")
        th_chars = _count_thai_chars(clean_text)
        en_chars = _count_ascii_letters(clean_text)
        docs.append({
            "id": doc_id,
            "kind": kind,
            "domain": domain,
            "language": language,
            "source": source,
            "license": license_id,
            "sha256": h,
            "chars": len(clean_text),
            "thai_chars": th_chars,
            "ascii_letters": en_chars,
            "split": split,
            "text": clean_text,
        })

    # 1. Load first-party bilingual JSONL dataset
    if os.path.exists(dataset_path):
        with open(dataset_path, "r", encoding="utf-8") as f:
            for line_num, raw_line in enumerate(f, start=1):
                line = raw_line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                _add_doc(
                    doc_id=str(rec.get("id") or f"bilingual_line_{line_num}"),
                    kind="bilingual_dataset",
                    text=str(rec.get("text", "")),
                    language=str(rec.get("language", "th-en")),
                    source=str(rec.get("source", "ZYNTHEOR First-Party Thai Corpus")),
                    license_id=str(rec.get("license", "CC0-1.0")),
                    domain=str(rec.get("domain", "general")),
                )

    # 2. Merge audited project docs & curated knowledge (preserving split + exclusions)
    if include_project_corpus:
        proj = build_project_corpus(root=root)
        excluded.extend(proj["excluded"])
        for d in proj["docs"]:
            th_c = _count_thai_chars(d["text"])
            en_c = _count_ascii_letters(d["text"])
            lang = "th-en" if th_c > 20 and en_c > 20 else ("th" if th_c > en_c else "en")
            _add_doc(
                doc_id=d["id"],
                kind=d["kind"],
                text=d["text"],
                language=lang,
                source="ZYNTHEOR Repository Audited Source/Docs",
                license_id="First-Party / Project License",
                domain=d["kind"],
                forced_split=d["split"],
            )

    train_docs = [d for d in docs if d["split"] == "train"]
    val_docs = [d for d in docs if d["split"] == "val"]
    total_chars = sum(d["chars"] for d in docs)
    total_thai = sum(d["thai_chars"] for d in docs)
    bilingual_docs = [d for d in docs if d["kind"] == "bilingual_dataset"]

    by_language: Dict[str, Dict[str, int]] = {}
    by_license: Dict[str, int] = {}
    by_source: Dict[str, int] = {}
    for d in docs:
        l_entry = by_language.setdefault(d["language"], {"docs": 0, "chars": 0, "thai_chars": 0})
        l_entry["docs"] += 1
        l_entry["chars"] += d["chars"]
        l_entry["thai_chars"] += d["thai_chars"]
        by_license[d["license"]] = by_license.get(d["license"], 0) + 1
        by_source[d["source"]] = by_source.get(d["source"], 0) + 1

    corpus_hash = hashlib.sha256("".join(sorted(d["sha256"] for d in docs)).encode("utf-8")).hexdigest()
    summary = {
        "documents": len(docs),
        "bilingual_dataset_docs": len(bilingual_docs),
        "bilingual_train_docs": sum(1 for d in bilingual_docs if d["split"] == "train"),
        "bilingual_val_docs": sum(1 for d in bilingual_docs if d["split"] == "val"),
        "train_docs": len(train_docs),
        "val_docs": len(val_docs),
        "total_chars": total_chars,
        "train_chars": sum(d["chars"] for d in train_docs),
        "val_chars": sum(d["chars"] for d in val_docs),
        "thai_chars": total_thai,
        "bilingual_dataset_thai_chars": sum(d["thai_chars"] for d in bilingual_docs),
        "thai_ratio_pct": round((total_thai / max(1, total_chars)) * 100.0, 2),
        "excluded": len(excluded),
        "by_language": by_language,
        "licenses": by_license,
        "provenance_sources": by_source,
    }

    manifest = {
        "corpus_sha256": corpus_hash,
        "split_rule": f"crc32(doc_id) % 100 < {VAL_PERCENT} -> val (whole-document isolation)",
        "summary": summary,
        "excluded": excluded,
        "docs": [
            {k: d[k] for k in ("id", "kind", "domain", "language", "source", "license", "sha256", "split", "chars", "thai_chars")}
            for d in docs
        ],
    }

    if write_manifest:
        os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
        with open(manifest_path, "w", encoding="utf-8") as mf:
            json.dump(manifest, mf, indent=2, ensure_ascii=False)

    return {
        "docs": docs,
        "excluded": excluded,
        "corpus_sha256": corpus_hash,
        "summary": summary,
        "manifest": manifest,
    }


if __name__ == "__main__":
    res = build_bilingual_corpus(write_manifest=True)
    print(json.dumps(res["summary"], indent=2, ensure_ascii=False))
