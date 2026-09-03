import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import WebSocket from 'ws';
import { Device } from '../types';

/**
 * Error yang menandai Python engine tak terjangkau/timeout. `code` adalah sumber
 * klasifikasi yang stabil untuk respondError — menggantikan pencocokan substring
 * pesan (yang rapuh terhadap perubahan terjemahan). Pesan tetap berbahasa
 * Indonesia untuk log & klien, tapi keputusan 503 tidak lagi bergantung padanya.
 */
export type BridgeErrorCode = 'BRIDGE_OFFLINE' | 'BRIDGE_TIMEOUT';

export class BridgeUnavailableError extends Error {
    readonly code: BridgeErrorCode;
    constructor(code: BridgeErrorCode, message: string) {
        super(message);
        this.name = 'BridgeUnavailableError';
        this.code = code;
    }
}

/** True untuk error apa pun yang berasal dari Python bridge yang tak terjangkau. */
export function isBridgeUnavailable(err: unknown): err is BridgeUnavailableError {
    return err instanceof BridgeUnavailableError;
}

export class PythonBridge extends EventEmitter {
    private process: ChildProcess | null = null;
    private baseUrl: string;
    private wsUrl: string;
    private ws: WebSocket | null = null;
    private ready: boolean = false;
    private isInternalSpawn: boolean = false;

    constructor() {
        super();
        this.baseUrl = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8001';
        this.wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws/events';
    }

    private getPythonPath(): string {
        if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
            return process.env.PYTHON_PATH;
        }
        const isWindows = process.platform === 'win32';
        const venvPython = isWindows
            ? path.resolve(__dirname, '../../../python-service/venv/Scripts/python.exe')
            : path.resolve(__dirname, '../../../python-service/venv/bin/python');
        if (fs.existsSync(venvPython)) {
            return venvPython;
        }
        return isWindows ? 'python' : 'python3';
    }

    private getServicePath(): string {
        if (process.env.PYTHON_SERVICE_PATH) {
            return path.resolve(process.env.PYTHON_SERVICE_PATH);
        }
        return path.resolve(__dirname, '../../../python-service');
    }

    /**
     * KEAMANAN (P1): Sisipkan token bearer lokal ke header bila SENTINEL_API_TOKEN
     * diset, agar Python engine (:8001) menolak request dari proses lokal lain.
     */
    private authHeaders(base: HeadersInit = {}): HeadersInit {
        const token = process.env.SENTINEL_API_TOKEN;
        if (!token) return base;
        return { ...(base as Record<string, string>), 'x-sentinel-token': token };
    }

    /**
     * fetch dengan timeout + cancel (AbortController) agar panggilan Node->Python
     * tidak pernah menggantung tanpa batas bila engine Python hang.
     * Header token disuntik terpusat di sini (mencakup seluruh panggilan HTTP).
     */
    private async fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                ...options,
                headers: this.authHeaders(options.headers),
                signal: controller.signal
            });
            // Python menjawab di socket -> engine terjangkau. Ini satu-satunya jalur
            // pemulihan `ready` setelah start() menyerah (lihat catatan di start()).
            this.markReachable();
            return res;
        } catch (err: any) {
            if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.message?.includes('aborted')) {
                // Timeout tidak membuktikan engine mati (bisa satu endpoint yang lambat),
                // jadi status `ready` sengaja tidak diubah di sini.
                throw new BridgeUnavailableError('BRIDGE_TIMEOUT', `Koneksi ke Python microservice (${url}) timeout setelah ${timeoutMs}ms.`);
            }
            if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
                this.markUnreachable();
                throw new BridgeUnavailableError('BRIDGE_OFFLINE', `Python microservice (:8001) tidak dapat dihubungi (Offline).`);
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * `ready` adalah sinyal keterjangkauan yang hidup, bukan flag sekali-set saat boot.
     * Tanpa ini, engine Python yang boot lebih lambat dari jendela polling start()
     * akan dianggap offline selamanya oleh seluruh guard `if (!this.ready)`.
     */
    private markReachable(): void {
        if (this.ready) return;
        this.ready = true;
        console.log(`✅ Python FastAPI microservice kembali terjangkau di ${this.baseUrl}`);
        if (!this.ws) {
            this.connectWebSocket();
        }
    }

    private markUnreachable(): void {
        if (!this.ready) return;
        this.ready = false;
        console.warn(`⚠️ Python FastAPI microservice (:8001) tidak lagi terjangkau — beralih ke mode offline.`);
    }

    /**
     * Error offline standar untuk fast-fail, membawa code BRIDGE_OFFLINE agar
     * respondError mengklasifikasikannya sebagai 503. Dipakai oleh operasi yang
     * TIDAK punya bentuk fallback yang jujur — yaitu mutasi dan pengambilan
     * artefak biner, di mana nilai kosong akan terbaca sebagai keberhasilan.
     */
    private offlineError(): BridgeUnavailableError {
        return new BridgeUnavailableError('BRIDGE_OFFLINE', `Python microservice (:8001) tidak dapat dihubungi (Offline).`);
    }

    /**
     * Pola baca ber-fallback yang seragam untuk endpoint yang PUNYA bentuk offline
     * yang jujur. Menggantikan triad `if (!ready) return X / try / if (!ok) return X
     * / catch return X` yang dulu disalin di ~8 method, sehingga setiap endpoint baru
     * tidak perlu menyalin ulang tiga titik-keluar yang mudah menyimpang.
     * Fallback selalu dikembalikan sebagai salinan agar konstanta bersama tak termutasi.
     * (Bukan untuk operasi mutasi/artefak — itu harus fast-fail via offlineError().)
     */
    private async fetchOrDefault<T>(
        endpoint: string,
        fallback: T,
        transform: (json: any) => T = (j) => j as T,
        init: RequestInit = {},
        timeoutMs = 2000
    ): Promise<T> {
        const clone = (): T =>
            Array.isArray(fallback) ? ([...(fallback as any)] as T)
            : (fallback && typeof fallback === 'object' ? ({ ...(fallback as any) } as T) : fallback);
        if (!this.ready) return clone();
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}${endpoint}`, init, timeoutMs);
            if (!res.ok) return clone();
            return transform(await res.json());
        } catch {
            return clone();
        }
    }

    private async checkHealth(): Promise<boolean> {
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/health`, {}, 1000);
            return res.ok;
        } catch {
            return false;
        }
    }

    async start(): Promise<void> {
        console.log(`🔍 Checking Python FastAPI microservice at ${this.baseUrl}...`);
        
        let attempts = 0;
        const maxAttempts = 20; // 10 detik
        while (attempts < maxAttempts) {
            const ok = await this.checkHealth();
            if (ok) {
                console.log(`✅ Python FastAPI microservice is ready on ${this.baseUrl} (in ${attempts * 0.5}s)`);
                // checkHealth() sudah melewati fetchWithTimeout -> markReachable(),
                // jadi `ready` dan WebSocket sudah terpasang. Jangan sambung dua kali.
                this.markReachable();
                return;
            }

            // In dev mode only (when explicitly not managed by electron supervisor), attempt spawn on attempt 1
            if (attempts === 0 && process.env.AUTO_SPAWN_PYTHON === 'true') {
                const pythonPath = this.getPythonPath();
                const servicePath = this.getServicePath();
                if (fs.existsSync(servicePath)) {
                    try {
                        console.log(`🚀 Spawning Python FastAPI: ${pythonPath} -m src.main`);
                        this.process = spawn(pythonPath, ['-m', 'src.main'], {
                            cwd: servicePath,
                            env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
                            stdio: ['ignore', 'inherit', 'inherit']
                        });

                        this.isInternalSpawn = true;

                        this.process.on('error', (err) => {
                            console.warn(`⚠️ [PythonBridge] Process spawn error (handled): ${err.message}`);
                        });

                        this.process.on('exit', (code, signal) => {
                            console.log(`Python process exited with code ${code} (signal: ${signal})`);
                            this.ready = false;
                            this.emit('exit', code);
                        });
                    } catch (err: any) {
                        console.warn(`⚠️ [PythonBridge] Could not spawn Python: ${err.message}`);
                    }
                }
            }

            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        // Menyerah di sini bukan vonis permanen: probe tanpa guard (checkHealth,
        // getDiagnostics) tetap memanggil fetchWithTimeout, yang akan memanggil
        // markReachable() begitu Python akhirnya menjawab.
        console.warn(`⚠️ Python FastAPI microservice not responding on ${this.baseUrl} after ${maxAttempts * 0.5}s. Continuing in offline mode (akan pulih otomatis bila engine menyusul aktif).`);
    }

    private latestTelemetry: any = null;
    private latestWifiInfo: any = null;

    private connectWebSocket(): void {
        try {
            const token = process.env.SENTINEL_API_TOKEN;
            this.ws = new WebSocket(this.wsUrl, token ? { headers: { 'x-sentinel-token': token } } : undefined);

            this.ws.on('error', (err) => {
                console.warn(`⚠️ [PythonBridge] WebSocket error (handled): ${err.message}`);
            });

            this.ws.on('open', () => {
                console.log(`🔌 Connected to Python event stream via WebSocket (${this.wsUrl})`);
            });

            this.ws.on('message', (raw: string | Buffer) => {
                try {
                    const event = JSON.parse(raw.toString());
                    if (event.event === 'network_changed' || event.error === 'NETWORK_CHANGED') {
                        console.log('📡 Python Broadcast: Network Changed', event.data);
                        this.emit('networkChanged', event.data);
                    } else if (event.event === 'telemetry') {
                        this.latestTelemetry = event.data;
                        if (event.data) {
                            this.latestWifiInfo = {
                                connected: Boolean(event.data.connected),
                                ssid: event.data.ssid || '',
                                signal: event.data.signal || '',
                                interface_type: event.data.interface_type || 'wifi',
                                state: event.data.connected ? 'connected' : 'disconnected'
                            };
                        }
                        this.emit('telemetry', event.data);
                    } else if (event.event === 'dhcp_device_discovered') {
                        console.log('📱 [DHCP Sniffer 3B] Perangkat Baru Tertangkap:', event.data);
                        this.emit('dhcpDevice', event.data);
                    } else if (event.event === 'rogue_dhcp_detected') {
                        console.warn('🚨 [DHCP Sniffer 3B] ROGUE DHCP SERVER TERDETEKSI:', event.data);
                        this.emit('rogueDhcp', event.data);
                    } else if (event.event === 'gateway_dns_query') {
                        this.emit('gatewayDnsQuery', event.data);
                    } else if (event.event === 'gateway_status_changed') {
                        this.emit('gatewayStatusChanged', event.data);
                    } else if (event.event === 'traffic_l7_flow') {
                        this.emit('l7Flow', event.data);
                    } else if (event.event === 'bettercap_dns_spoofed') {
                        this.emit('bettercapDnsSpoofed', event.data);
                    } else if (event.event === 'bettercap_credential_sniffed') {
                        this.emit('bettercapCredentialSniffed', event.data);
                    } else if (event.event === 'device_liveness_changed') {
                        this.emit('deviceLivenessChanged', event.data);
                    } else if (event.event === 'gaming_status_changed') {
                        this.emit('gamingStatusChanged', event.data);
                    } else if (event.event === 'gaming_telemetry') {
                        this.emit('gamingTelemetry', event.data);
                    }
                } catch (e) {
                    console.debug('Failed to parse Python WS event:', e);
                }
            });

            this.ws.on('close', () => {
                // Lepas referensi socket mati agar markReachable() bisa menyambung ulang
                // saat Python kembali hidup setelah sempat dianggap offline.
                this.ws = null;
                // Reconnect after 3 seconds if Python is still active
                if (this.ready) {
                    setTimeout(() => this.connectWebSocket(), 3000);
                }
            });
        } catch (e) {
            this.ws = null;
            console.warn('Error initiating Python WebSocket connection:', e);
        }
    }

    async scan(): Promise<Device[]> {
        console.log('📡 [HTTP Call -> Python] POST /api/scan (Non-Blocking)...');
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, 30000);

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Python scan error (${res.status}): ${err}`);
        }

        const data: any = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Scan failed');
        }

        return data.data.devices;
    }

    async startSpoof(
        victimIp: string,
        victimMac: string,
        gatewayIp: string,
        gatewayMac: string,
        speedLimit: number = 0,
        victimIpv6?: string,
        gatewayIpv6?: string,
        blackhole: boolean = false
    ): Promise<string> {
        console.log(`📡 [HTTP Call -> Python] POST /api/spoof/start for ${victimIp} (limit: ${speedLimit}%, IPv6: ${victimIpv6 || 'none'}, blackhole: ${blackhole})...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/spoof/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                victim_ip: victimIp,
                victim_mac: victimMac,
                gateway_ip: gatewayIp,
                gateway_mac: gatewayMac,
                speed_limit: speedLimit,
                victim_ipv6: victimIpv6,
                gateway_ipv6: gatewayIpv6,
                blackhole
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Start spoof error (${res.status}): ${err}`);
        }

        const data: any = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to start spoof');
        }

        return data.data.session_id;
    }

    async setSpoofLimit(sessionId: string, speedLimit: number): Promise<void> {
        console.log(`📡 [HTTP Call -> Python] POST /api/spoof/limit for session ${sessionId} (${speedLimit}%)...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/spoof/limit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, speed_limit: speedLimit })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Set spoof limit error (${res.status}): ${err}`);
        }
    }

    async stopSpoof(sessionId: string): Promise<void> {
        console.log(`📡 [HTTP Call -> Python] POST /api/spoof/stop for session ${sessionId}...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/spoof/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Stop spoof error (${res.status}): ${err}`);
        }
    }

    async stopAll(): Promise<void> {
        try {
            console.log('📡 [HTTP Call -> Python] POST /api/spoof/stop_all...');
            await this.fetchWithTimeout(`${this.baseUrl}/api/spoof/stop_all`, { method: 'POST' });
        } catch (e) {
            console.warn('Error during stopAll HTTP call:', e);
        }
    }

    async startRedirect(victimIp: string, victimMac: string, gatewayIp: string, gatewayMac: string, redirectUrl: string, instagramUsername: string = ''): Promise<any> {
        console.log(`📡 [HTTP Call -> Python] POST /api/redirect/start for ${victimIp} -> ${redirectUrl}...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/redirect/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                victim_ip: victimIp,
                victim_mac: victimMac,
                gateway_ip: gatewayIp,
                gateway_mac: gatewayMac,
                redirect_url: redirectUrl,
                instagram_username: instagramUsername
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Start redirect error (${res.status}): ${err}`);
        }

        const data: any = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to start redirect');
        }

        return data.data;
    }

    async stopRedirect(victimIp: string): Promise<void> {
        console.log(`📡 [HTTP Call -> Python] POST /api/redirect/stop for ${victimIp}...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/redirect/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ victim_ip: victimIp })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Stop redirect error (${res.status}): ${err}`);
        }
    }

    async getRedirectStatus(): Promise<any> {
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/redirect/status`);
            if (!res.ok) throw new Error('Failed to get redirect status');
            const data: any = await res.json();
            return data.sessions || {};
        } catch {
            return {};
        }
    }

    async startTransparentGateway(victimIp: string, victimMac: string, gatewayIp: string, gatewayMac: string): Promise<any> {
        console.log(`📡 [HTTP Call -> Python] POST /api/gateway/start for ${victimIp}...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                victim_ip: victimIp,
                victim_mac: victimMac,
                gateway_ip: gatewayIp,
                gateway_mac: gatewayMac
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Start gateway error (${res.status}): ${err}`);
        }

        const data: any = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to start transparent gateway');
        }

        return data.data;
    }

    async stopTransparentGateway(victimIp: string): Promise<void> {
        console.log(`📡 [HTTP Call -> Python] POST /api/gateway/stop for ${victimIp}...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ victim_ip: victimIp })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Stop gateway error (${res.status}): ${err}`);
        }
    }

    async getTransparentGatewayStatus(): Promise<any> {
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/status`);
            if (!res.ok) throw new Error('Failed to get gateway status');
            const data: any = await res.json();
            return data.data || { active_sessions: {}, active_count: 0, sinkhole_count: 0, sinkhole_domains: [], total_logs: 0 };
        } catch {
            return { active_sessions: {}, active_count: 0, sinkhole_count: 0, sinkhole_domains: [], total_logs: 0 };
        }
    }

    async getSinkholeDomains(): Promise<string[]> {
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/sinkhole`);
            if (!res.ok) throw new Error('Failed to get sinkholes');
            const data: any = await res.json();
            return data.domains || [];
        } catch {
            return [];
        }
    }

    async addSinkholeDomain(domain: string): Promise<string[]> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/sinkhole/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain })
        });
        if (!res.ok) throw new Error(`Add sinkhole error: ${res.statusText}`);
        const data: any = await res.json();
        return data.domains || [];
    }

    async removeSinkholeDomain(domain: string): Promise<string[]> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/sinkhole/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain })
        });
        if (!res.ok) throw new Error(`Remove sinkhole error: ${res.statusText}`);
        const data: any = await res.json();
        return data.domains || [];
    }

    async getGatewayDnsLogs(limit: number = 100): Promise<any[]> {
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/dns-logs?limit=${limit}`);
            if (!res.ok) throw new Error('Failed to get DNS logs');
            const data: any = await res.json();
            return data.logs || [];
        } catch {
            return [];
        }
    }

    async clearGatewayDnsLogs(): Promise<void> {
        await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/dns-logs`, { method: 'DELETE' });
    }

    async getTelemetry(): Promise<any> {
        if (this.latestTelemetry) return this.latestTelemetry;
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/telemetry`);
            if (!res.ok) throw new Error('Failed to get telemetry');
            const data: any = await res.json();
            this.latestTelemetry = data.telemetry || null;
            return this.latestTelemetry;
        } catch {
            return this.latestTelemetry || null;
        }
    }

    async getWifiInfo(): Promise<{ connected: boolean; ssid: string; signal: string; state: string; interface_type?: string }> {
        if (this.latestWifiInfo) return this.latestWifiInfo;
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/wifi`);
            if (!res.ok) throw new Error('Failed to get wifi info');
            const data: any = await res.json();
            this.latestWifiInfo = data.wifi || { connected: false, ssid: '', signal: '', state: 'disconnected', interface_type: 'unknown' };
            return this.latestWifiInfo;
        } catch {
            return this.latestWifiInfo || { connected: false, ssid: '', signal: '', state: 'error', interface_type: 'unknown' };
        }
    }

    async deepScanPorts(ip: string, ports?: number[]): Promise<any> {
        console.log(`📡 [HTTP Call -> Python] POST /api/scan/ports for ${ip}...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/scan/ports`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, ports })
        }, 30000);

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Deep scan ports error (${res.status}): ${err}`);
        }

        const data: any = await res.json();
        return data.data;
    }

    async optimizeDhcpProfiling(): Promise<{ success: boolean; message?: string; data?: any }> {
        console.log('📡 [HTTP Call -> Python] POST /api/dhcp/wakeup (Teknik 3B Optimization)...');
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/dhcp/wakeup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, 30000);

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Optimize DHCP error (${res.status}): ${err}`);
        }

        const data: any = await res.json();
        return data;
    }

    async quickReauth(targets: any[], holdMs: number = 1500): Promise<any> {
        console.log(`📡 [HTTP Call -> Python] POST /api/network/quick-reauth untuk ${targets.length} target...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/network/quick-reauth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets, hold_ms: holdMs })
        }, holdMs + 20000);

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Quick re-auth error (${res.status}): ${err}`);
        }
        const data: any = await res.json();
        return data.data;
    }

    async getDhcpStats(): Promise<any> {
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/dhcp/stats`);
            if (!res.ok) throw new Error('Failed to get DHCP stats');
            const data: any = await res.json();
            return data.data;
        } catch {
            return { count: 0, snapshot: {} };
        }
    }

    private static readonly CA_INFO_OFFLINE = { status: 'offline', common_name: 'Spoorf Root CA (Offline)', total_cached_leafs: 0 };

    async getCAInfo(): Promise<any> {
        return this.fetchOrDefault('/api/interceptor/ca', PythonBridge.CA_INFO_OFFLINE, (d) => d.data);
    }

    async getCACertPem(): Promise<string> {
        // Sertifikat tidak punya bentuk "kosong yang sah". Mengembalikan '' membuat
        // route download mengirim spoorf-ca.crt 0-byte dengan HTTP 200, dan user
        // mengimpor file rusak tanpa tahu engine sedang offline. Selalu sinyalkan gagal.
        if (!this.ready) throw this.offlineError();
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/interceptor/ca/cert`, {}, 2000);
        if (!res.ok) {
            throw new Error(`Gagal mengambil sertifikat CA dari Python engine (HTTP ${res.status}).`);
        }
        return await res.text();
    }

    /**
     * Cerminan GET /api/interceptor/flows di Python (server.py -> flow_manager.get_stats()).
     * Fallback lama memakai { total, active_connections } yang tidak pernah ada di
     * kontrak, sekaligus menghilangkan `stats` yang justru dibaca konsumen.
     */
    private static readonly L7_FLOWS_OFFLINE = {
        success: false,
        stats: {
            total_flows: 0,
            blocked_flows: 0,
            https_flows: 0,
            http_flows: 0,
            dns_flows: 0
        },
        flows: [] as any[]
    };

    async getL7Flows(query?: { limit?: number; search?: string; scheme?: string; method?: string; is_blocked?: boolean }): Promise<any> {
        const params = new URLSearchParams();
        if (query?.limit) params.set('limit', String(query.limit));
        if (query?.search) params.set('search', query.search);
        if (query?.scheme) params.set('scheme', query.scheme);
        if (query?.method) params.set('method', query.method);
        if (query?.is_blocked !== undefined) params.set('is_blocked', String(query.is_blocked));
        return this.fetchOrDefault(`/api/interceptor/flows?${params.toString()}`, PythonBridge.L7_FLOWS_OFFLINE);
    }

    async clearL7Flows(): Promise<void> {
        // Operasi mutasi: menelan error di sini membuat route melaporkan
        // { success: true } padahal buffer di sisi Python tidak tersentuh.
        if (!this.ready) throw this.offlineError();
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/interceptor/flows`, { method: 'DELETE' }, 2000);
        if (!res.ok) {
            throw new Error(`Gagal menghapus L7 flows di Python engine (HTTP ${res.status}).`);
        }
    }

    async generateLeafCert(domain: string): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/interceptor/cert/leaf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain })
        });
        if (!res.ok) throw new Error('Failed to generate leaf certificate');
        return await res.json();
    }

    // ===== BETTERCAP SECURITY SUITE BRIDGE METHODS =====
    /**
     * Bentuk fallback WAJIB sama dengan GET /api/bettercap/status di Python
     * (server.py) dan dengan interface BettercapStatus di kedua sisi TypeScript.
     * Bentuk yang menyimpang membuat field bertipe `number` menjadi undefined saat
     * runtime tanpa satu pun error dari compiler.
     */
    private static readonly BETTERCAP_STATUS_OFFLINE = {
        success: false,
        dns_rules_count: 0,
        sniffed_credentials_count: 0,
        active_gateway_sessions: 0
    };

    async getBettercapStatus(): Promise<any> {
        return this.fetchOrDefault('/api/bettercap/status', PythonBridge.BETTERCAP_STATUS_OFFLINE);
    }

    async getBettercapDnsRules(): Promise<any[]> {
        return this.fetchOrDefault<any[]>('/api/bettercap/dns/rules', [], (d) => d.rules || []);
    }

    async addBettercapDnsRule(domain: string, target_ip: string, action: string = 'spoof', is_enabled: boolean = true): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, target_ip, action, is_enabled })
        });
        if (!res.ok) throw new Error('Failed to add Bettercap DNS rule');
        return await res.json();
    }

    async updateBettercapDnsRule(ruleId: string, updates: { domain?: string; target_ip?: string; action?: string; is_enabled?: boolean }): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/rules/${ruleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        if (!res.ok) throw new Error(`Failed to update Bettercap DNS rule ${ruleId}`);
        return await res.json();
    }

    async deleteBettercapDnsRule(ruleId: string): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/rules/${ruleId}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(`Failed to delete Bettercap DNS rule ${ruleId}`);
        return await res.json();
    }

    async setBettercapDnsSpoofAll(enabled: boolean, address: string = ''): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/spoof-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, address })
        });
        if (!res.ok) throw new Error('Failed to set Bettercap DNS spoof-all');
        return await res.json();
    }

    async loadBettercapDnsHosts(content: string, default_address: string = '', action: string = 'spoof'): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/hosts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, default_address, action })
        });
        if (!res.ok) throw new Error('Failed to load Bettercap DNS hosts');
        return await res.json();
    }

    async setBettercapDnsTtl(ttl: number): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/ttl`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl })
        });
        if (!res.ok) throw new Error('Failed to set Bettercap DNS ttl');
        return await res.json();
    }

    async getBettercapCredentials(limit: number = 100): Promise<any[]> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/credentials?limit=${limit}`);
        if (!res.ok) throw new Error('Failed to get Bettercap credentials');
        const data: any = await res.json();
        return data.credentials || [];
    }

    async clearBettercapCredentials(): Promise<void> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/credentials`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to clear Bettercap credentials');
    }

    async runBettercapSynScan(targetIp: string, ports?: number[], profile: string = 'top-20'): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/syn-scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_ip: targetIp, ports, profile })
        }, 30000);
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Bettercap SYN scan error: ${err}`);
        }
        const data: any = await res.json();
        return data.data;
    }

    async pulseLiveness(targets: Array<{ ip: string; mac: string; ipv6_link_local?: string; ipv6_global?: string }>, gatewayIp?: string): Promise<Record<string, any>> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/liveness/pulse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets, gateway_ip: gatewayIp, timeout: 3.0 })
        }, 8000);
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Liveness pulse error: ${err}`);
        }
        const data: any = await res.json();
        return data.data?.results || {};
    }

    async getApIsolationStatus(): Promise<any> {
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/network/ap-isolation`);
            if (!res.ok) throw new Error('Failed to get AP isolation status');
            const data: any = await res.json();
            return data.data || { is_isolated: false, confidence: 0.0, percentage: 0, status: 'normal', reason: 'Normal' };
        } catch {
            return { is_isolated: false, confidence: 0.0, percentage: 0, status: 'normal', reason: 'Normal' };
        }
    }

    private static readonly STATUS_OFFLINE = { sessions: {}, interface: 'N/A', self_mac: '00:00:00:00:00:00', active_count: 0 };

    async getStatus(): Promise<any> {
        return this.fetchOrDefault('/api/status', PythonBridge.STATUS_OFFLINE, (d) => d.status);
    }

    /** Cerminan shield_engine.get_status() di python-service/src/core/shield.py. */
    private static readonly SHIELD_STATUS_OFFLINE = {
        is_enabled: false,
        mode: 'host_lock',
        auto_retaliate: false,
        gateway_ip: '',
        gateway_mac: '',
        win_alias: null as string | null,
        locked_at: null as number | null,
        threats_count: 0,
        latest_threat: null as any
    };

    async getShieldStatus(): Promise<any> {
        return this.fetchOrDefault('/api/shield/status', PythonBridge.SHIELD_STATUS_OFFLINE,
            (d) => d.data ?? { ...PythonBridge.SHIELD_STATUS_OFFLINE });
    }

    async toggleShield(enabled: boolean, mode: string = 'host_lock', autoRetaliate: boolean = false, lanTargets: any[] = []): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/shield/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled,
                mode,
                auto_retaliate: autoRetaliate,
                lan_targets: lanTargets
            })
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Toggle shield error: ${err}`);
        }
        const data: any = await res.json();
        return data.data;
    }

    async setShieldMode(mode: string, autoRetaliate: boolean = false): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/shield/mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode,
                auto_retaliate: autoRetaliate
            })
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Set shield mode error: ${err}`);
        }
        const data: any = await res.json();
        return data.data;
    }

    async getShieldThreats(): Promise<any[]> {
        return this.fetchOrDefault<any[]>('/api/shield/threats', [], (d) => d.data || []);
    }

    async clearShieldThreats(): Promise<boolean> {
        if (!this.ready) return false;
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/shield/threats`, { method: 'DELETE' }, 2000);
            return res.ok;
        } catch {
            return false;
        }
    }


    /** Cerminan gaming_engine._get_status_unlocked() di python-service/src/core/gaming.py. */
    private static readonly GAMING_STATUS_OFFLINE = {
        is_enabled: false,
        mode: 'auto_airtime',
        target_ping_ms: 0,
        ping_ms: 0,
        jitter_ms: 0,
        packet_loss_pct: 0,
        uptime_seconds: 0,
        timestamp: 0
    };

    async getGamingStatus(): Promise<any> {
        return this.fetchOrDefault('/api/gaming/status', PythonBridge.GAMING_STATUS_OFFLINE,
            (d) => d.data ?? { ...PythonBridge.GAMING_STATUS_OFFLINE });
    }

    async toggleGamingMode(enabled: boolean, mode: string = 'auto_airtime', targetPingMs: number = 25.0): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gaming/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled,
                mode,
                target_ping_ms: targetPingMs
            })
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Toggle gaming mode error: ${err}`);
        }
        const data: any = await res.json();
        return data.data;
    }

    isReady(): boolean {
        return this.ready;
    }

    async getDiagnostics(): Promise<any> {
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/api/system/diagnostics`, {}, 1500);
            if (res.ok) {
                return await res.json();
            }
        } catch {
            // Quiet fallback saat Python microservice sedang booting atau offline
        }

        // Fallback saat engine Python offline
        return {
            success: false,
            status: 'error',
            elapsed_ms: 0,
            checks: {
                python_engine: {
                    status: 'error',
                    version: 'N/A',
                    details: 'FastAPI Python Engine (:8001) tidak merespons atau belum aktif.'
                },
                // Node tidak punya cara memverifikasi Npcap tanpa probe Python, jadi
                // fallback ini HARUS mengaku tidak tahu. Melaporkan 'error' + "install
                // Npcap" mengarahkan user memperbaiki driver yang sebenarnya sehat,
                // padahal yang mati adalah FastAPI di :8001.
                npcap_driver: {
                    status: 'warning',
                    installed: false,
                    service_running: false,
                    details: 'Pemeriksaan driver Npcap tertunda (Python Engine Offline).'
                },
                network_adapter: {
                    status: 'warning',
                    connected: false,
                    details: 'Pemeriksaan adapter jaringan tertunda (Python Engine Offline).'
                }
            },
            logs: [
                '[ERROR] Gagal menghubungi Python FastAPI Engine di http://127.0.0.1:8001',
                '[NPCAP] Pemeriksaan driver Npcap dilewati — memerlukan Python Engine aktif'
            ]
        };
    }

    stop(): void {
        if (this.ws) {
            try { this.ws.close(); } catch {}
        }
        if (this.isInternalSpawn && this.process) {
            console.log('🛑 Terminating Python child process...');
            this.process.kill('SIGTERM');
            this.process = null;
        }
        this.ready = false;
    }
}
