import assert from 'assert';
import { DatabaseService as SentinelDatabase, deriveNetworkId } from '../src/services/database';
import { Device, Network } from '../src/types';

export async function runNetworkIsolationTests() {
    console.log('\n--- TESTING NETWORK-SCOPED ISOLATION & COMPOSITE KEY SCHEMA ---');

    // Test 1: deriveNetworkId generates clean, normalized IDs
    {
        assert.strictEqual(deriveNetworkId('1C:60:D2:6A:9A:48'), 'net_1c60d26a9a48');
        assert.strictEqual(deriveNetworkId('1c-60-d2-6a-9a-48'), 'net_1c60d26a9a48');
        assert.strictEqual(deriveNetworkId('1c60d26a9a48'), 'net_1c60d26a9a48');
        assert.strictEqual(deriveNetworkId(''), 'net_default');
        console.log('  ✓ Test 1: deriveNetworkId normalizes gateway MAC into net_<hex>');
    }

    // Test 2: ensureNetwork and getNetwork
    {
        const db = new SentinelDatabase(':memory:');
        await db.init();

        const net: Network = {
            id: 'net_1c60d26a9a48',
            ssid: 'YOTTA TALASALAPANG_5G',
            gateway_ip: '192.168.1.1',
            gateway_mac: '1c:60:d2:6a:9a:48',
            subnet: '192.168.1.0/24',
            interface_type: 'wifi'
        };

        db.ensureNetwork(net);
        const retrieved = db.getNetwork('net_1c60d26a9a48');
        assert.ok(retrieved, 'Network should be retrieved');
        assert.strictEqual(retrieved?.ssid, 'YOTTA TALASALAPANG_5G');
        assert.strictEqual(retrieved?.gateway_ip, '192.168.1.1');
        console.log('  ✓ Test 2: ensureNetwork & getNetwork persist network metadata');
    }

    // Test 3: Composite Primary Key (network_id, mac) allows same MAC across networks
    {
        const db = new SentinelDatabase(':memory:');
        await db.init();

        const netA = 'net_aaaa11112222';
        const netB = 'net_bbbb33334444';
        const targetMac = '00:11:22:33:44:55';

        db.ensureNetwork({ id: netA, ssid: 'Net A', gateway_ip: '10.0.0.1', gateway_mac: 'aa:aa:11:11:22:22', subnet: '10.0.0.0/24' });
        db.ensureNetwork({ id: netB, ssid: 'Net B', gateway_ip: '192.168.1.1', gateway_mac: 'bb:bb:33:33:44:44', subnet: '192.168.1.0/24' });

        // Target device on Network A
        await db.syncScanResults([{
            mac: targetMac,
            ip: '10.0.0.50',
            vendor: 'Samsung',
            hostname: 'Target-Phone',
            is_online: true,
            is_blocked: false,
            is_gateway: false,
            device_type: 'Phone',
            os: 'Android',
            rtt_ms: 10,
            open_ports: [],
            services: []
        } as Device], netA);

        // Block device on Network A
        await db.setDeviceBlocked(targetMac, true, undefined, netA);

        // Scan same device on Network B
        await db.syncScanResults([{
            mac: targetMac,
            ip: '192.168.1.100',
            vendor: 'Samsung',
            hostname: 'Target-Phone',
            is_online: true,
            is_blocked: false,
            is_gateway: false,
            device_type: 'Phone',
            os: 'Android',
            rtt_ms: 15,
            open_ports: [],
            services: []
        } as Device], netB);

        const devA = (await db.getAllDevices(netA)).find((d: Device) => d.mac === targetMac);
        const devB = (await db.getAllDevices(netB)).find((d: Device) => d.mac === targetMac);

        assert.ok(devA, 'Device should exist on Net A');
        assert.ok(devB, 'Device should exist on Net B');
        assert.strictEqual(devA?.ip, '10.0.0.50');
        assert.strictEqual(devB?.ip, '192.168.1.100');
        assert.strictEqual(devA?.is_blocked, true, 'Device on Net A must remain blocked');
        assert.strictEqual(devB?.is_blocked, false, 'Device on Net B must NOT be blocked');

        console.log('  ✓ Test 3: Composite Primary Key isolates block state per network');
    }

    // Test 4: Gateway immunity & reset is isolated per network
    {
        const db = new SentinelDatabase(':memory:');
        await db.init();

        const netA = 'net_aaaa11112222';
        const netB = 'net_bbbb33334444';

        db.ensureNetwork({ id: netA, ssid: 'Net A', gateway_ip: '10.0.0.1', gateway_mac: 'aa:aa:11:11:22:22', subnet: '10.0.0.0/24' });
        db.ensureNetwork({ id: netB, ssid: 'Net B', gateway_ip: '192.168.1.1', gateway_mac: 'bb:bb:33:33:44:44', subnet: '192.168.1.0/24' });

        await db.syncScanResults([{ mac: 'aa:aa:11:11:22:22', ip: '10.0.0.1', is_gateway: true, is_online: true } as Device], netA);
        await db.syncScanResults([{ mac: 'bb:bb:33:33:44:44', ip: '192.168.1.1', is_gateway: true, is_online: true } as Device], netB);

        const gwA = (await db.getAllDevices(netA)).find((d: Device) => d.mac === 'aa:aa:11:11:22:22');
        const gwB = (await db.getAllDevices(netB)).find((d: Device) => d.mac === 'bb:bb:33:33:44:44');

        assert.strictEqual(gwA?.is_gateway, true, 'Gateway A must remain gateway on Net A');
        assert.strictEqual(gwB?.is_gateway, true, 'Gateway B must remain gateway on Net B');
        console.log('  ✓ Test 4: Gateway flags are isolated per network');
    }

    // Test 5: Scanning Net B does not mark devices on Net A as offline
    {
        const db = new SentinelDatabase(':memory:');
        await db.init();

        const netA = 'net_aaaa11112222';
        const netB = 'net_bbbb33334444';

        db.ensureNetwork({ id: netA, ssid: 'Net A', gateway_ip: '10.0.0.1', gateway_mac: 'aa:aa:11:11:22:22', subnet: '10.0.0.0/24' });
        db.ensureNetwork({ id: netB, ssid: 'Net B', gateway_ip: '192.168.1.1', gateway_mac: 'bb:bb:33:33:44:44', subnet: '192.168.1.0/24' });

        // Add device on Net A
        await db.syncScanResults([{ mac: '12:34:56:78:9a:bc', ip: '10.0.0.5', is_online: true } as Device], netA);

        // Scan empty on Net B
        await db.syncScanResults([], netB);

        // Device on Net A should still be online!
        const devA = (await db.getAllDevices(netA)).find((d: Device) => d.mac === '12:34:56:78:9a:bc');
        assert.strictEqual(devA?.is_online, true, 'Device on Net A must remain online');
        console.log('  ✓ Test 5: Scan reconciliation on Net B does not mark Net A devices offline');
    }

    // Test 6: license_cache preservation during clean slate
    {
        const db = new SentinelDatabase(':memory:');
        await db.init();

        // Verify license_cache table exists and has current_license
        const lic = db.getCachedLicense();
        assert.strictEqual(lic?.tier, 'free');

        // Save VIP license
        await db.saveCachedLicense({
            tier: 'vip',
            token: 'test_token',
            max_cuts: 9999,
            can_throttle: true,
            can_gateway: true,
            can_autoreblock: true,
            can_arsenal: true,
            cloud_sync: true,
            grace_period_until: '2099-01-01T00:00:00.000Z'
        });

        const vipLic = db.getCachedLicense();
        assert.strictEqual(vipLic?.tier, 'vip');

        // Execute clearAllDevices
        await db.clearAllDevices();

        // License must still be VIP!
        const preservedLic = db.getCachedLicense();
        assert.strictEqual(preservedLic?.tier, 'vip', 'VIP license must be preserved after clearAllDevices');
        console.log('  ✓ Test 6: license_cache is preserved across device resets');
    }
}
