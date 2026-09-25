import assert from 'assert';
import crypto from 'crypto';
import { DatabaseService } from '../src/services/database';
import { LicenseManager, DEFAULT_FREE_LICENSE, PRO_TIER_LICENSE, VIP_TIER_LICENSE, FeatureLimitError, FeatureLockedError, isTrustedCloudUrl } from '../src/services/licenseManager';
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

    async stopRedirect(_victimIp: string): Promise<void> {}
    async scan(): Promise<any[]> { return []; }
    async getStatus(): Promise<any> { return { ready: true, sessions: {} }; }
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

    // Test 5b: Free Tier blocked from Deep Fingerprint port scan (FeatureLockedError)
    await assert.rejects(
        () => deviceManager.deepScanDevicePorts(targets[5].ip),
        (err: any) => err instanceof FeatureLockedError || err.code === 'FEATURE_LOCKED_PRO'
    );
    console.log('  ✓ Free Tier Guard: Deep fingerprint port scan rejected with FeatureLockedError');

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
    newLicenseManager.shutdown();
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

    // ULTRAREVIEW #3: anti-SSRF cloudUrl harus memeriksa port DAN path, bukan hanya protokol+host.
    {
        const official = 'https://api.spoorf.app/v1';
        assert.strictEqual(isTrustedCloudUrl(official, official), true, 'endpoint resmi identik harus dipercaya');
        assert.strictEqual(isTrustedCloudUrl('https://api.spoorf.app/v1/', official), true, 'trailing slash tetap dipercaya');
        assert.strictEqual(isTrustedCloudUrl('https://api.spoorf.app:8443/v1', official), false, 'port berbeda pada host resmi harus ditolak');
        assert.strictEqual(isTrustedCloudUrl('https://api.spoorf.app/mirror/upload', official), false, 'path berbeda pada host resmi harus ditolak');
        assert.strictEqual(isTrustedCloudUrl('http://localhost:4000/v1', official), true, 'loopback localhost:4000/v1 harus dipercaya untuk dev');
        assert.strictEqual(isTrustedCloudUrl('http://127.0.0.1:4000/v1', official), true, 'loopback 127.0.0.1:4000/v1 harus dipercaya untuk dev');
        assert.strictEqual(isTrustedCloudUrl('http://localhost:4000/mirror/upload', official), false, 'path arbitrer pada localhost harus ditolak');
        assert.strictEqual(isTrustedCloudUrl('http://localhost:9999/v1', official), false, 'port selain 4000 pada localhost harus ditolak');
        console.log('  ✓ ULTRAREVIEW #3: cloudUrl anti-SSRF menolak port/path arbitrer pada host resmi');
    }

    // Test 12: Production Offline Guard (503 UpstreamServiceError when cloud unreachable and demo disabled)
    {
        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'false';
        const offlineDb = new DatabaseService(':memory:');
        await offlineDb.init();
        const offlineLm = new LicenseManager(offlineDb, 'http://127.0.0.1:59999/v1');
        let thrownErr: any;
        try {
            await offlineLm.login({ email: 'test@example.com', password: 'pass' });
        } catch (err) {
            thrownErr = err;
        }
        assert.ok(thrownErr, 'Harus melempar error saat cloud tidak dapat dihubungi dan demo nonaktif');
        assert.strictEqual(thrownErr.statusCode, 503, 'Harus berstatus HTTP 503');
        assert.strictEqual(thrownErr.code, 'CLOUD_UNAVAILABLE', 'Harus berkode CLOUD_UNAVAILABLE');
        assert.match(thrownErr.message, /Server cloud tidak dapat dihubungi/);
        await offlineDb.close();
        console.log('  ✓ Production Offline Guard: Melempar 503 CLOUD_UNAVAILABLE saat koneksi gagal');
    }

    // Test 13: Background Heartbeat Sliding Window (HTTP 200)
    {
        const hbDb = new DatabaseService(':memory:');
        await hbDb.init();
        const hbLm = new LicenseManager(hbDb, 'http://127.0.0.1:4000/v1');
        await hbLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await hbLm.login({ email: 'pro_operator@sentinel.lan', password: 'secret' });
        assert.strictEqual(hbLm.getStatus().license.tier, 'pro');

        const origFetch = global.fetch;
        const extendedGrace = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        const rotatedToken = 'spoorf_jwt_rotated_mock_token';

        (global as any).fetch = async (url: string, opts: any) => {
            if (url.includes('/auth/heartbeat')) {
                assert.match(opts.headers.Authorization, /^Bearer /);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        status: 'success',
                        token: rotatedToken,
                        isRevoked: false,
                        grace_period_until: extendedGrace
                    })
                };
            }
            return origFetch(url, opts);
        };

        try {
            await hbLm.heartbeat();
            const statusAfterHb = hbLm.getStatus();
            assert.strictEqual(statusAfterHb.license.grace_period_until, extendedGrace);

            const cached = await hbDb.getLicenseCache();
            assert.strictEqual(cached?.token, rotatedToken);
            assert.strictEqual(cached?.grace_period_until, extendedGrace);
            console.log('  ✓ Heartbeat Sliding Window: Grace period successfully slid forward and token rotated in SQLite');
        } finally {
            global.fetch = origFetch;
            hbLm.shutdown();
            await hbDb.close();
        }
    }

    // Test 14: Remote Session Revocation (Kick Mechanism - HTTP 401 SESSION_REVOKED)
    {
        const kickDb = new DatabaseService(':memory:');
        await kickDb.init();
        const kickLm = new LicenseManager(kickDb, 'http://127.0.0.1:4000/v1');
        await kickLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await kickLm.login({ email: 'pro_kicked@sentinel.lan', password: 'secret' });
        assert.strictEqual(kickLm.getStatus().license.tier, 'pro');

        let revokedEventPayload: any = null;
        let downgradedEventPayload: any = null;
        kickLm.on('sessionRevoked', (p) => { revokedEventPayload = p; });
        kickLm.on('downgraded', (p) => { downgradedEventPayload = p; });

        const origFetch = global.fetch;
        (global as any).fetch = async (url: string, opts: any) => {
            if (url.includes('/auth/heartbeat')) {
                return {
                    ok: false,
                    status: 401,
                    json: async () => ({
                        success: false,
                        error: {
                            code: 'SESSION_REVOKED',
                            message: 'Sesi Anda telah dicabut karena batas login bersamaan terlampaui.',
                            details: { isRevoked: true }
                        }
                    })
                };
            }
            return origFetch(url, opts);
        };

        try {
            await kickLm.heartbeat();
            const statusAfterKick = kickLm.getStatus();
            assert.strictEqual(statusAfterKick.isAuthenticated, false);
            assert.strictEqual(statusAfterKick.license.tier, 'free');
            assert.strictEqual(statusAfterKick.user, null);

            const cached = await kickDb.getLicenseCache();
            assert.strictEqual(cached, null);

            assert.ok(revokedEventPayload, 'sessionRevoked event must be emitted');
            assert.strictEqual(revokedEventPayload.tier, 'free');
            assert.strictEqual(revokedEventPayload.previousTier, 'pro');
            assert.match(revokedEventPayload.reason, /telah dicabut/);

            assert.ok(downgradedEventPayload, 'downgraded event must be emitted');
            console.log('  ✓ Remote Kick: SESSION_REVOKED instantaneously downgrades to Free, clears cache, and emits sessionRevoked');
        } finally {
            global.fetch = origFetch;
            kickLm.shutdown();
            await kickDb.close();
        }
    }

    // Test 15: Offline Resilience Invariant (Network failure within grace period does NOT downgrade)
    {
        const offlineDb = new DatabaseService(':memory:');
        await offlineDb.init();
        const offlineLm = new LicenseManager(offlineDb, 'http://127.0.0.1:4000/v1');
        await offlineLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await offlineLm.login({ email: 'pro_field_worker@sentinel.lan', password: 'secret' });
        assert.strictEqual(offlineLm.getStatus().license.tier, 'pro');

        const origFetch = global.fetch;
        (global as any).fetch = async () => {
            throw new Error('fetch failed: ENOTFOUND api.spoorf.app');
        };

        try {
            await offlineLm.heartbeat();

            const status = offlineLm.getStatus();
            assert.strictEqual(status.isAuthenticated, true);
            assert.strictEqual(status.license.tier, 'pro');
            assert.strictEqual(status.isOfflineGracePeriod, true);
            console.log('  ✓ Offline Resilience Invariant: Network outage does NOT downgrade while within 7-day grace period');
        } finally {
            global.fetch = origFetch;
            offlineLm.shutdown();
            await offlineDb.close();
        }
    }

    // Test 16: Offline Grace Exhaustion (Network failure AFTER grace period expires downgrades to Free)
    {
        const expDb = new DatabaseService(':memory:');
        await expDb.init();
        const expLm = new LicenseManager(expDb, 'http://127.0.0.1:4000/v1');
        await expLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await expLm.login({ email: 'pro_expired@sentinel.lan', password: 'secret' });

        (expLm as any).currentLicense.grace_period_until = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const origFetch = global.fetch;
        (global as any).fetch = async () => {
            throw new Error('fetch failed: ENOTFOUND api.spoorf.app');
        };

        try {
            await expLm.heartbeat();
            const status = expLm.getStatus();
            assert.strictEqual(status.isAuthenticated, false);
            assert.strictEqual(status.license.tier, 'free');
            console.log('  ✓ Offline Grace Exhaustion: Reverts to Free when grace period has truly expired');
        } finally {
            global.fetch = origFetch;
            expLm.shutdown();
            await expDb.close();
        }
    }

    // Test 17: Active Enforcement Downgrade Reconciliation (Throttles reset, redirects stopped, cuts capped at 5)
    {
        const reconDb = new DatabaseService(':memory:');
        await reconDb.init();
        const reconLm = new LicenseManager(reconDb);
        await reconLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await reconLm.login({ email: 'pro_recon@sentinel.lan', password: 'secret' });

        const mockPy = new MockPythonBridge();
        const dm = new DeviceManager(mockPy, reconDb, reconLm);

        const gw: Device = {
            ip: '192.168.1.1',
            mac: '00:11:22:33:44:01',
            hostname: 'Router-GW',
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
        const host: Device = {
            ip: '192.168.1.50',
            mac: '00:11:22:33:44:50',
            hostname: 'This-PC',
            vendor: 'Lenovo',
            is_gateway: false,
            is_self: true,
            is_online: true,
            is_blocked: false,
            open_ports: [],
            services: [],
            device_type: 'PC',
            os: 'Windows',
            rtt_ms: 1
        };
        (dm as any).devices.set(gw.ip, gw);
        (dm as any).devices.set(host.ip, host);

        for (let i = 1; i <= 7; i++) {
            const sid = `sess_10${i}`;
            const dev: Device = {
                ip: `192.168.1.10${i}`,
                mac: `00:11:22:33:44:a${i}`,
                hostname: `Target-${i}`,
                vendor: 'Vendor',
                is_gateway: false,
                is_self: false,
                is_online: true,
                is_blocked: true,
                session_id: sid,
                speed_limit: 0, // Cut-off targets have speed_limit 0
                open_ports: [],
                services: [],
                device_type: 'Mobile',
                os: 'Android',
                rtt_ms: 10
            };
            (dm as any).devices.set(dev.ip, dev);
            mockPy.mockStartedSpoofs.push(sid);
        }

        // Add 1 throttled device that is NOT blocked
        const throttledDev: Device = {
            ip: '192.168.1.115',
            mac: '00:11:22:33:44:b5',
            hostname: 'Throttled-Target',
            vendor: 'Vendor',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            session_id: 'sess_115',
            speed_limit: 35,
            open_ports: [],
            services: [],
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 10
        };
        (dm as any).devices.set(throttledDev.ip, throttledDev);
        mockPy.mockStartedSpoofs.push(throttledDev.session_id!);
        mockPy.mockThrottled.set(throttledDev.session_id!, 35);

        const redirDev: Device = {
            ip: '192.168.1.120',
            mac: '00:11:22:33:44:c0',
            hostname: 'Redirect-Target',
            vendor: 'Vendor',
            is_gateway: false,
            is_self: false,
            is_online: true,
            is_blocked: false,
            is_redirected: true,
            redirect_url: 'http://block.lan',
            open_ports: [],
            services: [],
            device_type: 'Mobile',
            os: 'Android',
            rtt_ms: 10
        };
        (dm as any).devices.set(redirDev.ip, redirDev);

        assert.strictEqual(Array.from((dm as any).devices.values()).filter((d: any) => d.is_blocked).length, 7);

        const reconRes = await dm.reconcileActiveEnforcementsToFree();

        // 1. Throttles must be reset to 100 for non-blocked devices only
        const targetThrottled = (dm as any).devices.get('192.168.1.115');
        assert.strictEqual(targetThrottled.speed_limit, 100, 'Throttled target speed_limit must be reset to 100');
        assert.ok(reconRes.throttlesReset.includes('192.168.1.115'));

        // Retained blocked devices must NOT be in throttlesReset and must keep speed_limit 0
        const retainedTarget = (dm as any).devices.get('192.168.1.101');
        assert.strictEqual(retainedTarget.is_blocked, true);
        assert.strictEqual(retainedTarget.speed_limit, 0, 'Retained blocked device must keep speed_limit 0 (cut-off)');
        assert.strictEqual(reconRes.throttlesReset.includes('192.168.1.101'), false);

        const redirAfter = (dm as any).devices.get('192.168.1.120');
        assert.strictEqual(redirAfter.is_redirected, false, 'Redirect must be stopped');
        assert.strictEqual(redirAfter.redirect_url, undefined);
        assert.ok(reconRes.redirectsReset.includes('192.168.1.120'));

        const remainingBlocked = Array.from((dm as any).devices.values()).filter((d: any) => d.is_blocked);
        assert.strictEqual(remainingBlocked.length, 5, 'Blocked count must be capped at Free limit (5)');
        assert.strictEqual(reconRes.unblocked.length, 2, 'Exactly 2 excess devices must be unblocked');

        assert.strictEqual(gw.is_blocked, false);
        assert.strictEqual(host.is_blocked, false);

        console.log('  ✓ Active Enforcement Reconciler: Throttles reset, redirects stopped, and cuts capped at 5 without touching gateway, host, or corrupting blocked targets');

        reconLm.shutdown();
        await reconDb.close();
    }

    // Test 18: Explicit Logout Emits 'downgraded'
    {
        const logoutDb = new DatabaseService(':memory:');
        await logoutDb.init();
        const logoutLm = new LicenseManager(logoutDb);
        await logoutLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await logoutLm.login({ email: 'pro_logout@sentinel.lan', password: 'secret' });
        assert.strictEqual(logoutLm.getStatus().license.tier, 'pro');

        let downgradedFired = false;
        logoutLm.on('downgraded', (payload) => {
            if (payload?.tier === 'free' && payload?.previousTier === 'pro') {
                downgradedFired = true;
            }
        });

        await logoutLm.logout();
        assert.strictEqual(downgradedFired, true, 'Logout from Pro must emit downgraded event');
        assert.strictEqual(logoutLm.getStatus().license.tier, 'free');
        console.log('  ✓ Logout Downgrade Event: Explicit logout from Pro emits downgraded event for system reconciliation');

        logoutLm.shutdown();
        await logoutDb.close();
    }

    // Test 19: Late Heartbeat Fetch Response Does Not Resurrect Logged-Out Token
    {
        const raceDb = new DatabaseService(':memory:');
        await raceDb.init();
        const raceLm = new LicenseManager(raceDb, 'http://127.0.0.1:4000/v1');
        await raceLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await raceLm.login({ email: 'pro_race@sentinel.lan', password: 'secret' });
        assert.strictEqual(raceLm.getStatus().license.tier, 'pro');

        const origFetch = global.fetch;
        let resolveFetch: (val: any) => void;
        const fetchPromise = new Promise((resolve) => {
            resolveFetch = resolve;
        });

        (global as any).fetch = () => fetchPromise;

        try {
            // Start heartbeat in background
            const hbPromise = raceLm.heartbeat();

            // While fetch is pending, user logs out
            await raceLm.logout();
            assert.strictEqual(raceLm.getStatus().isAuthenticated, false);

            // Now resolve the late fetch with HTTP 200 and a token
            resolveFetch!({
                ok: true,
                status: 200,
                json: async () => ({
                    status: 'success',
                    token: 'resurrected_token_should_be_ignored',
                    grace_period_until: new Date(Date.now() + 7 * 86400000).toISOString()
                })
            });

            await hbPromise;

            // Assert token was NOT resurrected
            const finalStatus = raceLm.getStatus();
            assert.strictEqual(finalStatus.isAuthenticated, false);
            assert.strictEqual(finalStatus.license.tier, 'free');
            assert.strictEqual((raceLm as any).currentToken, null);
            console.log('  ✓ Race Condition Safety: Late heartbeat response after logout does not resurrect session token');
        } finally {
            global.fetch = origFetch;
            raceLm.shutdown();
            await raceDb.close();
        }
    }

    // Test 20: Authenticated Free Tier Heartbeat Lifecycle & Remote Kick
    {
        const freeDb = new DatabaseService(':memory:');
        await freeDb.init();
        const freeLm = new LicenseManager(freeDb, 'http://127.0.0.1:4000/v1');
        await freeLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await freeLm.login({ email: 'free_operator@sentinel.lan', password: 'secret' });
        assert.strictEqual(freeLm.getStatus().license.tier, 'free');
        assert.strictEqual(freeLm.getStatus().isAuthenticated, true);

        // 1. Verify heartbeat timer is started automatically upon login
        assert.ok((freeLm as any).heartbeatTimer !== null, 'Heartbeat timer must be started automatically on login for free tier');

        let heartbeatCalls = 0;
        let revokedFired = false;
        freeLm.on('sessionRevoked', () => { revokedFired = true; });

        const origFetch = global.fetch;
        (global as any).fetch = async (url: string, opts: any) => {
            if (url.includes('/auth/heartbeat')) {
                heartbeatCalls++;
                return {
                    ok: false,
                    status: 401,
                    json: async () => ({
                        error: 'SESSION_REVOKED',
                        message: 'Sesi diputuskan dari Cloud Web Portal'
                    })
                };
            }
            return origFetch(url, opts);
        };

        try {
            await freeLm.heartbeat();
            assert.strictEqual(heartbeatCalls, 1);
            assert.strictEqual(revokedFired, true, 'sessionRevoked must fire on Free tier when Cloud returns SESSION_REVOKED');
            assert.strictEqual(freeLm.getStatus().isAuthenticated, false, 'Free tier must be unauthenticated after SESSION_REVOKED');
            assert.strictEqual((freeLm as any).heartbeatTimer, null, 'Heartbeat timer must be stopped after session revoked');
            console.log('  ✓ Free Tier Heartbeat: Automatic lifecycle and remote kick handling verified for free accounts');
        } finally {
            global.fetch = origFetch;
            freeLm.shutdown();
            await freeDb.close();
        }
    }

    // Test 21: setHeartbeatInterval Reschedules Active Timer
    {
        const intervalDb = new DatabaseService(':memory:');
        await intervalDb.init();
        const intervalLm = new LicenseManager(intervalDb, 'http://127.0.0.1:4000/v1');
        await intervalLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await intervalLm.login({ email: 'operator@sentinel.lan', password: 'secret' });

        const initialTimer = (intervalLm as any).heartbeatTimer;
        assert.ok(initialTimer !== null, 'Heartbeat timer must be active after login');

        // Dynamically update interval
        intervalLm.setHeartbeatInterval(2500, 0);
        const rescheduledTimer = (intervalLm as any).heartbeatTimer;
        assert.ok(rescheduledTimer !== null, 'Rescheduled timer must be armed');
        assert.notStrictEqual(rescheduledTimer, initialTimer, 'Timer must be replaced with new rescheduled instance');
        assert.strictEqual((intervalLm as any).heartbeatIntervalMs, 2500, 'Interval MS must be updated');
        console.log('  ✓ setHeartbeatInterval: Dynamically reschedules active timers immediately');

        intervalLm.shutdown();
        await intervalDb.close();
    }

    // Cloud contract helpers (Tests 22-32): RS256 tokens signed with a test-only keypair,
    // verified by LicenseManager instances constructed with the matching public key.
    const TEST_KEYS = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const OTHER_KEYS = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const CLOUD_URL = 'http://127.0.0.1:4000/v1';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const b64u = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const signToken = (claims: Record<string, any>, privateKey: string = TEST_KEYS.privateKey) => {
        const nowSec = Math.floor(Date.now() / 1000);
        const header = b64u({ alg: 'RS256', typ: 'JWT' });
        const payload = b64u({ iss: 'https://api.spoorf.app', iat: nowSec, exp: nowSec + 30 * 24 * 3600, ...claims });
        const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
        return `${header}.${payload}.${signature}`;
    };
    const claimsFor = (tier: 'free' | 'pro' | 'vip', sessionId: string, overrides: Record<string, any> = {}) => {
        const base = tier === 'vip' ? VIP_TIER_LICENSE : tier === 'pro' ? PRO_TIER_LICENSE : DEFAULT_FREE_LICENSE;
        return {
            userId: 'usr_cloud',
            email: 'cloud@spoorf.app',
            tier,
            maxCuts: base.max_cuts,
            canThrottle: base.can_throttle,
            canGateway: base.can_gateway,
            canAutoreblock: base.can_autoreblock,
            canArsenal: base.can_arsenal,
            canDeepFingerprint: base.can_deep_fingerprint,
            cloudSync: base.cloud_sync,
            sessionId,
            expiresAt: null,
            gracePeriodUntil: new Date(Date.now() + 7 * DAY_MS).toISOString(),
            ...overrides
        };
    };
    const newCloudLm = async (db: DatabaseService) => {
        const lm = new LicenseManager(db, CLOUD_URL, { publicKeyPem: TEST_KEYS.publicKey });
        await lm.init();
        return lm;
    };
    const withFetch = async (mock: (url: string, opts: any) => any, fn: () => Promise<void>) => {
        const origFetch = global.fetch;
        (global as any).fetch = mock;
        try {
            await fn();
        } finally {
            global.fetch = origFetch;
        }
    };
    const loginViaCloud = async (lm: LicenseManager, tier: 'free' | 'pro' | 'vip') => {
        const sessionId = lm.getStatus().sessionId!;
        await withFetch(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                status: 'success',
                token: signToken(claimsFor(tier, sessionId)),
                user: { id: 'usr_cloud', email: 'cloud@spoorf.app', name: 'Cloud', avatar_url: null },
                license: { ...DEFAULT_FREE_LICENSE, tier }
            })
        }), async () => {
            await lm.login({ email: 'cloud@spoorf.app', password: 'secret' });
        });
    };
    const heartbeatReturning = (token: string, extra: Record<string, any> = {}) => async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'success', token, isRevoked: false, ...extra })
    });

    process.env.SPOORF_ALLOW_DEMO_LICENSE = 'false';

    // Test 22: Heartbeat token resyncs tier (server-side downgrade/expiry reaches desktop)
    {
        const syncDb = new DatabaseService(':memory:');
        await syncDb.init();
        const syncLm = await newCloudLm(syncDb);
        await loginViaCloud(syncLm, 'pro');
        assert.strictEqual(syncLm.getStatus().license.tier, 'pro');

        let downgradedPayload: any = null;
        syncLm.on('downgraded', (payload) => { downgradedPayload = payload; });

        const sessionId = syncLm.getStatus().sessionId!;
        const expiredClaims = claimsFor('pro', sessionId, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
        await withFetch(heartbeatReturning(signToken(expiredClaims)), async () => {
            await syncLm.heartbeat();
        });

        assert.strictEqual(syncLm.getStatus().license.tier, 'free', 'Expired license in the signed token must be served as Free');
        assert.strictEqual(syncLm.getStatus().license.can_throttle, false);
        assert.strictEqual(syncLm.getStatus().isAuthenticated, true, 'Downgrade keeps the user signed in');
        assert.strictEqual(downgradedPayload?.previousTier, 'pro');
        assert.strictEqual((await syncDb.getLicenseCache())?.tier, 'free', 'Resynced tier must be persisted');
        console.log('  ✓ Heartbeat License Resync: server-side downgrade applied from signed token, persisted, emits downgraded');
        syncLm.shutdown();
        await syncDb.close();
    }

    // Test 23: Heartbeat token applies upgrades (voucher redeemed on web portal)
    {
        const upDb = new DatabaseService(':memory:');
        await upDb.init();
        const upLm = await newCloudLm(upDb);
        await loginViaCloud(upLm, 'free');

        const sessionId = upLm.getStatus().sessionId!;
        await withFetch(heartbeatReturning(signToken(claimsFor('vip', sessionId))), async () => {
            await upLm.heartbeat();
        });
        assert.strictEqual(upLm.getStatus().license.tier, 'vip');
        assert.strictEqual(upLm.getStatus().license.can_arsenal, true);
        console.log('  ✓ Heartbeat License Resync: web-portal upgrade reaches desktop without re-login');
        upLm.shutdown();
        await upDb.close();
    }

    // Test 24: Outside demo mode, license keys are redeemed through the cloud API
    {
        const keyDb = new DatabaseService(':memory:');
        await keyDb.init();
        const keyLm = await newCloudLm(keyDb);

        await assert.rejects(
            () => keyLm.activateLicenseKey('VIP-ANYTHING-2026'),
            /login/i,
            'Unauthenticated activation must not grant a local tier'
        );
        assert.strictEqual(keyLm.getStatus().license.tier, 'free');

        await loginViaCloud(keyLm, 'free');
        const sessionId = keyLm.getStatus().sessionId!;
        const proToken = signToken(claimsFor('pro', sessionId, { expiresAt: '2099-01-01T00:00:00.000Z' }));
        let redeemCall: any = null;
        await withFetch(async (url: string, opts: any) => {
            redeemCall = { url, opts };
            return {
                ok: true,
                status: 200,
                json: async () => ({ status: 'success', token: proToken, license: { ...DEFAULT_FREE_LICENSE, tier: 'vip' } })
            };
        }, async () => {
            const status = await keyLm.activateLicenseKey(' pro-sentinel-xyz ');
            assert.ok(redeemCall.url.endsWith('/auth/redeem'));
            assert.match(redeemCall.opts.headers.Authorization, /^Bearer /);
            assert.deepStrictEqual(JSON.parse(redeemCall.opts.body), { key: 'PRO-SENTINEL-XYZ' });
            assert.strictEqual(status.license.tier, 'pro', 'Tier must come from the signed token, not the JSON license field');
            assert.strictEqual(keyLm.getStatus().user?.email, 'cloud@spoorf.app', 'Activation keeps the cloud account');
            assert.strictEqual((await keyDb.getLicenseCache())?.token, proToken);
        });

        await withFetch(async () => ({
            ok: false,
            status: 400,
            json: async () => ({ success: false, error: { code: 'BAD_REQUEST', message: 'Kode voucher lisensi ini sudah pernah digunakan.' } })
        }), async () => {
            await assert.rejects(() => keyLm.activateLicenseKey('PRO-USED-KEY'), /sudah pernah digunakan/);
        });
        console.log('  ✓ Cloud Key Activation: keys redeemed via /auth/redeem; tier taken from the signed token');
        keyLm.shutdown();
        await keyDb.close();
    }

    // Test 25: Logout releases the device slot on the cloud (best effort, non-blocking)
    {
        const outDb = new DatabaseService(':memory:');
        await outDb.init();
        const outLm = await newCloudLm(outDb);
        await loginViaCloud(outLm, 'pro');

        let logoutCall: any = null;
        await withFetch(async (url: string, opts: any) => {
            logoutCall = { url, opts };
            throw new Error('offline');
        }, async () => {
            await outLm.logout();
        });
        assert.ok(logoutCall?.url.endsWith('/auth/logout'), 'Logout must notify the cloud');
        assert.match(logoutCall.opts.headers.Authorization, /^Bearer /);
        assert.strictEqual(outLm.getStatus().isAuthenticated, false, 'Local logout must succeed even if the cloud is unreachable');
        console.log('  ✓ Cloud Logout: session slot released on the cloud, local logout unaffected by network errors');
        outLm.shutdown();
        await outDb.close();
    }

    // Test 26: Restored license comes from the verified token claims, not the cache columns
    {
        const cacheDb = new DatabaseService(':memory:');
        await cacheDb.init();
        const cachedRow = {
            user_id: 'usr_cloud',
            email: 'cloud@spoorf.app',
            name: 'Cloud',
            tier: 'vip' as const,
            token: signToken(claimsFor('free', 'session-cache')),
            max_cuts: 9999,
            can_throttle: true,
            can_gateway: true,
            can_autoreblock: true,
            can_arsenal: true,
            cloud_sync: true,
            grace_period_until: new Date(Date.now() + 7 * DAY_MS).toISOString(),
            hwid: 'session-cache'
        };
        await cacheDb.saveLicenseCache(cachedRow);
        const cacheLm = await newCloudLm(cacheDb);
        assert.strictEqual(cacheLm.getStatus().isAuthenticated, true);
        assert.strictEqual(cacheLm.getStatus().license.tier, 'free', 'Cache columns must not override the signed claims');
        assert.strictEqual(cacheLm.getStatus().license.can_arsenal, false);
        assert.strictEqual(cacheLm.getStatus().sessionId, 'session-cache');
        cacheLm.shutdown();
        console.log('  ✓ Signed Cache Restore: tier derived from verified token claims, cache columns ignored');
        await cacheDb.close();
    }

    // Test 27: Cached tokens that fail verification are discarded (wrong key, expired, clock set back)
    {
        const cases: Array<[string, string]> = [
            ['signed by another key', signToken(claimsFor('pro', 's1'), OTHER_KEYS.privateKey)],
            ['expired JWT', signToken(claimsFor('pro', 's2', { exp: Math.floor(Date.now() / 1000) - 60 }))],
            ['issued in the future', signToken(claimsFor('pro', 's3', { iat: Math.floor(Date.now() / 1000) + 3 * 24 * 3600 }))],
            ['grace period elapsed', signToken(claimsFor('pro', 's4', { gracePeriodUntil: new Date(Date.now() - 60_000).toISOString() }))],
            ['missing grace period', signToken(claimsFor('pro', 's5', { gracePeriodUntil: null }))],
            ['not a JWT', 'spoorf_jwt_local_token']
        ];
        for (const [label, token] of cases) {
            const badDb = new DatabaseService(':memory:');
            await badDb.init();
            await badDb.saveLicenseCache({
                user_id: 'usr_cloud', email: 'cloud@spoorf.app', tier: 'pro', token,
                max_cuts: 999, can_throttle: true, can_gateway: true, can_autoreblock: true, can_arsenal: false, cloud_sync: true,
                grace_period_until: new Date(Date.now() + 7 * DAY_MS).toISOString(), hwid: 's'
            });
            const badLm = await newCloudLm(badDb);
            assert.strictEqual(badLm.getStatus().license.tier, 'free', `${label}: must fall back to Free`);
            assert.strictEqual(badLm.getStatus().isAuthenticated, false, `${label}: must not stay signed in`);
            assert.strictEqual(await badDb.getLicenseCache(), null, `${label}: invalid cache must be cleared`);
            badLm.shutdown();
            await badDb.close();
        }
        console.log('  ✓ Token Verification: wrong key, expired, future-dated, lapsed/missing grace and non-JWT tokens are rejected');
    }

    // Test 28: A token from the cloud that fails verification aborts login
    {
        const rejDb = new DatabaseService(':memory:');
        await rejDb.init();
        const rejLm = await newCloudLm(rejDb);
        const sessionId = rejLm.getStatus().sessionId!;
        await withFetch(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ status: 'success', token: signToken(claimsFor('vip', sessionId), OTHER_KEYS.privateKey), user: {}, license: {} })
        }), async () => {
            await assert.rejects(() => rejLm.login({ email: 'cloud@spoorf.app', password: 'secret' }), /tidak dapat diverifikasi/);
        });
        assert.strictEqual(rejLm.getStatus().isAuthenticated, false);
        assert.strictEqual(rejLm.getStatus().license.tier, 'free');
        console.log('  ✓ Login Verification: unverifiable cloud token is rejected and nothing is persisted');
        rejLm.shutdown();
        await rejDb.close();
    }

    // Test 29: A heartbeat response that arrives after logout cannot resurrect the session
    {
        const raceDb2 = new DatabaseService(':memory:');
        await raceDb2.init();
        const raceLm2 = await newCloudLm(raceDb2);
        await loginViaCloud(raceLm2, 'pro');
        const sessionId = raceLm2.getStatus().sessionId!;

        let releaseJson!: () => void;
        const jsonGate = new Promise<void>((resolve) => { releaseJson = resolve; });
        await withFetch(async (url: string) => {
            if (!url.includes('/auth/heartbeat')) throw new Error('offline');
            return {
                ok: true,
                status: 200,
                json: async () => {
                    await jsonGate;
                    return { status: 'success', token: signToken(claimsFor('vip', sessionId)), isRevoked: false };
                }
            };
        }, async () => {
            const pending = raceLm2.heartbeat();
            await new Promise((r) => setImmediate(r));
            await raceLm2.logout();
            releaseJson();
            await pending;
        });

        assert.strictEqual(raceLm2.getStatus().isAuthenticated, false);
        assert.strictEqual(raceLm2.getStatus().license.tier, 'free', 'Late heartbeat must not re-apply a paid tier after logout');
        assert.strictEqual((raceLm2 as any).currentToken, null, 'Late heartbeat must not resurrect the token');
        assert.strictEqual((raceLm2 as any).heartbeatTimer, null, 'Late heartbeat must not reschedule');
        console.log('  ✓ Heartbeat Race Guard: responses from a previous session are discarded after every await');
        raceLm2.shutdown();
        await raceDb2.close();
    }

    // Test 30: Heartbeat 403/404 ends the session instead of continuing on grace
    {
        for (const status of [403, 404]) {
            const rejectDb = new DatabaseService(':memory:');
            await rejectDb.init();
            const rejectLm = await newCloudLm(rejectDb);
            await loginViaCloud(rejectLm, 'pro');
            await withFetch(async () => ({
                ok: false,
                status,
                json: async () => ({ success: false, error: { code: 'FORBIDDEN', message: 'session mismatch' } })
            }), async () => {
                await rejectLm.heartbeat();
            });
            assert.strictEqual(rejectLm.getStatus().isAuthenticated, false, `HTTP ${status} must end the session`);
            assert.strictEqual(rejectLm.getStatus().license.tier, 'free');
            rejectLm.shutdown();
            await rejectDb.close();
        }
        console.log('  ✓ Heartbeat Rejection: HTTP 403/404 from the cloud ends the session');
    }

    // Test 31: Feature gates for auto-reblock and deep fingerprint follow the license
    {
        const gateDb = new DatabaseService(':memory:');
        await gateDb.init();
        const gateLm = await newCloudLm(gateDb);
        assert.strictEqual(gateLm.checkCanAutoreblock().allowed, false);
        assert.strictEqual(gateLm.checkCanDeepFingerprint().allowed, false);
        assert.match(gateLm.checkCanArsenal().reason || '', /VIP/);
        await loginViaCloud(gateLm, 'pro');
        assert.strictEqual(gateLm.checkCanAutoreblock().allowed, true);
        assert.strictEqual(gateLm.checkCanDeepFingerprint().allowed, true);
        assert.strictEqual(gateLm.checkCanArsenal().allowed, false);
        console.log('  ✓ Feature Gates: auto-reblock & deep fingerprint locked for Free, unlocked for Pro');
        gateLm.shutdown();
        await gateDb.close();
    }

    // Test 32: Revocation from Free does not emit a spurious downgraded event
    {
        const freeRevDb = new DatabaseService(':memory:');
        await freeRevDb.init();
        const freeRevLm = await newCloudLm(freeRevDb);
        await loginViaCloud(freeRevLm, 'free');
        let downgradedCount = 0;
        freeRevLm.on('downgraded', () => { downgradedCount++; });
        await freeRevLm.handleSessionRevoked('kicked');
        assert.strictEqual(downgradedCount, 0);
        console.log('  ✓ Revocation Events: free → free revocation does not trigger reconciliation');
        freeRevLm.shutdown();
        await freeRevDb.close();
    }

    // Test 33: Logout rotates the local session id (a revoked session must not be reactivated on re-login)
    {
        const rotDb = new DatabaseService(':memory:');
        await rotDb.init();
        const rotLm = new LicenseManager(rotDb);
        await rotLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await rotLm.login({ email: 'pro_rotate@sentinel.lan', password: 'secret' });
        const before = rotLm.getStatus().sessionId;

        await rotLm.logout();
        const after = rotLm.getStatus().sessionId;

        assert.notStrictEqual(after, before, 'Logout must rotate the local session id');
        assert.match(after || '', /^[0-9a-f-]{36}$/, 'Rotated session id must be a fresh UUID');
        console.log('  ✓ Session Rotation: logout rotates the local session id so re-login cannot reactivate the revoked session');

        rotLm.shutdown();
        await rotDb.close();
    }

    // Test 34: Remote kick rotates the local session id (offline cache copy cannot be revived on re-login)
    {
        const kickRotDb = new DatabaseService(':memory:');
        await kickRotDb.init();
        const kickRotLm = new LicenseManager(kickRotDb);
        await kickRotLm.init();

        process.env.SPOORF_ALLOW_DEMO_LICENSE = 'true';
        await kickRotLm.login({ email: 'pro_kickrotate@sentinel.lan', password: 'secret' });
        const before = kickRotLm.getStatus().sessionId;

        await kickRotLm.handleSessionRevoked('kicked by another device');
        const after = kickRotLm.getStatus().sessionId;

        assert.notStrictEqual(after, before, 'Remote kick must rotate the local session id');
        assert.match(after || '', /^[0-9a-f-]{36}$/, 'Rotated session id must be a fresh UUID');
        console.log('  ✓ Session Rotation: remote kick rotates the local session id so re-login cannot revive the kicked session');

        kickRotLm.shutdown();
        await kickRotDb.close();
    }

    licenseManager.shutdown();
    await db.close();

    if (prevDemoFlag === undefined) {
        delete process.env.SPOORF_ALLOW_DEMO_LICENSE;
    } else {
        process.env.SPOORF_ALLOW_DEMO_LICENSE = prevDemoFlag;
    }
}
