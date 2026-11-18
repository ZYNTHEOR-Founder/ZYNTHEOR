Security Policy

Security Principles

ZYNTHEOR is developed with a focus on Fail-Closed Security, Data Integrity, and Cryptographic Accountability.

Our security engineering principles include:

- Native Intelligence Sovereignty: The Native Intelligence Core must remain under ZYNTHEOR's architectural control. External AI providers must not silently replace the Native Core.
- Secure Data Handling: Prompts, memory, workspace files, and connected service data must be handled according to explicit access controls and deployment security policies.
- Checkpoint Integrity: Model checkpoints must undergo integrity and compatibility validation before being loaded. Missing, corrupted, or invalid model assets must cause execution to fail safely.
- Audit Accountability: Important state transitions and security-sensitive operations should produce verifiable audit records. Cryptographic hash chaining provides tamper evidence but does not independently guarantee immutability.
- Sandbox Security: Code execution and tool access must enforce appropriate isolation, permissions, resource limits, and network access policies.
- Credential Protection: Secrets, API credentials, private keys, and sensitive configuration must never be committed to the repository or exposed in logs.

Security capabilities must be supported by actual implementation and verification evidence. Architectural intentions must not be represented as completed security guarantees.

Reporting a Vulnerability

If you discover a security vulnerability, please do not disclose it through a public issue.

Instead:

1. Contact the repository maintainers through an authorized private security reporting channel.
2. Include a description of the vulnerability, affected components, reproduction steps, and potential impact.
3. Avoid including real credentials, private user data, or other sensitive information in your report.
4. Allow maintainers reasonable time to investigate, validate, and remediate the issue before public disclosure.

Security Response

Security reports should be assessed according to severity, exploitability, affected components, and potential impact.

Confirmed vulnerabilities should be addressed with appropriate fixes, regression tests, and verification evidence.

We appreciate responsible disclosure and contributions that help make ZYNTHEOR — VIVID INTELLIGENCE more secure.
