import type Database from 'better-sqlite3';
import { ProfileAssessment, ProfileEvidence, ProfileStatus } from '../types';
import { IProfileRepository } from '../interfaces';
import {
    isUsableClientId,
    isGenericFactoryHostname,
    betterProfileName,
    validateProfileAssessment,
    isGenericProfileLabel
} from '../utils/databaseUtils';

export class ProfileRepository implements IProfileRepository {
    constructor(
        private readonly db: Database.Database,
        private readonly log?: any
    ) {}

    /**
     * FASE-3: apakah sinyal identitas DHCP ini cocok dengan perangkat yang MASIH TERBLOKIR
     * (is_blocked=1) — mengabaikan MAC (yang bisa berotasi). Sinkron (dipakai di hot-path handler).
     * Cocok bila: (1) DUID/client-id LAYAK & sama persis, ATAU (2) hostname PERSONAL (bukan generik)
     * + fingerprint(Opt55) + vendor(Opt60) ketiganya sama. Unblock-safe: hanya is_blocked=1.
     */
    hasBlockedIdentityMatch(
        data: { client_id?: string; hostname?: string; dhcp_fingerprint?: string; vendor_class?: string },
        networkId?: string
    ): boolean {
        if (!this.db) return false;
        const cid = (data.client_id || '').trim().toLowerCase();
        if (isUsableClientId(cid)) {
            let query = `SELECT 1 FROM devices WHERE is_blocked = 1 AND LOWER(dhcp_client_id) = ?`;
            const params: any[] = [cid];
            if (networkId) {
                query += ' AND network_id = ?';
                params.push(networkId);
            }
            query += ' LIMIT 1';
            const row = this.db.prepare(query).get(...params);
            if (row) return true;
        }
        const host = (data.hostname || '').trim().toLowerCase();
        const fp = (data.dhcp_fingerprint || '').trim().toLowerCase();
        const vc = (data.vendor_class || '').trim().toLowerCase();
        if (host && fp && vc) {
            let query = `SELECT 1 FROM devices WHERE is_blocked = 1 AND LOWER(hostname) = ? AND LOWER(dhcp_fingerprint) = ? AND LOWER(dhcp_vendor_class) = ?`;
            const params: any[] = [host, fp, vc];
            if (isGenericFactoryHostname(host)) {
                // Untuk hostname pabrik (Galaxy-A14, Redmi), batasi pencocokan hanya bila
                // target pernah online dalam jendela 15 menit terakhir (indikasi rotasi MAC nyata).
                query += " AND last_seen > datetime('now', 'localtime', '-15 minutes')";
            }
            if (networkId) {
                query += ' AND network_id = ?';
                params.push(networkId);
            }
            query += ' LIMIT 1';
            const row = this.db.prepare(query).get(...params);
            if (row) return true;
        }
        return false;
    }

    /**
     * Sembuhkan profil yang alias/hostname-nya generik/'Unknown' padahal salah satu baris device di
     * bawahnya punya hostname PERSONAL. Tanpa ini, MAC hasil rotasi yang fusi ke profil mewarisi
     * alias 'Unknown' → tampil "Unknown" walau hostname aslinya diketahui. Mengembalikan jumlah
     * profil yang diperbaiki. Aman & idempoten (hanya menaikkan generik→personal, tak pernah turun).
     */
    async backfillProfileNames(): Promise<number> {
        const profiles = this.db.prepare(`SELECT id, alias, hostname FROM device_profiles`).all() as any[];
        // Ambil SEMUA hostname perangkat sekali jalan (hindari N+1: satu SELECT per profil).
        // Diurutkan per profil lalu last_seen DESC, sehingga hostname personal terbaru muncul lebih dulu.
        const hostRows = this.db.prepare(
            `SELECT profile_id, hostname FROM devices
             WHERE profile_id IS NOT NULL AND hostname IS NOT NULL AND TRIM(hostname) != ''
             ORDER BY profile_id, last_seen DESC`
        ).all() as any[];
        const hostsByProfile = new Map<string, string[]>();
        for (const r of hostRows) {
            const list = hostsByProfile.get(r.profile_id);
            const name = (r.hostname || '').trim();
            if (list) list.push(name); else hostsByProfile.set(r.profile_id, [name]);
        }
        const update = this.db.prepare(`UPDATE device_profiles SET alias = ?, hostname = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`);
        let healed = 0;
        for (const p of profiles) {
            const aliasGeneric = isGenericFactoryHostname((p.alias || '').trim());
            const hostGeneric = isGenericFactoryHostname((p.hostname || '').trim());
            if (!aliasGeneric && !hostGeneric) continue;
            const personal = (hostsByProfile.get(p.id) || []).find(h => h && !isGenericFactoryHostname(h));
            if (!personal) continue;
            const newAlias = betterProfileName(p.alias, personal);
            const newHost = betterProfileName(p.hostname, personal);
            if (newAlias !== (p.alias || '').trim() || newHost !== (p.hostname || '').trim()) {
                update.run(newAlias, newHost, p.id);
                healed++;
            }
        }
        if (healed > 0 && this.log?.info) {
            this.log.info({ healed }, `[Profile Backfill] ${healed} profil dipulihkan namanya dari hostname personal perangkat.`);
        }
        return healed;
    }

    async updateDeviceProfileAssessment(profile: ProfileAssessment, networkId?: string): Promise<void> {
        const validated = validateProfileAssessment(profile);
        const vendor = isGenericProfileLabel(validated.vendor, 'vendor') ? null : validated.vendor;
        const deviceType = isGenericProfileLabel(validated.device_type, 'device_type')
            ? null
            : validated.device_type;
        const hostname = isGenericProfileLabel(validated.hostname, 'hostname') ? null : validated.hostname;
        const os = isGenericProfileLabel(validated.os, 'os') ? null : validated.os;

        let whereClause = 'WHERE LOWER(mac) = LOWER(?)';
        const params: any[] = [
            vendor, vendor,
            deviceType, deviceType,
            hostname, hostname,
            os, os,
            validated.vendor_confidence,
            validated.type_confidence,
            validated.hostname_confidence,
            validated.profile_status,
            validated.evidenceJson,
            validated.profiled_at,
            validated.profile_version,
            validated.mac
        ];
        if (networkId) {
            whereClause += ' AND network_id = ?';
            params.push(networkId);
        }

        const updateTransaction = this.db.transaction(() => {
            const result = this.db.prepare(`
                UPDATE devices SET
                    vendor = CASE WHEN ? IS NOT NULL THEN ? ELSE vendor END,
                    device_type = CASE WHEN ? IS NOT NULL THEN ? ELSE device_type END,
                    hostname = CASE WHEN ? IS NOT NULL THEN ? ELSE hostname END,
                    os = CASE WHEN ? IS NOT NULL THEN ? ELSE os END,
                    vendor_confidence = ?,
                    type_confidence = ?,
                    hostname_confidence = ?,
                    profile_status = ?,
                    profile_evidence = ?,
                    profiled_at = ?,
                    profile_version = ?,
                    last_seen = datetime('now', 'localtime')
                ${whereClause}
            `).run(...params);

            if (result.changes === 0) {
                throw new Error(`Device with MAC ${validated.mac} not found`);
            }
        });

        updateTransaction();
    }

    async updateDeviceDhcpProfile(profile: {
        mac: string;
        ip: string;
        hostname?: string;
        vendorClass?: string;
        fingerprint?: string;
        clientId?: string;
        fqdn?: string;
    }, networkId: string = 'net_default'): Promise<void> {
        const normMac = profile.mac.toLowerCase();
        const cleanIp = profile.ip ? profile.ip.trim() : '';
        const updateTransaction = this.db.transaction(() => {
            if (cleanIp) {
                this.db.prepare(`
                    UPDATE devices
                    SET is_online = 0,
                        last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END,
                        ip = ''
                    WHERE network_id = ? AND ip = ? AND LOWER(mac) != LOWER(?)
                `).run(networkId, cleanIp, normMac);
                this.db.prepare(`
                    UPDATE devices SET
                        ip = ?,
                        last_ip = ?,
                        is_online = 1,
                        hostname = CASE WHEN ? != '' THEN ? ELSE hostname END,
                        dhcp_vendor_class = CASE WHEN ? != '' THEN ? ELSE dhcp_vendor_class END,
                        dhcp_fingerprint = CASE WHEN ? != '' THEN ? ELSE dhcp_fingerprint END,
                        dhcp_client_id = CASE WHEN ? != '' THEN ? ELSE dhcp_client_id END,
                        dhcp_fqdn = CASE WHEN ? != '' THEN ? ELSE dhcp_fqdn END,
                        last_seen = datetime('now', 'localtime')
                    WHERE LOWER(mac) = LOWER(?) AND network_id = ?
                `).run(
                    cleanIp,
                    cleanIp,
                    profile.hostname || '', profile.hostname || '',
                    profile.vendorClass || '', profile.vendorClass || '',
                    profile.fingerprint || '', profile.fingerprint || '',
                    profile.clientId || '', profile.clientId || '',
                    profile.fqdn || '', profile.fqdn || '',
                    normMac,
                    networkId
                );
            } else {
                this.db.prepare(`
                    UPDATE devices SET
                        hostname = CASE WHEN ? != '' THEN ? ELSE hostname END,
                        dhcp_vendor_class = CASE WHEN ? != '' THEN ? ELSE dhcp_vendor_class END,
                        dhcp_fingerprint = CASE WHEN ? != '' THEN ? ELSE dhcp_fingerprint END,
                        dhcp_client_id = CASE WHEN ? != '' THEN ? ELSE dhcp_client_id END,
                        dhcp_fqdn = CASE WHEN ? != '' THEN ? ELSE dhcp_fqdn END
                    WHERE LOWER(mac) = LOWER(?) AND network_id = ?
                `).run(
                    profile.hostname || '', profile.hostname || '',
                    profile.vendorClass || '', profile.vendorClass || '',
                    profile.fingerprint || '', profile.fingerprint || '',
                    profile.clientId || '', profile.clientId || '',
                    profile.fqdn || '', profile.fqdn || '',
                    normMac,
                    networkId
                );
            }
        });
        updateTransaction();
    }

    getProfileById(id: string): any {
        return this.db.prepare('SELECT * FROM device_profiles WHERE id = ?').get(id);
    }

    getAllProfiles(): any[] {
        return this.db.prepare('SELECT * FROM device_profiles').all();
    }
}
