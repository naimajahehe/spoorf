import crypto from 'crypto';
import type { LicenseTier, UserLicense } from '../types';

/** Klaim token lisensi yang diterbitkan Spoorf Cloud (`backend/src/utils/cryptoSigner.ts`). */
export interface LicenseTokenClaims {
    userId: string;
    email: string;
    tier: LicenseTier;
    maxCuts: number;
    canThrottle: boolean;
    canGateway: boolean;
    canAutoreblock: boolean;
    canArsenal: boolean;
    canDeepFingerprint?: boolean;
    cloudSync?: boolean;
    sessionId?: string;
    expiresAt?: string | null;
    gracePeriodUntil?: string | null;
    iss?: string;
    iat?: number;
    exp?: number;
}

export class LicenseTokenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LicenseTokenError';
    }
}

/** Toleransi selisih jam antara klien dan server. */
const CLOCK_SKEW_SEC = 5 * 60;

const TIERS: readonly LicenseTier[] = ['free', 'pro', 'vip'];

function decodeSegment(segment: string): any {
    try {
        return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    } catch {
        throw new LicenseTokenError('Token segment is not valid base64url JSON');
    }
}

/**
 * Verifikasi token RS256 secara offline: algoritma dikunci ke RS256, tanda tangan, issuer,
 * masa berlaku (`exp`), dan `iat` yang tidak berada di masa depan (jam lokal mundur).
 */
export function verifyLicenseToken(
    token: string,
    publicKeyPem: string,
    options: { issuer: string; nowMs?: number }
): LicenseTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new LicenseTokenError('Token is not a JWS compact serialization');
    }
    const [headerB64, payloadB64, signatureB64] = parts;

    const header = decodeSegment(headerB64);
    if (header?.alg !== 'RS256') {
        throw new LicenseTokenError(`Unsupported token algorithm: ${header?.alg}`);
    }

    const isValidSignature = crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${headerB64}.${payloadB64}`),
        publicKeyPem,
        Buffer.from(signatureB64, 'base64url')
    );
    if (!isValidSignature) {
        throw new LicenseTokenError('Token signature is invalid');
    }

    const claims = decodeSegment(payloadB64) as LicenseTokenClaims;
    const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);

    if (claims.iss !== options.issuer) {
        throw new LicenseTokenError('Token issuer is not trusted');
    }
    if (typeof claims.exp !== 'number' || claims.exp <= nowSec) {
        throw new LicenseTokenError('Token has expired');
    }
    if (typeof claims.iat === 'number' && claims.iat > nowSec + CLOCK_SKEW_SEC) {
        throw new LicenseTokenError('Token issued in the future; system clock appears to be set back');
    }
    if (!TIERS.includes(claims.tier) || typeof claims.userId !== 'string' || typeof claims.email !== 'string') {
        throw new LicenseTokenError('Token claims are malformed');
    }

    return claims;
}

/** Bentuk `UserLicense` dari klaim yang sudah terverifikasi (sumber kebenaran lisensi offline). */
export function licenseFromClaims(claims: LicenseTokenClaims): UserLicense {
    return {
        tier: claims.tier,
        max_cuts: claims.maxCuts,
        can_throttle: Boolean(claims.canThrottle),
        can_gateway: Boolean(claims.canGateway),
        can_autoreblock: Boolean(claims.canAutoreblock),
        can_arsenal: Boolean(claims.canArsenal),
        can_deep_fingerprint: Boolean(claims.canDeepFingerprint),
        cloud_sync: Boolean(claims.cloudSync),
        expires_at: claims.expiresAt ?? null,
        grace_period_until: claims.gracePeriodUntil ?? null
    };
}
