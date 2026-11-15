# -*- coding: utf-8 -*-
"""Safe NativeLM resume bundle; no pickle, exact state arrays, and no overwrite."""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, Mapping

import numpy as np

from qplus_native.dataset_governance import canonical_json
from qplus_native.lm_v2 import AdamW, NativeLM, tokenizer_fingerprint

BUNDLE_VERSION = 1
MAGIC_MEMBER = "zyntheor-resume-v1"
REQUIRED_MEMBERS = {"bundle.json", "weights.pt", "model_state.npz", "optimizer.npz", "training.json"}
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_BUNDLE_BYTES = 512 * 1024 * 1024


def config_fingerprint(config: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(config)).hexdigest()


def corpus_hash_valid(value: str) -> bool:
    return isinstance(value, str) and bool(_SHA256.fullmatch(value))


def save_resume_bundle(
    path: str | os.PathLike[str], model: NativeLM, tokenizer, optimizer: AdamW,
    *, global_step: int, scheduler_state: Mapping[str, Any], rng: np.random.Generator,
    corpus_sha256: str, configuration: Mapping[str, Any],
) -> Dict[str, Any]:
    """Write an immutable bundle. Destination must not already exist."""
    target = Path(path)
    if target.exists():
        raise FileExistsError(f"refusing to overwrite resume bundle: {target}")
    if global_step < 0 or optimizer.t < 0:
        raise ValueError("global_step and optimizer.t must be non-negative")
    if not corpus_hash_valid(corpus_sha256):
        raise ValueError("corpus_sha256 must be lowercase SHA-256")
    if not isinstance(scheduler_state, Mapping) or not isinstance(configuration, Mapping):
        raise TypeError("scheduler_state and configuration must be mappings")
    if int(scheduler_state.get("global_step", global_step)) != global_step:
        raise ValueError("scheduler global_step must match bundle global_step")
    if optimizer.t != global_step:
        raise ValueError("AdamW step counter must match global_step for exact resume")
    if type(rng.bit_generator).__name__ != "PCG64":
        raise ValueError("only PCG64 RNG state is supported")
    names = model.param_names()
    if set(optimizer.m) != set(names) or set(optimizer.v) != set(names):
        raise ValueError("optimizer tensors do not match model parameter names")

    weights, _ = model.to_bytes(tokenizer, extra_meta={"training_state_bundle_version": BUNDLE_VERSION})
    model_buffer, opt_buffer = io.BytesIO(), io.BytesIO()
    model_arrays: Dict[str, np.ndarray] = {}
    opt_arrays: Dict[str, np.ndarray] = {}
    model_manifest, opt_manifest = [], []
    for i, name in enumerate(names):
        p_arr = np.asarray(model.p[name])
        m_arr, v_arr = np.asarray(optimizer.m[name]), np.asarray(optimizer.v[name])
        if m_arr.shape != p_arr.shape or v_arr.shape != p_arr.shape:
            raise ValueError(f"optimizer tensor shape mismatch for {name}")
        if not np.isfinite(p_arr).all() or not np.isfinite(m_arr).all() or not np.isfinite(v_arr).all():
            raise ValueError(f"non-finite model/optimizer state for {name}")
        model_arrays[f"p_{i}"] = p_arr
        opt_arrays[f"m_{i}"] = m_arr
        opt_arrays[f"v_{i}"] = v_arr
        model_manifest.append({"name": name, "shape": list(p_arr.shape), "dtype": str(p_arr.dtype)})
        opt_manifest.append({"name": name, "shape": list(m_arr.shape), "dtype_m": str(m_arr.dtype), "dtype_v": str(v_arr.dtype)})
    np.savez(model_buffer, **model_arrays)
    np.savez(opt_buffer, **opt_arrays)

    training_state = {
        "bundle_version": BUNDLE_VERSION,
        "global_step": int(global_step),
        "optimizer": {"lr": float(optimizer.lr), "weight_decay": float(optimizer.wd),
                      "betas": [float(optimizer.b1), float(optimizer.b2)], "eps": float(optimizer.eps), "t": int(optimizer.t)},
        "scheduler_state": dict(scheduler_state),
        "rng_state": rng.bit_generator.state,
        "rng_bit_generator": type(rng.bit_generator).__name__,
        "corpus_sha256": corpus_sha256,
        "configuration": dict(configuration),
        "configuration_sha256": config_fingerprint(configuration),
        "model_configuration": model.cfg.to_dict(),
        "model_dtype": str(np.dtype(model.dtype)),
        "tokenizer_fingerprint": tokenizer_fingerprint(tokenizer, model.cfg.vocab),
        "model_manifest": model_manifest,
        "optimizer_manifest": opt_manifest,
    }
    chunks = {
        "weights.pt": weights,
        "model_state.npz": model_buffer.getvalue(),
        "optimizer.npz": opt_buffer.getvalue(),
        "training.json": json.dumps(training_state, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"),
    }
    bundle = {"bundle_version": BUNDLE_VERSION, "magic": MAGIC_MEMBER,
              "member_sha256": {k: hashlib.sha256(v).hexdigest() for k, v in chunks.items()},
              "configuration_sha256": training_state["configuration_sha256"],
              "corpus_sha256": corpus_sha256, "global_step": global_step}
    chunks["bundle.json"] = json.dumps(bundle, sort_keys=True, separators=(",", ":")).encode("utf-8")

    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent))
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp_name, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            for name, payload in chunks.items():
                zf.writestr(name, payload)
        # Link creation is atomic and fails if destination already exists.
        os.link(tmp_name, target)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
    return {"path": str(target), "bundle_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "configuration_sha256": training_state["configuration_sha256"], "corpus_sha256": corpus_sha256,
            "global_step": global_step}


def load_resume_bundle(
    path: str | os.PathLike[str], tokenizer, *, expected_corpus_sha256: str,
    expected_configuration: Mapping[str, Any],
) -> Dict[str, Any]:
    """Load/verify every member and restore exact model, optimizer, scheduler, RNG, and step state."""
    p = Path(path)
    if p.stat().st_size > MAX_BUNDLE_BYTES:
        raise ValueError("resume bundle exceeds size limit")
    try:
        with zipfile.ZipFile(p, "r") as zf:
            infos = zf.infolist()
            names = [i.filename for i in infos]
            if len(names) != len(set(names)) or set(names) != REQUIRED_MEMBERS:
                raise ValueError("resume bundle member list is invalid")
            if any(i.file_size > MAX_BUNDLE_BYTES for i in infos):
                raise ValueError("resume bundle member exceeds size limit")
            if any(i.filename.startswith("/") or ".." in Path(i.filename).parts for i in infos):
                raise ValueError("unsafe resume bundle member path")
            contents = {n: zf.read(n) for n in names}
    except zipfile.BadZipFile as exc:
        raise ValueError("resume bundle is not a valid ZIP") from exc
    bundle = json.loads(contents["bundle.json"].decode("utf-8"))
    if bundle.get("magic") != MAGIC_MEMBER or bundle.get("bundle_version") != BUNDLE_VERSION:
        raise ValueError("unsupported resume bundle version/magic")
    for name in REQUIRED_MEMBERS - {"bundle.json"}:
        if hashlib.sha256(contents[name]).hexdigest() != bundle.get("member_sha256", {}).get(name):
            raise ValueError(f"resume bundle SHA-256 mismatch: {name}")
    state = json.loads(contents["training.json"].decode("utf-8"))
    if state.get("bundle_version") != BUNDLE_VERSION:
        raise ValueError("training state version mismatch")
    if state.get("corpus_sha256") != expected_corpus_sha256 or bundle.get("corpus_sha256") != expected_corpus_sha256:
        raise ValueError("corpus hash mismatch")
    expected_hash = config_fingerprint(expected_configuration)
    if state.get("configuration_sha256") != expected_hash or bundle.get("configuration_sha256") != expected_hash:
        raise ValueError("configuration hash mismatch")
    if config_fingerprint(state.get("configuration", {})) != expected_hash:
        raise ValueError("configuration content/hash mismatch")

    model, model_meta = NativeLM.load_bytes(contents["weights.pt"], tokenizer)
    if model.cfg.to_dict() != state.get("model_configuration"):
        raise ValueError("model configuration mismatch")
    try:
        model.dtype = np.dtype(state["model_dtype"])
    except (KeyError, TypeError) as exc:
        raise ValueError("model dtype missing or invalid") from exc
    if tokenizer_fingerprint(tokenizer, model.cfg.vocab) != state.get("tokenizer_fingerprint"):
        raise ValueError("tokenizer fingerprint mismatch")

    model_manifest = state.get("model_manifest", [])
    if len(model_manifest) != len(model.param_names()):
        raise ValueError("model state manifest tensor count mismatch")
    with np.load(io.BytesIO(contents["model_state.npz"]), allow_pickle=False) as arrays:
        expected_keys = {f"p_{i}" for i in range(len(model_manifest))}
        if set(arrays.files) != expected_keys:
            raise ValueError("model state archive keys mismatch")
        for i, entry in enumerate(model_manifest):
            name = entry["name"]
            if name not in model.p:
                raise ValueError("model state parameter name mismatch")
            p_arr = arrays[f"p_{i}"]
            shape = tuple(entry["shape"])
            if p_arr.shape != shape or shape != model.p[name].shape or str(p_arr.dtype) != entry["dtype"]:
                raise ValueError(f"model state shape/dtype mismatch: {name}")
            if not np.isfinite(p_arr).all():
                raise ValueError(f"non-finite model state: {name}")
            model.p[name] = p_arr.copy()

    opt_state = state["optimizer"]
    optimizer = AdamW(model, lr=float(opt_state["lr"]), weight_decay=float(opt_state["weight_decay"]),
                      betas=tuple(float(x) for x in opt_state["betas"]), eps=float(opt_state["eps"]))
    optimizer.t = int(opt_state["t"])
    manifest = state.get("optimizer_manifest", [])
    if len(manifest) != len(model.param_names()):
        raise ValueError("optimizer manifest tensor count mismatch")
    with np.load(io.BytesIO(contents["optimizer.npz"]), allow_pickle=False) as arrays:
        expected_keys = {f"{prefix}_{i}" for i in range(len(manifest)) for prefix in ("m", "v")}
        if set(arrays.files) != expected_keys:
            raise ValueError("optimizer archive keys mismatch")
        for i, entry in enumerate(manifest):
            name = entry["name"]
            if name not in model.p:
                raise ValueError("optimizer parameter name mismatch")
            m_arr, v_arr = arrays[f"m_{i}"], arrays[f"v_{i}"]
            shape = tuple(entry["shape"])
            if m_arr.shape != shape or v_arr.shape != shape or shape != model.p[name].shape:
                raise ValueError(f"optimizer tensor shape mismatch: {name}")
            if str(m_arr.dtype) != entry["dtype_m"] or str(v_arr.dtype) != entry["dtype_v"]:
                raise ValueError(f"optimizer dtype mismatch: {name}")
            if not np.isfinite(m_arr).all() or not np.isfinite(v_arr).all():
                raise ValueError(f"non-finite optimizer state: {name}")
            optimizer.m[name], optimizer.v[name] = m_arr.copy(), v_arr.copy()
    global_step = int(state["global_step"])
    if optimizer.t != global_step:
        raise ValueError("AdamW/global step mismatch")
    if state.get("rng_bit_generator") != "PCG64":
        raise ValueError("unsupported RNG bit generator")
    rng = np.random.default_rng()
    rng.bit_generator.state = state["rng_state"]
    scheduler_state = state.get("scheduler_state")
    if not isinstance(scheduler_state, dict) or int(scheduler_state.get("global_step", -1)) != global_step:
        raise ValueError("scheduler/global step mismatch")
    return {"model": model, "model_metadata": model_meta, "optimizer": optimizer,
            "scheduler_state": scheduler_state, "rng": rng, "global_step": global_step,
            "corpus_sha256": state["corpus_sha256"], "configuration": state["configuration"],
            "configuration_sha256": state["configuration_sha256"],
            "bundle_sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
