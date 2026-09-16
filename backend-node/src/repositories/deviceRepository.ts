import type Database from 'better-sqlite3';
import { Device, ProfileEvidence, ProfileStatus } from '../types';
import { IDeviceRepository } from '../interfaces';
import {
    safeParseJson,
    deriveProfileId,
    betterProfileName,
    PROFILE_STATUSES
} from '../utils/databaseUtils';

export class DeviceRepository implements IDeviceRepository {
    constructor(
        private readonly db: Database.Database,
        private readonly log?: any
    ) {}

    rowToDevice(row: any): Device {
        return {
            network_id: row.network_id || undefined,
            mac: row.mac,
            ip: row.ip,
            last_ip: row.last_ip || undefined,
            hostname: row.hostname || '',
            vendor: row.vendor || '',
            os: row.os || '',
            device_type: row.device_type || 'Unknown',
            web_title: row.web_title || undefined,
            web_server: row.web_server || undefined,
            workgroup: row.workgroup || undefined,
            user_name: row.user_name || undefined,
            open_ports: safeParseJson<number[]>(row.open_ports, []),
            services: safeParseJson<string[]>(row.services, []),
            is_blocked: Boolean(row.is_blocked),
            is_online: Boolean(row.is_online),
            is_gateway: Boolean(row.is_gateway),
            is_self: Boolean(row.is_self),
            rtt_ms: row.rtt_ms ? parseFloat(row.rtt_ms) : 0,
            ttl: row.ttl !== null && row.ttl !== undefined ? parseInt(row.ttl, 10) : undefined,
            is_randomized_mac: Boolean(row.is_randomized_mac),
            mac_type: row.mac_type || undefined,
            alias: row.alias || undefined,
            profile_id: row.profile_id || undefined,
            matched_by: row.matched_by || undefined,
            session_id: row.session_id || undefined,
            speed_limit: row.speed_limit !== undefined && row.speed_limit !== null ? parseInt(row.speed_limit, 10) : 100,
            first_seen: row.first_seen || undefined,
            last_seen: row.last_seen || undefined,
            dhcp_fingerprint: row.dhcp_fingerprint || undefined,
            dhcp_vendor_class: row.dhcp_vendor_class || undefined,
            dhcp_client_id: row.dhcp_client_id || undefined,
            dhcp_fqdn: row.dhcp_fqdn || undefined,
            match_score: row.match_score !== null && row.match_score !== undefined ? parseInt(row.match_score, 10) : undefined,
            candidate_profile_id: row.candidate_profile_id || undefined,
            is_archived: Boolean(row.is_archived),
            linked_macs: safeParseJson<string[]>(row.linked_macs, undefined as any),
            distance_zone: row.distance_zone || undefined,
            estimated_range: row.estimated_range || undefined,
            ipv6_link_local: row.ipv6_link_local || undefined,
            ipv6_global: row.ipv6_global || undefined,
            ipv6_addresses: safeParseJson<string[]>(row.ipv6_addresses, []),
            is_dual_stack: Boolean(row.is_dual_stack),
            profile_status: PROFILE_STATUSES.has(row.profile_status) ? row.profile_status : 'unknown',
            vendor_confidence: row.vendor_confidence !== null && row.vendor_confidence !== undefined
                ? Number(row.vendor_confidence)
                : 0,
            type_confidence: row.type_confidence !== null && row.type_confidence !== undefined
                ? Number(row.type_confidence)
                : 0,
            hostname_confidence: row.hostname_confidence !== null && row.hostname_confidence !== undefined
                ? Number(row.hostname_confidence)
                : 0,
            profile_evidence: safeParseJson<ProfileEvidence[]>(row.profile_evidence, []),
            profiled_at: row.profiled_at || undefined,
            profile_version: row.profile_version !== null && row.profile_version !== undefined
                ? Number(row.profile_version)
                : 1
        };
    }

    async getAll(includeArchived: boolean = false, networkId?: string): Promise<Device[]> {
        const conditions: string[] = [];
        const params: any[] = [];
        if (!includeArchived) {
            conditions.push('(d.is_archived = 0 OR d.is_archived IS NULL)');
        }
        if (networkId) {
            conditions.push('d.network_id = ?');
            params.push(networkId);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const query = `
            SELECT 
                d.network_id,
                d.mac, d.ip, d.last_ip, d.hostname, d.vendor, d.os, d.device_type,
                d.web_title, d.web_server, d.workgroup, d.user_name,
                d.open_ports, d.services, d.is_blocked, d.is_online, d.is_gateway, d.is_self,
                d.rtt_ms, d.ttl, d.is_randomized_mac, d.mac_type, d.alias, d.profile_id, d.matched_by, d.session_id, d.speed_limit,
                d.dhcp_vendor_class, d.dhcp_fingerprint, d.dhcp_client_id, d.dhcp_fqdn, d.match_score, d.candidate_profile_id, d.is_archived,
                d.distance_zone, d.estimated_range,
                d.ipv6_link_local, d.ipv6_global, d.ipv6_addresses, d.is_dual_stack,
                d.profile_status, d.vendor_confidence, d.type_confidence, d.hostname_confidence,
                d.profile_evidence, d.profiled_at, d.profile_version,
                p.linked_macs,
                d.first_seen,
                d.last_seen
            FROM devices d
            LEFT JOIN device_profiles p ON d.profile_id = p.id
            ${whereClause}
            ORDER BY d.is_blocked DESC, d.is_online DESC, d.last_seen DESC
        `;
        const rows = this.db.prepare(query).all(...params) as any[];
        if (includeArchived) {
            return rows.map(row => this.rowToDevice(row));
        }

        const seenIps = new Set<string>();
        return rows.map(row => {
            const dev = this.rowToDevice(row);
            if (dev.ip && dev.ip.trim() !== '') {
                if (seenIps.has(dev.ip)) {
                    // Stale duplicate IP pada baris offline berprioritas lebih rendah
                    dev.ip = '';
                } else {
                    seenIps.add(dev.ip);
                }
            }
            return dev;
        });
    }

    async getByMac(mac: string, networkId?: string): Promise<Device | null> {
        let query = `
            SELECT d.*, p.linked_macs
            FROM devices d
            LEFT JOIN device_profiles p ON d.profile_id = p.id
            WHERE LOWER(d.mac) = LOWER(?)
        `;
        const params: any[] = [mac];
        if (networkId) {
            query += ' AND d.network_id = ?';
            params.push(networkId);
        } else {
            query += ' ORDER BY d.is_online DESC, d.last_seen DESC LIMIT 1';
        }
        const row = this.db.prepare(query).get(...params) as any;
        if (!row) return null;
        return this.rowToDevice(row);
    }

    async getByIp(ip: string, networkId?: string): Promise<Device | null> {
        let query = `
            SELECT d.*, p.linked_macs 
            FROM devices d
            LEFT JOIN device_profiles p ON d.profile_id = p.id
            WHERE d.ip = ?
        `;
        const params: any[] = [ip];
        if (networkId) {
            query += ' AND d.network_id = ?';
            params.push(networkId);
        }
        query += ' ORDER BY d.is_online DESC, d.last_seen DESC LIMIT 1';
        const row = this.db.prepare(query).get(...params) as any;
        if (!row) return null;
        return this.rowToDevice(row);
    }

    async save(device: Device, networkId?: string): Promise<void> {
        const netId = networkId || device.network_id || 'net_default';
        const normMac = device.mac.toLowerCase();
        const saveTransaction = this.db.transaction(() => {
            // Disosiasikan IP ini dari perangkat lain jika ada yang memegang IP sama di jaringan ini (kecuali gateway & host operator)
            this.db.prepare(`UPDATE devices SET is_online = 0, last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END, ip = '' WHERE network_id = ? AND ip = ? AND LOWER(mac) != LOWER(?) AND (is_gateway IS NULL OR is_gateway = 0) AND (is_self IS NULL OR is_self = 0)`).run(netId, device.ip, normMac);
            const query = `
                UPDATE devices SET
                    ip = ?,
                    last_ip = CASE WHEN ? != '' THEN ? ELSE last_ip END,
                    hostname = CASE WHEN ? != '' THEN ? ELSE hostname END,
                    vendor = CASE WHEN ? != '' THEN ? ELSE vendor END,
                    os = CASE WHEN ? != '' THEN ? ELSE os END,
                    device_type = CASE WHEN ? != '' THEN ? ELSE device_type END,
                    web_title = CASE WHEN ? != '' THEN ? ELSE web_title END,
                    web_server = CASE WHEN ? != '' THEN ? ELSE web_server END,
                    workgroup = CASE WHEN ? != '' THEN ? ELSE workgroup END,
                    user_name = CASE WHEN ? != '' THEN ? ELSE user_name END,
                    open_ports = ?,
                    services = ?,
                    last_seen = datetime('now', 'localtime')
                WHERE LOWER(mac) = LOWER(?) AND network_id = ?
            `;
            this.db.prepare(query).run(
                device.ip,
                device.ip, device.ip,
                device.hostname || '', device.hostname || '',
                device.vendor || '', device.vendor || '',
                device.os || '', device.os || '',
                device.device_type || 'Unknown', device.device_type || 'Unknown',
                device.web_title || '', device.web_title || '',
                device.web_server || '', device.web_server || '',
                device.workgroup || '', device.workgroup || '',
                device.user_name || '', device.user_name || '',
                JSON.stringify(device.open_ports || []),
                JSON.stringify(device.services || []),
                normMac,
                netId
            );
        });
        saveTransaction();
    }

    async updateIp(mac: string, ip: string, networkId: string = 'net_default'): Promise<void> {
        const normMac = mac.toLowerCase();
        const updateTransaction = this.db.transaction(() => {
            this.db.prepare(`UPDATE devices SET is_online = 0, last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END, ip = '' WHERE network_id = ? AND ip = ? AND LOWER(mac) != LOWER(?) AND (is_gateway IS NULL OR is_gateway = 0) AND (is_self IS NULL OR is_self = 0)`).run(networkId, ip, normMac);
            this.db.prepare(`UPDATE devices SET ip = ?, last_ip = ?, is_online = 1, last_seen = datetime('now', 'localtime') WHERE LOWER(mac) = LOWER(?) AND network_id = ?`).run(ip, ip, normMac, networkId);
        });
        updateTransaction();
    }

    async setOnlineStatus(mac: string, isOnline: boolean, networkId?: string): Promise<void> {
        try {
            let query = `UPDATE devices SET is_online = ?, last_seen = datetime('now', 'localtime') WHERE LOWER(mac) = LOWER(?)`;
            const params: any[] = [isOnline ? 1 : 0, mac.toLowerCase()];
            if (networkId) {
                query += ' AND network_id = ?';
                params.push(networkId);
            }
            this.db.prepare(query).run(...params);
        } catch (e: any) {
            if (this.log?.warn) {
                this.log.warn({ mac, err: e }, `Notice updating online status for ${mac}: ${e?.message || e}`);
            }
        }
    }

    async setBlocked(
        mac: string,
        isBlocked: boolean,
        sessionIdOrNetworkId?: string,
        maybeNetworkId?: string
    ): Promise<void> {
        const normMac = mac.toLowerCase();

        let sessionId: string | undefined;
        let networkId: string = 'net_default';
        if (sessionIdOrNetworkId && sessionIdOrNetworkId.startsWith('net_') && !maybeNetworkId) {
            networkId = sessionIdOrNetworkId;
            sessionId = undefined;
        } else {
            sessionId = sessionIdOrNetworkId;
            if (maybeNetworkId) networkId = maybeNetworkId;
        }

        const updateDeviceStmt = this.db.prepare(`
            UPDATE devices 
            SET is_blocked = ?, session_id = ?, is_online = CASE WHEN ? = 1 THEN 1 ELSE is_online END, last_seen = datetime('now', 'localtime')
            WHERE LOWER(mac) = LOWER(?) AND network_id = ?
        `);
        updateDeviceStmt.run(isBlocked ? 1 : 0, sessionId || null, isBlocked ? 1 : 0, normMac, networkId);

        const dev = this.db.prepare(`SELECT * FROM devices WHERE LOWER(mac) = LOWER(?) AND network_id = ?`).get(normMac, networkId) as any;
        if (dev) {
            const pId = dev.profile_id || dev.candidate_profile_id || deriveProfileId(dev.mac);

            // Dapatkan linked_macs + nama profil yang ada
            const existingProf = this.db.prepare(`SELECT linked_macs, alias, hostname FROM device_profiles WHERE id = ?`).get(pId) as any;
            let linkedMacs: string[] = [normMac];
            if (existingProf && existingProf.linked_macs) {
                const parsed = safeParseJson<string[]>(existingProf.linked_macs, []);
                linkedMacs = Array.from(new Set([...parsed, normMac]));
            }

            // Sinkronkan status blokir dan speed limit untuk SELURUH entri yang terafiliasi dengan profil ini di jaringan ini.
            const placeholders = linkedMacs.map(() => '?').join(',');
            if (!isBlocked) {
                this.db.prepare(`
                    UPDATE devices 
                    SET is_blocked = 0, session_id = NULL, speed_limit = 100 
                    WHERE (profile_id = ? OR LOWER(mac) IN (${placeholders})) AND network_id = ?
                `).run(pId, ...linkedMacs.map(m => m.toLowerCase()), networkId);
            } else {
                this.db.prepare(`
                    UPDATE devices 
                    SET is_blocked = 1, speed_limit = 0 
                    WHERE (profile_id = ? OR LOWER(mac) IN (${placeholders})) AND network_id = ?
                `).run(pId, ...linkedMacs.map(m => m.toLowerCase()), networkId);
            }

            // Naikkan nama profil ke hostname PERSONAL bila ada; jangan biarkan 'Unknown'/generik
            const candidate = dev.alias || dev.hostname || '';
            const healedAlias = betterProfileName(existingProf?.alias, candidate) || 'Target Device';
            const healedHost = betterProfileName(existingProf?.hostname, dev.hostname) || dev.hostname;

            const upsertProfileStmt = this.db.prepare(`
                INSERT INTO device_profiles (id, alias, hostname, os, vendor, device_type, linked_macs, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                ON CONFLICT(id) DO UPDATE SET
                    alias = excluded.alias,
                    hostname = excluded.hostname,
                    linked_macs = excluded.linked_macs,
                    updated_at = datetime('now', 'localtime')
            `);
            upsertProfileStmt.run(
                pId, healedAlias, healedHost, dev.os, dev.vendor, dev.device_type,
                JSON.stringify(linkedMacs)
            );

            this.db.prepare(`UPDATE devices SET profile_id = ? WHERE LOWER(mac) = LOWER(?) AND network_id = ?`).run(pId, normMac, networkId);
        }
    }

    async setSpeedLimit(mac: string, speedLimit: number, networkId: string = 'net_default'): Promise<Device> {
        const normMac = mac.toLowerCase();
        const updateStmt = this.db.prepare(`
            UPDATE devices 
            SET speed_limit = ?, last_seen = datetime('now', 'localtime')
            WHERE LOWER(mac) = LOWER(?) AND network_id = ?
        `);
        const info = updateStmt.run(speedLimit, normMac, networkId);
        if (info.changes === 0) throw new Error(`Device with MAC ${mac} not found in network ${networkId}`);

        const dev = this.db.prepare(`SELECT * FROM devices WHERE LOWER(mac) = LOWER(?) AND network_id = ?`).get(normMac, networkId) as any;
        const pId = dev?.profile_id || dev?.candidate_profile_id;
        if (pId) {
            this.db.prepare(`UPDATE devices SET speed_limit = ?, profile_id = COALESCE(profile_id, ?) WHERE (profile_id = ? OR LOWER(mac) = LOWER(?)) AND network_id = ?`).run(speedLimit, pId, pId, normMac, networkId);
        }
        return this.rowToDevice(dev);
    }

    async setAlias(mac: string, alias: string, networkId: string = 'net_default'): Promise<Device> {
        const normMac = mac.toLowerCase();
        const existing = await this.getByMac(normMac, networkId);
        if (!existing) {
            throw new Error(`Device with MAC ${mac} not found`);
        }

        const pId = existing.profile_id || deriveProfileId(normMac);

        // Ambil linked_macs profil yang ada
        const existingProf = this.db.prepare(`SELECT linked_macs FROM device_profiles WHERE id = ?`).get(pId) as any;
        let linkedMacs: string[] = [normMac];
        if (existingProf && existingProf.linked_macs) {
            const parsed = safeParseJson<string[]>(existingProf.linked_macs, []);
            linkedMacs = Array.from(new Set([...parsed, normMac]));
        }

        this.db.prepare(`
            INSERT INTO device_profiles (id, alias, hostname, os, vendor, device_type, linked_macs, dhcp_fingerprint, dhcp_vendor_class, dhcp_client_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            ON CONFLICT(id) DO UPDATE SET
                alias = excluded.alias,
                linked_macs = excluded.linked_macs,
                dhcp_fingerprint = COALESCE(excluded.dhcp_fingerprint, device_profiles.dhcp_fingerprint),
                dhcp_vendor_class = COALESCE(excluded.dhcp_vendor_class, device_profiles.dhcp_vendor_class),
                dhcp_client_id = COALESCE(excluded.dhcp_client_id, device_profiles.dhcp_client_id),
                updated_at = datetime('now', 'localtime')
        `).run(
            pId, alias, existing.hostname, existing.os, existing.vendor, existing.device_type,
            JSON.stringify(linkedMacs),
            existing.dhcp_fingerprint || null,
            existing.dhcp_vendor_class || null,
            existing.dhcp_client_id || null
        );

        this.db.prepare(`
            UPDATE devices 
            SET alias = ?, profile_id = ?, last_seen = datetime('now', 'localtime') 
            WHERE (LOWER(mac) = LOWER(?) OR profile_id = ?) AND network_id = ?
        `).run(alias, pId, normMac, pId, networkId);

        const updated = await this.getByMac(normMac, networkId);
        return updated!;
    }

    async delete(mac: string, networkId?: string): Promise<void> {
        const normMac = mac.toLowerCase();
        const existing = await this.getByMac(normMac, networkId);
        const profileId = existing?.profile_id;

        if (networkId) {
            if (profileId) {
                this.db.prepare(`DELETE FROM devices WHERE (profile_id = ? OR LOWER(mac) = LOWER(?)) AND network_id = ?`).run(profileId, normMac, networkId);
            } else {
                this.db.prepare(`DELETE FROM devices WHERE LOWER(mac) = LOWER(?) AND network_id = ?`).run(normMac, networkId);
            }
        } else {
            if (profileId) {
                this.db.prepare(`DELETE FROM devices WHERE profile_id = ? OR LOWER(mac) = LOWER(?)`).run(profileId, normMac);
            } else {
                this.db.prepare(`DELETE FROM devices WHERE LOWER(mac) = LOWER(?)`).run(normMac);
            }
        }

        // Garbage collection: Bersihkan normMac dari linked_macs dan hapus profil yatim tanpa perangkat tersisa
        if (profileId) {
            const remaining = this.db.prepare(`SELECT count(*) as count FROM devices WHERE profile_id = ?`).get(profileId) as { count: number };
            if (remaining.count === 0) {
                this.db.prepare(`DELETE FROM device_profiles WHERE id = ?`).run(profileId);
            }
        }

        const allProfiles = this.db.prepare(`SELECT * FROM device_profiles`).all() as any[];
        for (const p of allProfiles) {
            const linked = safeParseJson<string[]>(p.linked_macs, []);
            const hasNormMac = linked.some(m => m.toLowerCase() === normMac);
            if (hasNormMac) {
                const nextLinked = linked.filter(m => m.toLowerCase() !== normMac);
                const remainingDevs = this.db.prepare(`SELECT count(*) as count FROM devices WHERE profile_id = ?`).get(p.id) as { count: number };
                if (nextLinked.length === 0 || remainingDevs.count === 0) {
                    this.db.prepare(`DELETE FROM device_profiles WHERE id = ?`).run(p.id);
                } else {
                    this.db.prepare(`UPDATE device_profiles SET linked_macs = ? WHERE id = ?`).run(JSON.stringify(nextLinked), p.id);
                }
            }
        }
    }

    async clearAll(networkId?: string): Promise<void> {
        if (networkId) {
            this.db.prepare(`DELETE FROM devices WHERE network_id = ?`).run(networkId);
        } else {
            this.db.exec("DELETE FROM devices; DELETE FROM device_profiles;");
        }
    }
}
