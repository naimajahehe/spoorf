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
    const stopCalls: string[] = [];
    const callOrder: string[] = [];
    const persistenceCalls: string[] = [];
    const networkCalls: string[] = [];
    python.startSpoof = async (
        victimIp: string, _vmac: string, _gip: string, _gmac: string,
        speedLimit: number, _v6?: string, _g6?: string, blackhole?: boolean
    ) => {
        networkCalls.push('startSpoof');
        startCalls.push({ victimIp, speedLimit, blackhole });
        return `sess-${victimIp}-${++seq}`;
    };
    python.stopSpoof = async (sid: string) => {
        networkCalls.push('stopSpoof');
        stopCalls.push(sid);
        callOrder.push(`stop:${sid}`);
    };
    python.setSpoofLimit = async () => { networkCalls.push('setSpoofLimit'); };
    python.pulseLiveness = async () => {
        networkCalls.push('pulseLiveness');
        return {};
    };
    python.startRedirect = async () => {
        networkCalls.push('startRedirect');
        return { arp_session_id: 'redirect-session' };
    };
    python.stopRedirect = async () => { networkCalls.push('stopRedirect'); };
    python.startTransparentGateway = async () => {
        networkCalls.push('startTransparentGateway');
        return {};
    };
    python.stopTransparentGateway = async () => { networkCalls.push('stopTransparentGateway'); };
    python.getTransparentGatewayStatus = async () => ({});
    python.toggleGamingMode = async (enabled: boolean, mode: string, targetPingMs: number) => {
        networkCalls.push(`toggleGamingMode:${enabled}`);
        callOrder.push(`gaming:${enabled}`);
        return {
            is_enabled: enabled, mode, target_ping_ms: targetPingMs,
            ping_ms: 18, jitter_ms: 1, packet_loss_pct: 0, uptime_seconds: 0, timestamp: Date.now()
        };
    };

    const db: any = {
        setDeviceBlocked: async () => { persistenceCalls.push('setDeviceBlocked'); },
        setDeviceSpeedLimit: async () => { persistenceCalls.push('setDeviceSpeedLimit'); },
    };

    const dm = new DeviceManager(python as any, db as any);
    return { dm, python, db, startCalls, stopCalls, callOrder, persistenceCalls, networkCalls };
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

    // Test 5 (Lifecycle): saat disable, sesi dihentikan via sessionId tersimpan MESKI
    // perangkat sudah hilang dari daftar (disconnect) -> tidak ada sesi bocor.
    {
        const { dm, stopCalls } = makeManager();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const t1 = makeDevice({ ip: '192.168.1.130', mac: 'f0:0d:00:00:01:30', speed_limit: 100 });
        (dm as any).devices.set(gw.ip, gw);
        (dm as any).devices.set(t1.ip, t1);

        await dm.toggleGamingMode(true, 'auto_airtime', 25);
        const sid = t1.session_id;
        assert.ok(sid, 'perangkat harus punya session_id setelah di-throttle');

        // Simulasi perangkat menghilang dari daftar (disconnect) TANPA sempat dibersihkan.
        (dm as any).devices.delete(t1.ip);

        await dm.toggleGamingMode(false);
        assert.ok(stopCalls.includes(sid as string),
            'disable harus menghentikan sesi via sessionId tersimpan walau perangkat sudah hilang');
        console.log('  ✓ Lifecycle: sesi dihentikan via sessionId tersimpan saat disable meski perangkat hilang');
    }

    // Test 6 (Reconnect): perangkat yang putus saat gaming -> entri dibersihkan (_stopGamingSession),
    // saat online lagi ter-throttle kembali (tidak lagi terkunci entri basi).
    {
        const { dm, stopCalls, startCalls } = makeManager();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const t1 = makeDevice({ ip: '192.168.1.131', mac: 'f0:0d:00:00:01:31', speed_limit: 100 });
        (dm as any).devices.set(gw.ip, gw);
        (dm as any).devices.set(t1.ip, t1);

        await dm.toggleGamingMode(true, 'auto_airtime', 25);
        const firstSid = t1.session_id as string;

        // Disconnect: bersihkan sesi gaming untuk MAC ini.
        await (dm as any)._stopGamingSession(t1.mac.toLowerCase());
        assert.ok(stopCalls.includes(firstSid), 'sesi harus dihentikan saat disconnect');
        assert.ok(!(dm as any).gamingManaged.has(t1.mac.toLowerCase()), 'entri MAC harus dibersihkan saat disconnect');

        // Reconnect (MAC sama): harus ter-throttle lagi.
        const before = startCalls.length;
        await (dm as any)._maybeApplyGamingToNewDevice(t1);
        assert.ok(startCalls.length > before, 'perangkat yang reconnect saat gaming aktif harus di-throttle lagi');
        console.log('  ✓ Reconnect: entri MAC dibersihkan saat disconnect; ter-throttle lagi saat kembali');
    }

    // Test 7 (Race guard): sweep re-apply scan tidak men-throttle apa pun bila gaming sudah non-aktif.
    {
        const { dm, startCalls } = makeManager();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const t1 = makeDevice({ ip: '192.168.1.132', mac: 'f0:0d:00:00:01:32', speed_limit: 100 });
        (dm as any).devices.set(gw.ip, gw);
        (dm as any).devices.set(t1.ip, t1);

        // Gaming TIDAK aktif -> sweep harus no-op (mensimulasikan disable yang mendahului scan).
        (dm as any).gamingActive = false;
        const before = startCalls.length;
        await (dm as any)._reapplyGamingSweep(gw);
        assert.strictEqual(startCalls.length, before, 'sweep tidak boleh throttle saat gamingActive=false');
        console.log('  ✓ Race guard: sweep scan no-op saat gaming non-aktif (tak throttle setelah disable)');
    }

    // Test 8: Gaming OFF must reject and preserve Node state when a managed spoof cannot stop.
    {
        const { dm, python, callOrder, persistenceCalls } = makeManager();
        const gw = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const target = makeDevice({
            ip: '192.168.1.140',
            mac: 'f0:0d:00:00:01:40',
            speed_limit: 20,
            session_id: 'gaming-session-fail'
        });
        const macKey = target.mac.toLowerCase();
        (dm as any).devices.set(gw.ip, gw);
        (dm as any).devices.set(target.ip, target);
        (dm as any).gamingActive = true;
        (dm as any).gamingMode = 'auto_airtime';
        (dm as any).gamingTargetLimit = 20;
        (dm as any).gamingManaged.set(macKey, {
            priorLimit: 100,
            hadSession: false,
            sessionId: target.session_id
        });

        const before = { ...target, open_ports: [...target.open_ports], services: [...target.services] };
        const emitted: string[] = [];
        dm.on('deviceUpdated', () => emitted.push('deviceUpdated'));
        dm.on('devicesUpdated', () => emitted.push('devicesUpdated'));
        dm.on('gamingStatusChanged', () => emitted.push('gamingStatusChanged'));
        python.stopSpoof = async (sid: string) => {
            callOrder.push(`stop:${sid}`);
            throw new Error('gaming teardown failed');
        };

        let rejection: Error | undefined;
        try {
            await dm.toggleGamingMode(false);
        } catch (error: any) {
            rejection = error;
        }

        assert.strictEqual(rejection?.message, 'gaming teardown failed', 'Gaming OFF harus mempropagasi kegagalan stopSpoof');
        assert.deepStrictEqual(target, before, 'State perangkat harus tetap sama');
        assert.strictEqual((dm as any).gamingActive, true, 'Gaming state harus tetap aktif');
        assert.deepStrictEqual(
            Array.from((dm as any).gamingManaged.entries()),
            [[macKey, { priorLimit: 100, hadSession: false, sessionId: 'gaming-session-fail' }]],
            'Metadata pemulihan harus dipertahankan untuk retry'
        );
        assert.deepStrictEqual(persistenceCalls, [], 'SQLite tidak boleh dimutasi');
        assert.deepStrictEqual(emitted, [], 'Event sukses tidak boleh dipancarkan');
        assert.deepStrictEqual(
            callOrder,
            ['stop:gaming-session-fail'],
            'Python Gaming OFF tidak boleh dipanggil sebelum semua teardown berhasil'
        );
        console.log('  ✓ Failure safety: Gaming OFF mempertahankan state saat teardown gagal');
    }

    // Test 9: A partially completed disable resumes from the failed session instead
    // of re-stopping a session that was already reconciled successfully.
    {
        const { dm, python, callOrder, persistenceCalls } = makeManager();
        const gateway = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const first = makeDevice({
            ip: '192.168.1.141',
            mac: 'f0:0d:00:00:01:41',
            speed_limit: 20,
            session_id: 'gaming-session-a'
        });
        const second = makeDevice({
            ip: '192.168.1.142',
            mac: 'f0:0d:00:00:01:42',
            speed_limit: 20,
            session_id: 'gaming-session-b'
        });
        (dm as any).devices.set(gateway.ip, gateway);
        (dm as any).devices.set(first.ip, first);
        (dm as any).devices.set(second.ip, second);
        (dm as any).gamingActive = true;
        (dm as any).gamingMode = 'auto_airtime';
        (dm as any).gamingTargetLimit = 20;
        (dm as any).gamingManaged.set(first.mac.toLowerCase(), {
            priorLimit: 100, hadSession: false, sessionId: first.session_id
        });
        (dm as any).gamingManaged.set(second.mac.toLowerCase(), {
            priorLimit: 100, hadSession: false, sessionId: second.session_id
        });

        let secondStopAttempts = 0;
        python.stopSpoof = async (sid: string) => {
            callOrder.push(`stop:${sid}`);
            if (sid === 'gaming-session-b' && secondStopAttempts++ === 0) {
                throw new Error('session B restore failed');
            }
        };

        await assert.rejects(
            () => dm.toggleGamingMode(false),
            /session B restore failed/
        );
        assert.strictEqual((dm as any).gamingActive, true, 'Node harus tetap aktif setelah partial teardown');
        assert.strictEqual((dm as any).gamingManaged.size, 2, 'Metadata retry tidak boleh dibuang');
        assert.deepStrictEqual(persistenceCalls, [], 'SQLite tidak boleh berubah sebelum semua stop berhasil');
        assert.deepStrictEqual(
            callOrder,
            ['stop:gaming-session-a', 'stop:gaming-session-b'],
            'Python Gaming OFF tidak boleh menyusul partial teardown'
        );

        await dm.toggleGamingMode(false);

        assert.deepStrictEqual(
            callOrder,
            [
                'stop:gaming-session-a',
                'stop:gaming-session-b',
                'stop:gaming-session-b',
                'gaming:false'
            ],
            'Retry hanya boleh melanjutkan session B yang belum selesai sebelum Gaming OFF'
        );
        assert.strictEqual((dm as any).gamingActive, false, 'Node hanya nonaktif setelah Python OFF berhasil');
        assert.strictEqual((dm as any).gamingManaged.size, 0, 'Metadata retry dibersihkan setelah commit');
        assert.strictEqual(first.speed_limit, 100, 'Perangkat A dipulihkan setelah commit');
        assert.strictEqual(second.speed_limit, 100, 'Perangkat B dipulihkan setelah commit');
        assert.deepStrictEqual(
            persistenceCalls,
            ['setDeviceBlocked', 'setDeviceSpeedLimit', 'setDeviceBlocked', 'setDeviceSpeedLimit'],
            'SQLite hanya berubah setelah teardown dan Python OFF berhasil'
        );
        console.log('  ✓ Retry safety: partial teardown direkonsiliasi sebelum Gaming OFF dan commit lokal');
    }

    // Test 10: a final Python OFF failure preserves Node recovery metadata despite
    // all managed stops having already completed.
    {
        const { dm, python, callOrder, persistenceCalls } = makeManager();
        const gateway = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const target = makeDevice({
            ip: '192.168.1.143',
            mac: 'f0:0d:00:00:01:43',
            speed_limit: 20,
            session_id: 'gaming-session-off-fail'
        });
        const macKey = target.mac.toLowerCase();
        (dm as any).devices.set(gateway.ip, gateway);
        (dm as any).devices.set(target.ip, target);
        (dm as any).gamingActive = true;
        (dm as any).gamingManaged.set(macKey, {
            priorLimit: 100, hadSession: false, sessionId: target.session_id
        });

        let pythonGamingEnabled = true;
        python.toggleGamingMode = async (enabled: boolean) => {
            callOrder.push(`gaming:${enabled}`);
            if (!enabled) throw new Error('Python Gaming OFF failed');
            pythonGamingEnabled = true;
            return { is_enabled: true };
        };

        await assert.rejects(
            () => dm.toggleGamingMode(false),
            /Python Gaming OFF failed/
        );

        assert.deepStrictEqual(
            callOrder,
            ['stop:gaming-session-off-fail', 'gaming:false'],
            'Python OFF harus dipanggil hanya setelah seluruh session stop'
        );
        assert.strictEqual(pythonGamingEnabled, true, 'Python tetap dianggap aktif saat perintah OFF gagal');
        assert.strictEqual((dm as any).gamingActive, true, 'Node tetap aktif saat Python OFF gagal');
        assert.deepStrictEqual(
            Array.from((dm as any).gamingManaged.entries()),
            [[macKey, { priorLimit: 100, hadSession: false, sessionId: 'gaming-session-off-fail' }]],
            'Metadata pemulihan tetap tersedia untuk retry OFF'
        );
        assert.strictEqual(target.speed_limit, 20, 'State perangkat tidak boleh di-commit sebelum Python OFF sukses');
        assert.deepStrictEqual(persistenceCalls, [], 'SQLite tidak boleh diubah bila Python OFF gagal');
        console.log('  ✓ Failure safety: Python OFF failure mempertahankan recovery metadata dan state Node');
    }

    // Test 11: after Python Gaming is OFF, a failed manual-session restore remains
    // retryable without public success events or duplicate successful sessions.
    {
        const { dm, python, callOrder, persistenceCalls } = makeManager();
        const gateway = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const target = makeDevice({
            ip: '192.168.1.144',
            mac: 'f0:0d:00:00:01:44',
            speed_limit: 20,
            session_id: 'gaming-session-restore-fail'
        });
        const macKey = target.mac.toLowerCase();
        (dm as any).devices.set(gateway.ip, gateway);
        (dm as any).devices.set(target.ip, target);
        (dm as any).gamingActive = true;
        (dm as any).gamingManaged.set(macKey, {
            priorLimit: 40, hadSession: true, sessionId: target.session_id
        });

        const before = { ...target, open_ports: [...target.open_ports], services: [...target.services] };
        const emitted: string[] = [];
        dm.on('deviceUpdated', () => emitted.push('deviceUpdated'));
        dm.on('devicesUpdated', () => emitted.push('devicesUpdated'));
        dm.on('gamingStatusChanged', () => emitted.push('gamingStatusChanged'));
        let restoreAttempts = 0;
        const successfulRestoreIds: string[] = [];
        python.startSpoof = async () => {
            restoreAttempts++;
            callOrder.push('start:192.168.1.144');
            if (restoreAttempts === 1) throw new Error('manual restore start failed');
            successfulRestoreIds.push('manual-session-restored');
            return 'manual-session-restored';
        };

        await assert.rejects(
            () => dm.toggleGamingMode(false),
            /manual restore start failed/
        );

        assert.strictEqual((dm as any).gamingActive, false, 'Python-off confirmation must update control-plane status');
        assert.deepStrictEqual(target, before, 'Local device state must not commit after restore-start failure');
        assert.deepStrictEqual(persistenceCalls, [], 'Persistence must wait for all remote reconciliation');
        assert.deepStrictEqual(emitted, [], 'No success events may precede a recoverable retry');
        assert.deepStrictEqual(
            callOrder,
            ['stop:gaming-session-restore-fail', 'gaming:false', 'start:192.168.1.144'],
            'Python OFF must precede manual restoration'
        );

        await dm.toggleGamingMode(false);

        assert.strictEqual(restoreAttempts, 2, 'Only the failed restore start is retried');
        assert.deepStrictEqual(successfulRestoreIds, ['manual-session-restored'], 'Retry creates one restored session');
        assert.deepStrictEqual(
            callOrder,
            [
                'stop:gaming-session-restore-fail',
                'gaming:false',
                'start:192.168.1.144',
                'start:192.168.1.144'
            ],
            'Completed stop and Python-off phases must not repeat'
        );
        assert.strictEqual(target.session_id, 'manual-session-restored');
        assert.strictEqual(target.speed_limit, 40);
        assert.deepStrictEqual(
            persistenceCalls,
            ['setDeviceBlocked', 'setDeviceSpeedLimit'],
            'Persistence occurs only after the restored session exists'
        );
        assert.deepStrictEqual(
            emitted,
            ['deviceUpdated', 'devicesUpdated', 'gamingStatusChanged'],
            'Success events occur only after retry finalization'
        );
        console.log('  ✓ Recovery safety: failed manual restore resumes without duplicate successful sessions');
    }

    // Test 12: the first persistence write can fail after Python OFF without
    // re-running completed remote work or emitting partial success.
    {
        const { dm, python, db, callOrder } = makeManager();
        const gateway = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const target = makeDevice({
            ip: '192.168.1.145',
            mac: 'f0:0d:00:00:01:45',
            speed_limit: 20,
            session_id: 'gaming-session-first-db-fail'
        });
        const macKey = target.mac.toLowerCase();
        (dm as any).devices.set(gateway.ip, gateway);
        (dm as any).devices.set(target.ip, target);
        (dm as any).gamingActive = true;
        (dm as any).gamingManaged.set(macKey, {
            priorLimit: 35, hadSession: true, sessionId: target.session_id
        });

        const before = { ...target, open_ports: [...target.open_ports], services: [...target.services] };
        const emitted: string[] = [];
        dm.on('deviceUpdated', () => emitted.push('deviceUpdated'));
        dm.on('devicesUpdated', () => emitted.push('devicesUpdated'));
        dm.on('gamingStatusChanged', () => emitted.push('gamingStatusChanged'));
        const persistenceCalls: string[] = [];
        let failFirstWrite = true;
        let restoreStarts = 0;
        python.startSpoof = async () => {
            restoreStarts++;
            callOrder.push('start:192.168.1.145');
            return 'manual-session-first-db';
        };
        const toggleGamingMode = python.toggleGamingMode;
        python.toggleGamingMode = async (...args: any[]) => {
            const result = await toggleGamingMode(...args);
            python.emit('gamingStatusChanged', result);
            return result;
        };
        db.setDeviceBlocked = async () => {
            persistenceCalls.push('blocked');
            if (failFirstWrite) throw new Error('first DB write failed');
        };
        db.setDeviceSpeedLimit = async () => { persistenceCalls.push('speed'); };

        await assert.rejects(
            () => dm.toggleGamingMode(false),
            /first DB write failed/
        );

        assert.strictEqual((dm as any).gamingActive, false, 'Python-off status must remain truthful');
        assert.deepStrictEqual(target, before, 'No local state may commit after the first DB write fails');
        assert.deepStrictEqual(emitted, [], 'No partial success events may be emitted');
        assert.strictEqual(restoreStarts, 1, 'Manual session is restored once before persistence');
        assert.deepStrictEqual(
            callOrder,
            ['stop:gaming-session-first-db-fail', 'gaming:false', 'start:192.168.1.145'],
        );

        failFirstWrite = false;
        await dm.toggleGamingMode(false);

        assert.strictEqual(restoreStarts, 1, 'Retry must retain the already-restored session ID');
        assert.deepStrictEqual(
            callOrder,
            ['stop:gaming-session-first-db-fail', 'gaming:false', 'start:192.168.1.145'],
            'Completed remote work must not repeat after first-write failure'
        );
        assert.deepStrictEqual(persistenceCalls, ['blocked', 'blocked', 'speed']);
        assert.strictEqual(target.session_id, 'manual-session-first-db');
        assert.strictEqual(target.speed_limit, 35);
        assert.deepStrictEqual(emitted, ['deviceUpdated', 'devicesUpdated', 'gamingStatusChanged']);
        console.log('  ✓ Recovery safety: first DB failure resumes persistence without duplicate sessions');
    }

    // Test 13: a second persistence-write failure preserves completed first-write
    // progress and resumes only the unfinished write after Python is already off.
    {
        const { dm, python, db, callOrder } = makeManager();
        const gateway = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const target = makeDevice({
            ip: '192.168.1.146',
            mac: 'f0:0d:00:00:01:46',
            speed_limit: 20,
            session_id: 'gaming-session-second-db-fail'
        });
        const macKey = target.mac.toLowerCase();
        (dm as any).devices.set(gateway.ip, gateway);
        (dm as any).devices.set(target.ip, target);
        (dm as any).gamingActive = true;
        (dm as any).gamingManaged.set(macKey, {
            priorLimit: 30, hadSession: true, sessionId: target.session_id
        });

        const before = { ...target, open_ports: [...target.open_ports], services: [...target.services] };
        const emitted: string[] = [];
        dm.on('deviceUpdated', () => emitted.push('deviceUpdated'));
        dm.on('devicesUpdated', () => emitted.push('devicesUpdated'));
        dm.on('gamingStatusChanged', () => emitted.push('gamingStatusChanged'));
        const persistenceCalls: string[] = [];
        let failSecondWrite = true;
        let restoreStarts = 0;
        python.startSpoof = async () => {
            restoreStarts++;
            callOrder.push('start:192.168.1.146');
            return 'manual-session-second-db';
        };
        db.setDeviceBlocked = async () => { persistenceCalls.push('blocked'); };
        db.setDeviceSpeedLimit = async () => {
            persistenceCalls.push('speed');
            if (failSecondWrite) throw new Error('second DB write failed');
        };

        await assert.rejects(
            () => dm.toggleGamingMode(false),
            /second DB write failed/
        );

        assert.strictEqual((dm as any).gamingActive, false, 'Python-off status must remain truthful');
        assert.deepStrictEqual(target, before, 'No local state may commit after the second DB write fails');
        assert.deepStrictEqual(emitted, [], 'No partial success events may be emitted');
        assert.strictEqual(restoreStarts, 1, 'Manual restoration completes before persistence begins');
        assert.deepStrictEqual(persistenceCalls, ['blocked', 'speed']);

        failSecondWrite = false;
        await dm.toggleGamingMode(false);

        assert.strictEqual(restoreStarts, 1, 'Retry must not create a duplicate restored session');
        assert.deepStrictEqual(
            callOrder,
            ['stop:gaming-session-second-db-fail', 'gaming:false', 'start:192.168.1.146'],
            'Completed remote phases must not repeat after second-write failure'
        );
        assert.deepStrictEqual(
            persistenceCalls,
            ['blocked', 'speed', 'speed'],
            'Successful first persistence write must not be repeated'
        );
        assert.strictEqual(target.session_id, 'manual-session-second-db');
        assert.strictEqual(target.speed_limit, 30);
        assert.deepStrictEqual(emitted, ['deviceUpdated', 'devicesUpdated', 'gamingStatusChanged']);
        console.log('  ✓ Recovery safety: second DB failure resumes only unfinished persistence');
    }

    // Test 14: while a persistence-failed Gaming disable is pending, every
    // conflicting mutation is rejected before touching Python, SQLite, or local state.
    {
        const { dm, db, networkCalls } = makeManager();
        const gateway = makeDevice({ ip: '192.168.1.1', mac: '00:00:00:00:00:01', is_gateway: true });
        const managed = makeDevice({
            ip: '192.168.1.147',
            mac: 'f0:0d:00:00:01:47',
            profile_id: 'family-profile',
            speed_limit: 20,
            session_id: 'gaming-session-pending'
        });
        const profilePeer = makeDevice({
            ip: '192.168.1.148',
            mac: 'f0:0d:00:00:01:48',
            profile_id: 'family-profile',
            speed_limit: 100
        });
        const managedMac = managed.mac.toLowerCase();
        (dm as any).devices.set(gateway.ip, gateway);
        (dm as any).devices.set(managed.ip, managed);
        (dm as any).devices.set(profilePeer.ip, profilePeer);
        (dm as any).gamingActive = true;
        (dm as any).gamingManaged.set(managedMac, {
            priorLimit: 35,
            hadSession: true,
            sessionId: managed.session_id
        });

        const sqliteCalls: string[] = [];
        let failPersistence = true;
        db.setDeviceBlocked = async () => {
            sqliteCalls.push('setDeviceBlocked');
            if (failPersistence) throw new Error('controlled persistence failure');
        };
        db.setDeviceSpeedLimit = async () => { sqliteCalls.push('setDeviceSpeedLimit'); };
        db.setDeviceOnlineStatus = async () => { sqliteCalls.push('setDeviceOnlineStatus'); };
        db.getDeviceByMac = async () => {
            sqliteCalls.push('getDeviceByMac');
            return profilePeer;
        };
        db.deleteDevice = async () => { sqliteCalls.push('deleteDevice'); };

        const emitted: string[] = [];
        dm.on('deviceUpdated', () => emitted.push('deviceUpdated'));
        dm.on('devicesUpdated', () => emitted.push('devicesUpdated'));
        dm.on('gamingStatusChanged', () => emitted.push('gamingStatusChanged'));

        await assert.rejects(
            () => dm.toggleGamingMode(false),
            /controlled persistence failure/
        );
        assert.ok((dm as any).pendingGamingDisable, 'persistence failure must retain a recovery plan');

        const beforeManaged = { ...managed, open_ports: [...managed.open_ports], services: [...managed.services] };
        const beforePeer = { ...profilePeer, open_ports: [...profilePeer.open_ports], services: [...profilePeer.services] };
        const pythonCallCount = networkCalls.length;
        const sqliteCallCount = sqliteCalls.length;
        const recoveryPending = /Gaming disable recovery is pending for a managed device\. Retry disabling Gaming Mode before changing its network state\./;

        await assert.rejects(() => dm.blockDevice(managed.ip, gateway.ip), recoveryPending);
        await assert.rejects(() => dm.unblockDevice(managed.ip), recoveryPending);
        await assert.rejects(() => dm.setSpeedLimit(managed.ip, 70), recoveryPending);
        await assert.rejects(() => dm.redirectDevice(managed.ip, 'https://example.test'), recoveryPending);
        await assert.rejects(() => dm.stopRedirectDevice(managed.ip), recoveryPending);
        await assert.rejects(() => dm.startTransparentGateway(managed.ip), recoveryPending);
        await assert.rejects(() => dm.stopTransparentGateway(managed.ip), recoveryPending);
        await assert.rejects(
            () => dm.deleteDevice(profilePeer.mac),
            recoveryPending,
            'deleting a profile peer must be blocked when that profile includes a managed device'
        );

        assert.strictEqual(networkCalls.length, pythonCallCount, 'rejected mutations must not call Python');
        assert.strictEqual(sqliteCalls.length, sqliteCallCount, 'rejected mutations must not call SQLite');
        assert.deepStrictEqual(managed, beforeManaged, 'managed device state must not change while recovery is pending');
        assert.deepStrictEqual(profilePeer, beforePeer, 'profile peer state must not change while recovery is pending');
        assert.deepStrictEqual(emitted, [], 'rejected mutations must not emit state events');

        failPersistence = false;
        await dm.toggleGamingMode(false);
        assert.strictEqual((dm as any).pendingGamingDisable, null, 'successful retry must clear recovery state');

        await dm.setSpeedLimit(managed.ip, 70);
        assert.strictEqual(managed.speed_limit, 70, 'the same mutation must proceed after recovery succeeds');
        assert.ok(networkCalls.length > pythonCallCount, 'post-recovery mutation must reach Python');
        assert.ok(sqliteCalls.length > sqliteCallCount, 'post-recovery mutation must reach SQLite');
        console.log('  ✓ Recovery isolation: pending Gaming disable blocks mutations until retry completes');
    }

}
