import type { AuthStatusResponse, UserLicense, AuthUser } from '../types';

export interface ILicenseManager {
    init(): Promise<void>;
    getLicense(): UserLicense;
    getUser(): AuthUser | null;
    login(credentials: { email?: string; password?: string; token?: string; cloudUrl?: string }): Promise<AuthStatusResponse>;
    activateLicenseKey(key: string): Promise<AuthStatusResponse>;
    logout(): Promise<void>;
    getStatus(): AuthStatusResponse;
    checkCanBlock(activelyBlockedCount: number, isTargetAlreadyBlocked?: boolean): { allowed: boolean; reason?: string };
    checkCanThrottle(): { allowed: boolean; reason?: string };
    checkCanGateway(): { allowed: boolean; reason?: string };
    checkCanArsenal(): { allowed: boolean; reason?: string };
    checkCanAutoreblock?(): { allowed: boolean; reason?: string };
    checkCanDeepFingerprint?(): { allowed: boolean; reason?: string };
    heartbeat?(): Promise<void>;
    startHeartbeat?(): void;
    stopHeartbeat?(): void;
    shutdown?(): void;
    on?(event: string | symbol, listener: (...args: any[]) => void): this;
    off?(event: string | symbol, listener: (...args: any[]) => void): this;
    emit?(event: string | symbol, ...args: any[]): boolean;
}
