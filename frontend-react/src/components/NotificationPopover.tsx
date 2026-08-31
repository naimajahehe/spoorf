import { useState, useRef, useEffect } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CheckCheck,
    Smartphone,
    Laptop,
    Radio,
    Cpu,
    Zap,
    AlertTriangle,
    WifiOff,
    Trash2,
    Bell,
    BellOff,
    ExternalLink
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Device } from '../types';

export interface NotificationItem {
    id: string;
    category: 'device' | 'security' | 'activity';
    senderName: string;
    actionText: string;
    targetName: string;
    timestamp: Date;
    timeAgo: string;
    isRead: boolean;
    bubbleText?: string;
    type: 'new_device' | 'reconnected' | 'auto_reblock' | 'rogue_dhcp' | 'throttled' | 'system';
    device?: Device;
    deviceIp?: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    notifications: NotificationItem[];
    isMuted?: boolean;
    onToggleMute?: () => void;
    onMarkAllRead: () => void;
    onClearAll: () => void;
    onBlockDevice?: (device: Device) => void;
    onInspectDevice?: (ip: string) => void;
}

type TabType = 'all' | 'device' | 'security';

function cleanDeviceName(name?: string): string {
    if (!name) return '';
    return name
        .replace(/\(.*?\)/g, '')
        .replace(/Private Device/gi, '')
        .replace(/Randomized MAC/gi, '')
        .trim();
}

export const NotificationPopover: FC<Props> = ({
    isOpen,
    onClose,
    notifications,
    isMuted = false,
    onToggleMute,
    onMarkAllRead,
    onClearAll,
    onBlockDevice,
    onInspectDevice
}) => {
    const [activeTab, setActiveTab] = useState<TabType>('all');
    const popoverRef = useRef<HTMLDivElement>(null);

    // Close on click outside, but ignore clicks on the toggle trigger button
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element | null;
            if (target?.closest('[data-notification-trigger]')) {
                return;
            }
            if (popoverRef.current && !popoverRef.current.contains(target as Node)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    const counts = {
        all: notifications.length,
        device: notifications.filter(n => n.category === 'device').length,
        security: notifications.filter(n => n.category === 'security').length
    };

    const filteredList = notifications.filter(item => {
        if (activeTab === 'all') return true;
        return item.category === activeTab;
    });

    const getDeviceIcon = (item: NotificationItem) => {
        const dev = item.device;

        if (item.type === 'rogue_dhcp') {
            return <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />;
        }

        if (item.type === 'auto_reblock') {
            return <Zap size={16} className="text-amber-400 shrink-0 mt-0.5" />;
        }

        if (!dev) {
            return <Cpu size={16} className="text-zinc-400 shrink-0 mt-0.5" />;
        }

        const os = (dev.os || '').toLowerCase();
        const host = (dev.hostname || dev.alias || '').toLowerCase();
        const vendor = (dev.vendor || '').toLowerCase();

        if (
            os.includes('android') ||
            os.includes('ios') ||
            host.includes('phone') ||
            host.includes('galaxy') ||
            host.includes('iphone') ||
            host.includes('redmi') ||
            host.includes('xiaomi') ||
            host.includes('oppo') ||
            host.includes('vivo') ||
            host.includes('realme') ||
            host.includes('infinix') ||
            vendor.includes('samsung') ||
            vendor.includes('apple') ||
            vendor.includes('xiaomi')
        ) {
            return <Smartphone size={16} className="text-emerald-400 shrink-0 mt-0.5" />;
        }

        if (
            os.includes('windows') ||
            os.includes('mac') ||
            os.includes('linux') ||
            host.includes('laptop') ||
            host.includes('desktop') ||
            host.includes('pc') ||
            host.includes('macbook') ||
            vendor.includes('lenovo') ||
            vendor.includes('dell') ||
            vendor.includes('hp') ||
            vendor.includes('asus') ||
            vendor.includes('acer')
        ) {
            return <Laptop size={16} className="text-cyan-400 shrink-0 mt-0.5" />;
        }

        if (dev.is_gateway) {
            return <Radio size={16} className="text-amber-400 shrink-0 mt-0.5" />;
        }

        return <Cpu size={16} className="text-zinc-400 shrink-0 mt-0.5" />;
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    ref={popoverRef}
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 top-11 w-[350px] sm:w-[380px] max-h-[490px] bg-[#0e1014]/98 backdrop-blur-2xl border border-white/[0.1] rounded-2xl shadow-2xl shadow-black/90 z-50 flex flex-col overflow-hidden text-zinc-100 font-sans"
                >
                    {/* Header */}
                    <div className="px-3.5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-white tracking-tight">
                                Notifications
                            </h3>
                            {onToggleMute && (
                                <button
                                    type="button"
                                    onClick={onToggleMute}
                                    className={cn(
                                        "px-2 py-0.5 rounded-md text-[11px] font-mono flex items-center gap-1 border transition-all",
                                        isMuted
                                            ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                                            : "bg-white/[0.04] border-white/[0.08] text-zinc-400 hover:text-white hover:bg-white/[0.08]"
                                    )}
                                    title={isMuted ? "Notifikasi Dinonaktifkan (Klik untuk Aktifkan)" : "Notifikasi Aktif (Klik untuk Mematikan)"}
                                >
                                    {isMuted ? <BellOff size={11} className="text-amber-400" /> : <Bell size={11} />}
                                    <span>{isMuted ? 'Muted' : 'Sound On'}</span>
                                </button>
                            )}
                        </div>

                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={onMarkAllRead}
                                className="size-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors outline-none"
                                title="Tandai semua dibaca"
                            >
                                <CheckCheck size={15} />
                            </button>
                            <button
                                type="button"
                                onClick={onClearAll}
                                className="size-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors outline-none"
                                title="Bersihkan riwayat"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Segmented Filter Tabs */}
                    <div className="px-3.5 py-2 bg-white/[0.015] border-b border-white/[0.04]">
                        <div className="p-1 rounded-xl bg-black/40 border border-white/[0.06] flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setActiveTab('all')}
                                className={cn(
                                    "flex-1 py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all outline-none",
                                    activeTab === 'all'
                                        ? "bg-white text-black font-semibold shadow-sm"
                                        : "text-zinc-400 hover:text-zinc-200"
                                )}
                            >
                                <span>View all</span>
                                <span className={cn(
                                    "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                                    activeTab === 'all' ? "bg-black/10 text-black font-bold" : "bg-white/[0.08] text-zinc-400"
                                )}>
                                    {counts.all}
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab('device')}
                                className={cn(
                                    "flex-1 py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all outline-none",
                                    activeTab === 'device'
                                        ? "bg-white text-black font-semibold shadow-sm"
                                        : "text-zinc-400 hover:text-zinc-200"
                                )}
                            >
                                <span>Perangkat</span>
                                <span className={cn(
                                    "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                                    activeTab === 'device' ? "bg-black/10 text-black font-bold" : "bg-white/[0.08] text-zinc-400"
                                )}>
                                    {counts.device}
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab('security')}
                                className={cn(
                                    "flex-1 py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all outline-none",
                                    activeTab === 'security'
                                        ? "bg-white text-black font-semibold shadow-sm"
                                        : "text-zinc-400 hover:text-zinc-200"
                                )}
                            >
                                <span>Keamanan</span>
                                <span className={cn(
                                    "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                                    activeTab === 'security' ? "bg-black/10 text-black font-bold" : "bg-white/[0.08] text-zinc-400"
                                )}>
                                    {counts.security}
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Notification Items List */}
                    <div className="flex-1 overflow-y-auto max-h-[350px] p-3.5 divide-y divide-white/[0.04] space-y-3">
                        {filteredList.length === 0 ? (
                            <div className="py-10 flex flex-col items-center justify-center text-center text-zinc-500 gap-1">
                                <p className="text-xs font-medium text-zinc-300">Tidak ada notifikasi</p>
                                <p className="text-[11px] text-zinc-500">Aktivitas jaringan terbaru akan muncul di sini.</p>
                            </div>
                        ) : (
                            filteredList.map((item) => {
                                const cleanSender = cleanDeviceName(item.senderName);
                                return (
                                    <div key={item.id} className="pt-3 first:pt-0 flex items-start gap-3 relative group">
                                        {/* Left Avatar / Device Icon (Consistent Color) */}
                                        {getDeviceIcon(item)}

                                        {/* Right Body */}
                                        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                                            {/* Row 1: Header title & timestamp */}
                                            <div className="flex items-baseline justify-between gap-2">
                                                <p className="text-xs text-zinc-300 leading-snug truncate">
                                                    <strong className="font-semibold text-white">
                                                        {cleanSender}
                                                    </strong>{' '}
                                                    <span className="text-zinc-400">{item.actionText}</span>{' '}
                                                    <strong className="font-medium text-zinc-200">
                                                        {item.targetName}
                                                    </strong>
                                                </p>

                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {!item.isRead && (
                                                        <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" />
                                                    )}
                                                    <span className="text-[10px] font-mono text-zinc-500">
                                                        {item.timeAgo}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Optional Detail Bubble Box (Cleaned) */}
                                            {item.bubbleText && (
                                                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-zinc-300 leading-relaxed font-sans">
                                                    {cleanDeviceName(item.bubbleText)}
                                                </div>
                                            )}

                                            {/* Optional Quick Action Buttons */}
                                            {item.device && (
                                                <div className="flex items-center gap-2 pt-0.5">
                                                    {onBlockDevice && (
                                                        <button
                                                            type="button"
                                                            onClick={() => onBlockDevice(item.device!)}
                                                            className="py-1 px-3 rounded-lg text-xs font-semibold bg-white text-black hover:bg-zinc-200 transition-colors shadow-sm outline-none flex items-center gap-1"
                                                        >
                                                            <WifiOff size={11} className="text-black shrink-0" />
                                                            <span>Putus Akses</span>
                                                        </button>
                                                    )}

                                                    {onInspectDevice && item.deviceIp && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                onInspectDevice(item.deviceIp!);
                                                                onClose();
                                                            }}
                                                            className="py-1 px-3 rounded-lg text-xs font-medium bg-white/[0.06] text-zinc-300 hover:bg-white/[0.12] hover:text-white border border-white/[0.08] transition-colors outline-none flex items-center gap-1"
                                                        >
                                                            <ExternalLink size={11} className="text-zinc-400 shrink-0" />
                                                            <span>Lihat Detail</span>
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
