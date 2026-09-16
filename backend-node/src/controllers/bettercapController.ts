import { Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { LicenseManager, FeatureLockedError } from '../services/licenseManager';

export class BettercapController {
    constructor(
        private readonly deviceManager: DeviceManager,
        private readonly licenseManager?: LicenseManager
    ) {}

    private assertCanArsenal(): void {
        const lic = this.licenseManager || (this.deviceManager as any)?.license;
        if (lic && typeof lic.checkCanArsenal === 'function') {
            const check = lic.checkCanArsenal();
            if (!check.allowed) {
                throw new FeatureLockedError(check.reason || 'Fitur VIP Arsenal (Bettercap & SYN Scan) khusus untuk pengguna PRO/VIP.');
            }
        }
    }

    getStatus = async (_req: Request, res: Response): Promise<void> => {
        const status = await this.deviceManager.getBettercapStatus();
        res.json(status);
    };

    getDnsRules = async (_req: Request, res: Response): Promise<void> => {
        const config = await this.deviceManager.getBettercapDnsRules();
        res.json(config);
    };

    addDnsRule = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { domain, target_ip, action, is_enabled } = req.body;
        const result = await this.deviceManager.addBettercapDnsRule(domain, target_ip || '192.168.1.1', action || 'spoof', is_enabled !== false);
        res.json(result);
    };

    updateDnsRule = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { id } = req.params;
        const { domain, target_ip, action, is_enabled } = req.body;
        const result = await this.deviceManager.updateBettercapDnsRule(id, { domain, target_ip, action, is_enabled });
        res.json(result);
    };

    deleteDnsRule = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { id } = req.params;
        const result = await this.deviceManager.deleteBettercapDnsRule(id);
        res.json(result);
    };

    setDnsSpoofAll = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { enabled, address } = req.body;
        const result = await this.deviceManager.setBettercapDnsSpoofAll(enabled === true, address || '');
        res.json(result);
    };

    loadDnsHosts = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { content, default_address, action } = req.body;
        const result = await this.deviceManager.loadBettercapDnsHosts(content, default_address || '', action || 'spoof');
        res.json(result);
    };

    setDnsTtl = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { ttl } = req.body;
        const result = await this.deviceManager.setBettercapDnsTtl(ttl);
        res.json(result);
    };

    getCredentials = async (req: Request, res: Response): Promise<void> => {
        const limit = Number(req.query.limit) || 100;
        const credentials = await this.deviceManager.getBettercapCredentials(limit);
        res.json({ success: true, credentials });
    };

    clearCredentials = async (_req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        await this.deviceManager.clearBettercapCredentials();
        res.json({ success: true, message: 'Credentials cleared' });
    };

    runSynScan = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { target_ip, ports, profile } = req.body;
        const data = await this.deviceManager.runBettercapSynScan(target_ip, ports, profile || 'top-20');
        res.json({ success: true, data });
    };
}
