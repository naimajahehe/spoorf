/**
 * Logika murni supervisor Python engine (tanpa I/O), agar dapat diuji unit.
 *
 * Dipisah dari main.ts supaya keputusan respawn dan penyusunan perintah kill
 * bisa diverifikasi tanpa menjalankan Electron atau men-spawn proses nyata.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Aksi protokol spoorf:// yang berdampak (memutus internet perangkat). Aksi ini WAJIB
 * membawa token HMAC yang ditandatangani proses main agar tak bisa dipicu URL sembarang.
 */
const PRIVILEGED_PROTOCOL_ACTIONS = new Set(['block']);
/** Aksi read-only yang aman dijalankan tanpa token (mis. membuka panel inspeksi). */
const READONLY_PROTOCOL_ACTIONS = new Set(['inspect']);

/**
 * KEAMANAN: tanda tangani (action,ip,mac) dengan rahasia sesi agar hanya URL toast yang
 * DITERBITKAN proses main yang bisa memicu aksi berdampak. Truncate 32 hex (128-bit) cukup
 * untuk mencegah pemalsuan sekaligus menjaga URL notifikasi tetap ringkas.
 */
export function signProtocolAction(secret: string, action: string, ip: string, mac: string): string {
    return createHmac('sha256', secret)
        .update(`${action}|${ip || ''}|${(mac || '').toLowerCase()}`)
        .digest('hex')
        .slice(0, 32);
}

/**
 * KEAMANAN: apakah aksi protokol boleh diteruskan ke renderer.
 *
 * `handleProtocolUrl` mem-parse `spoorf://action=…&ip=…&mac=…` dari sumber APA PUN — proses
 * lokal lain, atau tautan protokol yang dibuka halaman web via handler OS. Tanpa penjagaan,
 * `spoorf://action=block&ip=<gateway>` bisa memutus gateway/perangkat arbitrer tanpa konfirmasi.
 * Aksi berdampak (block) hanya sah bila token HMAC-nya cocok persis untuk (action,ip,mac);
 * aksi read-only (inspect) tetap diizinkan tanpa token; aksi tak dikenal ditolak.
 */
export function isProtocolActionAuthorized(
    secret: string,
    action: string | null,
    ip: string,
    mac: string,
    token: string | null
): boolean {
    if (!action) return false;
    if (READONLY_PROTOCOL_ACTIONS.has(action)) return true;
    if (!PRIVILEGED_PROTOCOL_ACTIONS.has(action)) return false;

    const provided = token || '';
    const expected = signProtocolAction(secret, action, ip, mac);
    // Bandingkan timing-safe; panjang harus sama dulu agar timingSafeEqual tak melempar.
    if (provided.length !== expected.length) return false;
    try {
        return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    } catch {
        return false;
    }
}

export interface RespawnContext {
    /** App sedang menutup: jangan pernah respawn. */
    isQuitting: boolean;
    /** Proses dimatikan sengaja (restart manual): exit handler tidak boleh respawn ganda. */
    intentionalKill: boolean;
}

/**
 * Tentukan apakah engine perlu di-respawn setelah keluar.
 *
 * Keluar bersih (exit code 0) berarti engine memang berhenti dengan sengaja —
 * termasuk guard preflight yang keluar 0 ketika engine Spoorf lain sudah aktif di
 * port 8001. Me-respawn kasus itu hanya menimbulkan churn (langsung keluar 0 lagi)
 * hingga guard crash-loop menghentikannya. Hanya crash (exit code != 0, termasuk
 * mati oleh signal dengan code null) yang layak di-respawn.
 */
export function shouldRespawnAfterExit(code: number | null, ctx: RespawnContext): boolean {
    if (ctx.isQuitting || ctx.intentionalKill) {
        return false;
    }
    if (code === 0) {
        return false;
    }
    return true;
}

/**
 * Argumen `taskkill` untuk mematikan SELURUH pohon proses di Windows.
 *
 * `pythonProcess.kill()` hanya mengirim sinyal ke proses puncak; bootloader
 * PyInstaller (onedir) atau subproses uvicorn bisa lolos dan tetap menahan port
 * 8001, menyebabkan tabrakan bind pada peluncuran berikutnya. `/T` mematikan
 * pohon proses, `/F` memaksa.
 */
export function buildTreeKillArgs(pid: number): string[] {
    return ['/PID', String(pid), '/T', '/F'];
}

/**
 * KEAMANAN (P1): apakah navigasi top-level window utama boleh diizinkan.
 *
 * Mengembalikan true hanya jika URL tetap di origin terpercaya (renderer lokal)
 * atau skema file:. Perbandingan memakai origin URL yang di-parse, bukan
 * pencocokan prefix string mentah, agar trik userinfo/subdomain/port
 * (`http://127.0.0.1:5000@ evil.com/`, `http://127.0.0.1:5000.evil.com/`,
 * `http://127.0.0.1:50001/`) tidak lolos.
 */
export function isAllowedNavigation(url: string, currentUrl: string, allowedOrigins: string[]): boolean {
    if (url === currentUrl) return true;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol === 'file:') return true;
    // Normalisasi allow-list ke origin yang di-parse, lalu bandingkan origin lengkap
    // (protokol + host + port) — bukan prefix string.
    return allowedOrigins.some((o) => {
        try {
            return new URL(o).origin === parsed.origin;
        } catch {
            return false;
        }
    });
}
