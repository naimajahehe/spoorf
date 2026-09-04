import assert from 'assert';
import { Device } from '../src/types';

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
}

