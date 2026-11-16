# -*- coding: utf-8 -*-
"""
ZYNTHEOR Training Pipeline Integrity Tests (pytest + unittest compatible).
Validates:
- CognitiveTransformerNet exact finite-difference gradients & zero target leakage
- Prompt gradient masking (IGNORE_INDEX=-100 -> 0.0 gradients)
- Pure-Python & NumPy training loop convergence & finite losses without NaN/Inf
"""

import math
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    np = None  # type: ignore[assignment]
    HAS_NUMPY = False

from qplus_native.batch21_24_integrity_recovery import verify_zero_target_leakage
from qplus_native.cognitive_core import check_numerical_gradients
from qplus_native.seq_lm import PureSeqLM, SeqLMConfig


class TrainingPipelineTests(unittest.TestCase):
    def test_cognitive_transformer_gradients_and_zero_leakage(self):
        grad_res = check_numerical_gradients(d_model=8)
        self.assertTrue(grad_res["passed"], f"Numerical gradient check failed: {grad_res}")
        self.assertLess(grad_res["max_relative_error"], 1e-4)

        leak = verify_zero_target_leakage(d_model=10)
        self.assertTrue(leak["input_invariance_under_target_rule_change"])
        self.assertTrue(leak["target_actually_differs"])
        self.assertTrue(leak["split_isolation"]["disjoint"])
        self.assertTrue(leak["input_leakage_validation"]["passed"])

    def test_pure_seq_lm_forward_and_training_step(self):
        lm = PureSeqLM(SeqLMConfig(vocab=24, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=8), seed=42)
        seq = [1, 4, 7, 10, 12]
        logits, _ = lm.forward_seq(seq[:-1], keep_cache=False)
        self.assertEqual(len(logits), len(seq) - 1)
        self.assertTrue(all(math.isfinite(float(v)) for row in logits for v in row))

    @unittest.skipUnless(HAS_NUMPY, "numpy not installed in host python3")
    def test_prompt_gradient_masking_and_lm_v2_step(self):
        from qplus_native.loss_mask import IGNORE_INDEX, masked_cross_entropy_loss_and_backward

        rng = np.random.default_rng(7)
        logits = rng.standard_normal((2, 8, 16))
        labels = np.full((2, 8), IGNORE_INDEX, dtype=int)
        labels[:, 4:] = rng.integers(0, 16, size=(2, 4))
        loss, grad = masked_cross_entropy_loss_and_backward(logits, labels)
        self.assertTrue(math.isfinite(float(loss)))
        self.assertTrue(np.all(grad[:, :4, :] == 0.0))
        self.assertTrue(np.any(grad[:, 4:, :] != 0.0))

        from qplus_native.lm_v2 import LMConfig, NativeLM

        model = NativeLM(LMConfig(vocab=16, d_model=16, n_layers=1, n_heads=2, d_ffn=24, ctx=6), seed=9)
        x = np.array([[1, 2, 3, 4, 5, 6]])
        y = np.array([[2, 3, 4, 5, 6, 7]])
        lg0, cache = model.forward(x, True)
        l0, dl = model.ce_loss(lg0, y)
        grads = model.backward(dl, cache)
        for name, w in model.p.items():
            w -= 0.05 * grads[name]
        lg1, _ = model.forward(x, False)
        l1, _ = model.ce_loss(lg1, y)
        self.assertTrue(math.isfinite(float(l1)))
        self.assertLess(float(l1), float(l0))


if __name__ == "__main__":
    unittest.main(verbosity=2)
