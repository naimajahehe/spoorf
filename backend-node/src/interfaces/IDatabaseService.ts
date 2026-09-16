import { Device, Network, ProfileAssessment, CachedLicense } from '../types';

export interface SyncScanResult {
    allDevices: Device[];
    autoReblockTargets: Device[];
    autoThrottleTargets: Device[];
    zombieSessionsToStop?: string[];
}

export interface IDatabaseService {
    init(): Promise<void>;
    close(): Promise<void>;
    checkpointWal(): void;
    getDbPath(): string;
    getJournalMode(): string;

    ensureNetwork(net: Network): void;
    getNetwork(id: string): Network | null;
    getAllNetworks(): Network[];

    archiveStaleDevices(thresholdDays?: number): Promise<number>;
    pruneStaleRandomizedMacs(thresholdDays?: number): { deletedDevices: number; deletedProfiles: number };

    getAllDevices(networkId?: string): Promise<Device[]>;
    getDeviceByMac(mac: string, networkId?: string): Promise<Device | null>;
    getDeviceByIp(ip: string, networkId?: string): Promise<Device | null>;

    backfillProfileNames(): Promise<number>;
    usingMemoryFallback: boolean;
    setDeviceOnlineStatus(mac: string, isOnline: boolean, networkId?: string): Promise<void>;
    setDeviceBlocked(
        mac: string,
        isBlocked: boolean,
        sessionIdOrNetworkId?: string,
        maybeNetworkId?: string
    ): Promise<void>;
    setDeviceSpeedLimit(mac: string, speedLimit: number, networkId?: string): Promise<Device>;
    setDeviceAlias(mac: string, alias: string, networkId?: string): Promise<Device>;
    deleteDevice(mac: string, networkId?: string): Promise<void>;
    clearAllDevices(networkId?: string): Promise<void>;
    saveDevice(device: Device, networkId?: string): Promise<void>;
    updateDeviceIp(mac: string, ip: string, networkId?: string): Promise<void>;
    updateDeviceProfileAssessment(profile: ProfileAssessment, networkId?: string): Promise<void>;
    updateDeviceDhcpProfile(
        profile: {
            mac: string;
            ip: string;
            hostname?: string;
            vendorClass?: string;
            fingerprint?: string;
            clientId?: string;
            fqdn?: string;
        },
        networkId?: string
    ): Promise<void>;
    hasBlockedIdentityMatch(
        data: { client_id?: string; hostname?: string; dhcp_fingerprint?: string; vendor_class?: string },
        networkId?: string
    ): boolean;
    syncScanResults(
        scannedDevices: Device[],
        networkIdOrLiveSessionIds?: string | Set<string>,
        liveSessionIds?: Set<string>
    ): Promise<SyncScanResult>;

    saveLicenseCache(lic: CachedLicense): Promise<void>;
    getLicenseCache(): Promise<CachedLicense | null>;
    saveCachedLicense(lic: CachedLicense): Promise<void>;
    clearLicenseCache(): Promise<void>;
}
