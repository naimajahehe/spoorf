import { Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';

export class GamingController {
    constructor(private readonly deviceManager: DeviceManager) {}

    getStatus = async (_req: Request, res: Response): Promise<void> => {
        const status = await this.deviceManager.getGamingStatus();
        res.json({ success: true, data: status });
    };

    toggle = async (req: Request, res: Response): Promise<void> => {
        const { enabled, mode, target_ping_ms } = req.body;
        const status = await this.deviceManager.toggleGamingMode(Boolean(enabled), mode, target_ping_ms);
        res.json({ success: true, data: status });
    };
}
