#!/usr/bin/env python3
"""ZYNTHEOR R1 - Safe iApp Streaming Pipeline (v1)."""
import json
import hashlib
from pathlib import Path
from datasets import load_dataset

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "native_data/r1_external_data_v1" 
OUT_DIR.mkdir(parents=True, exist_ok=True)

MAX_RECORDS = 2000 

def get_sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def process_iapp_streaming(split_name, max_records=MAX_RECORDS):
    print(f"Streaming iapp/iapp_wiki_qa_squad ({split_name})...")
    try:
        # Use streaming=True to avoid downloading the whole dataset
        ds = load_dataset("iapp/iapp_wiki_qa_squad", split=split_name, streaming=True)
    except Exception as e:
        print(f"Failed to load: {e}")
        return []

    records = []
    skipped_invalid = 0
    
    for idx, row in enumerate(ds):
        if len(records) >= max_records:
            break
            
        context = row.get("context", "").strip()
        question = row.get("question", "").strip()
        answers = row.get("answers", {})
        texts = answers.get("text", [])
        starts = answers.get("answer_start", [])

        if not texts or not starts:
            skipped_invalid += 1
            continue
            
        answer_text = texts[0]
        answer_start = starts[0]

        # Verify answer span matches context
        if context[answer_start:answer_start+len(answer_text)] != answer_text:
            skipped_invalid += 1
            continue

        record = {
            "id": f"r1_iapp_{split_name}_{idx}",
            "language": "th",
            "task_type": "contextual_question_answering",
            "instruction": "Answer the question using the supplied context.",
            "input": f"Context: {context}\nQuestion: {question}",
            "output": answer_text,
            "source_dataset": "iapp/iapp_wiki_qa_squad",
            "source_record_id": str(idx),
            "license": "MIT", 
            "original_split": split_name,
            "quality_status": "PENDING_REVIEW",
            "sha256": get_sha256(context + question)
        }
        records.append(record)

    print(f" -> Kept {len(records)} records. Skipped {skipped_invalid} invalid.")
    return records

def main():
    print("Starting Safe iApp Streaming Pipeline...")
    train_data = process_iapp_streaming("train", max_records=1500)
    val_data = process_iapp_streaming("validation", max_records=250)
    test_data = process_iapp_streaming("test", max_records=250)

    if not train_data:
        print("ERROR: No training data extracted. Aborting.")
        return

    for split, data in [("train", train_data), ("validation", val_data), ("test", test_data)]:
        if not data: continue
        filepath = OUT_DIR / f"iapp_{split}.jsonl"
        with open(filepath, "w", encoding="utf-8") as f:
            for item in data:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
        print(f"Saved: {filepath}")

    print("\nPipeline Complete! Safe to proceed.")

if __name__ == "__main__":
    main()
