import { EventEmitter } from 'events';
import crypto from 'crypto';
import os from 'os';
import { IDatabaseService, ILicenseManager } from '../interfaces';
import { LicenseTier, UserLicense, AuthUser, CachedLicense, AuthStatusResponse } from '../types';
import { env } from '../config/env';
import { LICENSE_PUBLIC_KEY_PEM, LICENSE_TOKEN_ISSUER } from '../config/licensePublicKey';
import { LicenseTokenClaims, LicenseTokenError, licenseFromClaims, verifyLicenseToken } from '../utils/licenseToken';
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
 * Build terpaket (SPOORF_PACKAGED) hanya menerima endpoint resmi.
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

        // 2. Loopback local dev instance pada port 4000 (/v1) — tidak berlaku pada build terpaket
        if (env.SPOORF_PACKAGED) {
            return false;
        }
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

export const HEARTBEAT_INTERVAL_MS = 30_000; // 30 detik (responsif terhadap remote kick)
export const HEARTBEAT_JITTER_MS = 5_000; // +/- 5 detik

const TIER_RANK: Record<LicenseTier, number> = { free: 0, pro: 1, vip: 2 };

/**
 * Lisensi berbayar yang melewati `expires_at` diperlakukan sebagai Free
 * (cermin `resolveEffectiveLicense` di cloud), juga saat offline dari cache.
 */
export function enforceLicenseExpiry(license: UserLicense): UserLicense {
    const isExpired = Boolean(license.expires_at && new Date(license.expires_at).getTime() <= Date.now());
    if (license.tier !== 'free' && isExpired) {
        return {
            ...DEFAULT_FREE_LICENSE,
            expires_at: license.expires_at,
            grace_period_until: license.grace_period_until ?? null
        };
    }
    return license;
}

/** Masa tenggang offline wajib ada dan belum lewat; null tidak lagi berarti "selamanya". */
function isGracePeriodValid(gracePeriodUntil: string | null | undefined): boolean {
    return Boolean(gracePeriodUntil && new Date(gracePeriodUntil).getTime() > Date.now());
}

/** Token demo/lokal bukan JWT dan tidak boleh dikirim ke cloud. */
function isCloudToken(token: string | null): token is string {
    return Boolean(token && token.split('.').length === 3);
}

export interface LicenseManagerOptions {
    /** Public key RS256 untuk verifikasi token (default: kunci yang ditanam di build). */
    publicKeyPem?: string;
    issuer?: string;
}

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
    private readonly publicKeyPem: string;
    private readonly issuer: string;

    /**
     * Naik setiap kali identitas/sesi berubah (login, logout, revoke, expire, aktivasi demo).
     * Respons jaringan yang dimulai pada epoch lama dibuang agar tidak menghidupkan kembali
     * token setelah logout atau menimpa sesi akun lain.
     */
    private authEpoch = 0;

    // Background Heartbeat Engine State
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private isHeartbeatInFlight = false;
    private heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
    private heartbeatJitterMs = HEARTBEAT_JITTER_MS;

    constructor(db: IDatabaseService, cloudEndpoint?: string, options: LicenseManagerOptions = {}) {
        super();
        this.db = db;
        this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        this.cloudEndpoint = cloudEndpoint || env.SPOORF_CLOUD_URL;
        this.sessionId = crypto.randomUUID();
        this.publicKeyPem = options.publicKeyPem || LICENSE_PUBLIC_KEY_PEM;
        this.issuer = options.issuer || LICENSE_TOKEN_ISSUER;
    }

    /**
     * Kompatibilitas mundur: properti hwid mengembalikan sessionId (Zero-HWID Architecture).
     * Tidak lagi membaca komponen fisik CPU/RAM/Motherboard/Hostname.
     */
    public get hwid(): string {
        return this.sessionId;
    }

    /** Di luar mode demo, lisensi hanya berasal dari token RS256 yang lolos verifikasi. */
    private requiresSignedToken(): boolean {
        return !env.SPOORF_ALLOW_DEMO_LICENSE;
    }

    private verifyToken(token: string): LicenseTokenClaims {
        return verifyLicenseToken(token, this.publicKeyPem, { issuer: this.issuer });
    }

    public async init(): Promise<void> {
        if (this.isInitialized) return;
        try {
            const cached = await this.db.getLicenseCache();
            if (cached && cached.token) {
                const restored = this.restoreFromCache(cached);
                if (restored) {
                    this.log.info({ tier: this.currentLicense.tier, email: this.currentUser?.email }, `Restored cached ${this.currentLicense.tier.toUpperCase()} license for ${this.currentUser?.email}`);
                    this.startHeartbeat();
                } else {
                    this.currentLicense = { ...DEFAULT_FREE_LICENSE };
                    this.currentUser = null;
                    this.currentToken = null;
                    await this.db.clearLicenseCache();
                }
            }
        } catch (err: any) {
            this.log.warn({ err }, `Notice loading license cache: ${err?.message || err}`);
            this.currentLicense = { ...DEFAULT_FREE_LICENSE };
            this.currentUser = null;
            this.currentToken = null;
        }
        this.isInitialized = true;
    }

    /** Pulihkan sesi dari cache; `false` bila cache tidak lagi sah dan harus dibuang. */
    private restoreFromCache(cached: CachedLicense): boolean {
        const cachedSessionId = (cached as any).session_id || cached.hwid;

        if (this.requiresSignedToken() || isCloudToken(cached.token)) {
            let claims: LicenseTokenClaims;
            try {
                claims = this.verifyToken(cached.token);
            } catch (err: any) {
                this.log.warn({ reason: err?.message }, 'Cached license token failed verification. Reverting to Free tier.');
                return false;
            }

            const license = enforceLicenseExpiry(licenseFromClaims(claims));
            if (!isGracePeriodValid(license.grace_period_until)) {
                this.log.warn('Cached license grace period expired. Reverting to Free tier.');
                return false;
            }

            this.currentToken = cached.token;
            this.currentLicense = license;
            this.currentUser = {
                id: claims.userId,
                email: claims.email,
                name: cached.name || claims.email.split('@')[0],
                avatar_url: cached.avatar_url,
                plan: license.tier
            };
            this.sessionId = claims.sessionId || cachedSessionId || this.sessionId;
            return true;
        }

        // Mode demo (dev/uji): token lokal non-JWT dipulihkan dari kolom cache apa adanya.
        if (!isGracePeriodValid(cached.grace_period_until)) {
            this.log.warn('Cached license grace period expired. Reverting to Free tier.');
            return false;
        }
        this.currentToken = cached.token;
        this.currentUser = {
            id: cached.user_id || 'usr_cached',
            email: cached.email || 'user@spoorf.app',
            name: cached.name || (cached.email ? cached.email.split('@')[0] : 'Spoorfer'),
            avatar_url: cached.avatar_url,
            plan: cached.tier
        };
        this.currentLicense = enforceLicenseExpiry({
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
        });
        if (cachedSessionId) {
            this.sessionId = cachedSessionId;
        }
        return true;
    }

    /** Lisensi efektif saat ini; kedaluwarsa dievaluasi ulang setiap kali dibaca (juga saat offline). */
    private effectiveLicense(): UserLicense {
        return enforceLicenseExpiry(this.currentLicense);
    }

    public getLicense(): UserLicense {
        return { ...this.effectiveLicense() };
    }

    public getUser(): AuthUser | null {
        return this.currentUser ? { ...this.currentUser } : null;
    }

    public getStatus(): AuthStatusResponse {
        const license = this.effectiveLicense();
        return {
            isAuthenticated: this.currentUser !== null,
            user: this.currentUser,
            license,
            isOfflineGracePeriod: isGracePeriodValid(license.grace_period_until),
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

    /**
     * Terjemahkan respons login cloud menjadi hasil autentikasi. Di luar mode demo, lisensi
     * diambil dari klaim token yang terverifikasi (bukan dari field JSON yang tidak ditandatangani).
     */
    private parseCloudAuthResult(data: any): { user: AuthUser; license: UserLicense; token: string } {
        if (!data || typeof data.token !== 'string' || !data.token) {
            throw new UpstreamServiceError('Invalid payload from auth server', 502, 'INVALID_CLOUD_RESPONSE');
        }

        const cloudUser = data.user && typeof data.user === 'object' ? data.user : {};

        if (!this.requiresSignedToken() && !isCloudToken(data.token)) {
            if (typeof cloudUser.id !== 'string' || typeof cloudUser.email !== 'string') {
                throw new UpstreamServiceError('Invalid payload from auth server', 502, 'INVALID_CLOUD_RESPONSE');
            }
            return { user: cloudUser, license: data.license || DEFAULT_FREE_LICENSE, token: data.token };
        }

        let claims: LicenseTokenClaims;
        try {
            claims = this.verifyToken(data.token);
        } catch (err: any) {
            this.log.warn({ reason: err?.message }, 'Cloud returned a license token that failed verification');
            throw new UpstreamServiceError(
                'Token lisensi dari server tidak dapat diverifikasi. Pastikan aplikasi terhubung ke Spoorf Cloud resmi.',
                502,
                'INVALID_CLOUD_TOKEN'
            );
        }
        if (claims.sessionId && claims.sessionId !== this.sessionId) {
            throw new UpstreamServiceError('Token lisensi tidak terikat ke sesi perangkat ini.', 502, 'INVALID_CLOUD_TOKEN');
        }

        const license = enforceLicenseExpiry(licenseFromClaims(claims));
        return {
            user: {
                id: claims.userId,
                email: claims.email,
                name: typeof cloudUser.name === 'string' && cloudUser.name ? cloudUser.name : claims.email.split('@')[0],
                avatar_url: typeof cloudUser.avatar_url === 'string' ? cloudUser.avatar_url : undefined,
                plan: license.tier
            },
            license,
            token: data.token
        };
    }

    /** Petakan respons error cloud ke AppError yang sesuai. */
    private async toCloudError(res: Response, fallbackMessage: string): Promise<AppError> {
        let errorData: any;
        try {
            errorData = await res.json();
        } catch {}
        const errorMsg =
            errorData?.error?.message ||
            (typeof errorData?.error === 'string' ? errorData.error : undefined) ||
            errorData?.message ||
            `${fallbackMessage} ${res.status}`;

        if (res.status === 400) return new BadRequestError(errorMsg);
        if (res.status === 401) return new UnauthorizedError(errorMsg);
        if (res.status === 403) return new ForbiddenError(errorMsg);
        if (res.status === 429) return new TooManyRequestsError(errorMsg);
        return new UpstreamServiceError(errorMsg, res.status >= 500 ? 502 : res.status, 'CLOUD_SERVER_ERROR');
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
                    app_version: env.APP_VERSION || '2.41.80',
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
                let data: any;
                try {
                    data = await res.json();
                } catch {
                    throw new UpstreamServiceError('Invalid payload from auth server', 502, 'INVALID_CLOUD_RESPONSE');
                }
                authResult = this.parseCloudAuthResult(data);
            } else if (env.SPOORF_ALLOW_DEMO_LICENSE) {
                authResult = this.generateDemoLicense(credentials);
            } else {
                throw await this.toCloudError(res, 'Auth server returned status');
            }
        }

        if (!authResult) {
            throw new UpstreamServiceError('Authentication could not be completed', 500, 'AUTH_FAILED');
        }

        // Identitas berganti: respons heartbeat yang masih berjalan dari sesi sebelumnya dibuang.
        this.stopHeartbeat();
        this.authEpoch++;

        // Simpan ke state aktif
        this.currentUser = authResult.user;
        this.currentLicense = enforceLicenseExpiry(authResult.license);
        this.currentToken = authResult.token;
        this.cloudEndpoint = targetUrl;

        await this.persistCache();

        this.startHeartbeat();

        this.emit('licenseChanged', this.getStatus());
        return this.getStatus();
    }

    /** Simpan state aktif ke cache SQLite (kolom lisensi hanya dipakai untuk tampilan & mode demo). */
    private async persistCache(extra: Partial<CachedLicense> = {}): Promise<void> {
        if (!this.currentUser || !this.currentToken) return;
        const license = this.currentLicense;
        await this.db.saveLicenseCache({
            user_id: this.currentUser.id,
            email: this.currentUser.email,
            name: this.currentUser.name,
            avatar_url: this.currentUser.avatar_url,
            tier: license.tier,
            token: this.currentToken,
            max_cuts: license.max_cuts,
            can_throttle: license.can_throttle,
            can_gateway: license.can_gateway,
            can_autoreblock: license.can_autoreblock,
            can_arsenal: license.can_arsenal,
            can_deep_fingerprint: license.can_deep_fingerprint,
            cloud_sync: license.cloud_sync,
            expires_at: license.expires_at,
            grace_period_until: license.grace_period_until,
            hwid: this.hwid,
            ...extra
        });
    }

    public async activateLicenseKey(key: string): Promise<AuthStatusResponse> {
        await this.init();
        const cleanKey = key.trim().toUpperCase();

        // KEAMANAN (P0): di luar mode demo, kode lisensi divalidasi & ditebus oleh cloud
        // (POST /auth/redeem). Penentuan tier berdasarkan prefix string hanya untuk demo/dev.
        if (!env.SPOORF_ALLOW_DEMO_LICENSE) {
            return this.redeemLicenseKeyViaCloud(cleanKey);
        }

        let newTier: LicenseTier;
        if (cleanKey.startsWith('FREE') || cleanKey.includes('FREE')) {
            newTier = 'free';
        } else if (cleanKey.startsWith('VIP') || cleanKey.includes('VIP')) {
            newTier = 'vip';
        } else if (cleanKey.startsWith('PRO') || cleanKey.includes('SENTINEL') || cleanKey.length >= 10) {
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

        this.stopHeartbeat();
        this.authEpoch++;

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

        await this.persistCache();
        this.startHeartbeat();

        this.emit('licenseChanged', this.getStatus());
        return this.getStatus();
    }

    private async redeemLicenseKeyViaCloud(cleanKey: string): Promise<AuthStatusResponse> {
        if (!this.currentUser || !isCloudToken(this.currentToken)) {
            throw new BadRequestError('Silakan login ke akun Spoorf Cloud terlebih dahulu untuk mengaktifkan kode lisensi.');
        }

        const epoch = this.authEpoch;
        let res: Response;
        try {
            res = await fetch(`${this.cloudEndpoint}/auth/redeem`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentToken}`
                },
                body: JSON.stringify({ key: cleanKey }),
                signal: AbortSignal.timeout(env.SPOORF_CLOUD_AUTH_TIMEOUT_MS)
            });
        } catch (networkErr: any) {
            this.log.warn({ err: networkErr?.message }, 'Cloud redeem endpoint unreachable');
            throw new UpstreamServiceError(
                'Server cloud tidak dapat dihubungi. Aktivasi kode lisensi memerlukan koneksi internet.',
                503,
                'CLOUD_UNAVAILABLE'
            );
        }

        if (!res.ok) {
            throw await this.toCloudError(res, 'Redeem server returned status');
        }

        let data: any;
        try {
            data = await res.json();
        } catch {}

        if (epoch !== this.authEpoch) {
            throw new BadRequestError('Sesi berubah selama aktivasi. Silakan coba lagi.');
        }

        if (typeof data?.token === 'string' && data.token) {
            // Cloud v0.0.4+: token baru yang ditandatangani membawa tier hasil redeem.
            await this.applyCloudToken(data.token, data.license);
        } else if (data?.license && !this.requiresSignedToken()) {
            await this.applyLicense(data.license);
        } else if (data?.license) {
            // Cloud lama tanpa token di respons redeem: ambil token bertanda tangan via heartbeat.
            await this.heartbeat();
        } else {
            throw new UpstreamServiceError('Invalid payload from redeem server', 502, 'INVALID_CLOUD_RESPONSE');
        }
        return this.getStatus();
    }

    /**
     * Terima token hasil rotasi (heartbeat/redeem). Di luar mode demo, token wajib lolos
     * verifikasi dan lisensinya diambil dari klaim; `fallbackLicense` hanya dipakai di mode demo.
     */
    private async applyCloudToken(token: string, fallbackLicense?: Partial<UserLicense>, gracePeriodUntil?: string): Promise<void> {
        if (this.requiresSignedToken() || isCloudToken(token)) {
            let claims: LicenseTokenClaims;
            try {
                claims = this.verifyToken(token);
            } catch (err) {
                const reason = err instanceof LicenseTokenError ? err.message : String(err);
                this.log.warn({ reason }, 'Rotated license token failed verification; keeping current token');
                return;
            }
            if (claims.userId !== this.currentUser?.id || (claims.sessionId && claims.sessionId !== this.sessionId)) {
                this.log.warn('Rotated license token belongs to a different user/session; ignoring');
                return;
            }
            this.currentToken = token;
            await this.applyLicense(licenseFromClaims(claims));
            return;
        }

        this.currentToken = token;
        if (fallbackLicense) {
            await this.applyLicense({ ...fallbackLicense, grace_period_until: gracePeriodUntil || fallbackLicense.grace_period_until });
        } else {
            if (gracePeriodUntil) {
                this.currentLicense = { ...this.currentLicense, grace_period_until: gracePeriodUntil };
            }
            await this.persistCache({ last_synced_at: new Date().toISOString() });
        }
    }

    /**
     * Terapkan lisensi otoritatif ke state & cache SQLite.
     * Emit `downgraded` bila tier turun agar reconciler mencabut fitur yang tidak lagi berhak.
     */
    private async applyLicense(raw: Partial<UserLicense>): Promise<void> {
        const prevTier = this.effectiveLicense().tier;
        const next = enforceLicenseExpiry({
            ...DEFAULT_FREE_LICENSE,
            ...raw,
            grace_period_until: raw.grace_period_until ?? this.currentLicense.grace_period_until ?? null
        } as UserLicense);

        this.currentLicense = next;
        if (this.currentUser) {
            this.currentUser.plan = next.tier;
        }

        await this.persistCache({ last_synced_at: new Date().toISOString() });

        if (TIER_RANK[next.tier] < TIER_RANK[prevTier]) {
            this.emit('downgraded', {
                reason: 'Lisensi diperbarui dari Spoorf Cloud (kedaluwarsa atau diturunkan).',
                revokedAt: new Date().toISOString(),
                previousTier: prevTier,
                tier: next.tier
            });
        }
        if (next.tier !== prevTier) {
            this.log.info({ previousTier: prevTier, tier: next.tier }, 'License tier resynchronized from cloud');
        }
        this.emit('licenseChanged', this.getStatus());
    }

    public async logout(): Promise<void> {
        this.stopHeartbeat();
        await this.init();
        this.authEpoch++;
        const prevTier = this.effectiveLicense().tier;
        const cloudToken = this.currentToken;
        this.currentUser = null;
        this.currentToken = null;
        this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        // Rotasi Session ID: cegah login berikutnya menghidupkan kembali sesi yang baru dicabut.
        // Tanpa ini, login ulang memakai sessionId lama akan mengaktifkan kembali baris sesi di
        // cloud dan menghidupkan setiap token yang pernah diterbitkan untuknya.
        this.sessionId = crypto.randomUUID();

        // Best effort: bebaskan slot perangkat di cloud tanpa memblokir logout lokal.
        if (isCloudToken(cloudToken)) {
            fetch(`${this.cloudEndpoint}/auth/logout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${cloudToken}`
                },
                body: JSON.stringify({}),
                signal: AbortSignal.timeout(env.SPOORF_CLOUD_AUTH_TIMEOUT_MS)
            }).catch((err: any) => {
                this.log.debug({ err: err?.message || err }, 'Cloud logout notification failed; slot will be reclaimed by the next login');
            });
        }

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
            this.scheduleNextHeartbeat();
        }
    }

    public startHeartbeat(): void {
        if (!this.currentToken) {
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
            this.heartbeatTimer = null;
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
        const epoch = this.authEpoch;
        // Respons milik sesi lama (setelah logout/login ulang) diabaikan seluruhnya.
        const isStale = () => epoch !== this.authEpoch || !this.currentToken;
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

            if (isStale()) {
                shouldReschedule = false;
                return;
            }

            if (res.ok) {
                const data: any = await res.json();
                if (isStale()) {
                    shouldReschedule = false;
                    return;
                }
                if (data && data.isRevoked === true) {
                    this.log.warn('Session marked revoked in 200 payload. Executing kick downgrade.');
                    shouldReschedule = false;
                    await this.handleSessionRevoked(data.message || data.revokedReason);
                    return;
                }
                if (data && (data.status === 'success' || data.success === true)) {
                    if (typeof data.token === 'string' && data.token) {
                        await this.applyCloudToken(data.token, data.license, data.grace_period_until);
                    } else if (data.grace_period_until && !this.requiresSignedToken()) {
                        this.currentLicense = { ...this.currentLicense, grace_period_until: data.grace_period_until };
                        await this.persistCache({ last_synced_at: new Date().toISOString() });
                    }
                    this.log.debug({ grace_period_until: this.currentLicense.grace_period_until }, 'Heartbeat synchronized successfully');
                }
            } else {
                let errorData: any;
                try {
                    errorData = await res.json();
                } catch {}
                if (isStale()) {
                    shouldReschedule = false;
                    return;
                }

                const errCode = errorData?.error?.code || errorData?.code || (typeof errorData?.error === 'string' ? errorData.error : undefined);
                const errMsg = errorData?.error?.message || errorData?.message || `Auth heartbeat status ${res.status}`;

                if (res.status === 401 && (errCode === 'SESSION_REVOKED' || errorData?.error?.details?.isRevoked || errMsg.toLowerCase().includes('dicabut') || errMsg.toLowerCase().includes('revoked') || errMsg.toLowerCase().includes('diputuskan'))) {
                    this.log.warn({ errCode, errMsg }, 'Session revoked by cloud. Executing kick downgrade.');
                    shouldReschedule = false;
                    await this.handleSessionRevoked(errMsg);
                    return;
                } else if (res.status === 401 || res.status === 403 || res.status === 404) {
                    // 401: token ditolak; 403: sesi/token tidak cocok; 404: akun tidak ada lagi.
                    this.log.warn({ status: res.status, errMsg }, 'Cloud rejected this session. Reverting to Free tier.');
                    shouldReschedule = false;
                    await this.handleSessionExpired(errMsg);
                    return;
                } else {
                    this.log.warn({ status: res.status, errMsg }, 'Heartbeat received non-200 response from cloud');
                    if (!isGracePeriodValid(this.currentLicense.grace_period_until)) {
                        this.log.warn('Heartbeat server error and grace period has expired. Reverting to Free tier.');
                        shouldReschedule = false;
                        await this.handleSessionExpired('Masa tenggang offline (grace period) telah habis.');
                        return;
                    }
                }
            }
        } catch (networkErr: any) {
            if (isStale()) {
                shouldReschedule = false;
                return;
            }
            // Network Error / Timeout / Cloud unreachable
            // OFFLINE RESILIENCE: Tetap gunakan lisensi yang ada jika masih dalam masa tenggang
            if (isGracePeriodValid(this.currentLicense.grace_period_until)) {
                this.log.debug({ err: networkErr?.message }, 'Cloud unreachable for heartbeat, continuing offline mode within grace period');
            } else {
                this.log.warn('Heartbeat failed and grace period has expired. Reverting to Free tier.');
                shouldReschedule = false;
                await this.handleSessionExpired('Masa tenggang offline (grace period) telah habis. Silakan hubungkan internet dan login kembali.');
            }
        } finally {
            this.isHeartbeatInFlight = false;
            if (shouldReschedule && !isStale()) {
                this.scheduleNextHeartbeat();
            }
        }
    }

    /** Akhiri sesi lokal (kick/kedaluwarsa) dan beri tahu reconciler bila ada fitur yang dicabut. */
    private async endSession(event: 'sessionRevoked' | 'licenseExpired', reason: string): Promise<void> {
        this.stopHeartbeat();
        this.authEpoch++;
        const prevTier = this.effectiveLicense().tier;
        this.currentUser = null;
        this.currentToken = null;
        this.currentLicense = { ...DEFAULT_FREE_LICENSE };
        // Rotasi Session ID (lihat logout): setelah kick/kedaluwarsa, login ulang harus mendaftarkan
        // sesi baru, bukan menghidupkan kembali sesi yang sudah dicabut server.
        this.sessionId = crypto.randomUUID();
        try {
            await this.db.clearLicenseCache();
        } catch (err: any) {
            this.log.warn({ err: err?.message || err }, `Failed to clear license cache on ${event}`);
        }

        const payload = {
            reason,
            revokedAt: new Date().toISOString(),
            previousTier: prevTier,
            tier: 'free'
        };

        this.emit(event, payload);
        if (prevTier !== 'free') {
            this.emit('downgraded', payload);
        }
        this.emit('licenseChanged', this.getStatus());
    }

    public async handleSessionRevoked(reason?: string): Promise<void> {
        await this.endSession('sessionRevoked', reason || 'Sesi Anda telah dicabut karena login di perangkat lain.');
    }

    public async handleSessionExpired(reason?: string): Promise<void> {
        await this.endSession('licenseExpired', reason || 'Sesi lisensi telah kedaluwarsa.');
    }

    public checkCanBlock(activelyBlockedCount: number, isTargetAlreadyBlocked: boolean): { allowed: boolean; reason?: string } {
        if (isTargetAlreadyBlocked) {
            return { allowed: true };
        }
        const license = this.effectiveLicense();
        if (license.tier === 'free' && activelyBlockedCount >= license.max_cuts) {
            return {
                allowed: false,
                reason: `Akun Free dibatasi maksimal ${license.max_cuts} target terblokir. Upgrade ke Pro untuk memutus tanpa batas!`
            };
        }
        return { allowed: true };
    }

    public checkCanThrottle(): { allowed: boolean; reason?: string } {
        if (!this.effectiveLicense().can_throttle) {
            return {
                allowed: false,
                reason: 'Fitur Pembatasan Kecepatan (PWM Bandwidth Throttling) terkunci khusus pengguna PRO.'
            };
        }
        return { allowed: true };
    }

    public checkCanGateway(): { allowed: boolean; reason?: string } {
        if (!this.effectiveLicense().can_gateway) {
            return {
                allowed: false,
                reason: 'Fitur Smart Transparent Gateway (DNS Sinkhole & Redirect) terkunci khusus pengguna PRO.'
            };
        }
        return { allowed: true };
    }

    public checkCanArsenal(): { allowed: boolean; reason?: string } {
        if (!this.effectiveLicense().can_arsenal) {
            return {
                allowed: false,
                reason: 'Fitur VIP Arsenal (Bettercap & SYN Scan) terkunci khusus pengguna VIP.'
            };
        }
        return { allowed: true };
    }

    public checkCanAutoreblock(): { allowed: boolean; reason?: string } {
        if (!this.effectiveLicense().can_autoreblock) {
            return {
                allowed: false,
                reason: 'Fitur Auto-Reblock Anti Ganti MAC terkunci khusus pengguna PRO.'
            };
        }
        return { allowed: true };
    }

    public checkCanDeepFingerprint(): { allowed: boolean; reason?: string } {
        if (!this.effectiveLicense().can_deep_fingerprint) {
            return {
                allowed: false,
                reason: 'Fitur Deep Fingerprinting & Port Scan penuh terkunci khusus pengguna PRO.'
            };
        }
        return { allowed: true };
    }
}
