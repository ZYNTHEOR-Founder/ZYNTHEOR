# Native Task Pipeline — Production Boundary

The production task pipeline is controlled by ZYNTHEOR's first-party Native Intelligence architecture and deterministic execution controls. It must not delegate reasoning, planning, code generation, or system control to an external AI provider.

## Production requirements

- Native model inference must be routed through the verified NativeLM runtime.
- Task planning and execution must retain permission checks, sandbox boundaries, audit traces, and result verification.
- A task is `DELIVERED` only when the actual execution and acceptance checks complete successfully.
- If the NativeLM checkpoint or runtime is unavailable, report the actual blocked state; do not substitute an external model or claim success.

## Legacy experiment notice

`qplus_native/brain.py`, `qplus_native/hybrid_brain.py`, `qplus_native/external_brain.py`, and the associated benchmark fixtures are retained as historical test material. They are not production controllers. The former external-brain HTTP adapter is disabled and the production server does not invoke it.

`qplus_native/stage_bench.py` is specification-only from its command-line entry point. It lists task definitions and explicitly reports `executionPerformed: false` and `scoresGenerated: false`.
