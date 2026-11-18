# Security Policy

## Sovereign Security Architecture

ZYNTHEOR is designed around **Fail-Closed Sovereignty** and **Cryptographic Accountability**:

- **Zero External AI Transmission**: Prompts, memory, and workspace files remain local to the sovereign runtime.
- **Checkpoint Integrity**: Model weights (`native_data/model_checkpoint.pt`) are validated deterministically via SHA-256 on startup. Corrupted or missing weights halt execution rather than simulating success.
- **Append-Only Audit Ledger**: State transitions, inference events, and memory mutations are recorded in `native_data/audit_log.jsonl` with SHA-256 chaining.
- **Sandboxed Tool Execution**: Agentic code execution is restricted to `/workspace` via `ToolGateway`.

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue. Instead:

1. Email the maintainers directly with a detailed description, reproduction steps, and potential impact.
2. Allow time for investigation and remediation before public disclosure.

We appreciate responsible disclosure to keep ZYNTHEOR secure.
