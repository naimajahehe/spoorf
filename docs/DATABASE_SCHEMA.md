# NetCut Sentinel (Spoorf) - Database Schema Specification

Sistem menggunakan **SQLite (`better-sqlite3`)** dengan mode **WAL (Write-Ahead Logging)** untuk menjamin persistensi data target, riwayat perangkat, status pemblokiran permanen, dan fungsi **Auto-Reblock** secara mandiri (*zero-configuration*) tanpa memerlukan instalasi service database eksternal. File database disimpan di `data/sentinel.db`.

---

## 1. Definisi Tabel `devices`

```sql
CREATE TABLE IF NOT EXISTS devices (
    mac TEXT PRIMARY KEY,
    ip TEXT NOT NULL,
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
    is_blocked INTEGER DEFAULT 0,
    is_online INTEGER DEFAULT 1,
    is_gateway INTEGER DEFAULT 0,
    is_self INTEGER DEFAULT 0,
    rtt_ms REAL DEFAULT 0,
    ttl INTEGER,
    is_randomized_mac INTEGER DEFAULT 0,
    mac_type TEXT,
    alias TEXT,
    profile_id TEXT,
    matched_by TEXT,
    session_id TEXT,
    speed_limit INTEGER DEFAULT 100,
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
    first_seen TEXT DEFAULT (datetime('now', 'localtime')),
    last_seen TEXT DEFAULT (datetime('now', 'localtime')),
    last_ip TEXT,
    profile_status TEXT DEFAULT 'unknown',
    vendor_confidence INTEGER DEFAULT 0,
    type_confidence INTEGER DEFAULT 0,
    hostname_confidence INTEGER DEFAULT 0,
    profile_evidence TEXT DEFAULT '[]',
    profiled_at TEXT,
    profile_version INTEGER DEFAULT 1
);
```

---

## 2. Definisi Tabel `device_profiles`

```sql
CREATE TABLE IF NOT EXISTS device_profiles (
    id TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    hostname TEXT,
    os TEXT,
    vendor TEXT,
    device_type TEXT,
    is_blocked INTEGER DEFAULT 0,
    speed_limit INTEGER DEFAULT 100,
    dhcp_fingerprint TEXT,
    dhcp_vendor_class TEXT,
    dhcp_client_id TEXT,
    linked_macs TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);
```

---

## 3. Definisi Tabel `license_cache`

```sql
CREATE TABLE IF NOT EXISTS license_cache (
    id TEXT PRIMARY KEY DEFAULT 'current_license',
    user_id TEXT,
    email TEXT,
    name TEXT,
    avatar_url TEXT,
    tier TEXT NOT NULL DEFAULT 'free',
    token TEXT NOT NULL,
    max_cuts INTEGER NOT NULL DEFAULT 5,
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

## 4. Indeks Performa

```sql
CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
CREATE INDEX IF NOT EXISTS idx_devices_is_blocked ON devices(is_blocked);
CREATE INDEX IF NOT EXISTS idx_devices_is_online ON devices(is_online);
CREATE INDEX IF NOT EXISTS idx_devices_is_archived ON devices(is_archived);
CREATE INDEX IF NOT EXISTS idx_devices_profile_id ON devices(profile_id);
```

---

## 5. Pola Kueri Kritis: UPSERT & Offline Lifecycle

### 5.1 Kueri Penyinkronan Scan (*UPSERT Atomik SQLite*):
```sql
INSERT INTO devices (
    mac, ip, hostname, vendor, os, device_type,
    web_title, web_server, workgroup, user_name,
    open_ports, services, is_blocked, is_online, is_gateway,
    rtt_ms, session_id, is_self, ttl, is_randomized_mac, mac_type, alias, profile_id, matched_by, speed_limit,
    dhcp_vendor_class, dhcp_fingerprint, dhcp_client_id, dhcp_fqdn, match_score, candidate_profile_id, first_seen, last_seen,
    distance_zone, estimated_range,
    ipv6_link_local, ipv6_global, ipv6_addresses, is_dual_stack,
    profile_status, vendor_confidence, type_confidence, hostname_confidence, profile_evidence, profiled_at, profile_version
) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, 1, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', 'localtime')), datetime('now', 'localtime'),
    ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?
)
ON CONFLICT (mac) DO UPDATE SET
    last_ip = CASE WHEN devices.ip != '' AND devices.ip IS NOT NULL THEN devices.ip ELSE devices.last_ip END,
    ip = excluded.ip,
    hostname = CASE WHEN excluded.hostname IS NOT NULL AND excluded.hostname != '' THEN excluded.hostname ELSE devices.hostname END,
    vendor = CASE WHEN excluded.vendor IS NOT NULL AND excluded.vendor != '' THEN excluded.vendor ELSE devices.vendor END,
    os = CASE WHEN excluded.os IS NOT NULL AND excluded.os != '' THEN excluded.os ELSE devices.os END,
    device_type = CASE WHEN excluded.device_type IS NOT NULL AND excluded.device_type != '' THEN excluded.device_type ELSE devices.device_type END,
    web_title = CASE WHEN excluded.web_title IS NOT NULL AND excluded.web_title != '' THEN excluded.web_title ELSE devices.web_title END,
    web_server = CASE WHEN excluded.web_server IS NOT NULL AND excluded.web_server != '' THEN excluded.web_server ELSE devices.web_server END,
    workgroup = CASE WHEN excluded.workgroup IS NOT NULL AND excluded.workgroup != '' THEN excluded.workgroup ELSE devices.workgroup END,
    user_name = CASE WHEN excluded.user_name IS NOT NULL AND excluded.user_name != '' THEN excluded.user_name ELSE devices.user_name END,
    open_ports = CASE WHEN excluded.open_ports IS NOT NULL AND excluded.open_ports != '[]' THEN excluded.open_ports ELSE devices.open_ports END,
    services = CASE WHEN excluded.services IS NOT NULL AND excluded.services != '[]' THEN excluded.services ELSE devices.services END,
    is_online = 1,
    is_gateway = excluded.is_gateway,
    rtt_ms = excluded.rtt_ms,
    is_self = excluded.is_self,
    ttl = excluded.ttl,
    is_randomized_mac = excluded.is_randomized_mac,
    mac_type = excluded.mac_type,
    alias = CASE WHEN excluded.alias IS NOT NULL AND excluded.alias != '' THEN excluded.alias ELSE devices.alias END,
    profile_id = CASE WHEN excluded.profile_id IS NOT NULL AND excluded.profile_id != '' THEN excluded.profile_id ELSE devices.profile_id END,
    matched_by = excluded.matched_by,
    speed_limit = devices.speed_limit,
    dhcp_vendor_class = CASE WHEN excluded.dhcp_vendor_class IS NOT NULL AND excluded.dhcp_vendor_class != '' THEN excluded.dhcp_vendor_class ELSE devices.dhcp_vendor_class END,
    dhcp_fingerprint = CASE WHEN excluded.dhcp_fingerprint IS NOT NULL AND excluded.dhcp_fingerprint != '' THEN excluded.dhcp_fingerprint ELSE devices.dhcp_fingerprint END,
    dhcp_client_id = CASE WHEN excluded.dhcp_client_id IS NOT NULL AND excluded.dhcp_client_id != '' THEN excluded.dhcp_client_id ELSE devices.dhcp_client_id END,
    dhcp_fqdn = CASE WHEN excluded.dhcp_fqdn IS NOT NULL AND excluded.dhcp_fqdn != '' THEN excluded.dhcp_fqdn ELSE devices.dhcp_fqdn END,
    match_score = excluded.match_score,
    candidate_profile_id = excluded.candidate_profile_id,
    is_archived = 0,
    last_seen = datetime('now', 'localtime'),
    distance_zone = excluded.distance_zone,
    estimated_range = excluded.estimated_range,
    ipv6_link_local = CASE WHEN excluded.ipv6_link_local IS NOT NULL AND excluded.ipv6_link_local != '' THEN excluded.ipv6_link_local ELSE devices.ipv6_link_local END,
    ipv6_global = CASE WHEN excluded.ipv6_global IS NOT NULL AND excluded.ipv6_global != '' THEN excluded.ipv6_global ELSE devices.ipv6_global END,
    ipv6_addresses = CASE WHEN excluded.ipv6_addresses IS NOT NULL AND excluded.ipv6_addresses != '[]' THEN excluded.ipv6_addresses ELSE devices.ipv6_addresses END,
    is_dual_stack = excluded.is_dual_stack,
    profile_status = CASE WHEN excluded.profile_status IS NOT NULL AND excluded.profile_status != '' THEN excluded.profile_status ELSE devices.profile_status END,
    vendor_confidence = excluded.vendor_confidence,
    type_confidence = excluded.type_confidence,
    hostname_confidence = excluded.hostname_confidence,
    profile_evidence = CASE WHEN excluded.profile_evidence IS NOT NULL AND excluded.profile_evidence != '[]' THEN excluded.profile_evidence ELSE devices.profile_evidence END,
    profiled_at = CASE WHEN excluded.profiled_at IS NOT NULL AND excluded.profiled_at != '' THEN excluded.profiled_at ELSE devices.profiled_at END,
    profile_version = excluded.profile_version;
```

### 5.2 Kueri Transisi Offline (*Anti-Ghosting IP Churn*):
```sql
-- Perangkat yang hilang dari scan melebihi batas toleransi (OFFLINE_GRACE_SECONDS = 75s)
-- ditandai offline dan IP aktifnya dirotasi ke last_ip untuk mencegah tabrakan DHCP.
UPDATE devices
SET is_online = 0,
    last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END,
    ip = ''
WHERE LOWER(mac) = LOWER(?)
  AND (is_self IS NULL OR is_self = 0)
  AND (is_gateway IS NULL OR is_gateway = 0)
  AND (last_seen IS NULL OR last_seen < datetime('now', 'localtime', '-75 seconds'));
```

