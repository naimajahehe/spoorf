import { EventEmitter } from 'events';
import { Device } from '../types';

export interface DeviceScanOptions {
    skipMulticastWakeup?: boolean;
    requireFresh?: boolean;
}

export interface IDiscoveryService extends EventEmitter {
    scanNetwork(options?: DeviceScanOptions): Promise<Device[]>;
    setAutoScanEnabled(enabled: boolean): void;
    isAutoScanEnabled(): boolean;
    isScanning(): boolean;
    debouncedScan(delayMs?: number): void;
    handleLivenessEvent(data: any): Promise<void>;
    startWatchdog(): void;
    stopWatchdog(): void;
}
