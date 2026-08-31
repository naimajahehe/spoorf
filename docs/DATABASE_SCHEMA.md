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
    last_seen TEXT DEFAULT (datetime('now', 'localtime'))
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

## 3. Indeks Performa

```sql
CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
CREATE INDEX IF NOT EXISTS idx_devices_is_blocked ON devices(is_blocked);
CREATE INDEX IF NOT EXISTS idx_devices_is_online ON devices(is_online);
CREATE INDEX IF NOT EXISTS idx_devices_is_archived ON devices(is_archived);
CREATE INDEX IF NOT EXISTS idx_devices_profile_id ON devices(profile_id);
```

---

## 4. Pola Kueri Kritis: UPSERT & Auto-Reblock

### Kueri Penyinkronan Scan (*UPSERT SQLite*):
```sql
INSERT INTO devices (
    mac, ip, hostname, vendor, os, device_type,
    web_title, web_server, workgroup, user_name,
    open_ports, services, is_blocked, is_online, is_gateway,
    rtt_ms, session_id, is_self, ttl, is_randomized_mac, mac_type, alias, profile_id, matched_by, speed_limit,
    dhcp_vendor_class, dhcp_fingerprint, dhcp_client_id, dhcp_fqdn, match_score, candidate_profile_id, first_seen, last_seen,
    distance_zone, estimated_range,
    ipv6_link_local, ipv6_global, ipv6_addresses, is_dual_stack
) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, 1, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', 'localtime')), datetime('now', 'localtime'),
    ?, ?,
    ?, ?, ?, ?
)
ON CONFLICT (mac) DO UPDATE SET
    ip = excluded.ip,
    hostname = CASE WHEN excluded.hostname IS NOT NULL AND excluded.hostname != '' THEN excluded.hostname ELSE devices.hostname END,
    vendor = CASE WHEN excluded.vendor IS NOT NULL AND excluded.vendor != '' THEN excluded.vendor ELSE devices.vendor END,
    os = CASE WHEN excluded.os IS NOT NULL AND excluded.os != '' THEN excluded.os ELSE devices.os END,
    device_type = CASE WHEN excluded.device_type IS NOT NULL AND excluded.device_type != '' THEN excluded.device_type ELSE devices.device_type END,
    is_online = 1,
    is_gateway = excluded.is_gateway,
    rtt_ms = excluded.rtt_ms,
    is_self = excluded.is_self,
    is_archived = 0,
    last_seen = datetime('now', 'localtime');
```

