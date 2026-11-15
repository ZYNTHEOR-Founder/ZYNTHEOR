# -*- coding: utf-8 -*-
"""Checkpoint-backed domain benchmark runner with fail-closed missing-data reporting."""

import hashlib
import json
import math
import os
import sys
import time
import unicodedata
from typing import Any, Dict, List

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from qplus_native.seq_lm import (  # noqa: E402
    PureSeqLM,
    tokenizer_fingerprint,
    verify_checkpoint_bundle,
)
from qplus_native.tokenizer import SovereignTokenizer  # noqa: E402


DOMAINS = (
    "reasoning",
    "learning",
    "research",
    "creation",
    "multimodal",
    "execution",
    "memory",
    "adaptive",
    "scientific_mathematical",
    "autonomous_problem_solving",
)

NOT_IMPLEMENTED = {
    "multimodal": "PureSeqLM accepts text token IDs only; image, audio, and video encoders are not part of this checkpoint.",
    "execution": "Tool execution is external to this model's forward pass and is not scored as checkpoint intelligence.",
    "memory": "Persistent memory is an external subsystem; no memory state is loaded into this checkpoint.",
    "autonomous_problem_solving": "Autonomous planning and controlled execution are not implemented by this checkpoint.",
}


def _sha256_json(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split()).casefold()


def _validate_dataset(req: Dict[str, Any]) -> Dict[str, Any]:
    splits = {}
    for field in ("train_texts", "val_texts", "test_texts"):
        texts = req.get(field)
        if not isinstance(texts, list) or len(texts) < 2 or any(
            not isinstance(text, str) or not text.strip() for text in texts
        ):
            raise ValueError(f"{field} must contain at least 2 non-empty strings")
        splits[field] = [text.strip() for text in texts]

    owners: Dict[str, str] = {}
    for split_name, texts in splits.items():
        for text in texts:
            normalized = _normalized(text)
            if normalized in owners:
                raise ValueError(
                    f"Dataset leakage: normalized sample occurs in {owners[normalized]} and {split_name}"
                )
            owners[normalized] = split_name

    dataset_payload = {
        "trainSamples": splits["train_texts"],
        "valSamples": splits["val_texts"],
        "testSamples": splits["test_texts"],
    }
    dataset_hash = _sha256_json(dataset_payload)
    if req.get("dataset_sha256") != dataset_hash:
        raise ValueError("dataset_sha256 does not match the supplied frozen splits")
    return {"splits": splits, "sha256": dataset_hash}


def _score_text_lm(model: PureSeqLM, tok: SovereignTokenizer, texts: List[str]) -> Dict[str, Any]:
    total_nll = 0.0
    positions = 0
    top1_hits = 0
    vocab = model.cfg.vocab
    for text in texts:
        ids = [idx if 0 <= idx < vocab else 3 for idx in tok.encode(text)]
        if len(ids) < 2:
            continue
        for start in range(0, len(ids) - 1, model.cfg.ctx):
            window = ids[start:start + model.cfg.ctx + 1]
            if len(window) < 2:
                continue
            logits, _ = model.forward_seq(window[:-1], keep_cache=False)
            for offset, target in enumerate(window[1:]):
                row = logits[offset]
                if not row or any(not math.isfinite(float(value)) for value in row):
                    raise ValueError("Checkpoint produced empty or non-finite logits")
                maximum = max(row)
                exp_sum = sum(math.exp(float(value) - maximum) for value in row)
                target_probability = math.exp(float(row[target]) - maximum) / max(exp_sum, 1e-300)
                total_nll -= math.log(max(target_probability, 1e-300))
                top1_hits += int(max(range(len(row)), key=row.__getitem__) == target)
                positions += 1
    if not positions:
        raise ValueError("Held-out test split produced no next-token positions")
    mean_nll = total_nll / positions
    return {
        "status": "MEASURED",
        "dataset_split": "test",
        "sample_count": len(texts),
        "positions": positions,
        "nll": round(mean_nll, 6),
        "perplexity": round(math.exp(min(mean_nll, 80)), 6),
        "next_token_accuracy": round(top1_hits / positions, 6),
        "score_scope": "general text next-token prediction; not a domain capability score",
    }


def run_domain_benchmark(req: Dict[str, Any]) -> Dict[str, Any]:
    started = time.perf_counter()
    checkpoint_path = req.get("checkpoint_path")
    if not isinstance(checkpoint_path, str) or not os.path.isfile(checkpoint_path):
        return {"schema": "ZYNTHEOR_NATIVE_DOMAIN_BENCHMARK_V1", "status": "BLOCKED",
                "error": "Checkpoint path is missing or unavailable", "domains": []}

    dataset = _validate_dataset(req)
    bundle = verify_checkpoint_bundle(checkpoint_path, require_resume_state=True)
    if not bundle.get("valid"):
        return {"schema": "ZYNTHEOR_NATIVE_DOMAIN_BENCHMARK_V1", "status": "FAILED",
                "error": bundle.get("error", "Checkpoint integrity verification failed"), "domains": []}

    metadata = bundle["metadata"]
    manifest = bundle.get("manifest") or {}
    if (
        metadata.get("untrained") is True
        or metadata.get("provenance_status") != "TRAINED"
        or metadata.get("checkpoint_lifecycle") not in ("TRAINED", "READY")
        or manifest.get("lifecycle_state") not in ("TRAINED", "READY")
    ):
        return {"schema": "ZYNTHEOR_NATIVE_DOMAIN_BENCHMARK_V1", "status": "BLOCKED",
                "error": "Only integrity-verified TRAINED/READY checkpoints can be evaluated", "domains": []}
    if (
        metadata.get("dataset_sha256") != dataset["sha256"]
        or metadata.get("dataset_version") != req.get("dataset_version")
    ):
        return {"schema": "ZYNTHEOR_NATIVE_DOMAIN_BENCHMARK_V1", "status": "BLOCKED",
                "error": "Checkpoint training dataset provenance does not match the supplied frozen dataset", "domains": []}

    model = bundle["model"]
    tok = SovereignTokenizer(
        vocab_size=max(16384, model.cfg.vocab),
        profile=model.tokenizer_profile,
        bpe_merges=model.bpe_merges,
    )
    tokenizer_sha256 = tokenizer_fingerprint(tok, model.cfg.vocab)
    if tokenizer_sha256 != metadata.get("tokenizer_sha256"):
        return {"schema": "ZYNTHEOR_NATIVE_DOMAIN_BENCHMARK_V1", "status": "FAILED",
                "error": "Checkpoint tokenizer fingerprint mismatch", "domains": []}

    test_metrics = _score_text_lm(model, tok, dataset["splits"]["test_texts"])
    quality_gate_passed = bool(
        metadata.get("quality_gate_status") == "PASS"
        and metadata.get("validation_passed") is True
        and metadata.get("test_gate_passed") is True
    )
    prompt_ids = tok.encode(dataset["splits"]["test_texts"][0])[-model.cfg.ctx:]
    generated_a = list(model.generate_ids_stream(prompt_ids, max_new_tokens=8, temperature=0.0, seed=42))
    generated_b = list(model.generate_ids_stream(prompt_ids, max_new_tokens=8, temperature=0.0, seed=42))
    inference_verified = bool(
        generated_a and generated_a == generated_b
        and all(0 <= token_id < model.cfg.vocab for token_id in generated_a)
    )

    domains = []
    for domain in DOMAINS:
        if domain in NOT_IMPLEMENTED:
            status = "NOT_IMPLEMENTED"
            reason = NOT_IMPLEMENTED[domain]
        else:
            status = "BLOCKED"
            reason = (
                "No independently validated, domain-labeled prompt/reference test set is available; "
                "the general text test split cannot stand in for this capability."
            )
        domains.append({
            "domain": domain,
            "status": status,
            "score": None,
            "cases": 0,
            "reason": reason,
            "attribution": "native_checkpoint",
        })

    summary = {
        "passed": sum(result["status"] == "PASS" for result in domains),
        "failed": sum(result["status"] == "FAIL" for result in domains),
        "blocked": sum(result["status"] == "BLOCKED" for result in domains),
        "not_implemented": sum(result["status"] == "NOT_IMPLEMENTED" for result in domains),
        "total": len(domains),
    }
    status = (
        "FAILED" if summary["failed"] or not inference_verified else
        "BLOCKED" if (
            not quality_gate_passed
            or summary["blocked"]
            or summary["not_implemented"]
        ) else
        "PASS"
    )
    return {
        "schema": "ZYNTHEOR_NATIVE_DOMAIN_BENCHMARK_V1",
        "status": status,
        "readiness_accepted": (
            status == "PASS"
            and quality_gate_passed
            and summary["passed"] == len(DOMAINS)
        ),
        "quality_gate": {
            "status": metadata.get("quality_gate_status", "NOT_VERIFIED"),
            "validation_passed": metadata.get("validation_passed") is True,
            "test_gate_passed": metadata.get("test_gate_passed") is True,
        },
        "checkpoint": {
            "checkpoint_id": bundle["checkpoint_id"],
            "payload_sha256": bundle["sha256"],
            "file_sha256": bundle["file_sha256"],
            "lifecycle": "READY" if status == "PASS" else bundle["checkpoint_lifecycle"],
            "architecture": bundle["config"],
            "tokenizer_sha256": tokenizer_sha256,
        },
        "dataset": {
            "version": req["dataset_version"],
            "sha256": dataset["sha256"],
            "test_samples": len(dataset["splits"]["test_texts"]),
        },
        "general_text_test": test_metrics,
        "inference": {
            "status": "PASS" if inference_verified else "FAIL",
            "seed": 42,
            "max_new_tokens": 8,
            "generated_tokens": len(generated_a),
            "deterministic_parity": generated_a == generated_b,
            "learned_logits": inference_verified,
        },
        "summary": summary,
        "domains": domains,
        "duration_seconds": round(time.perf_counter() - started, 3),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def main() -> None:
    try:
        request = json.loads(sys.stdin.read())
        print(json.dumps(run_domain_benchmark(request), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({
            "schema": "ZYNTHEOR_NATIVE_DOMAIN_BENCHMARK_V1",
            "status": "FAILED",
            "error": str(exc),
            "domains": [],
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
