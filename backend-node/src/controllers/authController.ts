import { Request, Response } from 'express';
import { ILicenseManager } from '../interfaces';
import { AppError, BadRequestError } from '../errors';

export class AuthController {
    constructor(private readonly licenseManager?: ILicenseManager) {}

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
        const { email, password, token, cloudUrl } = req.body;
        if (!this.licenseManager) {
            res.json({ success: true, user: { email, plan: 'free' }, license: { tier: 'free' } });
            return;
        }

        try {
            const status = await this.licenseManager.login({ email, password, token, cloudUrl });
            res.json({ success: true, ...status });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError(err?.message || 'Login failed');
        }
    };

    activate = async (req: Request, res: Response): Promise<void> => {
        const { key } = req.body;
        if (!this.licenseManager) {
            throw new BadRequestError('License manager not available');
        }

        try {
            const status = await this.licenseManager.activateLicenseKey(key);
            res.json({ success: true, ...status });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError(err?.message || 'Activation failed');
        }
    };

    logout = async (_req: Request, res: Response): Promise<void> => {
        if (this.licenseManager) {
            await this.licenseManager.logout();
        }
        res.json({ success: true, message: 'Logged out successfully' });
    };
}
