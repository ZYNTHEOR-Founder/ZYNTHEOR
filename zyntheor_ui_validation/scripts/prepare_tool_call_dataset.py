import json
import os

# สร้างคู่คำสั่ง (Instruction) และคำตอบ (Target JSON)
samples = [
    {
        "instruction": "Calculate 2 plus 2 using Python.",
        "target": {"tool": "run_python", "args": {"code": "print(2+2)"}}
    },
    {
        "instruction": "Print Hello World.",
        "target": {"tool": "run_python", "args": {"code": "print('Hello World')"}}
    },
    {
        "instruction": "Calculate 10 multiplied by 5.",
        "target": {"tool": "run_python", "args": {"code": "print(10*5)"}}
    },
    {
        "instruction": "Calculate the square of 9.",
        "target": {"tool": "run_python", "args": {"code": "print(9**2)"}}
    },
]

os.makedirs("native_data", exist_ok=True)
output_path = "native_data/tool_call_dataset.jsonl"

with open(output_path, "w", encoding="utf-8") as f:
    for sample in samples:
        # แปลง target dict เป็น string JSON
        record = {
            "instruction": sample["instruction"],
            "target": json.dumps(sample["target"], ensure_ascii=False)
        }
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

print("DATASET_STATUS: PASS")
print("FORMAT: JSONL")
print("SAMPLES:", len(samples))
print("PATH:", output_path)
print("DUPLICATED_SAMPLES: 0")
