import assert from 'assert';
import { shouldRespawnAfterExit, buildTreeKillArgs, isAllowedNavigation, signProtocolAction, isProtocolActionAuthorized } from '../src/supervisor-logic';

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

    // ULTRAREVIEW (batch): protocol handler spoorf:// tak boleh menghormati action=block dari
    //    URL sembarang. Aksi berbahaya (block) HANYA sah bila membawa token HMAC yang ditandatangani
    //    proses main untuk (action,ip,mac) persis itu. Aksi read-only (inspect) tetap sah tanpa token.
    {
        const secret = 'a'.repeat(64); // rahasia per-sesi (di produksi: crypto.randomBytes)
        const ip = '192.168.1.50';
        const mac = 'aa:bb:cc:dd:ee:ff';

        // Token sah dari main mengizinkan block untuk (action,ip,mac) yang cocok.
        const token = signProtocolAction(secret, 'block', ip, mac);
        assert.strictEqual(isProtocolActionAuthorized(secret, 'block', ip, mac, token), true, 'token sah harus mengizinkan block');

        // KERENTANAN INTI: URL block yang dibuat sembarang (tanpa token / token palsu) HARUS ditolak.
        assert.strictEqual(isProtocolActionAuthorized(secret, 'block', ip, mac, ''), false, 'block tanpa token harus ditolak');
        assert.strictEqual(isProtocolActionAuthorized(secret, 'block', ip, mac, 'deadbeef'), false, 'block token palsu harus ditolak');

        // Token untuk (ip,mac) lain tak boleh dipakai ulang menargetkan gateway/perangkat lain.
        const otherToken = signProtocolAction(secret, 'block', '192.168.1.1', '00:11:22:33:44:55');
        assert.strictEqual(isProtocolActionAuthorized(secret, 'block', ip, mac, otherToken), false, 'token target lain harus ditolak');

        // Rahasia berbeda (mis. sesi lain) tak boleh memvalidasi.
        assert.strictEqual(isProtocolActionAuthorized('b'.repeat(64), 'block', ip, mac, token), false, 'rahasia berbeda harus ditolak');

        // Aksi read-only inspect tetap sah tanpa token (notifikasi normal tak boleh rusak).
        assert.strictEqual(isProtocolActionAuthorized(secret, 'inspect', ip, mac, ''), true, 'inspect tanpa token tetap sah');

        // Aksi tak dikenal ditolak.
        assert.strictEqual(isProtocolActionAuthorized(secret, 'nuke', ip, mac, ''), false, 'aksi tak dikenal harus ditolak');
        console.log('  ✓ ULTRAREVIEW #1(sec): protocol handler menolak block tak-terautentikasi, inspect read-only tetap jalan');
    }
}
