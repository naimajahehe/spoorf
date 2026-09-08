# Technical Design: Per-Network Scoped Isolation & Clean Slate Database

- **Author:** Google Antigravity & Sentinel Team
- **Date:** 2026-09-08
- **Status:** Proposed (Ready for User Review)
- **Governing Invariants:** `AGENTS.md` (Gateway Immunity, Controller Self-Protection, Lock Concurrency, RFC 1918 Scope)

---

## 1. Background & Problem Statement

In the existing architecture of NetCut Sentinel (Spoorf), the SQLite database stores all discovered devices in a single global flat table where `mac TEXT PRIMARY KEY`. 

A forensic audit of `data/sentinel.db` revealed that **300 devices from 3 completely distinct network subnets** were co-mingled in the active database:
- `10.27.2.0/24`: 220 devices (68 devices flagged `is_blocked = 1` from a previous office/campus network).
- `192.168.1.0/24`: 61 devices (Current home Wi-Fi network: `YOTTA TALASALAPANG_5G`).
- `192.168.110.0/24`: 19 devices (From an earlier network).

### Consequences of Global Flat Architecture:
1. **UI Pollution**: When connected to home Wi-Fi (`192.168.1.0/24`), the UI displays 220 irrelevant offline hosts from the office network under "All Hosts".
2. **Block State Leakage**: 68 devices blocked at the office remain marked `is_blocked = 1` in the database. If any device matching that profile appears on the home network, auto-reblock could erroneously cut it.
3. **Memory & Bandwidth Waste**: Node.js maintains 300 device objects in memory and broadcasts large WebSocket payloads (~150 KB) instead of only tracking the active network's ~60 hosts (~30 KB).

---

## 2. Core Decisions & Philosophy (The 80% Lean Path)

Per user directive, we adopt the **80% Lean Path** with a **Clean Slate Database Reset**:
- **No Legacy Baggage**: All existing stale rows in `data/sentinel.db` are wiped clean. No complex legacy data migration is needed. The new schema starts fresh, pristine, and mathematically consistent.
- **No Over-Engineering**: We deliberately exclude complex multi-network history drawers, cross-network remote unblockers, and heavy UI controls. Spoorf focuses 100% on providing razor-sharp control and monitoring for the **currently connected active network**.
- **100% Operational Safety**: Every potential side-effect (kernel ARP pollution in Sentinel Shield, in-flight scan race conditions, gaming mode session leaks) is strictly guarded and mitigated.

---

## 3. Detailed Architecture & Component Design

### 3.1 Network Identity Resolver (`network_id`)

The system determines the active network identity at Layer 2:

```text
┌────────────────────────────────────────────────────────┐
│               ACTIVE NETWORK DETERMINATION             │
├────────────────────────────────────────────────────────┤
│ 1. Standard Wi-Fi / LAN Router:                        │
│    network_id = "net_" + gateway_mac_clean             │
│    e.g., Gateway MAC 1c:60:d2:6a:9a:48 ->              │
│    network_id = "net_1c60d26a9a48"                     │
│                                                        │
│ 2. Mobile Hotspot / Tethering:                         │
│    network_id = "net_tether_" + sanitize(ssid)         │
│    e.g., iPhone Hotspot -> "net_tether_iphone"         │
│                                                        │
│ 3. Disconnected / Resolving Gateway:                   │
│    network_id = "net_disconnected"                    │
└────────────────────────────────────────────────────────┘
```

#### Why Gateway LAN MAC is the Authoritative Anchor:
- **Dual-Band Roaming Immunity**: Home routers with 2.4 GHz (`MyWiFi`) and 5 GHz (`MyWiFi_5G`) broadcast different BSSIDs, but both radios bridge into the same router LAN switch with an identical Gateway LAN MAC (`1c:60:d2:6a:9a:48`). As the operator's laptop roams between 2.4 GHz and 5 GHz, `network_id` remains constant. No false network-hopping glitches occur.
- **SSID Collision Immunity**: Two cafes with the SSID `"Starbucks"` have completely different router hardware MACs. They are guaranteed to be isolated into different `network_id` partitions.

---

### 3.2 Clean Slate Database Schema (SQLite 3 WAL)

The database schema is initialized cleanly in `backend-node/src/services/database.ts`:

```sql
-- 1. Table: networks (Records all networks joined by the controller)
CREATE TABLE IF NOT EXISTS networks (
    id TEXT PRIMARY KEY,                 -- 'net_' + gateway_mac_clean
    ssid TEXT NOT NULL,                  -- Wi-Fi SSID or Interface Name
    gateway_ip TEXT NOT NULL,            -- Router IPv4 address
    gateway_mac TEXT NOT NULL,           -- Router LAN MAC address
    subnet TEXT,                         -- e.g. '192.168.1.0/24'
    interface_type TEXT DEFAULT 'wifi',  -- 'wifi' | 'ethernet' | 'tethering'
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    last_connected_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_networks_last_connected ON networks(last_connected_at DESC);

-- 2. Table: device_profiles (Physical Hardware Identity - Pure & Global)
-- NOTE: is_blocked and speed_limit are intentionally REMOVED to prevent cross-network block leakage.
CREATE TABLE IF NOT EXISTS device_profiles (
    id TEXT PRIMARY KEY,                 -- 'prof_' + clean_mac
    alias TEXT NOT NULL,                 -- User-defined friendly name
    hostname TEXT,                       -- Learned hostname
    os TEXT,                             -- Detected operating system
    vendor TEXT,                         -- OUI Vendor
    device_type TEXT,                    -- Phone, Laptop, IoT, etc.
    dhcp_fingerprint TEXT,               -- DHCP Option 55 PRL
    dhcp_vendor_class TEXT,              -- DHCP Option 60
    dhcp_client_id TEXT,                 -- DHCP Option 61 (DUID)
    linked_macs TEXT DEFAULT '[]',       -- Array of MACs rotated by this device
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 3. Table: devices (Scoped strictly to network_id)
CREATE TABLE IF NOT EXISTS devices (
    network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
    mac TEXT NOT NULL,
    ip TEXT NOT NULL,
    last_ip TEXT,
    hostname TEXT,
    vendor TEXT,
    os TEXT,
    device_type TEXT DEFAULT 'Unknown',
    web_title TEXT,
    web_server TEXT,
    workgroup TEXT,
    user_name TEXT,
    open_ports TEXT DEFAULT '[]',
    services TEXT DEFAULT '[]',
    is_blocked INTEGER DEFAULT 0,        -- SCOPED TO THIS NETWORK ONLY
    is_online INTEGER DEFAULT 1,         -- SCOPED TO THIS NETWORK ONLY
    is_gateway INTEGER DEFAULT 0,        -- SCOPED TO THIS NETWORK ONLY
    is_self INTEGER DEFAULT 0,           -- Operator Controller (Anti-Self-Cut)
    rtt_ms REAL DEFAULT 0,
    ttl INTEGER,
    is_randomized_mac INTEGER DEFAULT 0,
    mac_type TEXT,
    alias TEXT,
    profile_id TEXT REFERENCES device_profiles(id),
    matched_by TEXT,
    session_id TEXT,                     -- Active ARP spoof session ID
    speed_limit INTEGER DEFAULT 100,     -- SCOPED TO THIS NETWORK ONLY
    dhcp_vendor_class TEXT,
    dhcp_fingerprint TEXT,
    dhcp_client_id TEXT,
    dhcp_fqdn TEXT,
    match_score INTEGER,
    candidate_profile_id TEXT,
    is_archived INTEGER DEFAULT 0,
    distance_zone TEXT DEFAULT 'unknown',
    estimated_range TEXT DEFAULT '-',
    ipv6_link_local TEXT,
    ipv6_global TEXT,
    ipv6_addresses TEXT DEFAULT '[]',
    is_dual_stack INTEGER DEFAULT 0,
    profile_status TEXT DEFAULT 'unknown',
    vendor_confidence INTEGER DEFAULT 0,
    type_confidence INTEGER DEFAULT 0,
    hostname_confidence INTEGER DEFAULT 0,
    profile_evidence TEXT DEFAULT '[]',
    profiled_at TEXT,
    profile_version INTEGER DEFAULT 1,
    first_seen TEXT DEFAULT (datetime('now', 'localtime')),
    last_seen TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (network_id, mac)
);

CREATE INDEX IF NOT EXISTS idx_devices_net_id ON devices(network_id);
CREATE INDEX IF NOT EXISTS idx_devices_net_online ON devices(network_id, is_online);
CREATE INDEX IF NOT EXISTS idx_devices_net_blocked ON devices(network_id, is_blocked);
CREATE INDEX IF NOT EXISTS idx_devices_profile_id ON devices(profile_id);

-- 4. Table: license_cache (Preserved)
CREATE TABLE IF NOT EXISTS license_cache (
    id TEXT PRIMARY KEY DEFAULT 'current_license',
    user_id TEXT,
    email TEXT,
    name TEXT,
    avatar_url TEXT,
    tier TEXT NOT NULL DEFAULT 'free',
    token TEXT NOT NULL,
    max_cuts INTEGER NOT NULL DEFAULT 1,
    can_throttle INTEGER NOT NULL DEFAULT 0,
    can_gateway INTEGER NOT NULL DEFAULT 0,
    can_autoreblock INTEGER NOT NULL DEFAULT 0,
    can_arsenal INTEGER NOT NULL DEFAULT 0,
    cloud_sync INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    grace_period_until TEXT,
    hwid TEXT,
    last_synced_at TEXT DEFAULT (datetime('now', 'localtime'))
);
```

---

### 3.3 Backend Orchestrator (`DeviceManager`) Operations

#### A. Scoped State in Memory
In `backend-node/src/services/deviceManager.ts`:
- `private currentNetworkId: string = 'net_disconnected';`
- `private currentNetworkInfo: any = null;`
- `private scanGeneration: number = 0;`
- `this.devices` Map contains **ONLY** the devices belonging to `currentNetworkId`.
- `getDevices()` returns only devices of `currentNetworkId`.

#### B. Network Transition Event Handling (`networkChanged`)
When Python broadcasts `network_changed` or when Node detects a new Gateway MAC:
1. **Invalidate In-Flight Scans**: Increment `this.scanGeneration++`. Any scan promise from the previous network that finishes late is discarded immediately.
2. **Clear In-Memory Map**: `this.devices.clear()`.
3. **Reset Gaming Mode**: `this.gamingManaged.clear()`, `this.gamingActive = false`.
4. **Resolve New Network Identity**:
   - Query Gateway IP + MAC from Python scanner or system routing table.
   - Upsert row into `networks` table.
   - Set `this.currentNetworkId = newNetworkId`.
5. **Hydrate Scoped Devices**: Load persistent devices from SQLite:
   `SELECT * FROM devices WHERE network_id = ? AND is_archived = 0`.
6. **Emit UI Event**: Broadcast `networkChanged` and `devicesUpdated` to all connected frontend clients.
7. **Trigger Fresh Scan**: Invoke `this.scanNetwork()` to discover live hosts on the new network.

#### C. Cross-Network Block Isolation Logic
- When a user blocks a device on Network A:
  `db.setDeviceBlocked(mac, true, networkId, sessionId)`.
  The block is persisted strictly with `network_id = 'net_A'`.
- When the same physical device (e.g. "Hanif's Phone") connects to Network B:
  In `syncScanResults`:
  The device is matched to `bestProfile` ("Hanif's Phone") for identity and alias purposes.
  However, it checks whether the device was blocked **on Network B**:
  ```typescript
  const wasBlockedInThisNetwork = existingDevices.some(
      d => d.network_id === this.currentNetworkId && d.profile_id === bestProfile.id && d.is_blocked
  );
  isBlocked = wasBlockedInThisNetwork; // False on Network B!
  ```
  Result: On Network B, the device is unblocked and permitted full network access.

---

### 3.4 Operational Teardown Guards (Safety Invariants)

#### A. Sentinel Shield Kernel Neighbor Unlock
- **Risk**: On Windows, Sentinel Shield locks the gateway MAC via `netsh interface ipv4 add neighbors ...`. If the user moves to a new router with the same IP (`192.168.1.1`) but a different MAC, the static ARP entry locks traffic to the dead MAC, causing total loss of internet access.
- **Guard**: In `python-service/src/server.py` (`network_watchdog_thread`):
  When `is_network_changed` is detected, invoke `shield_engine.disable()` immediately. This calls `_unlock_kernel_neighbor()` to delete the static neighbor entry before binding to the new network.

#### B. Immediate Spoofer Teardown
- In `python-service/src/server.py`:
  `spoofer.stop_all()`, `transparent_gateway.stop_all()`, and `redirect_manager.stop_all()` execute synchronously upon network change detection. No poisoned packets are transmitted into the new network interface.

#### C. Controller & Gateway Immunity Enforcement (`AGENTS.md`)
- `is_gateway: true` is strictly evaluated per-network. The gateway of the active network cannot be blocked or throttled under any circumstances.
- `is_self: true` is strictly evaluated per-network. The operator's machine is automatically assigned `is_self = 1` and immunity-protected.

---

### 3.5 Frontend UI Integration (React)

#### A. Compact Network Info Badge in Header
In `frontend-react/src/App.tsx`:
Add an informative, compact badge in the top bar / navbar next to connection status:
```tsx
<div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs">
    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
    <span className="font-semibold text-white">{wifiInfo.ssid || 'Ethernet LAN'}</span>
    <span className="text-zinc-400">•</span>
    <span className="font-mono text-zinc-400">{gateway?.ip || '192.168.1.1'}</span>
</div>
```
Hovering reveals gateway MAC and subnet in a tooltip.

#### B. Automatic Filter Cleanliness
Because the backend `devices` stream emits only records where `network_id === currentNetworkId`:
- **"All Hosts" Tab**: Automatically displays only the hosts present on the active network (e.g. 61 hosts instead of 300).
- **"Online" Tab**: Displays online hosts on this network.
- **"Blocked" Tab**: Displays only devices actively or previously blocked on this specific network.
- **"Offline" Tab**: Displays hosts that have been seen on this specific network in the past.

---

## 4. Verification Plan

### 4.1 Automated Test Suites (Maintain 100% Passing)
1. **Node.js Test Suites (`npm test`)**:
   - Update `unit_database.test.ts` to test:
     - Table schema initialization with `PRIMARY KEY (network_id, mac)`.
     - Device insertion and query scoped by `network_id`.
     - Cross-network isolation: Inserting device `M1` on `net_A` as blocked does not affect `M1` on `net_B`.
     - `syncScanResults` scoped to active network ID.
   - Update `unit_deviceManager.test.ts` to test:
     - Initialization and network identity resolution.
     - State reset on `networkChanged` event.
     - Auto-reblock strictly within the active network.
2. **Python Test Suites (`unittest discover`)**:
   - Run 162 unit tests across `python-service/tests`. Verify spoofer teardown, network watchdog, and shield kernel unlock.

### 4.2 Manual / End-to-End Verification
1. Boot all three services (Python `:8001`, Node `:5000`, Frontend `:5173`).
2. Verify that `sentinel.db` initializes with the clean schema.
3. Run scan on `YOTTA TALASALAPANG_5G`: verify that only hosts on `192.168.1.0/24` are displayed.
4. Block a target device on the current network. Verify `is_blocked = 1` is recorded with the active `network_id`.
5. Verify header badge displays active SSID, gateway IP, and subnet cleanly.

---

## 5. Risk Assessment & Mitigations

| Identified Risk | Severity | Mitigation Strategy |
| :--- | :---: | :--- |
| Gateway MAC temporarily unresolved at startup | Low | Fallback to `net_pending_<ssid>` until first ARP packet resolves gateway MAC, then atomically re-key. |
| User roams between 2.4 GHz and 5 GHz on dual-band router | Medium | Gateway LAN MAC is identical across both bands; network ID remains stable without triggering a false network switch. |
| Windows kernel static ARP neighbor locks new gateway | High | Force `shield_engine.disable()` / `_unlock_kernel_neighbor()` immediately when `network_changed` is detected. |
| In-flight scan from old network returns after switch | Medium | Guard with `scanGeneration` version token. Discard results if version does not match active generation. |
