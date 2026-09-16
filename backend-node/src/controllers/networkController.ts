import { Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';

export class NetworkController {
    constructor(private readonly deviceManager: DeviceManager) {}

    getTelemetry = async (_req: Request, res: Response): Promise<void> => {
        const telemetry = await this.deviceManager.getTelemetry();
        res.json({ success: true, telemetry });
    };

    getWifi = async (_req: Request, res: Response): Promise<void> => {
        const wifi = await this.deviceManager.getWifiInfo();
        res.json({ success: true, wifi });
    };

    optimizeDhcp = async (_req: Request, res: Response): Promise<void> => {
        const result = await this.deviceManager.optimizeDhcpProfiling();
        res.json({
            success: true,
            message: 'Teknik 3B DHCP Wakeup and Network Re-Scan completed successfully',
            data: result
        });
    };

    profileRefresh = async (_req: Request, res: Response): Promise<void> => {
        const result = await this.deviceManager.profileRefresh();
        res.json({ success: true, data: result });
    };

    quickReauth = async (_req: Request, res: Response): Promise<void> => {
        const result = await this.deviceManager.profileRefresh();
        res.json({
            success: true,
            deprecated: true,
            message: 'Quick Re-Auth is deprecated; safe Profile Refresh completed',
            data: result
        });
    };

    getDhcpStats = async (_req: Request, res: Response): Promise<void> => {
        const stats = await this.deviceManager.getDhcpStats();
        res.json({ success: true, data: stats });
    };

    getApIsolationStatus = async (_req: Request, res: Response): Promise<void> => {
        const status = await this.deviceManager.getApIsolationStatus();
        res.json({ success: true, data: status });
    };
}
