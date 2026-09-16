import { Device } from '../types';
import type { ScanOptions } from '../services/pythonBridge';

export interface IPythonBridge {
    start(): Promise<void>;
    stop(): void;
    isReady(): boolean;
    getDiagnostics(): Promise<any>;
    getStatus(): Promise<any>;

    // Discovery & Scanning
    scan(options?: ScanOptions): Promise<Device[]>;
    pulseLiveness(targets: Array<{ ip: string; mac: string; ipv6_link_local?: string; ipv6_slaac?: string }>): Promise<any>;
    deepScanPorts(ip: string, ports?: number[]): Promise<any>;
    getApIsolationStatus(): Promise<any>;
    getDhcpStats(): Promise<any>;
    optimizeDhcpProfiling(): Promise<{ success: boolean; message?: string; data?: any }>;
    quickReauth(targets: any[], _holdMs?: number): Promise<any>;

    // Telemetry & Wi-Fi
    getTelemetry(): Promise<any>;
    getWifiInfo(): Promise<{ connected: boolean; ssid: string; signal: string; state: string }>;

    // L2 ARP & IPv6 Spoofing
    startSpoof(
        victimIp: string,
        victimMac: string,
        gatewayIp: string,
        gatewayMac: string,
        speedLimit?: number,
        victimIpv6?: string,
        gatewayIpv6?: string,
        blackhole?: boolean
    ): Promise<string>;
    setSpoofLimit(sessionId: string, speedLimit: number): Promise<void>;
    stopSpoof(sessionId: string): Promise<void>;
    stopAll(): Promise<void>;

    // Redirection & Transparent Gateway
    startRedirect(victimIp: string, victimMac: string, gatewayIp: string, gatewayMac: string, redirectUrl: string, instagramUsername?: string): Promise<any>;
    stopRedirect(victimIp: string): Promise<void>;
    getRedirectStatus(): Promise<any>;
    startTransparentGateway(victimIp: string, victimMac: string, gatewayIp: string, gatewayMac: string): Promise<any>;
    stopTransparentGateway(victimIp: string): Promise<void>;
    getTransparentGatewayStatus(): Promise<any>;
    getSinkholeDomains(): Promise<string[]>;
    addSinkholeDomain(domain: string): Promise<string[]>;
    removeSinkholeDomain(domain: string): Promise<string[]>;
    getGatewayDnsLogs(limit?: number): Promise<any[]>;
    clearGatewayDnsLogs(): Promise<void>;

    // TLS / MITM Interceptor
    getCAInfo(): Promise<any>;
    getCACertPem(): Promise<string>;
    getL7Flows(query?: { limit?: number; search?: string; scheme?: string; method?: string; is_blocked?: boolean }): Promise<any>;
    clearL7Flows(): Promise<void>;
    generateLeafCert(domain: string): Promise<any>;

    // Bettercap Suite
    getBettercapStatus(): Promise<any>;
    getBettercapDnsRules(): Promise<any>;
    addBettercapDnsRule(domain: string, target_ip: string, action?: string, is_enabled?: boolean): Promise<any>;
    updateBettercapDnsRule(ruleId: string, updates: { domain?: string; target_ip?: string; action?: string; is_enabled?: boolean }): Promise<any>;
    deleteBettercapDnsRule(ruleId: string): Promise<any>;
    setBettercapDnsSpoofAll(enabled: boolean, address?: string): Promise<any>;
    loadBettercapDnsHosts(content: string, default_address?: string, action?: string): Promise<any>;
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

    // Gaming Mode Suite
    getGamingStatus(): Promise<any>;
    toggleGamingMode(enabled: boolean, mode?: string, targetPingMs?: number): Promise<any>;

    // Event Emitter methods
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
}
