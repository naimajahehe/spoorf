import { useState, useMemo } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Zap,
    RefreshCw,
    Wifi,
    CheckCircle2,
    Clock,
    Smartphone,
    Laptop,
    Radio,
    Cpu,
    Sparkles,
    ShieldCheck,
    HelpCircle
} from 'lucide-react';
import { Device } from '../types';
import { getApiUrl } from '../api/client';
import { cn } from '../lib/utils';

interface Props {
    isOpen: boolean;
    devices: Device[];
    onClose: () => void;
    onTriggerReScan: () => void;
    onQuickReauth?: () => Promise<any>;
}

export const DhcpReconnectModal: FC<Props> = ({
    isOpen,
    devices,
    onClose,
    onTriggerReScan,
    onQuickReauth
}) => {
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [isReauthing, setIsReauthing] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    // Hitung rasio profiling Teknik 3B
    const profilingStats = useMemo(() => {
        const nonGatewayDevices = devices.filter(d => !d.is_gateway && d.is_online);
        const total = nonGatewayDevices.length;
        const profiled = nonGatewayDevices.filter(d => 
            Boolean(d.dhcp_fingerprint || d.dhcp_vendor_class || (d.hostname && !d.hostname.startsWith('Unknown') && d.hostname !== d.ip))
        ).length;
        const percentage = total > 0 ? Math.round((profiled / total) * 100) : 100;
        return { total, profiled, percentage };
    }, [devices]);

    const unknownCount = Math.max(0, profilingStats.total - profilingStats.profiled);

    if (!isOpen) return null;

    const handleQuickReauth = async () => {
        if (!onQuickReauth || unknownCount === 0) return;
        setIsReauthing(true);
        setStatusMessage(`⚡ Micro-cut serentak ${unknownCount} perangkat Unknown untuk memancing DHCP…`);
        try {
            await onQuickReauth();
            setStatusMessage('✅ Selesai memancing reconnect — memindai ulang profil...');
            onTriggerReScan();
        } catch (e) {
            setStatusMessage('⚠️ Gagal menjalankan Quick Re-Auth, coba lagi.');
        } finally {
            setTimeout(() => {
                setIsReauthing(false);
                setStatusMessage(null);
            }, 2800);
        }
    };

    const handleTriggerWakeup = async () => {
        setIsOptimizing(true);
        setStatusMessage('Menyiarkan DHCP & Multicast Wake-up Burst...');
        try {
            const res = await fetch(`${getApiUrl()}/api/network/optimize-dhcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (res.ok) {
                setStatusMessage('✅ Sinyal wake-up terkirim! Memindai ulang profil jaringan...');
                onTriggerReScan();
            } else {
                setStatusMessage('⚠️ Gagal mengirim sinyal wake-up, menjalankan scan fallback...');
                onTriggerReScan();
            }
        } catch (e) {
            setStatusMessage('⚠️ Menjalankan scan lokal...');
            onTriggerReScan();
        } finally {
            setTimeout(() => {
                setIsOptimizing(false);
                setStatusMessage(null);
            }, 2500);
        }
    };

    const getDeviceIcon = (device: Device) => {
        if (device.is_gateway) return <Radio size={14} className="text-amber-400" />;
        const os = (device.os || '').toLowerCase();
        const host = (device.hostname || '').toLowerCase();
        const vendor = (device.vendor || '').toLowerCase();
        if (os.includes('android') || os.includes('ios') || host.includes('phone') || vendor.includes('xiaomi') || vendor.includes('samsung')) {
            return <Smartphone size={14} className="text-blue-400" />;
        }
        if (os.includes('windows') || os.includes('mac') || host.includes('desktop') || host.includes('laptop')) {
            return <Laptop size={14} className="text-emerald-400" />;
        }
        return <Cpu size={14} className="text-zinc-400" />;
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full max-w-3xl bg-[#090a0c] border border-white/[0.1] rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
                >
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-white/[0.08] bg-white/[0.02] flex items-center justify-between gap-4 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="size-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0 shadow-sm shadow-amber-500/10">
                                <Zap size={18} />
                            </div>
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-sm font-semibold text-white tracking-tight">
                                        Optimasi Teknik 3B (DHCP Profiling)
                                    </h2>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                        Zero-Second Passive Fingerprint
                                    </span>
                                </div>
                                <p className="text-xs text-zinc-400">
                                    Tangkap nama host asli, OS, dan signature perangkat secara deterministik saat handshake Wi-Fi.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="size-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors outline-none"
                            title="Tutup Modal"
                        >
                            <X size={15} />
                        </button>
                    </div>

                    {/* Scrollable Body */}
                    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 overscroll-contain">
                        {/* Hero Stats Meter */}
                        <div className="p-4 rounded-xl bg-gradient-to-r from-white/[0.04] to-white/[0.01] border border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div className="flex flex-col gap-1 text-center sm:text-left">
                                <span className="text-xs text-zinc-400 font-medium">Status Profiling Teknik 3B di Subnet Ini</span>
                                <div className="flex items-baseline gap-2 justify-center sm:justify-start">
                                    <span className="text-2xl font-bold text-white font-mono">{profilingStats.profiled} / {profilingStats.total}</span>
                                    <span className="text-xs text-emerald-400 font-medium font-mono">({profilingStats.percentage}% Perangkat Ter-profiling)</span>
                                </div>
                            </div>

                            {/* Progress bar visual */}
                            <div className="w-full sm:w-64 flex flex-col gap-1.5">
                                <div className="h-2 w-full bg-white/[0.06] rounded-full overflow-hidden border border-white/[0.04]">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${profilingStats.percentage}%` }}
                                        transition={{ duration: 0.8, ease: "easeOut" }}
                                        className={cn(
                                            "h-full rounded-full transition-all",
                                            profilingStats.percentage >= 80 ? "bg-gradient-to-r from-emerald-500 to-teal-400" : "bg-gradient-to-r from-amber-500 to-orange-400"
                                        )}
                                    />
                                </div>
                                <div className="flex justify-between text-[10px] text-zinc-400 font-mono">
                                    <span>Handshake Terekam</span>
                                    <span>{profilingStats.percentage}%</span>
                                </div>
                            </div>
                        </div>

                        {/* Dual Action Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Card 1: Trigger Wakeup from Controller */}
                            <div className="p-4 rounded-xl bg-white/[0.025] border border-white/[0.08] hover:border-amber-500/30 transition-all flex flex-col justify-between gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <div className="size-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
                                            <Sparkles size={13} />
                                        </div>
                                        <h3 className="text-xs font-semibold text-white">Metode 1: Pemicu Otomatis (Controller)</h3>
                                    </div>
                                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                                        Kirim siaran <strong>Multicast & ARP Wake-Up Burst</strong> ke seluruh subnet untuk membangunkan radio Wi-Fi perangkat yang tertidur dan memancing perbaruan sewa IP DHCP.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleTriggerWakeup}
                                    disabled={isOptimizing}
                                    className={cn(
                                        "w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all border outline-none",
                                        isOptimizing
                                            ? "bg-amber-500/20 text-amber-300 border-amber-500/40 cursor-wait animate-pulse"
                                            : "bg-amber-500 hover:bg-amber-400 text-black border-amber-400 shadow-lg shadow-amber-500/20"
                                    )}
                                >
                                    <RefreshCw size={13} className={cn(isOptimizing && "animate-spin")} />
                                    <span>{isOptimizing ? 'Mengoptimasi & Memindai...' : '🚀 Trigger Wake-Up & Re-Scan'}</span>
                                </button>
                            </div>

                            {/* Card 2: Target Reconnect Guide */}
                            <div className="p-4 rounded-xl bg-white/[0.025] border border-white/[0.08] hover:border-blue-500/30 transition-all flex flex-col justify-between gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <div className="size-6 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                                            <Wifi size={13} />
                                        </div>
                                        <h3 className="text-xs font-semibold text-white">Metode 2: Reconnect Perangkat Target</h3>
                                    </div>
                                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                                        Untuk akurasi 100%, mintalah pengguna target melakukan reconnect Wi-Fi singkat:
                                    </p>
                                    <div className="space-y-1.5 text-[11px] text-zinc-300">
                                        <div className="flex items-center gap-2">
                                            <span className="size-4 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-mono text-white">1</span>
                                            <span>Matikan Wi-Fi di HP/Laptop target.</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="size-4 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-mono text-white">2</span>
                                            <span>Tunggu <strong>3 detik</strong>, lalu hidupkan kembali.</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="size-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-mono">3</span>
                                            <span>Teknik 3B menangkap handshake dalam <strong>0 detik!</strong></span>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05] text-[10px] text-zinc-400 flex items-center gap-2">
                                    <ShieldCheck size={13} className="text-emerald-400 shrink-0" />
                                    <span>Mengekstrak Option 12 (Hostname) & Option 55 (PRL Signature).</span>
                                </div>
                            </div>
                        </div>

                        {/* Metode 3: Quick Re-Auth Profiling (Micro-Cut Serentak) */}
                        {onQuickReauth && (
                            <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-500/[0.06] to-blue-500/[0.02] border border-cyan-500/20 hover:border-cyan-500/40 transition-all flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div className="space-y-1.5 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div className="size-6 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                                            <Zap size={13} />
                                        </div>
                                        <h3 className="text-xs font-semibold text-white">Metode 3: Quick Re-Auth Profiling (Otomatis)</h3>
                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">Micro-Cut Serentak</span>
                                    </div>
                                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                                        Memutus akses ~1,5 detik lalu memulihkannya <strong>serentak</strong> ke semua perangkat yang masih Unknown untuk <strong>memancing</strong> DHCP REQUEST baru. Gateway, perangkat ini, dan perangkat yang sedang diblokir tidak terganggu.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleQuickReauth}
                                    disabled={isReauthing || unknownCount === 0}
                                    className={cn(
                                        "shrink-0 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all border outline-none",
                                        isReauthing
                                            ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 cursor-wait animate-pulse"
                                            : unknownCount === 0
                                                ? "bg-white/[0.03] text-zinc-600 border-white/[0.06] cursor-not-allowed opacity-50"
                                                : "bg-cyan-500 hover:bg-cyan-400 text-black border-cyan-400 shadow-lg shadow-cyan-500/20"
                                    )}
                                    title={unknownCount === 0 ? 'Semua perangkat sudah ter-profiling' : `Pancing ${unknownCount} perangkat Unknown`}
                                >
                                    <Zap size={13} className={cn(isReauthing && "animate-pulse")} />
                                    <span>{isReauthing ? 'Memancing…' : `⚡ Quick Re-Auth (${unknownCount})`}</span>
                                </button>
                            </div>
                        )}

                        {statusMessage && (
                            <motion.div
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-mono text-center"
                            >
                                {statusMessage}
                            </motion.div>
                        )}

                        {/* Device List Status Breakdown */}
                        <div className="space-y-2.5 pt-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                                    Daftar Status Perangkat di Subnet
                                </h4>
                                <span className="text-[11px] text-zinc-500 font-mono">
                                    {devices.filter(d => !d.is_gateway && d.is_online).length} Perangkat Online
                                </span>
                            </div>

                            <div className="rounded-xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] bg-white/[0.01]">
                                {devices.filter(d => !d.is_gateway && d.is_online).map((dev) => {
                                    const hasDhcp = Boolean(dev.dhcp_fingerprint || dev.dhcp_vendor_class);
                                    const devName = dev.alias && dev.alias.trim() !== ''
                                        ? dev.alias.trim()
                                        : (dev.hostname && dev.hostname.trim() !== '' ? dev.hostname : dev.ip);

                                    return (
                                        <div key={dev.ip} className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="size-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                                                    {getDeviceIcon(dev)}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-semibold text-white truncate max-w-[180px]">
                                                            {devName}
                                                        </span>
                                                        <span className="text-[10px] font-mono text-zinc-400">
                                                            {dev.ip}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] text-zinc-400 font-mono truncate">
                                                        {dev.dhcp_vendor_class || dev.dhcp_fingerprint || dev.vendor || 'Generic Device'}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="shrink-0">
                                                {hasDhcp ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                                        <CheckCircle2 size={11} />
                                                        <span>Ter-profiling 3B</span>
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                                        <Clock size={11} />
                                                        <span>Menunggu Reconnect</span>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-3.5 border-t border-white/[0.08] bg-white/[0.02] flex items-center justify-between gap-3 shrink-0">
                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                            <HelpCircle size={13} className="text-zinc-500" />
                            <span>Teknik 3B berjalan otomatis secara pasif di latar belakang.</span>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-white text-xs font-medium transition-colors border border-white/[0.1] outline-none"
                        >
                            Tutup
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
