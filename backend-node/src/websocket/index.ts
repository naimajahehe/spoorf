import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { DeviceManager } from '../services/deviceManager';
import { LicenseManager } from '../services/licenseManager';
import { isAllowedOrigin, isAllowedHost, isValidApiToken } from '../security';

export class WebSocketManager {
    private io: SocketServer;

    constructor(
        server: HttpServer,
        private deviceManager: DeviceManager,
        private licenseManager?: LicenseManager
    ) {
        this.io = new SocketServer(server, {
            // Allowlist origin (bukan '*') — cegah situs jahat membuka socket.
            cors: {
                origin: (origin, callback) => {
                    if (isAllowedOrigin(origin)) {
                        callback(null, true);
                    } else {
                        callback(null, false);
                    }
                },
                methods: ['GET', 'POST']
            },
            // Proteksi DNS-rebinding pada handshake: tolak Host non-loopback.
            allowRequest: (req, callback) => {
                if (isAllowedHost(req.headers.host)) {
                    callback(null, true);
                } else {
                    callback('invalid host', false);
                }
            }
        });

        // KEAMANAN (P1): Wajibkan token bearer pada handshake bila SENTINEL_API_TOKEN
        // diset (Electron). Token dikirim klien via `io(url, { auth: { token } })`.
        // Guard nonaktif otomatis (izinkan semua) bila token tak diset — kompatibel dev.
        this.io.use((socket, next) => {
            if (isValidApiToken(socket.handshake.auth?.token)) {
                next();
            } else {
                next(new Error('Unauthorized: invalid API token.'));
            }
        });

        this.setupListeners();
    }

    private setupListeners() {
        this.io.on('connection', (socket) => this.handleConnection(socket));

        // Listen for device updates from manager
        this.deviceManager.on('scanStarted', () => {
            this.io.emit('scanStarted');
        });

        this.deviceManager.on('scanComplete', (devices) => {
            this.io.emit('scanComplete', devices);
        });

        this.deviceManager.on('devicesUpdated', (devices) => {
            this.io.emit('devicesUpdate', devices);
        });

        this.deviceManager.on('deviceUpdated', (device) => {
            this.io.emit('deviceUpdate', device);
        });

        this.deviceManager.on('deviceDisconnected', (device) => {
            this.io.emit('deviceDisconnected', device);
        });

        this.deviceManager.on('telemetry', (telemetry) => {
            this.io.emit('telemetryStream', telemetry);
        });

        this.deviceManager.on('autoReblocked', (device: any) => {
            console.log(`📡 Broadcast autoReblocked event for ${device.hostname || device.ip}`);
            this.io.emit('autoReblocked', device);
        });

        this.deviceManager.on('networkChanged', (data) => {
            this.io.emit('networkChanged', data);
        });

        this.deviceManager.on('rogueDhcpAlert', (data) => {
            console.warn(`📡 Broadcast rogueDhcpAlert event for server IP: ${data.server_ip}`);
            this.io.emit('rogueDhcpAlert', data);
        });

        this.deviceManager.on('dhcpActivity', (data) => {
            this.io.emit('dhcpEvent', data);
        });

        this.deviceManager.on('profileRefreshStarted', (data) => {
            this.io.emit('profileRefreshStarted', data);
        });

        this.deviceManager.on('profileRefreshDone', (data) => {
            this.io.emit('profileRefreshDone', data);
        });

        this.deviceManager.on('quickReauthStarted', (data) => {
            this.io.emit('quickReauthStarted', data);
        });

        this.deviceManager.on('quickReauthDone', (data) => {
            this.io.emit('quickReauthDone', data);
        });

        this.deviceManager.on('gatewayDnsQuery', (data) => {
            this.io.emit('gatewayDnsQuery', data);
        });

        this.deviceManager.on('gatewayStatusChanged', (data) => {
            this.io.emit('gatewayStatusChanged', data);
        });

        this.deviceManager.on('l7Flow', (data) => {
            this.io.emit('l7Flow', data);
        });

        this.deviceManager.on('bettercapDnsSpoofed', (data) => {
            this.io.emit('bettercapDnsSpoofed', data);
        });

        this.deviceManager.on('bettercapCredentialSniffed', (data) => {
            this.io.emit('bettercapCredentialSniffed', data);
        });

        this.deviceManager.on('shieldStatusChanged', (data) => {
            this.io.emit('shieldStatusChanged', data);
        });

        this.deviceManager.on('arpThreatDetected', (data) => {
            console.warn(`📡 Broadcast arpThreatDetected alert from MAC: ${data.attacker_mac}`);
            this.io.emit('arpThreatDetected', data);
        });

        // Gaming Mode: teruskan telemetri live & perubahan status ke UI React.
        this.deviceManager.on('gamingTelemetry', (data) => {
            this.io.emit('gamingTelemetryStream', data);
        });
        this.deviceManager.on('gamingStatusChanged', (data) => {
            this.io.emit('gamingStatusUpdate', data);
        });

        if (this.licenseManager) {
            this.licenseManager.on('licenseChanged', (status) => {
                console.log(`📡 Broadcast licenseStatus updated: ${status.license.tier.toUpperCase()}`);
                this.io.emit('licenseStatus', status);
            });
        }
    }

    private handleConnection(socket: any) {
            console.log(`Client connected: ${socket.id}`);

            // Send initial devices from database & memory
            socket.emit('devices', this.deviceManager.getDevices());
            if (this.licenseManager) {
                socket.emit('licenseStatus', this.licenseManager.getStatus());
            }
            if (this.deviceManager.isScanning()) {
                socket.emit('scanStarted');
            }

            // Atomic Initial Network Snapshot: Send Wi-Fi & Telemetry immediately
            this.deviceManager.getWifiInfo().then(wifi => {
                socket.emit('wifiStatus', wifi);
            }).catch(() => {});

            this.deviceManager.getTelemetry().then(telemetry => {
                if (telemetry) socket.emit('telemetryStream', telemetry);
            }).catch(() => {});

            this.deviceManager.getGamingStatus().then(gaming => {
                if (gaming) socket.emit('gamingStatus', gaming);
            }).catch(() => {});

            // Handle scan request
            socket.on('scan', async () => {
                try {
                    await this.deviceManager.scanNetwork();
                } catch (error: any) {
                    socket.emit('scanError', { error: error.message });
                }
            });

            // Handle block request
            socket.on('block', async (data: { ip: string, gatewayIp: string }) => {
                try {
                    const device = await this.deviceManager.blockDevice(data.ip, data.gatewayIp);
                    socket.emit('deviceBlocked', device);
                } catch (error: any) {
                    socket.emit('blockError', { error: error.message, ip: data?.ip });
                }
            });

            // Handle unblock request
            socket.on('unblock', async (data: { ip: string }) => {
                try {
                    const device = await this.deviceManager.unblockDevice(data.ip);
                    socket.emit('deviceUnblocked', device);
                } catch (error: any) {
                    socket.emit('unblockError', { error: error.message, ip: data?.ip });
                }
            });

            // Handle delete device from database
            socket.on('deleteDevice', async (data: { mac: string }) => {
                try {
                    await this.deviceManager.deleteDevice(data.mac);
                } catch (error: any) {
                    socket.emit('deleteError', { error: error.message });
                }
            });

            // Handle update device alias (Profile Target Tag)
            socket.on('updateDeviceAlias', async (data: { mac: string; alias: string }) => {
                try {
                    const updated = await this.deviceManager.setDeviceAlias(data.mac, data.alias);
                    socket.emit('deviceAliasUpdated', updated);
                } catch (error: any) {
                    socket.emit('aliasError', { error: error.message, mac: data?.mac });
                }
            });

            // Handle speed limit throttle
            socket.on('setSpeedLimit', async (data: { ip: string; limit: number }) => {
                try {
                    const updated = await this.deviceManager.setSpeedLimit(data.ip, data.limit);
                    socket.emit('deviceSpeedLimitUpdated', updated);
                } catch (error: any) {
                    socket.emit('speedLimitError', { error: error.message, ip: data?.ip });
                }
            });

            // Handle toggle Gaming Mode
            socket.on('toggleGamingMode', async (data: { enabled: boolean; mode?: string; target_ping_ms?: number }) => {
                try {
                    await this.deviceManager.toggleGamingMode(Boolean(data.enabled), data.mode, data.target_ping_ms);
                } catch (error: any) {
                    socket.emit('gamingError', { error: error.message });
                }
            });

            socket.on('disconnect', () => {
                console.log(`Client disconnected: ${socket.id}`);
            });
    }

    broadcast(event: string, data: any) {
        this.io.emit(event, data);
    }
}
