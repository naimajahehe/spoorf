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

    // Test 1: R-1 Guard - Rejects auto-rebind when live MAC is an unknown occupant (Default-Deny)
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

        // Unknown occupant responds at 192.168.1.105 (not present in manager.devices)
        python.pulseLiveness = async () => ({
            '192.168.1.105': {
                ip: '192.168.1.105',
                mac: '40:23:43:aa:5a:f1',
                is_alive: true,
                resolved_mac: '56:e9:8d:38:1c:97'
            }
        });

        await assert.rejects(
            async () => {
                await manager.blockDevice('192.168.1.105', '192.168.1.1');
            },
            /belum terdaftar/i
        );

        assert.strictEqual(spoofCalls.length, 0, 'Unknown occupant must NEVER be blindly blocked');
        console.log('  ✓ R-1 Guard: Rejects auto-rebind when live MAC is an unknown occupant (Default-Deny)');
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

    // Test 4: T-1 - Innocent Device Protection (Reject re-bind if occupied by another recognized device)
    {
        const { manager, python, spoofCalls } = createMockSetup();

        const printerTarget: Device = {
            ip: '192.168.1.50',
            mac: '00:11:22:33:44:55',
            hostname: 'Office-Printer',
            profile_id: 'prof_printer_99',
            vendor: 'HP',
            device_type: 'Printer',
            os: 'Embedded Linux',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            speed_limit: 100,
            rtt_ms: 10.0,
            open_ports: [9100],
            services: ['RAW-Print']
        };
        (manager as any).devices.set(printerTarget.ip, printerTarget);

        const guestDevice: Device = {
            ip: '192.168.1.75',
            mac: 'aa:bb:cc:dd:ee:88',
            hostname: 'Laptop-Tamu-Budi',
            profile_id: 'prof_budi_11',
            vendor: 'Apple',
            device_type: 'PC / Laptop',
            os: 'macOS',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            speed_limit: 100,
            rtt_ms: 3.0,
            open_ports: [],
            services: []
        };
        (manager as any).devices.set(guestDevice.ip, guestDevice);

        // Tamu Budi takes over 192.168.1.50 via DHCP
        python.pulseLiveness = async () => ({
            '192.168.1.50': {
                ip: '192.168.1.50',
                mac: '00:11:22:33:44:55',
                is_alive: true,
                resolved_mac: 'aa:bb:cc:dd:ee:88'
            }
        });

        // Cutting printer must NOT cut Budi!
        await assert.rejects(
            async () => {
                await manager.blockDevice('192.168.1.50', '192.168.1.1');
            },
            /saat ini ditempati oleh perangkat lain/i
        );

        assert.strictEqual(spoofCalls.length, 0, 'Innocent guest must NEVER be blocked due to DHCP IP reassignment');
        console.log('  ✓ T-1 Guard: Protects innocent guest devices from unintended cutoff when IP is reassigned');
    }

    // Test 5: T-1 Positive Case - Allows re-bind when profile_id matches (MAC randomization on same device)
    {
        const { manager, python, spoofCalls } = createMockSetup();

        const stalePhone: Device = {
            ip: '192.168.1.110',
            mac: '40:23:43:aa:5a:f1',
            hostname: 'Galaxy-A55',
            profile_id: 'prof_samsung_a55',
            vendor: 'Samsung',
            device_type: 'Mobile Phone',
            os: 'Android 14',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            speed_limit: 100,
            rtt_ms: 15.0,
            open_ports: [],
            services: []
        };
        (manager as any).devices.set(stalePhone.ip, stalePhone);

        const rotatedPhone: Device = {
            ip: '192.168.1.110',
            mac: '56:e9:8d:38:1c:97',
            hostname: 'Galaxy-A55',
            profile_id: 'prof_samsung_a55',
            vendor: 'Samsung',
            device_type: 'Mobile Phone',
            os: 'Android 14',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            speed_limit: 100,
            rtt_ms: 2.0,
            open_ports: [],
            services: []
        };
        (manager as any).devices.set(rotatedPhone.mac, rotatedPhone);

        python.pulseLiveness = async () => ({
            '192.168.1.110': {
                ip: '192.168.1.110',
                mac: '40:23:43:aa:5a:f1',
                is_alive: true,
                resolved_mac: '56:e9:8d:38:1c:97'
            }
        });

        const blocked = await manager.blockDevice('192.168.1.110', '192.168.1.1');
        assert.strictEqual(spoofCalls.length, 1);
        assert.strictEqual(spoofCalls[0].victimMac, '56:e9:8d:38:1c:97');
        assert.strictEqual(blocked.mac, '56:e9:8d:38:1c:97');
        assert.strictEqual(blocked.is_blocked, true);
        console.log('  ✓ T-1 Continuity: Allows auto-rebind when device shares the same profile_id (MAC randomization)');
    }

    // Test 6: T-4 Defense-in-depth - Rejects block when resolved_mac matches physical host OS NIC even if map has no is_self
    {
        const { manager, python, spoofCalls, selfDev } = createMockSetup();
        // Remove selfDev from map to test defense-in-depth without is_self entry
        (manager as any).devices.delete(selfDev.ip);

        // Get actual physical MAC of local OS
        let realOsMac = '';
        const os = require('os');
        for (const addrs of Object.values(os.networkInterfaces())) {
            for (const a of (addrs as any) || []) {
                if (a.mac && a.mac !== '00:00:00:00:00:00') {
                    realOsMac = a.mac.toLowerCase();
                    break;
                }
            }
            if (realOsMac) break;
        }

        if (realOsMac) {
            const ghostTarget: Device = {
                ip: '192.168.1.222',
                mac: '00:99:88:77:66:55',
                hostname: 'Ghost-Host',
                vendor: 'Generic',
                device_type: 'Unknown',
                os: 'Unknown',
                is_gateway: false,
                is_self: false,
                is_online: true,
                is_blocked: false,
                speed_limit: 100,
                rtt_ms: 1.0,
                open_ports: [],
                services: []
            };
            (manager as any).devices.set(ghostTarget.ip, ghostTarget);

            python.pulseLiveness = async () => ({
                '192.168.1.222': {
                    ip: '192.168.1.222',
                    mac: '00:99:88:77:66:55',
                    is_alive: true,
                    resolved_mac: realOsMac
                }
            });

            await assert.rejects(
                async () => {
                    await manager.blockDevice('192.168.1.222', '192.168.1.1');
                },
                /Cannot target operator host/i
            );
            assert.strictEqual(spoofCalls.length, 0);
            console.log('  ✓ T-4 Defense-in-depth: Rejects block if resolved_mac matches physical host OS NIC even without memory map');
        }
    }

    // Test 7: T-3 Error Boundary - Soft errors mentioning "gateway" are not turned into fatal re-throws
    {
        const { manager, python, spoofCalls } = createMockSetup();

        const normalTarget: Device = {
            ip: '192.168.1.130',
            mac: '00:22:33:44:55:66',
            hostname: 'Normal-Target',
            vendor: 'Generic',
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
        (manager as any).devices.set(normalTarget.ip, normalTarget);

        // pulseLiveness throws a soft network error containing the word "gateway"
        python.pulseLiveness = async () => {
            throw new Error('gateway arp ping probe timed out on interface Wi-Fi');
        };

        // Pre-flight catches the soft error, logs a notice, and proceeds to block
        const blocked = await manager.blockDevice('192.168.1.130', '192.168.1.1');
        assert.strictEqual(spoofCalls.length, 1);
        assert.strictEqual(blocked.is_blocked, true);
        console.log('  ✓ T-3 Error Boundary: Soft warning mentioning "gateway" is not falsely re-thrown as fatal');
    }

    // Test 8: R-3 Hostname Continuity - Allows re-bind when devices share identical non-generic hostname (even without profile_id)
    {
        const { manager, python, spoofCalls } = createMockSetup();

        const staleDevice: Device = {
            ip: '192.168.1.140',
            mac: '40:23:43:aa:5a:f1',
            hostname: 'a55-milik-hanif',
            vendor: 'Samsung',
            device_type: 'Mobile Phone',
            os: 'Android 14',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            speed_limit: 100,
            rtt_ms: 10.0,
            open_ports: [],
            services: []
        };
        (manager as any).devices.set(staleDevice.ip, staleDevice);

        const liveDevice: Device = {
            ip: '192.168.1.140',
            mac: '56:e9:8d:38:1c:97',
            hostname: 'a55-milik-hanif',
            vendor: 'Samsung',
            device_type: 'Mobile Phone',
            os: 'Android 14',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            speed_limit: 100,
            rtt_ms: 2.0,
            open_ports: [],
            services: []
        };
        (manager as any).devices.set(liveDevice.mac, liveDevice);

        python.pulseLiveness = async () => ({
            '192.168.1.140': {
                ip: '192.168.1.140',
                mac: '40:23:43:aa:5a:f1',
                is_alive: true,
                resolved_mac: '56:e9:8d:38:1c:97'
            }
        });

        const blocked = await manager.blockDevice('192.168.1.140', '192.168.1.1');
        assert.strictEqual(spoofCalls.length, 1);
        assert.strictEqual(spoofCalls[0].victimMac, '56:e9:8d:38:1c:97');
        assert.strictEqual(blocked.mac, '56:e9:8d:38:1c:97');
        assert.strictEqual(blocked.is_blocked, true);
        console.log('  ✓ R-3 Continuity: Allows re-bind when devices share identical non-generic hostname');
    }
}
