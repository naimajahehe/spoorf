import os from 'os';
import { EventEmitter } from 'events';
import { Device } from '../types';
import { IPythonBridge, IDatabaseService, ILicenseManager, ITrafficService } from '../interfaces';
import { FeatureLimitError, FeatureLockedError } from './licenseManager';
import { createChildLogger } from '../utils/logger';
import { deviceMemKey, isPrivateIpv4 } from '../utils/deviceUtils';

export interface IDeviceRegistry {
    getDevice(ip: string): Device | undefined;
    findDeviceByMac(mac: string): Device | undefined;
    getAllDevices(): Device[];
    findGateway(gatewayIp?: string): Device | undefined;
    setDevice(key: string, device: Device): void;
    deleteDevice(key: string): boolean | void;
    getCurrentNetworkId(): string;
    emit(event: string, ...args: any[]): boolean;
    runExclusive<T>(fn: () => Promise<T>): Promise<T>;
    assertNoPendingGamingConflict?(devices: Iterable<Device>): void;
    getLicense?(): ILicenseManager | undefined;
}

export class TrafficService extends EventEmitter implements ITrafficService {
    private readonly log = createChildLogger('TrafficService');

    constructor(
        private readonly python: IPythonBridge,
        private readonly db: IDatabaseService,
        private readonly license?: ILicenseManager,
        private readonly registry?: IDeviceRegistry
    ) {
        super();
    }

    private get currentLicense(): ILicenseManager | undefined {
        return this.registry?.getLicense ? this.registry.getLicense() : this.license;
    }

    private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        if (this.registry) {
            return this.registry.runExclusive(fn);
        }
        return fn();
    }

    private get currentNetworkId(): string {
        return this.registry ? this.registry.getCurrentNetworkId() : 'net_default';
    }

    private emitUpdate(device: Device): void {
        this.emit('deviceUpdated', device);
        if (this.registry) {
            this.registry.emit('deviceUpdated', device);
            this.registry.emit('devicesUpdated', this.registry.getAllDevices());
        }
    }

    async blockDevice(ip: string, gatewayIp?: string): Promise<Device> {
        return this.runExclusive(() => this._blockDeviceImpl(ip, gatewayIp));
    }

    async blockDeviceDirect(ip: string, gatewayIp?: string): Promise<Device> {
        return this._blockDeviceImpl(ip, gatewayIp);
    }

    private async _blockDeviceImpl(ip: string, gatewayIp?: string): Promise<Device> {
        let device = this.registry?.getDevice(ip) || this.registry?.findDeviceByMac(ip);
        if (!device) {
            throw new Error(`Device ${ip} not found`);
        }

        if (this.registry?.assertNoPendingGamingConflict) {
            this.registry.assertNoPendingGamingConflict([device]);
        }

        // Jika IP perangkat kosong (perangkat offline / rotasi MAC), cari IP aktif via MAC atau profil
        if (!device.ip && this.registry) {
            for (const d of this.registry.getAllDevices()) {
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

        if (device.is_gateway || (gatewayIp && device.ip === gatewayIp)) {
            throw new Error(`Cannot block the gateway (${ip})`);
        }

        if (!isPrivateIpv4(device.ip)) {
            throw new Error(`Target IP must be an RFC 1918 private address (${device.ip})`);
        }

        if (device.is_blocked && device.session_id) {
            throw new Error(`Device ${ip} already actively blocked`);
        }

        if (this.currentLicense && this.registry) {
            const activeBlockedCount = this.registry.getAllDevices().filter(d => d.is_blocked).length;
            const check = this.currentLicense.checkCanBlock(activeBlockedCount, Boolean(device.is_blocked));
            if (!check.allowed) {
                throw new FeatureLimitError(check.reason || 'Batas kuota pemutusan tercapai. Upgrade ke Pro untuk memutus tanpa batas!');
            }
        }

        const gateway = (gatewayIp && this.registry ? this.registry.getDevice(gatewayIp) : undefined) ||
            (gatewayIp && this.registry ? this.registry.findGateway(gatewayIp) : undefined) ||
            this.registry?.findGateway();
        if (!gateway) {
            throw new Error(gatewayIp ? `Gateway ${gatewayIp} not found` : 'Gateway not found');
        }

        if (gateway.ip && !isPrivateIpv4(gateway.ip)) {
            throw new Error(`Gateway IP must be an RFC 1918 private address (${gateway.ip})`);
        }

        if (device.ip === gateway.ip || (device.mac && gateway.mac && device.mac.toLowerCase() === gateway.mac.toLowerCase())) {
            throw new Error(`Cannot block the gateway (${ip})`);
        }

        // Pre-Flight Validation: Verifikasi apakah target benar-benar aktif di jaringan L2
        device = await this.verifyPreFlightLiveness(device, gateway.ip);

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
        if (this.registry) {
            this.registry.setDevice(deviceMemKey(device), device);

            // Sinkronkan juga perangkat lain di memori yang berbagi profile_id sama
            if (device.profile_id) {
                for (const d of this.registry.getAllDevices()) {
                    if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                        d.is_blocked = true;
                        d.speed_limit = 0;
                        this.registry.setDevice(deviceMemKey(d), d);
                    }
                }
            }
        }

        // Simpan status blokir secara persisten di SQLite
        await this.db.setDeviceBlocked(device.mac, true, sessionId, this.currentNetworkId);
        await this.db.setDeviceSpeedLimit(device.mac, 0, this.currentNetworkId);
        await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);

        this.emitUpdate(device);
        return device;
    }

    async unblockDevice(identifier: string): Promise<Device> {
        return this.runExclusive(() => this._unblockDeviceImpl(identifier));
    }

    async unblockDeviceDirect(identifier: string): Promise<Device> {
        return this._unblockDeviceImpl(identifier);
    }

    private async _unblockDeviceImpl(identifier: string): Promise<Device> {
        const device = this.registry?.findDeviceByMac(identifier) || this.registry?.getDevice(identifier);
        if (!device) {
            const dbDev = await this.db.getDeviceByMac(identifier, this.currentNetworkId);
            if (!dbDev) {
                throw new Error(`Device ${identifier} not found`);
            }
            // Device exists in DB but not in active memory
            dbDev.is_blocked = false;
            dbDev.speed_limit = 100;

            if (dbDev.profile_id && this.registry) {
                for (const d of this.registry.getAllDevices()) {
                    if (d.profile_id === dbDev.profile_id) {
                        if (d.session_id) {
                            try { await this.python.stopSpoof(d.session_id); } catch {}
                        }
                        d.is_blocked = false;
                        d.is_redirected = false;
                        d.redirect_url = undefined;
                        d.speed_limit = 100;
                        d.session_id = undefined;
                        this.registry.setDevice(deviceMemKey(d), d);
                    }
                }
            }

            await this.db.setDeviceBlocked(dbDev.mac, false, undefined, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(dbDev.mac, 100, this.currentNetworkId);
            this.emitUpdate(dbDev);
            return dbDev;
        }

        if (this.registry?.assertNoPendingGamingConflict) {
            this.registry.assertNoPendingGamingConflict([device]);
        }

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
        if (this.registry) {
            this.registry.setDevice(deviceMemKey(device), device);

            if (device.profile_id) {
                for (const d of this.registry.getAllDevices()) {
                    if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                        if (d.session_id) {
                            try { await this.python.stopSpoof(d.session_id); } catch {}
                        }
                        d.is_blocked = false;
                        d.is_redirected = false;
                        d.redirect_url = undefined;
                        d.speed_limit = 100;
                        d.session_id = undefined;
                        this.registry.setDevice(deviceMemKey(d), d);
                    }
                }
            }
        }

        await this.db.setDeviceBlocked(device.mac, false, undefined, this.currentNetworkId);
        await this.db.setDeviceSpeedLimit(device.mac, 100, this.currentNetworkId);
        if (device.is_online) {
            await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        }

        this.emitUpdate(device);
        return device;
    }

    async setSpeedLimit(ip: string, limit: number, gatewayIp?: string): Promise<Device> {
        return this.runExclusive(() => this._setSpeedLimitImpl(ip, limit, gatewayIp));
    }

    async setSpeedLimitDirect(ip: string, limit: number, gatewayIp?: string): Promise<Device> {
        return this._setSpeedLimitImpl(ip, limit, gatewayIp);
    }

    private async _setSpeedLimitImpl(ip: string, limit: number, gatewayIp?: string): Promise<Device> {
        let device = this.registry?.getDevice(ip);
        if (!device) {
            throw new Error(`Device with IP ${ip} not found`);
        }

        if (this.registry?.assertNoPendingGamingConflict) {
            this.registry.assertNoPendingGamingConflict([device]);
        }

        if (device.is_gateway || device.is_self || (gatewayIp && device.ip === gatewayIp)) {
            const isGw = device.is_gateway || (gatewayIp && device.ip === gatewayIp);
            throw new Error(`Perangkat infrastruktur (${isGw ? 'Gateway' : 'Perangkat Ini'}) dilindungi dan tidak dapat dibatasi kecepatannya.`);
        }

        const cleanLimit = Math.max(0, Math.min(100, Math.round(limit)));

        if (cleanLimit < 100 && !isPrivateIpv4(device.ip)) {
            throw new Error(`Target IP must be an RFC 1918 private address (${device.ip})`);
        }

        if (cleanLimit > 0 && cleanLimit < 100 && this.currentLicense) {
            const check = this.currentLicense.checkCanThrottle();
            if (!check.allowed) {
                throw new FeatureLockedError(check.reason || 'Fitur Pembatasan Kecepatan (PWM Bandwidth Throttling) khusus untuk pengguna PRO.');
            }
        }

        if (cleanLimit === 0 && this.currentLicense && this.registry) {
            const activeBlockedCount = this.registry.getAllDevices().filter(d => d.is_blocked).length;
            const check = this.currentLicense.checkCanBlock(activeBlockedCount, Boolean(device.is_blocked));
            if (!check.allowed) {
                throw new FeatureLimitError(check.reason || 'Batas kuota pemutusan tercapai. Upgrade ke Pro untuk memutus tanpa batas!');
            }
        }

        const gateway = (gatewayIp && this.registry ? this.registry.getDevice(gatewayIp) : undefined) || this.registry?.findGateway(gatewayIp);
        if (!gateway) {
            throw new Error('Gateway not found');
        }

        if (device.ip === gateway.ip || (device.mac && gateway.mac && device.mac.toLowerCase() === gateway.mac.toLowerCase())) {
            throw new Error(`Perangkat infrastruktur (Gateway) dilindungi dan tidak dapat dibatasi kecepatannya.`);
        }

        if (cleanLimit < 100) {
            if (gateway.ip && !isPrivateIpv4(gateway.ip)) {
                throw new Error(`Gateway IP must be an RFC 1918 private address (${gateway.ip})`);
            }
            device = await this.verifyPreFlightLiveness(device, gateway.ip);
        }

        if (cleanLimit === 100) {
            if (device.session_id) {
                await this.python.stopSpoof(device.session_id);
                device.session_id = undefined;
            }
            device.is_blocked = false;
            device.speed_limit = 100;
            if (device.profile_id && this.registry) {
                for (const d of this.registry.getAllDevices()) {
                    if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                        if (d.session_id) {
                            try { await this.python.stopSpoof(d.session_id); } catch {}
                        }
                        d.is_blocked = false;
                        d.is_redirected = false;
                        d.redirect_url = undefined;
                        d.speed_limit = 100;
                        d.session_id = undefined;
                        this.registry.setDevice(deviceMemKey(d), d);
                    }
                }
            }
            await this.db.setDeviceBlocked(device.mac, false, undefined, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(device.mac, 100, this.currentNetworkId);
            await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        } else if (cleanLimit === 0) {
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
            if (device.profile_id && this.registry) {
                for (const d of this.registry.getAllDevices()) {
                    if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                        d.is_blocked = true;
                        d.speed_limit = 0;
                        this.registry.setDevice(deviceMemKey(d), d);
                    }
                }
            }
            await this.db.setDeviceBlocked(device.mac, true, device.session_id, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(device.mac, 0, this.currentNetworkId);
            await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        } else {
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
            device.is_blocked = false;
            device.speed_limit = cleanLimit;
            if (device.profile_id && this.registry) {
                for (const d of this.registry.getAllDevices()) {
                    if (d.profile_id === device.profile_id && d.mac.toLowerCase() !== device.mac.toLowerCase()) {
                        d.is_blocked = false;
                        d.speed_limit = cleanLimit;
                        this.registry.setDevice(deviceMemKey(d), d);
                    }
                }
            }
            await this.db.setDeviceBlocked(device.mac, false, device.session_id, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(device.mac, cleanLimit, this.currentNetworkId);
            await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        }

        device.is_online = true;
        if (this.registry) {
            this.registry.setDevice(deviceMemKey(device), device);
        }
        this.emitUpdate(device);
        return device;
    }

    async redirectDevice(ip: string, redirectUrl: string, instagramUsername: string = '', gatewayIp?: string): Promise<Device> {
        return this.runExclusive(() => this._redirectDeviceImpl(ip, redirectUrl, instagramUsername, gatewayIp));
    }

    async redirectDeviceDirect(ip: string, redirectUrl: string, instagramUsername: string = '', gatewayIp?: string): Promise<Device> {
        return this._redirectDeviceImpl(ip, redirectUrl, instagramUsername, gatewayIp);
    }

    private async _redirectDeviceImpl(ip: string, redirectUrl: string, instagramUsername: string = '', gatewayIp?: string): Promise<Device> {
        const device = this.registry?.getDevice(ip);
        if (!device) {
            throw new Error(`Device ${ip} not found`);
        }

        if (this.registry?.assertNoPendingGamingConflict) {
            this.registry.assertNoPendingGamingConflict([device]);
        }

        if (device.is_gateway || (gatewayIp && device.ip === gatewayIp)) {
            throw new Error(`Cannot redirect the gateway (${ip})`);
        }

        if (device.is_self) {
            throw new Error(`Cannot redirect operator host (${ip})`);
        }

        if (!isPrivateIpv4(device.ip)) {
            throw new Error(`Target IP must be an RFC 1918 private address (${device.ip})`);
        }

        if (device.is_blocked || (device.session_id && !device.is_redirected)) {
            if (device.session_id) await this.python.stopSpoof(device.session_id);
            device.is_blocked = false;
            device.speed_limit = 100;
            device.session_id = undefined;
            await this.db.setDeviceBlocked(device.mac, false, undefined, this.currentNetworkId);
            await this.db.setDeviceSpeedLimit(device.mac, 100, this.currentNetworkId);
        }

        const gw = (gatewayIp && this.registry ? this.registry.getDevice(gatewayIp) : null) || this.registry?.findGateway();
        if (!gw) {
            throw new Error('Gateway not found');
        }

        if (gw.ip && !isPrivateIpv4(gw.ip)) {
            throw new Error(`Gateway IP must be an RFC 1918 private address (${gw.ip})`);
        }

        if (device.ip === gw.ip || (device.mac && gw.mac && device.mac.toLowerCase() === gw.mac.toLowerCase())) {
            throw new Error(`Cannot redirect the gateway (${ip})`);
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

        if (this.registry) {
            this.registry.setDevice(deviceMemKey(device), device);
        }
        await this.db.setDeviceOnlineStatus(device.mac, true, this.currentNetworkId);
        this.emitUpdate(device);
        return device;
    }

    async stopRedirectDevice(ip: string): Promise<Device> {
        return this.runExclusive(() => this._stopRedirectDeviceImpl(ip));
    }

    async stopRedirectDeviceDirect(ip: string): Promise<Device> {
        return this._stopRedirectDeviceImpl(ip);
    }

    private async _stopRedirectDeviceImpl(ip: string): Promise<Device> {
        const device = this.registry?.getDevice(ip) || this.registry?.findDeviceByMac(ip);
        if (!device) {
            throw new Error(`Device ${ip} not found`);
        }

        if (this.registry?.assertNoPendingGamingConflict) {
            this.registry.assertNoPendingGamingConflict([device]);
        }

        await this.python.stopRedirect(device.ip);

        if (device.session_id) {
            try {
                await this.python.stopSpoof(device.session_id);
            } catch {
                // Ignore failure if already stopped in engine
            }
            device.session_id = undefined;
        }

        device.is_redirected = false;
        device.redirect_url = undefined;
        device.is_blocked = false;
        device.speed_limit = 100;

        if (this.registry) {
            this.registry.setDevice(deviceMemKey(device), device);
        }
        await this.db.setDeviceBlocked(device.mac, false, undefined, this.currentNetworkId);
        await this.db.setDeviceSpeedLimit(device.mac, 100, this.currentNetworkId);

        this.emitUpdate(device);
        return device;
    }

    async clearStaleSpoofSession(device: Device): Promise<void> {
        if (!device.session_id) return;
        const oldSessionId = device.session_id;
        device.session_id = undefined;
        try {
            await this.python.stopSpoof(oldSessionId);
        } catch {
            // Engine mungkin sudah menghapus sesi ini (mis. restart/timeout) — aman diabaikan
        }
    }

    async verifyPreFlightLiveness(device: Device, gatewayIp: string): Promise<Device> {
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

            if (targetPulse && targetPulse.resolved_mac) {
                const liveMac = String(targetPulse.resolved_mac).toLowerCase();
                const currentMac = device.mac.toLowerCase();
                if (liveMac !== currentMac) {
                    const gw = (this.registry ? this.registry.getDevice(gatewayIp) : undefined) || this.registry?.findGateway(gatewayIp);
                    const gwMac = (gw?.mac || '').toLowerCase();
                    if (gwMac && gwMac === liveMac) {
                        throw new Error(`Cannot target gateway router (${device.ip} resolves to gateway MAC ${liveMac})`);
                    }

                    const selfDev = this.registry?.getAllDevices().find(d => d.is_self);
                    const localHostMacs = new Set<string>();
                    try {
                        for (const addrs of Object.values(os.networkInterfaces())) {
                            for (const a of addrs || []) {
                                if (a.mac && a.mac !== '00:00:00:00:00:00') {
                                    localHostMacs.add(a.mac.toLowerCase());
                                }
                            }
                        }
                    } catch {}
                    if ((selfDev && selfDev.mac.toLowerCase() === liveMac) || localHostMacs.has(liveMac)) {
                        throw new Error(`Cannot target operator host (${device.ip} resolves to host MAC ${liveMac})`);
                    }

                    let existingLiveDevice: Device | undefined;
                    if (this.registry) {
                        for (const d of this.registry.getAllDevices()) {
                            if (d.mac.toLowerCase() === liveMac) {
                                existingLiveDevice = d;
                                break;
                            }
                        }
                    }

                    const isSameIdentity = Boolean(
                        existingLiveDevice && (
                            (existingLiveDevice.profile_id && device.profile_id && existingLiveDevice.profile_id === device.profile_id) ||
                            (device.hostname && existingLiveDevice.hostname &&
                             device.hostname !== 'Unknown' && existingLiveDevice.hostname !== 'Unknown' &&
                             device.hostname.toLowerCase() === existingLiveDevice.hostname.toLowerCase())
                        )
                    );

                    if (existingLiveDevice) {
                        if (!isSameIdentity) {
                            const occupantName = (existingLiveDevice.alias && existingLiveDevice.alias.trim()) ||
                                                 (existingLiveDevice.hostname && existingLiveDevice.hostname.trim()) ||
                                                 existingLiveDevice.ip ||
                                                 existingLiveDevice.mac;
                            throw new Error(`Perangkat target offline: IP ${device.ip} saat ini ditempati oleh perangkat lain (${occupantName} / ${liveMac}).`);
                        }
                    } else {
                        throw new Error(`Perangkat target offline: IP ${device.ip} saat ini ditempati oleh perangkat asing (${liveMac}) yang belum terdaftar. Silakan lakukan Scan terlebih dahulu.`);
                    }

                    this.log.info({ ip: device.ip, oldMac: currentMac, liveMac }, `[Pre-Flight Dynamic Re-Bind] IP ${device.ip} shifted from ${currentMac} to live MAC ${liveMac}. Reconciling target!`);
                    await this.clearStaleSpoofSession(device);

                    if (this.registry) {
                        const oldKey = deviceMemKey(existingLiveDevice);
                        const targetIp = device.ip;
                        Object.assign(device, existingLiveDevice);
                        device.ip = targetIp;
                        device.mac = liveMac;
                        device.is_online = true;
                        const newKey = deviceMemKey(device);
                        if (oldKey && oldKey !== newKey && typeof this.registry.deleteDevice === 'function') {
                            this.registry.deleteDevice(oldKey);
                        }
                        this.registry.setDevice(newKey, device);
                    }

                    await this.db.saveDevice(device, this.currentNetworkId).catch(err => this.log.warn({ mac: device.mac, err }, 'Failed to save reconciled device'));
                    this.emitUpdate(device);
                    return device;
                }
            }

            if (targetPulse && targetPulse.is_alive === false) {
                let migratedIp: string | undefined;
                let migratedMac = device.mac;
                if (this.registry) {
                    for (const d of this.registry.getAllDevices()) {
                        if (d.mac.toLowerCase() === device.mac.toLowerCase() && d.ip !== device.ip && d.is_online) {
                            migratedIp = d.ip;
                            migratedMac = d.mac;
                            break;
                        }
                    }

                    if (!migratedIp && device.profile_id) {
                        for (const d of this.registry.getAllDevices()) {
                            if (d.profile_id === device.profile_id && d.ip !== device.ip && d.is_online) {
                                migratedIp = d.ip;
                                migratedMac = d.mac;
                                break;
                            }
                        }
                    }
                }

                if (migratedIp) {
                    this.log.info({ mac: device.mac, oldIp: device.ip, newIp: migratedIp, newMac: migratedMac }, `[Pre-Flight Auto-Migration] Target ${device.mac} berpindah dari ${device.ip} ke ${migratedIp} (MAC: ${migratedMac}), memverifikasi IP baru...`);
                    const reCheck = await this.python.pulseLiveness(
                        [{ ip: migratedIp, mac: migratedMac }],
                        gatewayIp
                    );
                    if (reCheck && reCheck[migratedIp] && reCheck[migratedIp].is_alive) {
                        this.log.info({ mac: migratedMac, ip: migratedIp }, `[Pre-Flight Auto-Migration] Target ${migratedMac} TERBUKTI HIDUP di IP baru ${migratedIp}!`);
                        const oldKey = deviceMemKey(device);
                        device.ip = migratedIp;
                        device.mac = migratedMac;
                        device.is_online = true;
                        if (this.registry) {
                            const newKey = deviceMemKey(device);
                            if (oldKey && oldKey !== newKey && typeof this.registry.deleteDevice === 'function') {
                                this.registry.deleteDevice(oldKey);
                            }
                            this.registry.setDevice(newKey, device);
                        }
                        await this.db.updateDeviceIp(device.mac, migratedIp, this.currentNetworkId).catch(err => this.log.warn({ mac: device.mac, err }, 'Failed to update device IP on auto-migration'));
                        this.emitUpdate(device);
                        return device;
                    }
                }

                const TRUST_FRESH_ONLINE_MS = 15_000;
                const lastSeenMs = device.last_seen ? new Date(device.last_seen).getTime() : 0;
                const sinceSeenMs = lastSeenMs > 0 ? Date.now() - lastSeenMs : Infinity;
                if (sinceSeenMs < TRUST_FRESH_ONLINE_MS) {
                    this.log.info({ mac: device.mac, sinceSeenMs }, `[Pre-Flight Trust-Fresh] ${device.mac} terakhir online ${Math.round(sinceSeenMs / 1000)}s lalu (< ${TRUST_FRESH_ONLINE_MS / 1000}s) — melewati vonis offline, lanjutkan aksi.`);
                    return device;
                }

                device.is_online = false;
                if (this.registry) {
                    this.registry.setDevice(deviceMemKey(device), device);
                }
                await this.db.setDeviceOnlineStatus(device.mac, false, this.currentNetworkId).catch(err => this.log.warn({ mac: device.mac, err }, 'Failed to set device offline on pre-flight'));
                this.emitUpdate(device);

                const name = (device.alias && device.alias.trim()) || (device.hostname && device.hostname.trim()) || device.ip;
                throw new Error(`Perangkat ${name} tidak merespons (Offline / sudah tidak terhubung ke Wi-Fi).`);
            }
        } catch (err: any) {
            if (
                err.message && (
                    err.message.includes('tidak merespons') ||
                    err.message.includes('Cannot target') ||
                    err.message.includes('saat ini ditempati oleh')
                )
            ) {
                throw err;
            }
            this.log.warn({ err }, `Notice in pre-flight liveness check: ${err.message || err}`);
        }
        return device;
    }
}
