# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 18 — Generalization & Few-Shot Adaptation
Evaluates held-out ID vs OOD generalization across all 7 domains over >=5 seeds:
- compositional_reasoning
- multihop_reasoning
- abstract_rule_induction
- causal_reasoning
- cross_domain_transfer
- few_shot_adaptation (k=2,4,8,12 with fresh initialization per k)
- novel_problem_solving
Includes Student-t 95% CIs, independent ridge baseline comparison, and module ablations.
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.cognitive_core import (
    ALL_COGNITIVE_DOMAINS,
    CognitiveTaskSuite,
    CognitiveTransformerNet,
    assert_disjoint_splits,
    evaluate_cognitive_model,
    profile_memory_and_latency,
    run_isolated_few_shot_adaptation,
    summarize_multi_seed,
    validateInputLeakage,
)
from qplus_native.batch21_24_integrity_recovery import fit_independent_linear_baseline


def run_batch18() -> Dict[str, Any]:
    d_model = 10
    seeds = [111, 222, 333, 444, 555]
    suite = CognitiveTaskSuite(d_model=d_model)

    X_test_id, Y_test_id, dom_test_id, _ = suite.build_dataset(n_samples=28, seed=1801, ood_regime=False)
    X_test_ood, Y_test_ood, dom_test_ood, _ = suite.build_dataset(n_samples=28, seed=1802, ood_regime=True)
    validateInputLeakage(X_test_id, Y_test_id)
    validateInputLeakage(X_test_ood, Y_test_ood)

    id_accs: List[float] = []
    ood_accs: List[float] = []
    gen_gaps: List[float] = []
    ridge_id_accs: List[float] = []
    ridge_ood_accs: List[float] = []
    no_attn_ood: List[float] = []
    no_swiglu_ood: List[float] = []

    domain_id_scores: Dict[str, List[float]] = {d: [] for d in ALL_COGNITIVE_DOMAINS}
    domain_ood_scores: Dict[str, List[float]] = {d: [] for d in ALL_COGNITIVE_DOMAINS}

    for s in seeds:
        X_tr, Y_tr, _, _ = suite.build_dataset(n_samples=28, seed=8000 + s, ood_regime=False)
        validateInputLeakage(X_tr, Y_tr)
        if s == seeds[0]:
            assert_disjoint_splits({"train": X_tr, "test_id": X_test_id, "test_ood": X_test_ood})

        net = CognitiveTransformerNet(d_model=d_model, deliberation_steps=2, seed=s)
        net.train_epochs(X_tr, Y_tr, epochs=10, batch_size=28, lr=0.05, seed_shuffle=s)
        ev_id = evaluate_cognitive_model(net, X_test_id, Y_test_id, dom_test_id)
        ev_ood = evaluate_cognitive_model(net, X_test_ood, Y_test_ood, dom_test_ood)

        id_accs.append(ev_id["accuracy"])
        ood_accs.append(ev_ood["accuracy"])
        gen_gaps.append(round(ev_id["accuracy"] - ev_ood["accuracy"], 4))

        for dom in ALL_COGNITIVE_DOMAINS:
            if dom in ev_id["per_domain"]:
                domain_id_scores[dom].append(ev_id["per_domain"][dom]["accuracy"])
            if dom in ev_ood["per_domain"]:
                domain_ood_scores[dom].append(ev_ood["per_domain"][dom]["accuracy"])

        # Ablations on OOD
        net_na = CognitiveTransformerNet(d_model=d_model, deliberation_steps=2, seed=s, use_attention=False, use_swiglu=True)
        net_na.train_epochs(X_tr, Y_tr, epochs=10, batch_size=28, lr=0.05, seed_shuffle=s)
        no_attn_ood.append(evaluate_cognitive_model(net_na, X_test_ood, Y_test_ood, dom_test_ood)["accuracy"])

        net_ns = CognitiveTransformerNet(d_model=d_model, deliberation_steps=2, seed=s, use_attention=True, use_swiglu=False)
        net_ns.train_epochs(X_tr, Y_tr, epochs=10, batch_size=28, lr=0.05, seed_shuffle=s)
        no_swiglu_ood.append(evaluate_cognitive_model(net_ns, X_test_ood, Y_test_ood, dom_test_ood)["accuracy"])

        b_id = fit_independent_linear_baseline(X_tr, Y_tr, X_test_id, Y_test_id)
        b_ood = fit_independent_linear_baseline(X_tr, Y_tr, X_test_ood, Y_test_ood)
        ridge_id_accs.append(b_id["linear_ridge_accuracy"])
        ridge_ood_accs.append(b_ood["linear_ridge_accuracy"])

    per_domain_summary = {
        dom: {
            "id_accuracy": summarize_multi_seed(domain_id_scores[dom]),
            "ood_accuracy": summarize_multi_seed(domain_ood_scores[dom]),
        }
        for dom in ALL_COGNITIVE_DOMAINS
    }

    # Fresh-init few-shot adaptation curve (k in [2, 4, 8, 12], zero weight carry-over across k)
    X_fs_pool, Y_fs_pool, dom_fs_pool, _ = suite.build_dataset(
        n_samples=16, seed=1850, domain_filter="few_shot_adaptation", ood_regime=True
    )
    X_fs_test, Y_fs_test, dom_fs_test, _ = suite.build_dataset(
        n_samples=18, seed=1860, domain_filter="few_shot_adaptation", ood_regime=True
    )
    few_shot_curve = run_isolated_few_shot_adaptation(
        X_fs_pool,
        Y_fs_pool,
        X_fs_test,
        Y_fs_test,
        dom_fs_test,
        shot_counts=(2, 4, 8, 12),
        seeds=seeds[:3],
        d_model=d_model,
        deliberation_steps=2,
        epochs=10,
        lr=0.045,
        seed_offset=2000,
    )

    return {
        "seeds": seeds,
        "domains_evaluated": ALL_COGNITIVE_DOMAINS,
        "overall": {
            "native_id_accuracy": summarize_multi_seed(id_accs),
            "native_ood_accuracy": summarize_multi_seed(ood_accs),
            "generalization_gap_id_minus_ood": summarize_multi_seed(gen_gaps),
            "ridge_baseline_id_accuracy": summarize_multi_seed(ridge_id_accs),
            "ridge_baseline_ood_accuracy": summarize_multi_seed(ridge_ood_accs),
            "ablation_no_attention_ood": summarize_multi_seed(no_attn_ood),
            "ablation_no_swiglu_ood": summarize_multi_seed(no_swiglu_ood),
        },
        "per_domain": per_domain_summary,
        "few_shot_adaptation_curve": few_shot_curve,
    }


def main() -> None:
    os.makedirs(ROOT / "native_data", exist_ok=True)
    results, perf = profile_memory_and_latency(run_batch18)
    payload = {
        "batch": "BATCH_18_GENERALIZATION_AND_ADAPTATION",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "zero_simulation_policy": "ENFORCED",
        "resource_profile": perf,
        **results,
    }
    (ROOT / "native_data" / "batch18_generalization_adaptation_report.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8"
    )

    ov = results["overall"]
    lines = [
        "# ZYNTHEOR Batch 18 — Generalization & Few-Shot Adaptation Report",
        "",
        f"- **Generated At:** {payload['generated_at']}",
        f"- **Seeds:** `{results['seeds']}` (7 domains, Student-t 95% CI)",
        f"- **Resource Profile:** `{perf['peak_memory_kb']} KB` / `{perf['elapsed_seconds']}s`",
        "",
        "## Overall ID vs OOD vs Baselines & Ablations",
        "| Condition | Mean | Std | 95% CI |",
        "|---|---|---|---|",
        f"| Native Cognitive Core (ID) | {ov['native_id_accuracy']['mean']:.4f} | {ov['native_id_accuracy']['std']:.4f} | {ov['native_id_accuracy']['ci_95']} |",
        f"| Native Cognitive Core (OOD) | {ov['native_ood_accuracy']['mean']:.4f} | {ov['native_ood_accuracy']['std']:.4f} | {ov['native_ood_accuracy']['ci_95']} |",
        f"| Ablation: No Attention (OOD) | {ov['ablation_no_attention_ood']['mean']:.4f} | {ov['ablation_no_attention_ood']['std']:.4f} | {ov['ablation_no_attention_ood']['ci_95']} |",
        f"| Ablation: No SwiGLU (OOD) | {ov['ablation_no_swiglu_ood']['mean']:.4f} | {ov['ablation_no_swiglu_ood']['std']:.4f} | {ov['ablation_no_swiglu_ood']['ci_95']} |",
        f"| Linear Ridge Baseline (ID) | {ov['ridge_baseline_id_accuracy']['mean']:.4f} | {ov['ridge_baseline_id_accuracy']['std']:.4f} | {ov['ridge_baseline_id_accuracy']['ci_95']} |",
        f"| Linear Ridge Baseline (OOD) | {ov['ridge_baseline_ood_accuracy']['mean']:.4f} | {ov['ridge_baseline_ood_accuracy']['std']:.4f} | {ov['ridge_baseline_ood_accuracy']['ci_95']} |",
        "",
        "## Per-Domain Breakdown (ID vs OOD)",
        "| Domain | ID Mean | OOD Mean | OOD 95% CI |",
        "|---|---|---|---|",
    ]
    for dom in ALL_COGNITIVE_DOMAINS:
        d = results["per_domain"][dom]
        lines.append(
            f"| `{dom}` | {d['id_accuracy']['mean']:.4f} | {d['ood_accuracy']['mean']:.4f} | {d['ood_accuracy']['ci_95']} |"
        )
    lines.extend([
        "",
        "## Fresh-Init Few-Shot Adaptation (No Weight Carry-Over Across k)",
        "| Support Shots (k) | OOD Accuracy Mean | OOD MSE Mean | 95% CI |",
        "|---|---|---|---|",
    ])
    for row in results["few_shot_adaptation_curve"]:
        lines.append(
            f"| `k={row['k']}` | {row['ood_accuracy']['mean']:.4f} | {row['ood_mse']['mean']:.6f} | {row['ood_accuracy']['ci_95']} |"
        )
    (ROOT / "native_data" / "batch18_generalization_adaptation_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"batch18": "DONE", "id": ov["native_id_accuracy"], "ood": ov["native_ood_accuracy"]}, indent=2))


if __name__ == "__main__":
    main()
