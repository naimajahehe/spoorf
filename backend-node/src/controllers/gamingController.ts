import { Request, Response } from 'express';
import { IGamingService, IDeviceManager } from '../interfaces';

export class GamingController {
    constructor(private readonly gamingService: IGamingService | IDeviceManager) {}

    getStatus = async (_req: Request, res: Response): Promise<void> => {
        const status = await this.gamingService.getGamingStatus();
        res.json({ success: true, data: status });
    };

    toggle = async (req: Request, res: Response): Promise<void> => {
        const { enabled, mode, target_ping_ms } = req.body;
        const status = await this.gamingService.toggleGamingMode(Boolean(enabled), mode, target_ping_ms);
        res.json({ success: true, data: status });
    };
}
