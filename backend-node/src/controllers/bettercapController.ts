import { Request, Response } from 'express';
import { IDeviceManager, IPythonBridge, ILicenseManager } from '../interfaces';
import { FeatureLockedError } from '../services/licenseManager';
import { parsePositiveInt } from '../middlewares/errorHandler';

export class BettercapController {
    constructor(
        private readonly service: IDeviceManager | IPythonBridge,
        private readonly licenseManager?: ILicenseManager
    ) {}

    private assertCanArsenal(): void {
        const lic = this.licenseManager || (this.service as any)?.license;
        if (lic && typeof lic.checkCanArsenal === 'function') {
            const check = lic.checkCanArsenal();
            if (!check.allowed) {
                throw new FeatureLockedError(check.reason || 'Fitur VIP Arsenal (Bettercap & SYN Scan) khusus untuk pengguna PRO/VIP.');
            }
        }
    }

    getStatus = async (_req: Request, res: Response): Promise<void> => {
        const status = await (this.service as any).getBettercapStatus();
        res.json(status);
    };

    getDnsRules = async (_req: Request, res: Response): Promise<void> => {
        const config = await (this.service as any).getBettercapDnsRules();
        res.json(config);
    };

    addDnsRule = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { domain, target_ip, action, is_enabled } = req.body;
        const result = await (this.service as any).addBettercapDnsRule(domain, target_ip || '192.168.1.1', action || 'spoof', is_enabled !== false);
        res.json(result);
    };

    updateDnsRule = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { id } = req.params;
        const { domain, target_ip, action, is_enabled } = req.body;
        const result = await (this.service as any).updateBettercapDnsRule(id, { domain, target_ip, action, is_enabled });
        res.json(result);
    };

    deleteDnsRule = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { id } = req.params;
        const result = await (this.service as any).deleteBettercapDnsRule(id);
        res.json(result);
    };

    setDnsSpoofAll = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { enabled, address } = req.body;
        const result = await (this.service as any).setBettercapDnsSpoofAll(enabled === true, address || '');
        res.json(result);
    };

    loadDnsHosts = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { content, default_address, action } = req.body;
        const result = await (this.service as any).loadBettercapDnsHosts(content, default_address || '', action || 'spoof');
        res.json(result);
    };

    setDnsTtl = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { ttl } = req.body;
        const result = await (this.service as any).setBettercapDnsTtl(ttl);
        res.json(result);
    };

    getCredentials = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const limit = parsePositiveInt(req.query.limit, 100);
        const credentials = await (this.service as any).getBettercapCredentials(limit);
        res.json({ success: true, credentials });
    };

    clearCredentials = async (_req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        await (this.service as any).clearBettercapCredentials();
        res.json({ success: true, message: 'Credentials cleared' });
    };

    runSynScan = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { target_ip, ports, profile } = req.body;
        const data = await (this.service as any).runBettercapSynScan(target_ip, ports, profile || 'top-20');
        res.json({ success: true, data });
    };
}
