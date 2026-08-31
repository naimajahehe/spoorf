/**
 * Resolusi base URL backend (Node orchestrator :5000).
 * Sumber tunggal untuk logika yang sebelumnya diduplikasi di `api/client.ts`
 * (getApiUrl) dan `hooks/useWebSocket.ts` (getWsUrl) — keduanya identik kecuali
 * nama env override (VITE_API_URL vs VITE_WS_URL).
 *
 * @param envOverride nilai dari import.meta.env (VITE_API_URL / VITE_WS_URL); bila
 *                    di-set, dipakai apa adanya.
 */
export function resolveBackendUrl(envOverride?: string): string {
    if (envOverride) return envOverride;
    if (typeof window !== 'undefined' && window.location) {
        if (window.location.protocol === 'file:' || !window.location.hostname) {
            return 'http://localhost:5000';
        }
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        return `${protocol}//${window.location.hostname}:5000`;
    }
    return 'http://localhost:5000';
}
