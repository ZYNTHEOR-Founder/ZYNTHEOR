Contributing to ZYNTHEOR

Thank you for your interest in contributing to ZYNTHEOR — VIVID INTELLIGENCE.

ZYNTHEOR is a Native Multi-Domain Intelligence platform built around first-party intelligence architecture, connected capabilities, and evidence-based engineering.

We welcome contributions that strengthen the platform's architecture, reliability, security, and real-world capabilities.

Core Engineering Principles

1. Native Sovereignty
   Intelligence capabilities must be developed around ZYNTHEOR's first-party architecture. Do not introduce third-party LLM fallbacks or replace the Native Intelligence Core with external AI providers.

2. Zero-Fake Engineering
   Never fabricate model capabilities, benchmark results, training progress, execution results, or system telemetry. Missing or corrupted resources must be handled safely and transparently.

3. Evidence-Based Verification
   Verify changes with appropriate automated tests, static checks, and runtime validation. Report exactly what was tested and distinguish verified results from unverified functionality.

4. Security and Data Integrity
   Preserve existing model assets, datasets, checkpoints, memory, and audit records. Never expose credentials, secrets, or sensitive configuration in source code.

5. Unified Architecture
   Build capabilities that integrate with the existing intelligence platform. Avoid disconnected implementations and unnecessary duplication.

Development Workflow

1. Fork the repository.

2. Create a feature branch:
   
   git checkout -b feat/your-feature

3. Install project dependencies using the package manager and lockfile specified by the repository.

4. Start the development environment when required:
   
   npm run dev

5. Run the applicable verification commands:
   
   npm run lint
npm run build

6. Run relevant tests and runtime checks for the components you changed.

If a check cannot run because of missing dependencies, infrastructure, or configuration, clearly report it as NOT RUN or BLOCKED. Do not report it as passed.

Pull Request Guidelines

Every pull request should:

- Keep changes focused and compatible with the existing architecture.
- Explain the problem and the intended solution.
- Document the files and components inspected or modified.
- Include test commands and their actual results.
- Identify known limitations and outstanding work.
- Preserve existing data, model assets, and audit integrity.
- Avoid unrelated refactoring or destructive changes.

Contribution Standards

Contributions must improve real functionality, maintainability, reliability, or security.

Proposed features must not be presented as implemented until the corresponding code and verification evidence exist.

Thank you for helping build ZYNTHEOR.
