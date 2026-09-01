import os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { PythonBridge } from './pythonBridge';
import { DatabaseService } from './database';
import { LicenseManager, FeatureLimitError, FeatureLockedError } from './licenseManager';
import { Device } from '../types';

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
 * Pilih gateway dari daftar perangkat dengan aman:
 *   1. Perangkat yang di-flag is_gateway (otoritatif dari scanner).
 *   2. Fallback heuristik: perangkat non-self ber-IP .1 / .254.
 * TIDAK ada fallback ke perangkat sembarang — kembalikan undefined bila tidak ada,
 * agar operasi spoofing gagal aman ("Gateway not found") ketimbang meracuni perangkat acak.
 */
export function selectGateway(devices: Device[]): Device | undefined {
    for (const d of devices) {
        if (d.is_gateway) return d;
    }
    for (const d of devices) {
        if (!d.is_self && (d.ip.endsWith('.1') || d.ip.endsWith('.254'))) return d;
    }
    return undefined;
}

export class DeviceManager extends EventEmitter {
    private devices: Map<string, Device> = new Map();
    private scanning: boolean = false;
    private inFlightScan: Promise<Device[]> | null = null;
    private dhcpScanDebounceTimer: NodeJS.Timeout | null = null;
    private offlineCooldownTimers: Map<string, NodeJS.Timeout> = new Map();
    // Perangkat yang dikelola Gaming Mode + limit sebelumnya agar bisa dipulihkan tepat.
    private gamingManaged: Map<string, { priorLimit: number; hadSession: boolean }> = new Map();
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

        this.python.on('networkChanged', (data) => {
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
            this._handleLivenessEvent(data).catch(console.warn);
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
            this.emit('gamingStatusChanged', data);
        });
    }

    private async _handleDhcpEvent(data: any): Promise<void> {
        {
            console.log('⚡ [DeviceManager] DHCP event received:', data);
            if (data && data.kind === 'release' && (data.mac || data.ip)) {
                let updatedAny = false;
                if (data.mac) {
                    const normMac = data.mac.toLowerCase();
                    for (const [ipKey, dev] of this.devices.entries()) {
                        if (dev.mac.toLowerCase() === normMac) {
                            dev.is_online = false;
                            if (dev.ip) {
                                dev.last_ip = dev.ip;
                                this.devices.delete(ipKey);
                                dev.ip = '';
                            }
                            this.db.setDeviceOnlineStatus(dev.mac, false).catch(console.warn);
                            this.emit('deviceUpdated', dev);
                            this.emit('deviceDisconnected', dev);
                            updatedAny = true;
                        }
                    }
                }
                if (updatedAny) {
                    this.emit('devicesUpdated', Array.from(this.devices.values()));
                }
                this.emit('dhcpActivity', { kind: 'release', mac: data.mac, ip: data.ip });
            } else if (data && data.mac && data.ip) {
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
                    this.db.setDeviceOnlineStatus(occupantOfNewIp.mac, false).catch(console.warn);
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
                    dev.is_online = true;
                    dev.ip = data.ip;
                    if (data.hostname && !dev.hostname) dev.hostname = data.hostname;
                    if (data.vendor_class) dev.dhcp_vendor_class = data.vendor_class;
                    if (data.dhcp_fingerprint) dev.dhcp_fingerprint = data.dhcp_fingerprint;
                    this.devices.set(dev.ip, dev);
                    this.db.updateDeviceIp(dev.mac, data.ip).catch(console.warn);
                    this.emit('deviceUpdated', dev);
                    this.emit('devicesUpdated', Array.from(this.devices.values()));
                } else {
                    isNewDevice = true;
                }

                this.emit('dhcpActivity', {
                    kind: isNewDevice ? 'new' : 'renew',
                    mac: normMac,
                    ip: data.ip,
                    hostname: data.hostname,
                    vendor_class: data.vendor_class
                });

                // Debounce network scan: Hanya jadwalkan scan bila ada perangkat baru yang belum terdaftar di database/memory
                if (isNewDevice) {
                    this.debouncedScan();
                }
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
            await this.db.setDeviceOnlineStatus(dev.mac, isOnline).catch(console.warn);
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
                for (const [ipKey, d] of this.devices.entries()) {
                    if (d.mac.toLowerCase() === device.mac.toLowerCase() && ipKey !== device.ip && d.is_online) {
                        migratedIp = ipKey;
                        break;
                    }
                }

                if (migratedIp) {
                    console.log(`⚡ [Pre-Flight Auto-Migration] Target ${device.mac} berpindah dari ${device.ip} ke ${migratedIp}, memverifikasi IP baru...`);
                    const reCheck = await this.python.pulseLiveness(
                        [{ ip: migratedIp, mac: device.mac }],
                        gatewayIp
                    );
                    if (reCheck && reCheck[migratedIp] && reCheck[migratedIp].is_alive) {
                        console.log(`✅ [Pre-Flight Auto-Migration] Target ${device.mac} TERBUKTI HIDUP di IP baru ${migratedIp}!`);
                        this.devices.delete(device.ip);
                        device.ip = migratedIp;
                        device.is_online = true;
                        this.devices.set(migratedIp, device);
                        await this.db.updateDeviceIp(device.mac, migratedIp).catch(console.warn);
                        this.emit('deviceUpdated', device);
                        this.emit('devicesUpdated', Array.from(this.devices.values()));
                        return;
                    }
                }

                // Target terbukti offline (tidak membalas Pre-Flight Liveness Probe)
                const normMac = device.mac.toLowerCase();
                device.is_online = false;
                this.devices.set(device.ip, device);
                await this.db.setDeviceOnlineStatus(device.mac, false).catch(console.warn);
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
        const storedDevices = await this.db.getAllDevices();
        this.devices.clear();
        // Load in reverse (offline first, online last) so online devices cleanly overwrite any legacy stale IP duplicates
        const sorted = [...storedDevices].sort((a, b) => (a.is_online === b.is_online ? 0 : a.is_online ? 1 : -1));
        for (const device of sorted) {
            this.devices.set(device.ip, device);
        }
        console.log(`📦 Loaded ${storedDevices.length} persistent devices from SQLite`);
        this.emit('devicesUpdated', storedDevices);

        // Background Liveness Watchdog: Periodically verify active network state every 25 seconds
        const watchdogTimer = setInterval(() => {
            if (!this.scanning && this.devices.size > 0) {
                this.scanNetwork().catch(err => console.warn('Notice background watchdog scan:', err.message));
            }
        }, 25000);
        watchdogTimer.unref();
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

    isScanning(): boolean {
        return this.scanning;
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

    async scanNetwork(): Promise<Device[]> {
        // Single-Flight Coalescing: bila scan sedang berjalan, bagikan promise yang sama tanpa antre ulang.
        if (this.inFlightScan) {
            console.log('⏳ [DeviceManager] Scan is already in progress, returning shared in-flight scan promise.');
            return this.inFlightScan;
        }
        this.inFlightScan = this._scanNetworkImpl().finally(() => {
            this.inFlightScan = null;
        });
        return this.inFlightScan;
    }

    private async _scanNetworkImpl(): Promise<Device[]> {
        this.scanning = true;
        this.emit('scanStarted');
        try {
            let rawScanned = await this.python.scan();

            // Pastikan Komputer Operator (Perangkat Ini / Controller) selalu ada & Online!
            try {
                const ifaces = os.networkInterfaces();
                for (const addrs of Object.values(ifaces)) {
                    if (!addrs) continue;
                    for (const a of addrs) {
                        if (a.family === 'IPv4' && !a.internal && (a.address.startsWith('192.168.') || a.address.startsWith('10.') || a.address.startsWith('172.'))) {
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

            // Saring rawScanned: Hanya proses perangkat yang berada dalam satu subnet dengan gateway aktif
            const activeGwForFilter = rawScanned.find(d => d.is_gateway) || this.findGateway();
            if (activeGwForFilter) {
                rawScanned = rawScanned.filter(d => d.is_self || isIpInSameSubnet(d.ip, activeGwForFilter.ip));
            }

            // Sinkronkan ke SQLite:
            // 1. Mempertahankan is_blocked jika perangkat pernah diblokir
            // 2. Mendeteksi perangkat terblokir yang baru saja kembali ke jaringan
            // 3. Menandai perangkat yang tidak tertangkap sebagai is_online = false (bukan dihapus!)
            const { allDevices, autoReblockTargets, autoThrottleTargets, zombieSessionsToStop } = await this.db.syncScanResults(rawScanned);

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
                        if (prev.ip) {
                            this.devices.delete(prev.ip);
                        }
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

            for (const dev of allDevices) {
                // Lewati perangkat tanpa IP valid
                if (!dev.ip || dev.ip.trim() === '') {
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
                        // Jika perangkat sebelumnya terdaftar di IP berbeda di memori, hapus IP lama
                        if (existing.ip && existing.ip !== dev.ip) {
                            this.devices.delete(existing.ip);
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

                    // Jika sesi sudah aktif berjalan, jangan buat sesi ganda
                    if (currentDev.session_id) {
                        continue;
                    }

                    try {
                        console.log(`⚡ [AUTO-REBLOCK] Target detected returning: ${currentDev.hostname || currentDev.ip} (MAC: ${currentDev.mac}, IP: ${currentDev.ip})`);
                        const sessionId = await this.python.startSpoof(
                            currentDev.ip,
                            currentDev.mac,
                            gateway.ip,
                            gateway.mac,
                            0
                        );

                        currentDev.is_blocked = true;
                        currentDev.speed_limit = 0;
                        currentDev.session_id = sessionId;
                        await this.db.setDeviceBlocked(currentDev.mac, true, sessionId);
                        await this.db.setDeviceSpeedLimit(currentDev.mac, 0);

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

                    if (currentDev.session_id) {
                        continue;
                    }

                    try {
                        const limit = currentDev.speed_limit ?? 50;
                        console.log(`⚡ [AUTO-THROTTLE] Reapplying speed limit ${limit}% for ${currentDev.hostname || currentDev.ip} (${currentDev.mac})`);
                        const sessionId = await this.python.startSpoof(
                            currentDev.ip,
                            currentDev.mac,
                            gateway.ip,
                            gateway.mac,
                            limit
                        );

                        currentDev.is_blocked = false;
                        currentDev.speed_limit = limit;
                        currentDev.session_id = sessionId;
                        await this.db.setDeviceBlocked(currentDev.mac, false, sessionId);
                        await this.db.setDeviceSpeedLimit(currentDev.mac, limit);

                        this.devices.set(currentDev.ip, currentDev);
                        this.emit('deviceUpdated', currentDev);
                    } catch (err) {
                        console.error(`❌ [AUTO-THROTTLE] Failed to auto-throttle ${target.ip}:`, err);
                    }
                }
            }

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
        const device = this.devices.get(ip);
        if (!device) {
            throw new Error(`Device ${ip} not found`);
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

        // Simpan status blokir secara persisten di SQLite
        await this.db.setDeviceBlocked(device.mac, true, sessionId);
        await this.db.setDeviceSpeedLimit(device.mac, 0);
        await this.db.setDeviceOnlineStatus(device.mac, true);

        this.emit('deviceUpdated', device);
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return device;
    }

    async unblockDevice(ip: string): Promise<Device> {
        return this.runExclusive(() => this._unblockDeviceImpl(ip));
    }

    private async _unblockDeviceImpl(ip: string): Promise<Device> {
        const device = this.devices.get(ip);
        if (!device) {
            throw new Error(`Device ${ip} not found`);
        }

        if (device.session_id) {
            try {
                await this.python.stopSpoof(device.session_id);
            } catch (e) {
                console.warn(`Warning stopping spoof on ${ip}:`, e);
            }
        }

        device.is_blocked = false;
        device.is_redirected = false;
        device.redirect_url = undefined;
        device.speed_limit = 100;
        device.session_id = undefined;
        device.is_online = true;
        this.devices.set(ip, device);

        // Hapus status blokir dan pulihkan speed limit ke 100% di SQLite
        await this.db.setDeviceBlocked(device.mac, false, undefined);
        await this.db.setDeviceSpeedLimit(device.mac, 100);
        await this.db.setDeviceOnlineStatus(device.mac, true);

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

        if (device.is_gateway || (gatewayIp && device.ip === gatewayIp)) {
            throw new Error(`Cannot redirect the gateway (${ip})`);
        }

        if (device.is_self) {
            throw new Error(`Cannot redirect operator host (${ip})`);
        }

        // If device is actively blocked or throttled, unblock first
        if (device.is_blocked || (device.session_id && !device.is_redirected)) {
            try {
                if (device.session_id) await this.python.stopSpoof(device.session_id);
            } catch (e) {
                console.warn('Notice stopping existing spoof before redirect:', e);
            }
            device.is_blocked = false;
            device.speed_limit = 100;
            device.session_id = undefined;
            await this.db.setDeviceBlocked(device.mac, false);
            await this.db.setDeviceSpeedLimit(device.mac, 100);
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
        await this.db.setDeviceOnlineStatus(device.mac, true);
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

        try {
            await this.python.stopRedirect(device.ip);
        } catch (e) {
            console.warn(`Notice stopping redirect on python:`, e);
        }

        device.is_redirected = false;
        device.redirect_url = undefined;
        device.session_id = undefined;
        device.is_online = true;

        this.devices.set(ip, device);
        await this.db.setDeviceOnlineStatus(device.mac, true);
        this.emit('deviceUpdated', device);
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return device;
    }

    async deleteDevice(mac: string): Promise<void> {
        return this.runExclusive(() => this._deleteDeviceImpl(mac));
    }

    private async _deleteDeviceImpl(mac: string): Promise<void> {
        const normMac = mac.toLowerCase();
        const existing = await this.db.getDeviceByMac(normMac);
        const profileId = existing?.profile_id;

        const ipsToDelete: string[] = [];
        for (const [ip, dev] of this.devices.entries()) {
            if (dev.mac.toLowerCase() === normMac || (profileId && dev.profile_id === profileId)) {
                ipsToDelete.push(ip);
                if (dev.session_id) {
                    try {
                        await this.python.stopSpoof(dev.session_id);
                    } catch (e) {
                        console.warn('Error stopping spoof before delete:', e);
                    }
                }
            }
        }

        await this.db.deleteDevice(mac);
        for (const ip of ipsToDelete) {
            this.devices.delete(ip);
        }

        this.emit('devicesUpdated', Array.from(this.devices.values()));
    }

    async clearAllDevices(): Promise<void> {
        await this.db.clearAllDevices();
        this.devices.clear();
        this.emit('devicesUpdated', []);
    }

    async setDeviceAlias(mac: string, alias: string): Promise<Device> {
        const updated = await this.db.setDeviceAlias(mac, alias);
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
        await this.db.setDeviceOnlineStatus(mac, true);
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return { ...updated, is_online: true };
    }

    async setSpeedLimit(ip: string, limit: number): Promise<Device> {
        return this.runExclusive(() => this._setSpeedLimitImpl(ip, limit));
    }

    private async _setSpeedLimitImpl(ip: string, limit: number): Promise<Device> {
        const device = this.devices.get(ip);
        if (!device) {
            throw new Error(`Device with IP ${ip} not found`);
        }

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

        const gateway = this.findGateway();
        if (!gateway) {
            throw new Error('Gateway not found');
        }

        if (cleanLimit < 100) {
            // Pre-Flight Validation: Verifikasi apakah target benar-benar aktif di jaringan L2
            await this._verifyPreFlightLiveness(device, gateway.ip);
        }

        device.is_online = true;

        if (cleanLimit === 100) {
            // Pulihkan kecepatan penuh (100%): stop spoof jika ada
            if (device.session_id) {
                try {
                    await this.python.stopSpoof(device.session_id);
                } catch (e) {
                    console.warn(`Error stopping spoof for full speed:`, e);
                }
            }
            device.is_blocked = false;
            device.session_id = undefined;
            device.speed_limit = 100;
            await this.db.setDeviceBlocked(device.mac, false, undefined);
            await this.db.setDeviceSpeedLimit(device.mac, 100);
            await this.db.setDeviceOnlineStatus(device.mac, true);
        } else if (cleanLimit === 0) {
            // Cut off total (0%): Blokir penuh
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
            await this.db.setDeviceBlocked(device.mac, true, device.session_id);
            await this.db.setDeviceSpeedLimit(device.mac, 0);
            await this.db.setDeviceOnlineStatus(device.mac, true);
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
            await this.db.setDeviceBlocked(device.mac, false, device.session_id);
            await this.db.setDeviceSpeedLimit(device.mac, cleanLimit);
            await this.db.setDeviceOnlineStatus(device.mac, true);
        }

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
        for (const dev of this.devices.values()) {
            const key = (dev.profile_id && dev.profile_id !== '') ? dev.profile_id : dev.mac.toLowerCase();
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

    async optimizeDhcpProfiling(): Promise<{ success: boolean; dhcpStats: any; devices: Device[] }> {
        console.log('⚡ [DeviceManager] Triggering DHCP Wakeup and Network Re-Scan for Teknik 3B...');
        const wakeupRes = await this.python.optimizeDhcpProfiling();
        const devices = await this.scanNetwork();
        return {
            success: true,
            dhcpStats: wakeupRes.data || {},
            devices
        };
    }

    async getDhcpStats(): Promise<any> {
        return this.python.getDhcpStats();
    }

    /**
     * Quick Re-Auth Profiling: micro-cut SERENTAK ke semua perangkat yang masih Unknown/unprofiled
     * (online, bukan gateway/self, tidak sedang diblokir/redirect) untuk memancing DHCP re-request,
     * lalu re-scan agar profil hasil sniffer DHCP tergabung. Tidak dibungkus runExclusive karena
     * memanggil scanNetwork() di akhir (mencegah re-entrant deadlock).
     */
    async quickReauthProfiling(): Promise<{ success: boolean; count: number; devices: Device[] }> {
        const gateway = this.findGateway();
        if (!gateway) {
            throw new Error('Gateway not found');
        }

        const isProfiled = (d: Device): boolean =>
            Boolean(d.dhcp_fingerprint || d.dhcp_vendor_class || (d.hostname && !d.hostname.startsWith('Unknown') && d.hostname !== d.ip));

        const targets = Array.from(this.devices.values())
            .filter(d => d.is_online && !d.is_gateway && !d.is_self && !d.is_blocked && !d.is_redirected && !d.session_id && !isProfiled(d))
            .map(d => ({
                victim_ip: d.ip,
                victim_mac: d.mac,
                gateway_ip: gateway.ip,
                gateway_mac: gateway.mac,
                victim_ipv6: d.ipv6_link_local || d.ipv6_global,
                gateway_ipv6: gateway.ipv6_link_local || gateway.ipv6_global
            }));

        if (targets.length === 0) {
            const devices = await this.scanNetwork();
            return { success: true, count: 0, devices };
        }

        console.log(`⚡ [DeviceManager] Quick Re-Auth micro-cut SERENTAK untuk ${targets.length} perangkat Unknown...`);
        this.emit('quickReauthStarted', { count: targets.length });
        try {
            await this.python.quickReauth(targets, 1500);
        } catch (err) {
            console.warn('Notice quick re-auth:', err);
        }
        const devices = await this.scanNetwork();
        this.emit('quickReauthDone', { count: targets.length });
        return { success: true, count: targets.length, devices };
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

    async getBettercapDnsRules(): Promise<any[]> {
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
            const result = await this.python.toggleGamingMode(enabled, mode, targetPingMs);

            const gateway = selectGateway(Array.from(this.devices.values()));
            if (!gateway) {
                this.emit('gamingStatusChanged', result);
                return result;
            }

            if (enabled) {
                // Auto-Isolate / Auto-Throttle seluruh perangkat LAN yang sedang online (kecuali Gateway & This PC)
                const targetLimit = mode === 'blackhole_priority' ? 0 : 20;
                const onlineTargets = Array.from(this.devices.values()).filter(d =>
                    !d.is_gateway && !d.is_self && d.is_online
                );

                console.log(`🎮 [GAMING MODE AKTIF] Mengisolasi otomatis ${onlineTargets.length} perangkat LAN (Mode: ${mode}, Limit: ${targetLimit}%)...`);

                for (const target of onlineTargets) {
                    try {
                        // Rekam kondisi SEBELUM diubah gaming, agar bisa dipulihkan tepat.
                        const priorLimit = target.speed_limit ?? 100;
                        const hadSession = Boolean(target.session_id);

                        // Gaming SELALU memakai sesi BLACKHOLE (racun ke MAC hantu, bukan MAC operator)
                        // agar trafik perangkat lain jatuh di AP & tidak membanjiri Wi-Fi operator (anti-lag).
                        // Hentikan sesi manual lama (self_mac) dulu bila ada.
                        if (hadSession && target.session_id) {
                            try { await this.python.stopSpoof(target.session_id); } catch {}
                        }
                        const sessionId = await this.python.startSpoof(
                            target.ip,
                            target.mac,
                            gateway.ip,
                            gateway.mac,
                            targetLimit,
                            target.ipv6_link_local,
                            gateway.ipv6_link_local,
                            true  // blackhole
                        );
                        target.session_id = sessionId;
                        target.speed_limit = targetLimit;
                        target.is_blocked = (targetLimit <= 0);
                        this.gamingManaged.set(target.ip, { priorLimit, hadSession });
                        this.devices.set(target.ip, target);
                        this.emit('deviceUpdated', target);
                    } catch (err: any) {
                        console.warn(`Notice mengisolasi perangkat ${target.ip} untuk Gaming Mode:`, err.message);
                    }
                }
            } else {
                // Pulihkan seluruh perangkat yang dikelola oleh Gaming Mode ke kondisi semula
                console.log(`🎮 [GAMING MODE NONAKTIF] Memulihkan ${this.gamingManaged.size} perangkat yang dikelola Gaming Mode...`);
                for (const [ip, meta] of Array.from(this.gamingManaged.entries())) {
                    const dev = this.devices.get(ip);
                    if (!dev || !dev.session_id) continue;
                    try {
                        // Hentikan sesi BLACKHOLE gaming (restore ARP korban ke MAC asli).
                        await this.python.stopSpoof(dev.session_id);
                        dev.session_id = undefined;

                        if (meta.hadSession) {
                            // Perangkat memang di-spoof manual sebelum gaming -> pulihkan sesi manual
                            // (self_mac) pada limit semula.
                            const sid = await this.python.startSpoof(
                                dev.ip,
                                dev.mac,
                                gateway.ip,
                                gateway.mac,
                                meta.priorLimit,
                                dev.ipv6_link_local,
                                gateway.ipv6_link_local
                                // blackhole default false -> sesi normal
                            );
                            dev.session_id = sid;
                            dev.speed_limit = meta.priorLimit;
                            dev.is_blocked = (meta.priorLimit <= 0);
                            await this.db.setDeviceBlocked(dev.mac, meta.priorLimit <= 0, sid).catch(() => {});
                            await this.db.setDeviceSpeedLimit(dev.mac, meta.priorLimit).catch(() => {});
                        } else {
                            // Gaming yang membuat sesi -> biarkan penuh 100%.
                            dev.speed_limit = 100;
                            dev.is_blocked = false;
                            await this.db.setDeviceBlocked(dev.mac, false, undefined).catch(() => {});
                            await this.db.setDeviceSpeedLimit(dev.mac, 100).catch(() => {});
                        }
                        this.devices.set(dev.ip, dev);
                        this.emit('deviceUpdated', dev);
                    } catch (err: any) {
                        console.warn(`Notice memulihkan perangkat ${ip}:`, err.message);
                    }
                }
                this.gamingManaged.clear();
            }

            this.emit('devicesUpdated', Array.from(this.devices.values()));
            this.emit('gamingStatusChanged', result);
            return result;
        });
    }

}
