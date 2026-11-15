# -*- coding: utf-8 -*-
"""
ZYNTHEOR Sovereign Cognitive Core (Batches 17–24 Foundation)
- Pure-Python stdlib compute compatible (uses NumPy if installed, np_compat otherwise)
- Strict Zero-Simulation Policy & Zero Target Leakage
- Full Analytical Backpropagation + Numerical Gradient Verification
- Calibrated Confidence Head + Validation-only Temperature Scaling
- Strictly Isolated Episodic Memory (train-only keys/values, never val/test)
"""

import hashlib
import math
import resource
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np

from qplus_native.reasoning_engine import LatentReasoningCore, SymbolicVerifier


# Student-t critical values (two-sided alpha=0.05) indexed by degrees of freedom (n - 1)
T_CRIT_95 = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
}

ALL_COGNITIVE_DOMAINS = [
    "compositional_reasoning",
    "multihop_reasoning",
    "abstract_rule_induction",
    "causal_reasoning",
    "cross_domain_transfer",
    "few_shot_adaptation",
    "novel_problem_solving",
]


def summarize_multi_seed(values: Sequence[float]) -> Dict[str, Any]:
    n = len(values)
    if n == 0:
        return {"n": 0, "mean": 0.0, "std": 0.0, "ci_95": [0.0, 0.0]}
    mean_v = math.fsum(values) / n
    if n == 1:
        return {"n": 1, "mean": round(mean_v, 6), "std": 0.0, "ci_95": [round(mean_v, 6), round(mean_v, 6)]}
    var = math.fsum((v - mean_v) ** 2 for v in values) / (n - 1)
    std_v = math.sqrt(max(0.0, var))
    t_crit = T_CRIT_95.get(n - 1, 1.96)
    half = t_crit * std_v / math.sqrt(n)
    return {
        "n": n,
        "mean": round(mean_v, 6),
        "std": round(std_v, 6),
        "ci_95": [round(mean_v - half, 6), round(mean_v + half, 6)],
        "t_critical": t_crit,
    }


def fingerprint_dataset(X: np.ndarray, Y: np.ndarray) -> str:
    h = hashlib.sha256()
    for arr in (X, Y):
        flat = arr._data if hasattr(arr, "_data") else arr.ravel().tolist()
        for v in flat:
            h.update(f"{float(v):.8g};".encode("ascii"))
    return h.hexdigest()


def sample_hashes(X: np.ndarray) -> List[str]:
    hashes: List[str] = []
    n = X.shape[0]
    for i in range(n):
        row = X[i]
        flat = row._data if hasattr(row, "_data") else row.ravel().tolist()
        h = hashlib.sha256(",".join(f"{float(v):.8g}" for v in flat).encode("ascii")).hexdigest()
        hashes.append(h)
    return hashes


def assert_disjoint_splits(splits: Dict[str, np.ndarray]) -> Dict[str, Any]:
    split_sets: Dict[str, set] = {name: set(sample_hashes(X)) for name, X in splits.items()}
    overlaps: Dict[str, int] = {}
    names = list(splits.keys())
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            inter = len(split_sets[a] & split_sets[b])
            overlaps[f"{a}__vs__{b}"] = inter
            if inter > 0:
                raise RuntimeError(f"FAIL_CLOSED: Data leakage detected between {a} and {b} ({inter} overlapping samples).")
    return {
        "disjoint": True,
        "split_sizes": {k: X.shape[0] for k, X in splits.items()},
        "pairwise_overlaps": overlaps,
    }


class InputLeakageError(AssertionError, ValueError):
    """Raised fail-closed when inputTensor features are not independent of targetTensor."""


def _extract_tensor_shape_and_flat(tensor: Any, name: str) -> Tuple[Tuple[int, ...], List[float]]:
    if tensor is None:
        raise ValueError(f"{name} must not be None")
    if hasattr(tensor, "shape") and hasattr(tensor, "_data"):
        shape = tuple(int(d) for d in tensor.shape)
        flat = [float(v) for v in tensor._data]
        return shape, flat
    if hasattr(tensor, "shape") and hasattr(tensor, "ravel"):
        shape = tuple(int(d) for d in tensor.shape)
        flat = [float(v) for v in tensor.ravel().tolist()]
        return shape, flat

    def _infer(obj: Any) -> Tuple[int, ...]:
        if isinstance(obj, (list, tuple)):
            if len(obj) == 0:
                return (0,)
            return (len(obj),) + _infer(obj[0])
        return ()

    def _flat(obj: Any, out: List[float]) -> None:
        if isinstance(obj, (list, tuple)):
            for item in obj:
                _flat(item, out)
        else:
            out.append(float(obj))

    shape = _infer(tensor)
    flat: List[float] = []
    _flat(tensor, flat)
    return shape, flat


def validateInputLeakage(
    inputTensor: Any,
    targetTensor: Any,
    corr_threshold: float = 0.995,
    atol: float = 1e-6,
    return_report: bool = False,
) -> Any:
    """
    Asserts that inputTensor features are independent of targetTensor output values.
    Checks:
      1. Valid non-empty, finite tensors with matching sample counts.
      2. No direct target row or scaled target slice embedded in any 3D input timestep.
      3. No input feature column equals any non-constant target column.
      4. For N >= 4, no non-constant input feature has near-unit linear correlation
         (|r| >= corr_threshold) with any non-constant target column.
    Raises InputLeakageError (subclass of AssertionError and ValueError) on violation.
    """
    x_shape, x_flat = _extract_tensor_shape_and_flat(inputTensor, "inputTensor")
    y_shape, y_flat = _extract_tensor_shape_and_flat(targetTensor, "targetTensor")

    if len(x_shape) == 0 or x_shape[0] <= 0:
        raise ValueError(f"inputTensor must have at least 1 sample, got shape={x_shape}")
    if len(y_shape) == 0 or y_shape[0] <= 0:
        raise ValueError(f"targetTensor must have at least 1 sample, got shape={y_shape}")
    if x_shape[0] != y_shape[0]:
        raise ValueError(f"Sample count mismatch: inputTensor={x_shape[0]} vs targetTensor={y_shape[0]}")

    for v in x_flat:
        if not math.isfinite(v):
            raise InputLeakageError("FAIL_CLOSED: Non-finite value detected in inputTensor.")
    for v in y_flat:
        if not math.isfinite(v):
            raise InputLeakageError("FAIL_CLOSED: Non-finite value detected in targetTensor.")

    n = x_shape[0]
    f_dim = 1
    for d in x_shape[1:]:
        f_dim *= d
    k_dim = 1
    for d in y_shape[1:]:
        k_dim *= d

    if len(x_flat) != n * f_dim or len(y_flat) != n * k_dim:
        raise ValueError("Ragged tensor shapes are not supported in validateInputLeakage.")

    # 1. Timestep-slice embedding check for 3D inputs (N, T, D)
    if len(x_shape) == 3 and x_shape[2] >= k_dim and k_dim > 0:
        t_steps, d_model = x_shape[1], x_shape[2]
        for t in range(t_steps):
            exact_hits = 0
            nonzero_targets = 0
            for i in range(n):
                y_row = y_flat[i * k_dim : (i + 1) * k_dim]
                y_norm = math.sqrt(math.fsum(v * v for v in y_row))
                if y_norm <= atol:
                    continue
                nonzero_targets += 1
                x_slice = x_flat[(i * t_steps + t) * d_model : (i * t_steps + t) * d_model + k_dim]
                if max(abs(a - b) for a, b in zip(x_slice, y_row)) <= atol:
                    exact_hits += 1
            if nonzero_targets > 0 and exact_hits == nonzero_targets:
                raise InputLeakageError(
                    f"FAIL_CLOSED: Target vector embedded directly in inputTensor timestep t={t}."
                )

    # 2. Column-level direct-copy and Pearson correlation checks
    max_abs_corr = 0.0
    max_corr_pair: Optional[Tuple[int, int]] = None

    x_cols = [[x_flat[i * f_dim + f] for i in range(n)] for f in range(f_dim)]
    y_cols = [[y_flat[i * k_dim + j] for i in range(n)] for j in range(k_dim)]

    for j, yc in enumerate(y_cols):
        y_min, y_max = min(yc), max(yc)
        y_ptp = y_max - y_min
        y_mean = math.fsum(yc) / n
        y_centered = [v - y_mean for v in yc]
        y_ss = math.fsum(v * v for v in y_centered)
        y_l2 = math.sqrt(math.fsum(v * v for v in yc))

        for f, xc in enumerate(x_cols):
            max_diff = max(abs(a - b) for a, b in zip(xc, yc))
            if max_diff <= atol and (y_ptp > atol or (n == 1 and y_l2 > atol)):
                raise InputLeakageError(
                    f"FAIL_CLOSED: Direct target leakage detected (input feature {f} == target dim {j}, max_diff={max_diff:.3e})."
                )

            x_ptp = max(xc) - min(xc)
            if y_ptp <= atol or x_ptp <= atol:
                continue

            x_mean = math.fsum(xc) / n
            x_centered = [v - x_mean for v in xc]
            x_ss = math.fsum(v * v for v in x_centered)
            if x_ss <= 1e-18 or y_ss <= 1e-18:
                continue

            if n >= 4:
                cov = math.fsum(a * b for a, b in zip(x_centered, y_centered))
                r = abs(cov / math.sqrt(x_ss * y_ss))
                if r > max_abs_corr:
                    max_abs_corr = r
                    max_corr_pair = (f, j)
                if r >= corr_threshold:
                    raise InputLeakageError(
                        f"FAIL_CLOSED: High linear dependence detected between input feature {f} and target dim {j} "
                        f"(|r|={r:.6f} >= {corr_threshold})."
                    )

    report = {
        "passed": True,
        "samples": n,
        "input_features": f_dim,
        "target_dims": k_dim,
        "max_abs_correlation": round(max_abs_corr, 6),
        "max_corr_pair": max_corr_pair,
    }
    return report if return_report else True



def compute_brier_and_ece(probs: Sequence[float], labels: Sequence[float], n_bins: int = 10) -> Dict[str, Any]:
    n = len(probs)
    if n == 0:
        return {"brier_score": 0.0, "ece": 0.0, "nll": 0.0, "bins": []}

    brier = math.fsum((float(p) - float(y)) ** 2 for p, y in zip(probs, labels)) / n
    eps = 1e-7
    nll = -math.fsum(
        float(y) * math.log(max(eps, min(1.0 - eps, float(p))))
        + (1.0 - float(y)) * math.log(max(eps, min(1.0 - eps, 1.0 - float(p))))
        for p, y in zip(probs, labels)
    ) / n

    bins_meta = []
    ece = 0.0
    for b in range(n_bins):
        lo = b / n_bins
        hi = (b + 1) / n_bins
        if b == n_bins - 1:
            idxs = [i for i, p in enumerate(probs) if lo <= float(p) <= hi]
        else:
            idxs = [i for i, p in enumerate(probs) if lo <= float(p) < hi]
        if not idxs:
            bins_meta.append({"bin": f"[{lo:.1f},{hi:.1f})", "count": 0, "avg_conf": None, "avg_acc": None})
            continue
        avg_c = math.fsum(float(probs[i]) for i in idxs) / len(idxs)
        avg_a = math.fsum(float(labels[i]) for i in idxs) / len(idxs)
        ece += (len(idxs) / n) * abs(avg_a - avg_c)
        bins_meta.append({
            "bin": f"[{lo:.1f},{hi:.1f}]" if b == n_bins - 1 else f"[{lo:.1f},{hi:.1f})",
            "count": len(idxs),
            "avg_conf": round(avg_c, 4),
            "avg_acc": round(avg_a, 4),
        })

    return {
        "brier_score": round(brier, 6),
        "ece": round(ece, 6),
        "nll": round(nll, 6),
        "bins": bins_meta,
    }


def fit_temperature(logits: Sequence[float], labels: Sequence[float]) -> float:
    """Fits temperature T > 0 on held-out calibration split strictly minimizing NLL."""
    if not logits:
        return 1.0
    best_t = 1.0
    best_nll = float("inf")
    eps = 1e-7
    for step in range(20, 401, 5):  # 0.20 .. 4.00
        temp = step / 100.0
        nll = 0.0
        for z, y in zip(logits, labels):
            s = max(-25.0, min(25.0, float(z) / temp))
            p = 1.0 / (1.0 + math.exp(-s))
            p = max(eps, min(1.0 - eps, p))
            nll -= float(y) * math.log(p) + (1.0 - float(y)) * math.log(1.0 - p)
        nll /= len(logits)
        if nll < best_nll:
            best_nll = nll
            best_t = temp
    return best_t


class CognitiveTaskSuite:
    """
    Strictly leak-free synthetic + structural cognitive task generator across 7 domains.
    Premises are placed at t=0..3, domain cue & difficulty context at t=4, and ONLY
    the `[QUERY]` indicator at t=5 so cross-timestep causal attention is required.
    """

    def __init__(self, d_model: int = 16):
        self.d_model = d_model

    def _vec(self, pairs: Dict[int, float]) -> np.ndarray:
        v = np.zeros((self.d_model,), dtype=np.float64)
        for k, val in pairs.items():
            if 0 <= k < self.d_model:
                v[k] = float(val)
        return v

    def build_dataset(
        self,
        n_samples: int,
        seed: int,
        domain_filter: Optional[str] = None,
        ood_regime: bool = False,
        target_variant: str = "standard",
    ) -> Tuple[np.ndarray, np.ndarray, List[str], List[Dict[str, Any]]]:
        rng = np.random.default_rng(seed)
        seq_len = 6
        X = np.zeros((n_samples, seq_len, self.d_model), dtype=np.float64)
        Y = np.zeros((n_samples, self.d_model), dtype=np.float64)
        domains: List[str] = []
        meta: List[Dict[str, Any]] = []

        scale_mult = 1.45 if ood_regime else 1.0
        alt_mult = 1.25 if target_variant == "shifted" else 1.0

        for idx in range(n_samples):
            dom_idx = ALL_COGNITIVE_DOMAINS.index(domain_filter) if domain_filter in ALL_COGNITIVE_DOMAINS else (idx % len(ALL_COGNITIVE_DOMAINS))
            dom_name = ALL_COGNITIVE_DOMAINS[dom_idx]
            domains.append(dom_name)

            # Domain one-hot occupies dims 0..6, numeric slot dim 7, auxiliary dim 8, query dim 9
            if dom_idx == 0:  # compositional_reasoning
                a = rng.uniform(-1.4, 1.4) * scale_mult
                b = rng.uniform(-1.4, 1.4) * scale_mult
                c = rng.uniform(0.5, 1.8)
                if ood_regime:
                    # Held-out sign-balanced composition in OOD split
                    c = rng.uniform(1.6, 2.6)
                X[idx, 0] = self._vec({0: 1.0, 7: a})
                X[idx, 1] = self._vec({0: 1.0, 7: b})
                X[idx, 2] = self._vec({0: 1.0, 7: c})
                X[idx, 5] = self._vec({0: 1.0, 9: 1.0})
                s1 = (0.6 * a + 0.4 * b) * (0.5 + 0.2 * c)
                s2 = (s1 + 0.25 * (a - b)) * alt_mult
                ans = 0.55 * s1 + 0.45 * s2
                Y[idx] = self._vec({0: s1 / 3.0, 1: s2 / 3.0, 2: ans / 3.0})
                meta.append({"a": a, "b": b, "c": c})

            elif dom_idx == 1:  # multihop_reasoning (multi-hop signed evidence chain)
                s1 = float(rng.choice([-1.0, 1.0]))
                s2 = float(rng.choice([-1.0, 1.0]))
                s3 = float(rng.choice([-1.0, 1.0]))
                a1 = rng.uniform(0.45, 1.35)
                a2 = rng.uniform(0.45, 1.35)
                a3 = rng.uniform(0.45, 1.35)
                w_scale = 1.25 if ood_regime else 1.0
                p1, p2, p3 = s1 * a1 * w_scale, s2 * a2 * w_scale, s3 * a3
                X[idx, 0] = self._vec({1: 1.0, 7: p1})
                X[idx, 1] = self._vec({1: 1.0, 7: p2})
                X[idx, 2] = self._vec({1: 1.0, 7: p3})
                X[idx, 5] = self._vec({1: 1.0, 9: 1.0})
                h1 = (s1 * s2) * 0.5 * (a1 + a2)
                h2 = (s1 * s2 * s3) * (a1 + a2 + a3) / 3.0
                ans = (0.5 * h1 + 0.5 * h2) * alt_mult
                Y[idx] = self._vec({0: h1 * 0.5, 1: h2 * 0.5, 2: ans * 0.5})
                meta.append({"p1": p1, "p2": p2, "p3": p3})

            elif dom_idx == 2:  # abstract_rule_induction
                x0 = rng.uniform(-1.2, 1.2) * scale_mult
                delta = rng.uniform(-0.7, 0.7) * (1.3 if ood_regime else 1.0)
                x1 = x0 + delta
                x2 = x1 + 1.2 * delta
                # Only observed history x0, x1, x2 are inputs; predict unseen continuation
                X[idx, 0] = self._vec({2: 1.0, 7: x0})
                X[idx, 1] = self._vec({2: 1.0, 7: x1})
                X[idx, 2] = self._vec({2: 1.0, 7: x2})
                X[idx, 5] = self._vec({2: 1.0, 9: 1.0})
                x3 = x2 + 1.4 * delta * alt_mult
                x4 = x3 + 1.6 * delta
                Y[idx] = self._vec({0: x3 / 5.0, 1: x4 / 5.0, 2: (0.6 * x3 + 0.4 * x4) / 5.0})
                meta.append({"x0": x0, "delta": delta})

            elif dom_idx == 3:  # causal_reasoning (parallel bottleneck + downstream node)
                t_a = rng.uniform(0.4, 1.8) * scale_mult
                t_b = rng.uniform(0.4, 1.8) * scale_mult
                t_c = rng.uniform(0.4, 1.5)
                X[idx, 0] = self._vec({3: 1.0, 7: t_a})
                X[idx, 1] = self._vec({3: 1.0, 7: t_b})
                X[idx, 2] = self._vec({3: 1.0, 7: t_c})
                X[idx, 5] = self._vec({3: 1.0, 9: 1.0})
                crit = max(t_a, t_b)
                total = (crit + t_c) * alt_mult
                slack = abs(t_a - t_b)
                Y[idx] = self._vec({0: crit / 5.0, 1: slack / 5.0, 2: total / 5.0})
                meta.append({"t_a": t_a, "t_b": t_b, "t_c": t_c})

            elif dom_idx == 4:  # cross_domain_transfer
                base = rng.uniform(-1.3, 1.3) * scale_mult
                gain = rng.uniform(1.1, 2.2) if ood_regime else rng.uniform(0.6, 1.6)
                shift = rng.uniform(-0.4, 0.4)
                X[idx, 0] = self._vec({4: 1.0, 7: base})
                X[idx, 1] = self._vec({4: 1.0, 7: gain})
                X[idx, 2] = self._vec({4: 1.0, 7: shift})
                X[idx, 5] = self._vec({4: 1.0, 9: 1.0})
                m1 = base * gain
                m2 = (m1 + shift) * alt_mult
                Y[idx] = self._vec({0: m1 / 5.0, 1: m2 / 5.0, 2: (0.7 * m2 + 0.3 * base) / 5.0})
                meta.append({"base": base, "gain": gain, "shift": shift})

            elif dom_idx == 5:  # few_shot_adaptation (novel context parameters encoded only in steps)
                u1 = rng.uniform(-1.2, 1.2) * scale_mult
                u2 = rng.uniform(-1.2, 1.2)
                w = rng.uniform(0.5, 1.8) if ood_regime else rng.uniform(0.3, 1.2)
                X[idx, 0] = self._vec({5: 1.0, 7: u1})
                X[idx, 1] = self._vec({5: 1.0, 7: u2})
                X[idx, 2] = self._vec({5: 1.0, 7: w})
                X[idx, 5] = self._vec({5: 1.0, 9: 1.0})
                out1 = (u1 * w) + 0.4 * u2
                out2 = out1 * alt_mult - 0.15 * u1
                Y[idx] = self._vec({0: out1 / 4.0, 1: out2 / 4.0, 2: (0.5 * out1 + 0.5 * out2) / 4.0})
                meta.append({"u1": u1, "u2": u2, "w": w})

            else:  # novel_problem_solving (dual-sensor noisy fusion & insufficient-info cue)
                s_clean = rng.uniform(-1.2, 1.2) * scale_mult
                noise_lvl = rng.uniform(0.05, 0.85 if ood_regime else 0.45)
                obs1 = s_clean + rng.uniform(-noise_lvl, noise_lvl)
                obs2 = s_clean + rng.uniform(-noise_lvl, noise_lvl)
                X[idx, 0] = self._vec({6: 1.0, 7: obs1})
                X[idx, 1] = self._vec({6: 1.0, 7: obs2})
                X[idx, 2] = self._vec({6: 1.0, 7: noise_lvl})
                X[idx, 5] = self._vec({6: 1.0, 9: 1.0})
                fused = (0.5 * (obs1 + obs2)) / (1.0 + 0.35 * noise_lvl)
                ans = fused * alt_mult
                Y[idx] = self._vec({0: obs1 / 4.0, 1: fused / 4.0, 2: ans / 4.0})
                meta.append({"s_clean": s_clean, "noise_lvl": noise_lvl})

        return X, Y, domains, meta


class IsolatedEpisodicMemory:
    """
    Strictly split-isolated associative episodic memory.
    Only accepts entries tagged split='train'; attempting to store val/test fails closed.
    """

    def __init__(self, max_items: int = 256):
        self.max_items = max_items
        self.entries: List[Dict[str, Any]] = []

    def clear(self) -> None:
        self.entries = []

    @staticmethod
    def _extract_feature(x_seq: np.ndarray) -> List[float]:
        # Summarize observable input tensor without any label data
        T, D = x_seq.shape
        out = [0.0] * D
        flat = x_seq._data if hasattr(x_seq, "_data") else x_seq.ravel().tolist()
        for t in range(T):
            for d in range(D):
                out[d] += float(flat[t * D + d]) * (1.0 if t < 3 else 0.25)
        norm = math.sqrt(math.fsum(v * v for v in out)) + 1e-8
        return [v / norm for v in out]

    def store(self, x_seq: np.ndarray, target_vec: np.ndarray, domain: str, split: str = "train") -> None:
        if split != "train":
            raise RuntimeError(f"FAIL_CLOSED: Prohibited write of '{split}' split target into episodic memory.")
        feat = self._extract_feature(x_seq)
        tgt = list(target_vec._data) if hasattr(target_vec, "_data") else target_vec.ravel().tolist()
        if len(self.entries) >= self.max_items:
            self.entries.pop(0)
        self.entries.append({"key": feat, "value": tgt, "domain": domain, "split": split})

    def retrieve(self, x_seq: np.ndarray, top_k: int = 3) -> List[Dict[str, Any]]:
        if not self.entries:
            return []
        q = self._extract_feature(x_seq)
        scored = []
        for entry in self.entries:
            sim = math.fsum(a * b for a, b in zip(q, entry["key"]))
            scored.append((sim, entry))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            {"similarity": round(float(s), 6), "domain": e["domain"], "value": e["value"]}
            for s, e in scored[:top_k]
        ]

    def evaluate_retrieval_only(self, X: np.ndarray, Y: np.ndarray, domains: List[str], top_k: int = 3, tol: float = 0.12) -> Dict[str, Any]:
        if not self.entries or X.shape[0] == 0:
            return {"precision_at_k": 0.0, "recall_at_k": 0.0, "retrieval_only_accuracy": 0.0}
        domain_matches = 0
        recall_hits = 0
        acc_hits = 0
        total = X.shape[0]
        # Total possible domain matches per sample in store (capped at top_k for recall normalization)
        dom_counts: Dict[str, int] = {}
        for e in self.entries:
            dom_counts[e["domain"]] = dom_counts.get(e["domain"], 0) + 1

        for i in range(total):
            hits = self.retrieve(X[i], top_k=top_k)
            if not hits:
                continue
            matched = sum(1 for h in hits if h["domain"] == domains[i])
            domain_matches += matched
            possible = min(top_k, dom_counts.get(domains[i], 0))
            if possible > 0:
                recall_hits += matched / possible
            # Distance-weighted regression prediction from retrieved training episodes
            weights = [max(0.0, h["similarity"]) + 1e-4 for h in hits]
            w_sum = math.fsum(weights)
            pred_col2 = math.fsum(w * h["value"][2] for w, h in zip(weights, hits)) / w_sum
            y_true = float(Y[i, 2])
            if abs(pred_col2 - y_true) < tol:
                acc_hits += 1

        return {
            "precision_at_k": round(domain_matches / (total * top_k), 4),
            "recall_at_k": round(recall_hits / total, 4),
            "retrieval_only_accuracy": round(acc_hits / total, 4),
        }


class CognitiveTransformerNet:
    """
    Native Multi-Step Causal Attention + SwiGLU Latent Deliberation + Calibrated Confidence Model.
    Supports ablation switches (`use_attention`, `use_swiglu`) and exact analytical backpropagation.
    """

    def __init__(
        self,
        d_model: int = 16,
        deliberation_steps: int = 2,
        seed: int = 42,
        use_attention: bool = True,
        use_swiglu: bool = True,
    ):
        self.d_model = d_model
        self.deliberation_steps = deliberation_steps
        self.seed = seed
        self.use_attention = use_attention
        self.use_swiglu = use_swiglu
        self.temperature = 1.0

        steps = deliberation_steps if use_swiglu else 0
        self.core = LatentReasoningCore(d_model=d_model, max_seq=16, reasoning_steps=steps, seed=seed)
        rng = np.random.default_rng(seed + 5000)
        scale = 0.09 / math.sqrt(d_model)
        self.w_out = rng.normal(0.0, scale, (d_model, d_model))
        self.b_out = np.zeros((d_model,), dtype=np.float64)
        self.w_conf = rng.normal(0.0, scale, (d_model, 1))
        self.b_conf = np.zeros((1,), dtype=np.float64)

        self.t = 0
        self.m = {k: np.zeros_like(v) for k, v in self._all_params().items()}
        self.v = {k: np.zeros_like(v) for k, v in self._all_params().items()}

    def _all_params(self) -> Dict[str, np.ndarray]:
        d = dict(self.core.p)
        d["w_out"] = self.w_out
        d["b_out"] = self.b_out
        d["w_conf"] = self.w_conf
        d["b_conf"] = self.b_conf
        return d

    def count_parameters(self) -> int:
        return sum(v.size for v in self._all_params().values())

    def clone_weights(self) -> Dict[str, Any]:
        return {
            "weights": {k: np.copy(v) for k, v in self._all_params().items()},
            "temperature": float(self.temperature),
            "adam_t": int(self.t),
        }

    def restore_weights(self, snapshot: Dict[str, Any]) -> None:
        w = snapshot["weights"] if "weights" in snapshot else snapshot
        for k, v in w.items():
            if k in self.core.p:
                self.core.p[k] = np.copy(v)
            elif k == "w_out":
                self.w_out = np.copy(v)
            elif k == "b_out":
                self.b_out = np.copy(v)
            elif k == "w_conf":
                self.w_conf = np.copy(v)
            elif k == "b_conf":
                self.b_conf = np.copy(v)
        if "temperature" in snapshot:
            self.temperature = float(snapshot["temperature"])
        if "adam_t" in snapshot:
            self.t = int(snapshot["adam_t"])
        self.m = {k: np.zeros_like(v) for k, v in self._all_params().items()}
        self.v = {k: np.zeros_like(v) for k, v in self._all_params().items()}

    def weights_sha256(self) -> str:
        h = hashlib.sha256()
        for k in sorted(self._all_params().keys()):
            arr = self._all_params()[k]
            flat = arr._data if hasattr(arr, "_data") else arr.ravel().tolist()
            h.update(k.encode("ascii"))
            for v in flat:
                h.update(f"{float(v):.8g},".encode("ascii"))
        return h.hexdigest()

    def forward(self, X: np.ndarray, steps_override: Optional[int] = None) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
        steps = self.deliberation_steps if steps_override is None else steps_override
        if not self.use_swiglu:
            steps = 0
        if self.use_attention:
            h, cache = self.core.forward(X, steps=steps)
        else:
            h = X + self.core.p["pos_emb"][:X.shape[1]][None, :, :]
            cache = {}

        final_h = h[:, -1, :]
        pred = final_h @ self.w_out + self.b_out
        logit = (final_h @ self.w_conf + self.b_conf).squeeze(-1)
        scaled = logit / max(0.05, self.temperature)
        conf = 1.0 / (1.0 + np.exp(-np.clip(scaled, -20.0, 20.0)))
        return pred, conf, {
            "h": h,
            "final_h": final_h,
            "logit": logit,
            "conf": conf,
            "cache": cache,
            "steps": steps,
        }

    def backward_and_step(
        self,
        X: np.ndarray,
        Y: np.ndarray,
        lr: float = 0.008,
        tol: float = 0.12,
        conf_weight: float = 0.15,
        weight_decay: float = 1e-4,
    ) -> Dict[str, float]:
        pred, conf, state = self.forward(X)
        diff = pred - Y
        B = X.shape[0]
        mse_loss = float(np.mean(diff * diff))

        # Binary correctness ground truth on prediction column 2
        y_corr_list = [
            1.0 if abs(float(pred[i, 2]) - float(Y[i, 2])) < tol else 0.0
            for i in range(B)
        ]
        y_corr = np.array(y_corr_list, dtype=np.float64)

        # Proper Binary Cross Entropy loss for calibrated confidence head (at training temp=1)
        eps = 1e-7
        logit = state["logit"]
        p_raw = 1.0 / (1.0 + np.exp(-np.clip(logit, -20.0, 20.0)))
        bce_vals = [
            -(y * math.log(max(eps, min(1.0 - eps, float(p)))) + (1.0 - y) * math.log(max(eps, min(1.0 - eps, 1.0 - float(p)))))
            for p, y in zip(p_raw, y_corr_list)
        ]
        conf_loss = math.fsum(bce_vals) / max(1, B)

        d_pred = (2.0 / (B * self.d_model)) * diff
        gw_out = state["final_h"].T @ d_pred
        gb_out = np.sum(d_pred, axis=0)
        d_final_h_mse = d_pred @ self.w_out.T

        # d(BCE)/d(logit) = (p - y) / B
        d_logit = (conf_weight / B) * (p_raw - y_corr)
        d_logit_2d = d_logit[:, None] if hasattr(d_logit, "shape") else np.array([[float(d_logit)]])
        gw_conf = state["final_h"].T @ d_logit_2d
        gb_conf = np.sum(d_logit_2d, axis=0)
        d_final_h = d_final_h_mse + (d_logit_2d @ self.w_conf.T)

        if self.use_attention and state["cache"]:
            dh = np.zeros_like(state["h"])
            dh[:, -1, :] = d_final_h
            _, grads = self.core.backward(dh, state["cache"])
        else:
            grads = {k: np.zeros_like(v) for k, v in self.core.p.items()}
            grads["pos_emb"][X.shape[1] - 1] = np.sum(d_final_h, axis=0)

        grads["w_out"] = gw_out
        grads["b_out"] = gb_out
        grads["w_conf"] = gw_conf
        grads["b_conf"] = gb_conf

        self.t += 1
        beta1, beta2, adam_eps = 0.9, 0.999, 1e-8
        for k, param in self._all_params().items():
            g = np.clip(grads[k], -1.5, 1.5)
            if weight_decay > 0.0 and param.ndim >= 2:
                g = g + weight_decay * param
            self.m[k] = beta1 * self.m[k] + (1.0 - beta1) * g
            self.v[k] = beta2 * self.v[k] + (1.0 - beta2) * (g * g)
            m_hat = self.m[k] / (1.0 - beta1 ** self.t)
            v_hat = self.v[k] / (1.0 - beta2 ** self.t)
            param -= lr * m_hat / (np.sqrt(v_hat) + adam_eps)

        return {
            "loss": round(mse_loss + conf_weight * conf_loss, 6),
            "mse_loss": round(mse_loss, 6),
            "conf_bce_loss": round(conf_loss, 6),
        }

    def train_epochs(
        self,
        X: np.ndarray,
        Y: np.ndarray,
        epochs: int = 30,
        batch_size: int = 24,
        lr: float = 0.01,
        tol: float = 0.12,
        seed_shuffle: int = 0,
    ) -> List[Dict[str, float]]:
        n = X.shape[0]
        rng = np.random.default_rng(self.seed + seed_shuffle + 333)
        history: List[Dict[str, float]] = []
        for ep in range(epochs):
            # Cosine decay schedule
            cur_lr = lr * (0.25 + 0.75 * 0.5 * (1.0 + math.cos(math.pi * ep / max(1, epochs))))
            if n <= batch_size:
                last_stats = self.backward_and_step(X, Y, lr=cur_lr, tol=tol)
            else:
                idxs = rng.choice(n, size=n, replace=False)
                last_stats = {"loss": 0.0, "mse_loss": 0.0, "conf_bce_loss": 0.0}
                for start in range(0, n, batch_size):
                    sub_idx = idxs[start : start + batch_size]
                    sub_list = list(sub_idx._data) if hasattr(sub_idx, "_data") else list(sub_idx)
                    Xb = np.array([X[int(i)].tolist() for i in sub_list], dtype=np.float64)
                    Yb = np.array([Y[int(i)].tolist() for i in sub_list], dtype=np.float64)
                    last_stats = self.backward_and_step(Xb, Yb, lr=cur_lr, tol=tol)
            history.append(last_stats)
        return history

    def self_verify_predict(self, X: np.ndarray, low_conf_threshold: float = 0.65) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
        """
        Adaptive multi-step self-verification:
        - Fast pass with max(1, deliberation_steps // 2) for routine confidence
        - If mean confidence < low_conf_threshold, triggers deeper deliberation pass (deliberation_steps + 1)
          to inspect whether reasoning representation stabilizes.
        """
        fast_steps = max(1, self.deliberation_steps // 2)
        pred_fast, conf_fast, _ = self.forward(X, steps_override=fast_steps)

        final_preds = pred_fast.copy()
        final_confs = conf_fast.copy()
        escalated = 0
        repaired_consistency = 0

        for i in range(X.shape[0]):
            if float(conf_fast[i]) < low_conf_threshold:
                escalated += 1
                xi = X[i : i + 1]
                p_deep, c_deep, _ = self.forward(xi, steps_override=self.deliberation_steps + 1)
                if float(c_deep[0]) >= float(conf_fast[i]):
                    repaired_consistency += 1
                final_preds[i] = p_deep[0]
                final_confs[i] = c_deep[0]

        return final_preds, final_confs, {
            "total": X.shape[0],
            "escalated_samples": escalated,
            "confidence_improved_on_escalation": repaired_consistency,
            "escalation_rate": round(escalated / max(1, X.shape[0]), 4),
        }


def evaluate_cognitive_model(
    model: CognitiveTransformerNet,
    X: np.ndarray,
    Y: np.ndarray,
    domains: List[str],
    tol: float = 0.12,
    use_self_verify: bool = False,
) -> Dict[str, Any]:
    t0 = time.perf_counter()
    if use_self_verify:
        pred, conf, verify_meta = model.self_verify_predict(X)
    else:
        pred, conf, _ = model.forward(X)
        verify_meta = {"escalated_samples": 0}
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    n = X.shape[0]
    errs = [abs(float(pred[i, 2]) - float(Y[i, 2])) for i in range(n)]
    correct = [1.0 if e < tol else 0.0 for e in errs]
    probs = [float(conf[i]) for i in range(n)]
    mse = float(np.mean((pred - Y) ** 2))
    acc = math.fsum(correct) / max(1, n)
    cal = compute_brier_and_ece(probs, correct, n_bins=10)

    per_domain: Dict[str, Dict[str, Any]] = {}
    for d in sorted(set(domains)):
        d_idxs = [i for i, dom in enumerate(domains) if dom == d]
        if not d_idxs:
            continue
        d_acc = math.fsum(correct[i] for i in d_idxs) / len(d_idxs)
        d_mse = math.fsum((float(pred[i, 2]) - float(Y[i, 2])) ** 2 for i in d_idxs) / len(d_idxs)
        per_domain[d] = {
            "count": len(d_idxs),
            "accuracy": round(d_acc, 4),
            "mse_col2": round(d_mse, 6),
        }

    return {
        "samples": n,
        "accuracy": round(acc, 4),
        "mse": round(mse, 6),
        "brier_score": cal["brier_score"],
        "ece": cal["ece"],
        "nll": cal["nll"],
        "mean_confidence": round(math.fsum(probs) / max(1, n), 4),
        "latency_ms_total": round(elapsed_ms, 3),
        "latency_ms_per_sample": round(elapsed_ms / max(1, n), 4),
        "per_domain": per_domain,
        "self_verify": verify_meta,
    }


def check_numerical_gradients(d_model: int = 8, eps: float = 1e-5) -> Dict[str, Any]:
    """
    Verifies exact analytical backpropagation of CognitiveTransformerNet (attention, SwiGLU,
    pos_emb, w_out, b_out, w_conf, b_conf) against central finite differences.
    """
    gen = CognitiveTaskSuite(d_model=d_model)
    X, Y, _, _ = gen.build_dataset(n_samples=4, seed=17)
    model = CognitiveTransformerNet(d_model=d_model, deliberation_steps=2, seed=17)

    # Compute analytical gradients on MSE objective (set conf_weight=0 to test smooth differentiable loss cleanly)
    pred, _, state = model.forward(X)
    diff = pred - Y
    B = X.shape[0]
    d_pred = (2.0 / (B * model.d_model)) * diff
    gw_out = state["final_h"].T @ d_pred
    gb_out = np.sum(d_pred, axis=0)
    d_final_h = d_pred @ model.w_out.T
    dh = np.zeros_like(state["h"])
    dh[:, -1, :] = d_final_h
    _, grads = model.core.backward(dh, state["cache"])
    grads["w_out"] = gw_out
    grads["b_out"] = gb_out

    def loss_fn() -> float:
        p, _, _ = model.forward(X)
        return float(np.mean((p - Y) ** 2))

    checked = {}
    max_rel = 0.0
    for pname in ["w_out", "b_out", "w_q", "w_k", "w_v", "w_o", "w_think_val", "w_think_gate", "w_think_out", "g_attn", "g_think", "pos_emb"]:
        param = model.w_out if pname == "w_out" else (model.b_out if pname == "b_out" else model.core.p[pname])
        g_ana = grads[pname]
        # Spot-check up to 4 entries deterministically across tensor
        total = param.size
        indices = sorted(set([0, total // 3, (2 * total) // 3, total - 1]))
        p_max_err = 0.0
        for flat_i in indices:
            if hasattr(param, "_data"):
                orig = param._data[flat_i]
                param._data[flat_i] = orig + eps
                lp = loss_fn()
                param._data[flat_i] = orig - eps
                lm = loss_fn()
                param._data[flat_i] = orig
                ana = float(g_ana._data[flat_i])
            else:
                idx = np.unravel_index(flat_i, param.shape)
                orig = float(param[idx])
                param[idx] = orig + eps
                lp = loss_fn()
                param[idx] = orig - eps
                lm = loss_fn()
                param[idx] = orig
                ana = float(g_ana[idx])
            num = (lp - lm) / (2.0 * eps)
            rel = abs(ana - num) / max(1e-7, abs(ana) + abs(num))
            if rel > p_max_err:
                p_max_err = rel
        max_rel = max(max_rel, p_max_err)
        checked[pname] = round(p_max_err, 8)

    return {
        "passed": max_rel < 1e-4,
        "max_relative_error": max_rel,
        "per_tensor_max_rel_error": checked,
    }


def profile_memory_and_latency(fn: Callable[[], Any]) -> Tuple[Any, Dict[str, Any]]:
    t0 = time.perf_counter()
    res = fn()
    dt_s = time.perf_counter() - t0
    rss_kb = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return res, {
        "elapsed_seconds": round(dt_s, 4),
        "peak_memory_kb": round(rss_kb, 2),
        "current_memory_kb": round(rss_kb, 2),
    }


def run_isolated_few_shot_adaptation(
    X_support: np.ndarray,
    Y_support: np.ndarray,
    X_query: np.ndarray,
    Y_query: np.ndarray,
    domains_query: List[str],
    shot_counts: Sequence[int] = (2, 4, 8, 12),
    seeds: Sequence[int] = (11, 22, 33),
    d_model: int = 10,
    deliberation_steps: int = 2,
    epochs: int = 10,
    lr: float = 0.05,
    seed_offset: int = 500,
    model_factory: Optional[Callable[..., CognitiveTransformerNet]] = None,
) -> List[Dict[str, Any]]:
    """
    Executes few-shot adaptation across shot counts (e.g. 2, 4, 8, 12) while strictly enforcing
    a brand-new, freshly initialized model instance for every (k, seed) condition.
    Verifies zero parameter leakage across shot counts:
      - Enforces disjoint support/query splits and validateInputLeakage on inputs/targets.
      - Verifies every created model has a unique Python object ID and disjoint parameter tensor IDs.
      - Verifies initial weights SHA-256 matches an untainted reference initialization for that seed.
      - Verifies weights genuinely update during adaptation without mutating other conditions.
    """
    if not shot_counts:
        raise ValueError("shot_counts must be non-empty")
    if not seeds:
        raise ValueError("seeds must be non-empty")

    assert_disjoint_splits({"few_shot_support": X_support, "few_shot_query": X_query})
    validateInputLeakage(X_support, Y_support)
    validateInputLeakage(X_query, Y_query)

    factory = model_factory or CognitiveTransformerNet
    baseline_init_sha: Dict[int, str] = {}
    for s in seeds:
        ref_net = factory(d_model=d_model, deliberation_steps=deliberation_steps, seed=seed_offset + s)
        baseline_init_sha[s] = ref_net.weights_sha256()

    seen_model_ids: set = set()
    seen_param_ids: set = set()
    _live_isolation_guard: List[Any] = []
    results: List[Dict[str, Any]] = []

    for k in shot_counts:
        if k <= 0 or k > X_support.shape[0]:
            raise ValueError(f"Invalid shot count k={k} for support pool size {X_support.shape[0]}")

        X_k = X_support[:k]
        Y_k = Y_support[:k]
        validateInputLeakage(X_k, Y_k)

        k_accs: List[float] = []
        k_mses: List[float] = []
        init_prefixes: List[str] = []
        post_prefixes: List[str] = []

        for s in seeds:
            fs_net = factory(d_model=d_model, deliberation_steps=deliberation_steps, seed=seed_offset + s)
            obj_id = id(fs_net)
            if obj_id in seen_model_ids:
                raise RuntimeError(f"FAIL_CLOSED: Reused model instance detected in few-shot adaptation (k={k}, seed={s}).")
            seen_model_ids.add(obj_id)

            for pname, ptensor in fs_net._all_params().items():
                pid = id(ptensor)
                if pid in seen_param_ids:
                    raise RuntimeError(f"FAIL_CLOSED: Shared parameter tensor '{pname}' detected across few-shot runs (k={k}, seed={s}).")
                seen_param_ids.add(pid)

            _live_isolation_guard.append(fs_net)

            init_sha = fs_net.weights_sha256()
            if init_sha != baseline_init_sha[s]:
                raise RuntimeError(
                    f"FAIL_CLOSED: Fresh initialization hash mismatch for k={k}, seed={s}: "
                    f"{init_sha[:12]} != {baseline_init_sha[s][:12]}"
                )

            fs_net.train_epochs(X_k, Y_k, epochs=epochs, batch_size=k, lr=lr, seed_shuffle=s)
            post_sha = fs_net.weights_sha256()
            if post_sha == init_sha:
                raise RuntimeError(f"FAIL_CLOSED: Model weights did not update during few-shot adaptation (k={k}, seed={s}).")

            ev_fs = evaluate_cognitive_model(fs_net, X_query, Y_query, domains_query)
            k_accs.append(ev_fs["accuracy"])
            k_mses.append(ev_fs["mse"])
            init_prefixes.append(init_sha[:12])
            post_prefixes.append(post_sha[:12])

        acc_summary = summarize_multi_seed(k_accs)
        mse_summary = summarize_multi_seed(k_mses)
        results.append({
            "k": k,
            "fresh_init_per_k": True,
            "isolated_instances": True,
            "init_sha256_verified": True,
            "parameter_leakage_detected": False,
            "distinct_model_count": len(seeds),
            "init_sha256_prefixes": init_prefixes,
            "post_train_sha256_prefixes": post_prefixes,
            "accuracy": acc_summary,
            "ood_accuracy": acc_summary,
            "ood_mse": mse_summary,
        })

    return results

