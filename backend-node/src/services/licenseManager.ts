import { EventEmitter } from 'events';
import crypto from 'crypto';
import os from 'os';
import { DatabaseService } from './database';
import { LicenseTier, UserLicense, AuthUser, CachedLicense, AuthStatusResponse } from '../types';

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

export class FeatureLimitError extends Error {
    public code = 'FEATURE_LIMIT_EXCEEDED';
    constructor(message: string) {
        super(message);
        this.name = 'FeatureLimitError';
    }
}

export class FeatureLockedError extends Error {
    public code = 'FEATURE_LOCKED_PRO';
    constructor(message: string) {
        super(message);
        this.name = 'FeatureLockedError';
    }
}

export class LicenseManager extends EventEmitter {
    private db: DatabaseService;
    private currentLicense: UserLicense;
    private currentUser: AuthUser | null = null;
    private currentToken: string | null = null;
    private hwid: string;
    private cloudEndpoint: string;
    private isInitialized = false;

    constructor(db: DatabaseService, cloudEndpoint?: string) {
        super();
        this.db = db;
        this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        this.cloudEndpoint = cloudEndpoint || process.env.SPOORF_CLOUD_URL || 'https://api.spoorf.app/v1';
        this.hwid = this.generateHardwareFingerprint();
    }

    private generateHardwareFingerprint(): string {
        try {
            const raw = [
                os.hostname(),
                os.platform(),
                os.arch(),
                os.cpus()?.[0]?.model || 'generic_cpu',
                os.totalmem()
            ].join('|');
            return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32).toUpperCase();
        } catch {
            return 'HWID-GENERIC-DEFAULT';
        }
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
                    console.log(`🔑 [LicenseManager] Restored cached ${cached.tier.toUpperCase()} license for ${this.currentUser.email}`);
                } else {
                    console.warn('⚠️ [LicenseManager] Cached license grace period expired. Reverting to Free tier.');
                    this.currentLicense = { ...DEFAULT_FREE_LICENSE };
                    this.currentUser = null;
                    this.currentToken = null;
                }
            }
        } catch (err) {
            console.warn('Notice loading license cache:', err);
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
            hwid: this.hwid,
            cloudEndpoint: this.cloudEndpoint
        };
    }

    public async login(credentials: {
        email: string;
        password?: string;
        token?: string;
        cloudUrl?: string;
    }): Promise<AuthStatusResponse> {
        await this.init();
        const targetUrl = credentials.cloudUrl || this.cloudEndpoint;

        let authResult: { user: AuthUser; license: UserLicense; token: string };

        try {
            // 1. Coba hubungi Cloud Auth API resmi
            const res = await fetch(`${targetUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: credentials.email,
                    password: credentials.password,
                    token: credentials.token,
                    hwid: this.hwid,
                    platform: process.platform,
                    app_version: '2.20.0'
                }),
                signal: AbortSignal.timeout(800)
            });

            if (res.ok) {
                const data: any = await res.json();
                if (data && data.token) {
                    authResult = {
                        user: data.user,
                        license: data.license || DEFAULT_FREE_LICENSE,
                        token: data.token
                    };
                } else {
                    throw new Error('Invalid payload from auth server');
                }
            } else {
                throw new Error(`Auth server returned status ${res.status}`);
            }
        } catch (cloudErr) {
            // 2. Standalone / Demo fallback engine
            // KEAMANAN (P0): fallback ini memberi tier berbayar berdasarkan substring email,
            // sehingga sepele dieksploitasi. Dinonaktifkan secara default; hanya aktif bila
            // operator secara eksplisit menyetel SPOORF_ALLOW_DEMO_LICENSE=true (dev/uji).
            if (process.env.SPOORF_ALLOW_DEMO_LICENSE !== 'true') {
                throw new Error(
                    'Autentikasi cloud gagal dan lisensi demo dinonaktifkan. ' +
                    'Setel SPOORF_ALLOW_DEMO_LICENSE=true untuk mode uji lokal.'
                );
            }

            const isProEmail = credentials.email.toLowerCase().includes('pro') ||
                               credentials.email.toLowerCase().includes('admin') ||
                               (credentials.password && credentials.password.toLowerCase().includes('pro'));
            const isVipEmail = credentials.email.toLowerCase().includes('vip');

            const tier: LicenseTier = isVipEmail ? 'vip' : isProEmail ? 'pro' : 'free';
            const baseLicense = tier === 'vip' ? VIP_TIER_LICENSE : tier === 'pro' ? PRO_TIER_LICENSE : DEFAULT_FREE_LICENSE;

            const gracePeriod = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 hari
            const fakeToken = `spoorf_jwt_${Buffer.from(credentials.email).toString('base64')}_${Date.now()}`;

            authResult = {
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

        // Simpan ke state aktif
        this.currentUser = authResult.user;
        this.currentLicense = authResult.license;
        this.currentToken = authResult.token;

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

        this.emit('licenseChanged', this.getStatus());
        return this.getStatus();
    }

    public async activateLicenseKey(key: string): Promise<AuthStatusResponse> {
        await this.init();
        const cleanKey = key.trim().toUpperCase();

        // KEAMANAN (P0): hanya prefix/token eksplisit yang menaikkan tier.
        // Aturan lama "panjang >= 10 char = Pro" memberi Pro ke hampir semua string
        // dan hanya diizinkan pada mode demo (SPOORF_ALLOW_DEMO_LICENSE=true).
        const demoMode = process.env.SPOORF_ALLOW_DEMO_LICENSE === 'true';
        let newTier: LicenseTier;
        if (cleanKey.startsWith('FREE') || cleanKey.includes('FREE')) {
            newTier = 'free';
        } else if (cleanKey.startsWith('VIP') || cleanKey.includes('VIP')) {
            newTier = 'vip';
        } else if (cleanKey.startsWith('PRO') || cleanKey.includes('SENTINEL') || (demoMode && cleanKey.length >= 10)) {
            newTier = 'pro';
        } else {
            throw new Error('Format lisensi tidak valid. Contoh format: PRO-SENTINEL-2026');
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

        this.emit('licenseChanged', this.getStatus());
        return this.getStatus();
    }

    public async logout(): Promise<void> {
        await this.init();
        this.currentUser = null;
        this.currentToken = null;
        this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        await this.db.clearLicenseCache();
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
}
