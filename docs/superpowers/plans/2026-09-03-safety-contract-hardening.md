# Safety and Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all network-affecting operations fail closed and keep state and event contracts consistent across Python, Node, and React.

**Architecture:** Harden the Python safety boundary first, then normalize and validate contracts in Node, and finally route all frontend transport through authenticated helpers with non-buffered mutations. Preserve existing endpoint paths and Socket.IO payloads.

**Tech Stack:** Python 3.11, FastAPI, Scapy, Node.js 20, Express, Socket.IO, React 18, TypeScript, unittest.

**Spec:** `docs/superpowers/specs/2026-09-03-safety-contract-hardening-design.md`

## Global Constraints

- Preserve gateway immunity and controller self-protection.
- Never perform packet or OS I/O while holding `ARPSpoofer._lock`.
- Reject active discovery outside RFC1918.
- Preserve all REST endpoint paths and public Socket.IO event names.
- Validate victim and gateway values before packet or OS operations.
- Keep optional `SENTINEL_API_TOKEN` protection on every non-health API.
- Do not run live scans or packet operations during verification.

---

### Task 1: Fail-Closed Network Resolution

**Files:**
- Modify: `python-service/src/core/network.py`
- Modify: `python-service/src/core/discovery/arp.py`
- Test: `python-service/tests/test_unit_network.py`
- Test: `python-service/tests/test_unit_discovery.py`

**Interfaces:**
- Produces: `is_valid_private_network(cidr: str) -> bool`
- Changes: unresolved network information uses empty strings, never invented defaults.

- [ ] **Step 1: Write failing network tests**

```python
def test_get_network_info_rejects_public_default_interface(self):
    # Mock a public adapter/default gateway and assert returned network/ip are empty.

def test_private_network_validator_rejects_public_cidr(self):
    self.assertFalse(is_valid_private_network("203.0.113.0/24"))
    self.assertTrue(is_valid_private_network("192.168.1.0/24"))
```

- [ ] **Step 2: Write failing ARP discovery test**

```python
def test_arp_broadcast_skips_non_rfc1918_network(self):
    # get_network_info returns 203.0.113.0/24; assert srp is never called.
```

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:
`D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_network tests.test_unit_discovery -v`

- [ ] **Step 4: Implement strict network resolution**

```python
def is_valid_private_network(cidr: str) -> bool:
    net = ipaddress.IPv4Network(cidr, strict=False)
    return any(net.subnet_of(private) for private in _RFC1918_NETWORKS)
```

Return empty network details when no valid private adapter/gateway exists, and
guard ARP broadcast and sweep before constructing candidates or packets.

- [ ] **Step 5: Run targeted tests**

Expected: both modules pass without a real packet operation.

### Task 2: Truthful Shield and Worker Lifecycle

**Files:**
- Modify: `python-service/src/core/shield.py`
- Modify: `python-service/src/core/gaming.py`
- Test: `python-service/tests/test_unit_shield.py`
- Test: `python-service/tests/test_unit_gaming.py`

**Interfaces:**
- Shield `enable()` raises `SpoofError` when gateway validation or OS locking fails.
- Shield and Gaming stop paths join their prior workers before stop events are reused.

- [ ] **Step 1: Add failing Shield lock tests**

```python
def test_enable_fails_when_gateway_mac_unresolved(self):
    with self.assertRaises(SpoofError):
        self.shield.enable()

def test_enable_fails_when_neighbor_lock_fails(self):
    with self.assertRaises(SpoofError):
        self.shield.enable()
```

- [ ] **Step 2: Add failing rapid restart tests**

Use controlled fake workers and assert prior workers are joined before the stop
event is cleared and replacement workers start.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:
`D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_shield tests.test_unit_gaming -v`

- [ ] **Step 4: Implement fail-closed activation and joins**

Check subprocess return codes, remove the gateway MAC fallback, propagate lock
failure, capture worker references during disable, join outside critical state
mutation, then emit the final status.

- [ ] **Step 5: Run targeted tests**

Expected: all Shield and Gaming tests pass.

### Task 3: Transactional Spoof and Redirect Lifecycle

**Files:**
- Modify: `python-service/src/core/spoofer.py`
- Modify: `python-service/src/core/redirector/manager.py`
- Test: `python-service/tests/test_unit_spoofer.py`
- Test: `python-service/tests/test_redirector.py`

**Interfaces:**
- `ARPSpoofer.stop(session_id)` raises `SpoofError` and retains retryable state when restoration fails.
- `RedirectManager.start_redirect(...)` rolls back every resource started by the failed attempt.

- [ ] **Step 1: Add failing teardown and rollback tests**

```python
def test_stop_retains_session_when_restore_fails(self):
    # sendp raises; assert SpoofError and session remains with active=False.

def test_redirect_start_rolls_back_portal_when_spoofer_fails(self):
    # assert portal.stop called and no session recorded.
```

- [ ] **Step 2: Run targeted tests and confirm failure**

Run:
`D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_spoofer tests.test_redirector -v`

- [ ] **Step 3: Implement two-phase teardown and reverse rollback**

Stop workers and mark the session inactive, restore outside the mutex, remove the
session only after success, and retain it with `restore_failed=True` otherwise.
Validate all redirect inputs before stopping an existing session or starting the
portal. Roll back DNS, forwarding/session, and portal in reverse start order.

- [ ] **Step 4: Run targeted tests**

Expected: lifecycle tests pass and no live I/O occurs.

### Task 4: Normalize Python-to-Node Contracts

**Files:**
- Modify: `backend-node/src/services/pythonBridge.ts`
- Modify: `backend-node/src/services/deviceManager.ts`
- Modify: `backend-node/src/api/routes.ts`
- Modify: `backend-node/src/websocket/index.ts`
- Modify: `backend-node/src/app.ts`
- Test: `backend-node/tests/unit_pythonBridge.test.ts`
- Test: `backend-node/tests/unit_deviceManager.test.ts`
- Test: `backend-node/tests/api_routes.test.ts`

**Interfaces:**
- Native aliases map `device_offline_pulse`, `arp_threat_detected`, and
  `shield_status_changed` to existing DeviceManager events.
- DHCP release normalization accepts `kind`, `is_release`, or code 7.
- Mutation bridge calls reject JSON responses where `success === false`.

- [ ] **Step 1: Add failing contract tests**

Test the real DHCP handler, native event aliases, `success:false` limit response,
full Bettercap DNS status preservation, and a shared SIGINT/SIGTERM shutdown
handler.

- [ ] **Step 2: Run backend tests and confirm failure**

Run: `npm test`

- [ ] **Step 3: Implement additive aliases and response validation**

Parse mutation JSON, throw operational errors for logical failure, preserve
Bettercap configuration fields, remove the duplicate direct Gaming broadcast,
and register the same shutdown function for SIGINT and SIGTERM.

- [ ] **Step 4: Run backend tests and build**

Run: `npm test` then `npm run build`.

### Task 5: Preserve Node State on Downstream Failure

**Files:**
- Modify: `backend-node/src/services/deviceManager.ts`
- Test: `backend-node/tests/unit_deviceManager.test.ts`
- Test: `backend-node/tests/unit_gamingMode.test.ts`

**Interfaces:**
- Unblock, full-speed restore, redirect transition, redirect stop, and delete do
  not mutate memory or SQLite when Python teardown fails.

- [ ] **Step 1: Add failing state-retention tests**

Mock `stopSpoof()` or `stopRedirect()` to reject and assert device state,
session ID, and persistence calls remain unchanged.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test`.

- [ ] **Step 3: Remove success-shaped catches**

Propagate downstream errors before changing state. Cleanup paths that are
explicitly best-effort at process shutdown remain logged but are not exposed as
successful user operations.

- [ ] **Step 4: Run tests and build**

Run: `npm test` then `npm run build`.

### Task 6: Safe Authenticated Frontend Transport

**Files:**
- Modify: `frontend-react/src/api/client.ts`
- Modify: `frontend-react/src/hooks/useWebSocket.ts`
- Modify: `frontend-react/src/components/DeepPortScanModal.tsx`
- Modify: `frontend-react/src/components/DhcpReconnectModal.tsx`
- Modify: `frontend-react/src/components/TransparentGatewayView.tsx`

**Interfaces:**
- Produces: `apiFetch(path: string, init?: RequestInit) -> Promise<Response>`
- All REST calls resolve against `getApiUrl()` and attach the optional token.
- Automatic retry applies only to explicitly safe read endpoints.

- [ ] **Step 1: Implement the shared request helper**

```typescript
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = window.electronAPI?.apiToken;
  if (token) headers.set('x-sentinel-token', token);
  return fetch(`${getApiUrl()}${path}`, { ...init, headers });
}
```

- [ ] **Step 2: Replace every raw backend fetch**

Use relative API paths through `apiFetch`, preserving content type, method,
body, response checks, and blob downloads.

- [ ] **Step 3: Restrict Axios retry**

Retry only health/status startup reads; never retry `/api/scan` or any mutation.

- [ ] **Step 4: Build frontend**

Run: `npm run build`.

### Task 7: Reconnect and UI Contract Corrections

**Files:**
- Modify: `frontend-react/src/hooks/useWebSocket.ts`
- Modify: `frontend-react/src/components/DashboardWelcomeView.tsx`
- Modify: `frontend-react/src/components/OpenPortsTable.tsx`
- Modify: `frontend-react/src/components/ui/auth-page.tsx`

**Interfaces:**
- Destructive socket methods reject while disconnected.
- Reconnect refreshes authoritative status and device data.
- Gateway becomes `null` when no gateway exists in the latest snapshot.

- [ ] **Step 1: Guard destructive emits**

Require `socket?.connected`; set an actionable error and do not call `emit` when
disconnected.

- [ ] **Step 2: Rehydrate state after connect**

Use one idempotent refresh function for device, gateway, Shield, Gaming,
Bettercap, interceptor, and Wi-Fi state. Clear gateway when absent.

- [ ] **Step 3: Correct direct UI mismatches**

Read `shieldStatus.is_enabled`, choose HTTPS for ports 443/8443, and make signup
fail honestly instead of calling login when no signup endpoint exists.

- [ ] **Step 4: Build frontend**

Run: `npm run build`.

### Task 8: Full Verification

**Files:**
- Update directly related contract documentation if runtime names changed.

- [ ] **Step 1: Run all Python tests**

Run:
`D:\spoorf\python-service\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v`

- [ ] **Step 2: Run Node tests and build**

Run: `npm test` and `npm run build`.

- [ ] **Step 3: Run frontend build**

Run: `npm run build`.

- [ ] **Step 4: Review the complete diff**

Confirm no endpoint paths changed, no live-network test was added, and no user
files outside the isolated worktree were modified.
