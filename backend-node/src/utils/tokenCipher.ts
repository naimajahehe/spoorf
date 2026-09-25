import { env } from '../config/env';
import { createChildLogger } from './logger';

/** Platform secret storage, e.g. Electron `safeStorage` (DPAPI on Windows). */
export interface SecretStorage {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

/**
 * - `encrypt`: tokens are sealed with the platform secret storage.
 * - `disabled`: packaged app without usable secret storage; tokens are never written to disk
 *   (kept in memory only, so the user signs in again on the next launch).
 * - `plaintext`: standalone backend (development, tests); the previous plaintext behaviour.
 */
export type TokenCipherMode = 'encrypt' | 'disabled' | 'plaintext';

/**
 * Protects the cached cloud token (a 30-day bearer credential for the account) at rest. With
 * Electron `safeStorage` on Windows the sealed value opens only with this app's key, which lives in
 * the app's userData ("Local State") protected by DPAPI for the Windows account. A database file
 * copied to another Windows account, machine or app-data folder therefore carries no usable token.
 */
export interface TokenCipher {
    readonly mode: TokenCipherMode;
    /** True when tokens are sealed at rest. */
    readonly encrypts: boolean;
    /** Value to store for `token`; empty in `disabled` mode. */
    seal(token: string): string;
    /** Returns the plaintext token, or throws TokenDecryptError. */
    open(stored: string): string;
    /** True when a stored value is not in the form this cipher writes (legacy plaintext). */
    needsRewrite(stored: string): boolean;
}

declare global {
    // Set by the Electron main process before the embedded backend is loaded.
    // eslint-disable-next-line no-var
    var __SPOORF_SECRET_STORAGE__: SecretStorage | undefined;
}

const SEALED_PREFIX = 'enc:v1:';

/**
 * - `foreign`: sealed with a key this app cannot use (another Windows account, machine or app data);
 *   the value can never be opened here.
 * - `unavailable`: sealed, but this process has no secret storage to try; another process may open it.
 */
export type TokenDecryptReason = 'foreign' | 'unavailable';

export class TokenDecryptError extends Error {
    constructor(public readonly reason: TokenDecryptReason, message: string) {
        super(message);
        this.name = 'TokenDecryptError';
    }
}

export function isSealedToken(stored: string): boolean {
    return stored.startsWith(SEALED_PREFIX);
}

function openWithoutStorage(stored: string): string {
    if (isSealedToken(stored)) {
        throw new TokenDecryptError('unavailable', 'Cached token is sealed but no secret storage is available');
    }
    return stored;
}

export function createTokenCipher(storage?: SecretStorage | null, options: { failClosed?: boolean } = {}): TokenCipher {
    if (storage && storage.isEncryptionAvailable()) {
        return {
            mode: 'encrypt',
            encrypts: true,
            seal: (token) => SEALED_PREFIX + storage.encryptString(token).toString('base64'),
            open: (stored) => {
                // Rows written before encryption existed are plain tokens; the repository re-seals them.
                if (!isSealedToken(stored)) return stored;
                try {
                    return storage.decryptString(Buffer.from(stored.slice(SEALED_PREFIX.length), 'base64'));
                } catch {
                    throw new TokenDecryptError('foreign', 'Cached token was sealed with a key this app cannot use');
                }
            },
            needsRewrite: (stored) => !isSealedToken(stored)
        };
    }

    if (options.failClosed) {
        return {
            mode: 'disabled',
            encrypts: false,
            seal: () => '',
            // A legacy plaintext token still restores this launch; the repository then wipes it.
            open: openWithoutStorage,
            needsRewrite: (stored) => stored !== '' && !isSealedToken(stored)
        };
    }

    return {
        mode: 'plaintext',
        encrypts: false,
        seal: (token) => token,
        open: openWithoutStorage,
        needsRewrite: () => false
    };
}

const log = createChildLogger('TokenCipher');

/**
 * Cipher for the current process. Uses the Electron-injected secret storage when it is usable. A
 * packaged app without it fails closed rather than writing the token in plain text, so a broken
 * injection (wrong order or name) shows up as "sign in on every launch" instead of silent plaintext.
 */
export function resolveTokenCipher(): TokenCipher {
    const storage = globalThis.__SPOORF_SECRET_STORAGE__;
    const cipher = createTokenCipher(storage, { failClosed: env.SPOORF_PACKAGED });
    if (cipher.mode === 'disabled') {
        log.error(
            { secretStorageInjected: Boolean(storage) },
            'Secret storage is not available in the packaged app: the cloud token is kept in memory only and sign-in is required on every launch.'
        );
    } else if (cipher.mode === 'plaintext' && storage) {
        log.warn('Secret storage is not available: the cloud token is stored without encryption (development build).');
    }
    return cipher;
}
