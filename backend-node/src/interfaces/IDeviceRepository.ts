import { Device } from '../types';

export interface IDeviceRepository {
    getAll(includeArchived?: boolean, networkId?: string): Promise<Device[]>;
    getByMac(mac: string, networkId?: string): Promise<Device | null>;
    getByIp(ip: string, networkId?: string): Promise<Device | null>;
    save(device: Device, networkId?: string): Promise<void>;
    updateIp(mac: string, ip: string, networkId?: string): Promise<void>;
    setOnlineStatus(mac: string, isOnline: boolean, networkId?: string): Promise<void>;
    setBlocked(mac: string, isBlocked: boolean, sessionId?: string, networkId?: string): Promise<void>;
    setSpeedLimit(mac: string, speedLimit: number, networkId?: string): Promise<Device>;
    setAlias(mac: string, alias: string, networkId?: string): Promise<Device>;
    delete(mac: string, networkId?: string): Promise<void>;
    clearAll(networkId?: string): Promise<void>;
    rowToDevice(row: any): Device;
}
