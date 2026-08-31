# AGENTS.MD: Autonomous Agent Operational Guide

> **Target Audience:** AI Coding Assistants (Google Antigravity, Claude, Copilot, Cursor).
> **Purpose:** Authoritative reference for architecture, commands, invariants, and guidelines.

---

## 1. System Overview & Service Ports

NetCut Sentinel (Spoorf) is an automated Layer 2 network manipulation and discovery engine organized as a **Hybrid Microservices Architecture**:

| Service | Technology | Port | Working Directory | Launch Command |
| :--- | :--- | :---: | :--- | :--- |
| **Network Engine** | Python 3.11 + FastAPI + Scapy | `8001` | `d:/spoorf/python-service` | `.\venv\Scripts\python.exe -m uvicorn src.server:app --host 127.0.0.1 --port 8001` |
| **Orchestrator** | Node.js 20 + Express + Socket.IO | `5000` | `d:/spoorf/backend-node` | `npm run dev` |
| **Frontend UI** | React 18 + Vite + Tailwind + Framer | `5173` | `d:/spoorf/frontend-react` | `npm run dev` |
| **Persistence** | SQLite 3 (`better-sqlite3` WAL) | Embedded | `d:/spoorf/backend-node/data` | Auto-created: `data/sentinel.db` |

---

## 2. Core Invariants (Non-Negotiable Rules)

When modifying or refactoring code in this repository, you **MUST NEVER VIOLATE** the following invariants:

1. **Gateway Immunity (`is_gateway: true`)**:
   - Default router gateways must NEVER be targeted by ARP spoofing, cut-off, or bandwidth limits.
   - The backend `DeviceManager` and Python `ARPSpoofer` must reject gateway spoofing immediately (`SpoofError`).
2. **Controller Self-Protection (`is_self: true`)**:
   - The operator's host adapter (`This PC`) must never be targeted by L2 spoofing (*anti self-cut*).
3. **Lock Concurrency (No I/O Inside Mutex)**:
   - In `python-service/src/core/spoofer.py`, **NEVER** place packet sending loops (`sendp`) or delays (`time.sleep`) inside `with self._lock:`.
   - State mutation (dict delete/insert) occurs INSIDE lock; network packet transmission occurs OUTSIDE lock.
4. **RFC 1918 Scope Strictness**:
   - All network probing and scanning must strictly validate that destination IPs belong to RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
   - Boundary addresses like `0.0.0.0` or `255.255.255.255` must evaluate to `False` in `is_valid_private_ip()`.
5. **API & Event Contract Backward Compatibility**:
   - Never alter or rename REST endpoint paths or WebSocket event payload keys without updating all 3 layers.
6. **Input Validation Before OS/Packet Ops (P1)**:
   - Validate **both** victim AND gateway params (`is_valid_private_ip`, `is_valid_mac`) before building packets or shell commands.
   - **NEVER** use `subprocess(..., shell=True)` with interpolated IP/MAC/interface values. Use argument-list (`shell=False`). Applies to `spoofer.py` and `shield.py`.
7. **Control-Plane Guards (P1)**:
   - Origin/Host checks in `backend-node/src/security.ts` must be **exact-match** (parse URL / exact set), never `startsWith` prefix.
   - When `SENTINEL_API_TOKEN` is set, all `/api/*` (except `/health`, `/api/health`) require header `x-sentinel-token` on both Node & Python; keep this guard intact when adding routes.

---

## 3. Automated Test Verification

Always run the automated test suites before finishing any task (semua hijau saat audit 2026-08-31: **145 Python + 27 Node**):

```powershell
# 1. Run Python Service Unit & API Tests (~145 tests)
cd d:/spoorf/python-service
.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v

# 2. Run Node.js Backend Tests (27 tests, termasuk unit_security)
cd d:/spoorf/backend-node
npm test
```

---

## 4. Architecture Directory Map

```text
d:/spoorf/
├── AGENTS.md                  # This file: Agent operational guide
├── CHANGELOG.md               # Version history and major refactoring decisions
├── SECURITY.md                # Security policy, threat model & reporting
├── docs/                      # Technical specifications & runbooks
│   ├── SPECIFICATION.md       # Master Technical Specification
│   ├── SECURITY_AUDIT.md      # Full defensive audit report (findings + status)
│   ├── TROUBLESHOOTING.md     # Error diagnosis & zombie process cleanup
│   ├── EVENT_TAXONOMY.md      # WebSocket & Socket.IO event dictionary
│   └── specs/                 # Detailed modular specs (SPEC-001 to SPEC-012)
├── python-service/            # Low-level network microservice (:8001)
│   ├── src/
│   │   ├── core/
│   │   │   ├── network.py     # Physical adapter, Wi-Fi info, IP forwarding
│   │   │   ├── telemetry.py   # Throughput (Mbps) & ping latency sampler
│   │   │   ├── spoofer.py     # Thread-safe ARP Spoofer & PWM Throttling
│   │   │   ├── scanner.py     # High-level scan orchestrator (< 170 lines)
│   │   │   ├── discovery/     # L2/L3 discovery (arp.py, multicast.py, dhcp.py)
│   │   │   └── fingerprint/   # vendors.py, netbios.py, probe.py, os_detect.py
│   │   └── server.py          # FastAPI routes & WebSocket event manager
│   └── tests/                 # 40 automated unittest files
├── backend-node/              # Express API & Socket.IO Orchestrator (:5000)
│   ├── src/
│   │   ├── services/          # database.ts, deviceManager.ts, pythonBridge.ts
│   │   └── api/routes.ts      # REST API route handlers
│   └── tests/                 # 13 automated test suites (npm test)
└── frontend-react/            # React 18 + Vite SPA (:5173)
    └── src/
        ├── components/motion/ # BeUI Segment Tabs & Action Tooltip
        ├── components/        # DeviceTable, NetworkLiveChart, Sidebar
        └── App.tsx            # Root application state & WebSocket listeners
```

---

## 5. Common Pitfalls & Agent Gotchas

- **Windows Console Unicode**: Do not print non-ASCII emojis (`🎉`, `🚀`) directly to the Windows terminal in scripts unless UTF-8 output mode is explicitly configured, or you will trigger `UnicodeEncodeError: 'charmap'`.
- **Npcap Driver Requirement**: Scapy requires the Npcap driver to inject Layer 2 raw Ethernet frames on Windows. If Scapy complains about interfaces, check `ifaces` in `src.core.spoofer`.
- **Background Processes**: Do not leave unmanaged child processes running. Always cleanly terminate connections or test clients.
