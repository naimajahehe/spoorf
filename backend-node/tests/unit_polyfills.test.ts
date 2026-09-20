import assert from 'assert';
import { applyDiagnosticsChannelPolyfill } from '../src/polyfills';

export async function runPolyfillsTests(): Promise<void> {
    console.log('\n--- [Node] Testing Runtime DiagnosticsChannel Polyfill ---');

    const dc = require('diagnostics_channel');

    // 1. Ensure polyfill function exists and can be called safely
    assert.strictEqual(typeof applyDiagnosticsChannelPolyfill, 'function');
    applyDiagnosticsChannelPolyfill();
    assert.strictEqual(typeof dc.tracingChannel, 'function', 'tracingChannel must be a function on diagnostics_channel');

    // 2. Test mock behavior when tracingChannel is simulated as undefined
    const originalTracingChannel = dc.tracingChannel;
    try {
        delete dc.tracingChannel;
        assert.strictEqual(typeof dc.tracingChannel, 'undefined', 'Simulated missing tracingChannel');

        // Apply polyfill
        applyDiagnosticsChannelPolyfill();
        assert.strictEqual(typeof dc.tracingChannel, 'function', 'tracingChannel polyfill must be applied');

        const channel = dc.tracingChannel('test_channel');
        assert.ok(channel, 'tracingChannel must return an object');
        assert.strictEqual(channel.hasSubscribers, false, 'hasSubscribers must be false');
        assert.strictEqual(typeof channel.traceSync, 'function', 'traceSync must be a function');

        let executed = false;
        const result = channel.traceSync((x: number, y: number) => {
            executed = true;
            return x + y;
        }, {}, null, 10, 20);

        assert.strictEqual(executed, true, 'traceSync must execute target function');
        assert.strictEqual(result, 30, 'traceSync must return function result');
    } finally {
        dc.tracingChannel = originalTracingChannel;
    }

    console.log('  ✓ DiagnosticsChannel polyfill resilience and traceSync execution verified');
}
