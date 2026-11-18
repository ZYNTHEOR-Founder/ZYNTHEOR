import json
import os
import time
import numpy as np
from typing import Dict, List, Tuple, Any
from qplus_native.reasoning_engine import LatentReasoningCore, SymbolicVerifier


class ReasoningTaskGenerator:
    def __init__(self, d_model: int = 24):
        self.d_model = d_model

    def _encode_vector(self, vals: List[float]) -> np.ndarray:
        vec = np.zeros((self.d_model,), dtype=np.float64)
        for i, v in enumerate(vals[: self.d_model]):
            vec[i] = float(v)
        return vec

    def build_dataset(self, n_samples: int, seed: int, ood_shift: float = 0.0) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        rng = np.random.default_rng(seed)
        seq_len = 4
        X = np.zeros((n_samples, seq_len, self.d_model), dtype=np.float64)
        Y = np.zeros((n_samples, self.d_model), dtype=np.float64)
        domains: List[str] = []

        for idx in range(n_samples):
            domain_id = idx % 4
            if domain_id == 0:
                domains.append("multi_step_arithmetic")
                a = rng.uniform(-2.0, 2.0) + ood_shift
                b = rng.uniform(-2.0, 2.0) + ood_shift
                c = rng.uniform(0.5, 2.5)
                d = rng.uniform(-1.5, 1.5)
                step1 = a + b
                step2 = step1 * c
                ans = step2 - d
                X[idx, 0] = self._encode_vector([1.0, 0.0, 0.0, 0.0, a, b])
                X[idx, 1] = self._encode_vector([1.0, 0.0, 0.0, 0.0, c, 0.0])
                X[idx, 2] = self._encode_vector([1.0, 0.0, 0.0, 0.0, d, 1.0])
                X[idx, 3] = self._encode_vector([1.0, 0.0, 0.0, 0.0, a, c])
                Y[idx] = self._encode_vector([step1 / 10.0, step2 / 10.0, ans / 10.0])

            elif domain_id == 1:
                domains.append("deductive_logic")
                p = float(rng.choice([-1.0, 1.0]))
                r1 = float(rng.choice([-1.0, 1.0]))
                r2 = float(rng.choice([-1.0, 1.0]))
                r3 = float(rng.choice([-1.0, 1.0]))
                q = p * r1
                r = q * r2
                s = r * r3
                X[idx, 0] = self._encode_vector([0.0, 1.0, 0.0, 0.0, p, r1])
                X[idx, 1] = self._encode_vector([0.0, 1.0, 0.0, 0.0, r2, 0.0])
                X[idx, 2] = self._encode_vector([0.0, 1.0, 0.0, 0.0, r3, 0.0])
                X[idx, 3] = self._encode_vector([0.0, 1.0, 0.0, 0.0, p, r3])
                Y[idx] = self._encode_vector([q, r, s])

            elif domain_id == 2:
                domains.append("pattern_induction")
                x0 = rng.uniform(-1.5, 1.5) + ood_shift
                delta = rng.uniform(-1.0, 1.0)
                accel = rng.uniform(-0.5, 0.5)
                x1 = x0 + delta
                x2 = x1 + delta + accel
                x3 = x2 + delta + 2.0 * accel
                x4 = x3 + delta + 3.0 * accel
                X[idx, 0] = self._encode_vector([0.0, 0.0, 1.0, 0.0, x0, 0.0])
                X[idx, 1] = self._encode_vector([0.0, 0.0, 1.0, 0.0, x1, 0.0])
                X[idx, 2] = self._encode_vector([0.0, 0.0, 1.0, 0.0, x2, 0.0])
                X[idx, 3] = self._encode_vector([0.0, 0.0, 1.0, 0.0, x3, 0.0])
                Y[idx] = self._encode_vector([x2 / 10.0, x3 / 10.0, x4 / 10.0])

            else:
                domains.append("causal_planning")
                t_a = rng.uniform(0.5, 2.0) + abs(ood_shift) * 0.5
                t_b = rng.uniform(0.5, 2.0) + abs(ood_shift) * 0.5
                t_c = rng.uniform(0.5, 2.0)
                t_d = rng.uniform(0.5, 2.0)
                critical_ab = max(t_a, t_b)
                total_time = critical_ab + t_c + t_d
                X[idx, 0] = self._encode_vector([0.0, 0.0, 0.0, 1.0, t_a, 0.0])
                X[idx, 1] = self._encode_vector([0.0, 0.0, 0.0, 1.0, t_b, 0.0])
                X[idx, 2] = self._encode_vector([0.0, 0.0, 0.0, 1.0, t_c, 0.0])
                X[idx, 3] = self._encode_vector([0.0, 0.0, 0.0, 1.0, t_d, 0.0])
                Y[idx] = self._encode_vector([critical_ab / 10.0, (critical_ab + t_c) / 10.0, total_time / 10.0])

        return X, Y, domains


class NativeReasoningModel:
    def __init__(self, d_model: int = 24, reasoning_steps: int = 3, seed: int = 42):
        self.d_model = d_model
        self.reasoning_steps = reasoning_steps
        self.core = LatentReasoningCore(d_model=d_model, reasoning_steps=reasoning_steps, seed=seed)
        rng = np.random.default_rng(seed + 100)
        self.w_out = rng.normal(0.0, 0.05, (d_model, d_model))
        self.b_out = np.zeros((d_model,), dtype=np.float64)

        # AdamW state
        self.t = 0
        self.m: Dict[str, np.ndarray] = {k: np.zeros_like(v) for k, v in self._all_params().items()}
        self.v: Dict[str, np.ndarray] = {k: np.zeros_like(v) for k, v in self._all_params().items()}

    def _all_params(self) -> Dict[str, np.ndarray]:
        d = dict(self.core.p)
        d["w_out"] = self.w_out
        d["b_out"] = self.b_out
        return d

    def predict(self, X: np.ndarray) -> Tuple[np.ndarray, Dict[str, Any]]:
        h, cache = self.core.forward(X, steps=self.reasoning_steps)
        final_h = h[:, -1, :]
        pred = final_h @ self.w_out + self.b_out
        return pred, {"h": h, "final_h": final_h, "core_cache": cache}

    def train_step(self, X: np.ndarray, Y: np.ndarray, lr: float = 0.008) -> float:
        pred, state = self.predict(X)
        diff = pred - Y
        loss = float(np.mean(diff ** 2))
        B = X.shape[0]
        d_pred = (2.0 / (B * self.d_model)) * diff

        gw_out = state["final_h"].T @ d_pred
        gb_out = np.sum(d_pred, axis=0)
        d_final_h = d_pred @ self.w_out.T

        dh = np.zeros_like(state["h"])
        dh[:, -1, :] = d_final_h
        _, grads = self.core.backward(dh, state["core_cache"])
        grads["w_out"] = gw_out
        grads["b_out"] = gb_out

        self.t += 1
        beta1, beta2, eps = 0.9, 0.999, 1e-8
        params = self._all_params()
        for k, param in params.items():
            g = np.clip(grads[k], -2.0, 2.0)
            self.m[k] = beta1 * self.m[k] + (1.0 - beta1) * g
            self.v[k] = beta2 * self.v[k] + (1.0 - beta2) * (g * g)
            m_hat = self.m[k] / (1.0 - beta1 ** self.t)
            v_hat = self.v[k] / (1.0 - beta2 ** self.t)
            param -= lr * m_hat / (np.sqrt(v_hat) + eps)

        return loss


def evaluate_model(model: NativeReasoningModel, X: np.ndarray, Y: np.ndarray, domains: List[str]) -> Dict[str, Any]:
    pred, _ = model.predict(X)
    mse = float(np.mean((pred - Y) ** 2))
    err = np.abs(pred[:, 2] - Y[:, 2])
    acc = float(np.mean(err < 0.08))

    per_domain: Dict[str, Dict[str, float]] = {}
    for d in sorted(set(domains)):
        mask = np.array([dom == d for dom in domains])
        d_mse = float(np.mean((pred[mask] - Y[mask]) ** 2))
        d_acc = float(np.mean(np.abs(pred[mask, 2] - Y[mask, 2]) < 0.08))
        per_domain[d] = {"mse": round(d_mse, 6), "accuracy": round(d_acc, 4)}

    return {
        "mse": round(mse, 6),
        "accuracy": round(acc, 4),
        "per_domain": per_domain,
    }


def run_benchmark() -> Dict[str, Any]:
    gen = ReasoningTaskGenerator(d_model=24)
    X_train, Y_train, _ = gen.build_dataset(n_samples=256, seed=101, ood_shift=0.0)
    X_val, Y_val, dom_val = gen.build_dataset(n_samples=128, seed=202, ood_shift=0.0)
    X_ood, Y_ood, dom_ood = gen.build_dataset(n_samples=128, seed=303, ood_shift=1.25)

    # 1. Baseline: Single-pass (reasoning_steps=0, no latent deliberation)
    baseline = NativeReasoningModel(d_model=24, reasoning_steps=0, seed=42)
    val_before = evaluate_model(baseline, X_val, Y_val, dom_val)
    for epoch in range(280):
        lr = 0.01 * (0.5 ** (epoch / 140.0))
        baseline.train_step(X_train, Y_train, lr=lr)
    baseline_val = evaluate_model(baseline, X_val, Y_val, dom_val)
    baseline_ood = evaluate_model(baseline, X_ood, Y_ood, dom_ood)

    # 2. Upgraded: Causal Attention + Multi-step Latent Reasoning (reasoning_steps=3)
    upgraded = NativeReasoningModel(d_model=24, reasoning_steps=3, seed=42)
    t0 = time.time()
    for epoch in range(280):
        lr = 0.01 * (0.5 ** (epoch / 140.0))
        upgraded.train_step(X_train, Y_train, lr=lr)
    train_sec = round(time.time() - t0, 3)
    upgraded_val = evaluate_model(upgraded, X_val, Y_val, dom_val)
    upgraded_ood = evaluate_model(upgraded, X_ood, Y_ood, dom_ood)

    sym_ok = SymbolicVerifier.verify_arithmetic_chain(
        [("+", 15.0, 25.0, 40.0), ("*", 40.0, 2.5, 100.0), ("-", 100.0, 12.0, 88.0)], 88.0
    )

    report = {
        "objective": "pure_reasoning_and_execution_not_chatbot",
        "architecture_upgrade": {
            "causal_self_attention_memory": True,
            "latent_deliberation_steps": 3,
            "optimizer": "NativeAdamW",
            "symbolic_verifier_active": sym_ok,
            "train_seconds": train_sec,
        },
        "untrained_initial": val_before,
        "baseline_single_pass": {
            "validation": baseline_val,
            "ood_generalization": baseline_ood,
        },
        "upgraded_latent_reasoning": {
            "validation": upgraded_val,
            "ood_generalization": upgraded_ood,
        },
        "delta_improvement": {
            "val_mse_reduction": round(baseline_val["mse"] - upgraded_val["mse"], 6),
            "val_accuracy_gain": round(upgraded_val["accuracy"] - baseline_val["accuracy"], 4),
            "ood_mse_reduction": round(baseline_ood["mse"] - upgraded_ood["mse"], 6),
            "ood_accuracy_gain": round(upgraded_ood["accuracy"] - baseline_ood["accuracy"], 4),
        },
    }

    os.makedirs("native_data", exist_ok=True)
    with open("native_data/intelligence_upgrade_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    run_benchmark()
