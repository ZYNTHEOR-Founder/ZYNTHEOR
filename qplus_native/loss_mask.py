try:
    import numpy as np
except ImportError:
    from qplus_native import np_compat as np  # type: ignore[no-redef]

IGNORE_INDEX = -100


def masked_cross_entropy_loss_and_backward(logits, labels, model_weights=None, ignore_index: int = IGNORE_INDEX):
    """
    Compute target-only cross-entropy loss and dlogits gradient with prompt/padding masking.
    - logits: shape (Batch, SeqLen, VocabSize) or (SeqLen, VocabSize)
    - labels: shape (Batch, SeqLen) or (SeqLen,)
    - ignore_index (default -100): excluded from loss average and forced to 0.0 gradient
    """
    logits_arr = np.asarray(logits, dtype=np.float64)
    labels_arr = np.asarray(labels, dtype=np.int64)

    was_unbatched = logits_arr.ndim == 2 and labels_arr.ndim == 1
    if was_unbatched:
        logits_3d = logits_arr[None, :, :]
        labels_2d = labels_arr[None, :]
    elif logits_arr.ndim == 3 and labels_arr.ndim == 2:
        logits_3d = logits_arr
        labels_2d = labels_arr
    else:
        raise ValueError(
            f"Unsupported shapes for masked_cross_entropy_loss_and_backward: "
            f"logits={logits_arr.shape}, labels={labels_arr.shape}"
        )

    if logits_3d.shape[:2] != labels_2d.shape:
        raise ValueError(
            f"Batch/Seq shape mismatch: logits={logits_3d.shape}, labels={labels_2d.shape}"
        )

    # 1. Numerically stable softmax
    shifted_logits = logits_3d - np.max(logits_3d, axis=-1, keepdims=True)
    exp_logits = np.exp(shifted_logits)
    probs = exp_logits / np.sum(exp_logits, axis=-1, keepdims=True)

    batch_size, seq_len = labels_2d.shape
    batch_indices = np.arange(batch_size)[:, None]
    seq_indices = np.arange(seq_len)[None, :]

    valid_mask = labels_2d != ignore_index
    safe_labels = np.where(valid_mask, labels_2d, 0)

    selected_probs = probs[batch_indices, seq_indices, safe_labels]
    eps = 1e-15
    token_losses = -np.log(np.clip(selected_probs, eps, 1.0))

    # 2. Target-only loss masking
    mask_f = valid_mask.astype(np.float64)
    masked_losses = token_losses * mask_f
    total_valid_tokens = int(np.sum(valid_mask))

    if total_valid_tokens > 0:
        mean_loss = float(np.sum(masked_losses) / total_valid_tokens)
    else:
        mean_loss = 0.0

    # 3. Gradient masking (force ignored prompt and padding positions to strictly 0.0)
    one_hot = np.zeros_like(probs)
    one_hot[batch_indices, seq_indices, safe_labels] = 1.0

    grad_logits = (probs - one_hot) * mask_f[..., None]
    if total_valid_tokens > 0:
        grad_logits = grad_logits / total_valid_tokens

    if was_unbatched:
        return mean_loss, grad_logits[0]
    return mean_loss, grad_logits
