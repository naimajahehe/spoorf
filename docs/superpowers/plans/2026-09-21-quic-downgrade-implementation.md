# QUIC Downgrade (Force TCP-443) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Transparent Gateway a per-target "Force QUIC → TCP" control that drops the target's outbound UDP-443 (QUIC/HTTP-3) so clients fall back to TCP-443, where the existing TLS-SNI sinkhole can enforce the block list.

**Architecture:** New additive Python module `quic_downgrade.py` exposes a `QUICDowngradeManager` that opens a WinDivert handle on the `NETWORK_FORWARD` layer with a filter matching only the target's UDP-443, runs a daemon loop that receives and **drops** (never re-injects) those packets, and is lifecycle-managed by the DI container. A FastAPI endpoint pair starts/stops it (gated by an active Transparent Gateway session for the target); the Node backend proxies it behind the `checkCanGateway` license gate; the frontend adds a per-target toggle. It never reads, decrypts, or re-injects traffic, and never touches `spoofer.py` or the gateway sniffer hot path.

**Tech Stack:** Python 3.11, FastAPI, `pydivert` 3.1.3 (WinDivert 2.x WFP driver), scapy/Npcap (existing), pytest; Node/TypeScript (backend proxy), React/TypeScript (frontend toggle), PyInstaller (packaging).

**Spec:** `docs/superpowers/specs/2026-09-16-quic-downgrade-design.md` (read it — the plan argues from it). Note: the spec predates the Python modular refactor; this plan targets the CURRENT structure (`container.py`, `lifespan.py`, `api/deps.py`, `api/routes/redirector.py`).

## Global Constraints

- **Python floor:** 3.11 (matches `pyproject.toml` `requires-python = ">=3.11"`).
- **Dependency pin:** add `pydivert==3.1.3` exactly (already validated on the target host). Runtime dep in `requirements.txt` AND `pyproject.toml` `[project.dependencies]`; also regenerate `requirements.lock` if the repo's lock workflow is used.
- **Never touch** `python-service/src/core/spoofer.py`, the ARP loop, or the gateway sniffer hot path (`transparent_gateway.py` packet callback). This feature is additive only.
- **Windows-only + admin:** WinDivert needs Administrator (the engine already requires it for Npcap). On non-Windows or when the driver cannot load, the manager must report `available: false` and every `start` must return a clean error — never crash the engine.
- **License gate (Node):** the QUIC-block endpoints are gated by the same `checkCanGateway()` used by `startTransparentGateway` — free tier receives `FeatureLockedError`.
- **Authorised networks only:** this is active enforcement; it is not for public Wi-Fi (consistent with the project's passive-only-on-public-Wi-Fi rule). No traffic content is read or recorded.
- **Test isolation:** unit tests MUST mock `pydivert` (a fake handle that yields packets) — they must never open a real WinDivert handle.
- **Commit style:** trunk-based, all commits to `main`, one commit per task. End each commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

- **Create** `python-service/src/core/redirector/quic_downgrade.py` — `QUICDowngradeManager` + pure `build_quic_filter()` helper. One responsibility: divert-and-drop the target's UDP-443.
- **Create** `python-service/tests/test_quic_downgrade.py` — unit tests with a fake pydivert handle.
- **Modify** `python-service/src/core/redirector/__init__.py` — export `QUICDowngradeManager`.
- **Modify** `python-service/src/core/redirector/transparent_gateway.py` — add public `is_active(victim_ip) -> bool`.
- **Modify** `python-service/src/container.py` — construct `self.quic_downgrade`, wire the gateway-session check, add a teardown stage, add to the watchdog network-change cleanup.
- **Modify** `python-service/src/lifespan.py` — expose `app.state.quic_downgrade`.
- **Modify** `python-service/src/api/deps.py` — add `get_quic_downgrade`.
- **Modify** `python-service/src/api/schemas.py` — add `QuicBlockRequest`.
- **Modify** `python-service/src/api/routes/redirector.py` — add `POST /api/gateway/quic-block/start|stop`, add QUIC state to `GET /api/gateway/status`.
- **Modify** `python-service/tests/test_api_server.py` — update the teardown-order expectation to include the new stage.
- **Modify** `python-service/requirements.txt`, `python-service/pyproject.toml` — add `pydivert==3.1.3`.
- **Modify** `backend-node/src/services/pythonBridge.ts` — `startQuicBlock`/`stopQuicBlock`.
- **Modify** `backend-node/src/services/deviceManager.ts` — `startQuicBlock`/`stopQuicBlock` (license-gated); stop QUIC when the gateway stops.
- **Modify** `backend-node/src/controllers/gatewayController.ts`, `backend-node/src/routes/gatewayRoutes.ts` — endpoints.
- **Modify** `frontend-react/src/components/TransparentGatewayView.tsx` (+ `src/types/index.ts`) — per-target toggle.
- **Modify** packaging config (PyInstaller spec / build script) — bundle the WinDivert DLL + `.sys`.

---

### Task 1: Add the pydivert dependency

**Files:**
- Modify: `python-service/requirements.txt`
- Modify: `python-service/pyproject.toml`

**Interfaces:**
- Produces: `import pydivert` available at runtime (version 3.1.3).

- [ ] **Step 1: Add to `requirements.txt`** — append under the existing pinned deps:

```
# QUIC-downgrade: WinDivert WFP driver binding to drop a target's UDP-443 (HTTP/3).
pydivert==3.1.3
```

- [ ] **Step 2: Add to `pyproject.toml`** — add to `[project.dependencies]` (keep alphabetical/grouped with the others):

```
    "pydivert==3.1.3",
```

- [ ] **Step 3: Install into the dev venv and verify import**

Run: `./venv/Scripts/python.exe -m pip install pydivert==3.1.3`
Then: `./venv/Scripts/python.exe -c "import pydivert; print(pydivert.WinDivert)"`
Expected: prints the class, no ImportError.

- [ ] **Step 4: Commit**

```bash
git add python-service/requirements.txt python-service/pyproject.toml
git commit -m "build(python): add pydivert 3.1.3 for QUIC-downgrade"
```

---

### Task 2: Pure WinDivert filter builder

**Files:**
- Create: `python-service/src/core/redirector/quic_downgrade.py`
- Test: `python-service/tests/test_quic_downgrade.py`

**Interfaces:**
- Produces: `build_quic_filter(target_ipv4: str, target_ipv6: str | None = None) -> str`

- [ ] **Step 1: Write the failing test** — create `python-service/tests/test_quic_downgrade.py`:

```python
"""Unit tests for QUIC-downgrade (WinDivert-based UDP-443 drop). pydivert is mocked."""

import unittest

from src.core.redirector.quic_downgrade import build_quic_filter


class TestQuicFilterBuilder(unittest.TestCase):
    def test_ipv4_only(self):
        f = build_quic_filter("192.168.110.98")
        self.assertEqual(f, "udp and udp.DstPort == 443 and (ip.SrcAddr == 192.168.110.98)")

    def test_dual_stack(self):
        f = build_quic_filter("192.168.110.98", "fe80::1")
        self.assertEqual(
            f,
            "udp and udp.DstPort == 443 and (ip.SrcAddr == 192.168.110.98 or ipv6.SrcAddr == fe80::1)",
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade.py -q`
Expected: FAIL — `ImportError: cannot import name 'build_quic_filter'`.

- [ ] **Step 3: Write minimal implementation** — create `python-service/src/core/redirector/quic_downgrade.py`:

```python
#!/usr/bin/env python3
"""QUIC Downgrade: drop a target's outbound UDP-443 (QUIC/HTTP-3) via WinDivert so
clients fall back to TCP-443 where the TLS-SNI sinkhole can enforce the block list.
Blocking-only: never reads, decrypts, or re-injects traffic."""

from typing import Optional


def build_quic_filter(target_ipv4: str, target_ipv6: Optional[str] = None) -> str:
    """WinDivert filter matching ONLY the target's outbound UDP destination-port 443."""
    conds = [f"ip.SrcAddr == {target_ipv4}"]
    if target_ipv6:
        conds.append(f"ipv6.SrcAddr == {target_ipv6}")
    return f"udp and udp.DstPort == 443 and ({' or '.join(conds)})"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add python-service/src/core/redirector/quic_downgrade.py python-service/tests/test_quic_downgrade.py
git commit -m "feat(python): QUIC-downgrade WinDivert filter builder"
```

---

### Task 3: Drop-loop that never re-injects

**Files:**
- Modify: `python-service/src/core/redirector/quic_downgrade.py`
- Test: `python-service/tests/test_quic_downgrade.py`

**Interfaces:**
- Produces: `_run_drop_loop(handle, stop_event) -> None` — recv packets from `handle` and drop them (never call `handle.send`); exits when `stop_event` is set or `handle.recv()` raises.

- [ ] **Step 1: Write the failing test** — append to `tests/test_quic_downgrade.py`:

```python
import threading
from src.core.redirector.quic_downgrade import _run_drop_loop


class _FakeHandle:
    def __init__(self, packets):
        self._packets = list(packets)
        self.sent = []
        self.closed = False

    def recv(self):
        if self._packets:
            return self._packets.pop(0)
        raise OSError("handle closed")  # mimics WinDivert recv after close

    def send(self, packet):
        self.sent.append(packet)

    def close(self):
        self.closed = True


class TestDropLoop(unittest.TestCase):
    def test_packets_are_dropped_never_sent(self):
        h = _FakeHandle(["p1", "p2", "p3"])
        stop = threading.Event()
        _run_drop_loop(h, stop)  # returns when recv() raises (packets exhausted)
        self.assertEqual(h.sent, [], "drop loop must NEVER re-inject a packet")

    def test_stop_event_exits_loop(self):
        never_ending = [object()] * 10_000
        h = _FakeHandle(never_ending)
        stop = threading.Event()
        stop.set()  # already stopped
        _run_drop_loop(h, stop)
        self.assertEqual(h.sent, [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade.py::TestDropLoop -q`
Expected: FAIL — `ImportError: cannot import name '_run_drop_loop'`.

- [ ] **Step 3: Write minimal implementation** — add to `quic_downgrade.py` (after `build_quic_filter`):

```python
import threading
from typing import Any

from ...utils.logger import logger


def _run_drop_loop(handle: Any, stop_event: threading.Event) -> None:
    """Receive matched packets and DROP them (never re-inject). Exits when the stop
    event is set or the handle is closed (recv raises)."""
    while not stop_event.is_set():
        try:
            handle.recv()
        except Exception:
            break  # handle closed / driver error -> exit cleanly
        # DROP: intentionally do NOT call handle.send(packet).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade.py::TestDropLoop -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add python-service/src/core/redirector/quic_downgrade.py python-service/tests/test_quic_downgrade.py
git commit -m "feat(python): QUIC-downgrade drop loop (recv, never re-inject)"
```

---

### Task 4: QUICDowngradeManager lifecycle (start/stop/stop_all/get_status)

**Files:**
- Modify: `python-service/src/core/redirector/quic_downgrade.py`
- Test: `python-service/tests/test_quic_downgrade.py`

**Interfaces:**
- Produces:
  - `class QUICDowngradeManager` with:
    - `__init__(self, gateway_session_check=None, windivert_factory=None)` — `gateway_session_check: Callable[[str], bool]` (defaults to always-True), `windivert_factory: Callable[[str], handle]` (defaults to a real `pydivert.WinDivert(filter, layer=NETWORK_FORWARD)`; injectable for tests).
    - `available(self) -> bool`
    - `start(self, target_ip: str, target_ipv6: str | None = None) -> dict` — returns `{"success": bool, "active": bool, "error": str | None}`
    - `stop(self, target_ip: str) -> bool`
    - `stop_all(self) -> None`
    - `get_status(self) -> dict` — `{"available": bool, "active_targets": list[str]}`

- [ ] **Step 1: Write the failing test** — append to `tests/test_quic_downgrade.py`:

```python
import time
from src.core.redirector.quic_downgrade import QUICDowngradeManager


class _FakeWinDivert:
    """Fake pydivert handle: recv blocks until close() is called, then raises."""
    def __init__(self, filter_str):
        self.filter = filter_str
        self.opened = False
        self.closed = False
        self._gate = threading.Event()

    def open(self):
        self.opened = True

    def recv(self):
        self._gate.wait()  # block until closed
        raise OSError("closed")

    def send(self, packet):
        raise AssertionError("must never send")

    def close(self):
        self.closed = True
        self._gate.set()


class TestManagerLifecycle(unittest.TestCase):
    def _mgr(self, gateway_ok=True):
        self.handles = []
        def factory(filter_str):
            h = _FakeWinDivert(filter_str)
            self.handles.append(h)
            return h
        return QUICDowngradeManager(
            gateway_session_check=lambda ip: gateway_ok,
            windivert_factory=factory,
        )

    def test_start_requires_gateway_session(self):
        m = self._mgr(gateway_ok=False)
        res = m.start("192.168.110.98")
        self.assertFalse(res["success"])
        self.assertIn("gateway", res["error"].lower())
        self.assertEqual(m.get_status()["active_targets"], [])

    def test_start_opens_handle_with_correct_filter(self):
        m = self._mgr()
        res = m.start("192.168.110.98")
        self.assertTrue(res["success"])
        self.assertEqual(self.handles[0].filter,
                         "udp and udp.DstPort == 443 and (ip.SrcAddr == 192.168.110.98)")
        self.assertTrue(self.handles[0].opened)
        self.assertIn("192.168.110.98", m.get_status()["active_targets"])
        m.stop_all()

    def test_start_idempotent_same_target(self):
        m = self._mgr()
        m.start("192.168.110.98")
        m.start("192.168.110.98")  # second start is a no-op, no second handle
        self.assertEqual(len(self.handles), 1)
        m.stop_all()

    def test_stop_closes_handle_and_joins(self):
        m = self._mgr()
        m.start("192.168.110.98")
        ok = m.stop("192.168.110.98")
        self.assertTrue(ok)
        self.assertTrue(self.handles[0].closed)
        self.assertEqual(m.get_status()["active_targets"], [])

    def test_stop_all(self):
        m = self._mgr()
        m.start("192.168.110.98")
        m.start("192.168.110.99")
        m.stop_all()
        self.assertTrue(all(h.closed for h in self.handles))
        self.assertEqual(m.get_status()["active_targets"], [])

    def test_stop_unknown_target_is_false(self):
        m = self._mgr()
        self.assertFalse(m.stop("192.168.110.200"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade.py::TestManagerLifecycle -q`
Expected: FAIL — `ImportError: cannot import name 'QUICDowngradeManager'`.

- [ ] **Step 3: Write minimal implementation** — add to `quic_downgrade.py`:

```python
from typing import Callable, Dict, List, Optional

try:
    import pydivert  # noqa: F401
    _PYDIVERT_IMPORT_OK = True
except Exception:  # pragma: no cover - platform/driver absent
    _PYDIVERT_IMPORT_OK = False


def _default_windivert_factory(filter_str: str):
    import pydivert
    return pydivert.WinDivert(filter_str, layer=pydivert.Layer.NETWORK_FORWARD)


class QUICDowngradeManager:
    """Per-target UDP-443 drop via WinDivert. Additive; never touches spoofer/gateway hot path."""

    def __init__(
        self,
        gateway_session_check: Optional[Callable[[str], bool]] = None,
        windivert_factory: Optional[Callable[[str], object]] = None,
    ):
        self._gateway_session_check = gateway_session_check or (lambda _ip: True)
        self._factory = windivert_factory or _default_windivert_factory
        self._sessions: Dict[str, dict] = {}   # target_ip -> {handle, thread, stop_event, ...}
        self._lock = threading.Lock()
        self._op_lock = threading.RLock()

    def available(self) -> bool:
        return _PYDIVERT_IMPORT_OK

    def start(self, target_ip: str, target_ipv6: Optional[str] = None) -> dict:
        with self._op_lock:
            if not self.available():
                return {"success": False, "active": False,
                        "error": "QUIC downgrade unavailable: WinDivert/pydivert not loadable."}
            if not self._gateway_session_check(target_ip):
                return {"success": False, "active": False,
                        "error": f"QUIC downgrade requires an active Transparent Gateway session for {target_ip}."}
            with self._lock:
                if target_ip in self._sessions:
                    return {"success": True, "active": True, "error": None}  # idempotent
            try:
                filter_str = build_quic_filter(target_ip, target_ipv6)
                handle = self._factory(filter_str)
                handle.open()
            except Exception as e:
                logger.error(f"[QUIC Downgrade] Failed to open WinDivert for {target_ip}: {e}")
                return {"success": False, "active": False,
                        "error": f"QUIC downgrade failed to start: {e}"}
            stop_event = threading.Event()
            thread = threading.Thread(
                target=_run_drop_loop, args=(handle, stop_event),
                daemon=True, name=f"quic-drop-{target_ip}",
            )
            thread.start()
            with self._lock:
                self._sessions[target_ip] = {
                    "handle": handle, "thread": thread, "stop_event": stop_event,
                    "target_ipv6": target_ipv6, "started_at": time.time(),
                }
            logger.info(f"🚫 [QUIC Downgrade] Dropping UDP-443 for {target_ip} (force TCP fallback)")
            return {"success": True, "active": True, "error": None}

    def stop(self, target_ip: str) -> bool:
        with self._op_lock:
            with self._lock:
                sess = self._sessions.pop(target_ip, None)
            if not sess:
                return False
            sess["stop_event"].set()
            try:
                sess["handle"].close()
            except Exception as e:
                logger.debug(f"[QUIC Downgrade] close notice for {target_ip}: {e}")
            sess["thread"].join(timeout=2.0)
            logger.info(f"✅ [QUIC Downgrade] Stopped UDP-443 drop for {target_ip}")
            return True

    def stop_all(self) -> None:
        with self._lock:
            targets = list(self._sessions.keys())
        for ip in targets:
            self.stop(ip)

    def get_status(self) -> dict:
        with self._lock:
            active = list(self._sessions.keys())
        return {"available": self.available(), "active_targets": active}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade.py -q`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add python-service/src/core/redirector/quic_downgrade.py python-service/tests/test_quic_downgrade.py
git commit -m "feat(python): QUICDowngradeManager lifecycle (start/stop/stop_all/get_status)"
```

---

### Task 5: Absence path (pydivert/driver unavailable)

**Files:**
- Test: `python-service/tests/test_quic_downgrade.py`

**Interfaces:**
- Consumes: `QUICDowngradeManager` (Task 4), `build_quic_filter` (Task 2).

- [ ] **Step 1: Write the failing test** — append to `tests/test_quic_downgrade.py`:

```python
class TestAbsencePath(unittest.TestCase):
    def test_factory_raises_yields_clean_error(self):
        def boom(_filter):
            raise OSError("WinError 5: Access is denied")  # e.g. not elevated / HVCI block
        m = QUICDowngradeManager(gateway_session_check=lambda ip: True, windivert_factory=boom)
        res = m.start("192.168.110.98")
        self.assertFalse(res["success"])
        self.assertIn("failed to start", res["error"].lower())
        self.assertEqual(m.get_status()["active_targets"], [])  # no ghost session
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade.py::TestAbsencePath -q`
Expected: PASS immediately (Task 4's `start` already catches factory exceptions). If it FAILS, fix `start` so a factory/open exception returns `success:false` and leaves no entry in `_sessions`.

- [ ] **Step 3: (only if Step 2 failed) fix**

Ensure the `try/except` around `self._factory(...)`/`handle.open()` in `start` returns the error dict and does NOT add to `_sessions`. (As written in Task 4 it already does.)

- [ ] **Step 4: Commit**

```bash
git add python-service/tests/test_quic_downgrade.py
git commit -m "test(python): QUIC-downgrade absence/failure path yields clean error"
```

---

### Task 6: Export the manager + add `is_active` to the gateway

**Files:**
- Modify: `python-service/src/core/redirector/__init__.py`
- Modify: `python-service/src/core/redirector/transparent_gateway.py`
- Test: `python-service/tests/test_quic_downgrade.py`

**Interfaces:**
- Produces:
  - `from src.core.redirector import QUICDowngradeManager`
  - `TransparentGatewayManager.is_active(self, victim_ip: str) -> bool`

- [ ] **Step 1: Write the failing test** — append to `tests/test_quic_downgrade.py`:

```python
class TestExportsAndGatewayIsActive(unittest.TestCase):
    def test_exported_from_package(self):
        from src.core.redirector import QUICDowngradeManager as Exported
        self.assertIs(Exported, QUICDowngradeManager)

    def test_gateway_is_active(self):
        from src.core.redirector.transparent_gateway import TransparentGatewayManager

        class _FakeSpoofer:  # minimal stand-in; is_active must not touch the network
            pass

        tg = TransparentGatewayManager(_FakeSpoofer())
        self.assertFalse(tg.is_active("192.168.110.98"))
        with tg._lock:
            tg._sessions["192.168.110.98"] = {"victim_ip": "192.168.110.98"}
        self.assertTrue(tg.is_active("192.168.110.98"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade.py::TestExportsAndGatewayIsActive -q`
Expected: FAIL — `ImportError` (not exported) and/or `AttributeError: 'TransparentGatewayManager' object has no attribute 'is_active'`.

- [ ] **Step 3: Implement**

In `python-service/src/core/redirector/__init__.py`, add the import and `__all__` entry (mirror the existing `TransparentGatewayManager` export):

```python
from .quic_downgrade import QUICDowngradeManager
```
and add `"QUICDowngradeManager"` to the module's `__all__` list.

In `python-service/src/core/redirector/transparent_gateway.py`, add this method to `TransparentGatewayManager` (place it next to the other small accessors, e.g. after `__init__` or near `get_status`):

```python
    def is_active(self, victim_ip: str) -> bool:
        """True if a Transparent Gateway session is currently active for victim_ip."""
        with self._lock:
            return victim_ip in self._sessions
```

- [ ] **Step 4: Run test to verify it passes**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add python-service/src/core/redirector/__init__.py python-service/src/core/redirector/transparent_gateway.py python-service/tests/test_quic_downgrade.py
git commit -m "feat(python): export QUICDowngradeManager + gateway.is_active()"
```

---

### Task 7: Wire into the DI container + lifespan + teardown

**Files:**
- Modify: `python-service/src/container.py`
- Modify: `python-service/src/lifespan.py`
- Modify: `python-service/tests/test_api_server.py` (teardown-order expectation)

**Interfaces:**
- Consumes: `QUICDowngradeManager`, `TransparentGatewayManager.is_active`.
- Produces: `container.quic_downgrade`, `app.state.quic_downgrade`.

- [ ] **Step 1: Construct in the container** — in `python-service/src/container.py`, in `EngineContainer.__init__`, immediately AFTER `self.transparent_gateway = TransparentGatewayManager(...)` is assigned, add:

```python
        from .core.redirector import QUICDowngradeManager
        self.quic_downgrade = QUICDowngradeManager(
            gateway_session_check=self.transparent_gateway.is_active
        )
```

- [ ] **Step 2: Add to watchdog network-change cleanup** — in `container.py` `run_watchdog_loop`, in the network-change branch where `self.transparent_gateway.stop_all()` is called, add on the next line:

```python
                        self.quic_downgrade.stop_all()
```

- [ ] **Step 3: Add a teardown stage** — in `container.py` `teardown()`, insert a stage into `cleanup_stages` immediately BEFORE the `("transparent gateway", ...)` entry:

```python
            ("QUIC downgrade", self.quic_downgrade.stop_all),
```

Update the docstring's numbered list in `teardown()` to include "QUIC downgrade" before "transparent gateway" (now 9 stages).

- [ ] **Step 4: Expose in lifespan** — in `python-service/src/lifespan.py`, next to the other `app.state.<x> = container.<x>` assignments, add:

```python
    app.state.quic_downgrade = container.quic_downgrade
```

- [ ] **Step 5: Update the teardown-order test** — in `python-service/tests/test_api_server.py`, find the assertion that verifies the shutdown cleanup order (it lists the stage names). Add `"QUIC downgrade"` to the expected ordered list immediately before `"transparent gateway"`. Run the suite to confirm the new order matches.

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_api_server.py -q`
Expected: PASS (teardown-order test now expects the QUIC stage).

- [ ] **Step 6: Import-sanity + full suite**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -c "import warnings;warnings.filterwarnings('ignore'); import src.server as s; print('OK', hasattr(s.container,'quic_downgrade'))"`
Then: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `OK True`, full suite green.

- [ ] **Step 7: Commit**

```bash
git add python-service/src/container.py python-service/src/lifespan.py python-service/tests/test_api_server.py
git commit -m "feat(python): lifecycle-manage QUICDowngradeManager in container + lifespan"
```

---

### Task 8: FastAPI endpoints + status field

**Files:**
- Modify: `python-service/src/api/deps.py`
- Modify: `python-service/src/api/schemas.py`
- Modify: `python-service/src/api/routes/redirector.py`
- Test: `python-service/tests/test_quic_downgrade_api.py` (create)

**Interfaces:**
- Consumes: `container.quic_downgrade`, existing `get_gateway_status` route.
- Produces:
  - `POST /api/gateway/quic-block/start` body `{"victim_ip": str, "victim_ipv6": str | null}`
  - `POST /api/gateway/quic-block/stop` body `{"victim_ip": str}`
  - `GET /api/gateway/status` gains `data.quic_downgrade = {"available": bool, "active_targets": [str]}`
  - `get_quic_downgrade(request) -> QUICDowngradeManager` dependency.

- [ ] **Step 1: Write the failing test** — create `python-service/tests/test_quic_downgrade_api.py`:

```python
"""Route-level tests for QUIC-block endpoints using a fake manager in app.state."""

import unittest
from unittest.mock import MagicMock

from src.api.routes.redirector import (
    start_quic_block, stop_quic_block, get_gateway_status,
)
from src.api.schemas import QuicBlockRequest, QuicBlockStopRequest


class _FakeMgr:
    def __init__(self):
        self.started = []
        self.stopped = []
        self._active = []
    def start(self, target_ip, target_ipv6=None):
        self.started.append((target_ip, target_ipv6)); self._active.append(target_ip)
        return {"success": True, "active": True, "error": None}
    def stop(self, target_ip):
        self.stopped.append(target_ip); return True
    def get_status(self):
        return {"available": True, "active_targets": list(self._active)}


class TestQuicBlockRoutes(unittest.TestCase):
    def test_start_calls_manager(self):
        mgr = _FakeMgr()
        req = QuicBlockRequest(victim_ip="192.168.110.98")
        out = start_quic_block(req, quic_downgrade=mgr)
        self.assertTrue(out["success"])
        self.assertEqual(mgr.started, [("192.168.110.98", None)])

    def test_stop_calls_manager(self):
        mgr = _FakeMgr()
        req = QuicBlockStopRequest(victim_ip="192.168.110.98")
        out = stop_quic_block(req, quic_downgrade=mgr)
        self.assertTrue(out["success"])
        self.assertEqual(mgr.stopped, ["192.168.110.98"])

    def test_status_includes_quic_state(self):
        gw = MagicMock()
        gw.get_status.return_value = {"active_sessions": {}, "active_count": 0,
                                      "sinkhole_count": 0, "sinkhole_domains": [], "total_logs": 0}
        mgr = _FakeMgr(); mgr._active = ["192.168.110.98"]
        out = get_gateway_status(transparent_gateway=gw, quic_downgrade=mgr)
        self.assertEqual(out["data"]["quic_downgrade"],
                         {"available": True, "active_targets": ["192.168.110.98"]})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade_api.py -q`
Expected: FAIL — ImportError (`start_quic_block`, `QuicBlockRequest` not defined).

- [ ] **Step 3a: Add schemas** — in `python-service/src/api/schemas.py`, add (mirror the existing `GatewayStartRequest`):

```python
class QuicBlockRequest(BaseModel):
    victim_ip: str
    victim_ipv6: Optional[str] = None


class QuicBlockStopRequest(BaseModel):
    victim_ip: str
```

- [ ] **Step 3b: Add the dependency** — in `python-service/src/api/deps.py`, add (mirror `get_transparent_gateway`):

```python
def get_quic_downgrade(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "quic_downgrade"):
        val = request.app.state.quic_downgrade
        if val is not None:
            return val
    return get_server_attr("quic_downgrade", get_default_container().quic_downgrade)
```

(Match the exact fallback style used by the other `get_*` deps in that file — some use `get_server_attr`, some read the default container. Copy the pattern of `get_transparent_gateway` verbatim, substituting `quic_downgrade`.)

- [ ] **Step 3c: Add routes + status field** — in `python-service/src/api/routes/redirector.py`:

Add imports at top (extend the existing schema/deps imports):

```python
from ..schemas import QuicBlockRequest, QuicBlockStopRequest
from ..deps import get_quic_downgrade
```

Modify `get_gateway_status` to also inject the QUIC manager and attach its state. Change its signature and body:

```python
@router.get("/api/gateway/status")
@auto_inject
def get_gateway_status(
    transparent_gateway=Depends(get_transparent_gateway),
    quic_downgrade=Depends(get_quic_downgrade),
):
    data = transparent_gateway.get_status()
    data["quic_downgrade"] = quic_downgrade.get_status()
    return {"success": True, "data": data}
```

(Keep whatever wrapper the existing route uses — if it already wraps `get_status()` in `{"success", "data"}`, preserve that shape and just add the `quic_downgrade` key to `data`.)

Add the two new routes (place after the `stop_transparent_gateway` route):

```python
@router.post("/api/gateway/quic-block/start")
@auto_inject
def start_quic_block(req: QuicBlockRequest, quic_downgrade=Depends(get_quic_downgrade)):
    logger.info(f"📥 [HTTP API] Request quic-block start for {req.victim_ip}")
    res = quic_downgrade.start(req.victim_ip, req.victim_ipv6)
    return {"success": res["success"], "active": res.get("active", False),
            "error": res.get("error"), "victim_ip": req.victim_ip}


@router.post("/api/gateway/quic-block/stop")
@auto_inject
def stop_quic_block(req: QuicBlockStopRequest, quic_downgrade=Depends(get_quic_downgrade)):
    logger.info(f"📥 [HTTP API] Request quic-block stop for {req.victim_ip}")
    ok = quic_downgrade.stop(req.victim_ip)
    return {"success": ok, "victim_ip": req.victim_ip}
```

(If the module's other routes use the `@auto_inject` decorator, keep it; if not, drop it and rely on `Depends`. Match the existing routes in this file exactly.)

- [ ] **Step 4: Run test to verify it passes**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/test_quic_downgrade_api.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Route registration + full suite**

Run: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -c "import warnings;warnings.filterwarnings('ignore'); import src.server as s; print(s.app.url_path_for('start_quic_block'), s.app.url_path_for('stop_quic_block'))"`
Expected: prints `/api/gateway/quic-block/start /api/gateway/quic-block/stop`.
Then: `SENTINEL_ALLOW_INSECURE_DEV=1 ./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add python-service/src/api/deps.py python-service/src/api/schemas.py python-service/src/api/routes/redirector.py python-service/tests/test_quic_downgrade_api.py
git commit -m "feat(python): /api/gateway/quic-block start|stop + status field"
```

---

### Task 9: Node backend proxy + license gate + stop-on-gateway-stop

**Files:**
- Modify: `backend-node/src/services/pythonBridge.ts`
- Modify: `backend-node/src/services/deviceManager.ts`
- Modify: `backend-node/src/controllers/gatewayController.ts`
- Modify: `backend-node/src/routes/gatewayRoutes.ts`
- Test: `backend-node/tests/unit_quicBlock.test.ts` (create) + register in `backend-node/tests/run_tests.ts`

**Interfaces:**
- Consumes: engine endpoints from Task 8; existing `this.license.checkCanGateway()`.
- Produces:
  - `pythonBridge.startQuicBlock(victimIp, victimIpv6?)`, `pythonBridge.stopQuicBlock(victimIp)`
  - `deviceManager.startQuicBlock(ip)`, `deviceManager.stopQuicBlock(ip)` (license-gated)
  - routes `POST /api/gateway/quic-block/start|stop`

- [ ] **Step 1: pythonBridge methods** — in `backend-node/src/services/pythonBridge.ts`, mirror `startTransparentGateway` (POST to the engine, `getAuthHeaders()`, `fetchWithTimeout`):

```typescript
    async startQuicBlock(victimIp: string, victimIpv6?: string): Promise<any> {
        this.log.info({ endpoint: '/api/gateway/quic-block/start', victimIp }, `[HTTP Call -> Python] POST /api/gateway/quic-block/start for ${victimIp}`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/quic-block/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
            body: JSON.stringify({ victim_ip: victimIp, victim_ipv6: victimIpv6 ?? null }),
        });
        return res.json();
    }

    async stopQuicBlock(victimIp: string): Promise<any> {
        this.log.info({ endpoint: '/api/gateway/quic-block/stop', victimIp }, `[HTTP Call -> Python] POST /api/gateway/quic-block/stop for ${victimIp}`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/quic-block/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
            body: JSON.stringify({ victim_ip: victimIp }),
        });
        return res.json();
    }
```

(Use the exact header/timeout helpers the neighbouring methods use — copy `startTransparentGateway`'s shape.)

- [ ] **Step 2: deviceManager methods (license-gated)** — in `backend-node/src/services/deviceManager.ts`, add near `startTransparentGateway`. Mirror `_startTransparentGatewayImpl`'s license check:

```typescript
    async startQuicBlock(ip: string): Promise<any> {
        return this.runExclusive(() => this._startQuicBlockImpl(ip));
    }

    private async _startQuicBlockImpl(ip: string): Promise<any> {
        const device = this.getDevice(ip) || this.findDeviceByMac(ip);
        if (!device) throw new Error(`Device ${ip} not found`);
        if (this.license) {
            const check = this.license.checkCanGateway();
            if (!check.allowed) {
                throw new FeatureLockedError(check.reason || 'Transparent Gateway (QUIC block) requires a Pro license.');
            }
        }
        return this.python.startQuicBlock(device.ip, device.ipv6_link_local || device.ipv6_global);
    }

    async stopQuicBlock(ip: string): Promise<any> {
        return this.runExclusive(() => this.python.stopQuicBlock(ip));
    }
```

(Import `FeatureLockedError` if not already imported in this file — check the top of `deviceManager.ts`; `_startTransparentGatewayImpl` already throws it, so it is imported.)

- [ ] **Step 3: Stop QUIC when the gateway stops** — in `deviceManager.ts` `_stopTransparentGatewayImpl` (the method behind `stopTransparentGateway`), after the gateway is stopped, add a best-effort QUIC stop so a lingering handle never outlives its gateway session:

```typescript
        try { await this.python.stopQuicBlock(ip); } catch (e: any) { this.log.debug({ err: e }, `Notice stopping QUIC block on gateway stop for ${ip}`); }
```

- [ ] **Step 4: Controller + routes** — in `backend-node/src/controllers/gatewayController.ts`, add handlers mirroring the existing gateway start/stop (read `req.body.ip`/`victim_ip`, call `deviceManager.startQuicBlock`/`stopQuicBlock`, return json; let the shared error middleware map `FeatureLockedError`):

```typescript
    startQuicBlock = async (req: Request, res: Response): Promise<void> => {
        const ip = req.body?.ip || req.body?.victim_ip;
        const data = await this.deviceManager.startQuicBlock(ip);
        res.json({ success: true, data });
    };
    stopQuicBlock = async (req: Request, res: Response): Promise<void> => {
        const ip = req.body?.ip || req.body?.victim_ip;
        const data = await this.deviceManager.stopQuicBlock(ip);
        res.json({ success: true, data });
    };
```

In `backend-node/src/routes/gatewayRoutes.ts`, register (mirror the `/api/gateway/start` registration + its `safeHandler` wrapper):

```typescript
    router.post('/api/gateway/quic-block/start', safeHandler(controller.startQuicBlock));
    router.post('/api/gateway/quic-block/stop', safeHandler(controller.stopQuicBlock));
```

- [ ] **Step 5: Write the unit test** — create `backend-node/tests/unit_quicBlock.test.ts`:

```typescript
import assert from 'assert';
import { FeatureLockedError } from '../src/services/licenseManager';

export async function runQuicBlockTests() {
    console.log('\n--- [Node] Testing QUIC-block license gate + delegation ---');

    // Free tier -> FeatureLockedError, engine NOT called.
    {
        let engineCalled = false;
        const dm: any = {
            license: { checkCanGateway: () => ({ allowed: false, reason: 'Pro only' }) },
            python: { startQuicBlock: async () => { engineCalled = true; return {}; } },
            getDevice: (ip: string) => ({ ip, ipv6_link_local: '' }),
            findDeviceByMac: () => undefined,
            runExclusive: (fn: any) => fn(),
            log: { debug() {} },
        };
        const { DeviceManager } = await import('../src/services/deviceManager');
        const impl = (DeviceManager.prototype as any)._startQuicBlockImpl.bind(dm);
        await assert.rejects(() => impl('192.168.110.98'), (e: any) => e instanceof FeatureLockedError);
        assert.strictEqual(engineCalled, false, 'free tier must NOT reach the engine');
        console.log('  ✓ Free tier blocked by checkCanGateway (engine not called)');
    }

    // Pro tier -> engine called with device ip.
    {
        let calledWith = '';
        const dm: any = {
            license: { checkCanGateway: () => ({ allowed: true }) },
            python: { startQuicBlock: async (ip: string) => { calledWith = ip; return { success: true }; } },
            getDevice: (ip: string) => ({ ip, ipv6_link_local: '' }),
            findDeviceByMac: () => undefined,
            runExclusive: (fn: any) => fn(),
            log: { debug() {} },
        };
        const { DeviceManager } = await import('../src/services/deviceManager');
        const impl = (DeviceManager.prototype as any)._startQuicBlockImpl.bind(dm);
        const out = await impl('192.168.110.98');
        assert.strictEqual(calledWith, '192.168.110.98');
        assert.strictEqual(out.success, true);
        console.log('  ✓ Pro tier delegates to engine startQuicBlock');
    }

    console.log('  ✅ QUIC-block gate suite passed');
}
```

Register it in `backend-node/tests/run_tests.ts` (import + a `try { await runQuicBlockTests(); passed += 2; } catch ...` block, following the existing pattern).

- [ ] **Step 6: Build + run Node tests**

Run: `cd backend-node && npx tsc --noEmit -p tsconfig.json` (expect exit 0)
Then: `cd backend-node && LOG_LEVEL=silent npx ts-node tests/run_tests.ts`
Expected: all pass including the QUIC-block gate suite.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/services/pythonBridge.ts backend-node/src/services/deviceManager.ts backend-node/src/controllers/gatewayController.ts backend-node/src/routes/gatewayRoutes.ts backend-node/tests/unit_quicBlock.test.ts backend-node/tests/run_tests.ts
git commit -m "feat(backend): proxy QUIC-block behind checkCanGateway; stop on gateway stop"
```

---

### Task 10: Frontend per-target toggle

**Files:**
- Modify: `frontend-react/src/types/index.ts`
- Modify: `frontend-react/src/components/TransparentGatewayView.tsx`

**Interfaces:**
- Consumes: `GET /api/gateway/status` `data.quic_downgrade = {available, active_targets}`; `POST /api/gateway/quic-block/start|stop`.

- [ ] **Step 1: Extend the gateway-status type** — in `frontend-react/src/types/index.ts`, add to the gateway-status type (find the interface used for `/api/gateway/status`'s `data`; add):

```typescript
  quic_downgrade?: {
    available: boolean;
    active_targets: string[];
  };
```

- [ ] **Step 2: Add the toggle** — in `frontend-react/src/components/TransparentGatewayView.tsx`, for each active gateway target, render a toggle "Force QUIC → TCP (block)". It is:
  - **disabled** when `status.quic_downgrade?.available === false`, with a tooltip: "WinDivert unavailable on this host".
  - **on** when `status.quic_downgrade?.active_targets.includes(target_ip)`.
  - On toggle-on: `POST /api/gateway/quic-block/start` with `{ ip: target_ip }`; on toggle-off: `POST /api/gateway/quic-block/stop` with `{ ip: target_ip }`; then refetch gateway status.

Follow the existing sinkhole/gateway control styling in this component. Example handler (adapt to the component's existing fetch helper and state):

```tsx
const toggleQuic = async (ip: string, enable: boolean) => {
  const path = enable ? '/api/gateway/quic-block/start' : '/api/gateway/quic-block/stop';
  await apiFetch(path, { method: 'POST', body: JSON.stringify({ ip }) });
  await refetchGatewayStatus();
};
```

- [ ] **Step 3: Type-check / build the frontend**

Run: `cd frontend-react && npm run build` (or the repo's `tsc`/vite build)
Expected: builds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend-react/src/types/index.ts frontend-react/src/components/TransparentGatewayView.tsx
git commit -m "feat(frontend): per-target Force QUIC->TCP toggle in Transparent Gateway"
```

---

### Task 11: Packaging — bundle WinDivert in the PyInstaller build

**Files:**
- Modify: the PyInstaller spec / build script under `python-service/` (e.g. `build_engine.py` or the `.spec` used by `pyinstaller`) and `python-service/requirements-build.txt` if build deps are tiered.

**Interfaces:**
- Produces: a packaged engine whose `pydivert` can locate and load `WinDivert.dll` + `WinDivert64.sys`.

- [ ] **Step 1: Ensure the hook is present** — `pyinstaller-hooks-contrib` ships `hook-pydivert` which collects the WinDivert binaries. Confirm `pyinstaller-hooks-contrib` is installed in the build environment (it is a PyInstaller dependency). If the build uses an explicit `.spec`, ensure `hiddenimports`/`datas` do not exclude pydivert.

- [ ] **Step 2: Build the packaged engine**

Run the repo's existing engine build (e.g. `python build_engine.py` or `pyinstaller <spec>`).
Expected: build succeeds; the output `dist/.../_internal/` contains `WinDivert.dll` and `WinDivert64.sys`.

- [ ] **Step 3: Acceptance check (manual, elevated, real host)** — from the packaged engine directory, in an **elevated** shell with the engine running, confirm a QUIC-block start returns `success:true` and `GET /api/gateway/status` shows the target under `quic_downgrade.active_targets`, and that a QUIC site (e.g. YouTube) on the target falls back to TCP and a sinkholed domain is then cut. Document the result in the PR. This is a manual acceptance test because it needs the signed WinDivert driver to load on the target Windows version (verified loadable on Win11 24H2 during the spike).

- [ ] **Step 4: Commit**

```bash
git add python-service/build_engine.py python-service/requirements-build.txt
git commit -m "build(python): bundle WinDivert driver in packaged engine for QUIC-downgrade"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Goal / mechanism (drop UDP-443 on NETWORK_FORWARD, no re-inject) → Tasks 2–4.
- Components (`QUICDowngradeManager`, filter builder, start/stop/stop_all/get_status, op-lock) → Tasks 2, 4, 6.
- Absence path (`available:false`, clean error) → Tasks 4, 5.
- Precondition (gateway session required) → Tasks 4, 6, 8.
- Lifecycle integration (teardown, network-change, IP-change replacement) → Tasks 7, 9 (Node stops QUIC on gateway stop; DHCP IP change replaces the gateway session which Node re-drives).
- API (`/api/gateway/quic-block/start|stop`, status field) → Task 8.
- Node proxy + `checkCanGateway` gate → Task 9.
- Frontend toggle (disabled when unavailable) → Task 10.
- Packaging (WinDivert bundled, acceptance check) → Task 11.
- Testing (mock pydivert; lifecycle; filter builder; drop loop never sends; absence path; precondition) → Tasks 2–8.
- Regression guard (spoofer/gateway tests unchanged) → every task runs the full suite; no task edits `spoofer.py` or the gateway packet callback.

**Placeholder scan:** no "TBD/TODO"; every code step contains real code. Where a task says "match the existing pattern", it also gives the exact code to copy and names the sibling to mirror (`startTransparentGateway`, `get_transparent_gateway`), because the sibling's precise wrapper (e.g. `@auto_inject`, `safeHandler`, header helpers) must be preserved verbatim.

**Type consistency:** `QUICDowngradeManager.start` returns `{"success","active","error"}` everywhere (Tasks 4, 5, 8); `get_status` returns `{"available","active_targets"}` (Tasks 4, 8, 10); routes `start_quic_block`/`stop_quic_block` and schemas `QuicBlockRequest`/`QuicBlockStopRequest` are used consistently (Tasks 8, 9); Node `startQuicBlock`/`stopQuicBlock` names match across bridge/deviceManager/controller/routes (Task 9).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-21-quic-downgrade-implementation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks (REQUIRED SUB-SKILL: superpowers:subagent-driven-development).
2. **Inline Execution** — execute tasks in-session with checkpoints (REQUIRED SUB-SKILL: superpowers:executing-plans).
