import { useState, useMemo } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    RefreshCw,
    Wifi,
    ShieldCheck,
    HelpCircle,
    Fingerprint,
    ChevronDown,
    CheckCircle2,
    Smartphone,
    Laptop,
    Radio,
    Cpu
} from 'lucide-react';
import { Device, ProfileRefreshSummary } from '../types';
import { apiFetch } from '../api/client';
import {
    calculateProfileCoverage,
    isHighConfidenceProfile,
    isIdentifiedVendor
} from '../lib/profileCoverage';
import { getResolvedDeviceName } from '../lib/deviceSort';
import { cn } from '../lib/utils';

interface Props {
    isOpen: boolean;
    devices: Device[];
    onClose: () => void;
    onProfileRefresh?: () => Promise<ProfileRefreshSummary>;
}

interface DhcpOptimizationResult {
    dhcpDelta?: {
        new_count?: number;
        updated_count?: number;
    };
}

export const DhcpReconnectModal: FC<Props> = ({
    isOpen,
    devices,
    onClose,
    onProfileRefresh
}) => {
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [isProfiling, setIsProfiling] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [lastOptimization, setLastOptimization] = useState<DhcpOptimizationResult | null>(null);
    const [profileResult, setProfileResult] = useState<ProfileRefreshSummary | null>(null);
    const [showReconnectTip, setShowReconnectTip] = useState(false);

    // Cakupan identitas atas perangkat terlihat: baseline langsung sebelum profiling,
    // lalu tergantikan angka hasil profiling terbaru bila ada.
    const identityCoverage = useMemo(
        () => calculateProfileCoverage(devices),
        [devices]
    );
    const eligibleDevices = useMemo(() => {
        const unique = new Map<string, Device>();
        for (const device of devices) {
            if (!device.is_online || device.is_gateway || device.is_self) continue;
            const key = device.mac?.toLowerCase();
            if (key && !unique.has(key)) unique.set(key, device);
        }
        return Array.from(unique.values());
    }, [devices]);

    if (!isOpen) return null;

    const cov = profileResult
        ? {
            visible: profileResult.visible_count,
            high: profileResult.high_confidence_count,
            medium: profileResult.medium_confidence_count,
            unknown: profileResult.unknown_count,
            pct: profileResult.coverage_percentage
        }
        : {
            visible: identityCoverage.visible,
            high: identityCoverage.highConfidence,
            medium: identityCoverage.mediumConfidence,
            unknown: identityCoverage.unknown,
            pct: identityCoverage.coveragePercentage
        };
    const pctOf = (n: number) => (cov.visible > 0 ? (n / cov.visible) * 100 : 0);

    const handleProfileRefresh = async () => {
        if (!onProfileRefresh || isProfiling) return;
        setIsProfiling(true);
        setStatusMessage('Mengumpulkan petunjuk identitas dari perangkat yang terlihat…');
        try {
            const summary = await onProfileRefresh();
            setProfileResult(summary);
            setStatusMessage(`Selesai: ${summary?.high_confidence_count ?? 0} dari ${summary?.visible_count ?? 0} perangkat teridentifikasi dengan keyakinan tinggi.`);
        } catch (e) {
            setStatusMessage(
                e instanceof Error ? `Profiling gagal: ${e.message}` : 'Profiling gagal.'
            );
        } finally {
            setTimeout(() => {
                setIsProfiling(false);
                setStatusMessage(null);
            }, 3000);
        }
    };

    const handleTriggerWakeup = async () => {
        setIsOptimizing(true);
        setLastOptimization(null);
        setStatusMessage('Menyapu ulang jaringan & mengamati sebentar untuk memunculkan perangkat baru…');
        try {
            const res = await apiFetch('/api/network/optimize-dhcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(payload.error || `Penyapuan gagal (${res.status})`);
            }
            const result = (payload.data || {}) as DhcpOptimizationResult;
            setLastOptimization(result);
            const found = (result.dhcpDelta?.new_count || 0) + (result.dhcpDelta?.updated_count || 0);
            setStatusMessage(
                found > 0
                    ? `Penyapuan selesai: ${found} perangkat baru/diperbarui.`
                    : 'Penyapuan selesai — tak ada perangkat baru saat ini.'
            );
        } catch (e) {
            setStatusMessage(
                e instanceof Error ? `Penyapuan gagal: ${e.message}` : 'Penyapuan gagal.'
            );
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
                    className="w-full max-w-2xl bg-[#090a0c] border border-white/[0.1] rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
                >
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-white/[0.08] bg-white/[0.02] flex items-center justify-between gap-4 shrink-0">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="size-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0 shadow-sm shadow-cyan-500/10">
                                <Fingerprint size={18} />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-sm font-semibold text-white tracking-tight">
                                        Identifikasi Perangkat
                                    </h2>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                                        Pasif
                                    </span>
                                </div>
                                <p className="text-xs text-zinc-400 truncate">
                                    Kenali merek, jenis & nama perangkat di jaringanmu — tanpa memutus koneksi.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="size-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors outline-none shrink-0"
                            title="Tutup"
                        >
                            <X size={15} />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 overscroll-contain">
                        {/* Hero: cakupan identitas + aksi utama */}
                        <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-500/[0.06] to-white/[0.01] border border-white/[0.08] space-y-3.5">
                            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[11px] text-zinc-400">Perangkat teridentifikasi</span>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl font-bold text-white font-mono tabular-nums">
                                            {cov.high}<span className="text-zinc-500 text-xl"> / {cov.visible}</span>
                                        </span>
                                        <span className="text-xs text-cyan-400 font-mono">
                                            {cov.pct === null ? '—' : `${cov.pct}%`}
                                        </span>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleProfileRefresh}
                                    disabled={isProfiling || !onProfileRefresh}
                                    className={cn(
                                        "shrink-0 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all border outline-none",
                                        isProfiling
                                            ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 cursor-wait animate-pulse"
                                            : "bg-cyan-500 hover:bg-cyan-400 text-black border-cyan-400 shadow-lg shadow-cyan-500/20"
                                    )}
                                >
                                    <Fingerprint size={14} className={cn(isProfiling && "animate-pulse")} />
                                    <span>{isProfiling ? 'Mengidentifikasi…' : 'Jalankan Profiling Otomatis'}</span>
                                </button>
                            </div>

                            {/* Bar tersegmentasi: tinggi / sedang / belum dikenali */}
                            <div className="flex flex-col gap-1.5">
                                <div className="h-2.5 w-full flex rounded-full overflow-hidden bg-white/[0.05] border border-white/[0.04]">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${pctOf(cov.high)}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} className="h-full bg-emerald-500" />
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${pctOf(cov.medium)}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} className="h-full bg-amber-500" />
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${pctOf(cov.unknown)}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} className="h-full bg-zinc-700" />
                                </div>
                                <div className="flex items-center gap-4 text-[10px] text-zinc-400">
                                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" />Keyakinan tinggi {cov.high}</span>
                                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" />Sedang {cov.medium}</span>
                                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-zinc-600" />Belum dikenali {cov.unknown}</span>
                                </div>
                            </div>

                            <p className="text-[11px] text-zinc-500 leading-relaxed">
                                Membangun profil dari petunjuk yang perangkat pancarkan sendiri (OUI, mDNS, DHCP, hostname). "Belum dikenali" adalah hasil yang wajar untuk perangkat yang menyembunyikan identitasnya — bukan kegagalan.
                            </p>
                        </div>

                        {/* Detail hasil profiling terakhir */}
                        {profileResult && (
                            <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-zinc-400">
                                <span className="px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06]">
                                    Durasi {(profileResult.duration_ms / 1000).toFixed(1)}s
                                </span>
                                <span className="px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06]">
                                    Punya hostname {profileResult.hostname_count}
                                </span>
                                {Object.entries(profileResult.sources || {}).map(([src, count]) => (
                                    <span key={src} className="px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06]">
                                        {src}: {count as number}
                                    </span>
                                ))}
                                {profileResult.ap_isolation && Object.keys(profileResult.ap_isolation).length > 0 && (
                                    <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">
                                        Isolasi AP membatasi cakupan
                                    </span>
                                )}
                                {profileResult.partial_failures?.length > 0 && (
                                    <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">
                                        {profileResult.partial_failures.length} sensor gagal sebagian
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Status transien */}
                        {statusMessage && (
                            <motion.div
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-200 text-xs text-center"
                            >
                                {statusMessage}
                            </motion.div>
                        )}

                        {/* Pembantu (sekunder) */}
                        <div className="space-y-2.5">
                            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Bila masih banyak yang belum dikenali</div>

                            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.07]">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="size-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-zinc-300 shrink-0">
                                        <RefreshCw size={13} className={cn(isOptimizing && "animate-spin")} />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-medium text-zinc-200">Segarkan penemuan</span>
                                        <span className="text-[10px] text-zinc-500 truncate">Sapu ulang jaringan & amati sebentar untuk memunculkan perangkat baru.</span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleTriggerWakeup}
                                    disabled={isOptimizing}
                                    className={cn(
                                        "shrink-0 py-1.5 px-3 rounded-lg text-[11px] font-medium border transition-all outline-none",
                                        isOptimizing
                                            ? "bg-white/[0.03] text-zinc-500 border-white/[0.06] cursor-wait"
                                            : "bg-white/[0.05] hover:bg-white/[0.08] text-zinc-200 border-white/[0.08]"
                                    )}
                                >
                                    {isOptimizing ? 'Menyapu…' : 'Segarkan'}
                                </button>
                            </div>

                            {lastOptimization && (
                                <div className="text-[10px] text-zinc-500 font-mono px-1">
                                    Penyapuan terakhir: {(lastOptimization.dhcpDelta?.new_count || 0) + (lastOptimization.dhcpDelta?.updated_count || 0)} perangkat baru/diperbarui.
                                </div>
                            )}

                            <div className="rounded-xl bg-white/[0.02] border border-white/[0.07] overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setShowReconnectTip(v => !v)}
                                    className="w-full flex items-center justify-between gap-3 p-3 outline-none"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <div className="size-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-zinc-300">
                                            <Wifi size={13} />
                                        </div>
                                        <span className="text-xs font-medium text-zinc-200">Minta perangkat menyambung ulang</span>
                                    </div>
                                    <ChevronDown size={14} className={cn("text-zinc-500 transition-transform", showReconnectTip && "rotate-180")} />
                                </button>
                                <AnimatePresence>
                                    {showReconnectTip && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.18 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="px-3 pb-3 pt-0 space-y-1.5 text-[11px] text-zinc-400">
                                                <p className="text-zinc-500">Perangkat paling mudah dikenali saat baru menyambung ke Wi-Fi. Minta pemiliknya:</p>
                                                <div className="flex items-center gap-2"><span className="size-4 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-mono text-zinc-300">1</span><span>Matikan Wi-Fi di perangkat.</span></div>
                                                <div className="flex items-center gap-2"><span className="size-4 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-mono text-zinc-300">2</span><span>Tunggu 3 detik, lalu nyalakan lagi.</span></div>
                                                <div className="flex items-center gap-2"><span className="size-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-mono">3</span><span>Profil diperbarui otomatis begitu perangkat menyambung.</span></div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>

                        {/* Daftar perangkat + status identitas */}
                        <div className="space-y-2 pt-1">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-semibold text-zinc-300">Perangkat di jaringan</h4>
                                <span className="text-[11px] text-zinc-500 font-mono">{eligibleDevices.length} online</span>
                            </div>

                            <div className="rounded-xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] bg-white/[0.01]">
                                {eligibleDevices.map((dev) => {
                                    const identified = isHighConfidenceProfile(dev) || isIdentifiedVendor(dev);
                                    const typeLabel = dev.device_type && !dev.device_type.toLowerCase().includes('generic') && dev.device_type.toLowerCase() !== 'unknown'
                                        ? dev.device_type
                                        : null;
                                    return (
                                        <div key={dev.ip} className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="size-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                                                    {getDeviceIcon(dev)}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-semibold text-white truncate max-w-[180px]">{getResolvedDeviceName(dev)}</span>
                                                        <span className="text-[10px] font-mono text-zinc-500">{dev.ip}</span>
                                                    </div>
                                                    <span className="text-[10px] text-zinc-500 truncate">
                                                        {identified
                                                            ? [dev.vendor, typeLabel].filter(Boolean).join(' · ')
                                                            : 'Identitas belum terkumpul'}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="shrink-0">
                                                {identified ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                                                        <CheckCircle2 size={11} />
                                                        <span>Teridentifikasi</span>
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/[0.04] text-zinc-400 border border-white/[0.08]">
                                                        <HelpCircle size={11} />
                                                        <span>Belum dikenali</span>
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
                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                            <ShieldCheck size={13} className="text-emerald-400/70" />
                            <span>Berjalan otomatis di latar; tombol ini menjalankannya sekali lagi sekarang.</span>
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
