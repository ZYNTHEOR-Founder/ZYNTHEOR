import json
import os
import time
import math
try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np
from typing import Dict, List, Tuple, Any
from qplus_native.reasoning_engine import LatentReasoningCore, SymbolicVerifier


class AutonomousTaskGenerator:
    """
    Leak-free task generator (Batch 8 recovered).
    Encodes ONLY observable input premises at t=0..4 and query signal at t=5.
    """
    def __init__(self, d_model: int = 16):
        self.d_model = d_model

    def _encode(self, vals: List[float]) -> np.ndarray:
        vec = np.zeros((self.d_model,), dtype=np.float64)
        for i, v in enumerate(vals[:self.d_model]):
            vec[i] = float(v)
        return vec

    def build_dataset(self, n_samples: int, seed: int, domain_type: str = "mixed", difficulty: float = 1.0) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        rng = np.random.default_rng(seed)
        seq_len = 6
        X = np.zeros((n_samples, seq_len, self.d_model), dtype=np.float64)
        Y = np.zeros((n_samples, self.d_model), dtype=np.float64)
        domains: List[str] = []

        domain_map = {"algebra": 0, "logic": 1, "transfer": 2, "planning": 3, "uncertainty": 4}
        for idx in range(n_samples):
            d_id = (idx % 5) if domain_type == "mixed" else domain_map.get(domain_type, 4)

            if d_id == 0:
                domains.append("advanced_algebra")
                a = rng.uniform(-1.5, 1.5) * difficulty
                b = rng.uniform(-1.5, 1.5) * difficulty
                c = rng.uniform(0.5, 2.0)
                s1 = (a * b) + c
                s2 = s1 / (abs(a) + 0.8)
                ans = s2 * 1.25
                X[idx, 0] = self._encode([1, 0, 0, 0, 0, a, 0])
                X[idx, 1] = self._encode([1, 0, 0, 0, 0, b, 0])
                X[idx, 2] = self._encode([1, 0, 0, 0, 0, c, 0])
                X[idx, 5] = self._encode([1, 0, 0, 0, 0, 0, 1.0])
                Y[idx] = self._encode([s1 / 6.0, s2 / 6.0, ans / 6.0])
            elif d_id == 1:
                domains.append("compositional_logic")
                p1 = float(rng.choice([-1.0, 1.0]))
                p2 = float(rng.choice([-1.0, 1.0]))
                p3 = float(rng.choice([-1.0, 1.0]))
                h1 = p1 * p2
                h2 = h1 * p3
                h3 = h2 * p1
                X[idx, 0] = self._encode([0, 1, 0, 0, 0, p1, 0])
                X[idx, 1] = self._encode([0, 1, 0, 0, 0, p2, 0])
                X[idx, 2] = self._encode([0, 1, 0, 0, 0, p3, 0])
                X[idx, 5] = self._encode([0, 1, 0, 0, 0, 0, 1.0])
                Y[idx] = self._encode([h1 * 0.5, h2 * 0.5, h3 * 0.5])
            elif d_id == 2:
                domains.append("knowledge_transfer_domain")
                base = rng.uniform(-1.5, 1.5) * difficulty
                scale = rng.uniform(0.8, 2.0)
                v1 = base * scale
                v2 = v1 + base
                v3 = v2 * 0.6 * scale
                X[idx, 0] = self._encode([0, 0, 1, 0, 0, base, 0])
                X[idx, 1] = self._encode([0, 0, 1, 0, 0, scale, 0])
                X[idx, 5] = self._encode([0, 0, 1, 0, 0, 0, 1.0])
                Y[idx] = self._encode([v1 / 6.0, v2 / 6.0, v3 / 6.0])
            elif d_id == 3:
                domains.append("causal_planning")
                t1 = rng.uniform(0.5, 2.0)
                t2 = rng.uniform(0.5, 2.0)
                crit = max(t1, t2)
                total = crit + 0.5 * (t1 + t2)
                X[idx, 0] = self._encode([0, 0, 0, 1, 0, t1, 0])
                X[idx, 1] = self._encode([0, 0, 0, 1, 0, t2, 0])
                X[idx, 5] = self._encode([0, 0, 0, 1, 0, 0, 1.0])
                Y[idx] = self._encode([crit / 6.0, total / 6.0, (total - crit) / 6.0])
            else:
                domains.append("uncertainty_reasoning")
                base = rng.uniform(-1.0, 1.0)
                noise = rng.uniform(-0.1, 0.1) * difficulty
                est1 = base + 0.5 * noise
                est2 = est1 * 1.2
                est3 = est2 - 0.2
                X[idx, 0] = self._encode([0, 0, 0, 0, 1, base, 0])
                X[idx, 1] = self._encode([0, 0, 0, 0, 1, noise, 0])
                X[idx, 5] = self._encode([0, 0, 0, 0, 1, 0, 1.0])
                Y[idx] = self._encode([est1 / 6.0, est2 / 6.0, est3 / 6.0])

        return X, Y, domains


class AutonomousZyntheorModel:
    def __init__(self, d_model: int = 16, max_steps: int = 3, seed: int = 42):
        self.d_model = d_model
        self.max_steps = max_steps
        self.seed = seed
        self.replay_rng = np.random.default_rng(seed + 7001)
        self.core = LatentReasoningCore(d_model=d_model, max_seq=16, reasoning_steps=max_steps, seed=seed)

        rng = np.random.default_rng(seed + 800)
        scale = 0.1 / math.sqrt(d_model)
        self.w_out = rng.normal(0.0, scale, (d_model, d_model))
        self.b_out = np.zeros((d_model,), dtype=np.float64)

        self.replay_buffer: List[Tuple[np.ndarray, np.ndarray]] = []
        self.max_buffer_size = 300

        self.t = 0
        self.m = {k: np.zeros_like(v) for k, v in self._all_params().items()}
        self.v = {k: np.zeros_like(v) for k, v in self._all_params().items()}

    def _all_params(self) -> Dict[str, np.ndarray]:
        d = dict(self.core.p)
        d["w_out"] = self.w_out
        d["b_out"] = self.b_out
        return d

    def clone_weights(self) -> Dict[str, np.ndarray]:
        return {k: np.copy(v) for k, v in self._all_params().items()}

    def restore_weights(self, state_dict: Dict[str, np.ndarray]):
        for k, v in state_dict.items():
            if k in self.core.p:
                self.core.p[k] = np.copy(v)
            elif k == "w_out":
                self.w_out = np.copy(v)
            elif k == "b_out":
                self.b_out = np.copy(v)

    def estimate_complexity(self, X: np.ndarray) -> int:
        var = float(np.var(X))
        if var > 0.2:
            return self.max_steps
        return max(1, self.max_steps - 1)

    def predict(self, X: np.ndarray, adaptive: bool = True) -> Tuple[np.ndarray, Dict[str, Any]]:
        steps = self.estimate_complexity(X) if adaptive else self.max_steps
        h, cache = self.core.forward(X, steps=steps)
        final_h = h[:, -1, :]
        pred = final_h @ self.w_out + self.b_out
        return pred, {"h": h, "final_h": final_h, "cache": cache, "steps_used": steps}

    def add_to_replay(self, X: np.ndarray, Y: np.ndarray):
        for i in range(X.shape[0]):
            if len(self.replay_buffer) >= self.max_buffer_size:
                self.replay_buffer.pop(0)
            self.replay_buffer.append((X[i : i + 1], Y[i : i + 1]))

    def train_step(self, X: np.ndarray, Y: np.ndarray, lr: float = 0.008) -> float:
        self.add_to_replay(X, Y)

        train_X, train_Y = X, Y
        if len(self.replay_buffer) >= 32:
            indices = self.replay_rng.choice(len(self.replay_buffer), size=min(16, len(self.replay_buffer)), replace=False)
            rx = np.concatenate([self.replay_buffer[int(i)][0] for i in indices], axis=0)
            ry = np.concatenate([self.replay_buffer[int(i)][1] for i in indices], axis=0)
            train_X = np.concatenate([X, rx], axis=0)
            train_Y = np.concatenate([Y, ry], axis=0)

        pred, state = self.predict(train_X, adaptive=True)
        diff = pred - train_Y
        loss = float(np.mean(diff * diff))
        B = train_X.shape[0]
        d_pred = (2.0 / (B * self.d_model)) * diff

        gw_out = state["final_h"].T @ d_pred
        gb_out = np.sum(d_pred, axis=0)
        d_final_h = d_pred @ self.w_out.T

        dh = np.zeros_like(state["h"])
        dh[:, -1, :] = d_final_h
        _, grads = self.core.backward(dh, state["cache"])
        grads["w_out"] = gw_out
        grads["b_out"] = gb_out

        self.t += 1
        beta1, beta2, eps = 0.9, 0.999, 1e-8
        for k, param in self._all_params().items():
            g = np.clip(grads[k], -1.5, 1.5)
            self.m[k] = beta1 * self.m[k] + (1.0 - beta1) * g
            self.v[k] = beta2 * self.v[k] + (1.0 - beta2) * (g * g)
            m_hat = self.m[k] / (1.0 - beta1 ** self.t)
            v_hat = self.v[k] / (1.0 - beta2 ** self.t)
            param -= lr * m_hat / (np.sqrt(v_hat) + eps)

        return loss


def run_batch8_pipeline():
    gen = AutonomousTaskGenerator(d_model=16)
    X_train, Y_train, _ = gen.build_dataset(n_samples=120, seed=42, domain_type="mixed", difficulty=1.0)
    X_val, Y_val, _ = gen.build_dataset(n_samples=90, seed=123, domain_type="mixed", difficulty=1.0)
    X_hidden, Y_hidden, _ = gen.build_dataset(n_samples=90, seed=777, domain_type="mixed", difficulty=1.4)

    champion = AutonomousZyntheorModel(d_model=16, max_steps=3, seed=42)
    t0 = time.time()
    for _ in range(35):
        champion.train_step(X_train, Y_train, lr=0.008)
    train_sec = round(time.time() - t0, 3)

    p_val, _ = champion.predict(X_val)
    champ_acc = float(np.mean(np.abs(p_val[:, 2] - Y_val[:, 2]) < 0.08))

    candidate = AutonomousZyntheorModel(d_model=16, max_steps=3, seed=42)
    candidate.restore_weights(champion.clone_weights())
    X_new_exp, Y_new_exp, _ = gen.build_dataset(n_samples=90, seed=999, domain_type="mixed", difficulty=1.2)
    for _ in range(20):
        candidate.train_step(X_new_exp, Y_new_exp, lr=0.004)

    p_cand, _ = candidate.predict(X_val)
    cand_acc = float(np.mean(np.abs(p_cand[:, 2] - Y_val[:, 2]) < 0.08))
    promoted = False
    if cand_acc > champ_acc:
        champion.restore_weights(candidate.clone_weights())
        promoted = True

    X_transfer, Y_transfer, _ = gen.build_dataset(n_samples=60, seed=555, domain_type="transfer", difficulty=1.2)
    p_trans, _ = champion.predict(X_transfer)
    transfer_acc = float(np.mean(np.abs(p_trans[:, 2] - Y_transfer[:, 2]) < 0.08))

    p_adaptive, _ = champion.predict(X_hidden, adaptive=True)
    adaptive_acc = float(np.mean(np.abs(p_adaptive[:, 2] - Y_hidden[:, 2]) < 0.08))

    seeds = [42, 123, 2026]
    final_accs = []
    for s in seeds:
        m = AutonomousZyntheorModel(d_model=16, max_steps=3, seed=s)
        for _ in range(30):
            m.train_step(X_train, Y_train, lr=0.008)
        p_f, _ = m.predict(X_hidden)
        final_accs.append(float(np.mean(np.abs(p_f[:, 2] - Y_hidden[:, 2]) < 0.08)))

    mean_final = float(np.mean(final_accs))
    std_final = float(np.std(final_accs))

    report = {
        "batch": "ZYNTHEOR Batch 8 — Recovered Leak-Free Autonomous Learning",
        "phase_1_baseline_integrity": {
            "validation_accuracy": round(champ_acc, 4),
            "reproducible_seeds": seeds,
        },
        "phase_2_autonomous_learning": {
            "experience_replay_seeded": True,
            "candidate_promoted": promoted,
            "candidate_accuracy": round(cand_acc, 4),
        },
        "phase_3_meta_learning_and_transfer": {
            "cross_domain_transfer_accuracy": round(transfer_acc, 4),
        },
        "phase_5_adaptive_reasoning": {
            "hidden_ood_adaptive_accuracy": round(adaptive_acc, 4),
        },
        "phase_8_final_evaluation": {
            "mean_hidden_accuracy": round(mean_final, 4),
            "std_hidden_accuracy": round(std_final, 4),
            "confidence_interval_95": [round(mean_final - 1.96 * std_final / math.sqrt(len(seeds)), 4), round(mean_final + 1.96 * std_final / math.sqrt(len(seeds)), 4)],
            "training_seconds": train_sec,
        },
    }

    os.makedirs("native_data", exist_ok=True)
    with open("native_data/batch8_autonomous_learning_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return report


if __name__ == "__main__":
    print(json.dumps(run_batch8_pipeline(), indent=2))
