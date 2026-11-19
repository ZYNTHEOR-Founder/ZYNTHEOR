#!/usr/bin/env python3
"""Audit the new R1 External Dataset (iApp) for duplicates and leakage."""
import json
import hashlib
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "native_data/r1_external_data_v1"

FILES = {
    "train": DATA_DIR / "iapp_train.jsonl",
    "validation": DATA_DIR / "iapp_validation.jsonl",
    "test": DATA_DIR / "iapp_test.jsonl"
}

def get_sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def audit_file(filepath):
    if not filepath.exists():
        return {"status": "NOT_FOUND"}
    
    stats = {"total": 0, "empty_input": 0, "empty_output": 0, "duplicates": 0}
    hashes = set()
    all_inputs = set()
    
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            stats["total"] += 1
            row = json.loads(line)
            
            inp = row.get("input", "").strip()
            out = row.get("output", "").strip()
            
            if not inp: stats["empty_input"] += 1
            if not out: stats["empty_output"] += 1
            
            # Deduplication check based on input + output
            record_hash = get_sha256(inp + out)
            if record_hash in hashes:
                stats["duplicates"] += 1
            else:
                hashes.add(record_hash)
                
            all_inputs.add(inp)
            
    return stats, all_inputs

def main():
    print("Starting R1 External Dataset Audit (iApp)...")
    results = {}
    
    train_inputs = set()
    
    for split, path in FILES.items():
        res = audit_file(path)
        if isinstance(res, dict) and res.get("status") == "NOT_FOUND":
            print(f"File not found: {path}")
            continue
            
        stats, inputs = res
        results[split] = stats
        
        if split == "train":
            train_inputs = inputs

    # Leakage Check
    leakage = {}
    for split, path in FILES.items():
        if split in ["validation", "test"] and path.exists():
            _, inputs = audit_file(path)
            overlap = len(inputs.intersection(train_inputs))
            leakage[split] = overlap

    print("\n===== AUDIT RESULTS =====")
    for split, stats in results.items():
        print(f"[{split.upper()}]")
        print(f" - Total records: {stats['total']}")
        print(f" - Duplicates within split: {stats['duplicates']}")
        print(f" - Empty inputs: {stats['empty_input']}")
        print(f" - Empty outputs: {stats['empty_output']}")
        
    print("\n===== LEAKAGE CHECK (Overlap with Train) =====")
    for split, overlap in leakage.items():
        print(f" - {split.capitalize()} overlap: {overlap} records")

    print("\nAudit Complete. Ready for Human Review.")

if __name__ == "__main__":
    main()
