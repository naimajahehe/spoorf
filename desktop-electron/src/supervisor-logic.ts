/**
 * Logika murni supervisor Python engine (tanpa I/O), agar dapat diuji unit.
 *
 * Dipisah dari main.ts supaya keputusan respawn dan penyusunan perintah kill
 * bisa diverifikasi tanpa menjalankan Electron atau men-spawn proses nyata.
 */

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
