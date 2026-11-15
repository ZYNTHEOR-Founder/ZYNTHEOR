import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np  # type: ignore[no-redef]

from qplus_native.loss_mask import masked_cross_entropy_loss_and_backward, IGNORE_INDEX
from qplus_native.lm_v2 import NativeLM, LMConfig
from qplus_native.seq_lm import PureSeqLM, SeqLMConfig


def test_gradient_masking():
    np.random.seed(123)
    batch_size, seq_len, vocab_size = 2, 10, 40
    logits = np.random.randn(batch_size, seq_len, vocab_size)

    # First 5 tokens are prompt (IGNORE_INDEX = -100), remaining 5 are targets
    labels = np.full((batch_size, seq_len), IGNORE_INDEX, dtype=int)
    labels[:, 5:] = np.random.randint(0, vocab_size, size=(batch_size, 5))

    loss, grad_logits = masked_cross_entropy_loss_and_backward(logits, labels)

    # Verify prompt gradients are strictly zero
    prompt_grads = grad_logits[:, :5, :]
    assert np.all(prompt_grads == 0.0), "Prompt gradients must be exactly zero!"

    # Verify target gradients are active
    target_grads = grad_logits[:, 5:, :]
    assert np.any(target_grads != 0.0), "Target gradients should be active!"

    # Finite-difference check on one prompt logit and one target logit
    eps = 1e-5
    orig = logits[0, 1, 7]
    logits[0, 1, 7] = orig + eps
    l_plus, _ = masked_cross_entropy_loss_and_backward(logits, labels)
    logits[0, 1, 7] = orig - eps
    l_minus, _ = masked_cross_entropy_loss_and_backward(logits, labels)
    logits[0, 1, 7] = orig
    assert abs((l_plus - l_minus) / (2 * eps)) < 1e-10, "Masked prompt logit FD derivative must be 0!"

    orig = logits[0, 6, 3]
    logits[0, 6, 3] = orig + eps
    l_plus, _ = masked_cross_entropy_loss_and_backward(logits, labels)
    logits[0, 6, 3] = orig - eps
    l_minus, _ = masked_cross_entropy_loss_and_backward(logits, labels)
    logits[0, 6, 3] = orig
    fd = (l_plus - l_minus) / (2 * eps)
    ag = grad_logits[0, 6, 3]
    assert abs(fd - ag) < 1e-6, f"Logit gradient mismatch: fd={fd}, analytical={ag}"

    # Verify 2D/1D unbatched input shape parity
    loss_2d, grad_2d = masked_cross_entropy_loss_and_backward(logits[0], labels[0])
    assert grad_2d.shape == (seq_len, vocab_size)
    assert np.all(grad_2d[:5, :] == 0.0), "Unbatched prompt gradients must be zero!"
    assert loss_2d >= 0.0


def test_pure_seq_lm_masked_gradients():
    cfg = SeqLMConfig(vocab=24, d_model=8, n_layers=1, n_heads=2, d_ffn=16, ctx=6)
    model = PureSeqLM(cfg, seed=7)
    inputs = [4, 7, 9, 11, 13, 15]
    raw_targets = [7, 9, 11, 13, 15, 2]
    masked_targets = PureSeqLM.apply_prompt_loss_mask(raw_targets, prompt_len=3, pad_id=0)
    assert masked_targets[:3] == [IGNORE_INDEX, IGNORE_INDEX, IGNORE_INDEX]

    # All-masked target must produce strictly zero parameter gradients
    logits, cache = model.forward_seq(inputs, keep_cache=True)
    zero_loss, zero_dl = PureSeqLM.ce_loss_seq(logits, [IGNORE_INDEX] * len(inputs))
    assert zero_loss == 0.0
    zero_grads = model.backward_seq(zero_dl, cache)
    assert all(val == 0.0 for arr in zero_grads.values() for val in arr), "All-masked sequence must yield 0 weight grads!"

    # Partial prompt mask finite-difference check across every parameter tensor
    loss, dl = PureSeqLM.ce_loss_seq(logits, masked_targets)
    assert loss > 0.0
    grads = model.backward_seq(dl, cache)
    eps = 1e-5
    for name, weights in model.p.items():
        if not weights:
            continue
        idx = min(3, len(weights) - 1)
        orig = weights[idx]
        weights[idx] = orig + eps
        la, _ = PureSeqLM.ce_loss_seq(model.forward_seq(inputs)[0], masked_targets)
        weights[idx] = orig - eps
        lb, _ = PureSeqLM.ce_loss_seq(model.forward_seq(inputs)[0], masked_targets)
        weights[idx] = orig
        fd = (la - lb) / (2 * eps)
        ag = grads[name][idx]
        rel = abs(fd - ag) / max(abs(fd) + abs(ag), 1e-8)
        assert rel < 1e-4, f"PureSeqLM gradient mismatch in {name}[{idx}]: fd={fd}, analytical={ag}"


def test_native_lm_v2_masked_gradients():
    cfg = LMConfig(vocab=24, d_model=8, n_layers=1, n_heads=2, d_ffn=16, ctx=6)
    model = NativeLM(cfg, seed=11)
    rng = np.random.default_rng(11)
    tokens = np.array([[4, 6, 8, 10, 12, 14], [5, 7, 9, 11, 13, 15]], dtype=np.int64)
    targets = np.array([
        [IGNORE_INDEX, IGNORE_INDEX, IGNORE_INDEX, 10, 12, 14],
        [IGNORE_INDEX, IGNORE_INDEX, 9, 11, 13, IGNORE_INDEX],
    ], dtype=np.int64)

    logits, cache = model.forward(tokens, keep_cache=True)
    loss, dlogits = NativeLM.ce_loss(logits, targets, ignore_index=IGNORE_INDEX)
    assert loss > 0.0
    assert dlogits[0, 0, 5] == 0.0 and dlogits[1, 5, 5] == 0.0, "Masked target positions must have 0 dlogits!"
    grads = model.backward(dlogits, cache)

    # All-masked target yields strictly 0 weight gradients
    all_ignored = np.full(targets.shape, IGNORE_INDEX, dtype=np.int64)
    z_loss, z_dl = NativeLM.ce_loss(logits, all_ignored, ignore_index=IGNORE_INDEX)
    assert z_loss == 0.0
    z_grads = model.backward(z_dl, cache)
    for k, g in z_grads.items():
        assert np.all(g == 0.0), f"NativeLM all-masked gradient for {k} must be 0!"

    # Finite-difference gradient check on sampled tensor elements
    eps = 1e-5
    for name in ("tok_emb", "pos_emb", "b0.wq", "b0.wo", "b0.w_down", "norm_f"):
        flat_w = model.p[name].reshape(-1)
        flat_g = grads[name].reshape(-1)
        pick = int(rng.choice(flat_w.size))
        orig = flat_w[pick]
        flat_w[pick] = orig + eps
        la, _ = NativeLM.ce_loss(model.forward(tokens)[0], targets, ignore_index=IGNORE_INDEX)
        flat_w[pick] = orig - eps
        lb, _ = NativeLM.ce_loss(model.forward(tokens)[0], targets, ignore_index=IGNORE_INDEX)
        flat_w[pick] = orig
        fd = (la - lb) / (2 * eps)
        ag = flat_g[pick]
        rel = abs(fd - ag) / max(abs(fd) + abs(ag), 1e-8)
        assert rel < 1e-4, f"NativeLM masked gradient mismatch in {name}[{pick}]: fd={fd}, analytical={ag}"


if __name__ == "__main__":
    test_gradient_masking()
    test_pure_seq_lm_masked_gradients()
    test_native_lm_v2_masked_gradients()
    print("SUCCESS: All masked gradient verifications passed (loss_mask, PureSeqLM, NativeLM)!")
