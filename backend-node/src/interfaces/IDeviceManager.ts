import { Device } from '../types';
import { ITrafficService } from './ITrafficService';
import { IGamingService } from './IGamingService';

export interface IDeviceManager extends ITrafficService, IGamingService {
    init(): Promise<void>;
    scanNetwork(options?: any): Promise<Device[]>;
    getDevices(): Device[];
    scopeForDisplay?(devices: Device[]): Device[];
    getDevice(ip: string): Device | undefined;
    getDeviceByMac(mac: string): Device | undefined;
    findGateway(): Device | undefined;
    isUsingMemoryFallback?(): boolean;
    isPythonReady?(): boolean;
    getSystemDiagnostics?(): Promise<any>;
    getStatus(): Promise<any>;
    getTelemetry(): Promise<any>;
    getWifiInfo(): Promise<any>;
    setDeviceAlias(mac: string, alias: string): Promise<Device>;
    deleteDevice(mac: string): Promise<void>;
    clearAllDevices(): Promise<void>;
    deepScanDevicePorts(ip: string, ports?: number[]): Promise<Device>;
    profileRefresh(targets?: string[]): Promise<any>;
    quickReauthProfiling(): Promise<any>;
    optimizeDhcpProfiling(): Promise<any>;
    getDhcpStats(): Promise<any>;
    getApIsolationStatus(): Promise<any>;

    // Transparent Gateway & DNS Sinkhole
    startTransparentGateway(ip: string, gatewayIp?: string): Promise<any>;
    stopTransparentGateway(ip: string): Promise<void>;
    getTransparentGatewayStatus(): Promise<any>;
    getSinkholeDomains(): Promise<string[]>;
    addSinkholeDomain(domain: string): Promise<string[]>;
    removeSinkholeDomain(domain: string): Promise<string[]>;
    getGatewayDnsLogs(limit?: number): Promise<any[]>;
    clearGatewayDnsLogs(): Promise<void>;

    // Interceptor & Leaf Cert
    getCAInfo(): Promise<any>;
    getCACertPem(): Promise<string>;
    getL7Flows(query?: any): Promise<any>;
    clearL7Flows(): Promise<void>;
    generateLeafCert(domain: string): Promise<any>;

    // Bettercap Suite
    getBettercapStatus(): Promise<any>;
    getBettercapDnsRules(): Promise<any>;
    addBettercapDnsRule(domain: string, target_ip: string, action?: string, is_enabled?: boolean): Promise<any>;
    updateBettercapDnsRule(ruleId: string, updates: any): Promise<any>;
    deleteBettercapDnsRule(ruleId: string): Promise<any>;
    setBettercapDnsSpoofAll(enabled: boolean, address?: string): Promise<any>;
    loadBettercapDnsHosts(content: string, defaultAddress?: string, action?: string): Promise<any>;
    setBettercapDnsTtl(ttl: number): Promise<any>;
    getBettercapCredentials(limit?: number): Promise<any[]>;
    clearBettercapCredentials(): Promise<void>;
    runBettercapSynScan(targetIp: string, ports?: number[], profile?: string): Promise<any>;

    // Sentinel Shield Suite
    getShieldStatus(): Promise<any>;
    toggleShield(enabled: boolean, mode?: string, autoRetaliate?: boolean, lanTargets?: any[]): Promise<any>;
    setShieldMode(mode: string, autoRetaliate?: boolean): Promise<any>;
    getShieldThreats(): Promise<any[]>;
    clearShieldThreats(): Promise<boolean>;

    // Event Emitter
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
}
