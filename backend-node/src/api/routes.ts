import { Router, Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { LicenseManager, FeatureLimitError, FeatureLockedError } from '../services/licenseManager';
import {
    isBridgeHttpError,
    isBridgeOperationError,
    isBridgeUnavailable
} from '../services/pythonBridge';

/**
 * KEAMANAN (P2): Sanitasi respons error 500 — hindari kebocoran detail internal.
 * Detail lengkap selalu di-log ke server; klien hanya menerima pesan operasional
 * yang dikenal (validasi/feature-gate/"not found"), selain itu pesan generik.
 */
const OPERATIONAL_ERROR_RE = /not found|required|already|invalid|cannot|gateway|tidak valid|tidak ditemukan|tidak merespons|diperlukan|dilindungi|kebal|di luar jangkauan|terkunci|format|batas|upgrade/i;

export function respondError(res: Response, err: any, status = 500): void {
    const msg = typeof err?.message === 'string' ? err.message : '';
    // Klasifikasi offline lewat tipe error yang stabil (BridgeUnavailableError.code),
    // bukan substring pesan yang bisa berubah saat terjemahan diubah.
    const isOffline = isBridgeUnavailable(err);
    const isDownstreamValidation =
        isBridgeHttpError(err) &&
        err.status >= 400 &&
        err.status < 500;
    if (isOffline || isDownstreamValidation) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ [API Warning] ${msg || 'Python Engine Offline / Aborted'}`);
    } else {
        // eslint-disable-next-line no-console
        console.error('[API Error]', err);
    }
    const isOperational =
        err instanceof FeatureLimitError ||
        err instanceof FeatureLockedError ||
        isOffline ||
        isDownstreamValidation ||
        isBridgeOperationError(err) ||
        (msg !== '' && OPERATIONAL_ERROR_RE.test(msg));
    const responseStatus = isOffline ? 503 : (isDownstreamValidation ? err.status : status);
    res.status(responseStatus).json({
        success: false,
        error: isOperational ? msg : 'Terjadi kesalahan internal pada server.'
    });
}

/**
 * Parse integer positif dari query param dengan fallback aman (P3).
 * Mencegah `NaN` diteruskan ke engine saat input tidak valid (mis. ?limit=abc).
 */
function parsePositiveInt(value: unknown, fallback: number): number {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const createRouter = (deviceManager: DeviceManager, licenseManager?: LicenseManager) => {
    const router = Router();

    // Health check with service readiness
    router.get(['/health', '/api/health'], (req: Request, res: Response) => {
        const memoryFallback = deviceManager.isUsingMemoryFallback();
        const pythonReady = deviceManager.isPythonReady();
        res.json({
            status: pythonReady ? 'ok' : 'degraded',
            services: {
                backend: true,
                database: true,
                // Jujur soal persistensi: false bila DB jatuh ke mode in-memory (P3).
                database_persistent: !memoryFallback,
                python_engine: pythonReady
            },
            warnings: [
                ...(memoryFallback ? ['Database berjalan in-memory: data perangkat & lisensi tidak tersimpan permanen.'] : []),
                ...(!pythonReady ? ['Python FastAPI Engine (:8001) belum terhubung atau sedang booting.'] : [])
            ],
            timestamp: new Date().toISOString()
        });
    });

    // Real System Diagnostics & Hardware Verification Route
    router.get('/api/system/diagnostics', async (req: Request, res: Response) => {
        try {
            const diag = await deviceManager.getSystemDiagnostics();
            res.json(diag);
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Scan network
    router.get('/api/scan', async (req: Request, res: Response) => {
        try {
            const devices = await deviceManager.scanNetwork();
            res.json({
                success: true,
                devices,
                count: devices.length
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Get devices (persisted + live cached)
    router.get('/api/devices', (req: Request, res: Response) => {
        const devices = deviceManager.getDevices();
        res.json({
            success: true,
            devices,
            count: devices.length
        });
    });

    // Reset / Clear all devices and profiles
    router.delete('/api/devices/reset', async (req: Request, res: Response) => {
        try {
            await deviceManager.clearAllDevices();
            res.json({
                success: true,
                message: 'Semua data perangkat dan profil berhasil dibersihkan'
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Block device
    router.post('/api/devices/:ip/block', async (req: Request, res: Response) => {
        try {
            const { ip } = req.params;
            const { gatewayIp } = req.body;
            
            const device = await deviceManager.blockDevice(ip, gatewayIp);
            res.json({
                success: true,
                device,
                message: `Device ${ip} blocked`
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Unblock device
    router.post('/api/devices/:ip/unblock', async (req: Request, res: Response) => {
        try {
            const { ip } = req.params;
            const device = await deviceManager.unblockDevice(ip);
            res.json({
                success: true,
                device,
                message: `Device ${ip} unblocked`
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Redirect device to Instagram
    router.post('/api/devices/:ip/redirect', async (req: Request, res: Response) => {
        try {
            const { ip } = req.params;
            const { redirectUrl, instagramUsername, gatewayIp } = req.body;
            if (!redirectUrl || typeof redirectUrl !== 'string') {
                return res.status(400).json({ success: false, error: 'Valid redirectUrl string is required' });
            }

            const device = await deviceManager.redirectDevice(ip, redirectUrl, instagramUsername, gatewayIp);
            res.json({
                success: true,
                device,
                message: `Device ${ip} redirected to ${redirectUrl}`
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Stop redirect on device
    router.post('/api/devices/:ip/stop-redirect', async (req: Request, res: Response) => {
        try {
            const { ip } = req.params;
            const device = await deviceManager.stopRedirectDevice(ip);
            res.json({
                success: true,
                device,
                message: `Redirect for ${ip} stopped`
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Delete / Forget device from database
    router.delete('/api/devices/:mac', async (req: Request, res: Response) => {
        try {
            const { mac } = req.params;
            await deviceManager.deleteDevice(mac);
            res.json({
                success: true,
                message: `Device with MAC ${mac} deleted from database`
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Update device alias (Profile Target Tag)
    router.put('/api/devices/:mac/alias', async (req: Request, res: Response) => {
        try {
            const { mac } = req.params;
            const { alias } = req.body;
            if (!alias || typeof alias !== 'string') {
                return res.status(400).json({ success: false, error: 'Valid alias string is required' });
            }
            const updated = await deviceManager.setDeviceAlias(mac, alias.trim());
            res.json({
                success: true,
                device: updated,
                message: `Alias for ${mac} updated to "${alias}"`
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Set device bandwidth speed limit
    router.post('/api/devices/:ip/limit', async (req: Request, res: Response) => {
        try {
            const { ip } = req.params;
            const { limit } = req.body;
            if (limit === undefined || typeof limit !== 'number') {
                return res.status(400).json({ success: false, error: 'Numeric speed limit (0-100) is required' });
            }
            const updated = await deviceManager.setSpeedLimit(ip, limit);
            res.json({
                success: true,
                device: updated,
                message: `Speed limit for ${ip} set to ${limit}%`
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Deep scan device ports
    router.post('/api/devices/:ip/scan-ports', async (req: Request, res: Response) => {
        try {
            const { ip } = req.params;
            const { ports } = req.body;
            const updated = await deviceManager.deepScanDevicePorts(ip, Array.isArray(ports) ? ports : undefined);
            res.json({
                success: true,
                device: updated,
                message: `Ports deep scanned for ${ip}`
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Get status
    router.get('/api/status', async (req: Request, res: Response) => {
        try {
            const status = await deviceManager.getStatus();
            res.json({
                success: true,
                status
            });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    // Get gateway
    router.get('/api/gateway', (req: Request, res: Response) => {
        const gateway = deviceManager.findGateway();
        res.json({
            success: true,
            gateway: gateway || null
        });
    });

    
    // Get Wi-Fi Connection Info (SSID, State, Signal)
    
    // Get Live Real-Time Telemetry (Download/Upload Mbps, Ping Latency, Wi-Fi)
    router.get('/api/telemetry', async (_req, res) => {
        try {
            const telemetry = await deviceManager.getTelemetry();
            res.json({ success: true, telemetry });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.get('/api/wifi', async (_req, res) => {
        try {
            const wifi = await deviceManager.getWifiInfo();
            res.json({ success: true, wifi });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    // ===== TRANSPARENT GATEWAY & TRAFFIC MONITOR ROUTES =====
    router.get('/api/gateway/status', async (_req: Request, res: Response) => {
        try {
            const status = await deviceManager.getTransparentGatewayStatus();
            res.json({ success: true, data: status });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/gateway/start', async (req: Request, res: Response) => {
        try {
            const { ip, gatewayIp } = req.body;
            if (!ip || typeof ip !== 'string') {
                return res.status(400).json({ success: false, error: 'Valid IP string is required' });
            }
            const data = await deviceManager.startTransparentGateway(ip, gatewayIp);
            res.json({ success: true, data, message: `Transparent gateway started for ${ip}` });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/gateway/stop', async (req: Request, res: Response) => {
        try {
            const { ip } = req.body;
            if (!ip || typeof ip !== 'string') {
                return res.status(400).json({ success: false, error: 'Valid IP string is required' });
            }
            await deviceManager.stopTransparentGateway(ip);
            res.json({ success: true, message: `Transparent gateway stopped for ${ip}` });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.get('/api/gateway/sinkhole', async (_req: Request, res: Response) => {
        try {
            const domains = await deviceManager.getSinkholeDomains();
            res.json({ success: true, domains });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/gateway/sinkhole', async (req: Request, res: Response) => {
        try {
            const { domain } = req.body;
            if (!domain || typeof domain !== 'string') {
                return res.status(400).json({ success: false, error: 'Valid domain string is required' });
            }
            const domains = await deviceManager.addSinkholeDomain(domain);
            res.json({ success: true, domain, domains });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.delete('/api/gateway/sinkhole/:domain', async (req: Request, res: Response) => {
        try {
            const { domain } = req.params;
            const domains = await deviceManager.removeSinkholeDomain(domain);
            res.json({ success: true, domain, domains });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.get('/api/gateway/logs', async (req: Request, res: Response) => {
        try {
            const limit = parsePositiveInt(req.query.limit, 100);
            const logs = await deviceManager.getGatewayDnsLogs(limit);
            res.json({ success: true, logs });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.delete('/api/gateway/logs', async (_req: Request, res: Response) => {
        try {
            await deviceManager.clearGatewayDnsLogs();
            res.json({ success: true, message: 'Gateway DNS logs cleared' });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    // Optimize Teknik 3B (Passive DHCP Profiling Wakeup & Re-scan)
    router.post('/api/network/optimize-dhcp', async (_req: Request, res: Response) => {
        try {
            const result = await deviceManager.optimizeDhcpProfiling();
            res.json({
                success: true,
                message: 'Teknik 3B DHCP Wakeup and Network Re-Scan completed successfully',
                data: result
            });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/network/profile-refresh', async (_req: Request, res: Response) => {
        try {
            const result = await deviceManager.profileRefresh();
            res.json({ success: true, data: result });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    // Deprecated compatibility alias for safe passive Profile Refresh.
    router.post('/api/network/quick-reauth', async (_req: Request, res: Response) => {
        try {
            const result = await deviceManager.profileRefresh();
            res.json({
                success: true,
                deprecated: true,
                message: 'Quick Re-Auth is deprecated; safe Profile Refresh completed',
                data: result
            });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    // Get DHCP Profiling Stats Snapshot
    router.get('/api/dhcp/stats', async (_req: Request, res: Response) => {
        try {
            const stats = await deviceManager.getDhcpStats();
            res.json({ success: true, data: stats });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    // Get AP Isolation Status Diagnostic
    router.get('/api/network/ap-isolation', async (_req: Request, res: Response) => {
        try {
            const status = await deviceManager.getApIsolationStatus();
            res.json({ success: true, data: status });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    // ===== L7 INTERCEPTOR & CA ROUTES (MITMPROXY ENGINE INTEGRATION) =====
    router.get('/api/interceptor/ca', async (_req: Request, res: Response) => {
        try {
            const caInfo = await deviceManager.getCAInfo();
            res.json({ success: true, data: caInfo });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.get('/api/interceptor/ca/download', async (_req: Request, res: Response) => {
        try {
            const certPem = await deviceManager.getCACertPem();
            res.setHeader('Content-Type', 'application/x-x509-ca-cert');
            res.setHeader('Content-Disposition', 'attachment; filename="spoorf-ca.crt"');
            res.send(certPem);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.get('/api/interceptor/flows', async (req: Request, res: Response) => {
        try {
            const limit = parsePositiveInt(req.query.limit, 100);
            const search = req.query.search as string;
            const scheme = req.query.scheme as string;
            const method = req.query.method as string;
            const is_blocked = req.query.is_blocked !== undefined ? req.query.is_blocked === 'true' : undefined;

            const result = await deviceManager.getL7Flows({ limit, search, scheme, method, is_blocked });
            res.json(result);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.delete('/api/interceptor/flows', async (_req: Request, res: Response) => {
        try {
            await deviceManager.clearL7Flows();
            res.json({ success: true, message: 'L7 Flows cleared' });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/interceptor/cert/leaf', async (req: Request, res: Response) => {
        try {
            const { domain } = req.body;
            if (!domain) {
                return res.status(400).json({ success: false, error: 'Domain parameter is required' });
            }
            const result = await deviceManager.generateLeafCert(domain);
            res.json(result);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    // ===== BETTERCAP SECURITY SUITE ROUTES =====
    router.get('/api/bettercap/status', async (_req: Request, res: Response) => {
        try {
            const status = await deviceManager.getBettercapStatus();
            res.json(status);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.get('/api/bettercap/dns/rules', async (_req: Request, res: Response) => {
        try {
            const config = await deviceManager.getBettercapDnsRules();
            res.json(config);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/bettercap/dns/rules', async (req: Request, res: Response) => {
        try {
            const { domain, target_ip, action, is_enabled } = req.body;
            if (!domain) {
                return res.status(400).json({ success: false, error: 'Domain is required' });
            }
            const result = await deviceManager.addBettercapDnsRule(domain, target_ip || '192.168.1.1', action || 'spoof', is_enabled !== false);
            res.json(result);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.put('/api/bettercap/dns/rules/:id', async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const { domain, target_ip, action, is_enabled } = req.body;
            const result = await deviceManager.updateBettercapDnsRule(id, { domain, target_ip, action, is_enabled });
            res.json(result);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.delete('/api/bettercap/dns/rules/:id', async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const result = await deviceManager.deleteBettercapDnsRule(id);
            res.json(result);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/bettercap/dns/spoof-all', async (req: Request, res: Response) => {
        try {
            const { enabled, address } = req.body;
            const result = await deviceManager.setBettercapDnsSpoofAll(enabled === true, address || '');
            res.json(result);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/bettercap/dns/hosts', async (req: Request, res: Response) => {
        try {
            const { content, default_address, action } = req.body;
            if (!content) {
                return res.status(400).json({ success: false, error: 'content is required' });
            }
            const result = await deviceManager.loadBettercapDnsHosts(content, default_address || '', action || 'spoof');
            res.json(result);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/bettercap/dns/ttl', async (req: Request, res: Response) => {
        try {
            const ttl = parseInt(req.body?.ttl, 10);
            const result = await deviceManager.setBettercapDnsTtl(isNaN(ttl) ? 10 : ttl);
            res.json(result);
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.get('/api/bettercap/credentials', async (req: Request, res: Response) => {
        try {
            const limit = parsePositiveInt(req.query.limit, 100);
            const credentials = await deviceManager.getBettercapCredentials(limit);
            res.json({ success: true, credentials });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.delete('/api/bettercap/credentials', async (_req: Request, res: Response) => {
        try {
            await deviceManager.clearBettercapCredentials();
            res.json({ success: true, message: 'Credentials cleared' });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/bettercap/syn-scan', async (req: Request, res: Response) => {
        try {
            const { target_ip, ports, profile } = req.body;
            if (!target_ip) {
                return res.status(400).json({ success: false, error: 'Target IP is required' });
            }
            const data = await deviceManager.runBettercapSynScan(target_ip, ports, profile || 'top-20');
            res.json({ success: true, data });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    // ===== AUTHENTICATION & CLOUD LICENSING ROUTES =====
    router.get('/api/auth/status', (_req: Request, res: Response) => {
        if (!licenseManager) {
            return res.json({
                success: true,
                isAuthenticated: false,
                user: null,
                license: { tier: 'free', max_cuts: 1, can_throttle: false, can_gateway: false, can_autoreblock: false, can_arsenal: false, cloud_sync: false },
                isOfflineGracePeriod: false,
                hwid: 'HWID-STANDALONE',
                cloudEndpoint: 'https://api.spoorf.app/v1'
            });
        }
        res.json({ success: true, ...licenseManager.getStatus() });
    });

    router.get('/api/auth/me', (_req: Request, res: Response) => {
        if (!licenseManager) {
            return res.json({ success: true, user: null, license: { tier: 'free', max_cuts: 1 } });
        }
        res.json({ success: true, ...licenseManager.getStatus() });
    });

    router.post('/api/auth/login', async (req: Request, res: Response) => {
        try {
            const { email, password, token, cloudUrl } = req.body;
            if (!email && !token) {
                return res.status(400).json({ success: false, error: 'Email atau token lisensi diperlukan' });
            }

            if (!licenseManager) {
                return res.json({ success: true, user: { email, plan: 'free' }, license: { tier: 'free' } });
            }

            const status = await licenseManager.login({ email, password, token, cloudUrl });
            res.json({ success: true, ...status });
        } catch (err: any) {
            res.status(400).json({ success: false, error: err.message });
        }
    });

    router.post('/api/auth/activate', async (req: Request, res: Response) => {
        try {
            const { key } = req.body;
            if (!key) {
                return res.status(400).json({ success: false, error: 'Kode lisensi diperlukan' });
            }

            if (!licenseManager) {
                return res.status(400).json({ success: false, error: 'License manager not available' });
            }

            const status = await licenseManager.activateLicenseKey(key);
            res.json({ success: true, ...status });
        } catch (err: any) {
            res.status(400).json({ success: false, error: err.message });
        }
    });

        router.post('/api/auth/logout', async (_req: Request, res: Response) => {
        try {
            if (licenseManager) {
                await licenseManager.logout();
            }
            res.json({ success: true, message: 'Logged out successfully' });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    // Sentinel Shield (Anti-ARP Spoofing & Threat Radar)
    router.get('/api/shield/status', async (_req: Request, res: Response) => {
        try {
            const data = await deviceManager.getShieldStatus();
            res.json({ success: true, data });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/shield/toggle', async (req: Request, res: Response) => {
        try {
            const { enabled, mode, autoRetaliate, lanTargets } = req.body;
            const data = await deviceManager.toggleShield(
                Boolean(enabled),
                mode || 'host_lock',
                Boolean(autoRetaliate),
                lanTargets || []
            );
            res.json({ success: true, data });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.post('/api/shield/mode', async (req: Request, res: Response) => {
        try {
            const { mode, autoRetaliate } = req.body;
            const data = await deviceManager.setShieldMode(mode || 'host_lock', Boolean(autoRetaliate));
            res.json({ success: true, data });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.get('/api/shield/threats', async (_req: Request, res: Response) => {
        try {
            const data = await deviceManager.getShieldThreats();
            res.json({ success: true, data });
        } catch (err: any) {
            respondError(res, err);
        }
    });

    router.delete('/api/shield/threats', async (_req: Request, res: Response) => {
        try {
            const success = await deviceManager.clearShieldThreats();
            res.json({ success, message: 'Threats log cleared' });
        } catch (err: any) {
            respondError(res, err);
        }
    });


    // ===== GAMING MODE ROUTES =====
    router.get('/api/gaming/status', async (req: Request, res: Response) => {
        try {
            const status = await deviceManager.getGamingStatus();
            res.json({ success: true, data: status });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    router.post('/api/gaming/toggle', async (req: Request, res: Response) => {
        try {
            const { enabled, mode, target_ping_ms } = req.body;
            const status = await deviceManager.toggleGamingMode(Boolean(enabled), mode, target_ping_ms);
            res.json({ success: true, data: status });
        } catch (error: any) {
            respondError(res, error);
        }
    });

    return router;
};
