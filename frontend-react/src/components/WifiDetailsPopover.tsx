import { FC, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Wifi,
    ShieldCheck,
    ShieldAlert,
    Radio,
    RefreshCw,
    CheckCircle2,
    XCircle,
    HelpCircle,
    Layers,
    X
} from 'lucide-react';
import { ApIsolationInfo, Device } from '../types';
import { cn } from '../lib/utils';

export interface WifiInfo {
    connected: boolean;
    ssid: string;
    signal?: string;
    state?: string;
    bssid?: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    wifiInfo: WifiInfo;
    apIsolation: ApIsolationInfo | null;
    gateway: Device | null;
    isCheckingWifi?: boolean;
    onRefreshApIsolation?: () => void;
    isRefreshing?: boolean;
}

export const WifiDetailsPopover: FC<Props> = ({
    isOpen,
    onClose,
    wifiInfo,
    apIsolation,
    gateway,
    isCheckingWifi = false,
    onRefreshApIsolation,
    isRefreshing = false
}) => {
    const popoverRef = useRef<HTMLDivElement>(null);

    // Click outside handler
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const percentage = apIsolation?.percentage ?? 0;

    // Status Styling: Solid colors for maximum clarity and contrast
    const getStatusTheme = () => {
        if (percentage >= 90) {
            return {
                bgBadge: 'bg-red-600 text-white',
                borderBox: 'border-red-600/40 bg-[#1e1315]',
                icon: <ShieldAlert size={16} className="text-red-400" />,
                title: 'AP Isolation Aktif (100% Confirmed)',
                desc: 'Router memblokir seluruh paket Layer 2 langsung antar perangkat di jaringan.',
                colorText: 'text-red-400'
            };
        }
        if (percentage >= 70) {
            return {
                bgBadge: 'bg-amber-600 text-white',
                borderBox: 'border-amber-600/40 bg-[#1c1712]',
                icon: <ShieldAlert size={16} className="text-amber-400" />,
                title: 'Kemungkinan AP Isolation',
                desc: 'Hanya gateway yang membalas dan pantulan siaran multicast di udara diblokir router.',
                colorText: 'text-amber-400'
            };
        }
        if (percentage >= 30) {
            return {
                bgBadge: 'bg-yellow-600 text-white',
                borderBox: 'border-yellow-600/40 bg-[#1a1812]',
                icon: <HelpCircle size={16} className="text-yellow-400" />,
                title: 'Jaringan Sepi / Idle',
                desc: 'Belum ada perangkat lain yang terdeteksi aktif selain controller dan gateway.',
                colorText: 'text-yellow-400'
            };
        }
        return {
            bgBadge: 'bg-emerald-600 text-white',
            borderBox: 'border-emerald-600/40 bg-[#111c16]',
            icon: <ShieldCheck size={16} className="text-emerald-400" />,
            title: 'Normal (Layer 2 Terbuka)',
            desc: 'Komunikasi Layer 2 (ARP & Multicast) bebas antar perangkat di subnet yang sama.',
            colorText: 'text-emerald-400'
        };
    };

    const theme = getStatusTheme();

    return (
        <AnimatePresence>
            <motion.div
                ref={popoverRef}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="absolute top-full right-0 mt-2.5 w-[360px] bg-[#14161d] border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden z-50 text-zinc-100 flex flex-col font-sans"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#191c24] border-b border-zinc-800">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                            <Wifi size={16} />
                        </div>
                        <div>
                            <h3 className="text-xs font-bold text-white tracking-wide truncate max-w-[200px]">
                                {wifiInfo.ssid || 'Wi-Fi Network'}
                            </h3>
                            <p className="text-[11px] text-zinc-400 font-mono">
                                {wifiInfo.connected ? 'Status: Terhubung' : 'Status: Terputus'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                        title="Tutup"
                    >
                        <X size={15} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="p-4 space-y-3.5">
                    {/* AP Isolation Main Score Box */}
                    <div className={cn("p-3.5 rounded-xl border flex flex-col gap-2.5", theme.borderBox)}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {theme.icon}
                                <span className="text-xs font-bold text-white">AP Isolation</span>
                            </div>
                            <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold font-mono tracking-wider uppercase shadow-sm", theme.bgBadge)}>
                                {percentage}%
                            </span>
                        </div>
                        <div>
                            <h4 className={cn("text-xs font-semibold", theme.colorText)}>
                                {theme.title}
                            </h4>
                            <p className="text-[11px] text-zinc-300/90 leading-relaxed mt-0.5">
                                {theme.desc}
                            </p>
                        </div>
                    </div>

                    {/* Diagnostic Indicator Breakdown */}
                    <div className="bg-[#181a22] border border-zinc-800 rounded-xl p-3 space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 mb-1.5">
                            <Layers size={12} className="text-zinc-400" />
                            <span>Hasil Uji Sensor Fisik</span>
                        </div>

                        {/* Indikator 1: Multicast BSSID Echo */}
                        <div className="flex items-center justify-between text-xs py-1 border-b border-zinc-800/60">
                            <span className="text-zinc-300 text-[11px]">Pantulan Multicast BSSID:</span>
                            {apIsolation?.indicators?.multicast_echo_blocked ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400">
                                    <XCircle size={13} /> Diblokir AP
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                                    <CheckCircle2 size={13} /> Diterima
                                </span>
                            )}
                        </div>

                        {/* Indikator 2: L2 Peers Found */}
                        <div className="flex items-center justify-between text-xs py-1 border-b border-zinc-800/60">
                            <span className="text-zinc-300 text-[11px]">Perangkat Layer 2 Lain:</span>
                            <span className={cn(
                                "text-[11px] font-semibold font-mono",
                                (apIsolation?.indicators?.l2_peers_found ?? 0) > 0 ? "text-emerald-400" : "text-amber-400"
                            )}>
                                {apIsolation?.indicators?.l2_peers_found ?? 0} Perangkat
                            </span>
                        </div>

                        {/* Indikator 3: Gateway L3 Hairpinning */}
                        <div className="flex items-center justify-between text-xs py-1">
                            <span className="text-zinc-300 text-[11px]">L3 Gateway Hairpinning:</span>
                            {apIsolation?.indicators?.l3_hairpinning_confirmed ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400">
                                    <CheckCircle2 size={13} /> Terisolasi L2
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                                    Tidak Terdeteksi
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Network Gateway Quick Details */}
                    {gateway && (
                        <div className="bg-[#181a22] border border-zinc-800 rounded-xl p-3 space-y-1.5 text-[11px]">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 mb-1">
                                <Radio size={12} className="text-amber-400" />
                                <span>Default Gateway (Router)</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">IP Gateway:</span>
                                <span className="font-mono text-white font-medium">{gateway.ip}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">MAC Gateway:</span>
                                <span className="font-mono text-zinc-300">{gateway.mac}</span>
                            </div>
                            {gateway.vendor && (
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Vendor:</span>
                                    <span className="text-zinc-200 truncate max-w-[170px]">{gateway.vendor}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Action */}
                <div className="p-3 bg-[#191c24] border-t border-zinc-800 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">
                        {isRefreshing ? 'Sedang menguji...' : 'Uji diagnostik mandiri'}
                    </span>
                    {onRefreshApIsolation && (
                        <button
                            type="button"
                            onClick={onRefreshApIsolation}
                            disabled={isRefreshing || isCheckingWifi}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white text-xs font-semibold transition-all disabled:opacity-50"
                        >
                            <RefreshCw size={12} className={cn(isRefreshing && "animate-spin text-emerald-400")} />
                            <span>Uji Ulang</span>
                        </button>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );
};
