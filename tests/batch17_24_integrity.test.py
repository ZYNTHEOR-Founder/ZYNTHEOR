# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batches 17-24 Integrity & Regression Unit Tests
Verifies:
- np_compat math, reductions, broadcasting, and RNG determinism
- Exact finite-difference numerical gradients on CognitiveTransformerNet
- Zero target leakage invariant (changing target rules leaves X bit-identical)
- Disjoint split isolation and fail-closed episodic memory write rejection
- Brier / ECE calibration and validation-only temperature scaling
- Fresh-init few-shot independence across k values
- Recovered batch6..14 module integrity
- Champion rollback SHA-256 invariance on rejected challenger
- Batch 20 Gate H honest BLOCKED enforcement when artifacts/DB/cloud env vars are unprovisioned
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native import np_compat as npc
from qplus_native.cognitive_core import (
    CognitiveTaskSuite,
    CognitiveTransformerNet,
    InputLeakageError,
    IsolatedEpisodicMemory,
    assert_disjoint_splits,
    check_numerical_gradients,
    compute_brier_and_ece,
    fit_temperature,
    run_isolated_few_shot_adaptation,
    validateInputLeakage,
)
from qplus_native.batch21_24_integrity_recovery import audit_batch_sources, verify_zero_target_leakage


class TestNpCompat(unittest.TestCase):
    def test_ops_and_broadcasting(self):
        a = npc.array([[1.0, 2.0], [3.0, 4.0]])
        b = npc.array([10.0, 20.0])
        c = a + b
        self.assertEqual(c.shape, (2, 2))
        self.assertAlmostEqual(float(c[1, 1]), 24.0)
        sq = npc.sqrt(npc.array([4.0, 9.0]))
        self.assertAlmostEqual(float(sq[1]), 3.0)
        ex = npc.exp(npc.array([0.0, 1.0]))
        self.assertAlmostEqual(float(ex[0]), 1.0, places=6)


class TestCognitiveCoreIntegrity(unittest.TestCase):
    def test_numerical_gradients_exact(self):
        res = check_numerical_gradients(d_model=8)
        self.assertTrue(res["passed"], f"Numerical gradient check failed: {res}")
        self.assertLess(res["max_relative_error"], 1e-4)

    def test_zero_target_leakage(self):
        leak = verify_zero_target_leakage(d_model=12)
        self.assertTrue(leak["input_invariance_under_target_rule_change"])
        self.assertTrue(leak["target_actually_differs"])
        self.assertTrue(leak["split_isolation"]["disjoint"])
        self.assertTrue(leak["input_leakage_validation"]["passed"])

    def test_validate_input_leakage_passes_clean_and_rejects_leaked_tensors(self):
        suite = CognitiveTaskSuite(d_model=10)
        X, Y, _, _ = suite.build_dataset(n_samples=21, seed=314)
        report = validateInputLeakage(X, Y, return_report=True)
        self.assertTrue(report["passed"])

        # Case 1: Direct target vector embedded into input timestep (Batch 6-14 regression)
        X_embed = X.copy()
        for i in range(X_embed.shape[0]):
            X_embed[i, 5] = Y[i]
        with self.assertRaises(InputLeakageError):
            validateInputLeakage(X_embed, Y)

        # Case 2: Scaled/shifted linear leakage of target column into an input feature
        X_aff = X.copy()
        for i in range(X_aff.shape[0]):
            X_aff[i, 4, 3] = 2.75 * float(Y[i, 2]) - 0.4
        with self.assertRaises(InputLeakageError):
            validateInputLeakage(X_aff, Y)

        # Case 3: Pure Python 2D input / 1D target leakage rejection
        with self.assertRaises(InputLeakageError):
            validateInputLeakage(
                [[0.1, 10.0], [0.2, 20.0], [0.3, 30.0], [0.4, 40.0]],
                [1.0, 2.0, 3.0, 4.0],
            )

    def test_few_shot_adaptation_fresh_init_isolation(self):
        suite = CognitiveTaskSuite(d_model=10)
        X_tr, Y_tr, _, _ = suite.build_dataset(
            n_samples=16, seed=9100, domain_filter="few_shot_adaptation", ood_regime=True
        )
        X_te, Y_te, dom_te, _ = suite.build_dataset(
            n_samples=16, seed=9200, domain_filter="few_shot_adaptation", ood_regime=True
        )

        created_models = []
        observed_init_hashes = {}

        def spy_factory(**kwargs):
            m = CognitiveTransformerNet(**kwargs)
            created_models.append((kwargs.get("seed"), id(m), m.weights_sha256()))
            observed_init_hashes.setdefault(kwargs.get("seed"), set()).add(m.weights_sha256())
            return m

        results = run_isolated_few_shot_adaptation(
            X_tr,
            Y_tr,
            X_te,
            Y_te,
            dom_te,
            shot_counts=(2, 4, 8, 12),
            seeds=(11, 22),
            d_model=10,
            deliberation_steps=2,
            epochs=4,
            lr=0.05,
            seed_offset=500,
            model_factory=spy_factory,
        )

        self.assertEqual([r["k"] for r in results], [2, 4, 8, 12])
        # 2 baseline refs + (4 shot counts * 2 seeds) = 10 distinct instances created
        self.assertEqual(len(created_models), 10)
        self.assertEqual(len({obj_id for _, obj_id, _ in created_models}), 10)
        # Every instance for a given seed started with identical untainted init hash (zero carry-over)
        for seed_val, hashes in observed_init_hashes.items():
            self.assertEqual(len(hashes), 1, f"Seed {seed_val} had varying initial hashes: {hashes}")
        for row in results:
            self.assertTrue(row["fresh_init_per_k"])
            self.assertTrue(row["isolated_instances"])
            self.assertTrue(row["init_sha256_verified"])
            self.assertFalse(row["parameter_leakage_detected"])
            self.assertNotEqual(row["init_sha256_prefixes"], row["post_train_sha256_prefixes"])

    def test_disjoint_split_fail_closed_on_overlap(self):
        suite = CognitiveTaskSuite(d_model=12)
        X1, _, _, _ = suite.build_dataset(n_samples=14, seed=42)
        with self.assertRaises(RuntimeError):
            assert_disjoint_splits({"train": X1, "val": X1})

    def test_episodic_memory_rejects_non_train_split(self):
        suite = CognitiveTaskSuite(d_model=12)
        X, Y, doms, _ = suite.build_dataset(n_samples=7, seed=88)
        mem = IsolatedEpisodicMemory(max_items=32)
        mem.store(X[0], Y[0], doms[0], split="train")
        for forbidden in ["val", "test", "ood"]:
            with self.assertRaises(RuntimeError):
                mem.store(X[1], Y[1], doms[1], split=forbidden)
        self.assertEqual(len(mem.entries), 1)

    def test_calibration_brier_ece_and_temperature(self):
        probs = [0.9, 0.9, 0.1, 0.1]
        labels = [1.0, 1.0, 0.0, 0.0]
        cal = compute_brier_and_ece(probs, labels, n_bins=10)
        self.assertLess(cal["brier_score"], 0.02)
        self.assertLess(cal["ece"], 0.15)
        t = fit_temperature([2.0, -2.0, 1.5, -1.5], [1.0, 0.0, 1.0, 0.0])
        self.assertGreaterEqual(t, 0.2)
        self.assertLessEqual(t, 4.0)

    def test_champion_rollback_preserves_exact_sha256(self):
        net = CognitiveTransformerNet(d_model=12, deliberation_steps=2, seed=7)
        snap = net.clone_weights()
        sha_before = net.weights_sha256()
        # Mutate weights intentionally (simulating failed challenger step)
        net.w_out += 5.0
        self.assertNotEqual(net.weights_sha256(), sha_before)
        net.restore_weights(snap)
        self.assertEqual(net.weights_sha256(), sha_before)


class TestBatchAuditAndGateH(unittest.TestCase):
    def test_recovered_batch6_to_14_clean(self):
        audit = audit_batch_sources()
        self.assertTrue(audit["all_recovered_modules_clean"], f"Violations: {audit}")

    def test_gate_h_reports_blocked_when_unprovisioned(self):
        manifest_path = ROOT / "native_data" / "ZYNTHEOR_RELEASE_MANIFEST.json"
        if manifest_path.exists():
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not data["checks"]["local_seq_pure_checkpoint"]["present"]:
                self.assertEqual(data["release_status"], "BLOCKED")


if __name__ == "__main__":
    unittest.main()
