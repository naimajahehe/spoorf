# Safety and Contract Hardening Design

## Goal

Make network-affecting operations fail closed, keep Python, Node, SQLite, and
React state truthful, and preserve existing REST paths and public event payloads.

## Scope

This change covers confirmed defects in:

- private-network scope detection and active discovery;
- Sentinel Shield activation and worker lifecycle;
- spoof and redirect teardown/startup error handling;
- Python-to-Node DHCP and WebSocket event contracts;
- Node-to-Python response validation and shutdown;
- authenticated frontend requests, retry policy, reconnect behavior, and
  destructive Socket.IO commands;
- directly related UI contract mismatches.

No endpoint path is renamed. New event handling is additive: the bridge accepts
legacy and canonical event names during the transition.

## Design Decisions

### Fail-closed network discovery

`get_current_gateway()` and `get_network_info()` must return empty values when a
real RFC1918 interface and gateway cannot be established. They must never invent
an IP, gateway, interface, network, or MAC. Active ARP discovery validates the
entire CIDR before constructing a packet.

### Truthful Shield activation

Shield activation succeeds only when the gateway IP and MAC are valid and at
least one OS neighbor-lock command returns success. No hard-coded gateway MAC is
allowed. Disable waits for prior workers to terminate before another enable can
reuse their stop events.

### Truthful operation state

Spoof teardown retains a recoverable session until packet restoration succeeds.
Failure is raised to FastAPI and propagated through Node; Node does not clear
memory or SQLite state after downstream failure. Redirect startup uses reverse
order rollback when a later stage fails.

### Backward-compatible contracts

PythonBridge accepts both old and canonical native WebSocket event names. DHCP
release detection accepts `kind`, `is_release`, or message type code 7. Bridge
mutation methods validate both HTTP status and JSON `success`.

### Safe frontend transport

All REST requests use one token-aware request helper. Automatic retry is limited
to explicitly safe read endpoints. Destructive Socket.IO actions fail immediately
when disconnected and are never buffered for later replay.

## Error Handling

Safety failures return explicit operational errors. They are not converted into
successful fallback objects. UI state changes only after authoritative success.

## Compatibility

- Existing REST paths and request keys remain unchanged.
- Existing Socket.IO event names remain unchanged.
- PythonBridge adds aliases rather than removing legacy native event names.
- Read-only status responses retain existing fields and add no required fields.

## Verification

Add regression tests for public-subnet rejection, Shield lock failure, rapid
worker restart, teardown restoration failure, redirect rollback, DHCP release
normalization, native event aliases, logical `success:false`, and state retention
after downstream stop failure. Run all Python and Node suites plus backend and
frontend production builds.
