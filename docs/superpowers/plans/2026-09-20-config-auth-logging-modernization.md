# Config Centralization, Auth Fail-Closed Hardening, & Structured Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the Python network microservice (`python-service`) with a centralized Pydantic v2 configuration engine, fail-closed auth hardening with a dev escape-hatch, and dual-mode structured JSON logging eliminating all raw `print()` calls.

**Architecture:** 
- Centralized `EngineSettings` model in `src/config.py` backed by `pydantic.BaseModel` and `python-dotenv`, re-exported via `src/utils/config.py` for 100% backward compatibility.
- Universal timing-safe token verification function `verify_api_token()` enforcing fail-closed protection in production and on loopback by default, with an explicit `SENTINEL_ALLOW_INSECURE_DEV=1` escape hatch for development.
- Dual-mode `StructuredJSONFormatter` in `src/utils/logger.py` supporting `LOG_FORMAT=text|json` with crash-proof serialization (`default=str`) and context extraction from `extra={...}`, replacing all raw `print()` occurrences in entrypoints.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2 (`2.13.4`), `python-dotenv` (`1.0.0`), standard library `logging` and `hmac`.

**Spec:** `python_config_auth_logging_deep_audit_phase2.md`, `docs/specs/SPEC-010_DEEP_SECURITY_AND_THREAT_MODELING.md`, `AGENTS.md`.

## Global Constraints

- **Invariants 1 & 2**: Never target default router gateway or controller host.
- **Invariant 3**: No network packet I/O or sleep inside mutex lock.
- **Invariant 5**: 100% backward compatibility for existing REST endpoints, WebSocket event payloads, and legacy module imports (`src.utils.config.config`).
- **Invariant 7**: Control-plane guards must remain exact-match and timing-safe (`hmac.compare_digest`). `/health` MUST remain public.
- **Zero New External Packages**: Rely only on pinned `pydantic` and `python-dotenv` already present in `pyproject.toml`.
- **Test Integrity**: Zero test failures across Python (392 existing) and Node.js (118 existing).

---

### Task 1: Centralized Configuration Engine (`src/config.py` & `src/utils/config.py`)

**Files:**
- Create: `python-service/src/config.py`
- Modify: `python-service/src/utils/config.py`
- Modify: `python-service/src/container.py:144`
- Modify: `python-service/src/server.py:162,167-176`
- Modify: `python-service/pyproject.toml:7`
- Test: `python-service/tests/test_config.py`

**Interfaces:**
- Produces:
  - `src.config.settings`: `EngineSettings` singleton instance.
  - `src.config.EngineSettings`: Pydantic BaseModel with properties `cors_origins`, `is_production`.
  - `src.utils.config.config`: Alias to `settings` preserving legacy attributes `LOG_LEVEL`, `ARP_TIMEOUT`, `SPOOF_INTERVAL`.

- [ ] **Step 1: Write the failing unit tests for configuration**
  Create `python-service/tests/test_config.py` testing:
  - Default settings values (`HOST="127.0.0.1"`, `PORT=8001`, `APP_VERSION="2.41.66"`, `MAX_WORKERS=5`, `LOG_LEVEL="INFO"`, `LOG_FORMAT="text"`).
  - Environment variable overrides (`ENGINE_HOST`, `ENGINE_PORT`, `MAX_WORKERS`, `PY_CORS_ORIGINS`).
  - Validation rules (invalid port, zero/negative workers, unknown log level fallback).
  - CORS origins list parsing and stripping.
  - Backward compatibility of `src.utils.config.config`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `.\venv\Scripts\python.exe -m unittest tests/test_config.py -v`
  Expected: FAIL with `ModuleNotFoundError: No module named 'src.config'`

- [ ] **Step 3: Implement `src/config.py` and update `src/utils/config.py`**
  - Implement `EngineSettings` in `python-service/src/config.py`.
  - Update `python-service/src/utils/config.py` to re-export `settings as config`.
  - Update `python-service/pyproject.toml` version to `"2.41.66"`.

- [ ] **Step 4: Wire `settings` into `src/container.py` and `src/server.py`**
  - In `src/container.py`, set `self.executor = ThreadPoolExecutor(max_workers=settings.MAX_WORKERS)`.
  - In `src/server.py`, set `version=settings.APP_VERSION` and `allow_origins=settings.cors_origins`.

- [ ] **Step 5: Run tests to verify they pass**
  Run: `.\venv\Scripts\python.exe -m unittest tests/test_config.py -v`
  Run: `.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`
  Expected: ALL PASS.

---

### Task 2: Logging Modernization & Structured JSON (`src/utils/logger.py` & Entrypoints)

**Files:**
- Modify: `python-service/src/utils/logger.py`
- Modify: `python-service/src/main.py:13-26`
- Modify: `python-service/main.py:6-25`
- Test: `python-service/tests/test_structured_logging.py`

**Interfaces:**
- Consumes: `src.config.settings` (`LOG_LEVEL`, `LOG_FORMAT`).
- Produces:
  - `src.utils.logger.StructuredJSONFormatter`: JSON formatter extracting `extra` attributes into `context` and serializing non-string objects safely with `default=str`.
  - `src.utils.logger.logger`: Idempotent singleton logger outputting text or JSON based on `settings.LOG_FORMAT`.

- [ ] **Step 1: Write the failing unit tests for structured logging**
  Create `python-service/tests/test_structured_logging.py` testing:
  - `StructuredJSONFormatter` formats log record into valid JSON.
  - Standard JSON keys present: `timestamp` (ISO UTC), `level`, `logger`, `message`.
  - Custom `extra` attributes (`victim_ip`, `mac`, `action`) serialized into `context`.
  - Non-JSON-serializable objects (e.g. Scapy packet mock, bytes) safely converted to string (`default=str`).
  - Exception stack traces correctly serialized into `exception` field.
  - `setup_logger()` idempotency (no duplicate handlers on re-invocation).

- [ ] **Step 2: Run test to verify it fails**
  Run: `.\venv\Scripts\python.exe -m unittest tests/test_structured_logging.py -v`
  Expected: FAIL with `AttributeError: module 'src.utils.logger' has no attribute 'StructuredJSONFormatter'`

- [ ] **Step 3: Implement `StructuredJSONFormatter` and update `setup_logger()`**
  - Implement `StructuredJSONFormatter` in `python-service/src/utils/logger.py`.
  - Update `setup_logger()` to check `if not logger.handlers:`.
  - Apply `StructuredJSONFormatter` when `settings.LOG_FORMAT == "json"`.

- [ ] **Step 4: Replace raw `print()` calls in entrypoints**
  - In `src/main.py:20,24`: Replace `print()` with `logger.info/error`. Use `settings.HOST` and `settings.PORT`.
  - In `python-service/main.py:18`: Replace `print()` with `logger.info/error`. Use `settings.HOST` and `settings.PORT`.

- [ ] **Step 5: Run tests to verify they pass**
  Run: `.\venv\Scripts\python.exe -m unittest tests/test_structured_logging.py -v`
  Run: `.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`
  Expected: ALL PASS.

---

### Task 3: Universal Fail-Closed Auth Hardening (`src/config.py`, `src/server.py`, `src/api/routes/websocket.py`)

**Files:**
- Modify: `python-service/src/config.py` (add `verify_api_token`)
- Modify: `python-service/src/server.py:178-195` (`api_token_guard`)
- Modify: `python-service/src/api/routes/websocket.py:19-27` (`websocket_events`)
- Modify: `backend-node/.env` (document dev auth configuration)
- Modify: `python-service/.env.example`
- Test: `python-service/tests/test_auth_guard.py`

**Interfaces:**
- Produces:
  - `src.config.verify_api_token(provided_token: Optional[str]) -> Tuple[bool, Optional[str]]`
- Consumes:
  - `settings.SENTINEL_API_TOKEN`, `settings.is_production`, `settings.SENTINEL_ALLOW_INSECURE_DEV`.

- [ ] **Step 1: Write failing unit tests for auth verification & middleware**
  Create `python-service/tests/test_auth_guard.py` testing:
  - `verify_api_token`:
    - Passes when token matches `SENTINEL_API_TOKEN` via `hmac.compare_digest`.
    - Fails (returns False, error msg) when token is wrong or missing when `SENTINEL_API_TOKEN` is set.
    - Fails in production when `SENTINEL_API_TOKEN` is unset (Fail-Closed).
    - Fails in dev when `SENTINEL_API_TOKEN` is unset and `SENTINEL_ALLOW_INSECURE_DEV=False` (Fail-Closed default).
    - Passes in dev when `SENTINEL_API_TOKEN` is unset and `SENTINEL_ALLOW_INSECURE_DEV=True` (Escape Hatch).
  - HTTP middleware & WS integration:
    - `/health` endpoint is exempt under all policies.
    - `OPTIONS` request is exempt under all policies.
    - Unauthorized request returns HTTP 401 with JSON `{"success": false, "error": ...}`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `.\venv\Scripts\python.exe -m unittest tests/test_auth_guard.py -v`
  Expected: FAIL with `ImportError: cannot import name 'verify_api_token'`

- [ ] **Step 3: Implement `verify_api_token` in `src/config.py`**
  Implement the timing-safe authorization function in `python-service/src/config.py`.

- [ ] **Step 4: Update `src/server.py` and `src/api/routes/websocket.py`**
  - Refactor `api_token_guard` in `src/server.py` to call `verify_api_token`.
  - Refactor `websocket_events` in `src/api/routes/websocket.py` to call `verify_api_token`.
  - Update `python-service/.env.example` and `backend-node/.env` with `SENTINEL_ALLOW_INSECURE_DEV=1`.

- [ ] **Step 5: Run tests to verify they pass**
  Run: `.\venv\Scripts\python.exe -m unittest tests/test_auth_guard.py -v`
  Run: `.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`
  Run: `cd ../backend-node; npm test`
  Expected: ALL PASS.

---

### Task 4: Documentation & Regression Verification Gate

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/specs/SPEC-010_DEEP_SECURITY_AND_THREAT_MODELING.md`
- Modify: `docs/TROUBLESHOOTING.md`

- [ ] **Step 1: Run complete test verification suites**
  - Python: `.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"` (All tests passing)
  - Node.js: `npm test` (All 118 tests passing)
- [ ] **Step 2: Update documentation and changelog**
  - Update `CHANGELOG.md` with version `v2.41.67`.
  - Update `docs/specs/SPEC-010_DEEP_SECURITY_AND_THREAT_MODELING.md` reflecting fail-closed default and escape-hatch.
  - Update `docs/TROUBLESHOOTING.md` with diagnosis for 401 fail-closed errors.
