# Superpowers Engineering Methodology

This repository integrates and enforces the **Superpowers** software development methodology (`obra/superpowers`).

## 1. Skill-First Workflow (Mandatory Invocation)
Whenever an agent begins a task in this repository, check for and invoke relevant skills BEFORE taking arbitrary actions:
- **Creative / New Feature Work**: Invoke `superpowers:brainstorming` before designing or modifying code.
- **Complex / Multi-Step Changes**: Invoke `superpowers:writing-plans` to produce a granular, testable implementation plan.
- **Implementation**: Follow `superpowers:test-driven-development` (TDD) — write failing tests first, make them pass, refactor.
- **Debugging & Bugfix**: Follow `superpowers:systematic-debugging` — formulate hypotheses, verify root causes, never guess.
- **Task Verification**: Follow `superpowers:verification-before-completion` — execute test suites and confirm terminal evidence before asserting completion.
- **Code Review**: Follow `superpowers:requesting-code-review` and `superpowers:receiving-code-review`.

## 2. Harmonization with Spec-Driven Development
- The Superpowers methodology works hand-in-hand with this repository's **Spec-Driven Development** (`docs/specs/SPEC-*.md` and `AGENTS.md`).
- Superpowers plans must honor core repository invariants:
  1. Default router gateway (`is_gateway: true`) must NEVER be spoofed or throttled.
  2. Controller host (`is_self: true`) must NEVER be targeted (anti self-cut).
  3. Lock concurrency in `spoofer.py`: Never place packet I/O inside mutex.
  4. RFC 1918 scope validation.
- Every completed feature or bugfix must update its corresponding `docs/specs/` document and record a version entry in `CHANGELOG.md`.
