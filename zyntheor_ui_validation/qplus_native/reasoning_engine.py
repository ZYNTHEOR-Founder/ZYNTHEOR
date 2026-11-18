import math
try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np
from typing import Dict, Tuple, List, Any


def _silu(x: np.ndarray) -> np.ndarray:
    return x / (1.0 + np.exp(-np.clip(x, -30.0, 30.0)))


def _silu_bwd(x: np.ndarray, dy: np.ndarray) -> np.ndarray:
    sig = 1.0 / (1.0 + np.exp(-np.clip(x, -30.0, 30.0)))
    return dy * (sig * (1.0 + x * (1.0 - sig)))


def _rms_norm(x: np.ndarray, g: np.ndarray, eps: float = 1e-6) -> Tuple[np.ndarray, Tuple[np.ndarray, np.ndarray, np.ndarray]]:
    r = 1.0 / np.sqrt(np.mean(x * x, axis=-1, keepdims=True) + eps)
    return x * r * g, (x, r, g)


def _rms_norm_bwd(dy: np.ndarray, cache: Tuple[np.ndarray, np.ndarray, np.ndarray]) -> Tuple[np.ndarray, np.ndarray]:
    x, r, g = cache
    d = x.shape[-1]
    dg = np.sum(dy * x * r, axis=tuple(range(dy.ndim - 1)))
    dxh = dy * g
    dx = r * dxh - x * (r ** 3) / d * np.sum(dxh * x, axis=-1, keepdims=True)
    return dx, dg


class LatentReasoningCore:
    """
    Native Causal Attention + Multi-Step Latent Reasoning Core (Pure NumPy).
    - Positional Slot Embeddings (preserves exact step/variable identity across T)
    - Causal Self-Attention Working Memory (attends across prior reasoning steps without future leakage)
    - Iterative SwiGLU Latent Deliberation Loop with RMSNorm (multi-step deduction & arithmetic)
    """

    def __init__(self, d_model: int = 24, max_seq: int = 16, reasoning_steps: int = 3, seed: int = 2026):
        self.d_model = d_model
        self.max_seq = max_seq
        self.reasoning_steps = reasoning_steps
        rng = np.random.default_rng(seed)
        scale = 0.12 / math.sqrt(d_model)

        self.p: Dict[str, np.ndarray] = {
            "pos_emb": rng.normal(0.0, 0.05, (max_seq, d_model)),
            "w_q": rng.normal(0.0, scale, (d_model, d_model)),
            "w_k": rng.normal(0.0, scale, (d_model, d_model)),
            "w_v": rng.normal(0.0, scale, (d_model, d_model)),
            "w_o": rng.normal(0.0, scale, (d_model, d_model)),
            "g_attn": np.ones((d_model,), dtype=np.float64),
            "g_think": np.ones((d_model,), dtype=np.float64),
            "w_think_val": rng.normal(0.0, scale, (d_model, d_model * 3)),
            "b_think_val": np.zeros((d_model * 3,), dtype=np.float64),
            "w_think_gate": rng.normal(0.0, scale, (d_model, d_model * 3)),
            "b_think_gate": np.zeros((d_model * 3,), dtype=np.float64),
            "w_think_out": rng.normal(0.0, scale, (d_model * 3, d_model)),
            "b_think_out": np.zeros((d_model,), dtype=np.float64),
        }

    def forward(self, x: np.ndarray, steps: int | None = None) -> Tuple[np.ndarray, Dict[str, Any]]:
        B, T, D = x.shape
        n_steps = self.reasoning_steps if steps is None else steps

        # 1. Inject Positional Slot Identity
        h0 = x + self.p["pos_emb"][:T][None, :, :]

        # 2. Causal Self-Attention Working Memory (attends over all past steps 0..t)
        h_norm1, rms1_cache = _rms_norm(h0, self.p["g_attn"])
        Q = h_norm1 @ self.p["w_q"]
        K = h_norm1 @ self.p["w_k"]
        V = h_norm1 @ self.p["w_v"]

        scores = (Q @ np.swapaxes(K, -1, -2)) / math.sqrt(D)
        causal_mask = np.triu(np.full((T, T), -1e9), k=1)
        scores_masked = scores + causal_mask[None, :, :]
        scores_shifted = scores_masked - np.max(scores_masked, axis=-1, keepdims=True)
        exp_s = np.exp(scores_shifted)
        attn = exp_s / np.sum(exp_s, axis=-1, keepdims=True)

        ctx = attn @ V
        h = h0 + (ctx @ self.p["w_o"])

        # 3. Iterative Latent Reasoning Loop (Multi-step deliberation)
        step_caches = []
        for _ in range(n_steps):
            h_in = h
            h_n, rms_t_cache = _rms_norm(h_in, self.p["g_think"])
            v_lin = h_n @ self.p["w_think_val"] + self.p["b_think_val"]
            g_lin = h_n @ self.p["w_think_gate"] + self.p["b_think_gate"]
            g_act = _silu(g_lin)
            prod = v_lin * g_act
            delta = prod @ self.p["w_think_out"] + self.p["b_think_out"]
            h = h_in + delta
            step_caches.append((h_in, h_n, rms_t_cache, v_lin, g_lin, g_act, prod))

        cache = {
            "T": T,
            "rms1_cache": rms1_cache,
            "h_norm1": h_norm1,
            "Q": Q,
            "K": K,
            "V": V,
            "attn": attn,
            "ctx": ctx,
            "step_caches": step_caches,
        }
        return h, cache

    def backward(self, dh: np.ndarray, cache: Dict[str, Any]) -> Tuple[np.ndarray, Dict[str, np.ndarray]]:
        grads = {k: np.zeros_like(v) for k, v in self.p.items()}
        D = self.d_model
        T = cache["T"]

        # Backward through Iterative Latent Reasoning Loop
        for h_in, h_n, rms_t_cache, v_lin, g_lin, g_act, prod in reversed(cache["step_caches"]):
            d_delta = dh
            d_h_in = dh.copy()

            grads["w_think_out"] += np.einsum("bti,btj->ij", prod, d_delta)
            grads["b_think_out"] += np.sum(d_delta, axis=(0, 1))
            d_prod = d_delta @ self.p["w_think_out"].T

            d_v_lin = d_prod * g_act
            d_g_act = d_prod * v_lin
            d_g_lin = _silu_bwd(g_lin, d_g_act)

            grads["w_think_val"] += np.einsum("bti,btj->ij", h_n, d_v_lin)
            grads["b_think_val"] += np.sum(d_v_lin, axis=(0, 1))
            grads["w_think_gate"] += np.einsum("bti,btj->ij", h_n, d_g_lin)
            grads["b_think_gate"] += np.sum(d_g_lin, axis=(0, 1))

            d_h_n = d_v_lin @ self.p["w_think_val"].T + d_g_lin @ self.p["w_think_gate"].T
            d_from_rms, dg_t = _rms_norm_bwd(d_h_n, rms_t_cache)
            grads["g_think"] += dg_t
            dh = d_h_in + d_from_rms

        # Backward through Causal Self-Attention Working Memory
        ctx = cache["ctx"]
        attn = cache["attn"]
        Q, K, V = cache["Q"], cache["K"], cache["V"]
        h_norm1 = cache["h_norm1"]

        grads["w_o"] += np.einsum("bti,btj->ij", ctx, dh)
        d_ctx = dh @ self.p["w_o"].T

        d_attn = d_ctx @ np.swapaxes(V, -1, -2)
        d_V = np.swapaxes(attn, -1, -2) @ d_ctx

        d_scores = attn * (d_attn - np.sum(d_attn * attn, axis=-1, keepdims=True))
        d_scores = d_scores / math.sqrt(D)

        d_Q = d_scores @ K
        d_K = np.swapaxes(d_scores, -1, -2) @ Q

        grads["w_q"] += np.einsum("bti,btj->ij", h_norm1, d_Q)
        grads["w_k"] += np.einsum("bti,btj->ij", h_norm1, d_K)
        grads["w_v"] += np.einsum("bti,btj->ij", h_norm1, d_V)

        d_h_norm1 = d_Q @ self.p["w_q"].T + d_K @ self.p["w_k"].T + d_V @ self.p["w_v"].T
        d_h0_attn, dg_a = _rms_norm_bwd(d_h_norm1, cache["rms1_cache"])
        grads["g_attn"] += dg_a
        dh0 = dh + d_h0_attn

        grads["pos_emb"][:T] += np.sum(dh0, axis=0)
        return dh0, grads


class SymbolicVerifier:
    @staticmethod
    def verify_arithmetic_chain(steps: List[Tuple[str, float, float, float]], final_answer: float) -> bool:
        acc = None
        for op, a, b, claimed in steps:
            if op == "+":
                val = a + b
            elif op == "-":
                val = a - b
            elif op == "*":
                val = a * b
            elif op == "/":
                if abs(b) < 1e-12:
                    return False
                val = a / b
            else:
                return False
            if abs(val - claimed) > 1e-6:
                return False
            acc = val
        return acc is not None and abs(acc - final_answer) <= 1e-6

    @staticmethod
    def verify_causal_plan(dependencies: Dict[str, List[str]], execution_order: List[str]) -> bool:
        completed = set()
        for task in execution_order:
            if task not in dependencies:
                return False
            for req in dependencies[task]:
                if req not in completed:
                    return False
            completed.add(task)
        return len(completed) == len(dependencies)
