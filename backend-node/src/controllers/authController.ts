import { Request, Response } from 'express';
import { LicenseManager } from '../services/licenseManager';

export class AuthController {
    constructor(private readonly licenseManager?: LicenseManager) {}

    getStatus = (_req: Request, res: Response): void => {
        if (!this.licenseManager) {
            res.json({
                success: true,
                isAuthenticated: false,
                user: null,
                license: {
                    tier: 'free',
                    max_cuts: 1,
                    can_throttle: false,
                    can_gateway: false,
                    can_autoreblock: false,
                    can_arsenal: false,
                    cloud_sync: false
                },
                isOfflineGracePeriod: false,
                hwid: 'SESSION-STANDALONE',
                sessionId: 'SESSION-STANDALONE',
                session_id: 'SESSION-STANDALONE',
                cloudEndpoint: 'https://api.spoorf.app/v1'
            });
            return;
        }
        res.json({ success: true, ...this.licenseManager.getStatus() });
    };

    getMe = (_req: Request, res: Response): void => {
        if (!this.licenseManager) {
            res.json({ success: true, user: null, license: { tier: 'free', max_cuts: 1 } });
            return;
        }
        res.json({ success: true, ...this.licenseManager.getStatus() });
    };

    login = async (req: Request, res: Response): Promise<void> => {
        try {
            const { email, password, token, cloudUrl } = req.body;
            if (!email && !token) {
                res.status(400).json({ success: false, error: 'Email atau token lisensi diperlukan' });
                return;
            }

            if (!this.licenseManager) {
                res.json({ success: true, user: { email, plan: 'free' }, license: { tier: 'free' } });
                return;
            }

            const status = await this.licenseManager.login({ email, password, token, cloudUrl });
            res.json({ success: true, ...status });
        } catch (err: any) {
            res.status(400).json({ success: false, error: err.message });
        }
    };

    activate = async (req: Request, res: Response): Promise<void> => {
        try {
            const { key } = req.body;
            if (!key) {
                res.status(400).json({ success: false, error: 'Kode lisensi diperlukan' });
                return;
            }

            if (!this.licenseManager) {
                res.status(400).json({ success: false, error: 'License manager not available' });
                return;
            }

            const status = await this.licenseManager.activateLicenseKey(key);
            res.json({ success: true, ...status });
        } catch (err: any) {
            res.status(400).json({ success: false, error: err.message });
        }
    };

    logout = async (_req: Request, res: Response): Promise<void> => {
        if (this.licenseManager) {
            await this.licenseManager.logout();
        }
        res.json({ success: true, message: 'Logged out successfully' });
    };
}
