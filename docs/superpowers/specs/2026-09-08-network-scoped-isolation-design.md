# Technical Design: Per-Network Scoped Isolation & Identity-Preserving Migration

- **Author:** Google Antigravity & Sentinel Team
- **Date:** 2026-09-08
- **Status:** Approved Architecture (Post-Review Revision)
- **Governing Invariants:** `AGENTS.md` (Gateway Immunity, Controller Self-Protection, Lock Concurrency, RFC 1918 Scope)

---

## 1. Problem Statement & Codebase Context

In NetCut Sentinel (Spoorf), `devices` historically stored all records under a global flat key (`mac TEXT PRIMARY KEY`). Live inspection of `data/sentinel.db` confirms:
- **300 devices co-mingled across 3 subnets**: `10.27.2.0/24` (220 hosts, 68 blocked), `192.168.1.0/24` (61 hosts, active home network), and `192.168.110.0/24` (19 hosts).
- **98 active profiles in `device_profiles`**: Personal aliases (`A15-milik-Indry-Nurutami`, `NurunnisMacbook`, `Tab-A-8-0-2019-milik-Gina`, `A55-milik-Hanif`, etc.) along with hardware DUIDs and Option 55 PRL fingerprints.

### Architectural Flaws Addressed:
1. **Host Contamination**: Connecting to home Wi-Fi displays 220 offline devices from past networks under "All Hosts".
2. **Block State Leakage**: Devices marked `is_blocked = 1` in one network carry that flag globally. Furthermore, `device_profiles.is_blocked` caused cross-network auto-reblock misfires.
3. **Subnet Cross-Invalidation**: Scanning in Network B marks Network A devices as offline and resets gateway flags across networks.

---

## 2. Core Architectural Decisions

### 2.1 Universal Network Anchor: Gateway LAN MAC
All connection types (Wi-Fi, Ethernet, and Mobile Hotspot/Tethering) use **Gateway LAN MAC** as the authoritative identity key:
```text
network_id = "net_" + gateway_mac.toLowerCase().replace(/[^0-9a-f]/g, '')
```
- **Wi-Fi Dual-Band Roaming**: 2.4 GHz and 5 GHz radios share the router's LAN Gateway MAC (`1c:60:d2:6a:9a:48`). Roaming does not trigger false network hops.
- **SSID Collision Protection**: Two different venues with SSID `"Starbucks"` possess distinct hardware MACs, guaranteeing isolation.
- **Tethering Consistency**: Mobile hotspots provide a gateway interface with a hardware MAC. Using Gateway MAC for tethering prevents collisions between two hotspots sharing the name `"iPhone"`.
- **Ethernet / Wired**: Uses the router's Ethernet switch gateway MAC. The `ssid` column stores the network adapter name (e.g., `'Ethernet (LAN)'`).
- **Transient Fallback**: If gateway MAC is resolving during the initial 1-2 seconds, use `net_pending_<subnet>` until ARP resolves, then atomically map to `net_<gateway_mac>`.

### 2.2 Preservation of `device_profiles` + Lightweight Migration
A "clean slate wipe" is rejected because it destroys learned user aliases, DUIDs, and fingerprint signatures.
- **`device_profiles` is preserved**: Physical identity is global. The columns `is_blocked` and `speed_limit` are removed/deprecated from `device_profiles` so that block state never leaks across networks.
- **Lightweight Subnet Partition Migration**: Existing 300 devices in `data/sentinel.db` are partitioned by subnet into their respective `network_id`:
  - Subnet `192.168.1.0/24` -> `net_1c60d26a9a48` (active gateway MAC `1c:60:d2:6a:9a:48`).
  - Subnet `10.27.2.0/24` -> `net_legacy_10_27_2` (recorded past network).
  - Subnet `192.168.110.0/24` -> `net_legacy_192_168_110` (recorded past network).
  - Corresponding rows are inserted into the `networks` table.

### 2.3 Layering: Plan A (Identity Resolution) vs Network Scoping
- **Plan A (Identity Resolution)** determines **WHO** the device is (resolving randomized MACs to `profile_id` via DUID/PRL/hostname).
- **Network Scoping** determines **WHERE** the device is and whether it is blocked in this specific network scope.
- Cross-network auto-reblock checks:
  ```sql
  SELECT 1 FROM devices
  WHERE network_id = :currentNetworkId
    AND profile_id = :matchedProfileId
    AND is_blocked = 1
  LIMIT 1
  ```
  A device blocked on Network A is unblocked on Network B unless explicitly blocked on Network B.

---

## 3. Database Schema Specification (SQLite 3 WAL)

```sql
-- 1. Table: networks
CREATE TABLE IF NOT EXISTS networks (
    id TEXT PRIMARY KEY,                 -- 'net_' + gateway_mac_clean
    ssid TEXT NOT NULL,                  -- Wi-Fi SSID or adapter name for Ethernet
    gateway_ip TEXT NOT NULL,            -- Default IPv4 Gateway
    gateway_mac TEXT NOT NULL,           -- Gateway LAN hardware MAC
    subnet TEXT NOT NULL,                -- Subnet CIDR (e.g., '192.168.1.0/24')
    interface_type TEXT DEFAULT 'wifi',  -- 'wifi' | 'ethernet' | 'tethering'
    first_connected_at TEXT DEFAULT (datetime('now', 'localtime')),
    last_connected_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_networks_last_connected ON networks(last_connected_at DESC);

-- 2. Table: device_profiles (Hardware identity only - no block state)
CREATE TABLE IF NOT EXISTS device_profiles (
    id TEXT PRIMARY KEY,                 -- 'prof_' + clean_mac
    alias TEXT NOT NULL,                 -- Friendly user alias
    hostname TEXT,                       -- Learned hostname
    os TEXT,                             -- Detected operating system
    vendor TEXT,                         -- OUI Vendor
    device_type TEXT,                    -- Phone, Laptop, IoT, etc.
    dhcp_fingerprint TEXT,               -- Option 55 PRL signature
    dhcp_vendor_class TEXT,              -- Option 60
    dhcp_client_id TEXT,                 -- Option 61 (DUID)
    linked_macs TEXT DEFAULT '[]',       -- Associated MAC addresses
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 3. Table: devices (Scoped strictly by network_id)
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
    is_blocked INTEGER DEFAULT 0,        -- LOCAL TO THIS NETWORK
    is_online INTEGER DEFAULT 1,         -- LOCAL TO THIS NETWORK
    is_gateway INTEGER DEFAULT 0,        -- LOCAL TO THIS NETWORK
    is_self INTEGER DEFAULT 0,           -- Controller host (Anti-Self-Cut)
    rtt_ms REAL DEFAULT 0,
    ttl INTEGER,
    is_randomized_mac INTEGER DEFAULT 0,
    mac_type TEXT,
    alias TEXT,
    profile_id TEXT REFERENCES device_profiles(id),
    matched_by TEXT,
    session_id TEXT,                     -- Active ARP spoof session
    speed_limit INTEGER DEFAULT 100,     -- LOCAL TO THIS NETWORK
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
```

---

## 4. Orchestrator & Engine Implementation Plan

### 4.1 High-Risk Core: `syncScanResults` Architecture
`syncScanResults` in `backend-node/src/services/database.ts` is the most delicate path in the backend. Its implementation requires strict isolation scoping:
1. **Scoped Querying**: `getDevicesForReconciliation(networkId)` queries only devices matching `network_id = :networkId`. Devices on other networks are never loaded into reconciliation.
2. **Scoped Gateway Reset**: `resetGatewayStmt` updates `is_gateway = 0 WHERE network_id = :networkId AND LOWER(mac) != LOWER(?)`. Gateway flags on other networks remain completely untouched.
3. **Scoped Offline Marking**: `setOfflineStmt` only sets `is_online = 0` for devices where `network_id = :networkId`. Missing devices on the active network are marked offline without affecting other networks.
4. **Scoped Re-Block Check**: When a scanned device matches `bestProfile`, `isBlocked` is determined by checking whether that profile has an active block **on this specific network**:
   ```typescript
   const wasBlockedInThisNetwork = existingDevices.some(
       d => d.network_id === networkId && d.profile_id === bestProfile.id && d.is_blocked
   );
   isBlocked = wasBlockedInThisNetwork;
   ```

### 4.2 Network Transition Lifecycle (`networkChanged`)
1. **Python Teardown**:
   - `spoofer.stop_all()`, `transparent_gateway.stop_all()`, `redirect_manager.stop_all()`.
   - **Sentinel Shield Kernel Unlock**: Execute `shield_engine.disable()` / `_unlock_kernel_neighbor()` to delete static ARP entries on Windows before binding to the new network.
   - `liveness_daemon.update_tracked_devices([])` and `dhcp_cache.clear()`.
2. **Node.js Orchestrator**:
   - Invalidate in-flight scan promises via `scanGeneration++`.
   - Clear `this.devices` memory map.
   - Clear `this.gamingManaged` and reset gaming mode state.
   - Resolve new `network_id` and ensure row exists in `networks`.
   - Load `this.devices` from SQLite `WHERE network_id = :newNetworkId`.
   - Broadcast `networkChanged` and `devicesUpdated` to frontend.
   - Trigger initial scan on the new network.

### 4.3 Frontend UI Integration
- Compact active network badge in header (SSID, Gateway IP, Subnet).
- `DeviceTable` automatically receives filtered device lists scoped to the active network.

---

## 5. Verification & Testing Strategy

1. **Test Suite Grounding**:
   - Run full Python test suite: **328 tests** passing via unittest/pytest runner.
   - Run Node.js test suite: **34 tests** currently passing.
2. **Dedicated TDD Test Cases for Scoped Isolation**:
   - **TDD-1: Subnet Migration Integrity**: Verify that existing 300 rows are partitioned into 3 networks without loss of profile aliases or fingerprints.
   - **TDD-2: Cross-Network Block Isolation**: Device `M1` blocked on `net_A` must register `is_blocked = 0` when scanned on `net_B`.
   - **TDD-3: Cross-Network Gateway Immunity**: Resetting gateway on `net_B` does not alter gateway flags on `net_A`.
   - **TDD-4: Profile Fusion Across Networks**: Learned alias and vendor for `M1` on `net_A` is recognized on `net_B`, but block state remains localized.
   - **TDD-5: Shield Neighbor Cleanup on Network Change**: Verifies kernel neighbor entry is unlocked when `network_changed` fires.
