import assert from 'assert';
import { isAllowedOrigin, isAllowedHost, isValidApiToken, apiTokenGuard } from '../src/security';

/**
 * Regression tests untuk perbaikan keamanan P1:
 *  - Exact-match origin (menutup drive-by CORS prefix bypass)
 *  - IPC Bearer Token guard (control-plane auth)
 */
export async function runSecurityTests() {
    console.log('\n--- [Node] Testing Security Guards (Origin/Host/Token P1) ---');

    // Test 1: Origin exact-match — TOLAK prefix-match jahat, TERIMA loopback sah
    {
        // No-origin (curl/native/Electron) diizinkan
        assert.strictEqual(isAllowedOrigin(undefined), true);
        assert.strictEqual(isAllowedOrigin(''), true);

        // Loopback sah
        assert.strictEqual(isAllowedOrigin('http://localhost:5173'), true);
        assert.strictEqual(isAllowedOrigin('http://127.0.0.1:5000'), true);
        assert.strictEqual(isAllowedOrigin('https://localhost'), true);
        assert.strictEqual(isAllowedOrigin('file:///C:/app/index.html'), true);

        // REGRESI UTAMA: prefix-match jahat HARUS ditolak
        assert.strictEqual(isAllowedOrigin('http://localhost.evil.com'), false);
        assert.strictEqual(isAllowedOrigin('http://127.0.0.1.evil.com'), false);
        assert.strictEqual(isAllowedOrigin('https://localhostx.attacker.net'), false);
        assert.strictEqual(isAllowedOrigin('http://evil.com'), false);

        // Origin literal "null" ditolak
        assert.strictEqual(isAllowedOrigin('null'), false);

        console.log('  ✓ Origin exact-match: rejects localhost.evil.com, accepts real loopback');
    }

    // Test 2: Host allowlist (DNS-rebinding) tetap eksak
    {
        assert.strictEqual(isAllowedHost('127.0.0.1:5000'), true);
        assert.strictEqual(isAllowedHost('localhost:5000'), true);
        assert.strictEqual(isAllowedHost('evil.com'), false);
        assert.strictEqual(isAllowedHost('127.0.0.1.evil.com:5000'), false);
        assert.strictEqual(isAllowedHost(undefined), false);
        console.log('  ✓ Host allowlist: rejects non-loopback Host headers');
    }

    // Test 3: isValidApiToken — nonaktif bila env kosong, ketat bila diset
    {
        const prev = process.env.SENTINEL_API_TOKEN;
        delete process.env.SENTINEL_API_TOKEN;
        assert.strictEqual(isValidApiToken(undefined), true); // guard off
        assert.strictEqual(isValidApiToken('apa-saja'), true);

        process.env.SENTINEL_API_TOKEN = 'secret-token-abc';
        assert.strictEqual(isValidApiToken('secret-token-abc'), true);
        assert.strictEqual(isValidApiToken('salah'), false);
        assert.strictEqual(isValidApiToken(undefined), false);

        if (prev === undefined) delete process.env.SENTINEL_API_TOKEN;
        else process.env.SENTINEL_API_TOKEN = prev;
        console.log('  ✓ isValidApiToken: off when unset, strict when set');
    }

    // Test 4: apiTokenGuard middleware — 401 tanpa token, lolos dengan token / health
    {
        const prev = process.env.SENTINEL_API_TOKEN;

        const runGuard = (path: string, headerToken?: string) => {
            let nextCalled = false;
            let statusCode: number | undefined;
            const req: any = { path, headers: headerToken ? { 'x-sentinel-token': headerToken } : {} };
            const res: any = {
                status(code: number) { statusCode = code; return this; },
                json() { return this; }
            };
            apiTokenGuard(req, res, () => { nextCalled = true; });
            return { nextCalled, statusCode };
        };

        // Guard OFF (env kosong): semua lolos
        delete process.env.SENTINEL_API_TOKEN;
        assert.strictEqual(runGuard('/api/devices').nextCalled, true);

        // Guard ON
        process.env.SENTINEL_API_TOKEN = 'secret-token-abc';
        // Health selalu terbuka
        assert.strictEqual(runGuard('/health').nextCalled, true);
        assert.strictEqual(runGuard('/api/health').nextCalled, true);
        // Tanpa token → 401
        const noTok = runGuard('/api/devices');
        assert.strictEqual(noTok.nextCalled, false);
        assert.strictEqual(noTok.statusCode, 401);
        // Token salah → 401
        assert.strictEqual(runGuard('/api/devices', 'salah').statusCode, 401);
        // Token benar → lolos
        assert.strictEqual(runGuard('/api/devices', 'secret-token-abc').nextCalled, true);

        if (prev === undefined) delete process.env.SENTINEL_API_TOKEN;
        else process.env.SENTINEL_API_TOKEN = prev;
        console.log('  ✓ apiTokenGuard: 401 without token, passes with valid token or health path');
    }
}
