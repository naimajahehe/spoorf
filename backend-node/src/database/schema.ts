/**
 * DDL SQL Definitions for SQLite Database Schema
 * Preserves composite primary keys (network_id, mac) and indexes.
 */

export const CREATE_NETWORKS_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS networks (
        id TEXT PRIMARY KEY,
        ssid TEXT NOT NULL,
        gateway_ip TEXT NOT NULL,
        gateway_mac TEXT NOT NULL,
        subnet TEXT,
        interface_type TEXT DEFAULT 'wifi',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        last_connected_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
`;

export const CREATE_PROFILES_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS device_profiles (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL,
        hostname TEXT,
        os TEXT,
        vendor TEXT,
        device_type TEXT,
        dhcp_fingerprint TEXT,
        dhcp_vendor_class TEXT,
        dhcp_client_id TEXT,
        linked_macs TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
`;

export const CREATE_DEVICES_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS devices (
        network_id TEXT NOT NULL DEFAULT 'net_default' REFERENCES networks(id) ON DELETE CASCADE,
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
        is_blocked INTEGER DEFAULT 0,
        is_online INTEGER DEFAULT 1,
        is_gateway INTEGER DEFAULT 0,
        is_self INTEGER DEFAULT 0,
        rtt_ms REAL DEFAULT 0,
        ttl INTEGER,
        is_randomized_mac INTEGER DEFAULT 0,
        mac_type TEXT,
        alias TEXT,
        profile_id TEXT REFERENCES device_profiles(id),
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
`;

export const CREATE_LICENSE_CACHE_TABLE_SQL = `
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
`;

export const CREATE_INDEXES_SQL = `
    CREATE INDEX IF NOT EXISTS idx_networks_last_connected ON networks(last_connected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_devices_net_id ON devices(network_id);
    CREATE INDEX IF NOT EXISTS idx_devices_net_online ON devices(network_id, is_online);
    CREATE INDEX IF NOT EXISTS idx_devices_net_blocked ON devices(network_id, is_blocked);
    CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
    CREATE INDEX IF NOT EXISTS idx_devices_is_archived ON devices(is_archived);
    CREATE INDEX IF NOT EXISTS idx_devices_profile_id ON devices(profile_id);
    CREATE INDEX IF NOT EXISTS idx_devices_dhcp_client_id ON devices(network_id, dhcp_client_id);
    CREATE INDEX IF NOT EXISTS idx_devices_identity ON devices(network_id, hostname, dhcp_fingerprint, dhcp_vendor_class);
    CREATE INDEX IF NOT EXISTS idx_device_profiles_alias ON device_profiles(alias);
`;

export const INSERT_DEFAULT_NETWORK_SQL = `
    INSERT OR IGNORE INTO networks (id, ssid, gateway_ip, gateway_mac)
    VALUES ('net_default', 'Default Network', '0.0.0.0', '00:00:00:00:00:00');
`;

export const ADDITIVE_DEVICE_COLUMNS = [
    ['last_ip', 'TEXT'],
    ['profile_status', "TEXT DEFAULT 'unknown'"],
    ['vendor_confidence', 'INTEGER DEFAULT 0'],
    ['type_confidence', 'INTEGER DEFAULT 0'],
    ['hostname_confidence', 'INTEGER DEFAULT 0'],
    ['profile_evidence', "TEXT DEFAULT '[]'"],
    ['profiled_at', 'TEXT'],
    ['profile_version', 'INTEGER DEFAULT 1']
] as const;
