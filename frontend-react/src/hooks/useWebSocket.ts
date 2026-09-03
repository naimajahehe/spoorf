export interface TelemetryData {
    connected: boolean;
    ssid: string;
    signal: string;
    download: number;
    upload: number;
    latency: number;
    timestamp: number;
}

export interface WifiInfo {
    connected: boolean;
    ssid: string;
    signal: string;
    state: 'detecting' | 'connected' | 'disconnected';
    interface_type?: 'wifi' | 'ethernet' | 'tethering' | 'unknown';
}

const getInitialWifiInfo = (): WifiInfo => {
    try {
        const cachedSsid = typeof window !== 'undefined' ? localStorage.getItem('sentinel_last_ssid') : null;
        if (cachedSsid) {
            return {
                connected: true,
                ssid: cachedSsid,
                signal: '',
                state: 'detecting',
                interface_type: cachedSsid.includes('Ethernet') ? 'ethernet' : 'wifi'
            };
        }
    } catch {}
    return {
        connected: false,
        ssid: '',
        signal: '',
        state: 'detecting',
        interface_type: 'unknown'
    };
};

export interface RogueDhcpAlertData {
    server_ip: string;
    server_mac: string;
    gateway_ip: string;
    message: string;
}

export interface GatewayDnsLog {
    id?: string;
    timestamp: number;
    target_ip: string;
    domain: string;
    qtype: string;
    status: 'allowed' | 'sinkholed';
}

export interface GatewayStatusData {
    active_sessions: Record<string, { victim_ip: string; victim_mac: string; gateway_ip: string; started_at: number }>;
    active_count: number;
    sinkhole_count: number;
    sinkhole_domains: string[];
    total_logs: number;
}

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Device, L7Flow, CAStatus, DnsSpoofRule, SniffedCredential, BettercapStatus, ActivityEvent, AuthStatusResponse, GamingStatus, GamingTelemetry } from '../types';

const deviceLabel = (d: Partial<Device> | undefined | null): string =>
    (d?.alias && d.alias.trim()) || (d?.hostname && d.hostname.trim()) || d?.ip || 'Perangkat';
import { apiClient, apiFetch } from '../api/client';
import { resolveBackendUrl } from '../lib/backend';
import { dedupeDevicesByMac } from '../lib/deviceSort';
import { findGateway } from '../lib/gateway';
import { RefreshDomain, RefreshSequencer } from '../lib/refreshSequencer';

const WS_URL = resolveBackendUrl(import.meta.env.VITE_WS_URL);

async function fetchApiJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await apiFetch(path, { signal });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = typeof data?.error === 'string'
            ? data.error
            : `HTTP ${response.status}`;
        throw new Error(`${path}: ${message}`);
    }
    return response.json() as Promise<T>;
}

export function useWebSocket() {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [devices, setDevices] = useState<Device[]>([]);
    const [gateway, setGateway] = useState<Device | null>(null);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isScanning, setIsScanning] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [autoReblockedEvent, setAutoReblockedEvent] = useState<Device | null>(null);
    const [disconnectedDeviceEvent, setDisconnectedDeviceEvent] = useState<Device | null>(null);
    const [rogueDhcpAlert, setRogueDhcpAlert] = useState<RogueDhcpAlertData | null>(null);
    const [authStatus, setAuthStatus] = useState<AuthStatusResponse>({
        isAuthenticated: false,
        user: null,
        license: { tier: 'free', max_cuts: 5, can_throttle: false, can_gateway: false, can_autoreblock: false, can_arsenal: false, can_deep_fingerprint: false, cloud_sync: false },
        isOfflineGracePeriod: false,
        hwid: 'HWID-LOCAL',
        cloudEndpoint: 'https://api.spoorf.app/v1'
    });
    const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusData>({
        active_sessions: {},
        active_count: 0,
        sinkhole_count: 0,
        sinkhole_domains: [],
        total_logs: 0
    });
    const [gatewayDnsLogs, setGatewayDnsLogs] = useState<GatewayDnsLog[]>([]);
    const [l7Flows, setL7Flows] = useState<L7Flow[]>([]);
    const [caStatus, setCaStatus] = useState<CAStatus | null>(null);
    const [bettercapDnsRules, setBettercapDnsRules] = useState<DnsSpoofRule[]>([]);
    const [dnsSpoofAll, setDnsSpoofAll] = useState<{ enabled: boolean; address: string }>({ enabled: false, address: '' });
    const [dnsTtl, setDnsTtl] = useState<number>(10);
    const [sniffedCredentials, setSniffedCredentials] = useState<SniffedCredential[]>([]);
    const [bettercapStatus, setBettercapStatus] = useState<BettercapStatus | null>(null);
    const [telemetry, setTelemetry] = useState<TelemetryData>({
        connected: false,
        ssid: '',
        signal: '',
        download: 0,
        upload: 0,
        latency: 0,
        timestamp: Date.now()
    });
    const [wifiInfo, setWifiInfo] = useState<WifiInfo>(getInitialWifiInfo);
    const [shieldStatus, setShieldStatus] = useState<any>({
        is_enabled: false,
        mode: 'host_lock',
        auto_retaliate: false,
        gateway_ip: '',
        gateway_mac: '',
        win_alias: 'Wi-Fi',
        locked_at: null,
        threats_count: 0
    });
    const [shieldThreats, setShieldThreats] = useState<any[]>([]);
    const [shieldThreatAlert, setShieldThreatAlert] = useState<any | null>(null);
    const [gamingStatus, setGamingStatus] = useState<GamingStatus>({
        is_enabled: false,
        mode: 'auto_airtime',
        target_ping_ms: 25.0,
        ping_ms: 18.0,
        jitter_ms: 1.2,
        packet_loss_pct: 0.0,
        uptime_seconds: 0,
        timestamp: Date.now()
    });
    const [gamingTelemetry, setGamingTelemetry] = useState<GamingTelemetry>({
        ping_ms: 18.0,
        jitter_ms: 1.2,
        packet_loss_pct: 0.0,
        is_optimal: true,
        timestamp: Date.now()
    });
    const deviceRef = useRef<Device[]>([]);
    const pendingAliasRef = useRef<Map<string, string | undefined>>(new Map());
    const refreshSequencerRef = useRef(new RefreshSequencer());
    const refreshAbortControllerRef = useRef<AbortController | null>(null);
    const refreshRequestRef = useRef<(generation?: number) => void>(() => {});

    // ===== Live Activity Feed (event kronologis manusiawi untuk halaman Aktivitas) =====
    const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
    const activitySeqRef = useRef(0);
    const pushActivity = useCallback((e: Omit<ActivityEvent, 'id' | 'timestamp'> & { timestamp?: number }) => {
        setActivityLog(prev => {
            const entry: ActivityEvent = {
                id: `act-${Date.now()}-${activitySeqRef.current++}`,
                timestamp: e.timestamp ?? Date.now(),
                category: e.category,
                tool: e.tool,
                title: e.title,
                description: e.description,
                status: e.status,
                detail: e.detail
            };
            return [entry, ...prev].slice(0, 300);
        });
    }, []);
    const clearActivityLog = useCallback(() => setActivityLog([]), []);

    const detectGateway = useCallback((deviceList: Device[]) => {
        setGateway(findGateway(deviceList));
    }, []);

    const recordLiveStateChange = useCallback((
        domains: readonly RefreshDomain[],
        options?: { scheduleRetry?: boolean }
    ) => {
        refreshSequencerRef.current.recordLiveChange(domains, options);
    }, []);

    const applyWifiSnapshot = useCallback((wifi: Partial<WifiInfo> | undefined | null) => {
        if (!wifi) return;
        const isConn = Boolean(wifi.connected);
        const ssid = wifi.ssid || '';
        setWifiInfo({
            connected: isConn,
            ssid,
            signal: wifi.signal || '',
            interface_type: wifi.interface_type || 'wifi',
            state: wifi.state || (isConn ? 'connected' : 'disconnected')
        });
        if (isConn && ssid) {
            try { localStorage.setItem('sentinel_last_ssid', ssid); } catch {}
        }
    }, []);

    const refreshAuthoritativeState = useCallback(async (expectedGeneration?: number) => {
        const sequencer = refreshSequencerRef.current;
        const ticket = sequencer.beginRefresh(expectedGeneration);
        if (!ticket) return;

        const controller = new AbortController();
        refreshAbortControllerRef.current?.abort();
        refreshAbortControllerRef.current = controller;
        const { signal } = controller;

        const [
            devicesResult,
            gatewayStatusResult,
            gatewayDnsLogsResult,
            caStatusResult,
            l7FlowsResult,
            bettercapDnsResult,
            credentialsResult,
            bettercapStatusResult,
            gamingStatusResult,
            shieldStatusResult,
            shieldThreatsResult,
            wifiResult,
            authResult
        ] = await Promise.allSettled([
            fetchApiJson<{ devices?: Device[] }>('/api/devices', signal),
            fetchApiJson<{ data?: GatewayStatusData }>('/api/gateway/status', signal),
            fetchApiJson<{ logs?: GatewayDnsLog[] }>('/api/gateway/logs?limit=50', signal),
            fetchApiJson<{ data?: CAStatus }>('/api/interceptor/ca', signal),
            fetchApiJson<{ flows?: L7Flow[] }>('/api/interceptor/flows?limit=100', signal),
            fetchApiJson<{
                rules?: DnsSpoofRule[];
                spoof_all_enabled?: boolean;
                spoof_all_address?: string;
                default_ttl?: number;
            }>('/api/bettercap/dns/rules', signal),
            fetchApiJson<{ credentials?: SniffedCredential[] }>('/api/bettercap/credentials?limit=100', signal),
            fetchApiJson<BettercapStatus>('/api/bettercap/status', signal),
            fetchApiJson<{ data?: GamingStatus }>('/api/gaming/status', signal),
            fetchApiJson<{ data?: any }>('/api/shield/status', signal),
            fetchApiJson<{ data?: any[] }>('/api/shield/threats', signal),
            fetchApiJson<{ wifi?: WifiInfo }>('/api/wifi', signal),
            fetchApiJson<AuthStatusResponse>('/api/auth/status', signal)
        ] as const);

        const completion = sequencer.finishRefresh(ticket);
        if (refreshAbortControllerRef.current === controller) {
            refreshAbortControllerRef.current = null;
        }
        if (!sequencer.isCurrent(ticket)) return;

        const valueOf = <T,>(result: PromiseSettledResult<T>): T | null =>
            result.status === 'fulfilled' ? result.value : null;
        const applySnapshot = (domain: RefreshDomain, update: () => void) => {
            if (sequencer.canCommit(ticket, domain)) update();
        };

        const devicesData = valueOf(devicesResult);
        if (Array.isArray(devicesData?.devices)) {
            const cleanList = dedupeDevicesByMac(devicesData.devices);
            applySnapshot('devices', () => {
                setDevices(cleanList);
                deviceRef.current = cleanList;
                detectGateway(cleanList);
            });
        }

        const gatewayStatusData = valueOf(gatewayStatusResult);
        if (gatewayStatusData?.data) {
            applySnapshot('gatewayStatus', () => setGatewayStatus(gatewayStatusData.data!));
        }

        const gatewayDnsLogsData = valueOf(gatewayDnsLogsResult);
        if (Array.isArray(gatewayDnsLogsData?.logs)) {
            applySnapshot('gatewayDnsLogs', () => setGatewayDnsLogs(gatewayDnsLogsData.logs!));
        }

        const caStatusData = valueOf(caStatusResult);
        if (caStatusData?.data) {
            applySnapshot('caStatus', () => setCaStatus(caStatusData.data!));
        }

        const l7FlowsData = valueOf(l7FlowsResult);
        if (Array.isArray(l7FlowsData?.flows)) {
            applySnapshot('l7Flows', () => setL7Flows(l7FlowsData.flows!));
        }

        const bettercapDnsData = valueOf(bettercapDnsResult);
        if (bettercapDnsData) {
            applySnapshot('bettercapDns', () => {
                if (Array.isArray(bettercapDnsData.rules)) setBettercapDnsRules(bettercapDnsData.rules);
                if (typeof bettercapDnsData.spoof_all_enabled === 'boolean') {
                    setDnsSpoofAll({
                        enabled: bettercapDnsData.spoof_all_enabled,
                        address: bettercapDnsData.spoof_all_address || ''
                    });
                }
                if (typeof bettercapDnsData.default_ttl === 'number') setDnsTtl(bettercapDnsData.default_ttl);
            });
        }

        const credentialsData = valueOf(credentialsResult);
        if (Array.isArray(credentialsData?.credentials)) {
            applySnapshot('credentials', () => setSniffedCredentials(credentialsData.credentials!));
        }

        const bettercapStatusData = valueOf(bettercapStatusResult);
        if (bettercapStatusData) {
            applySnapshot('bettercapStatus', () => setBettercapStatus(bettercapStatusData));
        }

        const gamingStatusData = valueOf(gamingStatusResult);
        if (gamingStatusData?.data) {
            applySnapshot('gamingStatus', () => setGamingStatus(gamingStatusData.data!));
        }

        const shieldStatusData = valueOf(shieldStatusResult);
        if (shieldStatusData?.data) {
            applySnapshot('shieldStatus', () => setShieldStatus(shieldStatusData.data));
        }

        const shieldThreatsData = valueOf(shieldThreatsResult);
        if (Array.isArray(shieldThreatsData?.data)) {
            applySnapshot('shieldThreats', () => setShieldThreats(shieldThreatsData.data!));
        }

        const wifiData = valueOf(wifiResult);
        if (wifiData?.wifi) {
            applySnapshot('wifi', () => applyWifiSnapshot(wifiData.wifi));
        }

        const authData = valueOf(authResult);
        if (authData?.license) {
            applySnapshot('auth', () => setAuthStatus(authData));
        }

        const failures = [
            devicesResult,
            gatewayStatusResult,
            gatewayDnsLogsResult,
            caStatusResult,
            l7FlowsResult,
            bettercapDnsResult,
            credentialsResult,
            bettercapStatusResult,
            gamingStatusResult,
            shieldStatusResult,
            shieldThreatsResult,
            wifiResult,
            authResult
        ].filter(result => result.status === 'rejected');
        if (failures.length > 0) {
            console.warn('Authoritative reconnect refresh partially failed:', failures);
            setError('Koneksi tersambung, tetapi sebagian data gagal disegarkan. Coba sambungkan ulang.');
        }

        if (completion.retry) {
            queueMicrotask(() => refreshRequestRef.current(ticket.generation));
        }
    }, [applyWifiSnapshot, detectGateway]);
    refreshRequestRef.current = refreshAuthoritativeState;

    useEffect(() => {
        // KEAMANAN (P1): kirim token bearer lokal (Electron) pada handshake bila ada.
        const apiToken = typeof window !== 'undefined' ? window.electronAPI?.apiToken : undefined;
        const newSocket = io(WS_URL, apiToken ? { auth: { token: apiToken } } : undefined);
        setSocket(newSocket);

        newSocket.on('connect', () => {
            console.log('WebSocket connected to NetCut Sentinel Backend');
            setIsConnected(true);
            setError(null);
            refreshAbortControllerRef.current?.abort();
            const generation = refreshSequencerRef.current.startGeneration();
            void refreshAuthoritativeState(generation);
        });

        newSocket.on('licenseStatus', (data: AuthStatusResponse) => {
            if (data && data.license) {
                recordLiveStateChange(['auth']);
                setAuthStatus(data);
            }
        });

        newSocket.on('disconnect', () => {
            refreshAbortControllerRef.current?.abort();
            refreshAbortControllerRef.current = null;
            refreshSequencerRef.current.startGeneration();
            setWifiInfo(prev => ({ ...prev, connected: false, state: 'disconnected' }));
            setTelemetry(prev => ({ ...prev, connected: false, download: 0, upload: 0, latency: 0 }));
            console.log('WebSocket disconnected');
            setIsConnected(false);
            setIsScanning(false);
        });

        newSocket.on('devices', (data: Device[]) => {
            if (Array.isArray(data)) {
                const cleanList = dedupeDevicesByMac(data);
                recordLiveStateChange(['devices']);
                setDevices(cleanList);
                deviceRef.current = cleanList;
                detectGateway(cleanList);
            }
        });

        newSocket.on('devicesUpdate', (data: Device[]) => {
            if (Array.isArray(data)) {
                const cleanList = dedupeDevicesByMac(data);
                recordLiveStateChange(['devices']);
                setDevices(cleanList);
                deviceRef.current = cleanList;
                detectGateway(cleanList);
            }
        });

        newSocket.on('deviceUpdate', (updatedDevice: Device) => {
            if (updatedDevice && (updatedDevice.mac || updatedDevice.ip)) {
                recordLiveStateChange(['devices']);
                setDevices(prev => {
                    const exists = prev.some(d =>
                        (d.mac && updatedDevice.mac && d.mac.toLowerCase() === updatedDevice.mac.toLowerCase()) ||
                        (d.ip && updatedDevice.ip && d.ip === updatedDevice.ip)
                    );
                    let updated: Device[];
                    if (exists) {
                        updated = prev.map(d =>
                            ((d.mac && updatedDevice.mac && d.mac.toLowerCase() === updatedDevice.mac.toLowerCase()) || (d.ip && updatedDevice.ip && d.ip === updatedDevice.ip))
                                ? { ...d, ...updatedDevice }
                                : d
                        );
                    } else {
                        updated = [...prev, updatedDevice];
                    }
                    deviceRef.current = updated;
                    detectGateway(updated);
                    return updated;
                });
            }
        });

        newSocket.on('deviceAliasUpdated', (updatedDevice: Device) => {
            if (updatedDevice && (updatedDevice.mac || updatedDevice.ip)) {
                recordLiveStateChange(['devices']);
                if (updatedDevice.mac) pendingAliasRef.current.delete(updatedDevice.mac.toLowerCase());
                setDevices(prev => {
                    const updated = prev.map(d =>
                        ((d.mac && updatedDevice.mac && d.mac.toLowerCase() === updatedDevice.mac.toLowerCase()) || (d.ip && updatedDevice.ip && d.ip === updatedDevice.ip))
                            ? { ...d, ...updatedDevice, is_online: true }
                            : d
                    );
                    deviceRef.current = updated;
                    detectGateway(updated);
                    return updated;
                });
            }
        });

        newSocket.on('telemetryStream', (data: TelemetryData) => {
            if (data) {
                // Telemetry refreshes Wi-Fi presentation state but must not trigger reconnect loops.
                recordLiveStateChange(['wifi'], { scheduleRetry: false });
                setTelemetry(data);
                const isConn = Boolean(data.connected);
                setWifiInfo({
                    connected: isConn,
                    ssid: data.ssid || '',
                    signal: data.signal || '',
                    interface_type: (data as any).interface_type || 'wifi',
                    state: isConn ? 'connected' : 'disconnected'
                });
                if (isConn && data.ssid) {
                    try { localStorage.setItem('sentinel_last_ssid', data.ssid); } catch {}
                }
            }
        });

        newSocket.on('wifiStatus', (data: WifiInfo) => {
            if (data) {
                recordLiveStateChange(['wifi']);
                const isConn = Boolean(data.connected);
                setWifiInfo({
                    connected: isConn,
                    ssid: data.ssid || '',
                    signal: data.signal || '',
                    interface_type: data.interface_type || 'wifi',
                    state: isConn ? 'connected' : 'disconnected'
                });
                if (isConn && data.ssid) {
                    try { localStorage.setItem('sentinel_last_ssid', data.ssid); } catch {}
                }
            }
        });

        newSocket.on('autoReblocked', (device: Device) => {
            console.log('⚡ Target auto-reblocked by PostgreSQL Engine:', device);
            recordLiveStateChange(['devices']);
            setAutoReblockedEvent(device);
            pushActivity({
                category: 'security',
                tool: 'arp.auto_reblock',
                title: 'Blokir otomatis',
                description: `${deviceLabel(device)} mencoba kembali dengan MAC baru dan langsung diblokir.`,
                status: 'warning',
                detail: { Perangkat: deviceLabel(device), 'Alamat IP': device.ip, MAC: device.mac }
            });
            // Clear toast after 5 seconds
            setTimeout(() => setAutoReblockedEvent(null), 5000);
        });

        newSocket.on('deviceDisconnected', (device: Device) => {
            console.log('🔌 Target disconnected from network:', device);
            recordLiveStateChange(['devices']);
            setDisconnectedDeviceEvent(device);
            setDevices(prev => {
                const updated = prev.map(d =>
                    ((d.mac && device.mac && d.mac.toLowerCase() === device.mac.toLowerCase()) || (d.ip && device.ip && d.ip === device.ip))
                        ? { ...d, ...device, is_online: false }
                        : d
                );
                deviceRef.current = updated;
                return updated;
            });
            pushActivity({
                category: 'device',
                tool: 'network.presence',
                title: 'Perangkat terputus',
                description: `${deviceLabel(device)} (${device.ip}) meninggalkan jaringan.`,
                status: 'info',
                detail: { Perangkat: deviceLabel(device), 'Alamat IP': device.ip, MAC: device.mac }
            });
        });

        newSocket.on('deviceBlocked', (device: Device) => {
            recordLiveStateChange(['devices']);
            pushActivity({
                category: 'security',
                tool: 'arp.spoofer',
                title: 'Akses internet diputus',
                description: `${deviceLabel(device)} (${device.ip}) berhasil diblokir.`,
                status: 'warning',
                detail: { Perangkat: deviceLabel(device), 'Alamat IP': device.ip, MAC: device.mac }
            });
        });

        newSocket.on('deviceUnblocked', (device: Device) => {
            recordLiveStateChange(['devices']);
            pushActivity({
                category: 'security',
                tool: 'arp.spoofer',
                title: 'Akses internet dipulihkan',
                description: `${deviceLabel(device)} (${device.ip}) kembali dapat mengakses internet.`,
                status: 'success',
                detail: { Perangkat: deviceLabel(device), 'Alamat IP': device.ip }
            });
        });

        newSocket.on('deviceSpeedLimitUpdated', (device: Device) => {
            recordLiveStateChange(['devices']);
            const limit = device.speed_limit ?? 100;
            if (limit >= 100) return; // pemulihan penuh sudah tercakup unblock
            pushActivity({
                category: 'device',
                tool: 'arp.throttle',
                title: 'Kecepatan dibatasi',
                description: `${deviceLabel(device)} (${device.ip}) dibatasi ke ${limit}% kecepatan.`,
                status: 'info',
                detail: { Perangkat: deviceLabel(device), 'Alamat IP': device.ip, 'Batas kecepatan': `${limit}%` }
            });
        });

        newSocket.on('scanStarted', () => {
            recordLiveStateChange([]);
            setIsScanning(true);
            setError(null);
            pushActivity({
                category: 'scan',
                tool: 'scanner.scan_full',
                title: 'Pemindaian jaringan dimulai',
                description: 'Mencari perangkat aktif di seluruh jaringan Wi-Fi…',
                status: 'info'
            });
        });

        newSocket.on('scanComplete', (data: Device[]) => {
            if (Array.isArray(data)) {
                const cleanList = dedupeDevicesByMac(data);
                recordLiveStateChange(['devices']);
                setDevices(cleanList);
                deviceRef.current = cleanList;
                detectGateway(cleanList);
                pushActivity({
                    category: 'scan',
                    tool: 'scanner.scan_full',
                    title: 'Pemindaian selesai',
                    description: `${cleanList.length} perangkat aktif ditemukan di jaringan.`,
                    status: 'success',
                    detail: { 'Jumlah perangkat': cleanList.length }
                });
            }
            setIsScanning(false);
        });

        newSocket.on('scanError', (data: { error: string }) => {
            console.error('Scan error:', data.error);
            setError(data.error);
            setIsScanning(false);
        });

        newSocket.on('blockError', (data: { error: string; ip?: string }) => {
            console.error('Block error:', data);
            setError(`Gagal memblokir ${data.ip || 'perangkat'}: ${data.error}`);
        });

        newSocket.on('unblockError', (data: { error: string; ip?: string }) => {
            console.error('Unblock error:', data);
            setError(`Gagal membuka blokir ${data.ip || 'perangkat'}: ${data.error}`);
        });

        newSocket.on('deleteError', (data: { error: string }) => {
            console.error('Delete error:', data);
            setError(`Gagal menghapus perangkat: ${data.error}`);
        });

        newSocket.on('speedLimitError', (data: { error: string; ip?: string }) => {
            console.error('Speed limit error:', data);
            setError(`Gagal mengatur batas kecepatan ${data.ip || 'perangkat'}: ${data.error}`);
        });

        newSocket.on('gamingError', (data: { error: string }) => {
            console.error('Gaming mode error:', data);
            setError(`Gagal mengubah status Mode Gaming: ${data.error}`);
        });

        newSocket.on('aliasError', (data: { error: string; mac?: string }) => {
            console.error('Alias error:', data);
            setError(`Gagal memperbarui alias: ${data.error}`);
            // Rollback optimistic update ke alias sebelumnya untuk mac terkait
            if (data.mac) {
                const normMac = data.mac.toLowerCase();
                if (pendingAliasRef.current.has(normMac)) {
                    const prevAlias = pendingAliasRef.current.get(normMac);
                    pendingAliasRef.current.delete(normMac);
                    setDevices(prev => {
                        const reverted = prev.map(d =>
                            d.mac && d.mac.toLowerCase() === normMac ? { ...d, alias: prevAlias } : d
                        );
                        deviceRef.current = reverted;
                        return reverted;
                    });
                }
            }
        });

        newSocket.on('gamingStatus', (data: GamingStatus) => {
            if (data) {
                recordLiveStateChange(['gamingStatus']);
                setGamingStatus(data);
            }
        });

        newSocket.on('gamingStatusUpdate', (data: GamingStatus) => {
            if (data) {
                recordLiveStateChange(['gamingStatus']);
                setGamingStatus(data);
                pushActivity({
                    category: 'network',
                    tool: 'gaming.engine',
                    title: data.is_enabled ? 'Mode Gaming Diaktifkan' : 'Mode Gaming Dinonaktifkan',
                    description: data.is_enabled ? `Mode Gaming aktif (Mode: ${data.mode}, Target: ${data.target_ping_ms}ms) — Zero-Lag Blackhole & Anti-Jitter ON.` : 'Mode Gaming dinonaktifkan — kembali ke konfigurasi normal.',
                    status: data.is_enabled ? 'success' : 'info',
                    detail: { 'Target Ping': `${data.target_ping_ms} ms`, Mode: data.mode, 'Ping Terkini': `${data.ping_ms} ms` }
                });
            }
        });

        newSocket.on('gamingTelemetryStream', (data: GamingTelemetry) => {
            if (data) {
                recordLiveStateChange(['gamingStatus'], { scheduleRetry: false });
                setGamingTelemetry(data);
                setGamingStatus(prev => ({
                    ...prev,
                    ping_ms: data.ping_ms,
                    jitter_ms: data.jitter_ms,
                    packet_loss_pct: data.packet_loss_pct
                }));
            }
        });

        newSocket.on('networkChanged', (data) => {
            console.log('Network changed:', data);
            recordLiveStateChange(['devices', 'gatewayStatus', 'wifi']);
            pushActivity({
                category: 'network',
                tool: 'watchdog.network',
                title: 'Jaringan berubah',
                description: data?.new_gateway
                    ? `Gateway berpindah ke ${data.new_gateway}; sesi lama dihentikan.`
                    : 'Perubahan jaringan terdeteksi; sesi lama dihentikan.',
                status: 'warning',
                detail: { 'Gateway baru': data?.new_gateway, 'Interface': data?.new_interface }
            });
        });

        newSocket.on('rogueDhcpAlert', (data: RogueDhcpAlertData) => {
            console.warn('🚨 [UI Hook] Rogue DHCP Server Alert received:', data);
            setRogueDhcpAlert(data);
            pushActivity({
                category: 'security',
                tool: 'dhcp.rogue_detector',
                title: 'Server DHCP mencurigakan',
                description: `Terdeteksi server DHCP tak dikenal di ${data.server_ip} — waspada Evil Twin.`,
                status: 'danger',
                detail: { 'IP server': data.server_ip, 'MAC server': data.server_mac, Gateway: data.gateway_ip }
            });
        });

        newSocket.on('dhcpEvent', (d: { kind: 'release' | 'new' | 'renew'; mac?: string; ip?: string; hostname?: string; vendor_class?: string }) => {
            if (!d || !d.ip) return;
            const nm = (d.hostname && d.hostname.trim()) || d.ip;
            const detail = { 'Alamat IP': d.ip, MAC: d.mac, Hostname: d.hostname || undefined, 'Vendor Class': d.vendor_class || undefined };
            if (d.kind === 'release') {
                pushActivity({
                    category: 'device', tool: 'dhcp.sniffer',
                    title: 'Melepaskan IP (DHCP)',
                    description: `${d.ip} melepaskan alamat IP-nya dari router.`,
                    status: 'warning', detail
                });
            } else if (d.kind === 'new') {
                pushActivity({
                    category: 'device', tool: 'dhcp.sniffer',
                    title: 'Sewa IP baru (DHCP)',
                    description: `Perangkat baru meminta IP ${d.ip} ke router.`,
                    status: 'success', detail
                });
            } else {
                pushActivity({
                    category: 'device', tool: 'dhcp.sniffer',
                    title: 'Perpanjangan sewa IP (DHCP)',
                    description: `${nm} memperbarui sewa IP-nya (DHCP).`,
                    status: 'info', detail
                });
            }
        });

        newSocket.on('quickReauthStarted', (d: { count?: number }) => {
            pushActivity({
                category: 'device', tool: 'dhcp.reauth',
                title: 'Quick Re-Auth dimulai',
                description: `Memancing ${d?.count ?? 0} perangkat Unknown mengirim ulang DHCP (micro-cut serentak)…`,
                status: 'info'
            });
        });

        newSocket.on('quickReauthDone', (d: { count?: number }) => {
            pushActivity({
                category: 'device', tool: 'dhcp.reauth',
                title: 'Quick Re-Auth selesai',
                description: `Selesai memancing ${d?.count ?? 0} perangkat — profil diperbarui via handshake DHCP.`,
                status: 'success'
            });
        });

        newSocket.on('gatewayDnsQuery', (data: GatewayDnsLog) => {
            if (data) {
                recordLiveStateChange(['gatewayDnsLogs']);
                setGatewayDnsLogs(prev => [data, ...prev.slice(0, 149)]);
                const blocked = data.status === 'sinkholed';
                pushActivity({
                    category: 'traffic',
                    tool: 'gateway.dns',
                    title: blocked ? 'Akses situs diblokir' : 'Kunjungan situs',
                    description: blocked
                        ? `${data.target_ip} dicegah membuka ${data.domain}.`
                        : `${data.target_ip} mengakses ${data.domain}.`,
                    status: blocked ? 'warning' : 'info',
                    timestamp: data.timestamp ? data.timestamp * 1000 : Date.now(),
                    detail: { 'Perangkat target': data.target_ip, Domain: data.domain, Jenis: data.qtype }
                });
            }
        });

        newSocket.on('gatewayStatusChanged', (data: GatewayStatusData) => {
            if (data) {
                recordLiveStateChange(['gatewayStatus']);
                setGatewayStatus(data);
            }
        });

        newSocket.on('l7Flow', (data: L7Flow) => {
            if (data && data.id) {
                recordLiveStateChange(['l7Flows']);
                setL7Flows(prev => [data, ...prev.slice(0, 299)]);
            }
        });

        newSocket.on('bettercapDnsSpoofed', (data: any) => {
            if (data && data.rule_id) {
                recordLiveStateChange(['bettercapDns']);
                setBettercapDnsRules(prev => prev.map(r => r.id === data.rule_id ? { ...r, hits: (r.hits || 0) + 1 } : r));
                pushActivity({
                    category: 'traffic',
                    tool: 'bettercap.dns_spoof',
                    title: 'DNS dialihkan',
                    description: data.domain
                        ? `Permintaan DNS untuk ${data.domain} diarahkan ke ${data.resolved_ip || 'alamat baru'}.`
                        : 'Sebuah permintaan DNS diarahkan ulang.',
                    status: 'warning',
                    timestamp: data.timestamp ? data.timestamp * 1000 : Date.now(),
                    detail: { Domain: data.domain, 'Diarahkan ke': data.resolved_ip, Perangkat: data.client_ip }
                });
            }
        });

        newSocket.on('bettercapCredentialSniffed', (data: SniffedCredential) => {
            if (data && data.id) {
                recordLiveStateChange(['credentials']);
                setSniffedCredentials(prev => [data, ...prev.slice(0, 299)]);
                pushActivity({
                    category: 'security',
                    tool: 'bettercap.dissector',
                    title: 'Kredensial terpantau',
                    description: `Data login ${data.protocol} terlihat dari ${data.client_ip} → ${data.host}.`,
                    status: 'danger',
                    timestamp: data.timestamp ? data.timestamp * 1000 : Date.now(),
                    detail: {
                        Protokol: data.protocol,
                        Perangkat: data.client_ip,
                        Tujuan: data.host,
                        Pengguna: data.username || undefined,
                        'Kata sandi': data.password ? '••••••••' : undefined
                    }
                });
            }
        });

        newSocket.on('shieldStatusChanged', (data: any) => {
            if (data) {
                recordLiveStateChange(['shieldStatus']);
                setShieldStatus(data);
            }
        });

        newSocket.on('arpThreatDetected', (data: any) => {
            console.warn('🚨 [useWebSocket] ARP Threat Alert:', data);
            recordLiveStateChange(['shieldThreats']);
            setShieldThreatAlert(data);
            setShieldThreats(prev => [data, ...prev.slice(0, 49)]);
            pushActivity({
                category: 'security',
                tool: 'sentinel.shield',
                title: 'Serangan ARP Terdeteksi',
                description: `Perangkat MAC ${data.attacker_mac} mencoba memalsukan Gateway. Dinetralkan oleh Sentinel Shield!`,
                status: 'danger',
                detail: { 'MAC Penyerang': data.attacker_mac, Target: data.target_ip, Gateway: data.claimed_ip }
            });
        });

        return () => {
            refreshAbortControllerRef.current?.abort();
            refreshAbortControllerRef.current = null;
            refreshSequencerRef.current.startGeneration();
            newSocket.close();
        };
    }, [pushActivity, recordLiveStateChange, refreshAuthoritativeState]);

    const clearError = useCallback(() => setError(null), []);
    const clearAutoReblocked = useCallback(() => setAutoReblockedEvent(null), []);
    const clearDisconnectedDeviceEvent = useCallback(() => setDisconnectedDeviceEvent(null), []);
    const clearRogueDhcpAlert = useCallback(() => setRogueDhcpAlert(null), []);

    const scan = () => {
        if (!socket?.connected) {
            setError('Tidak dapat memindai jaringan saat koneksi backend terputus. Tunggu hingga tersambung lalu coba lagi.');
            return;
        }
        if (isScanning) return;
        setIsScanning(true);
        setError(null);
        socket.emit('scan');
    };

    const block = (ip: string, gatewayIp: string) => {
        if (!socket?.connected) {
            setError('Tidak dapat memblokir perangkat saat koneksi backend terputus. Tunggu hingga tersambung lalu coba lagi.');
            return;
        }
        setError(null);
        socket.emit('block', { ip, gatewayIp });
    };

    const unblock = (ip: string) => {
        if (!socket?.connected) {
            setError('Tidak dapat membuka blokir saat koneksi backend terputus. Tunggu hingga tersambung lalu coba lagi.');
            return;
        }
        setError(null);
        socket.emit('unblock', { ip });
    };

    const deleteDevice = (mac: string) => {
        if (!socket?.connected) {
            setError('Tidak dapat menghapus perangkat saat koneksi backend terputus. Tunggu hingga tersambung lalu coba lagi.');
            return;
        }
        setError(null);
        socket.emit('deleteDevice', { mac });
    };

    const updateAlias = (mac: string, alias: string) => {
        const normMac = mac.toLowerCase();
        // Simpan alias sebelumnya agar bisa di-rollback bila backend gagal (aliasError)
        const prevDev = deviceRef.current.find(d => d.mac && d.mac.toLowerCase() === normMac);
        pendingAliasRef.current.set(normMac, prevDev?.alias);
        setDevices(prev => {
            const updated = prev.map(d =>
                d.mac && d.mac.toLowerCase() === normMac
                    ? { ...d, alias, is_online: true }
                    : d
            );
            deviceRef.current = updated;
            return updated;
        });

        if (socket && socket.connected) {
            socket.emit('updateDeviceAlias', { mac, alias });
        } else {
            apiFetch(`/api/devices/${encodeURIComponent(mac)}/alias`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alias })
            }).catch(err => console.warn('Error updating alias via REST:', err));
        }
    };

    const setSpeedLimit = async (ip: string, limit: number) => {
        setError(null);
        if (socket?.connected) {
            socket.emit('setSpeedLimit', { ip, limit });
        } else {
            try {
                const response = await apiFetch(`/api/devices/${encodeURIComponent(ip)}/limit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ limit })
                });
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.error || `HTTP ${response.status}`);
                }
            } catch (err: any) {
                console.warn('Error setting speed limit via REST:', err);
                setError(`Gagal mengatur batas kecepatan ${ip}: ${err.message}`);
            }
        }
    };

    const checkWifi = async () => {
        try {
            const data = await fetchApiJson<{ wifi?: WifiInfo }>('/api/wifi');
            if (data?.wifi) applyWifiSnapshot(data.wifi);
        } catch (err) {
            console.warn('Error checking Wi-Fi:', err);
        }
    };

    const quickReauth = async () => {
        try {
            const res = await apiFetch('/api/network/quick-reauth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Gagal menjalankan Quick Re-Auth');
            }
            return await res.json();
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    const startTransparentGateway = async (ip: string, gatewayIp?: string) => {
        try {
            const res = await apiFetch('/api/gateway/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, gatewayIp })
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Gagal memulai Transparent Gateway');
            }
            const data = await res.json();
            return data;
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    const stopTransparentGateway = async (ip: string) => {
        try {
            const res = await apiFetch('/api/gateway/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip })
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Gagal menghentikan Transparent Gateway');
            }
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    const addSinkholeDomain = async (domain: string) => {
        try {
            const res = await apiFetch('/api/gateway/sinkhole', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain })
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Gagal menambahkan domain sinkhole');
            }
            const data = await res.json();
            setGatewayStatus(prev => ({ ...prev, sinkhole_domains: data.domains, sinkhole_count: data.domains.length }));
            return data.domains;
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    const removeSinkholeDomain = async (domain: string) => {
        try {
            const res = await apiFetch(`/api/gateway/sinkhole/${encodeURIComponent(domain)}`, {
                method: 'DELETE'
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Gagal menghapus domain sinkhole');
            }
            const data = await res.json();
            setGatewayStatus(prev => ({ ...prev, sinkhole_domains: data.domains, sinkhole_count: data.domains.length }));
            return data.domains;
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    const startRedirect = async (ip: string, redirectUrl: string, username: string, gatewayIp?: string) => {
        try {
            const res = await apiFetch(`/api/devices/${encodeURIComponent(ip)}/redirect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    redirectUrl,
                    instagramUsername: username,
                    gatewayIp: gatewayIp
                })
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Gagal memulai redirect');
            }
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    const stopRedirect = async (ip: string) => {
        try {
            const res = await apiFetch(`/api/devices/${encodeURIComponent(ip)}/stop-redirect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Gagal menghentikan redirect');
            }
        } catch (err: any) {
            setError(err.message);
            throw err;
        }
    };

    const clearGatewayDnsLogs = async () => {
        try {
            // Kosongkan daftar lokal hanya bila server mengonfirmasi. Tanpa cek ini
            // log tampak terhapus lalu muncul lagi saat refresh berikutnya.
            const res = await apiFetch('/api/gateway/logs', { method: 'DELETE' });
            if (!res.ok) {
                throw new Error(`Gagal menghapus log DNS gateway (HTTP ${res.status})`);
            }
            setGatewayDnsLogs([]);
        } catch (err: any) {
            setError(err.message);
            console.warn('Error clearing gateway DNS logs:', err);
        }
    };

    const clearL7Flows = async () => {
        try {
            const res = await apiFetch('/api/interceptor/flows', { method: 'DELETE' });
            if (!res.ok) {
                throw new Error(`Gagal menghapus L7 flows (HTTP ${res.status})`);
            }
            setL7Flows([]);
        } catch (err: any) {
            setError(err.message);
            console.warn('Error clearing L7 flows:', err);
        }
    };

    // ===== BETTERCAP SECURITY SUITE ACTIONS =====
    const addBettercapDnsRule = async (domain: string, target_ip: string, action: string = 'spoof', is_enabled: boolean = true) => {
        try {
            const res = await apiClient.addBettercapDnsRule(domain, target_ip, action, is_enabled);
            if (res && res.rules) {
                setBettercapDnsRules(res.rules);
            }
            return res;
        } catch (err: any) {
            setError(err.message || 'Gagal menambahkan aturan DNS Spoof');
            throw err;
        }
    };

    const updateBettercapDnsRule = async (id: string, updates: { domain?: string; target_ip?: string; action?: string; is_enabled?: boolean }) => {
        try {
            const res = await apiClient.updateBettercapDnsRule(id, updates);
            if (res && res.rules) {
                setBettercapDnsRules(res.rules);
            }
            return res;
        } catch (err: any) {
            setError(err.message || 'Gagal memperbarui aturan DNS Spoof');
            throw err;
        }
    };

    const deleteBettercapDnsRule = async (id: string) => {
        try {
            const res = await apiClient.deleteBettercapDnsRule(id);
            if (res && res.rules) {
                setBettercapDnsRules(res.rules);
            }
            return res;
        } catch (err: any) {
            setError(err.message || 'Gagal menghapus aturan DNS Spoof');
            throw err;
        }
    };

    const setBettercapDnsSpoofAll = async (enabled: boolean, address: string = '') => {
        try {
            const res = await apiClient.setBettercapDnsSpoofAll(enabled, address);
            setDnsSpoofAll({ enabled: res?.spoof_all_enabled ?? enabled, address: res?.spoof_all_address ?? address });
            return res;
        } catch (err: any) {
            setError(err.message || 'Gagal mengatur DNS spoof-all');
            throw err;
        }
    };

    const loadBettercapDnsHosts = async (content: string, defaultAddress: string = '', action: string = 'spoof') => {
        try {
            const res = await apiClient.loadBettercapDnsHosts(content, defaultAddress, action);
            if (res && res.rules) setBettercapDnsRules(res.rules);
            return res;
        } catch (err: any) {
            setError(err.message || 'Gagal memuat daftar domain DNS');
            throw err;
        }
    };

    const setBettercapDnsTtl = async (ttl: number) => {
        try {
            const res = await apiClient.setBettercapDnsTtl(ttl);
            if (res && typeof res.default_ttl === 'number') setDnsTtl(res.default_ttl);
            return res;
        } catch (err: any) {
            setError(err.message || 'Gagal mengatur TTL DNS');
            throw err;
        }
    };

    const clearBettercapCredentials = async () => {
        try {
            await apiClient.clearBettercapCredentials();
            setSniffedCredentials([]);
        } catch (err: any) {
            console.warn('Error clearing Bettercap credentials:', err);
        }
    };

    const runBettercapSynScan = async (target_ip: string, ports?: number[], profile: string = 'top-20') => {
        try {
            const res = await apiClient.runBettercapSynScan(target_ip, ports, profile);
            return res.data;
        } catch (err: any) {
            setError(err.message || 'Gagal menjalankan pemindaian SYN');
            throw err;
        }
    };

    const authLogin = async (email: string, password?: string, token?: string, cloudUrl?: string) => {
        try {
            const res = await apiClient.login(email, password, token, cloudUrl);
            if (res && res.license) {
                setAuthStatus(res);
            }
            return res;
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Login gagal');
            throw err;
        }
    };

    const authLogout = async () => {
        try {
            await apiClient.logout();
            setAuthStatus({
                isAuthenticated: false,
                user: null,
                license: { tier: 'free', max_cuts: 5, can_throttle: false, can_gateway: false, can_autoreblock: false, can_arsenal: false, can_deep_fingerprint: false, cloud_sync: false },
                isOfflineGracePeriod: false,
                hwid: 'HWID-LOCAL',
                cloudEndpoint: 'https://api.spoorf.app/v1'
            });
        } catch (err: any) {
            console.warn('Error during logout:', err);
        }
    };

    const activateLicenseKey = async (key: string) => {
        try {
            const res = await apiClient.activateLicenseKey(key);
            if (res && res.license) {
                setAuthStatus(res);
            }
            return res;
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Aktivasi lisensi gagal');
            throw err;
        }
    };

    const toggleShield = async (enabled: boolean, mode: string = 'host_lock', autoRetaliate: boolean = false) => {
        try {
            const res = await apiClient.toggleShield(enabled, mode, autoRetaliate);
            if (res && res.data) {
                setShieldStatus(res.data);
            }
            pushActivity({
                category: 'security',
                tool: 'sentinel.shield',
                title: enabled ? 'Sentinel Shield Diaktifkan' : 'Sentinel Shield Dinonaktifkan',
                description: enabled ? `Mode ${mode} aktif. Gateway terkunci permanen.` : 'Tabel ARP dikembalikan ke mode dinamis.',
                status: enabled ? 'success' : 'info'
            });
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Gagal mengubah status Shield');
            throw err;
        }
    };

    const setShieldMode = async (mode: string, autoRetaliate: boolean = false) => {
        try {
            const res = await apiClient.setShieldMode(mode, autoRetaliate);
            if (res && res.data) {
                setShieldStatus(res.data);
            }
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Gagal mengubah mode Shield');
            throw err;
        }
    };

    const clearShieldThreats = async () => {
        try {
            await apiClient.clearShieldThreats();
            setShieldThreats([]);
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Gagal membersihkan riwayat ancaman');
            throw err;
        }
    };

    const clearShieldThreatAlert = useCallback(() => {
        setShieldThreatAlert(null);
    }, []);

    const refreshShield = async () => {
        try {
            const statusRes = await apiClient.getShieldStatus();
            if (statusRes && statusRes.data) setShieldStatus(statusRes.data);
            const threatsRes = await apiClient.getShieldThreats();
            if (threatsRes && threatsRes.data) setShieldThreats(threatsRes.data);
        } catch (err: any) {
            console.warn('Error refreshing shield:', err);
        }
    };

    const toggleGamingMode = async (enabled: boolean, mode: string = 'auto_airtime', target_ping_ms: number = 25.0) => {
        try {
            setError(null);
            if (socket?.connected) {
                socket.emit('toggleGamingMode', { enabled, mode, target_ping_ms });
            } else {
                const res = await apiClient.toggleGamingMode(enabled, mode, target_ping_ms);
                if (res?.data) setGamingStatus(res.data);
            }
        } catch (err: any) {
            setError(err.message || 'Gagal mengubah status Mode Gaming');
            throw err;
        }
    };

    return {
        devices,
        gateway,
        isConnected,
        isScanning,
        error,
        clearError,
        autoReblockedEvent,
        clearAutoReblocked,
        disconnectedDeviceEvent,
        clearDisconnectedDeviceEvent,
        rogueDhcpAlert,
        clearRogueDhcpAlert,
        scan,
        block,
        unblock,
        deleteDevice,
        updateAlias,
        setSpeedLimit,
        wifiInfo,
        telemetry,
        checkWifi,
        gatewayStatus,
        gatewayDnsLogs,
        l7Flows,
        caStatus,
        clearL7Flows,
        startTransparentGateway,
        stopTransparentGateway,
        addSinkholeDomain,
        removeSinkholeDomain,
        clearGatewayDnsLogs,
        startRedirect,
        stopRedirect,
        bettercapDnsRules,
        dnsSpoofAll,
        dnsTtl,
        sniffedCredentials,
        bettercapStatus,
        addBettercapDnsRule,
        updateBettercapDnsRule,
        deleteBettercapDnsRule,
        setBettercapDnsSpoofAll,
        loadBettercapDnsHosts,
        setBettercapDnsTtl,
        clearBettercapCredentials,
        runBettercapSynScan,
        activityLog,
        pushActivity,
        clearActivityLog,
        quickReauth,
        authStatus,
        authLogin,
        authLogout,
        activateLicenseKey,
        shieldStatus,
        shieldThreats,
        shieldThreatAlert,
        clearShieldThreatAlert,
        toggleShield,
        gamingStatus,
        gamingTelemetry,
        toggleGamingMode,
        setShieldMode,
        clearShieldThreats,
        refreshShield
    };
}
