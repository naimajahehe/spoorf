import type Database from 'better-sqlite3';
import { CachedLicense } from '../types';
import { ILicenseRepository } from '../interfaces';
import { TokenCipher, resolveTokenCipher, isSealedToken } from '../utils/tokenCipher';

export class LicenseRepository implements ILicenseRepository {
    constructor(
        private readonly db: Database.Database,
        private readonly cipher: TokenCipher = resolveTokenCipher()
    ) {}

    async saveLicenseCache(lic: CachedLicense): Promise<void> {
        const stmt = this.db.prepare(`
            INSERT INTO license_cache (
                id, user_id, email, name, avatar_url, tier, token,
                max_cuts, can_throttle, can_gateway, can_autoreblock, can_arsenal, cloud_sync,
                expires_at, grace_period_until, hwid, last_synced_at
            ) VALUES (
                'current_license', ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, datetime('now', 'localtime')
            )
            ON CONFLICT (id) DO UPDATE SET
                user_id = excluded.user_id,
                email = excluded.email,
                name = excluded.name,
                avatar_url = excluded.avatar_url,
                tier = excluded.tier,
                token = excluded.token,
                max_cuts = excluded.max_cuts,
                can_throttle = excluded.can_throttle,
                can_gateway = excluded.can_gateway,
                can_autoreblock = excluded.can_autoreblock,
                can_arsenal = excluded.can_arsenal,
                cloud_sync = excluded.cloud_sync,
                expires_at = excluded.expires_at,
                grace_period_until = excluded.grace_period_until,
                hwid = excluded.hwid,
                last_synced_at = datetime('now', 'localtime')
        `);

        stmt.run(
            lic.user_id || null,
            lic.email || null,
            lic.name || null,
            lic.avatar_url || null,
            lic.tier || 'free',
            this.cipher.seal(lic.token),
            lic.max_cuts ?? 1,
            lic.can_throttle ? 1 : 0,
            lic.can_gateway ? 1 : 0,
            lic.can_autoreblock ? 1 : 0,
            lic.can_arsenal ? 1 : 0,
            lic.cloud_sync ? 1 : 0,
            lic.expires_at || null,
            lic.grace_period_until || null,
            lic.hwid || null
        );
    }

    async getLicenseCache(): Promise<CachedLicense | null> {
        const row = this.db.prepare(`SELECT * FROM license_cache WHERE id = 'current_license'`).get() as any;
        if (!row || !row.token) return null;

        const token = this.openStoredToken(row.token);
        if (token === null) return null;

        return {
            id: row.id,
            user_id: row.user_id || undefined,
            email: row.email || undefined,
            name: row.name || undefined,
            avatar_url: row.avatar_url || undefined,
            tier: row.tier || 'free',
            token,
            max_cuts: row.max_cuts ?? 1,
            can_throttle: Boolean(row.can_throttle),
            can_gateway: Boolean(row.can_gateway),
            can_autoreblock: Boolean(row.can_autoreblock),
            can_arsenal: Boolean(row.can_arsenal),
            cloud_sync: Boolean(row.cloud_sync),
            expires_at: row.expires_at || undefined,
            grace_period_until: row.grace_period_until || undefined,
            hwid: row.hwid || undefined,
            last_synced_at: row.last_synced_at || undefined
        };
    }

    getCachedLicense(): CachedLicense | null {
        try {
            const row = this.db.prepare(`SELECT * FROM license_cache WHERE id = 'current_license'`).get() as any;
            if (!row) {
                return {
                    id: 'current_license',
                    tier: 'free',
                    token: '',
                    max_cuts: 5,
                    can_throttle: false,
                    can_gateway: false,
                    can_autoreblock: false,
                    can_arsenal: false,
                    cloud_sync: false
                };
            }

            return {
                id: row.id,
                user_id: row.user_id || undefined,
                email: row.email || undefined,
                name: row.name || undefined,
                avatar_url: row.avatar_url || undefined,
                tier: row.tier || 'free',
                token: row.token ? this.peekStoredToken(row.token) : '',
                max_cuts: row.max_cuts ?? 1,
                can_throttle: Boolean(row.can_throttle),
                can_gateway: Boolean(row.can_gateway),
                can_autoreblock: Boolean(row.can_autoreblock),
                can_arsenal: Boolean(row.can_arsenal),
                cloud_sync: Boolean(row.cloud_sync),
                expires_at: row.expires_at || undefined,
                grace_period_until: row.grace_period_until || undefined,
                hwid: row.hwid || undefined,
                last_synced_at: row.last_synced_at || undefined
            };
        } catch {
            return null;
        }
    }

    /**
     * Opens the stored token. A legacy plaintext row is re-sealed in place; a token that cannot be
     * opened here (sealed for another Windows account or machine) is unusable, so the row is removed
     * and the caller sees no cache.
     */
    private openStoredToken(stored: string): string | null {
        let token: string;
        try {
            token = this.cipher.open(stored);
        } catch {
            this.db.prepare(`DELETE FROM license_cache WHERE id = 'current_license'`).run();
            return null;
        }
        if (this.cipher.encrypts && !isSealedToken(stored)) {
            this.db.prepare(`UPDATE license_cache SET token = ? WHERE id = 'current_license'`).run(this.cipher.seal(token));
        }
        return token;
    }

    /** Side-effect-free variant for the synchronous display read. */
    private peekStoredToken(stored: string): string {
        try {
            return this.cipher.open(stored);
        } catch {
            return '';
        }
    }

    async clearLicenseCache(): Promise<void> {
        this.db.prepare(`DELETE FROM license_cache WHERE id = 'current_license'`).run();
    }
}
