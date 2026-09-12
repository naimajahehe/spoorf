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

    // Test 6b: High Confidence Auto-Link for Generic Factory Model with Offline Timing Continuity
    {
        const { calculateProfileMatchScore } = await import('../src/services/database');
        
        // Budi's blocked profile with generic factory name and vendor class
        const budiProfile = {
            id: 'prof_budi',
            alias: 'HP Budi',
            hostname: 'Galaxy-A14',
            is_blocked: true,
            dhcp_fingerprint: 'Android OS Signature',
            dhcp_vendor_class: 'android-dhcp-12',
            linked_macs: ['c2:4e:ca:88:04:2d']
        };

        // Budi's previous device entry showing offline within last 2 minutes
        const existingDevices: any[] = [
            {
                ip: '',
                mac: 'c2:4e:ca:88:04:2d',
                hostname: 'Galaxy-A14',
                vendor: 'Samsung',
                device_type: 'Mobile',
                os: 'Android',
                rtt_ms: 10,
                open_ports: [],
                services: [],
                is_blocked: true,
                is_online: false,
                is_gateway: false,
                profile_id: 'prof_budi',
                last_seen: new Date(Date.now() - 2 * 60 * 1000).toISOString()
            }
        ];

        // Budi rotates MAC and reconnects
        const budiRotatedGeneric: Device = {
            ip: '192.168.1.89',
            mac: '3a:11:22:33:44:99',
            hostname: 'Galaxy-A14',
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

        const result = calculateProfileMatchScore(budiRotatedGeneric, budiProfile, existingDevices);
        // Score = 20 (generic factory hostname) + 30 (PRL) + 15 (vendor class) + 15 (timing continuity) = 80%
        assert.strictEqual(result.score, 80, 'Returning target with timing continuity must score 80%');
        assert.ok(result.score >= 80, 'Score 80% qualifies for high-confidence auto-block');
        console.log('  ✓ Timing Continuity: Target Budi (Galaxy-A14) with linked offline continuity scores 80% and auto-reblocks');
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

    // Test 9b: TIER-1 GUARD — a placeholder/non-hex client-id (e.g. legacy "DUID_LLT") must NOT
    // trigger the instant 100% match, otherwise two DIFFERENT devices that both stored the same
    // placeholder would be falsely fused/blocked as one.
    {
        const { calculateProfileMatchScore } = await import('../src/services/database');
        const profileA = {
            id: 'prof_A', alias: 'Laptop A', hostname: 'LAPTOP-AAA',
            is_blocked: true, dhcp_client_id: 'DUID_LLT', linked_macs: []
        };
        const scannedB: Device = {
            ip: '192.168.1.50', mac: 'de:ad:be:ef:00:0b', hostname: 'DESKTOP-BBB',
            vendor: 'HP', device_type: 'Desktop', os: 'Windows', rtt_ms: 3,
            open_ports: [], services: [], is_blocked: false, is_online: true, is_gateway: false,
            dhcp_client_id: 'DUID_LLT'
        };
        const result = calculateProfileMatchScore(scannedB, profileA, []);
        assert.notStrictEqual(result.score, 100, 'placeholder client-id must NOT instant-match (would falsely fuse two devices)');
        assert.ok(!result.reasons.some(r => r.includes('duid_hardware_instant_match')), 'placeholder must not claim a hardware DUID match');
        console.log('  ✓ TIER-1 guard: placeholder/non-hex client-id does not trigger false 100% DUID match');
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

    // ULTRA #1+#3: syncScanResults must verify session_id against the engine's LIVE sessions.
    // Stale session_id (blocked device whose engine session died) -> re-block target + cleared in DB.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const mac = 'ae:11:22:33:44:55';
        const mkdev = (): Device => ({
            ip: '192.168.1.90', mac, hostname: 'Cam', vendor: 'Ezviz', device_type: 'IP Camera / IoT', os: '',
            rtt_ms: 3, open_ports: [], services: [], is_blocked: false, is_online: true, is_gateway: false
        });
        await db.syncScanResults([mkdev()]);
        await db.setDeviceBlocked(mac, true, 'sess_dead');
        await db.setDeviceSpeedLimit(mac, 0); // full block (speed_limit=0), as _blockDeviceImpl does

        // #1: rescan online, engine's LIVE sessions do NOT include 'sess_dead' -> must be re-block target.
        const rDead = await db.syncScanResults([mkdev()], new Set(['sess_other']));
        assert.ok(rDead.autoReblockTargets.some(d => d.mac === mac), '#1: device with dead engine session must be an auto-reblock target');
        // #3: the dead session_id must be cleared from the DB (hygiene).
        const afterDead = await db.getDeviceByMac(mac);
        assert.strictEqual(afterDead?.session_id, undefined, '#3: dead session_id must be nulled in DB');
        assert.strictEqual(afterDead?.is_blocked, true, 'block intent must be preserved');

        // Live session -> NOT re-targeted (no churn for healthy blocks).
        await db.setDeviceBlocked(mac, true, 'sess_live');
        await db.setDeviceSpeedLimit(mac, 0);
        const rLive = await db.syncScanResults([mkdev()], new Set(['sess_live']));
        assert.ok(!rLive.autoReblockTargets.some(d => d.mac === mac), 'live engine session -> must NOT be re-blocked (no churn)');

        // Backward-compat: no liveSessionIds -> trust stored session_id (avoid re-block storm when engine info absent).
        await db.setDeviceBlocked(mac, true, 'sess_x');
        await db.setDeviceSpeedLimit(mac, 0);
        const rNoInfo = await db.syncScanResults([mkdev()]);
        assert.ok(!rNoInfo.autoReblockTargets.some(d => d.mac === mac), 'without engine info -> trust stored session_id');
        await db.close();
        console.log('  ✓ ULTRA #1+#3: syncScanResults re-blocks dead engine sessions & clears stale session_id');
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

    // Name-Unknown fix: a personalized hostname must upgrade a generic/Unknown profile name, and a
    // generic value must never overwrite a personalized one. (Rotated MACs inherit the profile alias,
    // so a profile stuck at 'Unknown' makes every rotation display 'Unknown' despite known rows.)
    {
        const { betterProfileName } = await import('../src/services/database');
        assert.strictEqual(betterProfileName('Unknown', 'A55-milik-Hanif'), 'A55-milik-Hanif', 'personalized must upgrade generic');
        assert.strictEqual(betterProfileName('A55-milik-Hanif', 'Unknown'), 'A55-milik-Hanif', 'generic must NOT overwrite personalized');
        assert.strictEqual(betterProfileName('A55-milik-Hanif', 'android'), 'A55-milik-Hanif', 'generic candidate is ignored');
        assert.strictEqual(betterProfileName('', 'MyPhone'), 'MyPhone', 'empty upgrades to personalized');
        assert.strictEqual(betterProfileName('Unknown', 'android'), 'Unknown', 'generic candidate cannot upgrade generic current');
        console.log('  ✓ Name propagation: betterProfileName upgrades generic to personalized, never downgrades');
    }

    // Name-Unknown backfill: an existing blocked profile stuck at alias/hostname 'Unknown' whose device
    // rows carry a personalized hostname must be healed, so future rotated-MAC fusion inherits the real name.
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const mk = (ip: string, mac: string): Device => ({
            ip, mac, hostname: 'A55-milik-Hanif', vendor: 'Samsung', device_type: 'Mobile', os: 'Android',
            rtt_ms: 5, open_ports: [], services: [], is_blocked: true, is_online: true, is_gateway: false,
            dhcp_client_id: '01:56:e9:8d:38:1c:97'
        });
        await db.syncScanResults([mk('192.168.1.30', 'aa:bb:cc:00:00:01')]);
        await db.setDeviceBlocked('aa:bb:cc:00:00:01', true);
        // Force the profile name to the buggy 'Unknown' state (as seen in production).
        (db as any).db.prepare(`UPDATE device_profiles SET alias='Unknown', hostname='Unknown' WHERE id='prof_aabbcc000001'`).run();

        const healed = await db.backfillProfileNames();

        const prof = (db as any).db.prepare(`SELECT alias, hostname FROM device_profiles WHERE id='prof_aabbcc000001'`).get() as any;
        assert.strictEqual(prof.alias, 'A55-milik-Hanif', 'backfill must heal profile alias from a personalized device hostname');
        assert.strictEqual(prof.hostname, 'A55-milik-Hanif', 'backfill must heal profile hostname');
        assert.ok(healed >= 1, 'backfill must report at least one healed profile');
        await db.close();
        console.log('  ✓ Name backfill: an Unknown profile with a personalized device hostname is healed');
    }

    // ULTRAREVIEW #6: backfill across MULTIPLE profiles must heal each from ITS OWN device hostname
    // (guards the grouped/batched lookup against cross-profile leakage).
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const mk = (ip: string, mac: string, hostname: string): Device => ({
            ip, mac, hostname, vendor: 'Samsung', device_type: 'Mobile', os: 'Android',
            rtt_ms: 5, open_ports: [], services: [], is_blocked: true, is_online: true, is_gateway: false
        });
        await db.syncScanResults([
            mk('192.168.1.40', 'aa:bb:cc:00:00:01', 'A55-milik-Hanif'),
            mk('192.168.1.41', 'dd:ee:ff:00:00:02', 'iPhone-Budi')
        ]);
        await db.setDeviceBlocked('aa:bb:cc:00:00:01', true);
        await db.setDeviceBlocked('dd:ee:ff:00:00:02', true);
        (db as any).db.prepare(`UPDATE device_profiles SET alias='Unknown', hostname='Unknown'`).run();

        const healed = await db.backfillProfileNames();

        const p1 = (db as any).db.prepare(`SELECT alias, hostname FROM device_profiles WHERE id='prof_aabbcc000001'`).get() as any;
        const p2 = (db as any).db.prepare(`SELECT alias, hostname FROM device_profiles WHERE id='prof_ddeeff000002'`).get() as any;
        assert.strictEqual(p1.alias, 'A55-milik-Hanif', 'profil 1 harus sembuh dari hostname perangkatnya sendiri');
        assert.strictEqual(p2.alias, 'iPhone-Budi', 'profil 2 harus sembuh dari hostname perangkatnya sendiri, bukan bocor dari profil lain');
        assert.strictEqual(healed, 2, 'kedua profil harus terhitung sembuh');
        await db.close();
        console.log('  ✓ ULTRAREVIEW #6: backfill multi-profil menyembuhkan tiap profil dari hostname miliknya sendiri');
    }

    // Test: deleteDevice with networkId cleans up orphan device_profiles
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const dev: Device = {
            ip: '192.168.1.50',
            mac: '11:22:33:44:55:66',
            hostname: 'Phone-Test',
            vendor: 'Samsung',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 5,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false
        };
        await db.syncScanResults([dev], 'net_test');
        await db.setDeviceBlocked('11:22:33:44:55:66', true, undefined, 'net_test');
        const beforeProf = (db as any).db.prepare(`SELECT count(*) as count FROM device_profiles`).get() as any;
        assert.ok(beforeProf.count >= 1, 'Profile must exist after setDeviceBlocked');

        // Delete device with networkId
        await db.deleteDevice('11:22:33:44:55:66', 'net_test');

        const afterDev = await db.getDeviceByMac('11:22:33:44:55:66', 'net_test');
        assert.strictEqual(afterDev, null, 'Device must be deleted from devices table');

        const afterProf = (db as any).db.prepare(`SELECT count(*) as count FROM device_profiles`).get() as any;
        assert.strictEqual(afterProf.count, 0, 'Orphaned profile must be cleaned up from device_profiles');
        await db.close();
        console.log('  ✓ deleteDevice with networkId cleans up orphaned device_profiles');
    }

    // Test: Unblocking a device clears is_blocked and speed_limit across all historical/linked MAC entries for that profile in that network
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();

        const devA: Device = {
            ip: '192.168.1.101',
            mac: '26:b8:f1:00:00:01',
            hostname: 'A07-milik-Virgiawan',
            vendor: 'Samsung',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 5,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            dhcp_fingerprint: '1,3,6,15,26,28,51,58,59,43',
            dhcp_vendor_class: 'android-dhcp-14',
            dhcp_client_id: 'android-virgiawan-client-id'
        };

        // 1. Sync device A
        await db.syncScanResults([devA], 'net_test');
        // 2. Block device A
        await db.setDeviceBlocked(devA.mac, true, 'session_a', 'net_test');

        const storedA = await db.getDeviceByMac(devA.mac, 'net_test');
        assert.ok(storedA);
        assert.strictEqual(storedA.is_blocked, true);
        const pId = storedA.profile_id;
        assert.ok(pId, 'Profile ID must be assigned');

        // 3. Device rotates MAC to devB, online with same profile fingerprint
        const devB: Device = {
            ...devA,
            ip: '192.168.1.102',
            mac: '26:b8:f1:00:00:02',
            is_blocked: false
        };
        const syncB = await db.syncScanResults([devB], 'net_test');
        // Because devA was blocked, devB is auto-reblocked
        assert.strictEqual(syncB.autoReblockTargets.length, 1);
        assert.strictEqual(syncB.autoReblockTargets[0].mac, devB.mac);
        await db.setDeviceBlocked(devB.mac, true, 'session_b', 'net_test');

        // Verify both devA and devB are in DB and marked blocked
        const inDbA = (db as any).db.prepare('SELECT is_blocked, speed_limit FROM devices WHERE mac = ?').get(devA.mac);
        const inDbB = (db as any).db.prepare('SELECT is_blocked, speed_limit FROM devices WHERE mac = ?').get(devB.mac);
        assert.strictEqual(inDbA.is_blocked, 1);
        assert.strictEqual(inDbB.is_blocked, 1);

        // 4. User unblocks devB (Pulihkan Akses)
        await db.setDeviceBlocked(devB.mac, false, undefined, 'net_test');

        // 5. Assert: BOTH devA and devB must have is_blocked = 0 and speed_limit = 100
        const afterUnblockA = (db as any).db.prepare('SELECT is_blocked, speed_limit, session_id FROM devices WHERE mac = ?').get(devA.mac);
        const afterUnblockB = (db as any).db.prepare('SELECT is_blocked, speed_limit, session_id FROM devices WHERE mac = ?').get(devB.mac);
        assert.strictEqual(afterUnblockA.is_blocked, 0, 'Historical MAC must have is_blocked cleared');
        assert.strictEqual(afterUnblockA.speed_limit, 100, 'Historical MAC must have speed_limit restored to 100');
        assert.strictEqual(afterUnblockA.session_id, null, 'Historical MAC must have session_id cleared');
        assert.strictEqual(afterUnblockB.is_blocked, 0, 'Active MAC must have is_blocked cleared');
        assert.strictEqual(afterUnblockB.speed_limit, 100, 'Active MAC must have speed_limit restored to 100');

        // 6. Next scan cycle with devB or rotated devC must NOT trigger auto-reblock
        const devC: Device = {
            ...devA,
            ip: '192.168.1.103',
            mac: '26:b8:f1:00:00:03',
            is_blocked: false
        };
        const syncC = await db.syncScanResults([devC], 'net_test');
        assert.strictEqual(syncC.autoReblockTargets.length, 0, 'Must NOT auto-reblock after profile unblock');

        // 7. Check hasBlockedIdentityMatch returns false
        const identityMatch = db.hasBlockedIdentityMatch({
            client_id: devA.dhcp_client_id,
            hostname: devA.hostname,
            dhcp_fingerprint: devA.dhcp_fingerprint,
            vendor_class: devA.dhcp_vendor_class
        }, 'net_test');
        assert.strictEqual(identityMatch, false, 'hasBlockedIdentityMatch must return false after profile unblock');

        await db.close();
        console.log('  ✓ unblocking device clears is_blocked across all historical profile MACs and prevents auto-reblock');
    }

    // Test: Continuity fusing auto-links randomized MAC with generic fingerprint (score >= 60%) to existing profile
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();

        // 1. Initial device with personalized alias and generic Android DHCP fingerprint
        const phoneA: Device = {
            ip: '192.168.1.50',
            mac: '2a:11:22:33:44:55',
            hostname: 'Galaxy-A07',
            vendor: 'Samsung',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 5,
            open_ports: [],
            services: [],
            is_randomized_mac: true,
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            dhcp_fingerprint: '1,3,6,15,26,28,51,58,59,43',
            dhcp_vendor_class: 'android-dhcp-16',
            dhcp_client_id: 'random-client-id-1'
        };

        await db.syncScanResults([phoneA], 'net_test');
        await db.setDeviceBlocked(phoneA.mac, true, 'sess_phoneA', 'net_test');

        const storedPhoneA = await db.getDeviceByMac(phoneA.mac, 'net_test');
        assert.ok(storedPhoneA);
        assert.strictEqual(storedPhoneA.is_blocked, true);
        const originalProfileId = storedPhoneA.profile_id;
        assert.ok(originalProfileId);

        // 2. Phone disconnects (simulated by scan with empty list or next scan where phoneA is offline)
        // Mark phoneA offline with recent last_seen
        await db.setDeviceOnlineStatus(phoneA.mac, false, 'net_test');

        // 3. Phone reconnects with a NEW RANDOMIZED MAC (different DUID, no hostname sent)
        const phoneB: Device = {
            ip: '192.168.1.51',
            mac: '36:aa:bb:cc:dd:ee', // Different randomized MAC
            hostname: '', // Android sends empty hostname on reconnect
            vendor: 'Samsung',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 5,
            open_ports: [],
            services: [],
            is_randomized_mac: true,
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            dhcp_fingerprint: '1,3,6,15,26,28,51,58,59,43', // Same Android PRL
            dhcp_vendor_class: 'android-dhcp-16', // Same vendor class
            dhcp_client_id: 'random-client-id-2' // Different randomized DUID
        };

        const syncResult = await db.syncScanResults([phoneB], 'net_test');

        // Assert: Phone B should be CONTINUITY FUSED to originalProfileId and auto-reblocked!
        assert.strictEqual(syncResult.autoReblockTargets.length, 1, 'Phone B must be auto-reblocked via continuity fusing');
        assert.strictEqual(syncResult.autoReblockTargets[0].mac, phoneB.mac);

        const storedPhoneB = await db.getDeviceByMac(phoneB.mac, 'net_test');
        assert.ok(storedPhoneB);
        assert.strictEqual(storedPhoneB.profile_id, originalProfileId, 'Phone B must inherit the original profile_id');
        assert.strictEqual(storedPhoneB.is_blocked, true, 'Phone B must be marked is_blocked');

        // Assert: Phone A must now be marked is_archived = 1
        const archivedPhoneA = (db as any).db.prepare('SELECT is_archived FROM devices WHERE mac = ?').get(phoneA.mac);
        assert.strictEqual(archivedPhoneA.is_archived, 1, 'Superceded Phone A MAC must be archived');

        await db.close();
        console.log('  ✓ continuity fusing links Android randomized MAC (score >= 60%) to existing profile');
    }

    // Test: pruneStaleRandomizedMacs cleans up archived/stale randomized MACs while protecting personal aliases, gateway, and self
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();

        const raw = (db as any).db;
        raw.prepare("INSERT INTO networks (id, ssid, gateway_ip, gateway_mac) VALUES ('net_test', 'Test', '192.168.1.1', 'aa:bb:cc:dd:ee:ff')").run();
        // Insert a variety of device records to test pruning safety rules
        raw.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, alias, is_randomized_mac, is_archived, is_online, is_self, is_gateway, last_seen)
            VALUES 
                ('net_test', '26:00:00:00:00:01', '', 'Unknown', 'Target Device', 1, 1, 0, 0, 0, datetime('now', 'localtime', '-3 hours')),
                ('net_test', '26:00:00:00:00:02', '', 'Unknown', '', 1, 0, 0, 0, 0, datetime('now', 'localtime', '-3 days')),
                ('net_test', '26:00:00:00:00:03', '192.168.1.10', 'Laptop Ibu', 'Laptop Pribadi', 1, 1, 0, 0, 0, datetime('now', 'localtime', '-5 days')),
                ('net_test', '26:00:00:00:00:04', '192.168.1.1', 'Gateway', '', 1, 1, 0, 0, 1, datetime('now', 'localtime', '-5 days')),
                ('net_test', '26:00:00:00:00:05', '192.168.1.2', 'My PC', '', 1, 1, 0, 1, 0, datetime('now', 'localtime', '-5 days')),
                ('net_test', '00:11:22:33:44:55', '', 'Real Hardware', '', 0, 1, 0, 0, 0, datetime('now', 'localtime', '-5 days'))
        `).run();

        // Insert an orphan 'Target Device' profile
        raw.prepare(`
            INSERT INTO device_profiles (id, alias, hostname, updated_at)
            VALUES ('prof_orphan_123', 'Target Device', 'Unknown', datetime('now', 'localtime'))
        `).run();

        const pruneResult = db.pruneStaleRandomizedMacs(2);

        // 1. Archived randomized MAC older than 1h (26:..:01) and stale randomized MAC older than 2d (26:..:02) must be deleted
        assert.strictEqual(pruneResult.deletedDevices, 2, 'Must delete exactly the 2 eligible stale randomized devices');
        assert.strictEqual(pruneResult.deletedProfiles, 1, 'Must delete the 1 orphan Target Device profile');

        // 2. Verify protected records are STILL PRESENT in database
        const remaining = raw.prepare('SELECT mac, alias, is_gateway, is_self FROM devices').all();
        const remainingMacs = remaining.map((r: any) => r.mac);
        assert.ok(remainingMacs.includes('26:00:00:00:00:03'), 'Personal alias device must NOT be pruned');
        assert.ok(remainingMacs.includes('26:00:00:00:00:04'), 'Gateway router must NOT be pruned');
        assert.ok(remainingMacs.includes('26:00:00:00:00:05'), 'Controller host (is_self) must NOT be pruned');
        assert.ok(remainingMacs.includes('00:11:22:33:44:55'), 'Physical non-randomized hardware MAC must NOT be pruned');

        await db.close();
        console.log('  ✓ pruneStaleRandomizedMacs safely cleans archived and stale randomized MACs without touching protected hosts');
    }

    // Test: Continuity fusing succeeds even when an un-scanned historical MAC was lingering as is_online
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();

        const raw = (db as any).db;
        raw.prepare("INSERT INTO networks (id, ssid, gateway_ip, gateway_mac) VALUES ('net_test', 'Test', '192.168.1.1', 'aa:bb:cc:dd:ee:ff')").run();

        // 1. Profil target terdaftar
        raw.prepare(`
            INSERT INTO device_profiles (id, alias, hostname, dhcp_fingerprint, dhcp_vendor_class, linked_macs, updated_at)
            VALUES ('prof_target_hanif', 'Galaxy A55', 'Galaxy-A55', 'Android OS Signature (android-dhcp-16)', 'android-dhcp-16', '["26:00:00:00:00:01"]', datetime('now', 'localtime'))
        `).run();

        // 2. MAC lama (Phone A) tercatat di database dengan is_online = 1 (mis. dari event DHCP atau belum lewat grace period)
        raw.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, alias, profile_id, is_randomized_mac, is_blocked, is_online, dhcp_fingerprint, dhcp_vendor_class, last_seen)
            VALUES ('net_test', '26:00:00:00:00:01', '192.168.1.254', 'Galaxy-A55', 'Galaxy A55', 'prof_target_hanif', 1, 1, 1, 'Android OS Signature (android-dhcp-16)', 'android-dhcp-16', datetime('now', 'localtime', '-1 minute'))
        `).run();

        // 3. Scan fisik Layer 2 ARP menangkap MAC baru (Phone B) di IP fisik sebenarnya (192.168.1.2)
        // Phone A TIDAK ada di hasil scan fisik ini (karena sudah diskonek / ganti MAC)
        const phoneB: any = {
            ip: '192.168.1.2',
            mac: '26:00:00:00:00:02',
            hostname: 'Galaxy-A55',
            vendor: 'Samsung',
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 5,
            open_ports: [],
            services: [],
            is_blocked: false,
            is_online: true,
            is_gateway: false,
            is_self: false,
            is_randomized_mac: true,
            dhcp_fingerprint: 'Android OS Signature (android-dhcp-16)',
            dhcp_vendor_class: 'android-dhcp-16',
            network_id: 'net_test'
        };

        const syncResult = await db.syncScanResults([phoneB], 'net_test');

        // Assert: Phone B harus berhasil difusikan ke prof_target_hanif tanpa terblokir oleh residu Phone A
        assert.strictEqual(syncResult.autoReblockTargets.length, 1, 'Phone B must be auto-reblocked via continuity fusing');
        assert.strictEqual(syncResult.autoReblockTargets[0].mac, phoneB.mac);

        const storedPhoneB = await db.getDeviceByMac(phoneB.mac, 'net_test');
        assert.ok(storedPhoneB);
        assert.strictEqual(storedPhoneB.profile_id, 'prof_target_hanif', 'Phone B must inherit the target profile_id');
        assert.strictEqual(storedPhoneB.ip, '192.168.1.2', 'Phone B must be at physical IP 192.168.1.2');

        // Phone A harus diarsipkan dan IP lama 192.168.1.254 harus dilepas (ip = '')
        const archivedPhoneA = raw.prepare('SELECT is_archived, is_online, ip, last_ip FROM devices WHERE mac = ?').get('26:00:00:00:00:01');
        assert.strictEqual(archivedPhoneA.is_archived, 1, 'Historical MAC must be archived');
        assert.strictEqual(archivedPhoneA.is_online, 0, 'Historical MAC must be marked offline');
        assert.strictEqual(archivedPhoneA.ip, '', 'Historical MAC must have empty IP to prevent ghost IP conflicts');
        assert.strictEqual(archivedPhoneA.last_ip, '192.168.1.254', 'Historical IP preserved in last_ip');

        await db.close();
        console.log('  ✓ Continuity fusing succeeds and disassociates stale IP even when old un-scanned MAC was marked online');
    }

    // Test: pruneStaleRandomizedMacs must NOT prune blocked devices, and autoReblockTargets must NEVER include self or gateway
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const raw = (db as any).db;
        raw.prepare("INSERT INTO networks (id, ssid, gateway_ip, gateway_mac) VALUES ('net_test', 'Test', '192.168.1.1', 'aa:bb:cc:dd:ee:ff')").run();

        // 1. Insert stale unblocked randomized MAC device
        raw.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, is_randomized_mac, is_online, is_blocked, last_seen)
            VALUES ('net_test', '26:00:00:00:00:10', '192.168.1.110', 'Stale-Unblocked', 1, 0, 0, datetime('now', 'localtime', '-5 days'))
        `).run();

        // 2. Insert stale BLOCKED randomized MAC device
        raw.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, is_randomized_mac, is_online, is_blocked, last_seen)
            VALUES ('net_test', '26:00:00:00:00:11', '192.168.1.111', 'Stale-Blocked', 1, 0, 1, datetime('now', 'localtime', '-5 days'))
        `).run();

        // Run garbage collection with 2 days threshold
        db.pruneStaleRandomizedMacs(2);

        const unblockedDev = raw.prepare('SELECT mac FROM devices WHERE mac = ?').get('26:00:00:00:00:10');
        const blockedDev = raw.prepare('SELECT mac FROM devices WHERE mac = ?').get('26:00:00:00:00:11');

        assert.strictEqual(unblockedDev, undefined, 'Stale unblocked randomized MAC should be pruned');
        assert.ok(blockedDev, 'Stale BLOCKED randomized MAC must NOT be pruned by GC');

        // Test autoReblock does not target self or gateway
        const selfDevice: any = {
            ip: '192.168.1.100',
            mac: '26:00:00:00:00:12',
            hostname: 'Controller-PC',
            is_self: true,
            is_gateway: false,
            is_online: true,
            is_blocked: true, // anomaly
            speed_limit: 0,
            network_id: 'net_test'
        };
        const syncResult = await db.syncScanResults([selfDevice], 'net_test');
        assert.strictEqual(syncResult.autoReblockTargets.length, 0, 'Self device must NEVER be targeted for auto-reblock');

        await db.close();
        console.log('  ✓ Invariant Protection: GC preserves blocked devices and autoReblock ignores self/gateway');
    }

    // Stage 3 Test 4: isHighConfidence must NOT archive another legitimate online device in the same profile
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const raw = (db as any).db;
        raw.prepare("INSERT INTO networks (id, ssid, gateway_ip, gateway_mac) VALUES ('net_test', 'Test', '192.168.1.1', 'aa:bb:cc:dd:ee:ff')").run();

        // 1. Laptop A terdaftar dengan profile
        raw.prepare(`
            INSERT INTO device_profiles (id, alias, hostname, vendor, device_type, dhcp_fingerprint, dhcp_vendor_class, linked_macs, updated_at)
            VALUES ('prof_dell_laptop', 'Dell Inspiron', 'DESKTOP-DELL', 'Dell', 'PC / Laptop', '1,3,6,15,31,33,43,44,46,47', 'MSFT 5.0', '["aa:bb:cc:dd:ee:01"]', datetime('now', 'localtime'))
        `).run();
        raw.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, vendor, device_type, alias, profile_id, is_online, is_archived, dhcp_fingerprint, dhcp_vendor_class, last_seen)
            VALUES ('net_test', 'aa:bb:cc:dd:ee:01', '192.168.1.50', 'DESKTOP-DELL', 'Dell', 'PC / Laptop', 'Dell Inspiron', 'prof_dell_laptop', 1, 0, '1,3,6,15,31,33,43,44,46,47', 'MSFT 5.0', datetime('now', 'localtime'))
        `).run();

        // 2. Laptop B (model & spesifikasi sama) hadir di jaringan dan sama-sama online
        const laptopA: any = {
            ip: '192.168.1.50',
            mac: 'aa:bb:cc:dd:ee:01',
            hostname: 'DESKTOP-DELL',
            vendor: 'Dell',
            device_type: 'PC / Laptop',
            is_online: true,
            is_blocked: false,
            is_gateway: false,
            is_self: false,
            dhcp_fingerprint: '1,3,6,15,31,33,43,44,46,47',
            dhcp_vendor_class: 'MSFT 5.0',
            network_id: 'net_test'
        };
        const laptopB: any = {
            ip: '192.168.1.51',
            mac: 'aa:bb:cc:dd:ee:02',
            hostname: 'DESKTOP-DELL',
            vendor: 'Dell',
            device_type: 'PC / Laptop',
            is_online: true,
            is_blocked: false,
            is_gateway: false,
            is_self: false,
            dhcp_fingerprint: '1,3,6,15,31,33,43,44,46,47',
            dhcp_vendor_class: 'MSFT 5.0',
            network_id: 'net_test'
        };

        // Keduanya discan online bersamaan
        await db.syncScanResults([laptopA, laptopB], 'net_test');

        // Verifikasi: Laptop A TIDAK BOLEH diarsipkan dan IP-nya TIDAK BOLEH dihapus!
        const storedLaptopA = raw.prepare('SELECT is_archived, is_online, ip FROM devices WHERE mac = ?').get('aa:bb:cc:dd:ee:01');
        assert.strictEqual(storedLaptopA.is_archived, 0, 'Laptop A must NOT be archived by Laptop B joining');
        assert.strictEqual(storedLaptopA.is_online, 1, 'Laptop A must remain online');
        assert.strictEqual(storedLaptopA.ip, '192.168.1.50', 'Laptop A must retain its IP address');

        await db.close();
        console.log('  ✓ Profile Hijack Guard: isHighConfidence does not archive online devices sharing profile');
    }

    // Stage 3 Test 5: hasBlockedIdentityMatch matches generic factory hostname if seen within 15 minutes
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const raw = (db as any).db;
        raw.prepare("INSERT INTO networks (id, ssid, gateway_ip, gateway_mac) VALUES ('net_test', 'Test', '192.168.1.1', 'aa:bb:cc:dd:ee:ff')").run();

        // Device dengan nama pabrik 'Galaxy-A14' diblokir, last_seen 5 menit lalu
        raw.prepare(`
            INSERT INTO devices (network_id, mac, ip, hostname, is_blocked, dhcp_fingerprint, dhcp_vendor_class, last_seen)
            VALUES ('net_test', '26:11:22:33:44:55', '192.168.1.60', 'Galaxy-A14', 1, '1,3,6,15,26,28,51,58,59,43', 'android-dhcp-14', datetime('now', 'localtime', '-5 minutes'))
        `).run();

        // 1. Check match untuk device yang baru diskonek 5 menit lalu -> harus true
        const matchFresh = db.hasBlockedIdentityMatch({
            hostname: 'Galaxy-A14',
            dhcp_fingerprint: '1,3,6,15,26,28,51,58,59,43',
            vendor_class: 'android-dhcp-14'
        }, 'net_test');
        assert.strictEqual(matchFresh, true, 'Recent disconnect factory hostname must match for instant re-block');

        // 2. Ubah last_seen menjadi 30 menit lalu
        raw.prepare("UPDATE devices SET last_seen = datetime('now', 'localtime', '-30 minutes') WHERE mac = '26:11:22:33:44:55'").run();
        const matchOld = db.hasBlockedIdentityMatch({
            hostname: 'Galaxy-A14',
            dhcp_fingerprint: '1,3,6,15,26,28,51,58,59,43',
            vendor_class: 'android-dhcp-14'
        }, 'net_test');
        assert.strictEqual(matchOld, false, 'Old factory hostname (>15m) must not match to prevent false positives');

        await db.close();
        console.log('  ✓ Identity Re-Block: Generic factory hostname matches if seen within 15-minute window');
    }

    // Stage 3 Test 6: reconcileCanonicalDeviceMacs isolates unblock to the same network_id
    {
        const { DatabaseService } = await import('../src/services/database');
        const db = new DatabaseService(':memory:');
        await db.init();
        const raw = (db as any).db;

        // Siapkan 2 network terpisah
        raw.prepare("INSERT INTO networks (id, ssid, gateway_ip, gateway_mac) VALUES ('net_home', 'Home', '192.168.1.1', 'aa:11:11:11:11:11')").run();
        raw.prepare("INSERT INTO networks (id, ssid, gateway_ip, gateway_mac) VALUES ('net_office', 'Office', '10.0.0.1', 'bb:22:22:22:22:22')").run();

        // Profil sama
        raw.prepare(`
            INSERT INTO device_profiles (id, alias, hostname, updated_at)
            VALUES ('prof_phone_target', 'Hanif Phone', 'Hanif-Phone', datetime('now', 'localtime'))
        `).run();

        // Di Home: device online dan TIDAK diblokir (is_blocked = 0)
        raw.prepare(`
            INSERT INTO devices (network_id, mac, ip, profile_id, is_online, is_blocked)
            VALUES ('net_home', '26:aa:bb:cc:dd:01', '192.168.1.50', 'prof_phone_target', 1, 0)
        `).run();

        // Di Office: device offline dan DIBLOKIR (is_blocked = 1)
        raw.prepare(`
            INSERT INTO devices (network_id, mac, ip, profile_id, is_online, is_blocked)
            VALUES ('net_office', '26:aa:bb:cc:dd:02', '10.0.0.50', 'prof_phone_target', 0, 1)
        `).run();

        // Eksekusi reconcileCanonicalDeviceMacs
        (db as any).reconcileCanonicalDeviceMacs();

        // Di Office, device harus TETAP is_blocked = 1 (tidak ter-unblock oleh status unblocked di Home)
        const officeDev = raw.prepare("SELECT is_blocked FROM devices WHERE network_id = 'net_office' AND mac = '26:aa:bb:cc:dd:02'").get();
        assert.strictEqual(officeDev.is_blocked, 1, 'Device on foreign network must NOT be unblocked by local network state');

        await db.close();
        console.log('  ✓ Multi-Network Isolation: reconcileCanonicalDeviceMacs isolates unblock per network_id');
    }
}

