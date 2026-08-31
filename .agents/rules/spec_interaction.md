---
trigger: always_on
description: Strict Spec-Driven Development & Command Interaction Rule with Project Markdown Documentation
---

## Spec-Driven Development (MD Interaction Rule)

This project strictly enforces **Spec-Driven Development**. Every command, action, and code modification MUST interact with, reference, and update its corresponding `.md` documentation:

1. **Before Executing Commands or Modifying Code**:
   - Always cross-reference the governing specification in `docs/specs/` or root:
     - **Discovery & Probes**: `docs/specs/SPEC-001_NETWORK_DISCOVERY_PIPELINE.md`
     - **Passive DHCP Sniffer**: `docs/specs/SPEC-002_DHCP_PASSIVE_PROFILING.md`
     - **ARP Spoofing & Throttling**: `docs/specs/SPEC-003_ARP_SPOOFING_AND_THROTTLING.md`
     - **Database & Auto-Reblock**: `docs/specs/SPEC-004_STATE_PERSISTENCE_AND_AUTOREBLOCK.md`
     - **Telemetry & Watchdog**: `docs/specs/SPEC-005_REALTIME_TELEMETRY_AND_WATCHDOG.md`
     - **Frontend UI & Components**: `docs/specs/SPEC-006_FRONTEND_UI_AND_INTERACTION.md`
     - **Automated Tests**: `docs/specs/SPEC-007_AUTOMATED_TESTING_SUITE.md`
     - **Service Commands & Invariants**: `AGENTS.md`
     - **Troubleshooting & Zombie Cleanups**: `docs/TROUBLESHOOTING.md`
     - **Event Payloads**: `docs/EVENT_TAXONOMY.md`

2. **Core Architectural Invariants (Never Violate)**:
   - Default router gateway (`is_gateway: true`) must NEVER be spoofed or bandwidth-cut (`SpoofError`).
   - Operator controller host (`is_self: true`) must NEVER be targeted (*anti self-cut*).
   - In `spoofer.py`, never place network I/O (`sendp`, `time.sleep`) inside `with self._lock:`.
   - Boundary IP addresses (`0.0.0.0`, `255.255.255.255`) must evaluate to `False` in `is_valid_private_ip()`.

3. **When Errors or Exceptions Occur**:
   - Immediately consult `docs/TROUBLESHOOTING.md` before executing arbitrary commands.
   - If a new bug pattern is resolved, record the root cause in `docs/TROUBLESHOOTING.md`.

4. **After Code or Feature Modifications**:
   - Run the automated test suites per `docs/specs/SPEC-007_AUTOMATED_TESTING_SUITE.md`.
   - Update `CHANGELOG.md` with a summary of the change.
