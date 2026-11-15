#!/usr/bin/env python3
"""Reproducible, read-only evaluation of the native 41.53M checkpoint."""

import hashlib
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT = ROOT / "native_data" / "model_checkpoint_target_41m.pt"
REPORT_DIR = ROOT / "artifacts"
EXPECTED_PARAMS = 41_527_808
SEED = 20_261_114
BATCH_SIZE = 8

import sys

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.corpus import build_corpus  # noqa: E402
from qplus_native.lm_v2 import NativeLM, tokenizer_fingerprint  # noqa: E402
from qplus_native.tokenizer import SovereignTokenizer  # noqa: E402


PROBE_CASES = (
    {
        "id": "reasoning-syllogism-01",
        "domain": "reasoning",
        "prompt": "All daxes are mips. All mips are loms. Are all daxes loms? Answer:",
        "choices": [" Yes.", " No."],
        "expected_index": 0,
    },
    {
        "id": "reasoning-order-01",
        "domain": "reasoning",
        "prompt": "A is before B. B is before C. Which is last? Answer:",
        "choices": [" C.", " B.", " A."],
        "expected_index": 0,
    },
    {
        "id": "math-add-01",
        "domain": "mathematics",
        "prompt": "17 + 25 =",
        "choices": [" 42", " 41", " 43"],
        "expected_index": 0,
    },
    {
        "id": "math-multiply-01",
        "domain": "mathematics",
        "prompt": "12 * 13 =",
        "choices": [" 156", " 145", " 169"],
        "expected_index": 0,
    },
    {
        "id": "coding-add-01",
        "domain": "coding",
        "prompt": "def add(a, b):\n    return",
        "choices": [" a + b", " a - b", " a * b"],
        "expected_index": 0,
    },
    {
        "id": "coding-even-01",
        "domain": "coding",
        "prompt": "def is_even(n):\n    return",
        "choices": [" n % 2 == 0", " n % 2 == 1", " n / 2 == 0"],
        "expected_index": 0,
    },
    {
        "id": "language-en-01",
        "domain": "language_understanding",
        "prompt": "The opposite of 'hot' is",
        "choices": [" cold", " warm", " fast"],
        "expected_index": 0,
    },
    {
        "id": "language-th-01",
        "domain": "language_understanding",
        "prompt": "คำว่า 'cat' ในภาษาไทยคือ",
        "choices": [" แมว", " สุนัข", " นก"],
        "expected_index": 0,
    },
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _parameter_sha256(model: NativeLM) -> str:
    digest = hashlib.sha256()
    for parameter in model.p.values():
        array = np.asarray(parameter, dtype="<f4")
        if not array.flags.c_contiguous:
            array = np.ascontiguousarray(array)
        digest.update(memoryview(array).cast("B"))
    return digest.hexdigest()


def _make_windows(
    streams: Sequence[np.ndarray], context: int
) -> List[Tuple[np.ndarray, np.ndarray]]:
    windows: List[Tuple[np.ndarray, np.ndarray]] = []
    for stream in streams:
        for start in range(0, len(stream) - 1, context):
            end = min(start + context + 1, len(stream))
            inputs = stream[start : end - 1]
            targets = stream[start + 1 : end]
            if len(inputs):
                windows.append((inputs, targets))
    return windows


def _log_probabilities(logits: np.ndarray) -> np.ndarray:
    values = logits.astype(np.float64, copy=False)
    maximum = np.max(values, axis=-1, keepdims=True)
    return values - maximum - np.log(np.exp(values - maximum).sum(axis=-1, keepdims=True))


def _evaluate_validation(
    model: NativeLM,
    tok: SovereignTokenizer,
    train_docs: Sequence[Dict[str, Any]],
    val_docs: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    train_streams = [np.asarray(tok.encode(doc["text"]), dtype=np.int64) for doc in train_docs]
    val_streams = [np.asarray(tok.encode(doc["text"]), dtype=np.int64) for doc in val_docs]
    if any(len(stream) < 2 for stream in val_streams):
        raise ValueError("Held-out validation contains a document with fewer than two tokens")

    windows = _make_windows(val_streams, model.cfg.ctx)
    buckets: Dict[int, List[Tuple[np.ndarray, np.ndarray]]] = {}
    for inputs, targets in windows:
        buckets.setdefault(len(inputs), []).append((inputs, targets))

    total_nll = 0.0
    top1_hits = 0
    positions = 0
    unigram_counts = np.ones(model.cfg.vocab, dtype=np.float64)
    for stream in train_streams:
        np.add.at(unigram_counts, stream, 1)
    unigram_probs = unigram_counts / unigram_counts.sum()
    unigram_nll = 0.0

    for length, group in buckets.items():
        for start in range(0, len(group), BATCH_SIZE):
            batch = group[start : start + BATCH_SIZE]
            x = np.stack([item[0] for item in batch])
            y = np.stack([item[1] for item in batch])
            logits, _ = model.forward(x)
            if not np.isfinite(logits).all():
                raise ValueError("Non-finite logits encountered during validation")
            log_probs = _log_probabilities(logits)
            nll = -np.take_along_axis(log_probs, y[..., None], axis=-1)[..., 0]
            total_nll += float(np.sum(nll, dtype=np.float64))
            top1_hits += int(np.sum(np.argmax(logits, axis=-1) == y))
            unigram_nll -= float(np.log(unigram_probs[y]).sum())
            positions += int(y.size)

    expected_positions = sum(len(stream) - 1 for stream in val_streams)
    if positions != expected_positions or positions == 0:
        raise RuntimeError(
            f"Validation position accounting mismatch: {positions} != {expected_positions}"
        )
    mean_nll = total_nll / positions
    unigram_mean_nll = unigram_nll / positions
    return {
        "status": "PASS",
        "metric_scope": "teacher-forced next-token prediction on held-out documents",
        "validation_documents": len(val_docs),
        "validation_tokens": sum(len(stream) for stream in val_streams),
        "target_positions": positions,
        "context_tokens": model.cfg.ctx,
        "batch_size": BATCH_SIZE,
        "model": {
            "nll_nats_per_token": mean_nll,
            "perplexity": math.exp(mean_nll),
            "top1_next_token_accuracy": top1_hits / positions,
        },
        "training_split_unigram_baseline": {
            "smoothing": "add-one",
            "nll_nats_per_token": unigram_mean_nll,
            "perplexity": math.exp(unigram_mean_nll),
        },
        "uniform_vocab_baseline": {
            "nll_nats_per_token": math.log(model.cfg.vocab),
            "perplexity": float(model.cfg.vocab),
        },
    }


def _score_choices(
    model: NativeLM,
    tok: SovereignTokenizer,
    prompt: str,
    choices: Sequence[str],
) -> List[Dict[str, Any]]:
    prompt_ids = tok.encode(prompt)
    scores = []
    for choice in choices:
        choice_ids = tok.encode(choice)
        if not choice_ids or len(choice_ids) > model.cfg.ctx:
            raise ValueError("Every probe choice must fit within the model context")
        prefix_capacity = max(1, model.cfg.ctx - len(choice_ids))
        prefix_ids = prompt_ids[-prefix_capacity:]
        combined = prefix_ids + choice_ids
        inputs = np.asarray([combined[:-1]], dtype=np.int64)
        logits, _ = model.forward(inputs)
        log_probs = _log_probabilities(logits)[0]
        first_target_position = len(prefix_ids) - 1
        selected = [
            float(log_probs[first_target_position + offset, token_id])
            for offset, token_id in enumerate(choice_ids)
        ]
        scores.append({
            "text": choice,
            "token_ids": choice_ids,
            "mean_log_probability": float(np.mean(selected)),
        })
    return scores


def _evaluate_probes(model: NativeLM, tok: SovereignTokenizer) -> Dict[str, Any]:
    cases = []
    for case in PROBE_CASES:
        scored = _score_choices(model, tok, case["prompt"], case["choices"])
        predicted_index = max(
            range(len(scored)),
            key=lambda index: scored[index]["mean_log_probability"],
        )
        cases.append({
            **case,
            "predicted_index": predicted_index,
            "correct": predicted_index == case["expected_index"],
            "scores": scored,
            "attribution": "native_checkpoint_logits_only",
        })

    suites = {}
    for domain in ("reasoning", "mathematics", "coding", "language_understanding"):
        domain_cases = [case for case in cases if case["domain"] == domain]
        suites[domain] = {
            "status": "NOT_VERIFIED",
            "measured_cases": len(domain_cases),
            "measured_accuracy": sum(case["correct"] for case in domain_cases) / len(domain_cases),
            "chance_accuracy": 1.0 / len(domain_cases[0]["choices"]),
            "limitation": (
                "Two locally authored forced-choice probes are a smoke suite, not a validated "
                "domain benchmark or evidence of capability."
            ),
            "cases": domain_cases,
        }
    return {
        "dataset_sha256": _canonical_sha256(PROBE_CASES),
        "scoring": "highest mean autoregressive log-probability among fixed reference choices",
        "reference_use": "human-authored labels are used only for scoring, never fed to inference",
        "suites": suites,
    }


def _render_markdown(report: Dict[str, Any]) -> str:
    checkpoint = report["checkpoint"]
    validation = report["validation"]
    lines = [
        "# Native 41.53M Checkpoint Evaluation",
        "",
        f"- **Overall capability status:** {report['overall_capability_status']}",
        f"- **Checkpoint file SHA-256:** `{checkpoint['file_sha256']}`",
        f"- **Payload SHA-256:** `{checkpoint['payload_sha256']}`",
        f"- **Training steps in metadata:** {checkpoint['training_steps']}",
        f"- **Parameters:** {checkpoint['parameter_count']:,}",
        f"- **Validation corpus SHA-256:** `{report['dataset']['corpus_sha256']}`",
        f"- **Validation documents / tokens:** {validation['validation_documents']} / {validation['validation_tokens']:,}",
        f"- **Validation NLL:** {validation['model']['nll_nats_per_token']:.6f} nats/token",
        f"- **Validation perplexity:** {validation['model']['perplexity']:.6f}",
        f"- **Validation top-1:** {validation['model']['top1_next_token_accuracy']:.6%}",
        f"- **Generation deterministic:** {report['inference']['generation_reproducible']}",
        f"- **Loaded weights unchanged:** {report['weights_unchanged']}",
        "",
        "## Objective smoke suites",
        "",
        "| Suite | Accuracy | Cases | Status |",
        "|---|---:|---:|---|",
    ]
    for name, suite in report["objective_suites"]["suites"].items():
        lines.append(
            f"| {name} | {suite['measured_accuracy']:.1%} | "
            f"{suite['measured_cases']} | {suite['status']} |"
        )
    lines.extend([
        "",
        "These small locally authored forced-choice probes are diagnostic only. They do not "
        "establish reasoning, mathematical, coding, or language-understanding capability. "
        "Generalization is measured only as next-token prediction on the corpus's held-out "
        "document split; no semantic capability acceptance threshold was configured.",
        "",
        "Inference used the loaded native checkpoint only. No symbolic solver, retrieval, "
        "templates, external model, or tool execution contributed to model outputs.",
        "",
    ])
    return "\n".join(lines)


def evaluate(checkpoint_path: Path = CHECKPOINT) -> Dict[str, Any]:
    started = time.perf_counter()
    if not checkpoint_path.is_file():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")
    checkpoint_file_sha = _sha256_file(checkpoint_path)

    corpus = build_corpus(str(ROOT))
    current_summary = corpus["summary"]
    train_docs = [doc for doc in corpus["docs"] if doc["split"] == "train"]
    val_docs = [doc for doc in corpus["docs"] if doc["split"] == "val"]
    dataset_identity = {
        "corpus_sha256": corpus["corpus_sha256"],
        "validation_split_sha256": _canonical_sha256([
            {"id": doc["id"], "sha256": doc["sha256"], "split": doc["split"]}
            for doc in val_docs
        ]),
        "training_documents": len(train_docs),
        "validation_documents": len(val_docs),
        "validation_document_ids": [doc["id"] for doc in val_docs],
        "validation_document_sha256": {
            doc["id"]: doc["sha256"] for doc in val_docs
        },
    }

    profile = "v2_base"
    tok = SovereignTokenizer(16_384, profile=profile)
    model, meta = NativeLM.load(str(checkpoint_path), tok, dtype=np.float32)
    if model.num_params() != EXPECTED_PARAMS or meta.get("total_params") != EXPECTED_PARAMS:
        raise RuntimeError(
            f"Parameter count mismatch: model={model.num_params()}, metadata={meta.get('total_params')}"
        )
    if meta.get("tokenizer_profile") != tok.profile:
        raise RuntimeError("Checkpoint tokenizer profile does not match the evaluation tokenizer")
    if meta.get("corpus_sha256") != corpus["corpus_sha256"]:
        raise RuntimeError("Reconstructed corpus hash differs from checkpoint training corpus")
    if meta.get("corpus_summary") != current_summary:
        raise RuntimeError("Reconstructed corpus split summary differs from checkpoint metadata")
    if tokenizer_fingerprint(tok, model.cfg.vocab) != meta.get("tokenizer_fingerprint"):
        raise RuntimeError("Checkpoint tokenizer fingerprint mismatch")

    weights_sha_before = _parameter_sha256(model)
    if weights_sha_before != meta.get("sha256"):
        raise RuntimeError("Loaded parameter bytes do not match checkpoint payload digest")

    prompt = "ZYNTHEOR Native checkpoint inference check."
    prompt_ids = tok.encode(prompt)
    logits_a, _ = model.forward(np.asarray([prompt_ids], dtype=np.int64))
    logits_b, _ = model.forward(np.asarray([prompt_ids], dtype=np.int64))
    generation_settings = {
        "prompt": prompt,
        "max_new_tokens": 16,
        "temperature": 0.0,
        "top_k": 0,
        "top_p": 1.0,
        "seed": SEED,
        "repetition_penalty": 1.0,
    }
    generated_a = model.generate_ids(
        prompt_ids,
        max_new_tokens=generation_settings["max_new_tokens"],
        temperature=generation_settings["temperature"],
        top_k=generation_settings["top_k"],
        top_p=generation_settings["top_p"],
        seed=SEED,
        repetition_penalty=generation_settings["repetition_penalty"],
    )
    generated_b = model.generate_ids(
        prompt_ids,
        max_new_tokens=generation_settings["max_new_tokens"],
        temperature=generation_settings["temperature"],
        top_k=generation_settings["top_k"],
        top_p=generation_settings["top_p"],
        seed=SEED,
        repetition_penalty=generation_settings["repetition_penalty"],
    )
    real_vocab = min(model.cfg.vocab, tok._real_vocab_count)
    inference = {
        "status": "PASS" if (
            np.isfinite(logits_a).all()
            and np.array_equal(logits_a, logits_b)
            and generated_a == generated_b
            and all(4 <= token_id < real_vocab for token_id in generated_a)
        ) else "FAIL",
        "prompt_token_count": len(prompt_ids),
        "logits_shape": list(logits_a.shape),
        "logits_finite": bool(np.isfinite(logits_a).all()),
        "repeated_logits_exact": bool(np.array_equal(logits_a, logits_b)),
        "generated_token_ids": generated_a,
        "generated_text": tok.decode(generated_a),
        "generation_reproducible": generated_a == generated_b,
        "generation_settings": generation_settings,
        "attribution": "NativeLM checkpoint forward/generation only",
    }
    validation = _evaluate_validation(model, tok, train_docs, val_docs)
    probes = _evaluate_probes(model, tok)
    weights_sha_after = _parameter_sha256(model)
    final_file_sha = _sha256_file(checkpoint_path)
    weights_unchanged = (
        weights_sha_before == weights_sha_after
        and checkpoint_file_sha == final_file_sha
    )

    statuses = {
        "checkpoint_integrity": "PASS",
        "native_loader": "PASS",
        "parameter_count": "PASS",
        "inference": inference["status"],
        "heldout_dataset_identity": "PASS",
        "validation_metrics": validation["status"],
        "weight_preservation": "PASS" if weights_unchanged else "FAIL",
        "reasoning_capability": "NOT_VERIFIED",
        "mathematics_capability": "NOT_VERIFIED",
        "coding_capability": "NOT_VERIFIED",
        "language_understanding_capability": "NOT_VERIFIED",
        "generalization_quality": "NOT_VERIFIED",
        "multimodal_capability": "NOT_IMPLEMENTED",
        "tool_execution_capability": "NOT_IMPLEMENTED",
    }
    report = {
        "schema": "ZYNTHEOR_TARGET_CHECKPOINT_EVALUATION_V1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "overall_capability_status": "NOT_VERIFIED",
        "statuses": statuses,
        "checkpoint": {
            "path": str(checkpoint_path.relative_to(ROOT)),
            "file_size_bytes": checkpoint_path.stat().st_size,
            "file_sha256": checkpoint_file_sha,
            "payload_sha256": meta["sha256"],
            "parameter_payload_sha256": weights_sha_before,
            "training_steps": meta.get("training_steps"),
            "checkpoint_timestamp": meta.get("timestamp"),
            "training_track": meta.get("training_track"),
            "parameter_count": model.num_params(),
            "config": meta.get("config"),
            "tokenizer_profile": meta.get("tokenizer_profile"),
            "tokenizer_fingerprint": meta.get("tokenizer_fingerprint"),
            "dtype_on_disk": "float32",
            "inference_dtype": str(model.p["tok_emb"].dtype),
        },
        "dataset": dataset_identity,
        "validation": validation,
        "inference": inference,
        "objective_suites": probes,
        "separation": {
            "model_outputs": "NativeLM loaded checkpoint logits and autoregressive decoding",
            "scoring_references": "Locally authored fixed choices used only after inference scoring",
            "symbolic_tools_used": False,
            "retrieval_used": False,
            "templates_used_in_inference": False,
            "external_models_or_apis_used": False,
            "code_execution_used_for_scoring": False,
        },
        "weights_unchanged": weights_unchanged,
        "checkpoint_file_sha256_after_evaluation": final_file_sha,
        "duration_seconds": round(time.perf_counter() - started, 3),
        "limitations": [
            "The reasoning, math, coding, and language suites contain only two locally authored probes each.",
            "Forced-choice likelihood is not equivalent to open-ended capability or behavioral correctness.",
            "Generalization is measured only by held-out next-token prediction on this project corpus.",
            "No capability acceptance thresholds or independently validated domain datasets are available.",
        ],
    }

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stem = f"target-checkpoint-evaluation-step1400-{checkpoint_file_sha[:12]}-{stamp}"
    json_path = REPORT_DIR / f"{stem}.json"
    markdown_path = REPORT_DIR / f"{stem}.md"
    suffix = 1
    while json_path.exists() or markdown_path.exists():
        suffix += 1
        json_path = REPORT_DIR / f"{stem}-{suffix}.json"
        markdown_path = REPORT_DIR / f"{stem}-{suffix}.md"
    with json_path.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    with markdown_path.open("x", encoding="utf-8") as stream:
        stream.write(_render_markdown(report))
    report["report_files"] = {
        "json": str(json_path.relative_to(ROOT)),
        "markdown": str(markdown_path.relative_to(ROOT)),
    }
    return report


if __name__ == "__main__":
    print(json.dumps(evaluate(), ensure_ascii=False, indent=2))
