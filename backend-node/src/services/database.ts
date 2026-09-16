import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Device, Network, CachedLicense, ProfileAssessment, ProfileEvidence, ProfileStatus } from '../types';
import { IDatabaseService } from '../interfaces';
import { env } from '../config/env';
import { createChildLogger } from '../utils/logger';
import {
    DeviceRepository,
    ProfileRepository,
    NetworkRepository,
    LicenseRepository,
    RetentionRepository
} from '../repositories';
import {
    CREATE_NETWORKS_TABLE_SQL,
    CREATE_PROFILES_TABLE_SQL,
    CREATE_DEVICES_TABLE_SQL,
    CREATE_LICENSE_CACHE_TABLE_SQL,
    CREATE_INDEXES_SQL,
    INSERT_DEFAULT_NETWORK_SQL
} from '../database/schema';
import { runMigrations } from '../database/migrations';
import { reconcileCanonicalDeviceMacs } from '../database/maintenance';
import {
    deriveNetworkId,
    OFFLINE_GRACE_SECONDS,
    deriveProfileId,
    safeParseJson,
    normalizeMacAddress,
    isGenericProfileLabel,
    validateProfileAssessment,
    calculateProfileMatchScore
} from '../utils/databaseUtils';

export class DatabaseService implements IDatabaseService {
    private readonly log = createChildLogger('Database');
    public db: Database.Database;
    private initialized: boolean = false;
    private dbPath: string;
    /**
     * True bila file DB gagal dibuka & sistem memakai SQLite in-memory (data TIDAK
     * persist). Di-surface agar kondisi ini tidak "senyap" (P3). Bisa dibaca oleh
     * layer atas untuk memperingatkan operator.
     */
    public usingMemoryFallback: boolean = false;

    public deviceRepo: DeviceRepository;
    public profileRepo: ProfileRepository;
    public networkRepo: NetworkRepository;
    public licenseRepo: LicenseRepository;
    public retentionRepo: RetentionRepository;

    constructor(customDbPath?: string) {
        if (customDbPath) {
            this.dbPath = customDbPath;
        } else if (env.DB_FILE) {
            this.dbPath = path.resolve(env.DB_FILE);
        } else if (env.SENTINEL_DB_PATH) {
            this.dbPath = path.resolve(env.SENTINEL_DB_PATH);
        } else {
            this.dbPath = path.join(process.cwd(), 'data', 'sentinel.db');
        }

        // Pastikan folder direktori database tersedia jika bukan :memory:
        if (this.dbPath !== ':memory:') {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        try {
            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('foreign_keys = ON');
            this.db.pragma('busy_timeout = 5000');
        } catch (err: any) {
            this.usingMemoryFallback = true;
            this.log.warn(
                {
                    event: { action: 'db_fallback_memory', category: 'database' },
                    context: { dbPath: this.dbPath },
                    err
                },
                `GAGAL membuka file DB ${this.dbPath} (${err?.message || err}). Beralih ke SQLite IN-MEMORY. PERINGATAN: data perangkat & lisensi TIDAK akan tersimpan permanen.`
            );
            this.db = new Database(':memory:');
        }

        this.deviceRepo = new DeviceRepository(this.db, this.log);
        this.profileRepo = new ProfileRepository(this.db, this.log);
        this.networkRepo = new NetworkRepository(this.db);
        this.licenseRepo = new LicenseRepository(this.db);
        this.retentionRepo = new RetentionRepository(this.db, this.log);
    }

    getDbPath(): string {
        return this.dbPath;
    }

    getJournalMode(): string {
        try {
            return (this.db.pragma('journal_mode', { simple: true }) as string) || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    checkpointWal(): void {
        if (!this.db || this.dbPath === ':memory:') return;
        try {
            this.db.pragma('wal_checkpoint(PASSIVE)');
        } catch {}
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        try {
            // 1. Pastikan tabel networks & device_profiles tersedia terlebih dahulu
            this.db.exec(`
                ${CREATE_NETWORKS_TABLE_SQL}
                ${INSERT_DEFAULT_NETWORK_SQL}
                ${CREATE_PROFILES_TABLE_SQL}
            `);

            // 2. Jalankan migrasi schema legacy (migrasi devices ke composite PK network_id) & additive columns
            runMigrations(this.db, this.log);

            // 3. Pastikan tabel devices, license_cache & indeks tersedia
            this.db.exec(`
                ${CREATE_DEVICES_TABLE_SQL}
                ${CREATE_LICENSE_CACHE_TABLE_SQL}
                ${CREATE_INDEXES_SQL}
            `);

            // 4. Jalankan rekonsiliasi MAC canonical & pembersihan stale
            this.reconcileCanonicalDeviceMacs();

            this.log.info({ dbPath: this.dbPath }, `SQLite connected & schema initialized (${this.dbPath})`);
            this.initialized = true;
        } catch (error) {
            throw error;
        }
    }

    ensureNetwork(net: Network): void {
        this.networkRepo.ensureNetwork(net);
    }

    getNetwork(id: string): Network | null {
        return this.networkRepo.getNetwork(id);
    }

    getAllNetworks(): Network[] {
        return this.networkRepo.getAllNetworks();
    }

    private reconcileCanonicalDeviceMacs(): void {
        reconcileCanonicalDeviceMacs(this.db, this.log, (days) => this.pruneStaleRandomizedMacs(days));
    }

    async archiveStaleDevices(thresholdDays: number = 14): Promise<number> {
        await this.init();
        return this.retentionRepo.archiveStaleDevices(thresholdDays);
    }

    pruneStaleRandomizedMacs(thresholdDays: number = 2): { deletedDevices: number; deletedProfiles: number } {
        return this.retentionRepo.pruneStaleRandomizedMacs(thresholdDays);
    }

    private async getDevices(includeArchived: boolean, networkId?: string): Promise<Device[]> {
        await this.init();
        return this.deviceRepo.getAll(includeArchived, networkId);
    }

    async getAllDevices(networkId?: string): Promise<Device[]> {
        return this.getDevices(false, networkId);
    }

    private async getDevicesForReconciliation(networkId?: string): Promise<Device[]> {
        return this.getDevices(true, networkId);
    }

    async getDeviceByMac(mac: string, networkId?: string): Promise<Device | null> {
        await this.init();
        return this.deviceRepo.getByMac(mac, networkId);
    }

    hasBlockedIdentityMatch(
        data: { client_id?: string; hostname?: string; dhcp_fingerprint?: string; vendor_class?: string },
        networkId?: string
    ): boolean {
        return this.profileRepo.hasBlockedIdentityMatch(data, networkId);
    }

    async backfillProfileNames(): Promise<number> {
        await this.init();
        return this.profileRepo.backfillProfileNames();
    }

    async getDeviceByIp(ip: string, networkId?: string): Promise<Device | null> {
        await this.init();
        return this.deviceRepo.getByIp(ip, networkId);
    }

    async setDeviceBlocked(
        mac: string,
        isBlocked: boolean,
        sessionIdOrNetworkId?: string,
        maybeNetworkId?: string
    ): Promise<void> {
        await this.init();
        return this.deviceRepo.setBlocked(mac, isBlocked, sessionIdOrNetworkId, maybeNetworkId);
    }

    async setDeviceOnlineStatus(mac: string, isOnline: boolean, networkId?: string): Promise<void> {
        await this.init();
        return this.deviceRepo.setOnlineStatus(mac, isOnline, networkId);
    }

    async setDeviceSpeedLimit(mac: string, speedLimit: number, networkId: string = 'net_default'): Promise<Device> {
        await this.init();
        return this.deviceRepo.setSpeedLimit(mac, speedLimit, networkId);
    }

    async setDeviceAlias(mac: string, alias: string, networkId: string = 'net_default'): Promise<Device> {
        await this.init();
        return this.deviceRepo.setAlias(mac, alias, networkId);
    }

    async deleteDevice(mac: string, networkId?: string): Promise<void> {
        await this.init();
        return this.deviceRepo.delete(mac, networkId);
    }

    async clearAllDevices(networkId?: string): Promise<void> {
        await this.init();
        return this.deviceRepo.clearAll(networkId);
    }

    async saveDevice(device: Device, networkId?: string): Promise<void> {
        await this.init();
        return this.deviceRepo.save(device, networkId);
    }

    async updateDeviceIp(mac: string, ip: string, networkId: string = 'net_default'): Promise<void> {
        await this.init();
        return this.deviceRepo.updateIp(mac, ip, networkId);
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
        await this.init();
        return this.profileRepo.updateDeviceDhcpProfile(profile, networkId);
    }

    async updateDeviceProfileAssessment(profile: ProfileAssessment, networkId?: string): Promise<void> {
        await this.init();
        return this.profileRepo.updateDeviceProfileAssessment(profile, networkId);
    }

    /**
     * Sinkronisasi perangkat hasil scan dengan database SQLite:
     * - Mengenali perangkat lama berdasarkan MAC address
     * - Mempertahankan status is_blocked jika perangkat pernah diblokir
     * - Mendeteksi jika ada perangkat terblokir yang datang kembali (Auto-Reblock)
     * - Menandai perangkat yang tidak tertangkap sebagai is_online = 0 (bukan dihapus!)
     * - Dijalankan dalam transaksi atomik native SQLite dengan auto-rollback bila terjadi kegagalan.
     */
    async syncScanResults(
        scannedDevices: Device[],
        networkIdOrLiveSessionIds?: string | Set<string>,
        maybeLiveSessionIds?: Set<string>
    ): Promise<{
        allDevices: Device[];
        autoReblockTargets: Device[];
        autoThrottleTargets: Device[];
        zombieSessionsToStop?: string[];
    }> {
        await this.init();

        let networkId: string = 'net_default';
        let liveSessionIds: Set<string> | undefined;

        if (typeof networkIdOrLiveSessionIds === 'string') {
            networkId = networkIdOrLiveSessionIds;
            liveSessionIds = maybeLiveSessionIds;
        } else if (networkIdOrLiveSessionIds instanceof Set) {
            liveSessionIds = networkIdOrLiveSessionIds;
            const devWithNet = scannedDevices.find(d => Boolean(d.network_id));
            if (devWithNet?.network_id) {
                networkId = devWithNet.network_id;
            }
        } else {
            const devWithNet = scannedDevices.find(d => Boolean(d.network_id));
            if (devWithNet?.network_id) {
                networkId = devWithNet.network_id;
            }
        }

        // Pastikan network_id terdaftar di tabel networks agar foreign key valid
        this.db.prepare(`
            INSERT OR IGNORE INTO networks (id, ssid, gateway_ip, gateway_mac)
            VALUES (?, 'Active Network', '0.0.0.0', '00:00:00:00:00:00')
        `).run(networkId);

        const existingDevices = await this.getDevicesForReconciliation(networkId);
        const existingMap = new Map<string, Device>();
        for (const dev of existingDevices) {
            existingMap.set(dev.mac.toLowerCase(), dev);
        }

        const autoReblockTargets: Device[] = [];
        const autoThrottleTargets: Device[] = [];
        const zombieSessionsToStop: string[] = [];
        const scannedMacs = new Set<string>();
        const allScannedMacSet = new Set<string>(
            scannedDevices.map(d => normalizeMacAddress(d.mac))
        );

        // Load active profiles for heuristic matching
        const rawProfiles = this.db.prepare('SELECT * FROM device_profiles').all() as any[];
        const profiles = rawProfiles.map(p => ({
            ...p,
            linked_macs: safeParseJson<string[]>(p.linked_macs, [])
        }));

        // Prepared statements untuk performa ultra-cepat di dalam transaksi (SCOPED KE network_id)
        // Architectural Note: Prepared statements di-reuse langsung di sini untuk performa throughput tinggi
        // dalam iterasi loop scan reconciliation dengan jaminan transaksi atomik native SQLite.
        const resetGatewayStmt = this.db.prepare(`UPDATE devices SET is_gateway = 0 WHERE network_id = ? AND LOWER(mac) != LOWER(?)`);
        const updateProfileLinkedMacsStmt = this.db.prepare(`
            UPDATE device_profiles
            SET linked_macs = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `);
        // INVARIAN 1 & 2: Gateway dan Operator Controller (is_self) TIDAK BOLEH diarsipkan secara otomatis!
        const archiveDevicesStmt = this.db.prepare(`
            UPDATE devices
            SET is_archived = 1, is_online = 0, session_id = NULL,
                last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END,
                ip = ''
            WHERE network_id = ? AND profile_id = ? AND LOWER(mac) != LOWER(?)
              AND (is_gateway IS NULL OR is_gateway = 0)
              AND (is_self IS NULL OR is_self = 0)
        `);
        const selectArchivedSessionsStmt = this.db.prepare(`
            SELECT mac, session_id FROM devices
            WHERE network_id = ? AND profile_id = ? AND LOWER(mac) != LOWER(?) AND session_id IS NOT NULL
              AND (is_gateway IS NULL OR is_gateway = 0)
              AND (is_self IS NULL OR is_self = 0)
        `);
        const clearOtherSelfStmt = this.db.prepare(`
            UPDATE devices SET is_self = 0
            WHERE network_id = ? AND LOWER(mac) != LOWER(?) AND is_self = 1
        `);

        const upsertQuery = `
            INSERT INTO devices (
                network_id, mac, ip, last_ip, hostname, vendor, os, device_type,
                web_title, web_server, workgroup, user_name,
                open_ports, services, is_blocked, is_online, is_gateway,
                rtt_ms, session_id, is_self, ttl, is_randomized_mac, mac_type, alias, profile_id, matched_by, speed_limit,
                dhcp_vendor_class, dhcp_fingerprint, dhcp_client_id, dhcp_fqdn, match_score, candidate_profile_id, first_seen, last_seen,
                distance_zone, estimated_range,
                ipv6_link_local, ipv6_global, ipv6_addresses, is_dual_stack,
                profile_status, vendor_confidence, type_confidence, hostname_confidence,
                profile_evidence, profiled_at, profile_version
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, 1, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', 'localtime')), datetime('now', 'localtime'),
                ?, ?,
                ?, ?, ?, ?,
                COALESCE(?, 'unknown'), COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 0),
                COALESCE(?, '[]'), ?, COALESCE(?, 1)
            )
            ON CONFLICT (network_id, mac) DO UPDATE SET
                ip = excluded.ip,
                last_ip = CASE WHEN excluded.ip IS NOT NULL AND excluded.ip != '' THEN excluded.ip ELSE devices.last_ip END,
                hostname = CASE WHEN excluded.hostname IS NOT NULL AND excluded.hostname != '' THEN excluded.hostname ELSE devices.hostname END,
                vendor = CASE WHEN excluded.vendor IS NOT NULL AND excluded.vendor != '' THEN excluded.vendor ELSE devices.vendor END,
                os = CASE WHEN excluded.os IS NOT NULL AND excluded.os != '' THEN excluded.os ELSE devices.os END,
                device_type = CASE WHEN excluded.device_type IS NOT NULL AND excluded.device_type != '' THEN excluded.device_type ELSE devices.device_type END,
                web_title = CASE WHEN excluded.web_title IS NOT NULL AND excluded.web_title != '' THEN excluded.web_title ELSE devices.web_title END,
                web_server = CASE WHEN excluded.web_server IS NOT NULL AND excluded.web_server != '' THEN excluded.web_server ELSE devices.web_server END,
                workgroup = CASE WHEN excluded.workgroup IS NOT NULL AND excluded.workgroup != '' THEN excluded.workgroup ELSE devices.workgroup END,
                user_name = CASE WHEN excluded.user_name IS NOT NULL AND excluded.user_name != '' THEN excluded.user_name ELSE devices.user_name END,
                open_ports = CASE WHEN excluded.open_ports IS NOT NULL THEN excluded.open_ports ELSE devices.open_ports END,
                services = CASE WHEN excluded.services IS NOT NULL THEN excluded.services ELSE devices.services END,
                is_online = 1,
                is_gateway = excluded.is_gateway,
                rtt_ms = excluded.rtt_ms,
                is_self = excluded.is_self,
                ttl = CASE WHEN excluded.ttl IS NOT NULL THEN excluded.ttl ELSE devices.ttl END,
                is_randomized_mac = CASE WHEN excluded.is_randomized_mac IS NOT NULL THEN excluded.is_randomized_mac ELSE devices.is_randomized_mac END,
                mac_type = CASE WHEN excluded.mac_type IS NOT NULL THEN excluded.mac_type ELSE devices.mac_type END,
                alias = CASE WHEN excluded.alias IS NOT NULL THEN excluded.alias ELSE devices.alias END,
                profile_id = CASE WHEN excluded.profile_id IS NOT NULL THEN excluded.profile_id ELSE devices.profile_id END,
                matched_by = CASE WHEN excluded.matched_by IS NOT NULL THEN excluded.matched_by ELSE devices.matched_by END,
                dhcp_vendor_class = CASE WHEN excluded.dhcp_vendor_class IS NOT NULL AND excluded.dhcp_vendor_class != '' AND excluded.dhcp_vendor_class != 'VENDOR_CLASS_DATA' THEN excluded.dhcp_vendor_class ELSE devices.dhcp_vendor_class END,
                dhcp_fingerprint = CASE WHEN excluded.dhcp_fingerprint IS NOT NULL AND excluded.dhcp_fingerprint != '' AND excluded.dhcp_fingerprint NOT LIKE '%VENDOR_CLASS_DATA%' THEN excluded.dhcp_fingerprint ELSE devices.dhcp_fingerprint END,
                dhcp_client_id = CASE WHEN excluded.dhcp_client_id IS NOT NULL AND excluded.dhcp_client_id != '' THEN excluded.dhcp_client_id ELSE devices.dhcp_client_id END,
                dhcp_fqdn = CASE WHEN excluded.dhcp_fqdn IS NOT NULL AND excluded.dhcp_fqdn != '' THEN excluded.dhcp_fqdn ELSE devices.dhcp_fqdn END,
                match_score = CASE WHEN excluded.match_score IS NOT NULL THEN excluded.match_score ELSE devices.match_score END,
                candidate_profile_id = CASE WHEN excluded.candidate_profile_id IS NOT NULL THEN excluded.candidate_profile_id ELSE devices.candidate_profile_id END,
                distance_zone = CASE WHEN excluded.distance_zone IS NOT NULL THEN excluded.distance_zone ELSE devices.distance_zone END,
                estimated_range = CASE WHEN excluded.estimated_range IS NOT NULL THEN excluded.estimated_range ELSE devices.estimated_range END,
                ipv6_link_local = CASE WHEN excluded.ipv6_link_local IS NOT NULL AND excluded.ipv6_link_local != '' THEN excluded.ipv6_link_local ELSE devices.ipv6_link_local END,
                ipv6_global = CASE WHEN excluded.ipv6_global IS NOT NULL AND excluded.ipv6_global != '' THEN excluded.ipv6_global ELSE devices.ipv6_global END,
                ipv6_addresses = CASE WHEN excluded.ipv6_addresses IS NOT NULL AND excluded.ipv6_addresses != '[]' THEN excluded.ipv6_addresses ELSE devices.ipv6_addresses END,
                is_dual_stack = CASE WHEN excluded.is_dual_stack IS NOT NULL THEN excluded.is_dual_stack ELSE devices.is_dual_stack END,
                profile_status = CASE WHEN excluded.profiled_at IS NOT NULL THEN excluded.profile_status ELSE devices.profile_status END,
                vendor_confidence = CASE WHEN excluded.profiled_at IS NOT NULL THEN excluded.vendor_confidence ELSE devices.vendor_confidence END,
                type_confidence = CASE WHEN excluded.profiled_at IS NOT NULL THEN excluded.type_confidence ELSE devices.type_confidence END,
                hostname_confidence = CASE WHEN excluded.profiled_at IS NOT NULL THEN excluded.hostname_confidence ELSE devices.hostname_confidence END,
                profile_evidence = CASE WHEN excluded.profiled_at IS NOT NULL THEN excluded.profile_evidence ELSE devices.profile_evidence END,
                profiled_at = CASE WHEN excluded.profiled_at IS NOT NULL THEN excluded.profiled_at ELSE devices.profiled_at END,
                profile_version = CASE WHEN excluded.profiled_at IS NOT NULL THEN excluded.profile_version ELSE devices.profile_version END,
                is_archived = 0,
                last_seen = datetime('now', 'localtime')
        `;
        const upsertStmt = this.db.prepare(upsertQuery);

        const clearSessionStmt = this.db.prepare(`UPDATE devices SET session_id = NULL WHERE network_id = ? AND LOWER(mac) = LOWER(?)`);

        const setOfflineStmt = this.db.prepare(`
            UPDATE devices
            SET is_online = 0,
                last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END,
                ip = ''
            WHERE network_id = ?
              AND LOWER(mac) = LOWER(?)
              AND (is_self IS NULL OR is_self = 0)
              AND (is_gateway IS NULL OR is_gateway = 0)
              AND (last_seen IS NULL OR last_seen < datetime('now', 'localtime', '-${OFFLINE_GRACE_SECONDS} seconds'))
        `);

        const disassociateStaleIpStmt = this.db.prepare(`
            UPDATE devices
            SET is_online = 0,
                last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END,
                ip = ''
            WHERE network_id = ? AND ip = ? AND LOWER(mac) != LOWER(?)
              AND (is_gateway IS NULL OR is_gateway = 0)
              AND (is_self IS NULL OR is_self = 0)
        `);

        // Eksekusi atomik menggunakan db.transaction native better-sqlite3
        const syncTransaction = this.db.transaction(() => {
            // 1. Proses perangkat yang baru saja tertangkap di scan
            for (const rawScanned of scannedDevices) {
                const macKey = normalizeMacAddress(rawScanned.mac);
                const scanned = rawScanned.mac === macKey
                    ? rawScanned
                    : { ...rawScanned, mac: macKey };
                scannedMacs.add(macKey);

                // Pastikan hanya 1 gateway aktif di jaringan ini
                if (scanned.is_gateway) {
                    resetGatewayStmt.run(networkId, macKey);
                }

                // Disosiasikan IP ini dari perangkat lain jika ada yang memegang IP sama di jaringan ini
                disassociateStaleIpStmt.run(networkId, scanned.ip, macKey);

                const existing = existingMap.get(macKey);
                let isBlocked = existing ? existing.is_blocked : false;
                let sessionId = existing ? existing.session_id : undefined;
                let inheritedAlias = existing ? existing.alias : undefined;
                let inheritedFirstSeen: any = null;
                let currentSpeedLimit = existing?.speed_limit ?? 100;
                let profileId = existing ? existing.profile_id : undefined;
                let matchedBy = existing ? existing.matched_by : undefined;
                let matchScore: number | undefined = existing ? existing.match_score : undefined;
                let candidateProfileId: string | undefined = existing ? existing.candidate_profile_id : undefined;
                let scannedAssessment: ReturnType<typeof validateProfileAssessment> | null = null;
                if (scanned.profiled_at !== undefined) {
                    scannedAssessment = validateProfileAssessment({
                        mac: scanned.mac,
                        ip: scanned.ip,
                        vendor: scanned.vendor,
                        device_type: scanned.device_type,
                        hostname: scanned.hostname,
                        os: scanned.os,
                        vendor_confidence: scanned.vendor_confidence as number,
                        type_confidence: scanned.type_confidence as number,
                        hostname_confidence: scanned.hostname_confidence as number,
                        profile_status: scanned.profile_status as ProfileStatus,
                        profile_evidence: scanned.profile_evidence as ProfileEvidence[],
                        profiled_at: scanned.profiled_at,
                        profile_version: scanned.profile_version as number
                    }, macKey);
                }

                // Jika perangkat baru / tidak ada di existing, terapkan Multi-Factor Fingerprint Scoring
                if (!existing) {
                    let bestProfile: any = null;
                    let bestScore = 0;
                    let bestReasons: string[] = [];

                    for (const prof of profiles) {
                        const result = calculateProfileMatchScore(scanned, prof, existingDevices, allScannedMacSet);
                        if (result.score > bestScore) {
                            bestScore = result.score;
                            bestProfile = prof;
                            bestReasons = result.reasons;
                        }
                    }

                    matchScore = bestScore;

                    const isHighConfidence = bestScore >= 80;
                    const hasOtherOnlineInProfile = bestProfile ? existingDevices.some(
                        d => d.network_id === networkId &&
                             d.profile_id === bestProfile.id &&
                             d.is_online &&
                             allScannedMacSet.has(d.mac.toLowerCase()) &&
                             d.mac.toLowerCase() !== macKey
                    ) : false;
                    const isContinuityFusing = Boolean(
                        bestProfile &&
                        !isHighConfidence &&
                        bestScore >= 60 &&
                        !hasOtherOnlineInProfile &&
                        scanned.is_randomized_mac &&
                        bestReasons.includes('recent_disconnect_continuity (+15)') &&
                        (bestReasons.includes('dhcp_prl_signature_match (+30)') || bestReasons.includes('generic_factory_hostname_match (+20)'))
                    );

                    if (bestProfile && !hasOtherOnlineInProfile && (isHighConfidence || isContinuityFusing)) {
                        // High Confidence (>= 80%) or Verified Continuity Fusing (>= 60%): Auto-Link & Auto-Reblock
                        const matchTypeLabel = isHighConfidence
                            ? `HIGH CONFIDENCE (${bestScore}%)`
                            : `CONTINUITY FUSING (${bestScore}%)`;
                        this.log.info({
                            matchType: matchTypeLabel,
                            ip: scanned.ip,
                            mac: scanned.mac,
                            profileAlias: bestProfile.alias,
                            reasons: bestReasons
                        }, `[${matchTypeLabel}] Device ${scanned.ip} (${scanned.mac}) matched profile "${bestProfile.alias}" (${bestReasons.join(', ')})`);
                        // Auto-reblock HANYA bila perangkat dengan profil ini pernah diblokir DI JARINGAN INI!
                        const wasBlockedInThisNetwork = existingDevices.some(
                            d => d.network_id === networkId && d.profile_id === bestProfile.id && d.is_blocked
                        );
                        isBlocked = wasBlockedInThisNetwork;
                        inheritedAlias = bestProfile.alias;
                        inheritedFirstSeen = bestProfile.created_at || null;
                        profileId = bestProfile.id;
                        matchedBy = isHighConfidence ? 'high_confidence_multi_factor' : 'continuity_randomized_mac_fusing';
                        if (isBlocked) {
                            currentSpeedLimit = 0;
                        } else {
                            const existingNetDev = existingDevices.find(
                                d => d.network_id === networkId && d.profile_id === bestProfile.id
                            );
                            if (existingNetDev && existingNetDev.speed_limit !== undefined && existingNetDev.speed_limit < 100) {
                                currentSpeedLimit = existingNetDev.speed_limit;
                            }
                        }

                        // Tambahkan MAC baru ke linked_macs (capped max 10 to prevent profile bloat)
                        const currentLinked = Array.isArray(bestProfile.linked_macs)
                            ? bestProfile.linked_macs
                            : safeParseJson<string[]>(bestProfile.linked_macs, []);
                        const updatedLinked = Array.from(new Set([...currentLinked, macKey])).slice(-10);
                        updateProfileLinkedMacsStmt.run(JSON.stringify(updatedLinked), profileId);

                        // AUTO-ARCHIVE SUPERSEDED OFFLINE MACs FOR THIS PROFILE IN THIS NETWORK!
                        const zombieRows = selectArchivedSessionsStmt.all(networkId, profileId, macKey) as any[];
                        for (const r of zombieRows) {
                            if (r.session_id) {
                                zombieSessionsToStop.push(r.session_id);
                            }
                        }
                        archiveDevicesStmt.run(networkId, profileId, macKey);
                    } else if (bestProfile && bestScore >= 50) {
                        this.log.info({
                            score: bestScore,
                            ip: scanned.ip,
                            mac: scanned.mac,
                            profileAlias: bestProfile.alias,
                            reasons: bestReasons
                        }, `[CANDIDATE PROFILE REVIEW (${bestScore}%)] Device ${scanned.ip} (${scanned.mac}) looks similar to profile "${bestProfile.alias}", marked as candidate without blocking.`);
                        candidateProfileId = bestProfile.id;
                        matchedBy = 'candidate_review';
                        isBlocked = false;
                    }
                }

                // Sesi tersimpan yang TIDAK ada di daftar sesi HIDUP engine = BASI (mati) → perlakukan
                // sebagai belum ter-enforce. Hanya bila info engine tersedia (liveSessionIds != undefined);
                // bila engine tak terjangkau, percayai session_id tersimpan (hindari badai reblock palsu).
                if (liveSessionIds !== undefined && sessionId && !liveSessionIds.has(sessionId)) {
                    sessionId = undefined;
                    clearSessionStmt.run(networkId, macKey);
                }
                // Perangkat perlu auto-reblock/auto-throttle HANYA jika belum aktif sesi spoof-nya (baru online / ganti MAC / sesi basi)
                // INVARIAN 1 & 2: Gateway dan Operator Controller (is_self) TIDAK BOLEH ditarget auto-reblock/throttle!
                const isTargetSafe = !scanned.is_self && !scanned.is_gateway && !existing?.is_self && !existing?.is_gateway;
                const needsSpoofSession = isTargetSafe && (!existing || !existing.is_online || !sessionId);

                if (isBlocked && currentSpeedLimit === 0 && needsSpoofSession) {
                    autoReblockTargets.push({
                        ...scanned,
                        network_id: networkId,
                        is_blocked: true,
                        speed_limit: 0,
                        session_id: sessionId
                    });
                } else if (currentSpeedLimit > 0 && currentSpeedLimit < 100 && needsSpoofSession) {
                    autoThrottleTargets.push({
                        ...scanned,
                        network_id: networkId,
                        is_blocked: false,
                        speed_limit: currentSpeedLimit,
                        session_id: sessionId
                    });
                }

                const incomingHostname = existing && isGenericProfileLabel(scanned.hostname, 'hostname')
                    ? ''
                    : scanned.hostname || '';
                const incomingVendor = existing && isGenericProfileLabel(scanned.vendor, 'vendor')
                    ? ''
                    : scanned.vendor || '';
                const incomingOs = existing && isGenericProfileLabel(scanned.os, 'os')
                    ? ''
                    : scanned.os || '';
                const incomingDeviceType = existing && isGenericProfileLabel(scanned.device_type, 'device_type')
                    ? ''
                    : scanned.device_type || 'Unknown';

                upsertStmt.run(
                    networkId,
                    scanned.mac,
                    scanned.ip,
                    scanned.ip, // last_ip
                    incomingHostname,
                    incomingVendor,
                    incomingOs,
                    incomingDeviceType,
                    scanned.web_title || '',
                    scanned.web_server || '',
                    scanned.workgroup || '',
                    scanned.user_name || '',
                    JSON.stringify(scanned.open_ports || []),
                    JSON.stringify(scanned.services || []),
                    isBlocked ? 1 : 0,
                    scanned.is_gateway ? 1 : 0,
                    scanned.rtt_ms || 0,
                    sessionId || null,
                    scanned.is_self ? 1 : 0,
                    scanned.ttl || null,
                    scanned.is_randomized_mac ? 1 : 0,
                    scanned.mac_type || null,
                    inheritedAlias || scanned.alias || null,
                    profileId || scanned.profile_id || null,
                    matchedBy || scanned.matched_by || null,
                    currentSpeedLimit,
                    scanned.dhcp_vendor_class || null,
                    scanned.dhcp_fingerprint || null,
                    scanned.dhcp_client_id || null,
                    scanned.dhcp_fqdn || null,
                    matchScore || null,
                    candidateProfileId || null,
                    inheritedFirstSeen,
                    scanned.distance_zone || 'unknown',
                    scanned.estimated_range || '-',
                    scanned.ipv6_link_local || null,
                    scanned.ipv6_global || null,
                    JSON.stringify(scanned.ipv6_addresses || []),
                    scanned.is_dual_stack ? 1 : 0,
                    scannedAssessment?.profile_status ?? null,
                    scannedAssessment?.vendor_confidence ?? null,
                    scannedAssessment?.type_confidence ?? null,
                    scannedAssessment?.hostname_confidence ?? null,
                    scannedAssessment?.evidenceJson ?? null,
                    scannedAssessment?.profiled_at ?? null,
                    scannedAssessment?.profile_version ?? null
                );

                if (scanned.is_self) {
                    clearOtherSelfStmt.run(networkId, scanned.mac);
                }
            }

            // 2. Tandai perangkat yang tidak tertangkap di scan ini sebagai is_online = 0 (SCOPED KE network_id)
            // Terapkan grace period (OFFLINE_GRACE_SECONDS): Perangkat yang baru saja terlihat tidak langsung di-offline-kan
            for (const [macKey] of existingMap.entries()) {
                if (!scannedMacs.has(macKey)) {
                    setOfflineStmt.run(networkId, macKey);
                }
            }
        });

        syncTransaction();

        // Ambil data terbaru seluruh perangkat dari database untuk network ini
        const updatedDevices = await this.getAllDevices(networkId);
        return {
            allDevices: updatedDevices,
            autoReblockTargets,
            autoThrottleTargets,
            zombieSessionsToStop
        };
    }

    private rowToDevice(row: any): Device {
        return this.deviceRepo.rowToDevice(row);
    }

    async saveLicenseCache(lic: CachedLicense): Promise<void> {
        await this.init();
        return this.licenseRepo.saveLicenseCache(lic);
    }

    async getLicenseCache(): Promise<CachedLicense | null> {
        await this.init();
        return this.licenseRepo.getLicenseCache();
    }

    getCachedLicense(): CachedLicense | null {
        return this.licenseRepo.getCachedLicense();
    }

    async saveCachedLicense(lic: CachedLicense): Promise<void> {
        return this.saveLicenseCache(lic);
    }

    async clearLicenseCache(): Promise<void> {
        await this.init();
        return this.licenseRepo.clearLicenseCache();
    }

    async close(): Promise<void> {
        try {
            this.db.close();
            this.log.info('SQLite database connection closed');
        } catch (err) {
            // Already closed
        }
    }
}

// Re-export all database utilities for full backward compatibility
export * from '../utils/databaseUtils';
export { DatabaseService as SentinelDatabase };
