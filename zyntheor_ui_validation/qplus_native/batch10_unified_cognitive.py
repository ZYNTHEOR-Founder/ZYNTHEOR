import json
import os
import time
import math
try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np
from typing import Dict, List, Tuple, Any
from qplus_native.reasoning_engine import LatentReasoningCore


class UnifiedCognitiveTaskGenerator:
    """
    Leak-free task generator (Batch 10 recovered).
    Encodes ONLY observable premises at t=0..4 and query marker at t=5.
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
                domains.append("unified_algebra")
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
                domains.append("unified_compositional_logic")
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
                domains.append("unified_abstract_transfer")
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
                domains.append("unified_causal_planning")
                t1 = rng.uniform(0.5, 2.0)
                t2 = rng.uniform(0.5, 2.0)
                crit = max(t1, t2)
                total = crit + 0.5 * (t1 + t2)
                X[idx, 0] = self._encode([0, 0, 0, 1, 0, t1, 0])
                X[idx, 1] = self._encode([0, 0, 0, 1, 0, t2, 0])
                X[idx, 5] = self._encode([0, 0, 0, 1, 0, 0, 1.0])
                Y[idx] = self._encode([crit / 6.0, total / 6.0, (total - crit) / 6.0])
            else:
                domains.append("unified_uncertainty")
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


class UnifiedCognitiveEngine(LatentReasoningCore):
    def __init__(self, d_model: int = 16, max_seq: int = 16, reasoning_steps: int = 3, seed: int = 42):
        super().__init__(d_model=d_model, max_seq=max_seq, reasoning_steps=reasoning_steps, seed=seed)
        rng = np.random.default_rng(seed + 1000)
        scale = 0.08 / math.sqrt(d_model)
        self.p["w_memory"] = rng.normal(0.0, scale, (d_model, d_model))

    def count_parameters(self) -> int:
        return sum(v.size for v in self.p.values())


class UnifiedZyntheorModel:
    def __init__(self, d_model: int = 16, max_steps: int = 3, seed: int = 42, use_attention: bool = True, use_memory: bool = True):
        self.d_model = d_model
        self.max_steps = max_steps
        self.use_attention = use_attention
        self.use_memory = use_memory
        self.seed = seed
        self.replay_rng = np.random.default_rng(seed + 9001)

        self.core = UnifiedCognitiveEngine(d_model=d_model, max_seq=16, reasoning_steps=max_steps, seed=seed)
        rng = np.random.default_rng(seed + 1100)
        scale = 0.08 / math.sqrt(d_model)
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

    def count_parameters(self) -> int:
        return sum(v.size for v in self._all_params().values())

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
        return self.max_steps if float(np.var(X)) > 0.2 else max(1, self.max_steps - 1)

    def predict(self, X: np.ndarray, adaptive: bool = True) -> Tuple[np.ndarray, Dict[str, Any]]:
        steps = self.estimate_complexity(X) if adaptive else self.max_steps
        if not self.use_attention:
            h_core = X + self.core.p["pos_emb"][:X.shape[1]][None, :, :]
            cache = {}
        else:
            h_core, cache = self.core.forward(X, steps=steps)

        mem_pre = None
        mem_act = None
        h = h_core
        if self.use_memory:
            mem_pre = h_core @ self.core.p["w_memory"]
            mem_act = np.tanh(mem_pre)
            h = h_core + 0.15 * mem_act

        final_h = h[:, -1, :]
        pred = final_h @ self.w_out + self.b_out
        return pred, {
            "h": h,
            "h_core": h_core,
            "mem_act": mem_act,
            "final_h": final_h,
            "cache": cache,
            "steps_used": steps,
        }

    def add_to_replay(self, X: np.ndarray, Y: np.ndarray):
        for i in range(X.shape[0]):
            if len(self.replay_buffer) >= self.max_buffer_size:
                self.replay_buffer.pop(0)
            self.replay_buffer.append((X[i : i + 1], Y[i : i + 1]))

    def train_step(self, X: np.ndarray, Y: np.ndarray, lr: float = 0.007) -> float:
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

        gw_memory = np.zeros_like(self.core.p["w_memory"])
        if self.use_memory and state["mem_act"] is not None:
            d_mem_act = 0.15 * dh
            d_mem_pre = d_mem_act * (1.0 - state["mem_act"] * state["mem_act"])
            gw_memory = np.einsum("bti,btj->ij", state["h_core"], d_mem_pre)
            dh_core = dh + (d_mem_pre @ self.core.p["w_memory"].T)
        else:
            dh_core = dh

        if self.use_attention and state["cache"]:
            _, grads = self.core.backward(dh_core, state["cache"])
        else:
            grads = {k: np.zeros_like(v) for k, v in self.core.p.items()}
            grads["pos_emb"][train_X.shape[1] - 1] = np.sum(dh_core[:, -1, :], axis=0)

        grads["w_memory"] = gw_memory
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


def run_batch10_pipeline():
    gen = UnifiedCognitiveTaskGenerator(d_model=16)
    X_train, Y_train, _ = gen.build_dataset(n_samples=120, seed=42, domain_type="mixed", difficulty=1.0)
    X_val, Y_val, _ = gen.build_dataset(n_samples=90, seed=123, domain_type="mixed", difficulty=1.0)
    X_ood, Y_ood, _ = gen.build_dataset(n_samples=90, seed=777, domain_type="mixed", difficulty=1.4)

    champion = UnifiedZyntheorModel(d_model=16, max_steps=3, seed=42, use_attention=True, use_memory=True)
    t0 = time.time()
    for _ in range(35):
        champion.train_step(X_train, Y_train, lr=0.008)
    train_sec = round(time.time() - t0, 3)

    p_val, _ = champion.predict(X_val)
    val_acc = float(np.mean(np.abs(p_val[:, 2] - Y_val[:, 2]) < 0.08))
    p_ood, _ = champion.predict(X_ood)
    ood_acc = float(np.mean(np.abs(p_ood[:, 2] - Y_ood[:, 2]) < 0.08))

    ablation_results = {}
    for name, flags in [
        ("unified_full_architecture", {"use_attention": True, "use_memory": True}),
        ("no_causal_attention", {"use_attention": False, "use_memory": True}),
        ("no_working_memory", {"use_attention": True, "use_memory": False}),
    ]:
        m_abl = UnifiedZyntheorModel(d_model=16, max_steps=3, seed=42, **flags)
        for _ in range(30):
            m_abl.train_step(X_train, Y_train, lr=0.008)
        p_a, _ = m_abl.predict(X_ood)
        ablation_results[name] = {"ood_accuracy": round(float(np.mean(np.abs(p_a[:, 2] - Y_ood[:, 2]) < 0.08)), 4)}

    seeds = [42, 123, 2026, 777, 999]
    final_accs = []
    for s in seeds:
        m_v = UnifiedZyntheorModel(d_model=16, max_steps=3, seed=s, use_attention=True, use_memory=True)
        for _ in range(30):
            m_v.train_step(X_train, Y_train, lr=0.008)
        p_f, _ = m_v.predict(X_ood)
        final_accs.append(float(np.mean(np.abs(p_f[:, 2] - Y_ood[:, 2]) < 0.08)))

    mean_final = float(np.mean(final_accs))
    std_final = float(np.std(final_accs))

    report = {
        "batch": "ZYNTHEOR Batch 10 — Recovered Leak-Free Unified Cognitive Architecture",
        "phase_1_and_3_generalization_audit": {
            "in_distribution_validation_accuracy": round(val_acc, 4),
            "out_of_distribution_accuracy": round(ood_acc, 4),
            "generalization_gap": round(val_acc - ood_acc, 4),
        },
        "phase_8_ablation_results": ablation_results,
        "phase_9_final_validation": {
            "seeds_tested": seeds,
            "mean_hidden_ood_accuracy": round(mean_final, 4),
            "std_hidden_ood_accuracy": round(std_final, 4),
            "confidence_interval_95": [round(mean_final - 1.96 * std_final / math.sqrt(len(seeds)), 4), round(mean_final + 1.96 * std_final / math.sqrt(len(seeds)), 4)],
            "training_seconds": train_sec,
            "parameter_count": champion.count_parameters(),
        },
    }

    os.makedirs("native_data", exist_ok=True)
    with open("native_data/batch10_unified_cognitive_intelligence_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return report


if __name__ == "__main__":
    print(json.dumps(run_batch10_pipeline(), indent=2))
