import assert from 'assert';

export async function runPythonBridgeTests() {
    console.log('\n--- [Node] Testing PythonBridge Dependency-Failure Resilience ---');

    // Arahkan bridge ke port mati SEBELUM import/instansiasi (konstruktor tidak melakukan I/O).
    process.env.PYTHON_SERVICE_URL = 'http://127.0.0.1:59999';
    const { PythonBridge } = await import('../src/services/pythonBridge');
    const bridge = new PythonBridge();

    // Test 1: getTelemetry mengembalikan null (bukan throw/hang) saat engine tak terjangkau
    {
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
