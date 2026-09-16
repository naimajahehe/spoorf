import { Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { parsePositiveInt } from '../middlewares/errorHandler';

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
        const limit = parsePositiveInt(req.query.limit, 100);
        const search = req.query.search as string;
        const scheme = req.query.scheme as string;
        const method = req.query.method as string;
        const is_blocked = req.query.is_blocked !== undefined ? req.query.is_blocked === 'true' : undefined;

        const result = await this.deviceManager.getL7Flows({ limit, search, scheme, method, is_blocked });
        res.json(result);
    };

    clearFlows = async (_req: Request, res: Response): Promise<void> => {
        await this.deviceManager.clearL7Flows();
        res.json({ success: true, message: 'L7 Flows cleared' });
    };

    generateLeafCert = async (req: Request, res: Response): Promise<void> => {
        const { domain } = req.body;
        if (!domain) {
            res.status(400).json({ success: false, error: 'Domain parameter is required' });
            return;
        }
        const result = await this.deviceManager.generateLeafCert(domain);
        res.json(result);
    };
}
