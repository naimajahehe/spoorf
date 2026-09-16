import { Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';

export class ShieldController {
    constructor(private readonly deviceManager: DeviceManager) {}

    getStatus = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.deviceManager.getShieldStatus();
        res.json({ success: true, data });
    };

    toggle = async (req: Request, res: Response): Promise<void> => {
        const { enabled, mode, autoRetaliate, lanTargets } = req.body;
        const data = await this.deviceManager.toggleShield(
            Boolean(enabled),
            mode || 'host_lock',
            Boolean(autoRetaliate),
            lanTargets || []
        );
        res.json({ success: true, data });
    };

    setMode = async (req: Request, res: Response): Promise<void> => {
        const { mode, autoRetaliate } = req.body;
        const data = await this.deviceManager.setShieldMode(mode || 'host_lock', Boolean(autoRetaliate));
        res.json({ success: true, data });
    };

    getThreats = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.deviceManager.getShieldThreats();
        res.json({ success: true, data });
    };

    clearThreats = async (_req: Request, res: Response): Promise<void> => {
        const success = await this.deviceManager.clearShieldThreats();
        res.json({ success, message: 'Threats log cleared' });
    };
}
