import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
    Shield, 
    ShieldCheck, 
    ShieldAlert, 
    Lock, 
    Radio, 
    Zap, 
    CheckCircle2, 
    Activity, 
    Trash2, 
    RefreshCw, 
    Sliders, 
    Info,
    Crosshair
} from 'lucide-react';
import { Device } from '../types';

export interface ShieldStatus {
    is_enabled: boolean;
    mode: 'host_lock' | 'lan_healing' | 'reflect_counter';
    auto_retaliate: boolean;
    gateway_ip: string;
    gateway_mac: string;
    win_alias: string;
    locked_at: string | null;
    threats_count: number;
    latest_threat?: any;
}

export interface ShieldThreat {
    id: string;
    timestamp: string;
    attacker_ip: string;
    attacker_mac: string;
    target_ip: string;
    claimed_ip: string;
    type: string;
    action_taken: string;
    details: string;
}

interface SettingsViewProps {
    devices: Device[];
    gateway: Device | null;
    shieldStatus: ShieldStatus;
    threats: ShieldThreat[];
    onToggleShield: (enabled: boolean, mode: string, autoRetaliate: boolean) => Promise<void>;
    onChangeMode: (mode: string, autoRetaliate: boolean) => Promise<void>;
    onClearThreats: () => Promise<void>;
    onRefresh: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
    devices,
    gateway,
    shieldStatus,
    threats,
    onToggleShield,
    onChangeMode,
    onClearThreats,
    onRefresh
}) => {
    const [isUpdating, setIsUpdating] = useState(false);
    const [selectedMode, setSelectedMode] = useState<'host_lock' | 'lan_healing' | 'reflect_counter'>(
        shieldStatus?.mode || 'host_lock'
    );
    const [autoRetaliate, setAutoRetaliate] = useState<boolean>(
        shieldStatus?.auto_retaliate || false
    );

    const handleMasterToggle = async () => {
        setIsUpdating(true);
        try {
            await onToggleShield(!shieldStatus.is_enabled, selectedMode, autoRetaliate);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleModeSelect = async (mode: 'host_lock' | 'lan_healing' | 'reflect_counter') => {
        setSelectedMode(mode);
        if (shieldStatus.is_enabled) {
            setIsUpdating(true);
            try {
                await onChangeMode(mode, autoRetaliate);
            } finally {
                setIsUpdating(false);
            }
        }
    };

    const handleRetaliateToggle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const nextVal = !autoRetaliate;
        setAutoRetaliate(nextVal);
        if (shieldStatus.is_enabled) {
            setIsUpdating(true);
            try {
                await onChangeMode(selectedMode, nextVal);
            } finally {
                setIsUpdating(false);
            }
        }
    };

    return (
        <div className="w-full max-w-7xl mx-auto space-y-8 pb-16">
            {/* Header Title Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.06] pb-6">
                <div>
                    <div className="flex items-center gap-3">
                        <Shield size={24} className="text-emerald-400 shrink-0" />
                        <div>
                            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
                                Pengaturan & Pertahanan Jaringan
                                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono font-medium text-emerald-400 uppercase tracking-widest">
                                    Sentinel Shield v2.3
                                </span>
                            </h1>
                            <p className="text-xs text-zinc-400 mt-0.5">
                                Kendalikan pertahanan kernel terhadap serangan ARP Poisoning, NetCut, dan pantau radar penyerang real-time.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2.5">
                    <button
                        onClick={onRefresh}
                        disabled={isUpdating}
                        className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50"
                    >
                        <RefreshCw size={13} className={isUpdating ? "animate-spin text-emerald-400" : ""} />
                        Segarkan Status
                    </button>
                </div>
            </div>

            {/* Master Sentinel Shield Banner Card */}
            <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 ${
                    shieldStatus.is_enabled 
                        ? 'bg-gradient-to-br from-emerald-950/40 via-emerald-900/10 to-[#0c0d10] border-emerald-500/30 shadow-2xl shadow-emerald-950/20' 
                        : 'bg-[#090a0c] border-white/[0.08] shadow-lg'
                }`}
            >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="flex items-start gap-4">
                        <div className="shrink-0 pt-0.5">
                            {shieldStatus.is_enabled ? (
                                <ShieldCheck size={36} className="text-emerald-400 animate-pulse" />
                            ) : (
                                <ShieldAlert size={36} className="text-zinc-500" />
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                                <h2 className="text-lg font-bold text-white tracking-tight">
                                    Sentinel Shield (Perisai Anti-NetCut)
                                </h2>
                                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${
                                    shieldStatus.is_enabled
                                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                        : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                                }`}>
                                    {shieldStatus.is_enabled ? 'AKTIF & TERKUNCI' : 'NONAKTIF'}
                                </span>
                            </div>
                            <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
                                {shieldStatus.is_enabled ? (
                                    <>
                                        Tabel ARP kernel Windows terkunci permanen pada Gateway <span className="font-mono text-emerald-300 font-semibold">{shieldStatus.gateway_ip || gateway?.ip || '192.168.110.1'}</span> ({shieldStatus.gateway_mac || gateway?.mac || '98:4a:6b:0f:4a:97'}). Semua upaya pemutusan koneksi oleh pihak ketiga akan <strong className="text-white">langsung diabaikan oleh kernel</strong>.
                                    </>
                                ) : (
                                    'Ketika nonaktif, tabel ARP laptop Anda bersifat dinamis dan dapat diputus atau dibatasi kecepatannya oleh perangkat lain yang menjalankan NetCut di jaringan Wi-Fi ini.'
                                )}
                            </p>
                            {shieldStatus.is_enabled && shieldStatus.locked_at && (
                                <div className="text-[11px] text-emerald-400/80 font-mono flex items-center gap-1.5 pt-1">
                                    <Lock size={12} />
                                    Terkunci sejak: {shieldStatus.locked_at} • Interface: {shieldStatus.win_alias}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Master Switch Action */}
                    <div className="flex items-center gap-4 self-end lg:self-center shrink-0">
                        <button
                            onClick={handleMasterToggle}
                            disabled={isUpdating}
                            className={`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 ${
                                shieldStatus.is_enabled
                                    ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600'
                                    : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-black shadow-lg shadow-emerald-500/20'
                            }`}
                        >
                            {shieldStatus.is_enabled ? (
                                <>
                                    <Lock size={14} />
                                    Nonaktifkan Perisai
                                </>
                            ) : (
                                <>
                                    <Zap size={14} />
                                    Aktifkan Perisai (100% Kebal)
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </motion.div>

            {/* Defense Modes Selector Section */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                            <Sliders size={15} className="text-emerald-400" />
                            Pilihan Mode Pertahanan (*Defense Strategy*)
                        </h3>
                        <p className="text-xs text-zinc-400 mt-0.5">
                            Tentukan bagaimana Sentinel Shield bereaksi saat serangan ARP Spoofing terjadi.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Mode 1: Host Immunity */}
                    <div 
                        onClick={() => handleModeSelect('host_lock')}
                        className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                            selectedMode === 'host_lock'
                                ? 'bg-emerald-500/[0.08] border-emerald-500/40 shadow-lg shadow-emerald-950/20'
                                : 'bg-[#090a0c] border-white/[0.06] hover:bg-white/[0.03] hover:border-white/[0.12]'
                        }`}
                    >
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Lock size={18} className="text-emerald-400" />
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400">
                                    100% KEBAL
                                </span>
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-white">Mode 1: Host Immunity (Rekomendasi)</h4>
                                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                                    Mengunci router di level kernel Windows. Laptop ini menjadi <strong>kebal mutlak</strong> dari NetCut tanpa menggunakan beban CPU sama sekali.
                                </p>
                            </div>
                        </div>
                        <div className="pt-4 mt-4 border-t border-white/[0.06] flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Target: Laptop Ini</span>
                            {selectedMode === 'host_lock' && <CheckCircle2 size={16} className="text-emerald-400" />}
                        </div>
                    </div>

                    {/* Mode 2: LAN Guardian */}
                    <div 
                        onClick={() => handleModeSelect('lan_healing')}
                        className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                            selectedMode === 'lan_healing'
                                ? 'bg-cyan-500/[0.08] border-cyan-500/40 shadow-lg shadow-cyan-950/20'
                                : 'bg-[#090a0c] border-white/[0.06] hover:bg-white/[0.03] hover:border-white/[0.12]'
                        }`}
                    >
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Radio size={18} className="text-cyan-400" />
                                <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-bold text-cyan-400">
                                    AUTO-HEALING
                                </span>
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-white">Mode 2: LAN Guardian (Vaksinasi)</h4>
                                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                                    Mengunci laptop ini + secara aktif menyuntikkan paket pemulih (*Gratuitous ARP*) untuk <strong>menyelamatkan seluruh HP/TV di Wi-Fi</strong> dari serangan NetCut.
                                </p>
                            </div>
                        </div>
                        <div className="pt-4 mt-4 border-t border-white/[0.06] flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Target: Seluruh Jaringan</span>
                            {selectedMode === 'lan_healing' && <CheckCircle2 size={16} className="text-cyan-400" />}
                        </div>
                    </div>

                    {/* Mode 3: Reflect Counter */}
                    <div 
                        onClick={() => handleModeSelect('reflect_counter')}
                        className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                            selectedMode === 'reflect_counter'
                                ? 'bg-amber-500/[0.08] border-amber-500/40 shadow-lg shadow-amber-950/20'
                                : 'bg-[#090a0c] border-white/[0.06] hover:bg-white/[0.03] hover:border-white/[0.12]'
                        }`}
                    >
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Crosshair size={18} className="text-amber-400" />
                                <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-400">
                                    PEMBALASAN
                                </span>
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-white">Mode 3: Reflect Counter-Shield</h4>
                                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                                    Secara otomatis melacak dan <strong>memutus balik koneksi penyerang</strong> begitu penyerang terdeteksi mencoba meracuni jaringan Anda.
                                </p>
                            </div>
                        </div>
                        <div className="pt-4 mt-4 border-t border-white/[0.06] flex items-center justify-between text-xs">
                            <button
                                onClick={handleRetaliateToggle}
                                className="text-amber-300 font-semibold hover:underline"
                            >
                                Auto-Cut: {autoRetaliate ? 'ON' : 'OFF'}
                            </button>
                            {selectedMode === 'reflect_counter' && <CheckCircle2 size={16} className="text-amber-400" />}
                        </div>
                    </div>
                </div>
            </div>

            {/* Threat Radar Log Table */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                            <Activity size={15} className="text-red-400" />
                            Radar Ancaman & Riwayat Serangan yang Digagalkan
                            <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-[10px] font-mono text-zinc-400">
                                {threats.length} Percobaan
                            </span>
                        </h3>
                        <p className="text-xs text-zinc-400 mt-0.5">
                            Laporan real-time penyerang yang mencoba memalsukan Gateway di jaringan ini.
                        </p>
                    </div>

                    {threats.length > 0 && (
                        <button
                            onClick={onClearThreats}
                            className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs font-medium text-red-300 transition-all flex items-center gap-1.5"
                        >
                            <Trash2 size={12} />
                            Bersihkan Riwayat
                        </button>
                    )}
                </div>

                <div className="rounded-2xl border border-white/[0.08] bg-[#090a0c] overflow-hidden">
                    {threats.length === 0 ? (
                        <div className="p-10 text-center space-y-3">
                            <ShieldCheck size={32} className="text-emerald-400/80 mx-auto" />
                            <div className="space-y-1">
                                <h4 className="text-sm font-semibold text-zinc-200">Radar Aman — Tidak Ada Serangan</h4>
                                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                                    Tidak terdeteksi adanya paket ARP palsu atau aktivitas NetCut dari perangkat lain di jaringan Wi-Fi ini.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-white/[0.02] border-b border-white/[0.06] text-zinc-400 font-mono text-[11px] uppercase">
                                    <tr>
                                        <th className="px-4 py-3">Waktu</th>
                                        <th className="px-4 py-3">MAC Penyerang</th>
                                        <th className="px-4 py-3">Target Diserang</th>
                                        <th className="px-4 py-3">Jenis Serangan</th>
                                        <th className="px-4 py-3 text-right">Status Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                    {threats.map((threat) => (
                                        <tr key={threat.id} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-4 py-3.5 font-mono text-zinc-400 whitespace-nowrap">
                                                {threat.timestamp}
                                            </td>
                                            <td className="px-4 py-3.5 font-mono text-red-300 font-medium">
                                                <div className="flex items-center gap-2">
                                                    <span className="size-1.5 rounded-full bg-red-500 animate-ping shrink-0" />
                                                    <span>{threat.attacker_mac}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5 font-mono text-zinc-300">
                                                {threat.target_ip || 'Broadcast'}
                                            </td>
                                            <td className="px-4 py-3.5 text-zinc-300">
                                                <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 font-mono text-[11px]">
                                                    Gateway Poisoning ({threat.claimed_ip})
                                                </span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right">
                                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-medium text-[11px] inline-flex items-center gap-1">
                                                    <CheckCircle2 size={12} />
                                                    Dinetralkan
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Diagnostic & Hardware Information Section */}
            <div className="p-5 rounded-2xl border border-white/[0.06] bg-[#0c0d10] space-y-3">
                <div className="flex items-center gap-2 text-zinc-300 text-xs font-semibold">
                    <Info size={14} className="text-zinc-400" />
                    Informasi Adapter Jaringan & Status Kernel
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                        <span className="text-zinc-500 block text-[10px] font-mono uppercase">Interface Aktif</span>
                        <span className="font-mono text-white font-medium mt-0.5 block">{shieldStatus.win_alias || 'Wi-Fi'}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                        <span className="text-zinc-500 block text-[10px] font-mono uppercase">Gateway Router IP</span>
                        <span className="font-mono text-emerald-400 font-medium mt-0.5 block">{shieldStatus.gateway_ip || gateway?.ip || '192.168.110.1'}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                        <span className="text-zinc-500 block text-[10px] font-mono uppercase">Gateway MAC Fisik</span>
                        <span className="font-mono text-zinc-300 font-medium mt-0.5 block">{shieldStatus.gateway_mac || gateway?.mac || '98:4a:6b:0f:4a:97'}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                        <span className="text-zinc-500 block text-[10px] font-mono uppercase">Perangkat Terpantau</span>
                        <span className="font-mono text-teal-400 font-medium mt-0.5 block">{devices.length} Host Terdaftar</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
