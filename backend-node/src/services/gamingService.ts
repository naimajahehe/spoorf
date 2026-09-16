import { EventEmitter } from 'events';
import { Device } from '../types';
import { IPythonBridge, IDatabaseService, IGamingService } from '../interfaces';
import { selectGateway } from './deviceManager';
import { createChildLogger } from '../utils/logger';

export interface GamingRestorePlan {
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

export interface PendingGamingDisable {
    mode: string;
    targetPingMs: number;
    gateway?: Pick<Device, 'ip' | 'mac' | 'ipv6_link_local'>;
    restorePlans: GamingRestorePlan[];
    pythonOff: boolean;
    result?: any;
}

export interface IGamingStateDelegate {
    getDevice(ip: string): Device | undefined;
    findDeviceByMac(mac: string): Device | undefined;
    getAllDevices(): Device[];
    findGateway(): Device | undefined;
    setDevice(key: string, device: Device): void;
    getCurrentNetworkId(): string;
    emit(event: string, ...args: any[]): boolean;
    runExclusive<T>(fn: () => Promise<T>): Promise<T>;
}

export class GamingService extends EventEmitter implements IGamingService {
    private readonly log = createChildLogger('GamingService');

    // Perangkat yang dikelola Gaming Mode, DIKUNCI per-MAC (lowercase) agar tahan ganti-IP.
    public gamingManaged: Map<string, { priorLimit: number; hadSession: boolean; sessionId?: string }> = new Map();
    public gamingActive: boolean = false;
    public gamingMode: string = 'auto_airtime';
    public gamingTargetLimit: number = 100;
    public pendingGamingDisable: PendingGamingDisable | null = null;

    constructor(
        private readonly python: IPythonBridge,
        private readonly db: IDatabaseService,
        private readonly delegate?: IGamingStateDelegate
    ) {
        super();
    }

    private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        if (this.delegate) {
            return this.delegate.runExclusive(fn);
        }
        return fn();
    }

    private findDeviceByMac(macKey: string): Device | undefined {
        if (this.delegate) {
            return this.delegate.findDeviceByMac(macKey);
        }
        return undefined;
    }

    private get devices(): Device[] {
        return this.delegate ? this.delegate.getAllDevices() : [];
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
                const gateway = selectGateway(this.devices);
                if (!gateway) {
                    this.emit('gamingStatusChanged', result);
                    this.delegate?.emit('gamingStatusChanged', result);
                    return result;
                }

                // Auto-Isolate / Auto-Throttle seluruh perangkat LAN yang sedang online (kecuali Gateway & This PC)
                const targetLimit = mode === 'blackhole_priority' ? 0 : 20;
                this.gamingActive = true;
                this.gamingMode = mode;
                this.gamingTargetLimit = targetLimit;

                const onlineTargets = this.devices.filter(d =>
                    !d.is_gateway && !d.is_self && d.is_online
                );

                this.log.info({ count: onlineTargets.length, mode, targetLimit }, `[GAMING MODE AKTIF] Mengisolasi otomatis ${onlineTargets.length} perangkat LAN (Mode: ${mode}, Limit: ${targetLimit}%)...`);

                for (const target of onlineTargets) {
                    await this.applyGamingToDevice(target, gateway);
                }

                if (this.delegate) {
                    this.delegate.emit('devicesUpdated', this.devices);
                    this.delegate.emit('gamingStatusChanged', result);
                }
                this.emit('devicesUpdated', this.devices);
                this.emit('gamingStatusChanged', result);
                return result;
            } else {
                const pending = this.pendingGamingDisable || this.createPendingGamingDisable(mode, targetPingMs);
                this.pendingGamingDisable = pending;
                this.log.info({ count: pending.restorePlans.length }, `[GAMING MODE NONAKTIF] Memulihkan ${pending.restorePlans.length} perangkat yang dikelola Gaming Mode...`);

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
                    const device = this.findDeviceByMac(plan.macKey);
                    if (!device) continue;
                    device.session_id = plan.hadSession ? plan.restoredSessionId : undefined;
                    device.speed_limit = plan.hadSession ? plan.priorLimit : 100;
                    device.is_blocked = plan.hadSession && plan.priorLimit <= 0;
                    if (this.delegate) {
                        this.delegate.setDevice(device.ip, device);
                    }
                    updatedDevices.push(device);
                }

                this.gamingActive = false;
                this.gamingManaged.clear();
                this.pendingGamingDisable = null;
                for (const device of updatedDevices) {
                    this.delegate?.emit('deviceUpdated', device);
                    this.emit('deviceUpdated', device);
                }
                if (this.delegate) {
                    this.delegate.emit('devicesUpdated', this.devices);
                    this.delegate.emit('gamingStatusChanged', pending.result);
                }
                this.emit('devicesUpdated', this.devices);
                this.emit('gamingStatusChanged', pending.result);
                return pending.result;
            }
        });
    }

    private createPendingGamingDisable(mode: string, targetPingMs: number): PendingGamingDisable {
        const restorePlans = Array.from(this.gamingManaged.entries()).map(([macKey, meta]) => {
            const device = this.findDeviceByMac(macKey);
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
        const gateway = selectGateway(this.devices);
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

    public assertNoPendingGamingRecoveryConflict(devices: Iterable<Device>): void {
        for (const device of devices) {
            this.assertNoPendingGamingRecoveryConflictByIdentity({
                mac: device.mac,
                ip: device.ip,
                profileId: device.profile_id,
            });
        }
    }

    public assertNoPendingGamingRecoveryConflictByIdentity(
        identity: { mac?: string; ip?: string; profileId?: string }
    ): void {
        if (!this.pendingGamingDisable) return;

        for (const plan of this.pendingGamingDisable.restorePlans) {
            if (
                (identity.mac && plan.macKey === identity.mac.toLowerCase()) ||
                (identity.ip && plan.device?.ip === identity.ip) ||
                (identity.profileId && plan.device?.profile_id === identity.profileId)
            ) {
                throw this.pendingGamingRecoveryError();
            }
        }
    }

    private pendingGamingRecoveryError(): Error {
        return new Error(
            'Gaming disable recovery is pending for a managed device. Retry disabling Gaming Mode before changing its network state.'
        );
    }

    public async applyGamingToDevice(target: Device, gateway: Device): Promise<void> {
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
            if (this.delegate) {
                this.delegate.setDevice(target.ip, target);
                this.delegate.emit('deviceUpdated', target);
            }
            this.emit('deviceUpdated', target);
        } catch (err: any) {
            this.log.warn({ err, ip: target.ip, mac: target.mac }, `Notice mengisolasi perangkat ${target.ip} untuk Gaming Mode: ${err.message}`);
        }
    }

    public async maybeApplyGamingToNewDevice(dev: Device): Promise<void> {
        if (!this.gamingActive) return;
        if (dev.is_gateway || dev.is_self || !dev.is_online) return;
        if (this.gamingManaged.has(dev.mac.toLowerCase())) return;
        const gateway = selectGateway(this.devices);
        if (!gateway) return;
        await this.applyGamingToDevice(dev, gateway);
    }

    public async stopGamingSession(macKey: string): Promise<void> {
        const gm = this.gamingManaged.get(macKey);
        if (!gm) return;
        if (gm.sessionId) {
            try {
                await this.python.stopSpoof(gm.sessionId);
            } catch (error) {
                this.log.warn({ err: error, sessionId: gm.sessionId, mac: macKey }, `Notice stopping Gaming Mode session ${gm.sessionId}`);
            }
        }
        this.gamingManaged.delete(macKey);
    }

    public async reapplyGamingSweep(gateway: Device): Promise<void> {
        await this.runExclusive(async () => {
            if (!this.gamingActive) return;
            for (const dev of this.devices) {
                if (dev.is_gateway || dev.is_self || !dev.is_online) continue;
                if (this.gamingManaged.has(dev.mac.toLowerCase())) continue;
                await this.applyGamingToDevice(dev, gateway);
            }
        });
    }
}
