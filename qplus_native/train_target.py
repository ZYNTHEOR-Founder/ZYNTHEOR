# -*- coding: utf-8 -*-
"""Governed, fail-closed continuation training runner for ZYNTHEOR NativeLM (41,527,808 params).

Design invariants:
  * Real NumPy backend ONLY (never falls back to pure-Python np_compat).
  * Separate `--init` (source checkpoint) and `--out` (destination checkpoint); refuses
    in-place overwrite of original checkpoints or existing `--out` files.
  * Tokenizer lock (`v2_base` default): refuses silent tokenizer profile drift unless
    explicitly matched against the checkpoint's `tokenizer_fingerprint`.
  * Dataset Governance Gate (`validate_training_readiness`): refuses training unless
    provenance manifest, pinned evidence, split-leakage audit, and external HMAC
    trusted approval key all verify as `VERIFIED` (`test` split is strictly excluded).
  * Human Approval Gate (`--human-approval-confirmed`): refuses training without
    explicit human authorization, even when `--preflight-only` checks pass.
  * Exact optional optimizer/RNG/scheduler resume via `qplus_native.training_state`
    (`--resume-state` / `--save-resume-state`), plus warmup for weights-only warm start.
  * Finite logits, loss, dlogits, every gradient tensor, grad_norm, and weights checked
    before/after every optimizer step.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import stat
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Mapping, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_NUMPY_IMPORT_ERROR: Optional[str] = None
try:
    import numpy as _np  # type: ignore

    if (
        getattr(_np, "__name__", "") != "numpy"
        or not hasattr(_np, "__version__")
        or "np_compat" in str(getattr(_np, "__file__", ""))
    ):
        np: Any = None
        _NUMPY_IMPORT_ERROR = "Detected non-native NumPy shim; real NumPy C-extension required."
    else:
        np = _np
except ImportError as exc:
    np = None
    _NUMPY_IMPORT_ERROR = str(exc)

from qplus_native.architecture import (
    TARGET_CTX,
    TARGET_D_FFN,
    TARGET_D_MODEL,
    TARGET_N_HEADS,
    TARGET_N_LAYERS,
    TARGET_TOTAL_PARAMS,
    TARGET_VOCAB_SIZE,
)
from qplus_native.candidate_audit import inspect_checkpoint
from qplus_native.cloud_storage import check_cloud_connectivity, validate_cloud_runtime_config
from qplus_native.lm_v2 import AdamW, LMConfig, NativeLM, tokenizer_fingerprint
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.training_readiness import validate_training_readiness
from qplus_native.trusted_approvals import load_hmac_verifier

DEFAULT_INIT_CHECKPOINT = ROOT / "native_data" / "model_checkpoint_target_41m.pt"
DEFAULT_OUT_CHECKPOINT = ROOT / "native_data" / "model_checkpoint_target_41m_step5800.pt"
DEFAULT_PROVENANCE_MANIFEST = ROOT / "artifacts" / "dataset-provenance-manifest.json"
DEFAULT_EVIDENCE_ROOT = ROOT / "artifacts" / "dataset-provenance-evidence"
DEFAULT_EVIDENCE_OUT = ROOT / "artifacts" / "target-training-evidence.json"
DEFAULT_TARGET_STEPS = 5800


def verify_numpy_backend() -> Dict[str, Any]:
    """Ensure real NumPy (not np_compat) is loaded and supports float32."""
    if np is None:
        detail = _NUMPY_IMPORT_ERROR or "No module named 'numpy'"
        raise RuntimeError(
            "FAIL_CLOSED: Real NumPy is required for 41.53M NativeLM training "
            f"(pure-Python np_compat fallback is forbidden): {detail}"
        )
    mod_file = str(getattr(np, "__file__", ""))
    if "np_compat" in mod_file or getattr(np, "__name__", "") != "numpy":
        raise RuntimeError("FAIL_CLOSED: pure-Python np_compat is prohibited for NativeLM 41.53M training")
    test_arr = np.zeros((2, 2), dtype=np.float32)
    if test_arr.dtype != np.dtype(np.float32):
        raise RuntimeError("FAIL_CLOSED: NumPy float32 support verification failed")
    boto3_available = False
    boto3_version: Optional[str] = None
    try:
        import boto3  # type: ignore
        boto3_available = True
        boto3_version = str(getattr(boto3, "__version__", "")) or None
    except Exception:
        boto3_available = False
    return {
        "backend": "numpy",
        "numpy_available": True,
        "version": str(np.__version__),
        "module_file": mod_file,
        "boto3_available": boto3_available,
        "boto3_version": boto3_version,
        "python_executable": sys.executable,
        "python_version": sys.version.split()[0],
        "float32_verified": True,
    }


def load_frozen_documents(dataset_file: Optional[str]) -> Dict[str, Dict[str, str]]:
    """Load explicit dataset documents mapping document_id -> {text, split}.

    Supports either a single JSON/JSONL file or a split directory containing
    `train.jsonl`, `validation.jsonl`, and `test.jsonl`.
    Never invents synthetic data or falls back silently when `dataset_file` is absent.
    Expected JSONL lines (or JSON array) with keys:
      - `document_id` (str)
      - `split` ("train" | "validation" | "val" | "test")
      - `text` (str)
    """
    if not dataset_file:
        return {}
    p = Path(dataset_file)
    files_to_read: List[Path] = []
    if p.is_dir():
        for split_name in ("train", "validation", "test"):
            sp_path = p / f"{split_name}.jsonl"
            if not sp_path.is_file():
                raise FileNotFoundError(f"dataset split file missing in directory {p}: {sp_path.name}")
            files_to_read.append(sp_path)
    elif p.is_file():
        files_to_read = [p]
    else:
        raise FileNotFoundError(f"dataset_file not found: {p}")

    records: List[Dict[str, Any]] = []
    for file_path in files_to_read:
        raw = file_path.read_text(encoding="utf-8")
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped.startswith("["):
            loaded = json.loads(stripped)
            if not isinstance(loaded, list):
                raise ValueError(f"JSON dataset file must contain a list of records: {file_path}")
            records.extend(r for r in loaded if isinstance(r, dict))
        else:
            for line_no, line in enumerate(stripped.splitlines(), start=1):
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if not isinstance(obj, dict):
                    raise ValueError(f"{file_path} line {line_no} is not a JSON object")
                records.append(obj)

    frozen: Dict[str, Dict[str, str]] = {}
    for rec in records:
        doc_id = rec.get("document_id")
        text = rec.get("text")
        split = rec.get("split")
        if not isinstance(doc_id, str) or not doc_id.strip():
            raise ValueError("dataset record missing document_id")
        if not isinstance(text, str):
            raise ValueError(f"dataset record {doc_id} missing text")
        if split not in {"train", "validation", "val", "test"}:
            raise ValueError(f"dataset record {doc_id} has invalid split: {split!r}")
        if doc_id in frozen:
            raise ValueError(f"duplicate document_id in dataset_file: {doc_id}")
        frozen[doc_id] = {
            "text": text,
            "split": "validation" if split == "val" else str(split),
        }
    return frozen


def encode_docs(tok: SovereignTokenizer, docs: List[Mapping[str, str]]) -> List[np.ndarray]:
    return [np.asarray(tok.encode(d["text"]), dtype=np.int64) for d in docs]


def sample_batch(
    rng: np.random.Generator,
    streams: List[np.ndarray],
    batch: int,
    ctx: int,
) -> Tuple[np.ndarray, np.ndarray]:
    valid = [s for s in streams if len(s) > ctx + 1]
    if not valid:
        raise RuntimeError(f"FAIL_CLOSED: no training document stream exceeds ctx+1 ({ctx + 1} tokens)")
    lengths = np.asarray([len(s) - ctx - 1 for s in valid], dtype=np.float64)
    probs = lengths / lengths.sum()
    xs, ys = [], []
    for _ in range(batch):
        s = valid[int(rng.choice(len(valid), p=probs))]
        i = int(rng.integers(0, len(s) - ctx - 1))
        xs.append(s[i:i + ctx])
        ys.append(s[i + 1:i + ctx + 1])
    return np.stack(xs), np.stack(ys)


def eval_loss(model: NativeLM, streams: List[np.ndarray], ctx: int, max_windows: int = 128) -> float:
    windows = []
    for s in streams:
        for i in range(0, len(s) - ctx - 1, ctx):
            windows.append((s[i:i + ctx], s[i + 1:i + ctx + 1]))
            if len(windows) >= max_windows:
                break
        if len(windows) >= max_windows:
            break
    if not windows:
        return float("nan")
    total = 0.0
    for i in range(0, len(windows), 2):
        x = np.stack([w[0] for w in windows[i:i + 2]])
        y = np.stack([w[1] for w in windows[i:i + 2]])
        logits, _ = model.forward(x)
        if not np.all(np.isfinite(logits)):
            raise RuntimeError("FAIL_CLOSED: non-finite logits during validation evaluation")
        loss, _ = NativeLM.ce_loss(logits, y)
        if not math.isfinite(loss):
            raise RuntimeError("FAIL_CLOSED: non-finite validation loss")
        total += loss * len(x)
    return float(total / len(windows))


def verify_tokenizer_against_checkpoint(
    meta: Mapping[str, Any],
    tok: SovereignTokenizer,
    vocab_size: int,
) -> None:
    ckpt_profile = meta.get("tokenizer_profile") or "v2_base"
    if ckpt_profile != tok.profile:
        raise RuntimeError(
            f"FAIL_CLOSED: tokenizer profile mismatch (checkpoint={ckpt_profile!r}, requested={tok.profile!r}); "
            "silent switching between v2_base and bilingual_v4 is prohibited"
        )
    ckpt_fp = meta.get("tokenizer_fingerprint")
    expected_fp = tokenizer_fingerprint(tok, vocab_size)
    if ckpt_fp and ckpt_fp != expected_fp:
        raise RuntimeError(
            "FAIL_CLOSED: tokenizer fingerprint mismatch against checkpoint metadata"
        )


def _check_output_paths(init_path: Path, out_path: Path, save_resume_state: Optional[Path]) -> List[str]:
    issues: List[str] = []
    try:
        if init_path.resolve() == out_path.resolve():
            issues.append("out_path_equals_init_checkpoint_forbidden")
    except Exception:
        if str(init_path) == str(out_path):
            issues.append("out_path_equals_init_checkpoint_forbidden")
    if out_path.exists():
        issues.append(f"out_checkpoint_already_exists:{out_path}")
    if save_resume_state is not None and save_resume_state.exists():
        issues.append(f"resume_bundle_already_exists:{save_resume_state}")
    return issues


def _sanitize_uri(uri: Optional[str]) -> Optional[str]:
    """Redact credentials and signed query parameters before logging any cloud URI."""
    if not uri or not isinstance(uri, str):
        return None
    raw = uri.strip()
    if not raw:
        return None
    if raw.startswith("s3://"):
        return raw
    try:
        parts = urlsplit(raw)
        host = parts.hostname or ""
        if parts.port:
            netloc = f"{host}:{parts.port}"
        else:
            netloc = host
        query = "[REDACTED_QUERY]" if parts.query else ""
        return urlunsplit((parts.scheme, netloc, parts.path, query, ""))
    except Exception:
        return "[REDACTED_URI]"


def _inspect_approval_key(approval_key_file: Optional[str]) -> Dict[str, Any]:
    """Inspect Gate 5 approval key file & 0600 permissions without exposing key contents."""
    raw = (approval_key_file or "").strip()
    if not raw:
        return {
            "configured": False,
            "path": None,
            "exists": False,
            "is_symlink": False,
            "is_regular_file": False,
            "mode_octal": None,
            "permissions_0600_or_stricter": False,
            "verifier_loaded": False,
            "error": "trusted_approval_key_missing",
        }
    p = Path(raw)
    is_symlink = p.is_symlink()
    exists = p.exists()
    result: Dict[str, Any] = {
        "configured": True,
        "path": str(p),
        "exists": exists,
        "is_symlink": is_symlink,
        "is_regular_file": False,
        "mode_octal": None,
        "permissions_0600_or_stricter": False,
        "verifier_loaded": False,
        "error": None,
    }
    if not exists:
        result["error"] = "approval_key_file_not_found"
        return result
    try:
        info = p.stat()
        mode = stat.S_IMODE(info.st_mode)
        result["is_regular_file"] = stat.S_ISREG(info.st_mode)
        result["mode_octal"] = f"{mode:04o}"
        result["permissions_0600_or_stricter"] = (os.name != "posix") or ((mode & 0o077) == 0)
        load_hmac_verifier(p)
        result["verifier_loaded"] = True
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}:{exc}"
    return result


def _inspect_s3_probe(probe_s3: bool) -> Dict[str, Any]:
    """Inspect S3/cloud configuration and optionally run live connectivity probe without leaking secrets."""
    cfg = validate_cloud_runtime_config()
    env_presence = {
        "S3_BUCKET": bool(os.environ.get("S3_BUCKET", "").strip()),
        "S3_REGION": bool(os.environ.get("S3_REGION", "").strip()),
        "S3_ENDPOINT": bool(os.environ.get("S3_ENDPOINT", "").strip()),
        "S3_ACCESS_KEY_ID": bool(os.environ.get("S3_ACCESS_KEY_ID", "").strip()),
        "S3_SECRET_ACCESS_KEY": bool(os.environ.get("S3_SECRET_ACCESS_KEY", "").strip()),
        "S3_CHECKPOINT_KEY": bool(os.environ.get("S3_CHECKPOINT_KEY", "").strip()),
        "CHECKPOINT_PRESIGNED_URL": bool(os.environ.get("CHECKPOINT_PRESIGNED_URL", "").strip()),
    }
    report: Dict[str, Any] = {
        "probe_requested": bool(probe_s3),
        "config_valid": bool(cfg.get("config_valid")),
        "provider": cfg.get("provider"),
        "missing_keys": list(cfg.get("missing_keys", [])),
        "source_uri": _sanitize_uri(cfg.get("source_uri")),
        "validation_error": cfg.get("validation_error"),
        "env_presence": env_presence,
        "connectivity": None,
    }
    if probe_s3:
        conn = check_cloud_connectivity(timeout_s=3.0)
        report["connectivity"] = {
            "online": bool(conn.get("online")),
            "status": conn.get("status"),
            "error_code": conn.get("error_code"),
            "runtime_state_hint": conn.get("runtime_state_hint"),
            "reason": conn.get("reason"),
            "source_uri": _sanitize_uri(conn.get("source_uri")),
            "http_status": conn.get("http_status"),
            "content_length": conn.get("content_length"),
            "latency_ms": conn.get("latency_ms"),
        }
    return report


def run_preflight(
    *,
    init_checkpoint: Path,
    out_checkpoint: Path,
    target_steps: int,
    steps: Optional[int],
    tokenizer_profile: str,
    provenance_manifest: Path,
    evidence_root: Path,
    approval_key_file: Optional[str],
    dataset_file: Optional[str],
    resume_state: Optional[Path],
    save_resume_state: Optional[Path],
    human_approval_confirmed: bool,
    allow_fresh_init: bool = False,
    probe_s3: bool = False,
    expected_params: int = TARGET_TOTAL_PARAMS,
    vocab_size: int = TARGET_VOCAB_SIZE,
) -> Dict[str, Any]:
    """Run all readiness gates non-destructively without starting training."""
    blockers: List[str] = []
    try:
        backend_info = verify_numpy_backend()
    except Exception as exc:
        backend_info = {
            "backend": "unavailable",
            "numpy_available": False,
            "float32_verified": False,
            "python_executable": sys.executable,
            "python_version": sys.version.split()[0],
            "error": str(exc),
        }
        blockers.append("native_numpy_backend_unavailable")

    # 1. Path protection
    path_issues = _check_output_paths(init_checkpoint, out_checkpoint, save_resume_state)
    blockers.extend(path_issues)

    # 2. Checkpoint & architecture check
    ckpt_audit: Dict[str, Any] = {"path": str(init_checkpoint), "exists": init_checkpoint.is_file()}
    start_step = 0
    ckpt_meta: Dict[str, Any] = {}
    tok = SovereignTokenizer(vocab_size, profile=tokenizer_profile)
    tok_fp = tokenizer_fingerprint(tok, vocab_size)

    if init_checkpoint.is_file():
        audit = inspect_checkpoint(init_checkpoint)
        ckpt_audit["structural_audit"] = {
            "integrity_status": audit.get("integrity_status"),
            "runtime_compatibility": audit.get("runtime_compatibility"),
            "container_bytes": audit.get("container_bytes"),
            "container_sha256": audit.get("container_sha256"),
            "payload_sha256": audit.get("payload_sha256"),
            "total_params": (audit.get("metadata") or {}).get("total_params"),
            "errors": audit.get("errors", []),
        }
        if audit.get("integrity_status") != "STRUCTURAL_CHECKS_PASS":
            blockers.append("init_checkpoint_structural_audit_failed")
        else:
            ckpt_meta = audit.get("metadata", {}) or {}
            total_params = ckpt_meta.get("total_params")
            if expected_params and total_params != expected_params:
                blockers.append(
                    f"init_checkpoint_param_count_mismatch:{total_params}!={expected_params}"
                )
            try:
                verify_tokenizer_against_checkpoint(ckpt_meta, tok, vocab_size)
                ckpt_audit["tokenizer_match"] = True
            except Exception as exc:
                ckpt_audit["tokenizer_match"] = False
                blockers.append(str(exc))
            start_step = int(ckpt_meta.get("training_steps_total") or ckpt_meta.get("training_steps") or 0)
    elif not allow_fresh_init:
        blockers.append(f"init_checkpoint_missing:{init_checkpoint}")

    if steps is not None:
        if steps < 1 or steps > 20000:
            blockers.append(f"invalid_steps:{steps}")
    else:
        if target_steps <= start_step:
            blockers.append(f"target_steps_already_reached:{start_step}>={target_steps}")

    # 3. Resume state check (optional)
    resume_info: Dict[str, Any] = {"requested": resume_state is not None, "path": str(resume_state) if resume_state else None}
    if resume_state is not None:
        resume_info["exists"] = resume_state.is_file()
        if not resume_state.is_file():
            blockers.append(f"resume_state_missing:{resume_state}")

    # 4. Dataset JSONL, provenance manifest, evidence root, and governance gate
    frozen_docs: Dict[str, Dict[str, str]] = {}
    dataset_load_error: Optional[str] = None
    try:
        frozen_docs = load_frozen_documents(dataset_file)
    except Exception as exc:
        dataset_load_error = f"dataset_file_invalid:{exc}"
        blockers.append(dataset_load_error)

    if not dataset_file and not dataset_load_error:
        blockers.append("verified_dataset_file_missing")

    split_counts = {
        "train": sum(1 for d in frozen_docs.values() if d.get("split") == "train"),
        "validation": sum(1 for d in frozen_docs.values() if d.get("split") == "validation"),
        "test": sum(1 for d in frozen_docs.values() if d.get("split") == "test"),
        "total": len(frozen_docs),
    }

    evidence_dirs = {}
    for sub in ("source", "license", "rights", "approval"):
        sub_dir = evidence_root / sub
        if sub_dir.is_dir():
            files = [p.name for p in sorted(sub_dir.iterdir()) if p.is_file() and p.name != ".gitkeep"]
        else:
            files = []
        evidence_dirs[sub] = {"exists": sub_dir.is_dir(), "file_count": len(files)}

    approval_key_info = _inspect_approval_key(approval_key_file)
    if approval_key_info["configured"] and not approval_key_info["verifier_loaded"]:
        blockers.append(f"approval_key_invalid:{approval_key_info.get('error')}")

    readiness = validate_training_readiness(
        str(provenance_manifest),
        str(evidence_root),
        approval_key_file,
        frozen_docs,
    )
    if readiness.get("status") != "VERIFIED":
        blockers.append("dataset_governance_blocked")

    # 5. S3 credentials & connectivity probe
    s3_probe = _inspect_s3_probe(probe_s3=probe_s3)
    s3_online = bool((s3_probe.get("connectivity") or {}).get("online"))
    if probe_s3 and not (s3_probe["config_valid"] and s3_online):
        err_code = (s3_probe.get("connectivity") or {}).get("error_code") or "NOT_CONFIGURED"
        blockers.append(f"s3_preflight_blocked:{err_code}")

    # 6. Human approval gate
    if not human_approval_confirmed:
        blockers.append("human_approval_confirmation_missing")

    ckpt_gate_ok = bool(
        backend_info.get("numpy_available")
        and backend_info.get("float32_verified")
        and (
            allow_fresh_init
            or (
                ckpt_audit.get("exists")
                and (ckpt_audit.get("structural_audit") or {}).get("integrity_status") == "STRUCTURAL_CHECKS_PASS"
                and (ckpt_audit.get("structural_audit") or {}).get("total_params") == expected_params
                and ckpt_audit.get("tokenizer_match") is True
            )
        )
    )
    dataset_gate_ok = bool(
        dataset_file
        and not dataset_load_error
        and split_counts["train"] > 0
        and split_counts["validation"] > 0
        and split_counts["test"] > 0
        and provenance_manifest.is_file()
    )
    gates = {
        "gate_1_checkpoint_and_numpy": "VERIFIED" if ckpt_gate_ok else "BLOCKED",
        "gate_2_dataset_jsonl_and_provenance": "VERIFIED" if dataset_gate_ok else "BLOCKED",
        "gate_3_dataset_governance": "VERIFIED" if readiness.get("status") == "VERIFIED" else "BLOCKED",
        "gate_4_s3_credentials_and_bucket": (
            "VERIFIED"
            if (s3_probe["config_valid"] and (not probe_s3 or s3_online))
            else "BLOCKED"
        ),
        "gate_5_approval_key_0600": "VERIFIED" if approval_key_info["verifier_loaded"] else "BLOCKED",
        "gate_6_human_approval": "VERIFIED" if human_approval_confirmed else "BLOCKED",
    }

    unique_blockers = list(dict.fromkeys(blockers))
    return {
        "schema_version": "zyntheor.training-preflight.v1",
        "status": "READY" if not unique_blockers else "BLOCKED",
        "training_executed": False,
        "gates": gates,
        "backend": backend_info,
        "target_architecture": {
            "vocab": TARGET_VOCAB_SIZE,
            "d_model": TARGET_D_MODEL,
            "n_layers": TARGET_N_LAYERS,
            "n_heads": TARGET_N_HEADS,
            "d_ffn": TARGET_D_FFN,
            "ctx": TARGET_CTX,
            "target_total_params": TARGET_TOTAL_PARAMS,
        },
        "tokenizer": {
            "profile": tokenizer_profile,
            "vocab_size": vocab_size,
            "fingerprint": tok_fp,
        },
        "init_checkpoint": ckpt_audit,
        "out_checkpoint": str(out_checkpoint),
        "resume_state": resume_info,
        "target_steps": target_steps,
        "start_step": start_step,
        "dataset": {
            "path": dataset_file,
            "exists": bool(dataset_file and (Path(dataset_file).is_file() or Path(dataset_file).is_dir())),
            "split_counts": split_counts,
            "load_error": dataset_load_error,
            "provenance_manifest": {
                "path": str(provenance_manifest),
                "exists": provenance_manifest.is_file(),
            },
            "evidence_root": {
                "path": str(evidence_root),
                "exists": evidence_root.is_dir(),
                "subdirs": evidence_dirs,
            },
        },
        "dataset_governance": readiness,
        "s3_probe": s3_probe,
        "approval_key": approval_key_info,
        "human_approval_confirmed": bool(human_approval_confirmed),
        "blockers": unique_blockers,
    }


def build_verification_checkpoint_schedule(
    *,
    start_step: int = 0,
    target_steps: int = DEFAULT_TARGET_STEPS,
    steps: Optional[int] = None,
    eval_every: int = 25,
    save_every: int = 100,
) -> Dict[str, Any]:
    """Compute the deterministic verification checkpoint schedule for the 5,800-step loop."""
    run_steps = int(steps) if steps is not None else max(0, int(target_steps) - int(start_step))
    checkpoints: List[Dict[str, Any]] = []
    if run_steps > 0 and save_every > 0:
        for local_step in range(1, run_steps + 1):
            if local_step % save_every == 0 and local_step < run_steps:
                checkpoints.append({
                    "kind": "periodic_verification",
                    "local_step": local_step,
                    "global_step": start_step + local_step,
                    "checks": [
                        "finite_logits_loss",
                        "finite_gradients_and_norm",
                        "finite_float32_weights",
                        "sha256_payload_seal",
                        "sha256_container_seal",
                    ],
                })
        if run_steps > 0:
            checkpoints.append({
                "kind": "final_verification",
                "local_step": run_steps,
                "global_step": start_step + run_steps,
                "checks": [
                    "finite_logits_loss",
                    "finite_gradients_and_norm",
                    "finite_float32_weights",
                    "sha256_payload_seal",
                    "sha256_container_seal",
                    "best_val_checkpoint_selection",
                ],
            })
    return {
        "start_step": start_step,
        "target_steps": target_steps,
        "planned_run_steps": run_steps,
        "final_step": start_step + run_steps,
        "eval_every": eval_every,
        "save_every": save_every,
        "checkpoint_count": len(checkpoints),
        "milestones": checkpoints,
    }


def initialize_training_pipeline(
    *,
    init_checkpoint: Path = DEFAULT_INIT_CHECKPOINT,
    out_checkpoint: Path = DEFAULT_OUT_CHECKPOINT,
    provenance_manifest: Path = DEFAULT_PROVENANCE_MANIFEST,
    evidence_root: Path = DEFAULT_EVIDENCE_ROOT,
    approval_key_file: Optional[str] = None,
    dataset_file: Optional[str] = None,
    resume_state: Optional[Path] = None,
    save_resume_state: Optional[Path] = None,
    target_steps: int = DEFAULT_TARGET_STEPS,
    steps: Optional[int] = None,
    eval_every: int = 25,
    save_every: int = 100,
    tokenizer_profile: str = "v2_base",
    human_approval_confirmed: bool = False,
    allow_fresh_init: bool = False,
    expected_params: int = TARGET_TOTAL_PARAMS,
    vocab_size: int = TARGET_VOCAB_SIZE,
) -> Dict[str, Any]:
    """Initialize and verify the 5,800-step pipeline configuration without starting training."""
    preflight = run_preflight(
        init_checkpoint=init_checkpoint,
        out_checkpoint=out_checkpoint,
        target_steps=target_steps,
        steps=steps,
        tokenizer_profile=tokenizer_profile,
        provenance_manifest=provenance_manifest,
        evidence_root=evidence_root,
        approval_key_file=approval_key_file,
        dataset_file=dataset_file,
        resume_state=resume_state,
        save_resume_state=save_resume_state,
        human_approval_confirmed=human_approval_confirmed,
        allow_fresh_init=allow_fresh_init,
        expected_params=expected_params,
        vocab_size=vocab_size,
    )
    schedule = build_verification_checkpoint_schedule(
        start_step=int(preflight.get("start_step", 0)),
        target_steps=target_steps,
        steps=steps,
        eval_every=eval_every,
        save_every=save_every,
    )
    return {
        "schema_version": "zyntheor.training-pipeline-init.v1",
        "initialized": True,
        "training_executed": False,
        "can_execute_training": preflight["status"] == "READY",
        "preflight": preflight,
        "schedule": schedule,
    }


def _compute_lr(
    base_lr: float,
    local_step: int,
    total_run_steps: int,
    warmup_steps: int,
    global_step: int,
    schedule_total_steps: int,
    has_exact_optimizer_state: bool,
) -> float:
    if has_exact_optimizer_state:
        progress = min(1.0, max(0.0, global_step / max(1, schedule_total_steps)))
        warm = min(1.0, global_step / max(1, warmup_steps)) if warmup_steps > 0 else 1.0
        return base_lr * warm * (0.1 + 0.9 * 0.5 * (1.0 + math.cos(math.pi * progress)))
    warm = min(1.0, local_step / max(1, warmup_steps))
    progress = min(1.0, local_step / max(1, total_run_steps))
    return base_lr * warm * (0.1 + 0.9 * 0.5 * (1.0 + math.cos(math.pi * progress)))


def _verify_persisted_checkpoint(
    ckpt_path: Path,
    expected_payload_sha256: str,
    expected_params: int,
) -> Dict[str, Any]:
    """Re-read a persisted .pt artifact from disk and cryptographically verify its structure, params, and SHA-256."""
    if not ckpt_path.is_file():
        raise RuntimeError(f"FAIL_CLOSED: persisted checkpoint file missing after save: {ckpt_path}")
    raw_bytes = ckpt_path.read_bytes()
    container_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    audit = inspect_checkpoint(ckpt_path)
    if audit.get("integrity_status") != "STRUCTURAL_CHECKS_PASS":
        raise RuntimeError(
            f"FAIL_CLOSED: persisted checkpoint structural audit failed at {ckpt_path}: {audit.get('errors')}"
        )
    actual_payload_sha = str(audit.get("payload_sha256") or "").lower()
    if actual_payload_sha != expected_payload_sha256.lower():
        raise RuntimeError(
            f"FAIL_CLOSED: persisted checkpoint payload SHA-256 mismatch at {ckpt_path}: "
            f"got {actual_payload_sha}, expected {expected_payload_sha256}"
        )
    actual_params = int((audit.get("metadata") or {}).get("total_params") or 0)
    if expected_params and actual_params != expected_params:
        raise RuntimeError(
            f"FAIL_CLOSED: persisted checkpoint parameter count mismatch at {ckpt_path}: "
            f"got {actual_params}, expected {expected_params}"
        )
    return {
        "path": str(ckpt_path),
        "byte_size": len(raw_bytes),
        "total_params": actual_params,
        "payload_sha256": actual_payload_sha,
        "container_sha256": container_sha256,
        "verified": True,
    }


def run_training(
    *,
    init_checkpoint: Path = DEFAULT_INIT_CHECKPOINT,
    out_checkpoint: Path = DEFAULT_OUT_CHECKPOINT,
    provenance_manifest: Path = DEFAULT_PROVENANCE_MANIFEST,
    evidence_root: Path = DEFAULT_EVIDENCE_ROOT,
    approval_key_file: Optional[str] = None,
    dataset_file: Optional[str] = None,
    evidence_out: Path = DEFAULT_EVIDENCE_OUT,
    resume_state: Optional[Path] = None,
    save_resume_state: Optional[Path] = None,
    target_steps: int = DEFAULT_TARGET_STEPS,
    steps: Optional[int] = None,
    batch: int = 2,
    lr: float = 3e-4,
    weight_decay: float = 0.01,
    warmup_steps: Optional[int] = None,
    eval_every: int = 25,
    save_every: int = 100,
    max_val_windows: int = 128,
    seed: int = 17,
    tokenizer_profile: str = "v2_base",
    human_approval_confirmed: bool = False,
    allow_fresh_init: bool = False,
    probe_s3: bool = False,
    cfg_override: Optional[LMConfig] = None,
    expected_params: int = TARGET_TOTAL_PARAMS,
) -> Dict[str, Any]:
    """Execute governed NativeLM training after all fail-closed gates pass."""
    cfg = cfg_override or LMConfig(
        vocab=TARGET_VOCAB_SIZE,
        d_model=TARGET_D_MODEL,
        n_layers=TARGET_N_LAYERS,
        n_heads=TARGET_N_HEADS,
        d_ffn=TARGET_D_FFN,
        ctx=TARGET_CTX,
    )

    preflight = run_preflight(
        init_checkpoint=init_checkpoint,
        out_checkpoint=out_checkpoint,
        target_steps=target_steps,
        steps=steps,
        tokenizer_profile=tokenizer_profile,
        provenance_manifest=provenance_manifest,
        evidence_root=evidence_root,
        approval_key_file=approval_key_file,
        dataset_file=dataset_file,
        resume_state=resume_state,
        save_resume_state=save_resume_state,
        human_approval_confirmed=human_approval_confirmed,
        allow_fresh_init=allow_fresh_init,
        probe_s3=probe_s3,
        expected_params=expected_params,
        vocab_size=cfg.vocab,
    )
    if preflight["status"] != "READY":
        raise RuntimeError(
            "FAIL_CLOSED: Training readiness gate blocked execution: "
            + ", ".join(preflight["blockers"])
        )

    verify_numpy_backend()
    from qplus_native.training_state import load_resume_bundle, save_resume_bundle

    tok = SovereignTokenizer(cfg.vocab, profile=tokenizer_profile)
    frozen_docs = load_frozen_documents(dataset_file)
    readiness = preflight["dataset_governance"]
    corpus_sha256 = readiness["corpus_sha256"]

    # Strictly separate splits; `test` split MUST NEVER enter training or validation selection.
    train_docs = [{"id": k, **v} for k, v in frozen_docs.items() if v["split"] == "train"]
    val_docs = [{"id": k, **v} for k, v in frozen_docs.items() if v["split"] == "validation"]
    if not train_docs or not val_docs:
        raise RuntimeError("FAIL_CLOSED: verified train and validation documents are both required")

    train_streams = encode_docs(tok, train_docs)
    val_streams = encode_docs(tok, val_docs)

    run_config = {
        "model": cfg.to_dict(),
        "batch": int(batch),
        "lr": float(lr),
        "weight_decay": float(weight_decay),
        "target_steps": int(target_steps),
        "tokenizer_profile": tokenizer_profile,
        "tokenizer_fingerprint": tokenizer_fingerprint(tok, cfg.vocab),
    }

    init_container_sha256: Optional[str] = None
    previous_meta: Dict[str, Any] = {}
    has_exact_optimizer = False

    if resume_state is not None:
        restored = load_resume_bundle(
            resume_state,
            tok,
            expected_corpus_sha256=corpus_sha256,
            expected_configuration=run_config,
        )
        model: NativeLM = restored["model"]
        previous_meta = restored["model_metadata"]
        opt: AdamW = restored["optimizer"]
        rng: np.random.Generator = restored["rng"]
        restored_sched = restored.get("scheduler_state", {})
        start_step = int(
            restored_sched.get("checkpoint_training_steps")
            or previous_meta.get("training_steps_total")
            or restored["global_step"]
        )
        has_exact_optimizer = True
        if init_checkpoint.is_file():
            init_container_sha256 = hashlib.sha256(init_checkpoint.read_bytes()).hexdigest()
    elif init_checkpoint.is_file():
        init_container_sha256 = hashlib.sha256(init_checkpoint.read_bytes()).hexdigest()
        model, previous_meta = NativeLM.load(str(init_checkpoint), tok, dtype=np.float32)
        verify_tokenizer_against_checkpoint(previous_meta, tok, cfg.vocab)
        opt = AdamW(model, lr=lr, weight_decay=weight_decay)
        rng = np.random.default_rng(seed)
        start_step = int(
            previous_meta.get("training_steps_total")
            or previous_meta.get("training_steps")
            or 0
        )
    else:
        if not allow_fresh_init:
            raise RuntimeError(f"FAIL_CLOSED: init checkpoint missing: {init_checkpoint}")
        model = NativeLM(cfg, seed=seed, dtype=np.float32, tokenizer_profile=tokenizer_profile)
        opt = AdamW(model, lr=lr, weight_decay=weight_decay)
        rng = np.random.default_rng(seed)
        start_step = 0

    if expected_params and model.num_params() != expected_params:
        raise RuntimeError(
            f"FAIL_CLOSED: model param count {model.num_params()} != expected {expected_params}"
        )

    run_steps = int(steps) if steps is not None else int(target_steps - start_step)
    if run_steps < 1:
        raise RuntimeError(f"FAIL_CLOSED: non-positive run_steps ({run_steps})")
    eff_warmup = (
        int(warmup_steps)
        if warmup_steps is not None
        else (min(200, max(2, run_steps // 10)) if not has_exact_optimizer else min(100, max(2, target_steps // 20)))
    )

    base_val = eval_loss(model, val_streams, model.cfg.ctx, max_val_windows)
    best_val = base_val
    best_state = {k: v.copy() for k, v in model.p.items()}
    best_step = start_step
    history: List[Dict[str, Any]] = []
    recent_step_durations: Deque[float] = deque(maxlen=10)
    intermediate_checkpoints: List[Dict[str, Any]] = []
    eval_log_path = evidence_out.parent / f"{out_checkpoint.stem}.eval.jsonl"
    eval_log_path.parent.mkdir(parents=True, exist_ok=True)
    if eval_log_path.exists():
        eval_log_path.unlink()
    started = time.time()

    print(
        json.dumps(
            {
                "event": "TARGET_TRAINING_STARTED",
                "params": model.num_params(),
                "start_step": start_step,
                "run_steps": run_steps,
                "target_steps": target_steps,
                "warm_start_steps": 2800,
                "continuation_steps": 3000,
                "eval_every": eval_every,
                "save_every": save_every,
                "eval_evidence_path": str(eval_log_path),
                "warm_start_weights_only": bool(init_checkpoint.is_file() and not has_exact_optimizer),
                "exact_resume_bundle": has_exact_optimizer,
                "val_loss_start": base_val,
                "corpus_sha256": corpus_sha256,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    for local_step in range(1, run_steps + 1):
        step_started = time.perf_counter()
        global_step = start_step + local_step
        step_lr = _compute_lr(
            lr,
            local_step=local_step,
            total_run_steps=run_steps,
            warmup_steps=eff_warmup,
            global_step=global_step,
            schedule_total_steps=max(target_steps, start_step + run_steps),
            has_exact_optimizer_state=has_exact_optimizer,
        )
        x, y = sample_batch(rng, train_streams, batch, model.cfg.ctx)
        logits, cache = model.forward(x, keep_cache=True)
        if not np.all(np.isfinite(logits)):
            raise RuntimeError(f"FAIL_CLOSED: non-finite logits at global_step {global_step}")
        loss, dlogits = NativeLM.ce_loss(logits, y)
        if not math.isfinite(loss) or not np.all(np.isfinite(dlogits)):
            raise RuntimeError(f"FAIL_CLOSED: non-finite loss/dlogits at global_step {global_step}")
        grads = model.backward(dlogits, cache)
        for name, grad in grads.items():
            if not np.all(np.isfinite(grad)):
                raise RuntimeError(f"FAIL_CLOSED: non-finite gradient in {name} at global_step {global_step}")

        grad_norm = opt.step(model, grads, lr=step_lr)
        if not math.isfinite(grad_norm):
            raise RuntimeError(f"FAIL_CLOSED: non-finite grad_norm at global_step {global_step}")
        for name, w in model.p.items():
            if not np.all(np.isfinite(w)):
                raise RuntimeError(f"FAIL_CLOSED: non-finite weight in {name} at global_step {global_step}")

        step_duration_s = round(max(0.0, time.perf_counter() - step_started), 4)
        recent_step_durations.append(step_duration_s)

        if local_step % eval_every == 0 or local_step == run_steps:
            val = eval_loss(model, val_streams, model.cfg.ctx, max_val_windows)
            durations_window = list(recent_step_durations)
            avg_last_10_step_s = (
                round(sum(durations_window) / len(durations_window), 4)
                if durations_window
                else None
            )
            rec = {
                "local_step": local_step,
                "global_step": global_step,
                "train_loss": float(loss),
                "val_loss": float(val),
                "val_perplexity": float(math.exp(min(val, 50.0))) if math.isfinite(val) else None,
                "grad_norm": float(grad_norm),
                "lr": float(step_lr),
                "elapsed_s": round(time.time() - started, 4),
                "step_duration_s": step_duration_s,
                "last_10_step_durations_s": durations_window,
                "avg_last_10_step_s": avg_last_10_step_s,
                "eval_persisted": True,
                "eval_evidence_path": str(eval_log_path),
            }
            history.append(rec)
            with eval_log_path.open("a", encoding="utf-8") as ef:
                ef.write(json.dumps(rec, ensure_ascii=False) + "\n")
            print(json.dumps({"event": "TARGET_TRAINING_PROGRESS", **rec}, ensure_ascii=False), flush=True)
            if math.isfinite(val) and (not math.isfinite(best_val) or val < best_val):
                best_val = val
                best_state = {k: v.copy() for k, v in model.p.items()}
                best_step = global_step

        if save_every > 0 and local_step % save_every == 0 and local_step < run_steps:
            step_ckpt = out_checkpoint.parent / f"{out_checkpoint.stem}.step{global_step}{out_checkpoint.suffix}"
            if step_ckpt.exists():
                raise FileExistsError(f"FAIL_CLOSED: refusing to overwrite periodic checkpoint: {step_ckpt}")
            step_meta = model.save(
                str(step_ckpt),
                tok,
                extra_meta={
                    "training_track": "FULL_TARGET_41_53M",
                    "target_total_params": expected_params or model.num_params(),
                    "target_architecture_instantiated": model.num_params() == TARGET_TOTAL_PARAMS,
                    "training_steps": global_step,
                    "training_steps_total": global_step,
                    "resumed_from_steps": start_step,
                    "init_checkpoint": str(init_checkpoint),
                    "init_checkpoint_sha256": init_container_sha256,
                    "corpus_sha256": corpus_sha256,
                },
            )
            verified_artifact = _verify_persisted_checkpoint(
                step_ckpt,
                str(step_meta["sha256"]),
                int(expected_params or model.num_params()),
            )
            ckpt_entry = {
                **verified_artifact,
                "global_step": global_step,
                "kind": "periodic_verification",
            }
            intermediate_checkpoints.append(ckpt_entry)
            print(
                json.dumps(
                    {
                        "event": "TARGET_CHECKPOINT_PERSISTED",
                        **ckpt_entry,
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )

    final_global_step = start_step + run_steps
    # Save best validation weights only if out_checkpoint still does not exist
    if out_checkpoint.exists():
        raise FileExistsError(f"FAIL_CLOSED: refusing to overwrite output checkpoint: {out_checkpoint}")
    last_state = {k: v.copy() for k, v in model.p.items()}
    model.p = best_state
    final_meta = model.save(
        str(out_checkpoint),
        tok,
        extra_meta={
            "training_track": "FULL_TARGET_41_53M",
            "target_total_params": expected_params or model.num_params(),
            "target_architecture_instantiated": model.num_params() == TARGET_TOTAL_PARAMS,
            "validation_loss": best_val,
            "validation_perplexity": float(math.exp(min(best_val, 50.0))) if math.isfinite(best_val) else None,
            "best_val_step": best_step,
            "training_steps": final_global_step,
            "training_steps_total": final_global_step,
            "resumed_from_steps": start_step,
            "init_checkpoint": str(init_checkpoint),
            "init_checkpoint_sha256": init_container_sha256,
            "corpus_sha256": corpus_sha256,
            "provenance_verified": True,
            "test_split_excluded": True,
        },
    )
    final_verified = _verify_persisted_checkpoint(
        out_checkpoint,
        str(final_meta["sha256"]),
        int(expected_params or model.num_params()),
    )
    out_container_sha256 = final_verified["container_sha256"]
    print(
        json.dumps(
            {
                "event": "TARGET_CHECKPOINT_PERSISTED",
                **final_verified,
                "global_step": final_global_step,
                "kind": "final_verification",
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    resume_bundle_info = None
    if save_resume_state is not None:
        # Save exact last-step optimizer/model/RNG bundle with global_step == opt.t
        model.p = last_state
        scheduler_state = {
            "kind": "cosine_with_warmup",
            "base_lr": float(lr),
            "warmup_steps": eff_warmup,
            "total_steps": int(max(target_steps, final_global_step)),
            "global_step": int(opt.t),
            "checkpoint_training_steps": int(final_global_step),
            "warm_start_offset": int(final_global_step - opt.t),
        }
        resume_bundle_info = save_resume_bundle(
            save_resume_state,
            model,
            tok,
            opt,
            global_step=int(opt.t),
            scheduler_state=scheduler_state,
            rng=rng,
            corpus_sha256=corpus_sha256,
            configuration=run_config,
        )

    evidence = {
        "schema_version": "zyntheor.target-training-evidence.v1",
        "timestamp": int(time.time()),
        "init_checkpoint": str(init_checkpoint),
        "init_checkpoint_sha256": init_container_sha256,
        "checkpoint": str(out_checkpoint),
        "checkpoint_container_sha256": out_container_sha256,
        "checkpoint_payload_sha256": final_meta["sha256"],
        "params": model.num_params(),
        "target_params": expected_params or model.num_params(),
        "tokenizer_profile": tokenizer_profile,
        "tokenizer_fingerprint": tokenizer_fingerprint(tok, cfg.vocab),
        "start_step": start_step,
        "final_step": final_global_step,
        "best_val_step": best_step,
        "best_val_loss": best_val,
        "corpus_sha256": corpus_sha256,
        "intermediate_checkpoints": intermediate_checkpoints,
        "resume_bundle": resume_bundle_info,
        "history": history,
    }
    evidence_out.parent.mkdir(parents=True, exist_ok=True)
    evidence_out.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"event": "TARGET_TRAINING_COMPLETE", **evidence}, ensure_ascii=False), flush=True)
    return evidence


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Governed NativeLM 41.53M Training Continuation Runner")
    ap.add_argument("--init", default=str(DEFAULT_INIT_CHECKPOINT), help="Source checkpoint path (never overwritten)")
    ap.add_argument("--out", default=str(DEFAULT_OUT_CHECKPOINT), help="New destination checkpoint path")
    ap.add_argument("--target-steps", type=int, default=DEFAULT_TARGET_STEPS)
    ap.add_argument("--steps", type=int, default=None, help="Explicit number of additional steps to run")
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--weight-decay", type=float, default=0.01)
    ap.add_argument("--warmup-steps", type=int, default=None)
    ap.add_argument("--eval-every", type=int, default=25)
    ap.add_argument("--save-every", type=int, default=100)
    ap.add_argument("--max-val-windows", type=int, default=128)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--tokenizer-profile", default="v2_base", choices=["v2_base", "bilingual_v4"])
    ap.add_argument("--dataset-provenance", default=str(DEFAULT_PROVENANCE_MANIFEST))
    ap.add_argument("--evidence-root", default=str(DEFAULT_EVIDENCE_ROOT))
    ap.add_argument("--approval-key-file", default=os.environ.get("ZYNTHEOR_APPROVAL_KEY_FILE"))
    ap.add_argument("--dataset-file", default=None, help="JSON/JSONL dataset file matching provenance manifest")
    ap.add_argument("--resume-state", default=None, help="Optional .bundle for exact optimizer/RNG/scheduler resume")
    ap.add_argument("--save-resume-state", default=None, help="Optional output .bundle path")
    ap.add_argument("--evidence-out", default=str(DEFAULT_EVIDENCE_OUT))
    ap.add_argument("--human-approval-confirmed", action="store_true", help="Explicit human approval gate")
    ap.add_argument("--allow-fresh-init", action="store_true", help="Allow training without existing --init checkpoint")
    ap.add_argument("--probe-s3", action="store_true", help="Probe S3/cloud checkpoint connectivity during preflight")
    ap.add_argument("--preflight-only", action="store_true", help="Run readiness gates only and exit without training")
    return ap


def main(argv: Optional[List[str]] = None) -> int:
    ap = build_arg_parser()
    args = ap.parse_args(argv)

    if args.preflight_only:
        report = run_preflight(
            init_checkpoint=Path(args.init),
            out_checkpoint=Path(args.out),
            target_steps=args.target_steps,
            steps=args.steps,
            tokenizer_profile=args.tokenizer_profile,
            provenance_manifest=Path(args.dataset_provenance),
            evidence_root=Path(args.evidence_root),
            approval_key_file=args.approval_key_file,
            dataset_file=args.dataset_file,
            resume_state=Path(args.resume_state) if args.resume_state else None,
            save_resume_state=Path(args.save_resume_state) if args.save_resume_state else None,
            human_approval_confirmed=args.human_approval_confirmed,
            allow_fresh_init=args.allow_fresh_init,
            probe_s3=args.probe_s3,
        )
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if report["status"] == "READY" else 2

    try:
        run_training(
            init_checkpoint=Path(args.init),
            out_checkpoint=Path(args.out),
            provenance_manifest=Path(args.dataset_provenance),
            evidence_root=Path(args.evidence_root),
            approval_key_file=args.approval_key_file,
            dataset_file=args.dataset_file,
            evidence_out=Path(args.evidence_out),
            resume_state=Path(args.resume_state) if args.resume_state else None,
            save_resume_state=Path(args.save_resume_state) if args.save_resume_state else None,
            target_steps=args.target_steps,
            steps=args.steps,
            batch=args.batch,
            lr=args.lr,
            weight_decay=args.weight_decay,
            warmup_steps=args.warmup_steps,
            eval_every=args.eval_every,
            save_every=args.save_every,
            max_val_windows=args.max_val_windows,
            seed=args.seed,
            tokenizer_profile=args.tokenizer_profile,
            human_approval_confirmed=args.human_approval_confirmed,
            allow_fresh_init=args.allow_fresh_init,
            probe_s3=args.probe_s3,
        )
        return 0
    except Exception as exc:
        sys.stderr.write(f"{exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
