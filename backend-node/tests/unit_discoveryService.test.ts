import assert from 'assert';
import { EventEmitter } from 'events';
import { Device } from '../src/types';
import { DiscoveryService, IDiscoveryRegistryDelegate } from '../src/services/discoveryService';

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

function makeDiscoverySetup() {
    const devices = new Map<string, Device>();
    const python: any = new EventEmitter();
    const db: any = {};
    const emitted: Array<{ event: string; args: any[] }> = [];

    let currentNetworkId = 'net_default';
    let scanCount = 0;

    python.scan = async () => {
        scanCount++;
        return [
            makeDevice({ ip: '192.168.1.1', mac: '00:aa:bb:cc:dd:01', is_gateway: true, hostname: 'Gateway-Router' }),
            makeDevice({ ip: '192.168.1.50', mac: '00:11:22:33:44:50', hostname: 'Device-50' }),
            makeDevice({ ip: '192.168.1.60', mac: '00:11:22:33:44:60', hostname: 'Device-60' }),
        ];
    };

    python.getStatus = async () => ({
        sessions: {}
    });

    db.syncScanResults = async (scanned: Device[]) => ({
        allDevices: scanned,
        autoReblockTargets: [],
        autoThrottleTargets: [],
        zombieSessionsToStop: []
    });

    db.getAllDevices = async () => Array.from(devices.values());
    db.ensureNetwork = async () => {};
    db.setDeviceOnlineStatus = async () => {};

    const armedCooldowns: Array<{ mac: string; hostnameOrIp?: string }> = [];

    const registry: IDiscoveryRegistryDelegate = {
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
        clearDevices: () => { devices.clear(); },
        getCurrentNetworkId: () => currentNetworkId,
        setCurrentNetworkId: (netId: string) => { currentNetworkId = netId; },
        emit: (event: string, ...args: any[]) => {
            emitted.push({ event, args });
            return true;
        },
        runExclusive: async <T>(fn: () => Promise<T>) => fn(),
        scheduleProfileEnrichment: () => {},
        armOfflineCooldown: (mac: string, hostnameOrIp?: string) => {
            armedCooldowns.push({ mac, hostnameOrIp });
        }
    };

    const service = new DiscoveryService(python, db, registry);

    return { service, python, db, devices, registry, emitted, armedCooldowns, getScanCount: () => scanCount };
}

export async function runDiscoveryServiceTests(): Promise<void> {
    console.log('\n--- [Node] Testing DiscoveryService (Modular Scanning & Liveness) ---');

    // 1. Single-Flight Coalescing
    {
        const { service, python } = makeDiscoverySetup();
        let resolvePythonScan: (val: any) => void = () => {};
        let scanCalls = 0;
        python.scan = () => {
            scanCalls++;
            return new Promise(res => { resolvePythonScan = res; });
        };

        const scan1 = service.scanNetwork();
        const scan2 = service.scanNetwork();
        const scan3 = service.scanNetwork();

        resolvePythonScan([
            makeDevice({ ip: '192.168.1.1', mac: '00:aa:bb:cc:dd:01', is_gateway: true }),
            makeDevice({ ip: '192.168.1.100', mac: '00:11:22:33:44:99' })
        ]);

        const [r1, r2, r3] = await Promise.all([scan1, scan2, scan3]);
        assert.strictEqual(scanCalls, 1, 'Only 1 underlying Python scan executed during parallel requests');
        assert.strictEqual(r1, r2, 'Promises coalesced into identical shared reference');
        assert.strictEqual(r2, r3, 'Promises coalesced into identical shared reference');
        console.log('  ✓ Single-Flight: Parallel scan requests cleanly coalesced into single execution');
    }

    // 2. Controller Self-Protection & Invariant 2 Enforcement
    {
        const { service, python, db, registry } = makeDiscoverySetup();
        const autoReblockExecuted: string[] = [];
        python.startSpoof = async (ip: string) => {
            autoReblockExecuted.push(ip);
            return 'sess-1';
        };

        python.scan = async () => [
            makeDevice({ ip: '192.168.1.1', mac: '00:aa:bb:cc:dd:01', is_gateway: true }),
            makeDevice({ ip: '192.168.1.100', mac: '00:11:22:33:44:99', is_self: true, is_blocked: true }),
            makeDevice({ ip: '192.168.1.50', mac: 'aa:bb:cc:dd:ee:50', is_blocked: true })
        ];

        db.syncScanResults = async (scanned: Device[]) => ({
            allDevices: scanned,
            autoReblockTargets: [
                makeDevice({ ip: '192.168.1.100', mac: '00:11:22:33:44:99', is_self: true, is_blocked: true }),
                makeDevice({ ip: '192.168.1.50', mac: 'aa:bb:cc:dd:ee:50', is_self: false, is_blocked: true })
            ],
            autoThrottleTargets: [],
            zombieSessionsToStop: []
        });

        await service.scanNetwork();

        const all = registry.getAllDevices();
        const selfDev = all.find(d => d.is_self);
        assert.ok(selfDev, 'Controller host is present in registry');
        assert.strictEqual(autoReblockExecuted.includes('192.168.1.100'), false, 'Controller host (is_self) must NEVER be targeted by auto-reblock (Invariant 2)');
        console.log('  ✓ Invariant 2: Controller host is strictly protected from auto-reblock targeting');
    }

    // 3. Network Shift Detection
    {
        const { service, python, registry } = makeDiscoverySetup();
        await service.scanNetwork();
        assert.strictEqual(registry.getCurrentNetworkId(), 'net_00aabbccdd01');

        // New scan with different router gateway MAC
        python.scan = async () => [
            makeDevice({ ip: '192.168.1.1', mac: 'ee:ff:11:22:33:44', is_gateway: true }),
            makeDevice({ ip: '192.168.1.88', mac: 'aa:bb:cc:11:22:33' })
        ];

        await service.scanNetwork();
        assert.strictEqual(registry.getCurrentNetworkId(), 'net_eeff11223344', 'Network scope shifted to new router gateway MAC');
        console.log('  ✓ Network Shift: Dynamically adapts to new gateway BSSID and network scopes');
    }

    // 4. Background Watchdog Gating
    {
        const { service } = makeDiscoverySetup();
        assert.strictEqual(service.isAutoScanEnabled(), false);

        // When autoScan is false, watchdog scan does not run
        assert.strictEqual((service as any).shouldRunWatchdogScan(), false, 'Watchdog does not run when autoScan is disabled');

        service.setAutoScanEnabled(true);
        assert.strictEqual(service.isAutoScanEnabled(), true);
        assert.strictEqual((service as any).shouldRunWatchdogScan(), true, 'Watchdog is active when autoScan is enabled');

        (service as any).scanning = true;
        assert.strictEqual((service as any).shouldRunWatchdogScan(), false, 'Watchdog defers when a scan is in progress');
        console.log('  ✓ Watchdog Gating: Background watchdog execution respects autoScan toggle & concurrency');
    }

    // 5. Liveness Pulse Event Handling & Offline Penalty Arming
    {
        const { service, registry, emitted, armedCooldowns } = makeDiscoverySetup();
        const dev = makeDevice({ ip: '192.168.1.75', mac: '70:80:90:aa:bb:cc', is_online: true });
        registry.setDevice(dev.ip, dev);

        // Disconnect pulse
        await service.handleLivenessEvent({
            ip: dev.ip,
            mac: dev.mac,
            is_online: false,
            vector: 'arp_probe_timeout'
        });

        assert.strictEqual(dev.is_online, false);
        const disconnectedEvent = emitted.find(e => e.event === 'deviceDisconnected');
        assert.ok(disconnectedEvent, 'deviceDisconnected event emitted on fast liveness offline pulse');
        assert.ok(armedCooldowns.some(c => c.mac.toLowerCase() === dev.mac.toLowerCase()), 'armOfflineCooldown called on offline pulse');
        console.log('  ✓ Liveness Event: Sub-second offline state transition and event notification verified');
    }
}
