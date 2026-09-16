import type { AuthStatusResponse } from '../types';

export interface ILicenseManager {
    init(): Promise<void>;
    login(credentials: { email?: string; password?: string; token?: string; cloudUrl?: string }): Promise<AuthStatusResponse>;
    activateLicenseKey(key: string): Promise<AuthStatusResponse>;
    logout(): Promise<void>;
    getStatus(): AuthStatusResponse;
    checkCanBlock(activelyBlockedCount: number, isTargetAlreadyBlocked?: boolean): { allowed: boolean; reason?: string };
    checkCanThrottle(): { allowed: boolean; reason?: string };
    checkCanGateway(): { allowed: boolean; reason?: string };
    checkCanArsenal(): { allowed: boolean; reason?: string };
}
