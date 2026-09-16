import { Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';

export class InterceptorController {
    constructor(private readonly deviceManager: DeviceManager) {}

    getCaInfo = async (_req: Request, res: Response): Promise<void> => {
        const caInfo = await this.deviceManager.getCAInfo();
        res.json({ success: true, data: caInfo });
    };

    downloadCaCert = async (_req: Request, res: Response): Promise<void> => {
        const certPem = await this.deviceManager.getCACertPem();
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.setHeader('Content-Disposition', 'attachment; filename="spoorf-ca.crt"');
        res.send(certPem);
    };

    getFlows = async (req: Request, res: Response): Promise<void> => {
        const { limit = 100, search, scheme, method, is_blocked } = req.query as any;
        const result = await this.deviceManager.getL7Flows({ limit, search, scheme, method, is_blocked });
        res.json(result);
    };

    clearFlows = async (_req: Request, res: Response): Promise<void> => {
        await this.deviceManager.clearL7Flows();
        res.json({ success: true, message: 'L7 Flows cleared' });
    };

    generateLeafCert = async (req: Request, res: Response): Promise<void> => {
        const { domain } = req.body;
        const result = await this.deviceManager.generateLeafCert(domain);
        res.json(result);
    };
}
