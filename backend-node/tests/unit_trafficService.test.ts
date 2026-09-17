import assert from 'assert';
import { EventEmitter } from 'events';
import { Device } from '../src/types';
import { TrafficService, IDeviceRegistry } from '../src/services/trafficService';
import { FeatureLimitError, FeatureLockedError } from '../src/services/licenseManager';

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

function makeTrafficServiceSetup() {
    const devices = new Map<string, Device>();
    const python: any = new EventEmitter();
    const db: any = {};
    const emittedEvents: Array<{ event: string; args: any[] }> = [];

    let seq = 0;
    const startSpoofCalls: any[] = [];
    const stopSpoofCalls: string[] = [];
    const setSpoofLimitCalls: any[] = [];
    const startRedirectCalls: any[] = [];
    const stopRedirectCalls: string[] = [];

    python.startSpoof = async (
        victimIp: string, victimMac: string, gatewayIp: string, gatewayMac: string,
        limit: number, v6?: string, g6?: string, blackhole?: boolean
    ) => {
        const sid = `sess-${victimIp}-${++seq}`;
        startSpoofCalls.push({ victimIp, victimMac, gatewayIp, gatewayMac, limit, v6, g6, blackhole, sid });
        return sid;
    };

    python.stopSpoof = async (sid: string) => {
        stopSpoofCalls.push(sid);
    };

    python.setSpoofLimit = async (sid: string, limit: number) => {
        setSpoofLimitCalls.push({ sid, limit });
    };

    python.pulseLiveness = async (targets: any[], gatewayIp: string) => {
        const res: Record<string, any> = {};
        for (const t of targets) {
            res[t.ip] = { is_alive: true, resolved_mac: t.mac };
        }
        return res;
    };

    python.startRedirect = async (
        victimIp: string, victimMac: string, gatewayIp: string, gatewayMac: string,
        redirectUrl: string, instagramUsername: string
    ) => {
        startRedirectCalls.push({ victimIp, victimMac, gatewayIp, gatewayMac, redirectUrl, instagramUsername });
        return { arp_session_id: `redir-sess-${victimIp}` };
    };

    python.stopRedirect = async (ip: string) => {
        stopRedirectCalls.push(ip);
    };

    db.setDeviceBlocked = async () => {};
    db.setDeviceSpeedLimit = async () => {};
    db.setDeviceOnlineStatus = async () => {};
    db.getDeviceByMac = async (mac: string) => {
        for (const d of devices.values()) {
            if (d.mac.toLowerCase() === mac.toLowerCase()) return d;
        }
        return null;
    };

    let licenseMock: any = undefined;

    const registry: IDeviceRegistry = {
        getDevice: (ip: string) => devices.get(ip),
        findDeviceByMac: (mac: string) => {
            const norm = (mac || '').toLowerCase();
            for (const d of devices.values()) {
                if (d.mac.toLowerCase() === norm) return d;
            }
            return undefined;
        },
        getAllDevices: () => Array.from(devices.values()),
        findGateway: (gwIp?: string) => {
            if (gwIp) return devices.get(gwIp);
            for (const d of devices.values()) {
                if (d.is_gateway) return d;
            }
            return undefined;
        },
        setDevice: (key: string, dev: Device) => {
            devices.set(key, dev);
        },
        deleteDevice: (key: string) => devices.delete(key),
        getCurrentNetworkId: () => 'net_test',
        emit: (event: string, ...args: any[]) => {
            emittedEvents.push({ event, args });
            return true;
        },
        runExclusive: async <T>(fn: () => Promise<T>) => fn(),
        getLicense: () => licenseMock
    };

    const service = new TrafficService(python, db, undefined, registry);

    const setLicense = (lic: any) => {
        licenseMock = lic;
    };

    return {
        service,
        devices,
        python,
        db,
        registry,
        setLicense,
        emittedEvents,
        startSpoofCalls,
        stopSpoofCalls,
        setSpoofLimitCalls,
        startRedirectCalls,
        stopRedirectCalls
    };
}

export async function runTrafficServiceTests() {
    console.log('\n--- [Node] Testing TrafficService (L2 Traffic Manipulation & Invariants) ---');

    // Test 1: Invariant 1 - Cannot block gateway router
    {
        const { service, devices } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        devices.set(gw.ip, gw);

        await assert.rejects(
            () => service.blockDevice('192.168.1.1', '192.168.1.1'),
            (err: any) => /Cannot block the gateway/.test(err.message)
        );
        console.log('  ✓ Invariant 1: Router gateway immunity strictly rejects blockDevice');
    }

    // Test 2: Invariant 2 - Cannot block operator host PC (anti self-cut)
    {
        const { service, devices } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const selfDev = makeDevice({ ip: '192.168.1.100', mac: '00:00:00:00:00:99', is_self: true });
        devices.set(gw.ip, gw);
        devices.set(selfDev.ip, selfDev);

        await assert.rejects(
            () => service.blockDevice('192.168.1.100', '192.168.1.1'),
            (err: any) => /Cannot block operator host/.test(err.message)
        );
        console.log('  ✓ Invariant 2: Operator controller host strictly protected from blockDevice');
    }

    // Test 3: Happy path blockDevice starts spoof session with limit 0
    {
        const { service, devices, startSpoofCalls } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const victim = makeDevice({ ip: '192.168.1.50', mac: '00:00:00:00:00:50' });
        devices.set(gw.ip, gw);
        devices.set(victim.ip, victim);

        const result = await service.blockDevice('192.168.1.50', '192.168.1.1');
        assert.strictEqual(result.is_blocked, true);
        assert.strictEqual(result.speed_limit, 0);
        assert.ok(result.session_id);
        assert.strictEqual(startSpoofCalls.length, 1);
        assert.strictEqual(startSpoofCalls[0].victimIp, '192.168.1.50');
        assert.strictEqual(startSpoofCalls[0].limit, 0);
        console.log('  ✓ Happy Path: Target cut-off successfully engages L2 ARP spoof session');
    }

    // Test 4: License quota exhaustion throws FeatureLimitError
    {
        const { service, devices, setLicense } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const victim = makeDevice({ ip: '192.168.1.50', mac: '00:00:00:00:00:50' });
        devices.set(gw.ip, gw);
        devices.set(victim.ip, victim);

        setLicense({
            checkCanBlock: () => ({ allowed: false, reason: 'Batas kuota pemutusan tercapai.' })
        });

        await assert.rejects(
            () => service.blockDevice('192.168.1.50', '192.168.1.1'),
            (err: any) => err.name === 'FeatureLimitError' || /Batas kuota pemutusan tercapai/.test(err.message)
        );
        console.log('  ✓ Licensing: Quota enforcement rejects blockDevice when limit reached');
    }

    // Test 5: unblockDevice stops spoof and restores 100% limit
    {
        const { service, devices, stopSpoofCalls } = makeTrafficServiceSetup();
        const victim = makeDevice({
            ip: '192.168.1.50',
            mac: '00:00:00:00:00:50',
            is_blocked: true,
            speed_limit: 0,
            session_id: 'active-session-50'
        });
        devices.set(victim.ip, victim);

        const result = await service.unblockDevice('192.168.1.50');
        assert.strictEqual(result.is_blocked, false);
        assert.strictEqual(result.speed_limit, 100);
        assert.strictEqual(result.session_id, undefined);
        assert.strictEqual(stopSpoofCalls.length, 1);
        assert.strictEqual(stopSpoofCalls[0], 'active-session-50');
        console.log('  ✓ Happy Path: unblockDevice stops spoofing and restores 100% bandwidth');
    }

    // Test 6: setSpeedLimit throttling requires PRO tier
    {
        const { service, devices, setLicense } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const victim = makeDevice({ ip: '192.168.1.50', mac: '00:00:00:00:00:50' });
        devices.set(gw.ip, gw);
        devices.set(victim.ip, victim);

        setLicense({
            checkCanThrottle: () => ({ allowed: false, reason: 'Fitur Pembatasan Kecepatan khusus untuk pengguna PRO.' })
        });

        await assert.rejects(
            () => service.setSpeedLimit('192.168.1.50', 25, '192.168.1.1'),
            (err: any) => err.name === 'FeatureLockedError' || /Fitur Pembatasan Kecepatan/.test(err.message)
        );
        console.log('  ✓ Licensing: PWM bandwidth throttling locked for non-PRO licenses');
    }

    // Test 7: setSpeedLimit PWM duty cycle engages spoofing with custom limit
    {
        const { service, devices, startSpoofCalls, setLicense } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const victim = makeDevice({ ip: '192.168.1.50', mac: '00:00:00:00:00:50' });
        devices.set(gw.ip, gw);
        devices.set(victim.ip, victim);

        setLicense({
            checkCanThrottle: () => ({ allowed: true })
        });

        const result = await service.setSpeedLimit('192.168.1.50', 35, '192.168.1.1');
        assert.strictEqual(result.speed_limit, 35);
        assert.strictEqual(result.is_blocked, false);
        assert.ok(result.session_id);
        assert.strictEqual(startSpoofCalls.length, 1);
        assert.strictEqual(startSpoofCalls[0].limit, 35);
        console.log('  ✓ Throttling: setSpeedLimit(35) establishes PWM rate-limiting session');
    }

    // Test 8: redirectDevice and stopRedirectDevice lifecycle
    {
        const { service, devices, startRedirectCalls, stopRedirectCalls } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const victim = makeDevice({ ip: '192.168.1.50', mac: '00:00:00:00:00:50' });
        devices.set(gw.ip, gw);
        devices.set(victim.ip, victim);

        const redirected = await service.redirectDevice('192.168.1.50', 'https://warning.lan', 'hacker', '192.168.1.1');
        assert.strictEqual(redirected.is_redirected, true);
        assert.strictEqual(redirected.redirect_url, 'https://warning.lan');
        assert.strictEqual(startRedirectCalls.length, 1);

        const stopped = await service.stopRedirectDevice('192.168.1.50');
        assert.strictEqual(stopped.is_redirected, false);
        assert.strictEqual(stopped.redirect_url, undefined);
        assert.strictEqual(stopRedirectCalls.length, 1);
        console.log('  ✓ Redirection: HTTP portal captive redirection and teardown verified');
    }

    // Test 9: Invariant 1 - setSpeedLimit strictly rejects gateway (is_gateway or gatewayIp match)
    {
        const { service, devices } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const pseudoGw = makeDevice({ ip: '192.168.1.254', mac: '00:00:00:00:00:fe', is_gateway: false });
        devices.set(gw.ip, gw);
        devices.set(pseudoGw.ip, pseudoGw);

        await assert.rejects(
            () => service.setSpeedLimit('192.168.1.1', 50, '192.168.1.1'),
            (err: any) => /Perangkat infrastruktur \(Gateway\)/.test(err.message)
        );

        await assert.rejects(
            () => service.setSpeedLimit('192.168.1.254', 50, '192.168.1.254'),
            (err: any) => /Perangkat infrastruktur \(Gateway\)/.test(err.message)
        );
        console.log('  ✓ Invariant 1: Router gateway immunity strictly rejects setSpeedLimit');
    }

    // Test 10: Invariant 4 - RFC 1918 private IP scope enforcement
    {
        const { service, devices, setLicense } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const publicDev = makeDevice({ ip: '8.8.8.8', mac: '00:00:00:00:08:08' });
        devices.set(gw.ip, gw);
        devices.set(publicDev.ip, publicDev);
        setLicense({
            checkCanThrottle: () => ({ allowed: true }),
            checkCanBlock: () => ({ allowed: true })
        });

        await assert.rejects(
            () => service.blockDevice('8.8.8.8', '192.168.1.1'),
            (err: any) => /RFC 1918/.test(err.message)
        );

        await assert.rejects(
            () => service.setSpeedLimit('8.8.8.8', 50, '192.168.1.1'),
            (err: any) => /RFC 1918/.test(err.message)
        );

        await assert.rejects(
            () => service.redirectDevice('8.8.8.8', 'https://warning.lan', '', '192.168.1.1'),
            (err: any) => /RFC 1918/.test(err.message)
        );
        console.log('  ✓ Invariant 4: RFC 1918 private IP scope strictly enforced across all operations');
    }

    // Test 11: Canonical deviceMemKey consistency between TrafficService and DeviceManager
    {
        const { deviceMemKey } = await import('../src/utils/deviceUtils');
        const onlineDev = makeDevice({ ip: '192.168.1.75', mac: 'AA:BB:CC:DD:EE:FF', profile_id: 'prof-123' });
        const offlineDev = makeDevice({ ip: '', mac: 'AA-BB-CC-DD-EE-FF', profile_id: 'prof-123' });
        const unprofiledOfflineDev = makeDevice({ ip: '', mac: 'AA-BB-CC-DD-EE-99', profile_id: undefined });

        assert.strictEqual(deviceMemKey(onlineDev), '192.168.1.75');
        assert.strictEqual(deviceMemKey(offlineDev), 'prof-123');
        assert.strictEqual(deviceMemKey(unprofiledOfflineDev), 'aa:bb:cc:dd:ee:99');
        console.log('  ✓ Architecture: Canonical deviceMemKey contract strictly isolates offline and profiled devices');
    }

    // Test 12: Stop redirect fallback by MAC address (Bug 2 fix)
    {
        const { service, devices, stopRedirectCalls } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const dev = makeDevice({ ip: '192.168.1.55', mac: 'AA:BB:CC:DD:EE:77', is_redirected: true, redirect_url: 'https://test.lan', session_id: 'redir-sess-1' });
        devices.set(dev.ip, dev);
        devices.set(gw.ip, gw);

        // Calling stopRedirectDevice using MAC address AA:BB:CC:DD:EE:77
        const stopped = await service.stopRedirectDevice('AA:BB:CC:DD:EE:77');
        assert.strictEqual(stopped.is_redirected, false);
        assert.strictEqual(stopped.speed_limit, 100);
        assert.strictEqual(stopRedirectCalls.includes('192.168.1.55'), true);
        console.log('  ✓ Fallback: stopRedirectDevice resolves targets by MAC address when IP is not supplied');
    }

    // Test 13: Registry canonical key persistence & ghost key eviction (Bug 1 & 3 fix)
    {
        const { service, devices } = makeTrafficServiceSetup();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const target = makeDevice({ ip: '192.168.1.80', mac: 'AA:BB:CC:DD:EE:88', is_blocked: true, session_id: 'sess-old' });
        devices.set(target.ip, target);
        devices.set(gw.ip, gw);

        // Unblock by MAC address
        await service.unblockDevice('AA:BB:CC:DD:EE:88');
        // Must NOT create a ghost key with MAC
        assert.strictEqual(devices.has('AA:BB:CC:DD:EE:88'), false, 'Registry must not store device under raw MAC parameter');
        assert.strictEqual(devices.has('192.168.1.80'), true, 'Registry must preserve canonical IP key');
        console.log('  ✓ Registry: Operations keyed by MAC preserve canonical memory keys without ghost duplicates');
    }
}


