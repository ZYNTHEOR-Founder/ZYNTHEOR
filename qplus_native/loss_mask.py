import numpy as np

IGNORE_INDEX = -100

def masked_cross_entropy_loss_and_backward(logits, labels, model_weights=None):
    """
    คำนวณ Loss และ Backward พร้อมทำ Gradient Masking สำหรับ NativeLM
    - logits: shape (Batch, SeqLen, VocabSize) หรือ (SeqLen, VocabSize)
    - labels: shape (Batch, SeqLen) หรือ (SeqLen,)
    - IGNORE_INDEX = -100 สำหรับ Prompt และ Padding
    """
    # 1. Softmax & Cross Entropy Computation
    shifted_logits = logits - np.max(logits, axis=-1, keepdims=True)
    exp_logits = np.exp(shifted_logits)
    probs = exp_logits / np.sum(exp_logits, axis=-1, keepdims=True)
    
    batch_indices = np.arange(labels.shape[0])[:, None]
    seq_indices = np.arange(labels.shape[1])[None, :]
    
    valid_mask = (labels != IGNORE_INDEX)
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
        
    # 3. Gradient Masking (บังคับ Gradient ของ Prompt และ Padding ให้เป็น 0)
    one_hot = np.zeros_like(probs)
    one_hot[batch_indices, seq_indices, safe_labels] = 1.0
    
    grad_logits = probs - one_hot
    grad_logits = grad_logits * valid_mask[..., None].astype(float)
    
    if total_valid_tokens > 0:
        grad_logits = grad_logits / total_valid_tokens
        
    return mean_loss, grad_logits
print("Loss Masking module created successfully!")
