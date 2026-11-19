#!/usr/bin/env python3
"""ZYNTHEOR R1 — Instruction Data Preparation & Classification."""
import json
import hashlib
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN_DIR = ROOT / "native_data/datasets"
OUT_DIR = ROOT / "artifacts/r1_candidates"
OUT_DIR.mkdir(parents=True, exist_ok=True)

INPUT_FILES = {
    "train": IN_DIR / "train.jsonl",
    "validation": IN_DIR / "validation.jsonl",
    "test": IN_DIR / "test.jsonl"
}

def get_sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def classify_text(text):
    text = text.strip()
    if not text:
        return "empty"
    
    # Simple heuristic for code (contains code-like characters)
    if re.search(r'(def |class |import |function |\{\s*$|\};)', text):
        return "code"
    
    # Check for question marks
    if "?" in text or "?" in text:
        # Very basic check: if there's a question mark, it might be QA or instruction
        return "instruction_or_qa"
    
    return "knowledge_text"

def process_file(split_name, filepath):
    instructions = []
    knowledge = []
    needs_review = []
    report = {"total": 0, "instruction": 0, "knowledge": 0, "review": 0}

    if not filepath.exists():
        return instructions, knowledge, needs_review, report

    with open(filepath, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip(): continue
            report["total"] += 1
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                needs_review.append({"error": "Invalid JSON", "raw": line, "split": split_name})
                report["review"] += 1
                continue

            text = row.get("text", "").strip()
            source = row.get("source", "unknown")
            license_val = row.get("license", "unknown")
            orig_id = row.get("id", f"{split_name}_{line_num}")
            
            category = classify_text(text)
            
            # Base metadata for all outputs
            meta = {
                "original_id": orig_id,
                "original_sha256": get_sha256(text),
                "source": source,
                "license": license_val,
                "original_split": split_name
            }

            if category == "empty":
                needs_review.append({**meta, "reason": "Empty text", "text": text})
                report["review"] += 1
            elif category in ["instruction_or_qa"]:
                # Since we CANNOT generate QA, we put the raw text as the instruction
                # and leave output empty for human review to split.
                inst_rec = {
                    "id": f"r1_{split_name}_{line_num}",
                    "task_type": "needs_qa_extraction",
                    "language": row.get("language", "unknown"),
                    "domain": row.get("domain", "unknown"),
                    "instruction": text, # Raw text goes here for human to format
                    "input": "",
                    "output": "", 
                    "quality_status": "PENDING_REVIEW",
                    **meta
                }
                instructions.append(inst_rec)
                report["instruction"] += 1
            elif category == "code":
                 needs_review.append({**meta, "reason": "Code detected", "text": text})
                 report["review"] += 1
            else:
                # Knowledge text
                know_rec = {
                    "id": f"r1_know_{split_name}_{line_num}",
                    "text": text,
                    "quality_status": "PENDING_REVIEW",
                    **meta
                }
                knowledge.append(know_rec)
                report["knowledge"] += 1

    return instructions, knowledge, needs_review, report

def write_jsonl(filepath, data):
    if not data: return
    with open(filepath, "w", encoding="utf-8") as f:
        for item in data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

def main():
    print("Starting R1 Data Preparation...")
    all_reports = {}
    
    for split, path in INPUT_FILES.items():
        print(f"Processing {split}...")
        inst, know, rev, rep = process_file(split, path)
        all_reports[split] = rep
        
        write_jsonl(OUT_DIR / f"{split}_instruction.jsonl", inst)
        # We append knowledge and review across splits to single files
        if split == "train":
            all_knowledge = know
            all_review = rev
        else:
            all_knowledge.extend(know)
            all_review.extend(rev)

    write_jsonl(OUT_DIR / "knowledge_candidates.jsonl", all_knowledge)
    write_jsonl(OUT_DIR / "needs_review.jsonl", all_review)

    # Save report
    with open(OUT_DIR / "preparation_report.json", "w", encoding="utf-8") as f:
        json.dump(all_reports, f, ensure_ascii=False, indent=2)

    print(f"\nDone! Candidates saved to {OUT_DIR}")
    print("Summary:")
    for split, rep in all_reports.items():
        print(f" - {split}: Total {rep['total']} | Inst/QA {rep['instruction']} | Knowledge {rep['knowledge']} | Review {rep['review']}")

if __name__ == "__main__":
    main()
