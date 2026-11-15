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


class CognitiveEvolutionTaskGenerator:
    """
    Leak-free task generator (Batches 13 & 14 recovered).
    Encodes ONLY observable input premises at t=0..4 and query marker at t=5.
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

        domain_map = {
            "compositional": 0, "multihop": 1, "induction": 2,
            "causal": 3, "transfer": 4, "few_shot": 5,
        }
        for idx in range(n_samples):
            d_id = (idx % 6) if domain_type == "mixed" else domain_map.get(domain_type, 5)
            if d_id == 0:
                domains.append("compositional_reasoning")
                a = rng.uniform(-1.5, 1.5) * difficulty
                b = rng.uniform(-1.5, 1.5) * difficulty
                c = rng.uniform(0.5, 2.0)
                s1 = (a * b) + c
                s2 = s1 / (abs(a) + 0.8)
                ans = s2 * 1.25
                X[idx, 0] = self._encode([1, 0, 0, 0, 0, 0, a, 0])
                X[idx, 1] = self._encode([1, 0, 0, 0, 0, 0, b, 0])
                X[idx, 2] = self._encode([1, 0, 0, 0, 0, 0, c, 0])
                X[idx, 5] = self._encode([1, 0, 0, 0, 0, 0, 0, 1.0])
                Y[idx] = self._encode([s1 / 6.0, s2 / 6.0, ans / 6.0])
            elif d_id == 1:
                domains.append("multihop_logic")
                p1 = float(rng.choice([-1.0, 1.0]))
                p2 = float(rng.choice([-1.0, 1.0]))
                p3 = float(rng.choice([-1.0, 1.0]))
                h1 = p1 * p2
                h2 = h1 * p3
                h3 = h2 * p1
                X[idx, 0] = self._encode([0, 1, 0, 0, 0, 0, p1, 0])
                X[idx, 1] = self._encode([0, 1, 0, 0, 0, 0, p2, 0])
                X[idx, 2] = self._encode([0, 1, 0, 0, 0, 0, p3, 0])
                X[idx, 5] = self._encode([0, 1, 0, 0, 0, 0, 0, 1.0])
                Y[idx] = self._encode([h1 * 0.5, h2 * 0.5, h3 * 0.5])
            elif d_id == 2:
                domains.append("abstract_rule_induction")
                x0 = rng.uniform(-1.5, 1.5) * difficulty
                delta = rng.uniform(-0.8, 0.8)
                x1 = x0 + delta
                x2 = x1 + delta * 1.5
                x3 = x2 + delta * 2.0
                X[idx, 0] = self._encode([0, 0, 1, 0, 0, 0, x0, 0])
                X[idx, 1] = self._encode([0, 0, 1, 0, 0, 0, delta, 0])
                X[idx, 5] = self._encode([0, 0, 1, 0, 0, 0, 0, 1.0])
                Y[idx] = self._encode([x1 / 6.0, x2 / 6.0, x3 / 6.0])
            elif d_id == 3:
                domains.append("causal_intervention")
                t1 = rng.uniform(0.5, 2.0)
                t2 = rng.uniform(0.5, 2.0)
                crit = max(t1, t2)
                total = crit + 0.5 * (t1 + t2)
                X[idx, 0] = self._encode([0, 0, 0, 1, 0, 0, t1, 0])
                X[idx, 1] = self._encode([0, 0, 0, 1, 0, 0, t2, 0])
                X[idx, 5] = self._encode([0, 0, 0, 1, 0, 0, 0, 1.0])
                Y[idx] = self._encode([crit / 6.0, total / 6.0, (total - crit) / 6.0])
            elif d_id == 4:
                domains.append("cross_domain_transfer")
                base = rng.uniform(-1.5, 1.5) * difficulty
                scale = rng.uniform(0.8, 2.0)
                v1 = base * scale
                v2 = v1 + base
                v3 = v2 * 0.6 * scale
                X[idx, 0] = self._encode([0, 0, 0, 0, 1, 0, base, 0])
                X[idx, 1] = self._encode([0, 0, 0, 0, 1, 0, scale, 0])
                X[idx, 5] = self._encode([0, 0, 0, 0, 1, 0, 0, 1.0])
                Y[idx] = self._encode([v1 / 6.0, v2 / 6.0, v3 / 6.0])
            else:
                domains.append("few_shot_adaptation")
                base = rng.uniform(-1.2, 1.2)
                noise = rng.uniform(-0.15, 0.15) * difficulty
                est1 = base + 0.5 * noise
                est2 = est1 * 1.25
                est3 = est2 - 0.25
                X[idx, 0] = self._encode([0, 0, 0, 0, 0, 1, base, 0])
                X[idx, 1] = self._encode([0, 0, 0, 0, 0, 1, noise, 0])
                X[idx, 5] = self._encode([0, 0, 0, 0, 0, 1, 0, 1.0])
                Y[idx] = self._encode([est1 / 6.0, est2 / 6.0, est3 / 6.0])

        return X, Y, domains


class MetacognitiveZyntheorModel:
    def __init__(self, d_model: int = 16, max_steps: int = 3, seed: int = 42):
        self.d_model = d_model
        self.max_steps = max_steps
        self.seed = seed
        self.replay_rng = np.random.default_rng(seed + 13001)

        self.core = LatentReasoningCore(d_model=d_model, max_seq=16, reasoning_steps=max_steps, seed=seed)
        rng = np.random.default_rng(seed + 1300)
        scale = 0.08 / math.sqrt(d_model)
        self.w_out = rng.normal(0.0, scale, (d_model, d_model))
        self.b_out = np.zeros((d_model,), dtype=np.float64)
        self.w_conf = rng.normal(0.0, scale, (d_model, 1))
        self.b_conf = np.zeros((1,), dtype=np.float64)

        self.replay_buffer: List[Tuple[np.ndarray, np.ndarray]] = []
        self.max_buffer_size = 300

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

    def predict(self, X: np.ndarray, adaptive_depth: bool = True) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
        steps = self.max_steps if adaptive_depth else max(1, self.max_steps - 1)
        h, cache = self.core.forward(X, steps=steps)
        final_h = h[:, -1, :]
        pred = final_h @ self.w_out + self.b_out
        logit = final_h @ self.w_conf + self.b_conf
        conf = 1.0 / (1.0 + np.exp(-np.clip(logit, -10.0, 10.0)))
        return pred, conf.squeeze(-1), {"h": h, "final_h": final_h, "cache": cache, "logit": logit}

    def train_step(self, X: np.ndarray, Y: np.ndarray, lr: float = 0.007) -> float:
        for i in range(X.shape[0]):
            if len(self.replay_buffer) >= self.max_buffer_size:
                self.replay_buffer.pop(0)
            self.replay_buffer.append((X[i : i + 1], Y[i : i + 1]))

        train_X, train_Y = X, Y
        if len(self.replay_buffer) >= 32:
            indices = self.replay_rng.choice(len(self.replay_buffer), size=min(16, len(self.replay_buffer)), replace=False)
            rx = np.concatenate([self.replay_buffer[int(i)][0] for i in indices], axis=0)
            ry = np.concatenate([self.replay_buffer[int(i)][1] for i in indices], axis=0)
            train_X = np.concatenate([X, rx], axis=0)
            train_Y = np.concatenate([Y, ry], axis=0)

        pred, conf, state = self.predict(train_X, adaptive_depth=True)
        diff = pred - train_Y
        mse_loss = float(np.mean(diff * diff))

        # Binary correctness indicator on col 2 tolerance < 0.08 -> proper Brier calibration loss
        y_correct = np.array([1.0 if math.fabs(float(diff._data[i * self.d_model + 2])) < 0.08 else 0.0 for i in range(train_X.shape[0])], dtype=np.float64) if hasattr(diff, "_data") else (np.abs(diff[:, 2]) < 0.08).astype(np.float64)
        conf_err = conf - y_correct
        conf_loss = float(np.mean(conf_err * conf_err))
        loss = mse_loss + 0.15 * conf_loss

        B = train_X.shape[0]
        d_pred = (2.0 / (B * self.d_model)) * diff
        gw_out = state["final_h"].T @ d_pred
        gb_out = np.sum(d_pred, axis=0)
        d_final_h_mse = d_pred @ self.w_out.T

        # Backprop confidence head through sigmoid
        d_conf = (0.15 * 2.0 / B) * conf_err
        d_sig = (d_conf * conf * (1.0 - conf))[:, None]
        gw_conf = state["final_h"].T @ d_sig
        gb_conf = np.sum(d_sig, axis=0)
        d_final_h = d_final_h_mse + (d_sig @ self.w_conf.T)

        dh = np.zeros_like(state["h"])
        dh[:, -1, :] = d_final_h
        _, grads = self.core.backward(dh, state["cache"])
        grads["w_out"] = gw_out
        grads["b_out"] = gb_out
        grads["w_conf"] = gw_conf
        grads["b_conf"] = gb_conf

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


def run_batch13_14_pipeline():
    from qplus_native.batch12_generalization_scaling import Batch12ZyntheorModel

    gen = CognitiveEvolutionTaskGenerator(d_model=16)
    X_tr, Y_tr, _ = gen.build_dataset(n_samples=120, seed=42, domain_type="mixed", difficulty=1.0)
    X_val, Y_val, _ = gen.build_dataset(n_samples=90, seed=123, domain_type="mixed", difficulty=1.0)
    X_hid, Y_hid, dom_hid = gen.build_dataset(n_samples=90, seed=777, domain_type="mixed", difficulty=1.4)

    base_model = Batch12ZyntheorModel(d_model=16, max_steps=3, seed=42)
    for _ in range(35):
        base_model.train_step(X_tr, Y_tr, lr=0.007)
    base_val_acc = float(np.mean(np.abs(base_model.predict(X_val)[0][:, 2] - Y_val[:, 2]) < 0.08))

    seeds = [42, 123, 2026, 777, 999]
    seed_accs, val_accs, briers = [], [], []
    domains_list = ["compositional_reasoning", "multihop_logic", "abstract_rule_induction", "causal_intervention", "cross_domain_transfer", "few_shot_adaptation"]
    per_task_accs = {dom: [] for dom in domains_list}

    t_start = time.time()
    for s in seeds:
        # Distinct per-seed training resample prevents identical train tensor reuse
        X_s, Y_s, _ = gen.build_dataset(n_samples=120, seed=42 + s, domain_type="mixed", difficulty=1.0)
        model = MetacognitiveZyntheorModel(d_model=16, max_steps=3, seed=s)
        for _ in range(35):
            model.train_step(X_s, Y_s, lr=0.007)
        pv, _, _ = model.predict(X_val)
        val_accs.append(float(np.mean(np.abs(pv[:, 2] - Y_val[:, 2]) < 0.08)))

        pf, cf, _ = model.predict(X_hid)
        corr = np.abs(pf[:, 2] - Y_hid[:, 2]) < 0.08
        corr_f = np.array([1.0 if bool(c) else 0.0 for c in corr], dtype=np.float64)
        seed_accs.append(float(np.mean(corr_f)))
        briers.append(float(np.mean((cf - corr_f) * (cf - corr_f))))

        for dom in domains_list:
            mask = np.array([d == dom for d in dom_hid])
            if np.sum(mask) > 0:
                per_task_accs[dom].append(float(np.mean(np.abs(pf[mask, 2] - Y_hid[mask, 2]) < 0.08)))

    total_time = round(time.time() - t_start, 3)
    mean_acc = float(np.mean(seed_accs))
    std_acc = float(np.std(seed_accs))
    mean_val = float(np.mean(val_accs))
    mean_brier = float(np.mean(briers))
    ci_95 = [round(mean_acc - 2.776 * std_acc / math.sqrt(len(seeds)), 4), round(mean_acc + 2.776 * std_acc / math.sqrt(len(seeds)), 4)]
    promoted = bool(mean_val > base_val_acc)

    report = {
        "batches": ["ZYNTHEOR Batch 13 — Recovered Metacognitive Intelligence", "ZYNTHEOR Batch 14 — Recovered Autonomous Cognitive Evolution"],
        "phase_2_confidence_calibration": {
            "mean_brier_score": round(mean_brier, 4),
            "confidence_head_trained": True,
        },
        "phase_7_multi_seed_validation": {
            "seeds_tested": seeds,
            "mean_validation_accuracy": round(mean_val, 4),
            "baseline_validation_accuracy": round(base_val_acc, 4),
            "mean_hidden_ood_accuracy": round(mean_acc, 4),
            "std_hidden_ood_accuracy": round(std_acc, 4),
            "confidence_interval_95": ci_95,
            "total_training_seconds": total_time,
        },
        "per_task_reasoning_accuracy": {dom: round(float(np.mean(vals)), 4) for dom, vals in per_task_accs.items() if vals},
        "champion_challenger_decision": {
            "promoted": promoted,
            "reason": f"Promoted iff validation mean ({mean_val:.4f}) beats Batch 12 validation baseline ({base_val_acc:.4f}).",
        },
    }

    os.makedirs("native_data", exist_ok=True)
    with open("native_data/batch13_14_cognitive_evolution_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return report


if __name__ == "__main__":
    print(json.dumps(run_batch13_14_pipeline(), indent=2))
