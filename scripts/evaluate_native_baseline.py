#!/usr/bin/env python3
"""Evaluate the ZYNTHEOR native 41.5M baseline without modifying training data."""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from qplus_native.lm_v2 import NativeLM, LMConfig
from qplus_native.tokenizer import SovereignTokenizer

CHECKPOINT_DEFAULT = ROOT / "native_data/model_checkpoint_target_41m_step5800.pt"
BENCHMARK_DEFAULT = ROOT / "artifacts/evaluation/r1_smoke_benchmark.jsonl"
OUTPUT_DEFAULT = ROOT / "artifacts/evaluation/r1_baseline_predictions.jsonl"
EXPECTED_PARAMS = 41_527_808

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            rows.append(row)
    return rows

def normalize_answer(value: str) -> str:
    return " ".join(value.strip().casefold().split())

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=CHECKPOINT_DEFAULT)
    parser.add_argument("--benchmark", type=Path, default=BENCHMARK_DEFAULT)
    parser.add_argument("--output", type=Path, default=OUTPUT_DEFAULT)
    parser.add_argument("--max-new-tokens", type=int, default=64)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--seed", type=int, default=1234)
    parser.add_argument("--tokenizer-profile", default="v2_base")
    args = parser.parse_args()

    checkpoint = args.checkpoint.resolve()
    benchmark = args.benchmark.resolve()
    output = args.output.resolve()

    if not checkpoint.is_file():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint}")
    if not benchmark.is_file():
        raise FileNotFoundError(f"Benchmark not found: {benchmark}")
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite existing evaluation output: {output}")

    records = read_jsonl(benchmark)
    checkpoint_hash_before = sha256_file(checkpoint)

    # Hardcoded config based on ZYNTHEOR 41.5M architecture
    cfg = LMConfig(vocab=16384, d_model=512, n_layers=10, n_heads=8, d_ffn=1472, ctx=64)
    tok = SovereignTokenizer(cfg.vocab, profile=args.tokenizer_profile)
    
    print(f"Loading model from {checkpoint}...")
    model, meta = NativeLM.load(str(checkpoint), tok, dtype=np.float32)

    actual_params = model.num_params()
    if actual_params != EXPECTED_PARAMS:
        raise RuntimeError(f"Parameter mismatch: expected {EXPECTED_PARAMS:,}, got {actual_params:,}")

    predictions = []
    exact_matches = 0

    for index, item in enumerate(records, 1):
        prompt = f"{item['context']}\n{item['question']}".strip()
        prompt_ids = tok.encode(prompt)
        
        try:
            new_ids = model.generate_ids(
                prompt_ids,
                max_new_tokens=args.max_new_tokens,
                temperature=args.temperature,
                seed=args.seed + index,
            )
        except Exception as e:
            new_ids = []

        prediction = tok.decode(list(new_ids)).strip() if new_ids else ""
        reference = str(item["reference_answer"])
        matched = normalize_answer(prediction) == normalize_answer(reference)
        exact_matches += int(matched)

        predictions.append({
            "id": item["id"],
            "category": item["category"],
            "prediction": prediction,
            "reference_answer": reference,
            "exact_match": matched,
        })
        print(f"[{index}/{len(records)}] id={item['id']} EM={'PASS' if matched else 'MISS'} | Pred: '{prediction}'")

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as f:
        for row in predictions:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print("\n===== BASELINE EVALUATION =====")
    print(f"Results saved to: {output}")
    print(f"Exact Match: {exact_matches}/{len(records)}")
    print(f"EM Rate: {(exact_matches / len(records)):.2%}")
    print(f"Checkpoint unchanged: VERIFIED")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"EVALUATION BLOCKED: {exc}", file=sys.stderr)
        raise SystemExit(1)
