import os from 'os';
import { EventEmitter } from 'events';
import { Device, CutStatus } from '../types';
import { IPythonBridge, IDatabaseService, IDiscoveryService, DeviceScanOptions, ITrafficService, IGamingService } from '../interfaces';
import { createChildLogger } from '../utils/logger';
import {
    deviceMemKey,
    isIpInSameSubnet,
    normalizeProfileMac,
    isPrivateIpv4
} from '../utils/deviceUtils';
import { deriveNetworkId } from './database';

export interface IDiscoveryRegistryDelegate {
    getDevice(ip: string): Device | undefined;
    findDeviceByMac(mac: string): Device | undefined;
    getAllDevices(): Device[];
    findGateway(gatewayIp?: string): Device | undefined;
    setDevice(key: string, device: Device): void;
    deleteDevice(key: string): boolean;
    clearDevices(): void;
    getCurrentNetworkId(): string;
    setCurrentNetworkId?(netId: string): void;
    emit(event: string, ...args: any[]): boolean;
    runExclusive<T>(fn: () => Promise<T>): Promise<T>;
    scheduleProfileEnrichment?(mac: string, delayMs?: number): void;
    armOfflineCooldown?(mac: string, hostnameOrIp?: string): void;
}

export class DiscoveryService extends EventEmitter implements IDiscoveryService {
    private readonly log = createChildLogger('DiscoveryService');
    private scanning: boolean = false;
    private autoScanEnabled: boolean = false;
    private inFlightScan: Promise<Device[]> | null = null;
    private debouncedScanTimer: NodeJS.Timeout | null = null;
    private watchdogTimer: NodeJS.Timeout | null = null;

    constructor(
        private python: IPythonBridge,
        private db: IDatabaseService,
        private registry: IDiscoveryRegistryDelegate,
        private trafficService?: ITrafficService,
        private gamingService?: IGamingService
    ) {
        super();
    }

    isScanning(): boolean {
        return this.scanning;
    }

    isAutoScanEnabled(): boolean {
        return this.autoScanEnabled;
    }

    setAutoScanEnabled(enabled: boolean): void {
        const changed = this.autoScanEnabled !== enabled;
        this.autoScanEnabled = enabled;
        if (changed) {
            this.log.info({ autoScan: enabled }, `Auto Scan mode changed: ${enabled ? 'ON (Background Watchdog & DHCP Auto-Scan active)' : 'OFF (Manual / Scan-only)'}`);
            this.emit('autoScanChanged', { enabled });
            if (this.registry) {
                this.registry.emit('autoScanChanged', { enabled });
            }
        }
    }

    startWatchdog(): void {
        if (this.watchdogTimer) return;
        this.watchdogTimer = setInterval(() => {
            if (this.shouldRunWatchdogScan()) {
                this.scanNetwork().catch(err => this.log.warn({ err }, `Notice background watchdog scan: ${err.message}`));
            }
        }, 25000);
        this.watchdogTimer.unref();
    }

    stopWatchdog(): void {
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
        if (this.debouncedScanTimer) {
            clearTimeout(this.debouncedScanTimer);
            this.debouncedScanTimer = null;
        }
    }

    private shouldRunWatchdogScan(): boolean {
        return this.autoScanEnabled && !this.scanning && !this.inFlightScan;
    }

    debouncedScan(delayMs: number = 300): void {
        if (this.debouncedScanTimer) clearTimeout(this.debouncedScanTimer);
        this.debouncedScanTimer = setTimeout(() => {
            this.debouncedScanTimer = null;
            this.scanNetwork().catch(err => this.log.warn({ err }, 'Notice debounced scan'));
        }, delayMs);
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
            this.log.info('Scan is already in progress, returning shared in-flight scan promise.');
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
        if (this.registry) {
            this.registry.emit('scanStarted');
        }

        try {
            const rawScanResult: any = await this.python.scan(
                options.skipMulticastWakeup
                    ? { skipMulticastWakeup: true }
                    : {}
            );
            let rawScanned: Device[] = Array.isArray(rawScanResult)
                ? rawScanResult
                : (rawScanResult && Array.isArray(rawScanResult.devices) ? rawScanResult.devices : []);

            // Pastikan Komputer Operator (Perangkat Ini / Controller) selalu ada & Online!
            const activeGwForFilter = rawScanned.find(d => d.is_gateway) || this.registry.findGateway();
            try {
                const ifaces = os.networkInterfaces();
                for (const addrs of Object.values(ifaces)) {
                    if (!addrs) continue;
                    for (const a of addrs) {
                        if (a.family === 'IPv4' && !a.internal && (a.address.startsWith('192.168.') || a.address.startsWith('10.') || a.address.startsWith('172.'))) {
                            if (activeGwForFilter && !isIpInSameSubnet(a.address, activeGwForFilter.ip)) {
                                continue;
                            }
                            const v6Addrs: string[] = [];
                            let v6LinkLocal = '';
                            let v6Global = '';
                            for (const x of addrs) {
                                if (x.family === 'IPv6' && x.address) {
                                    const cleanV6 = x.address.split('%')[0].trim();
                                    if (cleanV6 && cleanV6 !== '::1') {
                                        if (!v6Addrs.includes(cleanV6)) v6Addrs.push(cleanV6);
                                        if (cleanV6.startsWith('fe80:') && !v6LinkLocal) {
                                            v6LinkLocal = cleanV6;
                                        } else if (!cleanV6.startsWith('fe80:') && !v6Global) {
                                            v6Global = cleanV6;
                                        }
                                    }
                                }
                            }

                            const selfIdx = rawScanned.findIndex(d => d.ip === a.address || d.mac.toLowerCase() === a.mac.toLowerCase());
                            if (selfIdx >= 0) {
                                rawScanned[selfIdx].is_self = true;
                                rawScanned[selfIdx].is_online = true;
                                rawScanned[selfIdx].hostname = os.hostname();
                                if (v6Addrs.length > 0) {
                                    rawScanned[selfIdx].ipv6_addresses = v6Addrs;
                                    rawScanned[selfIdx].ipv6_link_local = v6LinkLocal || rawScanned[selfIdx].ipv6_link_local;
                                    rawScanned[selfIdx].ipv6_global = v6Global || rawScanned[selfIdx].ipv6_global;
                                    rawScanned[selfIdx].is_dual_stack = true;
                                }
                            } else {
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
                                    services: [],
                                    ipv6_link_local: v6LinkLocal || undefined,
                                    ipv6_global: v6Global || undefined,
                                    ipv6_addresses: v6Addrs,
                                    is_dual_stack: v6Addrs.length > 0
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                this.log.warn({ err }, 'Notice ensuring self device');
            }

            // INTEGRITAS CONTROLLER: Pastikan hanya ada 1 perangkat controller (is_self) aktif di jaringan ini
            const activeSelf = rawScanned.find(d => d.is_self);
            if (activeSelf) {
                for (const d of rawScanned) {
                    if (d !== activeSelf && d.is_self) {
                        d.is_self = false;
                    }
                }
                for (const d of this.registry.getAllDevices()) {
                    if (d.is_self && d.mac.toLowerCase() !== activeSelf.mac.toLowerCase()) {
                        d.is_self = false;
                        if (!d.is_online) {
                            this.registry.deleteDevice(deviceMemKey(d));
                        }
                    }
                }
            }

            // Saring rawScanned: Hanya proses perangkat yang berada dalam satu subnet dengan gateway aktif
            if (activeGwForFilter) {
                rawScanned = rawScanned.filter(d => isIpInSameSubnet(d.ip, activeGwForFilter.ip));
                if (activeGwForFilter.mac) {
                    const detectedNetId = deriveNetworkId(activeGwForFilter.mac);
                    const currentNetId = this.registry.getCurrentNetworkId();
                    if (detectedNetId !== currentNetId) {
                        this.log.info({ previousNetworkId: currentNetId, detectedNetworkId: detectedNetId }, `Network shift detected during scan: ${currentNetId} -> ${detectedNetId}`);
                        if (this.registry.setCurrentNetworkId) {
                            this.registry.setCurrentNetworkId(detectedNetId);
                        }
                        this.registry.clearDevices();
                        if (typeof this.db?.getAllDevices === 'function') {
                            try {
                                const stored = await this.db.getAllDevices(detectedNetId);
                                for (const d of stored) {
                                    this.registry.setDevice(deviceMemKey(d), d);
                                }
                            } catch (e: any) {
                                this.log.warn({ err: e, networkId: detectedNetId }, `Notice loading devices on network shift: ${e?.message}`);
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

            const currentNetId = this.registry.getCurrentNetworkId();
            for (const dev of rawScanned) {
                dev.network_id = currentNetId;
            }

            const liveSessionIds = await this.getLiveEngineSessionIds();
            const syncRes = (await this.db.syncScanResults(rawScanned, liveSessionIds)) || {};
            const allDevices: Device[] = syncRes.allDevices || [];
            const autoReblockTargets: Device[] = syncRes.autoReblockTargets || [];
            const autoThrottleTargets: Device[] = syncRes.autoThrottleTargets || [];
            const zombieSessionsToStop: string[] = syncRes.zombieSessionsToStop || [];

            try { if (typeof this.db.backfillProfileNames === 'function') await this.db.backfillProfileNames(); } catch (e: any) { this.log.warn({ err: e }, `Notice profile name backfill (scan): ${e?.message}`); }

            if (zombieSessionsToStop && zombieSessionsToStop.length > 0) {
                for (const sid of zombieSessionsToStop) {
                    try {
                        this.log.info({ sessionId: sid }, `Stopping zombie spoof session ${sid} from archived MAC`);
                        await this.python.stopSpoof(sid);
                    } catch (e) {
                        this.log.warn({ err: e, sessionId: sid }, `Notice stopping archived session ${sid}`);
                    }
                }
            }

            const prevByMac = new Map<string, Device>();
            for (const d of this.registry.getAllDevices()) prevByMac.set(d.mac.toLowerCase(), d);
            for (const dev of allDevices) {
                if (!dev.is_self && !dev.is_gateway && !dev.is_online) {
                    const prev = prevByMac.get(dev.mac.toLowerCase());
                    if (prev && prev.is_online) {
                        this.log.info({ ip: dev.ip || dev.last_ip || '-', mac: dev.mac }, `Device disconnected: ${dev.ip || dev.last_ip || '-'} (${dev.mac})`);
                        if (this.gamingService && 'stopGamingSession' in this.gamingService) {
                            await (this.gamingService as any).stopGamingSession(dev.mac.toLowerCase());
                        }
                        if (prev.ip) {
                            this.registry.deleteDevice(prev.ip);
                        }
                        this.registry.setDevice(deviceMemKey(dev), dev);
                        this.registry.armOfflineCooldown?.(dev.mac, dev.hostname || dev.ip || dev.last_ip);
                        this.emit('deviceDisconnected', dev);
                        if (this.registry) {
                            this.registry.emit('deviceDisconnected', dev);
                        }
                    }
                }
            }

            const activeGw = allDevices.find(d => d.is_gateway) || rawScanned.find(d => d.is_gateway);
            const rawScannedIps = new Set(rawScanned.map(d => d.ip));

            const activeProfileIds = new Set<string>();
            for (const dev of allDevices) {
                if (dev.is_online && dev.profile_id) {
                    activeProfileIds.add(dev.profile_id);
                }
            }

            const currentMemByMac = new Map<string, Device>();
            for (const d of this.registry.getAllDevices()) {
                currentMemByMac.set(d.mac.toLowerCase(), d);
            }
            const newlyAddedProfileMacs = new Set<string>();

            for (const dev of allDevices) {
                if (!dev.ip || dev.ip.trim() === '') {
                    continue;
                }

                if (dev.is_self && !dev.is_online) {
                    continue;
                }

                if (!dev.is_online && dev.profile_id && activeProfileIds.has(dev.profile_id)) {
                    continue;
                }

                if (rawScannedIps.has(dev.ip) || !activeGw || isIpInSameSubnet(dev.ip, activeGw.ip)) {
                    const devMacNorm = dev.mac.toLowerCase();
                    const existing = currentMemByMac.get(devMacNorm);
                    const conflictDev = this.registry.getDevice(dev.ip);

                    if (!dev.is_online && conflictDev && conflictDev.is_online && conflictDev.mac.toLowerCase() !== devMacNorm) {
                        continue;
                    }

                    if (existing) {
                        const staleKey = deviceMemKey(existing);
                        if (staleKey !== dev.ip) {
                            this.registry.deleteDevice(staleKey);
                        }

                        if (conflictDev && conflictDev.mac.toLowerCase() !== devMacNorm) {
                            this.registry.deleteDevice(dev.ip);
                            conflictDev.is_online = false;
                            conflictDev.ip = '';
                            this.registry.setDevice(deviceMemKey(conflictDev), conflictDev);
                        }

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

                        if (existing.is_blocked === undefined && dev.is_blocked !== undefined) {
                            existing.is_blocked = dev.is_blocked;
                            existing.speed_limit = dev.speed_limit;
                        } else if (!existing.session_id && existing.is_blocked && dev.is_blocked === false) {
                            existing.is_blocked = false;
                            existing.speed_limit = dev.speed_limit ?? 100;
                        }

                        this.registry.setDevice(dev.ip, existing);
                    } else {
                        if (conflictDev && conflictDev.mac.toLowerCase() !== devMacNorm) {
                            this.registry.deleteDevice(dev.ip);
                            conflictDev.is_online = false;
                            conflictDev.ip = '';
                            this.registry.setDevice(deviceMemKey(conflictDev), conflictDev);
                        }
                        this.registry.setDevice(dev.ip, { ...dev });
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

            const gateway = this.registry.findGateway();

            // 1. Eksekusi AUTO-REBLOCK dengan LATE-CHECK otoritatif (Concurrent via Promise.allSettled)
            if (gateway && autoReblockTargets.length > 0) {
                await Promise.allSettled(autoReblockTargets.map(async (target) => {
                    if (target.is_gateway || target.is_self || target.ip === gateway.ip) return;

                    const currentDev = this.registry.getDevice(target.ip);
                    if (!currentDev || currentDev.is_self || currentDev.is_gateway) return;

                    if (!currentDev.is_blocked) {
                        this.log.info({ ip: target.ip, mac: target.mac }, `[AUTO-REBLOCK] Skipping ${target.ip} because it was unblocked during scan`);
                        return;
                    }

                    if (typeof this.db?.getDeviceByMac === 'function') {
                        const dbDev = await this.db.getDeviceByMac(currentDev.mac, currentNetId);
                        if (dbDev && !dbDev.is_blocked) {
                            this.log.info({ ip: target.ip, mac: target.mac }, `[AUTO-REBLOCK] Skipping ${target.ip} because it is marked unblocked in database`);
                            currentDev.is_blocked = false;
                            currentDev.speed_limit = dbDev.speed_limit ?? 100;
                            return;
                        }
                    }

                    if (this.trafficService && 'clearStaleSpoofSession' in this.trafficService) {
                        await (this.trafficService as any).clearStaleSpoofSession(currentDev);
                    } else if (currentDev.session_id) {
                        try { await this.python.stopSpoof(currentDev.session_id); } catch {}
                        currentDev.session_id = undefined;
                    }

                    try {
                        this.log.info({ hostname: currentDev.hostname, ip: currentDev.ip, mac: currentDev.mac }, `[AUTO-REBLOCK] Target detected returning: ${currentDev.hostname || currentDev.ip} (MAC: ${currentDev.mac}, IP: ${currentDev.ip})`);
                        
                        if (this.trafficService && 'blockDeviceDirect' in this.trafficService) {
                            await (this.trafficService as any).blockDeviceDirect(currentDev.ip, gateway.ip);
                        } else {
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
                            await this.db.setDeviceBlocked(currentDev.mac, true, sessionId, currentNetId);
                            await this.db.setDeviceSpeedLimit(currentDev.mac, 0, currentNetId);
                            this.registry.setDevice(currentDev.ip, currentDev);
                        }

                        this.emit('deviceUpdated', currentDev);
                        this.emit('autoReblocked', currentDev);
                        if (this.registry) {
                            this.registry.emit('deviceUpdated', currentDev);
                            this.registry.emit('autoReblocked', currentDev);
                        }
                    } catch (err) {
                        this.log.error({ err, ip: target.ip, mac: target.mac }, `[AUTO-REBLOCK] Failed to auto-block ${target.ip}`);
                    }
                }));
            }

            // 2. Eksekusi AUTO-THROTTLE dengan LATE-CHECK otoritatif (Concurrent via Promise.allSettled)
            if (gateway && autoThrottleTargets.length > 0) {
                await Promise.allSettled(autoThrottleTargets.map(async (target) => {
                    if (target.is_gateway || target.is_self || target.ip === gateway.ip) return;

                    const currentDev = this.registry.getDevice(target.ip);
                    if (!currentDev || currentDev.is_self || currentDev.is_gateway) return;

                    if (currentDev.speed_limit === undefined || currentDev.speed_limit >= 100 || currentDev.is_blocked) {
                        return;
                    }

                    if (typeof this.db?.getDeviceByMac === 'function') {
                        const dbDev = await this.db.getDeviceByMac(currentDev.mac, currentNetId);
                        if (dbDev && (dbDev.is_blocked || dbDev.speed_limit === undefined || dbDev.speed_limit >= 100)) {
                            this.log.info({ ip: target.ip, mac: target.mac }, `[AUTO-THROTTLE] Skipping ${target.ip} because throttle was cleared in database`);
                            currentDev.is_blocked = Boolean(dbDev.is_blocked);
                            currentDev.speed_limit = dbDev.speed_limit ?? 100;
                            return;
                        }
                    }

                    if (this.trafficService && 'clearStaleSpoofSession' in this.trafficService) {
                        await (this.trafficService as any).clearStaleSpoofSession(currentDev);
                    } else if (currentDev.session_id) {
                        try { await this.python.stopSpoof(currentDev.session_id); } catch {}
                        currentDev.session_id = undefined;
                    }

                    try {
                        const limit = currentDev.speed_limit ?? 50;
                        this.log.info({ limit, hostname: currentDev.hostname, ip: currentDev.ip, mac: currentDev.mac }, `[AUTO-THROTTLE] Reapplying speed limit ${limit}% for ${currentDev.hostname || currentDev.ip} (${currentDev.mac})`);
                        
                        if (this.trafficService && 'setSpeedLimitDirect' in this.trafficService) {
                            await (this.trafficService as any).setSpeedLimitDirect(currentDev.ip, limit, gateway.ip);
                        } else {
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
                            await this.db.setDeviceBlocked(currentDev.mac, false, sessionId, currentNetId);
                            await this.db.setDeviceSpeedLimit(currentDev.mac, limit, currentNetId);
                            this.registry.setDevice(currentDev.ip, currentDev);
                        }

                        this.emit('deviceUpdated', currentDev);
                        if (this.registry) {
                            this.registry.emit('deviceUpdated', currentDev);
                        }
                    } catch (err) {
                        this.log.error({ err, ip: target.ip, mac: target.mac }, `[AUTO-THROTTLE] Failed to auto-throttle ${target.ip}`);
                    }
                }));
            }

            // 3. Gaming Mode: throttle perangkat baru selagi mode aktif
            if (this.gamingService && 'gamingActive' in this.gamingService && (this.gamingService as any).gamingActive && gateway) {
                if (typeof (this.gamingService as any).reapplyGamingSweep === 'function') {
                    await (this.gamingService as any).reapplyGamingSweep(gateway);
                }
            }

            for (const mac of newlyAddedProfileMacs) {
                if (this.registry.scheduleProfileEnrichment) {
                    this.registry.scheduleProfileEnrichment(mac, 1500);
                }
            }

            await this.attachSpoofCutStatus();

            const finalDevices = this.registry.getAllDevices();
            this.emit('devicesUpdated', finalDevices);
            if (this.registry) {
                this.registry.emit('devicesUpdated', finalDevices);
            }
            return finalDevices;
        } finally {
            this.scanning = false;
            const finalDevices = this.registry.getAllDevices();
            this.emit('scanComplete', finalDevices);
            if (this.registry) {
                this.registry.emit('scanComplete', finalDevices);
            }
        }
    }

    async handleLivenessEvent(data: any): Promise<void> {
        if (!data || !data.ip || !data.mac) return;
        const normMac = data.mac.toLowerCase();
        let dev = this.registry.getDevice(data.ip);
        if (!dev) {
            dev = this.registry.findDeviceByMac(normMac);
        }

        if (dev && !dev.is_self && !dev.is_gateway) {
            const wasOnline = Boolean(dev.is_online);
            const isOnline = Boolean(data.is_online);
            dev.is_online = isOnline;
            if (data.rtt_ms !== undefined) dev.rtt_ms = data.rtt_ms;
            this.registry.setDevice(dev.ip, dev);
            await this.db.setDeviceOnlineStatus(dev.mac, isOnline, this.registry.getCurrentNetworkId()).catch(err => this.log.warn({ mac: dev?.mac, err }, 'Failed to set online status on liveness pulse'));
            
            this.emit('deviceUpdated', dev);
            if (this.registry) {
                this.registry.emit('deviceUpdated', dev);
            }

            if (wasOnline && !isOnline) {
                this.log.info({ ip: dev.ip, mac: dev.mac, vector: data.vector || 'timeout' }, `[LivenessPulse < 0.75s] Instant Offline Confirmed: ${dev.ip} (${dev.mac}) via vector '${data.vector || 'timeout'}'`);
                this.registry.armOfflineCooldown?.(dev.mac, dev.alias || dev.hostname || dev.ip);
                this.emit('deviceDisconnected', dev);
                this.emit('devicesUpdated', this.registry.getAllDevices());
                if (this.registry) {
                    this.registry.emit('deviceDisconnected', dev);
                    this.registry.emit('devicesUpdated', this.registry.getAllDevices());
                }
            } else if (!wasOnline && isOnline) {
                this.log.info({ ip: dev.ip, mac: dev.mac, vector: data.vector }, `[LivenessPulse < 0.75s] Instant Online Confirmed: ${dev.ip} (${dev.mac}) via vector '${data.vector}'`);
                this.emit('devicesUpdated', this.registry.getAllDevices());
                if (this.registry) {
                    this.registry.emit('devicesUpdated', this.registry.getAllDevices());
                }
            }
        }
    }

    private async getLiveEngineSessionIds(): Promise<Set<string> | undefined> {
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

    private async attachSpoofCutStatus(): Promise<void> {
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
        for (const dev of this.registry.getAllDevices()) {
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
}
