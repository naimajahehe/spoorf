import { Request, Response } from 'express';
import { IDeviceManager, IPythonBridge } from '../interfaces';

export class ShieldController {
    constructor(private readonly service: IDeviceManager | IPythonBridge) {}

    getStatus = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.service.getShieldStatus();
        res.json({ success: true, data });
    };

    toggle = async (req: Request, res: Response): Promise<void> => {
        const { enabled, mode, autoRetaliate, lanTargets } = req.body;
        const data = await this.service.toggleShield(
            Boolean(enabled),
            mode || 'host_lock',
            Boolean(autoRetaliate),
            lanTargets || []
        );
        res.json({ success: true, data });
    };

    setMode = async (req: Request, res: Response): Promise<void> => {
        const { mode, autoRetaliate } = req.body;
        const data = await this.service.setShieldMode(mode || 'host_lock', Boolean(autoRetaliate));
        res.json({ success: true, data });
    };

    getThreats = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.service.getShieldThreats();
        res.json({ success: true, data });
    };

    clearThreats = async (_req: Request, res: Response): Promise<void> => {
        const success = await this.service.clearShieldThreats();
        res.json({ success, message: 'Threats log cleared' });
    };
}
