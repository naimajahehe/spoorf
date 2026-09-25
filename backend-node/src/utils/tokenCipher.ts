/** Platform secret storage, e.g. Electron `safeStorage` (DPAPI on Windows). */
export interface SecretStorage {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

/**
 * Seals the cached cloud token (a 30-day bearer credential for the account) before it is written
 * to SQLite. With DPAPI the sealed value only opens for the same Windows account on the same
 * machine, so a copied database file does not carry a usable token.
 */
export interface TokenCipher {
    /** True when tokens are actually encrypted, false for the plaintext fallback. */
    readonly encrypts: boolean;
    seal(token: string): string;
    /** Returns the plaintext token. Throws TokenDecryptError when it cannot be opened here. */
    open(stored: string): string;
}

declare global {
    // Set by the Electron main process before the embedded backend is loaded.
    // eslint-disable-next-line no-var
    var __SPOORF_SECRET_STORAGE__: SecretStorage | undefined;
}

const SEALED_PREFIX = 'enc:v1:';

export class TokenDecryptError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TokenDecryptError';
    }
}

export function isSealedToken(stored: string): boolean {
    return stored.startsWith(SEALED_PREFIX);
}

export function createTokenCipher(storage?: SecretStorage | null): TokenCipher {
    if (storage && storage.isEncryptionAvailable()) {
        return {
            encrypts: true,
            seal: (token) => SEALED_PREFIX + storage.encryptString(token).toString('base64'),
            open: (stored) => {
                // Rows written before encryption existed are plain tokens; the repository re-seals them.
                if (!isSealedToken(stored)) return stored;
                try {
                    return storage.decryptString(Buffer.from(stored.slice(SEALED_PREFIX.length), 'base64'));
                } catch {
                    throw new TokenDecryptError('Cached token was sealed for another account or machine');
                }
            }
        };
    }

    // No secret storage (standalone backend in dev/tests): keep the previous plaintext behaviour.
    return {
        encrypts: false,
        seal: (token) => token,
        open: (stored) => {
            if (isSealedToken(stored)) {
                throw new TokenDecryptError('Cached token is sealed but no secret storage is available');
            }
            return stored;
        }
    };
}

/** Cipher for the current process: Electron-injected secret storage when present, else plaintext. */
export function resolveTokenCipher(): TokenCipher {
    return createTokenCipher(globalThis.__SPOORF_SECRET_STORAGE__);
}
