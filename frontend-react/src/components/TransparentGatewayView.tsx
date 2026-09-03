import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Radio,
    Globe,
    Activity,
    Search,
    Trash2,
    Plus,
    Ban,
    CheckCircle2,
    AlertCircle,
    RefreshCw,
    Sliders,
    Zap,
    Lock,
    Unlock,
    Shield,
    Download,
    HelpCircle,
    ChevronDown,
    ChevronUp,
    Layers,
    X
} from 'lucide-react';
import { Device, L7Flow, CAStatus } from '../types';
import { GatewayStatusData, GatewayDnsLog, TelemetryData } from '../hooks/useWebSocket';
import { apiFetch } from '../api/client';
import { cn } from '../lib/utils';

interface TransparentGatewayViewProps {
    devices: Device[];
    gateway: Device | null;
    gatewayStatus: GatewayStatusData;
    dnsLogs: GatewayDnsLog[];
    l7Flows?: L7Flow[];
    caStatus?: CAStatus | null;
    telemetry?: TelemetryData;
    onStartGateway: (ip: string, gatewayIp?: string) => Promise<any>;
    onStopGateway: (ip: string) => Promise<void>;
    onAddSinkhole: (domain: string) => Promise<string[]>;
    onRemoveSinkhole: (domain: string) => Promise<string[]>;
    onClearLogs: () => Promise<void>;
    onClearL7Flows?: () => Promise<void>;
}

export const TransparentGatewayView: React.FC<TransparentGatewayViewProps> = ({
    devices,
    gateway,
    gatewayStatus,
    dnsLogs,
    l7Flows = [],
    caStatus,
    telemetry: _telemetry,
    onStartGateway,
    onStopGateway,
    onAddSinkhole,
    onRemoveSinkhole,
    onClearLogs,
    onClearL7Flows
}) => {
    // Selectable targets: Online devices, excluding gateway and this PC
    const candidateTargets = useMemo(() => {
        return devices.filter(d => !d.is_gateway && !d.is_self);
    }, [devices]);

    // Active session target IP (if any)
    const activeTargetIp = useMemo(() => {
        const keys = Object.keys(gatewayStatus.active_sessions || {});
        return keys.length > 0 ? keys[0] : null;
    }, [gatewayStatus]);

    const isRunning = Boolean(activeTargetIp);

    const [selectedTargetIp, setSelectedTargetIp] = useState<string>(() => {
        return activeTargetIp || (candidateTargets[0]?.ip || '');
    });

    useEffect(() => {
        if (activeTargetIp) {
            setSelectedTargetIp(activeTargetIp);
        } else if (!selectedTargetIp && candidateTargets.length > 0) {
            setSelectedTargetIp(candidateTargets[0].ip);
        }
    }, [activeTargetIp, candidateTargets]);

    const activeTargetDevice = useMemo(() => {
        return devices.find(d => d.ip === (activeTargetIp || selectedTargetIp)) || null;
    }, [devices, activeTargetIp, selectedTargetIp]);

    // View state
    const [activeTab, setActiveTab] = useState<'flows' | 'dns'>('flows');
    const [newSinkholeInput, setNewSinkholeInput] = useState('');
    const [logSearchQuery, setLogSearchQuery] = useState('');
    const [flowSearchQuery, setFlowSearchQuery] = useState('');
    const [selectedSchemeFilter, setSelectedSchemeFilter] = useState<'all' | 'https' | 'http' | 'dns'>('all');
    const [isLoading, setIsLoading] = useState(false);
    const [showCaGuide, setShowCaGuide] = useState(false);
    const [selectedFlowDetail, setSelectedFlowDetail] = useState<L7Flow | null>(null);
    const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
        setActionMessage({ text, type });
        setTimeout(() => setActionMessage(null), 4000);
    };

    const handleToggleGateway = async () => {
        if (!selectedTargetIp) return;
        setIsLoading(true);
        try {
            if (isRunning && activeTargetIp) {
                await onStopGateway(activeTargetIp);
                showMessage(`Transparent Gateway untuk ${activeTargetIp} berhasil dihentikan & tabel ARP dipulihkan.`);
            } else {
                await onStartGateway(selectedTargetIp, gateway?.ip);
                showMessage(`Transparent Gateway untuk ${selectedTargetIp} berhasil diaktifkan dengan Full IP Forwarding & L7 Interception!`);
            }
        } catch (err: any) {
            showMessage(err.message || 'Gagal memproses aksi gateway', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddSinkhole = async (domainToAdd?: string) => {
        const targetDomain = (domainToAdd || newSinkholeInput).trim();
        if (!targetDomain) return;
        try {
            await onAddSinkhole(targetDomain);
            if (!domainToAdd) setNewSinkholeInput('');
            showMessage(`Domain '${targetDomain}' berhasil dimasukkan ke sinkhole blacklist.`);
        } catch (err: any) {
            showMessage(err.message || 'Gagal menambahkan domain sinkhole', 'error');
        }
    };

    const handleRemoveSinkhole = async (domain: string) => {
        try {
            await onRemoveSinkhole(domain);
            showMessage(`Domain '${domain}' dihapus dari sinkhole.`);
        } catch (err: any) {
            showMessage(err.message || 'Gagal menghapus domain sinkhole', 'error');
        }
    };

    const handleDownloadCa = async () => {
        try {
            const res = await apiFetch('/api/interceptor/ca/download');
            if (!res.ok) {
                throw new Error(`Gagal mengunduh sertifikat: ${res.statusText}`);
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'spoorf-ca.crt';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showMessage('Sertifikat Root CA (spoorf-ca.crt) berhasil diunduh.');
        } catch (err: any) {
            showMessage(err.message || 'Gagal mengunduh Root CA', 'error');
        }
    };

    // Filtered DNS logs
    const filteredDnsLogs = useMemo(() => {
        if (!logSearchQuery.trim()) return dnsLogs;
        const q = logSearchQuery.toLowerCase();
        return dnsLogs.filter(l => l.domain.toLowerCase().includes(q) || l.target_ip.includes(q));
    }, [dnsLogs, logSearchQuery]);

    // Filtered L7 Flows
    const filteredL7Flows = useMemo(() => {
        return l7Flows.filter(flow => {
            if (selectedSchemeFilter !== 'all' && flow.scheme !== selectedSchemeFilter) {
                return false;
            }
            if (flowSearchQuery.trim()) {
                const q = flowSearchQuery.toLowerCase();
                const matchHost = flow.host?.toLowerCase().includes(q);
                const matchPath = flow.path?.toLowerCase().includes(q);
                const matchIp = flow.client_ip?.includes(q);
                const matchMethod = flow.method?.toLowerCase().includes(q);
                if (!matchHost && !matchPath && !matchIp && !matchMethod) {
                    return false;
                }
            }
            return true;
        });
    }, [l7Flows, selectedSchemeFilter, flowSearchQuery]);

    const getMethodBadgeClass = (method: string) => {
        const m = method.toUpperCase();
        if (m === 'GET') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
        if (m === 'POST') return 'bg-sky-500/20 text-sky-300 border-sky-500/30';
        if (m === 'PUT') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
        if (m === 'DELETE') return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
        if (m === 'SNI') return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
    };

    const getStatusBadgeClass = (status?: number) => {
        if (!status) return 'text-zinc-500 bg-zinc-800/40 border-zinc-700';
        if (status >= 200 && status < 300) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
        if (status >= 300 && status < 400) return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
        if (status === 403 || status === 401) return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
        if (status >= 400 && status < 500) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
        return 'text-red-400 bg-red-500/10 border-red-500/20';
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-12">
            {/* Top Notification Toast */}
            <AnimatePresence>
                {actionMessage && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className={cn(
                            "flex items-center justify-between p-3.5 rounded-xl text-xs font-medium border shadow-lg backdrop-blur-md",
                            actionMessage.type === 'success'
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                : "bg-red-500/10 border-red-500/30 text-red-300"
                        )}
                    >
                        <div className="flex items-center gap-2">
                            {actionMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                            <span>{actionMessage.text}</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Master Header Card */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-white/[0.07] to-white/[0.02] border border-white/[0.1] p-6 lg:p-8 backdrop-blur-xl">
                <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
                <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                "size-10 rounded-xl flex items-center justify-center border transition-all shadow-lg",
                                isRunning
                                    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-400 shadow-cyan-500/20 animate-pulse"
                                    : "bg-white/[0.05] border-white/[0.1] text-zinc-400"
                            )}>
                                <Radio size={20} />
                            </div>
                            <div>
                                <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
                                    Smart Transparent Gateway & L7 Interceptor
                                    {isRunning && (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono bg-cyan-500/20 border border-cyan-500/30 text-cyan-300">
                                            <span className="size-1.5 rounded-full bg-cyan-400 animate-ping" />
                                            Active MitM Pass-Through
                                        </span>
                                    )}
                                </h1>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                    Menggabungkan L2 ARP Routing dengan <strong>Mitmproxy L7 Protocol Engine</strong> untuk inspeksi HTTP/HTTPS, TLS SNI, & DNS Sinkhole.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Quick Stats Pill */}
                    <div className="flex items-center gap-3 self-stretch md:self-auto flex-wrap">
                        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-black/40 border border-white/[0.08] text-xs font-mono text-zinc-300">
                            <span className="text-zinc-500">Router:</span>
                            <span className="text-emerald-400 font-semibold">{gateway?.ip || '192.168.1.1'}</span>
                        </div>
                        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-black/40 border border-white/[0.08] text-xs font-mono text-zinc-300">
                            <span className="text-zinc-500">Target Aktif:</span>
                            <span className={cn("font-semibold font-mono", isRunning ? "text-cyan-400" : "text-zinc-500")}>
                                {activeTargetIp || 'Tidak Ada'}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-black/40 border border-white/[0.08] text-xs font-mono text-zinc-300">
                            <span className="text-zinc-500">L7 Flows:</span>
                            <span className="text-cyan-400 font-semibold">{l7Flows.length}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Target Selection & Action Bar */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-2xl bg-white/[0.03] border border-white/[0.08] p-6 backdrop-blur-md flex flex-col justify-between gap-6">
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                                <Sliders size={14} className="text-cyan-400" />
                                Pilih Perangkat Target Sesi Gateway
                            </span>
                            {activeTargetDevice && (
                                <span className="text-xs text-zinc-400">
                                    Vendor: <strong className="text-zinc-200">{activeTargetDevice.vendor || 'Unknown'}</strong>
                                </span>
                            )}
                        </div>

                        {/* Select Target Device Dropdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs text-zinc-400 font-medium">Perangkat Terkoneksi:</label>
                                <select
                                    disabled={isRunning || isLoading}
                                    value={selectedTargetIp}
                                    onChange={(e) => setSelectedTargetIp(e.target.value)}
                                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/[0.1] text-xs text-white focus:outline-none focus:border-cyan-500/50 disabled:opacity-50 transition-all font-mono"
                                >
                                    {candidateTargets.length === 0 ? (
                                        <option value="">Tidak ada perangkat target tersedia</option>
                                    ) : (
                                        candidateTargets.map(d => (
                                            <option key={d.ip} value={d.ip}>
                                                {d.alias || d.hostname || d.ip} ({d.ip}) - {d.mac}
                                            </option>
                                        ))
                                    )}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs text-zinc-400 font-medium">Gateway Router Asli:</label>
                                <div className="px-3.5 py-2.5 rounded-xl bg-black/30 border border-white/[0.06] text-xs text-zinc-300 font-mono flex items-center justify-between">
                                    <span>{gateway?.hostname || 'Default Gateway'} ({gateway?.ip || '192.168.1.1'})</span>
                                    <span className="text-[10px] text-emerald-400 font-semibold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">Immune</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action Controls Button */}
                    <div className="flex items-center justify-between pt-4 border-t border-white/[0.06] flex-wrap gap-4">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <Activity size={14} className={isRunning ? "text-cyan-400 animate-pulse" : "text-zinc-500"} />
                            <span>
                                {isRunning
                                    ? `Sesi aktif meneruskan seluruh IP packets untuk ${activeTargetIp}`
                                    : 'Siap mengarahkan trafik target melewati controller tanpa memutus internet'}
                            </span>
                        </div>

                        <button
                            type="button"
                            disabled={isLoading || (!isRunning && !selectedTargetIp)}
                            onClick={handleToggleGateway}
                            className={cn(
                                "px-5 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 shadow-lg disabled:opacity-40",
                                isRunning
                                    ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 shadow-rose-500/10"
                                    : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-cyan-500/20 font-bold"
                            )}
                        >
                            {isLoading ? (
                                <>
                                    <RefreshCw size={14} className="animate-spin" />
                                    <span>Memproses...</span>
                                </>
                            ) : isRunning ? (
                                <>
                                    <Ban size={14} />
                                    <span>Hentikan Transparent Gateway</span>
                                </>
                            ) : (
                                <>
                                    <Zap size={14} />
                                    <span>Aktifkan Transparent Gateway</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Right Panel: CA Certificate & TLS Decryption Card */}
                <div className="rounded-2xl bg-gradient-to-b from-white/[0.05] to-white/[0.02] border border-white/[0.08] p-6 backdrop-blur-md flex flex-col justify-between gap-4">
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
                                <Shield size={16} className="text-cyan-400" />
                                Dynamic TLS CA Engine
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[10px] font-mono">
                                Mitmproxy Core
                            </span>
                        </div>

                        <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                            Untuk melihat payload dan header HTTPS secara penuh, pasang Root CA ini di perangkat target. Mode default tetap berjalan mulus untuk SNI & DNS tanpa sertifikat.
                        </p>

                        <div className="p-3 rounded-xl bg-black/40 border border-white/[0.06] mb-4">
                            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-300 mb-1.5">
                                <span className="text-zinc-500">Root CA:</span>
                                <span className="text-emerald-400 font-semibold">{caStatus?.common_name || 'NetCut Sentinel Root CA'}</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-300">
                                <span className="text-zinc-500">Status:</span>
                                <span className="text-cyan-300">Active (X.509 v3 RSA 2048)</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-3 border-t border-white/[0.06]">
                        <button
                            type="button"
                            onClick={handleDownloadCa}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
                        >
                            <Download size={14} />
                            <span>Download Root CA (.crt)</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setShowCaGuide(!showCaGuide)}
                            className="text-[11px] text-zinc-400 hover:text-cyan-300 flex items-center justify-center gap-1 transition-colors py-1"
                        >
                            <HelpCircle size={12} />
                            <span>{showCaGuide ? 'Tutup Panduan Instalasi' : 'Cara Pasang di HP / Laptop'}</span>
                            {showCaGuide ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>

                        {showCaGuide && (
                            <div className="p-3 rounded-xl bg-black/60 border border-cyan-500/20 text-[11px] text-zinc-300 space-y-1.5">
                                <p><strong className="text-cyan-300">Android:</strong> Settings ➔ Security ➔ Install from storage ➔ CA certificate.</p>
                                <p><strong className="text-cyan-300">iOS:</strong> Download profile ➔ Settings ➔ Profile ➔ Certificate Trust Settings.</p>
                                <p><strong className="text-cyan-300">Windows:</strong> Double click `.crt` ➔ Install ➔ Trusted Root Certification Authorities.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Traffic Inspection View Tabs */}
            <div className="flex items-center gap-3 border-b border-white/[0.08] pb-3">
                <button
                    type="button"
                    onClick={() => setActiveTab('flows')}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all",
                        activeTab === 'flows'
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                            : "bg-white/[0.03] text-zinc-400 hover:text-white border border-white/[0.06]"
                    )}
                >
                    <Layers size={15} />
                    <span>L7 HTTP/HTTPS Flows</span>
                    {l7Flows.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/30 text-cyan-200">
                            {l7Flows.length}
                        </span>
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => setActiveTab('dns')}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all",
                        activeTab === 'dns'
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                            : "bg-white/[0.03] text-zinc-400 hover:text-white border border-white/[0.06]"
                    )}
                >
                    <Globe size={15} />
                    <span>DNS Queries & Sinkhole</span>
                    {dnsLogs.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.1] text-zinc-300">
                            {dnsLogs.length}
                        </span>
                    )}
                </button>
            </div>

            {/* TAB 1: L7 HTTP/HTTPS Flows Inspector (Mitmproxy Engine) */}
            {activeTab === 'flows' && (
                <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-6 backdrop-blur-md flex flex-col gap-4">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div>
                            <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                                <Activity size={16} className="text-cyan-400" />
                                Real-Time L7 Traffic Flow Stream
                            </h2>
                            <p className="text-xs text-zinc-400 mt-0.5">
                                Menampilkan seluruh request HTTP, HTTPS (TLS SNI), dan respon secara live.
                            </p>
                        </div>

                        {/* Search & Scheme Filter */}
                        <div className="flex items-center gap-2.5 w-full md:w-auto flex-wrap">
                            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/[0.08]">
                                {(['all', 'https', 'http', 'dns'] as const).map(sch => (
                                    <button
                                        key={sch}
                                        type="button"
                                        onClick={() => setSelectedSchemeFilter(sch)}
                                        className={cn(
                                            "px-2.5 py-1 rounded-lg text-[11px] font-mono uppercase font-semibold transition-all",
                                            selectedSchemeFilter === sch
                                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                                : "text-zinc-400 hover:text-zinc-200"
                                        )}
                                    >
                                        {sch}
                                    </button>
                                ))}
                            </div>

                            <div className="relative flex-1 md:w-64">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                                <input
                                    type="text"
                                    placeholder="Filter URL / Host / IP..."
                                    value={flowSearchQuery}
                                    onChange={(e) => setFlowSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-black/50 border border-white/[0.1] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
                                />
                            </div>

                            {onClearL7Flows && (
                                <button
                                    type="button"
                                    onClick={onClearL7Flows}
                                    className="p-2 rounded-xl bg-white/[0.04] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 border border-white/[0.08] transition-all"
                                    title="Bersihkan riwayat flows"
                                >
                                    <Trash2 size={15} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Flows Table */}
                    <div className="rounded-xl border border-white/[0.08] bg-black/40 overflow-hidden min-h-[340px] max-h-[480px] overflow-y-auto">
                        {filteredL7Flows.length === 0 ? (
                            <div className="p-16 text-center text-xs text-zinc-500 flex flex-col items-center gap-2.5">
                                <Activity size={28} className="opacity-40 animate-pulse text-cyan-400" />
                                <span className="font-semibold text-zinc-400">Menunggu lalu lintas L7 dari target...</span>
                                <span className="text-[10px] text-zinc-500 max-w-md text-center">
                                    Aktifkan Transparent Gateway pada perangkat target di atas, lalu buka browser atau aplikasi apa pun untuk melihat live HTTP/HTTPS flows.
                                </span>
                            </div>
                        ) : (
                            <div className="divide-y divide-white/[0.04]">
                                {filteredL7Flows.map((flow, idx) => {
                                    const timeStr = new Date(flow.timestamp * 1000).toLocaleTimeString();
                                    const isBlocked = flow.is_blocked;

                                    return (
                                        <div
                                            key={flow.id || `${flow.timestamp}-${idx}`}
                                            onClick={() => setSelectedFlowDetail(flow)}
                                            className={cn(
                                                "flex items-center justify-between p-3 text-xs transition-colors hover:bg-white/[0.03] cursor-pointer group",
                                                isBlocked && "bg-rose-500/[0.04]"
                                            )}
                                        >
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                                                    {timeStr}
                                                </span>

                                                {/* Scheme Icon */}
                                                <span className="shrink-0 text-zinc-400">
                                                    {flow.scheme === 'https' ? (
                                                        <Lock size={13} className="text-emerald-400" />
                                                    ) : flow.scheme === 'http' ? (
                                                        <Unlock size={13} className="text-amber-400" />
                                                    ) : (
                                                        <Globe size={13} className="text-cyan-400" />
                                                    )}
                                                </span>

                                                {/* Method Badge */}
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold border shrink-0",
                                                    getMethodBadgeClass(flow.method || 'GET')
                                                )}>
                                                    {flow.method || 'GET'}
                                                </span>

                                                {/* Status Code */}
                                                <span className={cn(
                                                    "px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0",
                                                    getStatusBadgeClass(flow.status_code)
                                                )}>
                                                    {flow.status_code || 200}
                                                </span>

                                                {/* Host & Path */}
                                                <div className="flex items-center gap-1.5 truncate font-mono">
                                                    <span className="text-white font-semibold group-hover:text-cyan-300 transition-colors truncate">
                                                        {flow.host}
                                                    </span>
                                                    {flow.path && flow.path !== '/' && (
                                                        <span className="text-zinc-500 truncate text-[11px]">
                                                            {flow.path}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Right details & action */}
                                            <div className="flex items-center gap-3 shrink-0 ml-3">
                                                {flow.duration_ms > 0 && (
                                                    <span className="text-[10px] font-mono text-zinc-500">
                                                        {flow.duration_ms}ms
                                                    </span>
                                                )}
                                                {flow.response_size > 0 && (
                                                    <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-white/[0.04]">
                                                        {(flow.response_size / 1024).toFixed(1)} KB
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleAddSinkhole(flow.host);
                                                    }}
                                                    className="px-2 py-1 rounded bg-white/[0.05] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 border border-white/[0.06] hover:border-rose-500/30 text-[10px] font-medium transition-all"
                                                    title={`Blokir ${flow.host}`}
                                                >
                                                    + Sinkhole
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 2: DNS Queries & Custom Sinkhole Tab */}
            {activeTab === 'dns' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* DNS Query Stream Panel */}
                    <div className="lg:col-span-2 rounded-2xl bg-white/[0.03] border border-white/[0.08] p-6 backdrop-blur-md flex flex-col gap-4">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div>
                                <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                                    <Globe size={16} className="text-cyan-400" />
                                    DNS Queries & TLS SNI Stream
                                </h2>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                    Query DNS UDP port 53 dan TLS SNI port 443 dari target.
                                </p>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <div className="relative flex-1 sm:w-56">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                                    <input
                                        type="text"
                                        placeholder="Cari domain..."
                                        value={logSearchQuery}
                                        onChange={(e) => setLogSearchQuery(e.target.value)}
                                        className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-black/50 border border-white/[0.1] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={onClearLogs}
                                    className="p-2 rounded-xl bg-white/[0.04] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 border border-white/[0.08] transition-all"
                                    title="Bersihkan log DNS"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        </div>

                        {/* Logs Stream List */}
                        <div className="rounded-xl border border-white/[0.08] bg-black/40 overflow-hidden min-h-[300px] max-h-[420px] overflow-y-auto">
                            {filteredDnsLogs.length === 0 ? (
                                <div className="p-12 text-center text-xs text-zinc-500 flex flex-col items-center gap-2">
                                    <Activity size={24} className="opacity-40 animate-pulse text-cyan-400" />
                                    <span>Menunggu query DNS dari perangkat target...</span>
                                    <span className="text-[10px] text-zinc-600">Buka website apa pun di perangkat target.</span>
                                </div>
                            ) : (
                                <div className="divide-y divide-white/[0.04]">
                                    {filteredDnsLogs.map((log, idx) => {
                                        const isBlocked = log.status === 'sinkholed';
                                        const timeStr = new Date(log.timestamp * 1000).toLocaleTimeString();

                                        return (
                                            <div
                                                key={`${log.timestamp}-${idx}`}
                                                className={cn(
                                                    "flex items-center justify-between p-3 text-xs transition-colors hover:bg-white/[0.02]",
                                                    isBlocked && "bg-rose-500/[0.04]"
                                                )}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                                                        {timeStr}
                                                    </span>
                                                    <span className={cn(
                                                        "px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-bold shrink-0",
                                                        isBlocked
                                                            ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                                            : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                                    )}>
                                                        {log.status}
                                                    </span>
                                                    <span className="font-mono text-zinc-200 truncate font-medium">
                                                        {log.domain}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                                                        [{log.qtype}]
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0 ml-3">
                                                    {!isBlocked && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAddSinkhole(log.domain)}
                                                            className="px-2 py-1 rounded bg-white/[0.05] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 border border-white/[0.06] hover:border-rose-500/30 text-[10px] font-medium transition-all"
                                                            title={`Blokir domain ${log.domain} ke sinkhole`}
                                                        >
                                                            + Sinkhole
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Custom Domain Sinkhole Rules Panel */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-6 backdrop-blur-md flex flex-col justify-between gap-4">
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                                    <Ban size={16} className="text-rose-400" />
                                    🚫 Custom Domain Sinkhole
                                </h2>
                                <span className="px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] font-mono">
                                    {gatewayStatus.sinkhole_count || gatewayStatus.sinkhole_domains.length} Rules
                                </span>
                            </div>

                            <p className="text-xs text-zinc-400 mb-4">
                                Domain di bawah ini akan di-sinkhole (direspon dengan <code className="text-rose-300 font-mono">0.0.0.0</code>).
                            </p>

                            {/* Add Domain Input */}
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleAddSinkhole();
                                }}
                                className="flex items-center gap-2 mb-4"
                            >
                                <input
                                    type="text"
                                    placeholder="contoh: tiktok.com / ads.com"
                                    value={newSinkholeInput}
                                    onChange={(e) => setNewSinkholeInput(e.target.value)}
                                    className="flex-1 px-3 py-2 rounded-xl bg-black/50 border border-white/[0.1] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500/50 transition-all font-mono"
                                />
                                <button
                                    type="submit"
                                    disabled={!newSinkholeInput.trim()}
                                    className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
                                >
                                    <Plus size={14} />
                                    Tambah
                                </button>
                            </form>

                            {/* Active Sinkhole Domain Pills */}
                            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
                                {gatewayStatus.sinkhole_domains.length === 0 ? (
                                    <div className="text-xs text-zinc-500 italic p-3">
                                        Belum ada domain sinkhole.
                                    </div>
                                ) : (
                                    gatewayStatus.sinkhole_domains.map(domain => (
                                        <div
                                            key={domain}
                                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono text-xs shadow-sm"
                                        >
                                            <span>{domain}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveSinkhole(domain)}
                                                className="p-0.5 rounded hover:bg-rose-500/20 text-rose-400 hover:text-white transition-colors"
                                                title={`Hapus ${domain}`}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Quick Presets */}
                        <div className="pt-4 border-t border-white/[0.06] flex flex-col gap-2">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Quick Presets:</span>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleAddSinkhole('roblox.com')}
                                    className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-[11px] border border-white/[0.06] transition-colors"
                                >
                                    + roblox.com
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleAddSinkhole('tiktok.com')}
                                    className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-[11px] border border-white/[0.06] transition-colors"
                                >
                                    + tiktok.com
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleAddSinkhole('doubleclick.net')}
                                    className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-[11px] border border-white/[0.06] transition-colors"
                                >
                                    + Ads Tracker
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Flow Detail Modal Drawer */}
            <AnimatePresence>
                {selectedFlowDetail && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="w-full max-w-2xl bg-zinc-950 border border-white/[0.1] rounded-2xl p-6 shadow-2xl flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
                        >
                            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                                        <Layers size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                            <span>L7 Flow Inspector</span>
                                            <span className="text-[10px] font-mono text-zinc-500">[{selectedFlowDetail.id}]</span>
                                        </h3>
                                        <p className="text-xs text-zinc-400 font-mono">
                                            {selectedFlowDetail.scheme.toUpperCase()} ➔ {selectedFlowDetail.host}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedFlowDetail(null)}
                                    className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-400 hover:text-white transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* Key Value Details */}
                            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                                <div className="p-3 rounded-xl bg-black/40 border border-white/[0.06]">
                                    <span className="text-zinc-500 block text-[10px] uppercase">Client IP</span>
                                    <span className="text-zinc-200 font-bold">{selectedFlowDetail.client_ip}</span>
                                </div>
                                <div className="p-3 rounded-xl bg-black/40 border border-white/[0.06]">
                                    <span className="text-zinc-500 block text-[10px] uppercase">Method & Status</span>
                                    <span className="text-cyan-300 font-bold">{selectedFlowDetail.method} | {selectedFlowDetail.status_code || 200}</span>
                                </div>
                                <div className="p-3 rounded-xl bg-black/40 border border-white/[0.06]">
                                    <span className="text-zinc-500 block text-[10px] uppercase">Port & TLS</span>
                                    <span className="text-emerald-400 font-bold">{selectedFlowDetail.port} (TLS: {selectedFlowDetail.is_tls ? 'Yes' : 'No'})</span>
                                </div>
                                <div className="p-3 rounded-xl bg-black/40 border border-white/[0.06]">
                                    <span className="text-zinc-500 block text-[10px] uppercase">Duration & Size</span>
                                    <span className="text-zinc-300">{selectedFlowDetail.duration_ms}ms | {selectedFlowDetail.response_size} bytes</span>
                                </div>
                            </div>

                            {/* Full Path URL */}
                            <div className="flex flex-col gap-1.5 text-xs font-mono">
                                <span className="text-zinc-400 font-semibold">Target URI:</span>
                                <div className="p-3 rounded-xl bg-black/60 border border-white/[0.08] text-cyan-300 break-all select-all">
                                    {selectedFlowDetail.scheme}://{selectedFlowDetail.host}{selectedFlowDetail.path}
                                </div>
                            </div>

                            {/* Action Buttons in Modal */}
                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.08]">
                                <button
                                    type="button"
                                    onClick={() => {
                                        handleAddSinkhole(selectedFlowDetail.host);
                                        setSelectedFlowDetail(null);
                                    }}
                                    className="px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
                                >
                                    <Ban size={14} />
                                    <span>Blokir Domain Ini</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSelectedFlowDetail(null)}
                                    className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 text-xs font-semibold transition-all"
                                >
                                    Tutup
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};
