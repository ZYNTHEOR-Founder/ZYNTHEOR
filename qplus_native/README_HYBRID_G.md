# Legacy Hybrid Brain Experiment — Not Part of Production Runtime

This directory contains historical experiment code retained for regression and security-boundary tests.

**Native-only production policy:** ZYNTHEOR does not connect an external AI brain, does not accept provider API keys, and does not delegate system control or reasoning to an external model. The production server does not import or invoke `HybridBrain`, `external_brain`, or the legacy HTTP adapter.

`qplus_native/stage_bench.py` now lists task specifications only. It does not execute tasks or produce benchmark scores. The legacy `run_bench` function is retained only for isolated tests and must not be connected to production routes.

Do not add provider environment variables or re-enable the former `--real` execution path. Native model work must use the first-party NativeLM runtime and its verified checkpoint/inference interfaces.
