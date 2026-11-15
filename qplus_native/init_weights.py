# -*- coding: utf-8 -*-
"""Legacy synthetic checkpoint initializer disabled by the parameter-integrity audit."""

def generate_checkpoint():
    raise RuntimeError(
        "DISABLED: this legacy initializer wrote hash descriptors, not learned model weights. "
        "Initialize/export checkpoints only from actual NativeTrainer parameters."
    )

if __name__ == "__main__":
    generate_checkpoint()
