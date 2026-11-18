"""Canonical target architecture specification and exact parameter accounting.

This module describes the roadmap graph only. It is deliberately separate from the
active 231,168-parameter runtime graph and the 502,912-parameter learned-v2 graph.
"""

TARGET_VOCAB_SIZE = 16_384
TARGET_D_MODEL = 512
TARGET_N_LAYERS = 10
TARGET_N_HEADS = 8
TARGET_D_FFN = 1_472
TARGET_CTX = 64
TARGET_DTYPE_BYTES = 4


def target_parameter_count() -> int:
    """Count the tied-embedding decoder graph used by the target specification."""
    embedding = TARGET_VOCAB_SIZE * TARGET_D_MODEL
    positional = TARGET_CTX * TARGET_D_MODEL
    per_block = (
        2 * TARGET_D_MODEL  # RMSNorm scales
        + 4 * TARGET_D_MODEL * TARGET_D_MODEL  # Q/K/V/O
        + 3 * TARGET_D_MODEL * TARGET_D_FFN  # SwiGLU gate/up/down
    )
    final_norm = TARGET_D_MODEL
    return embedding + positional + TARGET_N_LAYERS * per_block + final_norm


TARGET_TOTAL_PARAMS = target_parameter_count()
assert TARGET_TOTAL_PARAMS == 41_527_808, TARGET_TOTAL_PARAMS
TARGET_WEIGHT_BYTES = TARGET_TOTAL_PARAMS * TARGET_DTYPE_BYTES
