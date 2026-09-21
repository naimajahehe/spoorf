import { EventEmitter } from 'events';
import crypto from 'crypto';
import os from 'os';
import { IDatabaseService, ILicenseManager } from '../interfaces';
import { LicenseTier, UserLicense, AuthUser, CachedLicense, AuthStatusResponse } from '../types';
import { env } from '../config/env';
import {
    AppError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    TooManyRequestsError,
    UpstreamServiceError
} from '../errors';
import { createChildLogger } from '../utils/logger';

/**
 * KEAMANAN (Anti-SSRF): apakah `candidate` cloudUrl aman menerima kredensial + Session ID.
 * Harus cocok origin (protokol + host + PORT) DAN path resmi — bukan hanya protokol+host,
 * agar port/path arbitrer pada host yang sama (mis. `:8443/mirror/upload`) tidak lolos.
 *
 * Mode lokal/dev: loopback host (localhost / 127.0.0.1 / [::1]) pada port 4000
 * dengan path resmi /v1 diizinkan untuk menghubungkan desktop dengan instance cloud lokal.
 */
export function isTrustedCloudUrl(candidate: string, official: string): boolean {
    try {
        const parsed = new URL(candidate);
        const officialParsed = new URL(official);
        const normPath = (p: string) => p.replace(/\/+$/, '') || '/';

        // 1. Cocok persis origin & path dengan official endpoint
        if (parsed.origin === officialParsed.origin && normPath(parsed.pathname) === normPath(officialParsed.pathname)) {
            return true;
        }

        // 2. Loopback local dev instance pada port 4000 (/v1)
        const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
        if (isLocalHost && (parsed.port === '4000' || parsed.port === '') && normPath(parsed.pathname) === '/v1') {
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

export const DEFAULT_FREE_LICENSE: UserLicense = {
    tier: 'free',
    max_cuts: 5,
    can_throttle: false,
    can_gateway: false,
    can_autoreblock: false,
    can_arsenal: false,
    can_deep_fingerprint: false,
    cloud_sync: false,
    expires_at: null,
    grace_period_until: null
};

export const PRO_TIER_LICENSE: UserLicense = {
    tier: 'pro',
    max_cuts: 999,
    can_throttle: true,
    can_gateway: true,
    can_autoreblock: true,
    can_arsenal: false,
    can_deep_fingerprint: true,
    cloud_sync: true,
    expires_at: null,
    grace_period_until: null
};

export const VIP_TIER_LICENSE: UserLicense = {
    tier: 'vip',
    max_cuts: 9999,
    can_throttle: true,
    can_gateway: true,
    can_autoreblock: true,
    can_arsenal: true,
    can_deep_fingerprint: true,
    cloud_sync: true,
    expires_at: null,
    grace_period_until: null
};

export const HEARTBEAT_INTERVAL_MS = 180_000; // 3 menit
export const HEARTBEAT_JITTER_MS = 15_000; // +/- 15 detik

export class FeatureLimitError extends ForbiddenError {
    constructor(message: string) {
        super(message, 'FEATURE_LIMIT_EXCEEDED');
        this.name = 'FeatureLimitError';
    }
}

export class FeatureLockedError extends ForbiddenError {
    constructor(message: string) {
        super(message, 'FEATURE_LOCKED_PRO');
        this.name = 'FeatureLockedError';
    }
}

export class LicenseManager extends EventEmitter implements ILicenseManager {
    private readonly log = createChildLogger('LicenseManager');
    private db: IDatabaseService;
    private currentLicense: UserLicense;
    private currentUser: AuthUser | null = null;
    private currentToken: string | null = null;
    private sessionId: string;
    private cloudEndpoint: string;
    private isInitialized = false;

    // Background Heartbeat Engine State
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private isHeartbeatInFlight = false;
    private heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
    private heartbeatJitterMs = HEARTBEAT_JITTER_MS;

    constructor(db: IDatabaseService, cloudEndpoint?: string) {
        super();
        this.db = db;
        this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        this.cloudEndpoint = cloudEndpoint || env.SPOORF_CLOUD_URL;
        this.sessionId = crypto.randomUUID();
    }

    /**
     * Kompatibilitas mundur: properti hwid mengembalikan sessionId (Zero-HWID Architecture).
     * Tidak lagi membaca komponen fisik CPU/RAM/Motherboard/Hostname.
     */
    public get hwid(): string {
        return this.sessionId;
    }

    public async init(): Promise<void> {
        if (this.isInitialized) return;
        try {
            const cached = await this.db.getLicenseCache();
            if (cached && cached.token) {
                // Periksa apakah masa tenggang (Grace Period) masih berlaku
                const isGraceValid = cached.grace_period_until
                    ? new Date(cached.grace_period_until).getTime() > Date.now()
                    : true;

                if (isGraceValid) {
                    this.currentToken = cached.token;
                    this.currentUser = {
                        id: cached.user_id || 'usr_cached',
                        email: cached.email || 'user@spoorf.app',
                        name: cached.name || (cached.email ? cached.email.split('@')[0] : 'Spoorfer'),
                        avatar_url: cached.avatar_url,
                        plan: cached.tier
                    };
                    this.currentLicense = {
                        tier: cached.tier,
                        max_cuts: cached.max_cuts,
                        can_throttle: cached.can_throttle,
                        can_gateway: cached.can_gateway,
                        can_autoreblock: cached.can_autoreblock,
                        can_arsenal: cached.can_arsenal,
                        can_deep_fingerprint: cached.can_deep_fingerprint ?? (cached.tier !== 'free'),
                        cloud_sync: cached.cloud_sync,
                        expires_at: cached.expires_at,
                        grace_period_until: cached.grace_period_until
                    };
                    if (cached.hwid || (cached as any).session_id) {
                        this.sessionId = (cached as any).session_id || cached.hwid;
                    }
                    this.log.info({ tier: cached.tier, email: this.currentUser?.email }, `Restored cached ${cached.tier.toUpperCase()} license for ${this.currentUser?.email}`);
                    if (this.currentToken) {
                        this.startHeartbeat();
                    }
                } else {
                    this.log.warn('Cached license grace period expired. Reverting to Free tier.');
                    this.currentLicense = { ...DEFAULT_FREE_LICENSE };
                    this.currentUser = null;
                    this.currentToken = null;
                }
            }
        } catch (err: any) {
            this.log.warn({ err }, `Notice loading license cache: ${err?.message || err}`);
            this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        }
        this.isInitialized = true;
    }

    public getLicense(): UserLicense {
        return { ...this.currentLicense };
    }

    public getUser(): AuthUser | null {
        return this.currentUser ? { ...this.currentUser } : null;
    }

    public getStatus(): AuthStatusResponse {
        const isOfflineGracePeriod = Boolean(
            this.currentLicense.grace_period_until &&
            new Date(this.currentLicense.grace_period_until).getTime() > Date.now()
        );

        return {
            isAuthenticated: this.currentUser !== null,
            user: this.currentUser,
            license: this.currentLicense,
            isOfflineGracePeriod,
            hwid: this.sessionId,
            sessionId: this.sessionId,
            session_id: this.sessionId,
            cloudEndpoint: this.cloudEndpoint
        };
    }

    private generateDemoLicense(credentials: { email: string; password?: string }): { user: AuthUser; license: UserLicense; token: string } {
        const isProEmail = credentials.email.toLowerCase().includes('pro') ||
                           credentials.email.toLowerCase().includes('admin') ||
                           (credentials.password && credentials.password.toLowerCase().includes('pro'));
        const isVipEmail = credentials.email.toLowerCase().includes('vip');

        const tier: LicenseTier = isVipEmail ? 'vip' : isProEmail ? 'pro' : 'free';
        const baseLicense = tier === 'vip' ? VIP_TIER_LICENSE : tier === 'pro' ? PRO_TIER_LICENSE : DEFAULT_FREE_LICENSE;

        const gracePeriod = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 hari
        const fakeToken = `spoorf_jwt_${Buffer.from(credentials.email).toString('base64')}_${Date.now()}`;

        return {
            user: {
                id: `usr_${crypto.createHash('md5').update(credentials.email).digest('hex').substring(0, 10)}`,
                email: credentials.email,
                name: credentials.email.split('@')[0],
                plan: tier,
                created_at: new Date().toISOString()
            },
            license: {
                ...baseLicense,
                grace_period_until: gracePeriod
            },
            token: fakeToken
        };
    }

    public async login(credentials: {
        email: string;
        password?: string;
        token?: string;
        cloudUrl?: string;
    }): Promise<AuthStatusResponse> {
        await this.init();
        // KEAMANAN (P0): Anti-SSRF & pencegahan eksfiltrasi kredensial / Session ID.
        // Kredensial dan Session ID HANYA boleh dikirim ke endpoint resmi terkonfigurasi.
        let targetUrl = this.cloudEndpoint;
        if (credentials.cloudUrl) {
            if (isTrustedCloudUrl(credentials.cloudUrl, this.cloudEndpoint)) {
                targetUrl = credentials.cloudUrl;
            } else {
                this.log.warn({ rejectedUrl: credentials.cloudUrl }, `[Security] Menolak cloudUrl tidak terpercaya: ${credentials.cloudUrl}`);
            }
        }

        let authResult: { user: AuthUser; license: UserLicense; token: string } | null = null;
        let res: Response | undefined;

        try {
            // 1. Coba hubungi Cloud Auth API resmi
            res = await fetch(`${targetUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: credentials.email,
                    password: credentials.password,
                    token: credentials.token,
                    session_id: this.sessionId,
                    hwid: this.sessionId,
                    platform: process.platform,
                    app_version: '2.21.0',
                    deviceName: os.hostname()
                }),
                signal: AbortSignal.timeout(env.SPOORF_CLOUD_AUTH_TIMEOUT_MS)
            });
        } catch (networkErr: any) {
            // 2. Kegagalan Jaringan / Offline / DNS resolution failure
            // Hanya aktif bila operator secara eksplisit menyetel SPOORF_ALLOW_DEMO_LICENSE=true (dev/uji).
            if (env.SPOORF_ALLOW_DEMO_LICENSE) {
                authResult = this.generateDemoLicense(credentials);
            } else {
                this.log.warn({ targetUrl, err: networkErr?.message }, 'Cloud authentication service unreachable');
                throw new UpstreamServiceError(
                    'Server cloud tidak dapat dihubungi. Periksa koneksi internet Anda atau pastikan server cloud aktif.',
                    503,
                    'CLOUD_UNAVAILABLE'
                );
            }
        }

        // 3. Jika request mencapai server cloud dan mendapat respons HTTP
        if (!authResult && res) {
            if (res.ok) {
                const data: any = await res.json();
                if (data && data.token) {
                    authResult = {
                        user: data.user,
                        license: data.license || DEFAULT_FREE_LICENSE,
                        token: data.token
                    };
                } else {
                    throw new UpstreamServiceError('Invalid payload from auth server', 502, 'INVALID_CLOUD_RESPONSE');
                }
            } else {
                if (env.SPOORF_ALLOW_DEMO_LICENSE) {
                    authResult = this.generateDemoLicense(credentials);
                } else {
                    let errorData: any;
                    try {
                        errorData = await res.json();
                    } catch {}
                    const errorMsg =
                        errorData?.error?.message ||
                        (typeof errorData?.error === 'string' ? errorData.error : undefined) ||
                        errorData?.message ||
                        `Auth server returned status ${res.status}`;

                    if (res.status === 401) {
                        throw new UnauthorizedError(errorMsg);
                    } else if (res.status === 400) {
                        throw new BadRequestError(errorMsg);
                    } else if (res.status === 403) {
                        throw new ForbiddenError(errorMsg);
                    } else if (res.status === 429) {
                        throw new TooManyRequestsError(errorMsg);
                    } else {
                        throw new UpstreamServiceError(errorMsg, res.status >= 500 ? 502 : res.status, 'CLOUD_SERVER_ERROR');
                    }
                }
            }
        }

        if (!authResult) {
            throw new UpstreamServiceError('Authentication could not be completed', 500, 'AUTH_FAILED');
        }

        // Simpan ke state aktif
        this.currentUser = authResult.user;
        this.currentLicense = authResult.license;
        this.currentToken = authResult.token;
        this.cloudEndpoint = targetUrl;

        // Persistensikan ke SQLite
        const cacheRecord: CachedLicense = {
            user_id: authResult.user.id,
            email: authResult.user.email,
            name: authResult.user.name,
            avatar_url: authResult.user.avatar_url,
            tier: authResult.license.tier,
            token: authResult.token,
            max_cuts: authResult.license.max_cuts,
            can_throttle: authResult.license.can_throttle,
            can_gateway: authResult.license.can_gateway,
            can_autoreblock: authResult.license.can_autoreblock,
            can_arsenal: authResult.license.can_arsenal,
            cloud_sync: authResult.license.cloud_sync,
            expires_at: authResult.license.expires_at,
            grace_period_until: authResult.license.grace_period_until,
            hwid: this.hwid
        };
        await this.db.saveLicenseCache(cacheRecord);

        if (this.currentToken) {
            this.startHeartbeat();
        }

        this.emit('licenseChanged', this.getStatus());
        return this.getStatus();
    }

    public async activateLicenseKey(key: string): Promise<AuthStatusResponse> {
        await this.init();
        const cleanKey = key.trim().toUpperCase();

        // KEAMANAN (P0): hanya prefix/token eksplisit yang menaikkan tier.
        // Aturan lama "panjang >= 10 char = Pro" memberi Pro ke hampir semua string
        // dan hanya diizinkan pada mode demo (SPOORF_ALLOW_DEMO_LICENSE=true).
        const demoMode = Boolean(env.SPOORF_ALLOW_DEMO_LICENSE);
        let newTier: LicenseTier;
        if (cleanKey.startsWith('FREE') || cleanKey.includes('FREE')) {
            newTier = 'free';
        } else if (cleanKey.startsWith('VIP') || cleanKey.includes('VIP')) {
            newTier = 'vip';
        } else if (cleanKey.startsWith('PRO') || cleanKey.includes('SENTINEL') || (demoMode && cleanKey.length >= 10)) {
            newTier = 'pro';
        } else {
            throw new BadRequestError('Format lisensi tidak valid. Contoh format: PRO-SENTINEL-2026');
        }

        const template = newTier === 'vip' 
            ? VIP_TIER_LICENSE 
            : newTier === 'pro' 
            ? PRO_TIER_LICENSE 
            : DEFAULT_FREE_LICENSE;
        const gracePeriod = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        if (!this.currentUser) {
            this.currentUser = {
                id: `usr_key_${Date.now()}`,
                email: 'activated@sentinel.lan',
                name: 'Licensed Operator',
                plan: newTier
            };
        } else {
            this.currentUser.plan = newTier;
        }

        this.currentLicense = {
            ...template,
            grace_period_until: gracePeriod
        };
        this.currentToken = `key_token_${cleanKey}_${Date.now()}`;

        await this.db.saveLicenseCache({
            user_id: this.currentUser.id,
            email: this.currentUser.email,
            name: this.currentUser.name,
            tier: newTier,
            token: this.currentToken,
            max_cuts: this.currentLicense.max_cuts,
            can_throttle: this.currentLicense.can_throttle,
            can_gateway: this.currentLicense.can_gateway,
            can_autoreblock: this.currentLicense.can_autoreblock,
            can_arsenal: this.currentLicense.can_arsenal,
            cloud_sync: this.currentLicense.cloud_sync,
            grace_period_until: gracePeriod,
            hwid: this.hwid
        });

        if (this.currentToken && this.currentLicense.tier !== 'free') {
            this.startHeartbeat();
        }

        this.emit('licenseChanged', this.getStatus());
        return this.getStatus();
    }

    public async logout(): Promise<void> {
        this.stopHeartbeat();
        await this.init();
        const prevTier = this.currentLicense.tier;
        this.currentUser = null;
        this.currentToken = null;
        this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        await this.db.clearLicenseCache();
        if (prevTier !== 'free') {
            this.emit('downgraded', { reason: 'User logged out', previousTier: prevTier, tier: 'free' });
        }
        this.emit('licenseChanged', this.getStatus());
    }

    public setHeartbeatInterval(intervalMs: number, jitterMs: number = 0): void {
        this.heartbeatIntervalMs = intervalMs;
        this.heartbeatJitterMs = jitterMs;
        if (this.heartbeatTimer) {
            this.startHeartbeat();
        }
    }

    public startHeartbeat(): void {
        if (!this.currentToken || this.currentLicense.tier === 'free') {
            return;
        }
        if (this.heartbeatTimer) {
            return;
        }
        this.scheduleNextHeartbeat();
    }

    public stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    public shutdown(): void {
        this.stopHeartbeat();
    }

    private scheduleNextHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        const jitter = this.heartbeatJitterMs > 0
            ? Math.floor(Math.random() * (2 * this.heartbeatJitterMs)) - this.heartbeatJitterMs
            : 0;
        const interval = Math.max(10, this.heartbeatIntervalMs + jitter);

        this.heartbeatTimer = setTimeout(async () => {
            try {
                await this.heartbeat();
            } catch (err: any) {
                this.log.error({ err: err?.message || err }, 'Unhandled error in heartbeat tick');
            }
        }, interval);

        this.heartbeatTimer.unref();
    }

    public async heartbeat(): Promise<void> {
        if (this.isHeartbeatInFlight) {
            return;
        }
        if (!this.currentToken) {
            this.stopHeartbeat();
            return;
        }

        this.isHeartbeatInFlight = true;
        let shouldReschedule = true;

        try {
            const targetUrl = this.cloudEndpoint;
            const res = await fetch(`${targetUrl}/auth/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentToken}`
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    sessionId: this.sessionId
                }),
                signal: AbortSignal.timeout(env.SPOORF_CLOUD_AUTH_TIMEOUT_MS)
            });

            // Race condition guard: jika user logout saat fetch sedang berlangsung, abaikan respons
            if (!this.currentToken) {
                return;
            }

            if (res.ok) {
                const data: any = await res.json();
                if (data && data.isRevoked === true) {
                    this.log.warn('Session marked revoked in 200 payload. Executing kick downgrade.');
                    shouldReschedule = false;
                    await this.handleSessionRevoked(data.message || data.revokedReason);
                    return;
                }
                if (data && (data.status === 'success' || data.success === true)) {
                    if (data.token) {
                        this.currentToken = data.token;
                    }
                    if (data.grace_period_until) {
                        this.currentLicense.grace_period_until = data.grace_period_until;
                    }
                    const cached = await this.db.getLicenseCache();
                    if (cached) {
                        await this.db.saveLicenseCache({
                            ...cached,
                            token: this.currentToken || cached.token,
                            grace_period_until: data.grace_period_until || cached.grace_period_until,
                            last_synced_at: new Date().toISOString()
                        });
                    }
                    this.log.debug({ grace_period_until: data.grace_period_until }, 'Heartbeat synchronized successfully');
                }
            } else {
                let errorData: any;
                try {
                    errorData = await res.json();
                } catch {}

                const errCode = errorData?.error?.code || errorData?.code;
                const errMsg = errorData?.error?.message || errorData?.message || `Auth heartbeat status ${res.status}`;

                if (res.status === 401 && (errCode === 'SESSION_REVOKED' || errorData?.error?.details?.isRevoked || errMsg.toLowerCase().includes('dicabut') || errMsg.toLowerCase().includes('revoked'))) {
                    this.log.warn({ errCode, errMsg }, 'Session revoked by cloud. Executing kick downgrade.');
                    shouldReschedule = false;
                    await this.handleSessionRevoked(errMsg);
                    return;
                } else if (res.status === 401) {
                    this.log.warn({ errMsg }, 'Session token invalid or expired. Reverting to Free tier.');
                    shouldReschedule = false;
                    await this.handleSessionExpired(errMsg);
                    return;
                } else {
                    this.log.warn({ status: res.status, errMsg }, 'Heartbeat received non-200 response from cloud');
                    const isGraceValid = Boolean(
                        this.currentLicense.grace_period_until &&
                        new Date(this.currentLicense.grace_period_until).getTime() > Date.now()
                    );
                    if (!isGraceValid) {
                        this.log.warn('Heartbeat server error and grace period has expired. Reverting to Free tier.');
                        shouldReschedule = false;
                        await this.handleSessionExpired('Masa tenggang offline (grace period) telah habis.');
                        return;
                    }
                }
            }
        } catch (networkErr: any) {
            // Network Error / Timeout / Cloud unreachable
            // OFFLINE RESILIENCE: Tetap gunakan lisensi yang ada jika masih dalam masa tenggang
            const isGraceValid = Boolean(
                this.currentLicense.grace_period_until &&
                new Date(this.currentLicense.grace_period_until).getTime() > Date.now()
            );

            if (isGraceValid) {
                this.log.debug({ err: networkErr?.message }, 'Cloud unreachable for heartbeat, continuing offline mode within grace period');
            } else {
                this.log.warn('Heartbeat failed and grace period has expired. Reverting to Free tier.');
                shouldReschedule = false;
                await this.handleSessionExpired('Masa tenggang offline (grace period) telah habis. Silakan hubungkan internet dan login kembali.');
            }
        } finally {
            this.isHeartbeatInFlight = false;
            if (shouldReschedule && this.currentToken && (this.currentLicense.tier as string) !== 'free') {
                this.scheduleNextHeartbeat();
            }
        }
    }

    public async handleSessionRevoked(reason?: string): Promise<void> {
        this.stopHeartbeat();
        const prevTier = this.currentLicense.tier;
        this.currentUser = null;
        this.currentToken = null;
        this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        try {
            await this.db.clearLicenseCache();
        } catch (err: any) {
            this.log.warn({ err: err?.message || err }, 'Failed to clear license cache on revocation');
        }

        const payload = {
            reason: reason || 'Sesi Anda telah dicabut karena login di perangkat lain.',
            revokedAt: new Date().toISOString(),
            previousTier: prevTier,
            tier: 'free'
        };

        this.emit('sessionRevoked', payload);
        this.emit('downgraded', payload);
        this.emit('licenseChanged', this.getStatus());
    }

    public async handleSessionExpired(reason?: string): Promise<void> {
        this.stopHeartbeat();
        const prevTier = this.currentLicense.tier;
        this.currentUser = null;
        this.currentToken = null;
        this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        try {
            await this.db.clearLicenseCache();
        } catch (err: any) {
            this.log.warn({ err: err?.message || err }, 'Failed to clear license cache on expiry');
        }

        const payload = {
            reason: reason || 'Sesi lisensi telah kedaluwarsa.',
            revokedAt: new Date().toISOString(),
            previousTier: prevTier,
            tier: 'free'
        };

        this.emit('licenseExpired', payload);
        this.emit('downgraded', payload);
        this.emit('licenseChanged', this.getStatus());
    }

    public checkCanBlock(activelyBlockedCount: number, isTargetAlreadyBlocked: boolean): { allowed: boolean; reason?: string } {
        if (isTargetAlreadyBlocked) {
            return { allowed: true };
        }
        if (this.currentLicense.tier === 'free' && activelyBlockedCount >= this.currentLicense.max_cuts) {
            return {
                allowed: false,
                reason: `Akun Free dibatasi maksimal ${this.currentLicense.max_cuts} target terblokir. Upgrade ke Pro untuk memutus tanpa batas!`
            };
        }
        return { allowed: true };
    }

    public checkCanThrottle(): { allowed: boolean; reason?: string } {
        if (!this.currentLicense.can_throttle) {
            return {
                allowed: false,
                reason: 'Fitur Pembatasan Kecepatan (PWM Bandwidth Throttling) terkunci khusus pengguna PRO.'
            };
        }
        return { allowed: true };
    }

    public checkCanGateway(): { allowed: boolean; reason?: string } {
        if (!this.currentLicense.can_gateway) {
            return {
                allowed: false,
                reason: 'Fitur Smart Transparent Gateway (DNS Sinkhole & Redirect) terkunci khusus pengguna PRO.'
            };
        }
        return { allowed: true };
    }

    public checkCanArsenal(): { allowed: boolean; reason?: string } {
        if (!this.currentLicense.can_arsenal) {
            return {
                allowed: false,
                reason: 'Fitur VIP Arsenal (Bettercap & SYN Scan) terkunci khusus pengguna PRO/VIP.'
            };
        }
        return { allowed: true };
    }
}

