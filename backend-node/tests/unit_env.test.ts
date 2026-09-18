import assert from 'assert';
import { EnvSchema, validateEnv } from '../src/config/env';

export async function runEnvTests() {
    console.log('\n--- [Node] Testing Type-Safe Environment Configuration (Zod) ---');

    // 1. Default Fallbacks
    {
        const parsed = EnvSchema.parse({});
        assert.strictEqual(parsed.PORT, 5000);
        assert.strictEqual(parsed.HOST, '127.0.0.1');
        assert.strictEqual(parsed.NODE_ENV, 'development');
        assert.strictEqual(parsed.PYTHON_SERVICE_URL, 'http://127.0.0.1:8001');
        assert.strictEqual(parsed.SPOORF_CLOUD_URL, 'https://api.spoorf.app/v1');
        assert.strictEqual(parsed.AUTO_SPAWN_PYTHON, false);
        assert.strictEqual(parsed.SPOORF_ALLOW_DEMO_LICENSE, false);
        console.log('  ✓ EnvSchema: Safe defaults applied when environment variables are omitted');
    }

    // 2. Type Coercion & Valid Custom Inputs
    {
        const customEnv = {
            PORT: '7000',
            HOST: '0.0.0.0',
            NODE_ENV: 'production',
            PYTHON_SERVICE_URL: 'http://192.168.1.10:8001',
            AUTO_SPAWN_PYTHON: 'true',
            SPOORF_ALLOW_DEMO_LICENSE: 'true',
            SENTINEL_API_TOKEN: 'super-secret-token'
        };
        const parsed = EnvSchema.parse(customEnv);
        assert.strictEqual(parsed.PORT, 7000);
        assert.strictEqual(parsed.HOST, '0.0.0.0');
        assert.strictEqual(parsed.NODE_ENV, 'production');
        assert.strictEqual(parsed.PYTHON_SERVICE_URL, 'http://192.168.1.10:8001');
        assert.strictEqual(parsed.AUTO_SPAWN_PYTHON, true);
        assert.strictEqual(parsed.SPOORF_ALLOW_DEMO_LICENSE, true);
        assert.strictEqual(parsed.SENTINEL_API_TOKEN, 'super-secret-token');
        console.log('  ✓ EnvSchema: String ports and flags properly coerced to number and boolean');
    }

    // 3. Fail-Fast Bootstrapping on Corrupt Configuration
    {
        // Invalid port
        assert.strictEqual(EnvSchema.safeParse({ PORT: 'not-a-number' }).success, false);
        assert.strictEqual(EnvSchema.safeParse({ PORT: -10 }).success, false);

        // Invalid URL
        assert.strictEqual(EnvSchema.safeParse({ PYTHON_SERVICE_URL: 'not_an_url' }).success, false);
        assert.strictEqual(EnvSchema.safeParse({ SPOORF_CLOUD_URL: 'htp:/broken' }).success, false);

        // Invalid NODE_ENV
        assert.strictEqual(EnvSchema.safeParse({ NODE_ENV: 'staging' }).success, false);

        // validateEnv throws on corrupted env
        assert.throws(() => {
            validateEnv({ PORT: 'invalid_port' } as any);
        }, /FATAL.*Environment configuration error/i);

        console.log('  ✓ Fail-Fast: Corrupt ports, invalid URLs, and unknown environments halt startup immediately');
    }

    // 4. Cloud auth timeout: tunable with a sane default (replaces the aggressive hardcoded 800ms
    //    that failed legitimate logins over slower links while demo fallback is disabled).
    {
        assert.strictEqual(EnvSchema.parse({}).SPOORF_CLOUD_AUTH_TIMEOUT_MS, 5000);
        assert.strictEqual(
            EnvSchema.parse({ SPOORF_CLOUD_AUTH_TIMEOUT_MS: '3000' }).SPOORF_CLOUD_AUTH_TIMEOUT_MS,
            3000
        );
        assert.strictEqual(EnvSchema.safeParse({ SPOORF_CLOUD_AUTH_TIMEOUT_MS: '-1' }).success, false);
        assert.strictEqual(EnvSchema.safeParse({ SPOORF_CLOUD_AUTH_TIMEOUT_MS: 'abc' }).success, false);
        console.log('  ✓ EnvSchema: Cloud auth timeout tunable (default 5000ms), rejects invalid values');
    }
}
