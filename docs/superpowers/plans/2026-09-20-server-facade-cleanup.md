# Server Facade & Backward Compatibility Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the legacy backward-compatibility facade in `python-service/src/server.py` (>240 lines of boilerplate), eliminate reflection hacks (`get_server_attr`) in `src/api/deps.py` and `src/api/routes/discovery.py`, and migrate unit tests to import directly from domain routers and containers.

**Architecture:** Refactor `src/server.py` to be a pure ASGI composition root (FastAPI app, middlewares, exception handlers, and router inclusions). Eliminate dynamic `sys.modules.get("src.server")` reflection lookups across all dependency providers. Realign unit test mocking to adhere strictly to standard Python testing rules (*mock where it is used*).

**Tech Stack:** Python 3.11, FastAPI, Starlette, Pytest, Unittest Mock, Pydantic v2.

**Spec:** Governed by `AGENTS.md` and `docs/specs/SPEC-007_AUTOMATED_TESTING_SUITE.md`.

## Global Constraints

- Never break backward compatibility for external consumers (Node.js REST/WebSocket contracts remain 100% identical).
- Core Invariants 1-7 in `AGENTS.md` must never be violated.
- Maintain 100% green test suites (420 Python + 118 Node.js + 6 Electron = 544 total tests).
- All changes must be incremental, test-backed, and verified with `pytest` at each stage.

---

### Task 1: Quick Win - Migrate `test_unit_core_fixes.py` to `src.container`

**Files:**
- Modify: `python-service/tests/test_unit_core_fixes.py:15`

**Interfaces:**
- Consumes: `ConnectionManager` from `src.container`
- Produces: Decoupled test importing directly from service container module

- [ ] **Step 1: Update import in `tests/test_unit_core_fixes.py`**
Change line 15:
```python
- from src.server import ConnectionManager
+ from src.container import ConnectionManager
```

- [ ] **Step 2: Run test to verify it passes**
Run: `cd python-service; .\venv\Scripts\pytest tests/test_unit_core_fixes.py -v`
Expected: PASS (4/4 passed).

- [ ] **Step 3: Commit**
```bash
git add python-service/tests/test_unit_core_fixes.py
git commit -m "test(python): import ConnectionManager directly from src.container"
```

---

### Task 2: Clean Unused Imports in `tests/test_modular_architecture.py`

**Files:**
- Modify: `python-service/tests/test_modular_architecture.py:24`

**Interfaces:**
- Consumes: `app, container` from `src.server`
- Produces: Removed dead `spoofer` import

- [ ] **Step 1: Update import in `tests/test_modular_architecture.py`**
Change line 24:
```python
- from src.server import app, container, spoofer
+ from src.server import app, container
```

- [ ] **Step 2: Run test to verify it passes**
Run: `cd python-service; .\venv\Scripts\pytest tests/test_modular_architecture.py -v`
Expected: PASS (6/6 passed).

- [ ] **Step 3: Commit**
```bash
git add python-service/tests/test_modular_architecture.py
git commit -m "test(python): remove unused spoofer import in test_modular_architecture"
```

---

### Task 3: Migrate `tests/test_api_server.py` to Domain Routers & Realignment of Mocking

**Files:**
- Modify: `python-service/tests/test_api_server.py`

**Interfaces:**
- Consumes:
  - `src.api.routes.system`: `health_check`, `get_status`
  - `src.api.routes.telemetry`: `get_telemetry`
  - `src.api.routes.discovery`: `get_wifi_status`, `scan_network`, `trigger_dhcp_wakeup`, `profile_refresh`, `quick_reauth_profiling`
  - `src.api.routes.spoof`: `start_spoof`, `update_spoof_limit`, `stop_spoof`, `stop_all_spoof`
  - `src.api.routes.bettercap`: `run_bettercap_syn_scan`
  - `src.api.schemas`: `SpoofStartRequest`, `SpoofLimitRequest`, `SpoofStopRequest`, `SynScanRequest`, `ProfileRefreshRequest`, `ProfileRefreshTarget`, `QuickReauthRequest`, `QuickReauthTarget`
  - `src.container`: `get_default_container`, `EngineContainer`
- Produces: Fully modular route test suite decoupled from `src.server` exports

- [ ] **Step 1: Update imports in `tests/test_api_server.py`**
Replace lines 20-48 with direct domain router, schema, and container imports without the Scapy/NDP patch-hack:
```python
from src.api.routes.system import health_check, get_status
from src.api.routes.telemetry import get_telemetry
from src.api.routes.discovery import (
    get_wifi_status,
    scan_network,
    trigger_dhcp_wakeup,
    profile_refresh,
    quick_reauth_profiling,
)
from src.api.routes.spoof import (
    start_spoof,
    update_spoof_limit,
    stop_spoof,
    stop_all_spoof,
)
from src.api.routes.bettercap import run_bettercap_syn_scan
from src.api.schemas import (
    SpoofStartRequest,
    SpoofLimitRequest,
    SpoofStopRequest,
    SynScanRequest,
    ProfileRefreshRequest,
    ProfileRefreshTarget,
    QuickReauthRequest,
    QuickReauthTarget,
)
from src.container import get_default_container
```

- [ ] **Step 2: Update spoofer error tests in `tests/test_api_server.py`**
In `test_stop_spoof_restore_failure_remains_an_http_error` and `test_stop_all_spoof_failure_remains_an_http_error`:
Pass `mock_spoofer` directly using `@auto_inject` DI capabilities, or patch `src.core.spoofer.ARPSpoofer`:
```python
mock_spoofer = MagicMock()
mock_spoofer.stop.side_effect = SpoofError('restore packets failed')
with self.assertRaises(HTTPException) as ctx:
    stop_spoof(req_stop, spoofer=mock_spoofer)
self.assertEqual(ctx.exception.status_code, 500)
```
And for `stop_all_spoof`:
```python
mock_spoofer = MagicMock()
mock_spoofer.stop_all.side_effect = SpoofError('member restore failed')
with self.assertRaises(HTTPException) as ctx:
    stop_all_spoof(spoofer=mock_spoofer)
self.assertEqual(ctx.exception.status_code, 500)
```

- [ ] **Step 3: Update `test_shutdown_event` to test `container.teardown()`**
Test `container.teardown()` directly on a mock container or patched container:
```python
def test_container_teardown_runs_all_cleanup_stages_after_multiple_failures(self):
    """A failed shutdown stage must not skip later safety cleanup."""
    calls = []

    def cleanup(name, fail=False):
        def run(*_args, **_kwargs):
            calls.append(name)
            if fail:
                raise RuntimeError(f'{name} failed')
        return run

    container = get_default_container()
    with patch.object(container.shield_engine, 'disable', side_effect=cleanup('shield', True)), \
         patch.object(container.gaming_engine, 'toggle', side_effect=cleanup('gaming')), \
         patch.object(container.liveness_daemon, 'stop', side_effect=cleanup('liveness', True)), \
         patch('src.container.NetworkScanner.stop_dhcp_sniffer', side_effect=cleanup('dhcp')), \
         patch.object(container.redirect_manager, 'stop_all', side_effect=cleanup('redirect')), \
         patch.object(container.transparent_gateway, 'stop_all', side_effect=cleanup('gateway', True)), \
         patch.object(container.spoofer, 'stop_all', side_effect=cleanup('spoofer')), \
         patch.object(container.executor, 'shutdown', side_effect=cleanup('executor')):
        container.teardown()

    self.assertEqual(
        calls,
        ['shield', 'gaming', 'liveness', 'dhcp', 'redirect', 'gateway', 'spoofer', 'executor'],
    )
```

- [ ] **Step 4: Update discovery mock targets in `test_api_server.py`**
Align discovery patch targets to `'src.api.routes.discovery.<symbol>'`:
- `'src.server.get_network_info'` -> `'src.api.routes.discovery.get_network_info'`
- `'src.server.get_current_gateway'` -> `'src.api.routes.discovery.get_current_gateway'`
- `'src.server.get_self_mac'` -> `'src.api.routes.discovery.get_self_mac'`
- `'src.server.send_multicast_wakeup'` -> `'src.api.routes.discovery.send_multicast_wakeup'`
- `'src.server.collect_profile_refresh'` -> `'src.api.routes.discovery.collect_profile_refresh'`
- `'src.server.dhcp_cache.get_unique_snapshot'` -> `'src.api.routes.discovery.dhcp_cache.get_unique_snapshot'`
- `'src.server.asyncio.sleep'` -> `'src.api.routes.discovery.asyncio.sleep'`
- `scan_network` scanner mock: pass `scanner=mock_scanner` directly or patch `src.api.routes.discovery.get_scanner`.

- [ ] **Step 5: Run test to verify it passes**
Run: `cd python-service; .\venv\Scripts\pytest tests/test_api_server.py -v`
Expected: PASS (24/24 passed).

- [ ] **Step 6: Commit**
```bash
git add python-service/tests/test_api_server.py
git commit -m "test(python): migrate test_api_server to import from domain routers directly"
```

---

### Task 4: Eliminate `get_server_attr()` and Reflection Seams in `src/api/routes/discovery.py` & `src/api/deps.py`

**Files:**
- Modify: `python-service/src/api/routes/discovery.py`
- Modify: `python-service/src/api/deps.py`

**Interfaces:**
- Consumes: Direct imports from `src.core.network` and `src.core.discovery`
- Produces: Clean dependency injection without `sys.modules.get("src.server")` reflection

- [ ] **Step 1: Clean up `src/api/routes/discovery.py`**
- Import `get_current_gateway`, `get_network_info`, `get_self_mac` directly from `src.core.network`.
- Import `send_multicast_wakeup`, `dhcp_cache`, `collect_profile_refresh` directly from `src.core.discovery`.
- Replace all `get_server_attr(...)` calls with direct function invocations.

- [ ] **Step 2: Clean up `src/api/deps.py`**
- Remove `get_server_attr()` function definition.
- Remove `srv = sys.modules.get("src.server")` blocks from all 13 dependency providers:
  `get_spoofer`, `get_scanner`, `get_redirect_manager`, `get_transparent_gateway`, `get_connection_manager`, `get_telemetry_sampler`, `get_cert_engine`, `get_flow_manager`, `get_bettercap_dns`, `get_bettercap_dissector`, `get_bettercap_syn_scanner`, `get_shield_engine`, `get_gaming_engine`, `get_liveness_daemon`, `get_executor`.
- Each provider simply resolves `request.app.state.<dep>` if present, else `get_container(request).<dep>`.

- [ ] **Step 3: Run full discovery and API test suites**
Run: `cd python-service; .\venv\Scripts\pytest tests/test_api_server.py tests/test_unit_discovery.py tests/test_modular_architecture.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add python-service/src/api/routes/discovery.py python-service/src/api/deps.py
git commit -m "refactor(python): eliminate get_server_attr and reflection seams in deps and discovery"
```

---

### Task 5: Prune Legacy Re-exports and Scaffolding from `src/server.py`

**Files:**
- Modify: `python-service/src/server.py`

**Interfaces:**
- Consumes: `ALL_ROUTERS`, `get_default_container`, `lifespan`, `settings`, `verify_api_token`, `logger`
- Produces: Clean, lightweight ASGI application entrypoint (<130 lines)

- [ ] **Step 1: Remove redundant imports and facade in `src/server.py`**
- Remove lines 25–146 (50+ handler imports, 25 schema imports, core helper imports).
- Remove lines 266–279 (module-level singletons: `scanner`, `spoofer`, etc.).
- Remove lines 281–314 (`shutdown_event()` duplicate).
- Retain `container = get_default_container()` for app state accessor.
- Simplify `__all__ = ["app", "container"]`.

- [ ] **Step 2: Run full Python test suite**
Run: `cd python-service; .\venv\Scripts\pytest -q`
Expected: 420 passed, 0 failed.

- [ ] **Step 3: Run Node.js orchestrator and Electron supervisor test suites**
Run:
```bash
cd backend-node; npm test
cd desktop-electron; npm test
```
Expected: 118 Node + 6 Electron passed.

- [ ] **Step 4: Commit**
```bash
git add python-service/src/server.py
git commit -m "refactor(python): prune legacy backward-compatibility facade in src/server.py"
```
