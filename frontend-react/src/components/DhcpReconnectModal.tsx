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
import { Device, ProfileRefreshSummary } from '../types';
import { apiFetch } from '../api/client';
import {
    calculateDhcpCoverage,
    hasDhcpEvidence
} from '../lib/dhcpProfiling';
import { calculateProfileCoverage } from '../lib/profileCoverage';
import { cn } from '../lib/utils';

interface Props {
    isOpen: boolean;
    devices: Device[];
    onClose: () => void;
    onProfileRefresh?: () => Promise<ProfileRefreshSummary>;
}

interface DhcpOptimizationResult {
    delivery?: {
        attempted?: number;
        succeeded?: number;
        failed?: number;
    };
    dhcpDelta?: {
        new_count?: number;
        updated_count?: number;
    };
    cached?: boolean;
    duration_ms?: number;
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

    const profilingStats = useMemo(
        () => calculateDhcpCoverage(devices),
        [devices]
    );
    // Live client-side identity coverage over the visible devices, so the panel
    // shows a meaningful baseline before any manual profiling pass is run.
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

    const handleProfileRefresh = async () => {
        if (!onProfileRefresh || isProfiling) return;
        setIsProfiling(true);
        setStatusMessage('Mengumpulkan bukti identitas pasif untuk perangkat yang terlihat…');
        try {
            const summary = await onProfileRefresh();
            setProfileResult(summary);
            const high = summary?.high_confidence_count ?? 0;
            const visible = summary?.visible_count ?? 0;
            setStatusMessage(`Profiling selesai: ${high} dari ${visible} perangkat teridentifikasi keyakinan tinggi.`);
        } catch (e) {
            setStatusMessage(
                e instanceof Error
                    ? `Profiling gagal: ${e.message}`
                    : 'Profiling identitas gagal.'
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
        setStatusMessage('Menjalankan discovery refresh dan mengamati DHCP selama 4 detik...');
        try {
            const res = await apiFetch('/api/network/optimize-dhcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(payload.error || `Discovery Refresh gagal (${res.status})`);
            }
            const result = (payload.data || {}) as DhcpOptimizationResult;
            setLastOptimization(result);
            const newCount = result.dhcpDelta?.new_count || 0;
            const updatedCount = result.dhcpDelta?.updated_count || 0;
            setStatusMessage(
                newCount + updatedCount > 0
                    ? `Discovery selesai: ${newCount} profil DHCP baru, ${updatedCount} diperbarui.`
                    : 'Discovery selesai, tetapi tidak ada DHCP handshake baru yang teramati.'
            );
        } catch (e) {
            setStatusMessage(
                e instanceof Error
                    ? `Discovery Refresh gagal: ${e.message}`
                    : 'Discovery Refresh gagal.'
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
                                        Measured Passive Evidence
                                    </span>
                                </div>
                                <p className="text-xs text-zinc-400">
                                    Gabungkan discovery aktif yang aman dengan evidence DHCP yang benar-benar terlihat oleh controller.
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
                                <span className="text-xs text-zinc-400 font-medium">DHCP Evidence Coverage di Subnet Ini</span>
                                <div className="flex items-baseline gap-2 justify-center sm:justify-start">
                                    <span className="text-2xl font-bold text-white font-mono">
                                        {profilingStats.dhcpProfiled} / {profilingStats.eligible}
                                    </span>
                                    <span className="text-xs text-emerald-400 font-medium font-mono">
                                        ({profilingStats.dhcpPercentage === null ? 'N/A' : `${profilingStats.dhcpPercentage}%`} Evidence DHCP)
                                    </span>
                                </div>
                                <span className="text-[10px] text-zinc-500 font-mono">
                                    Discovery profile: {profilingStats.discoveryPercentage === null ? 'N/A' : `${profilingStats.discoveryPercentage}%`}
                                </span>
                            </div>

                            {/* Progress bar visual */}
                            <div className="w-full sm:w-64 flex flex-col gap-1.5">
                                <div className="h-2 w-full bg-white/[0.06] rounded-full overflow-hidden border border-white/[0.04]">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${profilingStats.dhcpPercentage || 0}%` }}
                                        transition={{ duration: 0.8, ease: "easeOut" }}
                                        className={cn(
                                            "h-full rounded-full transition-all",
                                            (profilingStats.dhcpPercentage || 0) >= 80 ? "bg-gradient-to-r from-emerald-500 to-teal-400" : "bg-gradient-to-r from-amber-500 to-orange-400"
                                        )}
                                    />
                                </div>
                                <div className="flex justify-between text-[10px] text-zinc-400 font-mono">
                                    <span>Evidence DHCP unik per MAC</span>
                                    <span>{profilingStats.dhcpPercentage === null ? 'N/A' : `${profilingStats.dhcpPercentage}%`}</span>
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
                                        <h3 className="text-xs font-semibold text-white">Metode 1: Discovery Refresh & DHCP Observation</h3>
                                    </div>
                                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                                        Kirim satu burst mDNS/SSDP/LLMNR, amati DHCP alami selama 4 detik, lalu jalankan satu scan. Metode ini <strong>tidak memaksa renewal DHCP</strong>.
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
                                    <span>{isOptimizing ? 'Mengamati & Memindai...' : 'Jalankan Discovery Refresh'}</span>
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
                                        Untuk peluang capture DHCP yang lebih tinggi, mintalah pengguna target melakukan reconnect Wi-Fi singkat:
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
                                            <span>Event diproses segera setelah paket DHCP terlihat oleh controller.</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05] text-[10px] text-zinc-400 flex items-center gap-2">
                                    <ShieldCheck size={13} className="text-emerald-400 shrink-0" />
                                    <span>Mengekstrak Option 12 (Hostname) & Option 55 (PRL Signature).</span>
                                </div>
                            </div>
                        </div>

                        {/* Metode 3: Profiling Identitas Pasif Otomatis */}
                        {onProfileRefresh && (
                            <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-500/[0.06] to-blue-500/[0.02] border border-cyan-500/20 transition-all space-y-3">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                    <div className="space-y-1.5 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <div className="size-6 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                                                <ShieldCheck size={13} />
                                            </div>
                                            <h3 className="text-xs font-semibold text-white">Metode 3: Profiling Identitas Pasif Otomatis</h3>
                                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">Tanpa Memutus Koneksi</span>
                                        </div>
                                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                                            Membangun profil perangkat dari bukti yang perangkat itu sendiri paparkan (OUI, mDNS, DHCP, hostname). <strong>Tidak ada perangkat yang diputus.</strong> Nama & vendor bisa tetap tak tersedia di jaringan terisolasi; keyakinan tinggi mengutamakan kebenaran di atas mengisi setiap baris.
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleProfileRefresh}
                                        disabled={isProfiling}
                                        className={cn(
                                            "shrink-0 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all border outline-none",
                                            isProfiling
                                                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 cursor-wait animate-pulse"
                                                : "bg-cyan-500 hover:bg-cyan-400 text-black border-cyan-400 shadow-lg shadow-cyan-500/20"
                                        )}
                                        title="Kumpulkan bukti identitas pasif untuk perangkat yang terlihat"
                                    >
                                        <Sparkles size={13} className={cn(isProfiling && "animate-pulse")} />
                                        <span>{isProfiling ? 'Memprofil…' : 'Jalankan Profiling Identitas'}</span>
                                    </button>
                                </div>

                                {/* Coverage summary (fresh result if available, else live baseline) */}
                                {(() => {
                                    const visible = profileResult?.visible_count ?? identityCoverage.visible;
                                    const high = profileResult?.high_confidence_count ?? identityCoverage.highConfidence;
                                    const medium = profileResult?.medium_confidence_count ?? identityCoverage.mediumConfidence;
                                    const unknown = profileResult?.unknown_count ?? identityCoverage.unknown;
                                    const hostname = profileResult?.hostname_count ?? identityCoverage.hostnameCount;
                                    const coverage = profileResult
                                        ? profileResult.coverage_percentage
                                        : identityCoverage.coveragePercentage;
                                    const cells = [
                                        { label: 'Terlihat', value: visible, tone: 'text-white' },
                                        { label: 'Keyakinan tinggi', value: high, tone: 'text-emerald-400' },
                                        { label: 'Sedang', value: medium, tone: 'text-amber-400' },
                                        { label: 'Belum dikenali', value: unknown, tone: 'text-zinc-400' },
                                        { label: 'Punya hostname', value: hostname, tone: 'text-cyan-400' },
                                        { label: 'Cakupan', value: coverage === null ? 'N/A' : `${coverage}%`, tone: 'text-blue-400' }
                                    ];
                                    return (
                                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                                            {cells.map((c) => (
                                                <div key={c.label} className="p-2 rounded-lg bg-white/[0.025] border border-white/[0.06] text-center">
                                                    <div className="text-[9px] text-zinc-500 uppercase tracking-wide">{c.label}</div>
                                                    <div className={cn("mt-0.5 text-sm font-mono font-semibold", c.tone)}>{c.value}</div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}

                                {profileResult && (
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-zinc-400">
                                            <span className="px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06]">
                                                Durasi {(profileResult.duration_ms / 1000).toFixed(1)}s
                                            </span>
                                            {Object.entries(profileResult.sources || {}).map(([src, count]) => (
                                                <span key={src} className="px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06]">
                                                    {src}: {count as number}
                                                </span>
                                            ))}
                                            {profileResult.ap_isolation && Object.keys(profileResult.ap_isolation).length > 0 && (
                                                <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">
                                                    Isolasi AP dapat membatasi cakupan
                                                </span>
                                            )}
                                        </div>
                                        {profileResult.partial_failures && profileResult.partial_failures.length > 0 && (
                                            <div className="text-[10px] text-amber-300 font-mono">
                                                {profileResult.partial_failures.length} sensor gagal sebagian — hasil tetap ditampilkan apa adanya.
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="flex items-start gap-1.5 text-[10px] text-zinc-500 leading-relaxed">
                                    <HelpCircle size={12} className="text-zinc-600 shrink-0 mt-0.5" />
                                    <span>"Belum dikenali" adalah hasil yang disengaja ketika bukti belum cukup — bukan kegagalan. Perangkat privasi-tinggi memang bisa tak terprofilkan.</span>
                                </div>
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

                        {lastOptimization && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div className="p-2.5 rounded-lg bg-white/[0.025] border border-white/[0.06]">
                                    <div className="text-[9px] text-zinc-500 uppercase">Datagram terkirim</div>
                                    <div className="mt-1 text-sm font-mono text-emerald-400">
                                        {lastOptimization.delivery?.succeeded || 0}
                                    </div>
                                </div>
                                <div className="p-2.5 rounded-lg bg-white/[0.025] border border-white/[0.06]">
                                    <div className="text-[9px] text-zinc-500 uppercase">Datagram gagal</div>
                                    <div className="mt-1 text-sm font-mono text-amber-400">
                                        {lastOptimization.delivery?.failed || 0}
                                    </div>
                                </div>
                                <div className="p-2.5 rounded-lg bg-white/[0.025] border border-white/[0.06]">
                                    <div className="text-[9px] text-zinc-500 uppercase">DHCP baru</div>
                                    <div className="mt-1 text-sm font-mono text-cyan-400">
                                        {lastOptimization.dhcpDelta?.new_count || 0}
                                    </div>
                                </div>
                                <div className="p-2.5 rounded-lg bg-white/[0.025] border border-white/[0.06]">
                                    <div className="text-[9px] text-zinc-500 uppercase">DHCP diperbarui</div>
                                    <div className="mt-1 text-sm font-mono text-blue-400">
                                        {lastOptimization.dhcpDelta?.updated_count || 0}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Device List Status Breakdown */}
                        <div className="space-y-2.5 pt-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                                    Daftar Status Perangkat di Subnet
                                </h4>
                                <span className="text-[11px] text-zinc-500 font-mono">
                                    {eligibleDevices.length} Perangkat Online
                                </span>
                            </div>

                            <div className="rounded-xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] bg-white/[0.01]">
                                {eligibleDevices.map((dev) => {
                                    const hasDhcp = hasDhcpEvidence(dev);
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
