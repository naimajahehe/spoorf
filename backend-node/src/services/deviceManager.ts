import os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { deriveNetworkId } from './database';
import { FeatureLockedError } from './licenseManager';
import { Device, ProfileRefreshResult } from '../types';
import { createChildLogger } from '../utils/logger';
import {
    IDeviceManager,
    IPythonBridge,
    IDatabaseService,
    ILicenseManager,
    DhcpOptimizationResult,
    DeviceScanOptions
} from '../interfaces';
import { TrafficService, IDeviceRegistry } from './trafficService';
import { GamingService, IGamingStateDelegate, PendingGamingDisable, GamingRestorePlan } from './gamingService';
import { DiscoveryService, IDiscoveryRegistryDelegate } from './discoveryService';
import { ReconciliationService, IReconciliationRegistryDelegate } from './reconciliationService';
export { PendingGamingDisable, GamingRestorePlan };

// Retensi: perangkat tamu yang offline lebih lama dari ini diarsipkan (bukan dihapus)
// agar daftar mencerminkan jaringan nyata, bukan riwayat semua tamu.
export const STALE_DEVICE_RETENTION_DAYS = 14;
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // sekali per hari

import {
    normalizeProfileMac,
    deviceMemKey,
    isPrivateIpv4,
    isGenericProfileLabel,
    isIpInSameSubnet,
    ipv4ToInt,
    netmaskToPrefix,
    isSameSubnetMasked,
    NetIfaceLike,
    resolveActivePrefix,
    scopeDevicesToActiveSubnet,
    selectGateway
} from '../utils/deviceUtils';
export {
    normalizeProfileMac,
    deviceMemKey,
    isPrivateIpv4,
    isGenericProfileLabel,
    isIpInSameSubnet,
    ipv4ToInt,
    netmaskToPrefix,
    isSameSubnetMasked,
    NetIfaceLike,
    resolveActivePrefix,
    scopeDevicesToActiveSubnet,
    selectGateway
};

export class DeviceManager extends EventEmitter implements IDeviceManager {
    private readonly log = createChildLogger('DeviceManager');
    private devices: Map<string, Device> = new Map();
    private currentNetworkId: string = 'net_default';

    public readonly trafficService: TrafficService;
    public readonly gamingService: GamingService;
    public readonly discoveryService: DiscoveryService;
    public readonly reconciliationService: ReconciliationService;

    // Mutex serialisasi: operasi tulis perangkat (block/unblock/throttle/redirect)
    // diserialisasi untuk mencegah race condition antar-aksi pengguna.
    private opChain: Promise<void> = Promise.resolve();

    private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.opChain.then(fn, fn);
        this.opChain = result.then(() => {}, () => {});
        return result;
    }

    // Gaming delegation getters & setters
    get gamingManaged(): Map<string, { priorLimit: number; hadSession: boolean; sessionId?: string }> {
        return this.gamingService.gamingManaged;
    }
    set gamingManaged(val: Map<string, { priorLimit: number; hadSession: boolean; sessionId?: string }>) {
        this.gamingService.gamingManaged = val;
    }

    get pendingGamingDisable(): PendingGamingDisable | null {
        return this.gamingService.pendingGamingDisable;
    }
    set pendingGamingDisable(val: PendingGamingDisable | null) {
        this.gamingService.pendingGamingDisable = val;
    }

    get gamingActive(): boolean {
        return this.gamingService.gamingActive;
    }
    set gamingActive(val: boolean) {
        this.gamingService.gamingActive = val;
    }

    get gamingMode(): string {
        return this.gamingService.gamingMode;
    }
    set gamingMode(val: string) {
        this.gamingService.gamingMode = val;
    }

    get gamingTargetLimit(): number {
        return this.gamingService.gamingTargetLimit;
    }
    set gamingTargetLimit(val: number) {
        this.gamingService.gamingTargetLimit = val;
    }

    // Discovery delegation getters & setters
    get autoScanEnabled(): boolean {
        return this.discoveryService.isAutoScanEnabled();
    }
    set autoScanEnabled(val: boolean) {
        this.discoveryService.setAutoScanEnabled(val);
    }

    get scanning(): boolean {
        return this.discoveryService.isScanning();
    }
    set scanning(val: boolean) {
        (this.discoveryService as any).scanning = val;
    }

    get inFlightScan() {
        return (this.discoveryService as any).inFlightScan;
    }
    set inFlightScan(val: any) {
        (this.discoveryService as any).inFlightScan = val;
    }

    // Reconciliation delegation getters & setters
    get inFlightDhcpOptimization() {
        return (this.reconciliationService as any).inFlightDhcpOptimization;
    }
    set inFlightDhcpOptimization(val: any) {
        (this.reconciliationService as any).inFlightDhcpOptimization = val;
    }

    get inFlightDhcpOptimizationGeneration() {
        return (this.reconciliationService as any).inFlightDhcpOptimizationGeneration;
    }
    set inFlightDhcpOptimizationGeneration(val: any) {
        (this.reconciliationService as any).inFlightDhcpOptimizationGeneration = val;
    }

    get dhcpOptimizationGeneration() {
        return (this.reconciliationService as any).dhcpOptimizationGeneration;
    }
    set dhcpOptimizationGeneration(val: any) {
        (this.reconciliationService as any).dhcpOptimizationGeneration = val;
    }

    get lastDhcpOptimization() {
        return (this.reconciliationService as any).lastDhcpOptimization;
    }
    set lastDhcpOptimization(val: any) {
        (this.reconciliationService as any).lastDhcpOptimization = val;
    }

    get inFlightProfileRefresh() {
        return (this.reconciliationService as any).inFlightProfileRefresh;
    }
    set inFlightProfileRefresh(val: any) {
        (this.reconciliationService as any).inFlightProfileRefresh = val;
    }

    get inFlightProfileRefreshScope() {
        return (this.reconciliationService as any).inFlightProfileRefreshScope;
    }
    set inFlightProfileRefreshScope(val: any) {
        (this.reconciliationService as any).inFlightProfileRefreshScope = val;
    }

    get profileRefreshGeneration() {
        return (this.reconciliationService as any).profileRefreshGeneration;
    }
    set profileRefreshGeneration(val: any) {
        (this.reconciliationService as any).profileRefreshGeneration = val;
    }

    get lastProfileRefresh() {
        return (this.reconciliationService as any).lastProfileRefresh;
    }
    set lastProfileRefresh(val: any) {
        (this.reconciliationService as any).lastProfileRefresh = val;
    }

    get pendingProfileMacs() {
        return (this.reconciliationService as any).pendingProfileMacs;
    }
    set pendingProfileMacs(val: any) {
        (this.reconciliationService as any).pendingProfileMacs = val;
    }

    get profileEnrichmentTimer() {
        return (this.reconciliationService as any).profileEnrichmentTimer;
    }
    set profileEnrichmentTimer(val: any) {
        (this.reconciliationService as any).profileEnrichmentTimer = val;
    }

    get profileEnrichmentCooldowns() {
        return (this.reconciliationService as any).profileEnrichmentCooldowns;
    }
    set profileEnrichmentCooldowns(val: any) {
        (this.reconciliationService as any).profileEnrichmentCooldowns = val;
    }

    get dhcpScanDebounceTimer() {
        return (this.discoveryService as any).debouncedScanTimer ?? null;
    }
    set dhcpScanDebounceTimer(val: any) {
        (this.discoveryService as any).debouncedScanTimer = val;
    }

    get offlineCooldownTimers() {
        return (this.reconciliationService as any).offlineCooldownTimers;
    }
    set offlineCooldownTimers(val: any) {
        (this.reconciliationService as any).offlineCooldownTimers = val;
    }

    get lastIdentityReblockAt() {
        return (this.reconciliationService as any).lastIdentityReblockAt;
    }
    set lastIdentityReblockAt(val: any) {
        (this.reconciliationService as any).lastIdentityReblockAt = val;
    }

    private retentionTimer: NodeJS.Timeout | null = null;

    constructor(
        public python: IPythonBridge,
        private db: IDatabaseService,
        private license?: ILicenseManager,
        trafficService?: TrafficService,
        gamingService?: GamingService,
        discoveryService?: DiscoveryService,
        reconciliationService?: ReconciliationService
    ) {
        super();
        const registry: IDeviceRegistry & IGamingStateDelegate & IDiscoveryRegistryDelegate & IReconciliationRegistryDelegate = {
            getDevice: (ip: string) => this.devices.get(ip),
            findDeviceByMac: (mac: string) => this._findDeviceByMac(mac),
            getAllDevices: () => Array.from(this.devices.values()),
            findGateway: (gwIp?: string) => (gwIp ? this.devices.get(gwIp) : undefined) || this.findGateway(),
            setDevice: (key: string, dev: Device) => { this.devices.set(key, dev); },
            deleteDevice: (key: string) => this.devices.delete(key),
            clearDevices: () => { this.devices.clear(); },
            getCurrentNetworkId: () => this.currentNetworkId,
            setCurrentNetworkId: (netId: string) => { this.currentNetworkId = netId; },
            emit: (event: string, ...args: any[]) => this.emit(event, ...args),
            runExclusive: <T>(fn: () => Promise<T>) => this.runExclusive(fn),
            assertNoPendingGamingConflict: (devs: Iterable<Device>) => {
                this._assertNoPendingGamingRecoveryConflict(devs);
            },
            getLicense: () => this.license,
            scheduleProfileEnrichment: (mac: string, delayMs?: number) => {
                this.scheduleProfileEnrichment(mac, delayMs);
            },
            armOfflineCooldown: (mac: string, hostnameOrIp?: string) => {
                this.reconciliationService.armOfflineCooldown(mac, hostnameOrIp);
            },
            isAutoScanEnabled: () => this.discoveryService.isAutoScanEnabled(),
            debouncedScan: (delayMs?: number) => this.debouncedScan(delayMs),
            scanNetwork: (options?: any) => this.scanNetwork(options)
        };

        this.trafficService = trafficService || new TrafficService(this.python, this.db, this.license, registry);
        this.gamingService = gamingService || new GamingService(this.python, this.db, registry);
        this.discoveryService = discoveryService || new DiscoveryService(this.python, this.db, registry, this.trafficService, this.gamingService);
        this.reconciliationService = reconciliationService || new ReconciliationService(this.python, this.db, registry, this.trafficService, this.gamingService, this.discoveryService);

        // Rekonsiliasi otomatis jika lisensi di-downgrade (misal remote kick)
        if (this.license && typeof (this.license as any).on === 'function') {
            (this.license as any).on('downgraded', async (payload: any) => {
                this.log.info({ payload }, '[DeviceManager] License downgraded. Executing active enforcement reconciliation.');
                try {
                    await this.reconcileActiveEnforcementsToFree();
                } catch (err: any) {
                    this.log.error({ err: err?.message || err }, '[DeviceManager] Failed to reconcile active enforcements after license downgrade');
                }
            });
        }

        // Listen for network changes from Python
        this.python.on('telemetry', (data) => {
            this.emit('telemetry', data);
        });

        // SP-2: Python (re)connect = engine fresh tanpa sesi spoof.
        this.python.on('pythonReachable', () => {
            this.emit('pythonReachable');
            this.reconcileBlocksWithPython().catch(err => this.log.warn({ err }, `Notice reconcile on reconnect: ${err?.message || err}`));
        });

        this.python.on('networkChanged', async (data) => {
            this.reconciliationService.onNetworkChanged();

            const newGwMac = data?.gateway_mac || data?.new_gateway_mac;
            if (newGwMac) {
                this.currentNetworkId = deriveNetworkId(newGwMac);
                this.log.info({ networkId: this.currentNetworkId }, `networkChanged: scoped to ${this.currentNetworkId}`);
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
                    this.log.warn({ err }, `Notice reloading devices on networkChanged: ${err?.message || err}`);
                }
            }

            this.emit('networkChanged', data);
            this.scanNetwork().catch(err => this.log.error({ err }, 'Scan network on networkChanged failed'));
        });

        this.python.on('dhcpDevice', (data) => {
            // Serialisasi mutasi this.devices dari event DHCP agar tidak interleave dengan scan.
            this.runExclusive(() => this._handleDhcpEvent(data)).catch(err => this.log.error({ err }, 'Handle DHCP event failed'));
        });

        this.python.on('rogueDhcp', (data) => {
            this.log.warn({ alert: data }, '[DeviceManager] Rogue DHCP Alert');
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
            this.runExclusive(() => this._handleLivenessEvent(data)).catch(err => this.log.warn({ err }, 'Handle liveness event warning'));
        });

        this.python.on('shieldStatusChanged', (data) => {
            this.emit('shieldStatusChanged', data);
        });

        this.python.on('arpThreatDetected', (data) => {
            this.log.warn({ alert: data }, '[DeviceManager] ARP Threat Alert');
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
     */
    public async reconcileBlocksWithPython(): Promise<void> {
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
        this.log.info({ blockedCount: blocked.length, clearedSessions: cleared }, `[Reconcile] ${blocked.length} perangkat terblokir, sebagian tak ter-enforce di Python (session basi: ${cleared}) -> memicu scan re-block.`);
        this.scanNetwork().catch(err => this.log.warn({ err }, `Notice reconcile re-block scan: ${err?.message || err}`));
    }

    private async _handleDhcpEvent(data: any): Promise<void> {
        return this.reconciliationService.handleDhcpEvent(data);
    }

    private async _handleLivenessEvent(data: any): Promise<void> {
        return this.discoveryService.handleLivenessEvent(data);
    }

    /** @deprecated Legacy test compatibility */
    async _verifyPreFlightLiveness(device: Device, gatewayIp: string): Promise<Device> {
        if (this.trafficService && 'verifyPreFlightLiveness' in this.trafficService) {
            return await (this.trafficService as any).verifyPreFlightLiveness(device, gatewayIp);
        }
        return device;
    }

    /** @deprecated Legacy test compatibility */
    async _attachSpoofCutStatus(): Promise<void> {
        return (this.discoveryService as any).attachSpoofCutStatus();
    }

    /** @deprecated Legacy test compatibility */
    async _getLiveEngineSessionIds(): Promise<Set<string> | undefined> {
        return (this.discoveryService as any).getLiveEngineSessionIds();
    }

    armOfflineCooldown(mac: string, hostnameOrIp?: string): void {
        this.reconciliationService.armOfflineCooldown(mac, hostnameOrIp);
    }

    async init(): Promise<void> {
        await this.db.init();
        // Sembuhkan profil yang namanya generik/'Unknown' dari hostname personal perangkatnya
        try { if (typeof this.db.backfillProfileNames === "function") await this.db.backfillProfileNames(); } catch (e: any) { this.log.warn({ err: e }, `Notice profile name backfill: ${e?.message}`); }

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
                                    this.log.info({ networkId: this.currentNetworkId, gatewayIp: net.gateway_ip }, `Initialized network scope from local adapter: ${this.currentNetworkId} (${net.gateway_ip})`);
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
            if (device.session_id) device.session_id = undefined;
            // INTEGRITAS CONTROLLER: Abaikan riwayat controller offline dari DB agar tidak menjadi entri hantu saat startup
            const selfHostname = os.hostname().toLowerCase();
            const devHost = (device.hostname || '').trim().toLowerCase();
            if (!device.is_online && (device.is_self || (devHost && devHost === selfHostname))) continue;
            this.devices.set(deviceMemKey(device), device);
        }
        this.log.info({ count: storedDevices.length, networkId: this.currentNetworkId }, `Loaded ${storedDevices.length} persistent devices from SQLite`);
        this.emit('devicesUpdated', storedDevices);

        // Retention Sweep: arsipkan perangkat tamu yang lama hilang saat startup, lalu harian.
        await this._runRetentionSweep();
        this.retentionTimer = setInterval(() => {
            this._runRetentionSweep().catch(err => this.log.warn({ err }, `Notice retention sweep: ${err.message}`));
        }, RETENTION_SWEEP_INTERVAL_MS);
        this.retentionTimer.unref();

        // Background Liveness Watchdog via DiscoveryService
        this.discoveryService.startWatchdog();
    }

    shutdown(): void {
        if (this.retentionTimer) {
            clearInterval(this.retentionTimer);
            this.retentionTimer = null;
        }
        this.discoveryService.stopWatchdog();
        if (this.reconciliationService && typeof this.reconciliationService.shutdown === 'function') {
            this.reconciliationService.shutdown();
        }
    }

    /**
     * Arsipkan perangkat basi via DB (berpagar: hanya tamu anonim yang lama offline),
     * bersihkan MAC acak usang & profil duplikat secara berkala, checkpoint WAL SQLite.
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

    debouncedScan(delayMs: number = 8000): void {
        this.discoveryService.debouncedScan(delayMs);
    }

    setAutoScan(enabled: boolean): boolean {
        const next = Boolean(enabled);
        if (next && this.license && this.license.getLicense().tier === 'free') {
            this.log.warn({ tier: this.license?.getLicense().tier }, 'Auto Scan rejected: tier free is limited to manual scan. Upgrade to enable Auto Scan.');
            if (this.discoveryService.isAutoScanEnabled()) {
                this.discoveryService.setAutoScanEnabled(false);
            }
            return false;
        }

        const changed = next !== this.discoveryService.isAutoScanEnabled();
        this.discoveryService.setAutoScanEnabled(next);

        // Mengaktifkan Auto Scan langsung memicu satu scan seketika.
        if (next && changed && !this.discoveryService.isScanning()) {
            this.scanNetwork().catch(err => this.log.warn({ err }, `Notice immediate auto-scan: ${err?.message}`));
        }
        return this.discoveryService.isAutoScanEnabled();
    }

    isAutoScanEnabled(): boolean {
        return this.discoveryService.isAutoScanEnabled();
    }

    /** @deprecated Legacy test compatibility */
    _shouldRunWatchdogScan(): boolean {
        return this.discoveryService.isAutoScanEnabled() && !this.discoveryService.isScanning() && this.devices.size > 0;
    }

    isScanning(): boolean {
        return this.discoveryService.isScanning();
    }

    getCurrentNetworkId(): string {
        return this.currentNetworkId;
    }

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
        return this.discoveryService.scanNetwork(options);
    }

    async blockDevice(ip: string, gatewayIp?: string): Promise<Device> {
        return this.trafficService.blockDevice(ip, gatewayIp);
    }

    async unblockDevice(identifier: string): Promise<Device> {
        return this.trafficService.unblockDevice(identifier);
    }

    async redirectDevice(ip: string, redirectUrl: string, instagramUsername: string = '', gatewayIp?: string): Promise<Device> {
        return this.trafficService.redirectDevice(ip, redirectUrl, instagramUsername, gatewayIp);
    }

    async stopRedirectDevice(ip: string): Promise<Device> {
        return this.trafficService.stopRedirectDevice(ip);
    }

    async reconcileActiveEnforcementsToFree(): Promise<any> {
        if (typeof this.trafficService.reconcileActiveEnforcementsToFree === 'function') {
            return this.trafficService.reconcileActiveEnforcementsToFree();
        }
        return { unblocked: [], throttlesReset: [], redirectsReset: [] };
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
        if (requestedDevice?.is_gateway || existing?.is_gateway) {
            throw new Error('Cannot delete gateway router (Invariant 1: Gateway Immunity)');
        }
        if (requestedDevice?.is_self || existing?.is_self) {
            throw new Error('Cannot delete controller host (Invariant 2: Controller Self-Protection)');
        }
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
            if (this.gamingService && 'stopGamingSession' in this.gamingService) {
                await (this.gamingService as any).stopGamingSession(dev.mac.toLowerCase());
            }
        }
        if (this.gamingService && 'stopGamingSession' in this.gamingService) {
            await (this.gamingService as any).stopGamingSession(normMac);
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
        const preserved: Device[] = [];
        for (const dev of this.devices.values()) {
            if (dev.is_gateway || dev.is_self) {
                preserved.push(dev);
            }
        }
        this.devices.clear();
        for (const dev of preserved) {
            this.devices.set(deviceMemKey(dev), dev);
            await this.db.saveDevice(dev, this.currentNetworkId);
        }
        this.emit('devicesUpdated', Array.from(this.devices.values()));
    }

    async setDeviceAlias(mac: string, alias: string): Promise<Device> {
        const updated = await this.db.setDeviceAlias(mac, alias, this.currentNetworkId);
        const normMac = mac.toLowerCase();
        let found = false;
        for (const [ip, dev] of this.devices.entries()) {
            if (dev.mac.toLowerCase() === normMac || (dev.profile_id && dev.profile_id === updated.profile_id)) {
                dev.alias = alias;
                dev.profile_id = updated.profile_id;
                this.devices.set(ip, dev);
                this.emit('deviceUpdated', dev);
                found = true;
            }
        }
        if (!found && updated && updated.ip) {
            this.devices.set(updated.ip, updated);
        }
        this.emit('devicesUpdated', Array.from(this.devices.values()));
        return updated;
    }

    async setSpeedLimit(ip: string, limit: number, gatewayIp?: string): Promise<Device> {
        return this.trafficService.setSpeedLimit(ip, limit, gatewayIp);
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
            // INTEGRITAS CONTROLLER: Komputer operator yang offline adalah entri MAC usang.
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

    getDeviceByMac(mac: string): Device | undefined {
        return this._findDeviceByMac(mac);
    }

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
        return this.reconciliationService.optimizeDhcpProfiling();
    }

    async getDhcpStats(): Promise<any> {
        return this.reconciliationService.getDhcpStats();
    }

    async profileRefresh(): Promise<ProfileRefreshResult> {
        return this.reconciliationService.profileRefresh();
    }

    async runProfileRefresh(
        targetMacs: Set<string> | null,
        scope: 'all' | 'subset'
    ): Promise<ProfileRefreshResult> {
        return this.reconciliationService.runProfileRefresh(targetMacs, scope);
    }

    /** @deprecated Legacy test compatibility */
    async executeProfileRefresh(
        targetMacs: Set<string> | null,
        scope: 'all' | 'subset',
        generation: number
    ): Promise<ProfileRefreshResult> {
        return (this.reconciliationService as any).executeProfileRefresh(targetMacs, scope, generation);
    }

    scheduleProfileEnrichment(
        mac: string,
        delayMs: number = 1500
    ): void {
        this.reconciliationService.scheduleProfileEnrichment(mac, delayMs);
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
        if (!isPrivateIpv4(targetIp)) {
            throw new Error(`Target IP '${targetIp}' is not a valid RFC 1918 private address`);
        }
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
        return this.gamingService.getGamingStatus();
    }

    async toggleGamingMode(enabled: boolean, mode: string = 'auto_airtime', targetPingMs: number = 25.0): Promise<any> {
        return this.gamingService.toggleGamingMode(enabled, mode, targetPingMs);
    }

    private _findDeviceByMac(macKey: string): Device | undefined {
        const norm = (macKey || '').toLowerCase();
        for (const device of this.devices.values()) {
            if (device.mac.toLowerCase() === norm) return device;
        }
        return undefined;
    }

    private _pendingGamingRecoveryError(): Error {
        return new Error(
            'Gaming disable recovery is pending for a managed device. Retry disabling Gaming Mode before changing its network state.'
        );
    }

    private _assertNoPendingGamingRecoveryConflict(devices: Iterable<Device>): void {
        this.gamingService.assertNoPendingGamingRecoveryConflict(devices);
    }

    private _assertNoPendingGamingRecoveryConflictByIdentity(
        identity: { mac?: string; ip?: string; profileId?: string }
    ): void {
        this.gamingService.assertNoPendingGamingRecoveryConflictByIdentity(identity);
    }

    /** @deprecated Legacy test compatibility */
    async _applyGamingToDevice(target: Device, gateway: Device): Promise<void> {
        return this.gamingService.applyGamingToDevice(target, gateway);
    }

    /** @deprecated Legacy test compatibility */
    async _maybeApplyGamingToNewDevice(dev: Device): Promise<void> {
        return this.gamingService.maybeApplyGamingToNewDevice(dev);
    }

    /** @deprecated Legacy test compatibility */
    async _stopGamingSession(macKey: string): Promise<void> {
        return this.gamingService.stopGamingSession(macKey);
    }

    /** @deprecated Legacy test compatibility */
    async _reapplyGamingSweep(gateway: Device): Promise<void> {
        return this.gamingService.reapplyGamingSweep(gateway);
    }
}
