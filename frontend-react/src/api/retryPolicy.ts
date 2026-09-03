const SAFE_STARTUP_READ_PATHS = new Set([
    '/api/health',
    '/api/status'
]);

export function isSafeStartupRetry(method: string | undefined, url: string | undefined): boolean {
    if ((method ?? 'GET').toUpperCase() !== 'GET' || !url) {
        return false;
    }

    const pathname = new URL(url, 'http://sentinel.local').pathname;
    return SAFE_STARTUP_READ_PATHS.has(pathname);
}
