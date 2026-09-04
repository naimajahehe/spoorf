# DHCP Discovery Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Technique 3B Method 1 with a safe, single-scan discovery refresh that measures multicast delivery and naturally observed DHCP profile deltas.

**Architecture:** Python owns topology validation, multicast delivery accounting, DHCP observation, parser correctness, and safe packet construction. Node coalesces the workflow, persists complete live DHCP evidence, and runs one scan. React renders truthful, unique-MAC coverage and the measured result.

**Tech Stack:** Python 3.11, FastAPI, Scapy, Node.js 20, Express, Socket.IO, SQLite, React 18, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-04-dhcp-discovery-refresh-design.md`

## Global Constraints

- Keep `POST /api/dhcp/wakeup`, `POST /api/scan`, and `POST /api/network/optimize-dhcp` paths unchanged.
- Reject non-RFC1918 or inconsistent topology before Method 1 opens sockets or builds packets.
- Method 1 must not use spoofing, micro-cut, DHCP NAK, deauthentication, or gateway-disguised ARP.
- One Method 1 invocation sends one multicast wakeup burst and runs one full scan.
- Existing `/api/scan` callers retain current behavior by default.
- Never report datagram delivery success when zero datagrams were sent.
- Count DHCP profiles by unique normalized MAC, excluding gateway and controller.
- Preserve all existing user changes present in the worktree snapshot.
- All packet, socket, adapter, and timing behavior in tests is mocked.

---

### Task 1: Measured DHCP and Multicast Primitives

**Files:**
- Modify: `python-service/src/core/discovery/multicast.py`
- Modify: `python-service/src/core/discovery/dhcp.py`
- Modify: `python-service/tests/test_unit_discovery.py`

**Interfaces:**
- Produces: `send_multicast_wakeup() -> Dict[str, Any]`
- Produces: `DHCPDiscoveredCache.get_unique_snapshot() -> Dict[str, Dict[str, Any]]`
- Produces: `diff_dhcp_profiles(before, after) -> Dict[str, Any]`

- [ ] **Step 1: Add failing multicast result tests**

Test six protocol keys, partial send failure, complete socket failure, and ensure
the existing SSDP descriptor hardening remains intact.

```python
result = send_multicast_wakeup()
self.assertEqual(result["attempted"], 6)
self.assertEqual(result["succeeded"], 5)
self.assertEqual(result["failed"], 1)
self.assertFalse(result["protocols"]["ssdp_ipv6"])
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_discovery.TestCoreDiscovery.test_multicast_wakeup_reports_partial_delivery -v
```

Expected: failure because the function currently returns `None`.

- [ ] **Step 3: Implement structured delivery**

Use small internal send helpers that record one boolean per named protocol.
Keep payloads and destinations unchanged. Return attempted, succeeded, failed,
protocols, and sanitized errors.

- [ ] **Step 4: Add failing unique snapshot and delta tests**

```python
cache.update(mac, ip, {"hostname": "phone"})
self.assertEqual(len(cache.get_unique_snapshot()), 1)

delta = diff_dhcp_profiles(before, after)
self.assertEqual(delta["new_count"], 1)
self.assertEqual(delta["updated_count"], 1)
```

- [ ] **Step 5: Implement unique snapshot and delta**

Compare only IP, hostname, vendor class, fingerprint, client ID, and FQDN.
Return MAC lists plus counts.

- [ ] **Step 6: Add PRL and renewal-IP RED tests**

Assert PRL `[128, 151, 158]` is not Android, valid Android options still are,
and `yiaddr="0.0.0.0"` falls through to a valid `ciaddr`.

- [ ] **Step 7: Implement integer PRL matching and valid-IP fallback**

Normalize PRL into ordered integer values and a set. Preserve existing named
fingerprint strings.

- [ ] **Step 8: Run the full discovery test module**

Run:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_discovery -v
```

- [ ] **Step 9: Commit Task 1**

```powershell
git add python-service/src/core/discovery/multicast.py python-service/src/core/discovery/dhcp.py python-service/tests/test_unit_discovery.py
git commit -m "fix(dhcp): measure discovery observation inputs"
```

### Task 2: Safe Observation and Single-Burst Scan

**Files:**
- Modify: `python-service/src/core/discovery/arp.py`
- Modify: `python-service/src/core/discovery/__init__.py`
- Modify: `python-service/src/core/scanner.py`
- Modify: `python-service/src/server.py`
- Modify: `python-service/tests/test_unit_discovery.py`
- Modify: `python-service/tests/test_api_server.py`

**Interfaces:**
- Consumes: structured multicast result and DHCP unique/delta functions from Task 1.
- Produces: `NetworkScanner.scan_full(include_multicast_wakeup: bool = True)`
- Produces: optional `/api/scan` field `skip_multicast_wakeup`

- [ ] **Step 1: Add safe unicast ARP RED tests**

Assert sender IP equals the controller IP and sender MAC equals controller MAC.
Assert missing/invalid controller identity results in no `srp` call.

- [ ] **Step 2: Replace gateway-disguised ARP**

Create `probe_sleeping_host_via_unicast_arp()` and update scanner imports/calls.
Keep `probe_sleeping_host_via_gateway_arp` as a compatibility alias.

- [ ] **Step 3: Add observation endpoint RED tests**

Cover public topology rejection before `send_multicast_wakeup`, zero successful
datagrams returning HTTP 503, partial delivery success, four-second sleep mocked,
and accurate DHCP delta response.

- [ ] **Step 4: Add scan suppression RED tests**

Call `scan_network()` with `skip_multicast_wakeup=True` and assert the scanner
receives `include_multicast_wakeup=False`. Verify no-body calls still use true.

- [ ] **Step 5: Implement optional scan request and scanner flag**

Use an optional Pydantic request body. Skip only `send_multicast_wakeup`; retain
SSDP/mDNS collection and all other scan behavior.

- [ ] **Step 6: Implement topology-gated observation**

Validate private CIDR, controller IP, gateway IP, and gateway membership before
capturing baseline or opening sockets. Await four seconds with `asyncio.sleep`.

- [ ] **Step 7: Run focused Python tests**

Run:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_discovery tests.test_api_server -v
```

- [ ] **Step 8: Commit Task 2**

```powershell
git add python-service/src/core/discovery/arp.py python-service/src/core/discovery/__init__.py python-service/src/core/scanner.py python-service/src/server.py python-service/tests/test_unit_discovery.py python-service/tests/test_api_server.py
git commit -m "fix(dhcp): add safe observation workflow"
```

### Task 3: Node Workflow and Live DHCP Persistence

**Files:**
- Modify: `backend-node/src/services/pythonBridge.ts`
- Modify: `backend-node/src/services/deviceManager.ts`
- Modify: `backend-node/src/services/database.ts`
- Modify: `backend-node/src/api/routes.ts`
- Modify: `backend-node/tests/unit_pythonBridge.test.ts`
- Modify: `backend-node/tests/unit_deviceManager.test.ts`
- Modify: `backend-node/tests/api_routes.test.ts`

**Interfaces:**
- Consumes: `/api/dhcp/wakeup` structured result.
- Consumes: `/api/scan` optional `skip_multicast_wakeup`.
- Produces: `DatabaseService.updateDeviceDhcpProfile(...)`
- Produces: measured Technique 3B result returned from the existing Node route.

- [ ] **Step 1: Add PythonBridge RED tests**

Verify `scan()` without options sends the legacy empty body behavior and
`scan({ skipMulticastWakeup: true })` sends:

```json
{ "skip_multicast_wakeup": true }
```

Verify the full wakeup delivery/delta object is preserved.

- [ ] **Step 2: Implement typed bridge options**

Add optional parameters without changing existing call sites.

- [ ] **Step 3: Add DeviceManager workflow RED tests**

Assert:

- one Python observation call;
- one scan with wakeup suppressed;
- concurrent calls share one operation;
- calls inside 20 seconds reuse the latest result and do not rescan;
- the route exposes delivery and delta unchanged.

- [ ] **Step 4: Implement single-flight and cooldown**

Store one in-flight promise and one completed result timestamp. Cooldown reuse
sets `cached: true` and returns remaining milliseconds.

- [ ] **Step 5: Add live DHCP persistence RED tests**

Use the real production handler. Existing `"Unknown Device"` hostname must be
replaced, all four DHCP evidence fields must update, one database transaction
must be called, and one enrichment scan must be scheduled only when fields
change.

- [ ] **Step 6: Implement atomic DHCP profile persistence**

`updateDeviceDhcpProfile` updates IP, online state, hostname when supplied, and
all `dhcp_*` columns in one transaction. The manager copies those fields before
emitting state.

- [ ] **Step 7: Add and implement scanner merge coverage**

Ensure an existing in-memory device receives new `dhcp_vendor_class`,
`dhcp_fingerprint`, `dhcp_client_id`, and `dhcp_fqdn` values from scan results.

- [ ] **Step 8: Run Node tests and build**

```powershell
cd backend-node
npm test
npm run build
```

- [ ] **Step 9: Commit Task 3**

```powershell
git add backend-node/src backend-node/tests
git commit -m "fix(dhcp): orchestrate one measured refresh"
```

### Task 4: Truthful Frontend Metrics and Result UX

**Files:**
- Create: `frontend-react/src/lib/dhcpProfiling.ts`
- Create: `frontend-react/scripts/test-dhcp-profiling.mjs`
- Modify: `frontend-react/package.json`
- Modify: `frontend-react/src/components/DhcpReconnectModal.tsx`
- Modify: `frontend-react/src/App.tsx`

**Interfaces:**
- Produces: `hasDhcpEvidence`, `hasAnyProfileEvidence`, and
  `calculateDhcpCoverage`.
- Consumes: the measured response from `/api/network/optimize-dhcp`.

- [ ] **Step 1: Write pure-helper RED assertions**

Cover controller/gateway exclusion, duplicate MAC deduplication, hostname-only
profile evidence distinct from DHCP evidence, and `percentage: null` for zero
eligible devices.

- [ ] **Step 2: Add the existing-tool test runner**

Follow `scripts/test-refresh-sequencer.mjs`: compile only the helper with the
already installed TypeScript package, import it from a temporary directory, run
Node assertions, and remove the directory in `finally`.

- [ ] **Step 3: Implement the helper**

Use lowercase normalized MAC as the unique key. Do not use IP as identity.

- [ ] **Step 4: Update modal copy and response state**

Rename Method 1, render delivery/delta values, show explicit no-DHCP text, and
recommend target reconnect. Remove the success-path `onTriggerReScan()` call.

- [ ] **Step 5: Unify App badge and modal metrics**

Use `hasDhcpEvidence` for the dropdown count and row badges. Preserve the manual
reconnect card but remove 100% and zero-second claims.

- [ ] **Step 6: Run frontend tests and build**

```powershell
cd frontend-react
npm run test:dhcp-profiling
npm run test:refresh-sequencer
npm run build
```

- [ ] **Step 7: Commit Task 4**

```powershell
git add frontend-react/package.json frontend-react/scripts/test-dhcp-profiling.mjs frontend-react/src/lib/dhcpProfiling.ts frontend-react/src/components/DhcpReconnectModal.tsx frontend-react/src/App.tsx
git commit -m "fix(frontend): show measured DHCP refresh results"
```

### Task 5: Documentation and Full Verification

**Files:**
- Modify: `docs/specs/SPEC-002_DHCP_PASSIVE_PROFILING.md`
- Modify: `docs/API_SPEC.md`
- Modify: `docs/EVENT_TAXONOMY.md` only if the measured response is documented there.

- [ ] **Step 1: Align documentation**

State that Method 1 observes rather than forces DHCP, document delivery/delta
fields, remove 100% claims, and distinguish Discovery coverage from DHCP
evidence coverage.

- [ ] **Step 2: Run full Python tests**

```powershell
cd python-service
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

- [ ] **Step 3: Run full Node tests and build**

```powershell
cd backend-node
npm test
npm run build
```

- [ ] **Step 4: Run frontend tests and build**

```powershell
cd frontend-react
npm run test:dhcp-profiling
npm run test:refresh-sequencer
npm run build
```

- [ ] **Step 5: Verify scope**

Run `git diff --check`. Confirm no endpoint path changed, no Method 3 behavior
changed, no live-network test exists, and the local `theme.ts` baseline file is
not staged by feature commits.

- [ ] **Step 6: Commit documentation**

```powershell
git add docs/specs/SPEC-002_DHCP_PASSIVE_PROFILING.md docs/API_SPEC.md docs/EVENT_TAXONOMY.md docs/superpowers/specs/2026-09-04-dhcp-discovery-refresh-design.md docs/superpowers/plans/2026-09-04-dhcp-discovery-refresh.md
git commit -m "docs: define measured DHCP discovery refresh"
```
