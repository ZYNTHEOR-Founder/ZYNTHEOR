#!/usr/bin/env python3
"""Read-only audit for ZYNTHEOR R1 datasets."""
import json
import hashlib
import os
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    ROOT / "native_data/datasets/train.jsonl",
    ROOT / "native_data/datasets/validation.jsonl",
    ROOT / "native_data/datasets/test.jsonl",
    ROOT / "native_data/training_pipeline/datasets/verified_dataset.jsonl"
]
OUT_DIR = ROOT / "artifacts/r1_audit"
OUT_DIR.mkdir(parents=True, exist_ok=True)

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            h.update(chunk)
    return h.hexdigest()

def is_thai(text):
    return any('\u0e00' <= char <= '\u0e7f' for char in text)

def is_english(text):
    return any('a' <= char.lower() <= 'z' for char in text)

def audit_file(filepath):
    if not filepath.exists():
        return {"status": "NOT_FOUND", "file": str(filepath)}
    
    file_hash = sha256_file(filepath)
    total_lines = 0
    invalid_json = 0
    missing_fields = 0
    empty_text = 0
    domains = Counter()
    languages = Counter()
    lengths = []
    hashes = set()
    duplicates = 0
    missing_license = 0
    missing_source = 0
    text_hashes = set()

    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            total_lines += 1
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                invalid_json += 1
                continue
            
            # Extract text (handle different keys)
            text = row.get("text", "") or row.get("output", "") or row.get("content", "")
            if not text.strip():
                empty_text += 1
            
            # Deduplication
            text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if text_hash in text_hashes:
                duplicates += 1
            else:
                text_hashes.add(text_hash)

            # Metadata
            if not row.get("license"): missing_license += 1
            if not row.get("source"): missing_source += 1
            domains[row.get("domain", "unknown")] += 1
            lengths.append(len(text))

            # Language heuristic
            th = is_thai(text)
            en = is_english(text)
            if th and en: languages["mixed"] += 1
            elif th: languages["thai"] += 1
            elif en: languages["english"] += 1
            else: languages["other"] += 1

    return {
        "status": "AUDITED",
        "file": str(filepath.relative_to(ROOT)),
        "sha256": file_hash,
        "total_lines": total_lines,
        "invalid_json": invalid_json,
        "empty_text": empty_text,
        "duplicates": duplicates,
        "missing_license": missing_license,
        "missing_source": missing_source,
        "domains": dict(domains),
        "languages": dict(languages),
        "length_stats": {
            "min": min(lengths) if lengths else 0,
            "max": max(lengths) if lengths else 0,
            "avg": sum(lengths) / len(lengths) if lengths else 0
        },
        "text_hashes": text_hashes
    }

def main():
    print("Starting R1 Dataset Audit...")
    results = {}
    all_train_hashes = set()

    for filepath in FILES:
        res = audit_file(filepath)
        results[filepath.name] = res
        
        # Save train hashes for leakage check
        if filepath.name == "train.jsonl" and "text_hashes" in res:
            all_train_hashes = res["text_hashes"]

    # Leakage Check (Val/Test overlapping with Train)
    leakage = {}
    for name, res in results.items():
        if name in ["validation.jsonl", "test.jsonl"] and "text_hashes" in res:
            overlap = len(res["text_hashes"].intersection(all_train_hashes))
            leakage[name] = overlap
            del res["text_hashes"] # Remove raw hashes before saving JSON
        elif "text_hashes" in res:
             del res["text_hashes"]

    # Save JSON Report
    report = {"files": results, "leakage_overlap_with_train": leakage}
    json_path = OUT_DIR / "dataset_audit.json"
    with open(str(json_path) + ".tmp", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    os.replace(str(json_path) + ".tmp", json_path)

    # Save TXT Report
    txt_path = OUT_DIR / "dataset_audit.txt"
    with open(str(txt_path) + ".tmp", "w", encoding="utf-8") as f:
        for name, data in results.items():
            f.write(f"=== {name} ===\n")
            if data["status"] == "NOT_FOUND":
                f.write("File not found.\n\n")
                continue
            f.write(f"Lines: {data['total_lines']} | Duplicates: {data['duplicates']} | Empty: {data['empty_text']}\n")
            f.write(f"Languages: {data['languages']}\n")
            f.write(f"Missing License: {data['missing_license']} | Missing Source: {data['missing_source']}\n\n")
        f.write(f"=== LEAKAGE CHECK ===\n{leakage}\n")
    os.replace(str(txt_path) + ".tmp", txt_path)

    print(f"Audit complete. Reports saved to {OUT_DIR}")
    print(f"Leakage check: {leakage}")

if __name__ == "__main__":
    main()
