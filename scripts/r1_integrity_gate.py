#!/usr/bin/env python3
"""ZYNTHEOR R1 - Pre-Training Integrity Gate."""
import json
import hashlib
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))  # <-- เพิ่มบรรทัดนี้เพื่อให้ Python หา qplus_native เจอ

DATA_DIR = ROOT / "native_data/r1_external_data_v1"
OUT_DIR = ROOT / "artifacts/r1_integrity_gate"
OUT_DIR.mkdir(parents=True, exist_ok=True)

FILES = {
    "train": DATA_DIR / "iapp_train.jsonl",
    "validation": DATA_DIR / "iapp_validation.jsonl",
    "test": DATA_DIR / "iapp_test.jsonl"
}
EXPECTED_COUNTS = {"train": 1499, "validation": 250, "test": 250} # อัปเดตเป็น 1499 เพราะลบไป 1
R0_CHECKPOINT = ROOT / "native_data/model_checkpoint_target_41m_step5800.pt"

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def normalize_text(text):
    return " ".join(text.lower().split())

def main():
    report = {"status": "PASS", "checks": {}, "errors": []}
    hashes = {}
    
    print("Starting R1 Integrity Gate checks...")

    for split, path in FILES.items():
        if not path.exists():
            report["errors"].append(f"Missing file: {path}")
            report["status"] = "BLOCKED"
            continue
            
        hashes[split] = sha256_file(path)
        valid_count = 0
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip(): valid_count += 1
                
        if valid_count != EXPECTED_COUNTS[split]:
            report["errors"].append(f"{split} count mismatch: expected {EXPECTED_COUNTS[split]}, got {valid_count}")
            report["status"] = "BLOCKED"

    train_inputs = set()
    duplicates = 0
    leakage = 0

    for split, path in FILES.items():
        if not path.exists(): continue
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip(): continue
                row = json.loads(line)
                norm_inp = normalize_text(row.get("input", ""))
                
                if split == "train":
                    if norm_inp in train_inputs: duplicates += 1
                    train_inputs.add(norm_inp)
                else:
                    if norm_inp in train_inputs: leakage += 1

    if duplicates > 0: report["errors"].append(f"Found {duplicates} duplicates in train")
    if leakage > 0: report["errors"].append(f"Found {leakage} leakage records from val/test")

    span_errors = 0
    with open(FILES["train"], "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            row = json.loads(line)
            inp, out = row.get("input", ""), row.get("output", "")
            if out and out not in inp:
                span_errors += 1
    if span_errors > 0: report["errors"].append(f"Found {span_errors} records where output is not in input context")

    try:
        from qplus_native.tokenizer import SovereignTokenizer
        tok = SovereignTokenizer(vocab_size=16384, profile="v2_base")
        tok.encode("ทดสอบระบบ Tokenizer")
        report["checks"]["tokenizer"] = "PASS"
    except Exception as e:
        report["errors"].append(f"Tokenizer failed: {str(e)}")
        report["checks"]["tokenizer"] = "FAIL"

    if R0_CHECKPOINT.exists():
        report["checks"]["r0_checkpoint"] = "PASS"
        hashes["r0_checkpoint"] = sha256_file(R0_CHECKPOINT)
    else:
        report["errors"].append("R0 Checkpoint missing")
        report["checks"]["r0_checkpoint"] = "FAIL"

    total, used, free = shutil.disk_usage("/")
    free_mb = free // (2**20)
    if free_mb < 500:
        report["errors"].append(f"Low disk space: {free_mb}MB available")
    report["checks"]["disk_space"] = f"{free_mb} MB free"

    if report["errors"]:
        report["status"] = "BLOCKED"

    with open(OUT_DIR / "integrity_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    with open(OUT_DIR / "sha256_manifest.json", "w", encoding="utf-8") as f:
        json.dump(hashes, f, indent=2)

    print("\n===== INTEGRITY GATE RESULTS =====")
    print(f"STATUS: {report['status']}")
    print(f"Tokenizer: {report['checks'].get('tokenizer', 'UNKNOWN')}")
    print(f"Disk Space: {report['checks'].get('disk_space', 'UNKNOWN')}")
    print(f"Duplicates in Train: {duplicates}")
    print(f"Leakage from Val/Test: {leakage}")
    print(f"Answer Span Errors: {span_errors}")
    
    if report["errors"]:
        print("\nERRORS FOUND:")
        for err in report["errors"]:
            print(f" - {err}")
    else:
        print("\nALL GATES PASSED. Ready for Human Review & Training Approval.")
        
    print(f"\nReports saved to: {OUT_DIR}")

if __name__ == "__main__":
    main()
