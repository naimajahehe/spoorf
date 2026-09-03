import { useState, useMemo } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Globe,
    AlertTriangle,
    Check,
    Copy,
    ExternalLink,
    ChevronDown,
    Radio,
    Laptop,
    Smartphone,
    Cpu,
    Video,
    Server,
    Terminal,
    Zap,
    Eye
} from 'lucide-react';
import { Device } from '../types';
import { cn } from '../lib/utils';

export interface PortServiceInfo {
    port: number;
    protocol: 'TCP' | 'UDP';
    name: string;
    category: 'web' | 'media' | 'remote' | 'risk' | 'other';
    riskLevel: 'safe' | 'warning' | 'danger';
    riskLabel: string;
    isWeb: boolean;
}

const PORT_REGISTRY: Record<number, PortServiceInfo> = {
    80: { port: 80, protocol: 'TCP', name: 'HTTP Web Server', category: 'web', riskLevel: 'safe', riskLabel: 'Standar', isWeb: true },
    443: { port: 443, protocol: 'TCP', name: 'HTTPS Secure Web', category: 'web', riskLevel: 'safe', riskLabel: 'Aman', isWeb: true },
    8080: { port: 8080, protocol: 'TCP', name: 'HTTP-Alt Web Proxy', category: 'web', riskLevel: 'safe', riskLabel: 'Standar', isWeb: true },
    8443: { port: 8443, protocol: 'TCP', name: 'HTTPS-Alt Web Admin', category: 'web', riskLevel: 'safe', riskLabel: 'Aman', isWeb: true },
    8000: { port: 8000, protocol: 'TCP', name: 'HTTP Dev / Web Service', category: 'web', riskLevel: 'safe', riskLabel: 'Standar', isWeb: true },
    5000: { port: 5000, protocol: 'TCP', name: 'UPnP / Web Service', category: 'media', riskLevel: 'safe', riskLabel: 'Standar', isWeb: true },
    3000: { port: 3000, protocol: 'TCP', name: 'Node.js Web App', category: 'web', riskLevel: 'safe', riskLabel: 'Standar', isWeb: true },
    8888: { port: 8888, protocol: 'TCP', name: 'Web Dashboard / Proxy', category: 'web', riskLevel: 'safe', riskLabel: 'Standar', isWeb: true },
    9000: { port: 9000, protocol: 'TCP', name: 'Portainer / Admin UI', category: 'web', riskLevel: 'safe', riskLabel: 'Standar', isWeb: true },
    9090: { port: 9090, protocol: 'TCP', name: 'Cockpit / Web Console', category: 'web', riskLevel: 'safe', riskLabel: 'Standar', isWeb: true },
    
    53: { port: 53, protocol: 'UDP', name: 'DNS Resolver', category: 'other', riskLevel: 'safe', riskLabel: 'Standar', isWeb: false },
    22: { port: 22, protocol: 'TCP', name: 'SSH Secure Shell', category: 'remote', riskLevel: 'safe', riskLabel: 'Terenkripsi', isWeb: false },
    21: { port: 21, protocol: 'TCP', name: 'FTP File Transfer', category: 'risk', riskLevel: 'danger', riskLabel: 'Plaintext', isWeb: false },
    23: { port: 23, protocol: 'TCP', name: 'Telnet Remote Terminal', category: 'risk', riskLevel: 'danger', riskLabel: 'Rentan / Kuno', isWeb: false },
    3389: { port: 3389, protocol: 'TCP', name: 'RDP Windows Desktop', category: 'remote', riskLevel: 'warning', riskLabel: 'Akses Jarak Jauh', isWeb: false },
    5900: { port: 5900, protocol: 'TCP', name: 'VNC Remote Display', category: 'remote', riskLevel: 'warning', riskLabel: 'Screen Sharing', isWeb: false },
    445: { port: 445, protocol: 'TCP', name: 'SMB File Sharing', category: 'remote', riskLevel: 'warning', riskLabel: 'File Sharing LAN', isWeb: false },
    139: { port: 139, protocol: 'TCP', name: 'NetBIOS Session', category: 'remote', riskLevel: 'warning', riskLabel: 'Legacy Share', isWeb: false },
    137: { port: 137, protocol: 'UDP', name: 'NetBIOS Name Service', category: 'other', riskLevel: 'safe', riskLabel: 'Standar', isWeb: false },
    
    554: { port: 554, protocol: 'TCP', name: 'RTSP IP Camera Stream', category: 'media', riskLevel: 'warning', riskLabel: 'Video Feed', isWeb: false },
    8554: { port: 8554, protocol: 'TCP', name: 'RTSP-Alt Camera Feed', category: 'media', riskLevel: 'warning', riskLabel: 'Video Feed', isWeb: false },
    1883: { port: 1883, protocol: 'TCP', name: 'MQTT IoT Broker', category: 'media', riskLevel: 'warning', riskLabel: 'IoT Plaintext', isWeb: false },
    8883: { port: 8883, protocol: 'TCP', name: 'MQTT-TLS Secure IoT', category: 'media', riskLevel: 'safe', riskLabel: 'Terenkripsi', isWeb: false },
    8008: { port: 8008, protocol: 'TCP', name: 'Google Cast / Chromecast', category: 'media', riskLevel: 'safe', riskLabel: 'Smart TV', isWeb: true },
    8009: { port: 8009, protocol: 'TCP', name: 'Google Cast V2', category: 'media', riskLevel: 'safe', riskLabel: 'Media Hub', isWeb: false },
    1900: { port: 1900, protocol: 'UDP', name: 'SSDP / UPnP Discovery', category: 'other', riskLevel: 'warning', riskLabel: 'Discovery', isWeb: false },
    5353: { port: 5353, protocol: 'UDP', name: 'mDNS (Bonjour/Avahi)', category: 'other', riskLevel: 'safe', riskLabel: 'Broadcast', isWeb: false },
    9100: { port: 9100, protocol: 'TCP', name: 'RAW Network Printing', category: 'other', riskLevel: 'safe', riskLabel: 'Printer', isWeb: false },
    631: { port: 631, protocol: 'TCP', name: 'IPP / CUPS Printing', category: 'other', riskLevel: 'safe', riskLabel: 'Printer Web', isWeb: true },
    3306: { port: 3306, protocol: 'TCP', name: 'MySQL Database', category: 'other', riskLevel: 'warning', riskLabel: 'Database', isWeb: false },
    5432: { port: 5432, protocol: 'TCP', name: 'PostgreSQL Database', category: 'other', riskLevel: 'warning', riskLabel: 'Database', isWeb: false },
    6379: { port: 6379, protocol: 'TCP', name: 'Redis In-Memory Store', category: 'risk', riskLevel: 'danger', riskLabel: 'Tanpa Sandi?', isWeb: false }
};

interface FlatPortItem {
    id: string;
    port: number;
    protocol: 'TCP' | 'UDP';
    serviceName: string;
    category: 'web' | 'media' | 'remote' | 'risk' | 'other';
    riskLevel: 'safe' | 'warning' | 'danger';
    riskLabel: string;
    isWeb: boolean;
    banner: string;
    device: Device;
}

interface Props {
    devices: Device[];
    selectedInspectorIp?: string | null;
    onSelectDevice?: (ip: string) => void;
    onOpenDeepScan?: (targetIp?: string) => void;
    onOpenWebPreview?: (device: Device, port: number) => void;
}

export const OpenPortsTable: FC<Props> = ({
    devices,
    selectedInspectorIp,
    onSelectDevice,
    onOpenDeepScan,
    onOpenWebPreview
}) => {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const selectedDevice = useMemo(() => {
        if (!selectedInspectorIp) return null;
        return devices.find(d => d.ip === selectedInspectorIp) || null;
    }, [devices, selectedInspectorIp]);

    // Flatten all open ports across devices or for selected target
    const allPortItems = useMemo(() => {
        const targetDevices = selectedDevice ? [selectedDevice] : devices;
        const items: FlatPortItem[] = [];

        targetDevices.forEach(dev => {
            const rawPorts = dev.open_ports;
            let openPorts: number[] = [];
            if (Array.isArray(rawPorts)) {
                openPorts = rawPorts;
            } else if (typeof rawPorts === 'string') {
                try {
                    const parsed = JSON.parse(rawPorts);
                    if (Array.isArray(parsed)) openPorts = parsed;
                } catch {
                    openPorts = [];
                }
            }

            if (!openPorts || openPorts.length === 0) return;

            openPorts.forEach(rawPort => {
                const port = typeof rawPort === 'number' ? rawPort : parseInt(rawPort, 10);
                if (isNaN(port)) return;
                const info = PORT_REGISTRY[port] || {
                    port,
                    protocol: 'TCP',
                    name: `Port ${port}`,
                    category: port === 80 || port === 443 || port === 8080 ? 'web' : 'other',
                    riskLevel: 'safe',
                    riskLabel: 'Standar',
                    isWeb: port === 80 || port === 443 || port === 8080 || port === 8000
                };

                let bannerDetail = '';
                if (dev.web_title && (port === 80 || port === 443 || port === 8080 || port === 8000)) {
                    bannerDetail = dev.web_title;
                } else if (dev.web_server && (port === 80 || port === 443 || port === 8080)) {
                    bannerDetail = `Server: ${dev.web_server}`;
                } else if (dev.workgroup && (port === 445 || port === 139)) {
                    bannerDetail = `Workgroup: ${dev.workgroup}`;
                } else if (dev.vendor) {
                    bannerDetail = `${dev.vendor}`;
                } else {
                    bannerDetail = info.name;
                }

                items.push({
                    id: `${dev.ip}-${port}`,
                    port,
                    protocol: info.protocol,
                    serviceName: info.name,
                    category: info.category,
                    riskLevel: info.riskLevel,
                    riskLabel: info.riskLabel,
                    isWeb: info.isWeb,
                    banner: bannerDetail,
                    device: dev
                });
            });
        });

        return items;
    }, [devices, selectedDevice]);

    const handleCopy = (key: string, text: string, e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1800);
    };

    const getDeviceIcon = (dev: Device) => {
        const os = (dev.os || '').toLowerCase();
        const host = (dev.hostname || dev.alias || '').toLowerCase();
        const vendor = (dev.vendor || '').toLowerCase();

        if (dev.is_gateway) return <Radio size={13} className="text-zinc-300" />;
        if (os.includes('android') || os.includes('ios') || host.includes('phone') || host.includes('galaxy') || host.includes('iphone') || vendor.includes('xiaomi') || vendor.includes('samsung')) {
            return <Smartphone size={13} className="text-zinc-300" />;
        }
        if (os.includes('windows') || os.includes('mac') || os.includes('linux') || host.includes('laptop') || host.includes('desktop') || host.includes('pc')) {
            return <Laptop size={13} className="text-zinc-300" />;
        }
        return <Cpu size={13} className="text-zinc-300" />;
    };

    const getServiceIcon = (category: PortServiceInfo['category'], isWeb: boolean) => {
        if (isWeb) return <Globe size={13} className="text-zinc-300" />;
        switch (category) {
            case 'media':
                return <Video size={13} className="text-zinc-300" />;
            case 'remote':
                return <Terminal size={13} className="text-zinc-300" />;
            case 'risk':
                return <AlertTriangle size={13} className="text-rose-400" />;
            default:
                return <Server size={13} className="text-zinc-300" />;
        }
    };

    return (
        <div className="w-full bg-[#090a0c] rounded-2xl border border-white/[0.08] overflow-hidden shadow-2xl transition-all duration-300 mt-6">
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold text-white tracking-tight">
                        Open Ports & Services
                    </h2>
                    <p className="text-xs text-zinc-400 font-normal leading-relaxed">
                        {selectedDevice
                            ? `Daftar port dan layanan jaringan aktif yang terdeteksi pada target ${selectedDevice.ip}.`
                            : 'Pemetaan seluruh port dan layanan terbuka pada seluruh perangkat yang terhubung ke jaringan LAN.'}
                    </p>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                    {/* Tombol Deep Scan */}
                    {onOpenDeepScan && (
                        <button
                            type="button"
                            onClick={() => onOpenDeepScan(selectedInspectorIp || undefined)}
                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.15] text-white flex items-center gap-1.5 transition-all shadow-sm outline-none"
                            title="Buka pemindaian port mendalam kustom"
                        >
                            <Zap size={12} className="text-emerald-400" />
                            <span>Deep Scan</span>
                        </button>
                    )}

                    {/* Collapsible Chevron Button (Without bubble, consistent neutral color) */}
                    <button
                        type="button"
                        onClick={() => setIsCollapsed(prev => !prev)}
                        className="size-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors outline-none cursor-pointer"
                        title={isCollapsed ? "Buka tabel port" : "Tutup tabel port"}
                        aria-label={isCollapsed ? "Buka tabel port" : "Tutup tabel port"}
                    >
                        <ChevronDown
                            size={16}
                            className={cn(
                                "transition-transform duration-250 ease-out",
                                isCollapsed ? "-rotate-90 text-zinc-500" : "rotate-0 text-zinc-300"
                            )}
                        />
                    </button>
                </div>
            </div>

            {/* Collapsible Table Content */}
            <AnimatePresence initial={false}>
                {!isCollapsed && (
                    <motion.div
                        key="ports-table-collapsible"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                    >
                        <div className="w-full overflow-x-auto relative max-h-[420px]">
                            <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 bg-[#090a0c]/95 backdrop-blur z-20 shadow-sm shadow-black/40">
                                    <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-zinc-400 h-[40px]">
                                        <th className="h-[40px] py-0 px-4">Perangkat</th>
                                        <th className="h-[40px] py-0 px-4 text-center">Port</th>
                                        <th className="h-[40px] py-0 px-4">Layanan</th>
                                        <th className="h-[40px] py-0 px-4">Detail / Banner</th>
                                        <th className="h-[40px] py-0 px-4 text-center">Risiko</th>
                                        <th className="h-[40px] py-0 px-4 text-center">Aksi</th>
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-white/[0.04]">
                                    {allPortItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-12 text-center text-zinc-500">
                                                <div className="flex flex-col items-center justify-center gap-1.5">
                                                    <p className="text-xs font-medium text-zinc-300">
                                                        Tidak Ada Port Terbuka Terdeteksi
                                                    </p>
                                                    <p className="text-[11px] text-zinc-600">
                                                        Lakukan scan ulang atau gunakan Deep Scan untuk memindai port perangkat.
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        allPortItems.map((item) => {
                                            const devName = item.device.alias && item.device.alias.trim() !== ''
                                                ? item.device.alias.trim()
                                                : (item.device.hostname && item.device.hostname.trim() !== '' ? item.device.hostname : item.device.ip);
                                            const protocol = item.port === 443 || item.port === 8443 ? 'https' : 'http';
                                            const webUrl = `${protocol}://${item.device.ip}:${item.port}`;

                                            return (
                                                <tr
                                                    key={item.id}
                                                    className="group transition-colors hover:bg-white/[0.02] h-[50px]"
                                                >
                                                    {/* Column 1: Perangkat */}
                                                    <td className="h-[50px] py-0 px-4">
                                                        <div
                                                            className="flex items-center gap-2 cursor-pointer group-hover:text-white"
                                                            onClick={() => onSelectDevice && onSelectDevice(item.device.ip)}
                                                            title={`Pilih ${devName}`}
                                                        >
                                                            <div className="size-6 rounded bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-300 shrink-0">
                                                                {getDeviceIcon(item.device)}
                                                            </div>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="text-xs font-semibold text-white truncate max-w-[160px]">
                                                                    {devName}
                                                                </span>
                                                                <span className="text-[10px] font-mono text-zinc-500 truncate">
                                                                    {item.device.ip}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>

                                                    {/* Column 2: Port & Protocol (Centered) */}
                                                    <td className="h-[50px] py-0 px-4 text-center">
                                                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-xs font-semibold bg-white/[0.04] border border-white/[0.08] text-white">
                                                            <span>{item.port}</span>
                                                            <span className="text-[10px] text-zinc-400 font-normal">/{item.protocol}</span>
                                                        </div>
                                                    </td>

                                                    {/* Column 3: Layanan */}
                                                    <td className="h-[50px] py-0 px-4">
                                                        <div className="flex items-center gap-1.5">
                                                            {getServiceIcon(item.category, item.isWeb)}
                                                            <span className="text-xs font-medium text-zinc-200">
                                                                {item.serviceName}
                                                            </span>
                                                        </div>
                                                    </td>

                                                    {/* Column 4: Detail / Banner */}
                                                    <td className="h-[50px] py-0 px-4">
                                                        <span className="text-xs text-zinc-400 truncate block max-w-[240px]" title={item.banner}>
                                                            {item.banner || '-'}
                                                        </span>
                                                    </td>

                                                    {/* Column 5: Tingkat Risiko (Centered) */}
                                                    <td className="h-[50px] py-0 px-4 text-center">
                                                        {item.riskLevel === 'danger' ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                                                <AlertTriangle size={10} className="text-rose-400 shrink-0" />
                                                                {item.riskLabel}
                                                            </span>
                                                        ) : item.riskLevel === 'warning' ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                                {item.riskLabel}
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-white/[0.03] text-zinc-400 border border-white/[0.06]">
                                                                {item.riskLabel}
                                                            </span>
                                                        )}
                                                    </td>

                                                    {/* Column 6: Aksi (Centered) */}
                                                    <td className="h-[50px] py-0 px-4 text-center">
                                                        <div className="flex items-center justify-center gap-1.5">
                                                            {item.isWeb && onOpenWebPreview && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onOpenWebPreview(item.device, item.port)}
                                                                    className="py-1 px-2 rounded-md text-[11px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors inline-flex items-center gap-1"
                                                                    title={`Pratinjau langsung ${webUrl}`}
                                                                >
                                                                    <Eye size={11} className="text-emerald-400 shrink-0" />
                                                                    <span>Preview</span>
                                                                </button>
                                                            )}

                                                            {item.isWeb && (
                                                                <a
                                                                    href={webUrl}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="py-1 px-2 rounded-md text-[11px] font-medium bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/[0.1] transition-colors inline-flex items-center gap-1"
                                                                    title={`Buka ${webUrl} di tab baru`}
                                                                >
                                                                    <span>Buka Web</span>
                                                                    <ExternalLink size={11} className="text-zinc-300 shrink-0" />
                                                                </a>
                                                            )}

                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleCopy(item.id, `${item.device.ip}:${item.port}`, e)}
                                                                className="size-7 rounded-md bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-400 hover:text-white flex items-center justify-center transition-colors outline-none"
                                                                title={`Salin ${item.device.ip}:${item.port}`}
                                                            >
                                                                {copiedKey === item.id ? (
                                                                    <Check size={12} className="text-emerald-400" />
                                                                ) : (
                                                                    <Copy size={12} />
                                                                )}
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
