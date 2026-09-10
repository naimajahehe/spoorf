import os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { normalizeProfileIpv6Addresses, PythonBridge } from './pythonBridge';
import { DatabaseService, deriveNetworkId } from './database';
import { LicenseManager, FeatureLimitError, FeatureLockedError } from './licenseManager';
import { Device, CutStatus, ProfileAssessment, ProfileRefreshResult } from '../types';
import type { ScanOptions } from './pythonBridge';

// Retensi: perangkat tamu yang offline lebih lama dari ini diarsipkan (bukan dihapus)
// agar daftar mencerminkan jaringan nyata, bukan riwayat semua tamu. Lihat
// DatabaseService.archiveStaleDevices() untuk pagar pengamannya (blokir/alias/sesi/profil).
export const STALE_DEVICE_RETENTION_DAYS = 14;
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // sekali per hari
const DHCP_OPTIMIZATION_COOLDOWN_MS = 20_000;
const PROFILE_REFRESH_COOLDOWN_MS = 20_000;
const PROFILE_ENRICHMENT_COOLDOWN_MS = 60_000;
const PROFILE_ENRICHMENT_DEBOUNCE_MS = 1_500;
const IDENTITY_REBLOCK_MIN_INTERVAL_MS = 8_000; // rate-limit re-block scan saat perangkat me-rotasi MAC agresif
const PROFILE_MAC_PATTERN = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

interface DhcpOptimizationResult {
    success: true;
    delivery: any;
    dhcpDelta: any;
    dhcpStats: any;
    devices: Device[];
    cached: boolean;
    cooldown_remaining_ms: number;
    duration_ms: number;
}

interface DeviceScanOptions extends ScanOptions {
    requireFresh?: boolean;
}

function normalizeProfileMac(mac: unknown): string | null {
    if (typeof mac !== 'string') return null;
    const normalized = mac.trim().replace(/-/g, ':').toLowerCase();
    return PROFILE_MAC_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Kunci memori stabil untuk `this.devices`. Perangkat ONLINE memakai IP (kunci alami untuk
 * lookup dari API/event). Perangkat OFFLINE ber-`ip=''` memakai IDENTITAS (profile_id →
 * MAC ternormalisasi) — kalau tidak, SEMUA perangkat offline saling menimpa di kunci ''
 * sehingga hanya satu yang tersisa di memori & UI (BUG-17). Identitas tak pernah berformat IP,
 * jadi tak akan bertabrakan dengan kunci perangkat online.
 */
function deviceMemKey(d: Device): string {
    if (d.ip && d.ip.trim() !== '') return d.ip;
    return d.profile_id || normalizeProfileMac(d.mac) || (typeof d.mac === 'string' ? d.mac.toLowerCase() : '');
}

function isPrivateIpv4(ip: unknown): ip is string {
    if (typeof ip !== 'string') return false;
    const text = ip.trim();
    const parts = text.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return false;
    const octets = parts.map(Number);
    if (
        octets.some(part => part < 0 || part > 255)
        || parts.some((part, index) => String(octets[index]) !== part)
    ) {
        return false;
    }
    return octets[0] === 10
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168);
}

function isGenericProfileLabel(
    value: unknown,
    field: 'vendor' | 'device_type' | 'hostname' | 'os'
): boolean {
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

export function isIpInSameSubnet(ip: string, gatewayIp: string): boolean {
    if (!ip || !gatewayIp) return true;
    try {
        const ipParts = ip.split('.').map(Number);
        const gwParts = gatewayIp.split('.').map(Number);
        if (ipParts.length !== 4 || gwParts.length !== 4) return false;

        // Same /24 (standar rumah & kantor)
        if (ipParts[0] === gwParts[0] && ipParts[1] === gwParts[1] && ipParts[2] === gwParts[2]) {
            return true;
        }

        // Public Wi-Fi Supernets:
        // 10.x.x.x (Class A - Kafe besar / Kampus / Bandara / Hotel)
        if (gwParts[0] === 10 && ipParts[0] === 10) {
            return ipParts[1] === gwParts[1];
        }

        // 172.16.x.x - 172.31.x.x (Class B)
        if (gwParts[0] === 172 && ipParts[0] === 172) {
            return ipParts[1] === gwParts[1];
        }

        // 192.168.x.x (/22 or /20 or /16 supernet)
        if (gwParts[0] === 192 && gwParts[1] === 168 && ipParts[0] === 192 && ipParts[1] === 168) {
            return (ipParts[2] & 0xfc) === (gwParts[2] & 0xfc);
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Ubah IPv4 dotted-quad menjadi integer 32-bit TAK-bertanda. Null jika tak valid.
 */
export function ipv4ToInt(ip: string): number | null {
    const parts = (ip || '').trim().split('.');
    if (parts.length !== 4) return null;
    let acc = 0;
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p)) return null;
        const n = Number(p);
        if (n > 255) return null;
        acc = acc * 256 + n;
    }
    return acc >>> 0;
}

/**
 * Netmask dotted-quad ('255.255.255.0') → panjang prefix (24). Null bila mask tak
 * valid atau bit-1 tidak kontigu (mis. '255.0.255.0' — bukan mask sah).
 */
export function netmaskToPrefix(netmask: string): number | null {
    const n = ipv4ToInt(netmask);
    if (n === null) return null;
    let prefix = 0;
    let seenZero = false;
    for (let i = 31; i >= 0; i--) {
        const bit = (n >>> i) & 1;
        if (bit === 1) {
            if (seenZero) return null; // ada bit-1 setelah bit-0 → mask tidak kontigu
            prefix++;
        } else {
            seenZero = true;
        }
    }
    return prefix;
}

/**
 * True bila `ip` satu jaringan dengan `gatewayIp` untuk panjang prefix tertentu,
 * memakai aritmetika mask NYATA: (ip & mask) === (gw & mask). Tanpa tebakan
 * berbasis kelas alamat (classful sudah usang sejak CIDR / RFC 1519).
 */
export function isSameSubnetMasked(ip: string, gatewayIp: string, prefixLen: number): boolean {
    const a = ipv4ToInt(ip);
    const g = ipv4ToInt(gatewayIp);
    if (a === null || g === null) return false;
    if (prefixLen <= 0) return true;        // /0 → semua satu jaringan
    if (prefixLen >= 32) return a === g;     // /32 → host tunggal
    const mask = (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
    return ((a & mask) >>> 0) === ((g & mask) >>> 0);
}

/** Bentuk minimal entri adapter jaringan yang diperlukan resolver prefix. */
export interface NetIfaceLike { address: string; netmask: string; family: string | number; internal: boolean; }

/**
 * Cari panjang prefix adapter OS (IPv4, non-internal) yang jaringannya MEMUAT
 * `gatewayIp` aktif. Inilah sumber mask yang benar (bukan tebakan). Null bila tak
 * ada adapter cocok → pemanggil memilih fallback aman (tampilkan semua).
 */
export function resolveActivePrefix(gatewayIp: string, ifaces: NetIfaceLike[]): number | null {
    if (ipv4ToInt(gatewayIp) === null) return null;
    for (const a of ifaces) {
        const isV4 = a.family === 'IPv4' || a.family === 4;
        if (!isV4 || a.internal) continue;
        const prefix = netmaskToPrefix(a.netmask);
        if (prefix === null) continue;
        if (isSameSubnetMasked(a.address, gatewayIp, prefix)) return prefix;
    }
    return null;
}

/**
 * Saring daftar perangkat HANYA untuk tampilan: hanya perangkat di subnet gateway
 * aktif (ditentukan SUBNET MASK nyata, bukan tebakan). Perangkat offline ber-`ip`
 * kosong diklasifikasi lewat `last_ip`. Bila gateway/prefix belum diketahui,
 * kembalikan apa adanya (fallback aman — tak pernah menyembunyikan semua).
 *
 * Sengaja TIDAK mem-bypass is_gateway/is_self: gateway & host aktif sudah berada di
 * subnet aktif sehingga tetap lolos lewat mask; sebaliknya flag is_gateway/is_self
 * BASI dari jaringan lama justru harus dibuang dari tampilan.
 *
 * CATATAN: murni presentasi. JANGAN dipakai di jalur enforcement / hitung lisensi.
 */
export function scopeDevicesToActiveSubnet(devices: Device[], gatewayIp?: string, prefixLen?: number): Device[] {
    if (!gatewayIp || prefixLen === undefined || prefixLen === null) return devices;
    return devices.filter(d => isSameSubnetMasked(d.ip || d.last_ip || '', gatewayIp, prefixLen));
}

/**
 * Pilih gateway dari daftar perangkat dengan aman:
 *   1. Perangkat yang di-flag is_gateway (otoritatif dari scanner).
 *   2. Fallback heuristik: perangkat non-self ber-IP .1 / .254.
 * TIDAK ada fallback ke perangkat sembarang — kembalikan undefined bila tidak ada,
 * agar operasi spoofing gagal aman ("Gateway not found") ketimbang meracuni perangkat acak.
 */
export function selectGateway(devices: Device[]): Device | undefined {
    const ifaces: NetIfaceLike[] = [];
    try {
        for (const addrs of Object.values(os.networkInterfaces())) {
            for (const a of addrs || []) {
                if (a.family === 'IPv4' && !a.internal) {
                    ifaces.push({ address: a.address, netmask: a.netmask, family: a.family, internal: a.internal });
                }
            }
        }
    } catch {}

    const isLocalSubnet = (ip: string): boolean => {
        if (!ip) return false;
        if (ifaces.length === 0) return true;
        return ifaces.some(iface => {
            const prefix = resolveActivePrefix(iface.address, ifaces);
            return prefix !== null && isIpInSameSubnet(ip, iface.address);
        });
    };

    // 1. Prioritaskan gateway ONLINE yang berada dalam subnet adapter lokal aktif
    for (const d of devices) {
        if (d.is_gateway && d.is_online && isLocalSubnet(d.ip)) return d;
    }
    // 2. Gateway online lainnya
    for (const d of devices) {
        if (d.is_gateway && d.is_online) return d;
    }
    // 3. Gateway offline yang cocok dengan subnet lokal
    for (const d of devices) {
        if (d.is_gateway && isLocalSubnet(d.ip)) return d;
    }
    for (const d of devices) {
        if (d.is_gateway) return d;
    }
    for (const d of devices) {
        if (!d.is_self && isLocalSubnet(d.ip) && (d.ip.endsWith('.1') || d.ip.endsWith('.254'))) return d;
    }
    for (const d of devices) {
        if (!d.is_self && (d.ip.endsWith('.1') || d.ip.endsWith('.254'))) return d;
    }
    return undefined;
}

interface GamingRestorePlan {
    macKey: string;
    priorLimit: number;
    hadSession: boolean;
    sessionId?: string;
    device?: Pick<Device, 'ip' | 'mac' | 'ipv6_link_local' | 'profile_id'>;
    stopped: boolean;
    restoredSessionId?: string;
    blockedPersisted: boolean;
    speedLimitPersisted: boolean;
}

interface PendingGamingDisable {
    mode: string;
    targetPingMs: number;
    gateway?: Pick<Device, 'ip' | 'mac' | 'ipv6_link_local'>;
    restorePlans: GamingRestorePlan[];
    pythonOff: boolean;
    result?: any;
}

export class DeviceManager extends EventEmitter {
    private devices: Map<string, Device> = new Map();
    private currentNetworkId: string = 'net_default';
    private scanning: boolean = false;
    // Auto Scan sebagai fitur NYATA (bukan kosmetik): saat false ("Scan saja"), tak ada scan
    // otomatis latar (watchdog) maupun scan susulan saat perangkat baru masuk. Hanya scan
    // manual (tombol), scan saat buka aplikasi, dan scan reaktif saat ganti jaringan yang jalan.
    private autoScanEnabled: boolean = false;
    private inFlightScan: Promise<Device[]> | null = null;
    private inFlightDhcpOptimization: Promise<DhcpOptimizationResult> | null = null;
    private inFlightDhcpOptimizationGeneration: number | null = null;
    private dhcpOptimizationGeneration: number = 0;
    private lastDhcpOptimization: {
        completedAt: number;
        result: DhcpOptimizationResult;
    } | null = null;
    private inFlightProfileRefresh: Promise<ProfileRefreshResult> | null = null;
    private inFlightProfileRefreshScope: 'all' | 'subset' | null = null;
    private profileRefreshGeneration = 0;
    private lastProfileRefresh: {
        completedAt: number;
        result: ProfileRefreshResult;
    } | null = null;
    private pendingProfileMacs = new Set<string>();
    private profileEnrichmentTimer: NodeJS.Timeout | null = null;
    private profileEnrichmentCooldowns = new Map<string, number>();
    private dhcpScanDebounceTimer: NodeJS.Timeout | null = null;
    private offlineCooldownTimers: Map<string, NodeJS.Timeout> = new Map();
    private lastIdentityReblockAt: number = 0; // FASE-3: rate-limit re-block scan berbasis identitas
    // Perangkat yang dikelola Gaming Mode, DIKUNCI per-MAC (lowercase) agar tahan ganti-IP.
    // Menyimpan limit sebelumnya (untuk pemulihan tepat) + sessionId aktif (agar sesi bisa
    // dihentikan saat disable/disconnect meski objek device sudah hilang dari daftar).
    private gamingManaged: Map<string, { priorLimit: number; hadSession: boolean; sessionId?: string }> = new Map();
    // Status Gaming Mode agar throttle bisa idempoten (re-enter/ganti mode) dan diterapkan
    // ke perangkat yang baru online selagi mode aktif.
    private gamingActive: boolean = false;
    private gamingMode: string = 'auto_airtime';
    private gamingTargetLimit: number = 100;
    private pendingGamingDisable: PendingGamingDisable | null = null;
    // Mutex serialisasi: operasi tulis perangkat (block/unblock/throttle/redirect)
    // diserialisasi untuk mencegah race condition antar-aksi pengguna.
    private opChain: Promise<void> = Promise.resolve();

    private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.opChain.then(fn, fn);
        this.opChain = result.then(() => {}, () => {});
        return result;
    }

    constructor(
        public python: PythonBridge,
        private db: DatabaseService,
        private license?: LicenseManager
    ) {
        super();
        // Listen for network changes from Python
        this.python.on('telemetry', (data) => {
            this.emit('telemetry', data);
        });

        // SP-2: Python (re)connect = engine fresh tanpa sesi spoof. session_id apa pun yang masih
        // kita pegang (dari DB atau sebelum Python crash/restart) kini BASI. Bersihkan agar
        // auto-reblock (yang melewati perangkat ber-session_id, mengira sesinya hidup) benar-benar
        // membangun ulang sesi. is_blocked tetap; sesi baru dibuat saat scan/reblock berikutnya.
        this.python.on('pythonReachable', () => {
            this.reconcileBlocksWithPython().catch(err => console.warn('Notice reconcile on reconnect:', err?.message));
        });

        this.python.on('networkChanged', async (data) => {
            this.dhcpOptimizationGeneration++;
            this.lastDhcpOptimization = null;
            this.profileRefreshGeneration++;
            this.lastProfileRefresh = null;
            this.profileEnrichmentCooldowns.clear();
            this.pendingProfileMacs.clear();
            if (this.profileEnrichmentTimer) {
                clearTimeout(this.profileEnrichmentTimer);
                this.profileEnrichmentTimer = null;
            }

            const newGwMac = data?.gateway_mac || data?.new_gateway_mac;
            if (newGwMac) {
                this.currentNetworkId = deriveNetworkId(newGwMac);
                console.log(`🌐 [DeviceManager] networkChanged: scoped to ${this.currentNetworkId}`);
            }

            for (const dev of this.devices.values()) {
                if (dev.session_id) dev.session_id = undefined;
            }

            this.devices.clear();
            this.gamingManaged.clear();

            if (typeof this.db?.getAllDevices === 'function') {
                try {
                    const storedDevices = await this.db.getAllDevices(this.currentNetworkId);
                    const sorted = [...storedDevices].sort((a, b) => (a.is_online === b.is_online ? 0 : a.is_online ? 1 : -1));
                    for (const device of sorted) {
                        if (device.session_id) device.session_id = undefined;
                        this.devices.set(deviceMemKey(device), device);
                    }
                    this.emit('devicesUpdated', Array.from(this.devices.values()));
                } catch (err: any) {
                    console.warn('Notice reloading devices on networkChanged:', err?.message);
                }
            }

            this.emit('networkChanged', data);
            this.scanNetwork().catch(console.error);
        });

        this.python.on('dhcpDevice', (data) => {
            // Serialisasi mutasi this.devices dari event DHCP agar tidak interleave dengan scan.
            this.runExclusive(() => this._handleDhcpEvent(data)).catch(console.error);
        });

        this.python.on('rogueDhcp', (data) => {
            console.warn('🚨 [DeviceManager] Rogue DHCP Alert:', data);
            this.emit('rogueDhcpAlert', data);
        });

        this.python.on('gatewayDnsQuery', (data) => {
            this.emit('gatewayDnsQuery', data);
        });

        this.python.on('gatewayStatusChanged', (data) => {
            this.emit('gatewayStatusChanged', data);
        });

        this.python.on('l7Flow', (data) => {
            this.emit('l7Flow', data);
        });

        this.python.on('bettercapDnsSpoofed', (data) => {
            this.emit('bettercapDnsSpoofed', data);
        });

        this.python.on('bettercapCredentialSniffed', (data) => {
            this.emit('bettercapCredentialSniffed', data);
        });

        this.python.on('deviceLivenessChanged', (data) => {
            this.runExclusive(() => this._handleLivenessEvent(data)).catch(console.warn);
        });

        this.python.on('shieldStatusChanged', (data) => {
            this.emit('shieldStatusChanged', data);
        });

        this.python.on('arpThreatDetected', (data) => {
            console.warn('🚨 [DeviceManager] ARP Threat Alert:', data);
            this.emit('arpThreatDetected', data);
        });

        // Telemetri Gaming Mode live (ping/jitter tiap 1s) & perubahan status dari engine.
        this.python.on('gamingTelemetry', (data) => {
            this.emit('gamingTelemetry', data);
        });
        this.python.on('gamingStatusChanged', (data) => {
            if (this.pendingGamingDisable) return;
            this.emit('gamingStatusChanged', data);
        });
    }

    /**
     * FASE-1: setelah Python (re)connect, cocokkan blok yang kita yakini dengan sesi spoof yang
     * BENAR-BENAR aktif di Python. Sesi Python = in-memory, hilang saat engine restart → perangkat
     * terblokir dapat internet lagi. Bila ada perangkat is_blocked yang TAK ter-enforce di Python:
     * bersihkan session_id basi + picu scanNetwork agar auto-reblock membangun ulang sesi.
     * IDEMPOTEN: bila sesi masih ada (mis. WS blip tanpa restart), tak melakukan apa pun.
     */
    private async reconcileBlocksWithPython(): Promise<void> {
        const blocked = Array.from(this.devices.values()).filter(d => d.is_blocked && !d.is_gateway && !d.is_self);
        if (blocked.length === 0) return;

        const activeMacs = new Set<string>();
        try {
            const status = await this.python.getStatus();
            const sessions = (status && status.sessions) || {};
            for (const sid of Object.keys(sessions)) {
                const vm = sessions[sid] && sessions[sid].victim_mac;
                if (vm) activeMacs.add(String(vm).toLowerCase());
            }
        } catch {
            // getStatus gagal → anggap tak ada sesi aktif (Python kemungkinan baru restart).
        }

        const unenforced = blocked.some(d => !activeMacs.has(d.mac.toLowerCase()));
        if (!unenforced) return; // semua blok masih ter-enforce (WS blip) → no-op

        // Sesi Python hilang → session_id yang kita pegang basi. Bersihkan agar auto-reblock tak skip.
        let cleared = 0;
        for (const dev of this.devices.values()) {
            if (dev.session_id) { dev.session_id = undefined; cleared++; }
        }
        console.log(`♻️ [Reconcile] ${blocked.length} perangkat terblokir, sebagian tak ter-enforce di Python (session basi: ${cleared}) → memicu scan re-block.`);
        this.scanNetwork().catch(err => console.warn('Notice reconcile re-block scan:', err?.message));
    }

    /**
     * Lekatkan status pemutusan DUA-STACK (IPv4+IPv6) dari engine /api/status ke tiap device,
     * agar UI bisa menampilkan indikator "Dual-Stack Kill Switch" (dan menyorot kebocoran IPv6).
     * - Ada sesi engine → ipv4: 'cut' (blackhole) / 'throttle' (dibatasi); ipv6 dari sesi ('cut'|'leak'|'na').
     * - Ditandai blok tapi TAK ada sesi → ipv4: 'off' (bocor), ipv6: 'leak' bila dual-stack.
     * - Tak diblokir → cut_status dikosongkan (indikator tak tampil).
     * Engine tak terjangkau → biarkan nilai lama (tak menimpa dengan data kosong).
     */
    /**
     * Kumpulan session_id yang BENAR-BENAR aktif di engine (poison sedang jalan). Dipakai
     * syncScanResults untuk membedakan blok yang ter-enforce vs session_id basi (sesi mati).
     * Mengembalikan undefined bila engine tak terjangkau → syncScanResults tak memicu reblock massal.
     */
    private async _getLiveEngineSessionIds(): Promise<Set<string> | undefined> {
        try {
            const status = await this.python.getStatus();
            const sessions = (status && status.sessions) || {};
            const live = new Set<string>();
            for (const [sid, s] of Object.entries(sessions as Record<string, any>)) {
                if (s && s.active) live.add(sid);
            }
            return live;
        } catch {
            return undefined;
        }
    }

    private async _attachSpoofCutStatus(): Promise<void> {
        let sessions: Record<string, any>;
        try {
            const status = await this.python.getStatus();
            sessions = (status && status.sessions) || {};
        } catch {
            return;
        }
        const byIp = new Map<string, any>();
        const byMac = new Map<string, any>();
        for (const s of Object.values(sessions) as any[]) {
            if (s && s.victim_ip) byIp.set(s.victim_ip, s);
            if (s && s.victim_mac) byMac.set(String(s.victim_mac).toLowerCase(), s);
        }
        for (const dev of this.devices.values()) {
            const s = (dev.ip && byIp.get(dev.ip)) || (dev.mac && byMac.get(dev.mac.toLowerCase()));
            if (s) {
                const ipv4: CutStatus['ipv4'] = (s.speed_limit ?? 0) <= 0 ? 'cut' : 'throttle';
                const ipv6: CutStatus['ipv6'] = (s.ipv6 && s.ipv6.status) || (dev.is_dual_stack ? 'leak' : 'na');
                dev.cut_status = {
                    ipv4,
                    ipv6,
                    ipv4_packets: s.packets_sent ?? 0,
                    ipv6_packets: (s.ipv6 && s.ipv6.packets_sent) ?? 0
                };
            } else if (dev.is_blocked && !dev.is_gateway && !dev.is_self) {
                dev.cut_status = { ipv4: 'off', ipv6: dev.is_dual_stack ? 'leak' : 'na', ipv4_packets: 0, ipv6_packets: 0 };
            } else {
                dev.cut_status = undefined;
            }
        }
    }

    private async _handleDhcpEvent(data: any): Promise<void> {
        {
            console.log('⚡ [DeviceManager] DHCP event received:', data);
            const isRelease = data && (
                data.kind === 'release' ||
                data.is_release === true ||
                data.message_type_code === 7
            );
            if (isRelease && (data.mac || data.ip)) {
                let updatedAny = false;
                if (data.mac) {
                    const normMac = data.mac.toLowerCase();
                    // Kumpulkan dulu (jangan mutasi Map saat iterasi): kita akan menghapus kunci IP
                    // lama lalu menyisipkan kunci identitas di dalam loop pemrosesan.
                    const matches: Array<[string, Device]> = [];
                    for (const [ipKey, dev] of this.devices.entries()) {
                        if (dev.mac.toLowerCase() === normMac) matches.push([ipKey, dev]);
                    }
                    for (const [ipKey, dev] of matches) {
                        dev.is_online = false;
                        // Bersihkan sesi Gaming Mode agar tak bocor & reconnect ter-throttle lagi.
                        await this._stopGamingSession(normMac);
                        if (dev.ip) {
                            dev.last_ip = dev.ip;
                            this.devices.delete(ipKey);
                            dev.ip = '';
                        }
                        // Pertahankan perangkat yang baru offline memakai kunci IDENTITAS (bukan
                        // menghapusnya), agar tetap tampil di tab Offline — konsisten dengan jalur
                        // scanNetwork (BUG-17). Tanpa ini, RELEASE membuat perangkat hilang dari UI
                        // sampai rescan berikutnya.
                        this.devices.set(deviceMemKey(dev), dev);
                        this.db.setDeviceOnlineStatus(dev.mac, false, this.currentNetworkId).catch(console.warn);
                        this.emit('deviceUpdated', dev);
                        this.emit('deviceDisconnected', dev);
                        updatedAny = true;
                    }
                }
                if (updatedAny) {
                    this.emit('devicesUpdated', Array.from(this.devices.values()));
                }
                this.emit('dhcpActivity', { kind: 'release', mac: data.mac, ip: data.ip });
            } else if (data && data.mac && data.ip) {
                // Abaikan jika DHCP event membawa IP di luar subnet gateway aktif atau pesan DHCP DECLINE
                const activeGw = this.findGateway();
                if (activeGw && !isIpInSameSubnet(data.ip, activeGw.ip)) {
                    return;
                }
                if (data.is_decline) {
                    return;
                }
                // Instant Online State Transition from Passive DHCP Discovery (MAC-First Identity)
                const normMac = data.mac.toLowerCase();

                // ⚡ [DHCP Fast-Revival] Batalkan penalti karantina 30s seketika saat sinyal DHCP aktif diterima
                const existingPenalty = this.offlineCooldownTimers.get(normMac);
                if (existingPenalty) {
                    clearTimeout(existingPenalty);
                    this.offlineCooldownTimers.delete(normMac);
                    console.log(`⚡ [DHCP Fast-Revival] Penalti 30s DIBATALKAN untuk ${normMac} karena sinyal DHCP ${data.message_type || 'aktif'} diterima!`);
                }

                let dev: Device | undefined;
                let oldIpOfThisMac: string | undefined;

                // 1. MAC-First Identity Lookup
                for (const [ipKey, d] of this.devices.entries()) {
                    if (d.mac.toLowerCase() === normMac) {
                        dev = d;
                        oldIpOfThisMac = ipKey;
                        break;
                    }
                }

                // 2. Cek apakah ada perangkat lain yang sebelumnya menempati data.ip
                const occupantOfNewIp = this.devices.get(data.ip);
                if (occupantOfNewIp && occupantOfNewIp.mac.toLowerCase() !== normMac) {
                    console.log(`🔄 [DHCP IP Churn] IP ${data.ip} berpindah kepemilikan dari ${occupantOfNewIp.mac} ke ${normMac}`);
                    occupantOfNewIp.is_online = false;
                    this.devices.delete(data.ip);
                    this.db.setDeviceOnlineStatus(occupantOfNewIp.mac, false, this.currentNetworkId).catch(console.warn);
                    this.emit('deviceUpdated', occupantOfNewIp);
                    this.emit('deviceDisconnected', occupantOfNewIp);
                }

                let isNewDevice = false;
                if (dev) {
                    // Bersihkan mapping IP lama jika berbeda
                    if (oldIpOfThisMac && oldIpOfThisMac !== data.ip) {
                        console.log(`⚡ [DHCP IP Migration] Device ${dev.hostname || dev.mac} moved from ${oldIpOfThisMac} to ${data.ip}`);
                        this.devices.delete(oldIpOfThisMac);
                    }
                    const hostnameShouldChange = Boolean(
                        data.hostname && (
                            !dev.hostname
                            || dev.hostname === dev.ip
                            || dev.hostname.toLowerCase().startsWith('unknown')
                        )
                    );
                    const profileChanged = Boolean(
                        (hostnameShouldChange && dev.hostname !== data.hostname)
                        || (data.vendor_class && dev.dhcp_vendor_class !== data.vendor_class)
                        || (data.dhcp_fingerprint && dev.dhcp_fingerprint !== data.dhcp_fingerprint)
                        || (data.client_id && dev.dhcp_client_id !== data.client_id)
                        || (data.fqdn && dev.dhcp_fqdn !== data.fqdn)
                    );

                    dev.is_online = true;
                    dev.ip = data.ip;
                    if (hostnameShouldChange) dev.hostname = data.hostname;
                    if (data.vendor_class) dev.dhcp_vendor_class = data.vendor_class;
                    if (data.dhcp_fingerprint) dev.dhcp_fingerprint = data.dhcp_fingerprint;
                    if (data.client_id) dev.dhcp_client_id = data.client_id;
                    if (data.fqdn) dev.dhcp_fqdn = data.fqdn;
                    this.devices.set(dev.ip, dev);
                    await this.db.updateDeviceDhcpProfile({
                        mac: dev.mac,
                        ip: data.ip,
                        hostname: hostnameShouldChange ? data.hostname : undefined,
                        vendorClass: data.vendor_class,
                        fingerprint: data.dhcp_fingerprint,
                        clientId: data.client_id,
                        fqdn: data.fqdn
                    }, this.currentNetworkId);
                    this.emit('deviceUpdated', dev);
                    this.emit('devicesUpdated', Array.from(this.devices.values()));
                    // Perangkat aktif kembali via DHCP selagi Gaming Mode aktif -> ikut di-throttle.
                    await this._maybeApplyGamingToNewDevice(dev);
                    if (profileChanged) {
                        this.scheduleProfileEnrichment(normMac, PROFILE_ENRICHMENT_DEBOUNCE_MS);
                    }

                    // SP-1: perangkat yang MASIH berstatus diblokir baru saja renew/reconnect via
                    // DHCP (mungkin di IP baru). Sesi spoof lama menunjuk IP lama (racun basi) dan
                    // proses DHCP renew menyegarkan cache ARP korban ke router ASLI → tanpa
                    // re-poison, korban bebas berinternet walau UI masih merah (Blocked). Blokir
                    // ulang di IP baru: bersihkan session_id lama (memaksa startSpoof fresh;
                    // dedup-by-MAC IPv4 membersihkan sesi IP lama) lalu blokir lewat jalur
                    // terverifikasi (_blockDeviceImpl — kita SUDAH di dalam runExclusive).
                    if (dev.is_blocked && !dev.is_gateway && !dev.is_self) {
                        const gw = this.findGateway();
                        if (gw) {
                            dev.session_id = undefined;
                            try {
                                await this._blockDeviceImpl(dev.ip, gw.ip);
                                console.log(`🔒 [DHCP Re-Block] Blok ditegakkan ulang untuk ${dev.hostname || dev.mac} di ${dev.ip}`);
                            } catch (e: any) {
                                console.warn(`Notice re-blocking ${dev.mac} on DHCP:`, e?.message);
                            }
                        }
                    }
                } else {
                    isNewDevice = true;
                    // FASE-3: MAC baru yang identitas STABIL-nya (DUID layak, atau hostname personal
                    // + fingerprint + vendor) cocok dengan perangkat MASIH-TERBLOKIR = kemungkinan
                    // besar target yang me-rotasi MAC untuk lolos. Picu re-block SEKETIKA (reuse scan
                    // + auto-reblock existing, yang juga membersihkan sesi MAC lama via
                    // zombieSessionsToStop), tanpa menunggu scan terjadwal & tanpa bergantung mode
                    // Auto Scan. Rate-limited agar rotasi agresif tak memicu badai scan. Unblock-safe:
                    // pencocokan menuntut is_blocked=1 → perangkat yang di-unblock tak lagi cocok.
                    try {
                        if (typeof this.db.hasBlockedIdentityMatch === 'function' && this.db.hasBlockedIdentityMatch(data, this.currentNetworkId)) {
                            const now = Date.now();
                            if (now - this.lastIdentityReblockAt >= IDENTITY_REBLOCK_MIN_INTERVAL_MS) {
                                this.lastIdentityReblockAt = now;
                                console.log(`🔒 [Identity Re-Block] DHCP MAC baru ${normMac} cocok identitas terblokir → picu re-block scan seketika.`);
                                this.scanNetwork().catch(err => console.warn('Notice identity re-block scan:', err?.message));
                            }
                        }
                    } catch (e: any) {
                        console.warn('Notice identity re-block check:', e?.message);
                    }
                }

                this.emit('dhcpActivity', {
                    kind: isNewDevice ? 'new' : 'renew',
                    mac: normMac,
                    ip: data.ip,
                    hostname: data.hostname,
                    vendor_class: data.vendor_class
                });

                // Auto-scan saat perangkat baru masuk — HANYA bila Auto Scan aktif. Perangkat baru
                // dimaterialisasi ke daftar melalui scan susulan ini; jadi di mode "Scan saja" perangkat
                // baru BELUM muncul di tabel sampai scan berikutnya (manual/ganti-jaringan). Toast
                // "perangkat baru" (dhcpActivity di atas) tetap memberi tahu pengguna untuk memindai.
                if (isNewDevice && this.autoScanEnabled && !this.inFlightDhcpOptimization) {
                    this.debouncedScan();
                }
            } else if (data && data.mac && !data.ip) {
                // Event DHCP tanpa IP sah (DHCPDISCOVER / DHCPREQUEST: klien meminta IP lama via Option 50 belum disetujui router)
                const normMac = data.mac.toLowerCase();
                for (const d of this.devices.values()) {
                    if (d.mac.toLowerCase() === normMac) {
                        if (data.hostname && (!d.hostname || d.hostname.toLowerCase().startsWith('unknown'))) {
                            d.hostname = data.hostname;
                        }
                        if (data.vendor_class) d.dhcp_vendor_class = data.vendor_class;
                        if (data.dhcp_fingerprint) d.dhcp_fingerprint = data.dhcp_fingerprint;
                        if (data.client_id) d.dhcp_client_id = data.client_id;
                        if (data.fqdn) d.dhcp_fqdn = data.fqdn;
                        this.emit('deviceUpdated', d);
                        break;
                    }
                }
                await this.db.updateDeviceDhcpProfile({
                    mac: normMac,
                    ip: '',
                    hostname: data.hostname,
                    vendorClass: data.vendor_class,
                    fingerprint: data.dhcp_fingerprint,
                    clientId: data.client_id,
                    fqdn: data.fqdn
                }, this.currentNetworkId).catch(console.warn);

                // Periksa apakah MAC ini cocok dengan perangkat terblokir untuk picu re-block cepat
                try {
                    if (typeof this.db.hasBlockedIdentityMatch === 'function' && this.db.hasBlockedIdentityMatch(data, this.currentNetworkId)) {
                        const now = Date.now();
                        if (now - this.lastIdentityReblockAt >= IDENTITY_REBLOCK_MIN_INTERVAL_MS) {
                            this.lastIdentityReblockAt = now;
                            console.log(`🔒 [Identity Re-Block] DHCP discovery MAC ${normMac} cocok identitas terblokir → picu scan seketika.`);
                            this.scanNetwork().catch(err => console.warn('Notice identity re-block scan:', err?.message));
                        }
                    }
                } catch (e: any) {
                    console.warn('Notice identity re-block check:', e?.message);
                }

                // Picu micro-scan agar IP fisik sebenarnya segera diverifikasi via Layer 2 ARP
                this.debouncedScan(1000);
            }
        }
    }

    private async _handleLivenessEvent(data: any): Promise<void> {
        if (!data || !data.ip || !data.mac) return;
        const normMac = data.mac.toLowerCase();
        let dev = this.devices.get(data.ip);
        if (!dev) {
            for (const d of this.devices.values()) {
                if (d.mac.toLowerCase() === normMac) {
                    dev = d;
                    break;
                }
            }
        }

        if (dev && !dev.is_self && !dev.is_gateway) {
            const wasOnline = Boolean(dev.is_online);
            const isOnline = Boolean(data.is_online);
            dev.is_online = isOnline;
            if (data.rtt_ms !== undefined) dev.rtt_ms = data.rtt_ms;
            this.devices.set(dev.ip, dev);
            await this.db.setDeviceOnlineStatus(dev.mac, isOnline, this.currentNetworkId).catch(console.warn);
            this.emit('deviceUpdated', dev);

            if (wasOnline && !isOnline) {
                console.log(`🔌 [LivenessPulse < 0.75s] Instant Offline Confirmed: ${dev.ip} (${dev.mac}) via vector '${data.vector || 'timeout'}'`);
                this.emit('deviceDisconnected', dev);
                this.emit('devicesUpdated', Array.from(this.devices.values()));
            } else if (!wasOnline && isOnline) {
                console.log(`⚡ [LivenessPulse < 0.75s] Instant Online Confirmed: ${dev.ip} (${dev.mac}) via vector '${data.vector}'`);
                this.emit('devicesUpdated', Array.from(this.devices.values()));
            }
        }
    }

    private async _verifyPreFlightLiveness(device: Device, gatewayIp: string): Promise<void> {
        try {
            const pulseResult = await this.python.pulseLiveness(
                [{
                    ip: device.ip,
                    mac: device.mac,
                    ipv6_link_local: device.ipv6_link_local,
                    ipv6_global: device.ipv6_global
                }],
                gatewayIp
            );
            const targetPulse = pulseResult ? pulseResult[device.ip] : null;
            if (targetPulse && targetPulse.is_alive === false) {
                // Cek apakah perangkat baru saja bermigrasi ke IP lain sebelum menyatakan offline
                let migratedIp: string | undefined;
                let migratedMac = device.mac;
                for (const [ipKey, d] of this.devices.entries()) {
                    if (d.mac.toLowerCase() === device.mac.toLowerCase() && ipKey !== device.ip && d.is_online) {
                        migratedIp = ipKey;
                        migratedMac = d.mac;
                        break;
                    }
                }

                // Cek profil yang sama jika MAC sudah berotasi (misal Android / iOS MAC acak)
                if (!migratedIp && device.profile_id) {
                    for (const [ipKey, d] of this.devices.entries()) {
                        if (d.profile_id === device.profile_id && ipKey !== device.ip && d.is_online) {
                            migratedIp = ipKey;
                            migratedMac = d.mac;
                            break;
                        }
                    }
                }

                if (migratedIp) {
                    console.log(`⚡ [Pre-Flight Auto-Migration] Target ${device.mac} berpindah dari ${device.ip} ke ${migratedIp} (MAC: ${migratedMac}), memverifikasi IP baru...`);
                    const reCheck = await this.python.pulseLiveness(
                        [{ ip: migratedIp, mac: migratedMac }],
                        gatewayIp
                    );
                    if (reCheck && reCheck[migratedIp] && reCheck[migratedIp].is_alive) {
                        console.log(`✅ [Pre-Flight Auto-Migration] Target ${migratedMac} TERBUKTI HIDUP di IP baru ${migratedIp}!`);
                        if (device.ip) this.devices.delete(device.ip);
                        device.ip = migratedIp;
                        device.mac = migratedMac;
                        device.is_online = true;
                        this.devices.set(migratedIp, device);
                        await this.db.updateDeviceIp(device.mac, migratedIp, this.currentNetworkId).catch(console.warn);
                        this.emit('deviceUpdated', device);
                        this.emit('devicesUpdated', Array.from(this.devices.values()));
                        return;
                    }
                }

                // TRUST-FRESH BYPASS: bila perangkat baru terverifikasi online sangat baru-baru ini,
                // kegagalan satu probe jauh lebih mungkin karena contention Npcap/CPU (mis. saat scan/
                // gaming) ketimbang perangkat benar-benar pergi. Percayai kehadiran segar & lanjutkan
                // aksi daripada gagal-palsu. Ambang 15s ≈ satu siklus watchdog liveness.
                const TRUST_FRESH_ONLINE_MS = 15_000;
                const lastSeenMs = device.last_seen ? new Date(device.last_seen).getTime() : 0;
                const sinceSeenMs = lastSeenMs > 0 ? Date.now() - lastSeenMs : Infinity;
                if (sinceSeenMs < TRUST_FRESH_ONLINE_MS) {
                    console.log(`✅ [Pre-Flight Trust-Fresh] ${device.mac} terakhir online ${Math.round(sinceSeenMs / 1000)}s lalu (< ${TRUST_FRESH_ONLINE_MS / 1000}s) — melewati vonis offline, lanjutkan aksi.`);
                    return;
                }

                // Target terbukti offline (tidak membalas Pre-Flight Liveness Probe)
                const normMac = device.mac.toLowerCase();
                device.is_online = false;
                this.devices.set(device.ip, device);
                await this.db.setDeviceOnlineStatus(device.mac, false, this.currentNetworkId).catch(console.warn);
                this.emit('deviceUpdated', device);
                this.emit('deviceDisconnected', device);
                this.emit('devicesUpdated', Array.from(this.devices.values()));

                // ⏱️ [30-Second Penalty Window] Karantina offline selama 30 detik (kecuali ada DHCP Fast-Revival)
                const prevTimer = this.offlineCooldownTimers.get(normMac);
                if (prevTimer) clearTimeout(prevTimer);

                const penaltyTimer = setTimeout(() => {
                    this.offlineCooldownTimers.delete(normMac);
                    console.log(`⏱️ [Cooldown 30s Expired] Masa karantina offline untuk ${device.hostname || device.ip} (${normMac}) selesai.`);
                }, 30000);
                this.offlineCooldownTimers.set(normMac, penaltyTimer);

                const name = (device.alias && device.alias.trim()) || (device.hostname && device.hostname.trim()) || device.ip;
                throw new Error(`Perangkat ${name} tidak merespons (Offline / sudah tidak terhubung ke Wi-Fi).`);
            }
        } catch (err: any) {
            if (err.message && err.message.includes('tidak merespons')) {
                throw err;
            }
            console.warn('Notice in pre-flight liveness check:', err.message);
        }
    }

    async init(): Promise<void> {
        await this.db.init();
        // Sembuhkan profil yang namanya generik/'Unknown' dari hostname personal perangkatnya, agar
        // MAC hasil rotasi tak lagi mewarisi nama "Unknown" (idempoten, hanya naik generik→personal).
        try { if (typeof this.db.backfillProfileNames === "function") await this.db.backfillProfileNames(); } catch (e: any) { console.warn('Notice profile name backfill:', e?.message); }

        if (this.currentNetworkId === 'net_default' && typeof this.db?.getAllNetworks === 'function') {
            try {
                const ifaces = os.networkInterfaces();
                const networks = this.db.getAllNetworks();
                for (const net of networks) {
                    if (net.gateway_ip && net.gateway_ip !== '0.0.0.0') {
                        for (const addrs of Object.values(ifaces)) {
                            for (const a of addrs || []) {
                                if (a.family === 'IPv4' && !a.internal && isIpInSameSubnet(net.gateway_ip, a.address)) {
                                    this.currentNetworkId = net.id;
                                    console.log(`🌐 [DeviceManager] Initialized network scope from local adapter: ${this.currentNetworkId} (${net.gateway_ip})`);
                                    break;
                                }
                            }
                            if (this.currentNetworkId !== 'net_default') break;
                        }
                    }
                    if (this.currentNetworkId !== 'net_default') break;
                }
            } catch {}
        }

        const storedDevices = await this.db.getAllDevices(this.currentNetworkId);
        this.devices.clear();
        // Load in reverse (offline first, online last) so online devices cleanly overwrite any legacy stale IP duplicates
        const sorted = [...storedDevices].sort((a, b) => (a.is_online === b.is_online ? 0 : a.is_online ? 1 : -1));
        for (const device of sorted) {
            // Python fresh saat boot: session_id dari DB pasti basi (sesi spoof tak dipersistkan).
            // Bersihkan agar auto-reblock membangun ulang sesi, bukan mengira sesinya hidup (SP-2).
            if (device.session_id) device.session_id = undefined;
            // INTEGRITAS CONTROLLER: Abaikan riwayat controller offline dari DB agar tidak menjadi entri hantu saat startup
            const selfHostname = os.hostname().toLowerCase();
            const devHost = (device.hostname || '').trim().toLowerCase();
            if (!device.is_online && (device.is_self || (devHost && devHost === selfHostname))) continue;
            // Offline devices (ip='') keyed by identity so they don't collapse onto '' (BUG-17).
            this.devices.set(deviceMemKey(device), device);
        }
        console.log(`📦 Loaded ${storedDevices.length} persistent devices from SQLite`);
        this.emit('devicesUpdated', storedDevices);

        // Retention Sweep: arsipkan perangkat tamu yang lama hilang saat startup, lalu harian.
        await this._runRetentionSweep();
        const retentionTimer = setInterval(() => {
            this._runRetentionSweep().catch(err => console.warn('Notice retention sweep:', err.message));
        }, RETENTION_SWEEP_INTERVAL_MS);
        retentionTimer.unref();

        // Background Liveness Watchdog: verifikasi state jaringan tiap 25 detik — HANYA saat Auto Scan
        // aktif. Di mode "Scan saja" watchdog diam total (tak ada scan latar).
        const watchdogTimer = setInterval(() => {
            if (this._shouldRunWatchdogScan()) {
                this.scanNetwork().catch(err => console.warn('Notice background watchdog scan:', err.message));
            }
        }, 25000);
        watchdogTimer.unref();
    }

    /**
     * Arsipkan perangkat basi via DB (berpagar: hanya tamu anonim yang lama offline),
     * bersihkan MAC acak usang & profil duplikat secara berkala, checkpoint WAL SQLite,
     * lalu segarkan memori & UI bila ada perubahan agar database dan tabel tetap ramping.
     */
    private async _runRetentionSweep(): Promise<void> {
        const archived = await this.db.archiveStaleDevices(STALE_DEVICE_RETENTION_DAYS);
        const pruned = typeof this.db.pruneStaleRandomizedMacs === 'function'
            ? this.db.pruneStaleRandomizedMacs(2)
            : { deletedDevices: 0, deletedProfiles: 0 };
        if (typeof this.db.checkpointWal === 'function') {
            this.db.checkpointWal();
        }
        if (archived > 0 || pruned.deletedDevices > 0) {
            const fresh = await this.db.getAllDevices(this.currentNetworkId);
            const freshMacs = new Set(fresh.map(d => d.mac.toLowerCase()));
            for (const [ipKey, dev] of this.devices.entries()) {
                if (!freshMacs.has(dev.mac.toLowerCase())) this.devices.delete(ipKey);
            }
            this.emit('devicesUpdated', fresh);
        }
    }

    private debouncedScan(delayMs: number = 8000) {
        if (this.dhcpScanDebounceTimer) {
            clearTimeout(this.dhcpScanDebounceTimer);
        }
        this.dhcpScanDebounceTimer = setTimeout(() => {
            this.dhcpScanDebounceTimer = null;
            if (!this.scanning) {
                this.scanNetwork().catch(console.error);
            }
        }, delayMs);
        this.dhcpScanDebounceTimer.unref();
    }

    /**
     * Aktifkan/nonaktifkan Auto Scan. Saat diaktifkan, langsung menjalankan satu scan
     * seketika; watchdog latar & scan-saat-perangkat-baru menjadi aktif. Saat dimatikan,
     * seluruh scan otomatis berhenti (mode "Scan saja"): pembatalan debounce yang tertunda
     * agar tak ada scan latar yang menyusul. Mengembalikan status akhir.
     */
    setAutoScan(enabled: boolean): boolean {
        const next = Boolean(enabled);
        // Gate tier di BACKEND: Auto Scan hanya untuk tier berbayar (free = "Scan saja"). Ditegakkan
        // di sini — bukan hanya UI — agar klien free ter-autentikasi tak bisa menyalakan scan latar
        // via emit WS langsung. Permisif bila LicenseManager tak ada (dev/test tanpa lisensi).
        if (next && this.license && this.license.getLicense().tier === 'free') {
            console.warn('⚠️ [Auto Scan] Ditolak: tier free hanya "Scan saja". Upgrade untuk mengaktifkan Auto Scan.');
            if (this.autoScanEnabled) {
                this.autoScanEnabled = false;
                this.emit('autoScanChanged', { enabled: false });
            }
            return false;
        }

        const changed = next !== this.autoScanEnabled;
        this.autoScanEnabled = next;

        if (!next && this.dhcpScanDebounceTimer) {
            clearTimeout(this.dhcpScanDebounceTimer);
            this.dhcpScanDebounceTimer = null;
        }

        this.emit('autoScanChanged', { enabled: this.autoScanEnabled });

        // Mengaktifkan Auto Scan langsung memicu satu scan seketika.
        if (next && changed && !this.scanning) {
            this.scanNetwork().catch(err => console.warn('Notice immediate auto-scan:', err?.message));
        }
        return this.autoScanEnabled;
    }

    isAutoScanEnabled(): boolean {
        return this.autoScanEnabled;
    }

    /** Watchdog latar hanya scan bila Auto Scan aktif, tak sedang scan, & ada perangkat. */
    private _shouldRunWatchdogScan(): boolean {
        return this.autoScanEnabled && !this.scanning && this.devices.size > 0;
    }

    isScanning(): boolean {
        return this.scanning;
    }

    getCurrentNetworkId(): string {
        return this.currentNetworkId;
    }

    /** True bila DB memakai fallback in-memory (data tidak tersimpan permanen) — P3. */
    isUsingMemoryFallback(): boolean {
        return this.db.usingMemoryFallback === true;
    }

    isPythonReady(): boolean {
        return this.python.isReady();
    }

    async getSystemDiagnostics(): Promise<any> {
        const pyDiag = await this.python.getDiagnostics();
        const memoryFallback = this.isUsingMemoryFallback();
        
        let dbDeviceCount = 0;
        let dbJournalMode = 'wal';
        let dbPath = 'data/sentinel.db';
        try {
            const devices = await this.db.getAllDevices();
            dbDeviceCount = devices.length;
            dbJournalMode = this.db.getJournalMode();
            dbPath = this.db.getDbPath();
        } catch {}

        const dbCheck = {
            status: memoryFallback ? 'warning' : 'ok',
            persistent: !memoryFallback,
            mode: dbJournalMode,
            path: dbPath,
            device_count: dbDeviceCount,
            details: memoryFallback
                ? 'Database berjalan in-memory (data tidak disimpan permanen ke disk).'
                : `SQLite ${dbJournalMode.toUpperCase()} engine terverifikasi (${dbDeviceCount} perangkat tersimpan di ${path.basename(dbPath)}).`
        };

        const shieldCheck = {
            status: 'ok',
            gateway_immune: true,
            self_immune: true,
            details: 'Safety Invariants aktif: Router Default Gateway & Operator [This PC] kebal 100% dari self-cut.'
        };

        const combinedChecks = {
            ...(pyDiag.checks || {}),
            database_persistence: dbCheck,
            sentinel_shield: shieldCheck
        };

        const combinedLogs = [
            `[BOOT] Node.js Sentinel Orchestrator (:5000) listening on 127.0.0.1 (PID: ${process.pid})`,
            `[DB] ${dbCheck.details}`,
            ...(pyDiag.logs || []),
            `[SAFETY] ${shieldCheck.details}`
        ];

        return {
            success: true,
            status: pyDiag.status === 'error' ? 'error' : (pyDiag.status === 'warning' || memoryFallback ? 'warning' : 'ok'),
            timestamp: new Date().toISOString(),
            checks: combinedChecks,
            logs: combinedLogs
        };
    }

    async scanNetwork(options: DeviceScanOptions = {}): Promise<Device[]> {
        // Single-Flight Coalescing: bila scan sedang berjalan, bagikan promise yang sama tanpa antre ulang.
        if (this.inFlightScan) {
            if (options.requireFresh) {
                const priorScan = this.inFlightScan;
                try {
                    await priorScan;
                } catch {
                    // A fresh scan still gets one attempt after an older scan fails.
                }
                if (this.inFlightScan && this.inFlightScan !== priorScan) {
                    return this.scanNetwork(options);
                }
                return this.scanNetwork({
                    ...options,
                    requireFresh: false
                });
            }
            console.log('⏳ [DeviceManager] Scan is already in progress, returning shared in-flight scan promise.');
            return this.inFlightScan;
        }
        this.inFlightScan = this._scanNetworkImpl(options).finally(() => {
            this.inFlightScan = null;
        });
        return this.inFlightScan;
    }

    private async _scanNetworkImpl(options: DeviceScanOptions): Promise<Device[]> {
        this.scanning = true;
        this.emit('scanStarted');
        try {
            let rawScanned = await this.python.scan(
                options.skipMulticastWakeup
                    ? { skipMulticastWakeup: true }
                    : {}
            );

            // Pastikan Komputer Operator (Perangkat Ini / Controller) selalu ada & Online!
            const activeGwForFilter = rawScanned.find(d => d.is_gateway) || this.findGateway();
            try {
                const ifaces = os.networkInterfaces();
                for (const addrs of Object.values(ifaces)) {
                    if (!addrs) continue;
                    for (const a of addrs) {
                        if (a.family === 'IPv4' && !a.internal && (a.address.startsWith('192.168.') || a.address.startsWith('10.') || a.address.startsWith('172.'))) {
                            // Filter ketat: Jika gateway aktif diketahui, HANYA daftarkan interface controller yang
                            // satu subnet dengan gateway. Abaikan adapter virtual (WSL vEthernet, Hyper-V, Docker)
                            // yang berada di subnet berbeda agar tidak mencemari database dengan duplikasi laptop offline.
                            if (activeGwForFilter && !isIpInSameSubnet(a.address, activeGwForFilter.ip)) {
                                continue;
                            }
                            const selfIdx = rawScanned.findIndex(d => d.ip === a.address || d.mac.toLowerCase() === a.mac.toLowerCase());
                            if (selfIdx >= 0) {
                                rawScanned[selfIdx].is_self = true;
                                rawScanned[selfIdx].is_online = true;
                                rawScanned[selfIdx].hostname = os.hostname();
                            } else {
                                // OS operator dideteksi DINAMIS (bukan hardcode) agar benar
                                // di komputer pengguna mana pun.
                                const plt = os.platform();
                                let selfOs = 'Unknown';
                                if (plt === 'win32') {
                                    const build = parseInt(os.release().split('.')[2] || '0', 10);
                                    selfOs = build >= 22000 ? 'Windows 11' : 'Windows 10';
                                } else if (plt === 'darwin') {
                                    selfOs = 'macOS';
                                } else {
                                    selfOs = 'Linux';
                                }
                                rawScanned.push({
                                    ip: a.address,
                                    mac: a.mac.toLowerCase(),
                                    hostname: os.hostname(),
                                    vendor: 'This PC (Controller)',
                                    os: selfOs,
                                    device_type: 'This PC (Perangkat Ini)',
                                    is_gateway: false,
                                    is_self: true,
                                    is_online: true,
                                    is_blocked: false,
                                    rtt_ms: 0.1,
                                    open_ports: [],
                                    services: []
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('Notice ensuring self device:', err);
            }

            // INTEGRITAS CONTROLLER: Pastikan hanya ada 1 perangkat controller (is_self) aktif di jaringan ini
            const activeSelf = rawScanned.find(d => d.is_self);
            if (activeSelf) {
                for (const d of rawScanned) {
                    if (d !== activeSelf && d.is_self) {
                        d.is_self = false;
                    }
                }
                for (const [k, d] of this.devices.entries()) {
                    if (d.is_self && d.mac.toLowerCase() !== activeSelf.mac.toLowerCase()) {
                        d.is_self = false;
                        if (!d.is_online) {
                            this.devices.delete(k);
                        }
                    }
                }
            }

            // Saring rawScanned: Hanya proses perangkat yang berada dalam satu subnet dengan gateway aktif
            if (activeGwForFilter) {
                rawScanned = rawScanned.filter(d => isIpInSameSubnet(d.ip, activeGwForFilter.ip));
                if (activeGwForFilter.mac) {
                    const detectedNetId = deriveNetworkId(activeGwForFilter.mac);
                    if (detectedNetId !== this.currentNetworkId) {
                        console.log(`🌐 [DeviceManager] Network shift detected during scan: ${this.currentNetworkId} -> ${detectedNetId}`);
                        this.currentNetworkId = detectedNetId;
                        this.devices.clear();
                        if (typeof this.db?.getAllDevices === 'function') {
                            try {
                                const stored = await this.db.getAllDevices(this.currentNetworkId);
                                for (const d of stored) {
                                    this.devices.set(deviceMemKey(d), d);
                                }
                            } catch (e: any) {
                                console.warn('Notice loading devices on network shift:', e?.message);
                            }
                        }
                    }
                    if (typeof this.db?.ensureNetwork === 'function') {
                        this.db.ensureNetwork({
                            id: detectedNetId,
                            ssid: 'Network ' + (activeGwForFilter.ip || 'LAN'),
                            gateway_ip: activeGwForFilter.ip || '0.0.0.0',
                            gateway_mac: activeGwForFilter.mac,
                            subnet: (activeGwForFilter.ip ? activeGwForFilter.ip.substring(0, activeGwForFilter.ip.lastIndexOf('.')) + '.0/24' : '0.0.0.0/0')
                        });
                    }
                }
            }

            // Tag each scanned device with currentNetworkId
            for (const dev of rawScanned) {
                dev.network_id = this.currentNetworkId;
            }

            // Sinkronkan ke SQLite:
            // 1. Mempertahankan is_blocked jika perangkat pernah diblokir
            // 2. Mendeteksi perangkat terblokir yang baru saja kembali ke jaringan
            // 3. Menandai perangkat yang tidak tertangkap sebagai is_online = false (bukan dihapus!)
            // Ambil daftar sesi HIDUP engine agar syncScanResults dapat mendeteksi session_id BASI
            // (device ditandai blok tapi sesinya sudah mati di engine) → jadikan target reblock &
            // bersihkan session_id. undefined bila engine tak terjangkau (fallback: percayai nilai tersimpan).
            const liveSessionIds = await this._getLiveEngineSessionIds();
            const { allDevices, autoReblockTargets, autoThrottleTargets, zombieSessionsToStop } = await this.db.syncScanResults(rawScanned, liveSessionIds);

            // Sehatkan nama profil dari hostname personal yang baru dipelajari scan ini (idempoten).
            try { if (typeof this.db.backfillProfileNames === "function") await this.db.backfillProfileNames(); } catch (e: any) { console.warn('Notice profile name backfill (scan):', e?.message); }

            // Bersihkan sesi zombie lama dari MAC yang baru saja diarsipkan
            if (zombieSessionsToStop && zombieSessionsToStop.length > 0) {
                for (const sid of zombieSessionsToStop) {
                    try {
                        console.log(`🧹 [CLEANUP] Stopping zombie spoof session ${sid} from archived MAC`);
                        await this.python.stopSpoof(sid);
                    } catch (e) {
                        console.warn(`Notice stopping archived session ${sid}:`, e);
                    }
                }
            }

            // Deteksi perangkat yang beralih status dari online menjadi offline.
            const prevByMac = new Map<string, Device>();
            for (const d of this.devices.values()) prevByMac.set(d.mac.toLowerCase(), d);
            for (const dev of allDevices) {
                if (!dev.is_self && !dev.is_gateway && !dev.is_online) {
                    const prev = prevByMac.get(dev.mac.toLowerCase());
                    if (prev && prev.is_online) {
                        console.log(`🔌 [DeviceManager] Device disconnected: ${dev.ip || dev.last_ip || '-'} (${dev.mac})`);
                        // Bersihkan sesi Gaming Mode agar tak bocor & agar reconnect ter-throttle lagi.
                        await this._stopGamingSession(dev.mac.toLowerCase());
                        if (prev.ip) {
                            this.devices.delete(prev.ip);
                        }
                        // Pertahankan perangkat yang baru offline di memori memakai kunci
                        // identitas (bukan menghapusnya), agar tetap tampil di tab Offline
                        // alih-alih hilang dari daftar (BUG-17). Merge utama (bawah) melewati
                        // perangkat ber-ip kosong, jadi entri ini tidak akan ditimpa.
                        this.devices.set(deviceMemKey(dev), dev);
                        this.emit('deviceDisconnected', dev);
                    }
                }
            }

            // In-Place Delta Merge: JANGAN panggil this.devices.clear() agar status manipulasi aktif tidak pernah hilang.
            const activeGw = allDevices.find(d => d.is_gateway) || rawScanned.find(d => d.is_gateway);
            const rawScannedIps = new Set(rawScanned.map(d => d.ip));

            // Kumpulkan profile_id yang memiliki perangkat aktif online
            const activeProfileIds = new Set<string>();
            for (const dev of allDevices) {
                if (dev.is_online && dev.profile_id) {
                    activeProfileIds.add(dev.profile_id);
                }
            }

            // Indeks perangkat saat ini di memori berdasarkan MAC untuk rekonsiliasi yang aman
            const currentMemByMac = new Map<string, Device>();
            for (const d of this.devices.values()) {
                currentMemByMac.set(d.mac.toLowerCase(), d);
            }
            const newlyAddedProfileMacs = new Set<string>();

            for (const dev of allDevices) {
                // Lewati perangkat tanpa IP valid
                if (!dev.ip || dev.ip.trim() === '') {
                    continue;
                }

                // INTEGRITAS CONTROLLER: Komputer operator (is_self) tidak pernah berstatus offline di aplikasinya sendiri.
                // Jika ada entri lama dari adapter virtual yang mati, abaikan agar tidak muncul duplikat offline.
                if (dev.is_self && !dev.is_online) {
                    continue;
                }

                // Jika perangkat ini offline namun ada perangkat online lain dengan profile_id yang sama, lewati duplikat lama
                if (!dev.is_online && dev.profile_id && activeProfileIds.has(dev.profile_id)) {
                    continue;
                }

                // Muat/Perbarui perangkat jika dalam satu subnet atau tertangkap scan
                if (rawScannedIps.has(dev.ip) || !activeGw || isIpInSameSubnet(dev.ip, activeGw.ip)) {
                    const devMacNorm = dev.mac.toLowerCase();
                    const existing = currentMemByMac.get(devMacNorm);
                    const conflictDev = this.devices.get(dev.ip);

                    // ATURAN INTEGRITAS: Perangkat offline TIDAK BOLEH menimpa perangkat online di IP yang sama!
                    if (!dev.is_online && conflictDev && conflictDev.is_online && conflictDev.mac.toLowerCase() !== devMacNorm) {
                        continue;
                    }

                    if (existing) {
                        // Hapus kunci lama yang DITEMPATI `existing`: bisa IP lama (migrasi IP), ATAU
                        // kunci IDENTITAS saat perangkat sedang offline (ip='' → profile_id/MAC). Kalau
                        // hanya cek `existing.ip`, kunci identitas tak terhapus dan object yang sama juga
                        // diset di dev.ip (baris bawah) → duplikat identity+IP yang menggandakan hitungan
                        // kuota lisensi (filter(is_blocked).length).
                        const staleKey = deviceMemKey(existing);
                        if (staleKey !== dev.ip) {
                            this.devices.delete(staleKey);
                        }

                        // Jika ada perangkat lain yang sebelumnya menempati dev.ip di memori, bersihkan konflik tersebut
                        if (conflictDev && conflictDev.mac.toLowerCase() !== devMacNorm) {
                            this.devices.delete(dev.ip);
                        }

                        // Patch metadata discovery & hardware
                        existing.ip = dev.ip;
                        existing.hostname = dev.hostname || existing.hostname;
                        existing.vendor = dev.vendor || existing.vendor;
                        existing.os = dev.os || existing.os;
                        existing.device_type = dev.device_type || existing.device_type;
                        existing.rtt_ms = dev.rtt_ms;
                        existing.open_ports = dev.open_ports || existing.open_ports;
                        existing.services = dev.services || existing.services;
                        existing.is_online = dev.is_online;
                        existing.last_seen = dev.last_seen || existing.last_seen;
                        existing.distance_zone = dev.distance_zone || existing.distance_zone;
                        existing.estimated_range = dev.estimated_range || existing.estimated_range;
                        existing.ipv6_link_local = dev.ipv6_link_local || existing.ipv6_link_local;
                        existing.ipv6_global = dev.ipv6_global || existing.ipv6_global;
                        existing.ipv6_addresses = dev.ipv6_addresses || existing.ipv6_addresses;
                        existing.is_dual_stack = dev.is_dual_stack ?? existing.is_dual_stack;
                        existing.profile_id = dev.profile_id || existing.profile_id;
                        existing.dhcp_vendor_class = dev.dhcp_vendor_class || existing.dhcp_vendor_class;
                        existing.dhcp_fingerprint = dev.dhcp_fingerprint || existing.dhcp_fingerprint;
                        existing.dhcp_client_id = dev.dhcp_client_id || existing.dhcp_client_id;
                        existing.dhcp_fqdn = dev.dhcp_fqdn || existing.dhcp_fqdn;
                        if (dev.alias) existing.alias = dev.alias;
                        if (dev.is_gateway !== undefined) existing.is_gateway = dev.is_gateway;
                        if (dev.is_self !== undefined) existing.is_self = dev.is_self;

                        // Jika perangkat di memori belum punya sesi aktif, sinkronkan status block/throttle dari DB
                        if (!existing.session_id && dev.is_blocked !== undefined) {
                            existing.is_blocked = dev.is_blocked;
                            existing.speed_limit = dev.speed_limit;
                        }

                        this.devices.set(dev.ip, existing);
                    } else {
                        // Jika ada perangkat lain yang sebelumnya menempati dev.ip di memori, bersihkan konflik
                        if (conflictDev && conflictDev.mac.toLowerCase() !== devMacNorm) {
                            this.devices.delete(dev.ip);
                        }
                        this.devices.set(dev.ip, { ...dev });
                        if (
                            dev.is_online
                            && !dev.is_gateway
                            && !dev.is_self
                            && normalizeProfileMac(dev.mac)
                            && isPrivateIpv4(dev.ip)
                        ) {
                            newlyAddedProfileMacs.add(devMacNorm);
                        }
                    }
                }
            }

            // Temukan gateway untuk eksekusi spoofing
            const gateway = this.findGateway();

            // 1. Eksekusi AUTO-REBLOCK dengan LATE-CHECK otoritatif
            if (gateway && autoReblockTargets.length > 0) {
                for (const target of autoReblockTargets) {
                    if (target.is_gateway || target.ip === gateway.ip) continue;

                    const currentDev = this.devices.get(target.ip);
                    if (!currentDev) continue;

                    // Late-Check: Jika user baru saja unblock saat scan berjalan, batalkan auto-reblock
                    if (!currentDev.is_blocked) {
                        console.log(`⏩ [AUTO-REBLOCK] Skipping ${target.ip} because it was unblocked during scan`);
                        continue;
                    }

                    // Bersihkan sesi lama jika ada (dari sebelum offline / IP lama) sebelum membangun sesi fresh
                    await this._clearStaleSpoofSession(currentDev);

                    try {
                        console.log(`⚡ [AUTO-REBLOCK] Target detected returning: ${currentDev.hostname || currentDev.ip} (MAC: ${currentDev.mac}, IP: ${currentDev.ip})`);
                        const sessionId = await this.python.startSpoof(
                            currentDev.ip,
                            currentDev.mac,
                            gateway.ip,
                            gateway.mac,
                            0,
                            currentDev.ipv6_link_local || currentDev.ipv6_global,
                            gateway.ipv6_link_local || gateway.ipv6_global
                        );

                        currentDev.is_blocked = true;
                        currentDev.speed_limit = 0;
                        currentDev.session_id = sessionId;
                        await this.db.setDeviceBlocked(currentDev.mac, true, sessionId, this.currentNetworkId);
                        await this.db.setDeviceSpeedLimit(currentDev.mac, 0, this.currentNetworkId);

                        this.devices.set(currentDev.ip, currentDev);
                        this.emit('deviceUpdated', currentDev);
                        this.emit('autoReblocked', currentDev);
                    } catch (err) {
                        console.error(`❌ [AUTO-REBLOCK] Failed to auto-block ${target.ip}:`, err);
                    }
                }
            }

            // 2. Eksekusi AUTO-THROTTLE dengan LATE-CHECK otoritatif
            if (gateway && autoThrottleTargets.length > 0) {
                for (const target of autoThrottleTargets) {
                    if (target.is_gateway || target.ip === gateway.ip) continue;

                    const currentDev = this.devices.get(target.ip);
                    if (!currentDev) continue;

                    // Late-Check: Jika speed limit sudah diubah ke 100% atau diblokir penuh, lewati
                    if (currentDev.speed_limit === undefined || currentDev.speed_limit >= 100 || currentDev.is_blocked) {
                        continue;
                    }

                    // Bersihkan sesi lama jika ada (dari sebelum offline / IP lama) sebelum membangun sesi fresh
                    await this._clearStaleSpoofSession(currentDev);

                    try {
                        const limit = currentDev.speed_limit ?? 50;
                        console.log(`⚡ [AUTO-THROTTLE] Reapplying speed limit ${limit}% for ${currentDev.hostname || currentDev.ip} (${currentDev.mac})`);
                        const sessionId = await this.python.startSpoof(
                            currentDev.ip,
                            currentDev.mac,
                            gateway.ip,
                            gateway.mac,
                            limit,
                            currentDev.ipv6_link_local || currentDev.ipv6_global,
                            gateway.ipv6_link_local || gateway.ipv6_global
                        );

                        currentDev.is_blocked = false;
                        currentDev.speed_limit = limit;
                        currentDev.session_id = sessionId;
                        await this.db.setDeviceBlocked(currentDev.mac, false, sessionId, this.currentNetworkId);
                        await this.db.setDeviceSpeedLimit(currentDev.mac, limit, this.currentNetworkId);

                        this.devices.set(currentDev.ip, currentDev);
                        this.emit('deviceUpdated', currentDev);
                    } catch (err) {
                        console.error(`❌ [AUTO-THROTTLE] Failed to auto-throttle ${target.ip}:`, err);
                    }
                }
            }

            // 3. Gaming Mode: throttle perangkat yang baru terdeteksi online selagi mode aktif,
            // agar isolasi airtime tetap menyeluruh untuk perangkat yang bergabung belakangan.
            // Diserialisasi (runExclusive) + recheck gamingActive agar tak balapan dgn disable.
            if (this.gamingActive && gateway) {
                await this._reapplyGamingSweep(gateway);
            }

            for (const mac of newlyAddedProfileMacs) {
                this.scheduleProfileEnrichment(mac, PROFILE_ENRICHMENT_DEBOUNCE_MS);
            }

            // Lekatkan status pemutusan dua-stack (IPv4+IPv6) dari engine agar UI dapat menampilkan
            // indikator kill-switch & menyorot kebocoran IPv6. Best-effort: kegagalan tak menggagalkan scan.
            await this._attachSpoofCutStatus();

            this.emit('devicesUpdated', Array.from(this.devices.values()));
            return Array.from(this.devices.values());
        } finally {
            this.scanning = false;
            this.emit('scanComplete', Array.from(this.devices.values()));
        }
    }

    async blockDevice(ip: string, gatewayIp: string): Promise<Device> {
        return this.runExclusive(() => this._blockDeviceImpl(ip, gatewayIp));
    }

    private async _blockDeviceImpl(ip: string, gatewayIp: string): Promise<Device> {
        let device = this.devices.get(ip) || this._findDeviceByMac(ip);
        if (!device) {
            throw new Error(`Device ${ip} not found`);
        }
        this._assertNoPendingGamingRecoveryConflict([device]);

        // Jika IP perangkat kosong (perangkat offline / rotasi MAC), cari IP aktif via MAC atau profil
        if (!device.ip) {
            for (const d of this.devices.values()) {
                if ((d.mac.toLowerCase() === device.mac.toLowerCase() || (device.profile_id && d.profile_id === device.profile_id)) && d.ip && d.is_online) {
                    device.ip = d.ip;
                    device.mac = d.mac;
                    break;
                }
            }
        }

        if (device.is_self) {
            throw new Error(`Cannot block operator host / This PC (${ip})`);
        }

        if (device.is_gateway || device.ip === gatewayIp) {
            throw new Error(`Cannot block the gateway (${ip})`);
        }

        if (device.is_blocked && device.session_id) {
            throw new Error(`Device ${ip} already actively blocked`);
        }

        if (this.license) {
            const activeBlockedCount = Array.from(this.devices.values()).filter(d => d.is_blocked).length;
            const check = this.license.checkCanBlock(activeBlockedCount, Boolean(device.is_blocked));
            if (!check.allowed) {
                throw new FeatureLimitError(check.reason || 'Batas kuota pemutusan tercapai. Upgrade ke Pro untuk memutus tanpa batas!');
            }
        }

        const gateway = this.devices.get(gatewayIp) || this.findGateway();
        if (!gateway) {
            throw new Error(`Gateway ${gatewayIp} not found`);
        }

        // Pre-Flight Validation: Verifikasi apakah target benar-benar aktif di jaringan L2
        await this._verifyPreFlightLiveness(device, gateway.ip);

        let sessionId = device.session_id;
        if (sessionId) {
            // Jika sudah ada sesi aktif (misal dari throttling), cukup ubah limit menjadi 0 (cut-off)
            await this.python.setSpoofLimit(sessionId, 0);
        } else {
            sessionId = await this.python.startSpoof(
                device.ip,
                device.mac,
                gateway.ip,
                gateway.mac,
                0,
                device.ipv6_link_local || device.ipv6_global,
                gateway.ipv6_link_local || gateway.ipv6_global
            );
        }

        device.is_blocked = true;
        device.speed_limit = 0;
        device.session_id = sessionId;
        device.is_online = true;
        this.devices.set(ip, device);

        // Sinkronkan juga perangkat lain di memori yang berbagi profile_id sama
        if (device.profile_id) {
            for (const [key, d] of this.devices.entries()) {
                if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                    d.is_blocked = true;
                    d.speed_limit = 0;
                    this.devices.set(key, d);
                }
            }
        }

        // Simpan status blokir secara persisten di SQLite
        await this.db.setDeviceBlocked(device.mac, true, sessionId, this.currentNetworkId);
        await this.db.setDeviceSpeedLimit(device.mac, 0, this.currentNetworkId);
        await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);

        this.emit('deviceUpdated', device);
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return device;
    }

    /**
     * Hentikan sesi spoof lama pada perangkat (dari sebelum offline / IP lama) sebelum
     * membangun sesi fresh. Kegagalan stopSpoof diabaikan: sesi lama mungkin sudah mati
     * di engine (404), yang penting ID-nya dinolkan agar tak membingungkan state.
     */
    private async _clearStaleSpoofSession(device: Device): Promise<void> {
        if (!device.session_id) return;
        const oldSessionId = device.session_id;
        device.session_id = undefined;
        try {
            await this.python.stopSpoof(oldSessionId);
        } catch {
            // Engine mungkin sudah menghapus sesi ini (mis. restart/timeout) — aman diabaikan
        }
    }

    async unblockDevice(identifier: string): Promise<Device> {
        return this.runExclusive(() => this._unblockDeviceImpl(identifier));
    }

    private async _unblockDeviceImpl(identifier: string): Promise<Device> {
        const device = this._findDeviceByMac(identifier) || this.devices.get(identifier);
        if (!device) {
            const dbDev = await this.db.getDeviceByMac(identifier, this.currentNetworkId);
            if (!dbDev) {
                throw new Error(`Device ${identifier} not found`);
            }
            // Device exists in DB but not in active memory
            dbDev.is_blocked = false;
            dbDev.speed_limit = 100;

            // Sinkronkan juga perangkat lain di memori yang berbagi profile_id sama
            if (dbDev.profile_id) {
                for (const [key, d] of this.devices.entries()) {
                    if (d.profile_id === dbDev.profile_id) {
                        if (d.session_id) {
                            try { await this.python.stopSpoof(d.session_id); } catch {}
                        }
                        d.is_blocked = false;
                        d.is_redirected = false;
                        d.redirect_url = undefined;
                        d.speed_limit = 100;
                        d.session_id = undefined;
                        this.devices.set(key, d);
                    }
                }
            }

            await this.db.setDeviceBlocked(dbDev.mac, false, undefined, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(dbDev.mac, 100, this.currentNetworkId);
            this.emit('deviceUpdated', dbDev);
            this.emit('devicesUpdated', Array.from(this.devices.values()));
            return dbDev;
        }

        this._assertNoPendingGamingRecoveryConflict([device]);

        if (device.is_redirected) {
            await this.python.stopRedirect(device.ip);
        } else if (device.session_id) {
            await this.python.stopSpoof(device.session_id);
        }

        device.is_blocked = false;
        device.is_redirected = false;
        device.redirect_url = undefined;
        device.speed_limit = 100;
        device.session_id = undefined;
        this.devices.set(deviceMemKey(device), device);

        // Sinkronkan juga perangkat lain di memori yang berbagi profile_id sama
        if (device.profile_id) {
            for (const [key, d] of this.devices.entries()) {
                if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                    if (d.session_id) {
                        try { await this.python.stopSpoof(d.session_id); } catch {}
                    }
                    d.is_blocked = false;
                    d.is_redirected = false;
                    d.redirect_url = undefined;
                    d.speed_limit = 100;
                    d.session_id = undefined;
                    this.devices.set(key, d);
                }
            }
        }

        // Hapus status blokir dan pulihkan speed limit ke 100% di SQLite
        await this.db.setDeviceBlocked(device.mac, false, undefined, this.currentNetworkId);
        await this.db.setDeviceSpeedLimit(device.mac, 100, this.currentNetworkId);
        if (device.is_online) {
            await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        }

        this.emit('deviceUpdated', device);
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return device;
    }

    async redirectDevice(ip: string, redirectUrl: string, instagramUsername: string = '', gatewayIp?: string): Promise<Device> {
        return this.runExclusive(() => this._redirectDeviceImpl(ip, redirectUrl, instagramUsername, gatewayIp));
    }

    private async _redirectDeviceImpl(ip: string, redirectUrl: string, instagramUsername: string = '', gatewayIp?: string): Promise<Device> {
        const device = this.devices.get(ip);
        if (!device) {
            throw new Error(`Device ${ip} not found`);
        }
        this._assertNoPendingGamingRecoveryConflict([device]);

        if (device.is_gateway || (gatewayIp && device.ip === gatewayIp)) {
            throw new Error(`Cannot redirect the gateway (${ip})`);
        }

        if (device.is_self) {
            throw new Error(`Cannot redirect operator host (${ip})`);
        }

        // If device is actively blocked or throttled, unblock first
        if (device.is_blocked || (device.session_id && !device.is_redirected)) {
            if (device.session_id) await this.python.stopSpoof(device.session_id);
            device.is_blocked = false;
            device.speed_limit = 100;
            device.session_id = undefined;
            await this.db.setDeviceBlocked(device.mac, false, undefined, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(device.mac, 100, this.currentNetworkId);
        }

        const gw = (gatewayIp ? this.devices.get(gatewayIp) : null) || this.findGateway();
        if (!gw) {
            throw new Error('Gateway not found');
        }

        const res = await this.python.startRedirect(
            device.ip,
            device.mac,
            gw.ip,
            gw.mac,
            redirectUrl,
            instagramUsername
        );

        device.is_redirected = true;
        device.redirect_url = redirectUrl;
        device.is_online = true;
        if (res && res.arp_session_id) {
            device.session_id = res.arp_session_id;
        }

        this.devices.set(ip, device);
        await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        this.emit('deviceUpdated', device);
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return device;
    }

    async stopRedirectDevice(ip: string): Promise<Device> {
        return this.runExclusive(() => this._stopRedirectDeviceImpl(ip));
    }

    private async _stopRedirectDeviceImpl(ip: string): Promise<Device> {
        const device = this.devices.get(ip);
        if (!device) {
            throw new Error(`Device ${ip} not found`);
        }
        this._assertNoPendingGamingRecoveryConflict([device]);

        await this.python.stopRedirect(device.ip);

        device.is_redirected = false;
        device.redirect_url = undefined;
        device.session_id = undefined;
        device.is_online = true;

        this.devices.set(ip, device);
        await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        this.emit('deviceUpdated', device);
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return device;
    }

    async deleteDevice(mac: string): Promise<void> {
        return this.runExclusive(() => this._deleteDeviceImpl(mac));
    }

    private async _deleteDeviceImpl(mac: string): Promise<void> {
        const normMac = mac.toLowerCase();
        const requestedDevice = this._findDeviceByMac(normMac);
        if (!requestedDevice && this.pendingGamingDisable) {
            throw this._pendingGamingRecoveryError();
        }
        const requestedProfileId = requestedDevice?.profile_id;
        const inMemoryTargets = requestedProfileId
            ? Array.from(this.devices.values()).filter(device => device.profile_id === requestedProfileId)
            : requestedDevice ? [requestedDevice] : [];
        this._assertNoPendingGamingRecoveryConflict(inMemoryTargets);

        const existing = await this.db.getDeviceByMac(normMac, this.currentNetworkId);
        const profileId = requestedProfileId || existing?.profile_id;

        const devicesToDelete: Array<[string, Device]> = [];
        for (const [ip, dev] of this.devices.entries()) {
            if (dev.mac.toLowerCase() === normMac || (profileId && dev.profile_id === profileId)) {
                devicesToDelete.push([ip, dev]);
            }
        }
        this._assertNoPendingGamingRecoveryConflict(devicesToDelete.map(([, device]) => device));

        for (const [, dev] of devicesToDelete) {
            if (dev.is_redirected) {
                await this.python.stopRedirect(dev.ip);
            } else if (dev.session_id) {
                await this.python.stopSpoof(dev.session_id);
            }
        }

        await this.db.deleteDevice(mac, this.currentNetworkId);
        for (const [ip] of devicesToDelete) {
            this.devices.delete(ip);
        }

        this.emit('devicesUpdated', Array.from(this.devices.values()));
    }

    async clearAllDevices(): Promise<void> {
        return this.runExclusive(() => this._clearAllDevicesImpl());
    }

    private async _clearAllDevicesImpl(): Promise<void> {
        if (this.pendingGamingDisable) {
            throw this._pendingGamingRecoveryError();
        }
        await this.db.clearAllDevices(this.currentNetworkId);
        this.devices.clear();
        this.emit('devicesUpdated', []);
    }

    async setDeviceAlias(mac: string, alias: string): Promise<Device> {
        const updated = await this.db.setDeviceAlias(mac, alias, this.currentNetworkId);
        const normMac = mac.toLowerCase();
        let found = false;
        for (const [ip, dev] of this.devices.entries()) {
            if (dev.mac.toLowerCase() === normMac || (dev.profile_id && dev.profile_id === updated.profile_id)) {
                dev.alias = alias;
                dev.profile_id = updated.profile_id;
                dev.is_online = true;
                this.devices.set(ip, dev);
                this.emit('deviceUpdated', dev);
                found = true;
            }
        }
        if (!found && updated && updated.ip) {
            updated.is_online = true;
            this.devices.set(updated.ip, updated);
        }
        await this.db.setDeviceOnlineStatus(mac, true, this.currentNetworkId);
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return { ...updated, is_online: true };
    }

    async setSpeedLimit(ip: string, limit: number, gatewayIp?: string): Promise<Device> {
        return this.runExclusive(() => this._setSpeedLimitImpl(ip, limit, gatewayIp));
    }

    private async _setSpeedLimitImpl(ip: string, limit: number, gatewayIp?: string): Promise<Device> {
        const device = this.devices.get(ip);
        if (!device) {
            throw new Error(`Device with IP ${ip} not found`);
        }
        this._assertNoPendingGamingRecoveryConflict([device]);

        if (device.is_gateway || device.is_self) {
            throw new Error(`Perangkat infrastruktur (${device.is_gateway ? 'Gateway' : 'Perangkat Ini'}) dilindungi dan tidak dapat dibatasi kecepatannya.`);
        }

        const cleanLimit = Math.max(0, Math.min(100, Math.round(limit)));

        if (cleanLimit > 0 && cleanLimit < 100 && this.license) {
            const check = this.license.checkCanThrottle();
            if (!check.allowed) {
                throw new FeatureLockedError(check.reason || 'Fitur Pembatasan Kecepatan (PWM Bandwidth Throttling) khusus untuk pengguna PRO.');
            }
        }

        const gateway = (gatewayIp ? this.devices.get(gatewayIp) : undefined) || this.findGateway();
        if (!gateway) {
            throw new Error('Gateway not found');
        }

        if (cleanLimit < 100) {
            // Pre-Flight Validation: Verifikasi apakah target benar-benar aktif di jaringan L2
            await this._verifyPreFlightLiveness(device, gateway.ip);
        }

        if (cleanLimit === 100) {
            // Pulihkan kecepatan penuh (100%): stop spoof jika ada
            if (device.session_id) {
                await this.python.stopSpoof(device.session_id);
                device.session_id = undefined;
            }
            device.is_blocked = false;
            device.speed_limit = 100;
            if (device.profile_id) {
                for (const [key, d] of this.devices.entries()) {
                    if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                        if (d.session_id) {
                            try { await this.python.stopSpoof(d.session_id); } catch {}
                        }
                        d.is_blocked = false;
                        d.is_redirected = false;
                        d.redirect_url = undefined;
                        d.speed_limit = 100;
                        d.session_id = undefined;
                        this.devices.set(key, d);
                    }
                }
            }
            await this.db.setDeviceBlocked(device.mac, false, undefined, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(device.mac, 100, this.currentNetworkId);
            await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        } else if (cleanLimit === 0) {
            // Mode Blokir Penuh (0%): Setara cut-off
            if (!device.session_id) {
                const sessionId = await this.python.startSpoof(
                    device.ip,
                    device.mac,
                    gateway.ip,
                    gateway.mac,
                    0,
                    device.ipv6_link_local || device.ipv6_global,
                    gateway.ipv6_link_local || gateway.ipv6_global
                );
                device.session_id = sessionId;
            } else {
                await this.python.setSpoofLimit(device.session_id, 0);
            }
            device.is_blocked = true;
            device.speed_limit = 0;
            if (device.profile_id) {
                for (const [key, d] of this.devices.entries()) {
                    if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                        d.is_blocked = true;
                        d.speed_limit = 0;
                        this.devices.set(key, d);
                    }
                }
            }
            await this.db.setDeviceBlocked(device.mac, true, device.session_id, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(device.mac, 0, this.currentNetworkId);
            await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        } else {
            // Mode Throttle (1% - 99%): Duty cycle PWM
            if (!device.session_id) {
                const sessionId = await this.python.startSpoof(
                    device.ip,
                    device.mac,
                    gateway.ip,
                    gateway.mac,
                    cleanLimit,
                    device.ipv6_link_local || device.ipv6_global,
                    gateway.ipv6_link_local || gateway.ipv6_global
                );
                device.session_id = sessionId;
            } else {
                await this.python.setSpoofLimit(device.session_id, cleanLimit);
            }
            // Penting: Perangkat TIDAK diblokir total, hanya di-throttle
            device.is_blocked = false;
            device.speed_limit = cleanLimit;
            if (device.profile_id) {
                for (const [key, d] of this.devices.entries()) {
                    if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                        d.is_blocked = false;
                        d.speed_limit = cleanLimit;
                        this.devices.set(key, d);
                    }
                }
            }
            await this.db.setDeviceBlocked(device.mac, false, device.session_id, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(device.mac, cleanLimit, this.currentNetworkId);
            await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        }

        device.is_online = true;
        this.devices.set(ip, device);
        this.emit('deviceUpdated', device);
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return device;
    }

    async getStatus(): Promise<any> {
        return this.python.getStatus();
    }

    getDevices(): Device[] {
        const dedup = new Map<string, Device>();
        const selfHostname = os.hostname().toLowerCase();
        for (const dev of this.devices.values()) {
            if (dev.network_id && dev.network_id !== this.currentNetworkId) {
                continue;
            }
            const devHost = (dev.hostname || '').trim().toLowerCase();
            // INTEGRITAS CONTROLLER: Komputer operator (is_self atau hostname This PC) yang offline adalah entri MAC usang.
            // Jangan pernah tampilkan entri controller offline.
            if (!dev.is_online && (dev.is_self || (devHost && devHost === selfHostname))) {
                continue;
            }
            const key = (dev.is_self || (devHost && devHost === selfHostname))
                ? '_operator_controller_' 
                : ((dev.profile_id && dev.profile_id !== '') ? dev.profile_id : dev.mac.toLowerCase());
            const existing = dedup.get(key);
            if (!existing || (!existing.is_online && dev.is_online)) {
                dedup.set(key, dev);
            }
        }
        return Array.from(dedup.values());
    }

    getDevice(ip: string): Device | undefined {
        return this.devices.get(ip);
    }

    /**
     * Saring daftar perangkat untuk TAMPILAN: hanya subnet gateway aktif, dengan
     * SUBNET MASK nyata dari OS (os.networkInterfaces → netmask adapter yang memuat
     * gateway), bukan tebakan. Titik-choke tunggal yang dipakai bridge WebSocket &
     * REST. Fallback bertingkat: bila gateway ATAU mask aktif belum diketahui,
     * kembalikan apa adanya (tak pernah menyembunyikan semua). Jangan dipakai di
     * jalur enforcement/hitung lisensi (yang membaca map mentah).
     */
    scopeForDisplay(devices: Device[]): Device[] {
        const selfHostname = os.hostname().toLowerCase();
        const scopedByNet = devices.filter(d => {
            if (d.network_id && d.network_id !== this.currentNetworkId) return false;
            const devHost = (d.hostname || '').trim().toLowerCase();
            if (!d.is_online && (d.is_self || (devHost && devHost === selfHostname))) return false;
            return true;
        });
        const gw = this.findGateway()?.ip;
        if (!gw) return scopedByNet;
        const ifaces: NetIfaceLike[] = [];
        for (const addrs of Object.values(os.networkInterfaces())) {
            for (const a of addrs || []) {
                ifaces.push({ address: a.address, netmask: a.netmask, family: a.family, internal: a.internal });
            }
        }
        const prefix = resolveActivePrefix(gw, ifaces);
        if (prefix === null) return scopedByNet;
        return scopeDevicesToActiveSubnet(scopedByNet, gw, prefix);
    }

    findGateway(): Device | undefined {
        return selectGateway(Array.from(this.devices.values()));
    }
    async getTelemetry() {
        return this.python.getTelemetry();
    }

    async getWifiInfo() {
        return this.python.getWifiInfo();
    }

    async startTransparentGateway(ip: string, gatewayIp?: string): Promise<any> {
        return this.runExclusive(() => this._startTransparentGatewayImpl(ip, gatewayIp));
    }

    private async _startTransparentGatewayImpl(ip: string, gatewayIp?: string): Promise<any> {
        const device = this.devices.get(ip);
        if (!device) {
            throw new Error(`Device with IP ${ip} not found`);
        }
        this._assertNoPendingGamingRecoveryConflict([device]);
        if (device.is_gateway || device.is_self) {
            throw new Error(`Perangkat infrastruktur (${device.is_gateway ? 'Gateway' : 'Perangkat Ini'}) dilindungi dan tidak dapat dijadikan target Transparent Gateway.`);
        }

        if (this.license) {
            const check = this.license.checkCanGateway();
            if (!check.allowed) {
                throw new FeatureLockedError(check.reason || 'Fitur Smart Transparent Gateway khusus untuk pengguna PRO.');
            }
        }

        const gateway = gatewayIp ? this.devices.get(gatewayIp) || this.findGateway() : this.findGateway();
        if (!gateway) {
            throw new Error('Gateway not found');
        }

        const res = await this.python.startTransparentGateway(device.ip, device.mac, gateway.ip, gateway.mac);
        this.emit('gatewayStatusChanged', await this.getTransparentGatewayStatus());
        return res;
    }

    async stopTransparentGateway(ip: string): Promise<void> {
        return this.runExclusive(() => this._stopTransparentGatewayImpl(ip));
    }

    private async _stopTransparentGatewayImpl(ip: string): Promise<void> {
        const device = this.devices.get(ip);
        if (device) {
            this._assertNoPendingGamingRecoveryConflict([device]);
        }
        this._assertNoPendingGamingRecoveryConflictByIdentity({ ip });
        await this.python.stopTransparentGateway(ip);
        this.emit('gatewayStatusChanged', await this.getTransparentGatewayStatus());
    }

    async getTransparentGatewayStatus(): Promise<any> {
        return this.python.getTransparentGatewayStatus();
    }

    async getSinkholeDomains(): Promise<string[]> {
        return this.python.getSinkholeDomains();
    }

    async addSinkholeDomain(domain: string): Promise<string[]> {
        const res = await this.python.addSinkholeDomain(domain);
        this.emit('gatewayStatusChanged', await this.getTransparentGatewayStatus());
        return res;
    }

    async removeSinkholeDomain(domain: string): Promise<string[]> {
        const res = await this.python.removeSinkholeDomain(domain);
        this.emit('gatewayStatusChanged', await this.getTransparentGatewayStatus());
        return res;
    }

    async getGatewayDnsLogs(limit: number = 100): Promise<any[]> {
        return this.python.getGatewayDnsLogs(limit);
    }

    async clearGatewayDnsLogs(): Promise<void> {
        await this.python.clearGatewayDnsLogs();
    }

    async deepScanDevicePorts(ip: string, ports?: number[]): Promise<Device> {
        let device = this.devices.get(ip);
        if (!device) {
            device = (await this.db.getDeviceByIp(ip)) || undefined;
        }
        if (!device) {
            throw new Error(`Device with IP ${ip} not found`);
        }

        const scanResult = await this.python.deepScanPorts(ip, ports);
        if (scanResult) {
            device.open_ports = scanResult.open_ports || [];
            device.services = scanResult.services || [];
            if (scanResult.web_title) device.web_title = scanResult.web_title;
            if (scanResult.web_server) device.web_server = scanResult.web_server;

            await this.db.saveDevice(device);
            this.devices.set(ip, device);
            this.emit('deviceUpdated', device);
            this.emit('devicesUpdated', Array.from(this.devices.values()));
        }

        return device;
    }

    async optimizeDhcpProfiling(): Promise<DhcpOptimizationResult> {
        if (this.inFlightDhcpOptimization) {
            if (
                this.inFlightDhcpOptimizationGeneration !== this.dhcpOptimizationGeneration
            ) {
                throw new Error(
                    'Network changed during Discovery Refresh. Wait for cleanup, then retry.'
                );
            }
            return this.inFlightDhcpOptimization;
        }

        const now = Date.now();
        if (
            this.lastDhcpOptimization
            && now - this.lastDhcpOptimization.completedAt < DHCP_OPTIMIZATION_COOLDOWN_MS
        ) {
            const elapsed = now - this.lastDhcpOptimization.completedAt;
            return {
                ...this.lastDhcpOptimization.result,
                cached: true,
                cooldown_remaining_ms: Math.max(0, DHCP_OPTIMIZATION_COOLDOWN_MS - elapsed)
            };
        }

        const generation = this.dhcpOptimizationGeneration;
        this.inFlightDhcpOptimizationGeneration = generation;
        this.inFlightDhcpOptimization = (async () => {
            const startedAt = Date.now();
            console.log('⚡ [DeviceManager] Triggering measured Discovery Refresh & DHCP Observation...');
            const observation = await this.python.optimizeDhcpProfiling();
            const devices = await this.scanNetwork({
                skipMulticastWakeup: true,
                requireFresh: true
            });
            if (generation !== this.dhcpOptimizationGeneration) {
                throw new Error(
                    'Network changed before Discovery Refresh completed.'
                );
            }
            const completedAt = Date.now();
            const result: DhcpOptimizationResult = {
                success: true,
                delivery: observation?.data?.delivery || {},
                dhcpDelta: observation?.data?.dhcp_delta || {},
                dhcpStats: observation?.data || {},
                devices,
                cached: false,
                cooldown_remaining_ms: DHCP_OPTIMIZATION_COOLDOWN_MS,
                duration_ms: completedAt - startedAt
            };
            this.lastDhcpOptimization = { completedAt, result };
            return result;
        })().finally(() => {
            this.inFlightDhcpOptimization = null;
            this.inFlightDhcpOptimizationGeneration = null;
        });

        return this.inFlightDhcpOptimization;
    }

    async getDhcpStats(): Promise<any> {
        return this.python.getDhcpStats();
    }

    async profileRefresh(): Promise<ProfileRefreshResult> {
        let waitedForSubset = false;
        while (this.inFlightProfileRefresh) {
            if (this.inFlightProfileRefreshScope === 'all') {
                return this.inFlightProfileRefresh;
            }
            waitedForSubset = true;
            const subset = this.inFlightProfileRefresh;
            try {
                await subset;
            } catch {
                // A manual request still gets one fresh full attempt after subset failure.
            }
        }

        const now = Date.now();
        if (
            !waitedForSubset
            &&
            this.lastProfileRefresh
            && now - this.lastProfileRefresh.completedAt < PROFILE_REFRESH_COOLDOWN_MS
        ) {
            const elapsed = now - this.lastProfileRefresh.completedAt;
            return {
                ...this.lastProfileRefresh.result,
                cached: true,
                cooldown_remaining_ms: Math.max(0, PROFILE_REFRESH_COOLDOWN_MS - elapsed)
            };
        }

        return this.runProfileRefresh(null, 'all');
    }

    async runProfileRefresh(
        targetMacs: Set<string> | null,
        scope: 'all' | 'subset'
    ): Promise<ProfileRefreshResult> {
        while (this.inFlightProfileRefresh) {
            const active = this.inFlightProfileRefresh;
            if (this.inFlightProfileRefreshScope === 'all') {
                if (scope === 'subset') {
                    this.pendingProfileMacs.clear();
                }
                return active;
            }
            try {
                await active;
            } catch {
                // A queued operation is independent and may still make a fresh attempt.
            }
        }

        if (scope === 'all') {
            this.pendingProfileMacs.clear();
            if (this.profileEnrichmentTimer) {
                clearTimeout(this.profileEnrichmentTimer);
                this.profileEnrichmentTimer = null;
            }
        }

        const normalizedTargetMacs = targetMacs === null
            ? null
            : new Set(
                Array.from(targetMacs)
                    .map(normalizeProfileMac)
                    .filter((mac): mac is string => mac !== null)
            );
        const generation = this.profileRefreshGeneration;
        let trackedPromise: Promise<ProfileRefreshResult>;
        trackedPromise = this.executeProfileRefresh(normalizedTargetMacs, scope, generation)
            .finally(() => {
                if (this.inFlightProfileRefresh === trackedPromise) {
                    this.inFlightProfileRefresh = null;
                    this.inFlightProfileRefreshScope = null;
                }
                if (this.pendingProfileMacs.size > 0 && !this.profileEnrichmentTimer) {
                    this.armProfileEnrichmentTimer(0);
                }
            });
        this.inFlightProfileRefresh = trackedPromise;
        this.inFlightProfileRefreshScope = scope;
        return trackedPromise;
    }

    private async executeProfileRefresh(
        targetMacs: Set<string> | null,
        scope: 'all' | 'subset',
        generation: number
    ): Promise<ProfileRefreshResult> {
        const targets = this.snapshotProfileTargets(targetMacs);
        const visibleCount = targets.length;
        const startedPayload = {
            operation: 'profile_refresh',
            scope,
            count: visibleCount
        };
        this.emit('profileRefreshStarted', startedPayload);
        this.emit('quickReauthStarted', { ...startedPayload, deprecated: true });

        const response = await this.python.profileRefresh(targets, 5);
        if (generation !== this.profileRefreshGeneration) {
            throw new Error('Network changed before Profile Refresh completed.');
        }

        const uniqueAssessments = new Map<string, ProfileAssessment>();
        for (const assessment of response.devices || []) {
            const normalizedMac = normalizeProfileMac(assessment.mac);
            if (normalizedMac) {
                uniqueAssessments.set(normalizedMac, {
                    ...assessment,
                    mac: normalizedMac
                });
            }
        }

        const persistedAssessmentMacs = new Set<string>();
        for (const assessment of uniqueAssessments.values()) {
            if (await this.persistCurrentProfileAssessment(assessment, generation)) {
                persistedAssessmentMacs.add(assessment.mac);
            }
        }

        this.assertProfileRefreshGeneration(generation);
        const updatedDevices: Device[] = [];
        for (const assessment of uniqueAssessments.values()) {
            if (!persistedAssessmentMacs.has(assessment.mac)) continue;
            const liveDevice = this.findCurrentOnlineProfileDeviceByMac(assessment.mac);
            if (!liveDevice) continue;
            this.mergeProfileAssessment(liveDevice, assessment);
            updatedDevices.push(liveDevice);
        }
        for (const liveDevice of updatedDevices) {
            this.emit('deviceUpdated', liveDevice);
        }
        if (updatedDevices.length > 0) {
            this.emit('devicesUpdated', Array.from(this.devices.values()));
        }

        this.assertProfileRefreshGeneration(generation);
        const result: ProfileRefreshResult = {
            ...response,
            success: true,
            devices: this.getDevices(),
            cached: false,
            cooldown_remaining_ms: scope === 'all' ? PROFILE_REFRESH_COOLDOWN_MS : 0
        };
        const completedAt = Date.now();
        this.assertProfileRefreshGeneration(generation);
        for (const target of targets) {
            this.profileEnrichmentCooldowns.set(target.mac, completedAt);
        }
        this.assertProfileRefreshGeneration(generation);
        if (scope === 'all') {
            this.lastProfileRefresh = { completedAt, result };
        }

        this.assertProfileRefreshGeneration(generation);
        const donePayload = {
            ...result,
            operation: 'profile_refresh',
            scope,
            count: visibleCount
        };
        this.emit('profileRefreshDone', donePayload);
        this.assertProfileRefreshGeneration(generation);
        this.emit('quickReauthDone', { ...donePayload, deprecated: true });
        this.assertProfileRefreshGeneration(generation);
        return result;
    }

    private snapshotProfileTargets(
        targetMacs: Set<string> | null
    ): Array<{ ip: string; mac: string; ipv6_addresses: string[] }> {
        const targets = new Map<string, { ip: string; mac: string; ipv6_addresses: string[] }>();
        for (const device of this.devices.values()) {
            const mac = normalizeProfileMac(device.mac);
            if (
                !mac
                || (targetMacs !== null && !targetMacs.has(mac))
                || !device.is_online
                || device.is_gateway
                || device.is_self
                || !isPrivateIpv4(device.ip)
            ) {
                continue;
            }
            const ipv6Addresses = normalizeProfileIpv6Addresses([
                ...(device.ipv6_addresses || []),
                device.ipv6_link_local,
                device.ipv6_global
            ]);
            targets.set(mac, {
                ip: device.ip.trim(),
                mac,
                ipv6_addresses: ipv6Addresses
            });
        }
        return Array.from(targets.values());
    }

    private assertProfileRefreshGeneration(generation: number): void {
        if (generation !== this.profileRefreshGeneration) {
            throw new Error('Network changed before Profile Refresh completed.');
        }
    }

    private findCurrentOnlineProfileDeviceByMac(mac: string): Device | undefined {
        const normalizedMac = normalizeProfileMac(mac);
        if (!normalizedMac) return undefined;
        for (const [ip, device] of this.devices.entries()) {
            if (
                ip !== device.ip.trim()
                || normalizeProfileMac(device.mac) !== normalizedMac
                || !device.is_online
                || device.is_gateway
                || device.is_self
                || !isPrivateIpv4(device.ip)
            ) {
                continue;
            }
            const occupant = this.devices.get(device.ip.trim());
            if (occupant && normalizeProfileMac(occupant.mac) === normalizedMac) {
                return occupant;
            }
        }
        return undefined;
    }

    private async persistCurrentProfileAssessment(
        assessment: ProfileAssessment,
        generation: number
    ): Promise<boolean> {
        let persistedIp: string | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            this.assertProfileRefreshGeneration(generation);
            const liveDevice = this.findCurrentOnlineProfileDeviceByMac(assessment.mac);
            if (!liveDevice) return false;
            const currentIp = liveDevice.ip.trim();
            if (persistedIp === currentIp) return true;

            await this.db.updateDeviceProfileAssessment({
                ...assessment,
                ip: currentIp
            }, this.currentNetworkId);
            this.assertProfileRefreshGeneration(generation);
            persistedIp = currentIp;

            const currentDevice = this.findCurrentOnlineProfileDeviceByMac(assessment.mac);
            if (!currentDevice) return false;
            if (currentDevice.ip.trim() === persistedIp) return true;
        }
        return false;
    }

    private findDeviceByMac(mac: string): Device | undefined {
        const normalizedMac = normalizeProfileMac(mac);
        if (!normalizedMac) return undefined;
        for (const device of this.devices.values()) {
            if (normalizeProfileMac(device.mac) === normalizedMac) {
                return device;
            }
        }
        return undefined;
    }

    private mergeProfileAssessment(device: Device, assessment: ProfileAssessment): void {
        if (!isGenericProfileLabel(assessment.vendor, 'vendor')) {
            device.vendor = assessment.vendor;
        }
        if (!isGenericProfileLabel(assessment.device_type, 'device_type')) {
            device.device_type = assessment.device_type;
        }
        if (!isGenericProfileLabel(assessment.hostname, 'hostname')) {
            device.hostname = assessment.hostname;
        }
        if (!isGenericProfileLabel(assessment.os, 'os')) {
            device.os = assessment.os;
        }
        device.vendor_confidence = assessment.vendor_confidence;
        device.type_confidence = assessment.type_confidence;
        device.hostname_confidence = assessment.hostname_confidence;
        device.profile_status = assessment.profile_status;
        device.profile_evidence = assessment.profile_evidence;
        device.profiled_at = assessment.profiled_at;
        device.profile_version = assessment.profile_version;
    }

    private scheduleProfileEnrichment(
        mac: string,
        delayMs: number = PROFILE_ENRICHMENT_DEBOUNCE_MS
    ): void {
        const normalizedMac = normalizeProfileMac(mac);
        if (!normalizedMac) return;
        if (this.inFlightProfileRefreshScope === 'all') {
            this.pendingProfileMacs.delete(normalizedMac);
            return;
        }
        const completedAt = this.profileEnrichmentCooldowns.get(normalizedMac);
        if (
            completedAt !== undefined
            && Date.now() - completedAt < PROFILE_ENRICHMENT_COOLDOWN_MS
        ) {
            return;
        }
        this.pendingProfileMacs.add(normalizedMac);
        if (!this.profileEnrichmentTimer) {
            this.armProfileEnrichmentTimer(delayMs);
        }
    }

    private armProfileEnrichmentTimer(delayMs: number): void {
        this.profileEnrichmentTimer = setTimeout(() => {
            this.profileEnrichmentTimer = null;
            this.drainProfileEnrichment().catch(error => {
                console.warn('Notice automatic profile enrichment:', error);
            });
        }, Math.max(0, delayMs));
        this.profileEnrichmentTimer.unref();
    }

    private async drainProfileEnrichment(): Promise<void> {
        if (this.pendingProfileMacs.size === 0) return;
        if (this.inFlightProfileRefresh) {
            if (this.inFlightProfileRefreshScope === 'all') {
                this.pendingProfileMacs.clear();
                return;
            }
            const active = this.inFlightProfileRefresh;
            active.then(
                () => {
                    if (this.pendingProfileMacs.size > 0 && !this.profileEnrichmentTimer) {
                        this.armProfileEnrichmentTimer(0);
                    }
                },
                () => {
                    if (this.pendingProfileMacs.size > 0 && !this.profileEnrichmentTimer) {
                        this.armProfileEnrichmentTimer(0);
                    }
                }
            );
            return;
        }

        const now = Date.now();
        const eligibleMacs = new Set<string>();
        for (const mac of this.pendingProfileMacs) {
            const completedAt = this.profileEnrichmentCooldowns.get(mac);
            if (
                completedAt !== undefined
                && now - completedAt < PROFILE_ENRICHMENT_COOLDOWN_MS
            ) {
                this.pendingProfileMacs.delete(mac);
                continue;
            }
            const device = this.findDeviceByMac(mac);
            if (
                !device
                || !device.is_online
                || device.is_gateway
                || device.is_self
                || !isPrivateIpv4(device.ip)
            ) {
                this.pendingProfileMacs.delete(mac);
                continue;
            }
            eligibleMacs.add(mac);
            this.pendingProfileMacs.delete(mac);
        }

        if (eligibleMacs.size > 0) {
            await this.runProfileRefresh(eligibleMacs, 'subset');
        }
    }

    /** @deprecated Use profileRefresh(). */
    async quickReauthProfiling(): Promise<ProfileRefreshResult> {
        return this.profileRefresh();
    }

    async getApIsolationStatus(): Promise<any> {
        return this.python.getApIsolationStatus();
    }

    async getCAInfo(): Promise<any> {
        return await this.python.getCAInfo();
    }

    async getCACertPem(): Promise<string> {
        return await this.python.getCACertPem();
    }

    async getL7Flows(query?: any): Promise<any> {
        return await this.python.getL7Flows(query);
    }

    async clearL7Flows(): Promise<void> {
        await this.python.clearL7Flows();
    }

    async generateLeafCert(domain: string): Promise<any> {
        return await this.python.generateLeafCert(domain);
    }

    // ===== BETTERCAP SECURITY SUITE WRAPPERS =====
    async getBettercapStatus(): Promise<any> {
        return await this.python.getBettercapStatus();
    }

    async getBettercapDnsRules(): Promise<any> {
        return await this.python.getBettercapDnsRules();
    }

    async addBettercapDnsRule(domain: string, target_ip: string, action: string = 'spoof', is_enabled: boolean = true): Promise<any> {
        return await this.python.addBettercapDnsRule(domain, target_ip, action, is_enabled);
    }

    async updateBettercapDnsRule(ruleId: string, updates: { domain?: string; target_ip?: string; action?: string; is_enabled?: boolean }): Promise<any> {
        return await this.python.updateBettercapDnsRule(ruleId, updates);
    }

    async deleteBettercapDnsRule(ruleId: string): Promise<any> {
        return await this.python.deleteBettercapDnsRule(ruleId);
    }

    async setBettercapDnsSpoofAll(enabled: boolean, address: string = ''): Promise<any> {
        return await this.python.setBettercapDnsSpoofAll(enabled, address);
    }

    async loadBettercapDnsHosts(content: string, defaultAddress: string = '', action: string = 'spoof'): Promise<any> {
        return await this.python.loadBettercapDnsHosts(content, defaultAddress, action);
    }

    async setBettercapDnsTtl(ttl: number): Promise<any> {
        return await this.python.setBettercapDnsTtl(ttl);
    }

    async getBettercapCredentials(limit: number = 100): Promise<any[]> {
        return await this.python.getBettercapCredentials(limit);
    }

    async clearBettercapCredentials(): Promise<void> {
        await this.python.clearBettercapCredentials();
    }

    async runBettercapSynScan(targetIp: string, ports?: number[], profile: string = 'top-20'): Promise<any> {
        return await this.python.runBettercapSynScan(targetIp, ports, profile);
    }

    async getShieldStatus(): Promise<any> {
        return await this.python.getShieldStatus();
    }

    async toggleShield(enabled: boolean, mode: string = 'host_lock', autoRetaliate: boolean = false, lanTargets: any[] = []): Promise<any> {
        return await this.python.toggleShield(enabled, mode, autoRetaliate, lanTargets);
    }

    async setShieldMode(mode: string, autoRetaliate: boolean = false): Promise<any> {
        return await this.python.setShieldMode(mode, autoRetaliate);
    }

    async getShieldThreats(): Promise<any[]> {
        return await this.python.getShieldThreats();
    }

    async clearShieldThreats(): Promise<boolean> {
        return await this.python.clearShieldThreats();
    }

    async getGamingStatus(): Promise<any> {
        return this.python.getGamingStatus();
    }

    async toggleGamingMode(enabled: boolean, mode: string = 'auto_airtime', targetPingMs: number = 25.0): Promise<any> {
        return this.runExclusive(async () => {
            if (enabled) {
                if (this.pendingGamingDisable) {
                    throw new Error('Gaming disable recovery is pending');
                }
                const result = await this.python.toggleGamingMode(true, mode, targetPingMs);
                const gateway = selectGateway(Array.from(this.devices.values()));
                if (!gateway) {
                    this.emit('gamingStatusChanged', result);
                    return result;
                }

                // Auto-Isolate / Auto-Throttle seluruh perangkat LAN yang sedang online (kecuali Gateway & This PC)
                const targetLimit = mode === 'blackhole_priority' ? 0 : 20;
                this.gamingActive = true;
                this.gamingMode = mode;
                this.gamingTargetLimit = targetLimit;

                const onlineTargets = Array.from(this.devices.values()).filter(d =>
                    !d.is_gateway && !d.is_self && d.is_online
                );

                console.log(`🎮 [GAMING MODE AKTIF] Mengisolasi otomatis ${onlineTargets.length} perangkat LAN (Mode: ${mode}, Limit: ${targetLimit}%)...`);

                for (const target of onlineTargets) {
                    await this._applyGamingToDevice(target, gateway);
                }

                this.emit('devicesUpdated', Array.from(this.devices.values()));
                this.emit('gamingStatusChanged', result);
                return result;
            } else {
                const pending = this.pendingGamingDisable || this._createPendingGamingDisable(mode, targetPingMs);
                this.pendingGamingDisable = pending;
                console.log(`🎮 [GAMING MODE NONAKTIF] Memulihkan ${pending.restorePlans.length} perangkat yang dikelola Gaming Mode...`);

                for (const plan of pending.restorePlans) {
                    if (!plan.stopped && plan.sessionId) {
                        await this.python.stopSpoof(plan.sessionId);
                        plan.stopped = true;
                    }
                }

                if (!pending.pythonOff) {
                    pending.result = await this.python.toggleGamingMode(
                        false,
                        pending.mode,
                        pending.targetPingMs
                    );
                    pending.pythonOff = true;
                    this.gamingActive = false;
                }

                for (const plan of pending.restorePlans) {
                    if (!plan.device) continue;
                    if (plan.hadSession && !plan.restoredSessionId) {
                        const gateway = pending.gateway;
                        if (!gateway) {
                            throw new Error('Gateway not found');
                        }
                        plan.restoredSessionId = await this.python.startSpoof(
                            plan.device.ip,
                            plan.device.mac,
                            gateway.ip,
                            gateway.mac,
                            plan.priorLimit,
                            plan.device.ipv6_link_local,
                            gateway.ipv6_link_local
                        );
                    }
                }

                for (const plan of pending.restorePlans) {
                    if (!plan.device) continue;
                    const restoredSessionId = plan.hadSession ? plan.restoredSessionId : undefined;
                    const speedLimit = plan.hadSession ? plan.priorLimit : 100;
                    const isBlocked = plan.hadSession && plan.priorLimit <= 0;
                    if (!plan.blockedPersisted) {
                        await this.db.setDeviceBlocked(plan.device.mac, isBlocked, restoredSessionId);
                        plan.blockedPersisted = true;
                    }
                    if (!plan.speedLimitPersisted) {
                        await this.db.setDeviceSpeedLimit(plan.device.mac, speedLimit);
                        plan.speedLimitPersisted = true;
                    }
                }

                const updatedDevices: Device[] = [];
                for (const plan of pending.restorePlans) {
                    if (!plan.device) continue;
                    const device = this._findDeviceByMac(plan.macKey);
                    if (!device) continue;
                    device.session_id = plan.hadSession ? plan.restoredSessionId : undefined;
                    device.speed_limit = plan.hadSession ? plan.priorLimit : 100;
                    device.is_blocked = plan.hadSession && plan.priorLimit <= 0;
                    this.devices.set(device.ip, device);
                    updatedDevices.push(device);
                }

                this.gamingActive = false;
                this.gamingManaged.clear();
                this.pendingGamingDisable = null;
                for (const device of updatedDevices) {
                    this.emit('deviceUpdated', device);
                }
                this.emit('devicesUpdated', Array.from(this.devices.values()));
                this.emit('gamingStatusChanged', pending.result);
                return pending.result;
            }
        });
    }

    private _createPendingGamingDisable(mode: string, targetPingMs: number): PendingGamingDisable {
        const restorePlans = Array.from(this.gamingManaged.entries()).map(([macKey, meta]) => {
            const device = this._findDeviceByMac(macKey);
            return {
                macKey,
                priorLimit: meta.priorLimit,
                hadSession: meta.hadSession,
                sessionId: meta.sessionId || device?.session_id,
                device: device ? {
                    ip: device.ip,
                    mac: device.mac,
                    ipv6_link_local: device.ipv6_link_local,
                    profile_id: device.profile_id,
                } : undefined,
                stopped: false,
                blockedPersisted: false,
                speedLimitPersisted: false,
            };
        });
        const gateway = selectGateway(Array.from(this.devices.values()));
        if (restorePlans.some(plan => plan.hadSession && plan.device) && !gateway) {
            throw new Error('Gateway not found');
        }
        return {
            mode,
            targetPingMs,
            gateway: gateway ? {
                ip: gateway.ip,
                mac: gateway.mac,
                ipv6_link_local: gateway.ipv6_link_local,
            } : undefined,
            restorePlans,
            pythonOff: false,
        };
    }

    private _findDeviceByMac(macKey: string): Device | undefined {
        const norm = (macKey || '').toLowerCase();
        for (const device of this.devices.values()) {
            if (device.mac.toLowerCase() === norm) return device;
        }
        return undefined;
    }

    private _assertNoPendingGamingRecoveryConflict(devices: Iterable<Device>): void {
        for (const device of devices) {
            this._assertNoPendingGamingRecoveryConflictByIdentity({
                mac: device.mac,
                ip: device.ip,
                profileId: device.profile_id,
            });
        }
    }

    private _assertNoPendingGamingRecoveryConflictByIdentity(
        identity: { mac?: string; ip?: string; profileId?: string }
    ): void {
        if (!this.pendingGamingDisable) return;

        for (const plan of this.pendingGamingDisable.restorePlans) {
            if (
                (identity.mac && plan.macKey === identity.mac.toLowerCase()) ||
                (identity.ip && plan.device?.ip === identity.ip) ||
                (identity.profileId && plan.device?.profile_id === identity.profileId)
            ) {
                throw this._pendingGamingRecoveryError();
            }
        }
    }

    private _pendingGamingRecoveryError(): Error {
        return new Error(
            'Gaming disable recovery is pending for a managed device. Retry disabling Gaming Mode before changing its network state.'
        );
    }

    /**
     * Terapkan throttle Gaming Mode ke SATU perangkat (sesi blackhole).
     * Baseline (limit sebelum gaming) hanya direkam SEKALI di gamingManaged; pemanggilan
     * ulang (ganti target ping / ganti mode / perangkat baru) tidak menimpanya, sehingga
     * pemulihan saat gaming OFF selalu kembali ke nilai asli — bukan ke 20%/0% milik gaming.
     * Wajib dipanggil dari konteks yang sudah runExclusive.
     */
    private async _applyGamingToDevice(target: Device, gateway: Device): Promise<void> {
        if (target.is_gateway || target.is_self) return;
        const macKey = target.mac.toLowerCase();
        try {
            const already = this.gamingManaged.get(macKey);
            const priorLimit = already ? already.priorLimit : (target.speed_limit ?? 100);
            const hadSession = already ? already.hadSession : Boolean(target.session_id);

            // Gaming SELALU memakai sesi BLACKHOLE (racun ke MAC hantu, bukan MAC operator)
            // agar trafik perangkat lain jatuh di AP & tidak membanjiri Wi-Fi operator (anti-lag).
            // Hentikan sesi lama (manual atau gaming sebelumnya) dulu bila ada.
            if (target.session_id) {
                try { await this.python.stopSpoof(target.session_id); } catch {}
            }
            const sessionId = await this.python.startSpoof(
                target.ip,
                target.mac,
                gateway.ip,
                gateway.mac,
                this.gamingTargetLimit,
                target.ipv6_link_local,
                gateway.ipv6_link_local,
                true  // blackhole
            );
            target.session_id = sessionId;
            target.speed_limit = this.gamingTargetLimit;
            target.is_blocked = (this.gamingTargetLimit <= 0);
            this.gamingManaged.set(macKey, { priorLimit, hadSession, sessionId });
            this.devices.set(target.ip, target);
            this.emit('deviceUpdated', target);
        } catch (err: any) {
            console.warn(`Notice mengisolasi perangkat ${target.ip} untuk Gaming Mode:`, err.message);
        }
    }

    /**
     * Bila Gaming Mode aktif, throttle perangkat yang BARU online (belum dikelola gaming).
     * Dipanggil dari jalur yang sudah runExclusive (scan merge, liveness, dhcp).
     */
    private async _maybeApplyGamingToNewDevice(dev: Device): Promise<void> {
        if (!this.gamingActive) return;
        if (dev.is_gateway || dev.is_self || !dev.is_online) return;
        if (this.gamingManaged.has(dev.mac.toLowerCase())) return;
        const gateway = selectGateway(Array.from(this.devices.values()));
        if (!gateway) return;
        await this._applyGamingToDevice(dev, gateway);
    }

    /**
     * Hentikan sesi Gaming Mode untuk satu MAC (dipakai saat perangkat disconnect).
     * Menghentikan sesi Python via sessionId tersimpan lalu menghapus entri agar:
     *  - sesi tak bocor (loop spoof Python berhenti), dan
     *  - saat perangkat kembali online, ia di-throttle ulang (bukan terkunci entri basi).
     */
    private async _stopGamingSession(macKey: string): Promise<void> {
        const gm = this.gamingManaged.get(macKey);
        if (!gm) return;
        if (gm.sessionId) {
            try {
                await this.python.stopSpoof(gm.sessionId);
            } catch (error) {
                console.warn(`Notice stopping Gaming Mode session ${gm.sessionId}:`, error);
            }
        }
        this.gamingManaged.delete(macKey);
    }

    /**
     * Terapkan throttle gaming ke semua perangkat online yang belum dikelola.
     * Diserialisasi via runExclusive agar tak balapan dengan toggle/DHCP, dan mengecek
     * ulang gamingActive agar tidak men-throttle perangkat SETELAH user menekan disable.
     */
    private async _reapplyGamingSweep(gateway: Device): Promise<void> {
        await this.runExclusive(async () => {
            if (!this.gamingActive) return;
            for (const dev of Array.from(this.devices.values())) {
                if (dev.is_gateway || dev.is_self || !dev.is_online) continue;
                if (this.gamingManaged.has(dev.mac.toLowerCase())) continue;
                await this._applyGamingToDevice(dev, gateway);
            }
        });
    }

}
