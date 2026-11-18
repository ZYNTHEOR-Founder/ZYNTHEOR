# -*- coding: utf-8 -*-
"""Audit the reconciled target checkpoint against the canonical NativeLM graph."""
import hashlib
import json
import struct
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from qplus_native.architecture import TARGET_TOTAL_PARAMS
from qplus_native.lm_v2 import NativeLM
from qplus_native.tokenizer import SovereignTokenizer

CHECKPOINT = ROOT / "native_data" / "model_checkpoint_target_41m.pt"
OUT = ROOT / "artifacts" / "target-checkpoint-architecture-audit.json"
MAGIC = b"ZYNTHEOR_QPLUS_PT"


def read_container(path):
    raw = path.read_bytes()
    if not raw.startswith(MAGIC):
        raise RuntimeError("bad checkpoint magic")
    start = len(MAGIC)
    meta_len = struct.unpack(">I", raw[start:start + 4])[0]
    meta_start = start + 4
    meta_end = meta_start + meta_len
    meta = json.loads(raw[meta_start:meta_end].decode("utf-8"))
    payload = raw[meta_end:]
    return meta, payload


def main():
    meta, payload = read_container(CHECKPOINT)
    tok = SovereignTokenizer(16_384)
    model, loaded_meta = NativeLM.load(str(CHECKPOINT), tok)
    manifest = loaded_meta.get("tensors_manifest", [])
    expected = {name: {"shape": list(value.shape), "params": int(value.size)}
                for name, value in model.p.items()}
    actual = {entry["name"]: {"shape": entry["shape"], "params": entry["params"],
                              "dtype": entry.get("dtype"), "sha256": entry.get("sha256")}
              for entry in manifest}
    missing = sorted(set(expected) - set(actual))
    unexpected = sorted(set(actual) - set(expected))
    shape_mismatches = []
    count_mismatches = []
    for name in sorted(set(expected) & set(actual)):
        if expected[name]["shape"] != actual[name]["shape"]:
            shape_mismatches.append({"name": name, "expected": expected[name]["shape"], "actual": actual[name]["shape"]})
        if expected[name]["params"] != actual[name]["params"]:
            count_mismatches.append({"name": name, "expected": expected[name]["params"], "actual": actual[name]["params"]})

    unique_params = sum(item["params"] for item in expected.values())
    state_dict_entries = unique_params
    duplicate_tied_params = 0
    # NativeLM implements a tied output head by reusing tok_emb.T; no lm_head tensor is stored.
    tied = {"enabled": True, "input": "tok_emb", "output": "tok_emb.T", "duplicate_params": 0}
    payload_sha = hashlib.sha256(payload).hexdigest()
    report = {
        "checkpoint": str(CHECKPOINT),
        "checkpoint_sha256": payload_sha,
        "metadata_sha256": meta.get("sha256"),
        "sha256_match": payload_sha == meta.get("sha256"),
        "config": loaded_meta.get("config"),
        "manifest_tensor_count": len(manifest),
        "model_tensor_count": len(expected),
        "missing_tensors": missing,
        "unexpected_tensors": unexpected,
        "shape_mismatches": shape_mismatches,
        "count_mismatches": count_mismatches,
        "unique_parameters": unique_params,
        "state_dict_entries_parameters": state_dict_entries,
        "tied_embedding": tied,
        "metadata_total_params": loaded_meta.get("total_params"),
        "metadata_target_params": loaded_meta.get("target_total_params"),
        "canonical_target_params": TARGET_TOTAL_PARAMS,
        "payload_float32_count": len(payload) // 4,
        "positional_embedding": {"present": "pos_emb" in expected,
                                 "shape": expected.get("pos_emb", {}).get("shape"),
                                 "params": expected.get("pos_emb", {}).get("params", 0)},
        "reconciliation": {
            "all_names_match": not missing and not unexpected,
            "all_shapes_match": not shape_mismatches,
            "all_counts_match": not count_mismatches,
            "payload_matches_model": len(payload) // 4 == unique_params,
            "target_count_matches_model": TARGET_TOTAL_PARAMS == unique_params,
            "status": "VERIFIED_ARCHITECTURE_CHECKPOINT_PAIR" if (
                not missing and not unexpected and not shape_mismatches and
                not count_mismatches and len(payload) // 4 == unique_params and
                TARGET_TOTAL_PARAMS == unique_params and payload_sha == meta.get("sha256")
            ) else "MISMATCH_REQUIRES_REVIEW",
        },
    }
    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
