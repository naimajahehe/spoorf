import assert from 'assert';
import { EventEmitter } from 'events';
import { Device } from '../src/types';
import { DeviceManager, selectGateway } from '../src/services/deviceManager';

/**
 * Test logika enforcement Gaming Mode di DeviceManager.toggleGamingMode.
 *
 * Fokus pada dua invariant kebenaran:
 *  1. Baseline speed_limit perangkat harus dipulihkan ke nilai ASLI setelah gaming OFF,
 *     bahkan bila gaming di-re-enter (ganti target ping / ganti mode) saat masih aktif.
 *  2. Perangkat yang baru online saat gaming aktif ikut di-throttle.
 */

function makeDevice(over: Partial<Device>): Device {
    return {
        ip: '192.168.1.2',
        mac: '00:00:00:00:00:02',
        vendor: 'Test',
        hostname: 'dev',
        is_online: true,
        is_blocked: false,
        is_gateway: false,
        device_type: 'PC',
        os: 'Windows',
        rtt_ms: 10,
        open_ports: [],
        services: [],
        speed_limit: 100,
        ...over
    };
}

function makeManager() {
    const python: any = new EventEmitter();
    let seq = 0;
    const startCalls: any[] = [];
    python.startSpoof = async (
        victimIp: string, _vmac: string, _gip: string, _gmac: string,
        speedLimit: number, _v6?: string, _g6?: string, blackhole?: boolean
    ) => {
        startCalls.push({ victimIp, speedLimit, blackhole });
        return `sess-${victimIp}-${++seq}`;
    };
    python.stopSpoof = async (_sid: string) => { /* noop */ };
    python.toggleGamingMode = async (enabled: boolean, mode: string, targetPingMs: number) => ({
        is_enabled: enabled, mode, target_ping_ms: targetPingMs,
        ping_ms: 18, jitter_ms: 1, packet_loss_pct: 0, uptime_seconds: 0, timestamp: Date.now()
    });

    const db: any = {
        setDeviceBlocked: async () => {},
        setDeviceSpeedLimit: async () => {},
    };

    const dm = new DeviceManager(python as any, db as any);
    return { dm, python, db, startCalls };
}

export async function runGamingModeTests() {
    console.log('\n--- [Node] Testing Gaming Mode Enforcement (throttle & restore) ---');

    // Test 1: Baseline dipulihkan ke 100 setelah re-enter (ubah target ping) lalu OFF.
    {
        const { dm, startCalls } = makeManager();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true, speed_limit: 100 });
        const t1 = makeDevice({ ip: '192.168.1.101', mac: 'aa:aa:aa:aa:aa:a1', speed_limit: 100 });
        const t2 = makeDevice({ ip: '192.168.1.102', mac: 'aa:aa:aa:aa:aa:a2', speed_limit: 100 });
        (dm as any).devices.set(gw.ip, gw);
        (dm as any).devices.set(t1.ip, t1);
        (dm as any).devices.set(t2.ip, t2);

        await dm.toggleGamingMode(true, 'auto_airtime', 25);
        assert.strictEqual(t1.speed_limit, 20, 'target harus dibatasi ke 20% saat gaming ON');
        assert.strictEqual(t2.speed_limit, 20, 'target harus dibatasi ke 20% saat gaming ON');

        // Re-enter saat masih aktif: ubah target ping (memicu cabang enable lagi).
        await dm.toggleGamingMode(true, 'auto_airtime', 40);

        await dm.toggleGamingMode(false);
        assert.strictEqual(t1.speed_limit, 100, 'baseline t1 harus kembali 100 setelah gaming OFF');
        assert.strictEqual(t2.speed_limit, 100, 'baseline t2 harus kembali 100 setelah gaming OFF');
        assert.ok(startCalls.every(c => c.blackhole === true), 'sesi gaming harus blackhole');
        console.log('  ✓ Baseline speed_limit pulih ke 100 setelah re-enter target ping lalu OFF');
    }

    // Test 2: Blackhole mode membatasi ke 0%.
    {
        const { dm } = makeManager();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const t1 = makeDevice({ ip: '192.168.1.150', mac: 'bb:bb:bb:bb:bb:b1', speed_limit: 100 });
        (dm as any).devices.set(gw.ip, gw);
        (dm as any).devices.set(t1.ip, t1);

        await dm.toggleGamingMode(true, 'blackhole_priority', 25);
        assert.strictEqual(t1.speed_limit, 0, 'blackhole harus memutus total (0%)');
        await dm.toggleGamingMode(false);
        assert.strictEqual(t1.speed_limit, 100, 'baseline harus kembali 100 setelah OFF');
        console.log('  ✓ Mode blackhole membatasi ke 0% lalu pulih ke 100');
    }

    // Test 4 (Anti-Self-Cut): perangkat operator (is_self) TIDAK PERNAH jadi target,
    // baik saat mengaktifkan MAUPUN saat mematikan (jalur pemulihan).
    {
        const { dm, startCalls } = makeManager();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const me = makeDevice({ ip: '192.168.1.50', mac: 'de:ad:be:ef:00:50', is_self: true, speed_limit: 100 });
        const other = makeDevice({ ip: '192.168.1.120', mac: 'dd:dd:dd:dd:dd:d1', speed_limit: 100 });
        (dm as any).devices.set(gw.ip, gw);
        (dm as any).devices.set(me.ip, me);
        (dm as any).devices.set(other.ip, other);

        await dm.toggleGamingMode(true, 'auto_airtime', 25);
        // Perangkat sendiri tak boleh muncul di panggilan spoof mana pun.
        assert.ok(!startCalls.some(c => c.victimIp === me.ip), 'is_self TIDAK boleh di-spoof saat aktivasi');
        assert.ok(startCalls.some(c => c.victimIp === other.ip), 'perangkat lain tetap di-throttle');
        // State perangkat sendiri tak tersentuh.
        assert.strictEqual(me.speed_limit, 100, 'speed_limit is_self harus tetap 100');
        assert.strictEqual(me.is_blocked, false, 'is_self tidak boleh diblokir');
        assert.strictEqual(me.session_id, undefined, 'is_self tidak boleh punya sesi spoof');

        // Jalur MEMATIKAN: pemulihan juga tak boleh menyentuh perangkat sendiri.
        await dm.toggleGamingMode(false);
        assert.ok(!startCalls.some(c => c.victimIp === me.ip), 'is_self TIDAK boleh disentuh saat mematikan/pemulihan');
        assert.strictEqual(me.speed_limit, 100, 'is_self tetap 100 setelah gaming OFF');
        assert.strictEqual(me.session_id, undefined, 'is_self tetap tanpa sesi setelah OFF');
        console.log('  ✓ Anti-Self-Cut: perangkat operator (This PC) tak pernah jadi target saat aktif maupun mati');
    }

    // Test 3: Perangkat baru yang online saat gaming aktif ikut di-throttle.
    {
        const { dm, startCalls } = makeManager();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        (dm as any).devices.set(gw.ip, gw);
        await dm.toggleGamingMode(true, 'auto_airtime', 25);

        const late = makeDevice({ ip: '192.168.1.200', mac: 'cc:cc:cc:cc:cc:c1', speed_limit: 100 });
        (dm as any).devices.set(late.ip, late);
        const gateway = selectGateway(Array.from((dm as any).devices.values()) as Device[]);
        await (dm as any)._applyGamingToDevice(late, gateway);

        assert.strictEqual(late.speed_limit, 20, 'perangkat baru harus ikut dibatasi ke 20% saat gaming aktif');
        assert.ok(startCalls.some(c => c.victimIp === late.ip && c.blackhole === true),
            'perangkat baru harus di-spoof blackhole');
        await dm.toggleGamingMode(false);
        assert.strictEqual(late.speed_limit, 100, 'perangkat baru pulih ke 100 setelah OFF');
        console.log('  ✓ Perangkat baru saat gaming aktif ikut di-throttle lalu pulih');
    }
}
