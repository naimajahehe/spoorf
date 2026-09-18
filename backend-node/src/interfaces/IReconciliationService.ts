import { EventEmitter } from 'events';
import { Device, ProfileRefreshResult } from '../types';

export interface DhcpOptimizationResult {
    success: true;
    delivery: any;
    dhcpDelta: any;
    dhcpStats: any;
    devices: Device[];
    cached: boolean;
    cooldown_remaining_ms: number;
    duration_ms: number;
}

export interface IReconciliationService extends EventEmitter {
    handleDhcpEvent(data: any): Promise<void>;
    optimizeDhcpProfiling(): Promise<DhcpOptimizationResult>;
    getDhcpStats(): Promise<any>;
    profileRefresh(): Promise<ProfileRefreshResult>;
    runProfileRefresh(targetMacs: Set<string> | null, scope: 'all' | 'subset'): Promise<ProfileRefreshResult>;
    quickReauthProfiling(): Promise<ProfileRefreshResult>;
    scheduleProfileEnrichment(mac: string, delayMs?: number): void;
    armOfflineCooldown(mac: string, hostnameOrIp?: string): void;
    clearOfflineCooldown(mac: string): boolean;
    hasOfflineCooldown(mac: string): boolean;
    shutdown?(): void;
}
