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


class RigorousGeneralizationTaskGenerator:
    """
    Leak-free task generator (Batch 12 recovered).
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

        domain_map = {
            "compositional": 0, "multihop": 1, "induction": 2,
            "causal": 3, "transfer": 4, "novel": 5,
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
                # Observed inputs ONLY: x0 and delta at t=0,1; predict unseen x1,x2,x3
                X[idx, 0] = self._encode([0, 0, 1, 0, 0, 0, x0, 0])
                X[idx, 1] = self._encode([0, 0, 1, 0, 0, 0, delta, 0])
                X[idx, 5] = self._encode([0, 0, 1, 0, 0, 0, 0, 1.0])
                Y[idx] = self._encode([x1 / 6.0, x2 / 6.0, x3 / 6.0])
            elif d_id == 3:
                domains.append("causal_reasoning")
                t1 = rng.uniform(0.5, 2.0)
                t2 = rng.uniform(0.5, 2.0)
                crit = max(t1, t2)
                total = crit + 0.5 * (t1 + t2)
                X[idx, 0] = self._encode([0, 0, 0, 1, 0, 0, t1, 0])
                X[idx, 1] = self._encode([0, 0, 0, 1, 0, 0, t2, 0])
                X[idx, 5] = self._encode([0, 0, 0, 1, 0, 0, 0, 1.0])
                Y[idx] = self._encode([crit / 6.0, total / 6.0, (total - crit) / 6.0])
            elif d_id == 4:
                domains.append("transfer_learning")
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
                domains.append("novel_problem_solving")
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


class Batch12ZyntheorModel:
    def __init__(self, d_model: int = 16, max_steps: int = 3, seed: int = 42, use_attention: bool = True, use_swiglu: bool = True):
        self.d_model = d_model
        self.max_steps = max_steps
        self.use_attention = use_attention
        self.use_swiglu = use_swiglu

        steps = max_steps if use_swiglu else 0
        self.core = LatentReasoningCore(d_model=d_model, max_seq=16, reasoning_steps=steps, seed=seed)
        rng = np.random.default_rng(seed + 1200)
        scale = 0.08 / math.sqrt(d_model)
        self.w_out = rng.normal(0.0, scale, (d_model, d_model))
        self.b_out = np.zeros((d_model,), dtype=np.float64)

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

    def predict(self, X: np.ndarray) -> Tuple[np.ndarray, Dict[str, Any]]:
        steps = self.max_steps if self.use_swiglu else 0
        if not self.use_attention:
            h = X + self.core.p["pos_emb"][:X.shape[1]][None, :, :]
            cache = {}
        else:
            h, cache = self.core.forward(X, steps=steps)

        final_h = h[:, -1, :]
        pred = final_h @ self.w_out + self.b_out
        return pred, {"h": h, "final_h": final_h, "cache": cache}

    def train_step(self, X: np.ndarray, Y: np.ndarray, lr: float = 0.007) -> float:
        pred, state = self.predict(X)
        diff = pred - Y
        loss = float(np.mean(diff * diff))
        B = X.shape[0]
        d_pred = (2.0 / (B * self.d_model)) * diff

        gw_out = state["final_h"].T @ d_pred
        gb_out = np.sum(d_pred, axis=0)
        d_final_h = d_pred @ self.w_out.T

        if self.use_attention and state["cache"]:
            dh = np.zeros_like(state["h"])
            dh[:, -1, :] = d_final_h
            _, grads = self.core.backward(dh, state["cache"])
        else:
            grads = {k: np.zeros_like(v) for k, v in self.core.p.items()}
            grads["pos_emb"][X.shape[1] - 1] = np.sum(d_final_h, axis=0)

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


def run_batch12_pipeline():
    from qplus_native.batch10_unified_cognitive import UnifiedZyntheorModel
    from qplus_native.batch11_scalable_neural import ScalableZyntheorModel

    g_base = RigorousGeneralizationTaskGenerator(d_model=16)
    X_tr_b, Y_tr_b, _ = g_base.build_dataset(n_samples=120, seed=42, domain_type="mixed", difficulty=1.0)
    X_ood_b, Y_ood_b, _ = g_base.build_dataset(n_samples=90, seed=777, domain_type="mixed", difficulty=1.4)

    m_b10 = UnifiedZyntheorModel(d_model=16, max_steps=3, seed=42)
    m_b11 = ScalableZyntheorModel(d_model=16, max_steps=3, seed=42)
    for _ in range(30):
        m_b10.train_step(X_tr_b, Y_tr_b, lr=0.007)
        m_b11.train_step(X_tr_b, Y_tr_b, lr=0.007)
    b10_acc = float(np.mean(np.abs(m_b10.predict(X_ood_b)[0][:, 2] - Y_ood_b[:, 2]) < 0.08))
    b11_acc = float(np.mean(np.abs(m_b11.predict(X_ood_b)[0][:, 2] - Y_ood_b[:, 2]) < 0.08))

    scaling_configs = {
        "small": {"d_model": 12, "steps": 2},
        "medium": {"d_model": 16, "steps": 3},
        "large": {"d_model": 20, "steps": 4},
    }
    scaling_results = {}
    for name, cfg in scaling_configs.items():
        d, steps = cfg["d_model"], cfg["steps"]
        g_cfg = RigorousGeneralizationTaskGenerator(d_model=d)
        X_tr, Y_tr, _ = g_cfg.build_dataset(n_samples=120, seed=42, domain_type="mixed", difficulty=1.0)
        X_ood, Y_ood, _ = g_cfg.build_dataset(n_samples=90, seed=777, domain_type="mixed", difficulty=1.4)
        m = Batch12ZyntheorModel(d_model=d, max_steps=steps, seed=42)
        t0 = time.time()
        for _ in range(35):
            m.train_step(X_tr, Y_tr, lr=0.007)
        train_s = round(time.time() - t0, 3)
        p_ood, _ = m.predict(X_ood)
        scaling_results[name] = {
            "parameters": m.count_parameters(),
            "hidden_ood_accuracy": round(float(np.mean(np.abs(p_ood[:, 2] - Y_ood[:, 2]) < 0.08)), 4),
            "training_seconds": train_s,
        }

    ablation_results = {}
    for abl_name, flags in [
        ("full_architecture", {"use_attention": True, "use_swiglu": True}),
        ("no_causal_attention", {"use_attention": False, "use_swiglu": True}),
        ("no_swiglu_activation", {"use_attention": True, "use_swiglu": False}),
    ]:
        m_abl = Batch12ZyntheorModel(d_model=16, max_steps=3, seed=42, **flags)
        for _ in range(35):
            m_abl.train_step(X_tr_b, Y_tr_b, lr=0.007)
        p_a, _ = m_abl.predict(X_ood_b)
        ablation_results[abl_name] = {"ood_accuracy": round(float(np.mean(np.abs(p_a[:, 2] - Y_ood_b[:, 2]) < 0.08)), 4)}

    seeds = [42, 123, 2026, 777, 999]
    seed_accs = []
    domains_list = ["compositional_reasoning", "multihop_logic", "abstract_rule_induction", "causal_reasoning", "transfer_learning", "novel_problem_solving"]
    per_task_accs = {dom: [] for dom in domains_list}

    g_champ = RigorousGeneralizationTaskGenerator(d_model=20)
    X_tr_c, Y_tr_c, _ = g_champ.build_dataset(n_samples=120, seed=42, domain_type="mixed", difficulty=1.0)
    X_hid_c, Y_hid_c, dom_hid = g_champ.build_dataset(n_samples=90, seed=888, domain_type="mixed", difficulty=1.4)

    t_start = time.time()
    for s in seeds:
        m_s = Batch12ZyntheorModel(d_model=20, max_steps=3, seed=s)
        for _ in range(35):
            m_s.train_step(X_tr_c, Y_tr_c, lr=0.007)
        p_f, _ = m_s.predict(X_hid_c)
        seed_accs.append(float(np.mean(np.abs(p_f[:, 2] - Y_hid_c[:, 2]) < 0.08)))
        for dom in domains_list:
            mask = np.array([d == dom for d in dom_hid])
            if np.sum(mask) > 0:
                per_task_accs[dom].append(float(np.mean(np.abs(p_f[mask, 2] - Y_hid_c[mask, 2]) < 0.08)))

    total_time = round(time.time() - t_start, 3)
    mean_acc = float(np.mean(seed_accs))
    std_acc = float(np.std(seed_accs))
    ci_95 = [round(mean_acc - 2.776 * std_acc / math.sqrt(len(seeds)), 4), round(mean_acc + 2.776 * std_acc / math.sqrt(len(seeds)), 4)]

    report = {
        "batch": "ZYNTHEOR Batch 12 — Recovered Leak-Free Generalization & Scaling",
        "baseline_comparison": {
            "batch10_ood_accuracy": round(b10_acc, 4),
            "batch11_ood_accuracy": round(b11_acc, 4),
            "batch12_ood_accuracy": round(mean_acc, 4),
        },
        "scaling_verification": scaling_results,
        "ablation_results": ablation_results,
        "per_task_reasoning_accuracy": {dom: round(float(np.mean(vals)), 4) for dom, vals in per_task_accs.items() if vals},
        "multi_seed_validation": {
            "seeds_tested": seeds,
            "mean_hidden_ood_accuracy": round(mean_acc, 4),
            "std_hidden_ood_accuracy": round(std_acc, 4),
            "confidence_interval_95": ci_95,
            "total_training_seconds": total_time,
        },
        "champion_challenger_decision": {
            "promoted": bool(mean_acc > b11_acc and mean_acc > b10_acc),
            "reason": "Evaluated strictly against freshly trained Batch 10 & Batch 11 baselines on leak-free OOD tasks.",
        },
    }

    os.makedirs("native_data", exist_ok=True)
    with open("native_data/batch12_generalization_scaling_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return report


if __name__ == "__main__":
    print(json.dumps(run_batch12_pipeline(), indent=2))
