import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
    CREATE_NETWORKS_TABLE_SQL,
    CREATE_PROFILES_TABLE_SQL,
    CREATE_DEVICES_TABLE_SQL,
    CREATE_LICENSE_CACHE_TABLE_SQL,
    CREATE_INDEXES_SQL,
    INSERT_DEFAULT_NETWORK_SQL
} from '../src/database/schema';
import { runMigrations } from '../src/database/migrations';
import {
    DeviceRepository,
    ProfileRepository,
    NetworkRepository,
    LicenseRepository,
    RetentionRepository
} from '../src/repositories';
import { Device, Network, CachedLicense } from '../src/types';
import { createTokenCipher, resolveTokenCipher, SecretStorage, TokenCipher } from '../src/utils/tokenCipher';
import { fakeSecretStorage } from './helpers/fakeSecretStorage';

function createTestDatabase(file: string = ':memory:'): Database.Database {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        ${CREATE_NETWORKS_TABLE_SQL}
        ${INSERT_DEFAULT_NETWORK_SQL}
        ${CREATE_PROFILES_TABLE_SQL}
        ${CREATE_DEVICES_TABLE_SQL}
        ${CREATE_LICENSE_CACHE_TABLE_SQL}
        ${CREATE_INDEXES_SQL}
    `);
    runMigrations(db);
    return db;
}

export async function runRepositoriesTests(): Promise<void> {
    console.log('\n--- [Node] Testing Domain Repositories (Isolated Unit Tests) ---');

    // Test 1: NetworkRepository CRUD & ordering
    {
        const db = createTestDatabase();
        const repo = new NetworkRepository(db);

        const netA: Network = {
            id: 'net_112233',
            ssid: 'Office-5G',
            gateway_ip: '192.168.10.1',
            gateway_mac: '11:22:33:44:55:66',
            subnet: '192.168.10.0/24',
            interface_type: 'wifi'
        };

        repo.ensureNetwork(netA);
        const fetched = repo.getNetwork('net_112233');
        assert.ok(fetched, 'Network must be persisted');
        assert.strictEqual(fetched.ssid, 'Office-5G');
        assert.strictEqual(fetched.gateway_ip, '192.168.10.1');

        // Update last connected via ensureNetwork ON CONFLICT
        const netAUpdated: Network = {
            ...netA,
            ssid: 'Office-5G-Renamed'
        };
        repo.ensureNetwork(netAUpdated);
        const refetched = repo.getNetwork('net_112233');
        assert.strictEqual(refetched?.ssid, 'Office-5G-Renamed');

        const all = repo.getAllNetworks();
        assert.ok(all.length >= 2, 'Should contain net_default and net_112233');
        db.close();
        console.log('  ✓ NetworkRepository: ensureNetwork, update, and retrieval verified');
    }

    // Test 2: LicenseRepository Caching (Sync & Async)
    {
        const db = createTestDatabase();
        const repo = new LicenseRepository(db);

        const initial = repo.getCachedLicense();
        assert.ok(initial, 'Default license should exist');
        assert.strictEqual(initial.tier, 'free');

        const proLicense: CachedLicense = {
            id: 'current_license',
            tier: 'pro',
            token: 'valid-pro-token-12345',
            max_cuts: 50,
            can_throttle: true,
            can_gateway: true,
            can_autoreblock: true,
            can_arsenal: true,
            cloud_sync: true,
            email: 'pro-user@example.com',
            name: 'Pro Operator'
        };

        await repo.saveLicenseCache(proLicense);

        const asyncLic = await repo.getLicenseCache();
        assert.ok(asyncLic);
        assert.strictEqual(asyncLic.tier, 'pro');
        assert.strictEqual(asyncLic.can_throttle, true);
        assert.strictEqual(asyncLic.token, 'valid-pro-token-12345');

        const syncLic = repo.getCachedLicense();
        assert.ok(syncLic);
        assert.strictEqual(syncLic.tier, 'pro');
        assert.strictEqual(syncLic.can_throttle, true);

        await repo.clearLicenseCache();
        const cleared = await repo.getLicenseCache();
        assert.strictEqual(cleared, null, 'Cache must be empty after clear');
        db.close();
        console.log('  ✓ LicenseRepository: sync/async persistence and cache clearance verified');
    }

    // Test 3: RetentionRepository Archival and Pruning
    {
        const db = createTestDatabase();
        const repo = new RetentionRepository(db);

        // Insert stale guest device (no alias, no profile, offline 20 days ago)
        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, is_online, is_blocked, is_self, is_gateway, last_seen)
            VALUES ('net_default', 'aa:bb:cc:dd:ee:ff', '192.168.1.99', 0, 0, 0, 0, datetime('now', 'localtime', '-20 days'))
        `).run();

        // Insert protected blocked device (offline 20 days ago, but is_blocked=1)
        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, is_online, is_blocked, is_self, is_gateway, last_seen)
            VALUES ('net_default', 'aa:bb:cc:dd:ee:01', '192.168.1.100', 0, 1, 0, 0, datetime('now', 'localtime', '-20 days'))
        `).run();

        const archivedCount = await repo.archiveStaleDevices(14);
        assert.strictEqual(archivedCount, 1, 'Only unprotected guest device should be archived');

        // Test pruneStaleRandomizedMacs
        // Insert stale randomized mac
        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, is_online, is_randomized_mac, is_blocked, is_self, is_gateway, last_seen)
            VALUES ('net_default', '26:bb:cc:dd:ee:ff', '192.168.1.105', 0, 1, 0, 0, 0, datetime('now', 'localtime', '-5 days'))
        `).run();

        const pruneResult = repo.pruneStaleRandomizedMacs(2);
        assert.ok(pruneResult.deletedDevices >= 1, 'Stale randomized MAC should be pruned');

        db.close();
        console.log('  ✓ RetentionRepository: stale guest archival & randomized MAC pruning verified');
    }

    // Test 4: ProfileRepository Identity Matching & Backfill
    {
        const db = createTestDatabase();
        const profileRepo = new ProfileRepository(db);

        // Insert blocked device with DUID
        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, is_online, is_blocked, dhcp_client_id, hostname, dhcp_fingerprint, dhcp_vendor_class)
            VALUES ('net_default', '02:00:00:00:00:01', '192.168.1.20', 1, 1, '00:01:00:01:aa:bb', 'galaxy-s24', '1,3,6,15', 'android-dhcp')
        `).run();

        // DUID instant match check
        const matchDuid = profileRepo.hasBlockedIdentityMatch({
            client_id: '00:01:00:01:aa:bb'
        }, 'net_default');
        assert.strictEqual(matchDuid, true, 'DUID match should identify blocked device');

        // Non-matching DUID
        const noMatch = profileRepo.hasBlockedIdentityMatch({
            client_id: '00:01:00:01:99:99'
        }, 'net_default');
        assert.strictEqual(noMatch, false, 'Unrelated DUID must not match');

        // Test backfillProfileNames
        db.prepare(`
            INSERT INTO device_profiles (id, alias, hostname)
            VALUES ('prof_test', 'Unknown', 'Unknown')
        `).run();
        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, profile_id, hostname, last_seen)
            VALUES ('net_default', '02:00:00:00:00:02', '192.168.1.21', 'prof_test', 'Budi-Phone', datetime('now', 'localtime'))
        `).run();

        const healed = await profileRepo.backfillProfileNames();
        assert.strictEqual(healed, 1, 'Generic Unknown profile should be backfilled from personal device hostname');

        const updatedProf = profileRepo.getProfileById('prof_test');
        assert.strictEqual(updatedProf.alias, 'Budi-Phone');
        assert.strictEqual(updatedProf.hostname, 'Budi-Phone');

        db.close();
        console.log('  ✓ ProfileRepository: DUID matching and profile name backfilling verified');
    }

    // Test 5: DeviceRepository CRUD and Scope Isolation
    {
        const db = createTestDatabase();
        const devRepo = new DeviceRepository(db);

        // Pre-insert row as scan would do
        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, is_online)
            VALUES ('net_default', '00:11:22:33:44:55', '192.168.1.50', 'Initial-Host', 1)
        `).run();

        const devA: Device = {
            ip: '192.168.1.55',
            mac: '00:11:22:33:44:55',
            hostname: 'Workstation-A',
            vendor: 'Dell',
            device_type: 'Desktop',
            os: 'Windows',
            rtt_ms: 5,
            open_ports: [80, 443],
            services: ['http', 'https'],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            speed_limit: 100
        };

        await devRepo.save(devA, 'net_default');
        const fetched = await devRepo.getByMac('00:11:22:33:44:55', 'net_default');
        assert.ok(fetched);
        assert.strictEqual(fetched.hostname, 'Workstation-A');
        assert.deepStrictEqual(fetched.open_ports, [80, 443]);

        // Speed limit
        await devRepo.setSpeedLimit('00:11:22:33:44:55', 40, 'net_default');
        const throttled = await devRepo.getByMac('00:11:22:33:44:55', 'net_default');
        assert.strictEqual(throttled?.speed_limit, 40);

        // Alias
        await devRepo.setAlias('00:11:22:33:44:55', 'CEO Workstation', 'net_default');
        const aliased = await devRepo.getByMac('00:11:22:33:44:55', 'net_default');
        assert.strictEqual(aliased?.alias, 'CEO Workstation');

        // IP Reassignment & Stale Disassociation
        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, is_online)
            VALUES ('net_default', '00:11:22:33:44:99', '192.168.1.99', 'Workstation-B', 1)
        `).run();

        const devB: Device = {
            ip: '192.168.1.55', // Reassigning same IP to new MAC
            mac: '00:11:22:33:44:99',
            hostname: 'Workstation-B',
            vendor: 'Lenovo',
            device_type: 'Laptop',
            os: 'Windows',
            rtt_ms: 10,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            speed_limit: 100
        };

        await devRepo.save(devB, 'net_default');
        const oldDev = await devRepo.getByMac('00:11:22:33:44:55', 'net_default');
        assert.strictEqual(oldDev?.ip, '', 'Old device must lose IP upon reassignment to avoid IP collision');
        assert.strictEqual(oldDev?.is_online, false);

        // Gateway Immunity on IP collision: Rogue device claiming gateway IP does NOT wipe gateway IP
        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, is_gateway, is_online)
            VALUES ('net_default', '00:00:5e:00:53:01', '192.168.1.1', 'Main-Router', 1, 1)
        `).run();

        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, is_online)
            VALUES ('net_default', '00:99:88:77:66:55', '192.168.1.200', 'Rogue-Device', 1)
        `).run();

        const rogueDev: Device = {
            ip: '192.168.1.1', // Rogue device claiming gateway IP
            mac: '00:99:88:77:66:55',
            hostname: 'Rogue-Device',
            vendor: 'Unknown',
            device_type: 'Unknown',
            os: 'Unknown',
            rtt_ms: 0,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            speed_limit: 100
        };

        await devRepo.save(rogueDev, 'net_default');
        const router = await devRepo.getByMac('00:00:5e:00:53:01', 'net_default');
        assert.strictEqual(router?.ip, '192.168.1.1', 'Gateway IP must NEVER be wiped by rogue occupant collision (Invariant 1)');
        assert.strictEqual(router?.is_online, true);

        // Controller Host Immunity on IP collision: Rogue device claiming controller host IP does NOT wipe controller IP (Invariant 2)
        db.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, is_self, is_online)
            VALUES ('net_default', 'aa:bb:cc:dd:ee:ff', '192.168.1.100', 'Operator-PC', 1, 1)
        `).run();

        const rogueDevAgainstHost: Device = {
            ip: '192.168.1.100', // Rogue device claiming operator PC's IP
            mac: '00:99:88:77:66:55',
            hostname: 'Rogue-Device',
            vendor: 'Unknown',
            device_type: 'Unknown',
            os: 'Unknown',
            rtt_ms: 0,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            speed_limit: 100
        };

        await devRepo.save(rogueDevAgainstHost, 'net_default');
        const operatorHost = await devRepo.getByMac('aa:bb:cc:dd:ee:ff', 'net_default');
        assert.strictEqual(operatorHost?.ip, '192.168.1.100', 'Controller Host IP must NEVER be wiped by rogue occupant collision (Invariant 2)');
        assert.strictEqual(operatorHost?.is_online, true);

        // Delete
        await devRepo.delete('00:11:22:33:44:99', 'net_default');
        const deleted = await devRepo.getByMac('00:11:22:33:44:99', 'net_default');
        assert.strictEqual(deleted, null);

        db.close();
        console.log('  ✓ DeviceRepository: CRUD, speed limit, alias, and IP collision disassociation verified');
    }

    // Test 6: Invariant 1 & 2 Protection in syncScanResults continuity archiving
    {
        const { DatabaseService } = await import('../src/services/database');
        const dbService = new DatabaseService(':memory:');
        await dbService.init();

        // Setup profile
        dbService.db.prepare(`
            INSERT INTO device_profiles (id, alias, hostname)
            VALUES ('prof_shared', 'Shared Profile', 'target-device')
        `).run();

        // Setup Gateway having profile_id (edge case / rogue collision)
        dbService.db.prepare(`
            INSERT INTO devices (network_id, mac, ip, profile_id, is_gateway, is_self, is_online, is_archived)
            VALUES ('net_default', '00:00:5e:00:00:01', '192.168.1.1', 'prof_shared', 1, 0, 1, 0)
        `).run();

        // Setup Operator PC (is_self) having profile_id
        dbService.db.prepare(`
            INSERT INTO devices (network_id, mac, ip, profile_id, is_gateway, is_self, is_online, is_archived)
            VALUES ('net_default', '00:00:5e:00:00:02', '192.168.1.5', 'prof_shared', 0, 1, 1, 0)
        `).run();

        // Scanned device with high confidence match to prof_shared
        const scanned: Device = {
            ip: '192.168.1.88',
            mac: '26:bb:cc:dd:ee:88',
            hostname: 'target-device',
            vendor: 'Samsung',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 12,
            open_ports: [],
            services: [],
            dhcp_fingerprint: '1,3,6,15,28',
            dhcp_vendor_class: 'android-dhcp',
            is_randomized_mac: true,
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            speed_limit: 100
        };

        await dbService.syncScanResults([scanned], 'net_default');

        // Verify Gateway is NOT archived
        const gw = await dbService.getDeviceByMac('00:00:5e:00:00:01', 'net_default');
        assert.strictEqual(gw?.is_archived, false, 'Gateway must NEVER be archived during continuity fusing (Invariant 1)');
        assert.strictEqual(gw?.ip, '192.168.1.1', 'Gateway IP must be preserved');

        // Verify Self Host PC is NOT archived
        const selfDev = await dbService.getDeviceByMac('00:00:5e:00:00:02', 'net_default');
        assert.strictEqual(selfDev?.is_archived, false, 'Controller host must NEVER be archived during continuity fusing (Invariant 2)');
        assert.strictEqual(selfDev?.ip, '192.168.1.5', 'Controller host IP must be preserved');

        await dbService.close();
        console.log('  ✓ Invariant 1 & 2: Gateway and Controller host are strictly immune to continuity archiving');
    }

    // Cloud token at rest (license_cache.token): a 30-day bearer credential for the cloud account.
    const CLOUD_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.cloud-token-payload.signature';
    const licenseWithToken = (token: string): CachedLicense => ({
        id: 'current_license',
        tier: 'pro',
        token,
        max_cuts: 999,
        can_throttle: true,
        can_gateway: true,
        can_autoreblock: true,
        can_arsenal: false,
        cloud_sync: true,
        email: 'sealed@example.com'
    });
    const storedToken = (db: Database.Database): string | undefined =>
        (db.prepare(`SELECT token FROM license_cache WHERE id = 'current_license'`).get() as any)?.token;

    // Test 7: The cloud token is encrypted at rest when secret storage is available
    {
        const db = createTestDatabase();
        const repo = new LicenseRepository(db, createTokenCipher(fakeSecretStorage('user-a')));
        await repo.saveLicenseCache(licenseWithToken(CLOUD_TOKEN));

        const raw = storedToken(db) || '';
        assert.ok(raw.startsWith('enc:v1:'), 'token must be stored sealed');
        assert.ok(!raw.includes(CLOUD_TOKEN), 'plaintext token must not be stored');
        assert.strictEqual((await repo.getLicenseCache())?.token, CLOUD_TOKEN);
        db.close();
        console.log('  ✓ LicenseRepository: cloud token is encrypted at rest and decrypted on read');
    }

    // Test 8: A legacy plaintext cache row is still read, then re-encrypted in place
    {
        const db = createTestDatabase();
        await new LicenseRepository(db, createTokenCipher(null)).saveLicenseCache(licenseWithToken(CLOUD_TOKEN));
        assert.strictEqual(storedToken(db), CLOUD_TOKEN, 'precondition: legacy plaintext row');

        const repo = new LicenseRepository(db, createTokenCipher(fakeSecretStorage('user-a')));
        assert.strictEqual((await repo.getLicenseCache())?.token, CLOUD_TOKEN);
        assert.ok((storedToken(db) || '').startsWith('enc:v1:'), 'legacy row must be re-encrypted on read');
        db.close();
        console.log('  ✓ LicenseRepository: legacy plaintext token is migrated to encrypted storage on read');
    }

    // Test 9: A token sealed for another Windows account or machine is discarded
    {
        const db = createTestDatabase();
        await new LicenseRepository(db, createTokenCipher(fakeSecretStorage('user-a'))).saveLicenseCache(licenseWithToken(CLOUD_TOKEN));

        const otherAccount = new LicenseRepository(db, createTokenCipher(fakeSecretStorage('user-b')));
        assert.strictEqual(await otherAccount.getLicenseCache(), null, 'undecryptable cache must read as empty');
        assert.strictEqual(storedToken(db), undefined, 'undecryptable cache row must be removed');
        db.close();
        console.log('  ✓ LicenseRepository: a token sealed for another account/machine is discarded, not used');
    }

    // Test 10: Plaintext fallback without secret storage; Electron's injected storage reaches DatabaseService
    {
        const previous = globalThis.__SPOORF_SECRET_STORAGE__;
        try {
            globalThis.__SPOORF_SECRET_STORAGE__ = undefined;
            assert.strictEqual(resolveTokenCipher().encrypts, false, 'no secret storage: plaintext (dev/tests)');

            globalThis.__SPOORF_SECRET_STORAGE__ = { ...fakeSecretStorage('user-a'), isEncryptionAvailable: () => false };
            assert.strictEqual(resolveTokenCipher().encrypts, false, 'unavailable encryption falls back to plaintext');

            globalThis.__SPOORF_SECRET_STORAGE__ = fakeSecretStorage('user-a');
            assert.strictEqual(resolveTokenCipher().encrypts, true, 'injected secret storage is used');

            const { DatabaseService } = await import('../src/services/database');
            const dbService = new DatabaseService(':memory:');
            await dbService.init();
            await dbService.saveLicenseCache(licenseWithToken(CLOUD_TOKEN));
            assert.ok((storedToken(dbService.db) || '').startsWith('enc:v1:'), 'DatabaseService must encrypt via the injected storage');
            assert.strictEqual((await dbService.getLicenseCache())?.token, CLOUD_TOKEN);
            await dbService.close();
        } finally {
            globalThis.__SPOORF_SECRET_STORAGE__ = previous;
        }
        console.log('  ✓ Token cipher: plaintext fallback without secret storage; Electron-injected storage reaches DatabaseService');
    }

    // Test 11: A packaged build without usable secret storage never writes the token to disk (fail closed)
    {
        const unavailable: SecretStorage = { ...fakeSecretStorage('user-a'), isEncryptionAvailable: () => false };
        const cases: Array<[string, TokenCipher]> = [
            ['no secret storage injected', createTokenCipher(null, { failClosed: true })],
            ['secret storage unavailable', createTokenCipher(unavailable, { failClosed: true })]
        ];
        for (const [label, cipher] of cases) {
            const db = createTestDatabase();
            const repo = new LicenseRepository(db, cipher);
            await repo.saveLicenseCache(licenseWithToken(CLOUD_TOKEN));
            assert.strictEqual(storedToken(db), '', `${label}: token must not be written to disk`);
            assert.strictEqual(await repo.getLicenseCache(), null, `${label}: nothing to restore on the next launch`);
            db.close();
        }

        const previousPackaged = process.env.SPOORF_PACKAGED;
        const previousStorage = globalThis.__SPOORF_SECRET_STORAGE__;
        try {
            process.env.SPOORF_PACKAGED = 'true';
            globalThis.__SPOORF_SECRET_STORAGE__ = undefined;
            assert.strictEqual(resolveTokenCipher().seal(CLOUD_TOKEN), '', 'packaged without secret storage must fail closed');
        } finally {
            if (previousPackaged === undefined) delete process.env.SPOORF_PACKAGED;
            else process.env.SPOORF_PACKAGED = previousPackaged;
            globalThis.__SPOORF_SECRET_STORAGE__ = previousStorage;
        }
        console.log('  ✓ Token cipher: packaged build without secret storage keeps the token in memory only (fail closed)');
    }

    // Test 12: Fail-closed mode still restores a legacy plaintext session once, then wipes it from disk
    {
        const db = createTestDatabase();
        await new LicenseRepository(db, createTokenCipher(null)).saveLicenseCache(licenseWithToken(CLOUD_TOKEN));

        const repo = new LicenseRepository(db, createTokenCipher(null, { failClosed: true }));
        assert.strictEqual((await repo.getLicenseCache())?.token, CLOUD_TOKEN, 'legacy session still restores this launch');
        assert.strictEqual(storedToken(db), '', 'the plaintext token must be wiped from disk');
        db.close();
        console.log('  ✓ LicenseRepository: fail-closed mode restores a legacy session once and wipes the plaintext');
    }

    // Test 13: A backend without secret storage keeps a sealed row it cannot read (no data loss)
    {
        const db = createTestDatabase();
        await new LicenseRepository(db, createTokenCipher(fakeSecretStorage('user-a'))).saveLicenseCache(licenseWithToken(CLOUD_TOKEN));
        const sealed = storedToken(db);

        const standalone = new LicenseRepository(db, createTokenCipher(null));
        assert.strictEqual(await standalone.getLicenseCache(), null, 'a sealed token it cannot open reads as empty');
        assert.strictEqual(storedToken(db), sealed, 'the sealed row must be kept for the app that can open it');
        db.close();
        console.log('  ✓ LicenseRepository: a backend without secret storage leaves sealed rows untouched');
    }

    // Test 14: The synchronous display read opens sealed rows without side effects
    {
        const db = createTestDatabase();
        await new LicenseRepository(db, createTokenCipher(fakeSecretStorage('user-a'))).saveLicenseCache(licenseWithToken(CLOUD_TOKEN));
        const sealed = storedToken(db);

        assert.strictEqual(new LicenseRepository(db, createTokenCipher(fakeSecretStorage('user-a'))).getCachedLicense()?.token, CLOUD_TOKEN);
        assert.strictEqual(new LicenseRepository(db, createTokenCipher(fakeSecretStorage('user-b'))).getCachedLicense()?.token, '');
        assert.strictEqual(storedToken(db), sealed, 'getCachedLicense must not modify the row');
        db.close();
        console.log('  ✓ LicenseRepository: getCachedLicense opens sealed tokens without side effects');
    }

    // Test 15: Migrating a legacy row leaves no plaintext token in the main database file (WAL)
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoorf-token-'));
        const file = path.join(dir, 'sentinel.db');
        const opened: Database.Database[] = [];
        try {
            const legacy = createTestDatabase(file);
            opened.push(legacy);
            await new LicenseRepository(legacy, createTokenCipher(null)).saveLicenseCache(licenseWithToken(CLOUD_TOKEN));
            legacy.close();
            assert.ok(fs.readFileSync(file).includes(CLOUD_TOKEN), 'precondition: plaintext token in the main file');

            const current = createTestDatabase(file);
            opened.push(current);
            const repo = new LicenseRepository(current, createTokenCipher(fakeSecretStorage('user-a')));
            assert.strictEqual((await repo.getLicenseCache())?.token, CLOUD_TOKEN);
            assert.ok(!fs.readFileSync(file).includes(CLOUD_TOKEN), 'plaintext must not remain in the main database file');
        } finally {
            // Close before removing the folder: Windows keeps an open SQLite file locked, and a cleanup
            // error here would hide the assertion that actually failed.
            for (const db of opened) if (db.open) db.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
        console.log('  ✓ LicenseRepository: migration leaves no plaintext token in the database file');
    }

    // Test 16: A failed re-seal during migration does not lose the session
    {
        const db = createTestDatabase();
        await new LicenseRepository(db, createTokenCipher(null)).saveLicenseCache(licenseWithToken(CLOUD_TOKEN));

        const brokenSeal: SecretStorage = {
            ...fakeSecretStorage('user-a'),
            encryptString: () => { throw new Error('encrypt failed'); }
        };
        const repo = new LicenseRepository(db, createTokenCipher(brokenSeal));
        assert.strictEqual((await repo.getLicenseCache())?.token, CLOUD_TOKEN, 'a failed re-seal must not lose the session');
        db.close();
        console.log('  ✓ LicenseRepository: re-sealing is best effort and never blocks the session restore');
    }
}

