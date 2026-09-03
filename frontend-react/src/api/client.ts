import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { resolveBackendUrl } from '../lib/backend';
import { isSafeStartupRetry } from './retryPolicy';

export const getApiUrl = (): string => resolveBackendUrl(import.meta.env.VITE_API_URL);

const API_URL = getApiUrl();

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = typeof window !== 'undefined' ? window.electronAPI?.apiToken : undefined;
    if (token) {
        headers.set('x-sentinel-token', token);
    }

    return fetch(`${getApiUrl()}${path}`, { ...init, headers });
}

const http = axios.create({
    baseURL: API_URL,
    timeout: 10000
});

// KEAMANAN (P1): sertakan token bearer lokal (dari preload Electron) pada tiap
// request bila tersedia. Di browser dev (tanpa Electron) token undefined → guard
// backend juga nonaktif, jadi tetap kompatibel.
http.interceptors.request.use((config) => {
    const token = typeof window !== 'undefined' ? window.electronAPI?.apiToken : undefined;
    if (token) {
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>)['x-sentinel-token'] = token;
    }
    return config;
});

type RetryableRequestConfig = InternalAxiosRequestConfig & {
    __retryCount?: number;
};

// Auto-retry only idempotent startup probes while the backend binds its port.
http.interceptors.response.use(
    response => response,
    async (error: AxiosError) => {
        const config = error.config as RetryableRequestConfig | undefined;
        if (!config || !isSafeStartupRetry(config.method, config.url) || (config.__retryCount ?? 0) >= 3) {
            return Promise.reject(error);
        }

        if (!error.response || error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || error.message?.includes('Network Error')) {
            config.__retryCount = (config.__retryCount ?? 0) + 1;
            await new Promise(resolve => setTimeout(resolve, 400));
            return http(config);
        }

        return Promise.reject(error);
    }
);

export const apiClient = {
    async getHealth() {
        const response = await http.get('/api/health');
        return response.data;
    },

    async getDiagnostics() {
        const response = await http.get('/api/system/diagnostics');
        return response.data;
    },

    async scan() {
        const response = await http.get('/api/scan');
        return response.data;
    },

    async getDevices() {
        const response = await http.get('/api/devices');
        return response.data;
    },

    async blockDevice(ip: string, gatewayIp: string) {
        const response = await http.post(`/api/devices/${encodeURIComponent(ip)}/block`, { gatewayIp });
        return response.data;
    },

    async unblockDevice(ip: string) {
        const response = await http.post(`/api/devices/${encodeURIComponent(ip)}/unblock`);
        return response.data;
    },

    async getStatus() {
        const response = await http.get('/api/status');
        return response.data;
    },

    async getGateway() {
        const response = await http.get('/api/gateway');
        return response.data;
    },

    // ===== BETTERCAP SECURITY SUITE CLIENT METHODS =====
    async getBettercapStatus() {
        const response = await http.get('/api/bettercap/status');
        return response.data;
    },

    async getBettercapDnsRules() {
        const response = await http.get('/api/bettercap/dns/rules');
        return response.data;
    },

    async addBettercapDnsRule(domain: string, target_ip: string, action: string = 'spoof', is_enabled: boolean = true) {
        const response = await http.post('/api/bettercap/dns/rules', { domain, target_ip, action, is_enabled });
        return response.data;
    },

    async updateBettercapDnsRule(id: string, updates: { domain?: string; target_ip?: string; action?: string; is_enabled?: boolean }) {
        const response = await http.put(`/api/bettercap/dns/rules/${encodeURIComponent(id)}`, updates);
        return response.data;
    },

    async deleteBettercapDnsRule(id: string) {
        const response = await http.delete(`/api/bettercap/dns/rules/${encodeURIComponent(id)}`);
        return response.data;
    },

    async setBettercapDnsSpoofAll(enabled: boolean, address: string = '') {
        const response = await http.post('/api/bettercap/dns/spoof-all', { enabled, address });
        return response.data;
    },

    async loadBettercapDnsHosts(content: string, default_address: string = '', action: string = 'spoof') {
        const response = await http.post('/api/bettercap/dns/hosts', { content, default_address, action });
        return response.data;
    },

    async setBettercapDnsTtl(ttl: number) {
        const response = await http.post('/api/bettercap/dns/ttl', { ttl });
        return response.data;
    },

    async getBettercapCredentials(limit: number = 100) {
        const response = await http.get(`/api/bettercap/credentials?limit=${limit}`);
        return response.data;
    },

    async clearBettercapCredentials() {
        const response = await http.delete('/api/bettercap/credentials');
        return response.data;
    },

    async runBettercapSynScan(target_ip: string, ports?: number[], profile: string = 'top-20') {
        const response = await http.post('/api/bettercap/syn-scan', { target_ip, ports, profile });
        return response.data;
    },

    async getApIsolation() {
        const response = await http.get('/api/network/ap-isolation');
        return response.data;
    },

    // ===== AUTHENTICATION & LICENSE METHODS =====
    async getAuthStatus() {
        const response = await http.get('/api/auth/status');
        return response.data;
    },

    async login(email: string, password?: string, token?: string, cloudUrl?: string) {
        const response = await http.post('/api/auth/login', { email, password, token, cloudUrl });
        return response.data;
    },

    async activateLicenseKey(key: string) {
        const response = await http.post('/api/auth/activate', { key });
        return response.data;
    },

    async logout() {
        const response = await http.post('/api/auth/logout');
        return response.data;
    },

    async getWifiInfo() {
        const response = await http.get('/api/wifi');
        return response.data;
    },

    async getTelemetry() {
        const response = await http.get('/api/telemetry');
        return response.data;
    },

    // ===== SENTINEL SHIELD (ANTI-ARP SPOOFING & THREAT RADAR) =====
    async getShieldStatus() {
        const response = await http.get('/api/shield/status');
        return response.data;
    },

    async toggleShield(enabled: boolean, mode: string = 'host_lock', autoRetaliate: boolean = false, lanTargets: any[] = []) {
        const response = await http.post('/api/shield/toggle', {
            enabled,
            mode,
            autoRetaliate,
            lanTargets
        });
        return response.data;
    },

    async setShieldMode(mode: string, autoRetaliate: boolean = false) {
        const response = await http.post('/api/shield/mode', { mode, autoRetaliate });
        return response.data;
    },


    // ===== GAMING MODE (ULTRA-LOW LATENCY & ANTI-JITTER) =====
    async getGamingStatus() {
        const response = await http.get('/api/gaming/status');
        return response.data;
    },

    async toggleGamingMode(enabled: boolean, mode: string = 'auto_airtime', target_ping_ms: number = 25.0) {
        const response = await http.post('/api/gaming/toggle', { enabled, mode, target_ping_ms });
        return response.data;
    },

    async getShieldThreats() {
        const response = await http.get('/api/shield/threats');
        return response.data;
    },

    async clearShieldThreats() {
        const response = await http.delete('/api/shield/threats');
        return response.data;
    }
};
