import crypto from 'crypto';
import { SecretStorage } from '../../src/utils/tokenCipher';

/**
 * Stand-in for Electron safeStorage (DPAPI): authenticated encryption keyed per account, so
 * opening a value sealed under another account/machine throws, as DPAPI does.
 */
export function fakeSecretStorage(account: string): SecretStorage {
    const key = crypto.createHash('sha256').update(account).digest();
    return {
        isEncryptionAvailable: () => true,
        encryptString: (text: string) => {
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), body]);
        },
        decryptString: (sealed: Buffer) => {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
            decipher.setAuthTag(sealed.subarray(12, 28));
            return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8');
        }
    };
}
