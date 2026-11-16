import numpy as np

IGNORE_INDEX = -100

def masked_cross_entropy_loss_and_backward(logits, labels, model_weights=None, ignore_index: int = IGNORE_INDEX):
    """
    Computes loss and backward gradients with Target-only Loss and Gradient Masking.
    - logits: shape (Batch, SeqLen, VocabSize) or (SeqLen, VocabSize)
    - labels: shape (Batch, SeqLen) or (SeqLen,)
    - IGNORE_INDEX = -100 for prompt and padding
    """
    if logits.ndim == 2:
        logits = np.expand_dims(logits, 0)
    if labels.ndim == 1:
        labels = np.expand_dims(labels, 0)

    # 1. Softmax & Cross Entropy Computation
    shifted_logits = logits - np.max(logits, axis=-1, keepdims=True)
    exp_logits = np.exp(shifted_logits)
    probs = exp_logits / np.sum(exp_logits, axis=-1, keepdims=True)
    
    batch_indices = np.arange(labels.shape[0])[:, None]
    seq_indices = np.arange(labels.shape[1])[None, :]
    
    valid_mask = (labels != ignore_index)
    safe_labels = np.where(valid_mask, labels, 0)
    
    selected_probs = probs[batch_indices, seq_indices, safe_labels]
    eps = 1e-15
    token_losses = -np.log(np.clip(selected_probs, eps, 1.0))
    
    # 2. Target-only Loss Masking
    masked_losses = token_losses * valid_mask.astype(float)
    total_valid_tokens = np.sum(valid_mask)
    
    if total_valid_tokens > 0:
        mean_loss = np.sum(masked_losses) / total_valid_tokens
    else:
        mean_loss = 0.0
        
    # 3. Gradient Masking (Force prompt and padding gradients to exactly 0)
    one_hot = np.zeros_like(probs)
    one_hot[batch_indices, seq_indices, safe_labels] = 1.0
    
    grad_logits = probs - one_hot
    grad_logits = grad_logits * valid_mask[..., None].astype(float)
    
    if total_valid_tokens > 0:
        grad_logits = grad_logits / total_valid_tokens
        
    return mean_loss, grad_logits
