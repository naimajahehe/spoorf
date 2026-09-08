import assert from 'assert';
import { shouldRespawnAfterExit, buildTreeKillArgs, isAllowedNavigation } from '../src/supervisor-logic';

export async function runSupervisorLogicTests() {
    console.log('\n--- [Electron] Testing Supervisor Respawn & Kill Logic ---');

    // 1. Keluar bersih (exit 0) TIDAK boleh di-respawn.
    // Guard preflight Python keluar 0 saat engine lain sudah aktif; me-respawn hanya
    // memicu churn karena port tetap dipegang engine yang sah.
    {
        const respawn = shouldRespawnAfterExit(0, { isQuitting: false, intentionalKill: false });
        assert.strictEqual(respawn, false);
        console.log('  ✓ Clean exit (code 0) tidak di-respawn');
    }

    // 2. Crash (exit != 0) HARUS di-respawn.
    {
        const respawn = shouldRespawnAfterExit(1, { isQuitting: false, intentionalKill: false });
        assert.strictEqual(respawn, true);
        console.log('  ✓ Crash exit (code 1) di-respawn');
    }

    // 3. Mati karena signal (code null, mis. SIGSEGV) HARUS di-respawn.
    {
        const respawn = shouldRespawnAfterExit(null, { isQuitting: false, intentionalKill: false });
        assert.strictEqual(respawn, true);
        console.log('  ✓ Signal death (code null) di-respawn');
    }

    // 4. Saat app sedang tutup, TIDAK pernah respawn (apa pun exit code).
    {
        assert.strictEqual(shouldRespawnAfterExit(1, { isQuitting: true, intentionalKill: false }), false);
        assert.strictEqual(shouldRespawnAfterExit(null, { isQuitting: true, intentionalKill: false }), false);
        console.log('  ✓ isQuitting menekan respawn');
    }

    // 5. Kill disengaja (restart manual) TIDAK memicu respawn ganda dari exit handler.
    {
        assert.strictEqual(shouldRespawnAfterExit(1, { isQuitting: false, intentionalKill: true }), false);
        console.log('  ✓ intentionalKill menekan respawn');
    }

    // 6. Tree-kill Windows: matikan seluruh pohon proses (/T) secara paksa (/F).
    {
        assert.deepStrictEqual(buildTreeKillArgs(1234), ['/PID', '1234', '/T', '/F']);
        console.log('  ✓ buildTreeKillArgs menyusun argumen taskkill /T /F');
    }

    // 7. ULTRAREVIEW #1: will-navigate hanya boleh mengizinkan origin terpercaya persis,
    //    bukan pencocokan prefix string yang bisa di-bypass userinfo/subdomain/port.
    {
        const origins = ['http://127.0.0.1:5000', 'http://localhost:5173'];
        const cur = 'http://localhost:5173/';

        // Boleh: origin terpercaya & file:
        assert.strictEqual(isAllowedNavigation('http://127.0.0.1:5000/api', cur, origins), true);
        assert.strictEqual(isAllowedNavigation('http://localhost:5173/dash', cur, origins), true);
        assert.strictEqual(isAllowedNavigation('file:///C:/app/index.html', cur, origins), true);
        assert.strictEqual(isAllowedNavigation(cur, cur, origins), true, 'URL saat ini sendiri diizinkan');

        // Ditolak: keluarga bypass prefix-string
        assert.strictEqual(isAllowedNavigation('http://127.0.0.1:5000@evil.com/', cur, origins), false, 'trik userinfo harus ditolak');
        assert.strictEqual(isAllowedNavigation('http://127.0.0.1:5000.evil.com/', cur, origins), false, 'trik subdomain harus ditolak');
        assert.strictEqual(isAllowedNavigation('http://127.0.0.1:50001/', cur, origins), false, 'port berbeda dengan prefix sama harus ditolak');
        assert.strictEqual(isAllowedNavigation('https://evil.com/', cur, origins), false, 'origin asing harus ditolak');
        console.log('  ✓ ULTRAREVIEW #1: isAllowedNavigation menutup bypass userinfo/subdomain/port');
    }
}
