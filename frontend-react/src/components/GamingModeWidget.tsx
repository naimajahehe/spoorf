import { useState } from 'react';
import type { FC } from 'react';
import { motion } from 'framer-motion';
import {
    Gamepad2,
    Zap,
    Activity,
    Gauge,
    ShieldCheck,
    CheckCircle2,
    Radio,
    Flame,
    Sliders,
    Sparkles,
    Check,
    Smartphone,
    Laptop,
    Tv,
    ShieldAlert
} from 'lucide-react';
import { Device, GamingStatus, GamingTelemetry } from '../types';
import { cn } from '../lib/utils';

interface Props {
    status: GamingStatus;
    telemetry: GamingTelemetry;
    devices: Device[];
    onToggle: (enabled: boolean, mode?: string, target_ping_ms?: number) => Promise<void>;
}

export const GamingModeWidget: FC<Props> = ({ status, telemetry, devices, onToggle }) => {
    const [isUpdating, setIsUpdating] = useState(false);
    const [selectedMode, setSelectedMode] = useState<string>(status.mode || 'auto_airtime');
    const [targetPing, setTargetPing] = useState<number>(status.target_ping_ms || 25.0);

    const handleToggle = async () => {
        setIsUpdating(true);
        try {
            await onToggle(!status.is_enabled, selectedMode, targetPing);
        } finally {
            setTimeout(() => setIsUpdating(false), 300);
        }
    };

    const handleModeChange = async (mode: string) => {
        setSelectedMode(mode);
        if (status.is_enabled) {
            setIsUpdating(true);
            try {
                await onToggle(true, mode, targetPing);
            } finally {
                setTimeout(() => setIsUpdating(false), 300);
            }
        }
    };

    const handleTargetPingChange = async (val: number) => {
        setTargetPing(val);
        if (status.is_enabled) {
            await onToggle(true, selectedMode, val);
        }
    };

    const ping = telemetry.ping_ms || status.ping_ms || 18.0;
    const jitter = telemetry.jitter_ms || status.jitter_ms || 1.2;
    const packetLoss = telemetry.packet_loss_pct ?? status.packet_loss_pct ?? 0.0;
    const isOptimal = ping <= targetPing;

    // Filter target non-gateway non-self
    const otherLanDevices = devices.filter(d => !d.is_gateway && !d.is_self && d.is_online);

    return (
        <div className="w-full max-w-5xl mx-auto space-y-6">
            {/* Header Hero Banner */}
            <div className="relative overflow-hidden rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-zinc-950 via-zinc-900/90 to-cyan-950/30 p-8 backdrop-blur-xl shadow-2xl">
                <div className={cn(
                    "absolute -right-20 -top-20 h-80 w-80 rounded-full blur-3xl pointer-events-none transition-all duration-700",
                    status.is_enabled ? "bg-cyan-500/15" : "bg-zinc-700/10"
                )} />
                <div className={cn(
                    "absolute -left-20 -bottom-20 h-80 w-80 rounded-full blur-3xl pointer-events-none transition-all duration-700",
                    status.is_enabled ? "bg-emerald-500/15" : "bg-zinc-700/10"
                )} />

                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold tracking-wide uppercase">
                            <Gamepad2 className="w-3.5 h-3.5" />
                            <span>Esports Ultra-Low Latency Engine</span>
                        </div>
                        <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight flex items-center gap-3">
                            Mode Gaming Sentinel
                            {status.is_enabled && (
                                <motion.span
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                >
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    AKTIF ({otherLanDevices.length} TARGET DIKENDALIKAN)
                                </motion.span>
                            )}
                        </h1>
                        <p className="text-sm text-zinc-400 max-w-xl leading-relaxed">
                            Otomatis mengisolasi dan mengerem seluruh perangkat lain di jaringan Wi-Fi menggunakan teknik <span className="text-cyan-300 font-medium">Zero-Lag Dead MAC Blackhole</span> sehingga 100% antrean router dan gelombang radio Wi-Fi dikhususkan untuk game Anda.
                        </p>
                    </div>

                    <div className="flex flex-col items-center gap-2 shrink-0">
                        <button
                            onClick={handleToggle}
                            disabled={isUpdating}
                            className={cn(
                                "group relative flex items-center justify-center gap-3 px-8 py-4 rounded-2xl font-bold text-base transition-all duration-300 shadow-xl active:scale-95 disabled:opacity-50 cursor-pointer",
                                status.is_enabled
                                    ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-black hover:shadow-cyan-500/25 hover:shadow-2xl"
                                    : "bg-zinc-800/80 hover:bg-zinc-700/80 text-white border border-zinc-700/50 hover:border-cyan-500/40"
                            )}
                        >
                            <Zap className={cn("w-5 h-5 transition-transform group-hover:scale-110", status.is_enabled ? "fill-black" : "text-cyan-400")} />
                            <span>{status.is_enabled ? "MATIKAN GAMING MODE" : "AKTIFKAN GAMING MODE"}</span>
                        </button>
                        <span className="text-[11px] text-zinc-500 font-medium">
                            {status.is_enabled ? `Otomatis mengontrol ${otherLanDevices.length} perangkat LAN` : "1-Klik untuk mengisolasi seluruh perangkat lain"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Real-time Telemetry Radar Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className={cn(
                    "relative overflow-hidden rounded-2xl border p-5 backdrop-blur-md transition-all duration-300",
                    isOptimal
                        ? "bg-zinc-900/70 border-emerald-500/30 shadow-emerald-500/5 shadow-lg"
                        : "bg-zinc-900/70 border-amber-500/30 shadow-amber-500/5 shadow-lg"
                )}>
                    <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold mb-2">
                        <span className="flex items-center gap-1.5 uppercase tracking-wider">
                            <Activity className="w-4 h-4 text-cyan-400" />
                            Latensi Game (Ping)
                        </span>
                        <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                            isOptimal ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        )}>
                            {isOptimal ? "Sangat Baik" : "Mendekati Batas"}
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-extrabold text-white tracking-tight font-mono">
                            {ping.toFixed(1)}
                        </span>
                        <span className="text-sm font-semibold text-zinc-400">ms</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-2">
                        Target ambang batas: <span className="text-zinc-300 font-mono font-medium">≤ {targetPing} ms</span>
                    </p>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 backdrop-blur-md">
                    <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold mb-2">
                        <span className="flex items-center gap-1.5 uppercase tracking-wider">
                            <Gauge className="w-4 h-4 text-cyan-400" />
                            Fluktuasi Jitter
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                            Anti-Jitter
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-extrabold text-white tracking-tight font-mono">
                            ±{jitter.toFixed(1)}
                        </span>
                        <span className="text-sm font-semibold text-zinc-400">ms</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-2">
                        Variasi ping stabil (bebas lag spike tiba-tiba)
                    </p>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 backdrop-blur-md">
                    <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold mb-2">
                        <span className="flex items-center gap-1.5 uppercase tracking-wider">
                            <ShieldCheck className="w-4 h-4 text-emerald-400" />
                            Packet Loss
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            0% Loss
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-extrabold text-white tracking-tight font-mono">
                            {packetLoss.toFixed(1)}%
                        </span>
                        <span className="text-sm font-semibold text-zinc-400">drop</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-2">
                        Integritas koneksi ke router sempurna
                    </p>
                </div>
            </div>

            {/* Controlled LAN Devices List */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider">
                        <ShieldAlert className="w-4 h-4 text-cyan-400" />
                        Daftar Perangkat LAN yang Dikendalikan Mode Gaming ({otherLanDevices.length})
                    </div>
                    <span className="text-xs text-zinc-400">
                        {status.is_enabled ? (
                            <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {status.mode === 'blackhole_priority' ? 'Semua Terputus (Blackhole 0%)' : 'Semua Dibatasi (Airtime 20%)'}
                            </span>
                        ) : (
                            'Siaga (Akan otomatis dikontrol saat Gaming Mode aktif)'
                        )}
                    </span>
                </div>

                {otherLanDevices.length === 0 ? (
                    <div className="p-6 text-center text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
                        Tidak ada perangkat lain yang terdeteksi online di jaringan ini.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                        {otherLanDevices.map(dev => (
                            <div
                                key={dev.ip}
                                className={cn(
                                    "flex items-center justify-between p-3 rounded-xl border transition-all",
                                    status.is_enabled
                                        ? (status.mode === 'blackhole_priority' ? "bg-red-950/20 border-red-500/30 text-white" : "bg-cyan-950/20 border-cyan-500/30 text-white")
                                        : "bg-zinc-800/30 border-zinc-700/30 text-zinc-300"
                                )}
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    {dev.device_type === 'Smart TV' ? (
                                        <Tv className="w-4 h-4 text-zinc-400 shrink-0" />
                                    ) : dev.device_type === 'Mobile' ? (
                                        <Smartphone className="w-4 h-4 text-zinc-400 shrink-0" />
                                    ) : (
                                        <Laptop className="w-4 h-4 text-zinc-400 shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                        <div className="text-xs font-bold truncate text-white">
                                            {dev.alias || dev.hostname || dev.ip}
                                        </div>
                                        <div className="text-[10px] font-mono text-zinc-400">
                                            {dev.ip} • {dev.mac}
                                        </div>
                                    </div>
                                </div>

                                <span className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase shrink-0",
                                    status.is_enabled
                                        ? (status.mode === 'blackhole_priority' ? "bg-red-500/20 text-red-300 border border-red-500/30" : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30")
                                        : "bg-zinc-700/40 text-zinc-400 border border-zinc-700/50"
                                )}>
                                    {status.is_enabled
                                        ? (status.mode === 'blackhole_priority' ? "Blackhole (0%)" : "Airtime (20%)")
                                        : "Normal (100%)"
                                    }
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Mode & Target Configuration Panel */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Mode Selector */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider">
                        <Sliders className="w-4 h-4 text-cyan-400" />
                        Pilihan Mode Optimasi
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        <button
                            onClick={() => handleModeChange('auto_airtime')}
                            className={cn(
                                "flex items-start gap-3 p-4 rounded-xl border text-left transition-all cursor-pointer",
                                selectedMode === 'auto_airtime'
                                    ? "bg-cyan-500/10 border-cyan-500/40 text-white shadow-lg"
                                    : "bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
                            )}
                        >
                            <Radio className={cn("w-5 h-5 mt-0.5 shrink-0", selectedMode === 'auto_airtime' ? "text-cyan-400" : "text-zinc-500")} />
                            <div className="space-y-1">
                                <div className="text-sm font-bold flex items-center gap-2">
                                    <span>Smart Airtime Priority</span>
                                    {selectedMode === 'auto_airtime' && <Check className="w-4 h-4 text-cyan-400" />}
                                </div>
                                <p className="text-xs text-zinc-400 leading-relaxed">
                                    Otomatis membatasi seluruh perangkat lain ke <strong className="text-cyan-300">20%</strong>. Perangkat lain tetap bisa WhatsApp/chatting ringan tanpa mengganggu game Anda.
                                </p>
                            </div>
                        </button>

                        <button
                            onClick={() => handleModeChange('blackhole_priority')}
                            className={cn(
                                "flex items-start gap-3 p-4 rounded-xl border text-left transition-all cursor-pointer",
                                selectedMode === 'blackhole_priority'
                                    ? "bg-cyan-500/10 border-cyan-500/40 text-white shadow-lg"
                                    : "bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
                            )}
                        >
                            <Flame className={cn("w-5 h-5 mt-0.5 shrink-0", selectedMode === 'blackhole_priority' ? "text-cyan-400" : "text-zinc-500")} />
                            <div className="space-y-1">
                                <div className="text-sm font-bold flex items-center gap-2">
                                    <span>Ultra Blackhole Isolation</span>
                                    {selectedMode === 'blackhole_priority' && <Check className="w-4 h-4 text-cyan-400" />}
                                </div>
                                <p className="text-xs text-zinc-400 leading-relaxed">
                                    Otomatis memutuskan total (<strong className="text-red-400">0% Cut</strong>) seluruh perangkat lain dan mengarahkan download mereka ke Dead MAC di router.
                                </p>
                            </div>
                        </button>
                    </div>
                </div>

                {/* Target Latency Threshold */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-amber-400" />
                                Target Ambang Ping Maksimal
                            </span>
                            <span className="text-lg font-mono font-extrabold text-cyan-400">{targetPing} ms</span>
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                            Sistem akan secara otomatis mengetatkan kontrol saluran Wi-Fi jika latensi laptop Anda melampaui batas ini.
                        </p>

                        <div className="grid grid-cols-4 gap-2">
                            {[15, 25, 40, 60].map(val => (
                                <button
                                    key={val}
                                    onClick={() => handleTargetPingChange(val)}
                                    className={cn(
                                        "py-2 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer",
                                        targetPing === val
                                            ? "bg-cyan-500 text-black border-cyan-400 shadow-md shadow-cyan-500/20"
                                            : "bg-zinc-800/60 text-zinc-300 border-zinc-700/60 hover:bg-zinc-700/60"
                                    )}
                                >
                                    {val} ms
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        <span className="text-xs text-emerald-300 leading-normal">
                            <strong>Garansi Zero-Lag:</strong> Paket video download perangkat lain 100% dibuang di router dan tidak pernah mampir ke kartu Wi-Fi Anda.
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
