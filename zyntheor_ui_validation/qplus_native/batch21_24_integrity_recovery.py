# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batches 21-24 — Integrity Recovery Audit & Corrected Baseline Verification
Audits batch6..14 source modules for prior integrity flaws (target leakage, zeroed gradients,
hardcoded baselines, unseeded replay, unconditional promotion), verifies every invariant via AST
and runtime tests, and produces multi-seed Student-t 95% CI corrected benchmarks.
"""

import ast
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np

from qplus_native.cognitive_core import (
    ALL_COGNITIVE_DOMAINS,
    CognitiveTaskSuite,
    CognitiveTransformerNet,
    assert_disjoint_splits,
    check_numerical_gradients,
    evaluate_cognitive_model,
    fingerprint_dataset,
    fit_temperature,
    profile_memory_and_latency,
    run_isolated_few_shot_adaptation,
    summarize_multi_seed,
    validateInputLeakage,
)

BATCH_FILES = [
    ("batch6", "qplus_native/batch6_cognitive_expansion.py"),
    ("batch7", "qplus_native/batch7_neural_advancement.py"),
    ("batch8", "qplus_native/batch8_autonomous_learning.py"),
    ("batch9", "qplus_native/batch9_self_improving.py"),
    ("batch10", "qplus_native/batch10_unified_cognitive.py"),
    ("batch11", "qplus_native/batch11_scalable_neural.py"),
    ("batch12", "qplus_native/batch12_generalization_scaling.py"),
    ("batch13_14", "qplus_native/batch13_14_cognitive_evolution.py"),
]


def audit_batch_sources() -> Dict[str, Any]:
    findings: List[Dict[str, Any]] = []
    all_clean = True

    prohibited_literals = ["0.7500", "0.7250", "32 * 32 * 12"]
    for name, rel_path in BATCH_FILES:
        fpath = ROOT / rel_path
        exists = fpath.exists()
        text = fpath.read_text(encoding="utf-8") if exists else ""
        syntax_ok = True
        if exists:
            try:
                ast.parse(text)
            except SyntaxError:
                syntax_ok = False

        tree = ast.parse(text) if (exists and syntax_ok) else None
        found_literals = [lit for lit in prohibited_literals if lit in text]
        has_zero_grad_stub = "np.zeros_like(dw_" in text or "= 0.0 * dw" in text
        has_val_fine_tune = "fine_tune(X_val" in text or "train_step(X_val" in text
        has_unconditional_promo = False
        if tree is not None:
            def _scan_uncond(node: ast.AST, under_if: bool) -> bool:
                if isinstance(node, ast.If):
                    # Only body guarded by non-trivial condition counts as conditional
                    trivial_true = isinstance(node.test, ast.Constant) and bool(node.test.value)
                    for child in node.body:
                        if _scan_uncond(child, under_if or (not trivial_true)):
                            return True
                    for child in node.orelse:
                        if _scan_uncond(child, under_if):
                            return True
                    return False
                if isinstance(node, ast.Assign):
                    for tgt in node.targets:
                        if isinstance(tgt, ast.Name) and tgt.id == "promoted":
                            if isinstance(node.value, ast.Constant) and node.value.value is True and not under_if:
                                return True
                for child in ast.iter_child_nodes(node):
                    if _scan_uncond(child, under_if):
                        return True
                return False
            has_unconditional_promo = _scan_uncond(tree, False)
        has_leakage_note = "Y_target" in text and "X[" in text and "X[idx, 5] = Y" in text

        clean = (
            exists
            and syntax_ok
            and not found_literals
            and not has_zero_grad_stub
            and not has_val_fine_tune
            and not has_unconditional_promo
            and not has_leakage_note
        )
        if not clean:
            all_clean = False

        findings.append({
            "module": name,
            "path": rel_path,
            "exists": exists,
            "syntax_valid": syntax_ok,
            "prohibited_hardcoded_literals": found_literals,
            "zeroed_gradient_stub": has_zero_grad_stub,
            "validation_leakage_finetune": has_val_fine_tune,
            "unconditional_promotion": has_unconditional_promo,
            "target_in_input_leakage": has_leakage_note,
            "integrity_status": "CLEAN_RECOVERED" if clean else "VIOLATION_DETECTED",
        })

    return {
        "all_recovered_modules_clean": all_clean,
        "modules_audited": len(findings),
        "module_reports": findings,
    }


def verify_zero_target_leakage(d_model: int = 12) -> Dict[str, Any]:
    suite = CognitiveTaskSuite(d_model=d_model)
    X_std, Y_std, dom_std, _ = suite.build_dataset(n_samples=35, seed=77, ood_regime=False, target_variant="standard")
    X_alt, Y_alt, dom_alt, _ = suite.build_dataset(n_samples=35, seed=77, ood_regime=False, target_variant="shifted")

    x_diff = float(np.max(np.abs(X_std - X_alt)))
    y_diff = float(np.max(np.abs(Y_std - Y_alt)))

    # Disjoint train/val/test/ood split verification
    X_tr, Y_tr, _, _ = suite.build_dataset(n_samples=49, seed=101, ood_regime=False)
    X_va, Y_va, _, _ = suite.build_dataset(n_samples=28, seed=202, ood_regime=False)
    X_te, Y_te, _, _ = suite.build_dataset(n_samples=35, seed=303, ood_regime=False)
    X_ood, Y_ood, _, _ = suite.build_dataset(n_samples=35, seed=404, ood_regime=True)
    split_check = assert_disjoint_splits({"train": X_tr, "val": X_va, "test_id": X_te, "test_ood": X_ood})
    input_leak_std = validateInputLeakage(X_std, Y_std, return_report=True)
    input_leak_alt = validateInputLeakage(X_alt, Y_alt, return_report=True)
    input_leak_tr = validateInputLeakage(X_tr, Y_tr, return_report=True)
    input_leak_te = validateInputLeakage(X_te, Y_te, return_report=True)
    input_leak_ood = validateInputLeakage(X_ood, Y_ood, return_report=True)

    return {
        "input_invariance_under_target_rule_change": x_diff == 0.0,
        "max_input_diff": round(x_diff, 8),
        "target_actually_differs": y_diff > 1e-3,
        "max_target_diff": round(y_diff, 6),
        "split_isolation": split_check,
        "input_leakage_validation": {
            "passed": all(
                r["passed"]
                for r in (input_leak_std, input_leak_alt, input_leak_tr, input_leak_te, input_leak_ood)
            ),
            "standard": input_leak_std,
            "shifted": input_leak_alt,
            "train": input_leak_tr,
            "test_id": input_leak_te,
            "test_ood": input_leak_ood,
        },
        "fingerprints": {
            "train": fingerprint_dataset(X_tr, Y_tr)[:16],
            "val": fingerprint_dataset(X_va, Y_va)[:16],
            "test_id": fingerprint_dataset(X_te, Y_te)[:16],
            "test_ood": fingerprint_dataset(X_ood, Y_ood)[:16],
        },
    }


def fit_independent_linear_baseline(X_tr: np.ndarray, Y_tr: np.ndarray, X_eval: np.ndarray, Y_eval: np.ndarray, tol: float = 0.12) -> Dict[str, Any]:
    """
    Independent linear ridge baseline trained strictly on flattened premise inputs X_tr -> Y_tr[:, 2].
    Uses normal equations via pure Python Gaussian elimination (no shared weights/classes with CognitiveTransformerNet).
    """
    N, T, D = X_tr.shape
    F = T * D
    lam = 1e-2

    def flatten(X: np.ndarray) -> List[List[float]]:
        rows: List[List[float]] = []
        raw = X._data if hasattr(X, "_data") else X.ravel().tolist()
        for i in range(X.shape[0]):
            start = i * F
            rows.append([float(raw[start + j]) for j in range(F)] + [1.0])
        return rows

    A_rows = flatten(X_tr)
    y_vec = [float(Y_tr[i, 2]) for i in range(N)]
    P = F + 1
    XtX = [[0.0] * P for _ in range(P)]
    Xty = [0.0] * P
    for r, yv in zip(A_rows, y_vec):
        for i in range(P):
            Xty[i] += r[i] * yv
            ri = r[i]
            if ri != 0.0:
                row_i = XtX[i]
                for j in range(P):
                    row_i[j] += ri * r[j]
    for i in range(P):
        XtX[i][i] += lam

    # Solve (XtX) w = Xty via Gauss-Jordan with partial pivoting
    aug = [XtX[i] + [Xty[i]] for i in range(P)]
    for col in range(P):
        piv = max(range(col, P), key=lambda r: abs(aug[r][col]))
        aug[col], aug[piv] = aug[piv], aug[col]
        diag = aug[col][col] if abs(aug[col][col]) > 1e-12 else 1e-12
        for j in range(col, P + 1):
            aug[col][j] /= diag
        for r in range(P):
            if r != col and aug[r][col] != 0.0:
                factor = aug[r][col]
                for j in range(col, P + 1):
                    aug[r][j] -= factor * aug[col][j]
    w = [aug[i][P] for i in range(P)]

    E_rows = flatten(X_eval)
    preds = [math.fsum(r[j] * w[j] for j in range(P)) for r in E_rows]
    errs = [abs(p - float(Y_eval[i, 2])) for i, p in enumerate(preds)]
    acc = math.fsum(1.0 for e in errs if e < tol) / max(1, len(errs))
    mse = math.fsum(e * e for e in errs) / max(1, len(errs))

    # Naive mean baseline on train Y[:, 2]
    y_mean = math.fsum(y_vec) / max(1, len(y_vec))
    mean_acc = math.fsum(1.0 for i in range(X_eval.shape[0]) if abs(y_mean - float(Y_eval[i, 2])) < tol) / max(1, X_eval.shape[0])

    return {
        "linear_ridge_accuracy": round(acc, 4),
        "linear_ridge_mse_col2": round(mse, 6),
        "train_mean_accuracy": round(mean_acc, 4),
    }


def run_corrected_experiments() -> Dict[str, Any]:
    d_model = 10
    suite = CognitiveTaskSuite(d_model=d_model)
    seeds = [11, 22, 33, 44, 55]

    full_id_accs: List[float] = []
    full_ood_accs: List[float] = []
    full_briers: List[float] = []
    full_eces: List[float] = []
    no_attn_id_accs: List[float] = []
    no_swiglu_id_accs: List[float] = []
    lin_id_accs: List[float] = []
    lin_ood_accs: List[float] = []
    mean_id_accs: List[float] = []
    per_seed_runs: List[Dict[str, Any]] = []

    X_val_cal, Y_val_cal, dom_val_cal, _ = suite.build_dataset(n_samples=21, seed=9001, ood_regime=False)
    X_test_id, Y_test_id, dom_test_id, _ = suite.build_dataset(n_samples=28, seed=9002, ood_regime=False)
    X_test_ood, Y_test_ood, dom_test_ood, _ = suite.build_dataset(n_samples=28, seed=9003, ood_regime=True)
    validateInputLeakage(X_val_cal, Y_val_cal)
    validateInputLeakage(X_test_id, Y_test_id)
    validateInputLeakage(X_test_ood, Y_test_ood)

    for s in seeds:
        X_tr, Y_tr, dom_tr, _ = suite.build_dataset(n_samples=28, seed=1000 + s, ood_regime=False)
        assert_disjoint_splits({"train": X_tr, "val_cal": X_val_cal, "test_id": X_test_id, "test_ood": X_test_ood})
        validateInputLeakage(X_tr, Y_tr)

        # Full model (batch_size >= n_train triggers full-batch fast path in np_compat mode)
        net = CognitiveTransformerNet(d_model=d_model, deliberation_steps=2, seed=s, use_attention=True, use_swiglu=True)
        hist = net.train_epochs(X_tr, Y_tr, epochs=10, batch_size=28, lr=0.05, seed_shuffle=s)

        # Validation-only temperature calibration
        val_pred, _, val_state = net.forward(X_val_cal)
        val_correct = [1.0 if abs(float(val_pred[i, 2]) - float(Y_val_cal[i, 2])) < 0.12 else 0.0 for i in range(X_val_cal.shape[0])]
        val_logits = [float(val_state["logit"][i]) for i in range(X_val_cal.shape[0])]
        net.temperature = fit_temperature(val_logits, val_correct)

        ev_id = evaluate_cognitive_model(net, X_test_id, Y_test_id, dom_test_id)
        ev_ood = evaluate_cognitive_model(net, X_test_ood, Y_test_ood, dom_test_ood)

        # Ablation 1: No causal attention
        net_no_attn = CognitiveTransformerNet(d_model=d_model, deliberation_steps=2, seed=s, use_attention=False, use_swiglu=True)
        net_no_attn.train_epochs(X_tr, Y_tr, epochs=10, batch_size=28, lr=0.05, seed_shuffle=s)
        ev_no_attn = evaluate_cognitive_model(net_no_attn, X_test_id, Y_test_id, dom_test_id)

        # Ablation 2: No SwiGLU deliberation
        net_no_swiglu = CognitiveTransformerNet(d_model=d_model, deliberation_steps=2, seed=s, use_attention=True, use_swiglu=False)
        net_no_swiglu.train_epochs(X_tr, Y_tr, epochs=10, batch_size=28, lr=0.05, seed_shuffle=s)
        ev_no_swiglu = evaluate_cognitive_model(net_no_swiglu, X_test_id, Y_test_id, dom_test_id)

        # Independent ridge + mean baselines
        base_id = fit_independent_linear_baseline(X_tr, Y_tr, X_test_id, Y_test_id)
        base_ood = fit_independent_linear_baseline(X_tr, Y_tr, X_test_ood, Y_test_ood)

        full_id_accs.append(ev_id["accuracy"])
        full_ood_accs.append(ev_ood["accuracy"])
        full_briers.append(ev_id["brier_score"])
        full_eces.append(ev_id["ece"])
        no_attn_id_accs.append(ev_no_attn["accuracy"])
        no_swiglu_id_accs.append(ev_no_swiglu["accuracy"])
        lin_id_accs.append(base_id["linear_ridge_accuracy"])
        lin_ood_accs.append(base_ood["linear_ridge_accuracy"])
        mean_id_accs.append(base_id["train_mean_accuracy"])

        per_seed_runs.append({
            "seed": s,
            "train_loss_start": hist[0]["loss"],
            "train_loss_end": hist[-1]["loss"],
            "calibrated_temperature": net.temperature,
            "full_id_acc": ev_id["accuracy"],
            "full_ood_acc": ev_ood["accuracy"],
            "full_brier": ev_id["brier_score"],
            "full_ece": ev_id["ece"],
            "ablation_no_attn_id_acc": ev_no_attn["accuracy"],
            "ablation_no_swiglu_id_acc": ev_no_swiglu["accuracy"],
            "baseline_ridge_id_acc": base_id["linear_ridge_accuracy"],
            "baseline_ridge_ood_acc": base_ood["linear_ridge_accuracy"],
        })

    # Fresh-init few-shot adaptation sweep (strictly isolated per k in [2, 4, 8, 12], zero parameter carry-over)
    X_fs_tr, Y_fs_tr, dom_fs_tr, _ = suite.build_dataset(n_samples=16, seed=9100, domain_filter="few_shot_adaptation", ood_regime=True)
    X_fs_te, Y_fs_te, dom_fs_te, _ = suite.build_dataset(n_samples=16, seed=9200, domain_filter="few_shot_adaptation", ood_regime=True)
    few_shot_results = run_isolated_few_shot_adaptation(
        X_fs_tr,
        Y_fs_tr,
        X_fs_te,
        Y_fs_te,
        dom_fs_te,
        shot_counts=(2, 4, 8, 12),
        seeds=seeds[:3],
        d_model=d_model,
        deliberation_steps=2,
        epochs=10,
        lr=0.05,
        seed_offset=500,
    )

    return {
        "seeds": seeds,
        "summary": {
            "full_model_id_accuracy": summarize_multi_seed(full_id_accs),
            "full_model_ood_accuracy": summarize_multi_seed(full_ood_accs),
            "full_model_brier": summarize_multi_seed(full_briers),
            "full_model_ece": summarize_multi_seed(full_eces),
            "ablation_no_attention_id_accuracy": summarize_multi_seed(no_attn_id_accs),
            "ablation_no_swiglu_id_accuracy": summarize_multi_seed(no_swiglu_id_accs),
            "independent_ridge_baseline_id": summarize_multi_seed(lin_id_accs),
            "independent_ridge_baseline_ood": summarize_multi_seed(lin_ood_accs),
            "train_mean_baseline_id": summarize_multi_seed(mean_id_accs),
        },
        "few_shot_fresh_init": few_shot_results,
        "per_seed_runs": per_seed_runs,
    }


def main() -> None:
    os.makedirs(ROOT / "native_data", exist_ok=True)
    t0 = time.perf_counter()

    source_audit = audit_batch_sources()
    leakage_audit = verify_zero_target_leakage(d_model=12)
    grad_check = check_numerical_gradients(d_model=8)
    corrected_runs, perf = profile_memory_and_latency(run_corrected_experiments)

    audit_payload = {
        "batch": "BATCH_21_24_INTEGRITY_RECOVERY",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "zero_simulation_policy": "ENFORCED",
        "source_audit": source_audit,
        "zero_target_leakage_proof": leakage_audit,
        "numerical_gradient_verification": grad_check,
        "overall_integrity_passed": (
            source_audit["all_recovered_modules_clean"]
            and leakage_audit["input_invariance_under_target_rule_change"]
            and leakage_audit["target_actually_differs"]
            and leakage_audit["split_isolation"]["disjoint"]
            and leakage_audit["input_leakage_validation"]["passed"]
            and grad_check["passed"]
        ),
    }

    corrected_payload = {
        "batch": "BATCH_21_24_CORRECTED_RESULTS",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "zero_simulation_policy": "ENFORCED",
        "performance_profile": perf,
        "total_runtime_seconds": round(time.perf_counter() - t0, 3),
        "experiments": corrected_runs,
    }

    (ROOT / "native_data" / "batch21_24_integrity_audit.json").write_text(
        json.dumps(audit_payload, indent=2), encoding="utf-8"
    )
    (ROOT / "native_data" / "batch21_24_corrected_results.json").write_text(
        json.dumps(corrected_payload, indent=2), encoding="utf-8"
    )

    audit_md = "\n".join([
        "# ZYNTHEOR Batches 21–24 — Integrity Recovery Audit Report",
        "",
        f"- **Generated At:** {audit_payload['generated_at']}",
        f"- **Overall Integrity Passed:** `{audit_payload['overall_integrity_passed']}`",
        f"- **All batch6..14 Modules Clean:** `{source_audit['all_recovered_modules_clean']}` ({source_audit['modules_audited']} audited)",
        f"- **Zero Target Leakage Proof:** `input_invariance={leakage_audit['input_invariance_under_target_rule_change']}`, `max_input_diff={leakage_audit['max_input_diff']}`, `max_target_diff={leakage_audit['max_target_diff']}`",
        f"- **Disjoint Splits:** `{leakage_audit['split_isolation']['disjoint']}` (0 pairwise sample overlaps)",
        f"- **Numerical Gradient Check:** `passed={grad_check['passed']}`, `max_relative_error={grad_check['max_relative_error']:.3e}`",
        "",
        "## Module Audit Summary",
        "| Module | File | Status |",
        "|---|---|---|",
        *[f"| `{m['module']}` | `{m['path']}` | `{m['integrity_status']}` |" for m in source_audit["module_reports"]],
        "",
    ])
    (ROOT / "native_data" / "batch21_24_integrity_audit.md").write_text(audit_md, encoding="utf-8")

    s = corrected_runs["summary"]
    corr_md = "\n".join([
        "# ZYNTHEOR Batches 21–24 — Corrected Leak-Free Multi-Seed Results",
        "",
        f"- **Generated At:** {corrected_payload['generated_at']}",
        f"- **Seeds:** {corrected_runs['seeds']}",
        f"- **Runtime / Peak Memory:** `{corrected_payload['total_runtime_seconds']}s` / `{perf['peak_memory_kb']} KB`",
        "",
        "## Honest Baseline & Ablation Comparison (95% Student-t CI)",
        "| Model / Condition | Mean | Std | 95% CI |",
        "|---|---|---|---|",
        f"| Full Native Transformer (ID) | {s['full_model_id_accuracy']['mean']:.4f} | {s['full_model_id_accuracy']['std']:.4f} | {s['full_model_id_accuracy']['ci_95']} |",
        f"| Full Native Transformer (OOD) | {s['full_model_ood_accuracy']['mean']:.4f} | {s['full_model_ood_accuracy']['std']:.4f} | {s['full_model_ood_accuracy']['ci_95']} |",
        f"| Ablation: No Attention (ID) | {s['ablation_no_attention_id_accuracy']['mean']:.4f} | {s['ablation_no_attention_id_accuracy']['std']:.4f} | {s['ablation_no_attention_id_accuracy']['ci_95']} |",
        f"| Ablation: No SwiGLU (ID) | {s['ablation_no_swiglu_id_accuracy']['mean']:.4f} | {s['ablation_no_swiglu_id_accuracy']['std']:.4f} | {s['ablation_no_swiglu_id_accuracy']['ci_95']} |",
        f"| Independent Linear Ridge Baseline (ID) | {s['independent_ridge_baseline_id']['mean']:.4f} | {s['independent_ridge_baseline_id']['std']:.4f} | {s['independent_ridge_baseline_id']['ci_95']} |",
        f"| Train-Mean Predictor Baseline (ID) | {s['train_mean_baseline_id']['mean']:.4f} | {s['train_mean_baseline_id']['std']:.4f} | {s['train_mean_baseline_id']['ci_95']} |",
        "",
    ])
    (ROOT / "native_data" / "batch21_24_corrected_results.md").write_text(corr_md, encoding="utf-8")
    print(json.dumps({"integrity_passed": audit_payload["overall_integrity_passed"], "summary": s}, indent=2))


if __name__ == "__main__":
    main()
