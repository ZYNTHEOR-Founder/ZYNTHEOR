#!/usr/bin/env python3
"""ZYNTHEOR R1 - External QA Dataset Pipeline (Limited size to prevent disk full)."""
import json
import hashlib
import datetime
from pathlib import Path
from datasets import load_dataset

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "native_data/r1_external_data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ลิมิตจำนวนข้อมูลเพื่อไม่ให้พื้นที่เต็ม (เพียงพอสำหรับการเทรนโมเดล 41.5M)
MAX_RECORDS_PER_DATASET = 2000 

def get_sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def save_jsonl(filepath, data):
    with open(filepath, "w", encoding="utf-8") as f:
        for item in data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

def process_dataset(ds_name, config, split_name, lang, filter_thai=False, max_records=MAX_RECORDS_PER_DATASET):
    print(f"Loading {ds_name} ({split_name})...")
    try:
        if config:
            ds = load_dataset(ds_name, config, split=split_name)
        else:
            ds = load_dataset(ds_name, split=split_name)
    except Exception as e:
        print(f"Failed to load {ds_name} {split_name}: {e}")
        return []

    records = []
    for idx, row in enumerate(ds):
        if len(records) >= max_records:
            break

        if filter_thai:
            row_lang = row.get("language", "")
            if "thai" not in row_lang.lower() and "th" not in row_lang.lower():
                continue

        if "iapp" in ds_name:
            context, question, answer = row.get("context", ""), row.get("question", ""), row.get("answer", "")
        elif "tydiqa" in ds_name:
            context = row.get("context", "")
            question = row.get("question", "")
            ans_list = row.get("answers", {}).get("text", [])
            answer = ans_list[0] if ans_list else ""
        elif "squad_v2" in ds_name:
            context, question = row.get("context", ""), row.get("question", "")
            ans_list = row.get("answers", {}).get("text", [])
            answer = ans_list[0] if ans_list else "" 
        else:
            continue

        record = {
            "id": f"r1_{split_name}_{idx}",
            "language": lang,
            "task_type": "contextual_question_answering",
            "instruction": "Answer the question using the supplied context.",
            "input": f"Context: {context}\nQuestion: {question}",
            "output": answer,
            "source_dataset": ds_name,
            "source_record_id": str(idx),
            "license": "MIT" if "iapp" in ds_name else ("CC BY-SA 4.0" if "squad" in ds_name else "Apache 2.0"),
            "original_split": split_name,
            "quality_status": "PENDING_REVIEW",
            "sha256": get_sha256(context + question)
        }
        records.append(record)
    return records

def main():
    print("Starting R1 External Data Pipeline (Limited Size)...")
    
    train_iapp = process_dataset("iapp/iapp_wiki_qa_squad", None, "train", "th")
    val_iapp = process_dataset("iapp/iapp_wiki_qa_squad", None, "validation", "th")
    test_iapp = process_dataset("iapp/iapp_wiki_qa_squad", None, "test", "th")
    
    train_tydi = process_dataset("google-research-datasets/tydiqa", "primary_task", "train", "th", filter_thai=True)
    
    train_squad = process_dataset("squad_v2", None, "train", "en")
    val_squad = process_dataset("squad_v2", None, "validation", "en")

    all_train = train_iapp + train_tydi + train_squad
    all_val = val_iapp + val_squad
    all_test = test_iapp

    save_jsonl(OUT_DIR / "train.jsonl", all_train)
    save_jsonl(OUT_DIR / "validation.jsonl", all_val)
    save_jsonl(OUT_DIR / "test.jsonl", all_test)

    manifest = {
        "created_at": datetime.datetime.now().isoformat(),
        "sources": ["iapp/iapp_wiki_qa_squad", "google-research-datasets/tydiqa", "squad_v2"],
        "counts": {
            "train": len(all_train),
            "validation": len(all_val),
            "test": len(all_test)
        }
    }
    with open(OUT_DIR / "dataset_manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print("\nPipeline Complete!")
    print(f"Train: {len(all_train)} | Val: {len(all_val)} | Test: {len(all_test)}")
    print(f"Data saved in: {OUT_DIR}")

if __name__ == "__main__":
    main()
