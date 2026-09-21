import { Device } from '../types';

export interface ITrafficService {
    blockDevice(ip: string, gatewayIp?: string): Promise<Device>;
    unblockDevice(identifier: string): Promise<Device>;
    setSpeedLimit(ip: string, limit: number, gatewayIp?: string): Promise<Device>;
    redirectDevice(ip: string, redirectUrl: string, instagramUsername?: string, gatewayIp?: string): Promise<Device>;
    stopRedirectDevice(ip: string): Promise<Device>;
    reconcileActiveEnforcementsToFree?(): Promise<{
        unblocked: string[];
        throttlesReset: string[];
        redirectsReset: string[];
    }>;
}


