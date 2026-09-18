import { Request, Response } from 'express';
import { IDeviceManager, IPythonBridge, ILicenseManager } from '../interfaces';
import { FeatureLockedError } from '../services/licenseManager';

export class InterceptorController {
    constructor(
        private readonly service: IDeviceManager | IPythonBridge,
        private readonly licenseManager?: ILicenseManager
    ) {}

    /**
     * N-LIC: the L7 Interceptor's sensitive operations (reading victim browsing
     * flows, minting a leaf certificate) are part of the VIP Arsenal and must be
     * gated exactly like the Bettercap suite. Public CA artifacts (getCaInfo /
     * downloadCaCert) stay open because the .crt is meant to be installed.
     */
    private assertCanArsenal(): void {
        const lic = this.licenseManager || (this.service as any)?.license;
        if (lic && typeof lic.checkCanArsenal === 'function') {
            const check = lic.checkCanArsenal();
            if (!check.allowed) {
                throw new FeatureLockedError(check.reason || 'Fitur VIP Arsenal (L7 Interceptor) khusus untuk pengguna PRO/VIP.');
            }
        }
    }

    getCaInfo = async (_req: Request, res: Response): Promise<void> => {
        const caInfo = await this.service.getCAInfo();
        res.json({ success: true, data: caInfo });
    };

    downloadCaCert = async (_req: Request, res: Response): Promise<void> => {
        const certPem = await this.service.getCACertPem();
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.setHeader('Content-Disposition', 'attachment; filename="spoorf-ca.crt"');
        res.send(certPem);
    };

    getFlows = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { limit = 100, search, scheme, method, is_blocked } = req.query as any;
        const result = await this.service.getL7Flows({ limit, search, scheme, method, is_blocked });
        res.json(result);
    };

    clearFlows = async (_req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        await this.service.clearL7Flows();
        res.json({ success: true, message: 'L7 Flows cleared' });
    };

    generateLeafCert = async (req: Request, res: Response): Promise<void> => {
        this.assertCanArsenal();
        const { domain } = req.body;
        const result = await this.service.generateLeafCert(domain);
        res.json(result);
    };
}
