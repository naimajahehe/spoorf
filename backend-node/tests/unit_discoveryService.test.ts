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

    // 6. Auto-Reblock: Restores is_blocked from SQLite Sync & Executes Direct startSpoof (v2.41.36 Stability)
    {
        const { service, python, db, registry, emitted } = makeDiscoverySetup();
        
        // Simulasikan perangkat di memori yang berstatus is_blocked: false (belum ada sesi)
        const inMemVictim = makeDevice({
            ip: '192.168.1.77',
            mac: '77:88:99:aa:bb:cc',
            hostname: 'VictimPhone',
            is_online: true,
            is_blocked: false,
            session_id: undefined
        });
        registry.setCurrentNetworkId?.('net_00aabbccdd01');
        registry.setDevice(inMemVictim.ip, inMemVictim);

        // Raw scan dari Scapy tidak membawa is_blocked (undefined)
        python.scan = async () => [
            makeDevice({ ip: '192.168.1.1', mac: '00:aa:bb:cc:dd:01', is_gateway: true }),
            makeDevice({ ip: '192.168.1.77', mac: '77:88:99:aa:bb:cc', hostname: 'VictimPhone' })
        ];

        // Database sync mengembalikan is_blocked: true dari SQLite
        const dbVictim = makeDevice({
            ip: '192.168.1.77',
            mac: '77:88:99:aa:bb:cc',
            hostname: 'VictimPhone',
            is_blocked: true,
            speed_limit: 0
        });

        db.syncScanResults = async (scanned: Device[]) => ({
            allDevices: [scanned[0], dbVictim],
            autoReblockTargets: [dbVictim],
            autoThrottleTargets: [],
            zombieSessionsToStop: []
        });

        let dbSetBlockedCalled = false;
        db.setDeviceBlocked = async (mac: string, blocked: boolean, sessionId?: string) => {
            if (mac === dbVictim.mac && blocked && sessionId === 'sess_direct_reblock_77') {
                dbSetBlockedCalled = true;
            }
        };
        db.setDeviceSpeedLimit = async () => {};

        let spoofCalls: Array<{ ip: string; mac: string; gwIp: string; limit: number }> = [];
        python.startSpoof = async (ip: string, mac: string, gwIp: string, gwMac: string, limit: number) => {
            spoofCalls.push({ ip, mac, gwIp, limit });
            return 'sess_direct_reblock_77';
        };

        // Spy untuk memastikan blockDeviceDirect TIDAK dipanggil (menghindari pre-flight pulse failure & quota checks)
        let blockDeviceDirectCalled = false;
        const dummyTrafficService = {
            clearStaleSpoofSession: async () => {},
            blockDeviceDirect: async () => { blockDeviceDirectCalled = true; }
        };
        (service as any).trafficService = dummyTrafficService;

        await service.scanNetwork();

        const victimInRegistry = registry.getDevice('192.168.1.77');
        assert.ok(victimInRegistry, 'Victim must be present in registry');
        assert.strictEqual(blockDeviceDirectCalled, false, 'Auto-reblock must NOT delegate to blockDeviceDirect (avoids redundant pre-flight pulse)');
        assert.strictEqual(spoofCalls.length, 1, 'Direct python.startSpoof must be invoked');
        assert.strictEqual(spoofCalls[0].ip, '192.168.1.77');
        assert.strictEqual(spoofCalls[0].limit, 0);
        assert.strictEqual(victimInRegistry.is_blocked, true, 'is_blocked must be synced to true from DB');
        assert.strictEqual(victimInRegistry.session_id, 'sess_direct_reblock_77');
        assert.strictEqual(dbSetBlockedCalled, true, 'db.setDeviceBlocked must be called with new session ID');
        
        const autoReblockedEvent = emitted.find(e => e.event === 'autoReblocked');
        assert.ok(autoReblockedEvent, 'autoReblocked event must be emitted');
        console.log('  ✓ Auto-Reblock v2.41.36: Syncs DB is_blocked to memory and starts direct spoof without pre-flight pulse bypass');
    }
}
