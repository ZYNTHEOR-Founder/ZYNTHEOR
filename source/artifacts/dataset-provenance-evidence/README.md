# Dataset provenance evidence — pending

This directory is intentionally empty of approval evidence. Do not mark a dataset as approved merely because a file exists here.

Before NativeLM training, add immutable evidence files and SHA-256 pins for each document under:

- `source/` — original source URL, publisher, retrieval date, and source snapshot.
- `license/` — SPDX license identifier, canonical license URL, and the exact applicable terms.
- `rights/` — documented rights basis and permitted training/evaluation scope.
- `approval/` — human approval record signed by the configured external trusted HMAC key.

The active provenance manifest is currently empty and the 5,800-step pipeline remains BLOCKED. A trusted verifier and explicit human approval are required before training.
