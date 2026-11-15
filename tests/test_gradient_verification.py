import numpy as np
from qplus_native.loss_mask import masked_cross_entropy_loss_and_backward, IGNORE_INDEX

def test_gradient_masking():
    batch_size, seq_len, vocab_size = 2, 10, 100
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
    
    print("SUCCESS: Gradient verification passed! Prompt gradients are 0, target gradients are active.")

if __name__ == "__main__":
    test_gradient_masking()
