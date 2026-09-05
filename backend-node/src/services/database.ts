import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Device, CachedLicense, ProfileAssessment, ProfileEvidence, ProfileStatus } from '../types';

/**
 * Grace period (detik) sebelum perangkat yang hilang dari hasil scan ditandai offline.
 * Anti-flapping untuk ponsel yang masuk doze mode. Sumber tunggal kebenaran — dipakai
 * oleh SQL setOffline dan diimpor oleh test agar SQL & test tidak lagi berbeda (75 vs 90).
 */
export const OFFLINE_GRACE_SECONDS = 75;
const MAX_PROFILE_EVIDENCE_BYTES = 32 * 1024;
const PROFILE_STATUSES = new Set<ProfileStatus>(['high', 'medium', 'unknown']);
const PROFILE_EVIDENCE_STRENGTHS = new Set<ProfileEvidence['strength']>([
    'weak',
    'medium',
    'strong',
    'explicit'
]);
const MAC_ADDRESS_PATTERN = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export const GENERIC_FACTORY_PATTERNS = [
    /^galaxy[\s\-_]?(a|s|z|m|note|tab|fold|flip|j)[\s\-_]?[0-9]+/i,
    /^redmi[\s\-_]?(note[\s\-_]?)?[0-9]+/i,
    /^poco[\s\-_]?(x|f|m|c)[\s\-_]?[0-9]+/i,
    /^infinix[\s\-_]?(hot|note|zero|smart)[\s\-_]?[0-9]+/i,
    /^tecno[\s\-_]?(spark|camon|pova)[\s\-_]?[0-9]+/i,
    /^realme[\s\-_]?(c|gt|narzo)[\s\-_]?[0-9]+/i,
    /^oppo[\s\-_]?(a|f|reno|find)[\s\-_]?[0-9]+/i,
    /^vivo[\s\-_]?(v|y|x|t)[\s\-_]?[0-9]+/i,
    /^vivo[\s\-_]?[0-9]{4}/i, // vivo-1904 model number
    /^oneplus[\s\-_]?[0-9]+/i,
    /^pixel[\s\-_]?[0-9]+/i,
    /^iphone$/i,
    /^ipad$/i,
    /^desktop\-[a-z0-9]{5,8}$/i,
    /^laptop\-[a-z0-9]{5,8}$/i,
    /^android\-[a-z0-9]{5,16}$/i
];

export const GENERIC_EXACT_BLACKLIST = new Set([
    'unknown', 'gateway', 'this pc', 'perangkat ini', 'router', 'router / ap (local mac)',
    'android', 'iphone', 'windows', 'pc', 'laptop', 'device', 'phone', 'desktop'
]);

/**
 * Turunkan profile_id dari hex MAC penuh (12 char) — unik per NIC & bebas kolisi.
 * Menggantikan skema lama berbasis hostname yang membuat dua perangkat berhostname
 * sama (mis. "android", kosong) tergabung ke satu profil.
 */
export function deriveProfileId(mac: string): string {
    return `prof_${(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '')}`;
}

export function isGenericFactoryHostname(hostname: string): boolean {
    if (!hostname) return true;
    const clean = hostname.trim().toLowerCase();
    if (GENERIC_EXACT_BLACKLIST.has(clean)) return true;
    for (const pattern of GENERIC_FACTORY_PATTERNS) {
        if (pattern.test(clean)) return true;
    }
    return false;
}

export function calculateProfileMatchScore(
    scanned: Device,
    profile: any,
    existingDevices: Device[] = []
): { score: number; reasons: string[] } {
    const sCid = (scanned.dhcp_client_id || '').trim().toLowerCase();

    // =========================================================================
    // TIER 1: DUID-FIRST FAST-TRACK (Instant 100% Match)
    // Jika perangkat memiliki Hardware DUID unik (Option 61) dan cocok dengan profil,
    // maka 100% PASTI mesin fisik yang sama -> bypass faktor lain & langsung 100 Poin!
    // =========================================================================
    if (sCid && sCid !== '' && !sCid.startsWith('00:00:00:00:00:00')) {
        let pCid = (profile.dhcp_client_id || '').trim().toLowerCase();
        if (!pCid && existingDevices.length > 0) {
            const linkedDev = existingDevices.find(
                d => d.profile_id === profile.id && (d.dhcp_client_id || '').trim().toLowerCase() === sCid
            );
            if (linkedDev) {
                pCid = (linkedDev.dhcp_client_id || '').trim().toLowerCase();
            }
        }

        if (pCid && pCid === sCid) {
            return {
                score: 100,
                reasons: ['duid_hardware_instant_match (+100)']
            };
        }
    }

    // =========================================================================
    // TIER 2: MULTI-FACTOR HEURISTICS FALLBACK
    // Untuk perangkat yang DUID-nya disamarkan / diacak bersamaan dengan MAC (iOS/Android)
    // =========================================================================
    let score = 0;
    const reasons: string[] = [];

    const sHost = (scanned.hostname || '').trim().toLowerCase();
    const pHost = (profile.hostname || '').trim().toLowerCase();
    const pAlias = (profile.alias || '').trim().toLowerCase();

    // 1. Hostname Evaluation (Maks 45 Poin)
    if (sHost && (sHost === pHost || sHost === pAlias)) {
        if (isGenericFactoryHostname(sHost)) {
            score += 20;
            reasons.push('generic_factory_hostname_match (+20)');
        } else {
            score += 45;
            reasons.push('personalized_unique_hostname_match (+45)');
        }
    }

    // 2. DHCP Option 55 PRL Signature (Maks 30 Poin)
    const sFp = (scanned.dhcp_fingerprint || '').trim().toLowerCase();
    let pFp = (profile.dhcp_fingerprint || '').trim().toLowerCase();
    if (!pFp && existingDevices.length > 0) {
        const linkedDev = existingDevices.find(d => d.profile_id === profile.id && d.dhcp_fingerprint);
        if (linkedDev) pFp = (linkedDev.dhcp_fingerprint || '').trim().toLowerCase();
    }

    if (sFp && pFp) {
        if (sFp === pFp) {
            score += 30;
            reasons.push('dhcp_prl_signature_match (+30)');
        } else {
            if ((sFp.includes('windows') && pFp.includes('android')) || (sFp.includes('android') && pFp.includes('windows'))) {
                return { score: 0, reasons: ['contradictory_os_signature (disqualified)'] };
            }
        }
    }

    // 3. DHCP Option 60 Vendor Class (Maks 15 Poin)
    const sVc = (scanned.dhcp_vendor_class || '').trim().toLowerCase();
    let pVc = (profile.dhcp_vendor_class || '').trim().toLowerCase();
    if (!pVc && existingDevices.length > 0) {
        const linkedDev = existingDevices.find(d => d.profile_id === profile.id && d.dhcp_vendor_class);
        if (linkedDev) pVc = (linkedDev.dhcp_vendor_class || '').trim().toLowerCase();
    }

    if (sVc && pVc && sVc === pVc) {
        score += 15;
        reasons.push('dhcp_vendor_class_match (+15)');
    }

    // 4. Offline Timing Window Continuity (Maks 10 Poin)
    if (Array.isArray(profile.linked_macs) && profile.linked_macs.length > 0) {
        const matchingLinked = existingDevices.find(
            d => profile.linked_macs.map((m: string) => m.toLowerCase()).includes(d.mac.toLowerCase()) && !d.is_online
        );
        if (matchingLinked && matchingLinked.last_seen) {
            const lastSeenTime = new Date(matchingLinked.last_seen).getTime();
            const now = Date.now();
            if (!isNaN(lastSeenTime) && now - lastSeenTime <= 10 * 60 * 1000) {
                score += 10;
                reasons.push('recent_disconnect_continuity (+10)');
            }
        }
    }

    // 5. Secondary DUID / Partial Match (Bonus 15 Poin)
    if (sCid && sCid !== '') {
        const duidMatch = existingDevices.find(
            d => (d.dhcp_client_id || '').trim().toLowerCase() === sCid && d.profile_id === profile.id
        );
        if (duidMatch) {
            score += 15;
            reasons.push('duid_match (+15)');
        }
    }

    return { score: Math.min(100, score), reasons };
}

function safeParseJson<T>(val: any, fallback: T): T {
    if (!val) return fallback;
    if (Array.isArray(val)) return val as unknown as T;
    if (typeof val === 'string') {
        try {
            return JSON.parse(val);
        } catch {
            return fallback;
        }
    }
    return fallback;
}

function normalizeMacAddress(mac: unknown): string {
    if (typeof mac !== 'string') {
        throw new Error('Invalid profile MAC address');
    }
    const normalized = mac.trim().replace(/-/g, ':').toLowerCase();
    if (!MAC_ADDRESS_PATTERN.test(normalized)) {
        throw new Error('Invalid profile MAC address');
    }
    return normalized;
}

function isGenericProfileLabel(value: unknown, field: 'vendor' | 'device_type' | 'hostname' | 'os'): boolean {
    if (typeof value !== 'string' || value.trim() === '') return true;
    const normalized = value.trim().toLowerCase();
    if (normalized === '-' || normalized === 'n/a' || normalized === 'none') return true;
    if (normalized === 'unknown' || normalized.startsWith('unknown ')) return true;
    if (normalized === 'generic' || normalized.startsWith('generic ')) return true;
    if (field === 'vendor' && normalized.startsWith('private device')) return true;
    if (field === 'hostname' && normalized === 'device') return true;
    if (field === 'device_type' && (normalized === 'device' || normalized === 'client device')) return true;
    return false;
}

function validateConfidence(value: unknown, field: string): number {
    if (!Number.isFinite(value) || !Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) {
        throw new Error(`${field} confidence must be a finite integer from 0 to 100`);
    }
    return value as number;
}

function serializeProfileEvidence(evidence: unknown): string {
    if (!Array.isArray(evidence)) {
        throw new Error('Profile evidence must be an array');
    }
    for (const item of evidence) {
        const entry = item as Record<string, unknown>;
        if (
            !item
            || typeof item !== 'object'
            || typeof entry.source !== 'string'
            || typeof entry.group !== 'string'
            || typeof entry.field !== 'string'
            || typeof entry.value !== 'string'
            || typeof entry.observed_at !== 'string'
            || !PROFILE_EVIDENCE_STRENGTHS.has(entry.strength as ProfileEvidence['strength'])
        ) {
            throw new Error('Profile evidence contains a malformed entry');
        }
    }

    let serialized: string;
    try {
        serialized = JSON.stringify(evidence);
    } catch {
        throw new Error('Profile evidence must be JSON serializable');
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PROFILE_EVIDENCE_BYTES) {
        throw new Error('Profile evidence must not exceed 32 KiB');
    }
    return serialized;
}

function validateProfileAssessment(
    profile: ProfileAssessment,
    normalizedMac?: string
): ProfileAssessment & { evidenceJson: string } {
    if (!profile || typeof profile !== 'object') {
        throw new Error('Profile assessment is required');
    }
    const mac = normalizedMac ?? normalizeMacAddress(profile.mac);
    if (typeof profile.ip !== 'string' || profile.ip.trim() === '') {
        throw new Error('Profile IP address is required');
    }
    if (!PROFILE_STATUSES.has(profile.profile_status)) {
        throw new Error('Invalid profile status');
    }
    if (!Number.isInteger(profile.profile_version) || profile.profile_version <= 0) {
        throw new Error('Profile version must be a positive integer');
    }
    if (typeof profile.profiled_at !== 'string' || profile.profiled_at.trim() === '') {
        throw new Error('Profile timestamp is required');
    }
    for (const field of ['vendor', 'device_type', 'hostname', 'os'] as const) {
        if (typeof profile[field] !== 'string') {
            throw new Error(`Profile ${field} must be a string`);
        }
    }

    return {
        ...profile,
        mac,
        ip: profile.ip.trim(),
        vendor: profile.vendor.trim(),
        device_type: profile.device_type.trim(),
        hostname: profile.hostname.trim(),
        os: profile.os.trim(),
        vendor_confidence: validateConfidence(profile.vendor_confidence, 'Vendor'),
        type_confidence: validateConfidence(profile.type_confidence, 'Type'),
        hostname_confidence: validateConfidence(profile.hostname_confidence, 'Hostname'),
        profiled_at: profile.profiled_at.trim(),
        evidenceJson: serializeProfileEvidence(profile.profile_evidence)
    };
}

function hasStoredValue(value: unknown): boolean {
    return value !== null
        && value !== undefined
        && (typeof value !== 'string' || value.trim() !== '');
}

function normalizeStoredSpeedLimit(value: unknown): number {
    if (value === null || value === undefined) return 100;
    const numericValue = typeof value === 'string' && value.trim() === ''
        ? Number.NaN
        : Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100
        ? numericValue
        : 100;
}

function timestampRank(value: unknown): number {
    if (typeof value !== 'string' || value.trim() === '') return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareNewestDeviceRows(left: any, right: any): number {
    const leftLastSeen = timestampRank(left.last_seen);
    const rightLastSeen = timestampRank(right.last_seen);
    const lastSeenDifference = leftLastSeen === rightLastSeen
        ? 0
        : rightLastSeen > leftLastSeen ? 1 : -1;
    if (lastSeenDifference !== 0) return lastSeenDifference;

    const leftProfiledAt = timestampRank(left.profiled_at);
    const rightProfiledAt = timestampRank(right.profiled_at);
    const profiledAtDifference = leftProfiledAt === rightProfiledAt
        ? 0
        : rightProfiledAt > leftProfiledAt ? 1 : -1;
    if (profiledAtDifference !== 0) return profiledAtDifference;

    const lowercaseDifference = Number(right.mac === String(right.mac).toLowerCase())
        - Number(left.mac === String(left.mac).toLowerCase());
    if (lowercaseDifference !== 0) return lowercaseDifference;

    return String(left.mac).localeCompare(String(right.mac));
}

function quoteSqlIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}

export class DatabaseService {
    private db: Database.Database;
    private initialized: boolean = false;
    private dbPath: string;
    /**
     * True bila file DB gagal dibuka & sistem memakai SQLite in-memory (data TIDAK
     * persist). Di-surface agar kondisi ini tidak "senyap" (P3). Bisa dibaca oleh
     * layer atas untuk memperingatkan operator.
     */
    public usingMemoryFallback: boolean = false;

    constructor(customDbPath?: string) {
        if (customDbPath) {
            this.dbPath = customDbPath;
        } else if (process.env.DB_FILE) {
            this.dbPath = path.resolve(process.env.DB_FILE);
        } else if (process.env.SENTINEL_DB_PATH) {
            this.dbPath = path.resolve(process.env.SENTINEL_DB_PATH);
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
            console.error(
                `\n❌❌❌ [DatabaseService] GAGAL membuka file DB ${this.dbPath} (${err.message}).\n` +
                `   → Beralih ke SQLite IN-MEMORY. PERINGATAN: seluruh data perangkat & lisensi\n` +
                `     TIDAK akan tersimpan permanen dan hilang saat aplikasi ditutup.\n` +
                `   → Periksa izin tulis folder data/ atau kunci file DB.\n`
            );
            this.db = new Database(':memory:');
        }
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

    async init(): Promise<void> {
        if (this.initialized) return;

        try {
            // Skema tabel devices
            this.db.exec(`
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
                    profile_status TEXT DEFAULT 'unknown',
                    vendor_confidence INTEGER DEFAULT 0,
                    type_confidence INTEGER DEFAULT 0,
                    hostname_confidence INTEGER DEFAULT 0,
                    profile_evidence TEXT DEFAULT '[]',
                    profiled_at TEXT,
                    profile_version INTEGER DEFAULT 1,
                    first_seen TEXT DEFAULT (datetime('now', 'localtime')),
                    last_seen TEXT DEFAULT (datetime('now', 'localtime'))
                );

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

                CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
                CREATE INDEX IF NOT EXISTS idx_devices_is_blocked ON devices(is_blocked);
                CREATE INDEX IF NOT EXISTS idx_devices_is_online ON devices(is_online);
                CREATE INDEX IF NOT EXISTS idx_devices_is_archived ON devices(is_archived);
                CREATE INDEX IF NOT EXISTS idx_devices_profile_id ON devices(profile_id);

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
            `);

            const additiveDeviceColumns = [
                ['last_ip', 'TEXT'],
                ['profile_status', "TEXT DEFAULT 'unknown'"],
                ['vendor_confidence', 'INTEGER DEFAULT 0'],
                ['type_confidence', 'INTEGER DEFAULT 0'],
                ['hostname_confidence', 'INTEGER DEFAULT 0'],
                ['profile_evidence', "TEXT DEFAULT '[]'"],
                ['profiled_at', 'TEXT'],
                ['profile_version', 'INTEGER DEFAULT 1']
            ] as const;
            for (const [column, definition] of additiveDeviceColumns) {
                const existingColumns = this.db.pragma('table_info(devices)') as Array<{ name: string }>;
                if (!existingColumns.some(existing => existing.name === column)) {
                    this.db.exec(`ALTER TABLE devices ADD COLUMN ${column} ${definition}`);
                }
            }

            this.reconcileCanonicalDeviceMacs();

            console.log(`✅ SQLite connected & schema initialized (${this.dbPath})`);
            this.initialized = true;
        } catch (error) {
            console.error('❌ Failed to initialize SQLite database:', error);
            throw error;
        }
    }

    private reconcileCanonicalDeviceMacs(): void {
        const deviceColumns = this.db.pragma('table_info(devices)') as Array<{ name: string }>;
        const deviceColumnNames = new Set(deviceColumns.map(column => column.name));
        if (!deviceColumnNames.has('mac')) return;

        const rows = this.db.prepare('SELECT rowid AS __rowid, * FROM devices').all() as any[];
        const groupedRows = new Map<string, any[]>();
        for (const row of rows) {
            let canonicalMac: string;
            try {
                canonicalMac = normalizeMacAddress(row.mac);
            } catch {
                continue;
            }
            const group = groupedRows.get(canonicalMac) || [];
            group.push(row);
            groupedRows.set(canonicalMac, group);
        }

        const groupsToRepair = Array.from(groupedRows.entries()).filter(
            ([canonicalMac, group]) => group.length > 1 || group[0].mac !== canonicalMac
        );
        const canonicalProfileIds = new Map<string, string>();

        const repairTransaction = this.db.transaction(() => {
            for (const [canonicalMac, group] of groupsToRepair) {
                const ordered = [...group].sort(compareNewestDeviceRows);
                const merged = { ...ordered[0], mac: canonicalMac };

                const pickNewestValue = (field: string): any => {
                    const source = ordered.find(row => hasStoredValue(row[field]));
                    return source ? source[field] : merged[field];
                };
                for (const field of ['hostname', 'vendor', 'os', 'device_type'] as const) {
                    if (deviceColumnNames.has(field)) {
                        const identitySource = ordered.find(
                            row => hasStoredValue(row[field]) && !isGenericProfileLabel(row[field], field)
                        );
                        merged[field] = identitySource ? identitySource[field] : pickNewestValue(field);
                    }
                }
                for (const field of [
                    'web_title',
                    'web_server',
                    'workgroup',
                    'user_name',
                    'mac_type',
                    'alias',
                    'dhcp_vendor_class',
                    'dhcp_fingerprint',
                    'dhcp_client_id',
                    'dhcp_fqdn',
                    'candidate_profile_id'
                ]) {
                    if (deviceColumnNames.has(field)) {
                        merged[field] = pickNewestValue(field);
                    }
                }

                const profileSource = ordered.find(row => hasStoredValue(row.profile_id));
                if (profileSource) {
                    merged.profile_id = profileSource.profile_id;
                    merged.matched_by = hasStoredValue(profileSource.matched_by)
                        ? profileSource.matched_by
                        : pickNewestValue('matched_by');
                    canonicalProfileIds.set(canonicalMac, profileSource.profile_id);
                } else if (deviceColumnNames.has('matched_by')) {
                    merged.matched_by = pickNewestValue('matched_by');
                }

                if (deviceColumnNames.has('is_blocked')) {
                    merged.is_blocked = group.some(row => Boolean(row.is_blocked)) ? 1 : 0;
                }
                if (deviceColumnNames.has('is_redirected')) {
                    merged.is_redirected = group.some(row => Boolean(row.is_redirected)) ? 1 : 0;
                }
                if (deviceColumnNames.has('is_gateway')) {
                    merged.is_gateway = group.some(row => Boolean(row.is_gateway)) ? 1 : 0;
                }
                if (deviceColumnNames.has('is_self')) {
                    merged.is_self = group.some(row => Boolean(row.is_self)) ? 1 : 0;
                }
                if (deviceColumnNames.has('is_randomized_mac')) {
                    merged.is_randomized_mac = group.some(row => Boolean(row.is_randomized_mac)) ? 1 : 0;
                }
                if (deviceColumnNames.has('is_dual_stack')) {
                    merged.is_dual_stack = group.some(row => Boolean(row.is_dual_stack)) ? 1 : 0;
                }
                if (deviceColumnNames.has('is_archived')) {
                    merged.is_archived = group.every(row => Boolean(row.is_archived)) ? 1 : 0;
                }

                const intentRows = [...ordered].sort((left, right) => {
                    const rightIntent = Number(Boolean(right.is_blocked || right.is_redirected || hasStoredValue(right.session_id)));
                    const leftIntent = Number(Boolean(left.is_blocked || left.is_redirected || hasStoredValue(left.session_id)));
                    return rightIntent - leftIntent || compareNewestDeviceRows(left, right);
                });
                if (deviceColumnNames.has('session_id')) {
                    const sessionSource = intentRows.find(row => hasStoredValue(row.session_id));
                    merged.session_id = sessionSource ? sessionSource.session_id : merged.session_id;
                }
                if (deviceColumnNames.has('redirect_url')) {
                    const redirectSource = intentRows.find(
                        row => Boolean(row.is_redirected) && hasStoredValue(row.redirect_url)
                    ) || intentRows.find(row => hasStoredValue(row.redirect_url));
                    merged.redirect_url = redirectSource ? redirectSource.redirect_url : merged.redirect_url;
                }
                if (deviceColumnNames.has('speed_limit')) {
                    merged.speed_limit = Math.min(
                        ...group.map(row => normalizeStoredSpeedLimit(row.speed_limit))
                    );
                }

                const assessmentSource = [...ordered].sort((left, right) => {
                    const rightHasAssessment = Number(hasStoredValue(right.profiled_at));
                    const leftHasAssessment = Number(hasStoredValue(left.profiled_at));
                    if (rightHasAssessment !== leftHasAssessment) {
                        return rightHasAssessment - leftHasAssessment;
                    }
                    const leftProfiledAt = timestampRank(left.profiled_at);
                    const rightProfiledAt = timestampRank(right.profiled_at);
                    const profiledDifference = leftProfiledAt === rightProfiledAt
                        ? 0
                        : rightProfiledAt > leftProfiledAt ? 1 : -1;
                    if (profiledDifference !== 0) return profiledDifference;
                    const versionDifference = Number(right.profile_version || 0) - Number(left.profile_version || 0);
                    return versionDifference || compareNewestDeviceRows(left, right);
                })[0];
                for (const field of [
                    'profile_status',
                    'vendor_confidence',
                    'type_confidence',
                    'hostname_confidence',
                    'profile_evidence',
                    'profiled_at',
                    'profile_version'
                ]) {
                    if (deviceColumnNames.has(field)) {
                        merged[field] = assessmentSource[field];
                    }
                }

                if (deviceColumnNames.has('first_seen')) {
                    const firstSeenSource = [...group]
                        .filter(row => hasStoredValue(row.first_seen))
                        .sort((left, right) => {
                            const leftFirstSeen = timestampRank(left.first_seen);
                            const rightFirstSeen = timestampRank(right.first_seen);
                            const difference = leftFirstSeen === rightFirstSeen
                                ? 0
                                : leftFirstSeen < rightFirstSeen ? -1 : 1;
                            return difference || String(left.first_seen).localeCompare(String(right.first_seen));
                        })[0];
                    if (firstSeenSource) merged.first_seen = firstSeenSource.first_seen;
                }

                const survivor = group.find(row => row.mac === canonicalMac) || ordered[0];
                const deleteRow = this.db.prepare('DELETE FROM devices WHERE rowid = ?');
                for (const row of group) {
                    if (row.__rowid !== survivor.__rowid) deleteRow.run(row.__rowid);
                }

                const assignments = deviceColumns
                    .map(column => `${quoteSqlIdentifier(column.name)} = ?`)
                    .join(', ');
                this.db.prepare(`UPDATE devices SET ${assignments} WHERE rowid = ?`).run(
                    ...deviceColumns.map(column => merged[column.name]),
                    survivor.__rowid
                );
            }

            const profileColumns = this.db.pragma('table_info(device_profiles)') as Array<{ name: string }>;
            if (
                profileColumns.some(column => column.name === 'id')
                && profileColumns.some(column => column.name === 'linked_macs')
            ) {
                const profiles = this.db.prepare('SELECT id, linked_macs FROM device_profiles').all() as any[];
                const updateLinkedMacs = this.db.prepare(
                    'UPDATE device_profiles SET linked_macs = ? WHERE id = ?'
                );
                for (const profile of profiles) {
                    let linkedMacs: unknown;
                    try {
                        linkedMacs = JSON.parse(profile.linked_macs || '[]');
                    } catch {
                        continue;
                    }
                    if (!Array.isArray(linkedMacs)) continue;

                    const repaired: unknown[] = [];
                    const seen = new Set<string>();
                    for (const linkedMac of linkedMacs) {
                        let value = linkedMac;
                        if (typeof linkedMac === 'string') {
                            try {
                                value = normalizeMacAddress(linkedMac);
                            } catch {
                                value = linkedMac;
                            }
                        }
                        const key = typeof value === 'string'
                            ? `string:${value.toLowerCase()}`
                            : `json:${JSON.stringify(value)}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            repaired.push(value);
                        }
                    }
                    for (const [canonicalMac, profileId] of canonicalProfileIds) {
                        if (profileId === profile.id && !seen.has(`string:${canonicalMac}`)) {
                            seen.add(`string:${canonicalMac}`);
                            repaired.push(canonicalMac);
                        }
                    }

                    const serialized = JSON.stringify(repaired);
                    if (serialized !== profile.linked_macs) {
                        updateLinkedMacs.run(serialized, profile.id);
                    }
                }
            }
        });

        repairTransaction();
    }

    /**
     * Retensi: arsipkan (is_archived=1, bukan hapus — reversibel) perangkat "tamu"
     * yang sudah lama hilang, agar daftar mencerminkan jaringan nyata dan bukan
     * riwayat semua tamu. Diproteksi ketat: HANYA baris yang offline, last_seen lebih
     * tua dari `thresholdDays`, DAN tanpa niat pengguna atau identitas yang berharga:
     *   - tidak diblokir (is_blocked=0) dan tanpa sesi spoof (session_id NULL)
     *   - tanpa alias, profile_id, maupun candidate_profile_id
     *   - bukan operator (is_self) maupun gateway
     * Dengan begitu blokir, nama, profil fingerprint, dan sesi aktif tidak pernah hilang.
     * Mengembalikan jumlah baris yang diarsipkan.
     */
    async archiveStaleDevices(thresholdDays: number = 14): Promise<number> {
        await this.init();
        const stmt = this.db.prepare(`
            UPDATE devices
            SET is_archived = 1
            WHERE (is_online = 0 OR is_online IS NULL)
              AND last_seen IS NOT NULL
              AND last_seen < datetime('now', 'localtime', '-${Math.max(0, Math.floor(thresholdDays))} days')
              AND (is_blocked IS NULL OR is_blocked = 0)
              AND session_id IS NULL
              AND (alias IS NULL OR alias = '')
              AND profile_id IS NULL
              AND candidate_profile_id IS NULL
              AND (is_self IS NULL OR is_self = 0)
              AND (is_gateway IS NULL OR is_gateway = 0)
              AND (is_archived IS NULL OR is_archived = 0)
        `);
        const result = stmt.run();
        if (result.changes > 0) {
            console.log(`🧹 [Retention] Mengarsipkan ${result.changes} perangkat tamu yang offline > ${thresholdDays} hari.`);
        }
        return result.changes;
    }

    private async getDevices(includeArchived: boolean): Promise<Device[]> {
        await this.init();
        const archiveFilter = includeArchived
            ? ''
            : 'WHERE d.is_archived = 0 OR d.is_archived IS NULL';
        const query = `
            SELECT 
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
            ${archiveFilter}
            ORDER BY d.is_blocked DESC, d.is_online DESC, d.last_seen DESC
        `;
        const rows = this.db.prepare(query).all() as any[];
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

    async getAllDevices(): Promise<Device[]> {
        return this.getDevices(false);
    }

    private async getDevicesForReconciliation(): Promise<Device[]> {
        return this.getDevices(true);
    }

    async getDeviceByMac(mac: string): Promise<Device | null> {
        await this.init();
        const query = `
            SELECT d.*, p.linked_macs 
            FROM devices d
            LEFT JOIN device_profiles p ON d.profile_id = p.id
            WHERE LOWER(d.mac) = LOWER(?)
        `;
        const row = this.db.prepare(query).get(mac);
        if (!row) return null;
        return this.rowToDevice(row);
    }

    async getDeviceByIp(ip: string): Promise<Device | null> {
        await this.init();
        const query = `
            SELECT d.*, p.linked_macs 
            FROM devices d
            LEFT JOIN device_profiles p ON d.profile_id = p.id
            WHERE d.ip = ? 
            ORDER BY d.is_online DESC, d.last_seen DESC 
            LIMIT 1
        `;
        const row = this.db.prepare(query).get(ip);
        if (!row) return null;
        return this.rowToDevice(row);
    }

    async setDeviceBlocked(mac: string, isBlocked: boolean, sessionId?: string): Promise<void> {
        await this.init();
        const normMac = mac.toLowerCase();

        const updateDeviceStmt = this.db.prepare(`
            UPDATE devices 
            SET is_blocked = ?, session_id = ?, is_online = CASE WHEN ? = 1 THEN 1 ELSE is_online END, last_seen = datetime('now', 'localtime')
            WHERE LOWER(mac) = LOWER(?)
        `);
        updateDeviceStmt.run(isBlocked ? 1 : 0, sessionId || null, isBlocked ? 1 : 0, normMac);

        const dev = this.db.prepare(`SELECT * FROM devices WHERE LOWER(mac) = LOWER(?)`).get(normMac) as any;
        if (dev) {
            const pId = dev.profile_id || deriveProfileId(dev.mac);
            const pAlias = dev.alias || dev.hostname || 'Target Device';

            // Dapatkan linked_macs yang ada
            const existingProf = this.db.prepare(`SELECT linked_macs FROM device_profiles WHERE id = ?`).get(pId) as any;
            let linkedMacs: string[] = [normMac];
            if (existingProf && existingProf.linked_macs) {
                const parsed = safeParseJson<string[]>(existingProf.linked_macs, []);
                linkedMacs = Array.from(new Set([...parsed, normMac]));
            }

            const upsertProfileStmt = this.db.prepare(`
                INSERT INTO device_profiles (id, alias, hostname, os, vendor, device_type, is_blocked, linked_macs, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                ON CONFLICT(id) DO UPDATE SET
                    is_blocked = excluded.is_blocked,
                    linked_macs = excluded.linked_macs,
                    updated_at = datetime('now', 'localtime')
            `);
            upsertProfileStmt.run(
                pId, pAlias, dev.hostname, dev.os, dev.vendor, dev.device_type,
                isBlocked ? 1 : 0, JSON.stringify(linkedMacs)
            );

            this.db.prepare(`UPDATE devices SET profile_id = ? WHERE LOWER(mac) = LOWER(?)`).run(pId, normMac);
        }
    }

    async setDeviceOnlineStatus(mac: string, isOnline: boolean): Promise<void> {
        try {
            await this.init();
            this.db.prepare(
                `UPDATE devices SET is_online = ?, last_seen = datetime('now', 'localtime') WHERE LOWER(mac) = LOWER(?)`
            ).run(isOnline ? 1 : 0, mac.toLowerCase());
        } catch (e) {
            console.warn(`Notice updating online status for ${mac}:`, e);
        }
    }

    async setDeviceSpeedLimit(mac: string, speedLimit: number): Promise<Device> {
        await this.init();
        const normMac = mac.toLowerCase();
        const updateStmt = this.db.prepare(`
            UPDATE devices 
            SET speed_limit = ?, last_seen = datetime('now', 'localtime')
            WHERE LOWER(mac) = LOWER(?)
        `);
        const info = updateStmt.run(speedLimit, normMac);
        if (info.changes === 0) throw new Error(`Device with MAC ${mac} not found`);

        const dev = this.db.prepare(`SELECT * FROM devices WHERE LOWER(mac) = LOWER(?)`).get(normMac) as any;
        if (dev && dev.profile_id) {
            this.db.prepare(`UPDATE device_profiles SET speed_limit = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
                .run(speedLimit, dev.profile_id);
        }
        return this.rowToDevice(dev);
    }

    async setDeviceAlias(mac: string, alias: string): Promise<Device> {
        await this.init();
        const normMac = mac.toLowerCase();
        const existing = await this.getDeviceByMac(normMac);
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
            INSERT INTO device_profiles (id, alias, hostname, os, vendor, device_type, is_blocked, linked_macs, dhcp_fingerprint, dhcp_vendor_class, dhcp_client_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            ON CONFLICT(id) DO UPDATE SET
                alias = excluded.alias,
                linked_macs = excluded.linked_macs,
                dhcp_fingerprint = COALESCE(excluded.dhcp_fingerprint, device_profiles.dhcp_fingerprint),
                dhcp_vendor_class = COALESCE(excluded.dhcp_vendor_class, device_profiles.dhcp_vendor_class),
                dhcp_client_id = COALESCE(excluded.dhcp_client_id, device_profiles.dhcp_client_id),
                updated_at = datetime('now', 'localtime')
        `).run(
            pId, alias, existing.hostname, existing.os, existing.vendor, existing.device_type,
            existing.is_blocked ? 1 : 0, JSON.stringify(linkedMacs),
            existing.dhcp_fingerprint || null,
            existing.dhcp_vendor_class || null,
            existing.dhcp_client_id || null
        );

        this.db.prepare(`
            UPDATE devices 
            SET alias = ?, profile_id = ?, is_online = 1, last_seen = datetime('now', 'localtime') 
            WHERE LOWER(mac) = LOWER(?) OR profile_id = ?
        `).run(alias, pId, normMac, pId);

        const updated = await this.getDeviceByMac(normMac);
        if (updated) {
            updated.is_online = true;
        }
        return updated!;
    }

    async deleteDevice(mac: string): Promise<void> {
        await this.init();
        const normMac = mac.toLowerCase();
        const existing = await this.getDeviceByMac(normMac);

        if (existing?.profile_id) {
            this.db.prepare(`DELETE FROM devices WHERE profile_id = ? OR LOWER(mac) = LOWER(?)`).run(existing.profile_id, normMac);
            this.db.prepare(`DELETE FROM device_profiles WHERE id = ?`).run(existing.profile_id);
        } else {
            this.db.prepare(`DELETE FROM devices WHERE LOWER(mac) = LOWER(?)`).run(normMac);
            const allProfiles = this.db.prepare(`SELECT * FROM device_profiles`).all() as any[];
            for (const p of allProfiles) {
                const linked = safeParseJson<string[]>(p.linked_macs, []);
                if (linked.map(m => m.toLowerCase()).includes(normMac)) {
                    const nextLinked = linked.filter(m => m.toLowerCase() !== normMac);
                    if (nextLinked.length === 0) {
                        this.db.prepare(`DELETE FROM device_profiles WHERE id = ?`).run(p.id);
                    } else {
                        this.db.prepare(`UPDATE device_profiles SET linked_macs = ? WHERE id = ?`).run(JSON.stringify(nextLinked), p.id);
                    }
                }
            }
        }
    }

    async clearAllDevices(): Promise<void> {
        await this.init();
        this.db.exec("DELETE FROM devices; DELETE FROM device_profiles;");
    }

    async saveDevice(device: Device): Promise<void> {
        await this.init();
        const normMac = device.mac.toLowerCase();
        const saveTransaction = this.db.transaction(() => {
            // Disosiasikan IP ini dari perangkat lain jika ada yang memegang IP sama
            this.db.prepare(`UPDATE devices SET is_online = 0, last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END, ip = '' WHERE ip = ? AND LOWER(mac) != LOWER(?)`).run(device.ip, normMac);
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
                WHERE LOWER(mac) = LOWER(?)
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
                normMac
            );
        });
        saveTransaction();
    }

    async updateDeviceIp(mac: string, ip: string): Promise<void> {
        await this.init();
        const normMac = mac.toLowerCase();
        const updateTransaction = this.db.transaction(() => {
            this.db.prepare(`UPDATE devices SET is_online = 0, last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END, ip = '' WHERE ip = ? AND LOWER(mac) != LOWER(?)`).run(ip, normMac);
            this.db.prepare(`UPDATE devices SET ip = ?, last_ip = ?, is_online = 1, last_seen = datetime('now', 'localtime') WHERE LOWER(mac) = LOWER(?)`).run(ip, ip, normMac);
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
    }): Promise<void> {
        await this.init();
        const normMac = profile.mac.toLowerCase();
        const cleanIp = profile.ip.trim();
        const updateTransaction = this.db.transaction(() => {
            this.db.prepare(`
                UPDATE devices
                SET is_online = 0,
                    last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END,
                    ip = ''
                WHERE ip = ? AND LOWER(mac) != LOWER(?)
            `).run(cleanIp, normMac);
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
                WHERE LOWER(mac) = LOWER(?)
            `).run(
                cleanIp,
                cleanIp,
                profile.hostname || '', profile.hostname || '',
                profile.vendorClass || '', profile.vendorClass || '',
                profile.fingerprint || '', profile.fingerprint || '',
                profile.clientId || '', profile.clientId || '',
                profile.fqdn || '', profile.fqdn || '',
                normMac
            );
        });
        updateTransaction();
    }

    async updateDeviceProfileAssessment(profile: ProfileAssessment): Promise<void> {
        await this.init();
        const validated = validateProfileAssessment(profile);
        const vendor = isGenericProfileLabel(validated.vendor, 'vendor') ? null : validated.vendor;
        const deviceType = isGenericProfileLabel(validated.device_type, 'device_type')
            ? null
            : validated.device_type;
        const hostname = isGenericProfileLabel(validated.hostname, 'hostname') ? null : validated.hostname;
        const os = isGenericProfileLabel(validated.os, 'os') ? null : validated.os;

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
                WHERE LOWER(mac) = LOWER(?)
            `).run(
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
            );

            if (result.changes === 0) {
                throw new Error(`Device with MAC ${validated.mac} not found`);
            }
        });

        updateTransaction();
    }

    /**
     * Sinkronisasi perangkat hasil scan dengan database SQLite:
     * - Mengenali perangkat lama berdasarkan MAC address
     * - Mempertahankan status is_blocked jika perangkat pernah diblokir
     * - Mendeteksi jika ada perangkat terblokir yang datang kembali (Auto-Reblock)
     * - Menandai perangkat yang tidak tertangkap sebagai is_online = 0 (bukan dihapus!)
     * - Dijalankan dalam transaksi atomik native SQLite dengan auto-rollback bila terjadi kegagalan.
     */
    async syncScanResults(scannedDevices: Device[]): Promise<{
        allDevices: Device[];
        autoReblockTargets: Device[];
        autoThrottleTargets: Device[];
        zombieSessionsToStop?: string[];
    }> {
        await this.init();

        const existingDevices = await this.getDevicesForReconciliation();
        const existingMap = new Map<string, Device>();
        for (const dev of existingDevices) {
            existingMap.set(dev.mac.toLowerCase(), dev);
        }

        const autoReblockTargets: Device[] = [];
        const autoThrottleTargets: Device[] = [];
        const zombieSessionsToStop: string[] = [];
        const scannedMacs = new Set<string>();

        // Load active profiles for heuristic matching
        const rawProfiles = this.db.prepare('SELECT * FROM device_profiles').all() as any[];
        const profiles = rawProfiles.map(p => ({
            ...p,
            linked_macs: safeParseJson<string[]>(p.linked_macs, [])
        }));

        // Prepared statements untuk performa ultra-cepat di dalam transaksi
        const resetGatewayStmt = this.db.prepare(`UPDATE devices SET is_gateway = 0 WHERE LOWER(mac) != LOWER(?)`);
        const updateProfileLinkedMacsStmt = this.db.prepare(`
            UPDATE device_profiles
            SET linked_macs = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `);
        const archiveDevicesStmt = this.db.prepare(`
            UPDATE devices
            SET is_archived = 1, session_id = NULL
            WHERE profile_id = ? 
              AND LOWER(mac) != LOWER(?) 
              AND is_online = 0
        `);
        const selectArchivedSessionsStmt = this.db.prepare(`
            SELECT mac, session_id FROM devices
            WHERE profile_id = ? 
              AND LOWER(mac) != LOWER(?) 
              AND is_online = 0
              AND session_id IS NOT NULL
        `);

        const upsertQuery = `
            INSERT INTO devices (
                mac, ip, last_ip, hostname, vendor, os, device_type,
                web_title, web_server, workgroup, user_name,
                open_ports, services, is_blocked, is_online, is_gateway,
                rtt_ms, session_id, is_self, ttl, is_randomized_mac, mac_type, alias, profile_id, matched_by, speed_limit,
                dhcp_vendor_class, dhcp_fingerprint, dhcp_client_id, dhcp_fqdn, match_score, candidate_profile_id, first_seen, last_seen,
                distance_zone, estimated_range,
                ipv6_link_local, ipv6_global, ipv6_addresses, is_dual_stack,
                profile_status, vendor_confidence, type_confidence, hostname_confidence,
                profile_evidence, profiled_at, profile_version
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, 1, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', 'localtime')), datetime('now', 'localtime'),
                ?, ?,
                ?, ?, ?, ?,
                COALESCE(?, 'unknown'), COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 0),
                COALESCE(?, '[]'), ?, COALESCE(?, 1)
            )
            ON CONFLICT (mac) DO UPDATE SET
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
                speed_limit = CASE WHEN excluded.speed_limit IS NOT NULL THEN excluded.speed_limit ELSE devices.speed_limit END,
                dhcp_vendor_class = CASE WHEN excluded.dhcp_vendor_class IS NOT NULL AND excluded.dhcp_vendor_class != '' THEN excluded.dhcp_vendor_class ELSE devices.dhcp_vendor_class END,
                dhcp_fingerprint = CASE WHEN excluded.dhcp_fingerprint IS NOT NULL AND excluded.dhcp_fingerprint != '' THEN excluded.dhcp_fingerprint ELSE devices.dhcp_fingerprint END,
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

        const setOfflineStmt = this.db.prepare(`
            UPDATE devices
            SET is_online = 0,
                last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END,
                ip = ''
            WHERE LOWER(mac) = LOWER(?)
              AND (is_self IS NULL OR is_self = 0)
              AND (is_gateway IS NULL OR is_gateway = 0)
              AND (last_seen IS NULL OR last_seen < datetime('now', 'localtime', '-${OFFLINE_GRACE_SECONDS} seconds'))
        `);

        const disassociateStaleIpStmt = this.db.prepare(`
            UPDATE devices
            SET is_online = 0,
                last_ip = CASE WHEN ip != '' AND ip IS NOT NULL THEN ip ELSE last_ip END,
                ip = ''
            WHERE ip = ? AND LOWER(mac) != LOWER(?)
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
                    resetGatewayStmt.run(macKey);
                }

                // Disosiasikan IP ini dari perangkat lain jika ada yang memegang IP sama
                disassociateStaleIpStmt.run(scanned.ip, macKey);

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
                        const result = calculateProfileMatchScore(scanned, prof, existingDevices);
                        if (result.score > bestScore) {
                            bestScore = result.score;
                            bestProfile = prof;
                            bestReasons = result.reasons;
                        }
                    }

                    matchScore = bestScore;

                    if (bestProfile && bestScore >= 80) {
                        // High Confidence Match (>= 80%): Auto-Link & Auto-Reblock
                        console.log(`🎯 [HIGH CONFIDENCE PROFILE MATCH (${bestScore}%)] Device ${scanned.ip} (${scanned.mac}) matched profile "${bestProfile.alias}" (${bestReasons.join(', ')})`);
                        isBlocked = Boolean(bestProfile.is_blocked);
                        inheritedAlias = bestProfile.alias;
                        inheritedFirstSeen = bestProfile.created_at || null;
                        profileId = bestProfile.id;
                        matchedBy = 'high_confidence_multi_factor';
                        if (isBlocked) {
                            currentSpeedLimit = 0;
                        } else if (bestProfile.speed_limit !== undefined && bestProfile.speed_limit < 100) {
                            currentSpeedLimit = bestProfile.speed_limit;
                        }

                        // Tambahkan MAC baru ke linked_macs (capped max 10 to prevent profile bloat)
                        const currentLinked = Array.isArray(bestProfile.linked_macs)
                            ? bestProfile.linked_macs
                            : safeParseJson<string[]>(bestProfile.linked_macs, []);
                        const updatedLinked = Array.from(new Set([...currentLinked, macKey])).slice(-10);
                        updateProfileLinkedMacsStmt.run(JSON.stringify(updatedLinked), profileId);

                        // AUTO-ARCHIVE SUPERSEDED OFFLINE MACs FOR THIS PROFILE!
                        const zombieRows = selectArchivedSessionsStmt.all(profileId, macKey) as any[];
                        for (const r of zombieRows) {
                            if (r.session_id) {
                                zombieSessionsToStop.push(r.session_id);
                            }
                        }
                        archiveDevicesStmt.run(profileId, macKey);
                    } else if (bestProfile && bestScore >= 50) {
                        console.log(`⚠️ [CANDIDATE PROFILE REVIEW (${bestScore}%)] Device ${scanned.ip} (${scanned.mac}) looks similar to profile "${bestProfile.alias}" (${bestReasons.join(', ')}), marked as candidate without blocking.`);
                        candidateProfileId = bestProfile.id;
                        matchedBy = 'candidate_review';
                        isBlocked = false;
                    }
                }

                // Perangkat perlu auto-reblock/auto-throttle HANYA jika belum aktif sesi spoof-nya (baru online / ganti MAC / belum ada session_id)
                const needsSpoofSession = !existing || !existing.is_online || !existing.session_id;

                if (isBlocked && currentSpeedLimit === 0 && needsSpoofSession) {
                    autoReblockTargets.push({
                        ...scanned,
                        is_blocked: true,
                        speed_limit: 0,
                        session_id: sessionId
                    });
                } else if (currentSpeedLimit > 0 && currentSpeedLimit < 100 && needsSpoofSession) {
                    autoThrottleTargets.push({
                        ...scanned,
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
            }

            // 2. Tandai perangkat yang tidak tertangkap di scan ini sebagai is_online = 0
            // Terapkan grace period (OFFLINE_GRACE_SECONDS): Perangkat yang baru saja terlihat tidak langsung di-offline-kan
            for (const [macKey] of existingMap.entries()) {
                if (!scannedMacs.has(macKey)) {
                    setOfflineStmt.run(macKey);
                }
            }
        });

        syncTransaction();

        // Ambil data terbaru seluruh perangkat dari database
        const updatedDevices = await this.getAllDevices();
        return {
            allDevices: updatedDevices,
            autoReblockTargets,
            autoThrottleTargets,
            zombieSessionsToStop
        };
    }

    private rowToDevice(row: any): Device {
        return {
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

    async saveLicenseCache(lic: CachedLicense): Promise<void> {
        await this.init();
        const stmt = this.db.prepare(`
            INSERT INTO license_cache (
                id, user_id, email, name, avatar_url, tier, token,
                max_cuts, can_throttle, can_gateway, can_autoreblock, can_arsenal, cloud_sync,
                expires_at, grace_period_until, hwid, last_synced_at
            ) VALUES (
                'current_license', ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, datetime('now', 'localtime')
            )
            ON CONFLICT (id) DO UPDATE SET
                user_id = excluded.user_id,
                email = excluded.email,
                name = excluded.name,
                avatar_url = excluded.avatar_url,
                tier = excluded.tier,
                token = excluded.token,
                max_cuts = excluded.max_cuts,
                can_throttle = excluded.can_throttle,
                can_gateway = excluded.can_gateway,
                can_autoreblock = excluded.can_autoreblock,
                can_arsenal = excluded.can_arsenal,
                cloud_sync = excluded.cloud_sync,
                expires_at = excluded.expires_at,
                grace_period_until = excluded.grace_period_until,
                hwid = excluded.hwid,
                last_synced_at = datetime('now', 'localtime')
        `);

        stmt.run(
            lic.user_id || null,
            lic.email || null,
            lic.name || null,
            lic.avatar_url || null,
            lic.tier || 'free',
            lic.token,
            lic.max_cuts ?? 1,
            lic.can_throttle ? 1 : 0,
            lic.can_gateway ? 1 : 0,
            lic.can_autoreblock ? 1 : 0,
            lic.can_arsenal ? 1 : 0,
            lic.cloud_sync ? 1 : 0,
            lic.expires_at || null,
            lic.grace_period_until || null,
            lic.hwid || null
        );
    }

    async getLicenseCache(): Promise<CachedLicense | null> {
        await this.init();
        const row = this.db.prepare(`SELECT * FROM license_cache WHERE id = 'current_license'`).get() as any;
        if (!row) return null;

        return {
            id: row.id,
            user_id: row.user_id || undefined,
            email: row.email || undefined,
            name: row.name || undefined,
            avatar_url: row.avatar_url || undefined,
            tier: row.tier || 'free',
            token: row.token,
            max_cuts: row.max_cuts ?? 1,
            can_throttle: Boolean(row.can_throttle),
            can_gateway: Boolean(row.can_gateway),
            can_autoreblock: Boolean(row.can_autoreblock),
            can_arsenal: Boolean(row.can_arsenal),
            cloud_sync: Boolean(row.cloud_sync),
            expires_at: row.expires_at || undefined,
            grace_period_until: row.grace_period_until || undefined,
            hwid: row.hwid || undefined,
            last_synced_at: row.last_synced_at || undefined
        };
    }

    async clearLicenseCache(): Promise<void> {
        await this.init();
        this.db.prepare(`DELETE FROM license_cache WHERE id = 'current_license'`).run();
    }

    async close(): Promise<void> {
        try {
            this.db.close();
            console.log('✅ SQLite database connection closed');
        } catch (err) {
            // Already closed
        }
    }
}
