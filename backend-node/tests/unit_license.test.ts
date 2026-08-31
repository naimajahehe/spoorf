import assert from 'assert';
import { DatabaseService } from '../src/services/database';
import { LicenseManager, DEFAULT_FREE_LICENSE, FeatureLimitError, FeatureLockedError } from '../src/services/licenseManager';
import { DeviceManager } from '../src/services/deviceManager';
import { PythonBridge } from '../src/services/pythonBridge';
import { Device } from '../src/types';

// Mock Python Bridge for fast offline unit testing
class MockPythonBridge extends PythonBridge {
    public mockStartedSpoofs: string[] = [];
    public mockThrottled: Map<string, number> = new Map();

    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async stopAll(): Promise<void> {}

    async startSpoof(
        victimIp: string,
        victimMac: string,
        gatewayIp: string,
        gatewayMac: string,
        limit: number = 0
    ): Promise<string> {
        const sid = `sess_${victimIp}_${Date.now()}`;
        this.mockStartedSpoofs.push(sid);
        if (limit > 0) {
            this.mockThrottled.set(sid, limit);
        }
        return sid;
    }

    async stopSpoof(sessionId: string): Promise<void> {
        this.mockStartedSpoofs = this.mockStartedSpoofs.filter(s => s !== sessionId);
        this.mockThrottled.delete(sessionId);
    }

    async setSpoofLimit(sessionId: string, limit: number): Promise<void> {
        this.mockThrottled.set(sessionId, limit);
    }

    async startTransparentGateway(targetIp: string, targetMac: string, gatewayIp: string, gatewayMac: string): Promise<any> {
        return { success: true, victim_ip: targetIp };
    }

    async pulseLiveness(targets: any[]): Promise<Record<string, any>> {
        const res: Record<string, any> = {};
        for (const t of targets) {
            res[t.ip] = { is_alive: true, vector: 'mock_arp', rtt_ms: 1.0 };
        }
        return res;
    }
}

export async function runLicenseUnitTests() {
    console.log('\n--- [Node] Testing Cloud License & In-App Feature Gating ---');

    // Test ini menguji jalur upgrade OFFLINE/DEMO (cloud auth tidak tersedia).
    // Aktifkan flag demo secara eksplisit; default produksi menonaktifkannya (keamanan P0).
    const prevDemoFlag = process.env.SPOORF_ALLOW_DEMO_LICENSE;
    process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';

    const db = new DatabaseService(':memory:');
    await db.init();

    const licenseManager = new LicenseManager(db);
    await licenseManager.init();

    const mockPython = new MockPythonBridge();
    const deviceManager = new DeviceManager(mockPython, db, licenseManager);

    // Setup dummy mock devices in DeviceManager
    const gwDevice: Device = {
        ip: '192.168.1.1',
        mac: '00:11:22:33:44:01',
        hostname: 'Router-Gateway',
        vendor: 'TP-Link',
        is_gateway: true,
        is_online: true,
        is_blocked: false,
        open_ports: [],
        services: [],
        device_type: 'Router',
        os: 'Linux',
        rtt_ms: 2
    };

    const makeTarget = (idx: number, ip: string, mac: string): Device => ({
        ip,
        mac,
        hostname: `Target-${idx}`,
        vendor: 'TestVendor',
        is_gateway: false,
        is_online: true,
        is_blocked: false,
        open_ports: [],
        services: [],
        device_type: 'Mobile',
        os: 'Android',
        rtt_ms: 15
    });

    const targets: Device[] = [
        makeTarget(1, '192.168.1.51', '00:11:22:33:44:51'),
        makeTarget(2, '192.168.1.52', '00:11:22:33:44:52'),
        makeTarget(3, '192.168.1.53', '00:11:22:33:44:53'),
        makeTarget(4, '192.168.1.54', '00:11:22:33:44:54'),
        makeTarget(5, '192.168.1.55', '00:11:22:33:44:55'),
        makeTarget(6, '192.168.1.56', '00:11:22:33:44:56')
    ];

    await db.syncScanResults([gwDevice, ...targets]);

    (deviceManager as any).devices.set(gwDevice.ip, gwDevice);
    for (const t of targets) {
        (deviceManager as any).devices.set(t.ip, t);
    }

    // Test 1: Initial Default is Free Tier with max 5 cuts
    const initialStatus = licenseManager.getStatus();
    assert.strictEqual(initialStatus.isAuthenticated, false);
    assert.strictEqual(initialStatus.license.tier, 'free');
    assert.strictEqual(initialStatus.license.max_cuts, 5);
    assert.strictEqual(initialStatus.license.can_throttle, false);
    assert.strictEqual(initialStatus.license.can_deep_fingerprint, false);
    console.log('  ✓ Free Tier Baseline: Unauthenticated app defaults to Free with max 5 cuts and deep fingerprinting disabled');

    // Test 2: Free Tier can block up to 5 targets successfully
    for (let i = 0; i < 5; i++) {
        await deviceManager.blockDevice(targets[i].ip, gwDevice.ip);
        assert.strictEqual(targets[i].is_blocked, true);
    }
    console.log('  ✓ Free Tier Allowed: 5 targets blocked successfully within limit');

    // Test 3: Free Tier blocked from cutting off 6th target (FeatureLimitError)
    let limitExceededThrown = false;
    try {
        await deviceManager.blockDevice(targets[5].ip, gwDevice.ip);
    } catch (err: any) {
        if (err instanceof FeatureLimitError || err.code === 'FEATURE_LIMIT_EXCEEDED') {
            limitExceededThrown = true;
        }
    }
    assert.strictEqual(limitExceededThrown, true, 'Blocking 6th device on Free tier must throw FeatureLimitError');
    console.log('  ✓ Free Tier Guard: 6th target block rejected with FeatureLimitError');

    // Test 4: Free Tier blocked from Throttling bandwidth (FeatureLockedError)
    let throttleLockedThrown = false;
    try {
        await deviceManager.setSpeedLimit(targets[5].ip, 50);
    } catch (err: any) {
        if (err instanceof FeatureLockedError || err.code === 'FEATURE_LOCKED_PRO') {
            throttleLockedThrown = true;
        }
    }
    assert.strictEqual(throttleLockedThrown, true, 'Throttling on Free tier must throw FeatureLockedError');
    console.log('  ✓ Free Tier Guard: Bandwidth throttling rejected with FeatureLockedError');

    // Test 5: Free Tier blocked from Transparent Gateway (FeatureLockedError)
    let gatewayLockedThrown = false;
    try {
        await deviceManager.startTransparentGateway(targets[5].ip, gwDevice.ip);
    } catch (err: any) {
        if (err instanceof FeatureLockedError || err.code === 'FEATURE_LOCKED_PRO') {
            gatewayLockedThrown = true;
        }
    }
    assert.strictEqual(gatewayLockedThrown, true, 'Transparent Gateway on Free tier must throw FeatureLockedError');
    console.log('  ✓ Free Tier Guard: Transparent Gateway rejected with FeatureLockedError');

    // Test 6: Upgrade / Login with Pro Account
    const loginStatus = await licenseManager.login({
        email: 'pro.user@spoorf.app',
        password: 'PasswordPro123'
    });
    assert.strictEqual(loginStatus.isAuthenticated, true);
    assert.strictEqual(loginStatus.license.tier, 'pro');
    assert.strictEqual(loginStatus.license.can_throttle, true);
    assert.strictEqual(loginStatus.license.can_gateway, true);
    assert.strictEqual(loginStatus.license.can_deep_fingerprint, true);
    console.log('  ✓ Pro Upgrade: Login unlocks unlimited cuts, throttling, and deep fingerprinting');

    // Test 7: Pro Tier can now block 6th target without limit
    await deviceManager.blockDevice(targets[5].ip, gwDevice.ip);
    assert.strictEqual(targets[5].is_blocked, true);
    console.log('  ✓ Pro Execution: 6th target block succeeded without restriction');

    // Test 8: Pro Tier can now throttle target speed
    await deviceManager.setSpeedLimit(targets[1].ip, 35);
    assert.strictEqual(targets[1].speed_limit, 35);
    console.log('  ✓ Pro Execution: Target speed throttled to 35% successfully');

    // Test 9: Persistence & Grace Period restored on new LicenseManager instance
    const newLicenseManager = new LicenseManager(db);
    await newLicenseManager.init();
    const restoredStatus = newLicenseManager.getStatus();
    assert.strictEqual(restoredStatus.isAuthenticated, true);
    assert.strictEqual(restoredStatus.license.tier, 'pro');
    assert.strictEqual(restoredStatus.isOfflineGracePeriod, true);
    console.log('  ✓ Offline Resilience: Pro license and 7-day grace period restored from SQLite cache');

    // Test 10: License Key Activation (PRO-SENTINEL-2026)
    const keyStatus = await licenseManager.activateLicenseKey('PRO-SENTINEL-2026-KEY');
    assert.strictEqual(keyStatus.license.tier, 'pro');
    console.log('  ✓ License Key: Activation key PRO-SENTINEL successfully applied');

    // Test 11: Logout reverts to Free baseline
    await licenseManager.logout();
    const afterLogoutStatus = licenseManager.getStatus();
    assert.strictEqual(afterLogoutStatus.isAuthenticated, false);
    assert.strictEqual(afterLogoutStatus.license.tier, 'free');
    console.log('  ✓ Logout Cleanliness: Session cleared and reverted to Free baseline');

    await db.close();

    // Pulihkan flag demo agar tidak bocor ke test lain.
    if (prevDemoFlag === undefined) {
        delete process.env.SPOORF_ALLOW_DEMO_LICENSE;
    } else {
        process.env.SPOORF_ALLOW_DEMO_LICENSE = prevDemoFlag;
    }
}
