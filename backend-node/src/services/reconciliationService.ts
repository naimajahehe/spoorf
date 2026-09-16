import { EventEmitter } from 'events';
import { Device, ProfileAssessment, ProfileRefreshResult } from '../types';
import {
    IPythonBridge,
    IDatabaseService,
    IReconciliationService,
    DhcpOptimizationResult,
    ITrafficService,
    IGamingService,
    IDiscoveryService
} from '../interfaces';
import { normalizeProfileIpv6Addresses } from './pythonBridge';
import { createChildLogger } from '../utils/logger';
import {
    deviceMemKey,
    normalizeProfileMac,
    isPrivateIpv4,
    isGenericProfileLabel,
    isIpInSameSubnet
} from '../utils/deviceUtils';

const DHCP_OPTIMIZATION_COOLDOWN_MS = 20_000;
const PROFILE_REFRESH_COOLDOWN_MS = 20_000;
const PROFILE_ENRICHMENT_COOLDOWN_MS = 60_000;
const PROFILE_ENRICHMENT_DEBOUNCE_MS = 1_500;
const IDENTITY_REBLOCK_MIN_INTERVAL_MS = 8_000;

export interface IReconciliationRegistryDelegate {
    getDevice(ip: string): Device | undefined;
    findDeviceByMac(mac: string): Device | undefined;
    getAllDevices(): Device[];
    findGateway(gatewayIp?: string): Device | undefined;
    setDevice(key: string, device: Device): void;
    deleteDevice(key: string): boolean;
    getCurrentNetworkId(): string;
    emit(event: string, ...args: any[]): boolean;
    runExclusive<T>(fn: () => Promise<T>): Promise<T>;
    isAutoScanEnabled?(): boolean;
    debouncedScan?(delayMs?: number): void;
    scanNetwork?(options?: any): Promise<Device[]>;
    scheduleProfileEnrichment?(mac: string, delayMs?: number): void;
}

export class ReconciliationService extends EventEmitter implements IReconciliationService {
    private readonly log = createChildLogger('ReconciliationService');

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
    private offlineCooldownTimers: Map<string, NodeJS.Timeout> = new Map();
    private lastIdentityReblockAt: number = 0;

    constructor(
        private python: IPythonBridge,
        private db: IDatabaseService,
        private registry: IReconciliationRegistryDelegate,
        private trafficService?: ITrafficService,
        private gamingService?: IGamingService,
        private discoveryService?: IDiscoveryService
    ) {
        super();
    }

    onNetworkChanged(): void {
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
    }

    async handleDhcpEvent(data: any): Promise<void> {
        this.log.debug({ data }, '[ReconciliationService] DHCP event received');
        const isRelease = data && (
            data.kind === 'release' ||
            data.is_release === true ||
            data.message_type_code === 7
        );

        if (isRelease && (data.mac || data.ip)) {
            let updatedAny = false;
            if (data.mac) {
                const normMac = data.mac.toLowerCase();
                const matches: Array<[string, Device]> = [];
                for (const dev of this.registry.getAllDevices()) {
                    if (dev.mac.toLowerCase() === normMac) {
                        matches.push([deviceMemKey(dev), dev]);
                    }
                }
                for (const [ipKey, dev] of matches) {
                    dev.is_online = false;
                    if (this.gamingService && 'stopGamingSession' in this.gamingService) {
                        await (this.gamingService as any).stopGamingSession(normMac);
                    }
                    if (dev.ip) {
                        dev.last_ip = dev.ip;
                        this.registry.deleteDevice(ipKey);
                        dev.ip = '';
                    }
                    this.registry.setDevice(deviceMemKey(dev), dev);
                    this.db.setDeviceOnlineStatus(dev.mac, false, this.registry.getCurrentNetworkId()).catch(err => this.log.warn({ mac: dev.mac, err }, 'Failed to set device offline on DHCP release'));
                    this.emit('deviceUpdated', dev);
                    this.emit('deviceDisconnected', dev);
                    if (this.registry) {
                        this.registry.emit('deviceUpdated', dev);
                        this.registry.emit('deviceDisconnected', dev);
                    }
                    updatedAny = true;
                }
            }
            if (updatedAny) {
                const all = this.registry.getAllDevices();
                this.emit('devicesUpdated', all);
                if (this.registry) {
                    this.registry.emit('devicesUpdated', all);
                }
            }
            this.emit('dhcpActivity', { kind: 'release', mac: data.mac, ip: data.ip });
            if (this.registry) {
                this.registry.emit('dhcpActivity', { kind: 'release', mac: data.mac, ip: data.ip });
            }
        } else if (data && data.mac && data.ip) {
            const activeGw = this.registry.findGateway();
            if (activeGw && !isIpInSameSubnet(data.ip, activeGw.ip)) {
                return;
            }
            if (data.is_decline) {
                return;
            }

            const normMac = data.mac.toLowerCase();

            // ⚡ [DHCP Fast-Revival] Batalkan penalti karantina 30s seketika saat sinyal DHCP aktif diterima
            const existingPenalty = this.offlineCooldownTimers.get(normMac);
            if (existingPenalty) {
                clearTimeout(existingPenalty);
                this.offlineCooldownTimers.delete(normMac);
                this.log.info({ mac: normMac, messageType: data.message_type }, `[DHCP Fast-Revival] Penalti 30s DIBATALKAN untuk ${normMac} karena sinyal DHCP ${data.message_type || 'aktif'} diterima!`);
            }

            let dev: Device | undefined;
            let oldIpOfThisMac: string | undefined;

            for (const d of this.registry.getAllDevices()) {
                if (d.mac.toLowerCase() === normMac) {
                    dev = d;
                    oldIpOfThisMac = d.ip;
                    break;
                }
            }

            const occupantOfNewIp = this.registry.getDevice(data.ip);
            if (occupantOfNewIp && occupantOfNewIp.mac.toLowerCase() !== normMac) {
                this.log.info({ ip: data.ip, oldMac: occupantOfNewIp.mac, newMac: normMac }, `[DHCP IP Churn] IP ${data.ip} berpindah kepemilikan dari ${occupantOfNewIp.mac} ke ${normMac}`);
                occupantOfNewIp.is_online = false;
                occupantOfNewIp.ip = '';
                this.registry.deleteDevice(data.ip);
                this.registry.setDevice(deviceMemKey(occupantOfNewIp), occupantOfNewIp);
                this.db.setDeviceOnlineStatus(occupantOfNewIp.mac, false, this.registry.getCurrentNetworkId()).catch(err => this.log.warn({ mac: occupantOfNewIp.mac, err }, 'Failed to set old occupant offline on DHCP churn'));
                this.emit('deviceUpdated', occupantOfNewIp);
                this.emit('deviceDisconnected', occupantOfNewIp);
                if (this.registry) {
                    this.registry.emit('deviceUpdated', occupantOfNewIp);
                    this.registry.emit('deviceDisconnected', occupantOfNewIp);
                }
            }

            let isNewDevice = false;
            if (!dev && occupantOfNewIp && occupantOfNewIp.mac.toLowerCase() !== normMac) {
                dev = {
                    ip: data.ip,
                    mac: normMac,
                    hostname: data.hostname || '',
                    vendor: '',
                    device_type: 'Unknown',
                    os: '',
                    is_online: true,
                    is_blocked: false,
                    is_gateway: false,
                    is_self: false,
                    speed_limit: 100,
                    rtt_ms: 0.1,
                    open_ports: [],
                    services: [],
                    dhcp_fingerprint: data.dhcp_fingerprint,
                    dhcp_vendor_class: data.vendor_class,
                    dhcp_client_id: data.client_id,
                    dhcp_fqdn: data.fqdn,
                    network_id: this.registry.getCurrentNetworkId()
                };
                this.registry.setDevice(data.ip, dev);
                isNewDevice = true;
            }

            if (dev) {
                if (oldIpOfThisMac && oldIpOfThisMac !== data.ip) {
                    this.log.info({ mac: dev.mac, hostname: dev.hostname, oldIp: oldIpOfThisMac, newIp: data.ip }, `[DHCP IP Migration] Device ${dev.hostname || dev.mac} moved from ${oldIpOfThisMac} to ${data.ip}`);
                    this.registry.deleteDevice(oldIpOfThisMac);
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
                this.registry.setDevice(dev.ip, dev);

                if (typeof this.db.updateDeviceDhcpProfile === 'function') {
                    await this.db.updateDeviceDhcpProfile({
                        mac: dev.mac,
                        ip: data.ip,
                        hostname: hostnameShouldChange ? data.hostname : undefined,
                        vendorClass: data.vendor_class,
                        fingerprint: data.dhcp_fingerprint,
                        clientId: data.client_id,
                        fqdn: data.fqdn
                    }, this.registry.getCurrentNetworkId());
                }

                this.emit('deviceUpdated', dev);
                this.emit('devicesUpdated', this.registry.getAllDevices());
                if (this.registry) {
                    this.registry.emit('deviceUpdated', dev);
                    this.registry.emit('devicesUpdated', this.registry.getAllDevices());
                }

                if (this.gamingService && 'maybeApplyGamingToNewDevice' in this.gamingService) {
                    const gw = this.registry.findGateway();
                    if (gw) {
                        await (this.gamingService as any).maybeApplyGamingToNewDevice(dev, gw);
                    }
                }

                if (profileChanged) {
                    if (this.registry.scheduleProfileEnrichment) {
                        this.registry.scheduleProfileEnrichment(normMac, PROFILE_ENRICHMENT_DEBOUNCE_MS);
                    } else {
                        this.scheduleProfileEnrichment(normMac, PROFILE_ENRICHMENT_DEBOUNCE_MS);
                    }
                }

                if (dev.is_blocked && !dev.is_gateway && !dev.is_self) {
                    const gw = this.registry.findGateway();
                    if (gw) {
                        dev.session_id = undefined;
                        try {
                            if (this.trafficService && 'blockDeviceDirect' in this.trafficService) {
                                await (this.trafficService as any).blockDeviceDirect(dev.ip, gw.ip);
                            }
                            this.log.info({ mac: dev.mac, ip: dev.ip }, `[DHCP Re-Block] Blok ditegakkan ulang untuk ${dev.hostname || dev.mac} di ${dev.ip}`);
                        } catch (e: any) {
                            this.log.warn({ mac: dev.mac, err: e }, `Notice re-blocking ${dev.mac} on DHCP: ${e?.message || e}`);
                        }
                    }
                }
            } else {
                isNewDevice = true;
                try {
                    if (typeof this.db.hasBlockedIdentityMatch === 'function' && this.db.hasBlockedIdentityMatch(data, this.registry.getCurrentNetworkId())) {
                        const now = Date.now();
                        if (now - this.lastIdentityReblockAt >= IDENTITY_REBLOCK_MIN_INTERVAL_MS) {
                            this.lastIdentityReblockAt = now;
                            this.log.info({ mac: normMac }, `[Identity Re-Block] DHCP MAC baru ${normMac} cocok identitas terblokir -> picu re-block scan seketika.`);
                            if (this.registry.scanNetwork) {
                                this.registry.scanNetwork().catch(err => this.log.warn({ err }, `Notice identity re-block scan: ${err?.message || err}`));
                            } else if (this.discoveryService) {
                                this.discoveryService.scanNetwork().catch(err => this.log.warn({ err }, `Notice identity re-block scan: ${err?.message || err}`));
                            }
                        }
                    }
                } catch (e: any) {
                    this.log.warn({ err: e }, `Notice identity re-block check: ${e?.message || e}`);
                }
            }

            this.emit('dhcpActivity', {
                kind: isNewDevice ? 'new' : 'renew',
                mac: normMac,
                ip: data.ip,
                hostname: data.hostname,
                vendor_class: data.vendor_class
            });
            if (this.registry) {
                this.registry.emit('dhcpActivity', {
                    kind: isNewDevice ? 'new' : 'renew',
                    mac: normMac,
                    ip: data.ip,
                    hostname: data.hostname,
                    vendor_class: data.vendor_class
                });
            }

            const autoScan = this.registry.isAutoScanEnabled ? this.registry.isAutoScanEnabled() : (this.discoveryService ? this.discoveryService.isAutoScanEnabled() : false);
            if (isNewDevice && autoScan && !this.inFlightDhcpOptimization) {
                if (this.registry.debouncedScan) {
                    this.registry.debouncedScan();
                } else if (this.discoveryService) {
                    this.discoveryService.debouncedScan();
                }
            }
        } else if (data && data.mac && !data.ip) {
            const normMac = data.mac.toLowerCase();
            for (const d of this.registry.getAllDevices()) {
                if (d.mac.toLowerCase() === normMac) {
                    if (data.hostname && (!d.hostname || d.hostname.toLowerCase().startsWith('unknown'))) {
                        d.hostname = data.hostname;
                    }
                    if (data.vendor_class) d.dhcp_vendor_class = data.vendor_class;
                    if (data.dhcp_fingerprint) d.dhcp_fingerprint = data.dhcp_fingerprint;
                    if (data.client_id) d.dhcp_client_id = data.client_id;
                    if (data.fqdn) d.dhcp_fqdn = data.fqdn;
                    this.emit('deviceUpdated', d);
                    if (this.registry) {
                        this.registry.emit('deviceUpdated', d);
                    }
                    break;
                }
            }

            if (typeof this.db.updateDeviceDhcpProfile === 'function') {
                await this.db.updateDeviceDhcpProfile({
                    mac: normMac,
                    ip: '',
                    hostname: data.hostname,
                    vendorClass: data.vendor_class,
                    fingerprint: data.dhcp_fingerprint,
                    clientId: data.client_id,
                    fqdn: data.fqdn
                }, this.registry.getCurrentNetworkId()).catch(err => this.log.warn({ err }, 'Failed to save DHCP profile without IP'));
            }

            try {
                if (typeof this.db.hasBlockedIdentityMatch === 'function' && this.db.hasBlockedIdentityMatch(data, this.registry.getCurrentNetworkId())) {
                    const now = Date.now();
                    if (now - this.lastIdentityReblockAt >= IDENTITY_REBLOCK_MIN_INTERVAL_MS) {
                        this.lastIdentityReblockAt = now;
                        this.log.info({ mac: normMac }, `[Identity Re-Block] DHCP discovery MAC ${normMac} cocok identitas terblokir -> picu scan seketika.`);
                        if (this.registry.scanNetwork) {
                            this.registry.scanNetwork().catch(err => this.log.warn({ err }, `Notice identity re-block scan: ${err?.message || err}`));
                        } else if (this.discoveryService) {
                            this.discoveryService.scanNetwork().catch(err => this.log.warn({ err }, `Notice identity re-block scan: ${err?.message || err}`));
                        }
                    }
                }
            } catch (e: any) {
                this.log.warn({ err: e }, `Notice identity re-block check: ${e?.message || e}`);
            }

            const autoScanNoIp = this.registry.isAutoScanEnabled ? this.registry.isAutoScanEnabled() : (this.discoveryService ? this.discoveryService.isAutoScanEnabled() : false);
            if (autoScanNoIp) {
                if (this.registry.debouncedScan) {
                    this.registry.debouncedScan(1000);
                } else if (this.discoveryService) {
                    this.discoveryService.debouncedScan(1000);
                }
            }
        }
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
            this.log.info('Triggering measured Discovery Refresh & DHCP Observation...');
            const observation = await this.python.optimizeDhcpProfiling();
            const scanFn = this.registry.scanNetwork ? (opts: any) => this.registry.scanNetwork!(opts) : (this.discoveryService ? (opts: any) => this.discoveryService!.scanNetwork(opts) : null);
            if (!scanFn) {
                throw new Error('Discovery scan service not available');
            }
            const devices = await scanFn({
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
            && this.lastProfileRefresh
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
        if (this.registry) {
            this.registry.emit('profileRefreshStarted', startedPayload);
            this.registry.emit('quickReauthStarted', { ...startedPayload, deprecated: true });
        }

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
            if (this.registry) {
                this.registry.emit('deviceUpdated', liveDevice);
            }
        }
        if (updatedDevices.length > 0) {
            const all = this.registry.getAllDevices();
            this.emit('devicesUpdated', all);
            if (this.registry) {
                this.registry.emit('devicesUpdated', all);
            }
        }

        this.assertProfileRefreshGeneration(generation);
        const result: ProfileRefreshResult = {
            ...response,
            success: true,
            devices: this.registry.getAllDevices(),
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
        if (this.registry) {
            this.registry.emit('profileRefreshDone', donePayload);
            this.registry.emit('quickReauthDone', { ...donePayload, deprecated: true });
        }
        return result;
    }

    private snapshotProfileTargets(
        targetMacs: Set<string> | null
    ): Array<{ ip: string; mac: string; ipv6_addresses: string[] }> {
        const targets = new Map<string, { ip: string; mac: string; ipv6_addresses: string[] }>();
        for (const device of this.registry.getAllDevices()) {
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
        for (const device of this.registry.getAllDevices()) {
            if (
                normalizeProfileMac(device.mac) !== normalizedMac
                || !device.is_online
                || device.is_gateway
                || device.is_self
                || !isPrivateIpv4(device.ip)
            ) {
                continue;
            }
            const occupant = this.registry.getDevice(device.ip.trim());
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

            try {
                await this.db.updateDeviceProfileAssessment({
                    ...assessment,
                    ip: currentIp
                }, this.registry.getCurrentNetworkId());
                this.assertProfileRefreshGeneration(generation);
                persistedIp = currentIp;
            } catch (err: any) {
                if (err.message && err.message.includes('Network changed')) {
                    throw err;
                }
                this.log.warn({ err, mac: assessment.mac }, `Notice updating device profile assessment for ${assessment.mac}: ${err?.message}`);
                return false;
            }

            const currentDevice = this.findCurrentOnlineProfileDeviceByMac(assessment.mac);
            if (!currentDevice) return false;
            if (currentDevice.ip.trim() === persistedIp) return true;
        }
        return false;
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

    scheduleProfileEnrichment(
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
                this.log.warn({ err: error }, 'Notice automatic profile enrichment');
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
            const device = this.registry.findDeviceByMac(mac);
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

    async quickReauthProfiling(): Promise<ProfileRefreshResult> {
        return this.profileRefresh();
    }
}
