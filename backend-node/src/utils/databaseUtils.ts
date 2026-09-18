import { Device, ProfileAssessment, ProfileEvidence, ProfileStatus } from '../types';

/**
 * Turunkan network_id dari MAC gateway router — unik per router LAN & bebas kolisi.
 * Menghasilkan 'net_<hex>' atau 'net_default' bila MAC kosong.
 */
export function deriveNetworkId(gatewayMac?: string | null): string {
    const clean = (gatewayMac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    return clean ? `net_${clean}` : 'net_default';
}

/**
 * Grace period (detik) sebelum perangkat yang hilang dari hasil scan ditandai offline.
 * Anti-flapping untuk ponsel yang masuk doze mode. Sumber tunggal kebenaran — dipakai
 * oleh SQL setOffline dan diimpor oleh test agar SQL & test tidak lagi berbeda (75 vs 90).
 */
export const OFFLINE_GRACE_SECONDS = 75;
export const MAX_PROFILE_EVIDENCE_BYTES = 32 * 1024;
export const PROFILE_STATUSES = new Set<ProfileStatus>(['high', 'medium', 'unknown']);
export const PROFILE_EVIDENCE_STRENGTHS = new Set<ProfileEvidence['strength']>([
    'weak',
    'medium',
    'strong',
    'explicit'
]);
export const MAC_ADDRESS_PATTERN = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

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

/**
 * Pilih nama profil terbaik antara nilai SEKARANG dan KANDIDAT. Kandidat hanya boleh menang bila ia
 * hostname PERSONAL (bukan generik/'Unknown') DAN nilai sekarang kosong/generik. Mencegah 'Unknown'
 * menimpa nama personal, dan meng-UPGRADE profil generik begitu hostname personal terlihat — akar
 * bug "nama jadi Unknown saat rotasi MAC" (MAC baru mewarisi alias profil).
 */
export function betterProfileName(current: string | null | undefined, candidate: string | null | undefined): string {
    const cur = (current || '').trim();
    const cand = (candidate || '').trim();
    if (cand && !isGenericFactoryHostname(cand) && (!cur || isGenericFactoryHostname(cur))) {
        return cand;
    }
    return cur;
}

/**
 * TIER-1 guard: apakah client-id (DUID/Opt61) LAYAK dipakai untuk instant-match 100%.
 * Hanya colon-hex asli, ≥3 byte, bukan all-zero. Menolak placeholder/label (mis. legacy
 * "DUID_LLT") & nilai non-hex — kalau tidak, dua perangkat BERBEDA yang menyimpan placeholder
 * sama akan cocok 100% & di-fusi/blokir keliru sebagai satu.
 */
export function isUsableClientId(cid: string | undefined | null): boolean {
    if (!cid) return false;
    const c = String(cid).trim().toLowerCase();
    if (!/^[0-9a-f]{2}(:[0-9a-f]{2})+$/.test(c)) return false;
    const bytes = c.split(':');
    if (bytes.length < 3) return false;
    if (bytes.every(b => b === '00')) return false;
    return true;
}

/** Scoring reason emitted for a stable DHCP client-id (DUID) instant match. */
export const DUID_INSTANT_MATCH_REASON = 'duid_hardware_instant_match (+100)';

/** True when the profile match was decided by an authoritative DUID (client-id) match. */
export function isDuidExactMatch(reasons: readonly string[]): boolean {
    return Array.isArray(reasons) && reasons.includes(DUID_INSTANT_MATCH_REASON);
}

/**
 * Decide whether a newly-seen device should be auto-linked to a matched profile and
 * inherit its blocked/throttled state (auto-reblock).
 *
 * The `hasOtherOnlineInProfile` guard normally suppresses the link when another device
 * in that profile is currently online (two simultaneously-online devices could be
 * genuinely different — a weak hostname/fingerprint match must not merge them). A
 * DUID-exact match (stable DHCP client-id, near-unique per NIC) is authoritative
 * identity, so a same-identity MAC still "online" is a stale row left by the SAME
 * physical device rotating its L2 MAC — the guard is bypassed for that case only,
 * which closes the MAC-randomization block-evasion without weakening the guard for
 * hostname/fingerprint matches.
 */
export function shouldAutoLinkReblock(opts: {
    isHighConfidence: boolean;
    isContinuityFusing: boolean;
    hasOtherOnlineInProfile: boolean;
    isDuidExact: boolean;
}): boolean {
    if (!(opts.isHighConfidence || opts.isContinuityFusing)) return false;
    if (opts.isDuidExact) return true;
    return !opts.hasOtherOnlineInProfile;
}

export function calculateProfileMatchScore(
    scanned: Device,
    profile: any,
    existingDevices: Device[] = [],
    allScannedMacSet?: Set<string>
): { score: number; reasons: string[] } {
    const sCid = (scanned.dhcp_client_id || '').trim().toLowerCase();

    // =========================================================================
    // TIER 1: DUID-FIRST FAST-TRACK (Instant 100% Match)
    // Jika perangkat memiliki Hardware DUID unik (Option 61) dan cocok dengan profil,
    // maka 100% PASTI mesin fisik yang sama -> bypass faktor lain & langsung 100 Poin!
    // =========================================================================
    if (isUsableClientId(sCid)) {
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
                reasons: [DUID_INSTANT_MATCH_REASON]
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

    // 4. Offline Timing Window Continuity (Maks 15 Poin)
    if (Array.isArray(profile.linked_macs) && profile.linked_macs.length > 0) {
        const matchingLinked = existingDevices.find(
            d => profile.linked_macs.map((m: string) => m.toLowerCase()).includes(d.mac.toLowerCase()) &&
                 (!d.is_online || (allScannedMacSet && !allScannedMacSet.has(d.mac.toLowerCase())))
        );
        if (matchingLinked && matchingLinked.last_seen) {
            const lastSeenTime = new Date(matchingLinked.last_seen).getTime();
            const now = Date.now();
            if (!isNaN(lastSeenTime) && now - lastSeenTime <= 10 * 60 * 1000) {
                score += 15;
                reasons.push('recent_disconnect_continuity (+15)');
            }
        }
    }

    // 5. Secondary DUID / Partial Match (Bonus 15 Poin) — hanya client-id yang layak (bukan placeholder)
    if (isUsableClientId(sCid)) {
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

export function safeParseJson<T>(val: any, fallback: T): T {
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

export function normalizeMacAddress(mac: unknown): string {
    if (typeof mac !== 'string') {
        throw new Error('Invalid profile MAC address');
    }
    const normalized = mac.trim().replace(/-/g, ':').toLowerCase();
    if (!MAC_ADDRESS_PATTERN.test(normalized)) {
        throw new Error('Invalid profile MAC address');
    }
    return normalized;
}

export function isGenericProfileLabel(value: unknown, field: 'vendor' | 'device_type' | 'hostname' | 'os'): boolean {
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

export function validateConfidence(value: unknown, field: string): number {
    if (!Number.isFinite(value) || !Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) {
        throw new Error(`${field} confidence must be a finite integer from 0 to 100`);
    }
    return value as number;
}

export function serializeProfileEvidence(evidence: unknown): string {
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

export function validateProfileAssessment(
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

export function hasStoredValue(value: unknown): boolean {
    return value !== null
        && value !== undefined
        && (typeof value !== 'string' || value.trim() !== '');
}

export function normalizeStoredSpeedLimit(value: unknown): number {
    if (value === null || value === undefined) return 100;
    const numericValue = typeof value === 'string' && value.trim() === ''
        ? Number.NaN
        : Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100
        ? numericValue
        : 100;
}

export function timestampRank(value: unknown): number {
    if (typeof value !== 'string' || value.trim() === '') return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function compareNewestDeviceRows(left: any, right: any): number {
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

export function quoteSqlIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}
