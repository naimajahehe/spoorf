import { Request, Response } from 'express';
import { IDeviceManager } from '../interfaces';

export class GatewayController {
    constructor(private readonly deviceManager: IDeviceManager) {}

    getStatus = async (_req: Request, res: Response): Promise<void> => {
        const status = await this.deviceManager.getTransparentGatewayStatus();
        res.json({ success: true, data: status });
    };

    startGateway = async (req: Request, res: Response): Promise<void> => {
        const { ip, gatewayIp } = req.body;
        const data = await this.deviceManager.startTransparentGateway(ip, gatewayIp);
        res.json({ success: true, data, message: `Transparent gateway started for ${ip}` });
    };

    stopGateway = async (req: Request, res: Response): Promise<void> => {
        const { ip } = req.body;
        await this.deviceManager.stopTransparentGateway(ip);
        res.json({ success: true, message: `Transparent gateway stopped for ${ip}` });
    };

    getSinkholeDomains = async (_req: Request, res: Response): Promise<void> => {
        const domains = await this.deviceManager.getSinkholeDomains();
        res.json({ success: true, domains });
    };

    addSinkholeDomain = async (req: Request, res: Response): Promise<void> => {
        const { domain } = req.body;
        const domains = await this.deviceManager.addSinkholeDomain(domain);
        res.json({ success: true, domain, domains });
    };

    removeSinkholeDomain = async (req: Request, res: Response): Promise<void> => {
        const { domain } = req.params;
        const domains = await this.deviceManager.removeSinkholeDomain(domain);
        res.json({ success: true, domain, domains });
    };

    getDnsLogs = async (req: Request, res: Response): Promise<void> => {
        const limit = Number(req.query.limit) || 100;
        const logs = await this.deviceManager.getGatewayDnsLogs(limit);
        res.json({ success: true, logs });
    };

    clearDnsLogs = async (_req: Request, res: Response): Promise<void> => {
        await this.deviceManager.clearGatewayDnsLogs();
        res.json({ success: true, message: 'Gateway DNS logs cleared' });
    };
}
