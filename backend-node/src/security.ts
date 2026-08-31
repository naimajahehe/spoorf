import { Request, Response, NextFunction } from 'express';

/**
 * Keamanan sisi-server (P0): allowlist Origin & Host untuk mencegah
 * serangan drive-by / DNS-rebinding dari browser operator.
 *
 * Aplikasi ini bind ke 127.0.0.1, tetapi bind saja TIDAK cukup:
 *  - Origin allowlist: memblokir fetch/WebSocket cross-origin dari situs jahat.
 *  - Host allowlist: memblokir DNS-rebinding (domain penyerang di-rebind ke
 *    127.0.0.1 sehingga browser menganggapnya same-origin dan tak kirim preflight).
 */

const PORT = process.env.PORT || '5000';

/** Origin ekstra yang diizinkan dari env (comma-separated). */
function extraOrigins(): string[] {
    const raw = process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '';
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Host ekstra yang diizinkan dari env (comma-separated), mis. "localhost:5173". */
function extraHosts(): string[] {
    const raw = process.env.ALLOWED_HOSTS || '';
    return raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * True bila origin boleh mengakses backend.
 * Mengizinkan: tanpa-origin (curl/native/Electron file://), skema file://,
 * host loopback EKSAK (localhost / 127.0.0.1 / ::1, port apa pun), plus entri env.
 *
 * KEAMANAN (P1): memakai parsing URL, BUKAN prefix-match. Prefix-match lama
 * (`startsWith('http://localhost')`) keliru mengizinkan `http://localhost.evil.com`
 * / `http://127.0.0.1.evil.com`, membuka drive-by fetch dari situs jahat yang
 * dikunjungi operator. Cocokkan `hostname` secara eksak untuk menutupnya.
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
    // Request tanpa header Origin (curl, health-check, native, Electron file://) — izinkan.
    if (origin === undefined || origin === null || origin === '') return true;

    // Origin literal "null" (mis. sandboxed iframe) TIDAK diizinkan: reflect-null
    // dikombinasikan credentials membuka celah, jadi tolak eksplisit.
    if (origin === 'null') return false;

    // Entri allowlist env dicocokkan secara eksak lebih dulu.
    if (extraOrigins().includes(origin)) return true;

    try {
        const u = new URL(origin);
        if (u.protocol === 'file:') return true;
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        const host = u.hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    } catch {
        return false;
    }
}

/**
 * True bila header Host merujuk ke loopback pada port backend.
 * Ini pertahanan utama terhadap DNS-rebinding.
 */
export function isAllowedHost(host: string | undefined): boolean {
    if (!host) return false;
    const h = host.toLowerCase();

    const allowed = new Set<string>([
        `localhost:${PORT}`,
        `127.0.0.1:${PORT}`,
        `[::1]:${PORT}`,
        // Beberapa klien menghilangkan port default; toleransi loopback tanpa port.
        'localhost',
        '127.0.0.1',
        '[::1]',
        ...extraHosts()
    ]);

    return allowed.has(h);
}

/**
 * KEAMANAN (P1): Token bearer lokal opsional untuk mengunci control-plane dari
 * proses lokal lain di mesin yang sama. Loopback + CORS saja tidak menghentikan
 * proses lokal tak-tepercaya; token ini menutup celah tersebut.
 *
 * Aktif HANYA bila env `SENTINEL_API_TOKEN` diset. Electron meng-generate
 * (crypto.randomBytes) & menyuntikkannya ke Node, Python, dan renderer, sehingga
 * guard aktif di aplikasi terpaket namun nonaktif pada `npm run dev` biasa
 * (kompatibel mundur). Endpoint kesehatan tetap terbuka untuk readiness probe.
 */
export function apiTokenGuard(req: Request, res: Response, next: NextFunction): void {
    const token = process.env.SENTINEL_API_TOKEN;
    if (!token) {
        next();
        return;
    }

    const p = req.path;
    if (p === '/health' || p === '/api/health') {
        next();
        return;
    }

    const provided = req.headers['x-sentinel-token'];
    if (typeof provided === 'string' && provided === token) {
        next();
        return;
    }

    res.status(401).json({
        success: false,
        error: 'Unauthorized: missing or invalid API token.'
    });
}

/**
 * True bila token handshake WebSocket cocok — atau bila guard nonaktif
 * (SENTINEL_API_TOKEN tak diset). Dipakai oleh WebSocketManager.
 */
export function isValidApiToken(token: unknown): boolean {
    const expected = process.env.SENTINEL_API_TOKEN;
    if (!expected) return true;
    return typeof token === 'string' && token === expected;
}

/**
 * Callback origin untuk paket `cors`. Menolak origin tak dikenal alih-alih
 * reflect-all. `credentials:true` tetap kompatibel karena cors meng-echo
 * origin spesifik yang diizinkan.
 */
export function corsOriginCallback(
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
): void {
    if (isAllowedOrigin(origin)) {
        callback(null, true);
    } else {
        callback(null, false);
    }
}

/**
 * Middleware Express: tolak 403 bila header Host bukan loopback backend
 * (proteksi DNS-rebinding).
 */
export function hostGuard(req: Request, res: Response, next: NextFunction): void {
    if (isAllowedHost(req.headers.host)) {
        next();
        return;
    }
    res.status(403).json({
        success: false,
        error: 'Forbidden: invalid Host header (DNS-rebinding protection).'
    });
}
