import assert from 'assert';

export async function runPythonBridgeTests() {
    console.log('\n--- [Node] Testing PythonBridge Dependency-Failure Resilience ---');

    // Arahkan bridge ke port mati SEBELUM import/instansiasi (konstruktor tidak melakukan I/O).
    process.env.PYTHON_SERVICE_URL = 'http://127.0.0.1:59999';
    const { PythonBridge } = await import('../src/services/pythonBridge');
    const bridge = new PythonBridge();

    // Contract: native Python event names must flow through the existing Node event API.
    {
        const received: Record<string, any> = {};
        bridge.once('deviceLivenessChanged', data => { received.device = data; });
        bridge.once('arpThreatDetected', data => { received.threat = data; });
        bridge.once('shieldStatusChanged', data => { received.shield = data; });

        (bridge as any).handlePythonEvent({
            event: 'device_offline_pulse',
            data: { ip: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:ff', vector: 'arp' }
        });
        (bridge as any).handlePythonEvent({
            event: 'arp_threat_detected',
            data: { attacker_mac: 'de:ad:be:ef:00:01' }
        });
        (bridge as any).handlePythonEvent({
            event: 'shield_status_changed',
            data: { is_enabled: true, mode: 'host_lock' }
        });

        assert.deepStrictEqual(received.device, {
            ip: '192.168.1.20',
            mac: 'aa:bb:cc:dd:ee:ff',
            vector: 'arp',
            is_online: false
        });
        assert.strictEqual(received.threat.attacker_mac, 'de:ad:be:ef:00:01');
        assert.strictEqual(received.shield.is_enabled, true);

        let legacyReceived: any;
        bridge.once('deviceLivenessChanged', data => { legacyReceived = data; });
        (bridge as any).handlePythonEvent({
            event: 'device_liveness_changed',
            data: { ip: '192.168.1.21', mac: '11:22:33:44:55:66', is_online: true }
        });
        assert.strictEqual(legacyReceived.is_online, true, 'legacy liveness alias must remain supported');
        console.log('  ✓ Contract: canonical Python events and legacy liveness alias are normalized');
    }

    // Contract: Bettercap DNS configuration must not be reduced to only the rules array.
    {
        const originalFetch = globalThis.fetch;
        const payload = {
            success: true,
            rules: [{ id: 'rule-1', domain: 'example.test', target_ip: '192.168.1.5' }],
            spoof_all_enabled: true,
            spoof_all_address: '192.168.1.9',
            default_ttl: 42
        };
        try {
            (bridge as any).ready = true;
            globalThis.fetch = (async () => new Response(JSON.stringify(payload), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })) as typeof fetch;
            assert.deepStrictEqual(await bridge.getBettercapDnsRules(), payload);
        } finally {
            globalThis.fetch = originalFetch;
        }
        console.log('  ✓ Contract: Bettercap DNS rules and configuration fields are preserved');
    }

    // Contract: Technique 3B can suppress a duplicate multicast wake-up in its one scan.
    {
        const originalFetch = globalThis.fetch;
        const requests: Array<{ url: string; body?: string }> = [];
        const wakeupPayload = {
            success: true,
            data: {
                delivery: { attempted: 6, succeeded: 5, failed: 1 },
                dhcp_delta: { new_count: 1, updated_count: 2 },
                observation_seconds: 4
            }
        };
        try {
            (bridge as any).ready = true;
            globalThis.fetch = (async (input: any, init?: RequestInit) => {
                const url = String(input);
                requests.push({
                    url,
                    body: typeof init?.body === 'string' ? init.body : undefined
                });
                const payload = url.endsWith('/api/scan')
                    ? { success: true, data: { devices: [] } }
                    : wakeupPayload;
                return new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }) as typeof fetch;

            await bridge.scan({ skipMulticastWakeup: true });
            await bridge.scan();
            const observed = await bridge.optimizeDhcpProfiling();

            assert.deepStrictEqual(
                JSON.parse(requests[0].body || '{}'),
                { skip_multicast_wakeup: true }
            );
            assert.strictEqual(requests[1].body, undefined);
            assert.deepStrictEqual(observed, wakeupPayload);
        } finally {
            globalThis.fetch = originalFetch;
        }
        console.log('  ✓ Contract: Technique 3B scan options and measured observation survive the bridge');
    }

    // Contract: HTTP 200 is not success when Python explicitly returns success:false.
    {
        const originalFetch = globalThis.fetch;
        try {
            (bridge as any).ready = true;
            globalThis.fetch = (async () => new Response(JSON.stringify({
                success: false,
                error: 'Spoof session not found'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })) as typeof fetch;

            await assert.rejects(
                () => bridge.setSpoofLimit('missing-session', 25),
                /Spoof session not found/
            );
            await assert.rejects(
                () => bridge.stopSpoof('missing-session'),
                /Spoof session not found/
            );
            await assert.rejects(
                () => bridge.stopAll(),
                /Spoof session not found/
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
        console.log('  ✓ Contract: spoof limit, stop, and stop-all reject logical failures');
    }

    // Contract: stopAll must also reject non-2xx responses instead of logging success.
    {
        const originalFetch = globalThis.fetch;
        try {
            (bridge as any).ready = true;
            globalThis.fetch = (async () => new Response(JSON.stringify({
                success: false,
                error: 'Python shutdown unavailable'
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            })) as typeof fetch;
            await assert.rejects(
                () => bridge.stopAll(),
                (error: any) =>
                    error.name === 'BridgeHttpError' &&
                    error.status === 503 &&
                    /HTTP 503/.test(error.message) &&
                    !error.message.includes('Python shutdown unavailable')
            );

            globalThis.fetch = (async () => new Response(JSON.stringify({
                detail: [{ loc: ['body', 'speed_limit'], msg: 'Input should be less than or equal to 100' }]
            }), {
                status: 422,
                headers: { 'Content-Type': 'application/json' }
            })) as typeof fetch;
            await assert.rejects(
                () => bridge.setSpoofLimit('session-1', 101),
                (error: any) =>
                    error.name === 'BridgeHttpError' &&
                    error.status === 422 &&
                    error.message === 'body.speed_limit: Input should be less than or equal to 100'
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
        console.log('  ✓ Contract: HTTP failures are typed, safe, and preserve validation detail');
    }

    // Test 1: getTelemetry mengembalikan null (bukan throw/hang) saat engine tak terjangkau
    {
        (bridge as any).ready = false;
        const telemetry = await bridge.getTelemetry();
        assert.strictEqual(telemetry, null, 'getTelemetry harus null saat Python tak terjangkau');
        console.log('  ✓ Resilience: getTelemetry mengembalikan null saat engine mati');
    }

    // Test 2: getWifiInfo mengembalikan default aman
    {
        const wifi = await bridge.getWifiInfo();
        assert.strictEqual(wifi.connected, false, 'wifi.connected harus false');
        assert.strictEqual(wifi.state, 'error', "wifi.state harus 'error'");
        console.log('  ✓ Resilience: getWifiInfo mengembalikan default saat engine mati');
    }

    // Test 3: getTransparentGatewayStatus mengembalikan default (tanpa sesi)
    {
        const status = await bridge.getTransparentGatewayStatus();
        assert.strictEqual(status.active_count, 0, 'active_count harus 0');
        assert.deepStrictEqual(status.active_sessions, {}, 'active_sessions harus kosong');
        console.log('  ✓ Resilience: getTransparentGatewayStatus mengembalikan default saat engine mati');
    }

    // Test 4: Operasi kritikal (scan) MENOLAK dengan benar, tidak menggantung
    {
        await assert.rejects(
            () => bridge.scan(),
            'scan() harus reject saat engine tak terjangkau (bukan menggantung selamanya)'
        );
        console.log('  ✓ Resilience: scan() menolak (reject) saat engine mati, tidak menggantung');
    }

    // Bersihkan agar tidak memengaruhi test lain
    delete process.env.PYTHON_SERVICE_URL;
}
