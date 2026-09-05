import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import WebSocket from 'ws';
import { Device, ProfileRefreshResponse } from '../types';

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

export class BridgeHttpError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'BridgeHttpError';
        this.status = status;
    }
}

export class BridgeOperationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BridgeOperationError';
    }
}

/** True untuk error apa pun yang berasal dari Python bridge yang tak terjangkau. */
export function isBridgeUnavailable(err: unknown): err is BridgeUnavailableError {
    return err instanceof BridgeUnavailableError;
}

export function isBridgeHttpError(err: unknown): err is BridgeHttpError {
    return err instanceof BridgeHttpError;
}

export function isBridgeOperationError(err: unknown): err is BridgeOperationError {
    return err instanceof BridgeOperationError;
}

export interface ScanOptions {
    skipMulticastWakeup?: boolean;
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

    private async readMutationResponse(res: Response, operation: string): Promise<any> {
        const raw = await res.text();
        let data: any = null;
        if (raw) {
            try {
                data = JSON.parse(raw);
            } catch {
                data = null;
            }
        }

        let downstreamMessage = [data?.error, data?.detail, data?.message]
            .find(value => typeof value === 'string' && value.trim().length > 0);
        if (!downstreamMessage && Array.isArray(data?.detail)) {
            const validation = data.detail.find((item: any) => typeof item?.msg === 'string');
            if (validation) {
                const location = Array.isArray(validation.loc)
                    ? validation.loc.filter((part: unknown) => typeof part === 'string' || typeof part === 'number').join('.')
                    : '';
                downstreamMessage = location ? `${location}: ${validation.msg}` : validation.msg;
            }
        }

        if (!res.ok) {
            const safeMessage = res.status >= 400 && res.status < 500 && downstreamMessage
                ? downstreamMessage.slice(0, 500)
                : `${operation} failed in Python engine (HTTP ${res.status}).`;
            throw new BridgeHttpError(res.status, safeMessage);
        }

        if (data?.success === false) {
            throw new BridgeOperationError(
                downstreamMessage?.slice(0, 500) || `${operation} was rejected by Python engine.`
            );
        }

        return data;
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

    private handlePythonEvent(event: any): void {
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
        } else if (event.event === 'device_offline_pulse') {
            this.emit('deviceLivenessChanged', { ...event.data, is_online: false });
        } else if (event.event === 'arp_threat_detected') {
            this.emit('arpThreatDetected', event.data);
        } else if (event.event === 'shield_status_changed') {
            this.emit('shieldStatusChanged', event.data);
        } else if (event.event === 'gaming_status_changed') {
            this.emit('gamingStatusChanged', event.data);
        } else if (event.event === 'gaming_telemetry') {
            this.emit('gamingTelemetry', event.data);
        }
    }

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
                    this.handlePythonEvent(event);
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

    async scan(options: ScanOptions = {}): Promise<Device[]> {
        console.log('📡 [HTTP Call -> Python] POST /api/scan (Non-Blocking)...');
        const skipMulticastWakeup = options.skipMulticastWakeup === true;
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: skipMulticastWakeup
                ? JSON.stringify({ skip_multicast_wakeup: true })
                : undefined
        }, 30000);

        const data = await this.readMutationResponse(res, 'Network scan');
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

        const data = await this.readMutationResponse(res, 'Start spoof');
        return data.data.session_id;
    }

    async setSpoofLimit(sessionId: string, speedLimit: number): Promise<void> {
        console.log(`📡 [HTTP Call -> Python] POST /api/spoof/limit for session ${sessionId} (${speedLimit}%)...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/spoof/limit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, speed_limit: speedLimit })
        });

        await this.readMutationResponse(res, 'Set spoof limit');
    }

    async stopSpoof(sessionId: string): Promise<void> {
        console.log(`📡 [HTTP Call -> Python] POST /api/spoof/stop for session ${sessionId}...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/spoof/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId })
        });

        await this.readMutationResponse(res, 'Stop spoof');
    }

    async stopAll(): Promise<void> {
        console.log('📡 [HTTP Call -> Python] POST /api/spoof/stop_all...');
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/spoof/stop_all`, { method: 'POST' });
        await this.readMutationResponse(res, 'Stop all spoof sessions');
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

        const data = await this.readMutationResponse(res, 'Start redirect');
        return data.data;
    }

    async stopRedirect(victimIp: string): Promise<void> {
        console.log(`📡 [HTTP Call -> Python] POST /api/redirect/stop for ${victimIp}...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/redirect/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ victim_ip: victimIp })
        });

        await this.readMutationResponse(res, 'Stop redirect');
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

        const data = await this.readMutationResponse(res, 'Start transparent gateway');
        return data.data;
    }

    async stopTransparentGateway(victimIp: string): Promise<void> {
        console.log(`📡 [HTTP Call -> Python] POST /api/gateway/stop for ${victimIp}...`);
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ victim_ip: victimIp })
        });

        await this.readMutationResponse(res, 'Stop transparent gateway');
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
        const data = await this.readMutationResponse(res, 'Add sinkhole domain');
        return data.domains || [];
    }

    async removeSinkholeDomain(domain: string): Promise<string[]> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/sinkhole/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain })
        });
        const data = await this.readMutationResponse(res, 'Remove sinkhole domain');
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
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/gateway/dns-logs`, { method: 'DELETE' });
        await this.readMutationResponse(res, 'Clear gateway DNS logs');
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

        const data = await this.readMutationResponse(res, 'Deep port scan');
        return data.data;
    }

    async optimizeDhcpProfiling(): Promise<{ success: boolean; message?: string; data?: any }> {
        console.log('📡 [HTTP Call -> Python] POST /api/dhcp/wakeup (Teknik 3B Optimization)...');
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/dhcp/wakeup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, 30000);

        const data = await this.readMutationResponse(res, 'Optimize DHCP profiling');
        return data;
    }

    async profileRefresh(
        targets: Array<{ ip: string; mac: string; ipv6_addresses: string[] }>,
        observationSeconds = 5
    ): Promise<ProfileRefreshResponse> {
        console.log(`📡 [HTTP Call -> Python] POST /api/network/profile-refresh untuk ${targets.length} target...`);
        const timeoutMs = Math.ceil(observationSeconds * 1000) + 15000;
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/network/profile-refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targets,
                observation_seconds: observationSeconds
            })
        }, timeoutMs);

        const payload = await this.readMutationResponse(res, 'Profile refresh');
        return payload.data;
    }

    async quickReauth(targets: any[], _holdMs: number = 1500): Promise<ProfileRefreshResponse> {
        const convertedTargets = targets.map(target => ({
            ip: target.victim_ip,
            mac: target.victim_mac,
            ipv6_addresses: target.victim_ipv6 ? [target.victim_ipv6] : []
        }));
        return this.profileRefresh(convertedTargets, 5);
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
        await this.readMutationResponse(res, 'Clear L7 flows');
    }

    async generateLeafCert(domain: string): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/interceptor/cert/leaf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain })
        });
        return await this.readMutationResponse(res, 'Generate leaf certificate');
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

    private static readonly BETTERCAP_DNS_CONFIG_OFFLINE = {
        success: false,
        rules: [] as any[],
        spoof_all_enabled: false,
        spoof_all_address: '',
        default_ttl: 10
    };

    async getBettercapDnsRules(): Promise<any> {
        return this.fetchOrDefault('/api/bettercap/dns/rules', PythonBridge.BETTERCAP_DNS_CONFIG_OFFLINE);
    }

    async addBettercapDnsRule(domain: string, target_ip: string, action: string = 'spoof', is_enabled: boolean = true): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, target_ip, action, is_enabled })
        });
        return await this.readMutationResponse(res, 'Add Bettercap DNS rule');
    }

    async updateBettercapDnsRule(ruleId: string, updates: { domain?: string; target_ip?: string; action?: string; is_enabled?: boolean }): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/rules/${ruleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        return await this.readMutationResponse(res, `Update Bettercap DNS rule ${ruleId}`);
    }

    async deleteBettercapDnsRule(ruleId: string): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/rules/${ruleId}`, {
            method: 'DELETE'
        });
        return await this.readMutationResponse(res, `Delete Bettercap DNS rule ${ruleId}`);
    }

    async setBettercapDnsSpoofAll(enabled: boolean, address: string = ''): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/spoof-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, address })
        });
        return await this.readMutationResponse(res, 'Set Bettercap DNS spoof-all');
    }

    async loadBettercapDnsHosts(content: string, default_address: string = '', action: string = 'spoof'): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/hosts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, default_address, action })
        });
        return await this.readMutationResponse(res, 'Load Bettercap DNS hosts');
    }

    async setBettercapDnsTtl(ttl: number): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/dns/ttl`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl })
        });
        return await this.readMutationResponse(res, 'Set Bettercap DNS TTL');
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
        await this.readMutationResponse(res, 'Clear Bettercap credentials');
    }

    async runBettercapSynScan(targetIp: string, ports?: number[], profile: string = 'top-20'): Promise<any> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/bettercap/syn-scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_ip: targetIp, ports, profile })
        }, 30000);
        const data = await this.readMutationResponse(res, 'Bettercap SYN scan');
        return data.data;
    }

    async pulseLiveness(targets: Array<{ ip: string; mac: string; ipv6_link_local?: string; ipv6_global?: string }>, gatewayIp?: string): Promise<Record<string, any>> {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/liveness/pulse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets, gateway_ip: gatewayIp, timeout: 3.0 })
        }, 8000);
        const data = await this.readMutationResponse(res, 'Liveness pulse');
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
        const data = await this.readMutationResponse(res, 'Toggle shield');
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
        const data = await this.readMutationResponse(res, 'Set shield mode');
        return data.data;
    }

    async getShieldThreats(): Promise<any[]> {
        return this.fetchOrDefault<any[]>('/api/shield/threats', [], (d) => d.data || []);
    }

    async clearShieldThreats(): Promise<boolean> {
        if (!this.ready) throw this.offlineError();
        const res = await this.fetchWithTimeout(`${this.baseUrl}/api/shield/threats`, { method: 'DELETE' }, 2000);
        await this.readMutationResponse(res, 'Clear shield threats');
        return true;
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
        const data = await this.readMutationResponse(res, 'Toggle gaming mode');
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
