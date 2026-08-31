import React, { useState } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Check,
    Wifi,
    WifiHigh,
    WifiLow,
    WifiOff,
    Loader2,
    Lock,
    Copy,
    Activity,
    Cpu,
    Clock,
    Radio,
    Terminal,
    Network,
    Shield,
    Gauge,
    Info,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    MoreVertical,
    Pencil,
    Trash2,
    X,
    Globe,
    Router,
    Laptop,
    Link2,
    ShieldAlert
} from 'lucide-react';
import { SmoothScroll } from './motion/smooth-scroll';
import { Tooltip } from './motion/tooltip';
import { Dock, DockItem, DockSeparator } from './motion/dock';
import { InstagramIcon } from './icons/InstagramIcon';
import { Device, AuthStatusResponse } from '../types';
import { sortDevicesByField, SortField, SortOrder, formatLastSeen, getResolvedDeviceName } from '../lib/deviceSort';
import { cn } from '../lib/utils';

interface Props {
    devices: Device[];
    selectedIps: string[];
    isSelectMode?: boolean;
    activeInspectorIp?: string;
    authStatus?: AuthStatusResponse;
    onSelectForInspect?: (ip: string) => void;
    onToggleSelect: (ip: string) => void;
    onToggleSelectAll: () => void;
    onToggleInternet: (device: Device) => void;
    onDeleteDevice?: (mac: string) => void;
    onUpdateAlias?: (mac: string, alias: string) => void;
    onSetSpeedLimit?: (ip: string, limit: number) => void;
    onOpenRedirectModal?: (device: Device) => void;
    loadingIps: Set<string>;
}

export const DeviceTable: FC<Props> = ({
    devices,
    selectedIps,
    isSelectMode = false,
    activeInspectorIp,
    authStatus,
    onSelectForInspect,
    onToggleSelect,
    onToggleSelectAll,
    onToggleInternet,
    onDeleteDevice,
    onUpdateAlias,
    onOpenRedirectModal,
    loadingIps
}) => {
    const [expandedIp, setExpandedIp] = useState<string | null>(null);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [sortField, setSortField] = useState<SortField>('default');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
    const [activeDockIp, setActiveDockIp] = useState<string | null>(null);
    const [editingDevice, setEditingDevice] = useState<Device | null>(null);
    const [editAliasValue, setEditAliasValue] = useState<string>('');
    const [deletingDevice, setDeletingDevice] = useState<Device | null>(null);

    React.useEffect(() => {
        const handleClickOutside = () => {
            setActiveDockIp(null);
        };
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    const handleHeaderSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortOrder('asc');
        }
    };

    const sortedDevices = React.useMemo(() => {
        return sortDevicesByField(devices, sortField, sortOrder);
    }, [devices, sortField, sortOrder]);

    const selectableDevices = sortedDevices.filter(d => !d.is_gateway && !d.is_self);
    const canSelectAny = selectableDevices.length > 0;
    const isAllSelected = canSelectAny && selectableDevices.every(d => selectedIps.includes(d.ip));
    const isSomeSelected = canSelectAny && selectableDevices.some(d => selectedIps.includes(d.ip)) && !isAllSelected;

    const handleToggleRowDetail = (ip: string) => {
        setExpandedIp(prev => (prev === ip ? null : ip));
    };

    const handleCopy = (key: string, text: string, e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1800);
    };

    if (devices.length === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-16 text-center text-zinc-500 gap-3"
            >
                <Wifi size={36} className="text-zinc-600 opacity-60" />
                <h3 className="text-sm font-semibold text-zinc-300">Tidak Ada Perangkat Sesuai Filter</h3>
                <p className="text-xs text-zinc-500">Coba ganti filter tab atau lakukan pemindaian ulang jaringan.</p>
            </motion.div>
        );
    }

    return (
        <SmoothScroll root={false} className="w-full overflow-x-auto overflow-y-auto relative max-h-[min(650px,65vh)]">
            <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#090a0c]/95 backdrop-blur z-10 shadow-sm shadow-black/40">
                    <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-zinc-400 h-[44px]">
                        {isSelectMode && (
                            <th className="w-11 text-center h-[44px] py-0 px-2">
                                <button
                                    type="button"
                                    disabled={!canSelectAny}
                                    onClick={canSelectAny ? onToggleSelectAll : undefined}
                                    className={cn(
                                        "size-4 mx-auto rounded flex items-center justify-center border transition-all outline-none",
                                        !canSelectAny && "opacity-25 cursor-not-allowed border-white/[0.1]",
                                        canSelectAny && isAllSelected && "bg-white text-black border-white",
                                        canSelectAny && !isAllSelected && "border-white/[0.2] hover:border-white/[0.4] bg-transparent"
                                    )}
                                    title={!canSelectAny ? 'Tidak ada perangkat yang dapat dipilih' : isAllSelected ? 'Deselect All' : 'Select All'}
                                >
                                    {isAllSelected && <Check size={11} strokeWidth={3} />}
                                    {isSomeSelected && <div className="w-2 h-0.5 bg-white rounded-full" />}
                                </button>
                            </th>
                        )}
                        <th
                            className="h-[44px] py-0 px-4 cursor-pointer select-none group/th hover:text-white transition-colors"
                            onClick={() => handleHeaderSort('device')}
                            title="Klik untuk mengurutkan berdasarkan nama / IP"
                        >
                            <div className="flex items-center gap-1.5">
                                <span>Device</span>
                                {sortField === 'device' ? (
                                    sortOrder === 'asc' ? <ArrowUp size={12} className="text-emerald-400 shrink-0" /> : <ArrowDown size={12} className="text-emerald-400 shrink-0" />
                                ) : (
                                    <ArrowUpDown size={11} className="text-zinc-600 opacity-40 group-hover/th:opacity-100 transition-opacity shrink-0" />
                                )}
                            </div>
                        </th>
                        <th
                            className="h-[44px] py-0 px-4 cursor-pointer select-none group/th hover:text-white transition-colors"
                            onClick={() => handleHeaderSort('os')}
                            title="Klik untuk mengurutkan berdasarkan sistem operasi / vendor"
                        >
                            <div className="flex items-center gap-1.5">
                                <span>Perangkat</span>
                                {sortField === 'os' ? (
                                    sortOrder === 'asc' ? <ArrowUp size={12} className="text-emerald-400 shrink-0" /> : <ArrowDown size={12} className="text-emerald-400 shrink-0" />
                                ) : (
                                    <ArrowUpDown size={11} className="text-zinc-600 opacity-40 group-hover/th:opacity-100 transition-opacity shrink-0" />
                                )}
                            </div>
                        </th>
                        <th
                            className="h-[44px] py-0 px-4 text-center cursor-pointer select-none group/th hover:text-white transition-colors"
                            onClick={() => handleHeaderSort('status')}
                            title="Klik untuk mengurutkan berdasarkan status online / offline / terblokir"
                        >
                            <div className="flex items-center justify-center gap-1.5">
                                <span>Status</span>
                                {sortField === 'status' ? (
                                    sortOrder === 'asc' ? <ArrowUp size={12} className="text-emerald-400 shrink-0" /> : <ArrowDown size={12} className="text-emerald-400 shrink-0" />
                                ) : (
                                    <ArrowUpDown size={11} className="text-zinc-600 opacity-40 group-hover/th:opacity-100 transition-opacity shrink-0" />
                                )}
                            </div>
                        </th>
                        <th
                            className="h-[44px] py-0 px-4 text-center cursor-pointer select-none group/th hover:text-white transition-colors"
                            onClick={() => handleHeaderSort('last_seen')}
                            title="Klik untuk mengurutkan berdasarkan waktu terakhir dilihat"
                        >
                            <div className="flex items-center justify-center gap-1.5">
                                <span>Terakhir Dilihat</span>
                                {sortField === 'last_seen' ? (
                                    sortOrder === 'asc' ? <ArrowUp size={12} className="text-emerald-400 shrink-0" /> : <ArrowDown size={12} className="text-emerald-400 shrink-0" />
                                ) : (
                                    <ArrowUpDown size={11} className="text-zinc-600 opacity-40 group-hover/th:opacity-100 transition-opacity shrink-0" />
                                )}
                            </div>
                        </th>
                        <th
                            className="h-[44px] py-0 px-4 text-center cursor-pointer select-none group/th hover:text-white transition-colors"
                            onClick={() => handleHeaderSort('access')}
                            title="Klik untuk mengurutkan berdasarkan tingkat akses / batas kecepatan"
                        >
                            <div className="flex items-center justify-center gap-1.5">
                                <span>Akses</span>
                                {sortField === 'access' ? (
                                    sortOrder === 'asc' ? <ArrowUp size={12} className="text-emerald-400 shrink-0" /> : <ArrowDown size={12} className="text-emerald-400 shrink-0" />
                                ) : (
                                    <ArrowUpDown size={11} className="text-zinc-600 opacity-40 group-hover/th:opacity-100 transition-opacity shrink-0" />
                                )}
                            </div>
                        </th>
                        <th className="w-10 text-center h-[44px] py-0 px-2"></th>
                    </tr>
                </thead>

                <tbody className="divide-y divide-white/[0.04]">
                    {sortedDevices.map((device) => {
                        const isSelected = selectedIps.includes(device.ip);
                        const isExpanded = expandedIp === device.ip;
                        const isInspecting = activeInspectorIp === device.ip;
                        const isOnline = device.is_self ? true : device.is_online;
                        const isLoading = loadingIps.has(device.ip);
                        const isInternetActive = !device.is_blocked && (device.speed_limit === undefined || device.speed_limit > 0);
                        const isThrottled = (device.speed_limit ?? 100) > 0 && (device.speed_limit ?? 100) < 100;

                        const deviceName = getResolvedDeviceName(device);

                        const isDeepFingerprintEnabled = authStatus?.license?.can_deep_fingerprint ?? (authStatus?.license?.tier !== 'free');
                        const activeIpForSplit = device.ip && device.ip.trim() !== '' ? device.ip : (device.last_ip || '');
                        const lastDotIdx = activeIpForSplit.lastIndexOf('.');
                        const ipPrefix = lastDotIdx !== -1 ? activeIpForSplit.slice(0, lastDotIdx + 1) : '';
                        const ipHost = lastDotIdx !== -1 ? activeIpForSplit.slice(lastDotIdx + 1) : (device.is_online ? device.ip : 'Offline');

                        const ttlValue = device.ttl || (device.os === 'Windows' ? 128 : 64);
                        const ttlDesc = ttlValue >= 100 ? 'Windows NT' : ttlValue <= 75 ? 'Linux / Android / Darwin' : 'Network Appliance';

                        return (
                            <React.Fragment key={device.mac || device.ip}>
                                <tr
                                    onClick={() => handleToggleRowDetail(device.ip)}
                                    className={cn(
                                        "group transition-all duration-150 cursor-pointer select-none h-[56px]",
                                        isSelected ? "bg-white/[0.04]" : isInspecting ? "bg-white/[0.035]" : "hover:bg-white/[0.02]",
                                        isExpanded && "bg-white/[0.025]"
                                    )}
                                >
                                    {/* Checkbox / Lock Column with Left Active Accent Line (Only in Select Mode) */}
                                    {isSelectMode && (
                                        <td
                                            className={cn(
                                                "text-center h-[56px] py-0 px-2 relative transition-colors",
                                                (isExpanded || isInspecting) && (isOnline ? "border-l-2 border-emerald-400" : "border-l-2 border-zinc-500")
                                            )}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!device.is_gateway && !device.is_self) {
                                                    onToggleSelect(device.ip);
                                                }
                                            }}
                                        >
                                            {!device.is_gateway && !device.is_self ? (
                                                 <button
                                                    type="button"
                                                    className={cn(
                                                        "size-4 mx-auto rounded flex items-center justify-center border transition-all outline-none",
                                                        isSelected ? "bg-white text-black border-white" : "border-white/[0.2] group-hover:border-white/[0.4] bg-transparent"
                                                    )}
                                                >
                                                    {isSelected && <Check size={11} strokeWidth={3} />}
                                                </button>
                                            ) : (
                                                <div className="flex justify-center" title={device.is_self ? "Perangkat ini terlindungi" : "Gateway dilindungi (tidak dapat dipilih massal)"}>
                                                    <Lock size={12} className="text-zinc-600" />
                                                </div>
                                            )}
                                        </td>
                                    )}

                                    {/* Column 1: Device (Pro/VIP: Nama + IP, Free: Hanya IP) */}
                                    <td className={cn(
                                        "h-[56px] py-0 px-4",
                                        !isSelectMode && (isExpanded || isInspecting) && (isOnline ? "border-l-2 border-emerald-400" : "border-l-2 border-zinc-500")
                                    )}>
                                        <div className="flex flex-col justify-center min-w-0">
                                            {isDeepFingerprintEnabled ? (
                                                /* PRO / VIP: Tampilkan Nama Perangkat di atas & IP di bawah seperti sebelumnya */
                                                <>
                                                    <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                                                        <span 
                                                            className="text-xs font-semibold text-white tracking-tight truncate max-w-[180px]"
                                                            title={deviceName !== (device.ip || device.last_ip) ? `${deviceName} (${device.ip || device.last_ip || '-'})` : (device.ip || device.last_ip || '-')}
                                                        >
                                                            {deviceName}
                                                        </span>

                                                        {device.is_gateway && (
                                                            <span title="Gateway Jaringan Utama" className="inline-flex shrink-0 cursor-default">
                                                                <Router size={13} className="text-zinc-400" />
                                                            </span>
                                                        )}
                                                        {device.is_self && (
                                                            <span title="Komputer Kontroler Ini (This PC)" className="inline-flex shrink-0 cursor-default">
                                                                <Laptop size={13} className="text-zinc-400" />
                                                            </span>
                                                        )}
                                                        {!device.is_gateway && !device.is_self && (
                                                            device.linked_macs && device.linked_macs.length > 1 ? (
                                                                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 shrink-0 whitespace-nowrap cursor-default" title={`Perangkat fisik ini memiliki ${device.linked_macs.length} alamat MAC acak yang otomatis disatukan.`}>
                                                                    <Link2 size={12} className="text-zinc-400" />
                                                                    <span>{device.linked_macs.length}</span>
                                                                </span>
                                                            ) : device.matched_by === 'high_confidence_multi_factor' ? (
                                                                <span title="Perangkat ber-MAC acak ini otomatis terhubung via profil sidik jari cerdas" className="inline-flex shrink-0 cursor-default">
                                                                    <Link2 size={12} className="text-zinc-400" />
                                                                </span>
                                                            ) : null
                                                        )}
                                                        {device.matched_by === 'candidate_review' && (
                                                            <span title="Perangkat mirip profil terdaftar (Skor 50-79%), tidak diblokir untuk perlindungan tamu" className="inline-flex shrink-0 cursor-default">
                                                                <ShieldAlert size={12} className="text-zinc-400" />
                                                            </span>
                                                        )}
                                                        {Boolean(device.is_dual_stack || device.ipv6_link_local || device.ipv6_global) && (
                                                            <span 
                                                                className="text-[10px] font-mono text-cyan-300 shrink-0 whitespace-nowrap cursor-default"
                                                                title={`Dual-Stack (IPv4 + IPv6 aktif)\nLink-Local: ${device.ipv6_link_local || '-'}\nGlobal: ${device.ipv6_global || '-'}`}
                                                            >
                                                                ipv6
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="font-mono text-[11px] text-zinc-500 tracking-tight">
                                                        {device.is_online ? device.ip : (device.last_ip ? `Offline (${device.last_ip})` : 'Offline')}
                                                    </span>
                                                </>
                                            ) : (
                                                /* FREE: Hanya IP dengan Subnet Octet Highlighting (atau Offline bila tidak aktif) */
                                                <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                                                    {device.is_online ? (
                                                        <span 
                                                            className="font-mono text-xs inline-flex items-baseline tracking-tight"
                                                            title={deviceName !== device.ip ? `${deviceName} (${device.ip})` : device.ip}
                                                        >
                                                            <span className="text-zinc-500">{ipPrefix}</span>
                                                            <span className={cn(
                                                                "font-bold",
                                                                device.is_gateway ? "text-amber-400" : device.is_self ? "text-emerald-400" : "text-white"
                                                            )}>{ipHost}</span>
                                                        </span>
                                                    ) : (
                                                        <span 
                                                            className="font-mono text-xs text-zinc-500 tracking-tight"
                                                            title={device.last_ip ? `Terakhir aktif: ${device.last_ip}` : 'Offline'}
                                                        >
                                                            Offline {device.last_ip ? `(${device.last_ip})` : ''}
                                                        </span>
                                                    )}

                                                    {device.is_gateway && (
                                                        <span title="Gateway Jaringan Utama" className="inline-flex shrink-0 cursor-default">
                                                            <Router size={13} className="text-zinc-400" />
                                                        </span>
                                                    )}
                                                    {device.is_self && (
                                                        <span title="Komputer Kontroler Ini (This PC)" className="inline-flex shrink-0 cursor-default">
                                                            <Laptop size={13} className="text-zinc-400" />
                                                        </span>
                                                    )}
                                                    {!device.is_gateway && !device.is_self && (
                                                        device.linked_macs && device.linked_macs.length > 1 ? (
                                                            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 shrink-0 whitespace-nowrap cursor-default" title={`Perangkat fisik ini memiliki ${device.linked_macs.length} alamat MAC acak yang otomatis disatukan.`}>
                                                                <Link2 size={12} className="text-zinc-400" />
                                                                <span>{device.linked_macs.length}</span>
                                                            </span>
                                                        ) : device.matched_by === 'high_confidence_multi_factor' ? (
                                                            <span title="Perangkat ber-MAC acak ini otomatis terhubung via profil sidik jari cerdas" className="inline-flex shrink-0 cursor-default">
                                                                <Link2 size={12} className="text-zinc-400" />
                                                            </span>
                                                        ) : null
                                                    )}
                                                    {device.matched_by === 'candidate_review' && (
                                                        <span title="Perangkat mirip profil terdaftar (Skor 50-79%), tidak diblokir untuk perlindungan tamu" className="inline-flex shrink-0 cursor-default">
                                                            <ShieldAlert size={12} className="text-zinc-400" />
                                                        </span>
                                                    )}
                                                    {Boolean(device.is_dual_stack || device.ipv6_link_local || device.ipv6_global) && (
                                                        <span 
                                                            className="text-[10px] font-mono text-cyan-300 shrink-0 whitespace-nowrap cursor-default"
                                                            title={`Dual-Stack (IPv4 + IPv6 aktif)\nLink-Local: ${device.ipv6_link_local || '-'}\nGlobal: ${device.ipv6_global || '-'}`}
                                                        >
                                                            ipv6
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </td>

                                    {/* Column 2: Perangkat (Semua tertulis Terkunci untuk Free) */}
                                    <td className="h-[56px] py-0 px-4">
                                        {isDeepFingerprintEnabled ? (
                                            <span className="text-xs text-zinc-300 font-medium truncate block">
                                                {device.os || device.vendor || '-'}
                                            </span>
                                        ) : (
                                            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-zinc-500 select-none" title="Deteksi detail perangkat terkunci di versi Free. Upgrade ke PRO untuk membuka!">
                                                <Lock size={11} className="text-zinc-500 shrink-0" />
                                                <span className="text-[11px] font-mono text-zinc-500">Terkunci</span>
                                            </div>
                                        )}
                                    </td>

                                    {/* Column 3: Status (Centered) */}
                                    <td className="h-[56px] py-0 px-4 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            {device.is_blocked ? (
                                                <>
                                                    <span className="size-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                                                    <span className="text-xs font-medium text-rose-400">Terblokir</span>
                                                </>
                                            ) : device.is_redirected ? (
                                                <>
                                                    <span className="size-2 rounded-full bg-pink-400 animate-pulse shrink-0" />
                                                    <span className="text-xs font-medium text-pink-300">Redirect (IG)</span>
                                                </>
                                            ) : isThrottled ? (
                                                <>
                                                    <span className="size-2 rounded-full bg-amber-400 shrink-0" />
                                                    <span className="text-xs font-medium text-amber-300">Dibatasi ({device.speed_limit}%)</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className={cn(
                                                        "size-2 rounded-full shrink-0",
                                                        isOnline ? "bg-emerald-400" : "bg-zinc-600"
                                                    )} />
                                                    <span className={cn(
                                                        "text-xs font-medium",
                                                        isOnline ? "text-zinc-200" : "text-zinc-500"
                                                    )}>
                                                        {isOnline ? 'Online' : 'Offline'}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </td>

                                    {/* Column 4: Terakhir Dilihat (Formatted Date & Time - Normal Font) */}
                                    <td className="h-[56px] py-0 px-4 text-center">
                                        <span className="text-xs text-zinc-400 font-normal" title={`Terakhir aktif: ${device.last_seen || '-'}`}>
                                            {formatLastSeen(device.last_seen)}
                                        </span>
                                    </td>

                                    {/* Column 5: Akses (Fades out smoothly when 3-dots Dock is active) */}
                                    <td
                                        className="text-center h-[56px] py-0 px-4"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <AnimatePresence mode="wait">
                                            {activeDockIp !== device.ip ? (
                                                <motion.div
                                                    key={`access-${device.ip}`}
                                                    initial={{ opacity: 0, scale: 0.94, filter: "blur(2px)" }}
                                                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                                                    exit={{ opacity: 0, scale: 0.94, filter: "blur(2px)" }}
                                                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                                                    className="flex items-center justify-center"
                                                >
                                                    {device.is_gateway || device.is_self ? (
                                                        <Tooltip content={device.is_self ? "Komputer Ini Terlindungi (Anti Self-Cut)" : "Gateway Router Terlindungi (Immune)"}>
                                                            <div className="inline-flex items-center justify-center p-1.5 cursor-default group transition-transform duration-150 hover:scale-115">
                                                                <Lock size={15} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                                                            </div>
                                                        </Tooltip>
                                                    ) : (
                                                        <div className="flex items-center justify-center gap-2">
                                                            {/* Tooltip 1: Toggle Internet On/Off with Lucide icons (Wifi / WifiHigh / WifiLow / WifiOff / Loader2) & circular box container */}
                                                            {(() => {
                                                                const distanceLevel: 'near' | 'medium' | 'far' = (device.is_self || !device.distance_zone || device.distance_zone === 'unknown') ? 'near' : device.distance_zone;
                                                                const distanceLabel = distanceLevel === 'near' ? 'Dekat' : distanceLevel === 'medium' ? 'Sedang' : 'Jauh';
                                                                const tooltipText = isLoading
                                                                    ? (isInternetActive ? "Memverifikasi denyut & memutus..." : "Sedang memulihkan koneksi...")
                                                                    : !isOnline && !device.is_blocked
                                                                        ? "Perangkat Offline (Tidak terhubung ke Wi-Fi)"
                                                                        : isInternetActive
                                                                            ? `Putus Internet • Jarak: ${distanceLabel}${device.estimated_range ? ` (${device.estimated_range})` : ''}`
                                                                            : "Pulihkan Akses Internet";

                                                                const renderWifiIcon = () => {
                                                                    if (isLoading) {
                                                                        return (
                                                                            <Loader2
                                                                                size={14}
                                                                                className={cn(
                                                                                    "animate-spin",
                                                                                    isInternetActive ? "text-amber-400" : "text-rose-400"
                                                                                )}
                                                                            />
                                                                        );
                                                                    }
                                                                    if (!isInternetActive) {
                                                                        return (
                                                                            <WifiOff
                                                                                size={14}
                                                                                className="text-rose-500 transition-transform group-hover:scale-110 drop-shadow-[0_0_6px_rgba(244,63,94,0.4)]"
                                                                            />
                                                                        );
                                                                    }
                                                                    if (!isOnline) {
                                                                        return (
                                                                            <Wifi
                                                                                size={14}
                                                                                className="text-zinc-500 transition-transform group-hover:scale-110"
                                                                            />
                                                                        );
                                                                    }
                                                                    if (distanceLevel === 'far') {
                                                                        return (
                                                                            <WifiLow
                                                                                size={14}
                                                                                className="text-emerald-400 group-hover:text-emerald-300 transition-transform group-hover:scale-110 drop-shadow-[0_0_6px_rgba(52,211,153,0.35)]"
                                                                            />
                                                                        );
                                                                    }
                                                                    if (distanceLevel === 'medium') {
                                                                        return (
                                                                            <WifiHigh
                                                                                size={14}
                                                                                className="text-emerald-400 group-hover:text-emerald-300 transition-transform group-hover:scale-110 drop-shadow-[0_0_6px_rgba(52,211,153,0.35)]"
                                                                            />
                                                                        );
                                                                    }
                                                                    return (
                                                                        <Wifi
                                                                            size={14}
                                                                            className="text-emerald-400 group-hover:text-emerald-300 transition-transform group-hover:scale-110 drop-shadow-[0_0_6px_rgba(52,211,153,0.35)]"
                                                                        />
                                                                    );
                                                                };

                                                                return (
                                                                    <Tooltip content={tooltipText}>
                                                                        <button
                                                                            type="button"
                                                                            disabled={isLoading}
                                                                            onClick={() => onToggleInternet(device)}
                                                                            className={cn(
                                                                                "size-7 rounded-full flex items-center justify-center transition-all duration-150 outline-none group cursor-pointer active:scale-95",
                                                                                isLoading && "cursor-wait opacity-80",
                                                                                !isOnline && !device.is_blocked
                                                                                    ? "bg-zinc-800/40 border border-zinc-700/40 hover:bg-zinc-800/70 hover:border-zinc-600/50"
                                                                                    : isInternetActive
                                                                                        ? "bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 hover:border-emerald-500/40 hover:scale-110 shadow-sm shadow-emerald-500/10"
                                                                                        : "bg-rose-500/10 border border-rose-500/25 hover:bg-rose-500/20 hover:border-rose-500/40 hover:scale-110 shadow-sm shadow-rose-500/10"
                                                                            )}
                                                                            aria-label={isInternetActive ? "Putus Internet" : "Pulihkan Internet"}
                                                                        >
                                                                            {renderWifiIcon()}
                                                                        </button>
                                                                    </Tooltip>
                                                                );
                                                            })()}

                                                            {/* Tooltip 2: Bandwidth -> Security & Telemetry Sidebar */}
                                                            <Tooltip content="Security & Telemetry">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onSelectForInspect && onSelectForInspect(device.ip)}
                                                                    className={cn(
                                                                        "p-1.5 rounded-md flex items-center justify-center transition-all duration-150 outline-none group cursor-pointer hover:scale-115 active:scale-95",
                                                                        isInspecting
                                                                            ? "text-amber-300 drop-shadow-[0_0_8px_rgba(252,211,77,0.4)]"
                                                                            : isThrottled
                                                                                ? "text-amber-400 hover:text-amber-300"
                                                                                : "text-zinc-500 hover:text-zinc-200"
                                                                    )}
                                                                    aria-label="Buka Security & Telemetry"
                                                                >
                                                                    <Gauge size={16} className="transition-transform group-hover:scale-110" />
                                                                </button>
                                                            </Tooltip>

                                                            {/* Tooltip 3: Instagram Redirect */}
                                                            {onOpenRedirectModal && (
                                                                <Tooltip content={device.is_redirected ? "Kelola Redirect Instagram" : "Alihkan ke Instagram"}>
                                                                    <button
                                                                        type="button"
                                                                        disabled={isLoading}
                                                                        onClick={() => onOpenRedirectModal(device)}
                                                                        className={cn(
                                                                            "p-1.5 rounded-md flex items-center justify-center transition-all duration-150 outline-none group cursor-pointer hover:scale-115 active:scale-95",
                                                                            device.is_redirected
                                                                                ? "text-pink-400 drop-shadow-[0_0_8px_rgba(244,114,182,0.45)]"
                                                                                : "text-zinc-500 hover:text-pink-400"
                                                                        )}
                                                                        aria-label="Redirect Instagram"
                                                                    >
                                                                        <InstagramIcon size={15} className="transition-transform group-hover:scale-110" />
                                                                    </button>
                                                                </Tooltip>
                                                            )}

                                                            {/* Tooltip 4: Info -> Slide-down Bento Detail */}
                                                            <Tooltip content={isExpanded ? "Tutup Informasi" : "Lihat Informasi Detail"}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleToggleRowDetail(device.ip)}
                                                                    className={cn(
                                                                        "p-1.5 rounded-md flex items-center justify-center transition-all duration-150 outline-none group cursor-pointer hover:scale-115 active:scale-95",
                                                                        isExpanded
                                                                            ? "text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]"
                                                                            : "text-zinc-500 hover:text-zinc-200"
                                                                    )}
                                                                    aria-label={isExpanded ? "Tutup Info" : "Buka Info"}
                                                                >
                                                                    <Info size={16} className="transition-transform group-hover:scale-110" />
                                                                </button>
                                                            </Tooltip>
                                                        </div>
                                                    )}
                                                </motion.div>
                                            ) : null}
                                        </AnimatePresence>
                                    </td>

                                    {/* Column 6: Dedicated Opsi Titik 3 Column (No box, centered at right) */}
                                    <td
                                        className="text-center h-[56px] py-0 px-2"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {!device.is_gateway && !device.is_self && (
                                            <div className="relative inline-flex items-center justify-center">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setActiveDockIp(prev => (prev === device.ip ? null : device.ip));
                                                    }}
                                                    className={cn(
                                                        "p-1.5 transition-all duration-200 bg-transparent border-0 outline-none flex items-center justify-center rounded cursor-pointer",
                                                        activeDockIp === device.ip ? "text-white rotate-90" : "text-zinc-400 hover:text-white rotate-0"
                                                    )}
                                                    title="Opsi Perangkat"
                                                    aria-label="Opsi Perangkat"
                                                >
                                                    <MoreVertical size={16} />
                                                </button>

                                                {/* Floating BeUI Motion Dock directly anchored to the left of the 3-dots button */}
                                                <AnimatePresence>
                                                    {activeDockIp === device.ip && (
                                                        <motion.div
                                                            initial={{ opacity: 0, scale: 0.88, x: 12, y: "-50%" }}
                                                            animate={{ opacity: 1, scale: 1, x: 0, y: "-50%" }}
                                                            exit={{ opacity: 0, scale: 0.88, x: 12, y: "-50%" }}
                                                            transition={{ type: "spring", stiffness: 460, damping: 28, mass: 0.55 }}
                                                            className="absolute right-full mr-2.5 top-1/2 z-50 whitespace-nowrap"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <Dock size={28} className="shadow-2xl border-white/[0.12] bg-[#121316]/98 backdrop-blur-2xl">
                                                                <DockItem
                                                                    title="Ubah Nama Perangkat"
                                                                    onClick={() => {
                                                                        setEditingDevice(device);
                                                                        setEditAliasValue(device.alias || device.hostname || '');
                                                                        setActiveDockIp(null);
                                                                    }}
                                                                    className="hover:text-white hover:bg-white/[0.08]"
                                                                >
                                                                    <Pencil size={13} />
                                                                </DockItem>
                                                                <DockSeparator />
                                                                <DockItem
                                                                    title="Hapus dari Database"
                                                                    onClick={() => {
                                                                        setDeletingDevice(device);
                                                                        setActiveDockIp(null);
                                                                    }}
                                                                    className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/20"
                                                                >
                                                                    <Trash2 size={13} />
                                                                </DockItem>
                                                                <DockSeparator />
                                                                <DockItem
                                                                    title="Tutup Menu"
                                                                    onClick={() => setActiveDockIp(null)}
                                                                    className="text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"
                                                                >
                                                                    <X size={13} />
                                                                </DockItem>
                                                            </Dock>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        )}
                                    </td>
                                </tr>

                                {/* Slide-Down Accordion Detail Row */}
                                <AnimatePresence>
                                    {isExpanded && (
                                        <tr className="border-b border-white/[0.06]">
                                            <td colSpan={isSelectMode ? 7 : 6} className="p-0">
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                                                    className="overflow-hidden bg-[#090a0d] border-t border-white/[0.04]"
                                                >
                                                    <div className="p-6">
                                                        {/* Full-width Bento Stat Tiles */}
                                                        <div className="w-full space-y-3">
                                                                {/* Top Row: Network Telemetry */}
                                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                                    {/* Tile 1: IP Address */}
                                                                    <div className="group/tile p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-colors flex flex-col justify-between">
                                                                        <div className="flex items-center justify-between text-zinc-500 mb-2">
                                                                            <span className="text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5">
                                                                                <Network size={12} className="text-zinc-400" />
                                                                                IPv4 Address
                                                                            </span>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => handleCopy(`ip-${device.ip}`, device.ip, e)}
                                                                                className="p-1 rounded text-zinc-500 hover:text-white transition-colors"
                                                                                title="Copy IP"
                                                                            >
                                                                                {copiedKey === `ip-${device.ip}` ? (
                                                                                    <Check size={12} className="text-emerald-400" />
                                                                                ) : (
                                                                                    <Copy size={12} />
                                                                                )}
                                                                            </button>
                                                                        </div>
                                                                        <div className="flex items-baseline justify-between">
                                                                            <span className="text-sm font-mono font-semibold text-white">{device.ip}</span>
                                                                            {device.is_gateway && (
                                                                                <span className="text-[10px] font-mono text-zinc-400 bg-white/[0.06] px-1.5 py-0.5 rounded">Gateway</span>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* Tile 2: Physical MAC & Privacy Detection */}
                                                                    <div className="group/tile p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-colors flex flex-col justify-between">
                                                                        <div className="flex items-center justify-between text-zinc-500 mb-1.5">
                                                                            <span className="text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5">
                                                                                <Radio size={12} className="text-zinc-400" />
                                                                                MAC Layer 2
                                                                            </span>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => handleCopy(`mac-${device.mac}`, device.mac, e)}
                                                                                className="p-1 rounded text-zinc-500 hover:text-white transition-colors"
                                                                                title="Copy MAC"
                                                                            >
                                                                                {copiedKey === `mac-${device.mac}` ? (
                                                                                    <Check size={12} className="text-emerald-400" />
                                                                                ) : (
                                                                                    <Copy size={12} />
                                                                                )}
                                                                            </button>
                                                                        </div>
                                                                        <span className="text-sm font-mono font-semibold text-white tracking-tight mb-1.5">{device.mac || '-'}</span>
                                                                        <div>
                                                                            {device.is_randomized_mac ? (
                                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/10 text-purple-300 border border-purple-500/20" title="Alamat MAC acak yang dibuat oleh OS untuk privasi Wi-Fi (Locally Administered)">
                                                                                    <Shield size={10} />
                                                                                    Private MAC
                                                                                </span>
                                                                            ) : (
                                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-500/10 text-blue-300 border border-blue-500/20" title="Alamat MAC asli pabrikan perangkat keras (Universally Administered OUI)">
                                                                                    Hardware OUI
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* Tile 3: Latency & IP Kernel TTL */}
                                                                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-colors flex flex-col justify-between">
                                                                        <div className="flex items-center justify-between text-zinc-500 mb-1.5">
                                                                            <span className="text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5">
                                                                                <Activity size={12} className="text-zinc-400" />
                                                                                Ping & Kernel TTL
                                                                            </span>
                                                                            <span className={cn(
                                                                                "size-2 rounded-full",
                                                                                isOnline ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
                                                                            )} />
                                                                        </div>
                                                                        <div className="flex items-baseline gap-2 mb-1">
                                                                            <span className="text-sm font-mono font-semibold text-emerald-400">
                                                                                {device.rtt_ms ? `${device.rtt_ms} ms` : '< 1 ms'}
                                                                            </span>
                                                                            <span className="text-[10px] text-zinc-400 font-mono">
                                                                                TTL: {ttlValue}
                                                                            </span>
                                                                        </div>
                                                                        <span className="text-[10px] font-mono text-zinc-500 truncate" title={ttlDesc}>
                                                                            {ttlDesc}
                                                                        </span>
                                                                    </div>
                                                                </div>

                                                                {/* Second Row: Hardware, Device Class, & System Info (PRO Only) */}
                                                                {isDeepFingerprintEnabled && (
                                                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                                        {/* Hardware Vendor & Device Type */}
                                                                        <div className="p-3 rounded-xl bg-white/[0.015] border border-white/[0.05] flex flex-col justify-between">
                                                                            <div>
                                                                                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 flex items-center gap-1.5 mb-1">
                                                                                    <Cpu size={12} className="text-zinc-400" />
                                                                                    Vendor & Type
                                                                                </span>
                                                                                <span className="text-xs font-semibold text-zinc-200 block truncate">{device.vendor || 'Generic Device'}</span>
                                                                            </div>
                                                                            <span className="text-[11px] font-mono text-zinc-400 block truncate mt-1">
                                                                                {device.device_type || 'Network Device'}
                                                                            </span>
                                                                        </div>

                                                                        {/* OS Platform & NetBIOS */}
                                                                        <div className="p-3 rounded-xl bg-white/[0.015] border border-white/[0.05] flex flex-col justify-between">
                                                                            <div>
                                                                                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 flex items-center gap-1.5 mb-1">
                                                                                    <Terminal size={12} className="text-zinc-400" />
                                                                                    OS & Identity
                                                                                </span>
                                                                                <span className="text-xs font-semibold text-zinc-200 block truncate">{device.os || 'Unknown OS'}</span>
                                                                            </div>
                                                                            <div className="text-[11px] font-mono text-zinc-400 block truncate mt-1">
                                                                                {device.user_name ? (
                                                                                    <span className="text-emerald-400 font-medium">User: {device.user_name}</span>
                                                                                ) : device.workgroup ? (
                                                                                    <span>Domain: {device.workgroup}</span>
                                                                                ) : (
                                                                                    <span>LAN Client</span>
                                                                                )}
                                                                            </div>
                                                                        </div>

                                                                        {/* Timeline Activity / Web Banner */}
                                                                        <div className="p-3 rounded-xl bg-white/[0.015] border border-white/[0.05] flex flex-col justify-between">
                                                                            <div>
                                                                                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 flex items-center gap-1.5 mb-1">
                                                                                    <Clock size={12} className="text-zinc-400" />
                                                                                    Timeline / Banner
                                                                                </span>
                                                                                <span className="text-xs text-zinc-300 block truncate">
                                                                                    {device.web_title ? `Title: ${device.web_title}` : `Seen: ${device.last_seen || 'Active'}`}
                                                                                </span>
                                                                            </div>
                                                                            <span className="text-[11px] font-mono text-zinc-500 block truncate mt-1">
                                                                                {device.web_server ? `Server: ${device.web_server}` : `First: ${device.first_seen || '-'}`}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* Third Row: IPv6 Dual-Stack Network Breakdown */}
                                                                {(device.ipv6_link_local || device.ipv6_global || (device.ipv6_addresses && device.ipv6_addresses.length > 0)) && (
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                        {/* Link-Local IPv6 */}
                                                                        <div className="group/tile p-3 rounded-xl bg-white/[0.015] border border-white/[0.05] hover:border-cyan-500/20 transition-colors flex flex-col justify-between">
                                                                            <div className="flex items-center justify-between text-zinc-500 mb-1">
                                                                                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400/90 flex items-center gap-1.5">
                                                                                    <Network size={12} className="text-cyan-400" />
                                                                                    IPv6 Link-Local (fe80::)
                                                                                </span>
                                                                                {device.ipv6_link_local && (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={(e) => handleCopy(`ipv6-ll-${device.ip}`, device.ipv6_link_local!, e)}
                                                                                        className="p-1 rounded text-zinc-500 hover:text-white transition-colors"
                                                                                        title="Copy IPv6 Link-Local"
                                                                                    >
                                                                                        {copiedKey === `ipv6-ll-${device.ip}` ? (
                                                                                            <Check size={12} className="text-emerald-400" />
                                                                                        ) : (
                                                                                            <Copy size={12} />
                                                                                        )}
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                            <span className="text-xs font-mono font-medium text-zinc-200 block truncate" title={device.ipv6_link_local || 'Tidak terdeteksi'}>
                                                                                {device.ipv6_link_local || '-'}
                                                                            </span>
                                                                            <span className="text-[10px] font-mono text-zinc-500 mt-1 block">
                                                                                Local Scope / NDP Neighbor
                                                                            </span>
                                                                        </div>

                                                                        {/* Global SLAAC IPv6 */}
                                                                        <div className="group/tile p-3 rounded-xl bg-white/[0.015] border border-white/[0.05] hover:border-cyan-500/20 transition-colors flex flex-col justify-between">
                                                                            <div className="flex items-center justify-between text-zinc-500 mb-1">
                                                                                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400/90 flex items-center gap-1.5">
                                                                                    <Globe size={12} className="text-cyan-400" />
                                                                                    IPv6 Global / SLAAC
                                                                                </span>
                                                                                {(device.ipv6_global || (device.ipv6_addresses && device.ipv6_addresses.length > 0)) && (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={(e) => handleCopy(`ipv6-glob-${device.ip}`, device.ipv6_global || (device.ipv6_addresses?.[0] || ''), e)}
                                                                                        className="p-1 rounded text-zinc-500 hover:text-white transition-colors"
                                                                                        title="Copy IPv6 Global"
                                                                                    >
                                                                                        {copiedKey === `ipv6-glob-${device.ip}` ? (
                                                                                            <Check size={12} className="text-emerald-400" />
                                                                                        ) : (
                                                                                            <Copy size={12} />
                                                                                        )}
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                            <span className="text-xs font-mono font-medium text-zinc-200 block truncate" title={device.ipv6_global || (device.ipv6_addresses && device.ipv6_addresses.length > 0 ? device.ipv6_addresses[0] : '-')}>
                                                                                {device.ipv6_global || (device.ipv6_addresses && device.ipv6_addresses.length > 0 ? device.ipv6_addresses[0] : '-')}
                                                                            </span>
                                                                            <span className="text-[10px] font-mono text-zinc-500 mt-1 block">
                                                                                {device.ipv6_addresses && device.ipv6_addresses.length > 1
                                                                                    ? `${device.ipv6_addresses.length} Alamat IPv6 Terikat`
                                                                                    : 'Routable Internet Scope'}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* Open Ports / Services (PRO Only) */}
                                                                {isDeepFingerprintEnabled && Array.isArray(device.open_ports) && device.open_ports.length > 0 && (
                                                                    <div className="p-3.5 rounded-xl bg-white/[0.015] border border-white/[0.05] flex items-start gap-3">
                                                                        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 pt-0.5 shrink-0">Open Ports:</span>
                                                                        <div className="flex flex-wrap gap-1.5">
                                                                            {device.open_ports.map((port, i) => (
                                                                                <span key={port} className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-white/[0.05] text-zinc-300 border border-white/[0.08]">
                                                                                    {port} {Array.isArray(device.services) && device.services[i] ? `(${device.services[i]})` : ''}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                </td>
                                            </tr>
                                        )}
                                    </AnimatePresence>
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>

            {/* Rename Device Alias Modal (Triggered from BeUI Dock) */}
            <AnimatePresence>
                {editingDevice && (
                    <div 
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                        onClick={() => setEditingDevice(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#121316] p-5 shadow-2xl space-y-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Pencil size={16} className="text-zinc-400 shrink-0" />
                                    <div>
                                        <h3 className="text-sm font-semibold text-white">Ubah Nama Perangkat</h3>
                                        <p className="text-xs text-zinc-500 font-mono">{editingDevice.ip} ({editingDevice.mac})</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEditingDevice(null)}
                                    className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.05]"
                                >
                                    <X size={15} />
                                </button>
                            </div>

                            <div>
                                <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
                                    Nama Alias / Label
                                </label>
                                <input
                                    type="text"
                                    value={editAliasValue}
                                    onChange={(e) => setEditAliasValue(e.target.value)}
                                    placeholder="Contoh: HP Mama, Laptop Kerja..."
                                    autoFocus
                                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-emerald-400/50"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            if (onUpdateAlias && editingDevice.mac) {
                                                onUpdateAlias(editingDevice.mac, editAliasValue.trim());
                                            }
                                            setEditingDevice(null);
                                        } else if (e.key === 'Escape') {
                                            setEditingDevice(null);
                                        }
                                    }}
                                />
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setEditingDevice(null)}
                                    className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                                >
                                    Batal
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (onUpdateAlias && editingDevice.mac) {
                                            onUpdateAlias(editingDevice.mac, editAliasValue.trim());
                                        }
                                        setEditingDevice(null);
                                    }}
                                    className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black transition-colors"
                                >
                                    Simpan
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Delete Device Confirmation Modal (Triggered from BeUI Dock) */}
            <AnimatePresence>
                {deletingDevice && (
                    <div 
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                        onClick={() => setDeletingDevice(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#121316] p-5 shadow-2xl space-y-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Trash2 size={16} className="text-zinc-400 shrink-0" />
                                    <div>
                                        <h3 className="text-sm font-semibold text-white">Hapus Perangkat</h3>
                                        <p className="text-xs text-zinc-500 font-mono">{deletingDevice.ip} ({deletingDevice.mac})</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setDeletingDevice(null)}
                                    className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.05]"
                                >
                                    <X size={15} />
                                </button>
                            </div>

                            <p className="text-xs text-zinc-300 leading-relaxed">
                                Apakah Anda yakin ingin menghapus seluruh data dan profil untuk perangkat <strong className="text-white">{deletingDevice.alias || deletingDevice.hostname || deletingDevice.ip}</strong> secara permanen dari database?
                            </p>

                            <div className="flex items-center justify-end gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setDeletingDevice(null)}
                                    className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                                >
                                    Batal
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (onDeleteDevice && deletingDevice.mac) {
                                            onDeleteDevice(deletingDevice.mac);
                                        }
                                        setDeletingDevice(null);
                                    }}
                                    className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors"
                                >
                                    Hapus
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </SmoothScroll>
    );
};
