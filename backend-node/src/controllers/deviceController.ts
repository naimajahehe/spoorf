import { Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { InvariantViolationError } from '../errors';

export class DeviceController {
    constructor(private readonly deviceManager: DeviceManager) {}

    scanNetwork = async (_req: Request, res: Response): Promise<void> => {
        const devices = await this.deviceManager.scanNetwork();
        res.json({
            success: true,
            devices,
            count: devices.length
        });
    };

    getDevices = (_req: Request, res: Response): void => {
        const devices = this.deviceManager.scopeForDisplay(this.deviceManager.getDevices());
        res.json({
            success: true,
            devices,
            count: devices.length
        });
    };

    clearAllDevices = async (_req: Request, res: Response): Promise<void> => {
        await this.deviceManager.clearAllDevices();
        res.json({
            success: true,
            message: 'Semua data perangkat dan profil berhasil dibersihkan'
        });
    };

    blockDevice = async (req: Request, res: Response): Promise<void> => {
        const { ip } = req.params;
        const { gatewayIp } = req.body;
        const device = await this.deviceManager.blockDevice(ip, gatewayIp);
        res.json({
            success: true,
            device,
            message: `Device ${ip} blocked`
        });
    };

    unblockDevice = async (req: Request, res: Response): Promise<void> => {
        const { ip } = req.params;
        const device = await this.deviceManager.unblockDevice(ip);
        res.json({
            success: true,
            device,
            message: `Device ${ip} unblocked`
        });
    };

    redirectDevice = async (req: Request, res: Response): Promise<void> => {
        const { ip } = req.params;
        const { redirectUrl, instagramUsername, gatewayIp } = req.body;
        const device = await this.deviceManager.redirectDevice(ip, redirectUrl, instagramUsername, gatewayIp);
        res.json({
            success: true,
            device,
            message: `Device ${ip} redirected to ${redirectUrl}`
        });
    };

    stopRedirectDevice = async (req: Request, res: Response): Promise<void> => {
        const { ip } = req.params;
        const device = await this.deviceManager.stopRedirectDevice(ip);
        res.json({
            success: true,
            device,
            message: `Redirect for ${ip} stopped`
        });
    };

    deleteDevice = async (req: Request, res: Response): Promise<void> => {
        const { mac } = req.params;
        const target = this.deviceManager.getDeviceByMac(mac);
        if (target?.is_gateway) {
            throw new InvariantViolationError('Cannot delete gateway router (Invariant 1: Gateway Immunity)');
        }
        if (target?.is_self) {
            throw new InvariantViolationError('Cannot delete controller host (Invariant 2: Controller Self-Protection)');
        }
        await this.deviceManager.deleteDevice(mac);
        res.json({
            success: true,
            message: `Device with MAC ${mac} deleted from database`
        });
    };

    setDeviceAlias = async (req: Request, res: Response): Promise<void> => {
        const { mac } = req.params;
        const { alias } = req.body;
        const cleanAlias = alias.trim();
        const updated = await this.deviceManager.setDeviceAlias(mac, cleanAlias);
        res.json({
            success: true,
            device: updated,
            message: cleanAlias ? `Alias for ${mac} updated to "${cleanAlias}"` : `Alias for ${mac} cleared`
        });
    };

    setSpeedLimit = async (req: Request, res: Response): Promise<void> => {
        const { ip } = req.params;
        const { limit } = req.body;
        const updated = await this.deviceManager.setSpeedLimit(ip, limit);
        res.json({
            success: true,
            device: updated,
            message: `Speed limit for ${ip} set to ${limit}%`
        });
    };

    scanDevicePorts = async (req: Request, res: Response): Promise<void> => {
        const { ip } = req.params;
        const { ports } = req.body;
        const updated = await this.deviceManager.deepScanDevicePorts(ip, Array.isArray(ports) ? ports : undefined);
        res.json({
            success: true,
            device: updated,
            message: `Ports deep scanned for ${ip}`
        });
    };
}
