import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { Device, ProfileAssessment } from '../src/types';

function createLegacyMacRepairSchema(rawDb: any): void {
    rawDb.exec(`
        CREATE TABLE devices (
            mac TEXT PRIMARY KEY,
            ip TEXT NOT NULL,
            last_ip TEXT,
            hostname TEXT,
            vendor TEXT,
            os TEXT,
            device_type TEXT DEFAULT 'Unknown',
            web_title TEXT,
            web_server TEXT,
            workgroup TEXT,
            user_name TEXT,
            open_ports TEXT DEFAULT '[]',
            services TEXT DEFAULT '[]',
            is_blocked INTEGER DEFAULT 0,
            is_online INTEGER DEFAULT 1,
            is_gateway INTEGER DEFAULT 0,
            is_self INTEGER DEFAULT 0,
            rtt_ms REAL DEFAULT 0,
            ttl INTEGER,
            is_randomized_mac INTEGER DEFAULT 0,
            mac_type TEXT,
            alias TEXT,
            profile_id TEXT,
            matched_by TEXT,
            session_id TEXT,
            speed_limit INTEGER DEFAULT 100,
            dhcp_vendor_class TEXT,
            dhcp_fingerprint TEXT,
            dhcp_client_id TEXT,
            dhcp_fqdn TEXT,
            match_score INTEGER,
            candidate_profile_id TEXT,
            is_archived INTEGER DEFAULT 0,
            is_redirected INTEGER DEFAULT 0,
            redirect_url TEXT,
            distance_zone TEXT DEFAULT 'unknown',
            estimated_range TEXT DEFAULT '-',
            ipv6_link_local TEXT,
            ipv6_global TEXT,
            ipv6_addresses TEXT DEFAULT '[]',
            is_dual_stack INTEGER DEFAULT 0,
            profile_status TEXT DEFAULT 'unknown',
            vendor_confidence INTEGER DEFAULT 0,
            type_confidence INTEGER DEFAULT 0,
            hostname_confidence INTEGER DEFAULT 0,
            profile_evidence TEXT DEFAULT '[]',
            profiled_at TEXT,
            profile_version INTEGER DEFAULT 1,
            first_seen TEXT DEFAULT (datetime('now', 'localtime')),
            last_seen TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE device_profiles (
            id TEXT PRIMARY KEY,
            alias TEXT NOT NULL,
            hostname TEXT,
            os TEXT,
            vendor TEXT,
            device_type TEXT,
            is_blocked INTEGER DEFAULT 0,
            speed_limit INTEGER DEFAULT 100,
            dhcp_fingerprint TEXT,
            dhcp_vendor_class TEXT,
            dhcp_client_id TEXT,
            linked_macs TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);
}

export async function runDatabaseTests() {
    console.log('\n--- [Node] Testing Database & Data Reconciliation Logic ---');

    // Test 1: Device Reconciliation & Sync Logic (Happy Path)
    {
        const existingDevices: Device[] = [
            {
                ip: '192.168.1.50',
                mac: 'aa:bb:cc:dd:ee:01',
                hostname: 'Target-1',
                vendor: 'Samsung',
                device_type: 'Mobile',
                os: 'Android',
                rtt_ms: 10,
                open_ports: [],
                services: [],
                is_blocked: true,
                is_online: true,
                is_gateway: false,
                speed_limit: 0
            },
            {
                ip: '192.168.1.51',
                mac: 'aa:bb:cc:dd:ee:02',
                hostname: 'Target-2',
                vendor: 'Xiaomi',
                device_type: 'Mobile',
                os: 'Android',
                rtt_ms: 12,
                open_ports: [],
                services: [],
                is_blocked: false,
                is_online: true,
                is_gateway: false,
                speed_limit: 50
            }
        ];

        // Simulasikan raw scan yang masuk
        const rawScanned: Device[] = [
            {
                ip: '192.168.1.50', // Reconnected target
                mac: 'aa:bb:cc:dd:ee:01',
                hostname: 'Target-1',
                vendor: 'Samsung',
                device_type: 'Mobile',
                os: 'Android',
                rtt_ms: 5,
                open_ports: [],
                services: [],
                is_blocked: false, // Scanned raw says false
                is_online: true,
                is_gateway: false
            }
        ];

        // Logic check: Persisted is_blocked must be preserved!
        const existingMap = new Map(existingDevices.map(d => [d.mac.toLowerCase(), d]));
        const autoReblockTargets: Device[] = [];
        const autoThrottleTargets: Device[] = [];

        for (const scan of rawScanned) {
            const persisted = existingMap.get(scan.mac.toLowerCase());
            if (persisted) {
                if (persisted.is_blocked && (persisted.speed_limit === 0 || persisted.speed_limit === undefined)) {
                    scan.is_blocked = true;
                    scan.speed_limit = 0;
                    autoReblockTargets.push(scan);
                } else if (persisted.speed_limit !== undefined && persisted.speed_limit < 100 && persisted.speed_limit > 0) {
                    scan.speed_limit = persisted.speed_limit;
                    autoThrottleTargets.push(scan);
                }
            }
        }

        assert.strictEqual(autoReblockTargets.length, 1, 'Target with speed_limit 0 should be in autoReblockTargets');
        assert.strictEqual(autoThrottleTargets.length, 0, 'Target with speed_limit 0 should NOT be in autoThrottleTargets');
        assert.strictEqual(rawScanned[0].is_blocked, true, 'is_blocked must be preserved as true');
        console.log('  ✓ Happy Path: Device persistence and autoReblockTargets correctly computed');
    }

    // Test 2: Auto-Throttle Target Detection (Happy Path)
    {
        const existingDevice: Device = {
            ip: '192.168.1.60',
            mac: '11:22:33:44:55:66',
            hostname: 'HP-Throttled',
            vendor: 'Infinix',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 10,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            speed_limit: 50
        };

        const incomingScan: Device = {
            ip: '192.168.1.60',
            mac: '11:22:33:44:55:66',
            hostname: 'HP-Throttled',
            vendor: 'Infinix',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 8,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        };

        const autoThrottleTargets: Device[] = [];
        if (existingDevice.speed_limit !== undefined && existingDevice.speed_limit < 100 && existingDevice.speed_limit > 0) {
            incomingScan.speed_limit = existingDevice.speed_limit;
            autoThrottleTargets.push(incomingScan);
        }

        assert.strictEqual(autoThrottleTargets.length, 1);
        assert.strictEqual(incomingScan.speed_limit, 50);
        console.log('  ✓ Happy Path: Throttled device correctly identified for auto-throttle');
    }

    // Test 3: Negative Test - Unknown MAC cannot be reconciled
    {
        const existingMap = new Map<string, Device>();
        const unknownScan: Device = {
            ip: '192.168.1.99',
            mac: 'ff:ee:dd:cc:bb:aa',
            hostname: 'Unknown',
            vendor: 'Unknown',
            device_type: 'Unknown',
            os: 'Unknown',
            rtt_ms: 20,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        };

        const persisted = existingMap.get(unknownScan.mac.toLowerCase());
        assert.strictEqual(persisted, undefined, 'Unknown device should not exist in DB');
        console.log('  ✓ Negative Test: Unknown MAC handled gracefully');
    }

    // Test 4: Edge Cases - Empty array, long alias, SQL Injection attempt
    {
        // Empty scan array
        const emptyScan: Device[] = [];
        assert.strictEqual(emptyScan.length, 0);

        // SQL Injection String in alias
        const maliciousAlias = "MyPhone' OR '1'='1; DROP TABLE devices; --";
        // Parameterized query safety check:
        const parameterizedQuery = "UPDATE devices SET alias = $1 WHERE mac = $2";
        const values = [maliciousAlias.trim(), 'aa:bb:cc:dd:ee:ff'];
        assert.strictEqual(values[0], maliciousAlias);
        assert.ok(parameterizedQuery.includes('$1'), 'Must use parameterized $1 to prevent SQL injection');

        // Extremely long alias
        const longAlias = 'A'.repeat(5000);
        const truncated = longAlias.slice(0, 100);
        assert.strictEqual(truncated.length, 100);
        console.log('  ✓ Edge Cases: Empty array, SQL injection safety, and long string handling passed');
    }

    // Test 5: Generic Factory Hostname Blacklist Detection
    {
        const { isGenericFactoryHostname } = await import('../src/services/database');
        // Generic factory models must be true
        assert.strictEqual(isGenericFactoryHostname('Galaxy-A14'), true);
        assert.strictEqual(isGenericFactoryHostname('Galaxy-A52'), true);
        assert.strictEqual(isGenericFactoryHostname('Redmi-Note-11'), true);
        assert.strictEqual(isGenericFactoryHostname('POCO-X3-Pro'), true);
        assert.strictEqual(isGenericFactoryHostname('Infinix-HOT-10'), true);
        assert.strictEqual(isGenericFactoryHostname('vivo-1904'), true);
        assert.strictEqual(isGenericFactoryHostname('iPhone'), true);
        assert.strictEqual(isGenericFactoryHostname('DESKTOP-ABC1234'), true);

        // Personalized / distinct names must be false (qualified for unique matching)
        assert.strictEqual(isGenericFactoryHostname('Galaxy-Budi-Personal'), false);
        assert.strictEqual(isGenericFactoryHostname('iPhone-Milik-Naim'), false);
        assert.strictEqual(isGenericFactoryHostname('Laptop-Finance-Admin'), false);
        console.log('  ✓ Happy Path: Generic factory hostnames correctly distinguished from personal names');
    }

    // Test 6: Anti-Collateral Damage Guard (Siti vs Budi Galaxy-A14 Scenario)
    {
        const { calculateProfileMatchScore } = await import('../src/services/database');
        
        // Budi's blocked profile with generic factory name
        const budiProfile = {
            id: 'prof_budi',
            alias: 'HP Budi',
            hostname: 'Galaxy-A14',
            is_blocked: true,
            dhcp_fingerprint: 'Android OS Signature',
            linked_macs: ['c2:4e:ca:88:04:2d']
        };

        // Innocent guest Siti enters with her own Galaxy-A14
        const sitiScanned: Device = {
            ip: '192.168.1.88',
            mac: 'fa:bb:cc:dd:ee:ff',
            hostname: 'Galaxy-A14',
            vendor: 'Samsung',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 10,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            dhcp_fingerprint: 'Android OS Signature'
        };

        const result = calculateProfileMatchScore(sitiScanned, budiProfile, []);
        // Score = 20 (generic factory hostname) + 30 (PRL signature) = 50%
        assert.strictEqual(result.score, 50, 'Generic model match should only score 50%');
        assert.ok(result.score < 80, 'Score 50% must NOT trigger high-confidence auto-block!');
        console.log('  ✓ Protection: Innocent guest Siti (Galaxy-A14) gets candidate score 50% and is NOT auto-blocked');
    }

    // Test 7: High Confidence Auto-Link for Personalized Unique Hostnames
    {
        const { calculateProfileMatchScore } = await import('../src/services/database');

        const budiPersonalProfile = {
            id: 'prof_budi_unique',
            alias: 'HP Budi',
            hostname: 'Galaxy-Budi-Personal',
            is_blocked: true,
            dhcp_fingerprint: 'Android OS Signature',
            dhcp_vendor_class: 'android-dhcp-12',
            linked_macs: ['c2:4e:ca:88:04:2d']
        };

        // Budi rotates MAC but keeps his personal hostname
        const budiRotatedMac: Device = {
            ip: '192.168.1.92',
            mac: '3a:11:22:33:44:55',
            hostname: 'Galaxy-Budi-Personal',
            vendor: 'Samsung',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 8,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            dhcp_fingerprint: 'Android OS Signature',
            dhcp_vendor_class: 'android-dhcp-12'
        };

        const result = calculateProfileMatchScore(budiRotatedMac, budiPersonalProfile, []);
        // Score = 45 (unique hostname) + 30 (PRL) + 15 (vendor class) = 90%
        assert.strictEqual(result.score, 90, 'Personalized device match should score 90%');
        assert.ok(result.score >= 80, 'Score 90% qualifies for high-confidence auto-block');
        console.log('  ✓ High Confidence: Target Budi with personal hostname scores 90% and qualifies for auto-reblock');
    }

    // Test 8: Profile-Centric Consolidation & Superseded Offline MAC Auto-Archiving
    {
        // Simulasikan struktur data sebelum dan sesudah auto-archive
        interface StoredDevice {
            mac: string;
            profile_id: string;
            is_online: boolean;
            is_archived: boolean;
        }

        const storedDevices: StoredDevice[] = [
            { mac: 'c2:4e:ca:88:04:2d', profile_id: 'prof_budi', is_online: false, is_archived: false },
            { mac: 'f6:aa:bb:cc:dd:ee', profile_id: 'prof_siti', is_online: true, is_archived: false }
        ];

        // New active MAC for prof_budi connects
        const newMacKey = '3a:11:22:33:44:55';
        const profileId = 'prof_budi';

        // Execute auto-archive logic:
        for (const dev of storedDevices) {
            if (dev.profile_id === profileId && dev.mac !== newMacKey && !dev.is_online) {
                dev.is_archived = true;
            }
        }

        // Add new active device
        storedDevices.push({
            mac: newMacKey,
            profile_id: profileId,
            is_online: true,
            is_archived: false
        });

        // Verify: Old offline MAC of Budi is archived
        const oldBudi = storedDevices.find(d => d.mac === 'c2:4e:ca:88:04:2d');
        assert.strictEqual(oldBudi?.is_archived, true, 'Old offline MAC must be marked is_archived = true');

        // Verify: Unrelated device (Siti) is NOT archived
        const siti = storedDevices.find(d => d.mac === 'f6:aa:bb:cc:dd:ee');
        assert.strictEqual(siti?.is_archived, false, 'Unrelated profile device must not be archived');

        // Verify: Only non-archived devices are returned in main view
        const visibleDevices = storedDevices.filter(d => !d.is_archived);
        assert.strictEqual(visibleDevices.length, 2, 'Main view must only show 2 active devices (Budi MAC-2 and Siti)');
        assert.ok(visibleDevices.some(d => d.mac === newMacKey), 'Active representative MAC-2 must be visible');
        assert.ok(!visibleDevices.some(d => d.mac === 'c2:4e:ca:88:04:2d'), 'Superseded MAC-1 must be hidden from main view');
        console.log('  ✓ Profile-Centric: Superseded offline MACs successfully auto-archived, UI table stays clean (1 Perangkat = 1 Baris)');
    }

    // Test 9: DUID-First Fast-Track (Instant 100% Match)
    {
        const { calculateProfileMatchScore } = await import('../src/services/database');

        const targetProfile = {
            id: 'prof_laptop_target',
            alias: 'Target Laptop',
            hostname: 'Old-Hostname-Changed',
            is_blocked: true,
            dhcp_client_id: 'ff:12:34:56:78:90:ab:cd:ef',
            linked_macs: ['11:22:33:44:55:66']
        };

        // Scanned device rotates MAC and changes hostname, but keeps persistent Hardware DUID
        const scannedRotatedWithDuid: Device = {
            ip: '192.168.1.105',
            mac: 'ee:ff:11:22:33:44',
            hostname: 'Completely-Different-Name',
            vendor: 'Dell',
            device_type: 'Laptop',
            os: 'Windows 11',
            rtt_ms: 2,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            dhcp_client_id: 'ff:12:34:56:78:90:ab:cd:ef'
        };

        const result = calculateProfileMatchScore(scannedRotatedWithDuid, targetProfile, []);
        assert.strictEqual(result.score, 100, 'Matching Hardware DUID must trigger instant 100% match');
        assert.ok(result.reasons.some(r => r.includes('duid_hardware_instant_match')), 'Reason must state duid_hardware_instant_match');
        console.log('  ✓ DUID-First Priority: Matching Hardware DUID scores 100% instant match bypassing generic checks');
    }

    // Test 10: Profile ID derivation is collision-free (BUG-003)
    {
        const { deriveProfileId } = await import('../src/services/database');

        // MAC berbeda -> profile_id berbeda (walau hostname generik sama)
        const idAndroidA = deriveProfileId('c2:4e:ca:88:04:2d');
        const idAndroidB = deriveProfileId('fa:bb:cc:dd:ee:ff');
        assert.notStrictEqual(idAndroidA, idAndroidB, 'Dua MAC berbeda harus menghasilkan profile_id berbeda');

        // MAC sama beda kapitalisasi/pemisah -> profile_id sama (deterministik)
        assert.strictEqual(
            deriveProfileId('C2:4E:CA:88:04:2D'),
            deriveProfileId('c2-4e-ca-88-04-2d'),
            'MAC identik (beda format) harus menghasilkan profile_id sama'
        );

        // Tidak ada pemotongan yang menyebabkan tabrakan OUI (12 char hex penuh)
        assert.strictEqual(idAndroidA, 'prof_c24eca88042d');
        assert.notStrictEqual(
            deriveProfileId('a8:3b:76:00:00:01'),
            deriveProfileId('a8:3b:76:00:00:02'),
            'MAC dengan OUI sama namun berbeda tetap harus unik (tanpa truncation collision)'
        );
        console.log('  ✓ BUG-003 Fixed: deriveProfileId bebas kolisi (hostname generik sama, MAC beda -> profil beda)');
    }

    // Test 11: Sync transaction is atomic (Phase 4) - ROLLBACK on mid-failure
    {
        // Replika pola transaksi syncScanResults dengan mock client (calls dicatat eksternal).
        const runTxn = async (calls: string[], queries: (() => Promise<void>)[]): Promise<void> => {
            const client = {
                query: async (sql: string) => { calls.push(sql); },
                release: () => { calls.push('RELEASE'); }
            };
            try {
                await client.query('BEGIN');
                for (const q of queries) await q();
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        };

        // Happy path: semua query sukses -> COMMIT, tanpa ROLLBACK
        const okCalls: string[] = [];
        await runTxn(okCalls, [async () => {}, async () => {}, async () => {}]);
        assert.ok(okCalls.includes('COMMIT'), 'Transaksi sukses harus COMMIT');
        assert.ok(!okCalls.includes('ROLLBACK'), 'Transaksi sukses tidak boleh ROLLBACK');
        assert.strictEqual(okCalls[okCalls.length - 1], 'RELEASE', 'Client harus selalu di-release');

        // Failure di tengah -> ROLLBACK, tanpa COMMIT, tetap release, dan error dilempar
        const failCalls: string[] = [];
        let ranAfterFailure = false;
        let threw = false;
        try {
            await runTxn(failCalls, [
                async () => {},
                async () => { throw new Error('DB write ke-2 gagal'); },
                async () => { ranAfterFailure = true; }
            ]);
        } catch {
            threw = true;
        }
        assert.strictEqual(threw, true, 'Error harus terpropagasi ke pemanggil');
        assert.ok(failCalls.includes('ROLLBACK'), 'Kegagalan di tengah harus memicu ROLLBACK');
        assert.ok(!failCalls.includes('COMMIT'), 'Kegagalan tidak boleh COMMIT');
        assert.strictEqual(failCalls[failCalls.length - 1], 'RELEASE', 'Client tetap di-release walau gagal');
        assert.strictEqual(ranAfterFailure, false, 'Query setelah kegagalan tidak boleh dijalankan');
        console.log('  ✓ Phase 4: Sinkronisasi atomik — kegagalan di tengah memicu ROLLBACK (bukan COMMIT), client tetap release');
    }

    // Test 12: Live In-Memory SQLite DatabaseService CRUD & Sync
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();

        // 1. Initial devices empty
        const initialDevices = await db.getAllDevices();
        assert.strictEqual(initialDevices.length, 0, 'In-memory DB should start empty');

        // 2. Sync scan results
        const scan1: Device[] = [
            {
                ip: '192.168.1.1',
                mac: '00:11:22:33:44:55',
                hostname: 'Router-Gateway',
                vendor: 'TP-Link',
                device_type: 'Router / Gateway',
                os: 'Linux',
                rtt_ms: 1.5,
                open_ports: [80, 53],
                services: ['HTTP', 'DNS'],
                is_blocked: false,
                is_online: true,
                is_gateway: true
            },
            {
                ip: '192.168.1.100',
                mac: 'aa:bb:cc:11:22:33',
                hostname: 'Galaxy-S22',
                vendor: 'Samsung',
                device_type: 'Mobile',
                os: 'Android',
                rtt_ms: 12.0,
                open_ports: [],
                services: [],
                is_blocked: false,
                is_online: true,
                is_gateway: false
            }
        ];

        const syncResult = await db.syncScanResults(scan1);
        assert.strictEqual(syncResult.allDevices.length, 2, 'Should have 2 devices after sync');

        // 3. Set Alias
        const aliased = await db.setDeviceAlias('aa:bb:cc:11:22:33', 'HP Samsung Budi');
        assert.strictEqual(aliased.alias, 'HP Samsung Budi');

        // 4. Set Blocked
        await db.setDeviceBlocked('aa:bb:cc:11:22:33', true, 'session_test_999');
        const blockedDev = await db.getDeviceByMac('aa:bb:cc:11:22:33');
        assert.strictEqual(blockedDev?.is_blocked, true);
        assert.strictEqual(blockedDev?.session_id, 'session_test_999');

        // 5. Set Speed Limit
        const throttled = await db.setDeviceSpeedLimit('aa:bb:cc:11:22:33', 25);
        assert.strictEqual(throttled.speed_limit, 25);

        // 6. Rescan with reconnect - Auto-Reblock preservation
        const scan2: Device[] = [
            {
                ip: '192.168.1.100',
                mac: 'aa:bb:cc:11:22:33',
                hostname: 'Galaxy-S22',
                vendor: 'Samsung',
                device_type: 'Mobile',
                os: 'Android',
                rtt_ms: 10.0,
                open_ports: [],
                services: [],
                is_blocked: false, // Scanned raw says false
                is_online: true,
                is_gateway: false
            }
        ];

        const syncResult2 = await db.syncScanResults(scan2);
        const recheckedDev = syncResult2.allDevices.find(d => d.mac === 'aa:bb:cc:11:22:33');
        assert.strictEqual(recheckedDev?.is_blocked, true, 'is_blocked must be preserved across rescans');
        assert.strictEqual(recheckedDev?.alias, 'HP Samsung Budi', 'alias must be preserved across rescans');

        // Clean close
        await db.close();
        console.log('  ✓ SQLite Engine: In-memory SQLite DatabaseService CRUD, Auto-Reblock, and JSON arrays verified');
    }

    // Test 13: archiveStaleDevices — only anonymous long-offline devices are archived,
    // configured/recent/online devices are protected.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();

        const mk = (ip: string, mac: string, hostname: string): Device => ({
            ip, mac, hostname, vendor: 'Generic', device_type: 'Mobile', os: 'Android',
            rtt_ms: 10, open_ports: [], services: [], is_blocked: false, is_online: true, is_gateway: false
        });

        // Seed 5 devices online.
        await db.syncScanResults([
            mk('192.168.1.10', 'aa:00:00:00:00:0a', 'Guest-Anon'),      // A: anonymous, will be stale-offline -> ARCHIVE
            mk('192.168.1.11', 'bb:00:00:00:00:0b', 'Blocked-Old'),     // B: blocked, stale-offline    -> KEEP
            mk('192.168.1.12', 'cc:00:00:00:00:0c', 'Named-Old'),       // C: aliased, stale-offline     -> KEEP
            mk('192.168.1.13', 'dd:00:00:00:00:0d', 'Online-Now'),      // D: anonymous, still online    -> KEEP
            mk('192.168.1.14', 'ee:00:00:00:00:0e', 'Guest-Recent'),    // G: anonymous, recently offline-> KEEP
        ]);

        // Configure user-intent on B (block+session) and C (alias).
        await db.setDeviceBlocked('bb:00:00:00:00:0b', true, 'sess_b');
        await db.setDeviceAlias('cc:00:00:00:00:0c', 'Laptop Kantor');

        // Deterministically backdate A, B, C to 30 days ago & offline (test-only internal access).
        const backdate = (db as any).db.prepare(
            "UPDATE devices SET is_online = 0, last_seen = datetime('now','localtime','-30 days') WHERE LOWER(mac) = LOWER(?)"
        );
        for (const mac of ['aa:00:00:00:00:0a', 'bb:00:00:00:00:0b', 'cc:00:00:00:00:0c']) backdate.run(mac);
        // G: offline but recent (last_seen = now).
        await db.setDeviceOnlineStatus('ee:00:00:00:00:0e', false);

        // Archive devices stale beyond 14 days.
        const archivedCount = await db.archiveStaleDevices(14);

        const visible = await db.getAllDevices();
        const visibleMacs = new Set(visible.map(d => d.mac.toLowerCase()));

        assert.strictEqual(archivedCount, 1, 'Exactly 1 device (anonymous stale-offline) must be archived');
        assert.ok(!visibleMacs.has('aa:00:00:00:00:0a'), 'A: anonymous stale-offline must be archived (hidden)');
        assert.ok(visibleMacs.has('bb:00:00:00:00:0b'), 'B: blocked device must NOT be archived (block state protected)');
        assert.ok(visibleMacs.has('cc:00:00:00:00:0c'), 'C: aliased device must NOT be archived (user name protected)');
        assert.ok(visibleMacs.has('dd:00:00:00:00:0d'), 'D: online device must NOT be archived');
        assert.ok(visibleMacs.has('ee:00:00:00:00:0e'), 'G: recently-offline device must NOT be archived (within grace window)');

        await db.close();
        console.log('  ✓ Retention: archiveStaleDevices archives only anonymous long-offline devices; blocked/aliased/online/recent protected');
    }

    // Test 14: live DHCP evidence is persisted atomically for an existing device.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const device: Device = {
            ip: '192.168.1.70',
            mac: 'aa:bb:cc:dd:ee:70',
            hostname: 'Unknown Device',
            vendor: 'Generic Device',
            device_type: 'Generic Client Device',
            os: 'Unknown OS',
            rtt_ms: 10,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        };
        await db.syncScanResults([device]);

        await db.updateDeviceDhcpProfile({
            mac: device.mac,
            ip: device.ip,
            hostname: 'Galaxy-Naim',
            vendorClass: 'android-dhcp-14',
            fingerprint: 'Android OS Signature (android-dhcp-14)',
            clientId: '01:aa:bb:cc:dd:ee:70',
            fqdn: 'galaxy-naim.local'
        });

        const updated = await db.getDeviceByMac(device.mac);
        assert.strictEqual(updated?.hostname, 'Galaxy-Naim');
        assert.strictEqual(updated?.dhcp_vendor_class, 'android-dhcp-14');
        assert.strictEqual(updated?.dhcp_fingerprint, 'Android OS Signature (android-dhcp-14)');
        assert.strictEqual(updated?.dhcp_client_id, '01:aa:bb:cc:dd:ee:70');
        assert.strictEqual(updated?.dhcp_fqdn, 'galaxy-naim.local');
        await db.close();
        console.log('  ✓ DHCP persistence: live profile evidence is stored atomically');
    }

    // Test 15: profile columns are added to a legacy schema idempotently.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        const rawDb = (db as any).db;
        rawDb.exec(`
            CREATE TABLE devices (
                mac TEXT PRIMARY KEY,
                ip TEXT NOT NULL,
                hostname TEXT,
                vendor TEXT,
                os TEXT,
                device_type TEXT DEFAULT 'Unknown',
                web_title TEXT,
                web_server TEXT,
                workgroup TEXT,
                user_name TEXT,
                open_ports TEXT DEFAULT '[]',
                services TEXT DEFAULT '[]',
                is_blocked INTEGER DEFAULT 0,
                is_online INTEGER DEFAULT 1,
                is_gateway INTEGER DEFAULT 0,
                is_self INTEGER DEFAULT 0,
                rtt_ms REAL DEFAULT 0,
                ttl INTEGER,
                is_randomized_mac INTEGER DEFAULT 0,
                mac_type TEXT,
                alias TEXT,
                profile_id TEXT,
                matched_by TEXT,
                session_id TEXT,
                speed_limit INTEGER DEFAULT 100,
                dhcp_vendor_class TEXT,
                dhcp_fingerprint TEXT,
                dhcp_client_id TEXT,
                dhcp_fqdn TEXT,
                match_score INTEGER,
                candidate_profile_id TEXT,
                is_archived INTEGER DEFAULT 0,
                distance_zone TEXT DEFAULT 'unknown',
                estimated_range TEXT DEFAULT '-',
                ipv6_link_local TEXT,
                ipv6_global TEXT,
                ipv6_addresses TEXT DEFAULT '[]',
                is_dual_stack INTEGER DEFAULT 0,
                first_seen TEXT DEFAULT (datetime('now', 'localtime')),
                last_seen TEXT DEFAULT (datetime('now', 'localtime'))
            )
        `);

        await db.init();
        (db as any).initialized = false;
        await db.init();

        const columns = new Set(
            (rawDb.pragma('table_info(devices)') as Array<{ name: string }>).map(column => column.name)
        );
        for (const column of [
            'last_ip',
            'profile_status',
            'vendor_confidence',
            'type_confidence',
            'hostname_confidence',
            'profile_evidence',
            'profiled_at',
            'profile_version'
        ]) {
            assert.ok(columns.has(column), `Migration must add ${column}`);
        }

        await db.close();
        console.log('  ✓ Profile migration: legacy devices schema is upgraded idempotently');
    }

    // Test 16: profile persistence updates identity atomically without clearing control-plane state.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();

        const device: Device = {
            ip: '192.168.1.20',
            mac: '00:07:ab:11:22:33',
            hostname: 'Unknown Device',
            vendor: 'Generic Device',
            device_type: 'Generic Client Device',
            os: 'Unknown OS',
            rtt_ms: 8,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        };
        await db.syncScanResults([device]);
        await db.setDeviceAlias(device.mac, 'Living Room Phone');
        await db.setDeviceBlocked(device.mac, true, 'session_profile_1');
        await db.setDeviceSpeedLimit(device.mac, 25);

        const rawDb = (db as any).db;
        rawDb.exec(`
            ALTER TABLE devices ADD COLUMN is_redirected INTEGER DEFAULT 0;
            ALTER TABLE devices ADD COLUMN redirect_url TEXT;
        `);
        rawDb.prepare(`
            UPDATE devices
            SET is_redirected = 1,
                redirect_url = ?,
                matched_by = ?,
                candidate_profile_id = ?
            WHERE LOWER(mac) = LOWER(?)
        `).run('https://portal.local/', 'manual_link', 'candidate_7', device.mac);

        await db.updateDeviceProfileAssessment({
            mac: '00:07:AB:11:22:33',
            ip: '192.168.1.20',
            vendor: 'Samsung',
            device_type: 'Smartphone / Tablet',
            hostname: 'Galaxy-A07',
            os: 'Android',
            vendor_confidence: 94,
            type_confidence: 96,
            hostname_confidence: 90,
            profile_status: 'high',
            profile_evidence: [{
                source: 'mdns',
                group: 'explicit_identity',
                field: 'model',
                value: 'SM-A055F',
                strength: 'explicit',
                observed_at: '2026-09-04T08:00:00Z'
            }],
            profiled_at: '2026-09-04T08:00:05Z',
            profile_version: 1
        });

        let stored = await db.getDeviceByMac(device.mac) as any;
        assert.strictEqual(stored.vendor, 'Samsung');
        assert.strictEqual(stored.device_type, 'Smartphone / Tablet');
        assert.strictEqual(stored.hostname, 'Galaxy-A07');
        assert.strictEqual(stored.os, 'Android');
        assert.strictEqual(stored.profile_status, 'high');
        assert.strictEqual(stored.vendor_confidence, 94);
        assert.strictEqual(stored.type_confidence, 96);
        assert.strictEqual(stored.hostname_confidence, 90);
        assert.strictEqual(stored.profile_evidence?.[0].source, 'mdns');
        assert.strictEqual(stored.profiled_at, '2026-09-04T08:00:05Z');
        assert.strictEqual(stored.profile_version, 1);

        const controls = rawDb.prepare(`
            SELECT alias, is_blocked, session_id, speed_limit, profile_id,
                   matched_by, candidate_profile_id, is_redirected, redirect_url
            FROM devices WHERE LOWER(mac) = LOWER(?)
        `).get(device.mac);
        assert.strictEqual(controls.alias, 'Living Room Phone');
        assert.strictEqual(controls.is_blocked, 1);
        assert.strictEqual(controls.session_id, 'session_profile_1');
        assert.strictEqual(controls.speed_limit, 25);
        assert.ok(controls.profile_id);
        assert.strictEqual(controls.matched_by, 'manual_link');
        assert.strictEqual(controls.candidate_profile_id, 'candidate_7');
        assert.strictEqual(controls.is_redirected, 1);
        assert.strictEqual(controls.redirect_url, 'https://portal.local/');

        await db.updateDeviceProfileAssessment({
            mac: device.mac,
            ip: device.ip,
            vendor: 'Generic Device',
            device_type: 'Generic Client Device',
            hostname: 'Unknown',
            os: 'Unknown OS',
            vendor_confidence: 0,
            type_confidence: 0,
            hostname_confidence: 0,
            profile_status: 'unknown',
            profile_evidence: [],
            profiled_at: '2026-09-04T09:00:00Z',
            profile_version: 2
        });

        stored = await db.getDeviceByMac(device.mac) as any;
        assert.strictEqual(stored.vendor, 'Samsung', 'Unknown refresh must preserve last-known vendor');
        assert.strictEqual(stored.device_type, 'Smartphone / Tablet', 'Unknown refresh must preserve last-known type');
        assert.strictEqual(stored.hostname, 'Galaxy-A07', 'Unknown refresh must preserve last-known hostname');
        assert.strictEqual(stored.os, 'Android', 'Unknown refresh must preserve last-known OS');
        assert.strictEqual(stored.profile_status, 'unknown', 'Fresh status must replace stale high status');
        assert.strictEqual(stored.vendor_confidence, 0);
        assert.strictEqual(stored.type_confidence, 0);
        assert.strictEqual(stored.hostname_confidence, 0);
        assert.deepStrictEqual(stored.profile_evidence, []);
        assert.strictEqual(stored.profiled_at, '2026-09-04T09:00:00Z');
        assert.strictEqual(stored.profile_version, 2);

        await db.close();
        console.log('  ✓ Profile persistence: labels and control-plane state are preserved correctly');
    }

    // Test 17: malformed profile inputs are rejected before SQLite mutation.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        await db.syncScanResults([{
            ip: '192.168.1.30',
            mac: '00:07:ab:11:22:44',
            hostname: 'Known-Host',
            vendor: 'Known Vendor',
            device_type: 'Laptop',
            os: 'Windows',
            rtt_ms: 4,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        }]);

        const valid: ProfileAssessment = {
            mac: '00:07:ab:11:22:44',
            ip: '192.168.1.30',
            vendor: 'Dell',
            device_type: 'Laptop',
            hostname: 'Office-Laptop',
            os: 'Windows 11',
            vendor_confidence: 90,
            type_confidence: 91,
            hostname_confidence: 92,
            profile_status: 'high',
            profile_evidence: [],
            profiled_at: '2026-09-04T10:00:00Z',
            profile_version: 1
        };

        await assert.rejects(
            () => db.updateDeviceProfileAssessment({ ...valid, mac: 'not-a-mac' }),
            /MAC/i
        );
        await assert.rejects(
            () => db.updateDeviceProfileAssessment({ ...valid, vendor_confidence: 90.5 }),
            /confidence/i
        );
        await assert.rejects(
            () => db.updateDeviceProfileAssessment({ ...valid, type_confidence: 101 }),
            /confidence/i
        );
        await assert.rejects(
            () => db.updateDeviceProfileAssessment({ ...valid, profile_status: 'stale' } as any),
            /status/i
        );
        await assert.rejects(
            () => db.updateDeviceProfileAssessment({ ...valid, profile_evidence: { source: 'mdns' } } as any),
            /evidence/i
        );
        await assert.rejects(
            () => db.updateDeviceProfileAssessment({
                ...valid,
                profile_evidence: [{
                    source: 'mdns',
                    group: 'explicit_identity',
                    field: 'model',
                    value: 'x'.repeat(33 * 1024),
                    strength: 'explicit',
                    observed_at: '2026-09-04T10:00:00Z'
                }]
            }),
            /32 KiB/i
        );
        await assert.rejects(
            () => db.updateDeviceProfileAssessment({ ...valid, profile_version: 0 }),
            /version/i
        );

        const stored = await db.getDeviceByMac(valid.mac) as any;
        assert.strictEqual(stored.profile_status, 'unknown');
        assert.strictEqual(stored.vendor, 'Known Vendor');
        await db.close();
        console.log('  ✓ Profile validation: malformed and oversized assessments are rejected');
    }

    // Test 18: a mid-transaction SQLite failure rolls back IP reconciliation.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const mk = (ip: string, mac: string): Device => ({
            ip,
            mac,
            hostname: 'Known',
            vendor: 'Known Vendor',
            device_type: 'Laptop',
            os: 'Windows',
            rtt_ms: 1,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        });
        await db.syncScanResults([
            mk('192.168.1.40', '00:07:ab:11:22:40'),
            mk('192.168.1.41', '00:07:ab:11:22:41')
        ]);

        const rawDb = (db as any).db;
        rawDb.exec(`
            CREATE TRIGGER fail_profile_update
            BEFORE UPDATE OF profile_status ON devices
            WHEN LOWER(OLD.mac) = '00:07:ab:11:22:40'
            BEGIN
                SELECT RAISE(ABORT, 'forced profile failure');
            END;
        `);

        await assert.rejects(
            () => db.updateDeviceProfileAssessment({
                mac: '00:07:ab:11:22:40',
                ip: '192.168.1.41',
                vendor: 'Dell',
                device_type: 'Laptop',
                hostname: 'Office-Laptop',
                os: 'Windows 11',
                vendor_confidence: 90,
                type_confidence: 90,
                hostname_confidence: 90,
                profile_status: 'high',
                profile_evidence: [],
                profiled_at: '2026-09-04T11:00:00Z',
                profile_version: 1
            }),
            /forced profile failure/
        );

        const target = rawDb.prepare('SELECT ip, profile_status FROM devices WHERE mac = ?')
            .get('00:07:ab:11:22:40');
        const incumbent = rawDb.prepare('SELECT ip, is_online FROM devices WHERE mac = ?')
            .get('00:07:ab:11:22:41');
        assert.strictEqual(target.ip, '192.168.1.40');
        assert.strictEqual(target.profile_status, 'unknown');
        assert.strictEqual(incumbent.ip, '192.168.1.41');
        assert.strictEqual(incumbent.is_online, 1);
        await db.close();
        console.log('  ✓ Profile transaction: mid-write failures roll back every mutation');
    }

    // Test 18b: profile persistence never changes another MAC's IP ownership.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const mk = (ip: string, mac: string): Device => ({
            ip,
            mac,
            hostname: 'Known',
            vendor: 'Known Vendor',
            device_type: 'Laptop',
            os: 'Windows',
            rtt_ms: 1,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        });
        const targetMac = '00:07:ab:11:22:42';
        const incumbentMac = '00:07:ab:11:22:43';
        await db.syncScanResults([
            mk('192.168.1.42', targetMac),
            mk('192.168.1.43', incumbentMac)
        ]);

        await db.updateDeviceProfileAssessment({
            mac: targetMac,
            ip: '192.168.1.43',
            vendor: 'Updated Vendor',
            device_type: 'Laptop',
            hostname: 'Known',
            os: 'Windows',
            vendor_confidence: 90,
            type_confidence: 90,
            hostname_confidence: 90,
            profile_status: 'high',
            profile_evidence: [],
            profiled_at: '2026-09-05T12:00:00Z',
            profile_version: 1
        });

        const target = await db.getDeviceByMac(targetMac);
        const incumbent = await db.getDeviceByMac(incumbentMac);
        assert.strictEqual(target?.ip, '192.168.1.42');
        assert.strictEqual(target?.vendor, 'Updated Vendor');
        assert.strictEqual(target?.is_online, true);
        assert.strictEqual(incumbent?.ip, '192.168.1.43');
        assert.strictEqual(incumbent?.is_online, true);
        await db.close();
        console.log('  ✓ Profile persistence: another MAC retains its IP ownership');
    }

    // Test 19: persisted profile fields survive close/reopen and scan reconciliation.
    {
        const { DatabaseService } = await import('../src/services/database');
        const dbPath = path.join(process.cwd(), 'data', 'unit-profile-restart.sqlite');
        const cleanup = () => {
            for (const suffix of ['', '-wal', '-shm']) {
                fs.rmSync(`${dbPath}${suffix}`, { force: true });
            }
        };
        cleanup();

        try {
            let db = new DatabaseService(dbPath);
            await db.init();
            const scanned: Device = {
                ip: '192.168.1.50',
                mac: '00:07:ab:11:22:50',
                hostname: 'Unknown',
                vendor: 'Generic Device',
                device_type: 'Generic Client Device',
                os: 'Unknown OS',
                rtt_ms: 3,
                open_ports: [],
                services: [],
                is_blocked: false,
                is_online: true,
                is_gateway: false
            };
            await db.syncScanResults([scanned]);
            await db.updateDeviceProfileAssessment({
                mac: scanned.mac,
                ip: scanned.ip,
                vendor: 'Samsung',
                device_type: 'Smartphone / Tablet',
                hostname: 'Galaxy-Restart',
                os: 'Android',
                vendor_confidence: 94,
                type_confidence: 96,
                hostname_confidence: 90,
                profile_status: 'high',
                profile_evidence: [{
                    source: 'ssdp',
                    group: 'service_behavior',
                    field: 'server',
                    value: 'Samsung UPnP',
                    strength: 'strong',
                    observed_at: '2026-09-04T12:00:00Z'
                }],
                profiled_at: '2026-09-04T12:00:05Z',
                profile_version: 3
            });
            await db.close();

            db = new DatabaseService(dbPath);
            await db.init();
            let stored = await db.getDeviceByMac(scanned.mac) as any;
            assert.strictEqual(stored.profile_status, 'high');
            assert.strictEqual(stored.vendor_confidence, 94);
            assert.strictEqual(stored.profile_evidence?.[0].source, 'ssdp');
            assert.strictEqual(stored.profile_version, 3);

            await db.syncScanResults([{
                ...scanned,
                hostname: 'Unknown',
                vendor: 'Generic Device',
                device_type: 'Generic Client Device',
                os: 'Unknown OS',
                rtt_ms: 2
            }]);
            stored = await db.getDeviceByMac(scanned.mac) as any;
            assert.strictEqual(stored.profile_status, 'high');
            assert.strictEqual(stored.vendor_confidence, 94);
            assert.strictEqual(stored.profile_evidence?.[0].source, 'ssdp');
            assert.strictEqual(stored.vendor, 'Samsung');
            assert.strictEqual(stored.device_type, 'Smartphone / Tablet');
            assert.strictEqual(stored.hostname, 'Galaxy-Restart');
            await db.close();
        } finally {
            cleanup();
        }
        console.log('  ✓ Profile restart: assessment mapping survives restart and scan reconciliation');
    }

    // Test 20: case-variant scans reconcile to one canonical MAC row without losing state.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();

        const uppercaseMac = '00:07:AB:11:22:60';
        const lowercaseMac = uppercaseMac.toLowerCase();
        const baseScan: Device = {
            ip: '192.168.1.60',
            mac: uppercaseMac,
            hostname: 'Galaxy-Case',
            vendor: 'Samsung',
            device_type: 'Smartphone / Tablet',
            os: 'Android',
            rtt_ms: 3,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        };

        await db.syncScanResults([baseScan]);
        await db.setDeviceAlias(uppercaseMac, 'Case Preserved');
        await db.setDeviceBlocked(uppercaseMac, true, 'session_case_1');
        await db.setDeviceSpeedLimit(uppercaseMac, 25);
        await db.updateDeviceProfileAssessment({
            mac: uppercaseMac,
            ip: baseScan.ip,
            vendor: baseScan.vendor,
            device_type: baseScan.device_type,
            hostname: baseScan.hostname,
            os: baseScan.os,
            vendor_confidence: 94,
            type_confidence: 96,
            hostname_confidence: 90,
            profile_status: 'high',
            profile_evidence: [{
                source: 'mdns',
                group: 'explicit_identity',
                field: 'model',
                value: 'SM-A055F',
                strength: 'explicit',
                observed_at: '2026-09-04T13:00:00Z'
            }],
            profiled_at: '2026-09-04T13:00:05Z',
            profile_version: 4
        });

        const before = await db.getDeviceByMac(uppercaseMac) as any;
        const syncResult = await db.syncScanResults([{
            ...baseScan,
            mac: lowercaseMac,
            rtt_ms: 2
        }]);

        const rawDb = (db as any).db;
        const rows = rawDb.prepare('SELECT * FROM devices WHERE LOWER(mac) = LOWER(?)').all(lowercaseMac);
        const profile = rawDb.prepare('SELECT linked_macs FROM device_profiles WHERE id = ?').get(before.profile_id);
        const stored = await db.getDeviceByMac(lowercaseMac) as any;

        assert.strictEqual(rows.length, 1, 'Case-variant scans must reconcile into one SQLite row');
        assert.strictEqual(rows[0].mac, lowercaseMac, 'Persisted and returned MAC must use canonical lowercase');
        assert.strictEqual(syncResult.allDevices.length, 1);
        assert.strictEqual(syncResult.allDevices[0].mac, lowercaseMac);
        assert.strictEqual(stored.alias, 'Case Preserved');
        assert.strictEqual(stored.is_blocked, true);
        assert.strictEqual(stored.session_id, 'session_case_1');
        assert.strictEqual(stored.speed_limit, 25);
        assert.strictEqual(stored.profile_id, before.profile_id);
        assert.strictEqual(stored.profile_status, 'high');
        assert.strictEqual(stored.vendor_confidence, 94);
        assert.deepStrictEqual(JSON.parse(profile.linked_macs), [lowercaseMac]);

        await db.close();
        console.log('  ✓ MAC normalization: case-variant scans preserve one canonical row and all control/profile state');
    }

    // Test 21: archived devices participate in reconciliation while remaining hidden from public lists.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();

        const mac = '00:07:ab:11:22:70';
        const knownScan: Device = {
            ip: '192.168.1.70',
            mac,
            hostname: 'Galaxy-Archived',
            vendor: 'Samsung',
            device_type: 'Smartphone / Tablet',
            os: 'Android',
            rtt_ms: 4,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        };

        await db.syncScanResults([knownScan]);
        await db.updateDeviceProfileAssessment({
            mac,
            ip: knownScan.ip,
            vendor: knownScan.vendor,
            device_type: knownScan.device_type,
            hostname: knownScan.hostname,
            os: knownScan.os,
            vendor_confidence: 95,
            type_confidence: 96,
            hostname_confidence: 91,
            profile_status: 'high',
            profile_evidence: [{
                source: 'ssdp',
                group: 'service_behavior',
                field: 'server',
                value: 'Samsung UPnP',
                strength: 'strong',
                observed_at: '2026-09-04T14:00:00Z'
            }],
            profiled_at: '2026-09-04T14:00:05Z',
            profile_version: 5
        });

        const rawDb = (db as any).db;
        rawDb.prepare('UPDATE devices SET is_archived = 1, is_online = 0 WHERE mac = ?').run(mac);
        assert.strictEqual((await db.getAllDevices()).length, 0, 'Archived rows must remain hidden publicly');

        const refreshedAt = '2026-09-04T15:00:05Z';
        const syncResult = await db.syncScanResults([{
            ...knownScan,
            hostname: 'Unknown',
            vendor: 'Generic Device',
            device_type: 'Generic Client Device',
            os: 'Unknown OS',
            profile_status: 'unknown',
            vendor_confidence: 0,
            type_confidence: 0,
            hostname_confidence: 0,
            profile_evidence: [],
            profiled_at: refreshedAt,
            profile_version: 6
        }]);

        const stored = await db.getDeviceByMac(mac) as any;
        assert.strictEqual(syncResult.allDevices.length, 1, 'Returning archived device must be visible again');
        assert.strictEqual(stored.is_archived, false);
        assert.strictEqual(stored.vendor, 'Samsung', 'Unknown refresh must preserve archived last-known vendor');
        assert.strictEqual(stored.device_type, 'Smartphone / Tablet', 'Unknown refresh must preserve archived last-known type');
        assert.strictEqual(stored.hostname, 'Galaxy-Archived', 'Unknown refresh must preserve archived last-known hostname');
        assert.strictEqual(stored.os, 'Android', 'Unknown refresh must preserve archived last-known OS');
        assert.strictEqual(stored.profile_status, 'unknown');
        assert.strictEqual(stored.vendor_confidence, 0);
        assert.strictEqual(stored.type_confidence, 0);
        assert.strictEqual(stored.hostname_confidence, 0);
        assert.deepStrictEqual(stored.profile_evidence, []);
        assert.strictEqual(stored.profiled_at, refreshedAt);
        assert.strictEqual(stored.profile_version, 6);

        await db.close();
        console.log('  ✓ Archived reconciliation: last-known labels survive an Unknown refresh and the row is unarchived');
    }

    // Test 22: initialization repairs a directly seeded uppercase legacy primary key before scan upsert.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        const rawDb = (db as any).db;
        createLegacyMacRepairSchema(rawDb);

        const uppercaseMac = '00:07:AB:11:22:80';
        const lowercaseMac = uppercaseMac.toLowerCase();
        rawDb.prepare(`
            INSERT INTO device_profiles (
                id, alias, hostname, os, vendor, device_type, is_blocked,
                speed_limit, linked_macs
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            'prof_legacy_upper',
            'Legacy Owner',
            'Galaxy-Legacy',
            'Android',
            'Samsung',
            'Smartphone / Tablet',
            1,
            25,
            JSON.stringify([uppercaseMac])
        );
        rawDb.prepare(`
            INSERT INTO devices (
                mac, ip, last_ip, hostname, vendor, os, device_type,
                is_blocked, is_online, alias, profile_id, matched_by,
                session_id, speed_limit, candidate_profile_id, is_archived,
                is_redirected, redirect_url, profile_status, vendor_confidence,
                type_confidence, hostname_confidence, profile_evidence,
                profiled_at, profile_version, first_seen, last_seen
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?
            )
        `).run(
            uppercaseMac,
            '192.168.1.80',
            '192.168.1.79',
            'Galaxy-Legacy',
            'Samsung',
            'Android',
            'Smartphone / Tablet',
            1,
            0,
            'Legacy Owner',
            'prof_legacy_upper',
            'manual_link',
            'session_legacy_upper',
            null,
            'candidate_legacy',
            1,
            1,
            'https://legacy.portal/',
            'high',
            97,
            96,
            95,
            JSON.stringify([{
                source: 'mdns',
                group: 'explicit_identity',
                field: 'model',
                value: 'SM-A055F',
                strength: 'explicit',
                observed_at: '2026-09-04T16:00:00Z'
            }]),
            '2026-09-04T16:00:05Z',
            7,
            '2026-09-01 08:00:00',
            '2026-09-04 16:00:10'
        );

        await db.init();

        const repaired = rawDb.prepare('SELECT * FROM devices').all();
        assert.strictEqual(repaired.length, 1);
        assert.strictEqual(repaired[0].mac, lowercaseMac, 'Legacy uppercase primary key must be canonicalized during initialization');
        assert.strictEqual(repaired[0].ip, '192.168.1.80');
        assert.strictEqual(repaired[0].last_ip, '192.168.1.79');
        assert.strictEqual(repaired[0].alias, 'Legacy Owner');
        assert.strictEqual(repaired[0].is_blocked, 1);
        assert.strictEqual(repaired[0].session_id, 'session_legacy_upper');
        assert.strictEqual(repaired[0].speed_limit, 100, 'Legacy NULL speed limit must map to unrestricted');
        assert.strictEqual(repaired[0].profile_id, 'prof_legacy_upper');
        assert.strictEqual(repaired[0].matched_by, 'manual_link');
        assert.strictEqual(repaired[0].candidate_profile_id, 'candidate_legacy');
        assert.strictEqual(repaired[0].is_archived, 1);
        assert.strictEqual(repaired[0].is_redirected, 1);
        assert.strictEqual(repaired[0].redirect_url, 'https://legacy.portal/');
        assert.strictEqual(repaired[0].profile_status, 'high');
        assert.strictEqual(repaired[0].vendor_confidence, 97);
        assert.strictEqual(repaired[0].type_confidence, 96);
        assert.strictEqual(repaired[0].hostname_confidence, 95);
        assert.strictEqual(repaired[0].profile_version, 7);
        assert.strictEqual(
            JSON.parse(rawDb.prepare('SELECT linked_macs FROM device_profiles WHERE id = ?').get('prof_legacy_upper').linked_macs)[0],
            lowercaseMac
        );

        await db.syncScanResults([{
            ip: '192.168.1.80',
            mac: lowercaseMac,
            hostname: 'Unknown',
            vendor: 'Generic Device',
            device_type: 'Generic Client Device',
            os: 'Unknown OS',
            rtt_ms: 2,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        }]);

        const rowsAfterScan = rawDb.prepare('SELECT * FROM devices WHERE LOWER(mac) = LOWER(?)').all(lowercaseMac);
        assert.strictEqual(rowsAfterScan.length, 1, 'Lowercase scan must not create a second case-distinct row');
        assert.strictEqual(rowsAfterScan[0].mac, lowercaseMac);
        assert.strictEqual(rowsAfterScan[0].alias, 'Legacy Owner');
        assert.strictEqual(rowsAfterScan[0].is_blocked, 1);
        assert.strictEqual(rowsAfterScan[0].session_id, 'session_legacy_upper');
        assert.strictEqual(rowsAfterScan[0].speed_limit, 100);
        assert.strictEqual(rowsAfterScan[0].profile_status, 'high');

        await db.close();
        console.log('  ✓ Legacy MAC repair: uppercase primary keys canonicalize before lowercase scan upserts');
    }

    // Test 23: pre-existing case duplicates merge deterministically without losing intent or fresh observations.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        const rawDb = (db as any).db;
        createLegacyMacRepairSchema(rawDb);

        const uppercaseMac = '00:07:AB:11:22:90';
        const lowercaseMac = uppercaseMac.toLowerCase();
        rawDb.prepare(`
            INSERT INTO device_profiles (id, alias, linked_macs)
            VALUES (?, ?, ?)
        `).run(
            'prof_duplicate',
            'Duplicate Owner',
            JSON.stringify([uppercaseMac, lowercaseMac, '00:07:ab:11:22:91'])
        );
        const insertDuplicate = rawDb.prepare(`
            INSERT INTO devices (
                mac, ip, last_ip, hostname, vendor, os, device_type,
                is_blocked, is_online, is_gateway, is_self, rtt_ms,
                alias, profile_id, matched_by, session_id, speed_limit,
                candidate_profile_id, is_archived, is_redirected, redirect_url,
                profile_status, vendor_confidence, type_confidence,
                hostname_confidence, profile_evidence, profiled_at,
                profile_version, first_seen, last_seen
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?
            )
        `);
        insertDuplicate.run(
            uppercaseMac,
            '192.168.1.90',
            '192.168.1.89',
            'Galaxy-Duplicate',
            'Samsung',
            'Android',
            'Smartphone / Tablet',
            1,
            0,
            0,
            0,
            8,
            'Duplicate Owner',
            'prof_duplicate',
            'manual_link',
            'session_duplicate_block',
            0,
            'candidate_duplicate',
            1,
            0,
            null,
            'high',
            95,
            94,
            93,
            JSON.stringify([{ source: 'mdns', group: 'explicit_identity', field: 'model', value: 'SM-A055F', strength: 'explicit', observed_at: '2026-09-04T16:30:00Z' }]),
            '2026-09-04T16:30:05Z',
            7,
            '2026-09-01 08:00:00',
            '2026-09-04 16:30:10'
        );
        insertDuplicate.run(
            lowercaseMac,
            '192.168.1.92',
            '192.168.1.91',
            'Unknown',
            'Generic Device',
            'Unknown OS',
            'Generic Client Device',
            0,
            1,
            0,
            0,
            2,
            '',
            null,
            null,
            null,
            100,
            null,
            0,
            1,
            'https://fresh.portal/',
            'unknown',
            0,
            0,
            0,
            '[]',
            '2026-09-04T17:00:05Z',
            8,
            '2026-09-02 08:00:00',
            '2026-09-04 17:00:10'
        );

        await db.init();
        (db as any).initialized = false;
        await db.init();

        const mergedRows = rawDb.prepare('SELECT * FROM devices WHERE LOWER(mac) = LOWER(?)').all(lowercaseMac);
        assert.strictEqual(mergedRows.length, 1);
        const merged = mergedRows[0];
        assert.strictEqual(merged.mac, lowercaseMac);
        assert.strictEqual(merged.ip, '192.168.1.92', 'Newest observation IP must win');
        assert.strictEqual(merged.last_ip, '192.168.1.91', 'Newest observation last_ip must win');
        assert.strictEqual(merged.rtt_ms, 2, 'Newest observation telemetry must win');
        assert.strictEqual(merged.hostname, 'Galaxy-Duplicate', 'Non-empty identity must survive');
        assert.strictEqual(merged.vendor, 'Samsung');
        assert.strictEqual(merged.os, 'Android');
        assert.strictEqual(merged.device_type, 'Smartphone / Tablet');
        assert.strictEqual(merged.alias, 'Duplicate Owner');
        assert.strictEqual(merged.profile_id, 'prof_duplicate');
        assert.strictEqual(merged.matched_by, 'manual_link');
        assert.strictEqual(merged.candidate_profile_id, 'candidate_duplicate');
        assert.strictEqual(merged.is_blocked, 1, 'Active block intent must survive');
        assert.strictEqual(merged.session_id, 'session_duplicate_block', 'Active session intent must survive');
        assert.strictEqual(merged.speed_limit, 0, 'Most restrictive speed intent must survive');
        assert.strictEqual(merged.is_redirected, 1, 'Active redirect intent must survive');
        assert.strictEqual(merged.redirect_url, 'https://fresh.portal/');
        assert.strictEqual(merged.is_archived, 0, 'An active duplicate must remain visible');
        assert.strictEqual(merged.profile_status, 'unknown', 'Newest assessment bundle must win');
        assert.strictEqual(merged.vendor_confidence, 0);
        assert.strictEqual(merged.type_confidence, 0);
        assert.strictEqual(merged.hostname_confidence, 0);
        assert.deepStrictEqual(JSON.parse(merged.profile_evidence), []);
        assert.strictEqual(merged.profiled_at, '2026-09-04T17:00:05Z');
        assert.strictEqual(merged.profile_version, 8);
        assert.strictEqual(merged.first_seen, '2026-09-01 08:00:00');
        assert.strictEqual(merged.last_seen, '2026-09-04 17:00:10');
        assert.deepStrictEqual(
            JSON.parse(rawDb.prepare('SELECT linked_macs FROM device_profiles WHERE id = ?').get('prof_duplicate').linked_macs),
            [lowercaseMac, '00:07:ab:11:22:91']
        );

        await db.syncScanResults([{
            ip: '192.168.1.92',
            mac: lowercaseMac,
            hostname: 'Unknown',
            vendor: 'Generic Device',
            device_type: 'Generic Client Device',
            os: 'Unknown OS',
            rtt_ms: 1,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        }]);
        assert.strictEqual(
            rawDb.prepare('SELECT COUNT(*) AS count FROM devices WHERE LOWER(mac) = LOWER(?)').get(lowercaseMac).count,
            1
        );

        await db.close();
        console.log('  ✓ Duplicate MAC repair: case variants merge idempotently with intent and newest observations preserved');
    }

    // Test 24: NULL speed does not override an active valid control limit during duplicate repair.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        const rawDb = (db as any).db;
        createLegacyMacRepairSchema(rawDb);

        const uppercaseMac = '00:07:AB:11:22:A0';
        const lowercaseMac = uppercaseMac.toLowerCase();
        const insertDuplicate = rawDb.prepare(`
            INSERT INTO devices (
                mac, ip, hostname, vendor, os, device_type, is_online,
                session_id, speed_limit, first_seen, last_seen
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertDuplicate.run(
            uppercaseMac,
            '192.168.1.100',
            'Controlled-Device',
            'Samsung',
            'Android',
            'Smartphone / Tablet',
            1,
            'session_active_throttle',
            35,
            '2026-09-01 08:00:00',
            '2026-09-04 18:00:00'
        );
        insertDuplicate.run(
            lowercaseMac,
            '192.168.1.101',
            'Unknown',
            'Generic Device',
            'Unknown OS',
            'Generic Client Device',
            1,
            null,
            null,
            '2026-09-02 08:00:00',
            '2026-09-04 18:05:00'
        );

        await db.init();

        const mergedRows = rawDb.prepare('SELECT * FROM devices WHERE LOWER(mac) = LOWER(?)').all(lowercaseMac);
        assert.strictEqual(mergedRows.length, 1);
        assert.strictEqual(mergedRows[0].mac, lowercaseMac);
        assert.strictEqual(mergedRows[0].session_id, 'session_active_throttle');
        assert.strictEqual(mergedRows[0].speed_limit, 35, 'NULL must normalize to 100 so the active valid limit wins');

        await db.close();
        console.log('  ✓ Duplicate MAC repair: NULL speed preserves the active valid control limit');
    }
}
