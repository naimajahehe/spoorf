import assert from 'assert';
import { EventEmitter } from 'events';
import { Device } from '../src/types';
import { DeviceManager } from '../src/services/deviceManager';

function createMockSetup() {
    const python: any = new EventEmitter();
    const spoofCalls: Array<{ victimIp: string; victimMac: string; gatewayIp: string; gatewayMac: string }> = [];
    python.isReady = () => true;
    python.stopSpoof = async () => {};
    python.startSpoof = async (vIp: string, vMac: string, gIp: string, gMac: string) => {
        spoofCalls.push({ victimIp: vIp, victimMac: vMac, gatewayIp: gIp, gatewayMac: gMac });
        return 'mock-session-id';
    };
    python.pulseLiveness = async () => ({});

    const db: any = {
        saveDevice: async () => {},
        getDeviceByMac: async () => undefined,
        setDeviceBlocked: async () => {},
        setDeviceSpeedLimit: async () => {},
        setDeviceOnlineStatus: async () => {},
        updateDeviceMac: async () => {},
        getAllDevices: async () => []
    };

    const manager = new DeviceManager(python, db);

    // Register active Gateway
    const gateway: Device = {
        ip: '192.168.1.1',
        mac: '98:4a:6b:0f:4a:97',
        hostname: 'Router',
        vendor: 'TP-Link',
        device_type: 'Gateway Router',
        os: 'Embedded Linux',
        is_gateway: true,
        is_self: false,
        is_online: true,
        is_blocked: false,
        speed_limit: 100,
        rtt_ms: 1.0,
        open_ports: [80, 443],
        services: ['HTTP', 'HTTPS']
    };
    (manager as any).devices.set(gateway.ip, gateway);

    // Register Operator PC (is_self)
    const selfDev: Device = {
        ip: '192.168.1.50',
        mac: '11:22:33:44:55:66',
        hostname: 'This-PC',
        vendor: 'Lenovo',
        device_type: 'PC / Laptop',
        os: 'Windows 11',
        is_gateway: false,
        is_self: true,
        is_online: true,
        is_blocked: false,
        speed_limit: 100,
        rtt_ms: 0.1,
        open_ports: [],
        services: []
    };
    (manager as any).devices.set(selfDev.ip, selfDev);

    return { manager, python, db, spoofCalls, gateway, selfDev };
}

export async function runReconciliationTests() {
    console.log('\n--- [Node] Testing Dynamic ARP Reconciliation & Safety Guards ---');

    // Test 1: Auto-rebind target to live MAC
    {
        const { manager, python, spoofCalls } = createMockSetup();

        const staleTarget: Device = {
            ip: '192.168.1.105',
            mac: '40:23:43:aa:5a:f1',
            hostname: 'DESKTOP-OLD',
            vendor: 'Generic',
            device_type: 'PC / Laptop',
            os: 'Windows 10',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            speed_limit: 100,
            rtt_ms: 12.0,
            open_ports: [],
            services: []
        };
        (manager as any).devices.set(staleTarget.ip, staleTarget);

        python.pulseLiveness = async () => ({
            '192.168.1.105': {
                ip: '192.168.1.105',
                mac: '40:23:43:aa:5a:f1',
                is_alive: true,
                resolved_mac: '56:e9:8d:38:1c:97'
            }
        });

        const blocked = await manager.blockDevice('192.168.1.105', '192.168.1.1');

        assert.strictEqual(spoofCalls.length, 1);
        assert.strictEqual(spoofCalls[0].victimIp, '192.168.1.105');
        assert.strictEqual(spoofCalls[0].victimMac, '56:e9:8d:38:1c:97');
        assert.strictEqual(blocked.mac, '56:e9:8d:38:1c:97');
        assert.strictEqual(blocked.is_blocked, true);
        console.log('  ✓ Pre-Flight ARP: automatically re-binds target to live MAC when resolved_mac differs from stale memory');
    }

    // Test 2: Invariant 1 - Rejects Gateway
    {
        const { manager, python, spoofCalls, gateway } = createMockSetup();

        const fakeTarget: Device = {
            ip: '192.168.1.200',
            mac: 'aa:bb:cc:dd:ee:22',
            hostname: 'Attacker-IP',
            vendor: 'Unknown',
            device_type: 'Unknown',
            os: 'Unknown',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            speed_limit: 100,
            rtt_ms: 5.0,
            open_ports: [],
            services: []
        };
        (manager as any).devices.set(fakeTarget.ip, fakeTarget);

        python.pulseLiveness = async () => ({
            '192.168.1.200': {
                ip: '192.168.1.200',
                mac: 'aa:bb:cc:dd:ee:22',
                is_alive: true,
                resolved_mac: gateway.mac
            }
        });

        await assert.rejects(
            async () => {
                await manager.blockDevice('192.168.1.200', '192.168.1.1');
            },
            /gateway/i
        );

        assert.strictEqual(spoofCalls.length, 0, 'startSpoof must NEVER be called when resolved_mac is gateway');
        console.log('  ✓ Invariant 1: Rejects block if resolved_mac resolves to Gateway MAC');
    }

    // Test 3: Invariant 2 - Rejects Controller
    {
        const { manager, python, spoofCalls, selfDev } = createMockSetup();

        const fakeTarget: Device = {
            ip: '192.168.1.201',
            mac: 'aa:bb:cc:dd:ee:33',
            hostname: 'Ghost-IP',
            vendor: 'Unknown',
            device_type: 'Unknown',
            os: 'Unknown',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            speed_limit: 100,
            rtt_ms: 5.0,
            open_ports: [],
            services: []
        };
        (manager as any).devices.set(fakeTarget.ip, fakeTarget);

        python.pulseLiveness = async () => ({
            '192.168.1.201': {
                ip: '192.168.1.201',
                mac: 'aa:bb:cc:dd:ee:33',
                is_alive: true,
                resolved_mac: selfDev.mac
            }
        });

        await assert.rejects(
            async () => {
                await manager.blockDevice('192.168.1.201', '192.168.1.1');
            },
            /operator|host|this pc/i
        );

        assert.strictEqual(spoofCalls.length, 0, 'startSpoof must NEVER be called when resolved_mac is operator PC');
        console.log('  ✓ Invariant 2: Rejects block if resolved_mac resolves to Controller Host MAC');
    }
}
