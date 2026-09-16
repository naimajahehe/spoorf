import { Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { parsePositiveInt } from '../middlewares/errorHandler';

export class GatewayController {
    constructor(private readonly deviceManager: DeviceManager) {}

    getStatus = async (_req: Request, res: Response): Promise<void> => {
        const status = await this.deviceManager.getTransparentGatewayStatus();
        res.json({ success: true, data: status });
    };

    startGateway = async (req: Request, res: Response): Promise<void> => {
        const { ip, gatewayIp } = req.body;
        if (!ip || typeof ip !== 'string') {
            res.status(400).json({ success: false, error: 'Valid IP string is required' });
            return;
        }
        const data = await this.deviceManager.startTransparentGateway(ip, gatewayIp);
        res.json({ success: true, data, message: `Transparent gateway started for ${ip}` });
    };

    stopGateway = async (req: Request, res: Response): Promise<void> => {
        const { ip } = req.body;
        if (!ip || typeof ip !== 'string') {
            res.status(400).json({ success: false, error: 'Valid IP string is required' });
            return;
        }
        await this.deviceManager.stopTransparentGateway(ip);
        res.json({ success: true, message: `Transparent gateway stopped for ${ip}` });
    };

    getSinkholeDomains = async (_req: Request, res: Response): Promise<void> => {
        const domains = await this.deviceManager.getSinkholeDomains();
        res.json({ success: true, domains });
    };

    addSinkholeDomain = async (req: Request, res: Response): Promise<void> => {
        const { domain } = req.body;
        if (!domain || typeof domain !== 'string') {
            res.status(400).json({ success: false, error: 'Valid domain string is required' });
            return;
        }
        const domains = await this.deviceManager.addSinkholeDomain(domain);
        res.json({ success: true, domain, domains });
    };

    removeSinkholeDomain = async (req: Request, res: Response): Promise<void> => {
        const { domain } = req.params;
        const domains = await this.deviceManager.removeSinkholeDomain(domain);
        res.json({ success: true, domain, domains });
    };

    getDnsLogs = async (req: Request, res: Response): Promise<void> => {
        const limit = parsePositiveInt(req.query.limit, 100);
        const logs = await this.deviceManager.getGatewayDnsLogs(limit);
        res.json({ success: true, logs });
    };

    clearDnsLogs = async (_req: Request, res: Response): Promise<void> => {
        await this.deviceManager.clearGatewayDnsLogs();
        res.json({ success: true, message: 'Gateway DNS logs cleared' });
    };
}
