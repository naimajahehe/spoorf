import React, { useState } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Zap,
    Globe,
    Gamepad2,
    Sliders,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Server,
    ExternalLink
} from 'lucide-react';
import { Device } from '../types';
import { getApiUrl } from '../api/client';
import { getResolvedDeviceName } from '../lib/deviceSort';
import { cn } from '../lib/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './motion/select';

interface Props {
    isOpen: boolean;
    device: Device | null;
    devices: Device[];
    onClose: () => void;
    onScanComplete?: (updatedDevice: Device) => void;
    onOpenWebPreview?: (device: Device, port: number) => void;
}

type ScanPreset = 'top100' | 'web' | 'media' | 'custom';

export const DeepPortScanModal: FC<Props> = ({
    isOpen,
    device,
    devices,
    onClose,
    onScanComplete,
    onOpenWebPreview
}) => {
    // Only target online devices per user directive
    const onlineDevices = React.useMemo(() => {
        return devices.filter(d => d.is_online !== false);
    }, [devices]);

    const [selectedIp, setSelectedIp] = useState<string>(() => {
        if (device && device.is_online !== false) return device.ip;
        const firstOnline = devices.find(d => d.is_online !== false);
        return firstOnline ? firstOnline.ip : (devices[0]?.ip || '');
    });
    const [preset, setPreset] = useState<ScanPreset>('top100');
    const [customRange, setCustomRange] = useState<string>('1-1024');
    const [isScanning, setIsScanning] = useState<boolean>(false);
    const [scanResult, setScanResult] = useState<Device | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Update selected IP when device or onlineDevices changes
    React.useEffect(() => {
        if (device && device.is_online !== false) {
            setSelectedIp(device.ip);
        } else if (onlineDevices.length > 0) {
            if (!onlineDevices.some(d => d.ip === selectedIp)) {
                setSelectedIp(onlineDevices[0].ip);
            }
        }
    }, [device, onlineDevices, selectedIp]);

    if (!isOpen) return null;

    const getPortsForPreset = (): number[] | undefined => {
        if (preset === 'top100') {
            return undefined; // Python service default to TOP 100
        }
        if (preset === 'web') {
            return [80, 443, 8000, 8080, 8443, 8888, 9000, 9090, 10000, 3000, 5000, 8008];
        }
        if (preset === 'media') {
            return [25565, 27015, 32400, 554, 8554, 8008, 8009, 1883, 8883, 1900, 5353];
        }
        if (preset === 'custom') {
            const ports: number[] = [];
            const parts = customRange.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
            for (const part of parts) {
                if (part.includes('-')) {
                    const [startStr, endStr] = part.split('-').map(s => s.trim());
                    const start = parseInt(startStr, 10);
                    const end = parseInt(endStr, 10);
                    if (!isNaN(start) && !isNaN(end)) {
                        const minP = Math.max(1, Math.min(start, end));
                        const maxP = Math.min(65535, Math.max(start, end));
                        // Limit to 500 ports max for safety
                        const count = Math.min(500, maxP - minP + 1);
                        for (let i = 0; i < count; i++) {
                            ports.push(minP + i);
                        }
                    }
                } else {
                    const p = parseInt(part, 10);
                    if (!isNaN(p) && p >= 1 && p <= 65535) {
                        ports.push(p);
                    }
                }
            }
            return ports.length > 0 ? Array.from(new Set(ports)) : undefined;
        }
        return undefined;
    };

    const handleStartScan = async () => {
        if (!selectedIp) return;
        setIsScanning(true);
        setError(null);
        setScanResult(null);

        try {
            const ports = getPortsForPreset();
            const res = await fetch(`${getApiUrl()}/api/devices/${selectedIp}/scan-ports`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ports })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Scan failed (${res.status})`);
            }

            const data = await res.json();
            if (data.success && data.device) {
                setScanResult(data.device);
                if (onScanComplete) {
                    onScanComplete(data.device);
                }
            } else {
                throw new Error(data.error || 'Gagal memindai port');
            }
        } catch (err: any) {
            setError(err.message || 'Terjadi kesalahan saat memindai port');
        } finally {
            setIsScanning(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full max-w-xl bg-[#090a0c] border border-white/[0.1] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
                >
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-white/[0.08] bg-white/[0.02] flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <div className="size-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                                <Zap size={16} />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-white tracking-tight">
                                    Deep Port Scanner
                                </h3>
                                <p className="text-xs text-zinc-400">
                                    Pemindaian port multi-threaded berkecepatan tinggi pada target LAN.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="size-8 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 hover:text-rose-300 border border-white/[0.08] text-zinc-400 flex items-center justify-center transition-colors outline-none"
                            title="Tutup"
                        >
                            <X size={15} />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="p-6 flex flex-col gap-5">
                        {/* Target Device Selector with BeUI Motion Select */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-zinc-300">
                                Target Perangkat (Online)
                            </label>
                            <Select
                                value={selectedIp}
                                onValueChange={(val) => {
                                    setSelectedIp(val);
                                    setScanResult(null);
                                }}
                                disabled={isScanning || onlineDevices.length === 0}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Pilih perangkat online..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {onlineDevices.length === 0 ? (
                                        <div className="py-3 px-2 text-center text-xs text-zinc-500">
                                            Tidak ada perangkat online terdeteksi
                                        </div>
                                    ) : (
                                        onlineDevices.map((d) => {
                                            const name = getResolvedDeviceName(d);
                                            const labelText = `${d.ip} — ${name}${d.is_gateway ? ' (Gateway)' : ''}`;
                                            return (
                                                <SelectItem
                                                    key={d.ip}
                                                    value={d.ip}
                                                    label={labelText}
                                                >
                                                    <div className="flex items-center gap-2 truncate">
                                                        <span className="font-mono font-semibold text-white shrink-0">{d.ip}</span>
                                                        <span className="text-zinc-400 truncate text-xs">{name}</span>
                                                        {d.is_gateway && (
                                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono text-zinc-300 bg-white/[0.08] border border-white/[0.1] shrink-0">
                                                                Gateway
                                                            </span>
                                                        )}
                                                    </div>
                                                </SelectItem>
                                            );
                                        })
                                    )}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Presets */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold text-zinc-300">
                                Profil Pemindaian
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPreset('top100')}
                                    disabled={isScanning}
                                    className={cn(
                                        "p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all outline-none",
                                        preset === 'top100'
                                            ? "bg-white/[0.08] border-white/[0.25] text-white shadow-sm"
                                            : "bg-black/30 border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                                    )}
                                >
                                    <Zap size={15} className={preset === 'top100' ? "text-emerald-400 shrink-0 mt-0.5" : "text-zinc-500 shrink-0 mt-0.5"} />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-semibold">Top 100 Ports</span>
                                        <span className="text-[10px] text-zinc-500 leading-tight">Standar terlengkap (~1.5s)</span>
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setPreset('web')}
                                    disabled={isScanning}
                                    className={cn(
                                        "p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all outline-none",
                                        preset === 'web'
                                            ? "bg-white/[0.08] border-white/[0.25] text-white shadow-sm"
                                            : "bg-black/30 border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                                    )}
                                >
                                    <Globe size={15} className={preset === 'web' ? "text-emerald-400 shrink-0 mt-0.5" : "text-zinc-500 shrink-0 mt-0.5"} />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-semibold">Web & Admin</span>
                                        <span className="text-[10px] text-zinc-500 leading-tight">80, 443, 8080, 8000, 9000</span>
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setPreset('media')}
                                    disabled={isScanning}
                                    className={cn(
                                        "p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all outline-none",
                                        preset === 'media'
                                            ? "bg-white/[0.08] border-white/[0.25] text-white shadow-sm"
                                            : "bg-black/30 border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                                    )}
                                >
                                    <Gamepad2 size={15} className={preset === 'media' ? "text-emerald-400 shrink-0 mt-0.5" : "text-zinc-500 shrink-0 mt-0.5"} />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-semibold">Gaming & Media</span>
                                        <span className="text-[10px] text-zinc-500 leading-tight">RTSP 554, Cast, Plex, IoT</span>
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setPreset('custom')}
                                    disabled={isScanning}
                                    className={cn(
                                        "p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all outline-none",
                                        preset === 'custom'
                                            ? "bg-white/[0.08] border-white/[0.25] text-white shadow-sm"
                                            : "bg-black/30 border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                                    )}
                                >
                                    <Sliders size={15} className={preset === 'custom' ? "text-emerald-400 shrink-0 mt-0.5" : "text-zinc-500 shrink-0 mt-0.5"} />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-semibold">Rentang Kustom</span>
                                        <span className="text-[10px] text-zinc-500 leading-tight">Tentukan port spesifik</span>
                                    </div>
                                </button>
                            </div>

                            {preset === 'custom' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="mt-1"
                                >
                                    <input
                                        type="text"
                                        value={customRange}
                                        onChange={(e) => setCustomRange(e.target.value)}
                                        disabled={isScanning}
                                        placeholder="Contoh: 1-1024 atau 80, 443, 8080, 3000-3010"
                                        className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/[0.1] text-xs font-mono text-white outline-none focus:border-emerald-500/50"
                                    />
                                    <span className="text-[10px] text-zinc-500 mt-1 block">
                                        Maksimal 500 port per scan untuk menjaga stabilitas jaringan.
                                    </span>
                                </motion.div>
                            )}
                        </div>

                        {/* Scanning Progress Beam */}
                        {isScanning && (
                            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] flex flex-col gap-2.5">
                                <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                                        <Loader2 size={14} className="animate-spin" />
                                        <span>Memindai port pada {selectedIp}...</span>
                                    </div>
                                    <span className="text-zinc-400 font-mono text-[11px]">Multi-threaded (~1-2s)</span>
                                </div>
                                <div className="h-1.5 w-full bg-white/[0.06] rounded-full overflow-hidden relative">
                                    <motion.div
                                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                                        initial={{ x: '-100%' }}
                                        animate={{ x: '100%' }}
                                        transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Error Message */}
                        {error && (
                            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
                                <AlertCircle size={15} className="text-rose-400 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Scan Result */}
                        {scanResult && !isScanning && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="p-4 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 flex flex-col gap-3"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 size={16} className="text-emerald-400" />
                                        <span className="text-xs font-bold text-white">
                                            Pemindaian Selesai!
                                        </span>
                                    </div>
                                    <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                        {scanResult.open_ports?.length || 0} port terbuka ditemukan
                                    </span>
                                </div>

                                {scanResult.open_ports && scanResult.open_ports.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                                        {scanResult.open_ports.map((p) => {
                                            const isWeb = p === 80 || p === 443 || p === 8080 || p === 8000 || p === 3000;
                                            return (
                                                <div
                                                    key={p}
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono text-zinc-200"
                                                >
                                                    <Server size={11} className="text-zinc-400" />
                                                    <strong>{p}</strong>
                                                    {isWeb && onOpenWebPreview && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                onClose();
                                                                onOpenWebPreview(scanResult, p);
                                                            }}
                                                            className="text-emerald-400 hover:text-emerald-300 ml-0.5"
                                                            title="Pratinjau Web"
                                                        >
                                                            <ExternalLink size={10} />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-xs text-zinc-400">
                                        Tidak ada port terbuka yang merespons pada profil ini.
                                    </p>
                                )}
                            </motion.div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-white/[0.08] bg-white/[0.02] flex items-center justify-end gap-2.5">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isScanning}
                            className="px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white text-xs font-medium border border-white/[0.08] transition-colors outline-none"
                        >
                            Tutup
                        </button>
                        <button
                            type="button"
                            onClick={handleStartScan}
                            disabled={isScanning || !selectedIp}
                            className="px-5 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200 transition-all shadow-md flex items-center gap-2 outline-none disabled:opacity-50"
                        >
                            {isScanning ? (
                                <>
                                    <Loader2 size={13} className="animate-spin" />
                                    <span>Sedang Memindai...</span>
                                </>
                            ) : (
                                <>
                                    <Zap size={13} />
                                    <span>Mulai Scan Mendalam</span>
                                </>
                            )}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
