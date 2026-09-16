import assert from 'assert';
import { EventEmitter } from 'events';
import { Device, ProfileAssessment, ProfileRefreshResponse } from '../src/types';
import { ReconciliationService, IReconciliationRegistryDelegate } from '../src/services/reconciliationService';
import { deviceMemKey } from '../src/utils/deviceUtils';

function makeDevice(over: Partial<Device>): Device {
    return {
        ip: '192.168.1.50',
        mac: '00:11:22:33:44:55',
        vendor: 'TestVendor',
        hostname: 'VictimDevice',
        is_online: true,
        is_blocked: false,
        is_gateway: false,
        is_self: false,
        device_type: 'Mobile',
        os: 'Android',
        rtt_ms: 12,
        open_ports: [],
        services: [],
        speed_limit: 100,
        ...over
    };
}

function makeReconciliationSetup() {
    const devices = new Map<string, Device>();
    const python: any = new EventEmitter();
    const db: any = {};
    const emitted: Array<{ event: string; args: any[] }> = [];

    let currentNetworkId = 'net_default';
    let scanTriggered = false;

    db.updateDeviceDhcpProfile = async () => {};
    db.setDeviceOnlineStatus = async () => {};
    db.hasBlockedIdentityMatch = () => false;
    db.updateDeviceProfileAssessment = async () => {};

    const registry: IReconciliationRegistryDelegate = {
        getDevice: (ip: string) => devices.get(ip),
        findDeviceByMac: (mac: string) => {
            const norm = (mac || '').toLowerCase();
            for (const d of devices.values()) {
                if (d.mac.toLowerCase() === norm) return d;
            }
            return undefined;
        },
        getAllDevices: () => Array.from(devices.values()),
        findGateway: () => {
            for (const d of devices.values()) {
                if (d.is_gateway) return d;
            }
            return undefined;
        },
        setDevice: (key: string, dev: Device) => { devices.set(key, dev); },
        deleteDevice: (key: string) => devices.delete(key),
        getCurrentNetworkId: () => currentNetworkId,
        emit: (event: string, ...args: any[]) => {
            emitted.push({ event, args });
            return true;
        },
        runExclusive: async <T>(fn: () => Promise<T>) => fn(),
        isAutoScanEnabled: () => true,
        debouncedScan: () => { scanTriggered = true; },
        scanNetwork: async () => { scanTriggered = true; return []; }
    };

    const service = new ReconciliationService(python, db, registry);

    return { service, python, db, devices, registry, emitted, isScanTriggered: () => scanTriggered };
}

export async function runReconciliationServiceTests(): Promise<void> {
    console.log('\n--- [Node] Testing ReconciliationService (DHCP Packet Profiling & IP Churn) ---');

    // 1. DHCP RELEASE: Sets offline and preserves entry under identity key (BUG-17)
    {
        const { service, registry, devices } = makeReconciliationSetup();
        const target = makeDevice({ ip: '192.168.1.70', mac: '11:22:33:44:55:66', is_online: true });
        registry.setDevice(target.ip, target);

        await service.handleDhcpEvent({
            kind: 'release',
            mac: target.mac,
            ip: target.ip
        });

        assert.strictEqual(target.is_online, false, 'Device marked offline upon DHCP release');
        assert.strictEqual(target.ip, '', 'IP cleared on DHCP release');
        assert.strictEqual(target.last_ip, '192.168.1.70', 'last_ip preserved on DHCP release');
        assert.strictEqual(devices.has('192.168.1.70'), false, 'Stale IP key removed from memory map');
        assert.strictEqual(devices.has(deviceMemKey(target)), true, 'Preserved under identity key for Offline tab');
        console.log('  ✓ DHCP Release: Device transitions offline and preserves identity memory key');
    }

    // 2. DHCP IP Churn: Old occupant displaced cleanly when new MAC obtains IP
    {
        const { service, registry, devices } = makeReconciliationSetup();
        const oldOcc = makeDevice({ ip: '192.168.1.80', mac: 'aa:bb:cc:dd:ee:01', hostname: 'Laptop-Old' });
        registry.setDevice(oldOcc.ip, oldOcc);

        // New device requests the same IP
        await service.handleDhcpEvent({
            ip: '192.168.1.80',
            mac: 'aa:bb:cc:dd:ee:02',
            hostname: 'Phone-New',
            message_type_code: 5
        });

        assert.strictEqual(oldOcc.is_online, false, 'Old occupant marked offline');
        assert.strictEqual(oldOcc.ip, '', 'Old occupant IP cleared');
        const newOcc = registry.getDevice('192.168.1.80');
        assert.ok(newOcc, 'New occupant mapped to IP');
        assert.strictEqual(newOcc.mac, 'aa:bb:cc:dd:ee:02', 'New device owns IP 192.168.1.80');
        console.log('  ✓ DHCP IP Churn: Old occupant safely evicted and new MAC assigned');
    }

    // 3. DHCP Fast-Revival: Offline penalty timer canceled immediately upon active DHCP packet
    {
        const { service } = makeReconciliationSetup();
        const normMac = '00:11:22:33:44:99';
        let timerCleared = false;
        const fakeTimer: any = setTimeout(() => {}, 30000);
        (service as any).offlineCooldownTimers.set(normMac, fakeTimer);

        await service.handleDhcpEvent({
            mac: normMac,
            ip: '192.168.1.99',
            message_type: 'REQUEST'
        });

        assert.strictEqual((service as any).offlineCooldownTimers.has(normMac), false, 'Cooldown timer cleared on active DHCP');
        clearTimeout(fakeTimer);
        console.log('  ✓ Fast Revival: 30s offline penalty timer cancelled upon active DHCP renewal');
    }

    // 4. Identity-Match Auto-Reblock: New MAC matching blocked identity triggers urgent re-block scan
    {
        const { service, db, isScanTriggered } = makeReconciliationSetup();
        db.hasBlockedIdentityMatch = () => true;

        await service.handleDhcpEvent({
            mac: 'ee:dd:cc:bb:aa:11',
            ip: '192.168.1.111',
            client_id: '01:ee:dd:cc:bb:aa:11',
            message_type: 'REQUEST'
        });

        assert.strictEqual(isScanTriggered(), true, 'Scan triggered immediately on identity match with blocked device');
        console.log('  ✓ Identity Re-Block: MAC randomization circumvention intercepted and scan dispatched');
    }

    // 5. Network Changed Invalidation: Generation incremented & in-flight caches cleared
    {
        const { service } = makeReconciliationSetup();
        (service as any).lastProfileRefresh = { completedAt: Date.now(), result: {} };
        (service as any).lastDhcpOptimization = { completedAt: Date.now(), result: {} };

        service.onNetworkChanged();

        assert.strictEqual((service as any).lastProfileRefresh, null, 'Profile refresh cache cleared');
        assert.strictEqual((service as any).lastDhcpOptimization, null, 'DHCP optimization cache cleared');
        console.log('  ✓ Network Invalidation: Stale caches cleanly flushed on network change');
    }
}
