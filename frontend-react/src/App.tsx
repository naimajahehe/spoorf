import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Menu,
    PanelLeft,
    Search,
    AlertTriangle,
    X,
    Wifi,
    WifiOff,
    Zap,
    CheckSquare,
    Bell,
    BellOff,
    ChevronDown,
    Radar,
    Activity,
    Sparkles,
    ShieldAlert,
    ShieldCheck,
    ShieldCogCorner,
    Radio,
    Network,
    LayoutDashboard,
    Terminal,
    Settings,
    RefreshCw,
    Trash2,
    Laptop,
    CheckCircle2,
    BookOpen,
    Sun,
    Moon
} from 'lucide-react';
import { Select, SelectTrigger, SelectContent, SelectItem } from './components/motion/select';
import { AnimatedSidebar, AnimatedSidebarProvider } from './components/AnimatedSidebar';
import { Tabs, TabsList, TabsTrigger } from './components/motion/tabs';
import { CommandPalette, CommandItem } from './components/motion/CommandPalette';
import { DeviceTable } from './components/DeviceTable';
import { AgentScanProgress } from './components/AgentScanProgress';
import { SecurityTelemetrySidebar } from './components/SecurityTelemetrySidebar';
import { InstagramRedirectModal } from './components/InstagramRedirectModal';
import { TransparentGatewayView } from './components/TransparentGatewayView';
import { BettercapArsenalView } from './components/BettercapArsenalView';
import { ActivityLogView } from './components/ActivityLogView';
import { SettingsView } from './components/SettingsView';
import { DocumentationView } from './components/DocumentationView';
import { NewDeviceToast, ToastDeviceItem } from './components/NewDeviceToast';
import { DisconnectedDeviceToast } from './components/DisconnectedDeviceToast';
import { OnlineDeviceToast } from './components/OnlineDeviceToast';
import { ActionErrorToast } from './components/ActionErrorToast';
import { NotificationPopover, NotificationItem } from './components/NotificationPopover';
import { OpenPortsTable } from './components/OpenPortsTable';
import { DeepPortScanModal } from './components/DeepPortScanModal';
import { WebPreviewModal } from './components/WebPreviewModal';
import { DhcpReconnectModal } from './components/DhcpReconnectModal';
import { WifiDetailsPopover } from './components/WifiDetailsPopover';
import { DashboardWelcomeView } from './components/DashboardWelcomeView';
import { GamingModeWidget } from './components/GamingModeWidget';
import { LoginModal } from './components/LoginModal';
import { UpgradeProModal } from './components/UpgradeProModal';
import { EngineReadinessGateContent } from './components/EngineReadinessGate';
import { AuthPage } from './components/ui/auth-page';
import { NeonMesh } from './components/ui/neon-mesh';
import { ScrollReveal } from './components/motion/scroll-reveal';
import { useNetwork } from './context/NetworkContext';
import { Device, ApIsolationInfo } from './types';
import { apiClient } from './api/client';
import { sortDevices } from './lib/deviceSort';
import { playChimeSound, requestNotificationPermission, sendDesktopNotification, isNotificationMuted, setNotificationMuted } from './lib/notifications';
import { ThemeMode, getInitialTheme, applyTheme, toggleTheme } from './lib/theme';
import { hasDhcpEvidence } from './lib/dhcpProfiling';
import { cn } from './lib/utils';
import './App.css';

type FilterTab = 'all' | 'online' | 'throttled' | 'blocked';

export interface ActiveToastItem {
    id: string;
    type: 'new_device' | 'reconnected' | 'disconnected' | 'error';
    device?: Device;
    message?: string;
    title?: string;
    timestamp: number;
}

function App() {
    const {
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
        gamingStatus,
        gamingTelemetry,
        toggleGamingMode,
        toggleShield,
        setShieldMode,
        clearShieldThreats,
        refreshShield
    } = useNetwork();
    const [isCheckingWifi, setIsCheckingWifi] = useState(false);
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    const [upgradeModalState, setUpgradeModalState] = useState<{ isOpen: boolean; reason?: string }>({ isOpen: false });

    const [activeTab, setActiveTab] = useState<FilterTab>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [activeNav, setActiveNav] = useState('dashboard');
    const [selectedIps, setSelectedIps] = useState<string[]>([]);
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [loadingIps, setLoadingIps] = useState<Set<string>>(new Set());
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            const saved = localStorage.getItem('sentinel_sidebar_collapsed');
            if (saved !== null) {
                return saved === 'true';
            }
        } catch {
            // fallback if localStorage restricted
        }
        return true; // Default collapsed sidebar sebagai tampilan utama
    });

    useEffect(() => {
        try {
            localStorage.setItem('sentinel_sidebar_collapsed', String(sidebarCollapsed));
        } catch {
            // ignore
        }
    }, [sidebarCollapsed]);

    const [selectedInspectorIp, setSelectedInspectorIp] = useState<string | null>(null);
    const [isEngineReady, setIsEngineReady] = useState<boolean>(false);
    const [redirectModalDevice, setRedirectModalDevice] = useState<Device | null>(null);
    const [activeToasts, setActiveToasts] = useState<ActiveToastItem[]>([]);
    const [isNotificationOpen, setIsNotificationOpen] = useState<boolean>(false);
    const [notificationHistory, setNotificationHistory] = useState<NotificationItem[]>([]);
    const [isTableCollapsed, setIsTableCollapsed] = useState<boolean>(false);
    const [isDeepScanModalOpen, setIsDeepScanModalOpen] = useState<boolean>(false);
    const [deepScanTargetDevice, setDeepScanTargetDevice] = useState<Device | null>(null);
    const [webPreviewState, setWebPreviewState] = useState<{ isOpen: boolean; device: Device | null; port: number }>({
        isOpen: false,
        device: null,
        port: 80
    });
    const [isDhcpModalOpen, setIsDhcpModalOpen] = useState<boolean>(false);
    const [scanMode, setScanMode] = useState<'normal' | 'opt_3b' | 'auto' | 'super'>('auto');
    const [apIsolation, setApIsolation] = useState<ApIsolationInfo | null>(null);
    const [isWifiPopoverOpen, setIsWifiPopoverOpen] = useState<boolean>(false);
    const [isRefreshingApIsolation, setIsRefreshingApIsolation] = useState<boolean>(false);
    const [isMuted, setIsMuted] = useState<boolean>(() => isNotificationMuted());
    const deviceOnlineStatusRef = useRef<Map<string, boolean>>(new Map());
    const isInitialScanDoneRef = useRef<boolean>(false);

    // Synchronize mute state across tabs/windows or custom events
    useEffect(() => {
        const handleMuteChange = (e: any) => {
            if (e?.detail && typeof e.detail.muted === 'boolean') {
                setIsMuted(e.detail.muted);
            } else {
                setIsMuted(isNotificationMuted());
            }
        };
        window.addEventListener('sentinel-mute-changed', handleMuteChange);
        window.addEventListener('storage', handleMuteChange);
        return () => {
            window.removeEventListener('sentinel-mute-changed', handleMuteChange);
            window.removeEventListener('storage', handleMuteChange);
        };
    }, []);

    // Theme Mode Management (Dark Mode / Day Mode)
    const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        const handleThemeChange = (e: any) => {
            if (e?.detail && (e.detail.theme === 'light' || e.detail.theme === 'dark')) {
                setTheme(e.detail.theme);
            }
        };
        window.addEventListener('sentinel-theme-changed', handleThemeChange);
        return () => window.removeEventListener('sentinel-theme-changed', handleThemeChange);
    }, []);

    const handleToggleTheme = () => {
        setTheme(prev => toggleTheme(prev));
    };

    const fetchApIsolation = async () => {
        try {
            const res = await apiClient.getApIsolation();
            if (res && res.data) {
                setApIsolation(res.data);
            }
        } catch {
            // ignore
        }
    };

    const handleRefreshApIsolation = async () => {
        setIsRefreshingApIsolation(true);
        try {
            const res = await apiClient.getApIsolation();
            if (res && res.data) {
                setApIsolation(res.data);
            }
        } finally {
            setIsRefreshingApIsolation(false);
        }
    };

    const handleToggleMute = () => {
        setIsMuted(prev => {
            const next = !prev;
            setNotificationMuted(next);
            if (next) {
                // When muting: dismiss any active floating toasts immediately
                setActiveToasts([]);
            }
            return next;
        });
    };

    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

    // Global Cmd+K / Ctrl+K keyboard shortcut listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setIsCommandPaletteOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Assemble Command Palette items
    const commandPaletteItems = useMemo<CommandItem[]>(() => {
        const items: CommandItem[] = [
            // Group: Navigasi Menu
            {
                id: 'nav-dashboard',
                label: 'Dashboard — Daftar Perangkat Terhubung',
                group: 'Navigasi Menu',
                icon: LayoutDashboard,
                hint: 'Daftar Perangkat',
                keywords: ['dashboard', 'target', 'devices', 'perangkat', 'home'],
                onSelect: () => setActiveNav('dashboard')
            },
            {
                id: 'nav-gateway',
                label: 'Smart Gateway — DNS Sinkhole & SSL Interceptor',
                group: 'Navigasi Menu',
                icon: Radio,
                hint: 'L7 Gateway',
                keywords: ['gateway', 'dns', 'sinkhole', 'ssl', 'mitm', 'interceptor'],
                onSelect: () => setActiveNav('gateway')
            },
            {
                id: 'nav-arsenal',
                label: 'Security Arsenal — SYN Scanner & Bettercap',
                group: 'Navigasi Menu',
                icon: Zap,
                hint: 'VIP Arsenal',
                keywords: ['arsenal', 'syn', 'scan', 'ports', 'bettercap', 'spoof', 'dns'],
                onSelect: () => setActiveNav('arsenal')
            },
            {
                id: 'nav-shield',
                label: 'Sentinel Shield — Anti-ARP Spoofing & Threat Radar',
                group: 'Navigasi Menu',
                icon: ShieldCogCorner,
                hint: 'Perisai Anti-NetCut',
                keywords: ['shield', 'defense', 'pertahanan', 'anti-netcut', 'arp', 'radar', 'threat'],
                onSelect: () => setActiveNav('shield')
            },
            {
                id: 'nav-activity',
                label: 'Aktivitas Langsung — Live Event Stream',
                group: 'Navigasi Menu',
                icon: Terminal,
                hint: 'Audit Log',
                keywords: ['activity', 'log', 'aktivitas', 'events', 'feed'],
                onSelect: () => setActiveNav('activity')
            },
            {
                id: 'nav-documentation',
                label: 'Dokumentasi — Panduan Penggunaan, Cara Kerja & Diagram Alir',
                group: 'Navigasi Menu',
                icon: BookOpen,
                hint: 'Dokumentasi Interaktif',
                keywords: ['docs', 'dokumentasi', 'panduan', 'cara kerja', 'diagram', 'flow', 'npcap', 'arp', 'pwm', 'throttling', 'help', 'tutorial'],
                onSelect: () => setActiveNav('documentation')
            },
            {
                id: 'nav-settings',
                label: 'Settings — Konfigurasi & Pertahanan',
                group: 'Navigasi Menu',
                icon: Settings,
                hint: 'Pengaturan',
                keywords: ['settings', 'pengaturan', 'config', 'preferensi'],
                onSelect: () => setActiveNav('settings')
            },

            // Group: Aksi Cepat
            {
                id: 'action-scan',
                label: 'Pindai Jaringan Sekarang (Scan Network)',
                group: 'Aksi Cepat',
                icon: RefreshCw,
                hint: 'Auto-Discovery',
                keywords: ['scan', 'pindai', 'refresh', 'cari', 'discover'],
                onSelect: () => scan()
            },
            {
                id: 'action-shield-lock',
                label: 'Aktifkan Sentinel Shield (Host Immunity Lock)',
                group: 'Aksi Cepat',
                icon: ShieldCheck,
                hint: '100% Kebal',
                keywords: ['shield', 'lock', 'kebal', 'aktifkan perisai', 'protect'],
                onSelect: () => toggleShield(true, 'host_lock', false)
            },
            {
                id: 'action-shield-unlock',
                label: 'Nonaktifkan Sentinel Shield (Kembalikan ke Dinamis)',
                group: 'Aksi Cepat',
                icon: ShieldAlert,
                hint: 'Dinamis',
                keywords: ['shield', 'unlock', 'matikan', 'nonaktifkan'],
                onSelect: () => toggleShield(false)
            },
            {
                id: 'action-toggle-mute',
                label: isMuted ? 'Aktifkan Notifikasi (Unmute)' : 'Heningkan Notifikasi (Mute)',
                group: 'Aksi Cepat',
                icon: isMuted ? Bell : BellOff,
                hint: isMuted ? 'Muted' : 'Aktif',
                keywords: ['mute', 'unmute', 'suara', 'sound', 'notifikasi', 'silent', 'hening'],
                onSelect: () => handleToggleMute()
            },
            {
                id: 'action-clear-notif',
                label: 'Bersihkan Semua Riwayat Notifikasi',
                group: 'Aksi Cepat',
                icon: Trash2,
                hint: 'Clear History',
                keywords: ['clear', 'hapus', 'notifikasi', 'clean'],
                onSelect: () => handleClearAllNotifications()
            },
            {
                id: 'action-toggle-theme',
                label: theme === 'dark' ? 'Ganti ke Mode Siang / Day Mode (White Mode)' : 'Ganti ke Mode Malam / Night Mode (Dark Mode)',
                group: 'Aksi Cepat',
                icon: theme === 'dark' ? Sun : Moon,
                hint: theme === 'dark' ? 'Day Mode' : 'Night Mode',
                keywords: ['theme', 'dark', 'light', 'white', 'day', 'night', 'mode', 'tema', 'siang', 'malam', 'terang', 'gelap'],
                onSelect: () => handleToggleTheme()
            }
        ];

        // Group: Perangkat Jaringan (Live Connected Devices)
        devices.forEach(dev => {
            const devName = dev.alias?.trim() || dev.hostname?.trim() || dev.ip;
            const isOnline = Boolean(dev.is_online);
            const isGw = Boolean(dev.is_gateway);
            const isMe = Boolean(dev.is_self);
            const statusTag = isGw ? 'Router Gateway' : isMe ? 'This PC' : isOnline ? 'Online' : 'Offline';

            items.push({
                id: `dev-${dev.mac || dev.ip}`,
                label: `${devName} — ${dev.ip || dev.last_ip || 'Offline'}`,
                group: `Perangkat Jaringan (${devices.filter(d => d.is_online).length} Host Terhubung)`,
                hint: `${statusTag} • ${dev.mac}`,
                icon: isGw ? Radio : isMe ? Laptop : isOnline ? CheckCircle2 : WifiOff,
                keywords: [
                    dev.ip,
                    dev.last_ip || '',
                    dev.mac,
                    dev.vendor || '',
                    dev.hostname || '',
                    dev.alias || '',
                    dev.os || '',
                    'device',
                    'perangkat'
                ],
                badge: dev.is_blocked ? (
                    <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-mono text-[9px] border border-red-500/30">
                        Cut-Off
                    </span>
                ) : dev.speed_limit && dev.speed_limit < 100 ? (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[9px] border border-amber-500/30">
                        {dev.speed_limit}%
                    </span>
                ) : undefined,
                onSelect: () => {
                    if (dev.ip) {
                        setSelectedInspectorIp(dev.ip);
                    }
                }
            });
        });

        return items;
    }, [devices, isMuted, theme, scan, toggleShield]);

    const selectedInspectorMacRef = useRef<string | null>(null);

    // Keep selectedInspectorMacRef in sync when user selects a device
    useEffect(() => {
        if (selectedInspectorIp) {
            const dev = devices.find(d => d.ip === selectedInspectorIp);
            if (dev) {
                selectedInspectorMacRef.current = dev.mac.toLowerCase();
            }
        } else {
            selectedInspectorMacRef.current = null;
        }
    }, [selectedInspectorIp, devices]);

    const handleCloseInspector = () => {
        selectedInspectorMacRef.current = null;
        setSelectedInspectorIp(null);
    };

    const inspectorDevice = useMemo(() => {
        if (!selectedInspectorIp) return null;
        // 1. Try finding by IP
        const devByIp = devices.find(d => d.ip === selectedInspectorIp);
        if (devByIp) return devByIp;

        // 2. If IP changed while inspector is open, resolve by MAC to keep inspector open seamlessly
        if (selectedInspectorMacRef.current) {
            const devByMac = devices.find(d => d.mac.toLowerCase() === selectedInspectorMacRef.current);
            if (devByMac) return devByMac;
        }
        return null;
    }, [devices, selectedInspectorIp]);

    // Keep selectedInspectorIp synchronized if target device migrated to a new IP
    useEffect(() => {
        if (inspectorDevice && inspectorDevice.ip !== selectedInspectorIp) {
            setSelectedInspectorIp(inspectorDevice.ip);
        }
    }, [inspectorDevice, selectedInspectorIp]);

    // Auto-scan and request OS notification permission on mount
    useEffect(() => {
        scan();
        fetchApIsolation();
        requestNotificationPermission();
    }, []);

    useEffect(() => {
        if (!isScanning) {
            fetchApIsolation();
        }
    }, [isScanning]);

    // When network scan is running, auto-cancel select mode and clear selected IPs
    useEffect(() => {
        if (isScanning) {
            setIsSelectMode(false);
            setSelectedIps([]);
        }
    }, [isScanning]);

    // Detect newly connected devices AND reconnected devices on Wi-Fi and trigger actionable Toast + Desktop Notification + History
    useEffect(() => {
        if (devices.length === 0) return;

        if (!isInitialScanDoneRef.current) {
            // First load: populate known device online statuses without firing alerts
            devices.forEach(d => {
                if (d.mac) {
                    deviceOnlineStatusRef.current.set(d.mac.toLowerCase(), Boolean(d.is_online));
                }
            });
            isInitialScanDoneRef.current = true;
            return;
        }

        const toastsToFire: ToastDeviceItem[] = [];
        const historyToFire: NotificationItem[] = [];

        devices.forEach(dev => {
            if (!dev.mac || dev.is_gateway || dev.is_self) return;
            const macLower = dev.mac.toLowerCase();
            const prevStatus = deviceOnlineStatusRef.current.get(macLower);
            const isCurrentlyOnline = Boolean(dev.is_online);

            if (prevStatus === undefined) {
                // Perangkat baru pertama kali terdeteksi
                deviceOnlineStatusRef.current.set(macLower, isCurrentlyOnline);
                if (isCurrentlyOnline) {
                    toastsToFire.push({ device: dev, toastType: 'new_device' });
                    historyToFire.push({
                        id: `dev-${dev.mac}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                        category: 'device',
                        senderName: dev.alias && dev.alias.trim() !== '' ? dev.alias.trim() : (dev.hostname && dev.hostname.trim() !== '' ? dev.hostname : dev.ip),
                        actionText: 'terdeteksi di',
                        targetName: 'Wi-Fi Lokal',
                        timestamp: new Date(),
                        timeAgo: 'Baru saja',
                        isRead: false,
                        bubbleText: `Perangkat baru terdeteksi dengan IP ${dev.ip}.`,
                        type: 'new_device',
                        device: dev,
                        deviceIp: dev.ip
                    });
                    const nm = dev.alias?.trim() || dev.hostname?.trim() || dev.ip;
                    pushActivity({
                        category: 'device',
                        tool: 'network.presence',
                        title: 'Perangkat baru bergabung',
                        description: `${nm} (${dev.ip}) terhubung ke Wi-Fi.`,
                        status: 'success',
                        detail: { Perangkat: nm, 'Alamat IP': dev.ip, MAC: dev.mac, Vendor: dev.vendor || undefined }
                    });
                }
            } else if (prevStatus === false && isCurrentlyOnline === true) {
                // Perangkat yang sebelumnya offline kini KEMBALI ONLINE / RECONNECTED!
                deviceOnlineStatusRef.current.set(macLower, true);
                toastsToFire.push({ device: dev, toastType: 'reconnected' });
                historyToFire.push({
                    id: `reconnect-${dev.mac}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                    category: 'device',
                    senderName: dev.alias && dev.alias.trim() !== '' ? dev.alias.trim() : (dev.hostname && dev.hostname.trim() !== '' ? dev.hostname : dev.ip),
                    actionText: 'kembali online di',
                    targetName: 'Wi-Fi Lokal',
                    timestamp: new Date(),
                    timeAgo: 'Baru saja',
                    isRead: false,
                    bubbleText: `Perangkat kembali online dengan IP ${dev.ip}.`,
                    type: 'reconnected',
                    device: dev,
                    deviceIp: dev.ip
                });
                {
                    const nm = dev.alias?.trim() || dev.hostname?.trim() || dev.ip;
                    pushActivity({
                        category: 'device',
                        tool: 'network.presence',
                        title: 'Perangkat kembali online',
                        description: `${nm} (${dev.ip}) tersambung lagi ke Wi-Fi.`,
                        status: 'info',
                        detail: { Perangkat: nm, 'Alamat IP': dev.ip, MAC: dev.mac }
                    });
                }
            } else {
                // Perbarui status online jika ada perubahan (misal true -> false)
                deviceOnlineStatusRef.current.set(macLower, isCurrentlyOnline);
            }
        });

        if (toastsToFire.length > 0) {
            // Always record to Notification Center History
            setNotificationHistory(prev => [...historyToFire, ...prev]);

            // 1. Play pleasant melodic chime if not muted
            if (!isMuted) {
                playChimeSound();
            }

            // 2. Add to In-App Toast Queue if not muted
            if (!isMuted) {
                const incomingToasts: ActiveToastItem[] = toastsToFire.map(item => ({
                    id: `${item.toastType || 'new'}-${item.device.mac || item.device.ip}-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
                    type: item.toastType || 'new_device',
                    device: item.device,
                    timestamp: Date.now()
                }));

                setActiveToasts(prev => {
                    const incomingKeys = new Set(incomingToasts.map(t => (t.device ? (t.device.mac || t.device.ip).toLowerCase() : t.id)));
                    const existingFiltered = prev.filter(p => !incomingKeys.has(p.device ? (p.device.mac || p.device.ip).toLowerCase() : p.id));
                    return [...incomingToasts, ...existingFiltered].slice(0, 3);
                });
            }

            // 3. Fire Native OS Desktop Notification if not muted
            if (!isMuted) {
                toastsToFire.forEach(item => {
                    const dev = item.device;
                    const isReconnected = item.toastType === 'reconnected';
                    const devName = dev.alias && dev.alias.trim() !== ''
                        ? dev.alias.trim()
                        : (dev.hostname && dev.hostname.trim() !== '' ? dev.hostname : dev.ip);
                    const rangeText = dev.estimated_range && dev.estimated_range !== '-'
                        ? ` (Jarak: ${dev.estimated_range})`
                        : '';

                    sendDesktopNotification(
                        isReconnected ? 'NetCut Sentinel: Perangkat Online Kembali!' : 'NetCut Sentinel: Perangkat Baru Masuk!',
                        {
                            body: isReconnected
                                ? `${devName} [${dev.ip}] baru saja kembali online ke Wi-Fi${rangeText}.`
                                : `${devName} [${dev.ip}] baru saja terhubung ke Wi-Fi${rangeText}.`,
                            onClick: () => {
                                setSelectedInspectorIp(dev.ip);
                            }
                        }
                    );
                });
            }
        }
    }, [devices, isMuted]);

    // Surface action errors (such as offline block rejections) as floating Toast Notifications
    useEffect(() => {
        if (!error) return;

        const toastId = `err-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
        const errorToast: ActiveToastItem = {
            id: toastId,
            type: 'error',
            message: error,
            title: 'Gagal Memproses Aksi',
            timestamp: Date.now()
        };
        setActiveToasts(prev => [errorToast, ...prev].slice(0, 3));

        const timer = setTimeout(() => {
            clearError();
        }, 5000);
        return () => clearTimeout(timer);
    }, [error, clearError]);

    // Record Auto-Reblock event to notification history
    useEffect(() => {
        if (autoReblockedEvent) {
            const entry: NotificationItem = {
                id: `reblock-${autoReblockedEvent.mac}-${Date.now()}`,
                category: 'security',
                senderName: 'Auto-Reblock',
                actionText: 'berhasil mengunci target',
                targetName: autoReblockedEvent.alias || autoReblockedEvent.hostname || autoReblockedEvent.ip,
                timestamp: new Date(),
                timeAgo: 'Baru saja',
                isRead: false,
                bubbleText: `Target mencoba berganti MAC (${autoReblockedEvent.mac}) di IP ${autoReblockedEvent.ip} dan otomatis diputus kembali.`,
                type: 'auto_reblock',
                device: autoReblockedEvent,
                deviceIp: autoReblockedEvent.ip
            };
            setNotificationHistory(prev => [entry, ...prev]);
        }
    }, [autoReblockedEvent]);

    // Handle Disconnected Device Toast Notifications (Suppressed if muted, recorded to history)
    useEffect(() => {
        if (disconnectedDeviceEvent) {
            const dev = disconnectedDeviceEvent;
            const devKey = (dev.mac || dev.ip).toLowerCase();
            if (dev.mac) {
                deviceOnlineStatusRef.current.set(dev.mac.toLowerCase(), false);
            }

            // Record to Notification Center History silently
            const entry: NotificationItem = {
                id: `disconn-${dev.mac || dev.ip}-${Date.now()}`,
                category: 'device',
                senderName: dev.alias || dev.hostname || dev.ip,
                actionText: 'terputus dari jaringan',
                targetName: dev.ip,
                timestamp: new Date(),
                timeAgo: 'Baru saja',
                isRead: false,
                bubbleText: `Perangkat ${dev.alias || dev.hostname || dev.ip} (${dev.mac || dev.ip}) tidak lagi aktif di Wi-Fi.`,
                type: 'system',
                device: dev,
                deviceIp: dev.ip
            };
            setNotificationHistory(prev => [entry, ...prev]);

            // Only show floating toast if not muted
            if (!isMuted) {
                const newToast: ActiveToastItem = {
                    id: `disconn-${dev.mac || dev.ip}-${Date.now()}`,
                    type: 'disconnected',
                    device: dev,
                    timestamp: Date.now()
                };
                setActiveToasts(prev => {
                    const filtered = prev.filter(d => (d.device ? (d.device.mac || d.device.ip).toLowerCase() !== devKey : true));
                    return [newToast, ...filtered].slice(0, 3);
                });
            }
            clearDisconnectedDeviceEvent();
        }
    }, [disconnectedDeviceEvent, clearDisconnectedDeviceEvent, isMuted]);

    // Record Rogue DHCP event to notification history
    useEffect(() => {
        if (rogueDhcpAlert) {
            const entry: NotificationItem = {
                id: `rogue-${rogueDhcpAlert.server_mac}-${Date.now()}`,
                category: 'security',
                senderName: 'Rogue DHCP Server',
                actionText: 'terdeteksi di',
                targetName: rogueDhcpAlert.server_ip,
                timestamp: new Date(),
                timeAgo: 'Baru saja',
                isRead: false,
                bubbleText: `Server DHCP liar (MAC: ${rogueDhcpAlert.server_mac}) membagikan IP tanpa izin. Potensi serangan Evil Twin.`,
                type: 'rogue_dhcp'
            };
            setNotificationHistory(prev => [entry, ...prev]);
        }
    }, [rogueDhcpAlert]);

    const unreadCount = useMemo(() => {
        return notificationHistory.filter(n => !n.isRead).length;
    }, [notificationHistory]);

    const handleMarkAllRead = () => {
        setNotificationHistory(prev => prev.map(n => ({ ...n, isRead: true })));
    };

    const handleClearAllNotifications = () => {
        setNotificationHistory([]);
    };

    const gatewayIp = useMemo(() => {
        return gateway?.ip || devices.find(d => d.is_gateway)?.ip || '';
    }, [gateway, devices]);

    // Strict Filter logic:
    // Online: only online AND NOT blocked
    // Blocked: only blocked (both online and offline persistent)
    // All: all hosts in database
    const handleNavSelect = (nav: string) => {
        setActiveNav(nav);
        if (nav === 'search') {
            searchInputRef.current?.focus();
            searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (nav === 'dashboard') {
            setActiveTab('all');
            setSearchQuery('');
        } else if (nav === 'security') {
            setActiveTab('blocked');
        } else if (nav === 'recon') {
            searchInputRef.current?.focus();
        } else if (nav === 'telemetry') {
            handleManualCheckWifi();
        } else if (nav === 'gateway') {
            // Smart Transparent Gateway view
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === '/' && document.activeElement !== searchInputRef.current && !['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName)) {
                e.preventDefault();
                searchInputRef.current?.focus();
            } else if (e.key === 'Escape') {
                if (document.activeElement === searchInputRef.current) {
                    searchInputRef.current?.blur();
                } else {
                    handleCloseInspector();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Deduplicate device list by profile_id / MAC (preferring active online entries & recent timestamps)
    const dedupedDevices = useMemo(() => {
        const uniqueMap = new Map<string, Device>();
        for (const dev of devices) {
            const key = (dev.profile_id && dev.profile_id !== '') ? dev.profile_id : (dev.mac ? dev.mac.toLowerCase() : dev.ip);
            const existing = uniqueMap.get(key);
            if (!existing) {
                uniqueMap.set(key, dev);
            } else {
                // If existing is offline but incoming dev is online, prefer online
                if (!existing.is_online && dev.is_online) {
                    uniqueMap.set(key, dev);
                } else if (existing.is_online && !dev.is_online) {
                    // Retain online existing
                } else {
                    // If same online status, prefer the one with active session, non-default speed limit, or newer last_seen
                    const existingTime = existing.last_seen ? new Date(existing.last_seen).getTime() : 0;
                    const devTime = dev.last_seen ? new Date(dev.last_seen).getTime() : 0;
                    if ((dev.speed_limit !== undefined && dev.speed_limit < 100) || dev.is_blocked || devTime >= existingTime) {
                        uniqueMap.set(key, dev);
                    }
                }
            }
        }
        return Array.from(uniqueMap.values());
    }, [devices]);

    const filteredDevices = useMemo(() => {
        const list = dedupedDevices.filter(device => {
            if (activeTab === 'online') {
                if (!device.is_online || device.is_blocked) return false;
            }
            if (activeTab === 'throttled') {
                const speed = device.speed_limit ?? (device.is_blocked ? 0 : 100);
                if (device.is_blocked || speed >= 100 || speed <= 0) return false;
            }
            if (activeTab === 'blocked') {
                if (!device.is_blocked) return false;
            }

            if (deferredSearchQuery.trim()) {
                const q = deferredSearchQuery.toLowerCase();
                const matchIp = device.ip.toLowerCase().includes(q);
                const matchIpv6Ll = (device.ipv6_link_local || '').toLowerCase().includes(q);
                const matchIpv6Glob = (device.ipv6_global || '').toLowerCase().includes(q);
                const matchIpv6Arr = (device.ipv6_addresses || []).some(a => a.toLowerCase().includes(q));
                const matchHost = (device.hostname || '').toLowerCase().includes(q);
                const matchVendor = (device.vendor || '').toLowerCase().includes(q);
                const matchOs = (device.os || '').toLowerCase().includes(q);
                const matchMac = device.mac.toLowerCase().includes(q);
                const matchAlias = (device.alias || '').toLowerCase().includes(q);
                return matchIp || matchIpv6Ll || matchIpv6Glob || matchIpv6Arr || matchHost || matchVendor || matchOs || matchMac || matchAlias;
            }

            return true;
        });

        return [...list].sort(sortDevices);
    }, [dedupedDevices, activeTab, deferredSearchQuery]);

    // Stats calculations
    const stats = useMemo(() => {
        const total = dedupedDevices.length;
        const onlineUnblocked = dedupedDevices.filter(d => d.is_online && !d.is_blocked).length;
        const throttledCount = dedupedDevices.filter(d => !d.is_blocked && (d.speed_limit ?? 100) < 100 && (d.speed_limit ?? 100) > 0).length;
        const blockedCount = dedupedDevices.filter(d => d.is_blocked).length;
        return { total, onlineUnblocked, throttledCount, blockedCount };
    }, [dedupedDevices]);

    const dhcpUnprofiledCount = useMemo(() => {
        return dedupedDevices.filter(
            d => !d.is_gateway && !d.is_self && d.is_online && !hasDhcpEvidence(d)
        ).length;
    }, [dedupedDevices]);

    // Checkbox selection handlers (Gateway tidak dapat dipilih)
    const handleToggleSelect = (ip: string) => {
        const target = devices.find(d => d.ip === ip);
        if (target?.is_gateway) return;

        setSelectedIps(prev => {
            if (prev.includes(ip)) {
                return prev.filter(item => item !== ip);
            } else {
                return [...prev, ip];
            }
        });
    };

    const handleToggleSelectAll = () => {
        const selectableIps = filteredDevices.filter(d => !d.is_gateway).map(d => d.ip);
        const isAllVisibleSelected = selectableIps.length > 0 && selectableIps.every(ip => selectedIps.includes(ip));

        if (isAllVisibleSelected) {
            setSelectedIps(prev => prev.filter(ip => !selectableIps.includes(ip)));
        } else {
            setSelectedIps(prev => Array.from(new Set([...prev, ...selectableIps])));
        }
    };


    const handleManualCheckWifi = async () => {
        setIsCheckingWifi(true);
        await checkWifi();
        setTimeout(() => setIsCheckingWifi(false), 800);
    };

    // 2-Second Freeze Toggle Handler
    const handleToggleInternet = (device: Device) => {
        if (loadingIps.has(device.ip) || device.is_gateway) return;

        // Free tier block limit guard
        if (!device.is_blocked && (device.speed_limit === undefined || device.speed_limit >= 100)) {
            if (authStatus?.license?.tier === 'free') {
                const activeBlockedCount = devices.filter(d => d.is_blocked).length;
                const limit = authStatus.license.max_cuts || 5;
                if (activeBlockedCount >= limit) {
                    setUpgradeModalState({
                        isOpen: true,
                        reason: `Batas kuota Free tercapai (Maksimal ${limit} target pemutusan). Upgrade ke PRO untuk memutuskan target tanpa batas!`
                    });
                    return;
                }
            }
        }

        setLoadingIps(prev => new Set(prev).add(device.ip));

        if (device.is_blocked || (device.speed_limit !== undefined && device.speed_limit < 100)) {
            unblock(device.ip);
        } else {
            block(device.ip, gatewayIp);
        }

        setTimeout(() => {
            setLoadingIps(prev => {
                const next = new Set(prev);
                next.delete(device.ip);
                return next;
            });
        }, 2000);
    };

    // Perhitungan cerdas & konsisten untuk perangkat terpilih
    const selectedDevices = useMemo(() => {
        return devices.filter(d => selectedIps.includes(d.ip) && !d.is_gateway && !d.is_self);
    }, [devices, selectedIps]);

    const unblockedSelected = useMemo(() => {
        return selectedDevices.filter(d => !d.is_blocked && (d.speed_limit === undefined || d.speed_limit > 0));
    }, [selectedDevices]);

    const blockedSelected = useMemo(() => {
        return selectedDevices.filter(d => d.is_blocked || (d.speed_limit !== undefined && d.speed_limit <= 0));
    }, [selectedDevices]);

    const unblockedSelectedCount = unblockedSelected.length;
    const blockedSelectedCount = blockedSelected.length;

    // Action: Block Selected Devices (Hanya memblokir perangkat yang sedang aktif/tidak terblokir)
    const handleBlockSelected = () => {
        if (unblockedSelected.length === 0) return;

        if (authStatus?.license?.tier === 'free') {
            const activeBlockedCount = devices.filter(d => d.is_blocked).length;
            const limit = authStatus.license.max_cuts || 5;
            if (activeBlockedCount + unblockedSelected.length > limit) {
                setUpgradeModalState({
                    isOpen: true,
                    reason: `Batas kuota Free tercapai (Maksimal ${limit} target pemutusan). Upgrade ke PRO untuk memutuskan target tanpa batas!`
                });
                return;
            }
        }

        unblockedSelected.forEach(d => {
            setLoadingIps(prev => new Set(prev).add(d.ip));
            block(d.ip, gatewayIp);
        });

        setTimeout(() => {
            setLoadingIps(prev => {
                const next = new Set(prev);
                unblockedSelected.forEach(d => next.delete(d.ip));
                return next;
            });
        }, 2000);
    };

    // Action: Restore Selected Devices (Hanya memulihkan perangkat yang sedang terblokir)
    const handleRestoreSelected = () => {
        if (blockedSelected.length === 0) return;

        blockedSelected.forEach(d => {
            setLoadingIps(prev => new Set(prev).add(d.ip));
            unblock(d.ip);
        });

        setTimeout(() => {
            setLoadingIps(prev => {
                const next = new Set(prev);
                blockedSelected.forEach(d => next.delete(d.ip));
                return next;
            });
        }, 2000);
    };

    const handleStartRedirect = async (ip: string, redirectUrl: string, username: string) => {
        setLoadingIps(prev => new Set(prev).add(ip));
        try {
            await startRedirect(ip, redirectUrl, username, gatewayIp);
        } finally {
            setLoadingIps(prev => {
                const next = new Set(prev);
                next.delete(ip);
                return next;
            });
        }
    };

    const handleStopRedirect = async (ip: string) => {
        setLoadingIps(prev => new Set(prev).add(ip));
        try {
            await stopRedirect(ip);
        } finally {
            setLoadingIps(prev => {
                const next = new Set(prev);
                next.delete(ip);
                return next;
            });
        }
    };

    const selectedCount = selectedIps.length;

    // 1. Initial Pre-Flight Engine Initialization & Login Gates with Smooth Horizontal Slide Transition
    if (!isEngineReady || (authStatus && !authStatus.isAuthenticated)) {
        return (
            <NeonMesh className="w-full min-h-screen flex items-center justify-center font-sans p-4 select-none overflow-hidden">
                <AnimatePresence mode="wait" initial={false}>
                    {!isEngineReady ? (
                        <motion.div
                            key="initialization-gate"
                            initial={{ opacity: 0, x: 0 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -100, scale: 0.96 }}
                            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                            className="relative z-10 w-full max-w-xl flex justify-center"
                        >
                            <EngineReadinessGateContent onReady={() => setIsEngineReady(true)} />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="auth-gate"
                            initial={{ opacity: 0, x: 100, scale: 0.96 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -100, scale: 0.96 }}
                            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                            className="relative z-10 w-full max-w-md flex justify-center"
                        >
                            <AuthPage
                                authStatus={authStatus}
                                onLogin={authLogin}
                                onActivateKey={activateLicenseKey}
                                isModal={false}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </NeonMesh>
        );
    }

    return (
        <AnimatedSidebarProvider
            open={!sidebarCollapsed}
            onOpenChange={(open) => setSidebarCollapsed(!open)}
            openMobile={mobileMenuOpen}
            onOpenMobileChange={setMobileMenuOpen}
        >
            <div className="flex w-full h-screen overflow-hidden bg-[#090a0c] text-zinc-100 antialiased">
                {/* Mobile Sidebar Backdrop Overlay */}
                <AnimatePresence>
                    {mobileMenuOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setMobileMenuOpen(false)}
                            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
                        />
                    )}
                </AnimatePresence>

                {/* Left Sidebar */}
                <AnimatedSidebar
                    gateway={gateway}
                    isConnected={isConnected}
                    activeNav={activeNav}
                    onNavSelect={handleNavSelect}
                    onOpenSearch={() => setIsCommandPaletteOpen(true)}
                    totalHosts={stats.total}
                    blockedHosts={stats.blockedCount}
                    isMobileOpen={mobileMenuOpen}
                    onCloseMobile={() => setMobileMenuOpen(false)}
                    collapsed={sidebarCollapsed}
                    onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
                    authStatus={authStatus}
                    onOpenAuthModal={() => setIsLoginModalOpen(true)}
                    onOpenUpgradeModal={() => setUpgradeModalState({ isOpen: true, reason: 'Upgrade ke PRO untuk membuka seluruh kapabilitas!' })}
                />

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
                    {/* Topbar Header - Matched height h-16 pt-2 with sidebar header for perfect alignment */}
                    <header className="h-16 flex items-center justify-between w-full px-6 lg:px-8 bg-[#090a0c] shrink-0 gap-4 pt-2">
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                                className="hidden md:inline-flex items-center justify-center size-8 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors border border-transparent hover:border-white/[0.08]"
                                title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
                                aria-label="Toggle Sidebar"
                            >
                                <PanelLeft size={16} />
                            </button>

                            <button
                                type="button"
                                onClick={() => setMobileMenuOpen(true)}
                                className="inline-flex md:hidden items-center justify-center size-8 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                                aria-label="Buka Menu Navigasi"
                            >
                                <Menu size={18} />
                            </button>

                            <div className="hidden md:block w-px h-4 bg-white/[0.08]" />

                            <div className="flex items-center gap-2 text-sm font-medium">
                                <span className="text-zinc-500">Sentinel</span>
                                <span className="text-zinc-600">/</span>
                                <span className="text-zinc-200 font-semibold">
                                    {activeNav === 'dashboard' ? 'Dashboard' : activeNav === 'netcut' ? 'NetCut Targets' : activeNav === 'gateway' ? 'Smart Gateway' : activeNav === 'arsenal' ? 'Security Arsenal' : activeNav === 'shield' ? 'Sentinel Shield' : activeNav === 'activity' ? 'Aktivitas Langsung' : activeNav === 'documentation' ? 'Dokumentasi' : 'Settings'}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2.5 relative">
                            {/* Wi-Fi Name + AP Isolation Button & Popover */}
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setIsWifiPopoverOpen(prev => !prev)}
                                    className={cn(
                                        "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-mono transition-all outline-none cursor-pointer",
                                        isWifiPopoverOpen
                                            ? "bg-white/[0.08]"
                                            : "hover:bg-white/[0.04]",
                                        isCheckingWifi && "opacity-60"
                                    )}
                                    title={apIsolation?.is_isolated ? `Wi-Fi: ${wifiInfo.ssid || 'Terhubung'} (AP Isolation ${apIsolation.percentage}%)` : "Klik untuk melihat Detail Jaringan & AP Isolation"}
                                >
                                    {wifiInfo.state === 'detecting' ? (
                                        <Radio size={13} className="text-amber-400 shrink-0 animate-pulse" />
                                    ) : wifiInfo.connected ? (
                                        wifiInfo.interface_type === 'ethernet' ? (
                                            <Network size={13} className={apIsolation?.is_isolated ? "text-amber-400 shrink-0" : "text-cyan-400 shrink-0"} />
                                        ) : (
                                            <Wifi size={13} className={cn(
                                                apIsolation?.is_isolated ? "text-amber-400" : "text-emerald-400",
                                                "shrink-0",
                                                isCheckingWifi && "animate-pulse"
                                            )} />
                                        )
                                    ) : (
                                        <WifiOff size={13} className="text-zinc-500 shrink-0" />
                                    )}
                                    <span className={cn(
                                        "truncate max-w-[160px] font-medium transition-colors",
                                        apIsolation?.is_isolated ? "text-amber-400 font-semibold" : "text-zinc-300 hover:text-white"
                                    )}>
                                        {wifiInfo.state === 'detecting'
                                            ? (wifiInfo.ssid ? wifiInfo.ssid : 'Mendeteksi Jaringan…')
                                            : wifiInfo.connected
                                                ? (wifiInfo.ssid || 'Terhubung')
                                                : 'Tidak Ada Jaringan'}
                                    </span>

                                    <ChevronDown size={12} className={cn("transition-transform duration-200 shrink-0", apIsolation?.is_isolated ? "text-amber-400/80" : "text-zinc-400", isWifiPopoverOpen && "rotate-180 text-white")} />
                                </button>

                                <WifiDetailsPopover
                                    isOpen={isWifiPopoverOpen}
                                    onClose={() => setIsWifiPopoverOpen(false)}
                                    wifiInfo={wifiInfo}
                                    apIsolation={apIsolation}
                                    gateway={gateway}
                                    isCheckingWifi={isCheckingWifi}
                                    onRefreshApIsolation={handleRefreshApIsolation}
                                    isRefreshing={isRefreshingApIsolation}
                                />
                            </div>

                            {/* Notification Bell Button & Popover */}
                            <div className="relative">
                                <button
                                    type="button"
                                    data-notification-trigger="true"
                                    onClick={() => {
                                        setIsNotificationOpen(prev => {
                                            const next = !prev;
                                            if (next) {
                                                setActiveToasts([]);
                                            }
                                            return next;
                                        });
                                    }}
                                    className={cn(
                                        "relative size-8 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] flex items-center justify-center text-zinc-400 hover:text-white transition-all outline-none",
                                        isNotificationOpen && "bg-white/[0.1] text-white border-white/[0.2]"
                                    )}
                                    title={isMuted ? "Pusat Notifikasi (Muted - Suara & Pop-up Hening)" : "Pusat Notifikasi (Aktif)"}
                                    aria-label="Buka Notifikasi"
                                >
                                    {isMuted ? <BellOff size={14} className="text-zinc-400" /> : <Bell size={14} />}
                                    {unreadCount > 0 && (
                                        <span className={cn(
                                            "absolute -top-0.5 -right-0.5 size-4 rounded-full text-[9px] font-bold flex items-center justify-center shadow-md",
                                            isMuted
                                                ? "bg-zinc-700 text-zinc-300 border border-zinc-600 shadow-none"
                                                : "bg-emerald-500 text-black shadow-emerald-500/40"
                                        )}>
                                            {unreadCount > 9 ? '9+' : unreadCount}
                                        </span>
                                    )}
                                </button>

                                <NotificationPopover
                                    isOpen={isNotificationOpen}
                                    onClose={() => setIsNotificationOpen(false)}
                                    notifications={notificationHistory}
                                    isMuted={isMuted}
                                    onToggleMute={handleToggleMute}
                                    onMarkAllRead={handleMarkAllRead}
                                    onClearAll={handleClearAllNotifications}
                                    onBlockDevice={handleToggleInternet}
                                    onInspectDevice={(ip) => setSelectedInspectorIp(ip)}
                                />
                            </div>

                            {/* Theme Toggle Button (Day Mode / Night Mode) */}
                            <button
                                type="button"
                                onClick={handleToggleTheme}
                                className="size-8 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] flex items-center justify-center text-zinc-400 hover:text-white transition-all outline-none cursor-pointer"
                                title={theme === 'dark' ? "Beralih ke Day Mode (White Mode)" : "Beralih ke Dark Mode (Night Mode)"}
                                aria-label="Ganti Tema Tampilan"
                            >
                                {theme === 'dark' ? (
                                    <Sun size={14} className="text-zinc-400 hover:text-amber-400 transition-colors" />
                                ) : (
                                    <Moon size={14} className="text-zinc-400 hover:text-cyan-400 transition-colors" />
                                )}
                            </button>
                        </div>
                    </header>

                    {/* Scrollable Main Content Viewport */}
                    <main className="flex-1 w-full min-w-0 overflow-y-auto px-6 lg:px-8 py-6 box-border overscroll-y-contain">
                        {activeNav === 'dashboard' ? (
                            <DashboardWelcomeView
                                authStatus={authStatus}
                                gateway={gateway}
                                totalHosts={stats.total}
                                blockedHosts={stats.blockedCount}
                                throttledHosts={stats.throttledCount}
                                shieldStatus={shieldStatus}
                                shieldThreatsCount={shieldThreats.length}
                                onOpenNetCut={() => setActiveNav('netcut')}
                                onOpenGateway={() => setActiveNav('gateway')}
                                onOpenShield={() => setActiveNav('shield')}
                                onOpenArsenal={() => setActiveNav('arsenal')}
                            />
                                                ) : activeNav === 'gaming' ? (
                            <GamingModeWidget
                                status={gamingStatus}
                                telemetry={gamingTelemetry}
                                devices={devices}
                                onToggle={toggleGamingMode}
                            />
                        ) : (activeNav === 'shield' || activeNav === 'settings') ? (
                            <SettingsView
                                devices={devices}
                                gateway={gateway}
                                shieldStatus={shieldStatus}
                                threats={shieldThreats}
                                onToggleShield={toggleShield}
                                onChangeMode={setShieldMode}
                                onClearThreats={clearShieldThreats}
                                onRefresh={refreshShield}
                            />
                        ) : activeNav === 'activity' ? (
                            <ActivityLogView events={activityLog} onClear={clearActivityLog} />
                        ) : activeNav === 'documentation' ? (
                            <DocumentationView
                                onNavigate={(nav) => setActiveNav(nav as any)}
                                onTriggerScan={() => scan()}
                            />
                        ) : activeNav === 'gateway' ? (
                            <TransparentGatewayView
                                devices={devices}
                                gateway={gateway}
                                gatewayStatus={gatewayStatus}
                                dnsLogs={gatewayDnsLogs}
                                l7Flows={l7Flows}
                                caStatus={caStatus}
                                onClearL7Flows={clearL7Flows}
                                telemetry={telemetry}
                                onStartGateway={startTransparentGateway}
                                onStopGateway={stopTransparentGateway}
                                onAddSinkhole={addSinkholeDomain}
                                onRemoveSinkhole={removeSinkholeDomain}
                                onClearLogs={clearGatewayDnsLogs}
                            />
                        ) : activeNav === 'arsenal' ? (
                            <BettercapArsenalView
                                devices={devices}
                                gateway={gateway}
                                dnsRules={bettercapDnsRules}
                                dnsSpoofAll={dnsSpoofAll}
                                dnsTtl={dnsTtl}
                                credentials={sniffedCredentials}
                                bettercapStatus={bettercapStatus}
                                onAddDnsRule={addBettercapDnsRule}
                                onUpdateDnsRule={updateBettercapDnsRule}
                                onDeleteDnsRule={deleteBettercapDnsRule}
                                onSetSpoofAll={setBettercapDnsSpoofAll}
                                onLoadHosts={loadBettercapDnsHosts}
                                onSetTtl={setBettercapDnsTtl}
                                onClearCredentials={clearBettercapCredentials}
                                onRunSynScan={runBettercapSynScan}
                            />
                        ) : (
                            <>
                                {/* Auto-Reblock Toast Banner (PostgreSQL Persistent Trap Event) */}
                                <AnimatePresence>
                                    {autoReblockedEvent && (
                            <motion.div
                                initial={{ opacity: 0, y: -15, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -15, scale: 0.98 }}
                                className="flex items-center justify-between p-3.5 mb-6 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs shadow-lg"
                            >
                                <div className="flex items-center gap-3">
                                    <Zap size={16} className="text-amber-400 shrink-0" />
                                    <div>
                                        <strong className="font-semibold text-white">Auto-Reblock Engaged:</strong> Target{' '}
                                        <span className="font-mono text-amber-200 font-medium">
                                            {autoReblockedEvent.hostname || autoReblockedEvent.ip}
                                        </span>{' '}
                                        ({autoReblockedEvent.mac}) reconnected to LAN at{' '}
                                        <span className="font-mono text-amber-200 font-medium">{autoReblockedEvent.ip}</span> and was immediately cut off!
                                    </div>
                                </div>
                                <button onClick={clearAutoReblocked} className="p-1 rounded hover:bg-amber-500/20 text-amber-400 hover:text-white transition-colors">
                                    <X size={15} />
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Rogue DHCP Server Security Alert Banner */}
                    <AnimatePresence>
                        {rogueDhcpAlert && (
                            <motion.div
                                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                                className="flex items-center justify-between p-4 mb-6 rounded-2xl bg-gradient-to-r from-red-950/80 via-red-900/40 to-black/80 border border-red-500/40 text-red-200 text-xs shadow-2xl backdrop-blur-md"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="w-9 h-9 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0 text-red-400 animate-pulse">
                                        <AlertTriangle size={18} />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-red-300 uppercase tracking-wider text-[11px]">⚠️ Rogue DHCP Server Terdeteksi!</span>
                                            <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-mono text-[10px] border border-red-500/30">
                                                IP: {rogueDhcpAlert.server_ip}
                                            </span>
                                        </div>
                                        <p className="text-zinc-400 text-[11px]">
                                            Server DHCP liar ber-MAC <span className="font-mono text-zinc-300">{rogueDhcpAlert.server_mac}</span> terdeteksi membagikan IP tanpa izin di jaringan Wi-Fi ini.
                                        </p>
                                    </div>
                                </div>
                                <button 
                                    onClick={clearRogueDhcpAlert} 
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                                    title="Tutup Peringatan"
                                >
                                    <X size={16} />
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Sentinel Shield ARP Attack Security Alert Banner */}
                    <AnimatePresence>
                        {shieldThreatAlert && (
                            <motion.div
                                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                                className="flex items-center justify-between p-4 mb-6 rounded-2xl bg-gradient-to-r from-red-950/90 via-red-900/50 to-black/90 border border-red-500/50 text-red-200 text-xs shadow-2xl backdrop-blur-md"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="w-9 h-9 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center shrink-0 text-red-400 animate-bounce">
                                        <ShieldAlert size={20} />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-red-300 uppercase tracking-wider text-[11px]">🛡️ Serangan NetCut / ARP Spoofing Terdeteksi!</span>
                                            <span className="px-2 py-0.5 rounded-full bg-red-500/25 text-red-300 font-mono text-[10px] border border-red-500/40 font-bold">
                                                Penyerang: {shieldThreatAlert.attacker_mac}
                                            </span>
                                        </div>
                                        <p className="text-zinc-300 text-[11px]">
                                            Perangkat asing mencoba memalsukan Gateway <span className="font-mono text-white font-semibold">{shieldThreatAlert.claimed_ip}</span>. Sentinel Shield telah menetralkan paket racun tersebut.
                                        </p>
                                    </div>
                                </div>
                                <button 
                                    onClick={clearShieldThreatAlert} 
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                                    title="Tutup Peringatan"
                                >
                                    <X size={16} />
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* BeUI Segment Tabs Filter Bar with Search on the Right */}
                    <div className="flex items-center justify-between w-full mb-6 gap-4 flex-wrap">
                        <Tabs
                            value={activeTab}
                            onValueChange={(val) => setActiveTab(val as FilterTab)}
                            variant="segment"
                        >
                            <TabsList>
                                <TabsTrigger value="all">
                                    <span>All Hosts</span>
                                    {stats.total > 0 && (
                                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.06] border border-white/[0.08] text-zinc-300">
                                            {stats.total}
                                        </span>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="online">
                                    <span>Online</span>
                                    {stats.onlineUnblocked > 0 && (
                                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.06] border border-white/[0.08] text-zinc-300">
                                            {stats.onlineUnblocked}
                                        </span>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="throttled">
                                    <span>Dibatasi</span>
                                    {stats.throttledCount > 0 && (
                                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.06] border border-white/[0.08] text-zinc-300">
                                            {stats.throttledCount}
                                        </span>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="blocked">
                                    <span>Blocked</span>
                                    {stats.blockedCount > 0 && (
                                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.06] border border-white/[0.08] text-zinc-300">
                                            {stats.blockedCount}
                                        </span>
                                    )}
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>

                        <div className={cn(
                            "relative transition-all duration-300 ease-out",
                            isSearchFocused ? "w-full sm:w-[360px]" : "w-full sm:w-[260px]"
                        )}>
                            <Search size={15} className={cn(
                                "absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors pointer-events-none",
                                isSearchFocused ? "text-white" : "text-zinc-500"
                            )} />
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search Hostname, IP, MAC..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => setIsSearchFocused(true)}
                                onBlur={() => setIsSearchFocused(false)}
                                className={cn(
                                    "w-full rounded-xl pl-9 pr-8 py-2 text-xs font-sans transition-all outline-none border",
                                    isSearchFocused 
                                        ? "bg-white/[0.07] border-white/[0.28] text-white shadow-lg ring-2 ring-white/[0.06]" 
                                        : "bg-white/[0.035] border-white/[0.09] text-zinc-300 hover:border-white/[0.15]"
                                )}
                            />
                            {searchQuery ? (
                                <button 
                                    onClick={() => setSearchQuery('')} 
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-500 hover:text-white transition-colors" 
                                    title="Hapus Pencarian"
                                >
                                    <X size={13} />
                                </button>
                            ) : (
                                <span className="hidden sm:inline absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-500 bg-white/[0.05] border border-white/[0.1] px-1.5 py-0.5 rounded pointer-events-none" title="Tekan / untuk mencari">
                                    /
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Connected Devices Card Table & Parallel Security Telemetry Sidebar with BeUI Scroll Reveal */}
                    <ScrollReveal y={20} blur={8} duration={0.6} className="w-full">
                        <div className="flex flex-col xl:flex-row items-start gap-5 w-full">
                            {/* Left: Connected Devices Card Table with White Border on Scan */}
                            <div className={cn(
                                "flex-1 min-w-0 w-full bg-[#090a0c] rounded-2xl overflow-visible shadow-2xl relative transition-all duration-300 border",
                                isScanning
                                    ? "border-white/40 ring-1 ring-white/15"
                                    : "border-white/[0.08]"
                            )}>
                                <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between gap-4 flex-wrap relative z-30">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2.5">
                                            <h2 className="text-base font-semibold text-white tracking-tight">Connected Devices</h2>
                                            {selectedCount > 0 && (
                                                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-white/[0.08] text-white border border-white/[0.1]">
                                                    {selectedCount} selected
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-zinc-400 font-normal leading-relaxed">
                                            Kelola hak akses, pantau status koneksi, dan lindungi integritas seluruh perangkat LAN Anda.
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2.5 flex-wrap">
                                        <AnimatePresence>
                                            {isScanning && (
                                                <motion.div
                                                    key="scanning-progress"
                                                    initial={{ opacity: 0, scale: 0.95 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                    transition={{ duration: 0.2 }}
                                                >
                                                    <AgentScanProgress />
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        <div className="flex items-center gap-2">
                                            {/* Block & Restore buttons (Hanya muncul saat mode Pilih Perangkat aktif) */}
                                            <AnimatePresence>
                                                {isSelectMode && (
                                                    <motion.div
                                                        key="batch-actions"
                                                        initial={{ opacity: 0, x: 10, scale: 0.95 }}
                                                        animate={{ opacity: 1, x: 0, scale: 1 }}
                                                        exit={{ opacity: 0, x: 10, scale: 0.95 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="flex items-center gap-2"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={handleBlockSelected}
                                                            disabled={unblockedSelectedCount === 0 || isScanning}
                                                            className={cn(
                                                                "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all border outline-none",
                                                                unblockedSelectedCount > 0 && !isScanning
                                                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-500/40 shadow-sm shadow-rose-500/10"
                                                                    : "bg-white/[0.02] text-zinc-600 border-white/[0.05] cursor-not-allowed opacity-40"
                                                            )}
                                                            title={unblockedSelectedCount === 0 ? "Tidak ada perangkat aktif yang dapat diblokir" : `Putus akses internet untuk ${unblockedSelectedCount} perangkat`}
                                                        >
                                                            Block ({unblockedSelectedCount})
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={handleRestoreSelected}
                                                            disabled={blockedSelectedCount === 0 || isScanning}
                                                            className={cn(
                                                                "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all border outline-none",
                                                                blockedSelectedCount > 0 && !isScanning
                                                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-500/40 shadow-sm shadow-emerald-500/10"
                                                                    : "bg-white/[0.02] text-zinc-600 border-white/[0.05] cursor-not-allowed opacity-40"
                                                            )}
                                                            title={blockedSelectedCount === 0 ? "Tidak ada perangkat terblokir yang dapat dipulihkan" : `Pulihkan akses internet untuk ${blockedSelectedCount} perangkat`}
                                                        >
                                                            Restore ({blockedSelectedCount})
                                                        </button>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            {/* Tombol Pilih Perangkat / Batal Pilih (Otomatis tersembunyi saat sedang scan) */}
                                            <AnimatePresence>
                                                {!isScanning && (
                                                    <motion.button
                                                        key="select-mode-button"
                                                        initial={{ opacity: 0, scale: 0.95 }}
                                                        animate={{ opacity: 1, scale: 1 }}
                                                        exit={{ opacity: 0, scale: 0.95 }}
                                                        transition={{ duration: 0.2 }}
                                                        type="button"
                                                        onClick={() => {
                                                            setIsSelectMode(prev => {
                                                                if (prev) {
                                                                    setSelectedIps([]);
                                                                }
                                                                return !prev;
                                                            });
                                                        }}
                                                        className={cn(
                                                            "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all border outline-none flex items-center gap-1.5",
                                                            isSelectMode
                                                                ? "bg-white/[0.12] text-white border-white/[0.25] shadow-sm"
                                                                : "bg-white/[0.04] text-zinc-300 border-white/[0.08] hover:bg-white/[0.08] hover:text-white"
                                                        )}
                                                        title={isSelectMode ? "Selesai memilih perangkat" : "Pilih perangkat untuk aksi massal"}
                                                    >
                                                        {isSelectMode ? (
                                                            <>
                                                                <X size={13} className="text-zinc-400" />
                                                                <span>Batal Pilih</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <CheckSquare size={13} className="text-zinc-400" />
                                                                <span>Pilih Perangkat</span>
                                                            </>
                                                        )}
                                                    </motion.button>
                                                )}
                                            </AnimatePresence>

                                            <AnimatePresence>
                                                {!isScanning && (
                                                    <motion.div
                                                        key="scan-select-dropdown"
                                                        initial={{ opacity: 0, scale: 0.95 }}
                                                        animate={{ opacity: 1, scale: 1 }}
                                                        exit={{ opacity: 0, scale: 0.95 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="relative z-50"
                                                    >
                                                        <Select
                                                            value={scanMode}
                                                            onValueChange={(val) => {
                                                                if (val === 'normal') {
                                                                    setScanMode('normal');
                                                                    setIsTableCollapsed(false);
                                                                    scan();
                                                                } else if (val === 'opt_3b') {
                                                                    setIsDhcpModalOpen(true);
                                                                } else if (val === 'auto') {
                                                                    setScanMode('auto');
                                                                } else if (val === 'super') {
                                                                    setScanMode('super');
                                                                }
                                                            }}
                                                        >
                                                            <SelectTrigger
                                                                className={cn(
                                                                    "h-8 px-3 py-0 text-xs font-medium transition-all rounded-lg outline-none flex items-center gap-2",
                                                                    scanMode === 'auto' && "auto-scan-beam-active border-cyan-500/40 bg-cyan-500/10 text-cyan-200 shadow-sm shadow-cyan-500/10",
                                                                    scanMode === 'super' && "super-scan-beam-active border-amber-500/50 bg-gradient-to-r from-amber-500/15 via-purple-500/15 to-amber-500/15 text-amber-200 shadow-md shadow-amber-500/10",
                                                                    scanMode === 'normal' && "border-white/[0.15] bg-white/[0.08] hover:bg-white/[0.14] text-white"
                                                                )}
                                                            >
                                                                <div className="flex items-center gap-1.5 min-w-0">
                                                                    {scanMode === 'auto' && <Activity size={13} className="text-cyan-400 animate-pulse shrink-0" />}
                                                                    {scanMode === 'super' && <Sparkles size={13} className="text-amber-400 shrink-0" />}
                                                                    {scanMode === 'normal' && <Radar size={13} className="text-zinc-300 shrink-0" />}
                                                                    <span className="font-medium truncate">
                                                                        {scanMode === 'auto' ? 'Auto Scan' : scanMode === 'super' ? 'Super Scan' : 'Scan Biasa'}
                                                                    </span>
                                                                </div>
                                                            </SelectTrigger>
                                                            <SelectContent className="w-64 right-0 left-auto bg-[#12141a] border-white/[0.12] p-1.5 shadow-2xl rounded-xl">
                                                                <SelectItem value="normal" label="Scan Biasa" className="py-2">
                                                                    <div className="flex items-start gap-2.5">
                                                                        <Radar size={14} className="text-zinc-400 mt-0.5 shrink-0" />
                                                                        <div className="flex flex-col min-w-0 text-left">
                                                                            <span className="font-medium text-white text-xs">Scan Biasa</span>
                                                                            <span className="text-[10px] text-zinc-500 font-normal leading-tight">Sapuan cepat manual L2 ARP & ICMP</span>
                                                                        </div>
                                                                    </div>
                                                                </SelectItem>

                                                                <SelectItem value="opt_3b" label="Optimasi Teknik 3B" className="py-2">
                                                                    <div className="flex items-start gap-2.5">
                                                                        <Sparkles size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                                                                        <div className="flex flex-col min-w-0 text-left">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <span className="font-medium text-emerald-300 text-xs">Optimasi Teknik 3B</span>
                                                                                {dhcpUnprofiledCount > 0 ? (
                                                                                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 py-0.2 rounded font-mono">
                                                                                        {dhcpUnprofiledCount} Butuh Profil
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 py-0.2 rounded font-mono">POPULER</span>
                                                                                )}
                                                                            </div>
                                                                            <span className="text-[10px] text-zinc-500 font-normal leading-tight">Membuka dialog profiling DHCP & hostname</span>
                                                                        </div>
                                                                    </div>
                                                                </SelectItem>

                                                                <SelectItem value="auto" label="Auto Scan" className="py-2">
                                                                    <div className="flex items-start gap-2.5">
                                                                        <Activity size={14} className="text-cyan-400 mt-0.5 shrink-0" />
                                                                        <div className="flex flex-col min-w-0 text-left">
                                                                            <span className="font-medium text-cyan-300 text-xs">Auto Scan (Background)</span>
                                                                            <span className="text-[10px] text-zinc-500 font-normal leading-tight">Monitor otomatis tiap 10 detik di background</span>
                                                                        </div>
                                                                    </div>
                                                                </SelectItem>

                                                                <SelectItem value="super" label="Super Scan" className="py-2">
                                                                    <div className="flex items-start gap-2.5">
                                                                        <ShieldAlert size={14} className="text-amber-400 mt-0.5 shrink-0" />
                                                                        <div className="flex flex-col min-w-0 text-left">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <span className="font-medium text-amber-300 text-xs">Super Scan (Zero-Trust)</span>
                                                                                <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded font-mono">SEGERA</span>
                                                                            </div>
                                                                            <span className="text-[10px] text-zinc-500 font-normal leading-tight">Karantina otomatis pengguna baru asing</span>
                                                                        </div>
                                                                    </div>
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            {/* Tombol Collapse / Expand Table (Tanpa bubble, warna netral konsisten) */}
                                            <button
                                                type="button"
                                                onClick={() => setIsTableCollapsed(prev => !prev)}
                                                className="size-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors outline-none cursor-pointer"
                                                title={isTableCollapsed ? "Buka tabel perangkat" : "Tutup tabel perangkat"}
                                                aria-label={isTableCollapsed ? "Buka tabel perangkat" : "Tutup tabel perangkat"}
                                            >
                                                <ChevronDown
                                                    size={16}
                                                    className={cn(
                                                        "transition-transform duration-250 ease-out",
                                                        isTableCollapsed ? "-rotate-90 text-zinc-500" : "rotate-0 text-zinc-300"
                                                    )}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Collapsible Table Viewport */}
                                <AnimatePresence initial={false}>
                                    {!isTableCollapsed && (
                                        <motion.div
                                            key="device-table-collapsible"
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                                            className="overflow-hidden"
                                        >
                                            <DeviceTable
                                                devices={filteredDevices}
                                                selectedIps={selectedIps}
                                                isSelectMode={isSelectMode}
                                                activeInspectorIp={selectedInspectorIp || undefined}
                                                onSelectForInspect={(ip) => setSelectedInspectorIp(prev => (prev === ip ? null : ip))}
                                                onToggleSelect={handleToggleSelect}
                                                onToggleSelectAll={handleToggleSelectAll}
                                                onToggleInternet={handleToggleInternet}
                                                onUpdateAlias={updateAlias}
                                                onDeleteDevice={deleteDevice}
                                                onOpenRedirectModal={setRedirectModalDevice}
                                                loadingIps={loadingIps}
                                                authStatus={authStatus}
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Right: Security & Telemetry Sidebar with Bouncy Accordion (Only visible when device is selected) */}
                            <AnimatePresence mode="wait">
                                {inspectorDevice && (
                                    <motion.div
                                        key={inspectorDevice.ip}
                                        initial={{ opacity: 0, x: 24, scale: 0.98 }}
                                        animate={{ opacity: 1, x: 0, scale: 1 }}
                                        exit={{ opacity: 0, x: 24, scale: 0.98 }}
                                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                                        className="w-full xl:w-[320px] shrink-0"
                                    >
                                        <SecurityTelemetrySidebar
                                            device={inspectorDevice}
                                            onClose={handleCloseInspector}
                                            onSetSpeedLimit={setSpeedLimit}
                                            onUpdateAlias={updateAlias}
                                            onToggleInternet={handleToggleInternet}
                                            onDeleteDevice={deleteDevice}
                                            onOpenRedirectModal={setRedirectModalDevice}
                                            onRefresh={scan}
                                            isRefreshing={isScanning}
                                            isLoading={loadingIps.has(inspectorDevice.ip)}
                                            authStatus={authStatus}
                                            telemetry={telemetry}
                                            onOpenUpgradeModal={(reason) => setUpgradeModalState({ isOpen: true, reason })}
                                        />
                                    </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Open Ports & Services Explorer Table */}
                            <OpenPortsTable
                                devices={devices}
                                selectedInspectorIp={selectedInspectorIp}
                                onSelectDevice={(ip) => setSelectedInspectorIp(prev => (prev === ip ? null : ip))}
                                onOpenDeepScan={(targetIp) => {
                                    const dev = targetIp ? devices.find(d => d.ip === targetIp) || null : (inspectorDevice || devices[0] || null);
                                    setDeepScanTargetDevice(dev);
                                    setIsDeepScanModalOpen(true);
                                }}
                                onOpenWebPreview={(dev, port) => {
                                    setWebPreviewState({ isOpen: true, device: dev, port });
                                }}
                            />
                        </ScrollReveal>
                        </>
                    )}
                </main>
                </div>
            </div>

            {/* Deep Custom Port Scanner Modal */}
            <DeepPortScanModal
                isOpen={isDeepScanModalOpen}
                device={deepScanTargetDevice}
                devices={devices}
                onClose={() => setIsDeepScanModalOpen(false)}
                onOpenWebPreview={(dev, port) => {
                    setWebPreviewState({ isOpen: true, device: dev, port });
                }}
            />

            {/* In-App Live Web Iframe Preview Modal */}
            <WebPreviewModal
                isOpen={webPreviewState.isOpen}
                device={webPreviewState.device}
                port={webPreviewState.port}
                onClose={() => setWebPreviewState(prev => ({ ...prev, isOpen: false }))}
            />

            {/* Instagram Walled Garden Redirect Modal */}
            <InstagramRedirectModal
                device={redirectModalDevice}
                isOpen={!!redirectModalDevice}
                onClose={() => setRedirectModalDevice(null)}
                onStartRedirect={handleStartRedirect}
                onStopRedirect={handleStopRedirect}
            />

            {/* Teknik 3B (DHCP Profiling & Reconnect) Optimization Modal */}
            <DhcpReconnectModal
                isOpen={isDhcpModalOpen}
                devices={devices}
                onClose={() => setIsDhcpModalOpen(false)}
                onTriggerReScan={() => scan()}
                onQuickReauth={quickReauth}
            />

            {/* In-App Floating Toast Notification Stack (Bottom-Right, Suppressed if Muted or Popover Open) */}
            {!isMuted && !isNotificationOpen && activeToasts.length > 0 && (
                <div className="fixed bottom-6 right-6 z-50 flex flex-col-reverse gap-2 w-[320px] pointer-events-none">
                    {activeToasts.length > 1 && (
                        <div className="flex justify-end pointer-events-auto mb-0.5">
                            <button
                                type="button"
                                onClick={() => setActiveToasts([])}
                                className="px-2 py-0.5 rounded text-[10px] font-mono text-zinc-400 hover:text-white bg-[#14151a] hover:bg-[#1c1e24] border border-white/[0.08] shadow-[0_4px_12px_rgba(0,0,0,0.5)] transition-colors cursor-pointer"
                                title="Tutup semua notifikasi"
                            >
                                Tutup Semua ({activeToasts.length})
                            </button>
                        </div>
                    )}
                    <AnimatePresence mode="popLayout">
                        {activeToasts.map((toast) => (
                            <motion.div
                                key={toast.id}
                                layout
                                initial={{ opacity: 0, y: 32, scale: 0.94 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -20, scale: 0.92 }}
                                transition={{
                                    type: 'spring',
                                    stiffness: 420,
                                    damping: 28,
                                    mass: 0.8
                                }}
                                className="pointer-events-auto w-full"
                            >
                                {toast.type === 'error' ? (
                                    <ActionErrorToast
                                        message={toast.message || 'Terjadi kesalahan sistem'}
                                        title={toast.title}
                                        onDismiss={() => {
                                            setActiveToasts(prev => prev.filter(t => t.id !== toast.id));
                                            clearError();
                                        }}
                                    />
                                ) : toast.type === 'disconnected' && toast.device ? (
                                    <DisconnectedDeviceToast
                                        device={toast.device}
                                        onDismiss={() => setActiveToasts(prev => prev.filter(t => t.id !== toast.id))}
                                    />
                                ) : toast.type === 'reconnected' && toast.device ? (
                                    <OnlineDeviceToast
                                        device={toast.device}
                                        onInspect={(dev) => setSelectedInspectorIp(dev.ip)}
                                        onDismiss={() => setActiveToasts(prev => prev.filter(t => t.id !== toast.id))}
                                    />
                                ) : toast.device ? (
                                    <NewDeviceToast
                                        device={toast.device}
                                        toastType="new_device"
                                        onBlock={handleToggleInternet}
                                        onInspect={(dev) => setSelectedInspectorIp(dev.ip)}
                                        onDismiss={() => setActiveToasts(prev => prev.filter(t => t.id !== toast.id))}
                                    />
                                ) : null}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}

            {/* Cloud Auth & Licensing Modals */}
            <LoginModal
                isOpen={isLoginModalOpen}
                onClose={() => setIsLoginModalOpen(false)}
                authStatus={authStatus}
                onLogin={authLogin}
                onActivateKey={activateLicenseKey}
                onLogout={authLogout}
            />

            <UpgradeProModal
                isOpen={upgradeModalState.isOpen}
                reason={upgradeModalState.reason}
                onClose={() => setUpgradeModalState({ isOpen: false })}
                onOpenLoginModal={() => {
                    setUpgradeModalState({ isOpen: false });
                    setIsLoginModalOpen(true);
                }}
            />

            {/* BeUI-Inspired Command Palette (⌘K) */}
            <CommandPalette
                isOpen={isCommandPaletteOpen}
                onClose={() => setIsCommandPaletteOpen(false)}
                items={commandPaletteItems}
            />
        </AnimatedSidebarProvider>
    );
}

export default App;
