import { useState, useMemo } from 'react';
import {
    Zap,
    Key,
    Radar,
    Plus,
    Trash2,
    Check,
    Copy,
    Search,
    Globe,
    Settings2,
    FileText
} from 'lucide-react';
import { Device, DnsSpoofRule, SniffedCredential, BettercapStatus, SynScanResult } from '../types';
import { DnsSpoofModal } from './DnsSpoofModal';
import { cn } from '../lib/utils';

interface BettercapArsenalViewProps {
    devices: Device[];
    gateway: Device | null;
    dnsRules: DnsSpoofRule[];
    dnsSpoofAll: { enabled: boolean; address: string };
    dnsTtl: number;
    credentials: SniffedCredential[];
    bettercapStatus: BettercapStatus | null;
    onAddDnsRule: (domain: string, target_ip: string, action: 'spoof' | 'sinkhole') => Promise<any>;
    onUpdateDnsRule: (id: string, updates: { is_enabled?: boolean }) => Promise<any>;
    onDeleteDnsRule: (id: string) => Promise<any>;
    onSetSpoofAll: (enabled: boolean, address?: string) => Promise<any>;
    onLoadHosts: (content: string, defaultAddress?: string, action?: string) => Promise<any>;
    onSetTtl: (ttl: number) => Promise<any>;
    onClearCredentials: () => Promise<void>;
    onRunSynScan: (target_ip: string, ports?: number[], profile?: string) => Promise<SynScanResult>;
}

type ArsenalTab = 'dns' | 'credentials' | 'syn_scan';

export function BettercapArsenalView({
    devices,
    gateway,
    dnsRules,
    dnsSpoofAll,
    dnsTtl,
    credentials,
    bettercapStatus,
    onAddDnsRule,
    onUpdateDnsRule,
    onDeleteDnsRule,
    onSetSpoofAll,
    onLoadHosts,
    onSetTtl,
    onClearCredentials,
    onRunSynScan
}: BettercapArsenalViewProps) {
    const [activeTab, setActiveTab] = useState<ArsenalTab>('dns');
    const [isAddRuleOpen, setIsAddRuleOpen] = useState(false);
    const [dnsSearch, setDnsSearch] = useState('');

    // State panel "Pengaturan DNS" (mode blokir)
    const [showDnsSettings, setShowDnsSettings] = useState(false);
    const [hostsText, setHostsText] = useState('');
    const [ttlInput, setTtlInput] = useState<string>(String(dnsTtl || 10));
    const [dnsBusy, setDnsBusy] = useState(false);
    const [credSearch, setCredSearch] = useState('');
    const [selectedProtocol, setSelectedProtocol] = useState<string>('ALL');
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // SYN Scanner State
    const [synTargetIp, setSynTargetIp] = useState<string>(() => {
        const firstTarget = devices.find(d => !d.is_gateway && !d.is_self && d.is_online);
        return firstTarget ? firstTarget.ip : (gateway ? gateway.ip : '192.168.1.1');
    });
    const [synProfile, setSynProfile] = useState<'top-20' | 'top-100'>('top-20');
    const [isScanningSyn, setIsScanningSyn] = useState(false);
    const [synResult, setSynResult] = useState<SynScanResult | null>(null);
    const [synError, setSynError] = useState<string | null>(null);

    // Controller IP
    const controllerIp = useMemo(() => {
        const selfDev = devices.find(d => d.is_self);
        return selfDev ? selfDev.ip : '192.168.1.1';
    }, [devices]);

    // Filtered DNS Rules
    const filteredDnsRules = useMemo(() => {
        return dnsRules.filter(r =>
            r.domain.toLowerCase().includes(dnsSearch.toLowerCase()) ||
            r.target_ip.toLowerCase().includes(dnsSearch.toLowerCase())
        );
    }, [dnsRules, dnsSearch]);

    // Filtered Credentials
    const filteredCredentials = useMemo(() => {
        return credentials.filter(c => {
            const matchesSearch =
                c.client_ip.toLowerCase().includes(credSearch.toLowerCase()) ||
                c.host.toLowerCase().includes(credSearch.toLowerCase()) ||
                (c.username && c.username.toLowerCase().includes(credSearch.toLowerCase())) ||
                (c.token && c.token.toLowerCase().includes(credSearch.toLowerCase()));
            const matchesProto = selectedProtocol === 'ALL' || c.protocol === selectedProtocol;
            return matchesSearch && matchesProto;
        });
    }, [credentials, credSearch, selectedProtocol]);

    const handleCopy = (id: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleToggleRule = async (rule: DnsSpoofRule) => {
        await onUpdateDnsRule(rule.id, { is_enabled: !rule.is_enabled });
    };

    const handleRunSynScan = async () => {
        if (!synTargetIp.trim()) return;
        setIsScanningSyn(true);
        setSynError(null);
        try {
            const res = await onRunSynScan(synTargetIp.trim(), undefined, synProfile);
            setSynResult(res);
        } catch (err: any) {
            setSynError(err.message || 'Gagal memindai port host target');
        } finally {
            setIsScanningSyn(false);
        }
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
            {/* Top Banner Header */}
            <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-amber-500/10 via-red-500/5 to-purple-500/10 border border-amber-500/20 p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                        <div className="size-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-500/20">
                            <Zap size={24} className="animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold text-white tracking-tight">Bettercap Security Arsenal</h1>
                                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono font-semibold border border-amber-500/30">
                                    ENGINE v2.3
                                </span>
                            </div>
                            <p className="text-xs text-zinc-400 mt-0.5">
                                Dynamic DNS Poisoning, Protocol Dissectors, Live Credential Sniffing & Fast SYN Recon
                            </p>
                        </div>
                    </div>

                    {/* Metric Badges */}
                    <div className="flex items-center gap-3">
                        <div className="px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 flex items-center gap-2.5">
                            <Globe size={15} className="text-amber-400" />
                            <div>
                                <div className="text-[10px] text-zinc-500 uppercase font-mono tracking-wider">DNS Rules</div>
                                <div className="text-sm font-bold font-mono text-white">{dnsRules.length}</div>
                            </div>
                        </div>

                        <div className="px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 flex items-center gap-2.5">
                            <Key size={15} className="text-emerald-400" />
                            <div>
                                <div className="text-[10px] text-zinc-500 uppercase font-mono tracking-wider">Captured Auth</div>
                                <div className="text-sm font-bold font-mono text-white">{credentials.length}</div>
                            </div>
                        </div>

                        <div className="px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 flex items-center gap-2.5">
                            <Radar size={15} className="text-sky-400" />
                            <div>
                                <div className="text-[10px] text-zinc-500 uppercase font-mono tracking-wider">Gateway MitM</div>
                                <div className="text-sm font-bold font-mono text-emerald-400">
                                    {bettercapStatus?.active_gateway_sessions || 0} ACTIVE
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Sub-Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
                <button
                    onClick={() => setActiveTab('dns')}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all",
                        activeTab === 'dns'
                            ? "bg-white/[0.08] text-white border border-white/15 shadow-sm"
                            : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
                    )}
                >
                    <Globe size={14} className={activeTab === 'dns' ? "text-amber-400" : ""} />
                    <span>DNS Spoofing Rules ({dnsRules.length})</span>
                </button>

                <button
                    onClick={() => setActiveTab('credentials')}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all",
                        activeTab === 'credentials'
                            ? "bg-white/[0.08] text-white border border-white/15 shadow-sm"
                            : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
                    )}
                >
                    <Key size={14} className={activeTab === 'credentials' ? "text-emerald-400" : ""} />
                    <span>Credentials & Sniffer Feed ({credentials.length})</span>
                </button>

                <button
                    onClick={() => setActiveTab('syn_scan')}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all",
                        activeTab === 'syn_scan'
                            ? "bg-white/[0.08] text-white border border-white/15 shadow-sm"
                            : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
                    )}
                >
                    <Radar size={14} className={activeTab === 'syn_scan' ? "text-sky-400" : ""} />
                    <span>SYN Port Scanner</span>
                </button>
            </div>

            {/* TAB 1: DNS SPOOFING RULES */}
            {activeTab === 'dns' && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                        <div className="relative flex-1 max-w-md">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                            <input
                                type="text"
                                value={dnsSearch}
                                onChange={(e) => setDnsSearch(e.target.value)}
                                placeholder="Cari pola domain atau target IP..."
                                className="w-full bg-[#111318] border border-white/10 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 font-mono"
                            />
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => setShowDnsSettings(v => !v)}
                                className={cn(
                                    "flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all",
                                    showDnsSettings ? "bg-white/10 border-white/20 text-white" : "bg-[#111318] border-white/10 text-zinc-300 hover:border-white/20"
                                )}
                                title="Fitur bettercap: hosts-file, spoof-all, TTL"
                            >
                                <Settings2 size={15} className="text-amber-400" />
                                <span>Pengaturan</span>
                            </button>
                            <button
                                onClick={() => setIsAddRuleOpen(true)}
                                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs shadow-md shadow-amber-500/20 transition-all"
                            >
                                <Plus size={15} />
                                <span>Tambah Aturan DNS</span>
                            </button>
                        </div>
                    </div>

                    {/* Panel Pengaturan DNS (fitur port bettercap: hosts-file, spoof-all, TTL) */}
                    {showDnsSettings && (
                        <div className="rounded-2xl bg-[#0e1015] border border-white/10 p-4 space-y-4 shadow-xl">
                            {/* Spoof-all */}
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                                <div>
                                    <div className="text-sm font-semibold text-white flex items-center gap-2">
                                        <Globe size={14} className="text-rose-400" /> Blokir Semua Domain
                                    </div>
                                    <p className="text-[11px] text-zinc-500 mt-0.5">Blokir <b>seluruh</b> akses internet target (semua domain dijawab 0.0.0.0). Hati-hati: memutus internet target sepenuhnya.</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        disabled={dnsBusy}
                                        onClick={async () => {
                                            setDnsBusy(true);
                                            try { await onSetSpoofAll(!dnsSpoofAll.enabled, '0.0.0.0'); } finally { setDnsBusy(false); }
                                        }}
                                        className={cn(
                                            "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                                            dnsSpoofAll.enabled ? "bg-rose-500 hover:bg-rose-400 text-white" : "bg-emerald-500 hover:bg-emerald-400 text-black"
                                        )}
                                    >
                                        {dnsSpoofAll.enabled ? 'Nonaktifkan Blokir' : 'Blokir Semua'}
                                    </button>
                                </div>
                            </div>

                            {/* TTL */}
                            <div className="flex items-center gap-3 justify-between border-t border-white/5 pt-4">
                                <div>
                                    <div className="text-sm font-semibold text-white">TTL Jawaban DNS</div>
                                    <p className="text-[11px] text-zinc-500 mt-0.5">Berapa lama jawaban palsu di-cache target (detik). Saat ini: <b>{dnsTtl}s</b></p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={1}
                                        value={ttlInput}
                                        onChange={(e) => setTtlInput(e.target.value)}
                                        className="w-24 bg-[#111318] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50 font-mono"
                                    />
                                    <button
                                        disabled={dnsBusy}
                                        onClick={async () => {
                                            const t = parseInt(ttlInput, 10);
                                            if (!isNaN(t)) { setDnsBusy(true); try { await onSetTtl(t); } finally { setDnsBusy(false); } }
                                        }}
                                        className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-all"
                                    >
                                        Simpan TTL
                                    </button>
                                </div>
                            </div>

                            {/* Blokir Daftar Domain */}
                            <div className="border-t border-white/5 pt-4">
                                <div className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
                                    <FileText size={14} className="text-rose-400" /> Blokir Daftar Domain
                                </div>
                                <p className="text-[11px] text-zinc-500 mb-2">Satu domain per baris. Domain (dan subdomainnya) akan <b>diblokir</b> untuk target (dijawab 0.0.0.0). Baris diawali <span className="font-mono text-zinc-400">#</span> diabaikan.</p>
                                <textarea
                                    value={hostsText}
                                    onChange={(e) => setHostsText(e.target.value)}
                                    rows={4}
                                    placeholder={"tiktok.com\nfacebook.com\n# baris diawali # diabaikan"}
                                    className="w-full bg-[#111318] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-rose-500/50 font-mono resize-y"
                                />
                                <div className="flex justify-end mt-2">
                                    <button
                                        disabled={dnsBusy || !hostsText.trim()}
                                        onClick={async () => {
                                            setDnsBusy(true);
                                            try { await onLoadHosts(hostsText, '', 'sinkhole'); setHostsText(''); } finally { setDnsBusy(false); }
                                        }}
                                        className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-500 hover:bg-rose-400 text-white transition-all disabled:opacity-40"
                                    >
                                        Blokir Domain
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* DNS Rules Table */}
                    <div className="rounded-2xl bg-[#0e1015] border border-white/10 overflow-hidden shadow-xl">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-white/10 bg-white/[0.02] text-zinc-400 font-mono text-[11px]">
                                        <th className="py-3 px-4">Pola Domain (Wildcard)</th>
                                        <th className="py-3 px-4">Tindakan / Target IP</th>
                                        <th className="py-3 px-4 text-center">Hit Counter</th>
                                        <th className="py-3 px-4 text-center">Status</th>
                                        <th className="py-3 px-4 text-right">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5 font-mono">
                                    {filteredDnsRules.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="py-10 text-center text-zinc-500 font-sans">
                                                Belum ada aturan DNS Spoofing yang dibuat. Klik "Tambah Aturan DNS" di atas.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredDnsRules.map((rule) => (
                                            <tr key={rule.id} className="hover:bg-white/[0.02] transition-colors">
                                                <td className="py-3.5 px-4 font-semibold text-white">
                                                    <div className="flex items-center gap-2">
                                                        <Globe size={14} className="text-amber-400 shrink-0" />
                                                        <span className="text-amber-200">{rule.domain}</span>
                                                    </div>
                                                </td>
                                                <td className="py-3.5 px-4 text-zinc-300">
                                                    {rule.action === 'sinkhole' ? (
                                                        <span className="px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px]">
                                                            Sinkhole (0.0.0.0)
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px]">
                                                            Spoof &rarr; {rule.target_ip}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-3.5 px-4 text-center">
                                                    <span className={cn(
                                                        "px-2 py-0.5 rounded-full text-[10px] font-bold",
                                                        rule.hits > 0 ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "text-zinc-500"
                                                    )}>
                                                        {rule.hits || 0} hits
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-4 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleRule(rule)}
                                                        className={cn(
                                                            "px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all",
                                                            rule.is_enabled
                                                                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25"
                                                                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                                                        )}
                                                    >
                                                        {rule.is_enabled ? 'ENABLED' : 'DISABLED'}
                                                    </button>
                                                </td>
                                                <td className="py-3.5 px-4 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => onDeleteDnsRule(rule.id)}
                                                        className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                                        title="Hapus aturan ini"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: CREDENTIALS & SNIFFER FEED */}
            {activeTab === 'credentials' && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 max-w-lg">
                            <div className="relative flex-1">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                <input
                                    type="text"
                                    value={credSearch}
                                    onChange={(e) => setCredSearch(e.target.value)}
                                    placeholder="Cari host, IP korban, username..."
                                    className="w-full bg-[#111318] border border-white/10 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 font-mono"
                                />
                            </div>

                            {/* Protocol Filter */}
                            <select
                                value={selectedProtocol}
                                onChange={(e) => setSelectedProtocol(e.target.value)}
                                className="bg-[#111318] border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-amber-500/50 font-mono"
                            >
                                <option value="ALL">Semua Protokol</option>
                                <option value="HTTP-POST">HTTP-POST</option>
                                <option value="HTTP-BASIC">HTTP-BASIC</option>
                                <option value="HTTP-COOKIE">HTTP-COOKIE</option>
                                <option value="FTP">FTP</option>
                                <option value="MAIL">MAIL</option>
                            </select>
                        </div>

                        <button
                            onClick={onClearCredentials}
                            className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/30 text-zinc-400 hover:text-rose-300 text-xs transition-all shrink-0"
                        >
                            <Trash2 size={13} />
                            <span>Bersihkan Log Kredensial</span>
                        </button>
                    </div>

                    {/* Credentials List */}
                    <div className="space-y-2.5">
                        {filteredCredentials.length === 0 ? (
                            <div className="rounded-2xl bg-[#0e1015] border border-white/10 p-12 text-center text-zinc-500">
                                <Key size={32} className="mx-auto mb-3 opacity-30 text-zinc-400" />
                                <p className="text-sm font-medium text-zinc-400">Belum ada kredensial yang tertangkap</p>
                                <p className="text-xs text-zinc-600 mt-1 max-w-md mx-auto">
                                    Aktifkan mode Smart Gateway pada target untuk mulai menginspeksi lalu lintas form HTTP, Basic Auth, dan session token secara riil.
                                </p>
                            </div>
                        ) : (
                            filteredCredentials.map((cred) => (
                                <div
                                    key={cred.id}
                                    className="rounded-xl bg-[#0e1015] border border-white/10 p-4 hover:border-white/20 transition-all flex flex-col md:flex-row md:items-center justify-between gap-3"
                                >
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={cn(
                                                "px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase",
                                                cred.protocol.includes('BASIC') ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                                                cred.protocol.includes('POST') ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" :
                                                cred.protocol.includes('COOKIE') ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" :
                                                "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                                            )}>
                                                {cred.protocol}
                                            </span>
                                            <span className="text-xs font-mono font-semibold text-white">{cred.host}:{cred.port}</span>
                                            <span className="text-[11px] font-mono text-zinc-500">dari {cred.client_ip}</span>
                                            <span className="text-[10px] text-zinc-600 ml-auto">
                                                {new Date(cred.timestamp * 1000).toLocaleTimeString()}
                                            </span>
                                        </div>

                                        {/* Credential Data Display */}
                                        <div className="flex items-center gap-4 text-xs font-mono pt-1 text-zinc-300">
                                            {cred.username && (
                                                <div>
                                                    <span className="text-zinc-500">User:</span> <strong className="text-amber-200">{cred.username}</strong>
                                                </div>
                                            )}
                                            {cred.password && (
                                                <div>
                                                    <span className="text-zinc-500">Pass:</span> <strong className="text-emerald-300">{cred.password}</strong>
                                                </div>
                                            )}
                                            {cred.token && (
                                                <div className="truncate max-w-md">
                                                    <span className="text-zinc-500">Token/Cookie:</span> <span className="text-purple-300">{cred.token}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Copy action */}
                                    <button
                                        onClick={() => {
                                            const copyText = cred.username && cred.password
                                                ? `User: ${cred.username} | Pass: ${cred.password}`
                                                : (cred.token || cred.raw_snippet || '');
                                            handleCopy(cred.id, copyText);
                                        }}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-zinc-300 shrink-0 self-end md:self-auto transition-colors"
                                    >
                                        {copiedId === cred.id ? (
                                            <>
                                                <Check size={13} className="text-emerald-400" />
                                                <span className="text-emerald-400 font-medium">Tersalin</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy size={13} className="text-zinc-400" />
                                                <span>Salin Auth</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* TAB 3: FAST SYN PORT SCANNER */}
            {activeTab === 'syn_scan' && (
                <div className="space-y-6">
                    {/* Scan Trigger Panel */}
                    <div className="rounded-2xl bg-[#0e1015] border border-white/10 p-5 space-y-4">
                        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                            <div className="flex-1 space-y-1">
                                <label className="block text-xs font-medium text-zinc-400">Pilih Target Host (IP)</label>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={synTargetIp}
                                        onChange={(e) => setSynTargetIp(e.target.value)}
                                        className="bg-[#141720] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500/50 font-mono flex-1 max-w-xs"
                                    >
                                        {devices.map((d) => (
                                            <option key={d.ip} value={d.ip}>
                                                {d.ip} - {d.hostname || d.vendor || (d.is_gateway ? 'Gateway' : 'Unknown')} {d.is_self ? '(Perangkat Ini)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <input
                                        type="text"
                                        value={synTargetIp}
                                        onChange={(e) => setSynTargetIp(e.target.value)}
                                        placeholder="Atau ketik IP target..."
                                        className="bg-[#141720] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500/50 font-mono flex-1 max-w-xs"
                                    />
                                </div>
                            </div>

                            {/* Preset Buttons */}
                            <div className="space-y-1">
                                <label className="block text-xs font-medium text-zinc-400">Profil Port</label>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setSynProfile('top-20')}
                                        className={cn(
                                            "px-3 py-1.5 rounded-xl text-xs font-mono font-medium border transition-all",
                                            synProfile === 'top-20'
                                                ? "bg-sky-500/20 border-sky-500/40 text-sky-300"
                                                : "bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white"
                                        )}
                                    >
                                        Top 20 Ports
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSynProfile('top-100')}
                                        className={cn(
                                            "px-3 py-1.5 rounded-xl text-xs font-mono font-medium border transition-all",
                                            synProfile === 'top-100'
                                                ? "bg-sky-500/20 border-sky-500/40 text-sky-300"
                                                : "bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white"
                                        )}
                                    >
                                        Top 100 Ports
                                    </button>

                                    <button
                                        type="button"
                                        disabled={isScanningSyn}
                                        onClick={handleRunSynScan}
                                        className="flex items-center gap-2 px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-black font-semibold text-xs shadow-md shadow-sky-500/20 transition-all disabled:opacity-50"
                                    >
                                        <Radar size={14} className={isScanningSyn ? "animate-spin" : ""} />
                                        <span>{isScanningSyn ? 'Memindai...' : 'Jalankan Scan SYN'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {synError && (
                            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                                {synError}
                            </div>
                        )}
                    </div>

                    {/* Scan Results View */}
                    {synResult && (
                        <div className="rounded-2xl bg-[#0e1015] border border-white/10 p-5 space-y-4 shadow-xl">
                            <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-white font-mono">
                                        Hasil Pemindaian: <span className="text-sky-400">{synResult.target_ip}</span>
                                    </h3>
                                    <p className="text-xs text-zinc-400 mt-0.5">
                                        Dipindai dalam <span className="font-mono text-zinc-200">{synResult.scan_duration_sec}s</span> ({synResult.total_scanned} port diperiksa)
                                    </p>
                                </div>
                                <div className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-bold">
                                    {synResult.open_count} PORT TERBUKA
                                </div>
                            </div>

                            {synResult.open_ports.length === 0 ? (
                                <div className="py-8 text-center text-zinc-500 text-xs font-mono">
                                    Tidak ada port terbuka yang terdeteksi pada profil {synResult.profile}.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {synResult.open_ports.map((port) => (
                                        <div
                                            key={port.port}
                                            className="p-3.5 rounded-xl bg-[#141720] border border-white/10 space-y-1.5"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                                                    <span className="font-mono text-sm font-bold text-white">Port {port.port}</span>
                                                </div>
                                                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-semibold">
                                                    {port.service}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                                                <span>Latency:</span>
                                                <span className="text-zinc-200">{port.rtt_ms} ms</span>
                                            </div>

                                            {port.banner && (
                                                <div className="p-2 rounded-lg bg-black/40 border border-white/5 text-[10px] font-mono text-zinc-300 truncate">
                                                    {port.banner}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Add Rule Modal */}
            <DnsSpoofModal
                isOpen={isAddRuleOpen}
                onClose={() => setIsAddRuleOpen(false)}
                onSubmit={onAddDnsRule}
                defaultControllerIp={controllerIp}
            />
        </div>
    );
}
