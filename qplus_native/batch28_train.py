# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 28 — Continuous Learning Real Weight Trainer (PureSeqLM)

Executes genuine backpropagation + AdamW weight updates ONLY on an isolated
versioned dataset manifest (`train` vs `val` split), evaluates baseline vs
candidate on held-out validation and test windows, and persists an integrity-
verified candidate independently of whether quality gates pass. Rejected
candidates remain non-promotable and carry explicit quality-gate metadata.

Zero Simulation Policy:
  - Never touches active production checkpoint directly.
  - Never mixes production memory into weights without prior dataset curation.
  - Never claims training occurred without real gradient steps & NLL delta.
"""

import hashlib
import json
import math
import os
import random
import struct
import sys
import time
import uuid
from typing import Any, Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.seq_lm import (
    PureAdamW,
    PureSeqLM,
    SeqLMConfig,
    _evaluate_split,
    real_vocab_size,
    set_checkpoint_lifecycle,
    tokenizer_fingerprint,
    verify_checkpoint_bundle,
)
from qplus_native.tokenizer import SovereignTokenizer, train_bpe_merges


def _failure(status: str, reason: str) -> Dict[str, Any]:
    return {"status": status, "reason": reason}


def _canonical_json_sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _to_json_tree(value: Any) -> Any:
    if isinstance(value, tuple):
        return [_to_json_tree(item) for item in value]
    if isinstance(value, list):
        return [_to_json_tree(item) for item in value]
    return value


def _to_tuple_tree(value: Any) -> Any:
    if isinstance(value, list):
        return tuple(_to_tuple_tree(item) for item in value)
    return value


def _weights_sha256(weights: Dict[str, List[float]]) -> str:
    digest = hashlib.sha256()
    for name in sorted(weights):
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        for value in weights[name]:
            digest.update(struct.pack("<f", float(value)))
    return digest.hexdigest()


class ExponentialLearningRateScheduler:
    def __init__(
        self,
        optimizer: PureAdamW,
        base_lr: float,
        decay: float = 0.995,
        min_lr_ratio: float = 0.1,
        completed_steps: int = 0,
    ):
        self.optimizer = optimizer
        self.base_lr = base_lr
        self.decay = decay
        self.min_lr_ratio = min_lr_ratio
        self.completed_steps = completed_steps

    def current_lr(self) -> float:
        return max(self.base_lr * self.min_lr_ratio, self.base_lr * self.decay ** self.completed_steps)

    def advance(self) -> None:
        self.completed_steps += 1

    def state_dict(self) -> Dict[str, Any]:
        return {
            "type": "exponential",
            "base_lr": self.base_lr,
            "decay": self.decay,
            "min_lr_ratio": self.min_lr_ratio,
            "completed_steps": self.completed_steps,
        }

    def load_state_dict(self, state: Dict[str, Any]) -> None:
        expected = (self.base_lr, self.decay, self.min_lr_ratio)
        actual = (state.get("base_lr"), state.get("decay"), state.get("min_lr_ratio"))
        if (
            state.get("type") != "exponential"
            or actual != expected
            or not isinstance(state.get("completed_steps"), int)
            or state["completed_steps"] < 0
        ):
            raise ValueError("FAIL_CLOSED: learning-rate scheduler state is incompatible")
        self.completed_steps = state["completed_steps"]


def _weight_delta_sha256(
    before: Dict[str, List[float]], after: Dict[str, List[float]]
) -> str:
    digest = hashlib.sha256()
    for name in sorted(before):
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        for old_value, new_value in zip(before[name], after[name]):
            digest.update(struct.pack("<ff", float(old_value), float(new_value)))
    return digest.hexdigest()


def _round_weights_to_checkpoint_precision(model: PureSeqLM) -> None:
    for values in model.p.values():
        for index, value in enumerate(values):
            values[index] = struct.unpack("<f", struct.pack("<f", float(value)))[0]


def run_versioned_training(req: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()
    dataset_version = req.get("dataset_version")
    candidate_out_path = req.get("candidate_checkpoint_path")
    if not isinstance(dataset_version, str) or not dataset_version.strip():
        return _failure("FAILED", "dataset_version must be a non-empty string")
    if not isinstance(candidate_out_path, str) or not candidate_out_path.strip():
        return _failure("FAILED", "candidate_checkpoint_path must be a non-empty string")

    split_names = ("train_texts", "val_texts", "test_texts")
    splits: Dict[str, List[str]] = {}
    for split_name in split_names:
        raw_texts = req.get(split_name)
        if not isinstance(raw_texts, list) or len(raw_texts) < 2:
            return _failure("FAILED", f"{split_name} must contain at least 2 samples")
        if any(not isinstance(text, str) or not text.strip() for text in raw_texts):
            return _failure("FAILED", f"{split_name} contains a non-string or empty sample")
        splits[split_name] = [text.strip() for text in raw_texts]

    normalized_owners: Dict[str, str] = {}
    for split_name, texts in splits.items():
        for text in texts:
            normalized = " ".join(text.split()).casefold()
            previous_split = normalized_owners.get(normalized)
            if previous_split is not None:
                return _failure(
                    "FAILED",
                    f"Dataset leakage: duplicate normalized sample occurs in {previous_split} and {split_name}",
                )
            normalized_owners[normalized] = split_name

    dataset_payload = {
        "trainSamples": splits["train_texts"],
        "valSamples": splits["val_texts"],
        "testSamples": splits["test_texts"],
    }
    computed_dataset_sha256 = _canonical_json_sha256(dataset_payload)
    supplied_dataset_sha256 = req.get("dataset_sha256")
    if supplied_dataset_sha256 and supplied_dataset_sha256 != computed_dataset_sha256:
        return _failure("FAILED", "dataset_sha256 does not match the canonical train/validation/test data")

    try:
        steps = req.get("steps", 12)
        lr = float(req.get("lr", 0.012))
        margin = float(req.get("margin", 0.0))
        test_margin = float(req.get("test_margin", 0.02))
        weight_decay = float(req.get("weight_decay", 0.01))
        gradient_clip = float(req.get("gradient_clip", 1.0))
        scheduler_decay = float(req.get("scheduler_decay", 0.995))
        min_lr_ratio = float(req.get("min_lr_ratio", 0.1))
        seed = req.get("seed", 2028)
        model_seed = req.get("model_seed", 42)
        num_merges = req.get("num_merges", 24)
        max_chars = req.get("max_chars", 600)
        resume_training = req.get("resume_training", False)
        if (
            isinstance(steps, bool) or not isinstance(steps, int) or not 1 <= steps <= 80
            or isinstance(seed, bool) or not isinstance(seed, int) or seed < 0
            or isinstance(model_seed, bool) or not isinstance(model_seed, int) or model_seed < 0
            or isinstance(num_merges, bool) or not isinstance(num_merges, int) or not 0 <= num_merges <= 512
            or isinstance(max_chars, bool) or not isinstance(max_chars, int) or max_chars < 32
            or not isinstance(resume_training, bool)
        ):
            return _failure("FAILED", "Training steps, seeds, tokenizer settings, or resume flag are invalid")
        numeric_config = (lr, margin, test_margin, weight_decay, gradient_clip, scheduler_decay, min_lr_ratio)
        if (
            any(not math.isfinite(value) for value in numeric_config)
            or lr <= 0 or lr > 1 or test_margin < 0 or weight_decay < 0
            or gradient_clip <= 0 or not 0 < scheduler_decay <= 1 or not 0 < min_lr_ratio <= 1
        ):
            return _failure("FAILED", "Training numeric parameters are outside supported finite ranges")
    except (TypeError, ValueError, OverflowError) as exc:
        return _failure("FAILED", f"Invalid training configuration: {exc}")

    resolved_out = os.path.abspath(candidate_out_path)
    run_id = req.get("run_id") or uuid.uuid4().hex
    if not isinstance(run_id, str) or not run_id.strip():
        return _failure("FAILED", "run_id must be a non-empty string")
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    baseline_path = req.get("baseline_checkpoint_path")
    if baseline_path and os.path.abspath(str(baseline_path)) == resolved_out:
        return _failure("FAILED", "Candidate path must not overwrite the baseline checkpoint")
    bundle_targets = (
        resolved_out,
        f"{resolved_out}.manifest.json",
        f"{resolved_out}.resume.json",
    )
    if any(os.path.lexists(target) for target in bundle_targets):
        return _failure("FAILED", "Candidate checkpoint bundle already exists; refusing to overwrite artifacts")

    baseline_model = None
    baseline_meta: Dict[str, Any] = {}
    baseline_bundle: Dict[str, Any] = {}
    resumed_from_sha256 = None
    resumed_from_file_sha256 = None
    resume_mode = "fresh"
    if baseline_path:
        if not isinstance(baseline_path, str) or not os.path.isfile(baseline_path):
            return _failure("INCOMPATIBLE", "Requested baseline checkpoint does not exist")
        baseline_bundle = verify_checkpoint_bundle(baseline_path)
        if not baseline_bundle.get("valid"):
            return _failure("INCOMPATIBLE", baseline_bundle.get("error", "Baseline checkpoint integrity failed"))
        baseline_model = baseline_bundle["model"]
        baseline_meta = baseline_bundle["metadata"]
        if baseline_meta.get("untrained") is True or baseline_meta.get("provenance_status") == "UNTRAINED":
            return _failure("INCOMPATIBLE", "Baseline checkpoint is explicitly marked UNTRAINED")
        trained_steps = baseline_meta.get("training_steps", baseline_meta.get("training_step", 0))
        has_validation = any(
            baseline_meta.get(key) is not None
            for key in ("val_nll_after", "validation_loss", "best_val_loss", "last_loss")
        )
        if (not isinstance(trained_steps, (int, float)) or trained_steps <= 0) and not has_validation:
            return _failure("INCOMPATIBLE", "Baseline checkpoint has no training-step or validation-loss provenance")
        tokenizer_profile = baseline_model.tokenizer_profile
        bpe_merges = baseline_model.bpe_merges
        tok = SovereignTokenizer(vocab_size=16384, profile=tokenizer_profile, bpe_merges=bpe_merges)
        if tokenizer_fingerprint(tok, baseline_model.cfg.vocab) != baseline_meta.get("tokenizer_sha256"):
            return _failure("INCOMPATIBLE", "Baseline tokenizer fingerprint does not match its stored vocabulary")
        if req.get("model_config") and req["model_config"] != baseline_model.cfg.to_dict():
            return _failure("INCOMPATIBLE", "Requested model configuration differs from the baseline checkpoint")
        model = baseline_model
        resumed_from_sha256 = baseline_meta.get("sha256")
        resumed_from_file_sha256 = baseline_bundle.get("file_sha256")
        resume_mode = "weights_only"
    else:
        bpe_res = train_bpe_merges(
            [text[:max_chars] for text in splits["train_texts"]],
            num_merges=num_merges,
            min_pair_freq=2,
        )
        tokenizer_profile = "bilingual_bpe"
        bpe_merges = bpe_res["merges"]
        tok = SovereignTokenizer(vocab_size=16384, profile=tokenizer_profile, bpe_merges=bpe_merges)
        real_v = real_vocab_size(tok)
        config_values = req.get("model_config") or {}
        if not isinstance(config_values, dict) or set(config_values) - {"vocab", "d_model", "n_layers", "n_heads", "d_ffn", "ctx"}:
            return _failure("FAILED", "model_config contains unsupported fields")
        config_values = dict(config_values)
        if "vocab" in config_values and config_values["vocab"] != real_v:
            return _failure("INCOMPATIBLE", "model_config.vocab must equal the tokenizer's real vocabulary size")
        config_values["vocab"] = real_v
        try:
            cfg = SeqLMConfig(**{
                "d_model": 24, "n_layers": 1, "n_heads": 4, "d_ffn": 48, "ctx": 12,
                **config_values,
            })
        except (TypeError, AssertionError) as exc:
            return _failure("FAILED", f"Invalid model configuration: {exc}")
        model = PureSeqLM(
            cfg, seed=model_seed, tokenizer_profile=tokenizer_profile, bpe_merges=bpe_merges
        )

    ctx = model.cfg.ctx
    real_v = model.cfg.vocab

    def encode_split(texts: List[str], split_name: str) -> List[List[int]]:
        streams: List[List[int]] = []
        short_samples = 0
        for text in texts:
            ids = tok.encode(text[:max_chars])
            stream = [token_id if 0 <= token_id < real_v else 3 for token_id in ids]
            if len(stream) < ctx + 2:
                short_samples += 1
            else:
                streams.append(stream)
        if short_samples:
            raise ValueError(
                f"{split_name} has {short_samples} sample(s) shorter than ctx+2={ctx + 2} tokens"
            )
        return streams

    try:
        train_streams = encode_split(splits["train_texts"], "train")
        val_streams = encode_split(splits["val_texts"], "validation")
        test_streams = encode_split(splits["test_texts"], "test")
    except ValueError as exc:
        return _failure("FAILED", str(exc))

    def build_windows(streams: List[List[int]]) -> List[Tuple[List[int], List[int]]]:
        windows: List[Tuple[List[int], List[int]]] = []
        for stream in streams:
            for start in range(0, min(len(stream) - ctx - 1, ctx * 2), ctx):
                windows.append((stream[start:start + ctx], stream[start + 1:start + ctx + 1]))
        return windows[:8]

    val_windows = build_windows(val_streams)
    test_windows = build_windows(test_streams)
    if not val_windows or not test_windows:
        return _failure("FAILED", "Validation and test splits must each produce at least one evaluation window")

    config_for_fingerprint = {
        "lr": lr,
        "weight_decay": weight_decay,
        "gradient_clip": gradient_clip,
        "scheduler_decay": scheduler_decay,
        "min_lr_ratio": min_lr_ratio,
        "seed": seed,
        "model_seed": model_seed,
        "validation_margin": margin,
        "test_margin": test_margin,
        "model_config": model.cfg.to_dict(),
        "tokenizer_sha256": tokenizer_fingerprint(tok, model.cfg.vocab),
        "max_chars": max_chars,
    }
    training_config_sha256 = _canonical_json_sha256(config_for_fingerprint)
    optimizer = PureAdamW(model, lr=lr, weight_decay=weight_decay)
    scheduler = ExponentialLearningRateScheduler(
        optimizer, lr, scheduler_decay, min_lr_ratio
    )
    rng = random.Random(seed)
    prior_training_history: List[Dict[str, Any]] = []
    initial_step = 0

    if resume_training:
        resume_state = baseline_bundle.get("resume_state") if baseline_bundle else None
        if not resume_state:
            return _failure("INCOMPATIBLE", "Exact resume requested but baseline has no verified optimizer/RNG state")
        if (
            resume_state.get("dataset_sha256") != computed_dataset_sha256
            or resume_state.get("training_config_sha256") != training_config_sha256
            or resume_state.get("tokenizer_sha256") != config_for_fingerprint["tokenizer_sha256"]
            or resume_state.get("model_config") != model.cfg.to_dict()
        ):
            return _failure("INCOMPATIBLE", "Exact resume dataset, tokenizer, model, or training configuration fingerprint mismatch")
        try:
            optimizer.load_state_dict(resume_state["optimizer"], model)
            scheduler.load_state_dict(resume_state["scheduler"])
            rng.setstate(_to_tuple_tree(resume_state["rng_state"]))
            initial_step = int(resume_state["steps_completed"])
            if optimizer.t != initial_step or scheduler.completed_steps != initial_step:
                return _failure("INCOMPATIBLE", "Optimizer, scheduler, and checkpoint training steps are inconsistent")
            prior_training_history = list(resume_state.get("training_history", []))
        except (KeyError, TypeError, ValueError) as exc:
            return _failure("INCOMPATIBLE", f"Invalid exact-resume state: {exc}")
        resume_mode = "exact"
    elif baseline_model is not None:
        resume_mode = "weights_only"

    _round_weights_to_checkpoint_precision(model)
    baseline_eval = _evaluate_split(model, tok, val_windows, train_streams)
    baseline_test_eval = _evaluate_split(model, tok, test_windows, train_streams)
    weights_before = {name: list(values) for name, values in model.p.items()}
    weights_before_sha256 = _weights_sha256(weights_before)
    train_losses: List[float] = []
    gradient_norms: List[float] = []
    tokens_processed = 0
    try:
        for _ in range(steps):
            stream = rng.choice(train_streams)
            start = rng.randint(0, len(stream) - ctx - 1)
            inputs = stream[start:start + ctx]
            targets = stream[start + 1:start + ctx + 1]
            logits, cache = model.forward_seq(inputs, keep_cache=True)
            loss, dlogits = PureSeqLM.ce_loss_seq(logits, targets)
            if not math.isfinite(loss):
                return _failure("FAILED", "Non-finite training loss encountered; no checkpoint was written")
            gradients = model.backward_seq(dlogits, cache)
            optimizer.lr = scheduler.current_lr()
            gradient_norm = optimizer.step(model, gradients, clip=gradient_clip)
            _round_weights_to_checkpoint_precision(model)
            train_losses.append(loss)
            gradient_norms.append(gradient_norm)
            tokens_processed += len(inputs)
            scheduler.advance()
    except (ArithmeticError, OverflowError, ValueError) as exc:
        return _failure("FAILED", f"Training update failed; no checkpoint was written: {exc}")

    candidate_eval = _evaluate_split(model, tok, val_windows, train_streams)
    candidate_test_eval = _evaluate_split(model, tok, test_windows, train_streams)
    weight_deltas = [
        float(after) - float(before)
        for name, values in model.p.items()
        for before, after in zip(weights_before[name], values)
    ]
    changed_weight_count = sum(delta != 0.0 for delta in weight_deltas)
    max_abs_weight_delta = max((abs(delta) for delta in weight_deltas), default=0.0)
    weight_delta_l2 = math.sqrt(sum(delta * delta for delta in weight_deltas))
    weights_after_sha256 = _weights_sha256(model.p)
    weight_delta_sha256 = _weight_delta_sha256(weights_before, model.p)
    validation_passed = bool(
        math.isfinite(candidate_eval["nll"])
        and candidate_eval["nll"] < baseline_eval["nll"] - margin
    )
    test_gate_passed = bool(
        math.isfinite(candidate_test_eval["nll"])
        and candidate_test_eval["nll"] <= baseline_test_eval["nll"] + test_margin
    )
    nll_delta = round(candidate_eval["nll"] - baseline_eval["nll"], 6)
    test_nll_delta = round(candidate_test_eval["nll"] - baseline_test_eval["nll"], 6)
    regression_passed = validation_passed and test_gate_passed
    quality_gate_status = (
        "REJECTED_VALIDATION_GATE" if not validation_passed else
        "REJECTED_TEST_GATE" if not test_gate_passed else
        "PASS"
    )
    inference_prompt = "ZYNTHEOR native learned checkpoint verification"
    inference_inputs = tok.encode(inference_prompt)[-ctx:]
    first_generated = list(model.generate_ids_stream(
        inference_inputs, max_new_tokens=8, temperature=0.0, seed=seed
    ))
    repeated_generated = list(model.generate_ids_stream(
        inference_inputs, max_new_tokens=8, temperature=0.0, seed=seed
    ))
    inference_verified = bool(
        first_generated
        and first_generated == repeated_generated
        and all(0 <= token_id < model.cfg.vocab for token_id in first_generated)
    )
    run_training_summary = {
        "steps_this_run": steps,
        "steps_completed": scheduler.completed_steps,
        "lr": lr,
        "final_lr": scheduler.current_lr(),
        "weight_decay": weight_decay,
        "gradient_clip": gradient_clip,
        "tokens_processed": tokens_processed,
        "optimizer_steps": optimizer.t,
        "weights_before_sha256": weights_before_sha256,
        "weights_after_sha256": weights_after_sha256,
        "parameter_delta_sha256": weight_delta_sha256,
        "changed_weight_count": changed_weight_count,
        "max_abs_weight_delta": max_abs_weight_delta,
        "weight_delta_l2": weight_delta_l2,
        "gradient_norm_max": max(gradient_norms),
        "train_loss_first": round(train_losses[0], 6),
        "train_loss_last": round(train_losses[-1], 6),
    }
    if (
        optimizer.t != initial_step + steps
        or changed_weight_count < 1
        or weights_before_sha256 == weights_after_sha256
        or any(not math.isfinite(value) for values in model.p.values() for value in values)
    ):
        return _failure("FAILED", "Optimizer-step or parameter-change verification failed; no checkpoint was written")

    training_history = prior_training_history + [{
        "dataset_version": dataset_version,
        "dataset_sha256": computed_dataset_sha256,
        "steps": steps,
        "train_loss_first": train_losses[0],
        "train_loss_last": train_losses[-1],
        "validation_nll": candidate_eval["nll"],
        "test_nll": candidate_test_eval["nll"],
    }]
    resume_state = {
        "dataset_sha256": computed_dataset_sha256,
        "training_config_sha256": training_config_sha256,
        "training_config": config_for_fingerprint,
        "tokenizer_sha256": config_for_fingerprint["tokenizer_sha256"],
        "model_config": model.cfg.to_dict(),
        "steps_completed": scheduler.completed_steps,
        "optimizer": optimizer.state_dict(),
        "scheduler": scheduler.state_dict(),
        "rng_state": _to_json_tree(rng.getstate()),
        "training_history": training_history,
    }
    checkpoint_metadata = {
        "run_id": run_id,
        "created_at": created_at,
        "training_track": "BATCH28_CONTINUOUS_LEARNING",
        "training_storage_backend": "LOCAL_CANDIDATE_ONLY",
        "dataset_version": dataset_version,
        "dataset_sha256": computed_dataset_sha256,
        "training_config_sha256": training_config_sha256,
        "baseline_sha256": resumed_from_sha256,
        "baseline_file_sha256": resumed_from_file_sha256,
        "training_steps": initial_step + steps,
        "steps_this_run": steps,
        "tokens_processed": tokens_processed,
        "weights_before_sha256": weights_before_sha256,
        "weights_after_sha256": weights_after_sha256,
        "parameter_delta_sha256": weight_delta_sha256,
        "changed_weight_count": changed_weight_count,
        "max_abs_weight_delta": max_abs_weight_delta,
        "weight_delta_l2": weight_delta_l2,
        "baseline_val_nll": baseline_eval["nll"],
        "candidate_val_nll": candidate_eval["nll"],
        "baseline_test_nll": baseline_test_eval["nll"],
        "candidate_test_nll": candidate_test_eval["nll"],
        "untrained": False,
        "provenance_status": "TRAINED",
        "validation_passed": validation_passed,
        "test_gate_passed": test_gate_passed,
        "quality_gate_status": quality_gate_status,
        "inference_verified": inference_verified,
        "benchmark_status": "NOT_RUN",
        "checkpoint_lifecycle": "TRAINED",
    }
    manifest_metadata = {
        "lifecycle_state": "TRAINED",
        "lifecycle_detail": (
            "Integrity-checked training candidate preserved for inspection; "
            f"quality gate status={quality_gate_status}; not production-ready."
        ),
        "run_id": run_id,
        "training_storage_backend": "LOCAL_CANDIDATE_ONLY",
        "dataset_version": dataset_version,
        "dataset_sha256": computed_dataset_sha256,
        "training_config_sha256": training_config_sha256,
        "training_config": config_for_fingerprint,
        "training_steps": initial_step + steps,
        "validation_metrics": candidate_eval,
        "test_metrics": candidate_test_eval,
        "validation_passed": validation_passed,
        "test_gate_passed": test_gate_passed,
        "quality_gate_status": quality_gate_status,
        "inference_verified": inference_verified,
        "benchmark_status": "NOT_RUN",
    }
    try:
        saved_meta = model.save(
            resolved_out,
            tok,
            extra_meta=checkpoint_metadata,
            resume_state=resume_state,
            manifest_metadata=manifest_metadata,
        )
        bundle = verify_checkpoint_bundle(resolved_out, require_resume_state=True)
        if not bundle.get("valid"):
            if os.path.isfile(f"{resolved_out}.manifest.json"):
                set_checkpoint_lifecycle(resolved_out, "FAILED", bundle.get("error"))
            return _failure("FAILED", f"Saved checkpoint failed integrity verification: {bundle.get('error')}")
        loaded_model = bundle["model"]
        reloaded_generated = list(loaded_model.generate_ids_stream(
            inference_inputs, max_new_tokens=8, temperature=0.0, seed=seed
        ))
        if reloaded_generated != first_generated:
            inference_verified = False
            set_checkpoint_lifecycle(
                resolved_out,
                "TRAINED",
                "Checkpoint integrity verified; reload inference parity failed; quality/release remains blocked.",
            )
        set_checkpoint_lifecycle(
            resolved_out,
            "TRAINED",
            (
                "Integrity, tokenizer, optimizer/RNG state, and checkpoint reload verified; "
                f"quality_gate_status={quality_gate_status}, inference_verified={inference_verified}; "
                "domain benchmark not run."
            ),
        )
        verified_bundle = verify_checkpoint_bundle(resolved_out, require_resume_state=True)
        if not verified_bundle.get("valid"):
            return _failure("FAILED", f"Final checkpoint manifest verification failed: {verified_bundle.get('error')}")
    except (OSError, ValueError, RuntimeError) as exc:
        return _failure("FAILED", f"Checkpoint save or verification failed: {exc}")

    result = {
        "status": (
            "CANDIDATE_TRAINED" if regression_passed else
            "REJECTED_VALIDATION_GATE" if not validation_passed else
            "REJECTED_TEST_GATE"
        ),
        "regression_passed": regression_passed,
        "validation_passed": validation_passed,
        "test_gate_passed": test_gate_passed,
        "quality_gate_status": quality_gate_status,
        "inference_verified": inference_verified,
        "checkpoint_lifecycle": "TRAINED",
        "benchmark_status": "NOT_RUN",
        "resume_mode": resume_mode,
        "dataset_version": dataset_version,
        "dataset_sha256": computed_dataset_sha256,
        "baseline_checkpoint_sha256": resumed_from_sha256,
        "baseline_checkpoint_file_sha256": resumed_from_file_sha256,
        "candidate_checkpoint_path": resolved_out,
        "candidate_checkpoint_sha256": saved_meta["sha256"],
        "candidate_checkpoint_file_sha256": verified_bundle["file_sha256"],
        "candidate_checkpoint_id": saved_meta["checkpoint_id"],
        "run_id": run_id,
        "created_at": created_at,
        "storage_mode": "LOCAL_CANDIDATE_ONLY",
        "parameter_delta_sha256": weight_delta_sha256,
        "total_params": model.num_params(),
        "config": model.cfg.to_dict(),
        "tokenizer": {
            "profile": tok.profile,
            "fingerprint": config_for_fingerprint["tokenizer_sha256"],
            "bpe_merges": len(tok.bpe_merges),
        },
        "training": {
            **run_training_summary,
            "history": training_history,
        },
        "baseline_eval": baseline_eval,
        "candidate_eval": candidate_eval,
        "baseline_test_eval": baseline_test_eval,
        "candidate_test_eval": candidate_test_eval,
        "nll_delta": nll_delta,
        "test_nll_delta": test_nll_delta,
        "duration_s": round(time.perf_counter() - t0, 3),
    }
    return result


def verify_checkpoint_integrity_file(ckpt_path: str) -> Dict[str, Any]:
    bundle = verify_checkpoint_bundle(ckpt_path)
    if not bundle.get("valid"):
        return bundle
    metadata = bundle["metadata"]
    return {
        "valid": True,
        "sha256": bundle["sha256"],
        "file_sha256": bundle["file_sha256"],
        "total_params": bundle["total_params"],
        "storage_mode": bundle["storage_mode"],
        "training_storage_backend": metadata.get("training_storage_backend"),
        "config": bundle["config"],
        "checkpoint_id": bundle["checkpoint_id"],
        "run_id": metadata.get("run_id"),
        "created_at": metadata.get("created_at"),
        "parameter_delta_sha256": metadata.get("parameter_delta_sha256"),
        "quality_gate_status": metadata.get("quality_gate_status"),
        "inference_verified": metadata.get("inference_verified") is True,
        "checkpoint_lifecycle": bundle["checkpoint_lifecycle"],
        "resume_state_valid": bundle["resume_state"] is not None,
    }


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"status": "FAILED", "reason": "Empty JSON payload"}))
        sys.exit(1)
    req = json.loads(raw)
    op = req.get("op", "train")
    if op == "verify_checkpoint":
        out = verify_checkpoint_integrity_file(str(req["checkpoint_path"]))
    else:
        out = run_versioned_training(req)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
